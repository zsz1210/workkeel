import test from 'node:test';
import assert from 'node:assert/strict';
import {stageExecutionSummary,executionSummary,executionBreakdown,operationRows,aggregateRows,filterRows} from '../src/workkeel-monitor-analytics.mjs';
const at=n=>new Date(1700000000000+n).toISOString();
const op=(id,kind,a,b)=>({operation_id:id,activity_kind:kind,execution_intervals:[{started_at:at(a),completed_at:at(b)}],adapter_elapsed_ms:b-a,result_recorded:true,usage:{input_tokens:0,output_tokens:0}});
test('analytics counts reported models and reasoning while retaining tool-only totals',()=>{
 const rows=operationRows([{id:'one-model',runs:[{run_id:'r',operations:[
  {...op('build','implementation',0,10),runtime_model:'model-a',requested_reasoning:{value:'high'}},
  {...op('test','verification',10,20),tool:'node'},
  {...op('review','review',20,30),runtime_model:'model-a',reported_reasoning:'medium'}
 ]}]}]);
 const group=aggregateRows(rows)[0];
 assert.deepEqual(group.models,['model-a']);assert.equal(group.rows,3);assert.equal(group.ms,30);
 assert.equal(rows[0].reasoning,'unreported');assert.equal(filterRows(rows,{reasoning:'high'}).length,0);
 assert.equal(filterRows(rows,{reasoning:'medium'}).length,1);
 assert.equal(aggregateRows(rows,'model').find(g=>g.id==='unreported').rows,1);
});
test('explicit stages override lifecycle and overlapping phases retain union execution semantics',()=>{
  const task={id:'task',timeline:[{at:at(0),state:'build'}],runs:[{run_id:'run',operations:[op('a','planning',0,10),op('b','review',5,15),op('c','repair',15,20),op('d','verification',20,20)]}]};
  const stages=stageExecutionSummary(task),execution=executionSummary(task);
  assert.deepEqual(stages.phases,{planning:10,implementation:null,review:10,rework:5,verification:0});
  assert.equal(stages.assigned_ms,20);assert.equal(stages.unassigned_ms,0);assert.equal(execution.execution_ms,20);assert.equal(execution.operation_ms,25);
});
test('legacy stage fallback preserves unknown and zero, explicit stage needs no lifecycle',()=>{
  const task={id:'task',runs:[{run_id:'run',operations:[op('a','verification',0,0)]}]};
  assert.equal(stageExecutionSummary(task).phases.verification,0);assert.equal(stageExecutionSummary(task).complete,true);
  task.runs[0].operations=[op('b',null,0,10)];assert.equal(stageExecutionSummary(task).unassigned_ms,10);
  task.timeline=[{at:at(0),state:'build'},{at:at(5),state:'test'}];
  assert.equal(stageExecutionSummary(task).phases.implementation,5);assert.equal(stageExecutionSummary(task).phases.review,5);
});
const taskWith=operations=>({id:'task',runs:[{run_id:'run',operations}]});
test('token split distinguishes missing cache, explicit zero, invalid cache and partial totals',()=>{
 const usages=[{input_tokens:10,output_tokens:2},{input_tokens:10,cached_input_tokens:0,output_tokens:2},{input_tokens:10,cached_input_tokens:11,output_tokens:2},{input_tokens:0,cached_input_tokens:0,output_tokens:0},{input_tokens:5},{output_tokens:3},{input_tokens:'10',output_tokens:-1}];
 const rows=operationRows([taskWith(usages.map((usage,i)=>({...op(String(i),'implementation',0,1),usage})))]);
 assert.deepEqual(rows.map(r=>r.token_breakdown),[
  {input:10,cached_input:null,uncached_input:null,output:2,total:12},
  {input:10,cached_input:0,uncached_input:10,output:2,total:12},
  {input:10,cached_input:null,uncached_input:null,output:2,total:12},
  {input:0,cached_input:0,uncached_input:0,output:0,total:0},
  {input:5,cached_input:null,uncached_input:null,output:null,total:null},
  {input:null,cached_input:null,uncached_input:null,output:3,total:null},
  {input:null,cached_input:null,uncached_input:null,output:null,total:null}
 ]);
 assert.equal(rows[4].tokens,5);assert.equal(rows[5].tokens,3);assert.equal(rows[4].tokens_complete,false);
 const total=aggregateRows(rows)[0];
 assert.deepEqual(total.token_breakdown,{input:35,cached_input:0,uncached_input:10,output:9,total:36});
 assert.deepEqual(total.metric_coverage.input,{known:5,total:7});
 assert.deepEqual(total.metric_coverage.total,{known:4,total:7});
 assert.deepEqual(total.metric_coverage.token_split,{known:2,total:7});
});
test('full turn metrics use explicit reports and pair the same healthy terminal records',()=>{
 const operations=[
  {...op('paired','implementation',0,10),runtime_model:'paired-model',coverage_complete:false,usage:{input_tokens:8,output_tokens:2},reported_turn_duration_ms:100},
  {...op('tokens-only','implementation',10,20),runtime_model:'excluded-model',usage:{input_tokens:80,output_tokens:20}},
  {operation_id:'turn-only',result_recorded:true,reported_turn_duration_ms:200},
  {...op('unfinished','implementation',20,30),result_recorded:false,reported_turn_duration_ms:300},
  {...op('zero','implementation',30,30),usage:{input_tokens:0,cached_input_tokens:0,output_tokens:0},reported_turn_duration_ms:0}
 ];
 const task=taskWith([...operations,operations[0]]),rows=operationRows([task]),total=aggregateRows(rows)[0];
 assert.equal(rows.length,5);assert.equal(rows[0].turn_complete,true);assert.equal(rows[0].time_complete,false);assert.equal(rows[0].tokens_complete,false);
 assert.equal(rows[1].turn_ms,null);assert.equal(rows[2].ms,null);assert.equal(rows[3].turn_complete,false);
 assert.equal(total.ms,30);assert.equal(total.turn_ms,600);assert.equal(total.turn_complete,false);
 assert.equal(total.paired_turn_ms,100);assert.equal(total.paired_tokens,10);assert.equal(total.paired_operations,2);assert.equal(total.paired_complete,false);
 assert.ok(total.paired_models.includes('paired-model'));assert.ok(!total.paired_models.includes('excluded-model'));
 assert.deepEqual(total.metric_coverage.turn_ms,{known:4,total:5});
 const unhealthy=aggregateRows(operationRows([{...task,measurement_errors:['journal unreadable']}]))[0];
 assert.equal(unhealthy.paired_operations,0);assert.equal(unhealthy.paired_turn_ms,null);assert.equal(unhealthy.turn_complete,false);
 const zero=aggregateRows([rows[4]])[0];assert.equal(zero.paired_complete,true);assert.equal(zero.paired_turn_ms,0);assert.equal(zero.paired_tokens,0);
});
test('overflow cannot claim complete metrics or usable paired totals',()=>{
 const max=Number.MAX_SAFE_INTEGER;
 const rows=operationRows([taskWith([
  {...op('a','implementation',0,0),adapter_elapsed_ms:max,usage:{input_tokens:max,cached_input_tokens:0,output_tokens:0},reported_turn_duration_ms:max},
  {...op('b','implementation',0,0),adapter_elapsed_ms:1,usage:{input_tokens:1,cached_input_tokens:0,output_tokens:0},reported_turn_duration_ms:1},
 ])]);
 const total=aggregateRows(rows)[0];
 for(const key of ['ms','tokens','turn_ms','paired_turn_ms','paired_tokens'])assert.equal(total[key],null,key);
 for(const key of ['time_complete','tokens_complete','turn_complete','paired_complete'])assert.equal(total[key],false,key);
 for(const key of ['input','uncached_input','total','active_ms','turn_ms','token_split'])assert.deepEqual(total.metric_coverage[key],{known:0,total:2},key);
 const invalid=operationRows([taskWith([{...op('overflow','implementation',0,0),usage:{input_tokens:max,output_tokens:1},reported_turn_duration_ms:Infinity}])])[0];
 assert.equal(invalid.tokens,null);assert.equal(invalid.token_breakdown.total,null);assert.equal(invalid.tokens_complete,false);assert.equal(invalid.turn_ms,null);
 const fractional=operationRows([taskWith([{...op('fraction','implementation',0,0),usage:{input_tokens:1.5,cached_input_tokens:0.5,output_tokens:2}}])])[0];
 assert.equal(fractional.token_breakdown.input,null);assert.equal(fractional.token_breakdown.cached_input,null);assert.equal(fractional.tokens_complete,false);
});
test('breakdown gives stable separate executions for overlapping operations of the same actual model',()=>{
  const a={...op('a','implementation',0,10),execution_id:'exec-a',observed_model:'gpt-6-sol',reported_reasoning:'medium',tool:'codex'};
  const b={...op('b','review',5,15),execution_id:'exec-b',observed_model:'gpt-6-sol',tool:'codex'};
  const task=taskWith([b,a]),before=JSON.stringify(task),result=executionBreakdown(task);
  assert.equal(JSON.stringify(task),before);
  assert.deepEqual(result.models,['gpt-6-sol']);assert.deepEqual(result.tools,['codex']);
  assert.equal(result.max_concurrent,2);assert.equal(result.mode,'observed-overlap');
  assert.equal(result.total_operations,2);assert.equal(result.measured_operations,2);
  assert.deepEqual(result.rows.map(r=>[r.index,r.execution_ref,r.overlapping_with]),[[1,'exec-a',['exec-b']],[2,'exec-b',['exec-a']]]);
  assert.equal(result.rows[0].reasoning,'medium');assert.equal(result.rows[0].start_at,at(0));assert.equal(result.rows[0].end_at,at(10));
});
test('breakdown uses actual model and reasoning, excluding requested and tool-only unknown models',()=>{
  const result=executionBreakdown(taskWith([
    {...op('a','planning',0,10),runtime_model:'gpt-6-astra',requested_reasoning:{value:'high'}},
    {...op('b','implementation',10,20),observed_model:'gpt-6-sol',requested_model:'gpt-6-astra'},
    {...op('c','verification',20,30),observed_model:null,tool:'shell',requested_model:'gpt-6-luna'}
  ]));
  assert.deepEqual(result.models,['gpt-6-astra','gpt-6-sol']);assert.equal(result.rows[0].reasoning,'unreported');
  assert.equal(result.max_concurrent,1);assert.equal(result.mode,'no-observed-overlap');
  assert.ok(result.rows.every(r=>!r.overlapping_with.length));
});
test('breakdown preserves missing review intervals and unmeasured repair history without inventing zero',()=>{
  const task=taskWith([{operation_id:'review',activity_kind:'review'}]);
  task.timeline=[{at:at(0),state:'test'},{at:at(10),state:'build',action:'rework'}];
  const result=executionBreakdown(task);
  assert.deepEqual(result.stages.review,{ms:null,operation_count:1,measured_operations:0,status:'missing-intervals'});
  assert.deepEqual(result.stages.rework,{ms:null,operation_count:0,measured_operations:0,status:'unreported'});
  assert.equal(result.mode,'unreported');assert.equal(result.max_concurrent,0);
  assert.equal(result.rows[0].start_at,null);assert.equal(result.rows[0].end_at,null);
});
test('breakdown counts explicit zero and deduplicates operations and repeated spans',()=>{
  const zero=op('zero','verification',20,20),a=op('a','repair',0,10);
  a.execution_intervals.push({started_at:at(0),completed_at:at(10)},{started_at:at(5),completed_at:at(15)});
  const result=executionBreakdown(taskWith([a,zero,a,zero]));
  assert.equal(result.total_operations,2);assert.equal(result.measured_operations,2);assert.equal(result.max_concurrent,1);
  assert.deepEqual(result.stages.verification,{ms:0,operation_count:1,measured_operations:1,status:'measured'});
  assert.deepEqual(result.stages.rework,{ms:15,operation_count:1,measured_operations:1,status:'measured'});
  assert.equal(result.rows[0].stage,'rework');assert.equal(result.rows[0].end_at,at(15));
});
test('breakdown preserves legacy lifecycle duration attribution without claiming explicit stages',()=>{
  const task=taskWith([op('legacy',null,0,10)]);
  task.timeline=[{at:at(0),state:'build'},{at:at(5),state:'test'}];
  const result=executionBreakdown(task);
  assert.equal(result.rows[0].stage,null);
  assert.deepEqual(result.stages.implementation,{ms:5,operation_count:0,measured_operations:0,status:'measured'});
  assert.deepEqual(result.stages.review,{ms:5,operation_count:0,measured_operations:0,status:'measured'});
});
test('breakdown uses actual disjoint spans, stable key order, and valid timestamp fallback',()=>{
  const a=op('a','implementation',0,5);a.execution_intervals.push({started_at:at(15),completed_at:at(20)});
  const b=op('b','review',5,15),c={operation_id:'c',dispatched_at:at(0),ended_at:at(0)};
  const result=executionBreakdown(taskWith([b,c,a]));
  assert.deepEqual(result.rows.map(r=>r.operation_id),['a','c','b']);assert.equal(result.max_concurrent,1);
  assert.ok(result.rows.every(r=>!r.overlapping_with.length));
  const missing=executionBreakdown(taskWith([{...c,execution_intervals:[]},{operation_id:'invalid',dispatched_at:at(20),ended_at:at(10)}]));
  assert.equal(missing.measured_operations,0);assert.equal(missing.mode,'unreported');
});
