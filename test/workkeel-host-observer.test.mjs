import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createMonitorFixture} from '../scripts/workkeel-monitor-fixture.mjs';
import {createNativeTask,mutateNativeTask,readNativeTask} from '../src/workkeel-tasks.mjs';
import {bindHostUsage,reportHostUsage,closeHostUsage,readHostMeasurements} from '../src/workkeel-host-usage.mjs';
import {readTaskMeasurements,readProjectMeasurements} from '../src/workkeel-measurements.mjs';
import {startTaskMonitor} from '../src/workkeel-monitor.mjs';
import {stageExecutionSummary} from '../src/workkeel-monitor-analytics.mjs';
import {formatCount} from '../src/workkeel-monitor-view.mjs';

// All reports below are synthetic local fixtures. The real-task sample label in
// one case tests that supplied metadata survives projection; it is not live work.
async function fixture(t){
 const root=await createMonitorFixture({empty:true});let monitor;
 t.after(async()=>{await monitor?.close();await fs.rm(root,{recursive:true,force:true});});
 const start=Date.now();t.mock.timers.enable({apis:['Date'],now:start});
 const actor={agent_id:'builder',principal_id:'owner'},id='WK-host-observer';
 const contract={schema_version:'workkeel.task-contract/v1',id,goal:'Offline host observer integration',state:'intake',actor,
  scope:{include:['Bound synthetic host reports'],exclude:['Provider or model calls']},dependencies:[],
  acceptance:{criteria:['Observer keeps attribution and coverage'],evidence:[]},handoff:null,
  verification:{risk_tier:'standard',separation:'distinct-agent',implementer:null,reviewer:null,candidate_revision:null},
  environment:{cwd:'.',read_paths:['src'],write_paths:['src'],tools:['node'],resources:[],network:{mode:'none',hosts:[]},external_actions:[],data:{classification:'public',model_access:'none',policy_refs:['docs/approval.md']}},
  authorization:{approved_by:'owner',approval_ref:'docs/approval.md',operations:['read','write','execute'],expires_at:null},skills:[],
  execution:{runtime:{kind:'host-owned',adapter_id:null,required_features:[]},model_connection:{kind:'native'}},legacy:null};
 await createNativeTask(root,contract,{operation_id:'create',expected_version:0,actor});
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
 const base=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8',env}).trim();
 await mutateNativeTask(root,id,'claim',{operation_id:'claim',expected_version:1,actor,base_revision:base});
 const task=await readNativeTask(root,id),auth={actor,claim_id:task.claim.id,contract_sha256:task.contract_sha256};
 t.mock.timers.setTime(start+20000);
 const at=ms=>new Date(start+ms).toISOString();
 const bind=(binding_id,sample_kind='fixture')=>bindHostUsage(root,{binding_id,task_id:id,...auth,
  source:{kind:'host-report',thread_id:'private-thread-'+binding_id,turn_id:'private-turn-'+binding_id},sample_kind});
 const report=(binding_id,extra={})=>({binding_id,report_id:'private-report-'+binding_id,...auth,status:'completed',
  usage:{input_tokens:120,output_tokens:30,cost_usd:null},tool:'fixture-local-host',provider:'local',model:'fixture-local-model',reported_reasoning:'high',sample_kind:'fixture',observed_at:at(20000),...extra});
 const serve=async()=>{
  monitor=await startTaskMonitor(root);const url=new URL(monitor.url),headers={Authorization:'Bearer '+url.hash.slice(1)};
  return async route=>{const response=await fetch(url.origin+route,{headers});assert.equal(response.status,200,route);return response.json();};
 };
 return {root,id,at,bind,report,serve};
}

test('explicitly closed native observation preserves interruption history without an open workflow action',async t=>{
 const f=await fixture(t);await f.bind('closed-observation');
 const report=f.report('closed-observation',{status:'interrupted'});
 await reportHostUsage(f.root,report);const get=await f.serve();
 assert.equal((await get('/api/task?id='+f.id)).needs_attention,true);
 await closeHostUsage(f.root,{binding_id:'closed-observation',actor:report.actor});
 const task=await get('/api/task?id='+f.id);
 assert.equal(task.needs_attention,false);assert.equal(task.task_state,'build');
 assert.equal(task.runs[0].operations[0].state,'interrupted');assert.equal(task.execution.tokens,150);
 assert.equal(task.execution.tokens_complete,false);assert.equal(task.quality.locally_accepted,false);
});

test('bound cumulative host reports reach task, analysis and activity without double counting or private source details',async t=>{
 const f=await fixture(t);await f.bind('host-primary','real-task');
 const first=f.report('host-primary',{report_id:'private-report-progress',status:'partial',sample_kind:'real-task',
  usage:{input_tokens:80,output_tokens:10,cost_usd:null},execution_duration_ms:1000,
  execution_intervals:[{started_at:f.at(1000),completed_at:f.at(2000)}]});
 await reportHostUsage(f.root,first);
 const completed=f.report('host-primary',{sample_kind:'real-task',execution_duration_ms:4000,
  execution_intervals:[{started_at:f.at(1000),completed_at:f.at(2000)},{started_at:f.at(10000),completed_at:f.at(13000)}]});
 await reportHostUsage(f.root,completed);await reportHostUsage(f.root,completed);
 await f.bind('host-secondary');
 await reportHostUsage(f.root,f.report('host-secondary',{model:'fixture-other-local-model',usage:{input_tokens:20,output_tokens:5,cost_usd:null}}));

 const host=await readHostMeasurements(f.root);assert.deepEqual(host.errors,[]);assert.equal(host.byTask.get(f.id).length,2);
 const project=await readProjectMeasurements(f.root);assert.deepEqual(project.errors,[]);assert.equal(project.byTask.get(f.id).length,2);
 const measured=await readTaskMeasurements(f.root,f.id);
 assert.equal(measured.coverage,'bound-host-operations-only');assert.equal(measured.runs.length,2);
 assert.equal(measured.usage.input_tokens.known_subtotal,140);assert.equal(measured.usage.output_tokens.known_subtotal,35);
 assert.equal(measured.usage.input_tokens.total,null);assert.equal(measured.usage.input_tokens.complete,false);
 assert.equal(formatCount(measured.usage.input_tokens),'>= 140 (partial)');
 assert.equal(measured.timing.known_adapter_work_ms,4000);assert.equal(measured.timing.adapter_work_ms,null);

 const get=await f.serve(),workspace=await get('/api/workspace'),task=await get('/api/task?id='+f.id),analysis=await get('/api/analysis');
 assert.equal(task.task_state,'build','a completed host report does not complete or accept the task');
 assert.equal(task.settings.runtime.kind,'host-owned');assert.equal(task.read_status,'available');assert.equal(task.quality.locally_accepted,false);
 assert.equal(task.execution.execution_ms,4000);assert.equal(task.execution.operation_ms,4000);
 assert.equal(task.execution.tokens,175);assert.equal(task.execution.tokens_complete,false);assert.equal(task.execution.time_complete,false);
 assert.equal(stageExecutionSummary(task).phases.implementation,4000,'the gap between intervals is not AI execution');
 assert.equal(analysis.operation_count,2);assert.equal(analysis.totals.tokens,175);assert.equal(analysis.totals.tokens_complete,false);
 assert.equal(analysis.totals.ms,4000);assert.equal(analysis.totals.time_complete,false);
 const selected=await get('/api/analysis?model=fixture-local-model&tool=fixture-local-host&reasoning=high&kind=real-task');
 assert.equal(selected.operation_count,1);assert.equal(selected.totals.tokens,150,'latest cumulative total supersedes the 90-token progress report');
 assert.equal(selected.operations.items[0].provider,'local');assert.equal(selected.operations.items[0].reasoning,'high');
 assert.equal(selected.operations.items[0].sample_kind,'real-task');assert.equal(selected.operations.items[0].usage_source,'native-host-report');
 assert.equal((await get('/api/analysis?model=fixture-other-local-model')).totals.tokens,25);
 assert.equal((await get('/api/analysis?model=missing-model')).operation_count,0);
 const backlog=await get('/api/tasks'),summary=backlog.items.find(row=>row.id===f.id);
 assert.equal(summary.execution.tokens,175);assert.equal(summary.execution.tokens_complete,false);assert.equal(summary.execution.time_complete,false);
 const activity=await get('/api/activity');
 assert.deepEqual(activity.intervals.map(({start,end})=>[start,end]),[[Date.parse(f.at(1000)),Date.parse(f.at(2000))],[Date.parse(f.at(10000)),Date.parse(f.at(13000))]]);
 assert.equal(activity.interval_count,2);assert.ok(activity.events.items.some(event=>event.task_id===f.id&&event.action==='claim'));

 const canonicalRef=path.join(f.root,'.ai-org/work-items',f.id+'.json'),canonicalBefore=await fs.readFile(canonicalRef,'utf8');
 const privateRefs=['binding.json','measurement.json'].map(file=>path.join(f.root,'.ai-org/host-usage/host-primary',file));
 const privateBefore=await Promise.all(privateRefs.map(ref=>fs.readFile(ref,'utf8')));
 for(let i=0;i<2;i++){
  assert.equal((await get('/api/analysis')).totals.tokens,175);
  assert.equal((await get('/api/task?id='+f.id)).execution.execution_ms,4000);
  assert.equal((await readTaskMeasurements(f.root,f.id)).runs.length,2);
 }
 assert.deepEqual(await Promise.all(privateRefs.map(ref=>fs.readFile(ref,'utf8'))),privateBefore,'observation does not rewrite host journals');
 assert.equal(await fs.readFile(canonicalRef,'utf8'),canonicalBefore,'observation does not mutate task lifecycle');
 const diagnostics=await get('/api/diagnostics');assert.equal(diagnostics.model_calls,0);assert.equal(workspace.project.observer.model_calls,0);
 const publicData=JSON.stringify([workspace,task,analysis,selected,backlog,activity]);
 assert.equal(publicData.includes(f.root),false);
 assert.doesNotMatch(publicData,/private-thread-|private-turn-|private-report-|\.ai-org\/host-usage|binding\.json|credential_env/);
});

test('observer distinguishes explicit host zero, unreported measurements and interrupted subtotals',async t=>{
 const f=await fixture(t);
 await f.bind('host-zero');await reportHostUsage(f.root,f.report('host-zero',{model:'fixture-zero',usage:{input_tokens:0,output_tokens:0,cost_usd:null},
  execution_duration_ms:0,execution_intervals:[{started_at:f.at(1000),completed_at:f.at(1000)}]}));
 await f.bind('host-unknown');await reportHostUsage(f.root,f.report('host-unknown',{model:'fixture-unknown',usage:{input_tokens:null,output_tokens:null,cost_usd:null}}));
 await f.bind('host-interrupted');await reportHostUsage(f.root,f.report('host-interrupted',{model:'fixture-interrupted',status:'interrupted',usage:{input_tokens:10,output_tokens:null,cost_usd:null}}));
 const get=await f.serve(),zero=await get('/api/analysis?model=fixture-zero'),unknown=await get('/api/analysis?model=fixture-unknown'),interrupted=await get('/api/analysis?model=fixture-interrupted');
 assert.equal(zero.totals.tokens,0);assert.equal(zero.totals.ms,0);assert.equal(zero.totals.tokens_complete,false);
 assert.equal(unknown.totals.tokens,null);assert.equal(unknown.totals.ms,null);assert.equal(unknown.operation_count,1);
 assert.equal(interrupted.totals.tokens,10);assert.equal(interrupted.totals.tokens_complete,false);assert.equal(interrupted.totals.ms,null);
 assert.equal(interrupted.operations.items[0].state,'interrupted');assert.equal(interrupted.operations.items[0].result_recorded,false);
 const task=await get('/api/task?id='+f.id);
 assert.equal(task.read_status,'available','host interruption must not attempt to load a workflow continuation journal');
 assert.equal(task.needs_attention,true);assert.equal(task.continuation,null);assert.equal(task.execution.execution_ms,0);
 assert.equal(task.execution.tokens,10);assert.equal(task.execution.tokens_complete,false);assert.equal(task.execution.time_complete,false);
 const measurements=await readTaskMeasurements(f.root,f.id);
 assert.equal(formatCount(measurements.usage.output_tokens),'>= 0 (partial)');
 assert.equal(measurements.coverage,'bound-host-operations-only');assert.equal((await get('/api/diagnostics')).model_calls,0);
});
