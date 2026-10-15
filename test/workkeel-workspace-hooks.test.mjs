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
import {createWorkspace,registerWorkspaceProject} from '../src/workkeel-workspace.mjs';
import {startWorkspaceServer} from '../src/workkeel-workspace-server.mjs';
import {readModelPolicy} from '../src/workkeel-model-policy.mjs';
import {captureNativeLearning} from '../src/workkeel-learning.mjs';

test('observatory native hooks retain lessons before Skill promotion and isolate unreadable learning',async t=>{
  const f=await fixture(t,{learning:true});
  await captureNativeLearning(f.root,{task_id:f.task.id,actor:f.actor,claim_id:f.task.claim.id,contract_sha256:f.task.contract_sha256,operation_id:'capture-lesson',record:{id:'LESSON-synthetic',kind:'lesson',title:'A captured experience',summary:'A concrete learned behavior',applicability:'This synthetic case',exclusions:'No automatic promotion',aliases:[],derived_from:[],evidence:['docs/approval.md'],skill_refs:[]}});
  const view=await f.hooks.learning.read({project:f.project});assert.equal(view.entries.length,0);assert.equal(view.lessons.length,1);assert.equal(view.lessons[0].effective_state,'candidate');assert.equal(view.lesson_status,'available');
  await fs.writeFile(f.root+'/.ai-org/learning/native/000001.json','broken');
  const broken=await f.hooks.learning.read({project:f.project});assert.equal(broken.lesson_status,'unavailable');assert.deepEqual(broken.lessons,[]);assert.deepEqual(broken.entries,[]);
});

async function fixture(t,{learning=false}={}){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'workspace-hooks-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  const actor={agent_id:'builder',principal_id:'owner'};await initializeTaskProject(root,{schema_version:'workkeel.task-policy/v1',principals:['owner'],agents:[actor,{agent_id:'reviewer',principal_id:'owner'}],approvers:['owner'],review_separation:'distinct-agent'});
  await fs.mkdir(root+'/docs');await fs.writeFile(root+'/docs/approval.md','Synthetic settings authority');
  const policy={schema_version:'workkeel.dispatch-policy/v1',models:[{alias:'careful',provider:'codex',model:'fixture-model',reasoning:'high',data_classes:['internal']}],default_alias:'careful',conservative_alias:'careful',parallelism:1};
  await fs.writeFile(root+'/docs/models.json',JSON.stringify(policy));git('add','docs');git('commit','-qm','Synthetic settings baseline');
  const brief={schema_version:'workkeel.task-brief/v1',id:'WK-settings',goal:'Configure synthetic project settings',actor,acceptance:['Keep native task unchanged'],environment:{cwd:'.',read_paths:['docs','.ai-org/host-usage'],write_paths:['.ai-org/model-policies','.ai-org/autonomy','.ai-org/retention'],tools:['node'],resources:[],network:{mode:'none',hosts:[]},external_actions:[],data:{classification:'internal',model_access:'none',policy_refs:['docs/approval.md','docs/models.json']}},authorization:{approved_by:'owner',approval_ref:'docs/approval.md',operations:['read','write','execute'],expires_at:null}};
  if(learning)brief.environment.write_paths.push('.ai-org/learning');
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

test('desktop editor persists exact task activity drafts through the native hooks and a server restart', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core'),f=await fixture(t);
  const state=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'desktop-workspace-')));t.after(()=>fs.rm(state,{recursive:true,force:true}));await createWorkspace(state,{id:'desktop',name:'Synthetic desktop test'});
  await registerWorkspaceProject(state,{id:'native',name:'Synthetic product project',task_root:f.root,repositories:[{id:'core',path:f.root}]},{expectedVersion:1});
  const options={control:{actor:f.actor,actions:['policy.draft','policy.preview','policy.approve']},hooks:f.hooks};
  let server=await startWorkspaceServer(state,options);t.after(()=>server.close());
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(8000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(server.url);await page.waitForFunction(()=>document.getElementById('connection')?.textContent.startsWith('Connected locally'));await page.goto(server.origin+'/?view=settings&project=native');
  await page.getByRole('button',{name:'Adjust Implementation',exact:true}).click();
  await page.locator('[name=model-mode]').selectOption('fixed');await page.locator('[name=model-value]').fill('careful');
  await page.keyboard.press('Escape');assert.equal(await page.locator('dialog').count(),0);assert.equal((await readModelPolicy(f.root,'project-routing')).version,0);
  assert.equal(await page.getByRole('button',{name:'Adjust Implementation',exact:true}).evaluate(el=>el===document.activeElement),true);
  await page.getByRole('button',{name:'Task exception',exact:true}).click();await page.getByRole('searchbox',{name:'Search tasks',exact:true}).fill('WK-settings');await page.locator('[data-rule-action="task:WK-settings"]').click();
  await page.getByRole('button',{name:'Adjust Implementation',exact:true}).click();await page.locator('[name=model-mode]').selectOption('fixed');await page.locator('[name=model-value]').fill('careful');
  await page.locator('[name=reasoning-mode]').selectOption('auto');
  await page.getByRole('button',{name:'Preview choices',exact:true}).click();await page.locator('#rule-selection-preview .model-observation-row').first().filter({hasText:'fixture-model'}).waitFor();
  assert.match(await page.locator('#rule-selection-preview').innerText(),/Not reported/);
  const evidence=process.env.WORKKEEL_WORKSPACE_EVIDENCE_DIR;
  if(evidence){await fs.mkdir(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,'native-policy-drawer-1440.png')});}
  await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.locator('.mr-version').filter({hasText:'draft v1'}).waitFor();
  const saved=await readModelPolicy(f.root,'project-routing');assert.equal(saved.active_version,null);assert.equal(saved.entries[0].policy.rules[0].task,'WK-settings');assert.equal(saved.entries[0].policy.rules[0].match,'implementation');
  await page.reload();await page.locator('.mr-context h2').filter({hasText:'Configure synthetic project settings'}).waitFor();
  await page.getByRole('button',{name:'Approve this exact draft',exact:true}).click();await page.locator('.mr-version').filter({hasText:'approved v1'}).waitFor();
  assert.equal((await readModelPolicy(f.root,'project-routing')).active_version,1);assert.deepEqual((await readNativeTask(f.root,'WK-settings')).contract,f.task.contract);
  await server.close();server=await startWorkspaceServer(state,options);await page.goto(server.url);await page.waitForFunction(()=>document.getElementById('connection')?.textContent.startsWith('Connected locally'));await page.goto(server.origin+'/?view=settings&project=native');await page.locator('.mr-version').filter({hasText:'approved v1'}).waitFor();
  for(const viewport of [{width:1280,height:800},{width:1440,height:1000},{width:1920,height:1080}]){await page.setViewportSize(viewport);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));if(evidence)await page.screenshot({path:path.join(evidence,'native-policy-page-1440.png')});
  await page.getByRole('button',{name:'Project defaults',exact:true}).click();await page.locator('[name=model-mode]').selectOption('fixed');await page.locator('[name=model-value]').fill('not-approved');
  assert.equal(await page.getByRole('button',{name:'Save draft',exact:true}).isDisabled(),true);assert.equal((await readModelPolicy(f.root,'project-routing')).version,2);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Adjust Verification',exact:true}).click();
  const concurrent=structuredClone((await readModelPolicy(f.root,'project-routing')).entries[0].policy);concurrent.version=2;
  await f.hooks.policy.execute({project:f.project,actor:f.actor,action:'policy.draft',expectedVersion:2,payload:{policy:concurrent}});
  await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.locator('#rule-editor-error').filter({hasText:'not confirmed'}).waitFor();
  assert.equal((await readModelPolicy(f.root,'project-routing')).version,3,'stale browser draft cannot overwrite a newer revision');
  assert.equal(await page.getByRole('button',{name:'Save draft',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.deepEqual(errors,[]);
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
