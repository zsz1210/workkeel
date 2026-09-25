import test from 'node:test';
import assert from 'node:assert/strict';
import {projectTaskTiming} from '../src/workkeel-task-timing.mjs';
import {handoffText,taskActions,durationZh,countZh} from '../src/workkeel-monitor-view.mjs';
const at=n=>new Date(Date.UTC(2026,0,1)+n*1000).toISOString();
const make=rows=>({state:rows.at(-1)[1],history:rows.map(([action,state,time])=>({action,state,at:at(time)}))});
const rows=[['create','intake',0],['claim','build',10],['handoff','test',30],['review','test',40],['rework','intake',50],['claim','build',60],['handoff','test',90],['review','release_gate',100],['close','done',120]];
test('complete task breakdown includes failed-review wait, rework and acceptance without double counting',()=>{
 const result=projectTaskTiming(make(rows),{now:new Date(at(500))});
 assert.equal(result.coverage,'complete-history');assert.equal(result.elapsed_ms,120000);assert.equal(result.ongoing,false);
 assert.deepEqual(result.phases,{waiting:20000,implementation:20000,review:30000,rework:30000,acceptance:20000});
 assert.equal(Object.values(result.phases).reduce((a,b)=>a+b),result.elapsed_ms);
 for(const key of ['human_effort_ms','baseline_elapsed_ms','saved_time_ms'])assert.equal(result[key],null);
});
test('ongoing snapshots use one read time; zero and cancellation remain measured',()=>{
 const task=make(rows.slice(0,2));const now=new Date(at(15));
 assert.deepEqual(projectTaskTiming(task,{now}).phases,{waiting:10000,implementation:5000,review:0,rework:0,acceptance:0});
 assert.equal(projectTaskTiming(make([['create','intake',0]]),{now:new Date(at(0))}).elapsed_ms,0);
 assert.equal(projectTaskTiming(make([['create','intake',0],['cancel','cancelled',5]]),{now}).elapsed_ms,5000);
 assert.equal(task.history.length,2);
});
test('bad chronology and histories return unknown rather than zero or a partial total',()=>{
 const original=make(rows);
 for(const change of [t=>t.history[2].at='bad',t=>t.history[2].at=at(1),t=>t.history.at(-1).at=at(900),t=>t.history[0].action='claim',t=>t.history[2].state='done',t=>t.history[2].state='unknown',t=>t.state='build',t=>t.history=[]]){
  const task=structuredClone(original);change(task);const result=projectTaskTiming(task,{now:new Date(at(500))});
  assert.equal(result.coverage,'unavailable');assert.equal(result.elapsed_ms,null);assert.ok(Object.values(result.phases).every(x=>x===null));
 }
 assert.equal(projectTaskTiming(original,{now:new Date(NaN)}).elapsed_ms,null);
});
test('handoff includes exact evidence and pending actions, not raw outputs or links',()=>{
 const task={id:'WK-1',read_status:'available',goal:'完整任務目標',scope:{include:['src'],exclude:['credentials']},task_state:'test',updated_at:at(100),candidate_revision:'abc',acceptance_criteria:['可驗收'],attention_reasons:['approval-expired','review-failed','workflow-incomplete'],quality:{locally_accepted:false},review:{judgment:'fail'},evidence:[{stage:'delivery',path:'report.md',sha256:'sha256:exact',status:'changed'}],observation:{status:'stale',value:{links:{conversation:'DO_NOT_COPY_LINK'}}},runs:[{run_id:'one',runner_state:'completed',output:'DO_NOT_COPY_OUTPUT'}],token:'DO_NOT_COPY_TOKEN',lifecycle:projectTaskTiming(make(rows),{now:new Date(at(500))})};
 const text=handoffText(task,at(500));assert.match(text,/完整任務目標/);assert.match(text,/report.md \/ sha256:exact/);assert.match(text,/尚未完成/);assert.match(text,/授權已過期/);assert.match(text,/勿直接重跑/);assert.doesNotMatch(text,/DO_NOT_COPY/);
 assert.equal(handoffText({...task,read_status:'unavailable'},at(500)),null);
 assert.equal(taskActions({task_state:'intake',attention_reasons:[]})[0],'認領已批准的任務，開始工作。');
 assert.equal(durationZh(null),'未知');assert.equal(durationZh(0),'0.0 秒');assert.equal(countZh({complete:false,known_subtotal:0}),'>= 0 （部分紀錄）');
});
