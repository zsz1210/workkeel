import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {initializeTaskProject} from '../src/workkeel-project.mjs';
import {previewTaskIntake,applyTaskIntake} from '../src/workkeel-intake.mjs';
import {readNativeTask,mutateNativeTask,createNativeTask} from '../src/workkeel-tasks.mjs';
import {validateDispatchPolicy,selectDispatchModel,assertDispatchCapability,planDispatch,prepareDispatchTicket,readDispatchTicket,bindDispatchTicket} from '../src/workkeel-dispatch.mjs';
import {reportHostUsage,bindHostUsage,closeHostUsage} from '../src/workkeel-host-usage.mjs';
import {executionDigest} from '../src/workkeel-execution-policy.mjs';
import {prepareClassifiedDispatch} from '../src/workkeel-dispatch-classifier.mjs';

test('a short completed turn binds only to a prior ticket with explicit capture authority',async t=>{
 const f=await fixture(t),ticket=await prepareDispatchTicket(f.root,f.request),source={kind:'codex-rollout',path:f.root+'/short.jsonl',thread_id:'short-thread',turn_id:'short-turn'};
 const stamp=Date.parse(ticket.created_at)+1,at=n=>new Date(stamp+n).toISOString();
 const rows=[{type:'session_meta',payload:{id:source.thread_id,model_provider:'local-provider'}},{timestamp:at(0),type:'event_msg',payload:{type:'task_started',turn_id:source.turn_id}},{timestamp:at(1),type:'turn_context',payload:{turn_id:source.turn_id,model:'small-model',effort:null}},{timestamp:at(2),type:'event_msg',payload:{type:'task_complete',turn_id:source.turn_id,duration_ms:2}}];
 await fs.writeFile(source.path,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
 const base={binding_id:'without-ticket',task_id:f.task.id,actor:f.actor,claim_id:f.task.claim.id,contract_sha256:f.task.contract_sha256,source,capture_turn_from_start:true,approval_ref:'docs/approval.md'};
 await assert.rejects(bindHostUsage(f.root,base),/active-turn/);
 await assert.rejects(bindDispatchTicket(f.root,{execution_id:ticket.execution_id,source}),/active-turn/);
 const early=structuredClone(rows);early[1].timestamp=new Date(Date.parse(ticket.created_at)-1).toISOString();
 await fs.writeFile(source.path,early.map(r=>JSON.stringify(r)).join('\n')+'\n');
 await assert.rejects(bindDispatchTicket(f.root,{execution_id:ticket.execution_id,source,capture_turn_from_start:true,approval_ref:'docs/approval.md'}),/active-turn/);
 await fs.writeFile(source.path,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
 const result=await bindDispatchTicket(f.root,{execution_id:ticket.execution_id,source,capture_turn_from_start:true,approval_ref:'docs/approval.md',sample_kind:'fixture'});
 assert.equal(result.runner_state,'completed');assert.equal(result.operations[0].runtime_model,'small-model');assert.equal(result.operations[0].adapter_elapsed_ms,null);
});

const policy=()=>({schema_version:'workkeel.dispatch-policy/v1',models:[
  {alias:'small',provider:'local-provider',model:'small-model',reasoning:null,data_classes:['public','internal']},
  {alias:'careful',provider:'other-provider',model:'careful-model',reasoning:'deep',data_classes:['internal','public']}
],default_alias:'small',conservative_alias:'careful',parallelism:2});
const capabilities=()=>({host:'fixture-host',models:policy().models.map(m=>({provider:m.provider,model:m.model,reasoning:[m.reasoning]}))});
const node=(id,write_paths=[],depends_on=[])=>({id,activity_kind:'implementation',depends_on,read_paths:[],write_paths});
async function fixture(t,{pin=true}={}) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'workkeel-dispatch-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  const actor={agent_id:'builder',principal_id:'owner'},reviewer={agent_id:'reviewer',principal_id:'owner'};
  await initializeTaskProject(root,{schema_version:'workkeel.task-policy/v1',principals:['owner'],agents:[actor,reviewer],approvers:['owner'],review_separation:'distinct-agent'});
  await fs.mkdir(root+'/docs');await fs.mkdir(root+'/src');await fs.writeFile(root+'/docs/approval.md','Approved synthetic model dispatch fixture, no live model execution.');
  await fs.writeFile(root+'/docs/dispatch.json',JSON.stringify(policy()));git('add','.');git('commit','-qm','Fixture');
  const brief={schema_version:'workkeel.task-brief/v1',id:'WK-dispatch',goal:'Synthetic dispatch',actor,acceptance:['Bound dispatch'],
    environment:{cwd:'.',read_paths:['src','docs'],write_paths:['src'],tools:['node'],resources:[],network:{mode:'none',hosts:[]},external_actions:[],data:{classification:'internal',model_access:'approved-connection',policy_refs:pin?['docs/approval.md','docs/dispatch.json']:['docs/approval.md']}},
    authorization:{approved_by:'owner',approval_ref:'docs/approval.md',operations:['read','write','execute'],expires_at:null}};
  const preview=await previewTaskIntake(root,brief);await applyTaskIntake(root,brief,preview.fingerprint);
  await mutateNativeTask(root,brief.id,'claim',{operation_id:'claim',expected_version:1,actor,base_revision:git('rev-parse','HEAD')});
  const task=await readNativeTask(root,brief.id);
  const request={task_id:task.id,actor,claim_id:task.claim.id,contract_sha256:task.contract_sha256,policy_ref:'docs/dispatch.json',node:node('code',['src/a.mjs']),capabilities:capabilities(),operation_id:'dispatch-code'};
  return {root,actor,reviewer,task,request};
}

test('model-neutral conservative routing keeps classifier advisory and rejects silent host fallback',()=>{
  assert.equal(selectDispatchModel(policy()).model,'small-model');
  const route={classifier:{alias:'small',eligible:true,name:'fixture-classifier',tier:'simple',selection_reason:'small scope',model_called:false},risk:'high'};
  const chosen=selectDispatchModel(policy(),route);assert.equal(chosen.alias,'careful');assert.equal(chosen.selection_reason,'conservative-high-risk');
  assert.equal(selectDispatchModel(policy(),{classifier:{alias:'unapproved',eligible:true}}).alias,'careful');
  assert.equal(selectDispatchModel(policy(),{classifier:{alias:'small',eligible:false}}).alias,'careful');
  assert.throws(()=>selectDispatchModel(policy(),{alias:'unapproved'}),/unapproved/);
  assert.throws(()=>selectDispatchModel(policy(),{classifier:{alias:'small',eligible:1}}),/eligibility/);
  assert.throws(()=>selectDispatchModel(policy(),{classifier:{alias:'small',eligible:true,prompt:'private'}}),/fields/);
  assert.throws(()=>selectDispatchModel(policy(),{classifier:{alias:'small',eligible:true,model_called:true}}),/local advisory/);
  assert.equal(assertDispatchCapability(chosen,capabilities()),'fixture-host');
  assert.throws(()=>assertDispatchCapability(chosen,{host:'inherited-model',models:[{provider:chosen.provider,model:chosen.model,reasoning:[null]}]}),/capability mismatch/);
  assert.throws(()=>validateDispatchPolicy({...policy(),parallelism:17}),/parallelism/);
});

test('planner bounds independent work and rejects dependency and running-scope contradictions',()=>{
  const nodes=[node('a',['src/a']),node('b',['src/b']),node('c',['src/c']),node('d',['src/a'],['a'])];
  assert.deepEqual(planDispatch(policy(),{nodes}).ready,['a','b']);
  assert.deepEqual(planDispatch(policy(),{nodes,completed:['a'],running:['b']}).ready,['c']);
  assert.throws(()=>planDispatch(policy(),{nodes:[node('a',[],['b']),node('b',[],['a'])]}),/cycle/);
  assert.throws(()=>planDispatch(policy(),{nodes:[node('a',[],['missing'])]}),/dependency/);
  assert.throws(()=>planDispatch(policy(),{nodes:[node('a'),node('a')]}),/duplicate/);
  assert.throws(()=>planDispatch(policy(),{nodes,running:['d']}),/unsatisfied/);
  assert.throws(()=>planDispatch(policy(),{nodes,running:['a','b','c']}),/running/);
  const conflict=[node('a',['src']),{...node('b'),read_paths:['src/a']}];
  assert.deepEqual(planDispatch(policy(),{nodes:conflict}).blocked,[{id:'b',reason:'scope-conflict'}]);
  assert.throws(()=>planDispatch(policy(),{nodes:conflict,running:['a','b']}),/scope conflict/);
  for(const ref of ['../src','src/../a','/tmp','src/*','src\\a'])assert.throws(()=>planDispatch(policy(),{nodes:[node('a',[ref])]}),/scope path/);
  assert.throws(()=>planDispatch(policy(),{nodes:[{...node('a',['src']),activity_kind:'review'}]}),/read-only/);
});

test('ticket is pinned to approved claim and policy, replay-safe, UUID-only with unknown usage',async t=>{
  const f=await fixture(t),ticket=await prepareDispatchTicket(f.root,f.request);
  assert.match(ticket.execution_id,/^[a-f0-9-]{36}$/);assert.equal(ticket.display_label,null);
  assert.deepEqual(ticket.usage,{input_tokens:null,output_tokens:null,execution_duration_ms:null});
  assert.equal(ticket.host_binding_id,null);assert.equal(ticket.selected.model,'small-model');
  assert.deepEqual(await readDispatchTicket(f.root,ticket.execution_id),ticket);
  assert.equal((await prepareDispatchTicket(f.root,f.request)).execution_id,ticket.execution_id);
  await assert.rejects(prepareDispatchTicket(f.root,{...f.request,display_label:'different'}),/replay conflict/);
  const next=await prepareDispatchTicket(f.root,{...f.request,operation_id:'second',display_label:'Short name'});
  assert.notEqual(next.execution_id,ticket.execution_id);assert.equal(next.display_label,'Short name');
  assert.equal((await readNativeTask(f.root,f.task.id)).version,f.task.version,'ticket does not mutate lifecycle');
  await mutateNativeTask(f.root,f.task.id,'release',{operation_id:'release',expected_version:f.task.version,actor:f.actor,claim_id:f.task.claim.id,summary:'Fixture done'});
  assert.deepEqual(await readDispatchTicket(f.root,ticket.execution_id),ticket,'historical reading survives released claim');
  await assert.rejects(prepareDispatchTicket(f.root,{...f.request,operation_id:'after-release'}),/matching implementation claim/);
});

test('wrong actor, claim, contract, scope and symlink targets fail before ticket persistence',async t=>{
  const f=await fixture(t);
  for(const patch of [{actor:f.reviewer},{claim_id:'wrong'},{contract_sha256:'f'.repeat(64)},
    {node:node('outside',['docs'])},{node:{...node('outside'),read_paths:['.']}},{node:node('escape',['src/../docs'])},
    {capabilities:{host:'fixture-host',models:[{provider:'other',model:'other',reasoning:[null]}]}}])
    await assert.rejects(prepareDispatchTicket(f.root,{...f.request,...patch}));
  await fs.symlink(f.root+'/docs',f.root+'/src/link');
  await assert.rejects(prepareDispatchTicket(f.root,{...f.request,node:node('symlink',['src/link/new'])}),/symlink/);
  assert.equal(await fs.stat(f.root+'/.ai-org/dispatch').then(()=>true,()=>false),false);
});

test('unpinned or modified routing policies cannot widen authority',async t=>{
  const f=await fixture(t,{pin:false});await assert.rejects(prepareDispatchTicket(f.root,f.request),/policy must be pinned/);
  const g=await fixture(t);const ticket=await prepareDispatchTicket(g.root,g.request);
  await fs.writeFile(g.root+'/docs/dispatch.json',JSON.stringify({...policy(),parallelism:3}));
  await assert.rejects(prepareDispatchTicket(g.root,{...g.request,operation_id:'changed'}),/changed/);
  await assert.rejects(readDispatchTicket(g.root,ticket.execution_id),/pin changed/);
});

test('exact host binding retains requested versus reported model, rejects conflicts and waits for completed dependency',async t=>{
  const f=await fixture(t);
  const prepare=(operation_id,n)=>prepareDispatchTicket(f.root,{...f.request,operation_id,node:n,route:{alias:'careful'},display_label:'Code execution'});
  const first=await prepare('first',node('first',['src/a']));
  const conflicting=await prepare('conflicting',node('conflicting',['src/a/child']));
  const dependent=await prepare('dependent',node('dependent',['src/b'],['first']));
  const independent=await prepare('independent',node('independent',['src/c']));
  const excess=await prepare('excess',node('excess',['src/d']));
  const bind=ticket=>bindDispatchTicket(f.root,{execution_id:ticket.execution_id,source:{kind:'host-report',thread_id:ticket.execution_id,turn_id:'turn'},sample_kind:'fixture'});
  let run=await bind(first);assert.equal(run.operations.length,0,'no synthetic zero before observed report');
  await assert.rejects(bind(conflicting),/scope-conflict/);
  await assert.rejects(bind(dependent),/dependency/);
  await bind(independent);await assert.rejects(bind(excess),/parallelism/);
  run=await reportHostUsage(f.root,{binding_id:first.execution_id,report_id:'completed',actor:f.actor,claim_id:f.task.claim.id,contract_sha256:f.task.contract_sha256,
    status:'completed',usage:{input_tokens:0,output_tokens:0},tool:'fixture-host',provider:'other-provider',model:'actual-model',reported_reasoning:'actual-effort',observed_at:new Date().toISOString()});
  const operation=run.operations[0];assert.equal(operation.execution_id,first.execution_id);assert.equal(operation.display_label,'Code execution');
  assert.equal(operation.requested_model,'careful-model');assert.equal(operation.runtime_model,'actual-model');assert.equal(operation.requested_reasoning.value,'deep');
  assert.equal(operation.activity_kind,'implementation');assert.equal(operation.usage.input_tokens,0);assert.equal(operation.adapter_elapsed_ms,null);
  await closeHostUsage(f.root,{binding_id:first.execution_id,actor:f.actor});
  await bind(dependent);
});

test('closed unrelated dispatch history cannot block a fresh task, while open history and duplicate identities still fail',async t=>{
  const f=await fixture(t),old=await prepareDispatchTicket(f.root,f.request);
  const source={kind:'host-report',thread_id:'old-dispatch-thread',turn_id:'old-turn'};
  await bindDispatchTicket(f.root,{execution_id:old.execution_id,source,sample_kind:'fixture'});
  await mutateNativeTask(f.root,f.task.id,'cancel',{operation_id:'cancel',expected_version:2,actor:f.actor,summary:'Synthetic supersession',evidence:['docs/approval.md']});
  const contract=structuredClone(f.task.contract);contract.id='WK-fresh';
  await createNativeTask(f.root,contract,{operation_id:'create',expected_version:0,actor:f.actor});
  const base=execFileSync('git',['-C',f.root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  await mutateNativeTask(f.root,contract.id,'claim',{operation_id:'claim',expected_version:1,actor:f.actor,base_revision:base});
  const fresh=await readNativeTask(f.root,contract.id),ticket=await prepareDispatchTicket(f.root,{...f.request,task_id:fresh.id,claim_id:fresh.claim.id,contract_sha256:fresh.contract_sha256});
  const request={execution_id:ticket.execution_id,source:{kind:'host-report',thread_id:'fresh-thread',turn_id:'fresh-turn'},sample_kind:'fixture'};
  await assert.rejects(bindDispatchTicket(f.root,request),/historical claim mismatch/,'unclosed old dispatch still requires inspection');
  await closeHostUsage(f.root,{binding_id:old.execution_id,actor:f.actor});
  await assert.rejects(bindDispatchTicket(f.root,{...request,source}),/turn-already-bound/);
  assert.equal((await bindDispatchTicket(f.root,request)).run_id,ticket.execution_id);
});

test('rehashed persisted ticket cannot invent selected model, reason, usage, scope or operation identity',async t=>{
  const f=await fixture(t),ticket=await prepareDispatchTicket(f.root,f.request),dir=f.root+'/.ai-org/dispatch';
  const file=path.join(dir,(await fs.readdir(dir)).find(name=>name.startsWith(ticket.execution_id))),original=JSON.parse(await fs.readFile(file,'utf8'));
  for(const mutate of [v=>{v.selected.model='invented';},v=>{v.selected.selection_reason='invented';},v=>{v.usage.input_tokens=0;},v=>{v.node.write_paths=['docs'];},v=>{v.operation_id='different';}]) {
    const envelope=structuredClone(original);mutate(envelope.value);envelope.sha256=executionDigest(envelope.value);await fs.writeFile(file,JSON.stringify(envelope));
    await assert.rejects(readDispatchTicket(f.root,ticket.execution_id));
  }
});

test('local classifier bridge persists guarded metadata, replays ticket and checks authority before classification',async t=>{
  const f=await fixture(t);let calls=0;
  const classify=async(prompt,{profile})=>{
    calls++;assert.equal(prompt,'Bounded fixture prompt');assert.equal(profile,'auto');
    return {model_called:false,model:'careful-model',classifier:'fixture-local-guard',tier:'medium',selection_reason:'Conservative local guard'};
  };
  const request={dispatch:f.request,prompt:'Bounded fixture prompt'};
  const ticket=await prepareClassifiedDispatch(f.root,request,classify);
  assert.equal(ticket.selected.model,'careful-model');assert.equal(ticket.selected.classifier.name,'fixture-local-guard');
  assert.equal(ticket.selected.classifier.tier,'medium');assert.equal(ticket.selected.classifier.selection_reason,'Conservative local guard');
  assert.equal(ticket.selected.classifier.model_called,false);assert.equal(JSON.stringify(ticket).includes(request.prompt),false);
  assert.equal((await prepareClassifiedDispatch(f.root,request,classify)).execution_id,ticket.execution_id);
  const g=await fixture(t,{pin:false}),priorCalls=calls;
  await assert.rejects(prepareClassifiedDispatch(g.root,{...request,dispatch:g.request},classify),/approved dispatch policy/);
  assert.equal(calls,priorCalls);
  await fs.writeFile(f.root+'/docs/dispatch.json',JSON.stringify({...policy(),parallelism:3}));
  await assert.rejects(prepareClassifiedDispatch(f.root,request,classify),/changed/);assert.equal(calls,priorCalls);
});
