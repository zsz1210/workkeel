import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createObserverFixture} from '../scripts/workkeel-observer-fixture.mjs';
import {startTaskMonitor} from '../src/workkeel-monitor.mjs';
import {executionSummary,stageExecutionSummary,operationRows} from '../src/workkeel-monitor-analytics.mjs';
import {createObserverIndex,semanticObserverValue} from '../src/workkeel-observer-index.mjs';

test('semantic revisions ignore invalidation and observation clocks but retain recorded timing changes',async t=>{
 const root=await fs.mkdtemp('/tmp/workkeel-semantic-');t.after(()=>fs.rm(root,{recursive:true,force:true}));
 let now=5000,elapsed=12,phase=20;
 const index=createObserverIndex(root,async()=>({complete:true,read_at:new Date(now).toISOString(),project:{},tasks:[{id:'task',timeline:[{state:'build',action:'claim',at:new Date(1000).toISOString()}],lifecycle:{ongoing:true,as_of:new Date(now).toISOString(),elapsed_ms:now,phases:{waiting:1000,implementation:now-1000}},measurement:{elapsed_ms:elapsed,phases:{implementation:phase}},runs:[]}]}));t.after(()=>index.close());
 await index.snapshot();const first=await index.query('/api/changes');
 now=9000;index.invalidate();await index.snapshot();const heartbeat=await index.query('/api/changes');
 assert.equal(heartbeat.revision,first.revision);assert.equal(heartbeat.last_changed_at,first.last_changed_at);
 elapsed++;index.invalidate();await index.snapshot();const timing=await index.query('/api/changes');assert.notEqual(timing.revision,first.revision);
 phase++;index.invalidate();await index.snapshot();assert.notEqual((await index.query('/api/changes')).revision,timing.revision);
 assert.notDeepEqual(semanticObserverValue({lifecycle:{ongoing:false,elapsed_ms:1,phases:{review:1}}}),semanticObserverValue({lifecycle:{ongoing:false,elapsed_ms:2,phases:{review:2}}}));
});

test('execution uses interval union, excludes unknown ends and preserves explicit zero',()=>{
 const op=(id,start,end)=>({operation_id:id,dispatched_at:new Date(start).toISOString(),completed_at:end===null?null:new Date(end).toISOString(),result_recorded:end!==null,usage:{input_tokens:0,output_tokens:0}});
 const task={id:'x',runs:[{run_id:'r',operations:[op('a',1000,5000),op('b',2000,7000),op('c',9000,9000),op('d',10000,null)]}]};
 const m=executionSummary(task);assert.equal(m.execution_ms,6000);assert.equal(m.time_complete,false);assert.equal(m.measured_intervals,3);assert.equal(m.tokens,0);
 assert.equal(executionSummary({id:'empty'}).execution_ms,null);
});

test('native reports preserve partial coverage and never substitute turn elapsed for active work',()=>{
 const at=n=>new Date(n).toISOString();
 const native={operation_id:'native',usage_source:'native-host-report',tool:'local-host',provider:'local',runtime_model:'local-model',reported_reasoning:'high',sample_kind:'real-task',coverage_complete:false,result_recorded:true,usage:{input_tokens:80,output_tokens:20},reported_turn_duration_ms:86400000,adapter_elapsed_ms:null,execution_intervals:[]};
 const task={id:'host-task',settings:{runtime:{kind:'host-owned'}},runs:[{run_id:'host',operations:[native]}]};
 const before=executionSummary(task);assert.equal(before.tokens,100);assert.equal(before.tokens_complete,false);assert.equal(before.execution_ms,null);
 const row=operationRows([task])[0];assert.equal(row.tool,'local-host');assert.equal(row.reasoning,'high');assert.equal(row.ms,null);assert.equal(row.sample_kind,'real-task');
 const measured={...task,runs:[{run_id:'host',operations:[{...native,execution_intervals:[{started_at:at(1000),completed_at:at(2000)},{started_at:at(10000),completed_at:at(13000)}],adapter_elapsed_ms:4000}]}]};
 const after=executionSummary(measured);assert.equal(after.execution_ms,4000);assert.equal(after.measured_intervals,1);assert.equal(after.time_complete,false);
 assert.equal(operationRows([measured])[0].time_complete,false);
});

test('stage execution attributes recorded intervals without inflating human waiting or parallel work',()=>{
 const at=n=>new Date(n).toISOString(),event=(action,state,n)=>({action,state,at:at(n)});
 const op=(id,a,b)=>({operation_id:id,dispatched_at:at(a),completed_at:b===null?null:at(b),result_recorded:b!==null,usage:{input_tokens:0,output_tokens:0}});
 const task={id:'x',timeline:[event('create','intake',0),event('claim','build',1000),event('handoff','test',10000),event('rework','intake',3600000),event('claim','build',7200000),event('handoff','test',7210000),event('review','release_gate',7220000),event('close','done',86400000)],runs:[{run_id:'r',operations:[op('a',2000,4000),op('b',3000,6000),op('c',11000,12000),op('d',7201000,7202000),op('open',7203000,null)]}]};
 const result=stageExecutionSummary(task);
 assert.deepEqual(result.phases,{planning:null,implementation:4000,review:1000,rework:1000,verification:null});
 assert.equal(result.assigned_ms,6000);assert.equal(result.complete,false);
 assert.equal(result.unassigned_ms,0);
 assert.deepEqual(stageExecutionSummary({id:'empty',timeline:task.timeline}).phases,{planning:null,implementation:null,review:null,rework:null,verification:null});
 assert.equal(stageExecutionSummary({...task,timeline:[]}).unassigned_ms,6000);
 const crossing={...task,runs:[{run_id:'r',operations:[op('cross',9000,11000)]}]};
 assert.deepEqual(stageExecutionSummary(crossing).phases,{planning:null,implementation:1000,review:1000,rework:null,verification:null});
 assert.equal(stageExecutionSummary({...task,runs:[{run_id:'r',operations:[op('zero',2000,2000)]}]}).phases.implementation,0);
 const boundary={...task,timeline:[event('claim','build',0),event('handoff','test',1000)],runs:[{run_id:'r',operations:[op('implementation',0,1000),op('review-zero',1000,1000)]}]};
 assert.deepEqual(stageExecutionSummary(boundary).phases,{planning:null,implementation:1000,review:0,rework:null,verification:null});
 assert.equal(stageExecutionSummary(boundary).complete,true);
 const missingEnd={...boundary,runs:[{run_id:'r',operations:[op('finished',0,500),op('open',500,null)]}]};
 assert.equal(stageExecutionSummary(missingEnd).phases.implementation,500);
 assert.equal(stageExecutionSummary(missingEnd).complete,false);
});

test('bounded index pages 1200 tasks, binds cursors to filters/version and aggregates before slicing',async t=>{
 const root=await fs.mkdtemp('/tmp/workkeel-index-');t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const tasks=Array.from({length:1200},(_,i)=>({id:'WK-'+i,title:'Task '+i,task_state:'build',read_status:'available',updated_at:'2026-09-26T00:00:00Z',runs:[]}));
 let calls=0;const index=createObserverIndex(root,async()=>{calls++;return {tasks,complete:true,project:{}};});t.after(()=>index.close());
 const first=await index.query('/api/tasks');assert.equal(first.items.length,50);assert.equal(first.total,1200);
 const second=await index.query('/api/tasks',new URLSearchParams({cursor:first.next_cursor}));assert.equal(second.items.length,50);assert.notEqual(first.items[0].id,second.items[0].id);
 assert.equal(calls,1);assert.equal(index.diagnostics().hits,1);
 assert.equal((await index.query('/api/tasks',new URLSearchParams({cursor:first.next_cursor,q:'different'}))).reset_required,true);
 await assert.rejects(index.query('/api/tasks',new URLSearchParams({limit:'10000'})));
 tasks.pop();index.invalidate();assert.equal((await index.query('/api/tasks',new URLSearchParams({cursor:first.next_cursor}))).reset_required,true);
});

test('indexed usage threads splits and pairing through filtered totals, groups, tasks, trends and operations',async t=>{
 const root=await fs.mkdtemp('/tmp/workkeel-usage-index-');t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const a={operation_id:'a',runtime_model:'a',result_recorded:true,coverage_complete:false,usage:{input_tokens:10,cached_input_tokens:0,output_tokens:2},reported_turn_duration_ms:100,dispatched_at:'2026-09-25T00:00:00Z'};
 const b={operation_id:'b',runtime_model:'b',result_recorded:true,usage:{input_tokens:20,output_tokens:3},adapter_elapsed_ms:5,dispatched_at:a.dispatched_at};
 const index=createObserverIndex(root,async()=>({complete:true,project:{},tasks:[{id:'one',runs:[{run_id:'r',operations:[a,b,a]}]},{id:'empty',runs:[]}]}));t.after(()=>index.close());
 const all=await index.query('/api/analysis');assert.equal(all.operation_count,2);assert.deepEqual(all.totals.metric_coverage.cached_input,{known:1,total:2});
 assert.equal(all.totals.paired_tokens,12);assert.equal(all.totals.paired_turn_ms,100);assert.equal(all.totals.paired_operations,1);assert.equal(all.totals.paired_complete,false);
 assert.equal(all.metric_scope.coverage,'filtered-recorded-operations');
 const selected=await index.query('/api/analysis',new URLSearchParams({model:'a',group:'model'}));
 for(const group of [selected.totals,selected.groups[0],selected.tasks[0],selected.trends[0]]){
  assert.deepEqual(group.token_breakdown,{input:10,cached_input:0,uncached_input:10,output:2,total:12});
  assert.deepEqual(group.metric_coverage.token_split,{known:1,total:1});
  assert.equal(group.turn_ms,100);assert.equal(group.turn_complete,true);assert.equal(group.paired_complete,true);assert.equal(group.tokens_complete,false);
 }
 assert.deepEqual(selected.operations.items[0].token_breakdown,selected.totals.token_breakdown);
 assert.equal(selected.coverage.total_tasks,2);assert.equal(selected.operation_count,1);
 assert.equal((await index.query('/api/workspace')).overview_usage.paired_operations,1);
});

test('health remains responsive during cold validation and labels the cached projection as syncing',async t=>{
 const root=await fs.mkdtemp('/tmp/workkeel-index-');t.after(()=>fs.rm(root,{recursive:true,force:true}));let release;
 const wait=new Promise(r=>release=r),index=createObserverIndex(root,async()=>{await wait;return {tasks:[],complete:true,project:{}};});t.after(()=>index.close());
 const state=await index.query('/api/changes');assert.equal(state.indexing,true);assert.equal(state.ready,false);assert.equal(state.source_status,'indexing');
 release();await index.snapshot();assert.equal((await index.query('/api/changes')).ready,true);
});

test('query APIs authenticate, invalidate source edits, redact output and remain observation-only',async t=>{
 const root=await createObserverFixture();t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const monitor=await startTaskMonitor(root);t.after(()=>monitor.close());const url=new URL(monitor.url),headers={Authorization:'Bearer '+url.hash.slice(1)};
 const get=async p=>{const r=await fetch(url.origin+p,{headers});assert.equal(r.status,200,p);return r.json();};
 for(const route of ['/api/workspace','/api/tasks','/api/task?id=WK-working','/api/analysis','/api/activity','/api/changes']){
  assert.equal((await fetch(url.origin+route)).status,401);
  assert.equal((await fetch(url.origin+route,{headers,method:'POST'})).status,405);
  assert.equal((await fetch(url.origin+route,{headers:{...headers,Origin:'https://invalid.example'}})).status,403);
  const value=await get(route);assert.doesNotMatch(JSON.stringify(value),/PRIVATE_OUTPUT_NOT_FOR_MONITOR|credential_env/);
 }
 const analysis=await get('/api/analysis');assert.equal(analysis.totals.tokens,2860);assert.equal(analysis.totals.tokens_complete,false);assert.equal(analysis.operation_count,3);
 assert.equal((await get('/api/analysis?model=fixture-local-model')).totals.tokens,300);
 const first=await get('/api/changes'),diag1=await get('/api/diagnostics');await get('/api/changes?revision='+first.revision);
 const diag2=await get('/api/diagnostics');assert.equal(diag2.index.builds,diag1.index.builds);assert.equal(diag2.model_calls,0);
 const ref=path.join(root,'docs/approval.md'),saved=await fs.readFile(ref);await fs.appendFile(ref,'\nchanged');
 // Fresh detail must revalidate even before a watcher callback.
 const task=await get('/api/task?id=WK-working');assert.equal(task.quality.evidence_current,false);
 await fs.writeFile(ref,saved);assert.equal((await get('/api/task?id=WK-working')).quality.evidence_current,true);
 assert.equal((await fetch(url.origin+'/api/task?id=../../etc/hosts',{headers})).status,503);
});
