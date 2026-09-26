import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {initializeTaskProject} from '../src/workkeel-project.mjs';
import {previewTaskIntake,applyTaskIntake} from '../src/workkeel-intake.mjs';
import {readNativeTask,mutateNativeTask} from '../src/workkeel-tasks.mjs';
import {readTaskSummary} from '../src/workkeel-task-summary.mjs';
import {executionDigest} from '../src/workkeel-execution-policy.mjs';
import {measureReads,trackSources} from '../src/workkeel-read-metrics.mjs';

async function fixture(t) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'workkeel-event-reasons-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  const actor={agent_id:'builder',principal_id:'owner'},reviewer={agent_id:'reviewer',principal_id:'owner'},id='WK-history';
  await initializeTaskProject(root,{schema_version:'workkeel.task-policy/v1',principals:['owner'],agents:[actor,reviewer],approvers:['owner'],review_separation:'distinct-agent'});
  await fs.mkdir(root+'/docs');await fs.mkdir(root+'/src');await fs.writeFile(root+'/docs/approval.md','Approved synthetic event-reason fixture.');
  git('add','.');git('commit','-qm','Fixture inputs');
  const brief={schema_version:'workkeel.task-brief/v1',id,goal:'Synthetic task title',actor,acceptance:['Preserve event reasons'],environment:{cwd:'.',read_paths:['.'],write_paths:['src'],tools:[],resources:[],network:{mode:'none',hosts:[]},external_actions:[],data:{classification:'public',model_access:'none',policy_refs:['docs/approval.md']}},authorization:{approved_by:'owner',approval_ref:'docs/approval.md',operations:['read','write'],expires_at:null}};
  const preview=await previewTaskIntake(root,brief);await applyTaskIntake(root,brief,preview.fingerprint);
  const requests=[];
  const mutate=async(action,extra={})=>{
    const item=await readNativeTask(root,id),request={operation_id:action+'-'+item.version,expected_version:item.version,actor,...extra};
    const result=await mutateNativeTask(root,id,action,request);requests.push({action,request});return result;
  };
  const artifacts=`.ai-org/artifacts/${id}`;
  return {root,id,actor,reviewer,git,mutate,requests,artifacts,record:`${root}/.ai-org/work-items/${id}.json`};
}
async function release(f) {
  const claim=await f.mutate('claim',{base_revision:f.git('rev-parse','HEAD')});
  await f.mutate('release',{claim_id:claim.claim.id,summary:'Yield write roots for another approved task.'});
}
async function complete(f) {
  await release(f);
  const evidence=['docs/approval.md'];
  let claim=await f.mutate('claim',{base_revision:f.git('rev-parse','HEAD')});
  await f.mutate('handoff',{claim_id:claim.claim.id,revision:f.git('rev-parse','HEAD'),summary:'Deliver initial behavior.',evidence,unresolved:[]});
  await f.mutate('review',{actor:f.reviewer,revision:f.git('rev-parse','HEAD'),judgment:'fail',summary:'The original boundary check fails.',evidence});
  await f.mutate('rework',{summary:'Repair the failed boundary check in the same scope.'});
  claim=await f.mutate('claim',{base_revision:f.git('rev-parse','HEAD')});
  await fs.writeFile(f.root+'/src/repair.txt','Repaired fixture');f.git('add','src');f.git('commit','-qm','Repair');
  const revision=f.git('rev-parse','HEAD');
  await f.mutate('handoff',{claim_id:claim.claim.id,revision,summary:'Deliver the corrected behavior.',evidence,unresolved:[]});
  await f.mutate('review',{actor:f.reviewer,revision,judgment:'pass',summary:'The repaired boundary check passes.',evidence});
  await f.mutate('close',{revision,summary:'Accept this corrected candidate locally.',rollback:'Revert fixture',evidence});
}
// Build a synthetic old-format history; production records are never rewritten.
async function oldHistory(f) {
  const task=await readNativeTask(f.root,f.id);let previous=null;
  for(const event of task.history) {
    delete event.summary;delete event.judgment;delete event.hash;
    event.previous_hash=previous;event.hash=executionDigest(event);previous=event.hash;
  }
  await fs.writeFile(f.record,JSON.stringify(task,null,2)+'\n');
  await readNativeTask(f.root,f.id);
  return fs.readFile(f.record);
}
async function save(f,name,content) {
  const file=path.join(f.root,f.artifacts,name);await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(file,typeof content==='string'?content:JSON.stringify(content));return file;
}

test('new event reasons and review outcomes survive release, rework and later acceptance in the hash chain',async t=>{
  const f=await fixture(t);await complete(f);
  const task=await readNativeTask(f.root,f.id),summary=await readTaskSummary(f.root,f.id);
  assert.equal(summary.quality.locally_accepted,true);assert.equal(summary.quality.rework_count,1);
  assert.equal(summary.timeline.find(e=>e.action==='release').reason,'Yield write roots for another approved task.');
  assert.equal(summary.timeline.find(e=>e.action==='rework').reason,'Repair the failed boundary check in the same scope.');
  const reviews=summary.timeline.filter(e=>e.action==='review');
  assert.deepEqual(reviews.map(e=>e.outcome),['fail','pass']);
  assert.deepEqual(reviews[0].actor,f.reviewer);assert.equal(reviews[0].reason,'The original boundary check fails.');
  for(const event of summary.timeline) {
    assert.equal(event.reason_source,event.reason?'event':'unknown');
    if(event.action!=='review')assert.equal(event.outcome,null);
    assert.notEqual(event.reason,summary.title);
  }
  assert.equal(summary.timeline[0].reason,null);
  const recorded=task.history.find(e=>e.action==='review');
  const {hash,...body}=recorded;assert.equal(executionDigest(body),hash);assert.equal(recorded.judgment,'fail');
  recorded.summary='Altered after recording';await fs.writeFile(f.record,JSON.stringify(task));
  await assert.rejects(readNativeTask(f.root,f.id),/history integrity/);
});

test('old events recover only exact own operation requests without replacing retained failure or rewriting history',async t=>{
  const f=await fixture(t);await complete(f);const before=await oldHistory(f);
  let summary=await readTaskSummary(f.root,f.id);
  assert.ok(summary.timeline.every(e=>e.reason===null&&e.outcome===null),'Current and retained stage summaries cannot be assigned to an old event by inference');
  for(const {action,request} of f.requests.filter(r=>r.request.summary))await save(f,action+'-'+request.expected_version+'.json',request);
  summary=await readTaskSummary(f.root,f.id);
  assert.deepEqual(summary.timeline.filter(e=>e.action==='review').map(e=>e.outcome),['fail','pass']);
  assert.equal(summary.timeline.find(e=>e.action==='release').reason_source,'request');
  assert.equal(summary.timeline.find(e=>e.action==='review').reason,'The original boundary check fails.');
  assert.equal(summary.timeline.find(e=>e.action==='rework').reason,'Repair the failed boundary check in the same scope.');
  assert.ok(summary.timeline.every(e=>!Object.hasOwn(e,'request')&&!Object.hasOwn(e,'evidence')&&!Object.hasOwn(e,'claim_id')));
  assert.deepEqual(await fs.readFile(f.record),before);
  const released=f.requests.find(r=>r.action==='release').request;
  await save(f,'release-'+released.expected_version+'.json',{...released,summary:'Changed reason'});
  const failed=f.requests.find(r=>r.action==='review').request;
  await save(f,'review-'+failed.expected_version+'.json',{...failed,operation_id:'nonmatching-operation'});
  summary=await readTaskSummary(f.root,f.id);
  assert.equal(summary.timeline.find(e=>e.action==='release').reason,null);
  assert.equal(summary.timeline.find(e=>e.action==='review').reason,null);
  assert.equal(summary.timeline.find(e=>e.action==='review').outcome,null);
  assert.deepEqual(await fs.readFile(f.record),before);
});

test('legacy recovery ignores unrelated JSON, nested requests, symlinks and oversized or invalid input',async t=>{
  const f=await fixture(t);await release(f);await oldHistory(f);
  const request=f.requests.find(r=>r.action==='release').request;
  await save(f,'credentials.json',request);await save(f,'nested/release.json',request);
  const other=path.join(f.root,'.ai-org/artifacts/WK-other/release.json');await fs.mkdir(path.dirname(other),{recursive:true});await fs.writeFile(other,JSON.stringify(request));
  await fs.symlink(other,path.join(f.root,f.artifacts,'release-link.json'));
  await save(f,'release-oversized.json',JSON.stringify(request)+' '.repeat(64*1024));
  await save(f,'release-invalid.json','{broken');
  const opened=[],open=fs.open.bind(fs);
  t.mock.method(fs,'open',async(file,...args)=>{opened.push(String(file));return open(file,...args);});
  const tracked=await trackSources(()=>readTaskSummary(f.root,f.id));
  assert.equal(tracked.result.timeline.find(e=>e.action==='release').reason,null);
  assert.ok(tracked.dependencies.has(f.root+'/'+f.artifacts),'Restoring a missing own request invalidates cached summaries');
  assert.ok(!opened.some(name=>/credentials|nested|release-link|WK-other/.test(name)));
  await save(f,'release-valid.json',request);
  assert.equal((await readTaskSummary(f.root,f.id)).timeline.find(e=>e.action==='release').reason,request.summary);
});

test('legacy request recovery bounds directory entries, file count and total bytes',async t=>{
  const f=await fixture(t);await release(f);await oldHistory(f);
  const request=f.requests.find(r=>r.action==='release').request;
  const filler=JSON.stringify({operation_id:'unrelated',summary:'Synthetic unrelated operation'});
  for(let i=0;i<8;i++)await save(f,`release-a${i}.json`,filler+' '.repeat(64*1024-Buffer.byteLength(filler)));
  await save(f,'release-z.json',request);
  const {result,metrics}=await measureReads(()=>readTaskSummary(f.root,f.id));
  assert.equal(result.timeline.find(e=>e.action==='release').reason,null);
  assert.ok(metrics.source_bytes<512*1024+32*1024,'Recovery reads at most 512 KiB plus bounded canonical inputs');
  for(let i=8;i<64;i++)await save(f,`release-a${i}.json`,request);
  const open=fs.open.bind(fs),opened=[];
  t.mock.method(fs,'open',async(file,...args)=>{opened.push(String(file));return open(file,...args);});
  assert.equal((await readTaskSummary(f.root,f.id)).timeline.find(e=>e.action==='release').reason,null);
  assert.equal(opened.filter(name=>name.startsWith(f.root+'/'+f.artifacts+'/')).length,0,'More than 64 candidates are not scanned');
  for(let i=0;i<65;i++)await save(f,`other-${i}.txt`,'Unrelated fixture');
  assert.equal((await readTaskSummary(f.root,f.id)).timeline.find(e=>e.action==='release').reason,null);
});
