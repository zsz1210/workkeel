import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {sha256} from '../src/files.mjs';
import {initializeTaskProject} from '../src/workkeel-project.mjs';
import {previewTaskIntake,applyTaskIntake} from '../src/workkeel-intake.mjs';
import {readNativeTask,mutateNativeTask} from '../src/workkeel-tasks.mjs';
import {prepareDispatchTicket,bindDispatchTicket} from '../src/workkeel-dispatch.mjs';
import {bindHostUsage,reportHostUsage,closeHostUsage,inspectHostBinding} from '../src/workkeel-host-usage.mjs';
import {createTrustedRoleHost} from '../src/workkeel-role-preflight.mjs';
import {recoverInterruptedReview,readReviewRecovery} from '../src/workkeel-review-recovery.mjs';

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

async function fixture(t,{expiresAt=null,closeBinding=true}={}) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'workkeel-review-recovery-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  const actor={agent_id:'builder',principal_id:'owner'},reviewer={agent_id:'reviewer',principal_id:'owner'},other={agent_id:'second-reviewer',principal_id:'owner'};
  await initializeTaskProject(root,{schema_version:'workkeel.task-policy/v1',principals:['owner'],agents:[actor,reviewer,other],approvers:['owner'],review_separation:'distinct-agent'});
  await fs.mkdir(root+'/docs');await fs.mkdir(root+'/src');
  await fs.writeFile(root+'/docs/approval.md','Approved synthetic review recovery fixture, no live model execution.');
  await fs.writeFile(root+'/docs/check.md','Synthetic focused check output.');
  await fs.writeFile(root+'/docs/dispatch.json',JSON.stringify(policy()));await fs.writeFile(root+'/src/a.mjs','export const a = 1;\n');
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
