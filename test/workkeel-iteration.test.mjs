import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {initializeTaskProject} from '../src/workkeel-project.mjs';
import {previewTaskIntake,applyTaskIntake} from '../src/workkeel-intake.mjs';
import {mutateNativeTask,readNativeTask} from '../src/workkeel-tasks.mjs';
import {recordTaskObservation,readTaskSummary} from '../src/workkeel-task-summary.mjs';
import {runIteration} from '../scripts/workkeel-iteration.mjs';
import {planRetention,retireMedia} from '../scripts/workkeel-media-retention.mjs';
import {inspectEvidenceAvailability} from '../scripts/workkeel-evidence-availability.mjs';
import {recoverClaimProof} from '../scripts/workkeel-history-recover.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex'),actor={agent_id:'builder',principal_id:'owner'};
async function fixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'workkeel-iteration-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const git=(...a)=>execFileSync('git',['-C',root,...a],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 await initializeTaskProject(root,{schema_version:'workkeel.task-policy/v1',principals:['owner'],agents:[actor,{agent_id:'reviewer',principal_id:'owner'}],approvers:['owner'],review_separation:'distinct-agent'});
 await fs.mkdir(root+'/docs');await fs.writeFile(root+'/docs/approval.md','Approved fixture only.');await fs.mkdir(root+'/Evidence');
 git('add','.');git('commit','-qm','Fixture');const revision=git('rev-parse','HEAD');
 const brief={schema_version:'workkeel.task-brief/v1',id:'WK-iteration',goal:'Fixture iteration',actor,acceptance:['Measured outcome'],environment:{cwd:'.',read_paths:['.'],write_paths:['docs','Evidence'],tools:['node'],resources:[],network:{mode:'none',hosts:[]},external_actions:[],data:{classification:'public',model_access:'none',policy_refs:['docs/approval.md']}},authorization:{approved_by:'owner',approval_ref:'docs/approval.md',operations:['read','write','execute'],expires_at:null}};
 const p=await previewTaskIntake(root,brief);await applyTaskIntake(root,brief,p.fingerprint);await mutateNativeTask(root,brief.id,'claim',{operation_id:'claim',expected_version:1,actor,base_revision:revision});
 const task=await readNativeTask(root,brief.id),put=async(ref,data)=>{const bytes=typeof data==='string'?data:JSON.stringify(data);await fs.writeFile(root+'/'+ref,bytes);return {path:ref,sha256:sha(bytes)};};
 const baseline=await put('Evidence/before.json',{schema_version:'workkeel.sample/v1',conditions_sha256:'a'.repeat(64),candidate_revision:revision,pass:false});
 const result=await put('Evidence/after.json',{schema_version:'workkeel.sample/v1',conditions_sha256:'a'.repeat(64),candidate_revision:revision,pass:true});
 const approval=await put('Evidence/decision.json',{schema_version:'workkeel.sample-decision/v1',candidate_revision:revision,sample_sha256:result.sha256,decision:'ready',authority:'owner'});
 const resource=await put('Evidence/resource.txt','plain resource');
 const issue={issue_id:'hit',hypothesis:'Input viewport differs',change:'Use measured viewport'};
 const request={task_id:task.id,claim_id:task.claim.id,expected_revision:revision,issue,sample:{baseline,result,approval},probe_command:['node','probe.mjs'],test_command:['node','long.mjs'],timeout_ms:1000};
 const probe=()=>({schema_version:'workkeel.test-probe/v1',revision,observed_at:new Date().toISOString(),viewport:{width:321,height:578},input_viewport:{width:321,height:578},targets:[{x:30,y:50,width:100,height:50}],required_resources:[resource],estimated_generated_bytes:100,max_generated_bytes:1000,reserve_bytes:1024});
 const observation=()=>({schema_version:'workkeel.task-observation/v1',task_id:task.id,task_version:2,actor,candidate_revision:revision,observed_at:new Date().toISOString(),source:'Synthetic fixture',sample_kind:'fixture',comparison_group:null,checks:[],links:{conversation:null,pull_request:null},note:'Fixture, never real game results.'});
 const iteration=id=>({id,...issue,conditions_sha256:'a'.repeat(64),baseline_ref:baseline.path,result_ref:result.path,resolution:'unresolved',failure_kind:'environment',metrics:{ai_active_ms:null,input_tokens:null,output_tokens:null,generated_bytes:0,retained_bytes:0}});
 return {root,git,put,revision,task,request,probe,observation,iteration};
}
test('progress retains unknown, measured zero and exact evidence without accepting task',async t=>{
 const f=await fixture(t),value={...f.observation(),delivery_progress:{total:200,produced:{count:200,evidence_ref:'Evidence/after.json'},functionally_verified:{count:null,evidence_ref:null},quality_accepted:{count:0,evidence_ref:'Evidence/decision.json'},quality_authority:null}};
 await recordTaskObservation(f.root,f.task.id,value);const s=await readTaskSummary(f.root,f.task.id),p=s.quality.delivery_progress;
 assert.equal(p.progress.produced.count,200);assert.equal(p.progress.functionally_verified.count,null);assert.equal(p.progress.quality_accepted.count,0);assert.equal(s.quality.locally_accepted,false);assert.equal(p.progress.revision_status,'not-delivered');assert.equal(p.three_iteration_window.pending,3);assert.equal(p.progress.produced.evidence_status,'verified');assert.match(p.progress.produced.evidence_sha256,/^[a-f0-9]{64}$/);
 await fs.appendFile(f.root+'/Evidence/after.json',' ');const changed=(await readTaskSummary(f.root,f.task.id)).quality.delivery_progress;
 assert.equal(changed.status,'unavailable');assert.equal(changed.progress,null);
});
test('contradictory progress and missing acceptance attribution cannot be recorded',async t=>{
 const f=await fixture(t),p={total:5,produced:{count:1,evidence_ref:'Evidence/after.json'},functionally_verified:{count:2,evidence_ref:'Evidence/after.json'},quality_accepted:{count:null,evidence_ref:null},quality_authority:null};
 await assert.rejects(recordTaskObservation(f.root,f.task.id,{...f.observation(),delivery_progress:p}),/contradict/);
 p.functionally_verified.count=1;p.quality_accepted.count=1;p.quality_accepted.evidence_ref='Evidence/decision.json';
 await assert.rejects(recordTaskObservation(f.root,f.task.id,{...f.observation(),delivery_progress:p}),/authority/);
});
test('iteration IDs are immutable and fixture runs never satisfy three real rounds',async t=>{
 const f=await fixture(t),v={...f.observation(),iteration:f.iteration('one')};await recordTaskObservation(f.root,f.task.id,v);
 assert.equal((await recordTaskObservation(f.root,f.task.id,v)).replayed,true);
 await assert.rejects(recordTaskObservation(f.root,f.task.id,{...v,iteration:{...v.iteration,resolution:'resolved'}}),/already binds/);
 const s=(await readTaskSummary(f.root,f.task.id)).quality.delivery_progress;assert.equal(s.recorded_rounds,1);assert.equal(s.three_iteration_window.recorded,0);assert.equal(s.environment_reruns,1);
});
test('viewport mismatch and offscreen input prevent the long command',async t=>{
 const f=await fixture(t);let called=0;const p=f.probe();p.input_viewport={width:540,height:960};p.targets[0].y=800;
 const result=await runIteration(f.root,f.request,{runProbe:()=>p,runTest:()=>{called++;return {status:0};}});
 assert.equal(called,0);assert.equal(result.ready,false);assert.ok(result.reasons.includes('input-viewport-mismatch'));assert.ok(result.reasons.includes('input-target-outside-viewport'));
});
test('expired probes, media budget and missing resources block before long work',async t=>{
 const f=await fixture(t),p=f.probe();p.observed_at='2020-01-01T00:00:00Z';p.estimated_generated_bytes=1001;await fs.unlink(f.root+'/Evidence/resource.txt');
 const result=await runIteration(f.root,f.request,{runProbe:()=>p,runTest:()=>assert.fail('must not run')});
 for(const reason of ['probe-not-fresh','media-budget-exceeded','required-resource-unavailable'])assert.ok(result.reasons.includes(reason));
});
test('two identical unresolved approaches block even the probe; changed hypothesis can run',async t=>{
 const f=await fixture(t);
 for(const id of ['one','two'])await recordTaskObservation(f.root,f.task.id,{...f.observation(),iteration:f.iteration(id)});
 let probes=0;const options={runProbe:()=>{probes++;return f.probe();},runTest:()=>({status:0})};
 assert.equal((await runIteration(f.root,f.request,options)).ready,false);assert.equal(probes,0);
 const changed={...f.request,issue:{...f.request.issue,hypothesis:'Measured target is obscured'}};
 assert.equal((await runIteration(f.root,changed,options)).test_passed,true);assert.equal(probes,1);
});
test('sample digest or conditions mismatch blocks; caller supplied actual probe can run',async t=>{
 const f=await fixture(t);let called=0;
 const run=()=>runIteration(f.root,f.request,{runProbe:()=>f.probe(),runTest:()=>{called++;return {status:0};}});
 assert.equal((await run()).test_passed,true);assert.equal(called,1);
 const changed=await f.put('Evidence/before.json',{schema_version:'workkeel.sample/v1',conditions_sha256:'b'.repeat(64)});f.request.sample.baseline=changed;
 assert.equal((await run()).ready,false);assert.equal(called,1);
});
test('claim/candidate changes during probe prevent long work',async t=>{
 const f=await fixture(t);const result=await runIteration(f.root,f.request,{runProbe:async()=>{await mutateNativeTask(f.root,f.task.id,'release',{operation_id:'release',expected_version:2,actor,claim_id:f.task.claim.id,summary:'Fixture release'});return f.probe();},runTest:()=>assert.fail('must not run')});
 assert.ok(result.reasons.includes('claim-changed-during-probe'));
});
test('the same passing sample cannot stand in for a failed baseline',async t=>{
 const f=await fixture(t);f.request.sample.baseline=f.request.sample.result;
 const result=await runIteration(f.root,f.request,{runProbe:()=>assert.fail('must not probe'),runTest:()=>assert.fail('must not run')});assert.equal(result.ready,false);assert.ok(result.reasons.includes('comparable-sample-not-approved'));
});
async function media(t){const f=await fixture(t);await f.put('Evidence/frame.jpg','raw frame');await f.put('Evidence/current.png','required original');const replacement=await f.put('Evidence/clip.mp4','synthetic decoded movie');
 await f.put('Evidence/decode.json',{schema_version:'workkeel.media-validation/v1',status:'pass',check:'full-decode',replacement_sha256:replacement.sha256,command:'fixture decoder (synthetic, not a real movie)'});
 return {...f,policy:{schema_version:'workkeel.media-policy/v1',roots:['Evidence'],protected:['Evidence/current.png'],retire:['Evidence/frame.jpg'],replacement:{...replacement,validation_ref:'Evidence/decode.json'},max_retained_bytes:1000,reason:'Synthetic superseded frames'}};}
test('media dry run preserves files, apply requires exact digest and leaves readable receipt',async t=>{
 const f=await media(t),plan=await planRetention(f.root,f.policy);assert.equal(await fs.readFile(f.root+'/Evidence/frame.jpg','utf8'),'raw frame');
 await assert.rejects(retireMedia(f.root,plan,{confirm_sha256:'0'.repeat(64),journal_ref:'Evidence/retired.jsonl'}),/confirmation/);
 const result=await retireMedia(f.root,plan,{confirm_sha256:plan.plan_sha256,journal_ref:'Evidence/retired.jsonl'});assert.equal(result.files,1);
 assert.equal(await fs.readFile(f.root+'/Evidence/current.png','utf8'),'required original');
 const a=await inspectEvidenceAvailability(f.root,{files:plan.files,retirement_journals:[{path:'Evidence/retired.jsonl',format:'workkeel-retirement-jsonl/v1'}]});assert.equal(a.files[0].state,'retired-recorded');
});
test('claim recovery uses original Git bytes and preserves canonical task',async t=>{
 const f=await fixture(t);f.git('add','.');f.git('commit','-qm','Original claimed task');const claimRevision=f.git('rev-parse','HEAD');
 const original=await fs.readFile(f.root+'/.ai-org/work-items/'+f.task.id+'.json');
 await mutateNativeTask(f.root,f.task.id,'cancel',{operation_id:'cancel',expected_version:2,actor,summary:'Fixture cancellation',evidence:['docs/approval.md']});
 const before=await fs.readFile(f.root+'/.ai-org/work-items/'+f.task.id+'.json');
 const p=await recoverClaimProof(f.root,f.task.id,claimRevision);assert.equal(p.status,'validated-preview');
 await assert.rejects(fs.readFile(f.root+'/'+p.destination),/ENOENT/);
 const result=await recoverClaimProof(f.root,f.task.id,claimRevision,{apply:true});assert.equal(result.status,'restored');assert.deepEqual(await fs.readFile(f.root+'/'+p.destination),original);assert.deepEqual(await fs.readFile(f.root+'/.ai-org/work-items/'+f.task.id+'.json'),before);
 assert.equal((await recoverClaimProof(f.root,f.task.id,claimRevision,{apply:true})).status,'already-retained');
 await fs.writeFile(f.root+'/'+p.destination,'tampered');await assert.rejects(recoverClaimProof(f.root,f.task.id,claimRevision,{apply:true}),/differs/);
});
test('over-budget retained originals cannot be retired even with exact confirmation',async t=>{
 const f=await media(t),plan=await planRetention(f.root,{...f.policy,max_retained_bytes:0});assert.equal(plan.budget_exceeded,true);
 await assert.rejects(retireMedia(f.root,plan,{confirm_sha256:plan.plan_sha256,journal_ref:'Evidence/over-budget.jsonl'}),/exceeds budget/);assert.equal(await fs.readFile(f.root+'/Evidence/frame.jpg','utf8'),'raw frame');
});
test('media protection, changed replacement, changed original and symlink all fail closed',async t=>{
 const f=await media(t);await assert.rejects(planRetention(f.root,{...f.policy,retire:['Evidence/current.png']}),/Protected/);
 const plan=await planRetention(f.root,f.policy);await f.put('Evidence/frame.jpg','changed');
 await assert.rejects(retireMedia(f.root,plan,{confirm_sha256:plan.plan_sha256,journal_ref:'Evidence/retired.jsonl'}),/changed/);
 await fs.unlink(f.root+'/Evidence/frame.jpg');await fs.symlink('current.png',f.root+'/Evidence/frame.jpg');await assert.rejects(planRetention(f.root,f.policy),/regular/);
 await f.put('Evidence/clip.mp4','changed replacement');await assert.rejects(planRetention(f.root,f.policy),/digest/);
});
