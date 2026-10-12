import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {initializeTaskProject} from '../src/workkeel-project.mjs';
import {previewTaskIntake,applyTaskIntake} from '../src/workkeel-intake.mjs';
import {readNativeTask,mutateNativeTask} from '../src/workkeel-tasks.mjs';
import {executionDigest} from '../src/workkeel-execution-policy.mjs';
import {prepareDispatchTicket} from '../src/workkeel-dispatch.mjs';
import {resolveCaptureSource,checkCaptureReadiness,beginCapture,pauseCapture,resumeCapture,finishCapture} from '../scripts/workkeel-execution-capture.mjs';
const observation={authority:'observation-only',mutation_status:'no-write',execution_authorized:false};

async function fixture(t){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'capture-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  const actor={agent_id:'builder',principal_id:'owner'},reviewer={agent_id:'reviewer',principal_id:'owner'};
  await initializeTaskProject(root,{schema_version:'workkeel.task-policy/v1',principals:['owner'],agents:[actor,reviewer],approvers:['owner'],review_separation:'distinct-agent'});
  await fs.mkdir(root+'/docs');await fs.mkdir(root+'/src');await fs.writeFile(root+'/docs/approval.md','Approved capture fixture.');
  const policy={schema_version:'workkeel.dispatch-policy/v1',models:[{alias:'fixture',provider:'local',model:'requested-model',reasoning:'medium',data_classes:['public']}],default_alias:'fixture',conservative_alias:'fixture',parallelism:2};
  await fs.writeFile(root+'/docs/dispatch.json',JSON.stringify(policy));git('add','.');git('commit','-qm','Fixture');
  const brief={schema_version:'workkeel.task-brief/v1',id:'WK-capture',goal:'Capture fixture',actor,acceptance:['Exact report'],environment:{cwd:'.',read_paths:['.'],write_paths:['src'],tools:['native-agent-host'],resources:[],network:{mode:'none',hosts:[]},external_actions:[],data:{classification:'public',model_access:'approved-connection',policy_refs:['docs/approval.md','docs/dispatch.json']}},authorization:{approved_by:'owner',approval_ref:'docs/approval.md',operations:['read','write','execute'],expires_at:null}};
  const preview=await previewTaskIntake(root,brief);await applyTaskIntake(root,brief,preview.fingerprint);
  await mutateNativeTask(root,brief.id,'claim',{operation_id:'claim',expected_version:1,actor,base_revision:git('rev-parse','HEAD')});
  const task=await readNativeTask(root,brief.id),epoch=Date.parse(task.history.at(-1).at),now=n=>({now:()=>epoch+n});
  const binding={kind:'host',binding_id:'binding',task_id:task.id,actor,claim_id:task.claim.id,contract_sha256:task.contract_sha256};
  const begin={capture_id:'capture',binding,source:{kind:'host-report',thread_id:'thread',turn_id:'turn'},sample_kind:'fixture',activity_kind:'implementation'};
  const report={status:'completed',usage:{input_tokens:0,output_tokens:null},tool:'fixture'};
  const sourceFile=root+'/source.jsonl',at=n=>new Date(epoch+n).toISOString();let ordinal=0;
  const event=(type,payload,n=1)=>({timestamp:at(n),ordinal:ordinal++,type,payload});
  const append=async(...rows)=>fs.appendFile(sourceFile,rows.map(r=>typeof r==='string'?r:JSON.stringify(r)).join('\n')+'\n');
  await append(event('session_meta',{id:'thread',model_provider:'local',instructions:'PRIVATE'},-2000),event('event_msg',{type:'task_started',turn_id:'turn'},-1000),event('turn_context',{turn_id:'turn',model:'observed-model',effort:'high',secret:'PRIVATE'}));
  await fs.appendFile(root+'/.git/info/exclude','\n/source.jsonl\n');
  const codex={...begin,source:{kind:'codex-rollout',path:sourceFile,thread_id:'thread',turn_id:'turn'}};
  return {root,actor,task,brief,git,now,at,begin,report,sourceFile,append,event,codex,policy};
}

test('pause/resume excludes waiting and frozen finish is idempotent, preserving zero versus unknown',async t=>{
  const f=await fixture(t);const begun=await beginCapture(f.root,f.begin,f.now(10));
  const replay=await beginCapture(f.root,f.begin,f.now(20));
  assert.deepEqual(replay.measurement.usage_scope,begun.measurement.usage_scope);assert.equal(replay.active_duration_ms,0);
  await pauseCapture(f.root,{capture_id:'capture',operation_id:'pause'},f.now(110));
  await pauseCapture(f.root,{capture_id:'capture',operation_id:'pause'},f.now(500));
  await assert.rejects(resumeCapture(f.root,{capture_id:'capture',operation_id:'pause'},f.now(500)),/replay conflict/);
  await resumeCapture(f.root,{capture_id:'capture',operation_id:'resume'},f.now(1010));
  let out=await finishCapture(f.root,{capture_id:'capture',report:f.report},f.now(1110));
  assert.equal(out.active_duration_ms,200);assert.equal(out.final_collection,'completed');
  assert.equal(out.measurement.operations[0].usage.input_tokens,0);assert.equal(out.measurement.operations[0].usage.output_tokens,null);
  assert.equal(out.measurement.operations[0].runtime_model,null);assert.equal(out.execution_intervals.length,2);
  const retry=await finishCapture(f.root,{capture_id:'capture',report:f.report},f.now(5000));
  assert.deepEqual(retry.execution_intervals,out.execution_intervals);assert.equal(retry.active_duration_ms,200);
  assert.equal(retry.measurement.observations.response_count,1);
  const finishedReplay=await beginCapture(f.root,f.begin,f.now(9000));assert.equal(finishedReplay.state,'finished');
  assert.deepEqual(finishedReplay.measurement.usage_scope,retry.measurement.usage_scope);
  await assert.rejects(finishCapture(f.root,{capture_id:'capture',report:{...f.report,usage:{input_tokens:2}}}),/replay conflict/);
  await assert.rejects(beginCapture(f.root,{...f.begin,source:{...f.begin.source,turn_id:'wrong'}}),/replay conflict/);
  await assert.rejects(resumeCapture(f.root,{capture_id:'capture',operation_id:'again'}),/transition/);
});

test('terminal interrupted and cancelled reports finish collection without implying success',async t=>{
  for(const status of ['interrupted','cancelled']){
    const f=await fixture(t);await beginCapture(f.root,f.begin,f.now(1));
    const request={capture_id:'capture',report:{...f.report,status}};
    const out=await finishCapture(f.root,request,f.now(2));
    assert.equal(out.final_collection,'completed');assert.equal(out.measurement.runner_state,status);
    assert.equal(out.measurement.operations[0].result_recorded,false);
    const retry=await finishCapture(f.root,request,f.now(20));
    assert.equal(retry.final_collection,'completed');assert.equal(retry.active_duration_ms,1);
    assert.equal(retry.measurement.observations.response_count,1);
  }
  const f=await fixture(t);await beginCapture(f.root,f.codex,f.now(2));
  assert.equal((await finishCapture(f.root,{capture_id:'capture'},f.now(10))).final_collection,'pending');
  await f.append(f.event('event_msg',{type:'turn_aborted',turn_id:'turn'},15));
  const out=await finishCapture(f.root,{capture_id:'capture'},f.now(30));
  assert.equal(out.final_collection,'completed');assert.equal(out.measurement.runner_state,'interrupted');
  assert.equal(out.measurement.operations[0].result_recorded,false);assert.equal(out.active_duration_ms,8);
});

test('zero clock interval and absent usage remain distinct',async t=>{
  const f=await fixture(t);await beginCapture(f.root,f.begin,f.now(1));
  const out=await finishCapture(f.root,{capture_id:'capture',report:{...f.report,usage:{}}},f.now(1));
  assert.equal(out.active_duration_ms,0);assert.equal(out.measurement.operations[0].usage.input_tokens,null);
});

test('finished capture history does not exhaust live clocks and retained ledgers stay immutable',async t=>{
  const f=await fixture(t);await beginCapture(f.root,f.begin,f.now(1));
  await finishCapture(f.root,{capture_id:'capture',report:f.report},f.now(2));
  const root=f.root+'/.ai-org/execution-capture',original=await fs.readFile(root+'/capture.json','utf8'),v=JSON.parse(original).value;
  for(let i=1;i<128;i++){
    const copy={...v,capture_id:'old-'+i};
    await fs.writeFile(root+'/'+copy.capture_id+'.json',JSON.stringify({value:copy,sha256:executionDigest(copy)}));
  }
  const fresh={...f.begin,capture_id:'fresh',binding:{...f.begin.binding,binding_id:'fresh'},source:{kind:'host-report',thread_id:'fresh',turn_id:'fresh'}};
  assert.equal((await beginCapture(f.root,fresh,f.now(3))).state,'active');
  assert.equal(await fs.readFile(root+'/capture.json','utf8'),original);
  for(let i=1;i<128;i++){
    const copy={...v,capture_id:'old-'+i,state:'paused',finished_at:null,final_report:null};
    await fs.writeFile(root+'/'+copy.capture_id+'.json',JSON.stringify({value:copy,sha256:executionDigest(copy)}));
  }
  await assert.rejects(beginCapture(f.root,{...fresh,capture_id:'overflow',binding:{...fresh.binding,binding_id:'overflow'},source:{kind:'host-report',thread_id:'overflow',turn_id:'overflow'}},f.now(4)),/ledger open capacity/);
  await assert.rejects(fs.stat(root+'/overflow.json'),/ENOENT/);
});

test('malformed normalized reports do not freeze the clock and missing activity cannot start',async t=>{
  const f=await fixture(t);const {activity_kind,...missing}=f.begin;
  await assert.rejects(beginCapture(f.root,missing,f.now(1)),/activity kind required/);
  await beginCapture(f.root,f.begin,f.now(1));
  for(const report of [{...f.report,usage:{input_tokens:-1}},{...f.report,tool:''},{...f.report,usage:{cost_usd:1}},{...f.report,usage:{surprise:2}}])await assert.rejects(finishCapture(f.root,{capture_id:'capture',report},f.now(10)));
  const out=await finishCapture(f.root,{capture_id:'capture',report:f.report},f.now(20));assert.equal(out.active_duration_ms,19);
});

test('source fingerprint covers start row and payload metadata field order is accepted',async t=>{
  const f=await fixture(t);await fs.writeFile(f.sourceFile,JSON.stringify(f.event('session_meta',{id:'thread'},-2000))+'\n'+JSON.stringify(f.event('event_msg',{turn_id:'turn',type:'task_started'},1))+'\n');
  const request={path:f.sourceFile,thread_id:'thread',turn_id:'turn'},before=await resolveCaptureSource(request);
  const text=await fs.readFile(f.sourceFile,'utf8');await fs.writeFile(f.sourceFile,text.replace(f.at(1),f.at(2)));
  const after=await resolveCaptureSource(request);assert.notEqual(before.fingerprint.start_row_sha256,after.fingerprint.start_row_sha256);
  await assert.rejects(beginCapture(f.root,{...f.codex,source_fingerprint:before.fingerprint},f.now(10)),/stale/);
});

test('exact source resolution, stale anchors, ambiguity and unsafe paths fail without content output',async t=>{
  const f=await fixture(t),request={path:f.sourceFile,thread_id:'thread',turn_id:'turn'};
  const resolved=await resolveCaptureSource(request);assert.ok(resolved.source.start_offset>0);assert.equal(JSON.stringify(resolved).includes('PRIVATE'),false);
  await assert.rejects(resolveCaptureSource({...request,thread_id:'other'}),/thread mismatch/);
  await assert.rejects(resolveCaptureSource({...request,turn_id:'other'}),/missing or ambiguous/);
  await fs.symlink(f.sourceFile,f.root+'/link');await assert.rejects(resolveCaptureSource({...request,path:f.root+'/link'}));
  const original=await fs.readFile(f.sourceFile,'utf8');await fs.writeFile(f.sourceFile,original.replace('PRIVATE','ALTERED'));
  await assert.rejects(beginCapture(f.root,{...f.codex,source_fingerprint:resolved.fingerprint},f.now(2)),/stale/);
  await f.append(f.event('event_msg',{type:'task_started',turn_id:'turn'}));
  await assert.rejects(resolveCaptureSource(request),/ambiguous/);
});

test('large private rows are skipped in bounded tail; metadata rows have strict bounds',async t=>{
  const f=await fixture(t),header=JSON.stringify(f.event('session_meta',{id:'thread'}))+'\n';
  await fs.writeFile(f.sourceFile,header+JSON.stringify({type:'response_item',payload:{text:'x'.repeat(33*1024*1024)}})+'\n'+JSON.stringify(f.event('event_msg',{type:'task_started',turn_id:'turn'}))+'\n');
  const out=await resolveCaptureSource({path:f.sourceFile,thread_id:'thread',turn_id:'turn'});assert.ok(out.source.start_offset>32*1024*1024);
  await fs.writeFile(f.sourceFile,header+JSON.stringify(f.event('event_msg',{type:'task_started',turn_id:'turn',extra:'x'.repeat(65536)}))+'\n');
  await assert.rejects(resolveCaptureSource({path:f.sourceFile,thread_id:'thread',turn_id:'turn'}),/metadata bound/);
});

test('Codex finish stays pending until source terminal, collects newer tokens and deduplicates without extending clock',async t=>{
  const f=await fixture(t);await beginCapture(f.root,f.codex,f.now(2));
  let out=await finishCapture(f.root,{capture_id:'capture'},f.now(20));assert.equal(out.final_collection,'pending');assert.equal(out.measurement.operations[0].usage.input_tokens,null);
  const row=f.event('token_usage_record',{thread_id:'thread',turn_id:'turn',response_id:'r',usage:{input_tokens:7,output_tokens:0},turn_token_usage:{input_tokens:7,output_tokens:0}},25);
  await f.append(row,row,f.event('token_usage_record',{thread_id:'other',turn_id:'turn',response_id:'private',usage:{input_tokens:999}},26),f.event('event_msg',{type:'task_complete',turn_id:'turn'},30));
  out=await finishCapture(f.root,{capture_id:'capture'},f.now(1000));
  assert.equal(out.final_collection,'completed');assert.equal(out.active_duration_ms,18);assert.equal(out.measurement.operations[0].usage.input_tokens,7);assert.equal(out.measurement.operations[0].usage.output_tokens,0);
  assert.equal(out.measurement.operations[0].runtime_model,'observed-model');assert.equal(out.measurement.operations[0].requested_model,null);
  const ledger=await fs.readFile(f.root+'/.ai-org/execution-capture/capture.json','utf8');assert.equal(ledger.includes('PRIVATE'),false);
});

test('dispatch uses pinned identity and preserves requested versus observed model',async t=>{
  const f=await fixture(t);const ticket=await prepareDispatchTicket(f.root,{task_id:f.task.id,actor:f.actor,claim_id:f.task.claim.id,contract_sha256:f.task.contract_sha256,policy_ref:'docs/dispatch.json',operation_id:'dispatch',node:{id:'implement',activity_kind:'implementation',depends_on:[],read_paths:[],write_paths:['src']},capabilities:{host:'fixture',models:[{provider:'local',model:'requested-model',reasoning:['medium']}]}});
  await beginCapture(f.root,{...f.begin,binding:{kind:'dispatch',execution_id:ticket.execution_id}},f.now(100));
  const out=await finishCapture(f.root,{capture_id:'capture',report:{...f.report,model:'observed-model'}},f.now(200));
  assert.equal(out.measurement.dispatch_execution_id,ticket.execution_id);assert.equal(out.measurement.operations[0].requested_model,'requested-model');assert.equal(out.measurement.operations[0].runtime_model,'observed-model');
});

test('capture dependency preflight leaves no prepared ledger and retries after actual completion',async t=>{
  const f=await fixture(t);
  const ticket=async(id,depends_on,write_paths)=>prepareDispatchTicket(f.root,{task_id:f.task.id,actor:f.actor,claim_id:f.task.claim.id,contract_sha256:f.task.contract_sha256,policy_ref:'docs/dispatch.json',operation_id:id,node:{id,activity_kind:'implementation',depends_on,read_paths:[],write_paths},capabilities:{host:'fixture',models:[{provider:'local',model:'requested-model',reasoning:['medium']}]}});
  const first=await ticket('first',[],['src/first']),second=await ticket('second',['first'],['src/second']);
  const request=(name,ticket)=>({...f.begin,capture_id:name,binding:{kind:'dispatch',execution_id:ticket.execution_id},source:{kind:'host-report',thread_id:name,turn_id:name}});
  const pending=request('second',second);
  const before=(await fs.readdir(f.root+'/.ai-org',{recursive:true})).sort();
  assert.deepEqual(await checkCaptureReadiness(f.root,pending),{...observation,ready:false,code:'host-dispatch-dependency',dependency_id:'first'});
  assert.deepEqual((await fs.readdir(f.root+'/.ai-org',{recursive:true})).sort(),before);
  await assert.rejects(beginCapture(f.root,pending,f.now(10)),/host-dispatch-dependency/);
  await assert.rejects(fs.stat(f.root+'/.ai-org/execution-capture/second.json'),{code:'ENOENT'});
  await beginCapture(f.root,request('first',first),f.now(20));
  assert.equal((await checkCaptureReadiness(f.root,pending)).code,'host-dispatch-dependency');
  await finishCapture(f.root,{capture_id:'first',report:f.report},f.now(30));
  assert.deepEqual(await checkCaptureReadiness(f.root,pending),{...observation,ready:true,code:'host-binding-ready'});
  assert.equal((await beginCapture(f.root,pending,f.now(40))).state,'active');
});

test('capture occupied thread rejection is retryable, but exact turn remains bound',async t=>{
  const f=await fixture(t);await beginCapture(f.root,f.begin,f.now(10));
  const next={...f.begin,capture_id:'next',binding:{...f.begin.binding,binding_id:'next'},source:{...f.begin.source,turn_id:'next'}};
  assert.deepEqual(await checkCaptureReadiness(f.root,next),{...observation,ready:false,code:'host-thread-already-bound',binding_id:'binding'});
  await assert.rejects(beginCapture(f.root,next,f.now(20)),/host-thread-already-bound/);
  await assert.rejects(fs.stat(f.root+'/.ai-org/execution-capture/next.json'),{code:'ENOENT'});
  await finishCapture(f.root,{capture_id:'capture',report:f.report},f.now(30));
  assert.equal((await checkCaptureReadiness(f.root,{...next,source:f.begin.source})).code,'host-turn-already-bound');
  assert.equal((await beginCapture(f.root,next,f.now(40))).state,'active');
});

test('capture preflight preserves dispatch scope and parallelism admission',async t=>{
  const f=await fixture(t);
  const prepare=async(name,scope)=>{
    const ticket=await prepareDispatchTicket(f.root,{task_id:f.task.id,actor:f.actor,claim_id:f.task.claim.id,contract_sha256:f.task.contract_sha256,policy_ref:'docs/dispatch.json',operation_id:name,node:{id:name,activity_kind:'implementation',depends_on:[],read_paths:[],write_paths:[scope]},capabilities:{host:'fixture',models:[{provider:'local',model:'requested-model',reasoning:['medium']}]}});
    return {...f.begin,capture_id:name,binding:{kind:'dispatch',execution_id:ticket.execution_id},source:{kind:'host-report',thread_id:name,turn_id:name}};
  };
  const a=await prepare('a','src/a'),overlap=await prepare('overlap','src/a/file'),b=await prepare('b','src/b'),c=await prepare('c','src/c');
  await beginCapture(f.root,a,f.now(10));
  assert.deepEqual(await checkCaptureReadiness(f.root,overlap),{...observation,ready:false,code:'host-dispatch-scope-conflict',binding_id:a.binding.execution_id});
  await assert.rejects(beginCapture(f.root,overlap,f.now(20)),/host-dispatch-scope-conflict/);
  await assert.rejects(fs.stat(f.root+'/.ai-org/execution-capture/overlap.json'),{code:'ENOENT'});
  await beginCapture(f.root,b,f.now(30));
  assert.deepEqual(await checkCaptureReadiness(f.root,c),{...observation,ready:false,code:'host-dispatch-parallelism'});
  await assert.rejects(beginCapture(f.root,c,f.now(40)),/host-dispatch-parallelism/);
  await assert.rejects(fs.stat(f.root+'/.ai-org/execution-capture/c.json'),{code:'ENOENT'});
  await finishCapture(f.root,{capture_id:'a',report:f.report},f.now(50));
  assert.equal((await beginCapture(f.root,c,f.now(60))).state,'active');
});

test('orphan active dispatch remains blocked with a bounded binding identity',async t=>{
  const f=await fixture(t),brief={...f.brief,id:'WK-orphan',environment:{...f.brief.environment,write_paths:['docs/old']}};
  const preview=await previewTaskIntake(f.root,brief);await applyTaskIntake(f.root,brief,preview.fingerprint);
  await mutateNativeTask(f.root,brief.id,'claim',{operation_id:'orphan-claim',expected_version:1,actor:f.actor,base_revision:f.git('rev-parse','HEAD')});
  const orphan=await readNativeTask(f.root,brief.id);
  const prepare=(task,name,scope)=>prepareDispatchTicket(f.root,{task_id:task.id,actor:f.actor,claim_id:task.claim.id,contract_sha256:task.contract_sha256,policy_ref:'docs/dispatch.json',operation_id:name,node:{id:name,activity_kind:'implementation',depends_on:[],read_paths:[],write_paths:[scope]},capabilities:{host:'fixture',models:[{provider:'local',model:'requested-model',reasoning:['medium']}]}});
  const old=await prepare(orphan,'old','docs/old'),fresh=await prepare(f.task,'fresh','src/fresh');
  await beginCapture(f.root,{...f.begin,capture_id:'old',binding:{kind:'dispatch',execution_id:old.execution_id}});
  await fs.unlink(f.root+'/.ai-org/work-items/WK-orphan.json');
  const request={...f.begin,capture_id:'fresh',binding:{kind:'dispatch',execution_id:fresh.execution_id},source:{kind:'host-report',thread_id:'fresh',turn_id:'fresh'}};
  const before=(await fs.readdir(f.root+'/.ai-org',{recursive:true})).sort();
  const expected={...observation,ready:false,code:'host-dispatch-unavailable',binding_id:old.execution_id};
  assert.deepEqual(await checkCaptureReadiness(f.root,request),expected);
  assert.deepEqual((await fs.readdir(f.root+'/.ai-org',{recursive:true})).sort(),before);
  const input=f.root+'/request.json';await fs.writeFile(input,JSON.stringify(request));
  const output=execFileSync(process.execPath,[path.resolve('scripts/workkeel-execution-capture.mjs'),'check',f.root,input],{encoding:'utf8'});
  assert.deepEqual(JSON.parse(output),expected);assert.equal(output.includes(f.root),false);assert.equal(output.includes('WK-orphan'),false);
  await assert.rejects(beginCapture(f.root,request),/host-dispatch-unavailable/);
  await assert.rejects(fs.stat(f.root+'/.ai-org/execution-capture/fresh.json'),{code:'ENOENT'});
});

test('readiness is not a reservation and prepared recovery remains explicit',async t=>{
  const f=await fixture(t);
  assert.equal((await checkCaptureReadiness(f.root,f.begin)).ready,true);
  const competitor={...f.begin,capture_id:'competitor',binding:{...f.begin.binding,binding_id:'competitor'}};
  await beginCapture(f.root,competitor,f.now(10));
  await assert.rejects(beginCapture(f.root,f.begin,f.now(20)),/host-thread-already-bound/);
  await assert.rejects(fs.stat(f.root+'/.ai-org/execution-capture/capture.json'),{code:'ENOENT'});
  const file=f.root+'/.ai-org/execution-capture/competitor.json',envelope=JSON.parse(await fs.readFile(file,'utf8'));
  Object.assign(envelope.value,{state:'prepared',active_since:null});envelope.sha256=executionDigest(envelope.value);await fs.writeFile(file,JSON.stringify(envelope));
  const before=await fs.readFile(file,'utf8');
  assert.deepEqual(await checkCaptureReadiness(f.root,competitor),{...observation,ready:false,code:'capture-prepared-recovery-required'});
  await assert.rejects(beginCapture(f.root,competitor),/explicit recovery required/);
  assert.equal(await fs.readFile(file,'utf8'),before);
});

test('handoff permits stopping/finishing existing capture, but cannot resume or start',async t=>{
  const f=await fixture(t);await beginCapture(f.root,f.begin,f.now(1));
  await mutateNativeTask(f.root,f.task.id,'handoff',{operation_id:'handoff',expected_version:2,actor:f.actor,claim_id:f.task.claim.id,revision:f.git('rev-parse','HEAD'),summary:'Fixture handoff',evidence:['docs/approval.md'],unresolved:[]});
  await pauseCapture(f.root,{capture_id:'capture',operation_id:'pause'},f.now(10));
  await assert.rejects(resumeCapture(f.root,{capture_id:'capture',operation_id:'resume'},f.now(20)),/matching implementation claim/);
  await assert.rejects(beginCapture(f.root,{...f.begin,capture_id:'new'},f.now(20)),/matching implementation claim/);
  const out=await finishCapture(f.root,{capture_id:'capture',report:f.report},f.now(30));assert.equal(out.active_duration_ms,9);
});

test('released authority cannot resume or report; backwards and future clocks do not mutate intervals',async t=>{
  const f=await fixture(t);await beginCapture(f.root,f.begin,f.now(10));
  await assert.rejects(pauseCapture(f.root,{capture_id:'capture',operation_id:'back'},f.now(9)),/backward/);
  await assert.rejects(pauseCapture(f.root,{capture_id:'capture',operation_id:'future'},{now:()=>Date.now()+70000}),/future/);
  await pauseCapture(f.root,{capture_id:'capture',operation_id:'pause'},f.now(20));
  await mutateNativeTask(f.root,f.task.id,'release',{operation_id:'release',expected_version:2,actor:f.actor,claim_id:f.task.claim.id,summary:'Fixture release'});
  await assert.rejects(resumeCapture(f.root,{capture_id:'capture',operation_id:'resume'},f.now(30)),/matching implementation claim/);
  await assert.rejects(finishCapture(f.root,{capture_id:'capture',report:f.report},f.now(40)),/binding-closed/);
});

test('corrupt ledger, symlink ledger and interrupted bind all fail closed',async t=>{
  const f=await fixture(t);await beginCapture(f.root,f.begin,f.now(1));const file=f.root+'/.ai-org/execution-capture/capture.json';
  const original=await fs.readFile(file,'utf8');await fs.writeFile(file,original.replace('"active"','"paused"'));
  await assert.rejects(pauseCapture(f.root,{capture_id:'capture',operation_id:'pause'}),/integrity/);
  await fs.unlink(file);await fs.symlink(f.root+'/docs/approval.md',file);
  await assert.rejects(finishCapture(f.root,{capture_id:'capture',report:f.report}),/inventory/);
  await fs.unlink(file);const envelope=JSON.parse(original);Object.assign(envelope.value,{state:'prepared',active_since:null});envelope.sha256=executionDigest(envelope.value);await fs.writeFile(file,JSON.stringify(envelope));
  await assert.rejects(beginCapture(f.root,f.begin),/explicit recovery required/);
});

test('ledger capacity rejects creation without making existing captures unreadable',async t=>{
  const f=await fixture(t);await beginCapture(f.root,f.begin,f.now(1));
  const dir=f.root+'/.ai-org/execution-capture';
  const original=JSON.parse(await fs.readFile(dir+'/capture.json','utf8')).value;
  for(let n=0;n<1023;n++){
    const v={...original,capture_id:'fixture-'+n};
    await fs.writeFile(`${dir}/fixture-${n}.json`,JSON.stringify({value:v,sha256:executionDigest(v)}));
  }
  await assert.rejects(beginCapture(f.root,{...f.begin,capture_id:'overflow',binding:{...f.begin.binding,binding_id:'overflow'},source:{kind:'host-report',thread_id:'other',turn_id:'other'}},f.now(2)),/capacity/);
  const out=await finishCapture(f.root,{capture_id:'capture',report:f.report},f.now(3));assert.equal(out.active_duration_ms,2);
});
