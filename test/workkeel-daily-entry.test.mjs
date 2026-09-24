import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {initializeTaskProject} from '../src/workkeel-project.mjs';
import {createMonitorFixture} from '../scripts/workkeel-monitor-fixture.mjs';
import {previewTaskIntake,applyTaskIntake} from '../src/workkeel-intake.mjs';
import {readNativeTask,listTaskItems,mutateNativeTask} from '../src/workkeel-tasks.mjs';
import {recordTaskObservation,readTaskSummary,safeObservationLink} from '../src/workkeel-task-summary.mjs';
import {readMonitorSnapshot} from '../src/workkeel-monitor.mjs';
import {readTaskMeasurements} from '../src/workkeel-measurements.mjs';

async function fixture(t){const root=await createMonitorFixture();t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
async function brief(root){const {contract:c}=await readNativeTask(root,'WK-unobserved');return {schema_version:'workkeel.task-brief/v1',id:'WK-new',goal:'A real bounded change',actor:c.actor,acceptance:['Checks pass'],environment:c.environment,authorization:c.authorization};}
test('one brief previews without writes, applies idempotently and rejects stale authority',async t=>{
 const root=await fixture(t),input=await brief(root),before=await listTaskItems(root),preview=await previewTaskIntake(root,input);
 assert.equal(preview.execution_authorized,false);assert.equal(preview.contract.execution.runtime.kind,'host-owned');
 assert.deepEqual(await listTaskItems(root),before);
 await assert.rejects(applyTaskIntake(root,input,'bad'),/Stale/);
 await fs.appendFile(path.join(root,'docs/approval.md'),' Changed.');
 await assert.rejects(applyTaskIntake(root,input,preview.fingerprint),/Stale/);
 const fresh=await previewTaskIntake(root,input),result=await applyTaskIntake(root,input,fresh.fingerprint);
 assert.equal(result.state,'intake');assert.equal((await applyTaskIntake(root,input,fresh.fingerprint)).replayed,true);
 assert.equal((await readNativeTask(root,'WK-new')).claim,null);
});
test('brief does not invent actors, acceptance, permissions or path authority',async t=>{
 const root=await fixture(t),input=await brief(root);
 for(const changed of [{acceptance:[]},{actor:{agent_id:'other',principal_id:'owner'}},{authorization:null},{environment:{...input.environment,write_paths:['../escape']}},{risk_tier:'high'},{extra:'not allowed'}])await assert.rejects(previewTaskIntake(root,{...input,...changed}));
});
test('expired active authority requires attention and cannot be claimed',async t=>{
 const root=await fixture(t),input=await brief(root);input.authorization={...input.authorization,expires_at:new Date(Date.now()+60000).toISOString()};
 const preview=await previewTaskIntake(root,input);await applyTaskIntake(root,input,preview.fingerprint);
 t.mock.timers.enable({apis:['Date'],now:Date.now()+120000});
 const summary=await readTaskSummary(root,input.id);assert.equal(summary.needs_attention,true);assert.equal(summary.quality.approval_status,'expired');assert.match(summary.next_action,/expired.*renewed approval/);
 const snapshot=await readMonitorSnapshot(root);assert.match(snapshot.tasks.find(x=>x.id===input.id).next_action,/expired/);
 await assert.rejects(mutateNativeTask(root,input.id,'claim',{operation_id:'expired-claim',expected_version:1,actor:input.actor,base_revision:execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim()}),/authorization.expired/);
});
test('first review failure survives rework and later acceptance',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'workkeel-summary-history-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const git=(...a)=>execFileSync('git',['-C',root,...a],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 const actor={agent_id:'builder',principal_id:'owner'},reviewer={agent_id:'reviewer',principal_id:'owner'};
 await initializeTaskProject(root,{schema_version:'workkeel.task-policy/v1',principals:['owner'],agents:[actor,reviewer],approvers:['owner'],review_separation:'distinct-agent'});
 await fs.mkdir(root+'/docs');await fs.mkdir(root+'/src');await fs.writeFile(root+'/docs/approval.md','Approved synthetic lifecycle fixture');
 git('add','.');git('commit','-qm','Fixture inputs');
 const input={schema_version:'workkeel.task-brief/v1',id:'WK-history',goal:'Synthetic review history',actor,acceptance:['Retain review history'],environment:{cwd:'.',read_paths:['.'],write_paths:['src'],tools:[],resources:[],network:{mode:'none',hosts:[]},external_actions:[],data:{classification:'public',model_access:'none',policy_refs:['docs/approval.md']}},authorization:{approved_by:'owner',approval_ref:'docs/approval.md',operations:['read','write'],expires_at:null}};
 const preview=await previewTaskIntake(root,input);await applyTaskIntake(root,input,preview.fingerprint);
 const mutate=async(action,extra={})=>{const item=await readNativeTask(root,input.id);return mutateNativeTask(root,input.id,action,{operation_id:action+'-'+item.version,expected_version:item.version,actor,...extra});};
 let claim=await mutate('claim',{base_revision:git('rev-parse','HEAD')});
 await mutate('handoff',{claim_id:claim.claim.id,revision:git('rev-parse','HEAD'),summary:'Synthetic initial delivery',evidence:['docs/approval.md'],unresolved:[]});
 await mutate('review',{actor:reviewer,revision:git('rev-parse','HEAD'),judgment:'fail',summary:'Synthetic defect',evidence:['docs/approval.md']});
 await mutate('rework',{summary:'Correct same scope'});
 let summary=await readTaskSummary(root,input.id);assert.equal(summary.quality.first_review_pass,false);assert.equal(summary.quality.review_judgment,null);assert.equal(summary.quality.rework_count,1);
 claim=await mutate('claim',{base_revision:git('rev-parse','HEAD')});await fs.writeFile(root+'/src/change.txt','Corrected fixture');git('add','src');git('commit','-qm','Correct fixture');
 const revision=git('rev-parse','HEAD');await mutate('handoff',{claim_id:claim.claim.id,revision,summary:'Synthetic correction',evidence:['docs/approval.md'],unresolved:[]});
 await mutate('review',{actor:reviewer,revision,judgment:'pass',summary:'Corrected fixture reviewed',evidence:['docs/approval.md']});
 await mutate('close',{actor:reviewer,revision,summary:'Synthetic acceptance',rollback:'Revert fixture',evidence:['docs/approval.md']});
 summary=await readTaskSummary(root,input.id);assert.equal(summary.quality.first_review_pass,false);assert.equal(summary.quality.locally_accepted,true);assert.equal(summary.quality.review_judgment,'pass');assert.equal(summary.quality.evidence_current,true);assert.ok(summary.quality.lifecycle_elapsed_ms>=0);
});
async function observed(root){const task=await readNativeTask(root,'WK-completed');return {schema_version:'workkeel.task-observation/v1',task_id:task.id,task_version:task.version,actor:task.contract.actor,candidate_revision:null,observed_at:new Date().toISOString(),source:'Coordinator local test',sample_kind:'fixture',comparison_group:null,checks:[{name:'Acceptance',status:'pass',evidence_ref:'docs/approval.md'}],links:{conversation:'codex://threads/01a0d1d2-b5ee-7c90-b7c5-178e65725b86',pull_request:'https://github.com/example/project/pull/1'},note:'Synthetic observation; not task acceptance'};}
test('observations are bounded idempotent metadata, never acceptance; changed evidence is unavailable',async t=>{
 const root=await fixture(t),value=await observed(root),before=await readNativeTask(root,value.task_id);
 await recordTaskObservation(root,value.task_id,value);
 assert.equal((await recordTaskObservation(root,value.task_id,value)).replayed,true);
 assert.deepEqual(await readNativeTask(root,value.task_id),before);
 const summary=await readTaskSummary(root,value.task_id);assert.equal(summary.observation.status,'unbound');assert.equal(summary.quality.locally_accepted,false);assert.equal(summary.quality.first_review_pass,null);
 await fs.appendFile(path.join(root,'docs/approval.md'),' drift');
 const drift=await readTaskSummary(root,value.task_id);
 assert.equal(drift.observation.status,'unavailable');assert.equal(drift.quality.evidence_current,false);
 assert.match(drift.next_action,/exact recorded evidence/);assert.equal((await readMonitorSnapshot(root)).complete,false);
});
test('unsafe links, stale versions, unknown actors and invalid observation references reject',async t=>{
 const root=await fixture(t),value=await observed(root);
 for(const url of ['javascript:alert(1)','https://github.com.evil.test/a/b/pull/1','file:///etc/passwd','https://github.com/a/b/pull/1?token=secret'])assert.equal(safeObservationLink(url,'pull_request'),null);
 for(const change of [{task_version:0},{actor:{agent_id:'other',principal_id:'owner'}},{links:{...value.links,pull_request:'javascript:alert(1)'}},{checks:[{name:'bad',status:'pass',evidence_ref:'../escape'}]}])await assert.rejects(recordTaskObservation(root,value.task_id,{...value,...change}));
});
test('observer reads execution inventory once and isolates attributable corruption without certifying totals',async t=>{
 const root=await fixture(t);let snapshot=await readMonitorSnapshot(root);assert.equal(snapshot.inventory_reads,2);
 await fs.writeFile(path.join(root,'.ai-org/execution/completed/status.json'),'broken');
 snapshot=await readMonitorSnapshot(root);assert.equal(snapshot.complete,false);
 assert.equal(snapshot.tasks.find(t=>t.id==='WK-completed').coverage,'incomplete-journal');
 assert.equal(snapshot.tasks.find(t=>t.id==='WK-interrupted').usage.input_tokens.known_subtotal,1200);
 await assert.rejects(readTaskMeasurements(root,'WK-completed'));
 await fs.writeFile(path.join(root,'.ai-org/execution/completed/run.json'),'broken');
 snapshot=await readMonitorSnapshot(root);
 for(const task of snapshot.tasks){assert.equal(task.usage.input_tokens.total,null);assert.equal(task.usage.input_tokens.complete,false);}
 await fs.writeFile(path.join(root,'.ai-org/work-items/WK-unobserved.json'),'broken');
 snapshot=await readMonitorSnapshot(root);assert.equal(snapshot.tasks.find(t=>t.id==='WK-unobserved').read_status,'unavailable');
 assert.equal(snapshot.tasks.find(t=>t.id==='WK-interrupted').read_status,'available');
});
test('retained legacy history does not consume native monitor limit',async t=>{
 const root=await fixture(t),lock=JSON.parse(await fs.readFile(path.join(root,'workkeel.lock')));lock.legacy_manifest=[];
 // Inject retained-history fixture records, not production lifecycle writes.
 for(let i=1;i<=201;i++){const id='WI-'+String(i).padStart(4,'0'),ref='.ai-org/work-items/'+id+'.json';const bytes=JSON.stringify({id,schema_version:'temple.work-item/v1',title:'Historical task',state:'done'});await fs.writeFile(path.join(root,ref),bytes);lock.legacy_manifest.push({path:ref,sha256:createHash('sha256').update(bytes).digest('hex')});}
 await fs.writeFile(path.join(root,'workkeel.lock'),JSON.stringify(lock));
 const snapshot=await readMonitorSnapshot(root);assert.equal(snapshot.legacy_tasks_excluded,201);assert.equal(snapshot.tasks.length,3);
});
