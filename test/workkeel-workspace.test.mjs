import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {createMonitorFixture} from '../scripts/workkeel-monitor-fixture.mjs';
import {createWorkspace,readWorkspace,registerWorkspaceProject,removeWorkspaceProject,readWorkspaceSnapshot,projectWorkspaceAttention,inspectWorkspaceIntegration,workspaceAutonomySummary,workspaceExecutionRows,projectWorkspaceExecution,projectWorkspaceAnalysis,projectWorkspaceGoals} from '../src/workkeel-workspace.mjs';
import {startWorkspaceServer} from '../src/workkeel-workspace-server.mjs';
import {readMonitorSnapshot} from '../src/workkeel-monitor.mjs';
import {workspaceClient} from '../src/workkeel-workspace-ui.mjs';

test('workspace browser module parses before deployment',()=>{new vm.Script('async function parseOnly(){'+workspaceClient+'}');});

async function captureDesktop(page,name){const directory=process.env.WORKKEEL_WORKSPACE_EVIDENCE_DIR;if(!directory)return;await fs.mkdir(directory,{recursive:true});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(directory,name),fullPage:false});}

async function setup(t,{extended=false}={}) {
  const state=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'workkeel-workspace-state-')));
  const repo=await fs.realpath(await createMonitorFixture({extended}));
  t.after(()=>Promise.all([fs.rm(state,{recursive:true,force:true}),fs.rm(repo,{recursive:true,force:true})]));
  await createWorkspace(state,{id:'synthetic',name:'Synthetic workspace'});
  await registerWorkspaceProject(state,{id:'alpha',name:'Order service',task_root:repo,repositories:[{id:'service',path:repo}]},{expectedVersion:1});
  return {state,repo};
}
const projectInput=(repo,id)=>({id,name:id,task_root:repo,repositories:[{id:'service',path:repo}]});
function syntheticGoal(root,taskId='WK-synthetic'){
  const component=(id,componentRoot,depends_on=[])=>({id,project_id:id,repo_id:'service',root:componentRoot,task_id:id==='api'?taskId:'WK-'+id,read_status:'available',state:'done',accepted:true,candidate_revision:'a'.repeat(40),depends_on,progress:{phase:'accepted'}});
  return {id:'synthetic-goal',version:7,state:'running',status:'running',authority_status:'current',manifest:{title:'Synthetic three-repository delivery',integration:{component_id:'integration',criteria:['Verify the exact API, library and integration candidates together']},roles:{implementer:{agent_id:'builder',principal_id:'owner'},reviewer:{agent_id:'reviewer',principal_id:'qa'}},limits:{max_operations:20,timeout_ms:60000,max_cost_usd:null}},mandatory_components:[component('api',root),component('library','/synthetic/library'),component('integration','/synthetic/integration',['api','library'])],whole_acceptance:'not-accepted',accepted:false,component_set_sha256:'b'.repeat(64),integration:null,created_at:'2026-01-01T00:00:00Z',operations:[{id:'synthetic-role-op',kind:'runtime',status:'completed',at:'2026-01-01T00:00:00Z',input:{component_id:'api',phase:'planning',actor:{agent_id:'builder',principal_id:'owner'},model:{provider:'synthetic',model:'requested-model',reasoning:'high',service:'standard'}},result:{actor:{agent_id:'builder',principal_id:'owner'},thread_id:'synthetic-thread',runtime_selection:{provider:'synthetic',model:'reported-model',reasoning:'high',service:'standard'},usage:{input_tokens:20,output_tokens:10},model_called:true}}]};
}
test('mandatory goal projection separates whole acceptance, missing scope and truthful role observations',()=>{
  const raw=syntheticGoal('/synthetic/api'),registry={projects:['api','library','integration'].map(id=>({id,task_root:'/synthetic/'+id,repositories:[{id:'service',path:'/synthetic/'+id,scope:'.'}]}))};
  let goal=projectWorkspaceGoals([raw],registry,'api')[0];assert.equal(goal.acceptance,'not-accepted');assert.equal(goal.mandatory_components.filter(c=>c.accepted).length,3);assert.deepEqual(goal.mandatory_components[2].depends_on,['api','library']);assert.equal(goal.operations[0].tokens,30);assert.equal(goal.operations[0].reported_ms,null);assert.equal(goal.operations[0].requested.model,'requested-model');assert.equal(goal.operations[0].reported.model,'reported-model');
  const snapshot={goals:[goal],tasks:[],projects:registry.projects,read_at:'2026-01-01T00:00:00Z'};assert.equal(projectWorkspaceAnalysis(snapshot).coverage.recorded_operations,1);assert.equal(projectWorkspaceAnalysis(snapshot,{model:'reported-model'}).groups.items[0].tokens,30);
  raw.accepted=true;raw.whole_acceptance='accepted';raw.integration={candidate_set_sha256:'c'.repeat(64),pins:[]};assert.equal(projectWorkspaceGoals([raw],registry,'api')[0].accepted,true);
  raw.authority_status='unavailable';assert.equal(projectWorkspaceGoals([raw],registry,'api')[0].accepted,false);raw.accepted=false;raw.whole_acceptance='stale';assert.equal(projectWorkspaceGoals([raw],registry,'api')[0].acceptance,'stale');
  raw.integration=null;raw.whole_acceptance='not-accepted';goal=projectWorkspaceGoals([raw],{projects:registry.projects.slice(0,1)},'api')[0];assert.equal(goal.read_status,'partial');assert.equal(goal.mandatory_components[1].scope_status,'unregistered');assert.equal(goal.accepted,false);
  registry.projects[0].repositories[0].scope='src';assert.equal(projectWorkspaceGoals([raw],registry,'api')[0].mandatory_components[0].scope_status,'scope-unconfirmed');raw.mandatory_components[0].scope_paths=['src/api'];assert.equal(projectWorkspaceGoals([raw],registry,'api')[0].mandatory_components[0].scope_status,'registered');raw.mandatory_components[0].read_status='unavailable';assert.equal(projectWorkspaceGoals([raw],registry,'api')[0].accepted,false);
  raw.operations[0].result=null;goal=projectWorkspaceGoals([raw],registry,'api')[0];assert.equal(goal.operations[0].actor,null);assert.equal(goal.operations[0].requested_actor.agent_id,'builder');assert.equal(goal.operations[0].reported.model,null);assert.equal(goal.operations[0].tokens,null);
  raw.operations.push({id:'native-handoff',kind:'native',status:'completed',input:{component_id:'api',phase:'handoff',request:{operation_id:'actual-native-handoff',actor:{agent_id:'builder',principal_id:'owner'}}},result:{native:{task:{history:[{operation_id:'actual-native-handoff',actor:{agent_id:'builder',principal_id:'owner'}}]}}}});goal=projectWorkspaceGoals([raw],registry,'api')[0];assert.equal(goal.operations[1].activity_kind,'coordination');assert.equal(goal.operations[1].actor_source,'native-event');assert.equal(goal.operations[1].reported.model,null);assert.equal(goal.operations[1].tokens,null);
  const other={...goal,operations:[{...goal.operations[0],task_key:'other:WK-synthetic'}]};assert.equal(workspaceExecutionRows([], [goal,other]).length,3);
  raw.operations[0].timing={execution:{started_at:'2026-01-01T00:00:00Z',ended_at:'2026-01-01T00:00:00.100Z',duration_ms:100,basis:'goal-adapter-observed-wall-time',mode:'execute'},latest_observation:{duration_ms:999,mode:'reconcile'}};goal=projectWorkspaceGoals([raw],registry,'api')[0];assert.equal(goal.operations[0].reported_ms,100);assert.equal(goal.operations[0].end_at,'2026-01-01T00:00:00.100Z');assert.equal(goal.operations[0].time_source,'goal-adapter-observed-wall-time');assert.equal(goal.operations[0].tool,'unreported');assert.equal(goal.operations[0].requested_provider,'synthetic');
});
function syntheticExecutionView(){
  const actor={agent_id:'synthetic-builder',principal_id:'synthetic-owner'},at=n=>new Date(1700000000000+n).toISOString();
  const implementation={operation_id:'implement',node:'build-node',execution_id:'execute-build',activity_kind:'implementation',actor,state:'completed',requested_model:'requested-model',requested_reasoning:{value:'medium'},requested_service:'standard',selected_model:'selected-model',selected_reasoning:'high',selected_service:'priority',runtime_model:'reported-model',reported_reasoning:'low',reported_service:null,tool:'synthetic-host',usage:{input_tokens:100,output_tokens:0},result_recorded:true,coverage_complete:true,adapter_elapsed_ms:1000,execution_intervals:[{started_at:at(0),completed_at:at(1000)}]};
  const verification={operation_id:'verify',node:'test-node',activity_kind:'verification',state:'completed',runtime_model:null,tool:'synthetic-host',usage:{input_tokens:null,output_tokens:null},result_recorded:true,adapter_elapsed_ms:null,execution_intervals:[]};
  const review={operation_id:'review',node:'review-node',activity_kind:'review',state:'unconfirmed',requested_model:'requested-review',tool:'synthetic-review-host',usage:{input_tokens:0,output_tokens:0},result_recorded:true,coverage_complete:true,adapter_elapsed_ms:0,execution_intervals:[]};
  return {projects:[{id:'p',name:'Synthetic project',read_status:'available'}],read_at:at(2000),tasks:[{id:'WK-synthetic',key:'p:WK-synthetic',project_id:'p',title:'Synthetic measured goal',task_state:'build',read_status:'available',actor:{agent_id:'do-not-infer-this-claim',principal_id:'owner'},runs:[{run_id:'work',actor,operations:[implementation,verification,implementation]},{run_id:'review',operations:[review]}]}]};
}
test('one project owns three exact repositories and duplicate root-local IDs remain distinct',()=>{
  const roots=['/synthetic/api','/synthetic/library','/synthetic/integration'],project={id:'single',task_root:roots[0],repositories:roots.map((root,index)=>({id:['api','library','integration'][index],path:root,scope:'.'}))},registry={projects:[project]},raw=syntheticGoal(roots[0]);
  raw.mandatory_components.forEach((c,index)=>Object.assign(c,{project_id:'single',repo_id:project.repositories[index].id,task_id:'WK-same'}));raw.accepted=true;raw.whole_acceptance='accepted';raw.integration={candidate_set_sha256:'c'.repeat(64),pins:[]};
  const primary=projectWorkspaceGoals([raw],registry,'single',{snapshotTasks:[{key:'single:WK-same',task_root:roots[0]}]})[0],foreign=projectWorkspaceGoals([raw],registry,'single',{goalRoot:roots[1]})[0];
  assert.equal(primary.accepted,true);assert.equal(foreign.accepted,true);assert.equal(primary.key,'single:synthetic-goal');assert.equal(primary.reference_id,raw.id);assert.notEqual(primary.key,foreign.key);assert.notEqual(primary.reference_id,foreign.reference_id);assert.match(foreign.reference_id,/^[A-Za-z0-9._-]{1,95}$/);assert.equal(foreign.id,raw.id);assert.equal(foreign.root,roots[1]);assert.equal(foreign.repo_id,'library');assert.equal(new Set(primary.mandatory_components.map(c=>c.key)).size,3);assert.deepEqual(primary.mandatory_components.map(c=>c.task_view_available),[true,false,false]);assert.ok(primary.mandatory_components.every(c=>c.scope_status==='registered'));
  const alias={...project,id:'alias'};raw.mandatory_components[1].project_id='missing';assert.equal(projectWorkspaceGoals([raw],{projects:[project,alias]},'single')[0].mandatory_components[1].scope_status,'scope-ambiguous');raw.mandatory_components[1].project_id='single';assert.equal(projectWorkspaceGoals([raw],{projects:[project,alias]},'single')[0].mandatory_components[1].scope_status,'registered');
});
test('snapshot reads only explicit repository roots, isolates root failure and retains foreign goal references',async t=>{
  const {state,repo}=await setup(t),foreign=await fs.realpath(await createMonitorFixture());t.after(()=>fs.rm(foreign,{recursive:true,force:true}));await removeWorkspaceProject(state,'alpha',{expectedVersion:2});await registerWorkspaceProject(state,{id:'single',name:'Single multi-repo project',task_root:repo,repositories:[{id:'api',path:repo},{id:'library',path:foreign}]},{expectedVersion:3});
  const raw=syntheticGoal(repo);raw.mandatory_components=raw.mandatory_components.slice(0,2);raw.mandatory_components[0].project_id=raw.mandatory_components[1].project_id='single';raw.mandatory_components[0].repo_id='api';raw.mandatory_components[1].repo_id='library';raw.mandatory_components[1].root=foreign;const reads=[];
  const snapshot=await readWorkspaceSnapshot(state,{goalReader:async root=>{reads.push(root);return [structuredClone(raw)];}});assert.deepEqual(reads,[repo,foreign]);assert.equal(snapshot.goals.length,2);assert.equal(new Set(snapshot.goals.map(g=>g.key)).size,2);assert.equal(snapshot.goals[1].root,foreign);assert.equal(snapshot.goals[1].repo_id,'library');assert.equal(snapshot.model_calls,0);
  const partial=await readWorkspaceSnapshot(state,{goalReader:async root=>{if(root===repo)throw Error('Synthetic primary goal inventory failure');return [raw];}});assert.equal(partial.projects[0].goal_read_status,'partial');assert.equal(partial.goals[0].root,foreign);assert.equal(partial.projects[0].goal_roots[0].goal_count,null);assert.equal(partial.model_calls,0);
});

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

test('stalled goal recovery is actionable while automatic dependency waits and pauses stay quiet',()=>{
  const registry={projects:[{id:'api',read_status:'available',task_root:'/synthetic/api',repositories:[{id:'service',path:'/synthetic/api',scope:'.'}]}]},raw=syntheticGoal('/synthetic/api');
  raw.mandatory_components=[raw.mandatory_components[0]];raw.mandatory_components[0].state='build';raw.mandatory_components[0].accepted=false;raw.mandatory_components[0].progress={phase:'planning',last_error:'Fixed planning model unavailable'};
  let goal=projectWorkspaceGoals([raw],registry,'api')[0];assert.equal(goal.requires_recovery,true);assert.equal(goal.reason,'Fixed planning model unavailable');
  const other={...goal,id:'second',reference_id:'second',key:'api:second'},issues=projectWorkspaceAttention([],registry.projects,[goal,other]);
  assert.equal(issues.length,1);assert.equal(issues[0].kind,'goal-blocked');assert.equal(issues[0].affected_goals,2);assert.equal(issues[0].goals[0].id,goal.reference_id);
  raw.state='paused';raw.status='paused';goal=projectWorkspaceGoals([raw],registry,'api')[0];assert.equal(projectWorkspaceAttention([],registry.projects,[goal]).length,0);
  raw.status='running';raw.mandatory_components[0].progress.last_error=null;goal=projectWorkspaceGoals([raw],registry,'api')[0];assert.equal(goal.requires_recovery,false);assert.equal(projectWorkspaceAttention([],registry.projects,[goal]).length,0);
});

test('actual browser directs a stalled goal to recovery instead of the calm overview', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core'),{state,repo}=await setup(t);let blocked=true;
  const raw=syntheticGoal(repo);raw.mandatory_components=[{...raw.mandatory_components[0],project_id:'alpha',state:'build',accepted:false}];
  const service=await startWorkspaceServer(state,{readSnapshot:dir=>{raw.mandatory_components[0].progress={phase:'planning',last_error:blocked?'Fixed planning model unavailable':null};return readWorkspaceSnapshot(dir,{goalReader:async()=>[raw]});}});t.after(()=>service.close());
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.goto(service.url);await page.getByRole('heading',{name:'Delivery needs recovery',exact:true}).waitFor();
  assert.equal(await page.getByText('Nothing needs your decision right now.',{exact:true}).count(),0);
  await page.getByText('Delivery blocked · recovery required',{exact:true}).waitFor();await page.getByRole('link',{name:/^View goal/}).click();
  await page.getByRole('heading',{name:'Synthetic three-repository delivery',exact:true}).waitFor();await page.getByText('Fixed planning model unavailable',{exact:true}).waitFor();
  await page.getByRole('button',{name:'繁體中文',exact:true}).click();await page.getByRole('link',{name:'總覽',exact:true}).click();await page.getByRole('heading',{name:'交付需要恢復',exact:true}).waitFor();
  if(process.env.WORKKEEL_WORKSPACE_EVIDENCE_DIR){await fs.mkdir(process.env.WORKKEEL_WORKSPACE_EVIDENCE_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.WORKKEEL_WORKSPACE_EVIDENCE_DIR,'workspace-blocked-goal-synthetic-1440.png'),fullPage:true});}
  blocked=false;await page.getByRole('button',{name:'重新整理',exact:true}).click();await page.getByText('已啟用交付',{exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'交付需要恢復',exact:true}).count(),0,'resolving this goal removes only its decision; unrelated task decisions remain');
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
  await page.getByRole('tab',{name:'Timeline',exact:true}).click();await page.getByText('Task lifecycle & handoffs',{exact:true}).click();assert.ok(await page.locator('ol.timeline li').count()>0);
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
  await page.getByRole('button',{name:'繁體中文',exact:true}).click();assert.equal(await page.locator('[name="model-value"]').isVisible(),true);assert.equal(await page.locator('[name="model-value"]').isDisabled(),false);assert.equal(await page.locator('[name="model-value"]').inputValue(),'synthetic-approved-model');await page.getByRole('button',{name:'English',exact:true}).click();assert.equal(await page.locator('[name="reasoning-value"]').isVisible(),false);assert.equal(await page.locator('[name="service-value"]').isVisible(),false);
  await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByText('Draft saved.',{exact:false}).waitFor();assert.equal(storeVersion,1);assert.equal(approved,false);
  await page.getByRole('button',{name:'Preview effective choices',exact:true}).click();await page.locator('#policy-preview').filter({hasText:'synthetic-model'}).waitFor();assert.equal(previewed,true);await captureDesktop(page,'workspace-model-policy-desktop.png');const tops=await Promise.all(['model','reasoning','service'].map(async name=>(await page.locator('[name="'+name+'-mode"]').boundingBox()).y));assert.ok(Math.max(...tops)-Math.min(...tops)<2,'independent mode controls align on one row');assert.equal(await page.locator('#policy-preview .model-observation-row').count(),3);assert.equal(await page.locator('#policy-preview pre').isVisible(),false);assert.equal(await page.locator('#policy-preview .model-observation-row').first().getByText('synthetic-model',{exact:true}).isVisible(),true);
  await page.getByRole('button',{name:'Approve this exact draft',exact:true}).click();await page.getByText('Exact draft approved.',{exact:false}).waitFor();assert.equal(approved,true);assert.equal(storeVersion,2);
  await page.evaluate(()=>document.documentElement.style.zoom='2');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.keyboard.press('Tab');assert.notEqual(await page.evaluate(()=>document.activeElement.tagName),'BODY');assert.deepEqual(errors,[]);
});

test('actual browser reviews exact storage plan, archives without deletion, and registers an explicitly selected project', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core');const {state,repo}=await setup(t);let reads=0,archives=0;
  const service=await startWorkspaceServer(state,{control:{actor:{agent_id:'synthetic',principal_id:'owner'},actions:['retention.archive','workspace.register']},hooks:{retention:{read:async()=>{reads++;return {version:0,stored_scope:'host-measurements-only',protected_evidence:{available:true,bytes:8192,files:4,roots:['.ai-org/goals','.ai-org/artifacts'],scope:'configured-canonical-evidence-roots',release_bytes:0},stored_bytes:4096,archive_bytes:1024,release_bytes:0,roots:['.ai-org/host-usage'],preview:{sha256:'b'.repeat(64)},actions:[{action:'retention.archive',label:'Create a verified archive',payload:{preview_sha256:'b'.repeat(64)}}]};},execute:async request=>{archives++;assert.equal(request.payload.preview_sha256,'b'.repeat(64));return {released_bytes:0};}}}});t.after(()=>service.close());
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(service.url);await page.getByRole('link',{name:'Settings',exact:true}).click();await page.getByLabel('Project',{exact:true}).selectOption('alpha');
  assert.equal(reads,0);await page.getByRole('link',{name:'Storage',exact:true}).click();await page.getByRole('heading',{name:'Storage',exact:true}).waitFor();await page.getByText('4.0 KiB',{exact:true}).waitFor();assert.equal(reads,1);await page.getByText('Execution measurements',{exact:true}).waitFor();await page.getByRole('heading',{name:'Protected task & acceptance evidence',exact:true}).waitFor();await page.getByText('8.0 KiB',{exact:true}).waitFor();await page.getByText('2 configured evidence roots',{exact:true}).waitFor();assert.equal(await page.getByText('Currently stored',{exact:true}).count(),0);
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
  assert.equal(await page.locator('.operation-row').count(),3);await page.locator('.operation-row').filter({hasText:'Implementation'}).locator('summary').click();await page.getByText('requested-model',{exact:true}).waitFor();await page.getByText('selected-model',{exact:true}).waitFor();await page.locator('.operation-details').getByText('reported-model',{exact:true}).waitFor();
  assert.equal(await page.locator('.operation-row').filter({hasText:'Implementation'}).locator('.model-observation-row').last().getByText('Not reported',{exact:true}).count(),1);
  for(const size of [{width:1280,height:800},{width:1440,height:900},{width:1920,height:1080},{width:720,height:600}]){await page.setViewportSize(size);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>document.documentElement.style.zoom='2');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.evaluate(()=>document.documentElement.style.zoom='1');
  const evidence=process.env.WORKKEEL_WORKSPACE_EVIDENCE_DIR;if(evidence){await fs.mkdir(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,'workspace-execution-synthetic-1440.png'),fullPage:true});}
  await page.getByRole('link',{name:'Analysis',exact:true}).click();await page.getByText('Recorded operation groups',{exact:true}).waitFor();assert.equal(await page.locator('.ev-comparison svg').count(),1);await captureDesktop(page,'workspace-analysis-time-desktop.png');await page.locator('#analysis-metric').selectOption('tokens');assert.match(await page.locator('.ev-comparison').innerText(),/tokens/i);await captureDesktop(page,'workspace-analysis-tokens-desktop.png');await page.getByText('Recorded operation groups',{exact:true}).click();assert.equal(await page.locator('.analysis-row').count(),3);await page.locator('#analysis-model').selectOption('reported-model');await page.waitForFunction(()=>document.querySelectorAll('.analysis-row').length===1);assert.equal(await page.locator('.analysis-row').getByText('Implementation',{exact:true}).count(),1);
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

test('actual browser registers approved three-repo goal, checks components and controls exact goal versions', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core');const {state,repo}=await setup(t);const library=await fs.realpath(await createMonitorFixture()),integration=await fs.realpath(await createMonitorFixture());t.after(()=>Promise.all([fs.rm(library,{recursive:true,force:true}),fs.rm(integration,{recursive:true,force:true})]));
  await registerWorkspaceProject(state,projectInput(library,'library'),{expectedVersion:2});await registerWorkspaceProject(state,projectInput(integration,'integration'),{expectedVersion:3});
  const task=(await readMonitorSnapshot(repo)).tasks[0],raw=syntheticGoal(repo,task.id);raw.mandatory_components[1].root=library;raw.mandatory_components[2].root=integration;raw.mandatory_components[2].accepted=false;raw.mandatory_components[2].state='build';let registered=false,started=false,commands=[];
  const service=await startWorkspaceServer(state,{readSnapshot:directory=>readWorkspaceSnapshot(directory,{goalReader:async root=>root===repo&&registered?[raw]:[]}),control:{actor:{agent_id:'synthetic',principal_id:'owner'},actions:['goals.create','goals.start','goals.cancel']},hooks:{goals:{read:async()=>({version:0,entries:registered?[raw]:[],candidates:registered?[]:[{task_id:task.id,manifest_ref:'synthetic-approved-goal.json',title:raw.manifest.title,goal_id:raw.id,version:8,component_count:3,repository_count:3}],services:[{goal_id:raw.id,state:started?'running-in-this-host':'not-confirmed-in-this-host',errors:[]}]}),execute:async request=>{
    commands.push(request.action);if(request.action==='goals.create'){assert.equal(request.expectedVersion,8);assert.equal(request.payload.manifest_ref,'synthetic-approved-goal.json');registered=true;return {registered:true};}
    assert.equal(request.expectedVersion,raw.version);assert.deepEqual(request.payload,{goal_id:raw.id,repo_id:'service'});if(request.action==='goals.start')started=true;else raw.state=raw.status='cancel-requested';raw.version++;return {recorded:true};
  }}}});t.after(()=>service.close());const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(service.url);await page.goto(service.origin+'/?view=project&project=alpha');await page.getByRole('button',{name:'Register selected goal',exact:true}).waitFor();await page.getByRole('button',{name:'Register selected goal',exact:true}).click();await page.getByText('Approved goal registered.',{exact:false}).waitFor();assert.deepEqual(commands,['goals.create']);
  await page.getByRole('link',{name:raw.manifest.title,exact:true}).first().click();await page.getByRole('heading',{name:raw.manifest.title,exact:true}).waitFor();assert.equal(await page.locator('.task-key-metrics strong').first().textContent(),'2 / 3');assert.equal(await page.getByText('Whole goal accepted',{exact:true}).count(),0);assert.equal(await page.locator('.ev-dependencies g[tabindex="0"]').count(),3);await captureDesktop(page,'workspace-goal-flow-and-dependencies-desktop.png');if(process.env.WORKKEEL_WORKSPACE_EVIDENCE_DIR)await page.locator('.ev-dependencies').screenshot({path:path.join(process.env.WORKKEEL_WORKSPACE_EVIDENCE_DIR,'workspace-goal-dependency-diagram.png')});
  await page.getByRole('tab',{name:'Components & dependencies',exact:true}).click();await page.getByRole('heading',{name:'Required work & dependencies',exact:true}).waitFor();await page.getByText('Repository scope & exact candidates',{exact:true}).click();assert.equal(await page.locator('.ev-dependencies .ev-edge').count(),2);
  await page.getByRole('tab',{name:'Execution',exact:true}).click();await page.locator('.operation-row summary').click();await page.locator('.operation-details').getByText('reported-model',{exact:true}).waitFor();await page.getByRole('tab',{name:'Overview',exact:true}).click();await page.getByRole('button',{name:'Start delivery service',exact:true}).click();await page.getByText('Service active in this host',{exact:true}).waitFor();assert.equal(started,true);
  await page.getByText('More actions',{exact:true}).click();await page.getByRole('button',{name:'Request cancellation',exact:true}).click();await page.getByText('Cancellation requested. Check its recorded confirmation before treating work as stopped.',{exact:true}).waitFor();assert.equal(raw.status,'cancel-requested');assert.deepEqual(commands,['goals.create','goals.start','goals.cancel']);assert.deepEqual(errors,[]);
});

test('actual browser narrows sealed standing grant, saves null cost and separately starts the event service', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core');const {state,repo}=await setup(t);const beta=await fs.realpath(await createMonitorFixture());t.after(()=>fs.rm(beta,{recursive:true,force:true}));await registerWorkspaceProject(state,projectInput(beta,'beta'),{expectedVersion:2});const alphaGoal=syntheticGoal(repo),betaGoal=syntheticGoal(beta);alphaGoal.manifest.title='Alpha improvement with same identifier';betaGoal.manifest.title='Beta admitted improvement';let writes=0,starts=0,serviceActive=false,policy={enabled:false,directions:[],max_jobs:20,max_attempts:2,cooldown_ms:1001};
  const grant={enabled:true,directions:['quality','reliability'],read_paths:['src','docs'],write_paths:['src'],max_goals:3,max_total_operations:30,max_total_runtime_ms:90000,max_attempts:1,max_runtime_ms:1001,max_cost_usd:null,max_rounds:2,max_source_bytes:4096,cooldown_ms:1001};
  const service=await startWorkspaceServer(state,{readSnapshot:directory=>readWorkspaceSnapshot(directory,{goalReader:async root=>root===repo?[alphaGoal]:root===beta?[betaGoal]:[]}),control:{actor:{agent_id:'synthetic',principal_id:'owner'},actions:['autonomy.policy','autonomy.start-service','autonomy.pause']},hooks:{autonomy:{read:async()=>({version:writes,policy,enabled:policy.enabled,state:'idle',available_goals:[{id:'approved-standing',title:'Approved standing improvement',authority_current:true,grant},{id:'stale-standing',title:'Expired grant',authority_current:false,grant}],service:{state:serviceActive?'running-in-this-host':'not-confirmed-in-this-host',errors:[],last_step:null},admissions:serviceActive?[{id:'admission-synthetic',goal_id:betaGoal.id,root:beta,kind:'improvement',status:'committed',proposal_id:'proposal-synthetic',reservation:{max_runtime_ms:1001},error:null}]:[],jobs:[],proposals:[]}),execute:async request=>{
    assert.equal(request.expectedVersion,writes);assert.equal(request.payload.goal_id,'approved-standing');if(request.action==='autonomy.policy'){policy=request.payload.policy;writes++;assert.ok(policy.directions.every(d=>grant.directions.includes(d)));assert.equal(policy.discovery.max_cost_usd,null);return {policy_saved:true};}if(request.action==='autonomy.start-service'){starts++;serviceActive=true;return {state:'listening',model_called:false};}throw Error('Unexpected synthetic action');
  }}}});t.after(()=>service.close());const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(service.url);await page.goto(service.origin+'/?view=autonomy&project=alpha');await page.locator('#improvement-goal').selectOption('approved-standing');
  assert.equal(await page.locator('#improvement-goal option[value="stale-standing"]').evaluate(option=>option.disabled),true);assert.equal(await page.locator('[name="discovery-runtime"]').inputValue(),'1.001');assert.equal(await page.locator('[name="improvement-cooldown"]').inputValue(),'1.001');assert.equal(await page.locator('[name="discovery-cost"]').inputValue(),'');
  await page.locator('[name="improvement-enabled"]').check();await page.locator('[name="admission-enabled"]').check();await page.locator('[name="improvement-direction"][value="reliability"]').uncheck();await page.getByText('Scoped discovery & limits',{exact:true}).click();await page.locator('[name="discovery-enabled"]').check();await page.locator('[name="discovery-read-paths"]').fill('outside');await page.getByRole('button',{name:'Save improvement policy',exact:true}).click();await page.getByText('Keep directions and paths within the approved standing grant.',{exact:true}).waitFor();assert.equal(writes,0);
  await page.locator('[name="discovery-read-paths"]').fill('src/subdir');await page.getByRole('button',{name:'Save improvement policy',exact:true}).click();await page.getByText('Improvement policy saved. Activity is reported separately.',{exact:true}).waitFor();assert.equal(writes,1);assert.equal(starts,0);assert.deepEqual(policy.directions,['quality']);assert.equal(policy.discovery.max_runtime_ms,1001);assert.equal(policy.discovery.cooldown_ms,1001);assert.equal(policy.cooldown_ms,1001);assert.equal(policy.admission.enabled,true);assert.equal(policy.discovery.max_cost_usd,null);
  await page.getByRole('button',{name:'Start approved event service',exact:true}).click();await page.getByText('Service active in this host',{exact:true}).waitFor();assert.equal(starts,1);const admitted=page.getByRole('link',{name:'Beta admitted improvement',exact:true});await admitted.waitFor();assert.ok((await admitted.getAttribute('href')).includes('project=beta'));assert.ok(!(await admitted.getAttribute('href')).includes('project=alpha'));await page.getByText('Source & reservation',{exact:true}).click();await page.getByText('1.001 s',{exact:true}).waitFor();
  const evidence=process.env.WORKKEEL_WORKSPACE_EVIDENCE_DIR;if(evidence){await fs.mkdir(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,'workspace-standing-grant-synthetic-1440.png'),fullPage:true});}
  await page.locator('[name="improvement-enabled"]').uncheck();await page.getByRole('button',{name:'Save improvement policy',exact:true}).click();await page.getByRole('heading',{name:'Improvement disabled',exact:true}).waitFor();assert.equal(writes,2);assert.equal(starts,1);assert.equal(policy.enabled,false);assert.deepEqual(errors,[]);
});

test('late goal-control reads never overwrite another settings view', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core');const {state}=await setup(t);let release;const held=new Promise(resolve=>release=resolve);
  const service=await startWorkspaceServer(state,{hooks:{goals:{read:async()=>{await held;return {version:0,entries:[],candidates:[],services:[]};}},policy:{read:async()=>({version:9,policy:{model:{mode:'auto'},reasoning:{mode:'auto'},service:{mode:'auto'}},capabilities:{model:[],reasoning:[],service:[]}})}}});t.after(()=>service.close());const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.goto(service.url);await page.getByRole('link',{name:'Order service',exact:true}).click();await page.getByRole('heading',{name:'Order service',exact:true}).waitFor();await page.getByRole('link',{name:'Model policy',exact:true}).click();await page.getByText('Store version 9',{exact:true}).waitFor();
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/goals');release();await (await response).json();await page.evaluate(()=>new Promise(requestAnimationFrame));assert.equal(await page.getByText('Store version 9',{exact:true}).count(),1);assert.equal(await page.getByRole('heading',{name:'Model policy',exact:true}).count(),1);
});

test('actual learning settings distinguish evaluated and active states while disclosing reasons', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core'),{state}=await setup(t);
  const entries=[['candidate','Awaiting evaluation'],['evaluated','Evaluated'],['active','Active'],['review-required','Revalidation required']].map(([effective_state,title],index)=>({id:'synthetic-'+index,title,effective_state,reasons:[{code:'Synthetic exact evidence needs inspection'}],candidate:{request:{trigger:'When the approved project condition applies'}}}));
  const service=await startWorkspaceServer(state,{hooks:{learning:{read:async()=>({version:0,entries,actions:[]})}}});t.after(()=>service.close());
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(service.url);await page.goto(service.origin+'/?view=learning&project=alpha');await page.getByRole('heading',{name:'Skills from project learning',exact:true}).waitFor();assert.equal(await page.locator('.delivery-row').count(),4);assert.equal(await page.getByText('Synthetic exact evidence needs inspection',{exact:true}).first().isVisible(),false);assert.equal(await page.locator('.delivery-row .badge').filter({hasText:/^Active$/}).count(),1);
  await captureDesktop(page,'workspace-learning-states-desktop.png');await page.getByText('Why this state',{exact:true}).first().focus();await page.keyboard.press('Enter');assert.equal(await page.getByText('Synthetic exact evidence needs inspection',{exact:true}).first().isVisible(),true);
  await page.getByRole('button',{name:'繁體中文',exact:true}).click();await page.getByRole('heading',{name:'專案學習形成的 Skills',exact:true}).waitFor();assert.equal(await page.locator('.delivery-row .badge').filter({hasText:/^已啟用$/}).count(),1);await captureDesktop(page,'workspace-learning-states-zh-TW.png');
  await page.locator('#theme').click();await page.locator('#theme').click();await captureDesktop(page,'workspace-learning-states-dark.png');await page.evaluate(()=>document.body.style.zoom='2');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
});

test('storage separates protected evidence from missing measurements and bounded inventory uncertainty', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core');const {state}=await setup(t);let limited=false;
  const service=await startWorkspaceServer(state,{hooks:{retention:{read:async()=>({available:!limited,version:0,stored_scope:'host-measurements-only',stored_bytes:null,archive_bytes:null,release_bytes:0,roots:[],actions:[],protected_evidence:limited?{available:false,bytes:null,files:null,roots:['.ai-org/goals'],scope:'configured-canonical-evidence-roots',release_bytes:0,reason:'Synthetic inventory byte limit reached'}:{available:true,bytes:16384,files:7,roots:['.ai-org/goals'],scope:'configured-canonical-evidence-roots',release_bytes:0}})}}});t.after(()=>service.close());const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:900}});await page.goto(service.url);await page.goto(service.origin+'/?view=storage&project=alpha');await page.getByText('Execution measurements',{exact:true}).waitFor();await page.getByText('16.0 KiB',{exact:true}).waitFor();await page.getByText('7 files',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Create a verified archive',exact:true}).count(),0);
  limited=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByText('Stored evidence size is unknown.',{exact:true}).waitFor();await page.getByText('Synthetic inventory byte limit reached',{exact:true}).waitFor();assert.equal(await page.getByText('16.0 KiB',{exact:true}).count(),0);assert.equal(await page.getByText('0 files',{exact:false}).count(),0);
});

test('single-project multi-repo browser separates duplicate goal routes and permits stopping a known partial goal', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core');const {state,repo}=await setup(t),library=await fs.realpath(await createMonitorFixture()),integration=await fs.realpath(await createMonitorFixture());t.after(()=>Promise.all([fs.rm(library,{recursive:true,force:true}),fs.rm(integration,{recursive:true,force:true})]));
  await removeWorkspaceProject(state,'alpha',{expectedVersion:2});await registerWorkspaceProject(state,{id:'single',name:'One project · three repos',task_root:repo,repositories:[{id:'api',path:repo},{id:'library',path:library},{id:'integration',path:integration}]},{expectedVersion:3});
  const taskId=(await readMonitorSnapshot(repo)).tasks[0].id,primary=syntheticGoal(repo,taskId);primary.manifest.title='Primary-root delivery';primary.mandatory_components.forEach((c,index)=>Object.assign(c,{project_id:'single',repo_id:['api','library','integration'][index],root:[repo,library,integration][index],task_id:taskId}));const foreign=structuredClone(primary);foreign.manifest.title='Library-root delivery';foreign.operations[0].input.component_id='library';const commands=[];
  const service=await startWorkspaceServer(state,{readSnapshot:directory=>readWorkspaceSnapshot(directory,{goalReader:async root=>root===repo?[primary]:root===library?[foreign]:[]}),control:{actor:{agent_id:'synthetic',principal_id:'owner'},actions:['goals.start','goals.pause','goals.cancel','goals.resume','goals.recover']},hooks:{goals:{read:async()=>({version:0,entries:[primary,foreign],candidates:[],services:[{goal_id:primary.id,root:repo,repo_id:'api',state:'not-confirmed-in-this-host',errors:[]},{goal_id:foreign.id,root:library,repo_id:'library',state:'not-confirmed-in-this-host',errors:[]}]}),execute:async request=>{
    const goal=request.payload.repo_id==='api'?primary:foreign;assert.equal(request.payload.goal_id,primary.id);assert.ok(['api','library'].includes(request.payload.repo_id));assert.equal(request.expectedVersion,goal.version);commands.push([request.action,request.payload.repo_id]);if(request.action==='goals.cancel')goal.state=goal.status='cancel-requested';goal.version++;return {recorded:true};
  }}}});t.after(()=>service.close());const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(service.url);await page.goto(service.origin+'/?view=project&project=single');await page.getByRole('link',{name:'Library-root delivery',exact:true}).first().waitFor();const primaryLink=await page.getByRole('link',{name:'Primary-root delivery',exact:true}).first().getAttribute('href'),foreignLink=await page.getByRole('link',{name:'Library-root delivery',exact:true}).first().getAttribute('href');assert.notEqual(primaryLink,foreignLink);
  await page.getByRole('link',{name:'Primary-root delivery',exact:true}).first().click();await page.getByRole('button',{name:'Start delivery service',exact:true}).click();await page.getByText('Goal control recorded.',{exact:true}).waitFor();await page.getByRole('tab',{name:'Components & dependencies',exact:true}).click();await page.getByText('Repository scope & exact candidates',{exact:true}).click();assert.equal(await page.locator('.dependency-list > li').count(),3);assert.equal(await page.locator('.dependency-list a').count(),1);
  await page.goto(service.origin+'/'+foreignLink);await page.getByRole('heading',{name:'Library-root delivery',exact:true}).waitFor();await page.getByRole('button',{name:'Start delivery service',exact:true}).click();await page.getByText('Goal control recorded.',{exact:true}).waitFor();assert.deepEqual(commands,[['goals.start','api'],['goals.start','library']]);
  foreign.authority_status='unavailable';foreign.mandatory_components[1].read_status='unavailable';foreign.mandatory_components[1].reason='Synthetic component authority drift';await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByText('Required scope or evidence unavailable',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Start delivery service',exact:true}).isDisabled(),true);await page.getByText('More actions',{exact:true}).click();assert.equal(await page.getByRole('button',{name:'Pause delivery',exact:true}).isDisabled(),false);assert.equal(await page.getByRole('button',{name:'Request cancellation',exact:true}).isDisabled(),false);
  await page.getByRole('button',{name:'Request cancellation',exact:true}).click();await page.getByText('Cancellation requested. Check its recorded confirmation before treating work as stopped.',{exact:true}).waitFor();assert.deepEqual(commands.at(-1),['goals.cancel','library']);assert.equal(foreign.status,'cancel-requested');assert.equal(await page.getByText('Stopped',{exact:true}).count(),0);
  await page.getByRole('tab',{name:'Integration evidence',exact:true}).click();assert.equal(await page.getByRole('button',{name:'History & resources',exact:true}).count(),0);assert.deepEqual(errors,[]);
});
