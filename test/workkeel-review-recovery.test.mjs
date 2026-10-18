import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {sha256} from '../src/files.mjs';
import {withProjectMutationLock} from '../src/workkeel-lock.mjs';
import {executionDigest} from '../src/workkeel-execution-policy.mjs';
import {initializeTaskProject} from '../src/workkeel-project.mjs';
import {previewTaskIntake,applyTaskIntake} from '../src/workkeel-intake.mjs';
import {readNativeTask,mutateNativeTask} from '../src/workkeel-tasks.mjs';
import {prepareDispatchTicket,bindDispatchTicket} from '../src/workkeel-dispatch.mjs';
import {bindHostUsage,reportHostUsage,closeHostUsage,inspectHostBinding} from '../src/workkeel-host-usage.mjs';
import {createTrustedRoleHost} from '../src/workkeel-role-preflight.mjs';
import {recoverInterruptedReview,readReviewRecovery,confirmReviewRecoveryStopped} from '../src/workkeel-review-recovery.mjs';

const policy=()=>({schema_version:'workkeel.dispatch-policy/v1',models:[
  {alias:'small',provider:'local-provider',model:'small-model',reasoning:null,data_classes:['public','internal']},
  {alias:'careful',provider:'review-provider',model:'careful-model',reasoning:'deep',data_classes:['internal','public']}
],default_alias:'small',conservative_alias:'careful',parallelism:2});
const model={provider:'review-provider',model:'careful-model',reasoning:'deep'};
const completed={status:'completed',usage:{input_tokens:7,output_tokens:3},runtime_model:'careful-model',reasoning:'deep',output:'Synthetic review notes'};
const probe=(overrides={})=>({host:'fixture-review-host',enforcement:{sandbox:'enforced',product_access:'read',network:'disabled',test_scratch:'host-private'},
  tools:['shell'],models:[{provider:'review-provider',model:'careful-model',efforts:['deep']}],usage:{fields:['input_tokens','output_tokens'],unknown:'null'},...overrides});
function reviewHost({state='stopped',result=completed,probeResult=probe()}={}) {
  const calls={launch:0,runtimeState:0,specs:[]};
  const host=createTrustedRoleHost({id:'fixture-review-host',probe:async()=>structuredClone(probeResult),
    runtimeState:async query=>{calls.runtimeState++;const observed=typeof state==='function'?await state(query):state;if(observed instanceof Error)throw observed;return {state:observed};},
    launch:async spec=>{calls.launch++;calls.specs.push(spec);return typeof result==='function'?result(spec):structuredClone(result);}});
  return {host,calls};
}
// The project mutation lock file used by every task mutation.
const lockPath=root=>path.join(os.tmpdir(),`temple-mutation-${sha256(path.resolve(root)).slice(0,20)}.lock`);
const until=async check=>{for(let i=0;i<400&&!check();i++)await new Promise(r=>setTimeout(r,5));assert.ok(check());};

async function fixture(t,{expiresAt=null,closeBinding=true,beforeHandoff=null,parallelism=2}={}) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'workkeel-review-recovery-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  const actor={agent_id:'builder',principal_id:'owner'},reviewer={agent_id:'reviewer',principal_id:'owner'},other={agent_id:'second-reviewer',principal_id:'owner'};
  await initializeTaskProject(root,{schema_version:'workkeel.task-policy/v1',principals:['owner'],agents:[actor,reviewer,other],approvers:['owner'],review_separation:'distinct-agent'});
  await fs.mkdir(root+'/docs');await fs.mkdir(root+'/src');
  await fs.writeFile(root+'/docs/approval.md','Approved synthetic review recovery fixture, no live model execution.');
  await fs.writeFile(root+'/docs/check.md','Synthetic focused check output.');
  await fs.writeFile(root+'/docs/dispatch.json',JSON.stringify({...policy(),parallelism}));await fs.writeFile(root+'/src/a.mjs','export const a = 1;\n');
  git('add','.');git('commit','-qm','Fixture');
  const brief={schema_version:'workkeel.task-brief/v1',id:'WK-recovery',goal:'Synthetic review recovery',actor,acceptance:['Reviewed candidate'],
    environment:{cwd:'.',read_paths:['src','docs'],write_paths:['src'],tools:['node','shell'],resources:[],network:{mode:'none',hosts:[]},external_actions:[],
      data:{classification:'internal',model_access:'approved-connection',policy_refs:['docs/approval.md','docs/dispatch.json']}},
    authorization:{approved_by:'owner',approval_ref:'docs/approval.md',operations:['read','write','execute'],expires_at:expiresAt}};
  const preview=await previewTaskIntake(root,brief);await applyTaskIntake(root,brief,preview.fingerprint);
  await mutateNativeTask(root,brief.id,'claim',{operation_id:'claim',expected_version:1,actor,base_revision:git('rev-parse','HEAD')});
  let task=await readNativeTask(root,brief.id);
  const ticket=await prepareDispatchTicket(root,{operation_id:'dispatch-review',task_id:task.id,actor,claim_id:task.claim.id,contract_sha256:task.contract_sha256,
    policy_ref:'docs/dispatch.json',route:{alias:'careful'},node:{id:'review',activity_kind:'review',depends_on:[],read_paths:['src'],write_paths:[]},
    capabilities:{host:'fixture-host',models:[{provider:model.provider,model:model.model,reasoning:[model.reasoning]}]}});
  await bindDispatchTicket(root,{execution_id:ticket.execution_id,source:{kind:'host-report',thread_id:'review-thread-1',turn_id:'review-turn-1'},sample_kind:'fixture'});
  if(beforeHandoff)await beforeHandoff({root,task,actor});
  const claimId=task.claim.id,revision=git('rev-parse','HEAD');
  await mutateNativeTask(root,brief.id,'handoff',{operation_id:'handoff',expected_version:2,actor,claim_id:claimId,revision,summary:'Synthetic handoff',evidence:['docs/check.md'],unresolved:[]});
  const report={binding_id:ticket.execution_id,report_id:'interrupted',actor,claim_id:claimId,contract_sha256:task.contract_sha256,status:'interrupted',
    usage:{input_tokens:5,output_tokens:2,cost_usd:null},tool:'fixture-tool',provider:model.provider,model:model.model,reported_reasoning:model.reasoning,sample_kind:'fixture',observed_at:new Date().toISOString()};
  await reportHostUsage(root,report);
  if(closeBinding)await closeHostUsage(root,{binding_id:ticket.execution_id,actor,status:'stopped'});
  task=await readNativeTask(root,brief.id);
  const bindingFile=root+`/.ai-org/host-usage/${ticket.execution_id}/binding.json`;
  async function request(overrides={}) {
    const chain=await readReviewRecovery(root,brief.id),current=await readNativeTask(root,brief.id);
    return {schema_version:'workkeel.review-recovery-request/v1',operation_id:'recover-1',task_id:brief.id,expected_version:current.version,
      expected_chain_sha256:chain.chain_sha256,revision,actor,reviewer,
      predecessor:{kind:'host-binding',id:ticket.execution_id,sha256:(await inspectHostBinding(root,ticket.execution_id)).file_sha256},
      policy_ref:'docs/dispatch.json',model:{...model},source:{thread_id:'retry-thread-1',turn_id:'retry-turn-1'},...overrides};
  }
  return {root,git,actor,reviewer,other,task,ticket,claimId,revision,report,bindingFile,request,id:brief.id};
}
const review=(f,overrides={})=>({operation_id:'review',expected_version:3,actor:f.reviewer,revision:f.revision,judgment:'pass',summary:'Independent synthetic review',evidence:['docs/check.md'],...overrides});
const close=f=>({operation_id:'close',expected_version:4,actor:f.actor,revision:f.revision,summary:'Accepted',rollback:'Revert the synthetic commit',evidence:['docs/check.md']});
// A second claimed task in the same project, sharing its lock and source inventory.
async function secondTask(f,{roots=['docs']}={}) {
  // Keep the delivered candidate's product tree clean while the second task exists.
  await fs.mkdir(f.root+'/.git/info',{recursive:true});await fs.appendFile(f.root+'/.git/info/exclude','\n/.ai-org/work-items/WK-other.json\n/.ai-org/artifacts/WK-other/\n');
  const brief={schema_version:'workkeel.task-brief/v1',id:'WK-other',goal:'Second synthetic task',actor:f.actor,acceptance:['Done'],
    environment:{cwd:'.',read_paths:roots,write_paths:roots,tools:['node','shell'],resources:[],network:{mode:'none',hosts:[]},external_actions:[],
      data:{classification:'internal',model_access:'approved-connection',policy_refs:['docs/approval.md','docs/dispatch.json']}},
    authorization:{approved_by:'owner',approval_ref:'docs/approval.md',operations:['read','write','execute'],expires_at:null}};
  const preview=await previewTaskIntake(f.root,brief);await applyTaskIntake(f.root,brief,preview.fingerprint);
  await mutateNativeTask(f.root,brief.id,'claim',{operation_id:'claim-other',expected_version:1,actor:f.actor,base_revision:f.revision});
  const task=await readNativeTask(f.root,brief.id);
  return source=>({binding_id:`other-${source.turn_id}`,task_id:task.id,actor:f.actor,claim_id:task.claim.id,contract_sha256:task.contract_sha256,source:{kind:'host-report',...source}});
}
const rehashResult=async(f,change)=>{
  const file=`${f.root}/.ai-org/review-recovery/${f.id}/${f.claimId}/attempt-001-result.json`,envelope=JSON.parse(await fs.readFile(file,'utf8'));
  Object.assign(envelope.value,change);envelope.sha256=executionDigest(envelope.value);await fs.writeFile(file,JSON.stringify(envelope));
};

async function otherDispatch(f,{roots=['docs']}={}) {
  await secondTask(f,{roots});
  const task=await readNativeTask(f.root,'WK-other');
  const ticket=await prepareDispatchTicket(f.root,{operation_id:'other-dispatch',task_id:task.id,actor:f.actor,claim_id:task.claim.id,
    contract_sha256:task.contract_sha256,policy_ref:'docs/dispatch.json',route:{alias:'careful'},
    node:{id:'writer',activity_kind:'implementation',depends_on:[],read_paths:roots,write_paths:roots},
    capabilities:{host:'fixture-host',models:[{provider:model.provider,model:model.model,reasoning:[model.reasoning]}]}});
  return {ticket,bind:()=>bindDispatchTicket(f.root,{execution_id:ticket.execution_id,
    source:{kind:'host-report',thread_id:'other-dispatch-thread',turn_id:'other-dispatch-turn'},sample_kind:'fixture'})};
}

test('recovery launch enforces the original dispatch read roots without changing task authority',async t=>{
  const f=await fixture(t),before=await fs.readFile(f.root+'/.ai-org/work-items/'+f.id+'.json');
  const {host,calls}=reviewHost({result:spec=>{
    const flags=['--permission',...spec.contract.environment.read_paths.map(ref=>'--allow-fs-read='+path.join(f.root,ref))];
    const read=ref=>execFileSync(process.execPath,[...flags,'-e',`process.stdout.write(require('node:fs').readFileSync(${JSON.stringify(path.join(f.root,ref))},'utf8'))`],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
    assert.match(read('src/a.mjs'),/export const a/);
    assert.throws(()=>read('docs/check.md'),error=>error.status===1&&/ERR_ACCESS_DENIED/.test(error.stderr));
    assert.deepEqual(spec.contract.environment.write_paths,[]);
    assert.deepEqual(spec.dispatch.node.read_paths,['src']);
    return completed;
  }});
  const result=await recoverInterruptedReview(f.root,await f.request(),{host});
  assert.equal(result.status,'completed');
  assert.deepEqual(calls.specs[0].contract.environment.read_paths,['src']);
  assert.deepEqual(await fs.readFile(f.root+'/.ai-org/work-items/'+f.id+'.json'),before);
});

test('recovery and dispatch share capacity and scope checks in both start orders',async t=>{
  for(const {parallelism,roots,error} of [{parallelism:1,roots:['docs'],error:/host-dispatch-parallelism/},
    {parallelism:2,roots:['src'],error:/host-dispatch-scope-conflict/}]) {
    const f=await fixture(t,{parallelism}),other=await otherDispatch(f,{roots}),blocked=reviewHost();
    await other.bind();
    await assert.rejects(recoverInterruptedReview(f.root,await f.request(),{host:blocked.host}),error);
    assert.equal(blocked.calls.launch,0);
    const g=await fixture(t,{parallelism}),next=await otherDispatch(g,{roots});let release;
    const pending=new Promise(resolve=>{release=resolve;}),slow=reviewHost({result:()=>pending});
    const running=recoverInterruptedReview(g.root,await g.request(),{host:slow.host});
    await until(()=>slow.calls.launch===1);
    try { await assert.rejects(next.bind(),error); } finally { release(completed);await running; }
    assert.equal((await next.bind()).collection_closed,false,'valid terminal recovery releases its slot');
  }
});

test('disjoint recovery and writer can use separate slots and a racing last-slot reservation has one winner',async t=>{
  const f=await fixture(t),other=await otherDispatch(f);await other.bind();
  assert.equal((await recoverInterruptedReview(f.root,await f.request(),{host:reviewHost().host})).status,'completed');
  const g=await fixture(t,{parallelism:1}),next=await otherDispatch(g);
  let releaseProbe,releaseRun,probeEntered=false,rejected=false;
  const probeGate=new Promise(resolve=>{releaseProbe=resolve;}),runGate=new Promise(resolve=>{releaseRun=resolve;});
  const slow=reviewHost({state:async()=>{probeEntered=true;await probeGate;return 'stopped';},result:()=>runGate});
  const running=recoverInterruptedReview(g.root,await g.request(),{host:slow.host}).catch(e=>{rejected=true;throw e;});
  const settled=Promise.allSettled([running]); // Observe rejection immediately.
  await until(()=>probeEntered);
  const binding=next.bind();releaseProbe();
  const bound=await Promise.allSettled([binding]);await until(()=>rejected||slow.calls.launch===1);
  releaseRun(completed);const recovered=await settled;
  assert.equal([...bound,...recovered].filter(x=>x.status==='fulfilled').length,1);
  assert.match([...bound,...recovered].find(x=>x.status==='rejected').reason.message,/host-dispatch-parallelism/);
});

test('unknown and cancelled recovery reservations need an exact trusted stopped observation',async t=>{
  for(const cancel of [false,true]) {
    const f=await fixture(t,{parallelism:1}),other=await otherDispatch(f);let release;
    const pending=new Promise(resolve=>{release=resolve;}),slow=reviewHost({result:()=>pending});
    const running=recoverInterruptedReview(f.root,await f.request(),{host:slow.host});
    const settled=Promise.allSettled([running]);await until(()=>slow.calls.launch===1);
    const [attempt]=(await readReviewRecovery(f.root,f.id)).attempts;
    if(cancel)await mutateNativeTask(f.root,f.id,'cancel',{operation_id:'cancel',expected_version:3,actor:f.actor,summary:'Stop',evidence:['docs/check.md']});
    release({malformed:true});await settled;
    const before=await fs.readFile(f.root+'/.ai-org/work-items/'+f.id+'.json');
    await assert.rejects(other.bind(),/host-dispatch-parallelism/);
    const request={operation_id:'confirm-stopped',task_id:f.id,attempt_id:attempt.attempt_id,attempt_sha256:attempt.sha256,actor:f.actor};
    for(const state of ['active','unknown',new Error('unknown')])
      await assert.rejects(confirmReviewRecoveryStopped(f.root,request,{host:reviewHost({state}).host}),/active|unknown/);
    await assert.rejects(other.bind(),/host-dispatch-parallelism/);
    await assert.rejects(confirmReviewRecoveryStopped(f.root,{...request,attempt_sha256:'0'.repeat(64)},{host:reviewHost().host}),/stale/);
    await assert.rejects(confirmReviewRecoveryStopped(f.root,{...request,actor:f.reviewer},{host:reviewHost().host}),/original approving actor/);
    const wrongHost=createTrustedRoleHost({id:'wrong-host',probe:async()=>probe(),runtimeState:async()=>({state:'stopped'})});
    await assert.rejects(confirmReviewRecoveryStopped(f.root,request,{host:wrongHost}),/original runtime host/);
    const observer=reviewHost(),stopped=await confirmReviewRecoveryStopped(f.root,request,{host:observer.host});
    assert.equal(stopped.authority,'observation-only');assert.equal(observer.calls.launch,0);
    assert.equal((await confirmReviewRecoveryStopped(f.root,request,{host:observer.host})).replayed,true);
    assert.equal(observer.calls.runtimeState,1);
    await assert.rejects(confirmReviewRecoveryStopped(f.root,{...request,operation_id:'other-stop'},{host:observer.host}),/different input/);
    assert.deepEqual(await fs.readFile(f.root+'/.ai-org/work-items/'+f.id+'.json'),before);
    const marker=f.root+'/.ai-org/review-recovery-stops/'+attempt.attempt_id+'.json',bytes=await fs.readFile(marker);
    const forged=JSON.parse(bytes);forged.value.attempt_sha256='0'.repeat(64);forged.sha256=executionDigest(forged.value);
    await fs.writeFile(marker,JSON.stringify(forged));await assert.rejects(other.bind(),/stopped observation/);
    await fs.writeFile(marker,bytes);
    assert.equal((await other.bind()).collection_closed,false);
  }
});

test('unknown recovery can be replaced in one slot only after predecessor stop confirmation',async t=>{
  const f=await fixture(t,{parallelism:1});
  const one=await recoverInterruptedReview(f.root,await f.request(),{host:reviewHost({result:{malformed:true}}).host});
  const request=await f.request({operation_id:'recover-2',predecessor:{kind:'review-attempt',id:one.attempt_id,sha256:one.attempt_sha256},
    source:{thread_id:'retry-thread-2',turn_id:'retry-turn-2'}});
  const active=reviewHost({state:'active'});
  await assert.rejects(recoverInterruptedReview(f.root,request,{host:active.host}),/active/);assert.equal(active.calls.launch,0);
  assert.equal((await recoverInterruptedReview(f.root,request,{host:reviewHost().host})).status,'completed');
});

test('two different recovery tasks compete for the same execution slot',async t=>{
  const f=await fixture(t,{parallelism:1});await secondTask(f);
  await fs.appendFile(f.root+'/.git/info/exclude','\n/.ai-org/artifacts/WK-recovery/\n/.ai-org/work-items/WK-recovery.json\n');
  const other=await readNativeTask(f.root,'WK-other');
  const ticket=await prepareDispatchTicket(f.root,{operation_id:'other-review',task_id:other.id,actor:f.actor,claim_id:other.claim.id,
    contract_sha256:other.contract_sha256,policy_ref:'docs/dispatch.json',route:{alias:'careful'},
    node:{id:'other-review',activity_kind:'review',depends_on:[],read_paths:['docs'],write_paths:[]},
    capabilities:{host:'fixture-host',models:[{provider:model.provider,model:model.model,reasoning:[model.reasoning]}]}});
  await bindDispatchTicket(f.root,{execution_id:ticket.execution_id,source:{kind:'host-report',thread_id:'other-first-thread',turn_id:'other-first-turn'},sample_kind:'fixture'});
  await mutateNativeTask(f.root,other.id,'handoff',{operation_id:'other-handoff',expected_version:2,actor:f.actor,claim_id:other.claim.id,
    revision:f.revision,summary:'Synthetic review',evidence:['docs/check.md'],unresolved:[]});
  await closeHostUsage(f.root,{binding_id:ticket.execution_id,actor:f.actor,status:'stopped'});
  const request=await f.request({operation_id:'other-recover',task_id:other.id,expected_version:3,source:{thread_id:'other-retry-thread',turn_id:'other-retry-turn'},
    predecessor:{kind:'host-binding',id:ticket.execution_id,sha256:(await inspectHostBinding(f.root,ticket.execution_id)).file_sha256}});
  let release;const pending=new Promise(resolve=>{release=resolve;}),slow=reviewHost({result:()=>pending});
  const running=recoverInterruptedReview(f.root,await f.request(),{host:slow.host});await until(()=>slow.calls.launch===1);
  const blocked=reviewHost();
  try { await assert.rejects(recoverInterruptedReview(f.root,request,{host:blocked.host}),/host-dispatch-parallelism/); }
  finally { release(completed);await running; }
  assert.equal(blocked.calls.launch,0);
  assert.equal((await recoverInterruptedReview(f.root,request,{host:blocked.host})).status,'completed');
});

test('stop confirmation rechecks exact bytes after its await and snapshots caller input',async t=>{
  const f=await fixture(t,{parallelism:1}),one=await recoverInterruptedReview(f.root,await f.request(),
    {host:reviewHost({result:()=>{throw Error('unconfirmed launch');}}).host});
  const request={operation_id:'stop-after-await',task_id:f.id,attempt_id:one.attempt_id,attempt_sha256:one.attempt_sha256,actor:f.actor};
  const file=f.root+'/.ai-org/review-recovery/'+f.id+'/'+f.claimId+'/attempt-001.json',bytes=await fs.readFile(file);
  const changed=reviewHost({state:async()=>{await fs.appendFile(file,' ');return 'stopped';}});
  await assert.rejects(confirmReviewRecoveryStopped(f.root,request,{host:changed.host}),/stale|result does not match its attempt/);
  assert.equal(existsSync(f.root+'/.ai-org/review-recovery-stops'),false);
  await fs.writeFile(file,bytes);
  const frozen=structuredClone(request),observing=reviewHost({state:async()=>{request.actor.agent_id='changed';request.attempt_sha256='0'.repeat(64);return 'stopped';}});
  const stopped=await confirmReviewRecoveryStopped(f.root,request,{host:observing.host});
  assert.deepEqual(stopped.actor,frozen.actor);assert.equal(stopped.attempt_sha256,frozen.attempt_sha256);
});

test('legacy unresolved recovery keeps its broad read scope; new scope pins cannot be broadened',async t=>{
  const f=await fixture(t),other=await otherDispatch(f);
  await recoverInterruptedReview(f.root,await f.request(),{host:reviewHost({result:{malformed:true}}).host});
  assert.equal((await other.bind()).collection_closed,false,'new pinned src-only recovery permits a docs writer');
  const g=await fixture(t),writer=await otherDispatch(g);
  const result=await recoverInterruptedReview(g.root,await g.request(),{host:reviewHost({result:{malformed:true}}).host});
  // Synthesize the retained pre-upgrade schema, preserving both integrity pins.
  await rehashAttemptAndResult(g,1,v=>{delete v.execution_scope;},()=>{});
  await readReviewRecovery(g.root,g.id);
  await assert.rejects(writer.bind(),/host-dispatch-scope-conflict/);
  const [attempt]=(await readReviewRecovery(g.root,g.id)).attempts;
  await confirmReviewRecoveryStopped(g.root,{operation_id:'legacy-stopped',task_id:g.id,attempt_id:result.attempt_id,attempt_sha256:attempt.sha256,actor:g.actor},
    {host:reviewHost().host});
  assert.equal((await writer.bind()).collection_closed,false);
  const h=await fixture(t);
  await recoverInterruptedReview(h.root,await h.request(),{host:reviewHost().host});
  await rehashAttemptAndResult(h,1,v=>{v.execution_scope.read_paths=['src','docs'];},()=>{});
  await assert.rejects(readReviewRecovery(h.root,h.id),/execution scope differs/);
});
// Jointly rewrites an attempt and its result, recomputing both envelopes and the
// result's attempt file digest, so only independent authority can expose it.
const rehashAttemptAndResult=async(f,n,editAttempt,editResult)=>{
  const dir=`${f.root}/.ai-org/review-recovery/${f.id}/${f.claimId}`,name=`attempt-${String(n).padStart(3,'0')}`;
  const attempt=JSON.parse(await fs.readFile(`${dir}/${name}.json`,'utf8'));editAttempt(attempt.value);attempt.sha256=executionDigest(attempt.value);
  const bytes=JSON.stringify(attempt);await fs.writeFile(`${dir}/${name}.json`,bytes);
  const result=JSON.parse(await fs.readFile(`${dir}/${name}-result.json`,'utf8'));
  result.value.attempt_sha256=createHash('sha256').update(bytes).digest('hex');editResult(result.value);result.sha256=executionDigest(result.value);
  await fs.writeFile(`${dir}/${name}-result.json`,JSON.stringify(result));
};
const unauthorized=v=>{v.selected.model='unauthorized-model';v.selected.reasoning='unauthorized-effort';};
const unauthorizedReport=v=>{v.runtime_model='unauthorized-model';v.reasoning='unauthorized-effort';};
const authorityBytes=async f=>Promise.all([f.bindingFile,...(await fs.readdir(f.root+'/.ai-org/dispatch')).filter(n=>n.endsWith('.json')).map(n=>`${f.root}/.ai-org/dispatch/${n}`)].map(p=>fs.readFile(p)));

test('recovery sources are fresh across the workspace: retained implementation bindings cannot supply a review',async t=>{
  const implementation={kind:'host-report',thread_id:'implementation-thread',turn_id:'implementation-turn'};
  const f=await fixture(t,{beforeHandoff:async({root,task,actor})=>{
    await bindHostUsage(root,{binding_id:'implementation-retained',task_id:task.id,actor,claim_id:task.claim.id,contract_sha256:task.contract_sha256,source:implementation});
    await closeHostUsage(root,{binding_id:'implementation-retained',actor,status:'stopped'});
  }});
  const bindingBytes=await fs.readFile(f.root+'/.ai-org/host-usage/implementation-retained/binding.json'),{host,calls}=reviewHost();
  for(const source of [{thread_id:'implementation-thread',turn_id:'implementation-turn'},{thread_id:'implementation-thread',turn_id:'fresh-turn'},{thread_id:'fresh-thread',turn_id:'implementation-turn'}])
    await assert.rejects(recoverInterruptedReview(f.root,await f.request({source}),{host}),/fresh source/);
  assert.equal(calls.launch,0);assert.equal(calls.runtimeState,0);assert.equal((await readReviewRecovery(f.root,f.id)).attempts.length,0);
  assert.deepEqual(await fs.readFile(f.root+'/.ai-org/host-usage/implementation-retained/binding.json'),bindingBytes);
  assert.equal((await recoverInterruptedReview(f.root,await f.request(),{host})).status,'completed');
});

test('source uniqueness holds across tasks in both directions and under concurrent reservation',async t=>{
  const f=await fixture(t),other=await secondTask(f);
  // Another task's retained binding blocks recovery.
  await bindHostUsage(f.root,other({thread_id:'shared-thread',turn_id:'shared-turn'}));
  const blocked=reviewHost();
  await assert.rejects(recoverInterruptedReview(f.root,await f.request({source:{thread_id:'shared-thread',turn_id:'shared-turn'}}),{host:blocked.host}),/fresh source/);
  assert.equal(blocked.calls.launch,0);
  // A recovery attempt's source blocks later bindings by any task; identical replay still works.
  const request=await f.request(),done=await recoverInterruptedReview(f.root,request,{host:reviewHost().host});
  for(const source of [{thread_id:'retry-thread-1',turn_id:'retry-turn-1'},{thread_id:'retry-thread-1',turn_id:'other-turn'},{thread_id:'other-thread',turn_id:'retry-turn-1'}])
    await assert.rejects(bindHostUsage(f.root,other(source)),/host-source-used-by-review-recovery/);
  assert.equal((await recoverInterruptedReview(f.root,request,{host:blocked.host})).attempt_id,done.attempt_id);
  assert.equal(blocked.calls.launch,0);
});

test('a concurrent binding and recovery reserving one source have exactly one winner',async t=>{
  const f=await fixture(t),other=await secondTask(f),source={thread_id:'race-thread',turn_id:'race-turn'};
  const {host,calls}=reviewHost();
  const outcomes=await Promise.allSettled([recoverInterruptedReview(f.root,await f.request({source}),{host}),bindHostUsage(f.root,other(source))]);
  assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1,JSON.stringify(outcomes.map(o=>o.reason?.message??o.status)));
  const recovered=outcomes[0].status==='fulfilled',view=await readReviewRecovery(f.root,f.id);
  assert.equal(view.attempts.length,recovered?1:0);assert.equal(calls.launch,recovered?1:0);
  assert.equal(existsSync(f.root+'/.ai-org/host-usage/other-race-turn'),!recovered);
  assert.match(outcomes[recovered?1:0].reason.message,recovered?/host-source-used-by-review-recovery/:/fresh source/);
});

test('ordinary binding inside an already-held project lock completes without waiting for that lock',async t=>{
  const f=await fixture(t),other=await secondTask(f),started=Date.now();
  // Execution capture binds while holding the project lock; binding must not reacquire it.
  const bound=await withProjectMutationLock(f.root,()=>bindHostUsage(f.root,other({thread_id:'nested-thread',turn_id:'nested-turn'})));
  assert.equal(bound.collection_closed,false);assert.ok(Date.now()-started<1500,`bind took ${Date.now()-started}ms`);
  const {host,calls}=reviewHost();
  await assert.rejects(recoverInterruptedReview(f.root,await f.request({source:{thread_id:'nested-thread',turn_id:'nested-turn'}}),{host}),/fresh source/);
  assert.equal(calls.launch,0);
});

test('a source bound while recovery awaits its probes is rejected at reservation',async t=>{
  const f=await fixture(t),other=await secondTask(f),source={thread_id:'probe-race-thread',turn_id:'probe-race-turn'};let launched=0;
  const host=createTrustedRoleHost({id:'fixture-review-host',probe:async()=>probe(),
    runtimeState:async()=>{await bindHostUsage(f.root,other(source));return {state:'stopped'};},
    launch:async()=>{launched++;return structuredClone(completed);}});
  await assert.rejects(recoverInterruptedReview(f.root,await f.request({source}),{host}),/fresh source/);
  assert.equal(launched,0);assert.equal((await readReviewRecovery(f.root,f.id)).attempts.length,0);
  assert.ok(existsSync(f.root+'/.ai-org/host-usage/other-probe-race-turn'));
});

test('the approved request is snapshotted before the first await; caller mutation changes nothing',async t=>{
  const f=await fixture(t),request=await f.request(),original=structuredClone(request);let spec=null;
  const host=createTrustedRoleHost({id:'fixture-review-host',probe:async()=>{request.source.thread_id='probe-thread';return probe();},
    runtimeState:async()=>{request.source={thread_id:'changed-thread',turn_id:'changed-turn'};request.model.model='other-model';request.operation_id='changed';return {state:'stopped'};},
    launch:async value=>{spec=value;return structuredClone(completed);}});
  const result=await recoverInterruptedReview(f.root,request,{host});
  assert.deepEqual(spec.source,original.source);assert.equal(spec.model.model,model.model);
  const view=await readReviewRecovery(f.root,f.id);assert.deepEqual(view.attempts[0].source,original.source);
  const attempt=JSON.parse(await fs.readFile(`${f.root}/.ai-org/review-recovery/${f.id}/${f.claimId}/attempt-001.json`,'utf8')).value;
  assert.equal(attempt.request_sha256,executionDigest(original));assert.equal(attempt.operation_id,'recover-1');
  const replayed=await recoverInterruptedReview(f.root,original,{host:reviewHost().host});
  assert.equal(replayed.replayed,true);assert.equal(replayed.attempt_id,result.attempt_id);
  await assert.rejects(recoverInterruptedReview(f.root,{...original,source:{thread_id:'changed-thread',turn_id:'changed-turn'}},{host:reviewHost().host}),/different input/);
});

test('malformed host model or effort becomes a readable interrupted attempt and retry stays bounded',async t=>{
  for(const bad of [{runtime_model:''},{runtime_model:'   '},{reasoning:''},{reasoning:' \t'},{runtime_model:'careful\nmodel'}]) {
    const f=await fixture(t),one=await recoverInterruptedReview(f.root,await f.request(),{host:reviewHost({result:{...completed,...bad}}).host});
    assert.equal(one.status,'interrupted');assert.deepEqual(one.usage,{input_tokens:null,output_tokens:null});
    const envelope=JSON.parse(await fs.readFile(`${f.root}/.ai-org/review-recovery/${f.id}/${f.claimId}/attempt-001-result.json`,'utf8'));
    assert.equal(envelope.value.error,'invalid-host-result');assert.equal(envelope.value.runtime_model,null);assert.equal(envelope.value.reasoning,null);
    assert.equal((await readReviewRecovery(f.root,f.id)).attempts[0].status,'interrupted');
    const two=await recoverInterruptedReview(f.root,await f.request({operation_id:'recover-2',predecessor:{kind:'review-attempt',id:one.attempt_id,sha256:one.attempt_sha256},
      source:{thread_id:'retry-thread-2',turn_id:'retry-turn-2'}}),{host:reviewHost().host});
    assert.equal(two.status,'completed');assert.equal((await readReviewRecovery(f.root,f.id)).attempts.length,2);
  }
});

test('completed results must match the pinned model and effort at read, review and close even when rehashed',async t=>{
  for(const change of [{runtime_model:'unapproved-model'},{reasoning:'unapproved-effort'},{runtime_model:'unapproved-model',reasoning:'unapproved-effort'}]) {
    const f=await fixture(t),result=await recoverInterruptedReview(f.root,await f.request(),{host:reviewHost().host});
    await rehashResult(f,change);
    await assert.rejects(readReviewRecovery(f.root,f.id),/differs from the approved selection/);
    await assert.rejects(mutateNativeTask(f.root,f.id,'review',review(f,{review_attempt_id:result.attempt_id})),/differs from the approved selection/);
    assert.equal((await readNativeTask(f.root,f.id)).state,'test');
  }
  // A flagged mismatch must really differ, and an unflagged failure must really match.
  for(const [host,change] of [[{...completed,runtime_model:'other-model'},{runtime_model:'careful-model'}],[{...completed,status:'failed'},{runtime_model:'other-model'}]]) {
    const f=await fixture(t);await recoverInterruptedReview(f.root,await f.request(),{host:reviewHost({result:host}).host});
    await readReviewRecovery(f.root,f.id);await rehashResult(f,change);
    await assert.rejects(readReviewRecovery(f.root,f.id),/differs from the approved selection/);
  }
  const f=await fixture(t),result=await recoverInterruptedReview(f.root,await f.request(),{host:reviewHost().host});
  await mutateNativeTask(f.root,f.id,'review',review(f,{review_attempt_id:result.attempt_id}));
  await rehashResult(f,{runtime_model:'unapproved-model'});
  await assert.rejects(mutateNativeTask(f.root,f.id,'close',close(f)),/differs from the approved selection|chain changed after the authored review/);
  assert.equal((await readNativeTask(f.root,f.id)).state,'release_gate');
});

test('jointly rehashed attempt selection and completed result cannot replace the approved dispatch at read, review and close',async t=>{
  const f=await fixture(t),result=await recoverInterruptedReview(f.root,await f.request(),{host:reviewHost().host}),authority=await authorityBytes(f);
  await rehashAttemptAndResult(f,1,unauthorized,unauthorizedReport);
  await assert.rejects(readReviewRecovery(f.root,f.id),/differs from the approved review dispatch/);
  await assert.rejects(mutateNativeTask(f.root,f.id,'review',review(f,{review_attempt_id:result.attempt_id})),/differs from the approved review dispatch/);
  assert.equal((await readNativeTask(f.root,f.id)).state,'test');
  // Policy reference and provider are equally bound to the ticket.
  for(const edit of [v=>{v.policy_ref='docs/approval.md';},v=>{v.selected.provider='other-provider';}]) {
    const g=await fixture(t);await recoverInterruptedReview(g.root,await g.request(),{host:reviewHost().host});
    await rehashAttemptAndResult(g,1,edit,()=>{});
    await assert.rejects(readReviewRecovery(g.root,g.id),/differs from the approved review dispatch/);
  }
  // After an authored review, the same joint rewrite blocks close.
  const g=await fixture(t),done=await recoverInterruptedReview(g.root,await g.request(),{host:reviewHost().host});
  await mutateNativeTask(g.root,g.id,'review',review(g,{review_attempt_id:done.attempt_id}));
  await rehashAttemptAndResult(g,1,unauthorized,unauthorizedReport);
  await assert.rejects(mutateNativeTask(g.root,g.id,'close',close(g)),/differs from the approved review dispatch|chain changed after the authored review/);
  assert.equal((await readNativeTask(g.root,g.id)).state,'release_gate');
  assert.deepEqual(await authorityBytes(f),authority);
});

test('attempts stay anchored to the original review dispatch; another valid ticket cannot be substituted',async t=>{
  let substitutes;
  const f=await fixture(t,{beforeHandoff:async({root,task,actor})=>{
    // Two further valid review tickets for this same delivery claim: one with another model, one with the same.
    const ticket=(operation_id,alias,models)=>prepareDispatchTicket(root,{operation_id,task_id:task.id,actor,claim_id:task.claim.id,contract_sha256:task.contract_sha256,
      policy_ref:'docs/dispatch.json',route:{alias},node:{id:operation_id,activity_kind:'review',depends_on:[],read_paths:['src'],write_paths:[]},capabilities:{host:'fixture-host',models}});
    substitutes=[await ticket('dispatch-small','small',[{provider:'local-provider',model:'small-model',reasoning:[null]}]),
      await ticket('dispatch-careful','careful',[{provider:model.provider,model:model.model,reasoning:[model.reasoning]}])];
  }});
  const result=await recoverInterruptedReview(f.root,await f.request(),{host:reviewHost().host});
  const dir=`${f.root}/.ai-org/review-recovery/${f.id}/${f.claimId}`,original=await Promise.all(['attempt-001.json','attempt-001-result.json'].map(n=>fs.readFile(`${dir}/${n}`)));
  for(const substitute of substitutes) {
    const selected=substitute.selected;
    await rehashAttemptAndResult(f,1,v=>{v.dispatch_execution_id=substitute.execution_id;v.predecessor.dispatch_execution_id=substitute.execution_id;
      v.selected={provider:selected.provider,model:selected.model,reasoning:selected.reasoning};},v=>{v.runtime_model=selected.model;v.reasoning=selected.reasoning;});
    await assert.rejects(readReviewRecovery(f.root,f.id),/predecessor evidence changed/);
    await assert.rejects(mutateNativeTask(f.root,f.id,'review',review(f,{review_attempt_id:result.attempt_id})),/predecessor evidence changed/);
    await fs.writeFile(`${dir}/attempt-001.json`,original[0]);await fs.writeFile(`${dir}/attempt-001-result.json`,original[1]);
  }
  assert.equal((await readReviewRecovery(f.root,f.id)).attempts[0].status,'completed');

  // A later attempt inherits the original dispatch; rewriting it alone, or with its selection, is rejected.
  const g=await fixture(t),first=await recoverInterruptedReview(g.root,await g.request(),{host:reviewHost({result:{...completed,status:'interrupted'}}).host});
  const second=await recoverInterruptedReview(g.root,await g.request({operation_id:'recover-2',predecessor:{kind:'review-attempt',id:first.attempt_id,sha256:first.attempt_sha256},
    source:{thread_id:'retry-thread-2',turn_id:'retry-turn-2'}}),{host:reviewHost().host});
  assert.equal(second.status,'completed');
  await rehashAttemptAndResult(g,2,unauthorized,unauthorizedReport);
  await assert.rejects(readReviewRecovery(g.root,g.id),/differs from the approved review dispatch/);
  await assert.rejects(mutateNativeTask(g.root,g.id,'review',review(g,{review_attempt_id:second.attempt_id})),/differs from the approved review dispatch/);
});

test('an interrupted review resumes on the same task and exact candidate, then ordinary review and close accept it',async t=>{
  const f=await fixture(t),bindingBytes=await fs.readFile(f.bindingFile),{host,calls}=reviewHost();
  // The old implementation claim cannot authorize a fresh binding or ticket after handoff.
  await assert.rejects(bindHostUsage(f.root,{binding_id:'after-handoff',task_id:f.id,actor:f.actor,claim_id:f.claimId,contract_sha256:f.task.contract_sha256,source:{kind:'host-report',thread_id:'bypass',turn_id:'bypass'}}),/matching implementation claim/);
  await assert.rejects(prepareDispatchTicket(f.root,{operation_id:'bypass',task_id:f.id,actor:f.actor,claim_id:f.claimId,contract_sha256:f.task.contract_sha256,policy_ref:'docs/dispatch.json',node:{id:'review-2',activity_kind:'review',depends_on:[],read_paths:['src'],write_paths:[]},capabilities:{host:'h',models:[{provider:model.provider,model:model.model,reasoning:[model.reasoning]}]}}),/matching implementation claim/);
  const request=await f.request(),result=await recoverInterruptedReview(f.root,request,{host});
  assert.equal(result.status,'completed');assert.equal(result.acceptance,'not-performed');assert.equal(result.implementation_authority,false);
  assert.deepEqual(result.usage,{input_tokens:7,output_tokens:3});assert.equal(typeof result.duration_ms,'number');
  assert.equal(calls.launch,1);assert.equal(calls.runtimeState,1);assert.equal(calls.specs[0].product_access,'read');assert.equal(calls.specs[0].revision,f.revision);
  let task=await readNativeTask(f.root,f.id);assert.equal(task.state,'test');assert.equal(task.review,null);assert.equal(task.version,3);
  // Identical replays never launch again; a reused operation ID with other input conflicts.
  const replayed=await recoverInterruptedReview(f.root,request,{host});
  assert.equal(replayed.replayed,true);assert.equal(replayed.attempt_id,result.attempt_id);assert.equal(calls.launch,1);
  await assert.rejects(recoverInterruptedReview(f.root,{...request,source:{thread_id:'other',turn_id:'other'}},{host}),/different input/);
  // The completed attempt is not acceptance and cannot be retried again.
  await assert.rejects(recoverInterruptedReview(f.root,await f.request({operation_id:'recover-2',predecessor:{kind:'review-attempt',id:result.attempt_id,sha256:result.attempt_sha256},source:{thread_id:'t3',turn_id:'t3'}}),{host}),/latest attempt completed/);
  // A late report on the stopped predecessor cannot mutate its retained evidence.
  await assert.rejects(reportHostUsage(f.root,{...f.report,report_id:'late',status:'completed'}),/binding-closed/);
  await assert.rejects(mutateNativeTask(f.root,f.id,'review',review(f)),/current review recovery attempt/);
  await assert.rejects(mutateNativeTask(f.root,f.id,'review',review(f,{review_attempt_id:result.attempt_id,actor:f.other})),/not completed by this reviewer/);
  await mutateNativeTask(f.root,f.id,'review',review(f,{review_attempt_id:result.attempt_id}));
  task=await readNativeTask(f.root,f.id);assert.equal(task.review.attempt_id,result.attempt_id);assert.equal(task.review.attempt_sha256,result.attempt_sha256);
  await mutateNativeTask(f.root,f.id,'close',{operation_id:'close',expected_version:4,actor:f.actor,revision:f.revision,summary:'Accepted',rollback:'Revert the synthetic commit',evidence:['docs/check.md']});
  assert.equal((await readNativeTask(f.root,f.id)).state,'done');
  assert.deepEqual(await fs.readFile(f.bindingFile),bindingBytes);
  assert.equal((await readReviewRecovery(f.root,f.id)).attempts[0].sha256,result.attempt_sha256);
  await assert.rejects(recoverInterruptedReview(f.root,await f.request({operation_id:'after-close',source:{thread_id:'t4',turn_id:'t4'}}),{host}),/terminal/);
  assert.equal(calls.launch,1);
});

test('a further retry chains from the interrupted attempt, preserves prior bytes and binds review to the head',async t=>{
  const f=await fixture(t),first=reviewHost({result:{...completed,status:'interrupted',usage:{input_tokens:4,output_tokens:null}}});
  const one=await recoverInterruptedReview(f.root,await f.request(),{host:first.host});
  assert.equal(one.status,'interrupted');assert.deepEqual(one.usage,{input_tokens:4,output_tokens:null});
  const attemptFile=f.root+`/.ai-org/review-recovery/${f.id}/${f.claimId}/attempt-001.json`,oneBytes=await fs.readFile(attemptFile),bindingBytes=await fs.readFile(f.bindingFile);
  const second=reviewHost(),next={operation_id:'recover-2',predecessor:{kind:'review-attempt',id:one.attempt_id,sha256:one.attempt_sha256},source:{thread_id:'retry-thread-2',turn_id:'retry-turn-2'}};
  await assert.rejects(recoverInterruptedReview(f.root,await f.request({operation_id:'recover-2',source:next.source}),{host:second.host}),/current chain head/);
  await assert.rejects(recoverInterruptedReview(f.root,await f.request({...next,expected_chain_sha256:null}),{host:second.host}),/stale recovery chain/);
  await assert.rejects(recoverInterruptedReview(f.root,await f.request({...next,source:{thread_id:'retry-thread-1',turn_id:'fresh'}}),{host:second.host}),/fresh source/);
  await assert.rejects(recoverInterruptedReview(f.root,await f.request({...next,source:{thread_id:'review-thread-1',turn_id:'fresh'}}),{host:second.host}),/fresh source/);
  assert.equal(second.calls.launch,0);
  const two=await recoverInterruptedReview(f.root,await f.request(next),{host:second.host});
  assert.equal(two.sequence,2);assert.equal(two.status,'completed');
  assert.deepEqual(await fs.readFile(attemptFile),oneBytes);assert.deepEqual(await fs.readFile(f.bindingFile),bindingBytes);
  const chain=await readReviewRecovery(f.root,f.id);assert.deepEqual(chain.attempts.map(a=>a.status),['interrupted','completed']);
  await assert.rejects(mutateNativeTask(f.root,f.id,'review',review(f,{review_attempt_id:one.attempt_id})),/current review recovery attempt/);
  await mutateNativeTask(f.root,f.id,'review',review(f,{judgment:'fail',review_attempt_id:two.attempt_id}));
  // An authored failure uses ordinary rework; recovery cannot reopen the review.
  await assert.rejects(recoverInterruptedReview(f.root,await f.request({operation_id:'recover-3',predecessor:{kind:'review-attempt',id:two.attempt_id,sha256:two.attempt_sha256},source:{thread_id:'t3',turn_id:'t3'}}),{host:second.host}),/ordinary rework/);
  await fs.writeFile(attemptFile,Buffer.concat([oneBytes,Buffer.from(' ')]));
  await assert.rejects(readReviewRecovery(f.root,f.id),/does not match its attempt/);
});

test('unsafe recovery requests fail before reservation or inference',async t=>{
  const f=await fixture(t),{host,calls}=reviewHost();
  const cases=[
    [{revision:'0'.repeat(40)},/exact delivered candidate/],
    [{reviewer:f.actor},/separation policy/],
    [{actor:f.reviewer},/cannot also be the reviewer/],
    [{reviewer:{agent_id:'unregistered',principal_id:'owner'}},/registered Agent/],
    [{expected_version:2},/Stale expected version/],
    [{expected_chain_sha256:'a'.repeat(64)},/stale recovery chain/],
    [{predecessor:{kind:'host-binding',id:f.ticket.execution_id,sha256:'b'.repeat(64)}},/differs from the request/],
    [{model:{...model,reasoning:'shallow'}},/fallback is not permitted/],
    [{policy_ref:'docs/approval.md'},/policy reference/],
    [{source:{thread_id:'review-thread-1',turn_id:'new'}},/fresh source/],
    [{claim_id:f.claimId},/unknown fields/]
  ];
  for(const [overrides,pattern] of cases)await assert.rejects(recoverInterruptedReview(f.root,await f.request(overrides),{host}),pattern);
  for(const [state,pattern] of [['active',/runtime is active/],['unknown',/runtime is unknown/],[new Error('host offline'),/runtime state is unknown/]]) {
    const probeHost=reviewHost({state});
    await assert.rejects(recoverInterruptedReview(f.root,await f.request(),{host:probeHost.host}),pattern);assert.equal(probeHost.calls.launch,0);
  }
  const unsupported=reviewHost({probeResult:probe({models:[{provider:'review-provider',model:'careful-model',efforts:['shallow']}]})});
  await assert.rejects(recoverInterruptedReview(f.root,await f.request(),{host:unsupported.host}),/exact model and effort/);
  const writable=reviewHost({probeResult:probe({enforcement:{...probe().enforcement,product_access:'write'}})});
  await assert.rejects(recoverInterruptedReview(f.root,await f.request(),{host:writable.host}),/role requires read/);
  await assert.rejects(recoverInterruptedReview(f.root,await f.request(),{host:{runtimeState:async()=>({state:'stopped'}),launch:async()=>completed}}),/trusted embedding code/);
  await fs.writeFile(f.root+'/docs/check.md','Drifted evidence');
  await assert.rejects(recoverInterruptedReview(f.root,await f.request(),{host}),/clean product tree|changed/);
  f.git('checkout','--','docs/check.md');
  const pinned=await f.request();
  await fs.writeFile(f.root+'/docs/dispatch.json',JSON.stringify({...policy(),parallelism:1}));
  await assert.rejects(recoverInterruptedReview(f.root,pinned,{host}),/changed|clean product tree/);
  f.git('checkout','--','docs/dispatch.json');
  assert.equal(calls.launch,0);assert.equal((await readReviewRecovery(f.root,f.id)).attempts.length,0);
  const open=await fixture(t,{closeBinding:false});
  await assert.rejects(recoverInterruptedReview(open.root,await open.request(),{host}),/collection is active or completed/);
  assert.equal(calls.launch,0);
});

test('racing and late attempts have one winner and late results never mutate the chain',async t=>{
  const f=await fixture(t),{host,calls}=reviewHost(),base=await f.request();
  const outcomes=await Promise.allSettled([recoverInterruptedReview(f.root,base,{host}),recoverInterruptedReview(f.root,{...base,operation_id:'recover-race',source:{thread_id:'race',turn_id:'race'}},{host})]);
  assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);assert.match(outcomes.find(o=>o.status==='rejected').reason.message,/stale recovery chain|chain head/);
  assert.equal(calls.launch,1);
  const g=await fixture(t),same=reviewHost(),request=await g.request();
  const pair=await Promise.all([recoverInterruptedReview(g.root,request,{host:same.host}),recoverInterruptedReview(g.root,request,{host:same.host})]);
  assert.equal(same.calls.launch,1);assert.equal(pair[0].attempt_id,pair[1].attempt_id);assert.equal(pair.filter(r=>r.replayed).length,1);
  // A host that lost track of its first launch: the stale result arrives after a successor exists.
  const h=await fixture(t);let release;const pending=new Promise(resolve=>{release=resolve;});
  const slow=reviewHost({result:()=>pending}),late=recoverInterruptedReview(h.root,await h.request(),{host:slow.host});
  let head;for(let i=0;i<200&&!(head=(await readReviewRecovery(h.root,h.id)).attempts[0]);i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(head.status,'unrecorded');
  const successor=await recoverInterruptedReview(h.root,await h.request({operation_id:'recover-2',predecessor:{kind:'review-attempt',id:head.attempt_id,sha256:head.sha256},source:{thread_id:'t2',turn_id:'t2'}}),{host:reviewHost().host});
  release(completed);await assert.rejects(late,/no longer current/);
  const chain=await readReviewRecovery(h.root,h.id);assert.deepEqual(chain.attempts.map(a=>a.status),['unrecorded','completed']);assert.equal(chain.attempts[1].attempt_id,successor.attempt_id);
});

test('probes run unlocked; changes while they are awaited block reservation and launch',async t=>{
  const f=await fixture(t),lock=lockPath(f.root),seen={};
  const observed=reviewHost({state:()=>{seen.probe=existsSync(lock);return 'stopped';},result:()=>{seen.launch=existsSync(lock);return structuredClone(completed);}});
  await recoverInterruptedReview(f.root,await f.request(),{host:observed.host});
  // Cancellation cannot be queued between the final check and launch invocation.
  assert.deepEqual(seen,{probe:false,launch:true});
  const cancel=c=>mutateNativeTask(c.root,c.id,'cancel',{operation_id:'cancel',expected_version:3,actor:c.actor,summary:'Stop',evidence:['docs/check.md']});
  const recovered=async c=>{await recoverInterruptedReview(c.root,await c.request({operation_id:'concurrent',source:{thread_id:'other',turn_id:'other'}}),{host:reviewHost().host});};
  const during=[
    [cancel,/Stale expected version/],
    [c=>fs.writeFile(c.root+'/docs/dispatch.json',JSON.stringify({...policy(),parallelism:1})),/changed|clean product tree/],
    [c=>fs.writeFile(c.root+'/docs/check.md','Drifted evidence'),/changed|clean product tree/],
    [recovered,/stale recovery chain/]
  ];
  for(const [change,pattern] of during) {
    const c=await fixture(t),probeHost=reviewHost({state:async()=>{await change(c);return 'stopped';}}),request=await c.request();
    await assert.rejects(recoverInterruptedReview(c.root,request,{host:probeHost.host}),pattern);
    assert.equal(probeHost.calls.runtimeState,1);assert.equal(probeHost.calls.launch,0);
    // Only a concurrently recovered attempt may exist; this request reserved none.
    assert.deepEqual((await readReviewRecovery(c.root,c.id)).attempts.filter(a=>a.source.thread_id==='retry-thread-1'),[]);
  }
});

test('authority expiring at the launch boundary records an unlaunched attempt',async t=>{
  const f=await fixture(t,{expiresAt:new Date(Date.now()+600000).toISOString()}),{host,calls}=reviewHost();
  const attemptFile=f.root+`/.ai-org/review-recovery/${f.id}/${f.claimId}/attempt-001.json`,request=await f.request(),realNow=Date.now;
  // The clock jumps past expiry exactly when the reservation becomes durable.
  Date.now=()=>existsSync(attemptFile)?realNow()+3600000:realNow();t.after(()=>{Date.now=realNow;});
  try { await assert.rejects(recoverInterruptedReview(f.root,request,{host}),/expired before launch/); } finally { Date.now=realNow; }
  assert.equal(calls.runtimeState,1);assert.equal(calls.launch,0);
  const [attempt]=(await readReviewRecovery(f.root,f.id)).attempts;
  assert.equal(attempt.status,'not-launched');assert.deepEqual(attempt.usage,{input_tokens:0,output_tokens:0});
  await assert.rejects(mutateNativeTask(f.root,f.id,'review',review(f,{review_attempt_id:attempt.attempt_id})),/not completed by this reviewer/);
});

test('a late result after cancellation is not recorded and grants nothing',async t=>{
  const f=await fixture(t);let release;const pending=new Promise(resolve=>{release=resolve;});
  const slow=reviewHost({result:()=>pending}),late=recoverInterruptedReview(f.root,await f.request(),{host:slow.host});
  await until(()=>slow.calls.launch===1);
  await mutateNativeTask(f.root,f.id,'cancel',{operation_id:'cancel',expected_version:3,actor:f.actor,summary:'Stop',evidence:['docs/check.md']});
  release(completed);await assert.rejects(late,/task changed during the attempt/);
  const chain=await readReviewRecovery(f.root,f.id);assert.deepEqual(chain.attempts.map(a=>a.status),['unrecorded']);
  assert.equal((await readNativeTask(f.root,f.id)).state,'cancelled');
});

test('the attempt chain is bounded and rejects unexpected or altered records',async t=>{
  const f=await fixture(t),{host,calls}=reviewHost({result:{...completed,status:'interrupted'}});
  const next=(head,n)=>f.request({operation_id:`recover-${n}`,predecessor:{kind:'review-attempt',id:head.attempt_id,sha256:head.attempt_sha256},source:{thread_id:`t${n}`,turn_id:`t${n}`}});
  let head=await recoverInterruptedReview(f.root,await f.request(),{host});
  for(let n=2;n<=3;n++)head=await recoverInterruptedReview(f.root,await next(head,n),{host});
  assert.equal(head.sequence,3);assert.equal(calls.launch,3);
  await assert.rejects(recoverInterruptedReview(f.root,await next(head,4),{host}),/attempt bound/);
  assert.equal(calls.launch,3);
  const dir=f.root+`/.ai-org/review-recovery/${f.id}/${f.claimId}`;
  await fs.writeFile(dir+'/attempt-004.json','{}');
  await assert.rejects(readReviewRecovery(f.root,f.id),/attempt bound/);
  await assert.rejects(mutateNativeTask(f.root,f.id,'review',review(f,{review_attempt_id:head.attempt_id})),/attempt bound/);
  await fs.rm(dir+'/attempt-004.json');await fs.writeFile(dir+'/notes.txt','unexpected');
  await assert.rejects(readReviewRecovery(f.root,f.id),/unexpected file/);
});

test('chain readers and identical replays wait for durable record publication',async t=>{
  const f=await fixture(t),{host,calls}=reviewHost(),request=await f.request();
  const target=`${f.root}/.ai-org/review-recovery/${f.id}/${f.claimId}/attempt-001.json`,realLink=fs.link,realOpen=fs.open;
  let publish,finalize,paused=false,openedWhilePublishing=false;
  const published=new Promise(resolve=>{publish=resolve;}),canFinalize=new Promise(resolve=>{finalize=resolve;});
  // Pause after the record is hard-linked but before its temporary link is removed,
  // the window in which an unsynchronized reader saw the shared inode ctime change.
  fs.link=async(from,to)=>{const linked=await realLink(from,to);if(to===target){paused=true;publish();await canFinalize;paused=false;}return linked;};
  fs.open=async(...args)=>{if(paused&&args[0]===target)openedWhilePublishing=true;return realOpen(...args);};
  const restore=()=>{fs.link=realLink;fs.open=realOpen;finalize();};t.after(restore);
  const recovery=recoverInterruptedReview(f.root,request,{host});
  await published;
  const reader=readReviewRecovery(f.root,f.id),replayed=recoverInterruptedReview(f.root,request,{host});
  let settled=false;Promise.allSettled([reader,replayed]).then(()=>{settled=true;});
  await new Promise(resolve=>setTimeout(resolve,200));
  assert.equal(settled,false);assert.equal(openedWhilePublishing,false);
  finalize();
  const [view,first,second]=await Promise.all([reader,recovery,replayed]);restore();
  assert.equal(openedWhilePublishing,false);
  assert.equal(view.attempts.length,1);assert.equal(view.attempts[0].attempt_id,first.attempt_id);assert.ok(['unrecorded','completed'].includes(view.attempts[0].status));
  assert.equal(second.replayed,true);assert.equal(second.attempt_id,first.attempt_id);assert.equal(calls.launch,1);
});

test('close rejects drift, rehashing or deletion of the reviewed attempt result',async t=>{
  for(const change of ['append','rehash','delete']) {
    const f=await fixture(t),result=await recoverInterruptedReview(f.root,await f.request(),{host:reviewHost().host});
    await mutateNativeTask(f.root,f.id,'review',review(f,{review_attempt_id:result.attempt_id}));
    const reviewed=(await readNativeTask(f.root,f.id)).review,view=await readReviewRecovery(f.root,f.id);
    assert.equal(reviewed.recovery_chain_sha256,view.chain_sha256);assert.match(reviewed.attempt_result_sha256,/^[a-f0-9]{64}$/);
    const file=`${f.root}/.ai-org/review-recovery/${f.id}/${f.claimId}/attempt-001-result.json`;
    if(change==='append')await fs.appendFile(file,' ');
    else if(change==='delete')await fs.unlink(file);
    else {const envelope=JSON.parse(await fs.readFile(file,'utf8'));envelope.value.output='Rewritten notes';envelope.sha256=executionDigest(envelope.value);await fs.writeFile(file,JSON.stringify(envelope));}
    await assert.rejects(mutateNativeTask(f.root,f.id,'close',close(f)),/chain changed after the authored review/);
    assert.equal((await readNativeTask(f.root,f.id)).state,'release_gate');
  }
});

test('persisted attempts and results are fully validated beyond their envelope digests',async t=>{
  const f=await fixture(t);await recoverInterruptedReview(f.root,await f.request(),{host:reviewHost().host});
  const dir=`${f.root}/.ai-org/review-recovery/${f.id}/${f.claimId}`;
  const rewrite=async(name,edit)=>{const file=`${dir}/${name}`,bytes=await fs.readFile(file),envelope=JSON.parse(bytes);
    edit(envelope.value);envelope.sha256=executionDigest(envelope.value);await fs.writeFile(file,JSON.stringify(envelope));return ()=>fs.writeFile(file,bytes);};
  const cases=[
    ['attempt-001-result.json',v=>{v.unknown_field='unrecognized';},/missing or unknown fields/],
    ['attempt-001-result.json',v=>{v.usage.input_tokens=-1;},/invalid usage/],
    ['attempt-001-result.json',v=>{v.usage={input_tokens:7};},/missing or unknown fields/],
    ['attempt-001-result.json',v=>{v.duration_ms=-1;},/invalid attempt duration/],
    ['attempt-001-result.json',v=>{v.status='accepted';},/invalid attempt result status/],
    ['attempt-001-result.json',v=>{v.error='model-mismatch';},/invalid attempt result status/],
    ['attempt-001-result.json',v=>{v.acceptance='performed';},/invalid attempt result/],
    ['attempt-001.json',v=>{v.unknown_field='unrecognized';},/missing or unknown fields/],
    ['attempt-001.json',v=>{v.predecessor.usage.input_tokens=-5;},/invalid usage/],
    ['attempt-001.json',v=>{v.predecessor.status='completed';},/predecessor evidence changed/],
    ['attempt-001.json',v=>{v.preflight.product_access='write';},/invalid attempt preflight/],
    ['attempt-001.json',v=>{v.reviewer={...f.actor};},/not independent/],
    ['attempt-001.json',v=>{v.implementation_authority=true;},/invalid attempt authority/],
    ['attempt-001.json',v=>{delete v.selected.reasoning;},/missing or unknown fields/],
    ['attempt-001.json',v=>{v.delivery_evidence=[];},/does not belong to this delivery chain/]
  ];
  for(const [name,edit,pattern] of cases) {const restore=await rewrite(name,edit);await assert.rejects(readReviewRecovery(f.root,f.id),pattern);await restore();}
  assert.equal((await readReviewRecovery(f.root,f.id)).attempts[0].status,'completed');
});

test('tasks without a recovery chain keep the ordinary review and close path',async t=>{
  const f=await fixture(t),view=await readReviewRecovery(f.root,f.id);
  assert.equal(view.chain_sha256,null);assert.deepEqual(view.attempts,[]);assert.equal(view.execution_authorized,false);
  await assert.rejects(mutateNativeTask(f.root,f.id,'review',review(f,{review_attempt_id:'review-attempt-invented'})),/current review recovery attempt/);
  await mutateNativeTask(f.root,f.id,'review',review(f));
  assert.equal(Object.hasOwn((await readNativeTask(f.root,f.id)).review,'attempt_id'),false);
  await mutateNativeTask(f.root,f.id,'close',{operation_id:'close',expected_version:4,actor:f.actor,revision:f.revision,summary:'Accepted',rollback:'Revert the synthetic commit',evidence:['docs/check.md']});
  assert.equal((await readNativeTask(f.root,f.id)).state,'done');
  assert.equal(existsSync(f.root+'/.ai-org/review-recovery'),false);
});

test('accepted, cancelled and expired tasks cannot resume review',async t=>{
  const {host,calls}=reviewHost();
  const pass=await fixture(t);await mutateNativeTask(pass.root,pass.id,'review',review(pass));
  await assert.rejects(recoverInterruptedReview(pass.root,await pass.request(),{host}),/terminal/);
  const cancelled=await fixture(t);await mutateNativeTask(cancelled.root,cancelled.id,'cancel',{operation_id:'cancel',expected_version:3,actor:cancelled.actor,summary:'Stop',evidence:['docs/check.md']});
  await assert.rejects(recoverInterruptedReview(cancelled.root,await cancelled.request(),{host}),/terminal/);
  const expires=new Date(Date.now()+4000).toISOString(),expired=await fixture(t,{expiresAt:expires});
  // Authority lapses while the stopped-state probe is awaited: nothing is reserved or launched.
  const slow=reviewHost({state:async()=>{await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(expires)-Date.now()+100)));return 'stopped';}});
  await assert.rejects(recoverInterruptedReview(expired.root,await expired.request(),{host:slow.host}),/expired/);
  assert.equal(slow.calls.runtimeState,1);assert.equal(slow.calls.launch,0);
  assert.equal((await readReviewRecovery(expired.root,expired.id)).attempts.length,0);
  // Once expired, the request fails before any host probe.
  await assert.rejects(recoverInterruptedReview(expired.root,await expired.request(),{host}),/expired/);
  assert.equal(calls.runtimeState,0);assert.equal(calls.launch,0);
});
