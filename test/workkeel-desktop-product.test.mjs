import test from 'node:test';
import assert from 'node:assert/strict';
import {editPolicy,latestRecordedExecution} from '../src/workkeel-model-rules-ui.mjs';
import {buildExecutionVisual,taskVisualRows} from '../src/workkeel-execution-visuals.mjs';
import {resolveModelPolicy} from '../src/workkeel-model-policy.mjs';
import {renderWorkspaceScene} from '../src/workkeel-workspace-scene.mjs';

const auto={mode:'auto'}, fixed=value=>({mode:'fixed',value}), inherit={mode:'inherit'};
const model=(id,efforts,services)=>({id,provider:'synthetic',model:id,data_classes:['internal'],risk_tiers:['standard'],quality:1,
  reasoning_efforts:efforts,service_tiers:services,auto_efforts:{low:efforts[0],standard:efforts[0],high:efforts[0]},auto_service:services[0],cost:null,quota_remaining:null});
const policy=()=>({schema_version:'workkeel.model-policy/v1',id:'test',version:1,
  project:{model:auto,reasoning:auto,service:auto},rules:[],models:[model('a',['low','high'],['standard','priority']),model('b',['high'],['standard'])]});

test('latest execution uses canonical operation chronology and preserves missing or tied timestamps',()=>{
  const task={updated_at:'2030-01-01T00:00:00Z',runs:[{run_id:'r',operations:[
    {operation_id:'older',activity_kind:'implementation',start_at:'2026-01-01T00:00:00Z',runtime_model:'older-model'},
    {operation_id:'newer',activity_kind:'implementation',dispatched_at:'2026-01-02T00:00:00Z',runtime_model:'newer-model'}]}]};
  const rows=buildExecutionVisual(taskVisualRows(task)).operations.map(row=>({task,row}));
  assert.equal(latestRecordedExecution(rows).row.actual_model,'newer-model');
  assert.equal(rows[0].row.actual_model,'older-model','selection does not reorder input');
  assert.equal(latestRecordedExecution([...rows,{task,row:{order_at:null}}]),null);
  assert.equal(latestRecordedExecution([...rows,rows[1]]),null);
  assert.equal(latestRecordedExecution([]),null);
  assert.equal(latestRecordedExecution([{task,row:{order_at:null}}]).task,task);
});

test('product editor rejects incompatible tuples in both selection orders and inherited descendants',()=>{
  const p=policy();
  assert.throws(()=>editPolicy(p,{layer:'project'},{model:fixed('b'),reasoning:fixed('low'),service:auto},['a','b'],1),/incompatible/);
  const fixedEffort=editPolicy(p,{layer:'activity',match:'implementation'},{model:inherit,reasoning:fixed('low'),service:inherit},['a','b'],1);
  assert.throws(()=>editPolicy(fixedEffort,{layer:'project'},{model:fixed('b'),reasoning:auto,service:auto},['a','b'],1),/implementation/);
  const fixedModel=editPolicy(p,{layer:'project'},{model:fixed('b'),reasoning:auto,service:auto},['a','b'],1);
  assert.throws(()=>editPolicy(fixedModel,{layer:'activity',match:'implementation'},{model:inherit,reasoning:fixed('low'),service:inherit},['a','b'],1),/incompatible/);
  assert.throws(()=>editPolicy(p,{layer:'project'},{model:fixed('b'),reasoning:auto,service:fixed('priority')},['a','b'],1),/incompatible/);
  assert.deepEqual(p,policy(),'cancelable edits never mutate their input');
});

test('editing a task activity preserves other tasks, role metadata and independently inherited fields',()=>{
  const p=policy();p.rules.push({id:'existing',layer:'role',match:'qa',settings:{service:fixed('standard')}});
  const next=editPolicy(p,{layer:'activity',match:'implementation',task:'WK-one'},
    {model:fixed('b'),reasoning:inherit,service:inherit},['a','b'],2);
  assert.equal(resolveModelPolicy(next,{activity:'implementation',task:'WK-one'}).requested.model.value,'b');
  assert.equal(resolveModelPolicy(next,{activity:'implementation',task:'WK-two'}).requested.model.mode,'auto');
  assert.equal(resolveModelPolicy(next,{activity:'verification',task:'WK-one'}).requested.model.mode,'auto');
  assert.deepEqual(next.rules[0],p.rules[0]);assert.deepEqual(next.models,p.models);assert.equal(p.rules.length,1);
  assert.throws(()=>editPolicy(next,{layer:'project'},p.project,['a'],3),/disabled model/);
});

test('scene escapes recorded identities, preserves unknown metrics and does not invent a current executor',()=>{
  const empty=renderWorkspaceScene([],{language:'zh-TW'});
  assert.match(empty,/尚無執行回報/);assert.doesNotMatch(empty,/aria-current="step"/);
  const html=renderWorkspaceScene([{activity_kind:'implementation',actor:{agent_id:'<img onerror=x>',principal_id:'p'},state:'completed',started_at:'2026-01-01T00:00:00Z',ended_at:'2026-01-01T00:00:01Z',reported:{model:'<script>bad</script>'},tokens:null}],{});
  assert.doesNotMatch(html,/<img|<script>/);assert.match(html,/&lt;img/);assert.match(html,/Tokens not reported/);
  assert.doesNotMatch(html,/aria-current="step"/);
});
