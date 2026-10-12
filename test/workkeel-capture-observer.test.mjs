import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {initializeTaskProject} from '../src/workkeel-project.mjs';
import {previewTaskIntake,applyTaskIntake} from '../src/workkeel-intake.mjs';
import {readNativeTask,mutateNativeTask} from '../src/workkeel-tasks.mjs';
import {startTaskMonitor} from '../src/workkeel-monitor.mjs';
import {stageExecutionSummary} from '../src/workkeel-monitor-analytics.mjs';
import {beginCapture,pauseCapture,resumeCapture,finishCapture} from '../scripts/workkeel-execution-capture.mjs';

async function fixture(t) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'workkeel-capture-observer-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  const actor={agent_id:'builder',principal_id:'owner'};
  await initializeTaskProject(root,{schema_version:'workkeel.task-policy/v1',principals:['owner'],agents:[actor,{agent_id:'reviewer',principal_id:'owner'}],approvers:['owner'],review_separation:'distinct-agent'});
  await fs.mkdir(root+'/docs');await fs.mkdir(root+'/src');
  await fs.writeFile(root+'/docs/approval.md','Approved offline capture and observer fixture.');
  git('add','.');git('commit','-qm','Fixture');
  const brief={schema_version:'workkeel.task-brief/v1',id:'WK-capture-observer',goal:'Capture reports reach the observer',actor,
    acceptance:['Preserve pauses, replay, unknown usage and measured zero'],
    environment:{cwd:'.',read_paths:['src','docs'],write_paths:['src'],tools:['node'],resources:[],network:{mode:'none',hosts:[]},external_actions:[],data:{classification:'internal',model_access:'none',policy_refs:['docs/approval.md']}},
    authorization:{approved_by:'owner',approval_ref:'docs/approval.md',operations:['read','write','execute'],expires_at:null}};
  const preview=await previewTaskIntake(root,brief);await applyTaskIntake(root,brief,preview.fingerprint);
  await mutateNativeTask(root,brief.id,'claim',{operation_id:'claim',expected_version:1,actor,base_revision:git('rev-parse','HEAD')});
  const task=await readNativeTask(root,brief.id),base=Date.now();
  const clock=n=>({now:()=>base+n});
  const begin=(id,activity_kind,n)=>beginCapture(root,{capture_id:id,binding:{kind:'host',binding_id:id,task_id:task.id,actor,claim_id:task.claim.id,contract_sha256:task.contract_sha256},source:{kind:'host-report',thread_id:'private-thread-'+id,turn_id:'private-turn-'+id},activity_kind,sample_kind:'fixture'},clock(n));
  return {root,task,clock,begin};
}

test('capture reports reconcile through authenticated observer APIs without counting pauses or inventing missing usage',async t=>{
  const f=await fixture(t);
  await f.begin('implementation','implementation',0);
  const pause={capture_id:'implementation',operation_id:'wait-for-input'};
  await pauseCapture(f.root,pause,f.clock(3));
  await pauseCapture(f.root,pause,f.clock(5));
  await resumeCapture(f.root,{capture_id:'implementation',operation_id:'continue-work'},f.clock(7));
  const completed={capture_id:'implementation',report:{status:'completed',usage:{input_tokens:120,cached_input_tokens:100,output_tokens:30,total_tokens:150},tool:'offline-runner',provider:'local',model:'actual-local-model',reported_reasoning:null}};
  await finishCapture(f.root,completed,f.clock(10));
  await finishCapture(f.root,completed,f.clock(100));
  await f.begin('review','review',11);
  await finishCapture(f.root,{capture_id:'review',report:{status:'completed',usage:{},tool:'offline-runner'}},f.clock(15));
  await f.begin('verification','verification',16);
  await finishCapture(f.root,{capture_id:'verification',report:{status:'completed',usage:{input_tokens:0,output_tokens:0,total_tokens:0},tool:'node-test'}},f.clock(16));

  const monitor=await startTaskMonitor(f.root);t.after(()=>monitor.close());
  const url=new URL(monitor.url),headers={Authorization:'Bearer '+url.hash.slice(1)};
  const get=async route=>{const r=await fetch(url.origin+route,{headers});assert.equal(r.status,200,route);return r.json();};
  assert.equal((await fetch(url.origin+'/api/analysis')).status,401);
  // The observer bounds concurrent readers; inspect each view after its predecessor.
  const analysis=await get('/api/analysis'),task=await get('/api/task?id='+f.task.id),
    activity=await get('/api/activity'),diagnostics=await get('/api/diagnostics');
  assert.equal(analysis.operation_count,3);
  assert.equal(analysis.totals.ms,10);
  assert.equal(analysis.totals.tokens,150);
  assert.deepEqual(analysis.totals.token_breakdown,{input:120,cached_input:100,uncached_input:20,output:30,total:150});
  assert.deepEqual(analysis.totals.metric_coverage.input,{known:2,total:3});
  assert.equal(analysis.totals.tokens_complete,false);
  assert.equal(task.execution.execution_ms,10);
  assert.deepEqual(stageExecutionSummary(task).phases,{planning:null,implementation:6,review:4,rework:null,verification:0});
  const selected=await get('/api/analysis?model=actual-local-model&group=model');
  assert.equal(selected.operation_count,1);assert.equal(selected.totals.ms,6);assert.equal(selected.totals.tokens,150);
  assert.ok(activity.interval_count>=2);
  assert.equal(diagnostics.model_calls,0);
  assert.doesNotMatch(JSON.stringify({analysis,task,activity}),/private-thread-|private-turn-|execution-capture\/|capture-observer-.*\.json/);
  assert.deepEqual(await readNativeTask(f.root,f.task.id),f.task,'capture and observer do not advance task state');
});
