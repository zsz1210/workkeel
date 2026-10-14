import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {createMonitorFixture} from '../scripts/workkeel-monitor-fixture.mjs';
import {createWorkspace,readWorkspace,registerWorkspaceProject,removeWorkspaceProject,readWorkspaceSnapshot,projectWorkspaceAttention,inspectWorkspaceIntegration,workspaceAutonomySummary,workspaceExecutionRows,projectWorkspaceExecution,projectWorkspaceAnalysis} from '../src/workkeel-workspace.mjs';
import {startWorkspaceServer} from '../src/workkeel-workspace-server.mjs';
import {readMonitorSnapshot} from '../src/workkeel-monitor.mjs';
import {workspaceClient} from '../src/workkeel-workspace-ui.mjs';

test('workspace browser module parses before deployment',()=>{new vm.Script('async function parseOnly(){'+workspaceClient+'}');});

async function setup(t,{extended=false}={}) {
  const state=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'workkeel-workspace-state-')));
  const repo=await fs.realpath(await createMonitorFixture({extended}));
  t.after(()=>Promise.all([fs.rm(state,{recursive:true,force:true}),fs.rm(repo,{recursive:true,force:true})]));
  await createWorkspace(state,{id:'synthetic',name:'Synthetic workspace'});
  await registerWorkspaceProject(state,{id:'alpha',name:'Order service',task_root:repo,repositories:[{id:'service',path:repo}]},{expectedVersion:1});
  return {state,repo};
}
const projectInput=(repo,id)=>({id,name:id,task_root:repo,repositories:[{id:'service',path:repo}]});
function syntheticExecutionView(){
  const actor={agent_id:'synthetic-builder',principal_id:'synthetic-owner'},at=n=>new Date(1700000000000+n).toISOString();
  const implementation={operation_id:'implement',node:'build-node',execution_id:'execute-build',activity_kind:'implementation',actor,state:'completed',requested_model:'requested-model',requested_reasoning:{value:'medium'},requested_service:'standard',selected_model:'selected-model',selected_reasoning:'high',selected_service:'priority',runtime_model:'reported-model',reported_reasoning:'low',reported_service:null,tool:'synthetic-host',usage:{input_tokens:100,output_tokens:0},result_recorded:true,coverage_complete:true,adapter_elapsed_ms:1000,execution_intervals:[{started_at:at(0),completed_at:at(1000)}]};
  const verification={operation_id:'verify',node:'test-node',activity_kind:'verification',state:'completed',runtime_model:null,tool:'synthetic-host',usage:{input_tokens:null,output_tokens:null},result_recorded:true,adapter_elapsed_ms:null,execution_intervals:[]};
  const review={operation_id:'review',node:'review-node',activity_kind:'review',state:'unconfirmed',requested_model:'requested-review',tool:'synthetic-review-host',usage:{input_tokens:0,output_tokens:0},result_recorded:true,coverage_complete:true,adapter_elapsed_ms:0,execution_intervals:[]};
  return {projects:[{id:'p',name:'Synthetic project',read_status:'available'}],read_at:at(2000),tasks:[{id:'WK-synthetic',key:'p:WK-synthetic',project_id:'p',title:'Synthetic measured goal',task_state:'build',read_status:'available',actor:{agent_id:'do-not-infer-this-claim',principal_id:'owner'},runs:[{run_id:'work',actor,operations:[implementation,verification,implementation]},{run_id:'review',operations:[review]}]}]};
}

test('execution projects recorded activities, actual identity reports and separate requested/selected/reported dimensions',()=>{
  const view=syntheticExecutionView(),rows=workspaceExecutionRows(view.tasks);
  assert.equal(rows.length,3);assert.deepEqual(rows.map(row=>row.activity_kind).sort(),['implementation','review','verification']);
  const operation=rows.find(row=>row.operation_id==='implement');assert.equal(operation.actor.agent_id,'synthetic-builder');assert.equal(operation.requested.model,'requested-model');assert.equal(operation.selected.model,'selected-model');assert.equal(operation.reported.model,'reported-model');assert.equal(operation.requested.reasoning,'medium');assert.equal(operation.selected.reasoning,'high');assert.equal(operation.reported.reasoning,'low');assert.equal(operation.reported.service,null);assert.equal(operation.interval_ms,1000);
  const unknown=rows.find(row=>row.operation_id==='verify');assert.equal(unknown.reported.model,null);assert.equal(unknown.tokens,null);assert.equal(unknown.interval_ms,null);
  const review=rows.find(row=>row.operation_id==='review');assert.equal(review.actor,null);assert.equal(review.actor_source,'unreported');assert.equal(review.reported.model,null);assert.equal(review.tokens,0);assert.equal(review.reported_ms,0);
  const result=projectWorkspaceExecution(view,{project_id:'p',task_id:'WK-synthetic',limit:2});assert.equal(result.operations.total,3);assert.equal(result.operations.items.length,2);assert.equal(result.operations.next_offset,2);assert.equal(result.reported_actor_count,1);assert.deepEqual(result.identity_coverage,{reported:2,total:3});assert.equal(result.lifecycle_state,'build');
  assert.throws(()=>projectWorkspaceExecution(view,{project_id:'p',task_id:'WK-synthetic',limit:101}),/Invalid execution page/);
});

test('workspace analysis groups and filters bounded recorded operations without inventing missing measurements',()=>{
  const view=syntheticExecutionView(),grouped=projectWorkspaceAnalysis(view,{group:'activity_kind',limit:1});assert.equal(grouped.groups.total,3);assert.equal(grouped.groups.items.length,1);assert.equal(grouped.coverage.recorded_operations,3);
  const filtered=projectWorkspaceAnalysis(view,{activity:'implementation',tool:'synthetic-host',model:'reported-model'});assert.equal(filtered.coverage.selected_operations,1);assert.equal(filtered.totals.tokens,100);assert.equal(filtered.totals.ms,1000);
  const unknown=projectWorkspaceAnalysis(view,{model:'unreported'});assert.equal(unknown.coverage.selected_operations,2);assert.equal(unknown.totals.tokens,0);assert.equal(unknown.totals.tokens_complete,false);
  assert.throws(()=>projectWorkspaceAnalysis(view,{group:'actor'}),/Invalid analysis grouping/);
});

test('registry has private bounded explicit scope and transactional version checks',async t=>{
  const {state,repo}=await setup(t);
  await assert.rejects(createWorkspace(path.resolve('private-state-forbidden')),/outside framework source/);
  await assert.rejects(registerWorkspaceProject(state,projectInput(repo,'other'),{expectedVersion:1}),/version changed/);
  await assert.rejects(registerWorkspaceProject(state,{...projectInput(repo,'other'),repositories:[{id:'service',path:repo,scope:'../outside'}]},{expectedVersion:2}),/relative directory/);
  await assert.rejects(registerWorkspaceProject(state,{...projectInput(repo,'alpha')},{expectedVersion:2}),/already registered/);
  await fs.symlink(path.join(repo,'src'),path.join(repo,'alias'));
  await assert.rejects(registerWorkspaceProject(state,{...projectInput(repo,'other'),repositories:[{id:'service',path:repo,scope:'alias'}]},{expectedVersion:2}),/symlink/);
  const results=await Promise.allSettled(['one','two'].map(id=>registerWorkspaceProject(state,projectInput(repo,id),{expectedVersion:2})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await readWorkspace(state)).version,3);
  await removeWorkspaceProject(state,'alpha',{expectedVersion:3});
  assert.equal((await readWorkspace(state)).projects.length,1);
  const stored=await fs.readFile(path.join(state,'workspace.json'),'utf8');
  assert.ok(!stored.includes('WK-completed'));assert.ok(!stored.includes('runs'));
  assert.equal((await fs.stat(path.join(state,'workspace.json'))).mode&0o777,0o600);
});

test('namespaced canonical projections isolate failures and expose shared repository scope',async t=>{
  const {state,repo}=await setup(t);
  await registerWorkspaceProject(state,projectInput(repo,'beta'),{expectedVersion:2});
  const before=await fs.readFile(path.join(state,'workspace.json'),'utf8');
  const view=await readWorkspaceSnapshot(state);
  assert.equal(view.model_calls,0);assert.equal(view.tasks.length,6);
  assert.equal(new Set(view.tasks.map(task=>task.key)).size,6);
  assert.ok(view.tasks.some(task=>task.key==='alpha:WK-completed'));
  assert.ok(view.tasks.some(task=>task.key==='beta:WK-completed'));
  assert.equal(view.shared_scopes.length,1);
  assert.equal(view.usage_coverage.recorded_operations,4);
  assert.equal(await fs.readFile(path.join(state,'workspace.json'),'utf8'),before);
  let count=0;
  const partial=await readWorkspaceSnapshot(state,{snapshotReader:async root=>{if(++count===2)throw Error('Synthetic missing source');return readMonitorSnapshot(root);}});
  assert.equal(partial.projects[1].read_status,'unavailable');assert.equal(partial.projects[1].active_count,null);
  assert.equal(partial.tasks.length,3);assert.equal(partial.complete,false);
  assert.ok(partial.attention.some(issue=>issue.kind==='source-unavailable'));
});

test('human attention groups shared reasons without manufacturing approval for automatic review',()=>{
  const tasks=[{project_id:'p',key:'p:a',attention_reasons:['awaiting-review','workflow-incomplete'],next_action:'Review automatically'},
    {project_id:'p',key:'p:b',attention_reasons:['awaiting-acceptance'],next_action:'Accept result'},
    {project_id:'p',key:'p:c',attention_reasons:['awaiting-acceptance'],next_action:'Accept result'}];
  const issues=projectWorkspaceAttention(tasks,[{id:'p',read_status:'available'}]);
  assert.equal(issues.length,1);assert.equal(issues[0].affected_count,2);assert.deepEqual(issues[0].tasks,['p:b','p:c']);
});

test('project autonomy distinguishes off, idle and recorded execution; corruption stays unknown',async t=>{
  const base={policy:{enabled:false},paused:false,jobs:[],discovery_runs:[],proposals:[]};
  assert.equal(workspaceAutonomySummary(base).state,'off');
  assert.equal(workspaceAutonomySummary({...base,policy:{enabled:true}}).state,'idle');
  const job={origin:'improvement',status:'running',updated_at:'2026-01-01T00:00:00.000Z'};
  const recorded=workspaceAutonomySummary({...base,policy:{enabled:true},jobs:[job]});
  assert.equal(recorded.state,'execution-recorded');assert.equal(recorded.live_activity,'unconfirmed');assert.equal(recorded.last_updated,job.updated_at);
  const {state,repo}=await setup(t);
  assert.equal((await readWorkspaceSnapshot(state)).projects[0].autonomy.state,'off');
  await fs.mkdir(path.join(repo,'.ai-org/autonomy'));await fs.writeFile(path.join(repo,'.ai-org/autonomy/state.json'),'synthetic malformed state');
  const unknown=await readWorkspaceSnapshot(state);assert.equal(unknown.projects[0].autonomy.enabled,null);assert.equal(unknown.projects[0].autonomy.state,'unknown');assert.equal(unknown.projects[0].read_status,'available');assert.equal(unknown.tasks.length,3);assert.equal(unknown.complete,false);assert.ok(unknown.attention.some(a=>a.kind==='autonomy-unavailable'));
});

test('exact repository integration requires accepted components and pinned candidate-set evidence',async t=>{
  const {state,repo}=await setup(t,{extended:true});
  const view=await readWorkspaceSnapshot(state),task=view.tasks.find(t=>t.id==='WK-accepted');
  const components=[{project_id:'alpha',task_id:task.id,repo_id:'service',candidate_revision:task.candidate_revision}];
  const first=await inspectWorkspaceIntegration(view,{components});assert.equal(first.components[0].status,'accepted');assert.equal(first.status,'incomplete');
  const content=JSON.stringify({schema_version:'workkeel.integration-evidence/v1',candidate_set_digest:first.candidate_set_digest,judgment:'pass',checks:[{name:'Synthetic contract combination',status:'pass'}]});
  await fs.writeFile(path.join(repo,'docs','integration.json'),content);
  const evidence={project_id:'alpha',path:'docs/integration.json',sha256:createHash('sha256').update(content).digest('hex')};
  const result=await inspectWorkspaceIntegration(view,{components,evidence});
  assert.equal(result.status,'integration-verified');assert.equal(result.acceptance_granted,false);assert.equal(result.deployed,'unreported');
  const drift=structuredClone(view);drift.tasks.find(t=>t.id===task.id).candidate_revision='0'.repeat(40);
  assert.equal((await inspectWorkspaceIntegration(drift,{components,evidence})).status,'incomplete');
  await fs.appendFile(path.join(repo,'docs','integration.json'),' ');
  assert.equal((await inspectWorkspaceIntegration(view,{components,evidence})).evidence_status,'changed');
  await assert.rejects(inspectWorkspaceIntegration(view,{components:[...components,...components]}),/duplicate/);
});

test('capability server separates reads/control, preserves observer resources and deduplicates durable requests',async t=>{
  const {state}=await setup(t);let executed=0,observersClosed=0;
  const options={control:{actor:{agent_id:'owner-agent',principal_id:'owner'},actions:['policy.save']},hooks:{policy:{read:async()=>({version:0,policy:{},capabilities:{}}),execute:async request=>{executed++;assert.equal(request.expectedVersion,0);return {saved:true};}}},observerFactory:async()=>({url:'http://127.0.0.1:1234/#'+'a'.repeat(64),close:async()=>{observersClosed++;}})};
  const service=await startWorkspaceServer(state,options);t.after(()=>service.close());
  const [read,write]=new URL(service.url).hash.slice(1).split('/'),readHeaders={Authorization:'Bearer '+read},writeHeaders={Authorization:'Bearer '+write,Origin:service.origin,'Content-Type':'application/json'};
  assert.equal((await fetch(service.origin+'/api/workspace')).status,401);
  assert.equal((await fetch(service.origin+'/api/workspace',{headers:{...readHeaders,Origin:'https://untrusted.example'}})).status,403);
  assert.equal((await fetch(service.origin+'/api/workspace',{headers:{Authorization:'Bearer '+write}})).status,401);
  const command={project_id:'alpha',action:'policy.save',expectedVersion:0,expectedRegistryVersion:2,idempotencyKey:'request-one',payload:{policy:{}}};
  assert.equal((await fetch(service.origin+'/api/policy',{method:'PUT',headers:readHeaders,body:JSON.stringify(command)})).status,403);
  assert.equal((await fetch(service.origin+'/api/policy',{method:'PUT',headers:{Authorization:'Bearer '+write},body:JSON.stringify(command)})).status,403);
  const invoke=()=>fetch(service.origin+'/api/policy',{method:'PUT',headers:writeHeaders,body:JSON.stringify(command)}).then(r=>r.json());
  const responses=await Promise.all([invoke(),invoke()]);assert.equal(executed,1);assert.ok(responses.every(r=>r.status==='confirmed'));
  assert.equal((await invoke()).replayed,true);
  assert.equal((await fetch(service.origin+'/api/policy',{method:'PUT',headers:writeHeaders,body:JSON.stringify({...command,payload:{policy:{different:true}}})})).status,409);
  assert.equal((await fetch(service.origin+'/api/policy',{method:'PUT',headers:writeHeaders,body:JSON.stringify({...command,idempotencyKey:'stale',expectedRegistryVersion:1})})).status,409);
  const link=await fetch(service.origin+'/api/observer?project=alpha',{headers:readHeaders}).then(r=>r.json());assert.match(link.url,/127\.0\.0\.1/);
  const html=await fetch(service.origin);assert.match(html.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.ok(!(await html.text()).includes(write));
  await service.close();assert.equal(observersClosed,1);
  const restarted=await startWorkspaceServer(state,options);t.after(()=>restarted.close());
  const newWrite=new URL(restarted.url).hash.slice(1).split('/')[1];
  const replay=await fetch(restarted.origin+'/api/policy',{method:'PUT',headers:{...writeHeaders,Authorization:'Bearer '+newWrite,Origin:restarted.origin},body:JSON.stringify(command)}).then(r=>r.json());
  assert.equal(replay.replayed,true);assert.equal(executed,1);
});

test('unknown host outcomes are durable and symlinked command receipts are rejected',async t=>{
  const {state}=await setup(t);let calls=0;
  const service=await startWorkspaceServer(state,{control:{actor:{agent_id:'a',principal_id:'p'},actions:['autonomy.pause']},hooks:{autonomy:{execute:async()=>{calls++;throw Error('Synthetic lost host response');}}}});t.after(()=>service.close());
  const write=new URL(service.url).hash.slice(1).split('/')[1],headers={Authorization:'Bearer '+write,Origin:service.origin,'Content-Type':'application/json'};
  const command={project_id:'alpha',action:'autonomy.pause',expectedVersion:0,expectedRegistryVersion:2,idempotencyKey:'pause-one',payload:{}};
  const invoke=()=>fetch(service.origin+'/api/autonomy',{method:'POST',headers,body:JSON.stringify(command)}).then(r=>r.json());
  assert.equal((await invoke()).status,'requires-reconciliation');assert.equal((await invoke()).status,'requires-reconciliation');assert.equal(calls,1);
  await fs.symlink(path.join(state,'workspace.json'),path.join(state,'commands','symlink.json'));
  const response=await fetch(service.origin+'/api/autonomy',{method:'POST',headers,body:JSON.stringify({...command,idempotencyKey:'symlink'})});assert.equal(response.status,400);assert.equal(calls,1);
});

test('partial source failure keeps last-confirmed history visibly stale without copying it into registry',async t=>{
  const {state}=await setup(t);let unavailable=false;
  const service=await startWorkspaceServer(state,{readSnapshot:async directory=>{const view=await readWorkspaceSnapshot(directory);if(unavailable){view.projects[0].read_status='unavailable';view.projects[0].last_confirmed_at=null;view.projects[0].active_count=null;view.projects[0].complete=false;view.tasks=[];view.complete=false;}return view;}});t.after(()=>service.close());
  const headers={Authorization:'Bearer '+new URL(service.url).hash.slice(1)};
  const read=()=>fetch(service.origin+'/api/workspace',{headers}).then(r=>r.json());
  const first=await read();unavailable=true;const stale=await read();
  assert.equal(stale.projects[0].last_confirmed_at,first.projects[0].last_confirmed_at);
  assert.equal(stale.tasks.length,first.tasks.length);assert.ok(stale.tasks.every(task=>task.read_status==='stale'));
  assert.equal(stale.complete,false);assert.ok(stale.attention.some(issue=>issue.kind==='source-unavailable'));
  assert.ok(!(await fs.readFile(path.join(state,'workspace.json'),'utf8')).includes('WK-completed'));
});

test('retention inventory is requested only on its own route; exact archive commands use control capability',async t=>{
  const {state}=await setup(t);let reads=0,archives=0;
  const service=await startWorkspaceServer(state,{control:{actor:{agent_id:'synthetic',principal_id:'owner'},actions:['retention.archive']},hooks:{retention:{read:async()=>{reads++;return {version:0,stored_bytes:4096,archive_bytes:1024,release_bytes:0,roots:['.ai-org/host-usage'],preview:{sha256:'b'.repeat(64)}};},execute:async request=>{archives++;assert.equal(request.payload.preview_sha256,'b'.repeat(64));return {archived:true,released_bytes:0};}}}});t.after(()=>service.close());
  const [read,write]=new URL(service.url).hash.slice(1).split('/');
  await fetch(service.origin+'/api/workspace',{headers:{Authorization:'Bearer '+read}});assert.equal(reads,0);
  const capacity=await fetch(service.origin+'/api/retention?project=alpha',{headers:{Authorization:'Bearer '+read}}).then(r=>r.json());assert.equal(capacity.release_bytes,0);assert.equal(reads,1);
  const command={project_id:'alpha',action:'retention.archive',expectedVersion:0,expectedRegistryVersion:2,idempotencyKey:'archive-preview',payload:{preview_sha256:'b'.repeat(64)}};
  const response=await fetch(service.origin+'/api/retention',{method:'POST',headers:{Authorization:'Bearer '+write,Origin:service.origin,'Content-Type':'application/json'},body:JSON.stringify(command)}).then(r=>r.json());assert.equal(response.status,'confirmed');assert.equal(response.result.released_bytes,0);assert.equal(archives,1);
});

test('actual desktop browser supports navigation, escaped text, controls, zoom, stale state and theme', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core');const {state}=await setup(t,{extended:true});
  let fail=false,policyWrites=0;
  const service=await startWorkspaceServer(state,{readSnapshot:async dir=>{if(fail)throw Error('Synthetic connection interruption');return readWorkspaceSnapshot(dir);},control:{actor:{agent_id:'a',principal_id:'p'},actions:['policy.save']},hooks:{policy:{read:async()=>({version:0,policy:{model:{mode:'fixed',value:'review-model'},reasoning:{mode:'auto'},service:{mode:'inherit'}},capabilities:{model:['review-model'],reasoning:['high'],service:['standard']}}),execute:async()=>{policyWrites++;return {saved:true};}}}});t.after(()=>service.close());
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:900},colorScheme:'light',reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(service.url);await page.getByRole('heading',{name:'Your workspace',exact:true}).waitFor();
  for(const viewport of [{width:1280,height:800},{width:1440,height:900},{width:1920,height:1080},{width:720,height:600}]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,JSON.stringify(viewport));
  }
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole('link',{name:'Order service',exact:true}).click();await page.getByRole('heading',{name:'Order service',exact:true}).waitFor();
  await page.getByRole('link',{name:/^<img src=x onerror=alert\(1\)> Unobserved task/}).click();await page.getByRole('heading',{name:/^<img src=x onerror=alert\(1\)> Unobserved task/}).waitFor();assert.equal(await page.locator('main img').count(),0);
  await page.getByRole('tab',{name:'Timeline',exact:true}).click();await page.getByRole('heading',{name:'Task lifecycle & handoffs'}).waitFor();
  await page.goto(service.origin+'/?view=settings&project=alpha');await page.getByRole('button',{name:'Save policy'}).waitFor();
  await page.getByRole('button',{name:'Save policy'}).click();await page.getByText('Host confirmed the request.',{exact:false}).waitFor();assert.equal(policyWrites,1);
  await page.getByRole('button',{name:'Appearance: system'}).click();assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'light');
  await page.getByRole('button',{name:'繁體中文',exact:true}).click();await page.getByRole('heading',{name:'模型政策',exact:true}).waitFor();
  fail=true;await page.getByRole('button',{name:'重新整理',exact:true}).click();await page.getByText('無法確認最新狀態。',{exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'儲存政策'}).isDisabled(),true);
  assert.deepEqual(errors,[]);
  const evidence=process.env.WORKKEEL_WORKSPACE_EVIDENCE_DIR;
  if(evidence){await fs.mkdir(evidence,{recursive:true});fail=false;await page.getByRole('button',{name:'重新整理',exact:true}).click();await page.goto(service.origin+'/?view=overview');await page.getByRole('heading',{name:'工作空間',exact:true}).waitFor();await page.screenshot({path:path.join(evidence,'workspace-overview-1440.png'),fullPage:true});}
});

test('actual browser edits contextual model rules and separately previews and approves an exact draft', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core');const {state}=await setup(t);
  let storeVersion=0,entries=[],policy={schema_version:'workkeel.model-policy/v1',id:'synthetic-model-policy',version:1,project:{model:{mode:'auto'},reasoning:{mode:'auto'},service:{mode:'auto'}},rules:[],models:[{id:'synthetic-approved-model',provider:'synthetic',model:'synthetic-model',opaque_scope:'kept'}]},approved=false,previewed=false;
  const service=await startWorkspaceServer(state,{control:{actor:{agent_id:'synthetic-operator',principal_id:'synthetic-owner'},actions:['policy.draft','policy.preview','policy.approve']},hooks:{policy:{read:async()=>({version:storeVersion,policy:policy.project,policy_document:policy,entries,active_version:approved?policy.version:null,capabilities:{model:['synthetic-approved-model'],reasoning:['high'],service:['standard']}}),execute:async request=>{
    assert.equal(request.expectedVersion,storeVersion);
    if(request.action==='policy.draft'){policy=request.payload.policy;assert.equal(policy.models[0].opaque_scope,'kept');assert.equal(policy.rules[0].layer,'role');assert.equal(policy.rules[0].match,'review');assert.equal(policy.rules[0].settings.model.value,'synthetic-approved-model');entries=[{policy,sha256:'a'.repeat(64),approval:null}];storeVersion++;return {draft_saved:true};}
    if(request.action==='policy.preview'){previewed=true;assert.equal(request.payload.selectors.role,'review');return {requested:policy.rules[0].settings,selected:{model:'synthetic-model'},reported:{model:null},dispatch_performed:false};}
    if(request.action==='policy.approve'){assert.equal(request.payload.policy_sha256,'a'.repeat(64));assert.equal(request.payload.policy_version,1);approved=true;entries[0].approval={synthetic:true};storeVersion++;return {approved:true};}
    throw Error('Unexpected synthetic action');
  }}}});t.after(()=>service.close());
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(service.url);await page.getByRole('link',{name:'Settings',exact:true}).click();await page.getByLabel('Project',{exact:true}).selectOption('alpha');await page.getByRole('button',{name:'Save draft',exact:true}).waitFor();
  await page.locator('#policy-context').selectOption('role');await page.locator('#policy-match').fill('review');await page.locator('#policy-match').dispatchEvent('change');
  await page.locator('[name="model-mode"]').selectOption('fixed');await page.locator('[name="model-value"]').fill('synthetic-approved-model');
  await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByText('Draft saved.',{exact:false}).waitFor();assert.equal(storeVersion,1);assert.equal(approved,false);
  await page.getByRole('button',{name:'Preview effective choices',exact:true}).click();await page.locator('#policy-preview').filter({hasText:'synthetic-model'}).waitFor();assert.equal(previewed,true);assert.equal(await page.locator('#policy-preview .model-observation-row').count(),3);assert.equal(await page.locator('#policy-preview pre').isVisible(),false);assert.equal(await page.locator('#policy-preview .model-observation-row').first().getByText('synthetic-model',{exact:true}).isVisible(),true);
  await page.getByRole('button',{name:'Approve this exact draft',exact:true}).click();await page.getByText('Exact draft approved.',{exact:false}).waitFor();assert.equal(approved,true);assert.equal(storeVersion,2);
  await page.evaluate(()=>document.documentElement.style.zoom='2');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.keyboard.press('Tab');assert.notEqual(await page.evaluate(()=>document.activeElement.tagName),'BODY');assert.deepEqual(errors,[]);
});

test('actual browser reviews exact storage plan, archives without deletion, and registers an explicitly selected project', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core');const {state,repo}=await setup(t);let reads=0,archives=0;
  const service=await startWorkspaceServer(state,{control:{actor:{agent_id:'synthetic',principal_id:'owner'},actions:['retention.archive','workspace.register']},hooks:{retention:{read:async()=>{reads++;return {version:0,stored_bytes:4096,archive_bytes:1024,release_bytes:0,roots:['.ai-org/host-usage'],preview:{sha256:'b'.repeat(64)},actions:[{action:'retention.archive',label:'Create a verified archive',payload:{preview_sha256:'b'.repeat(64)}}]};},execute:async request=>{archives++;assert.equal(request.payload.preview_sha256,'b'.repeat(64));return {released_bytes:0};}}}});t.after(()=>service.close());
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(service.url);await page.getByRole('link',{name:'Settings',exact:true}).click();await page.getByLabel('Project',{exact:true}).selectOption('alpha');
  assert.equal(reads,0);await page.getByRole('link',{name:'Storage',exact:true}).click();await page.getByRole('heading',{name:'Storage',exact:true}).waitFor();await page.getByText('4.0 KiB',{exact:true}).waitFor();assert.equal(reads,1);
  assert.equal(await page.getByText('0 B',{exact:true}).count(),1);await page.getByRole('button',{name:'Create a verified archive',exact:true}).click();await page.getByText('Host confirmed the request.',{exact:false}).waitFor();assert.equal(archives,1);
  await page.getByRole('link',{name:'Overview',exact:true}).click();assert.equal(reads,1);
  await removeWorkspaceProject(state,'alpha',{expectedVersion:2});await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('link',{name:/Register a project/}).click();await page.getByRole('heading',{name:'Register a project',exact:true}).waitFor();
  await page.locator('[name="name"]').fill('Explicit synthetic project');await page.locator('[name="id"]').fill('explicit');await page.locator('[name="task_root"]').fill(repo);await page.locator('[name="repo-path-0"]').fill(repo);
  await page.getByRole('button',{name:'Register project',exact:true}).click();await page.getByText('Host confirmed the request.',{exact:false}).waitFor();assert.equal((await readWorkspace(state)).projects[0].id,'explicit');assert.deepEqual(errors,[]);
});

test('actual browser displays synthetic recorded execution, bounded analysis and unconfirmed host cancellation', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core');const {state}=await setup(t);const measured=syntheticExecutionView();let cancelCalls=0;
  const sourceReader=async()=>({tasks:measured.tasks,complete:true,read_at:measured.read_at,project:{}});
  const service=await startWorkspaceServer(state,{readSnapshot:directory=>readWorkspaceSnapshot(directory,{snapshotReader:sourceReader}),control:{actor:{agent_id:'synthetic',principal_id:'owner'},actions:['autonomy.cancel']},hooks:{autonomy:{read:async()=>({version:0,enabled:true,state:'execution-recorded',jobs:[{id:'synthetic-running',task_id:'WK-synthetic',status:'running',reason:'Synthetic executing goal',direction:'quality'}],proposals:[{id:'synthetic-proposal',title:'Synthetic improvement proposal',direction:'quality',created_at:measured.read_at,line:7,evidence:[{path:'src/synthetic.mjs',sha256:'c'.repeat(64)}],scope:{read_paths:['src'],write_paths:['src']},budget:{max_attempts:1}}]}),execute:async request=>{assert.equal(request.payload.task_id,'WK-synthetic');cancelCalls++;return {cancellation:'requested-not-confirmed'};}}}});t.after(()=>service.close());
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(service.url);await page.getByRole('link',{name:'Work',exact:true}).click();await page.getByRole('link',{name:'Synthetic measured goal',exact:true}).click();await page.getByRole('tab',{name:'Execution',exact:true}).click();await page.getByRole('heading',{name:'Recorded work',exact:true}).waitFor();
  assert.equal(await page.locator('.operation-row').count(),3);await page.locator('.operation-row').filter({hasText:'Implementation'}).locator('summary').click();await page.getByText('requested-model',{exact:true}).waitFor();await page.getByText('selected-model',{exact:true}).waitFor();await page.getByText('reported-model',{exact:true}).waitFor();
  assert.equal(await page.locator('.operation-row').filter({hasText:'Implementation'}).locator('.model-observation-row').last().getByText('Not reported',{exact:true}).count(),1);
  for(const size of [{width:1280,height:800},{width:1440,height:900},{width:1920,height:1080},{width:720,height:600}]){await page.setViewportSize(size);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>document.documentElement.style.zoom='2');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.evaluate(()=>document.documentElement.style.zoom='1');
  const evidence=process.env.WORKKEEL_WORKSPACE_EVIDENCE_DIR;if(evidence){await fs.mkdir(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,'workspace-execution-synthetic-1440.png'),fullPage:true});}
  await page.getByRole('link',{name:'Analysis',exact:true}).click();await page.getByRole('heading',{name:'Recorded operation groups',exact:true}).waitFor();assert.equal(await page.locator('.analysis-row').count(),3);await page.locator('#analysis-model').selectOption('reported-model');await page.waitForFunction(()=>document.querySelectorAll('.analysis-row').length===1);assert.equal(await page.locator('.analysis-row').getByText('Implementation',{exact:true}).count(),1);
  if(evidence)await page.screenshot({path:path.join(evidence,'workspace-analysis-synthetic-1440.png'),fullPage:true});
  await page.goto(service.origin+'/?view=autonomy&project=alpha');await page.getByText('Execution recorded',{exact:true}).waitFor();await page.getByRole('button',{name:'Cancel this work',exact:true}).click();await page.getByText('Cancellation requested. The host has not confirmed stopping.',{exact:true}).waitFor();assert.equal(cancelCalls,1);
  assert.equal(await page.getByText('src/synthetic.mjs',{exact:true}).isVisible(),false);await page.getByText('Trigger evidence & scope',{exact:true}).click();await page.getByText('src/synthetic.mjs',{exact:true}).waitFor();assert.deepEqual(errors,[]);
});

test('actual browser narrows only approved model catalog and rejects disabling a fixed model', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core');const {state}=await setup(t);let drafts=0;
  const catalog=[{id:'synthetic-a',provider:'synthetic',model:'a',opaque:'source-a'},{id:'synthetic-b',provider:'synthetic',model:'b',opaque:'source-b'}];
  let policy={schema_version:'workkeel.model-policy/v1',id:'synthetic',version:1,project:{model:{mode:'fixed',value:'synthetic-a'},reasoning:{mode:'auto'},service:{mode:'auto'}},rules:[],models:catalog},entries=[];
  const service=await startWorkspaceServer(state,{control:{actor:{agent_id:'synthetic',principal_id:'owner'},actions:['policy.draft']},hooks:{policy:{read:async()=>({version:drafts,policy:policy.project,policy_document:policy,entries,capabilities:{model:catalog.map(model=>model.id),catalog,reasoning:[],service:[]}}),execute:async request=>{policy=request.payload.policy;assert.ok(policy.models.every(model=>catalog.some(allowed=>allowed.id===model.id&&allowed.opaque===model.opaque)));entries.push({policy,sha256:String(drafts+1).repeat(64),approval:null});drafts++;return {draft_saved:true};}}}});t.after(()=>service.close());
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:900}});await page.goto(service.url);await page.goto(service.origin+'/?view=settings&project=alpha');await page.getByText('Allowed models',{exact:false}).click();
  await page.locator('[name="allowed-model"][value="synthetic-a"]').uncheck();await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByText('A fixed model rule uses a disabled model.',{exact:false}).waitFor();assert.equal(drafts,0);
  await page.locator('[name="allowed-model"][value="synthetic-a"]').check();await page.locator('[name="allowed-model"][value="synthetic-b"]').uncheck();await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByText('Draft saved.',{exact:false}).waitFor();assert.equal(drafts,1);assert.deepEqual(policy.models.map(model=>model.id),['synthetic-a']);
  await page.getByText('Allowed models',{exact:false}).click();await page.locator('[name="allowed-model"][value="synthetic-b"]').check();await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#policy-form .actions .small')?.textContent==='Store version 2'&&document.querySelectorAll('[name="allowed-model"]:checked').length===2);assert.equal(drafts,2);
});

test('actual browser opts in and out of bounded improvement without starting inference', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core');const {state}=await setup(t);let writes=0,policy={enabled:false,directions:[],max_jobs:20,max_attempts:2,cooldown_ms:1001};
  const service=await startWorkspaceServer(state,{control:{actor:{agent_id:'synthetic',principal_id:'owner'},actions:['autonomy.policy']},hooks:{autonomy:{read:async()=>({version:writes,policy,enabled:policy.enabled,state:'idle',jobs:[],proposals:[]}),execute:async request=>{
    assert.equal(request.action,'autonomy.policy');assert.equal(request.expectedVersion,writes);assert.deepEqual(Object.keys(request.payload),['policy']);policy=request.payload.policy;writes++;return {policy_saved:true};
  }}}});t.after(()=>service.close());
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(service.url);await page.goto(service.origin+'/?view=autonomy&project=alpha');await page.getByRole('button',{name:'Save improvement policy',exact:true}).waitFor();
  await page.locator('[name="improvement-enabled"]').check();await page.getByRole('button',{name:'Save improvement policy',exact:true}).click();await page.getByText('Choose at least one improvement direction before enabling.',{exact:true}).waitFor();assert.equal(writes,0);
  await page.locator('[name="improvement-directions"]').fill('quality, reliability');await page.locator('[name="improvement-max-jobs"]').fill('3');await page.locator('[name="improvement-max-attempts"]').fill('1');await page.getByText('Scoped discovery & limits',{exact:true}).click();await page.locator('[name="discovery-enabled"]').check();await page.getByRole('button',{name:'Save improvement policy',exact:true}).click();await page.getByText('Bounded discovery requires explicit read and write scope.',{exact:true}).waitFor();assert.equal(writes,0);
  await page.locator('[name="discovery-read-paths"]').fill('../outside');await page.locator('[name="discovery-write-paths"]').fill('src');await page.getByRole('button',{name:'Save improvement policy',exact:true}).click();await page.getByText('Use normalized relative project paths.',{exact:true}).waitFor();assert.equal(writes,0);
  await page.locator('[name="discovery-read-paths"]').fill('src\ndocs');await page.locator('[name="discovery-max-proposals"]').fill('4');await page.locator('[name="discovery-max-rounds"]').fill('2');await page.locator('[name="discovery-max-source-bytes"]').fill('4096');await page.locator('[name="discovery-runtime"]').fill('1.001');await page.locator('[name="discovery-cost"]').fill('0.25');
  await page.getByRole('button',{name:'Save improvement policy',exact:true}).click();await page.getByText('Improvement policy saved. Activity is reported separately.',{exact:true}).waitFor();assert.equal(writes,1);assert.equal(policy.enabled,true);assert.deepEqual(policy.directions,['quality','reliability']);assert.equal(policy.cooldown_ms,1001);assert.equal(policy.max_jobs,3);assert.equal(policy.discovery.max_runtime_ms,1001);assert.equal(policy.discovery.max_cost_usd,0.25);assert.deepEqual(policy.discovery.read_paths,['src','docs']);assert.equal(await page.getByText('No improvement work has been created.',{exact:true}).count(),1);
  const evidence=process.env.WORKKEEL_WORKSPACE_EVIDENCE_DIR;if(evidence){await fs.mkdir(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,'workspace-autonomy-policy-synthetic-1440.png'),fullPage:true});}
  await page.locator('[name="improvement-enabled"]').uncheck();await page.getByRole('button',{name:'Save improvement policy',exact:true}).click();await page.getByRole('heading',{name:'Improvement disabled',exact:true}).waitFor();assert.equal(writes,2);assert.equal(policy.enabled,false);assert.equal(policy.discovery.enabled,true);assert.equal(await page.getByText('No improvement work has been created.',{exact:true}).count(),1);assert.deepEqual(errors,[]);
});
