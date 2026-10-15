import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createMonitorFixture} from '../scripts/workkeel-monitor-fixture.mjs';
import {createWorkspace,registerWorkspaceProject,readWorkspaceSnapshot} from '../src/workkeel-workspace.mjs';
import {startWorkspaceServer} from '../src/workkeel-workspace-server.mjs';

test('actual workspace flow is compact, inspectable, truthful and keyboard-readable', {skip:process.env.WORKKEEL_WORKSPACE_BROWSER!=='1'},async t=>{
  const {chromium}=await import('playwright-core'),state=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'workkeel-visual-flow-'))),repo=await fs.realpath(await createMonitorFixture({extended:true}));
  t.after(()=>Promise.all([fs.rm(state,{recursive:true,force:true}),fs.rm(repo,{recursive:true,force:true})]));
  await createWorkspace(state,{id:'synthetic-flow',name:'Synthetic delivery workspace'});await registerWorkspaceProject(state,{id:'alpha',name:'Example checkout',task_root:repo,repositories:[{id:'checkout',path:repo}]},{expectedVersion:1});
  const snapshot=await readWorkspaceSnapshot(state),task=snapshot.tasks.find(value=>value.id==='WK-working');assert.ok(task);
  const now=Date.now(),at=offset=>new Date(now+offset).toISOString();
  const operation=(id,activity,agent,model,start,end,extra={})=>({operation_id:id,activity_kind:activity,state:'completed',actor:{agent_id:agent,principal_id:'synthetic-owner'},runtime_model:model,selected_model:model,result_recorded:true,coverage_complete:true,adapter_elapsed_ms:end-start,dispatched_at:at(start),completed_at:at(end),execution_intervals:[{started_at:at(start),completed_at:at(end)}],usage:{input_tokens:800,output_tokens:200},...extra});
  task.title='Synthetic cross-service checkout';task.goal='Deliver matching order and inventory changes with independent review.';task.task_state='build';task.quality.review_judgment='fail';
  task.runs=[{run_id:'synthetic-implementation',runner_state:'running',last_observed_at:at(-1000),operations:[operation('plan','planning','implementation-agent','reported-plan-model',-90000,-80000),operation('implement','implementation','implementation-agent','reported-build-model',-80000,-40000),operation('verify','verification','implementation-agent','reported-build-model',-40000,-35000),operation('repair','repair','implementation-agent','reported-build-model',-10000,-1000,{state:'running',result_recorded:false,last_observed_at:at(-1000),usage:{input_tokens:null,output_tokens:null},coverage_complete:false,execution_intervals:[],completed_at:null,adapter_elapsed_ms:null,observed_elapsed_ms:9000})]},
    {run_id:'synthetic-review',runner_state:'completed',operations:[operation('review','independent-review','review-agent','reported-review-model',-35000,-20000,{state:'failed'})]}];
  let stale=false;
  const service=await startWorkspaceServer(state,{readSnapshot:async()=>({...snapshot,tasks:snapshot.tasks.map(value=>value===task?{...task,read_status:stale?'stale':'available'}:value)})});t.after(()=>service.close());
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:1000},colorScheme:'light'}),errors=[],external=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith(service.origin))external.push(request.url());});
  await page.clock.install({time:now});await page.goto(service.url);await page.goto(service.origin+'/?view=task&project=alpha&task=WK-working');await page.getByRole('heading',{name:task.title,exact:true}).waitFor();
  assert.equal(await page.locator('.ev-track>.ev-node').count(),5);assert.ok((await page.locator('.execution-visual').boundingBox()).height<=240);
  assert.equal(await page.locator('.ev-node[data-flow-node]').count(),0);assert.equal(await page.locator('.ev-node[aria-current=step] [data-flow-node]').getAttribute('data-flow-node'),'repair');
  assert.equal(await page.locator('.ev-node[data-state=failed]').count(),1);await page.getByRole('button',{name:/Independent review · Needs repair/}).focus();await page.keyboard.press('Enter');await page.getByRole('region',{name:'Selected activity'}).waitFor();await page.locator('.flow-inspector').getByText('review-agent',{exact:true}).waitFor();await page.getByRole('button',{name:'Close details',exact:true}).click();assert.equal(await page.evaluate(()=>document.activeElement.dataset.flowNode),'independent-review');
  assert.equal(await page.getByText(task.key,{exact:true}).isVisible(),false);
  const evidence=process.env.WORKKEEL_WORKSPACE_EVIDENCE_DIR;async function capture(name){if(evidence){await fs.mkdir(evidence,{recursive:true});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(evidence,name),fullPage:false});}}
  await capture('task-flow-repair-desktop.png');
  await page.getByRole('tab',{name:'Timeline',exact:true}).click();await page.getByRole('heading',{name:'Executor timeline',exact:true}).waitFor();assert.equal(await page.locator('.ev-interval').count(),5);assert.equal(await page.locator('.ev-bar').count(),4);await capture('task-executor-timeline-desktop.png');
  await page.getByRole('tab',{name:'Overview',exact:true}).click();await page.getByRole('button',{name:'Appearance: system',exact:true}).click();await page.getByRole('button',{name:'Appearance: light',exact:true}).click();await capture('task-flow-repair-dark.png');
  await page.getByRole('button',{name:'繁體中文',exact:true}).click();await page.getByRole('button',{name:/獨立審查/}).waitFor();await capture('task-flow-repair-zh-TW.png');
  await page.emulateMedia({reducedMotion:'reduce'});await page.clock.fastForward(71000);assert.equal(await page.locator('.ev-node[aria-current=step]').count(),0,'unchanged successful polling cannot keep a running report fresh');await capture('task-flow-expired-zh-TW.png');
  stale=true;await page.getByRole('button',{name:'重新整理',exact:true}).click();await page.getByText('顯示先前確認的歷史，目前狀態無法讀取。最後確認：',{exact:false}).waitFor();assert.equal(await page.locator('.ev-node[aria-current=step]').count(),0);
  await page.evaluate(()=>document.body.style.zoom='2');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.evaluate(()=>document.body.style.zoom='1');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
});
