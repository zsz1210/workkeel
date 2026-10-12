import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createMonitorFixture} from '../scripts/workkeel-monitor-fixture.mjs';
import {readNativeTask,mutateNativeTask} from '../src/workkeel-tasks.mjs';
import {recordTaskObservation,readTaskSummary} from '../src/workkeel-task-summary.mjs';
import {executionDigest} from '../src/workkeel-execution-policy.mjs';

async function fixture(t) {
  const root=await createMonitorFixture();t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const id='WK-unobserved',actor={agent_id:'builder',principal_id:'owner'};
  await fs.writeFile(path.join(root,'docs/source-review.md'),'Synthetic source review findings.');
  execFileSync('git',['-C',root,'add','.']);
  execFileSync('git',['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','-C',root,'commit','-qm','Synthetic review evidence']);
  const revision=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const mutate=async(action,extra={})=>mutateNativeTask(root,id,action,{
    operation_id:action+'-'+(await readNativeTask(root,id)).version,
    expected_version:(await readNativeTask(root,id)).version,actor,...extra});
  const claim=await mutate('claim',{base_revision:revision});
  const value={schema_version:'workkeel.task-observation/v1',task_id:id,task_version:claim.version,actor,
    candidate_revision:revision,observed_at:new Date().toISOString(),source:'Synthetic source review',sample_kind:'fixture',
    comparison_group:null,checks:[],links:{conversation:null,pull_request:null},note:'Pre-delivery only',
    pre_delivery_review:{review_id:'source-review-1',judgment:'fail',findings_count:2,evidence_ref:'docs/source-review.md'}};
  return {root,id,value,mutate,claim,revision};
}

test('pre-delivery fail then pass remains separate from formal first pass; exact replay is idempotent',async t=>{
  const {root,id,value,mutate,claim,revision}=await fixture(t);
  const before=await readNativeTask(root,id);
  const first=await recordTaskObservation(root,id,value);
  assert.equal((await recordTaskObservation(root,id,value)).replayed,true);
  assert.deepEqual(await readNativeTask(root,id),before);
  await assert.rejects(recordTaskObservation(root,id,{...value,note:'Changed under same ID'}),/already binds/);
  await recordTaskObservation(root,id,{...value,pre_delivery_review:{...value.pre_delivery_review,review_id:'source-review-2',judgment:'pass',findings_count:0}});
  await mutate('handoff',{claim_id:claim.claim.id,revision,summary:'Delivery',evidence:['docs/approval.md'],unresolved:[]});
  await mutate('review',{actor:{agent_id:'reviewer',principal_id:'owner'},revision,judgment:'pass',summary:'Formal review',evidence:['docs/approval.md']});
  assert.equal((await recordTaskObservation(root,id,value)).path,first.path);
  const {quality}=await readTaskSummary(root,id);
  assert.equal(quality.first_review_pass,true);assert.equal(quality.formal_first_review_pass,true);
  assert.equal(quality.rework_count,0);assert.equal(quality.formal_rework_count,0);
  assert.equal(quality.metric_scope,'formal-task-review');
  assert.equal(quality.pre_delivery_review.recorded_count,2);
  assert.equal(quality.pre_delivery_review.failures_count,1);
  assert.equal(quality.pre_delivery_review.findings_count,2);
  assert.equal(quality.pre_delivery_review.coverage,'recorded-only');
  assert.equal(quality.pre_delivery_review.independence,'not-asserted');
  assert.deepEqual(quality.pre_delivery_review.events[0].actor,value.actor);
});

test('unknown coverage remains null and ordinary observations remain compatible',async t=>{
  const {root,id,value}=await fixture(t);
  const empty=(await readTaskSummary(root,id)).quality.pre_delivery_review;
  assert.equal(empty.status,'unobserved');
  for(const field of ['recorded_count','failures_count','findings_count'])assert.equal(empty[field],null);
  const {pre_delivery_review,...ordinary}=value;
  ordinary.candidate_revision=null;
  await recordTaskObservation(root,id,ordinary);
  const summary=await readTaskSummary(root,id);
  assert.equal(summary.observation.status,'unbound');assert.equal(summary.quality.pre_delivery_review.recorded_count,null);
});

test('pre-delivery reviews reject stale or non-build versions, unknown actors and malformed fields',async t=>{
  const {root,id,value,mutate,claim,revision}=await fixture(t);
  for(const change of [{candidate_revision:null},{task_version:1},{actor:{agent_id:'stranger',principal_id:'owner'}},
    ...[{review_id:'x'.repeat(97)},{judgment:'accepted'},{findings_count:-1},{findings_count:0.5},{evidence_ref:'../escape'},{formal_first_review_pass:true}].map(change=>({pre_delivery_review:{...value.pre_delivery_review,...change}}))])
    await assert.rejects(recordTaskObservation(root,id,{...value,...change}));
  await mutate('handoff',{claim_id:claim.claim.id,revision,summary:'Delivery',evidence:['docs/approval.md'],unresolved:[]});
  await assert.rejects(recordTaskObservation(root,id,value),/Stale/);
  await assert.rejects(recordTaskObservation(root,id,{...value,task_version:3}),/build-stage/);
});

test('evidence drift or any corrupt older observation makes observations unavailable without losing task',async t=>{
  const {root,id,value}=await fixture(t);
  const saved=await recordTaskObservation(root,id,value);
  const evidence=path.join(root,value.pre_delivery_review.evidence_ref);
  await fs.appendFile(evidence,' drift');
  let summary=await readTaskSummary(root,id);
  assert.equal(summary.task_state,'build');assert.equal(summary.observation.status,'unavailable');
  assert.equal(summary.quality.pre_delivery_review.status,'unavailable');assert.equal(summary.quality.pre_delivery_review.recorded_count,null);
  await assert.rejects(recordTaskObservation(root,id,value),/evidence changed/);
  await fs.writeFile(evidence,'Synthetic source review findings.');
  const file=path.join(root,saved.path),doc=JSON.parse(await fs.readFile(file,'utf8'));
  // A valid digest cannot legitimize a review attributed to an intake version.
  doc.record.value.task_version=1;doc.sha256=executionDigest(doc.record);
  await fs.rm(file);await fs.writeFile(path.join(path.dirname(file),doc.sha256+'.json'),JSON.stringify(doc));
  summary=await readTaskSummary(root,id);
  assert.equal(summary.task_state,'build');assert.equal(summary.observation.status,'unavailable');
});

test('bounded history and digest tampering block appends and remain unavailable to readers',async t=>{
  const {root,id,value}=await fixture(t);
  const saved=await recordTaskObservation(root,id,value),file=path.join(root,saved.path);
  const bytes=await fs.readFile(file,'utf8');
  await fs.writeFile(file,bytes.replace('Pre-delivery only','Tampered note'));
  assert.equal((await readTaskSummary(root,id)).observation.status,'unavailable');
  await assert.rejects(recordTaskObservation(root,id,value),/integrity/);
  await fs.writeFile(file,bytes);
  for(let index=0;index<64;index++)await fs.writeFile(path.join(path.dirname(file),String(index).padStart(64,'0')+'.json'),'{}');
  assert.equal((await readTaskSummary(root,id)).observation.status,'unavailable');
  await assert.rejects(recordTaskObservation(root,id,value),/exceeds limit/);
});

test('conflicting stored review IDs fail closed and large finding totals never lose precision',async t=>{
  const {root,id,value}=await fixture(t);
  value.pre_delivery_review.findings_count=Number.MAX_SAFE_INTEGER;
  const first=await recordTaskObservation(root,id,value);
  const second=await recordTaskObservation(root,id,{...value,pre_delivery_review:{...value.pre_delivery_review,review_id:'source-review-2'}});
  assert.equal((await readTaskSummary(root,id)).quality.pre_delivery_review.findings_count,null);
  const doc=JSON.parse(await fs.readFile(path.join(root,second.path),'utf8'));
  doc.record.value.pre_delivery_review.review_id=value.pre_delivery_review.review_id;
  doc.record.value.note='Conflicting attributed observation';doc.sha256=executionDigest(doc.record);
  await fs.rm(path.join(root,second.path));
  await fs.writeFile(path.join(root,path.dirname(first.path),doc.sha256+'.json'),JSON.stringify(doc));
  assert.equal((await readTaskSummary(root,id)).observation.status,'unavailable');
  await assert.rejects(recordTaskObservation(root,id,value),/Duplicate/);
});
