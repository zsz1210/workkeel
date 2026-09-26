import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {initializeTaskProject} from '../src/workkeel-project.mjs';
import {previewTaskIntake,applyTaskIntake} from '../src/workkeel-intake.mjs';
import {readNativeTask,mutateNativeTask} from '../src/workkeel-tasks.mjs';
import {bindHostUsage,collectHostUsage,reportHostUsage,reportHostActivity,closeHostUsage,readHostMeasurements} from '../src/workkeel-host-usage.mjs';
import {executionDigest} from '../src/workkeel-execution-policy.mjs';
import {prepareDispatchTicket} from '../src/workkeel-dispatch.mjs';

const token=(n=1)=>({input_tokens:n,cached_input_tokens:0,cache_write_input_tokens:0,output_tokens:n,reasoning_output_tokens:0,total_tokens:n*2});
async function fixture(t,{advancingClaimClock=false,dispatchReasoning=undefined}={}) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'workkeel-host-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  const actor={agent_id:'builder',principal_id:'owner'},reviewer={agent_id:'reviewer',principal_id:'owner'};
  await initializeTaskProject(root,{schema_version:'workkeel.task-policy/v1',principals:['owner'],agents:[actor,reviewer],approvers:['owner'],review_separation:'distinct-agent'});
  await fs.mkdir(root+'/docs');await fs.mkdir(root+'/src');await fs.writeFile(root+'/docs/approval.md','Approved synthetic host reporting fixture.');
  if(dispatchReasoning!==undefined)await fs.writeFile(root+'/docs/dispatch.json',JSON.stringify({schema_version:'workkeel.dispatch-policy/v1',models:[{alias:'fixture',provider:'local',model:'fixture-model',reasoning:dispatchReasoning,data_classes:['public']}],default_alias:'fixture',conservative_alias:'fixture',parallelism:2}));
  git('add','.');git('commit','-qm','Fixture');
  const brief={schema_version:'workkeel.task-brief/v1',id:'WK-host',goal:'Synthetic host usage',actor,acceptance:['Bound usage'],environment:{cwd:'.',read_paths:['.'],write_paths:['src'],tools:[],resources:[],network:{mode:'none',hosts:[]},external_actions:[],data:{classification:'public',model_access:'none',policy_refs:['docs/approval.md']}},authorization:{approved_by:'owner',approval_ref:'docs/approval.md',operations:['read','write'],expires_at:null}};
  if(dispatchReasoning!==undefined){brief.environment.data.policy_refs.push('docs/dispatch.json');brief.environment.data.model_access='approved-connection';brief.authorization.operations.push('execute');brief.environment.tools.push('native-agent-host');}
  const preview=await previewTaskIntake(root,brief);await applyTaskIntake(root,brief,preview.fingerprint);
  const RealDate=Date;let tick=RealDate.now();
  if(advancingClaimClock)globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[tick++]));}static now(){return tick++;}};
  try{await mutateNativeTask(root,brief.id,'claim',{operation_id:'claim',expected_version:1,actor,base_revision:git('rev-parse','HEAD')});}
  finally{globalThis.Date=RealDate;}
  const task=await readNativeTask(root,brief.id),at=offset=>new Date(Date.parse(task.history.at(-1).at)+offset).toISOString();
  const sourceFile=root+'/source.jsonl';let ordinal=0;
  const event=(type,payload,offset=1)=>({timestamp:at(offset),ordinal:ordinal++,type,payload});
  const response=(response_id,n,total,offset=1)=>event('token_usage_record',{thread_id:'thread',turn_id:'turn',session_id:'thread',root_turn_id:'turn',response_id,usage:token(n),turn_token_usage:token(total),thread_token_usage:token(99999)},offset);
  const append=async(...rows)=>fs.appendFile(sourceFile,rows.map(r=>typeof r==='string'?r:JSON.stringify(r)).join('\n')+'\n');
  await append(event('session_meta',{id:'thread',model_provider:'openai',base_instructions:'PRIVATE INSTRUCTIONS'},-2000),event('event_msg',{type:'task_started',turn_id:'turn',root_turn_id:'turn',started_at:0},-1000),event('turn_context',{turn_id:'turn',model:'fixture-model',effort:'high',summary:'PRIVATE SUMMARY'},0));
  const bind={binding_id:'binding',task_id:task.id,actor,claim_id:task.claim.id,contract_sha256:task.contract_sha256,source:{kind:'codex-rollout',path:sourceFile,thread_id:'thread',turn_id:'turn'},sample_kind:'fixture'};
  const manual={...bind,source:{kind:'host-report',thread_id:'local-verification',turn_id:'run'}};
  const report={binding_id:'binding',report_id:'report-1',actor,claim_id:task.claim.id,contract_sha256:task.contract_sha256,status:'partial',usage:{input_tokens:0,output_tokens:0,cost_usd:null},tool:'node',provider:'local',model:null,reported_reasoning:null,sample_kind:'fixture',observed_at:at(10)};
  return {root,actor,reviewer,task,at,sourceFile,event,response,append,bind,manual,report,git};
}

test('explicit attachment excludes earlier usage; response identities deduplicate and read never opens source',async t=>{
  const f=await fixture(t);await f.append(f.response('before',100,100,1));
  const bound=await bindHostUsage(f.root,f.bind);assert.equal(bound.operations.length,0);
  assert.equal(bound.progress.unresolved_attempts,0);assert.equal(bound.runner_state,'running');
  const next=f.response('after',7,107,2);await f.append(next,f.event('event_msg',{type:'token_count',info:{last_token_usage:token(999999)}},3));
  let collected=await collectHostUsage(f.root,'binding');assert.equal(collected.operations[0].usage.input_tokens,7);assert.equal(collected.operations[0].adapter_elapsed_ms,null);
  await f.append(next);collected=await collectHostUsage(f.root,'binding');assert.equal(collected.operations[0].usage.input_tokens,7);
  const filename=f.root+'/.ai-org/host-usage/binding/measurement.json',before=(await fs.stat(filename)).mtimeMs;
  await collectHostUsage(f.root,'binding');assert.equal((await fs.stat(filename)).mtimeMs,before,'No write on unchanged source');
  await fs.rename(f.sourceFile,f.sourceFile+'.offline');
  const index=await readHostMeasurements(f.root);assert.equal(index.index_reads,1);assert.equal(index.errors.length,0);
  assert.equal(index.byTask.get(f.task.id)[0].operations[0].usage.input_tokens,7);
  const shown=JSON.stringify(index.byTask.get(f.task.id));
  for(const secret of [f.sourceFile,'PRIVATE INSTRUCTIONS','PRIVATE SUMMARY','response_id','thread_token_usage'])assert.equal(shown.includes(secret),false);
  const disk=await fs.readFile(f.root+'/.ai-org/host-usage/binding/binding.json','utf8');assert.equal(disk.includes('PRIVATE'),false);
});

test('explicit turn capture excludes preclaim samples and preserves separate reported turn duration',async t=>{
  const f=await fixture(t);await f.append(f.response('preclaim',5,5,-1),f.response('claimed',2,7,1));
  await assert.rejects(bindHostUsage(f.root,{...f.bind,capture_turn_from_start:true}),/approval-required/);
  const bound=await bindHostUsage(f.root,{...f.bind,capture_turn_from_start:true,approval_ref:'docs/approval.md'});
  assert.equal(bound.operations[0].usage.input_tokens,2);assert.equal(bound.observations.unassigned_response_count,1);
  await f.append(f.event('event_msg',{type:'task_complete',turn_id:'turn',duration_ms:1234,last_agent_message:'PRIVATE END'},20));
  const run=await collectHostUsage(f.root,'binding');assert.equal(run.runner_state,'completed');assert.equal(run.operations[0].result_recorded,true);
  assert.equal(run.coverage_complete,false);assert.equal(run.operations[0].reported_turn_duration_ms,1234);
  assert.equal(run.operations[0].adapter_elapsed_ms,null);assert.equal(run.operations[0].dispatched_at,null);
  assert.equal(JSON.stringify(run).includes('PRIVATE END'),false);
});

test('transient task and source absence recover without losing or duplicating completed usage',async t=>{
  const f=await fixture(t);await bindHostUsage(f.root,f.bind);
  await f.append(f.response('first',3,3,2));
  assert.equal((await collectHostUsage(f.root,'binding')).operations[0].usage.input_tokens,3);
  const taskFile=f.root+'/.ai-org/work-items/'+f.task.id+'.json';
  await fs.rename(taskFile,taskFile+'.offline');
  let run=await collectHostUsage(f.root,'binding');
  assert.equal(run.observations.error_code,'host-source-unavailable');
  assert.equal(run.operations[0].usage.input_tokens,3);
  await fs.rename(taskFile+'.offline',taskFile);
  run=await collectHostUsage(f.root,'binding');assert.equal(run.collection_status,'running');
  assert.equal(run.observations.error_code,null);assert.equal(run.operations[0].usage.input_tokens,3);
  await f.append(f.response('last',2,5,3),f.event('event_msg',{type:'task_complete',turn_id:'turn'},10));
  run=await collectHostUsage(f.root,'binding');assert.equal(run.collection_status,'completed');
  assert.equal(run.operations[0].usage.input_tokens,5);
  await fs.rename(f.sourceFile,f.sourceFile+'.offline');
  assert.equal((await collectHostUsage(f.root,'binding')).collection_status,'error');
  await fs.rename(f.sourceFile+'.offline',f.sourceFile);
  run=await collectHostUsage(f.root,'binding');assert.equal(run.collection_status,'completed');
  assert.equal(run.observations.error_code,null);assert.equal(run.operations[0].usage.input_tokens,5);
  assert.equal((await readHostMeasurements(f.root)).errors.length,0);
  await collectHostUsage(f.root,'binding');
  assert.equal((await collectHostUsage(f.root,'binding')).operations[0].usage.input_tokens,5);
});

test('transient retries still reject replaced sources and never resume explicitly closed collection',async t=>{
  const f=await fixture(t);await bindHostUsage(f.root,f.bind);await f.append(f.response('first',3,3,2));
  await collectHostUsage(f.root,'binding');
  await fs.rename(f.sourceFile,f.sourceFile+'.offline');await collectHostUsage(f.root,'binding');
  await fs.copyFile(f.sourceFile+'.offline',f.sourceFile);
  let run=await collectHostUsage(f.root,'binding');
  assert.equal(run.observations.error_code,'host-source-replaced-or-truncated');
  assert.equal(run.operations[0].usage.input_tokens,3);
  await fs.unlink(f.sourceFile);await fs.rename(f.sourceFile+'.offline',f.sourceFile);
  assert.equal((await collectHostUsage(f.root,'binding')).observations.error_code,'host-source-replaced-or-truncated');
  const g=await fixture(t);await bindHostUsage(g.root,g.bind);
  await fs.rename(g.sourceFile,g.sourceFile+'.offline');await collectHostUsage(g.root,'binding');
  await closeHostUsage(g.root,{binding_id:'binding',actor:g.actor});
  await fs.rename(g.sourceFile+'.offline',g.sourceFile);await g.append(g.response('late',2,2,5));
  run=await collectHostUsage(g.root,'binding');assert.equal(run.collection_closed,true);assert.equal(run.operations.length,0);
});

test('missing and actual zero remain distinct for partial and interrupted native observations',async t=>{
  const f=await fixture(t);await bindHostUsage(f.root,f.bind);
  let run=await collectHostUsage(f.root,'binding');assert.equal(run.operations.length,0);
  await f.append(f.response('zero',0,0,1),f.event('event_msg',{type:'turn_aborted',turn_id:'turn',duration_ms:50,reason:'interrupted'},10));
  run=await collectHostUsage(f.root,'binding');assert.equal(run.operations[0].usage.input_tokens,0);assert.equal(run.runner_state,'interrupted');
  assert.equal(run.operations[0].result_recorded,false);assert.equal(run.progress.unresolved_attempts,1);assert.equal(run.operations[0].adapter_elapsed_ms,null);
});

test('model-neutral cumulative reports are replaceable, idempotent, bounded and explicitly timed',async t=>{
  const f=await fixture(t);await bindHostUsage(f.root,f.manual);
  let run=await reportHostUsage(f.root,f.report);assert.equal(run.operations[0].usage.input_tokens,0);assert.equal(run.operations[0].runtime_model,null);
  const final={...f.report,report_id:'report-2',status:'completed',usage:{input_tokens:10,output_tokens:3},execution_duration_ms:8,
    execution_intervals:[{started_at:f.at(1),completed_at:f.at(5)},{started_at:f.at(3),completed_at:f.at(6)},{started_at:f.at(7),completed_at:f.at(10)}]};
  run=await reportHostUsage(f.root,final);assert.equal(run.operations[0].usage.input_tokens,10);assert.equal(run.operations[0].adapter_elapsed_ms,8);
  assert.equal(run.operations[0].execution_intervals.length,2);assert.equal(run.operations[0].dispatched_at,null);
  assert.equal(run.operations[0].reported_reasoning,null);assert.equal(run.coverage_complete,false);
  assert.deepEqual((await reportHostUsage(f.root,final)).operations,run.operations);
  await assert.rejects(reportHostUsage(f.root,{...final,usage:{input_tokens:11}}),/report-conflict/);
  assert.equal((await readHostMeasurements(f.root)).byTask.get(f.task.id)[0].operations[0].usage.cost_usd,null);
});

test('invalid report actors, text fields, timing, regressions and overlap bindings fail closed',async t=>{
  const f=await fixture(t);await bindHostUsage(f.root,f.manual);
  await assert.rejects(bindHostUsage(f.root,{...f.manual,binding_id:'second'}),/already-bound/);
  await assert.rejects(reportHostUsage(f.root,{...f.report,actor:f.reviewer}),/reporter-binding/);
  await assert.rejects(reportHostUsage(f.root,{...f.report,prompt:'secret'}),/invalid-host-fields/);
  await assert.rejects(reportHostUsage(f.root,{...f.report,execution_duration_ms:10}),/intervals-required/);
  await assert.rejects(reportHostUsage(f.root,{...f.report,execution_duration_ms:10,execution_intervals:[{started_at:f.at(1),completed_at:f.at(2)}]}),/duration-mismatch/);
  await assert.rejects(reportHostUsage(f.root,{...f.report,execution_duration_ms:11,execution_intervals:[{started_at:f.at(-1),completed_at:f.at(10)}]}),/interval-boundary/);
  await reportHostUsage(f.root,{...f.report,usage:{input_tokens:10,output_tokens:2}});
  await assert.rejects(reportHostUsage(f.root,{...f.report,report_id:'regression',usage:{input_tokens:9,output_tokens:2}}),/counter-discontinuity/);
  const paused=await reportHostUsage(f.root,{...f.report,report_id:'paused',status:'paused',usage:{input_tokens:10,output_tokens:2}});assert.equal(paused.progress.unresolved_attempts,1);
  const stopped=await closeHostUsage(f.root,{binding_id:'binding',actor:f.actor});assert.equal(stopped.collection_status,'stopped');
  await assert.rejects(reportHostUsage(f.root,{...f.report,report_id:'later'}),/binding-closed/);
  await assert.rejects(bindHostUsage(f.root,{...f.manual,binding_id:'second'}),/turn-already-bound/);
});

test('source bounds skip unrelated bodies but reject malformed or oversized relevant records',async t=>{
  const f=await fixture(t);await f.append(f.event('compacted',{content:'PRIVATE'.repeat(15000)},1));
  await f.append(f.event('event_msg',{type:'agent_message',message:'PRIVATE'.repeat(15000)},1));
  await bindHostUsage(f.root,f.bind);await f.append(f.response('ok',2,2,2));
  assert.equal((await collectHostUsage(f.root,'binding')).operations[0].usage.input_tokens,2);
  await f.append('{"type":"token_usage_record","payload":INVALID}');
  const run=await collectHostUsage(f.root,'binding');assert.equal(run.collection_status,'error');assert.equal(run.observations.error_code,'host-source-malformed');
  assert.equal(run.operations[0].usage.input_tokens,2);assert.equal((await readHostMeasurements(f.root)).errors.length,1);
});

test('oversized relevant lines and initial sources hit explicit read bounds',async t=>{
  const f=await fixture(t);await bindHostUsage(f.root,f.bind);
  await f.append({...f.response('huge',1,1),padding:'x'.repeat(64*1024)});
  assert.equal((await collectHostUsage(f.root,'binding')).observations.error_code,'host-relevant-line-bound');
  const g=await fixture(t);await fs.truncate(g.sourceFile,32*1024*1024+1);
  await assert.rejects(bindHostUsage(g.root,g.bind),/initial-source-bound/);
});

test('rehashed local records still require bounded typed measurement fields',async t=>{
  const f=await fixture(t);await bindHostUsage(f.root,f.manual);await reportHostUsage(f.root,f.report);
  const file=f.root+'/.ai-org/host-usage/binding/binding.json',original=JSON.parse(await fs.readFile(file,'utf8'));
  for(const mutate of [b=>{b.usage.input_tokens=-1;},b=>{b.model='x'.repeat(161);},b=>{b.execution_duration_ms=10;},b=>{b.observed_at='bad';}]) {
    const bad=structuredClone(original);mutate(bad.value);bad.sha256=executionDigest(bad.value);await fs.writeFile(file,JSON.stringify(bad));
    const index=await readHostMeasurements(f.root);assert.equal(index.byTask.size,0);assert.equal(index.errors.length,1);
  }
});

test('counter rollover, source replacement and truncation are persistent incomplete observations',async t=>{
  for(const kind of ['counter','replace','truncate']) {
    const f=await fixture(t);await f.append(f.response('baseline',10,10,1));await bindHostUsage(f.root,f.bind);
    if(kind==='counter')await f.append(f.response('reset',1,1,2));
    if(kind==='replace'){await fs.rename(f.sourceFile,f.sourceFile+'.old');await fs.copyFile(f.sourceFile+'.old',f.sourceFile);}
    if(kind==='truncate')await fs.truncate(f.sourceFile,1);
    const run=await collectHostUsage(f.root,'binding');assert.equal(run.collection_status,'error');assert.equal(run.operations.length,0);
    assert.equal((await readHostMeasurements(f.root)).errors.length,1);
  }
});

test('symlink sources, symlink stores and changed ignore policies are rejected',async t=>{
  const f=await fixture(t);await fs.symlink(f.sourceFile,f.root+'/link.jsonl');
  await assert.rejects(bindHostUsage(f.root,{...f.bind,source:{...f.bind.source,path:f.root+'/link.jsonl'}}));
  await bindHostUsage(f.root,f.bind);
  await fs.writeFile(f.root+'/.ai-org/host-usage/.gitignore','!binding\n');
  await assert.rejects(collectHostUsage(f.root,'binding'),/ignore-policy/);
  const index=await readHostMeasurements(f.root);assert.equal(index.errors[0].code,'host-inventory-unavailable');
  const g=await fixture(t);await fs.mkdir(g.root+'/elsewhere');await fs.symlink(g.root+'/elsewhere',g.root+'/.ai-org/host-usage');
  await assert.rejects(bindHostUsage(g.root,g.bind),/symlinks/);
});

test('partial final source lines are deferred and a released claim stops attribution',async t=>{
  const f=await fixture(t);await bindHostUsage(f.root,f.bind);
  const line=JSON.stringify(f.response('partial',3,3,1));await fs.appendFile(f.sourceFile,line.slice(0,40));
  assert.equal((await collectHostUsage(f.root,'binding')).operations.length,0);
  await fs.appendFile(f.sourceFile,line.slice(40)+'\n');assert.equal((await collectHostUsage(f.root,'binding')).operations[0].usage.input_tokens,3);
  await mutateNativeTask(f.root,f.task.id,'release',{operation_id:'release',expected_version:2,actor:f.actor,claim_id:f.task.claim.id,summary:'Fixture release'});
  await f.append(f.response('after-release',2,5,1000));
  const run=await collectHostUsage(f.root,'binding');assert.equal(run.runner_state,'stopped');assert.equal(run.operations[0].usage.input_tokens,3);
});

test('partial numeric fields preserve known native subtotals and mixed models remain unknown',async t=>{
  const f=await fixture(t);await bindHostUsage(f.root,f.bind);
  const a=f.response('first',10,10,1);a.payload.usage.output_tokens=2;a.payload.turn_token_usage.output_tokens=2;
  const b=f.response('second',1,11,3);b.payload.usage.input_tokens=null;b.payload.usage.output_tokens=3;b.payload.turn_token_usage.input_tokens=null;b.payload.turn_token_usage.output_tokens=5;
  await f.append(a,f.event('turn_context',{turn_id:'turn',model:'rerouted-model',effort:'max'},2),b);
  const run=await collectHostUsage(f.root,'binding');assert.equal(run.operations[0].usage.input_tokens,10);assert.equal(run.operations[0].usage.output_tokens,5);
  assert.equal(run.operations[0].runtime_model,null);assert.equal(run.operations[0].reported_reasoning,null);assert.equal(run.observations.mixed_model,true);
  const g=await fixture(t);await bindHostUsage(g.root,g.manual);await reportHostUsage(g.root,g.report);
  await assert.rejects(reportHostUsage(g.root,{...g.report,report_id:'relabeled',model:'new-model'}),/labels-changed/);
});

test('verified checkpoints repair stale projections and completed turns drain late usage until explicitly closed',async t=>{
  const f=await fixture(t);await bindHostUsage(f.root,f.bind);
  await f.append(f.response('first',2,2,1),f.event('event_msg',{type:'task_complete',turn_id:'turn',duration_ms:10},10));
  let run=await collectHostUsage(f.root,'binding');assert.equal(run.runner_state,'completed');
  const projection=f.root+'/.ai-org/host-usage/binding/measurement.json',old=await fs.readFile(projection);
  await f.append(f.response('late',3,5,11));run=await collectHostUsage(f.root,'binding');assert.equal(run.operations[0].usage.input_tokens,5);
  await fs.writeFile(projection,old);assert.equal((await readHostMeasurements(f.root)).errors.length,1);
  await collectHostUsage(f.root,'binding');assert.equal((await readHostMeasurements(f.root)).errors.length,0);
  await fs.unlink(projection);await collectHostUsage(f.root,'binding');assert.equal((await readHostMeasurements(f.root)).byTask.get(f.task.id)[0].operations[0].usage.input_tokens,5);
  await closeHostUsage(f.root,{binding_id:'binding',actor:f.actor});await f.append(f.response('closed',10,15,12));
  run=await collectHostUsage(f.root,'binding');assert.equal(run.collection_status,'stopped');assert.equal(run.operations[0].usage.input_tokens,5);
});

test('dead writer claims are recovered while live writers and concurrent operations remain exclusive',async t=>{
  const f=await fixture(t);await bindHostUsage(f.root,f.manual);
  const dir=f.root+'/.ai-org/host-usage/.locks',token='00000000-0000-0000-0000-000000000001',file=dir+'/claim-'+token+'.json';
  await fs.writeFile(file,JSON.stringify({pid:2147483646,host:os.hostname(),token,choosing:true,ticket:0}));
  await reportHostUsage(f.root,f.report);await assert.rejects(fs.stat(file),{code:'ENOENT'});
  await fs.writeFile(file,JSON.stringify({pid:process.pid,host:os.hostname(),token,choosing:false,ticket:1}));
  await assert.rejects(reportHostUsage(f.root,{...f.report,report_id:'busy'}),/writer-busy/);assert.equal((await fs.stat(file)).isFile(),true);
  await fs.unlink(file);
  const results=await Promise.allSettled([bindHostUsage(f.root,{...f.manual,binding_id:'race-a',source:{...f.manual.source,thread_id:'race',turn_id:'turn'}}),bindHostUsage(f.root,{...f.manual,binding_id:'race-b',source:{...f.manual.source,thread_id:'race',turn_id:'turn'}})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/already-bound/);
});

test('model-neutral completed report and close replays repair derived projection after a crash',async t=>{
  const f=await fixture(t);await bindHostUsage(f.root,f.manual);
  const projection=f.root+'/.ai-org/host-usage/binding/measurement.json',initial=await fs.readFile(projection);
  const final={...f.report,report_id:'final',status:'completed',usage:{input_tokens:10,output_tokens:3}};
  await reportHostUsage(f.root,final);await fs.writeFile(projection,initial);
  assert.equal((await readHostMeasurements(f.root)).errors.length,1);
  await reportHostUsage(f.root,final);
  assert.equal((await readHostMeasurements(f.root)).errors.length,0);
  assert.equal((await readHostMeasurements(f.root)).byTask.get(f.task.id)[0].operations[0].usage.input_tokens,10);
  await closeHostUsage(f.root,{binding_id:'binding',actor:f.actor});await fs.unlink(projection);
  await closeHostUsage(f.root,{binding_id:'binding',actor:f.actor});
  assert.equal((await readHostMeasurements(f.root)).errors.length,0);
});

test('binding pins canonical claim event time across separate clock ticks',async t=>{
  const f=await fixture(t,{advancingClaimClock:true});
  assert.notEqual(f.task.claim.at,f.task.history.at(-1).at);
  await bindHostUsage(f.root,f.manual);await reportHostUsage(f.root,f.report);
  assert.deepEqual((await readHostMeasurements(f.root)).errors,[]);
});

test('explicit source offset validates header and exact start envelope beyond initial scan bound',async t=>{
  const f=await fixture(t);const header=JSON.stringify(f.event('session_meta',{id:'thread',model_provider:'openai'},-2000))+'\n';
  const padding=JSON.stringify({type:'response_item',payload:{text:'x'.repeat(32*1024*1024)}})+'\n';
  const start=JSON.stringify(f.event('event_msg',{type:'task_started',turn_id:'turn'},-1000))+'\n';
  await fs.writeFile(f.sourceFile,header+padding+start);const offset=Buffer.byteLength(header+padding);
  for(const bad of [-1,1.5,offset+1,Buffer.byteLength(header)])await assert.rejects(bindHostUsage(f.root,{...f.bind,source:{...f.bind.source,start_offset:bad}}),/source-offset|initial-source-bound/);
  await assert.rejects(bindHostUsage(f.root,{...f.bind,source:{...f.bind.source,start_offset:offset,thread_id:'wrong'}}),/thread-mismatch/);
  await bindHostUsage(f.root,{...f.bind,source:{...f.bind.source,start_offset:offset}});
  await f.append(f.response('after-offset',4,4,2));assert.equal((await collectHostUsage(f.root,'binding')).operations[0].usage.input_tokens,4);
});

test('activity reports preserve source usage, reject invention and replay conflicts, and keep zero explicit',async t=>{
  const f=await fixture(t);await bindHostUsage(f.root,f.bind);
  const report={binding_id:'binding',report_id:'activity',actor:f.actor,claim_id:f.task.claim.id,contract_sha256:f.task.contract_sha256,observed_at:f.at(10),activity_kind:'verification',execution_duration_ms:0,execution_intervals:[{started_at:f.at(1),completed_at:f.at(1)}]};
  let run=await reportHostActivity(f.root,report);assert.equal(run.operations[0].usage.input_tokens,null);assert.equal(run.operations[0].adapter_elapsed_ms,0);assert.equal(run.operations[0].activity_kind,'verification');
  assert.deepEqual((await reportHostActivity(f.root,report)).operations,run.operations);
  await assert.rejects(reportHostActivity(f.root,{...report,model:'invented'}),/invalid-host-fields/);
  await assert.rejects(reportHostActivity(f.root,{...report,actor:f.reviewer}),/reporter-binding/);
  await assert.rejects(reportHostActivity(f.root,{...report,activity_kind:'review'}),/report-conflict/);
  await assert.rejects(reportHostActivity(f.root,{...report,report_id:'changed',activity_kind:'review'}),/kind-changed/);
  await assert.rejects(reportHostActivity(f.root,{...report,report_id:'erased',execution_intervals:[{started_at:f.at(2),completed_at:f.at(2)}]}),/activity-regressed/);
  await f.append(f.response('source',2,2,3));run=await collectHostUsage(f.root,'binding');assert.equal(run.operations[0].usage.input_tokens,2);assert.equal(run.operations[0].adapter_elapsed_ms,0);
  await mutateNativeTask(f.root,f.task.id,'release',{operation_id:'release',expected_version:2,actor:f.actor,claim_id:f.task.claim.id,summary:'Release'});
  await assert.rejects(reportHostActivity(f.root,{...report,report_id:'after-release'}),/binding-closed/);
});

test('existing host reports finish after actual handoff but stop and authority drift reject new reports',async t=>{
  const f=await fixture(t);await bindHostUsage(f.root,f.manual);await reportHostUsage(f.root,f.report);
  await fs.appendFile(f.root+'/.git/info/exclude','\nsource.jsonl\n');
  await mutateNativeTask(f.root,f.task.id,'handoff',{operation_id:'handoff',expected_version:2,actor:f.actor,claim_id:f.task.claim.id,revision:f.git('rev-parse','HEAD'),summary:'Actual fixture handoff',evidence:['docs/approval.md'],unresolved:[]});
  const final=await reportHostUsage(f.root,{...f.report,report_id:'after-handoff',status:'completed'});assert.equal(final.runner_state,'completed');
  await assert.rejects(bindHostUsage(f.root,{...f.manual,binding_id:'new-after-handoff'}),/matching implementation claim/);
  await mutateNativeTask(f.root,f.task.id,'review',{operation_id:'review',expected_version:3,actor:f.reviewer,revision:f.git('rev-parse','HEAD'),judgment:'fail',summary:'Rework fixture',evidence:['docs/approval.md']});
  await mutateNativeTask(f.root,f.task.id,'rework',{operation_id:'rework',expected_version:4,actor:f.actor,summary:'Rework fixture'});
  await assert.rejects(reportHostUsage(f.root,{...f.report,report_id:'after-rework'}),/binding-closed/);
  for(const action of ['release','cancel']){
    const g=await fixture(t);await bindHostUsage(g.root,g.manual);
    await mutateNativeTask(g.root,g.task.id,action,{operation_id:action,expected_version:2,actor:g.actor,...(action==='release'?{claim_id:g.task.claim.id}:{evidence:['docs/approval.md']}),summary:'Stop fixture'});
    await assert.rejects(reportHostUsage(g.root,g.report),/binding-closed/);
  }
  const g=await fixture(t);await bindHostUsage(g.root,g.manual);await fs.writeFile(g.root+'/docs/approval.md','Changed approval');
  await assert.rejects(reportHostUsage(g.root,g.report),/authority-changed/);
});

test('offset attachment rejects a selected turn exceeding the initial scan budget before binding',async t=>{
  const f=await fixture(t),bytes=await fs.readFile(f.sourceFile);const offset=bytes.indexOf(10)+1;
  await f.append(JSON.stringify({type:'response_item',payload:{text:'x'.repeat(32*1024*1024)}}),f.response('pre-attachment-late-chunk',99,99,2));
  await assert.rejects(bindHostUsage(f.root,{...f.bind,source:{...f.bind.source,start_offset:offset}}),/initial-source-bound/);
  await assert.rejects(collectHostUsage(f.root,'binding'),{code:'ENOENT'});
});

test('selection comparison distinguishes missing reasoning, actual disagreement and no requested setting',async t=>{
  for(const [requested,reported,model,expected] of [['high',null,'fixture-model','unknown'],['high','low','fixture-model','mismatch'],['high',null,'other-model','mismatch'],[null,'high','fixture-model','match']]){
    const f=await fixture(t,{dispatchReasoning:requested});
    const ticket=await prepareDispatchTicket(f.root,{operation_id:'dispatch',task_id:f.task.id,actor:f.actor,claim_id:f.task.claim.id,contract_sha256:f.task.contract_sha256,policy_ref:'docs/dispatch.json',node:{id:'work',activity_kind:'implementation',depends_on:[],read_paths:[],write_paths:['src']},route:{},capabilities:{host:'fixture',models:[{provider:'local',model:'fixture-model',reasoning:[requested]}]}});
    await bindHostUsage(f.root,{...f.manual,binding_id:ticket.execution_id,dispatch_id:ticket.execution_id});
    const run=await reportHostUsage(f.root,{...f.report,binding_id:ticket.execution_id,model,reported_reasoning:reported});assert.equal(run.operations[0].selection_match,expected);
  }
});
