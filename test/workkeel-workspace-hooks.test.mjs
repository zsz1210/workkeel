import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {initializeTaskProject} from '../src/workkeel-project.mjs';
import {previewTaskIntake,applyTaskIntake} from '../src/workkeel-intake.mjs';
import {mutateNativeTask,readNativeTask} from '../src/workkeel-tasks.mjs';
import {createWorkspaceHooks} from '../src/workkeel-workspace-hooks.mjs';
import {prepareTaskMaterial} from '../src/workkeel-material.mjs';
import {mutateAutonomy,readAutonomy} from '../src/workkeel-autonomy.mjs';

async function fixture(t){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'workspace-hooks-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  const actor={agent_id:'builder',principal_id:'owner'};await initializeTaskProject(root,{schema_version:'workkeel.task-policy/v1',principals:['owner'],agents:[actor,{agent_id:'reviewer',principal_id:'owner'}],approvers:['owner'],review_separation:'distinct-agent'});
  await fs.mkdir(root+'/docs');await fs.writeFile(root+'/docs/approval.md','Synthetic settings authority');
  const policy={schema_version:'workkeel.dispatch-policy/v1',models:[{alias:'careful',provider:'codex',model:'fixture-model',reasoning:'high',data_classes:['internal']}],default_alias:'careful',conservative_alias:'careful',parallelism:1};
  await fs.writeFile(root+'/docs/models.json',JSON.stringify(policy));git('add','docs');git('commit','-qm','Synthetic settings baseline');
  const brief={schema_version:'workkeel.task-brief/v1',id:'WK-settings',goal:'Configure synthetic project settings',actor,acceptance:['Keep native task unchanged'],environment:{cwd:'.',read_paths:['docs','.ai-org/host-usage'],write_paths:['.ai-org/model-policies','.ai-org/autonomy','.ai-org/retention'],tools:['node'],resources:[],network:{mode:'none',hosts:[]},external_actions:[],data:{classification:'internal',model_access:'none',policy_refs:['docs/approval.md','docs/models.json']}},authorization:{approved_by:'owner',approval_ref:'docs/approval.md',operations:['read','write','execute'],expires_at:null}};
  const p=await previewTaskIntake(root,brief);await applyTaskIntake(root,brief,p.fingerprint);await mutateNativeTask(root,brief.id,'claim',{operation_id:'claim',expected_version:1,actor,base_revision:git('rev-parse','HEAD')});
  const host_models=[{provider:'codex',model:'fixture-model',reasoning_efforts:['high'],service_tiers:['standard']}];
  return {root,actor,project:{task_root:root},hooks:createWorkspaceHooks({host_models}),task:await readNativeTask(root,brief.id)};
}
test('actual claimed task connects dimension editor to versioned drafts and exact approval',async t=>{
  const f=await fixture(t),context={project:f.project,actor:f.actor};const view=await f.hooks.policy.read(context);
  assert.equal(view.setup_reason,null);assert.equal(view.policy_document.models[0].id,'careful');assert.deepEqual(view.capabilities.reasoning,['high']);
  const saved=await f.hooks.policy.execute({...context,action:'policy.draft',expectedVersion:0,payload:{policy:{model:{mode:'fixed',value:'careful'},reasoning:{mode:'auto'},service:{mode:'auto'}}}});
  assert.equal(saved.version,1);assert.equal(saved.active_version,null);
  const preview=await f.hooks.policy.execute({...context,action:'policy.preview',expectedVersion:1,payload:{policy:saved.entries[0].policy}});
  assert.equal(preview.selected.reasoning,'high');assert.equal(preview.reported.model,null);
  const approved=await f.hooks.policy.execute({...context,action:'policy.approve',expectedVersion:1,payload:{policy_id:saved.id,policy_version:1,policy_sha256:saved.entries[0].sha256}});
  assert.equal(approved.active_version,1);assert.deepEqual((await readNativeTask(f.root,f.task.id)).contract,f.task.contract);
});
test('browser intent cannot impersonate the owner or expand the pinned model allowlist',async t=>{
  const f=await fixture(t),context={project:f.project,actor:f.actor};const view=await f.hooks.policy.read(context);
  await assert.rejects(f.hooks.policy.execute({...context,actor:{agent_id:'reviewer',principal_id:'owner'},action:'policy.draft',expectedVersion:0,payload:{policy:view.policy_document}}),/Select one approved task/);
  const widened=structuredClone(view.policy_document);widened.models[0].id='unapproved';widened.project.model={mode:'fixed',value:'unapproved'};
  await assert.rejects(f.hooks.policy.execute({...context,action:'policy.preview',expectedVersion:0,payload:{policy:widened,selectors:{authority:{allowed_models:['unapproved']}}}}),/unavailable|prohibited|allowlist/);
  await fs.appendFile(f.root+'/docs/models.json',' ');await assert.rejects(f.hooks.policy.execute({...context,action:'policy.preview',expectedVersion:0,payload:{policy:view.policy_document}}),/source changed|changed/);
});
test('autonomy UI changes have actual version and claimed-task authorization',async t=>{
  const f=await fixture(t),context={project:f.project,actor:f.actor};assert.equal((await f.hooks.autonomy.read(context)).enabled,false);
  const result=await f.hooks.autonomy.execute({...context,action:'autonomy.pause',expectedVersion:0,idempotencyKey:'pause',payload:{}});assert.equal(result.state.paused,true);
  await assert.rejects(f.hooks.autonomy.execute({...context,action:'autonomy.resume',expectedVersion:0,idempotencyKey:'resume',payload:{}}),/version conflict/);
  assert.equal((await f.hooks.autonomy.read(context)).state,'paused');
});
test('UI can stop the original queued job after its claim ends, without borrowing another active claim',async t=>{
  const f=await fixture(t),request={task_id:f.task.id,actor:f.actor,claim_id:f.task.claim.id,contract_sha256:f.task.contract_sha256,operation_id:'enqueue-original',expected_version:0};
  await mutateAutonomy(f.root,'enqueue',{...request,job:{id:'queued-job',origin:'assigned',direction:null,reason:'Synthetic queued stop',task_id:f.task.id,request_ref:'docs/models.json',depends_on:[]}});
  await mutateNativeTask(f.root,f.task.id,'release',{operation_id:'release-original',expected_version:f.task.version,actor:f.actor,claim_id:f.task.claim.id,summary:'Synthetic claim ended before dispatch'});
  const view=await readAutonomy(f.root);await assert.rejects(f.hooks.autonomy.execute({project:f.project,actor:{agent_id:'reviewer',principal_id:'owner'},action:'autonomy.cancel',expectedVersion:view.version,idempotencyKey:'wrong-actor',payload:{job_id:'queued-job'}}),/original job operator/);
  const result=await f.hooks.autonomy.execute({project:f.project,actor:f.actor,action:'autonomy.cancel',expectedVersion:view.version,idempotencyKey:'stop-original',payload:{job_id:'queued-job'}});
  assert.equal(result.cancellation,'cancelled-before-dispatch');assert.equal((await readAutonomy(f.root)).jobs[0].status,'cancelled');
});
test('explicit learning discovery does not broaden mandatory Skills or infer usage',async t=>{
  const f=await fixture(t);const request={kind:'initial',instruction:'Perform approved work',write_paths:f.task.contract.environment.write_paths,materials:[],learning_query:'external schema'};
  const material=await prepareTaskMaterial(f.root,f.task.contract,request);assert.equal(material.authority,'navigation-only');assert.deepEqual(f.task.contract.skills,[]);
  assert.equal(material.sources.some(s=>s.purposes.some(p=>p.startsWith('active-project-skill'))),false);
});

test('storage hook archives the exact preview, preserves originals and rejects changed capacity sources',async t=>{
  const f=await fixture(t),context={project:f.project,actor:f.actor};
  const source=JSON.stringify({source:'synthetic',usage:null});await fs.mkdir(f.root+'/.ai-org/host-usage',{recursive:true});await fs.writeFile(f.root+'/.ai-org/host-usage/synthetic.json',source);
  const view=await f.hooks.retention.read(context);assert.equal(view.release_bytes,0);assert.equal(view.version,f.task.version);assert.equal(view.actions.length,1);
  assert.equal(view.stored_scope,'host-measurements-only');assert.equal(view.protected_evidence.available,true);assert.ok(view.protected_evidence.bytes>0);assert.equal(view.protected_evidence.release_bytes,0);assert.ok(view.protected_evidence.roots.some(r=>r.path==='.ai-org/work-items'));
  const result=await f.hooks.retention.execute({...context,action:'retention.archive',expectedVersion:view.version,idempotencyKey:'synthetic-archive',payload:{preview_sha256:view.preview_sha256}});
  assert.equal(result.released_bytes,0);assert.equal(result.originals_modified,false);
  assert.equal(await fs.readFile(f.root+'/.ai-org/host-usage/synthetic.json','utf8'),source);
  await fs.appendFile(f.root+'/.ai-org/host-usage/synthetic.json',' ');
  await assert.rejects(f.hooks.retention.execute({...context,action:'retention.archive',expectedVersion:view.version,idempotencyKey:'changed-archive',payload:{preview_sha256:view.preview_sha256}}),/Capacity sources changed/);
});
