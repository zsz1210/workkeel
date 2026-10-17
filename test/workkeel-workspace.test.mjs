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
import {workspaceWorkSummary} from '../src/workkeel-workspace.mjs';

test('observatory keeps actual outcomes and lifecycle visible without telemetry, and excludes unavailable acceptance',()=>{
  const task={id:'WK-result',key:'alpha:WK-result',project_id:'alpha',title:'A delivered result',read_status:'available',task_state:'done',updated_at:'2026-01-02T00:00:00Z',quality:{locally_accepted:true,review_judgment:'pass'},delivery:{summary:'Search now preserves filters'},review:{summary:'Independently checked'},timeline:[{action:'close',at:'2026-01-02T00:00:00Z',actor:{agent_id:'owner'},reason:'Accepted'}]};
  const result=workspaceWorkSummary([task,{...task,id:'WK-stale',key:'alpha:WK-stale',read_status:'stale'}]);
  assert.equal(result.accepted,1);assert.equal(result.unavailable,1);assert.equal(result.recorded_operations,0);assert.equal(result.activity.length,1);assert.equal(result.outcomes[0].summary,'Search now preserves filters');assert.equal(result.outcomes[0].review,'Independently checked');
  const row={key:'op-one',task_key:task.key,task_title:task.title,project_id:'alpha',read_status:'available',last_observed_at:'2026-01-01T12:00:00Z',activity_kind:'review',state:'completed',reported:{model:null},requested:{model:'selected-only'},tokens:42,tokens_complete:false,reported_ms:null};
  const withUsage=workspaceWorkSummary([task],[row]);assert.equal(withUsage.reported_tokens,1);assert.equal(withUsage.measured_tokens,0);assert.equal(withUsage.activity[1].model,null);assert.equal(withUsage.activity[1].requested_model,'selected-only');
  const cancelled={...task,id:'WK-cancelled',key:'alpha:WK-cancelled',task_state:'cancelled',quality:{locally_accepted:false},updated_at:'2026-01-03T00:00:00Z',timeline:[{action:'cancel',at:'2026-01-03T00:00:00Z'}]};
  const history=workspaceWorkSummary([cancelled,task]);assert.deepEqual(history.outcomes.map(result=>result.task_id),[task.id]);assert.equal(history.activity[0].action,'cancel');
});

test('project overview prioritizes current goals and accepted results over cancelled history', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core'),{state}=await setup(t,{extended:true});let recovery=false;
  const service=await startWorkspaceServer(state,{readSnapshot:async directory=>{
    const snapshot=await readWorkspaceSnapshot(directory),base={project_id:'alpha',read_status:'available',mandatory_components:[],operations:[]};
    snapshot.goals=[{...base,id:'cancelled',title:'Cancelled predecessor',state:'cancelled',created_at:'2026-01-04T00:00:00Z'},{...base,id:'accepted-old',title:'Accepted source',state:'done',accepted:true,acceptance:'accepted',created_at:'2026-01-02T00:00:00Z'},{...base,id:'accepted-new',title:'Accepted discovery',state:'done',accepted:true,acceptance:'accepted',created_at:'2026-01-03T00:00:00Z'}];
    if(recovery)snapshot.goals.push({...base,id:'recovery',title:'Recovery first',state:'blocked',requires_recovery:true,created_at:'2026-01-01T00:00:00Z'});
    return snapshot;
  }});t.after(()=>service.close());
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage();page.setDefaultTimeout(8000);
  await page.goto(service.url);await page.goto(service.origin+'/?view=project&project=alpha');await page.locator('.project-goal').first().waitFor();
  assert.deepEqual(await page.locator('.project-goal-heading h3').allTextContents(),['Accepted discovery','Accepted source']);assert.equal(await page.locator('.work-facts').getByText('open tasks',{exact:true}).isVisible(),true);
  recovery=true;await page.reload();await page.getByRole('heading',{name:'Recovery first',exact:true}).waitFor();assert.deepEqual(await page.locator('.project-goal-heading h3').allTextContents(),['Recovery first','Accepted discovery']);
  await page.getByRole('link',{name:/All goals/}).click();await page.getByRole('link',{name:'Cancelled predecessor',exact:true}).waitFor();
});

test('observatory browser shows real lifecycle results, learning records and autonomy readiness without empty goals', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core'),{state}=await setup(t,{extended:true});
  const service=await startWorkspaceServer(state,{hooks:{learning:{read:async()=>({entries:[],lessons:[{id:'lesson-one',title:'Retain useful work',summary:'Show outcomes even when timing is absent',effective_state:'candidate',applicability:'Task views',exclusions:'Not a global instruction'}],lesson_status:'available',retrospectives:[{at:'2026-01-01T00:00:00Z',request:{summary:'A recorded inspection'}}],actions:[]})},autonomy:{read:async()=>({version:0,enabled:false,policy:{enabled:false,directions:[],max_jobs:20,max_attempts:2,cooldown_ms:1000},available_goals:[],service:{state:'not-confirmed-in-this-host'},jobs:[],admissions:[],proposals:[]})}}});t.after(()=>service.close());
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(8000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(service.url);await page.getByRole('heading',{name:'Your workspace',exact:true}).waitFor();
  await page.goto(service.origin+'/?view=project&project=alpha');await page.getByRole('heading',{name:'Recent activity',exact:true}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'Delivery goals',exact:true}).count(),0);
  assert.ok(await page.locator('.work-feed a').count()>0);assert.ok(await page.locator('.outcome-cards article').count()>0);
  const snapshot=await readWorkspaceSnapshot(state),completed=snapshot.tasks.find(task=>task.quality?.locally_accepted);
  await page.goto(service.origin+'/?view=task&project=alpha&task='+completed.id);await page.getByText('Delivered result',{exact:true}).waitFor();assert.ok((await page.locator('.outcome-summary').innerText()).includes(completed.delivery.summary));
  await page.getByRole('tab',{name:'Timeline',exact:true}).click();assert.equal(await page.locator('.timeline').isVisible(),true);
  await page.goto(service.origin+'/?view=learning&project=alpha');await page.getByRole('heading',{name:'Retain useful work',exact:true}).waitFor();assert.equal(await page.getByText('Awaiting review',{exact:true}).isVisible(),true);assert.equal(await page.getByRole('heading',{name:'Skills',exact:true}).isVisible(),true);
  await page.goto(service.origin+'/?view=autonomy&project=alpha');await page.locator('[data-autonomy-state=unconfigured]').waitFor();assert.equal(await page.getByText(/View only/).isVisible(),true);assert.equal(await page.locator('#autonomy-form').isVisible(),false);assert.equal(await page.getByRole('heading',{name:'Request a plan change',exact:true}).isVisible(),true);
  await page.goto(service.origin+'/?view=analysis&project=alpha');await page.getByRole('heading',{name:'Usage & outcomes',exact:true}).waitFor();assert.equal(await page.locator('#analysis-project').count(),0);await page.getByRole('button',{name:'Switch project',exact:true}).click();const allProjects=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/analysis'&&new URL(response.url()).searchParams.get('project')==='all');await page.locator('[data-project-select=""]').click();await allProjects;await page.locator('#analysis-project').waitFor();assert.equal(await page.locator('#analysis-project').inputValue(),'all');
  for(const view of ['project','learning','autonomy']){await page.goto(service.origin+'/?view='+view+'&project=alpha');await page.waitForFunction(()=>!document.getElementById('content').innerText.includes('Reading project'));await page.evaluate(()=>document.body.style.zoom='2');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  assert.deepEqual(errors,[]);
});

test('observatory browser refreshes service-only changes, keeps read-only scope open and handles a fresh capability link', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core'),{state}=await setup(t);let live=false,reads=0;
  const service=await startWorkspaceServer(state,{hooks:{autonomy:{read:async()=>{reads++;return {version:0,enabled:true,policy:{enabled:true,directions:['quality'],max_jobs:20,max_attempts:2,cooldown_ms:1000,admission:{enabled:true,goal_id:'approved'}},available_goals:[{id:'approved',title:'Approved scope',authority_current:true,grant:{enabled:true,directions:['quality'],max_goals:20,max_attempts:2,read_paths:['src'],write_paths:['src']}}],service:{state:live?'running-in-this-host':'not-confirmed-in-this-host'},jobs:[],admissions:[],proposals:[]};}}}});t.after(()=>service.close());
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage();page.setDefaultTimeout(8000);
  await page.addInitScript(()=>{const original=window.setInterval;window.setInterval=(fn,ms)=>original(fn,ms===15000?200:ms);});
  await page.goto(service.url);await page.getByRole('heading',{name:'Your workspace',exact:true}).waitFor();await page.goto(service.origin+'/?view=autonomy&project=alpha');await page.locator('[data-autonomy-state=ready]').waitFor();
  live=true;await page.locator('[data-autonomy-state=waiting]').waitFor();
  await page.locator('#autonomy-settings>summary').click();const before=reads;await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,500)));assert.equal(await page.locator('#autonomy-settings').getAttribute('open'),'');assert.equal(await page.locator('#autonomy-settings input,#autonomy-settings select').count(),0);assert.ok(reads>before,'read-only scope does not stop live observations');
  const token=new URL(service.url).hash.slice(1).split('/')[0];await page.evaluate(()=>sessionStorage.setItem('workkeel-workspace-capability','a'.repeat(64)));await page.reload();await page.getByText(/This access link has expired/).first().waitFor();
  await page.goto(service.origin+'/?view=autonomy&project=alpha#'+token);await page.locator('[data-autonomy-state=waiting]').waitFor();
  await page.getByRole('link',{name:'Skip to content',exact:true}).focus();await page.keyboard.press('Enter');await page.reload();await page.locator('[data-autonomy-state=waiting]').waitFor();
});

test('native improvement goals and stop limits are visible instead of an idle service claim', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core'),{state,repo}=await setup(t);let phase='running';
  const service=await startWorkspaceServer(state,{readSnapshot:async directory=>{
    const snapshot=await readWorkspaceSnapshot(directory);if(!['intake-recovery','unavailable'].includes(phase))snapshot.goals.push({id:'derived',root:repo,state:phase==='running'?'running':phase==='recovery'?'recovery-required':'done',accepted:phase==='accepted',historically_accepted:phase==='stale-accepted',reason:phase==='recovery'?'Exact host failure needs reconciliation':null,project_id:'alpha',title:'Synthetic admitted inspection',read_status:'available'});return snapshot;
  },hooks:{autonomy:{read:async()=>({version:0,enabled:true,policy:{enabled:true,directions:['quality'],max_jobs:3,max_attempts:1,cooldown_ms:1000,admission:{enabled:true,goal_id:'approved'}},available_goals:[{id:'approved',title:'Approved scope',authority_current:true,grant:{enabled:true,directions:['quality'],max_goals:3,max_attempts:1,read_paths:['src'],write_paths:['src']}}],service:{state:'running-in-this-host',errors:[],last_step:{idle:phase==='running'?null:phase,...(phase==='discovery-round-budget'?{rounds_used:1,rounds_limit:1}:{})}},jobs:[],admissions:[{goal_id:'derived',root:repo,status:phase==='intake-recovery'?'recovery-required':'created',error:phase==='intake-recovery'?'An active task holds overlapping write roots':null,kind:'discovery'}],proposals:[]})}}});t.after(()=>service.close());
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage();page.setDefaultTimeout(8000);
  await page.goto(service.url);await page.goto(service.origin+'/?view=autonomy&project=alpha');await page.locator('[data-autonomy-state=recorded]').waitFor();
  assert.equal(await page.getByText('Listening for the next improvement',{exact:true}).count(),0);
  for(const [idle,state]of [['accepted','waiting'],['stale-accepted','waiting'],['unavailable','unknown-work'],['intake-recovery','blocked'],['recovery','blocked'],['discovery-round-budget','limited'],['source-goal-awaiting-acceptance','baseline-review'],['derived-goal-needs-attention','blocked'],['unchanged-approved-sources','waiting']]){
    phase=idle;await page.reload();await page.locator('[data-autonomy-state='+state+']').waitFor();
    if(idle==='discovery-round-budget'){assert.equal(await page.getByRole('heading',{name:'This discovery allowance is used up',exact:true}).isVisible(),true);await page.locator('#autonomy-status-details summary').focus();await page.keyboard.press('Enter');assert.match(await page.locator('[data-autonomy-state=limited]').innerText(),/Completed or reserved rounds: 1 \/ 1/);}
    if(['accepted','stale-accepted','unavailable'].includes(idle)){assert.equal(await page.locator('.journey-current').getByText({accepted:'Exploration accepted','stale-accepted':'Previously accepted · needs recheck',unavailable:'Details unavailable'}[idle],{exact:true}).isVisible(),true);}
    if(idle==='intake-recovery')assert.equal(await page.locator('[data-autonomy-attention]').getByText('An active task holds overlapping write roots',{exact:true}).isVisible(),true);
    if(idle==='recovery'){const attention=page.locator('[data-autonomy-attention]');assert.equal(await attention.getByText('Exact host failure needs reconciliation',{exact:true}).isVisible(),true);assert.equal(await attention.getByRole('link',{name:'Synthetic admitted inspection'}).getAttribute('href'),'?view=goal&project=alpha&task=derived');}
    if(idle==='derived-goal-needs-attention')assert.equal(await page.locator('[data-autonomy-attention]').getByText(/latest result and required decision/).isVisible(),true);
  }
});

test('autonomy live status explains unchanged inputs, pending checks and stale observations without starting work', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1',timeout:45000},async t=>{
 const {chromium}=await import('playwright-core'),{state,repo}=await setup(t);let phase='waiting',observedAt=new Date().toISOString(),reads=0,writes=0;
 const service=await startWorkspaceServer(state,{hooks:{autonomy:{read:async()=>{reads++;return {version:0,enabled:true,policy:{enabled:true,directions:['quality'],max_jobs:7,max_attempts:1,cooldown_ms:1000,admission:{enabled:true,goal_id:'approved'},discovery:{enabled:true,max_rounds:5,read_paths:['src'],write_paths:['src'],max_proposals:2,max_source_bytes:1000,cooldown_ms:1000,max_runtime_ms:1000,max_cost_usd:null}},available_goals:[{id:'approved',title:'Approved scope',authority_current:true,grant:{enabled:true,directions:['quality'],max_goals:7,max_attempts:1,read_paths:['src'],write_paths:['src']}}],service:{state:'running-in-this-host',activity:phase==='checking'?'checking':'listening',current_check_started_at:phase==='checking'?observedAt:null,observed_at:observedAt,check_interval_ms:30000,errors:phase==='failed'?['Synthetic connection failure']:[],last_step:{idle:'unchanged-approved-sources',at:'2026-10-16T01:00:00.000Z',rounds_used:3,rounds_limit:5}},watch_scope:{repositories:[{id:'core',root:repo+'/separate-working-copy'}],source_refs:['src/view.mjs']},jobs:[],admissions:[],proposals:[]};},execute:async()=>{writes++;throw Error('Unexpected write');}}}});
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(async()=>{await browser.close();await service.close();});const page=await browser.newPage({viewport:{width:1440,height:1000},colorScheme:'dark',reducedMotion:'reduce'});page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{localStorage.setItem('workkeel-workspace-theme','dark');const original=window.setInterval;window.setInterval=(fn,ms)=>original(fn,ms===15000?200:ms);});
 await page.goto(service.url);await page.goto(service.origin+'/?view=autonomy&project=alpha');await page.locator('[data-autonomy-state=waiting]').waitFor();
 assert.equal(await page.getByRole('heading',{name:'Service started · standing by',exact:true}).isVisible(),true);assert.equal(await page.locator('#autonomy-status-details').getAttribute('open'),null);await page.locator('#autonomy-status-details summary').focus();await page.keyboard.press('Enter');assert.match(await page.locator('.autonomy-now').innerText(),/previously explored input/);assert.match(await page.locator('.autonomy-next').innerText(),/Other working copies do not trigger/);assert.match(await page.locator('.journey-totals').innerText(),/3 \/ 5/);assert.match(await page.locator('.autonomy-observation').textContent(),/Checks every 30 seconds/);assert.equal(await page.locator('.autonomy-watch strong').textContent(),'separate-working-copy');
 const evidence=process.env.WORKKEEL_WORKSPACE_EVIDENCE_DIR;if(evidence)await fs.mkdir(evidence,{recursive:true});
 for(const width of [1440,1280]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);if(evidence)await page.screenshot({path:path.join(evidence,'autonomy-waiting-'+width+'.png')});}
 phase='checking';await page.locator('[data-autonomy-state=checking]').waitFor();assert.equal(await page.locator('.autonomy-now').getByText(/previously explored input/).count(),0);assert.match(await page.locator('.autonomy-observation').textContent(),/Current check started/);if(evidence)await page.screenshot({path:path.join(evidence,'autonomy-checking-1280.png')});
 phase='failed';await page.locator('[data-autonomy-state=blocked]').waitFor();assert.equal(await page.getByText('Synthetic connection failure',{exact:true}).isVisible(),true);
 phase='waiting';observedAt='2000-01-01T00:00:00Z';await page.locator('[data-autonomy-state=waiting]').waitFor();await page.getByText(/No recent service observation/).waitFor();
 observedAt=new Date().toISOString();await page.locator('#autonomy-settings>summary').click();const before=reads;await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,400)));assert.ok(reads>before);assert.equal(await page.locator('#autonomy-settings').getAttribute('open'),'');assert.equal(await page.locator('#autonomy-settings input').count(),0);
 assert.equal(writes,0);assert.deepEqual(errors,[]);
});

test('autonomy exposes blocked result collection even when service listens and goal detail is unavailable', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
 const {chromium}=await import('playwright-core'),{state,repo}=await setup(t);let recovered=false;
 const reason='Screenshot evidence could not be collected';
 const service=await startWorkspaceServer(state,{hooks:{autonomy:{read:async()=>({version:0,enabled:true,state:recovered?'idle':'needs-reconciliation',policy:{enabled:true,admission:{enabled:true,goal_id:'approved'}},available_goals:[{id:'approved',title:'Approved desktop scope',authority_current:true,grant:{enabled:true}}],service:{state:'running-in-this-host',activity:'listening',errors:[],observed_at:new Date().toISOString(),last_step:{idle:null,goal_id:'discovery-four',progressed:false}},jobs:[],admissions:recovered?[]:[{id:'four',goal_id:'discovery-four',root:repo,kind:'discovery',status:'created'}],needs_attention:recovered?[]:[{goal_id:'discovery-four',root:repo,operation_id:'collect-result',phase:'implementation',reason}],proposals:[]})}}});
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(async()=>{await browser.close();await service.close();});
 const page=await browser.newPage({viewport:{width:1440,height:1000},colorScheme:'dark',reducedMotion:'reduce'});page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('workkeel-workspace-theme','dark'));
 await page.goto(service.url);await page.goto(service.origin+'/?view=autonomy&project=alpha');await page.locator('[data-autonomy-state=blocked]').waitFor();
 assert.equal(await page.getByRole('heading',{name:'Improvement needs attention',exact:true}).isVisible(),true);
 await page.getByRole('button',{name:'View what needs attention',exact:true}).click();assert.equal(await page.getByText(reason,{exact:true}).isVisible(),true);
 assert.equal(await page.getByText('Stopped during: Implementation',{exact:true}).isVisible(),true);
 assert.equal(await page.locator('[data-autonomy-state=waiting]').count(),0);assert.equal(await page.locator('[data-control="autonomy.start-service"]').count(),0);
 const evidence=process.env.WORKKEEL_WORKSPACE_EVIDENCE_DIR;if(evidence)await fs.mkdir(evidence,{recursive:true});
 await page.getByRole('button',{name:'繁體中文',exact:true}).click();await page.getByRole('heading',{name:'改善工作需要處理',exact:true}).waitFor();
 assert.equal(await page.getByText('停在：實作',{exact:true}).isVisible(),true);
 for(const width of [1440,1280]){await page.setViewportSize({width,height:1000});await page.evaluate(async()=>{window.scrollTo(0,0);await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);if(evidence)await page.screenshot({path:path.join(evidence,'autonomy-result-blocked-'+width+'.png'),fullPage:false});}
 recovered=true;await page.reload();await page.locator('[data-autonomy-state=waiting]').waitFor();assert.equal(await page.getByText(reason,{exact:true}).count(),0);assert.deepEqual(errors,[]);
});

test('a late autonomy response preserves focused read-only disclosure', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
 const {chromium}=await import('playwright-core'),{state}=await setup(t);let reads=0,release,notify;
 const pending=new Promise(resolve=>notify=resolve),gate=new Promise(resolve=>release=resolve);
 const service=await startWorkspaceServer(state,{hooks:{autonomy:{read:async()=>{if(++reads===2){notify();await gate;}return {version:0,enabled:true,policy:{enabled:true,directions:['quality'],max_jobs:7,max_attempts:1,cooldown_ms:1000,admission:{enabled:true,goal_id:'approved'}},available_goals:[{id:'approved',title:'Approved scope',authority_current:true,grant:{enabled:true,directions:['quality'],max_goals:7,max_attempts:1,read_paths:['src'],write_paths:['src']}}],service:{state:'running-in-this-host',observed_at:new Date().toISOString()},jobs:[],admissions:[],proposals:[]};}}}});
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(async()=>{release();await browser.close();await service.close();});const page=await browser.newPage();page.setDefaultTimeout(8000);
 await page.addInitScript(()=>{const real=setInterval;window.setInterval=(fn,ms)=>real(fn,ms===15000?400:ms);});await page.goto(service.url);await page.goto(service.origin+'/?view=autonomy&project=alpha');await page.locator('[data-autonomy-state=waiting]').waitFor();await page.locator('#autonomy-settings>summary').click();await pending;
 const input=page.locator('#autonomy-settings>summary');await input.focus();const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/autonomy');release();await response;await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,200)));
 assert.equal(await input.evaluate(node=>node===document.activeElement),true);assert.equal(await page.locator('#autonomy-settings').getAttribute('open'),'');assert.match(await page.locator('[data-autonomy-freshness]').innerText(),/Refreshes every 15 seconds/);
});

test('workspace browser module parses before deployment',()=>{new vm.Script('async function parseOnly(){'+workspaceClient+'}');});

test('autonomy holds pending and unresolved controls across observation refreshes', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
 const {chromium}=await import('playwright-core'),{state}=await setup(t);let reads=0,release,requested,posts=0;
 const gate=new Promise(resolve=>release=resolve),pending=new Promise(resolve=>requested=resolve);
 const service=await startWorkspaceServer(state,{control:{actor:{agent_id:'synthetic',principal_id:'owner'},actions:['autonomy.start-service','autonomy.policy']},hooks:{autonomy:{read:async()=>({version:0,enabled:true,policy:{enabled:true,admission:{enabled:true,goal_id:'approved'}},available_goals:[{id:'approved',title:'Synthetic plan',authority_current:true,grant:{enabled:true}}],service:{state:'not-confirmed-in-this-host',observed_at:new Date().toISOString(),read_sequence:++reads},jobs:[],admissions:[],proposals:[]}),execute:async()=>{throw Error('No real control should execute');}}}});t.after(()=>service.close());
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(async()=>{release();await browser.close();});const page=await browser.newPage();page.setDefaultTimeout(8000);await page.addInitScript(()=>{const real=setInterval;window.setInterval=(fn,ms)=>real(fn,ms===15000?200:ms);});
 await page.route('**/api/autonomy',async route=>{posts++;requested();await gate;await route.fulfill({json:{status:'pending',result:null}});});
 await page.goto(service.url);await page.goto(service.origin+'/?view=autonomy&project=alpha');await page.locator('[data-autonomy-state=ready]').waitFor();
 await page.getByRole('button',{name:'Start improvement service',exact:true}).click();await pending;const before=reads;await page.waitForFunction(()=>document.getElementById('service-result')?.textContent.includes('awaiting confirmation'));await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,500)));
 assert.ok(reads>before);assert.equal(await page.locator('#autonomy-simple-control').isDisabled(),true);assert.match(await page.locator('#service-result').innerText(),/awaiting confirmation/);assert.equal(posts,1);
 release();await page.getByText(/outcome needs reconciliation/).waitFor();await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,400)));assert.equal(await page.locator('#autonomy-simple-control').isDisabled(),true);assert.match(await page.locator('#service-result').innerText(),/Do not submit it again/);assert.equal(posts,1);
});

test('autonomy journey binds exact roots, rejects partial records and separates exploration from current acceptance',()=>{
 const source=workspaceClient.slice(workspaceClient.indexOf('function autonomyJourney('),workspaceClient.indexOf('\nfunction journeyOutcome('));
 const project=vm.runInNewContext(source+';autonomyJourney;');
 const base={project_id:'alpha',root:'/alpha',read_status:'available',operations:[]};
 const goals=[
  {...base,id:'discovery',state:'done',accepted:true},
  {...base,id:'accepted',state:'done',accepted:true},
  {...base,id:'historical',state:'review-required',historically_accepted:true,requires_recovery:true,operations:[{activity_kind:'verification',state:'failed'}]},
  {...base,id:'cancelled',state:'cancelled',requires_recovery:true},
  {...base,id:'partial',state:'done',accepted:true,read_status:'partial'},
  {...base,id:'running',state:'running',created_at:'2000-01-01',operations:[{activity_kind:'verification',state:'running'},{activity_kind:'coordination',state:'running'}]},
  {...base,id:'shared',state:'done',accepted:true},
  {...base,id:'shared',root:'/beta',project_id:'beta',state:'running'}
 ];
 const admissions=goals.filter(g=>!(g.id==='shared'&&g.root==='/alpha')).map(g=>({goal_id:g.id,root:g.root,kind:g.id==='discovery'?'discovery':'execution'}));
 admissions.push({goal_id:'shared',root:'/wrong',kind:'execution'});
 const before=JSON.stringify({admissions,goals});const result=project(admissions,goals,'alpha');
 assert.equal(result.counts.acceptedImprovements,1);assert.equal(result.counts.discoveries,1);assert.equal(result.counts.historicalImprovements,1);assert.equal(result.counts.attention,0);assert.equal(result.counts.unknown,2);assert.equal(result.counts.unknownImprovements,2);
 assert.equal(result.rows.find(r=>r.admission.goal_id==='historical').category,'historical');
 assert.equal(result.rows.find(r=>r.admission.root==='/beta').goal.project_id,'beta');
 assert.equal(result.rows.find(r=>r.admission.goal_id==='running').operations.length,1);assert.equal(JSON.stringify({admissions,goals}),before);
 const lots=Array.from({length:20},(_,i)=>({...base,id:'old-'+i,state:'cancelled',created_at:'2026-01-01'}));
 const bounded=project([...lots.map(g=>({goal_id:g.id,root:g.root})),{goal_id:'running',root:'/alpha'}],[...lots,goals[5]],'alpha');
 assert.equal(bounded.rows.length,12);assert.equal(bounded.total,21);assert.equal(bounded.current.goal.id,'running');
 const ambiguous=project([{goal_id:'accepted',root:'/alpha'}],[goals[1],{...goals[1]}],'alpha');assert.equal(ambiguous.counts.acceptedImprovements,0);assert.equal(ambiguous.rows[0].goal,null);
});

test('autonomy workflow shows observed stages, truthful model metrics and historical results', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
 const {chromium}=await import('playwright-core'),{state,repo}=await setup(t);let phase='running';
 const operations=[{activity_kind:'planning',state:'completed',reported_ms:12000,tokens:800,tokens_complete:true,tool:'codex',reported:{model:'synthetic-gpt'}},{activity_kind:'implementation',state:'completed',reported_ms:20000,tokens:1500,tokens_complete:true,tool:'claude-code',reported:{model:'synthetic-claude'}},{activity_kind:'verification',state:'running',reported_ms:null,tokens:200,tokens_complete:false,tool:'codex',reported:{model:null}}];
 const service=await startWorkspaceServer(state,{readSnapshot:async directory=>({...await readWorkspaceSnapshot(directory),goals:[{id:'derived',root:repo,project_id:'alpha',read_status:'available',title:'Synthetic search improvement',state:phase==='historical'?'review-required':['failed','blocked'].includes(phase)?'blocked':phase==='paused'?'paused':'running',requires_recovery:phase==='blocked',historically_accepted:phase==='historical',accepted:false,operations:operations.map(op=>({...op,read_status:phase==='stale-operation'?'stale':'available',state:op.activity_kind==='verification'&&phase==='failed'?'failed':op.state}))}]}),hooks:{autonomy:{read:async()=>({version:0,enabled:true,policy:{enabled:true,admission:{enabled:true,goal_id:'approved'}},available_goals:[{id:'approved',title:'Synthetic plan',authority_current:true,grant:{enabled:true}}],service:{state:'running-in-this-host',observed_at:new Date().toISOString()},jobs:[],admissions:[{goal_id:'derived',root:repo,kind:'execution',status:'created'}],proposals:[]})}}});t.after(()=>service.close());
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage({colorScheme:'dark',reducedMotion:'reduce'});page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>localStorage.setItem('workkeel-workspace-theme','dark'));
 await page.goto(service.url);await page.goto(service.origin+'/?view=autonomy&project=alpha');await page.locator('.journey-current').waitFor();
 const stage=kind=>page.locator('.journey-current [data-stage="'+kind+'"]');assert.equal(await stage('verification').getAttribute('data-stage-state'),'active');assert.equal(await stage('independent-review').getAttribute('data-stage-state'),'unrecorded');assert.equal(await stage('acceptance').getAttribute('data-stage-state'),'unrecorded');
 await page.locator('.journey-current .journey-operation-details>summary').click();assert.equal(await page.locator('.journey-operations').getByText('synthetic-claude',{exact:true}).isVisible(),true);assert.equal(await page.locator('.journey-operations').getByText('Tokens incomplete',{exact:true}).isVisible(),true);assert.equal(await page.locator('.journey-operations').getByText('Model not reported',{exact:true}).isVisible(),true);
 const evidence=process.env.WORKKEEL_WORKSPACE_EVIDENCE_DIR;if(evidence)await fs.mkdir(evidence,{recursive:true});
 assert.equal(await page.locator('.journey-operations [data-tool="claude-code"] img[data-official-tool]').count(),1);
 for(const width of [1440,1280]){await page.setViewportSize({width,height:1000});await page.evaluate(()=>{window.scrollTo(0,0);return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);if(evidence)await page.screenshot({path:path.join(evidence,'autonomy-active-'+width+'.png')});}
 phase='failed';await page.reload();await page.locator('[data-autonomy-state=blocked]').waitFor();assert.equal(await stage('verification').getAttribute('data-stage-state'),'attention');if(evidence)await page.screenshot({path:path.join(evidence,'autonomy-blocked-1280.png')});
 phase='blocked';await page.reload();await page.locator('[data-autonomy-state=blocked]').waitFor();assert.equal(await stage('verification').getAttribute('data-stage-state'),'unknown');
 phase='stale-operation';await page.reload();await page.locator('.journey-current').waitFor();assert.equal(await stage('verification').getAttribute('data-stage-state'),'unknown');assert.equal(await page.locator('.journey-outcome').innerText(),'Verification · Unconfirmed');
 phase='paused';await page.reload();await page.locator('.journey-current').waitFor();assert.equal(await stage('verification').getAttribute('data-stage-state'),'unknown');assert.equal(await page.locator('.journey-outcome').innerText(),'Paused');
 phase='historical';await page.reload();await page.getByText('Previously accepted · needs recheck',{exact:true}).waitFor();assert.equal(await stage('acceptance').getAttribute('data-stage-state'),'historical');assert.equal(await stage('verification').getAttribute('data-stage-state'),'unknown');assert.equal(await page.getByRole('heading',{name:'Latest recorded outcome',exact:true}).isVisible(),true);
 const historicalMap=page.locator('.journey-history-map');assert.equal(await historicalMap.getAttribute('open'),null);assert.equal(await historicalMap.locator('.signal-scene').isVisible(),false);
 await historicalMap.locator('summary').first().focus();await page.keyboard.press('Enter');assert.equal(await historicalMap.locator('.signal-scene').isVisible(),true);assert.equal(await historicalMap.locator('.signal-packet').count(),0);await page.keyboard.press('Enter');assert.equal(await historicalMap.locator('.signal-scene').isVisible(),false);
 if(evidence)await page.screenshot({path:path.join(evidence,'autonomy-historical-1280.png')});assert.deepEqual(errors,[]);
});

test('live collaboration motion follows fresh parallel work, expires without polling and respects reduced motion', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
 const {chromium}=await import('playwright-core'),{state,repo}=await setup(t);let phase='running',observedAt=new Date().toISOString();
 const service=await startWorkspaceServer(state,{readSnapshot:async directory=>({...await readWorkspaceSnapshot(directory),goals:[{id:'signal',root:repo,project_id:'alpha',read_status:'available',title:'Synthetic checkout improvement',state:phase==='paused'?'paused':phase==='blocked'?'blocked':'running',requires_recovery:phase==='blocked',accepted:false,operations:[
  {activity_kind:'planning',state:'completed',tool:'codex',reported:{model:'synthetic-planner'},reported_ms:18000,time_complete:true,tokens:1200,tokens_complete:true},
  ...['implementation','verification'].map((activity_kind,i)=>({activity_kind,state:'running',tool:i?'codex':'claude-code',read_status:phase==='partial'?'stale':'available',last_observed_at:observedAt,reported:{model:i?'synthetic-verifier':'synthetic-builder'},reported_ms:i?null:42000,time_complete:false,tokens:i?null:2400,tokens_complete:false}))
 ]}]}),hooks:{autonomy:{read:async()=>({version:0,enabled:true,policy:{enabled:true,admission:{enabled:true,goal_id:'approved'}},available_goals:[{id:'approved',title:'Synthetic UI demonstration · no models called',authority_current:true,grant:{enabled:true}}],service:{state:'running-in-this-host',observed_at:new Date().toISOString()},jobs:[],admissions:[{goal_id:'signal',root:repo,kind:'execution',status:'created'}],proposals:[]})}}});t.after(()=>service.close());
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const evidence=process.env.WORKKEEL_WORKSPACE_EVIDENCE_DIR;if(evidence)await fs.mkdir(evidence,{recursive:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'dark',reducedMotion:'no-preference',...(evidence?{recordVideo:{dir:path.join(evidence,'motion'),size:{width:1440,height:1000}}}:{})});
 await context.addInitScript(()=>{localStorage.setItem('workkeel-workspace-theme','dark');const interval=window.setInterval;window.setInterval=(fn,ms)=>interval(fn,ms===15000?600000:ms);});
 const page=await context.newPage();page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(service.url);await page.goto(service.origin+'/?view=autonomy&project=alpha');await page.locator('.signal-scene[data-live=true]').waitFor();
 assert.equal(await page.locator('.signal-packet').count(),2);assert.equal(await page.locator('.signal-lane[data-live=true]').count(),2);
 const packet=page.locator('.signal-packet').first();assert.equal(await packet.evaluate(n=>getComputedStyle(n).animationName),'execution-signal');
 const start=await packet.evaluate(n=>getComputedStyle(n).strokeDashoffset);await page.evaluate(()=>new Promise(r=>setTimeout(r,180)));assert.notEqual(await packet.evaluate(n=>getComputedStyle(n).strokeDashoffset),start);
 assert.equal(await page.locator('.signal-measure[aria-label="Recorded time: Time not reported"]').innerText(),'—');assert.equal(await page.locator('.signal-measure[aria-label="Reported tokens: Tokens not reported"]').innerText(),'— tokens');assert.equal(await page.locator('.signal-lanes [data-tool="claude-code"] img[data-official-tool]').count(),1);
 for(const width of [1440,1280]){
  const capture=await context.newPage();await capture.setViewportSize({width,height:1000});await capture.goto(service.url);await capture.goto(service.origin+'/?view=autonomy&project=alpha');await capture.locator('.signal-scene[data-live=true]').waitFor();await capture.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  assert.equal(await capture.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const bottom=await capture.locator('.signal-composition').evaluate(n=>n.getBoundingClientRect().bottom);assert.ok(bottom<1000,'Execution map should fit in the initial desktop viewport');
  if(evidence)await capture.screenshot({path:path.join(evidence,'signal-active-'+width+'.png')});await capture.close();
 }
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await packet.evaluate(n=>getComputedStyle(n).display),'none');assert.equal(await page.locator('.signal-lane[data-live=true]').count(),2);await page.emulateMedia({reducedMotion:'no-preference'});
 // Browser visibility changes must stop existing motion immediately.
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});assert.equal(await page.locator('.signal-packet').count(),0);
 await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await page.locator('.signal-packet').first().waitFor({state:'attached'});
 for(const next of ['paused','blocked','partial']){phase=next;await page.reload();await page.locator('.signal-scene[data-live=false]').waitFor();assert.equal(await page.locator('.signal-packet').count(),0);}
 phase='running';observedAt=new Date(Date.now()-56000).toISOString();await page.reload();await page.locator('.signal-packet').first().waitFor({state:'attached'});await page.locator('.signal-scene[data-live=false]').waitFor({timeout:7000});assert.equal(await page.locator('.signal-packet').count(),0);assert.match(await page.locator('.signal-lanes').innerText(),/Awaiting a fresh report/);
 observedAt=new Date().toISOString();await page.reload();await page.locator('.signal-packet').first().waitFor({state:'attached'});await page.route('**/api/workspace',r=>r.abort());await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.locator('#connection.error').waitFor();assert.equal(await page.locator('.signal-packet').count(),0);assert.deepEqual(errors,[]);
 await context.close();
});

test('autonomy next steps preserve controls, reveal detail and recover from unknown state', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
 const {chromium}=await import('playwright-core'),{state,repo}=await setup(t);let phase='first',hookUnavailable=false;const writes=[];
 const policy={enabled:true,directions:['quality'],max_jobs:3,max_attempts:1,cooldown_ms:1000,admission:{enabled:true,goal_id:'approved'}};
 const service=await startWorkspaceServer(state,{readSnapshot:async directory=>({...await readWorkspaceSnapshot(directory),goals:phase==='running'?[{id:'active',root:repo,state:'running',project_id:'alpha',title:'Synthetic active work',read_status:'available'},{id:'past',root:repo,state:'cancelled',project_id:'alpha',title:'Synthetic cancelled work',read_status:'available'}]:[]}),control:{actor:{agent_id:'synthetic',principal_id:'owner'},actions:['autonomy.start-service','autonomy.pause','autonomy.resume','autonomy.policy']},hooks:{autonomy:{read:async()=>{
  if(hookUnavailable)throw Error('Synthetic unavailable source');
  return {version:0,enabled:phase!=='first',paused:phase==='paused',policy,available_goals:['first','missing'].includes(phase)?[]:[{id:'approved',title:'Approved scope',authority_current:phase!=='expired',grant:{enabled:true,directions:['quality'],max_goals:3,max_attempts:1,read_paths:['src'],write_paths:['src']}}],service:{state:phase==='running'?'running-in-this-host':'not-confirmed-in-this-host',errors:phase==='blocked'?['Synthetic host failure']:[]},jobs:phase==='legacy-review'?[{id:'awaiting',task_id:'WK-synthetic',status:'awaiting-acceptance',reason:'Synthetic result to review'}]:[],admissions:phase==='running'?[{goal_id:'past',root:repo,status:'created'},{goal_id:'active',root:repo,status:'created'}]:[],proposals:[]};
 },execute:async request=>{writes.push(request.action);return {confirmed:true};}}}});t.after(()=>service.close());
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1280,height:1000}});page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(service.url);await page.goto(service.origin+'/?view=autonomy&project=alpha');await page.locator('[data-autonomy-state=unconfigured]').waitFor();
 assert.equal(await page.locator('#autonomy-setup').getAttribute('open'),null);await page.getByRole('button',{name:'See how to get started',exact:true}).click();assert.equal(await page.locator('#autonomy-setup').getAttribute('open'),'');assert.equal(await page.locator('#autonomy-setup>summary').evaluate(node=>node===document.activeElement),true);
 await page.getByRole('button',{name:'View scope',exact:true}).click();assert.equal(await page.locator('#autonomy-settings').getAttribute('open'),'');assert.equal(await page.locator('#autonomy-settings>summary').evaluate(node=>node===document.activeElement),true);
 for(const expired of ['expired','missing']){phase=expired;await page.reload();await page.locator('[data-autonomy-state=unconfigured]').waitFor();assert.equal(await page.getByRole('heading',{name:'Choose what Workkeel may improve',exact:true}).isVisible(),true);assert.equal(await page.getByText('Allowed within scope',{exact:true}).count(),0);assert.equal(await page.locator('[data-control="autonomy.start-service"]').count(),0);}
 phase='running';await page.reload();await page.locator('[data-autonomy-state=recorded]').waitFor();await page.getByRole('button',{name:'View current work',exact:true}).click();assert.equal(await page.locator('#autonomy-work').evaluate(node=>node===document.activeElement),true);assert.equal(await page.getByRole('heading',{name:'Synthetic active work',exact:true}).isVisible(),true);assert.equal(await page.getByRole('heading',{name:'Synthetic cancelled work',exact:true}).isVisible(),false);
 assert.equal(await page.getByRole('button',{name:'Pause new execution',exact:true}).isEnabled(),true);await page.getByRole('button',{name:'Pause new execution',exact:true}).click();await page.getByText('Host confirmed the request. Reload to inspect effective canonical state.',{exact:true}).waitFor();assert.deepEqual(writes,['autonomy.pause']);
 phase='legacy-review';await page.reload();await page.locator('[data-autonomy-state=review]').waitFor();await page.getByRole('button',{name:'View results to review',exact:true}).click();assert.equal(await page.locator('#autonomy-jobs>summary').evaluate(node=>node===document.activeElement),true);assert.equal(await page.getByRole('heading',{name:'Synthetic result to review',exact:true}).isVisible(),true);
 phase='paused';await page.reload();await page.locator('[data-autonomy-state=paused]').waitFor();assert.equal(await page.getByRole('button',{name:'Resume new execution',exact:true}).isEnabled(),true);
 assert.equal(await page.locator('.autonomy-next').getByText('Choose “Resume new execution” when you want to continue.',{exact:true}).isVisible(),true);
 const readOnly=await browser.newPage({viewport:{width:1440,height:1000},colorScheme:'dark',reducedMotion:'reduce'});readOnly.on('pageerror',error=>errors.push(error.message));
 await readOnly.addInitScript(()=>localStorage.setItem('workkeel-workspace-theme','dark'));
 await readOnly.goto(service.origin+'/?view=autonomy&project=alpha#'+new URL(service.url).hash.slice(1).split('/')[0]);await readOnly.locator('[data-autonomy-state=paused]').waitFor();
 assert.equal(await readOnly.getByText('Ask your Agent to check the execution connection.',{exact:true}).isVisible(),true);assert.equal(await readOnly.locator('[data-control="autonomy.resume"]').count(),0);
 await readOnly.getByRole('button',{name:'繁體中文',exact:true}).click();assert.equal(await readOnly.getByText('請與 Agent 核對執行連線。',{exact:true}).isVisible(),true);await readOnly.locator('#autonomy-status-details summary').click();assert.ok((await readOnly.locator('.autonomy-now').innerText()).includes('此連線無法恢復執行。'));
 for(const width of [1440,1280]){await readOnly.setViewportSize({width,height:1000});await readOnly.evaluate(async()=>{scrollTo(0,0);await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});assert.equal(await readOnly.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await captureDesktop(readOnly,'autonomy-paused-readonly-'+width+'.png');}
 await readOnly.close();assert.deepEqual(writes,['autonomy.pause']);
 phase='blocked';await page.reload();await page.locator('[data-autonomy-state=blocked]').waitFor();assert.equal(await page.locator('[data-control="autonomy.start-service"]').count(),0);await page.locator('#autonomy-attention>summary').click();await page.getByRole('button',{name:'View what needs attention',exact:true}).click();assert.equal(await page.getByText('Synthetic host failure',{exact:true}).isVisible(),true);
 hookUnavailable=true;await page.reload();await page.locator('[data-autonomy-state=unavailable]').waitFor();assert.equal(await page.locator('[data-control]').count(),0);assert.equal(await page.getByText('Synthetic unavailable source',{exact:true}).isVisible(),false);await page.getByText('Connection details',{exact:true}).click();assert.equal(await page.getByText('Synthetic unavailable source',{exact:true}).isVisible(),true);
 hookUnavailable=false;phase='ready';await page.getByRole('button',{name:'Retry connection',exact:true}).click();await page.locator('[data-autonomy-state=ready]').waitFor();
 await page.route('**/api/workspace',route=>route.abort('failed'));await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.locator('[data-autonomy-state=unavailable]').waitFor();assert.equal(await page.locator('[data-control]').count(),0);
 await page.unroute('**/api/workspace');await page.getByRole('button',{name:'Retry connection',exact:true}).click();await page.locator('[data-autonomy-state=ready]').waitFor();assert.equal(await page.getByRole('button',{name:'Start improvement service',exact:true}).isEnabled(),true);
 const box=await page.locator('.autonomy-summary').boundingBox();assert.ok(box.height<500,'status and next action fit the first desktop viewport');await page.evaluate(()=>document.body.style.zoom='2');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);assert.deepEqual(writes,['autonomy.pause'],'opening guidance and retrying state must not start work');
});


test('terminal goal browser foregrounds records while active recovery remains actionable', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
 const {chromium}=await import('playwright-core'),{state,repo}=await setup(t);
 const goal={id:'finished',title:'Synthetic finished delivery',project_id:'alpha',root:repo,repo_id:'service',version:1,read_status:'available',authority_status:'current',state:'done',accepted:true,acceptance:'accepted',mandatory_components:[],criteria:['Preserve the result'],operations:[]};
 const service=await startWorkspaceServer(state,{readSnapshot:async directory=>({...await readWorkspaceSnapshot(directory),goals:[goal]}),control:{actor:{agent_id:'synthetic',principal_id:'owner'},actions:['goals.start','goals.pause','goals.recover','goals.cancel']},hooks:{goals:{read:async()=>({services:[]})}}});t.after(()=>service.close());
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage();page.setDefaultTimeout(8000);await page.goto(service.url);
 const visit=async()=>{await page.goto(service.origin+'/?view=goal&project=alpha&task=finished');await page.locator('.task-situation').waitFor();};
 await visit();assert.equal(await page.locator('.task-situation strong').innerText(),'Whole goal accepted');assert.equal(await page.locator('[data-goal-action]').count(),0);assert.equal(await page.getByText('Service not confirmed in this host',{exact:true}).count(),0);
 await page.getByRole('button',{name:'View acceptance record',exact:true}).click();await page.getByRole('heading',{name:'Exact integration acceptance',exact:true}).waitFor();
 Object.assign(goal,{state:'cancelled',accepted:false,acceptance:'not-accepted',requires_recovery:true,reason:'Retained historical error',mandatory_components:[{id:'source',review_judgment:'fail',depends_on:[]}]});
 await visit();assert.equal(await page.locator('.task-situation strong').innerText(),'Cancelled');assert.equal(await page.locator('[data-goal-action]').count(),0);assert.equal(await page.getByText('Delivery needs reconciliation before new work can continue.',{exact:true}).count(),0);
 await page.getByRole('button',{name:'View retained records',exact:true}).click();await page.getByRole('heading',{name:'Exact integration acceptance',exact:true}).waitFor();
 Object.assign(goal,{state:'done',acceptance:'stale',historically_accepted:true,requires_recovery:false});await visit();assert.match(await page.locator('.task-situation strong').innerText(),/Historical acceptance/);assert.equal(await page.locator('[data-goal-action]').count(),0);
 Object.assign(goal,{state:'blocked',acceptance:'not-accepted',historically_accepted:false,requires_recovery:true});await visit();assert.equal(await page.getByRole('button',{name:'Reconcile & recover',exact:true}).isEnabled(),true);assert.equal(await page.getByText('Retained historical error',{exact:true}).isVisible(),true);
});

test('observatory browser separates historical failures from readiness and reports an in-flight observation failure', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core'),{state}=await setup(t);
  const service=await startWorkspaceServer(state,{hooks:{autonomy:{read:async()=>({version:0,enabled:true,policy:{enabled:true,directions:['quality'],max_jobs:20,max_attempts:2,cooldown_ms:1000,admission:{enabled:true,goal_id:'approved'}},available_goals:[{id:'approved',title:'Approved scope',authority_current:true,grant:{enabled:true,directions:['quality'],max_goals:20,max_attempts:2,read_paths:['src'],write_paths:['src']}}],service:{state:'running-in-this-host',errors:[]},jobs:[{id:'old',status:'failed',reason:'Historical failure'},{id:'new',status:'completed',reason:'Later result'}],admissions:[],proposals:[]})}}});t.after(()=>service.close());
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage();page.setDefaultTimeout(8000);
  await page.addInitScript(()=>{const real=setInterval;window.setInterval=(fn,ms)=>real(fn,ms===15000?200:ms);});
  await page.goto(service.url);await page.getByRole('heading',{name:'Your workspace',exact:true}).waitFor();await page.goto(service.origin+'/?view=autonomy&project=alpha');await page.locator('[data-autonomy-state=waiting]').waitFor();assert.equal(await page.getByRole('heading',{name:'Historical failure',exact:true}).isVisible(),false);await page.locator('.autonomy-history>summary').click();assert.equal(await page.getByRole('heading',{name:'Historical failure',exact:true}).isVisible(),true);
  await page.locator('#autonomy-settings>summary').click();let release,requested;const gate=new Promise(resolve=>release=resolve),waiting=new Promise(resolve=>requested=resolve);t.after(()=>release?.());
  await page.route('**/api/autonomy?*',async route=>{requested();await gate;await route.abort('failed');});await waiting;release();
  await page.locator('[data-autonomy-state=unavailable]').waitFor();assert.equal(await page.locator('[data-control]').count(),0);
});

test('project selector waits for the first workspace snapshot before accepting input', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core'),{state}=await setup(t);
  const service=await startWorkspaceServer(state);t.after(()=>service.close());
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());
  const page=await browser.newPage();let release,requested;
  const waiting=new Promise(resolve=>{requested=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  t.after(()=>release());
  await page.route('**/api/workspace',async route=>{requested();await gate;await route.continue();});
  await page.goto(service.url);await waiting;
  assert.equal(await page.locator('#project-switch').isDisabled(),true);
  await page.getByRole('link',{name:'Model rules',exact:true}).click();
  assert.equal(await page.locator('#project-switch').isDisabled(),true);
  release();await page.getByRole('button',{name:'Switch project',exact:true}).click();
  await page.locator('[data-project-select=alpha]').click();
  assert.equal(new URL(page.url()).searchParams.get('project'),'alpha');
});

test('desktop project selector stays bounded with 200 long names and restores keyboard focus', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core'),{state}=await setup(t);
  const service=await startWorkspaceServer(state,{readSnapshot:async directory=>{
    const value=await readWorkspaceSnapshot(directory),base=value.projects[0];
    return {...value,projects:Array.from({length:200},(_,i)=>({...base,id:'synthetic-'+i,name:'Synthetic '+i+' — '+('Long project name · '.repeat(10))}))};
  }});t.after(()=>service.close());
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1280,height:800}});page.setDefaultTimeout(8000);
  await page.goto(service.url);await page.getByRole('heading',{name:'Your workspace',exact:true}).waitFor();
  assert.equal(await page.locator('.project-row').count(),8,'overview is bounded, full project directory remains available');
  await page.getByRole('button',{name:'Switch project',exact:true}).click();assert.equal(await page.locator('#project-results .picker-item').count(),20);
  await page.getByRole('button',{name:'Next projects',exact:true}).click();assert.match(await page.locator('#project-results .picker-item').first().innerText(),/Synthetic 20/);
  await page.locator('.project-dialog').getByRole('searchbox',{name:'Search projects',exact:true}).fill('synthetic-199');assert.equal(await page.locator('#project-results .picker-item').count(),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.locator('.project-dialog').getByRole('searchbox',{name:'Search projects',exact:true}).fill('');await page.evaluate(()=>document.documentElement.style.zoom='2');
  for(const selector of ['#close-project-picker','#project-search','[data-picker-page="1"]'])assert.equal(await page.locator(selector).evaluate(el=>{const b=el.getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight&&b.left>=0&&b.right<=innerWidth;}),true,'project picker search, close and paging stay visible at 200%');
  await page.getByRole('button',{name:'Next projects',exact:true}).click();assert.match(await page.locator('#project-results .picker-item').first().innerText(),/Synthetic 20/);
  await page.keyboard.press('Escape');await page.locator('dialog').waitFor({state:'detached'});assert.equal(await page.locator('#project-switch').evaluate(el=>el===document.activeElement),true);
  await page.evaluate(()=>document.documentElement.style.zoom='1');
  await page.getByRole('link',{name:'All projects',exact:true}).click();assert.equal(await page.locator('.project-row').count(),30);
  await page.getByRole('button',{name:'Next',exact:true}).click();assert.equal(await page.locator('.project-row').count(),30);
  await page.locator('#search').fill('Synthetic 199 —');assert.equal(await page.locator('.project-row').count(),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
});

async function captureDesktop(page,name){const directory=process.env.WORKKEEL_WORKSPACE_EVIDENCE_DIR;if(!directory)return;await fs.mkdir(directory,{recursive:true});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(directory,name),fullPage:false});}

test('desktop task discovery keeps URL context, scope and focus through navigation and refresh', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core'),{state}=await setup(t);let revision=0;
  const service=await startWorkspaceServer(state,{readSnapshot:async directory=>{
    const value=await readWorkspaceSnapshot(directory),base=value.tasks[0];
    return {...value,name:'Synthetic workspace '+revision,goals:[],tasks:Array.from({length:75},(_,i)=>({...base,id:'WK-find-'+i,key:'alpha:WK-find-'+i,title:'Searchable task '+i,task_state:i<70?'build':'done',updated_at:'2020-01-02T03:04:00Z'}))};
  }});t.after(()=>service.close());const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{const real=setInterval;window.setInterval=(fn,ms,...args)=>real(fn,ms===15000?300:ms,...args);localStorage.setItem('workkeel-workspace-theme','dark');});
  await page.goto(service.url);await page.getByRole('heading',{name:'Your workspace',exact:true}).waitFor();
  await page.goto(service.origin+'/?view=work&project=alpha');await page.locator('.task-row').first().waitFor();
  assert.equal(await page.getByRole('heading',{name:'Delivery goals',exact:true}).count(),0,'absent goals do not crowd the task list');
  assert.match(await page.locator('.task-updated').first().innerText(),/Updated.*2020/);
  await page.locator('#search').fill('Searchable');await page.locator('#task-filter').selectOption('active');await page.getByRole('button',{name:'Next',exact:true}).click();
  assert.match(await page.locator('.task-row a').first().innerText(),/task 30/);assert.equal(await page.locator('.task-row a').first().evaluate(el=>el===document.activeElement),true);
  const listURL=page.url();assert.equal(new URL(listURL).searchParams.get('page'),'1');
  await page.locator('.task-row a').first().click();assert.equal(await page.locator('#search').isVisible(),false);
  await page.goBack();await page.locator('#task-filter').waitFor();assert.equal(page.url(),listURL);assert.equal(await page.locator('#search').inputValue(),'Searchable');assert.equal(await page.locator('#task-filter').inputValue(),'active');assert.match(await page.locator('.task-row a').first().innerText(),/task 30/);
  await page.waitForFunction(()=>document.querySelector('.task-row a')===document.activeElement);
  await page.reload();await page.locator('.task-row').first().waitFor();assert.match(await page.locator('.task-row a').first().innerText(),/task 30/);
  await page.locator('.task-row a').nth(2).focus();revision++;await page.waitForFunction(()=>document.getElementById('workspace-name').textContent.endsWith('1'));assert.equal(await page.locator('.task-row a').nth(2).evaluate(el=>el===document.activeElement),true,'background updates retain the focused task link');
  await page.locator('#search').fill('no-match');assert.match(await page.locator('.work-toolbar').innerText(),/0 \/ 75/);await page.getByRole('button',{name:'Clear search & filters',exact:true}).click();assert.equal(await page.locator('#search').inputValue(),'');assert.equal(await page.locator('#task-filter').inputValue(),'all');assert.equal(await page.locator('#search').evaluate(el=>el===document.activeElement),true);
  await page.locator('#search').fill('WK-find-74');assert.equal(await page.locator('.task-row').count(),1);assert.match(await page.locator('.task-id').innerText(),/WK-find-74/);
  await captureDesktop(page,'desktop-task-search-dark.png');
  for(const view of ['work','project','settings','overview']){await page.goto(service.origin+'/?view='+view+'&project=missing');await page.getByRole('heading',{name:'Project not found',exact:true}).waitFor();assert.equal(await page.locator('.task-row').count(),0);assert.match(await page.locator('#project-switch').innerText(),/Unknown project/);}
  await page.getByRole('link',{name:/Browse projects/}).click();await page.locator('.project-row').waitFor();assert.equal(await page.locator('#search').inputValue(),'');
  await page.goto(service.origin+'/?view=work&project=alpha&q=Searchable&filter=active&page=1');await page.locator('.task-row').first().waitFor();
  await page.setViewportSize({width:1280,height:800});await page.evaluate(()=>document.documentElement.style.zoom='2');
  assert.equal(await page.locator('.task-row>div').first().evaluate(el=>el.getBoundingClientRect().width>=200),true,'task content stays readable at 200%, not a narrow vertical strip');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.locator('#clear-task-filters').scrollIntoViewIfNeeded();assert.equal(await page.locator('#clear-task-filters').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}),true);await page.locator('#clear-task-filters').click();assert.equal(await page.locator('#task-filter').inputValue(),'all');
  assert.deepEqual(errors,[]);
});

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
  await page.getByRole('button',{name:'繁體中文',exact:true}).click();await page.goto(service.origin+'/?view=overview');await page.getByRole('heading',{name:'交付需要恢復',exact:true}).waitFor();
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
  await page.getByRole('tab',{name:'Timeline',exact:true}).click();assert.ok(await page.locator('ol.timeline li').count()>0);
  await page.goto(service.origin+'/?view=settings&project=alpha');await page.getByRole('button',{name:'Open policy controls'}).click();
  await page.getByRole('button',{name:'Save policy'}).click();await page.getByText('Host confirmed the request.',{exact:false}).waitFor();assert.equal(policyWrites,1);
  await page.getByRole('button',{name:'Appearance: dark'}).click();assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),undefined);
  await page.getByRole('button',{name:'繁體中文',exact:true}).click();await page.getByRole('heading',{name:'模型規則',exact:true}).waitFor();
  fail=true;await page.getByRole('button',{name:'重新整理',exact:true}).click();await page.getByText('無法確認最新狀態。',{exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'開啟政策控制'}).isDisabled(),true);
  assert.deepEqual(errors,[]);
  const evidence=process.env.WORKKEEL_WORKSPACE_EVIDENCE_DIR;
  if(evidence){await fs.mkdir(evidence,{recursive:true});fail=false;await page.getByRole('button',{name:'重新整理',exact:true}).click();await page.goto(service.origin+'/?view=overview');await page.getByRole('heading',{name:'工作空間',exact:true}).waitFor();await page.screenshot({path:path.join(evidence,'workspace-overview-1440.png'),fullPage:true});}
});

test('actual browser edits contextual model rules and separately previews and approves an exact draft', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core');const {state}=await setup(t);
  let storeVersion=0,entries=[],policy={schema_version:'workkeel.model-policy/v1',id:'synthetic-model-policy',version:1,project:{model:{mode:'auto'},reasoning:{mode:'auto'},service:{mode:'auto'}},rules:[],models:[{id:'synthetic-approved-model',provider:'synthetic',model:'synthetic-model',opaque_scope:'kept'}]},approved=false,previewed=false;
  const service=await startWorkspaceServer(state,{control:{actor:{agent_id:'synthetic-operator',principal_id:'synthetic-owner'},actions:['policy.draft','policy.preview','policy.approve']},readSnapshot:async directory=>{const snapshot=await readWorkspaceSnapshot(directory);return {...snapshot,tasks:Array.from({length:40},(_,i)=>({...snapshot.tasks[0],id:'WK-zoom-'+i,key:'alpha:WK-zoom-'+i,title:'Synthetic zoom task '+i}))};},hooks:{policy:{read:async()=>({version:storeVersion,policy:policy.project,policy_document:policy,entries,active_version:approved?policy.version:null,capabilities:{model:['synthetic-approved-model'],reasoning:['high'],service:['standard']}}),execute:async request=>{
    assert.equal(request.expectedVersion,storeVersion);
    if(request.action==='policy.draft'){policy=request.payload.policy;assert.equal(policy.models[0].opaque_scope,'kept');assert.equal(policy.rules[0].layer,'role');assert.equal(policy.rules[0].match,'review');assert.equal(policy.rules[0].settings.model.value,'synthetic-approved-model');entries=[{policy,sha256:'a'.repeat(64),approval:null}];storeVersion++;return {draft_saved:true};}
    if(request.action==='policy.preview'){previewed=true;assert.equal(request.payload.selectors.role,'review');return {requested:policy.rules[0].settings,selected:{model:'synthetic-model'},reported:{model:null},dispatch_performed:false};}
    if(request.action==='policy.approve'){assert.equal(request.payload.policy_sha256,'a'.repeat(64));assert.equal(request.payload.policy_version,1);approved=true;entries[0].approval={synthetic:true};storeVersion++;return {approved:true};}
    throw Error('Unexpected synthetic action');
  }}}});t.after(()=>service.close());
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(service.url);await page.getByRole('link',{name:'Model rules',exact:true}).click();await page.getByRole('button',{name:'Switch project',exact:true}).click();await page.locator('[data-project-select=alpha]').click();await page.getByText('Advanced rules & exact versions',{exact:true}).click();await page.getByRole('button',{name:'Add contextual rule',exact:true}).click();
  await page.locator('#policy-context').selectOption('role');await page.locator('#policy-match').fill('review');await page.locator('#policy-match').dispatchEvent('change');
  await page.locator('[name="model-mode"]').selectOption('fixed');await page.locator('[name="model-value"]').fill('synthetic-approved-model');
  assert.equal(await page.locator('[name="model-value"]').isVisible(),true);assert.equal(await page.locator('[name="reasoning-value"]').isVisible(),false);assert.equal(await page.locator('[name="service-value"]').isVisible(),false);
  await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByText('Draft saved.',{exact:false}).waitFor();assert.equal(storeVersion,1);assert.equal(approved,false);
  await page.getByText('Advanced rules & exact versions',{exact:true}).click();await page.locator('[data-rule-action="rule:ui-rule-1"]').click();await page.getByRole('button',{name:'Preview choices',exact:true}).click();await page.locator('#rule-selection-preview').filter({hasText:'synthetic-model'}).waitFor();assert.equal(previewed,true);await captureDesktop(page,'workspace-model-policy-desktop.png');assert.equal(await page.locator('#rule-selection-preview .model-observation-row').count(),3);assert.equal(await page.locator('#rule-selection-preview pre').isVisible(),false);await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Approve this exact draft',exact:true}).click();await page.getByText('Exact draft approved.',{exact:false}).waitFor();assert.equal(approved,true);assert.equal(storeVersion,2);
  await page.evaluate(()=>document.documentElement.style.zoom='2');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  for(const width of [1440,1280]){await page.setViewportSize({width,height:900});
  for(const control of await page.locator('[data-rule-action^="edit:"]').all()){
    await control.scrollIntoViewIfNeeded();
    assert.equal(await control.evaluate(el=>{const b=el.getBoundingClientRect(),r=el.closest('.mr-list').getBoundingClientRect();return b.left>=r.left&&b.right<=r.right&&b.left>=0&&b.right<=innerWidth;}),true,'every Adjust control remains inside the visible container');
    await control.click();
    for(const name of ['Cancel','Preview choices','Save draft'])assert.equal(await page.getByRole('button',{name,exact:true}).evaluate(el=>{const b=el.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=innerHeight;}),true,'all editor footer controls remain visible at 200%');
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
  }}
  await page.getByRole('button',{name:'Adjust Implementation',exact:true}).click();
  await page.locator('[name="reasoning-mode"]').selectOption('fixed');await page.locator('[name="reasoning-value"]').fill('high');
  await captureDesktop(page,'workspace-policy-zoom2.png');
  await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.locator('#model-rule-dialog').waitFor({state:'detached'});assert.equal(storeVersion,3);
  await page.getByRole('button',{name:'Task exception',exact:true}).click();assert.equal(await page.locator('#rule-task-results .picker-item').count(),20);
  for(const selector of ['[data-rule-action="close-picker"]','#rule-task-search','[data-rule-action="picker-next"]'])assert.equal(await page.locator(selector).evaluate(el=>{const b=el.getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight&&b.left>=0&&b.right<=innerWidth;}),true,'large task picker controls stay visible at 200%');
  await page.locator('[data-rule-action="picker-next"]').click();assert.match(await page.locator('#rule-task-results .picker-item').first().innerText(),/WK-zoom-20/);
  await page.locator('#rule-task-search').fill('WK-zoom-39');await page.locator('[data-rule-action="task:WK-zoom-39"]').click();assert.equal(new URL(page.url()).searchParams.get('policy_task'),'WK-zoom-39');
  await page.keyboard.press('Tab');assert.notEqual(await page.evaluate(()=>document.activeElement.tagName),'BODY');assert.deepEqual(errors,[]);
});

test('exact activity rules remain editable when dimensions are split across project and task rules', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core'),{state}=await setup(t);
  const auto={mode:'auto'},fixed=value=>({mode:'fixed',value});let version=0;
  let policy={schema_version:'workkeel.model-policy/v1',id:'split-rules',version:1,project:{model:auto,reasoning:auto,service:auto},
    models:['a','b'].map(id=>({id,provider:'synthetic',model:'synthetic-'+id,reasoning_efforts:['high'],service_tiers:['standard']})),rules:[
      {id:'project-model',layer:'activity',match:'implementation',settings:{model:fixed('a')}},
      {id:'project-effort',layer:'activity',match:'implementation',settings:{reasoning:fixed('high')}},
      {id:'task-model',layer:'activity',match:'implementation',task:'WK-other',settings:{model:fixed('a')}},
      {id:'task-effort',layer:'activity',match:'implementation',task:'WK-other',settings:{reasoning:fixed('high')}}]};
  const original=structuredClone(policy);
  const service=await startWorkspaceServer(state,{control:{actor:{agent_id:'synthetic-operator',principal_id:'synthetic-owner'},actions:['policy.draft']},hooks:{policy:{
    read:async()=>({version,policy_document:policy,entries:[],active_version:null}),execute:async request=>{assert.equal(request.action,'policy.draft');assert.equal(request.expectedVersion,version);policy=request.payload.policy;version++;return {draft_saved:true};}
  }}});t.after(()=>service.close());
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  await page.goto(service.url);await page.getByRole('link',{name:'Model rules',exact:true}).click();await page.getByRole('button',{name:'Switch project',exact:true}).click();await page.locator('[data-project-select=alpha]').click();
  await page.getByRole('button',{name:'Adjust Implementation',exact:true}).click();await page.locator('#rule-editor-error').filter({hasText:'Multiple rules'}).waitFor();await page.getByRole('button',{name:'Cancel',exact:true}).click();
  for(const id of ['project-model','task-model']){
    await page.getByText('Advanced rules & exact versions',{exact:true}).click();
    assert.equal(await page.locator('.mr-advanced-row').count(),4);
    await page.locator('[data-rule-action="rule:'+id+'"]').click();
    assert.equal(await page.locator('#policy-match').getAttribute('readonly'),'');
    assert.equal((await page.locator('.mr-dialog-head').innerText()).includes('WK-other'),id==='task-model');
    await page.locator('[name=model-value]').fill('b');await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.locator('#model-rule-dialog').waitFor({state:'detached'});
  }
  assert.equal(version,2);assert.equal(policy.rules.length,4);
  assert.deepEqual(policy.rules[1],original.rules[1]);assert.deepEqual(policy.rules[3],original.rules[3]);
  assert.equal(policy.rules[0].settings.model.value,'b');assert.equal(policy.rules[2].settings.model.value,'b');assert.equal(policy.rules[2].task,'WK-other');
});

test('actual browser reviews exact storage plan, archives without deletion, and registers an explicitly selected project', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core');const {state,repo}=await setup(t);let reads=0,archives=0;
  const service=await startWorkspaceServer(state,{control:{actor:{agent_id:'synthetic',principal_id:'owner'},actions:['retention.archive','workspace.register']},hooks:{retention:{read:async()=>{reads++;return {version:0,stored_scope:'host-measurements-only',protected_evidence:{available:true,bytes:8192,files:4,roots:['.ai-org/goals','.ai-org/artifacts'],scope:'configured-canonical-evidence-roots',release_bytes:0},stored_bytes:4096,archive_bytes:1024,release_bytes:0,roots:['.ai-org/host-usage'],preview:{sha256:'b'.repeat(64)},actions:[{action:'retention.archive',label:'Create a verified archive',payload:{preview_sha256:'b'.repeat(64)}}]};},execute:async request=>{archives++;assert.equal(request.payload.preview_sha256,'b'.repeat(64));return {released_bytes:0};}}}});t.after(()=>service.close());
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(service.url);await page.getByRole('link',{name:'Model rules',exact:true}).click();await page.getByRole('button',{name:'Switch project',exact:true}).click();await page.locator('[data-project-select=alpha]').click();
  assert.equal(reads,0);await page.getByRole('link',{name:'Records & storage',exact:true}).click();await page.getByRole('heading',{name:'Storage',exact:true}).waitFor();await page.getByText('4.0 KiB',{exact:true}).waitFor();assert.equal(reads,1);await page.getByText('Execution measurements',{exact:true}).waitFor();await page.getByRole('heading',{name:'Protected task & acceptance evidence',exact:true}).waitFor();await page.getByText('8.0 KiB',{exact:true}).waitFor();await page.getByText('2 configured evidence roots',{exact:true}).waitFor();assert.equal(await page.getByText('Currently stored',{exact:true}).count(),0);
  assert.equal(await page.getByText('0 B',{exact:true}).count(),1);await page.getByRole('button',{name:'Create a verified archive',exact:true}).click();await page.getByText('Host confirmed the request.',{exact:false}).waitFor();assert.equal(archives,1);
  await page.goto(service.origin+'/?view=overview');await page.getByRole('heading',{name:'Your workspace',exact:true}).waitFor();assert.equal(reads,1);
  await removeWorkspaceProject(state,'alpha',{expectedVersion:2});await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('link',{name:/Register a project/}).click();await page.getByRole('heading',{name:'Register a project',exact:true}).waitFor();
  await page.locator('[name="name"]').fill('Explicit synthetic project');await page.locator('[name="id"]').fill('explicit');await page.locator('[name="task_root"]').fill(repo);await page.locator('[name="repo-path-0"]').fill(repo);
  await page.getByRole('button',{name:'Register project',exact:true}).click();await page.getByText('Host confirmed the request.',{exact:false}).waitFor();assert.equal((await readWorkspace(state)).projects[0].id,'explicit');assert.deepEqual(errors,[]);
});

test('actual browser displays synthetic recorded execution, bounded analysis and unconfirmed host cancellation', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core');const {state}=await setup(t);const measured=syntheticExecutionView();let cancelCalls=0;
  const sourceReader=async()=>({tasks:measured.tasks,complete:true,read_at:measured.read_at,project:{}});
  const service=await startWorkspaceServer(state,{readSnapshot:directory=>readWorkspaceSnapshot(directory,{snapshotReader:sourceReader}),control:{actor:{agent_id:'synthetic',principal_id:'owner'},actions:['autonomy.cancel']},hooks:{autonomy:{read:async()=>({version:0,enabled:true,state:'execution-recorded',jobs:[{id:'synthetic-running',task_id:'WK-synthetic',status:'running',reason:'Synthetic executing goal',direction:'quality'}],proposals:[{id:'synthetic-proposal',title:'Synthetic improvement proposal',direction:'quality',created_at:measured.read_at,line:7,evidence:[{path:'src/synthetic.mjs',sha256:'c'.repeat(64)}],scope:{read_paths:['src'],write_paths:['src']},budget:{max_attempts:1}}]}),execute:async request=>{assert.equal(request.payload.task_id,'WK-synthetic');cancelCalls++;return {cancellation:'requested-not-confirmed'};}}}});t.after(()=>service.close());
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(service.url);await page.getByRole('link',{name:'Tasks',exact:true}).click();await page.getByRole('link',{name:'Synthetic measured goal',exact:true}).click();await page.getByRole('tab',{name:'Execution',exact:true}).click();await page.getByRole('heading',{name:'Recorded work',exact:true}).waitFor();
  assert.equal(await page.locator('.operation-row').count(),3);await page.locator('.operation-row').filter({hasText:'Implementation'}).locator('summary').click();await page.getByText('requested-model',{exact:true}).waitFor();await page.getByText('selected-model',{exact:true}).waitFor();await page.locator('.operation-details').getByText('reported-model',{exact:true}).waitFor();
  assert.equal(await page.locator('.operation-row').filter({hasText:'Implementation'}).locator('.model-observation-row').last().getByText('Not reported',{exact:true}).count(),1);
  for(const size of [{width:1280,height:800},{width:1440,height:900},{width:1920,height:1080},{width:720,height:600}]){await page.setViewportSize(size);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>document.documentElement.style.zoom='2');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.evaluate(()=>document.documentElement.style.zoom='1');
  const evidence=process.env.WORKKEEL_WORKSPACE_EVIDENCE_DIR;if(evidence){await fs.mkdir(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,'workspace-execution-synthetic-1440.png'),fullPage:true});}
  await page.getByRole('link',{name:'Usage & outcomes',exact:true}).click();await page.getByText('Recorded operation groups',{exact:true}).waitFor();assert.equal(await page.locator('.ev-comparison svg').count(),1);await captureDesktop(page,'workspace-analysis-time-desktop.png');await page.locator('#analysis-metric').selectOption('tokens');assert.match(await page.locator('.ev-comparison').innerText(),/tokens/i);await captureDesktop(page,'workspace-analysis-tokens-desktop.png');await page.getByText('Recorded operation groups',{exact:true}).click();assert.equal(await page.locator('.analysis-row').count(),3);await page.locator('#analysis-model').selectOption('reported-model');await page.waitForFunction(()=>document.querySelectorAll('.analysis-row').length===1);assert.equal(await page.locator('.analysis-row').getByText('Implementation',{exact:true}).count(),1);
  if(evidence)await page.screenshot({path:path.join(evidence,'workspace-analysis-synthetic-1440.png'),fullPage:true});
  await page.goto(service.origin+'/?view=autonomy&project=alpha');await page.getByText('Execution recorded',{exact:true}).waitFor();await page.getByRole('button',{name:'Cancel this work',exact:true}).click();await page.getByText('Cancellation requested. The host has not confirmed stopping.',{exact:true}).waitFor();assert.equal(cancelCalls,1);
  assert.equal(await page.getByText('src/synthetic.mjs',{exact:true}).isVisible(),false);await page.getByText('Trigger evidence & scope',{exact:true}).click();await page.getByText('src/synthetic.mjs',{exact:true}).waitFor();assert.deepEqual(errors,[]);
});

test('actual browser narrows only approved model catalog and rejects disabling a fixed model', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core');const {state}=await setup(t);let drafts=0;
  const catalog=[{id:'synthetic-a',provider:'synthetic',model:'a',opaque:'source-a'},{id:'synthetic-b',provider:'synthetic',model:'b',opaque:'source-b'}];
  let policy={schema_version:'workkeel.model-policy/v1',id:'synthetic',version:1,project:{model:{mode:'fixed',value:'synthetic-a'},reasoning:{mode:'auto'},service:{mode:'auto'}},rules:[],models:catalog},entries=[];
  const service=await startWorkspaceServer(state,{control:{actor:{agent_id:'synthetic',principal_id:'owner'},actions:['policy.draft']},hooks:{policy:{read:async()=>({version:drafts,policy:policy.project,policy_document:policy,entries,capabilities:{model:catalog.map(model=>model.id),catalog,reasoning:[],service:[]}}),execute:async request=>{policy=request.payload.policy;assert.ok(policy.models.every(model=>catalog.some(allowed=>allowed.id===model.id&&allowed.opaque===model.opaque)));entries.push({policy,sha256:String(drafts+1).repeat(64),approval:null});drafts++;return {draft_saved:true};}}}});t.after(()=>service.close());
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:900}});await page.goto(service.url);await page.waitForFunction(()=>document.getElementById('connection')?.textContent.startsWith('Connected locally'));await page.goto(service.origin+'/?view=settings&project=alpha');await page.getByRole('button',{name:'Project defaults',exact:true}).click();await page.getByText('Allowed models',{exact:false}).click();
  await page.locator('[name="allowed-model"][value="synthetic-a"]').uncheck();await page.getByText('A fixed rule uses a disabled model.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Save draft',exact:true}).isDisabled(),true);assert.equal(drafts,0);
  await page.locator('[name="allowed-model"][value="synthetic-a"]').check();await page.locator('[name="allowed-model"][value="synthetic-b"]').uncheck();await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByText('Draft saved.',{exact:false}).waitFor();assert.equal(drafts,1);assert.deepEqual(policy.models.map(model=>model.id),['synthetic-a']);
  await page.getByRole('button',{name:'Project defaults',exact:true}).click();await page.getByText('Allowed models',{exact:false}).click();await page.locator('[name="allowed-model"][value="synthetic-b"]').check();await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.locator('.mr-version').filter({hasText:'draft v2'}).waitFor();assert.equal(drafts,2);assert.equal(policy.models.length,2);
});

test('compact activity usage exposes exact partial, zero and unknown values through keyboard and touch details', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
 const {chromium}=await import('playwright-core'),{state,repo}=await setup(t);
 const operations=[['planning',0,true],['implementation',1234567,false],['verification',null,false]].map(([activity_kind,tokens,tokens_complete])=>({activity_kind,tokens,tokens_complete,state:'completed',tool:'codex',actor:{agent_id:'synthetic'},reported_ms:1000,time_complete:true,reported:{model:'synthetic-model'}}));
 const service=await startWorkspaceServer(state,{readSnapshot:async directory=>({...await readWorkspaceSnapshot(directory),goals:[{id:'precise',root:repo,project_id:'alpha',read_status:'available',title:'Precision fixture',state:'running',accepted:false,operations}]})});t.after(()=>service.close());
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());
 for(const touch of [false,true]){
  const page=await browser.newPage({viewport:{width:1280,height:1000},hasTouch:touch});await page.goto(service.url);await page.goto(service.origin+'/?view=goal&project=alpha&task=precise');
  assert.match(await page.locator('[data-flow-node="implementation"]').innerText(),/≥ 1\.2M tokens/);
  for(const [activity,exact] of [['implementation','Reported tokens: ≥ 1,234,567 · partial'],['planning','Reported tokens: 0'],['verification','Reported tokens: Unknown']]){
   const row=page.locator('[data-flow-node="'+activity+'"]');if(touch)await row.tap();else{await row.focus();await page.keyboard.press('Enter');}
   await page.locator('.flow-inspector').waitFor();assert.equal(await page.locator('.flow-exact-tokens').innerText(),exact);assert.equal(await page.locator('.flow-exact-tokens').isVisible(),true);
   await page.locator('[data-flow-close]').click();assert.equal(await row.evaluate(el=>document.activeElement===el),true);
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.close();
 }
});

test('autonomy plan is read-only and conversation handoff survives clipboard denial', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
 const {chromium}=await import('playwright-core'),{state}=await setup(t);let writes=0;
 const service=await startWorkspaceServer(state,{control:{actor:{agent_id:'synthetic',principal_id:'owner'},actions:['autonomy.policy']},hooks:{autonomy:{read:async()=>({version:0,enabled:false,policy:{enabled:false,directions:[],max_jobs:20},available_goals:[],jobs:[],proposals:[],admissions:[]}),execute:async()=>{writes++;throw Error('Unexpected write');}}}});t.after(()=>service.close());
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage();page.setDefaultTimeout(8000);
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw Error('Denied');}}}));
 await page.goto(service.url);await page.goto(service.origin+'/?view=autonomy&project=alpha');await page.getByRole('button',{name:'See how to get started',exact:true}).click();
 await page.getByRole('button',{name:'Copy conversation brief',exact:true}).click();assert.equal(await page.locator('#autonomy-brief').evaluate(el=>el===document.activeElement),true);assert.match(await page.locator('#autonomy-copy-status').innerText(),/copy|Copy/);
 assert.match(await page.locator('#autonomy-brief').innerText(),/acceptance checks.*stop conditions/);assert.equal(await page.locator('#autonomy-form,input[name^=improvement],input[name^=discovery]').count(),0);assert.equal(writes,0);
});

test('actual browser registers approved three-repo goal, checks components and controls exact goal versions', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core');const {state,repo}=await setup(t);const library=await fs.realpath(await createMonitorFixture()),integration=await fs.realpath(await createMonitorFixture());t.after(()=>Promise.all([fs.rm(library,{recursive:true,force:true}),fs.rm(integration,{recursive:true,force:true})]));
  await registerWorkspaceProject(state,projectInput(library,'library'),{expectedVersion:2});await registerWorkspaceProject(state,projectInput(integration,'integration'),{expectedVersion:3});
  const task=(await readMonitorSnapshot(repo)).tasks[0],raw=syntheticGoal(repo,task.id);raw.mandatory_components[1].root=library;raw.mandatory_components[2].root=integration;raw.mandatory_components[2].accepted=false;raw.mandatory_components[2].state='build';let registered=false,started=false,commands=[];
  const service=await startWorkspaceServer(state,{readSnapshot:directory=>readWorkspaceSnapshot(directory,{goalReader:async root=>root===repo&&registered?[raw]:[]}),control:{actor:{agent_id:'synthetic',principal_id:'owner'},actions:['goals.create','goals.start','goals.cancel']},hooks:{goals:{read:async()=>({version:0,entries:registered?[raw]:[],candidates:registered?[]:[{task_id:task.id,manifest_ref:'synthetic-approved-goal.json',title:raw.manifest.title,goal_id:raw.id,version:8,component_count:3,repository_count:3}],services:[{goal_id:raw.id,state:started?'running-in-this-host':'not-confirmed-in-this-host',errors:[]}]}),execute:async request=>{
    commands.push(request.action);if(request.action==='goals.create'){assert.equal(request.expectedVersion,8);assert.equal(request.payload.manifest_ref,'synthetic-approved-goal.json');registered=true;return {registered:true};}
    assert.equal(request.expectedVersion,raw.version);assert.deepEqual(request.payload,{goal_id:raw.id,repo_id:'service'});if(request.action==='goals.start')started=true;else raw.state=raw.status='cancel-requested';raw.version++;return {recorded:true};
  }}}});t.after(()=>service.close());const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(service.url);await page.waitForFunction(()=>document.getElementById('connection')?.textContent.startsWith('Connected locally'));await page.goto(service.origin+'/?view=project&project=alpha');await page.getByRole('button',{name:'Register selected goal',exact:true}).waitFor();await page.getByRole('button',{name:'Register selected goal',exact:true}).click();await page.getByText('Approved goal registered.',{exact:false}).waitFor();assert.deepEqual(commands,['goals.create']);
  await page.getByRole('link',{name:raw.manifest.title,exact:true}).first().click();await page.getByRole('heading',{name:raw.manifest.title,exact:true}).waitFor();assert.equal(await page.locator('.task-key-metrics strong').first().textContent(),'2 / 3');assert.equal(await page.getByText('Whole goal accepted',{exact:true}).count(),0);assert.equal(await page.locator('.workspace-map .constellation-node').count(),3);await captureDesktop(page,'workspace-goal-flow-and-dependencies-desktop.png');if(process.env.WORKKEEL_WORKSPACE_EVIDENCE_DIR)await page.locator('.ev-dependencies').screenshot({path:path.join(process.env.WORKKEEL_WORKSPACE_EVIDENCE_DIR,'workspace-goal-dependency-diagram.png')});
  await page.getByRole('tab',{name:'Components & dependencies',exact:true}).click();await page.getByRole('heading',{name:'Delivery landscape',exact:true}).waitFor();await page.getByText('Repository scope & exact candidates',{exact:true}).click();assert.equal(await page.locator('.workspace-map .constellation-edge').count(),2);
  await page.getByRole('tab',{name:'Execution',exact:true}).click();await page.locator('.operation-row summary').click();await page.locator('.operation-details').getByText('reported-model',{exact:true}).waitFor();await page.getByRole('tab',{name:'Overview',exact:true}).click();await page.getByRole('button',{name:'Start delivery service',exact:true}).click();await page.getByText('Service active in this host',{exact:true}).waitFor();assert.equal(started,true);
  await page.getByText('More actions',{exact:true}).click();await page.getByRole('button',{name:'Request cancellation',exact:true}).click();await page.getByText('Cancellation requested. Check its recorded confirmation before treating work as stopped.',{exact:true}).waitFor();assert.equal(raw.status,'cancel-requested');assert.deepEqual(commands,['goals.create','goals.start','goals.cancel']);assert.deepEqual(errors,[]);
});

test('goal browser shows canonical component FAIL despite completed execution and retains repair history', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core'),{state,repo}=await setup(t),raw=syntheticGoal(repo);
  raw.mandatory_components=raw.mandatory_components.slice(0,1);const component=raw.mandatory_components[0];Object.assign(component,{project_id:'alpha',accepted:false,state:'test',progress:{phase:'rework'},review:{judgment:'fail',revision:component.candidate_revision},reviews:[{operation_id:'review-failed',judgment:'fail',revision:component.candidate_revision}]});
  raw.operations.push({id:'review-failed',kind:'runtime',status:'completed',at:'2026-01-01T00:01:00Z',input:{component_id:'api',phase:'review',candidate:component.candidate_revision},result:{actor:{agent_id:'reviewer',principal_id:'owner'},runtime_selection:{model:'review-model'},usage:{input_tokens:0,output_tokens:0}}});
  const service=await startWorkspaceServer(state,{readSnapshot:directory=>readWorkspaceSnapshot(directory,{goalReader:async root=>root===repo?[raw]:[]})});t.after(()=>service.close());const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(service.url);await page.waitForFunction(()=>document.getElementById('connection')?.textContent.startsWith('Connected locally'));await page.goto(service.origin+'/?view=goal&project=alpha&task='+raw.id);await page.locator('.scene-current[data-state=failed] button[data-flow-node="independent-review"]').waitFor();assert.equal(await page.locator('.scene-current[data-state=failed]').count(),1);assert.equal(await page.locator('.ev-node[data-state=queued]').count(),1);await captureDesktop(page,'workspace-goal-failed-review-desktop.png');
  component.review={judgment:'pass',revision:component.candidate_revision};component.reviews.push({operation_id:'review-passed',judgment:'pass',revision:component.candidate_revision});component.progress.phase='close';raw.operations.push({...structuredClone(raw.operations.at(-1)),id:'review-passed',at:'2026-01-01T00:02:00Z'});
  await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.locator('.scene-current[data-state=review-passed] button[data-flow-node="independent-review"]').waitFor();assert.equal(await page.locator('.scene-current[data-state=review-passed]').count(),1);await page.locator('button[data-flow-node="independent-review"]').click();assert.equal(await page.locator('.flow-inspector .flow-record').count(),2);assert.deepEqual(errors,[]);
});

test('project rest state never claims completion when task records are unavailable', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core'),{state}=await setup(t);
  const service=await startWorkspaceServer(state,{readSnapshot:async directory=>{
    const snapshot=await readWorkspaceSnapshot(directory);
    snapshot.projects[0].complete=false;
    for(const task of snapshot.tasks)task.read_status='unavailable';
    return snapshot;
  }});t.after(()=>service.close());
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());
  const page=await browser.newPage();await page.goto(service.url);
  await page.waitForFunction(()=>document.getElementById('connection')?.textContent.startsWith('Connected locally'));
  await page.goto(service.origin+'/?view=project&project=alpha');
  await page.locator('.project-rest').waitFor();
  assert.match(await page.locator('.project-rest').innerText(),/Some work cannot be confirmed/);
  assert.equal(await page.locator('.project-rest [aria-hidden]').count(),0);
  await page.getByRole('button',{name:'繁體中文',exact:true}).click();
  assert.match(await page.locator('.project-rest').innerText(),/部分工作狀態尚無法確認/);
  assert.doesNotMatch(await page.locator('main').innerText(),/目前任務已告一段落/);
});

test('task dependency landscape navigates the exact project and keeps missing dependencies unlinked', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core'),{state,repo}=await setup(t),other=await fs.realpath(await createMonitorFixture());
  t.after(()=>fs.rm(other,{recursive:true,force:true}));
  await registerWorkspaceProject(state,projectInput(other,'beta'),{expectedVersion:2});
  let sourceId,targetId;
  const service=await startWorkspaceServer(state,{readSnapshot:async directory=>{
    const snapshot=await readWorkspaceSnapshot(directory),source=snapshot.tasks.find(task=>task.project_id==='alpha'),target=snapshot.tasks.find(task=>task.project_id==='beta');
    sourceId=source.id;targetId=target.id;source.title='Synthetic source task';target.title='Synthetic dependency task';source.task_state='build';target.task_state='test';source.dependencies=[target.key,'missing:WK-unavailable'];
    return snapshot;
  }});t.after(()=>service.close());
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.goto(service.url);await page.waitForFunction(()=>document.getElementById('connection')?.textContent.startsWith('Connected locally'));
  await page.goto(service.origin+'/?'+new URLSearchParams({view:'task',project:'alpha',task:sourceId}));
  await page.getByRole('tab',{name:'Dependencies',exact:true}).click();
  const missing=page.locator('.constellation-node').filter({has:page.locator('strong[title="missing:WK-unavailable"]')});
  assert.equal(await missing.locator('a').count(),0);
  const link=page.locator('.workspace-map a').filter({hasText:'beta:'+targetId});
  assert.equal(await link.locator('small').innerText(),'Independent review');
  await page.getByRole('button',{name:'繁體中文',exact:true}).click();
  assert.equal(await link.locator('small').innerText(),'獨立審查');
  assert.equal(await missing.locator('small').innerText(),'狀態待確認');
  await link.click();await page.getByRole('heading',{name:'Synthetic dependency task',exact:true}).waitFor();
  const url=new URL(page.url());assert.equal(url.searchParams.get('project'),'beta');assert.equal(url.searchParams.get('task'),targetId);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
});

test('simple autonomy controls preserve sealed scope and link admitted work to its actual project', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
 const {chromium}=await import('playwright-core'),{state,repo}=await setup(t);let writes=0,starts=0,active=false;
 const grant={enabled:true,directions:['quality'],read_paths:['src'],write_paths:['src'],max_goals:3};
 let policy={enabled:true,directions:['quality'],max_jobs:3,max_attempts:1,cooldown_ms:1001,admission:{enabled:true,goal_id:'approved'},discovery:{enabled:true,max_rounds:2,max_runtime_ms:1001,max_cost_usd:null,read_paths:['src'],write_paths:['src']}};
 const original=structuredClone(policy);
 const service=await startWorkspaceServer(state,{readSnapshot:async directory=>({...await readWorkspaceSnapshot(directory),goals:[{id:'same-id',root:repo,project_id:'alpha',read_status:'available',title:'Unrelated source goal',state:'done',operations:[]},{id:'same-id',root:repo+'/beta',project_id:'beta',read_status:'available',title:'Cross-repository improvement',state:'running',operations:[]}]}),control:{actor:{agent_id:'synthetic',principal_id:'owner'},actions:['autonomy.policy','autonomy.start-service','autonomy.pause']},hooks:{autonomy:{read:async()=>({version:writes,enabled:policy.enabled,policy,available_goals:[{id:'approved',title:'Approved plan',authority_current:true,grant}],service:{state:active?'running-in-this-host':'not-confirmed-in-this-host'},admissions:active?[{id:'admitted',goal_id:'same-id',root:repo+'/beta',kind:'execution',status:'created'}]:[],jobs:[],proposals:[]}),execute:async request=>{
  assert.equal(request.expectedVersion,writes);assert.equal(request.payload.goal_id,'approved');
  if(request.action==='autonomy.start-service'){starts++;active=true;return {state:'listening',model_called:false};}
  assert.equal(request.action,'autonomy.policy');assert.deepEqual(request.payload.policy,{...original,enabled:false});policy=request.payload.policy;writes++;return {policy_saved:true};
 }}}});t.after(()=>service.close());
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage();page.setDefaultTimeout(8000);
 await page.goto(service.url);await page.goto(service.origin+'/?view=autonomy&project=alpha');await page.locator('[data-autonomy-state=ready]').waitFor();await page.getByRole('button',{name:'Start improvement service',exact:true}).click();await page.locator('[data-autonomy-state=recorded]').waitFor();assert.equal(starts,1);
 await page.locator('.journey-current .journey-operation-details>summary').click();assert.equal(await page.getByRole('link',{name:'View task & evidence ↗',exact:true}).getAttribute('href'),'?view=goal&project=beta&task=same-id');
 assert.equal(await page.getByRole('heading',{name:'Unrelated source goal',exact:true}).count(),0);
 await page.locator('#autonomy-end>summary').click();assert.match(await page.locator('#autonomy-end').innerText(),/does not cancel/);assert.equal(writes,0);
 await page.getByRole('button',{name:'Confirm end of future improvement',exact:true}).click();await page.locator('[data-autonomy-state=off]').waitFor();assert.equal(writes,1);assert.equal(starts,1);assert.deepEqual(policy,{...original,enabled:false});
});

test('late goal-control reads never overwrite another settings view', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core');const {state}=await setup(t);let release;const held=new Promise(resolve=>release=resolve);
  const service=await startWorkspaceServer(state,{hooks:{goals:{read:async()=>{await held;return {version:0,entries:[],candidates:[],services:[]};}},policy:{read:async()=>({version:9,policy:{model:{mode:'auto'},reasoning:{mode:'auto'},service:{mode:'auto'}},capabilities:{model:[],reasoning:[],service:[]}})}}});t.after(()=>service.close());const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.goto(service.url);await page.getByRole('link',{name:'Order service',exact:true}).click();await page.getByRole('heading',{name:'Order service',exact:true}).waitFor();await page.locator('.project-resources>summary').click();await page.locator('.project-resources').getByRole('link',{name:'Model rules',exact:true}).click();await page.getByText('Store version 9',{exact:true}).waitFor();
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/goals');release();await (await response).json();await page.evaluate(()=>new Promise(requestAnimationFrame));assert.equal(await page.getByText('Store version 9',{exact:true}).count(),1);assert.equal(await page.getByRole('heading',{name:'Model rules',exact:true}).count(),1);
});

test('actual learning settings distinguish evaluated and active states while disclosing reasons', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core'),{state}=await setup(t);
  const entries=[['candidate','Awaiting evaluation'],['evaluated','Evaluated'],['active','Active'],['review-required','Revalidation required']].map(([effective_state,title],index)=>({id:'synthetic-'+index,title,effective_state,reasons:[{code:'Synthetic exact evidence needs inspection'}],candidate:{request:{trigger:'When the approved project condition applies'}}}));
  const service=await startWorkspaceServer(state,{hooks:{learning:{read:async()=>({version:0,entries,actions:[]})}}});t.after(()=>service.close());
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(service.url);await page.waitForFunction(()=>document.getElementById('connection')?.textContent.startsWith('Connected locally'));await page.goto(service.origin+'/?view=learning&project=alpha');await page.getByRole('heading',{name:'Skills',exact:true}).waitFor();assert.equal(await page.locator('.delivery-row').count(),4);assert.equal(await page.getByText('Synthetic exact evidence needs inspection',{exact:true}).first().isVisible(),false);assert.equal(await page.locator('.delivery-row .badge').filter({hasText:/^Active$/}).count(),1);
  await captureDesktop(page,'workspace-learning-states-desktop.png');await page.getByText('Why this state',{exact:true}).first().focus();await page.keyboard.press('Enter');assert.equal(await page.getByText('Synthetic exact evidence needs inspection',{exact:true}).first().isVisible(),true);
  await page.getByRole('button',{name:'繁體中文',exact:true}).click();await page.getByRole('heading',{name:'專案學習形成的 Skills',exact:true}).waitFor();assert.equal(await page.locator('.delivery-row .badge').filter({hasText:/^已啟用$/}).count(),1);await captureDesktop(page,'workspace-learning-states-zh-TW.png');
  await page.locator('#theme').click();await page.locator('#theme').click();await captureDesktop(page,'workspace-learning-states-dark.png');await page.evaluate(()=>document.body.style.zoom='2');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
});

test('storage separates protected evidence from missing measurements and bounded inventory uncertainty', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core');const {state}=await setup(t);let limited=false;
  const service=await startWorkspaceServer(state,{hooks:{retention:{read:async()=>({available:!limited,version:0,stored_scope:'host-measurements-only',stored_bytes:null,archive_bytes:null,release_bytes:0,roots:[],actions:[],protected_evidence:limited?{available:false,bytes:null,files:null,roots:['.ai-org/goals'],scope:'configured-canonical-evidence-roots',release_bytes:0,reason:'Synthetic inventory byte limit reached'}:{available:true,bytes:16384,files:7,roots:['.ai-org/goals'],scope:'configured-canonical-evidence-roots',release_bytes:0}})}}});t.after(()=>service.close());const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:900}});await page.goto(service.url);await page.waitForFunction(()=>document.getElementById('connection')?.textContent.startsWith('Connected locally'));await page.goto(service.origin+'/?view=storage&project=alpha');await page.getByText('Execution measurements',{exact:true}).waitFor();await page.getByText('16.0 KiB',{exact:true}).waitFor();await page.getByText('7 files',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Create a verified archive',exact:true}).count(),0);
  limited=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByText('Stored evidence size is unknown.',{exact:true}).waitFor();await page.getByText('Synthetic inventory byte limit reached',{exact:true}).waitFor();assert.equal(await page.getByText('16.0 KiB',{exact:true}).count(),0);assert.equal(await page.getByText('0 files',{exact:false}).count(),0);
});

test('single-project multi-repo browser separates duplicate goal routes and permits stopping a known partial goal', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core');const {state,repo}=await setup(t),library=await fs.realpath(await createMonitorFixture()),integration=await fs.realpath(await createMonitorFixture());t.after(()=>Promise.all([fs.rm(library,{recursive:true,force:true}),fs.rm(integration,{recursive:true,force:true})]));
  await removeWorkspaceProject(state,'alpha',{expectedVersion:2});await registerWorkspaceProject(state,{id:'single',name:'One project · three repos',task_root:repo,repositories:[{id:'api',path:repo},{id:'library',path:library},{id:'integration',path:integration}]},{expectedVersion:3});
  const taskId=(await readMonitorSnapshot(repo)).tasks[0].id,primary=syntheticGoal(repo,taskId);primary.manifest.title='Primary-root delivery';primary.mandatory_components.forEach((c,index)=>Object.assign(c,{project_id:'single',repo_id:['api','library','integration'][index],root:[repo,library,integration][index],task_id:taskId}));const foreign=structuredClone(primary);foreign.manifest.title='Library-root delivery';foreign.operations[0].input.component_id='library';const commands=[];
  const service=await startWorkspaceServer(state,{readSnapshot:directory=>readWorkspaceSnapshot(directory,{goalReader:async root=>root===repo?[primary]:root===library?[foreign]:[]}),control:{actor:{agent_id:'synthetic',principal_id:'owner'},actions:['goals.start','goals.pause','goals.cancel','goals.resume','goals.recover']},hooks:{goals:{read:async()=>({version:0,entries:[primary,foreign],candidates:[],services:[{goal_id:primary.id,root:repo,repo_id:'api',state:'not-confirmed-in-this-host',errors:[]},{goal_id:foreign.id,root:library,repo_id:'library',state:'not-confirmed-in-this-host',errors:[]}]}),execute:async request=>{
    const goal=request.payload.repo_id==='api'?primary:foreign;assert.equal(request.payload.goal_id,primary.id);assert.ok(['api','library'].includes(request.payload.repo_id));assert.equal(request.expectedVersion,goal.version);commands.push([request.action,request.payload.repo_id]);if(request.action==='goals.cancel')goal.state=goal.status='cancel-requested';goal.version++;return {recorded:true};
  }}}});t.after(()=>service.close());const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(service.url);await page.waitForFunction(()=>document.getElementById('connection')?.textContent.startsWith('Connected locally'));await page.goto(service.origin+'/?view=project&project=single');await page.getByRole('link',{name:'Library-root delivery',exact:true}).first().waitFor();const primaryLink=await page.getByRole('link',{name:'Primary-root delivery',exact:true}).first().getAttribute('href'),foreignLink=await page.getByRole('link',{name:'Library-root delivery',exact:true}).first().getAttribute('href');assert.notEqual(primaryLink,foreignLink);
  await page.getByRole('link',{name:'Primary-root delivery',exact:true}).first().click();await page.getByRole('button',{name:'Start delivery service',exact:true}).click();await page.getByText('Goal control recorded.',{exact:true}).waitFor();await page.getByRole('tab',{name:'Components & dependencies',exact:true}).click();await page.getByText('Repository scope & exact candidates',{exact:true}).click();assert.equal(await page.locator('.dependency-list > li').count(),3);assert.equal(await page.locator('.dependency-list a').count(),1);
  await page.goto(service.origin+'/'+foreignLink);await page.getByRole('heading',{name:'Library-root delivery',exact:true}).waitFor();await page.getByRole('button',{name:'Start delivery service',exact:true}).click();await page.getByText('Goal control recorded.',{exact:true}).waitFor();assert.deepEqual(commands,[['goals.start','api'],['goals.start','library']]);
  foreign.authority_status='unavailable';foreign.mandatory_components[1].read_status='unavailable';foreign.mandatory_components[1].reason='Synthetic component authority drift';await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByText('Required scope or evidence unavailable',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Start delivery service',exact:true}).isDisabled(),true);await page.getByText('More actions',{exact:true}).click();assert.equal(await page.getByRole('button',{name:'Pause delivery',exact:true}).isDisabled(),false);assert.equal(await page.getByRole('button',{name:'Request cancellation',exact:true}).isDisabled(),false);
  await page.getByRole('button',{name:'Request cancellation',exact:true}).click();await page.getByText('Cancellation requested. Check its recorded confirmation before treating work as stopped.',{exact:true}).waitFor();assert.deepEqual(commands.at(-1),['goals.cancel','library']);assert.equal(foreign.status,'cancel-requested');assert.equal(await page.getByText('Stopped',{exact:true}).count(),0);
  await page.getByRole('tab',{name:'Integration evidence',exact:true}).click();assert.equal(await page.getByRole('button',{name:'History & resources',exact:true}).count(),0);assert.deepEqual(errors,[]);
});
