import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {createMonitorFixture} from './workkeel-monitor-fixture.mjs';
import {startTaskMonitor,readMonitorSnapshot} from '../src/workkeel-monitor.mjs';
import {recordTaskObservation} from '../src/workkeel-task-summary.mjs';
import {readNativeTask} from '../src/workkeel-tasks.mjs';

const output=path.resolve('output/playwright/workkeel-monitor');await fs.mkdir(output,{recursive:true});
const root=await createMonitorFixture({extended:true}),empty=await createMonitorFixture({empty:true});
const observed=await readNativeTask(root,'WK-completed');
await recordTaskObservation(root,observed.id,{schema_version:'workkeel.task-observation/v1',task_id:observed.id,task_version:observed.version,actor:observed.contract.actor,candidate_revision:null,observed_at:new Date().toISOString(),source:'Synthetic browser check',sample_kind:'fixture',comparison_group:null,checks:[{name:'Fixture check',status:'pass',evidence_ref:'docs/approval.md'}],links:{conversation:'codex://threads/01a0d1d2-b5ee-7c90-b7c5-178e65725b86',pull_request:'https://github.com/example/project/pull/1'},note:'Synthetic observation, not task acceptance.'});
const monitor=await startTaskMonitor(root),emptyMonitor=await startTaskMonitor(empty);
const browser=await chromium.launch({channel:'chrome',headless:true});
const checks=[];let page;
try {
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
  page=await browser.newPage({viewport,reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(monitor.url);await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('唯讀快照'));
  assert.equal(new URL(page.url()).hash,'');
  assert.equal(await page.locator('#task-list button').count(),6);
  await page.screenshot({path:path.join(output,`${viewport.width}-overview.png`),fullPage:true});
  await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
  await page.screenshot({path:path.join(output,`${viewport.width}-dark.png`),fullPage:true});
  await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
  checks.push(`${viewport.width}:dark-layout`);
  await page.getByLabel('搜尋',{exact:true}).fill('no-match');
  assert.match(await page.locator('#task-list').innerText(),/沒有符合/);
  await page.getByLabel('搜尋',{exact:true}).fill('');
  await page.getByRole('button',{name:'用量與效益',exact:true}).click();
  assert.match(await page.locator('#quality-table').innerText(),/尚未審查/);
  await page.screenshot({path:path.join(output,`${viewport.width}-quality.png`),fullPage:true});
  await page.getByRole('button',{name:'任務詳情',exact:true}).click();
  checks.push(`${viewport.width}:overview-search-quality-navigation`);
  for(const state of ['completed','interrupted','unobserved']) {
   await page.getByLabel('任務',{exact:true}).selectOption('WK-'+state);
   await page.waitForFunction(s=>document.querySelector('#detail-title').textContent.includes(s==='unobserved'?'Unobserved':s),state);
   const cards=await page.locator('#cards').innerText();assert.match(cards,state==='completed'?/1,200/:state==='interrupted'?/>= 1,200 （部分紀錄）/:/未知/);
   assert.equal(await page.locator('#detail-title img').count(),0);
   if(state==='completed'){
    assert.equal(await page.getByRole('link',{name:'開啟 Pull Request'}).getAttribute('href'),'https://github.com/example/project/pull/1');
    assert.match(await page.locator('#evidence').innerText(),/非目前候選版本的證據/);
   }
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:path.join(output,`${viewport.width}-${state}.png`),fullPage:true});checks.push(`${viewport.width}:${state}`);
  }
  for(const state of ['working','review','accepted']) {
   await page.locator('#tasks').selectOption('WK-'+state);
   assert.match(await page.locator('#lifecycle').innerText(),/總經過時間/);
   if(state==='review')assert.match(await page.locator('#next-action').innerText(),/等待獨立審查/);
   if(state==='accepted')assert.match(await page.locator('#delivery').innerText(),/本機驗收：已記錄/);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:path.join(output,viewport.width+'-'+state+'.png'),fullPage:true});
   checks.push(viewport.width+':'+state+'-lifecycle');
  }
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  await page.locator('#copy-handoff').click();
  await page.waitForFunction(()=>document.querySelector('#copy-status').textContent.includes('已複製'));
  const copied=await page.evaluate(()=>navigator.clipboard.readText());
  assert.match(copied,/WK-accepted/);assert.match(copied,/本機驗收：已記錄/);
  assert.ok(!copied.includes(new URL(monitor.url).hash.slice(1)));assert.doesNotMatch(copied,/PRIVATE_OUTPUT_NOT_FOR_MONITOR/);
  await page.locator('#tasks').selectOption('WK-review');
  assert.equal(await page.locator('#copy-status').innerText(),'');
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied');}}}));
  await page.locator('#copy-handoff').click();
  await page.waitForFunction(()=>!document.querySelector('#copy-fallback').hidden);
  assert.match(await page.locator('#handoff-text').inputValue(),/WK-review/);
  const frozen=await page.locator('#handoff-text').inputValue();
  await page.locator('#refresh').click();await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);
  assert.equal(await page.locator('#handoff-text').inputValue(),frozen);
  await page.screenshot({path:path.join(output,viewport.width+'-handoff.png'),fullPage:true});
  await page.locator('#tasks').selectOption('WK-interrupted');assert.equal(await page.locator('#copy-fallback').isVisible(),false);
  checks.push(viewport.width+':clipboard-success-fallback-and-task-switch');
  const brokenFile=path.join(root,'.ai-org/work-items/WK-unobserved.json'),original=await fs.readFile(brokenFile);
  await fs.writeFile(brokenFile,'broken synthetic record');
  await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('部分紀錄'));
  await page.locator('#tasks').selectOption('WK-unobserved');
  assert.equal(await page.locator('#copy-handoff').isDisabled(),true);
  assert.match(await page.locator('#delivery').innerText(),/無法驗證/);
  await page.screenshot({path:path.join(output,viewport.width+'-unavailable.png'),fullPage:true});
  await fs.writeFile(brokenFile,original);await page.locator('#refresh').click();await page.waitForFunction(()=>!document.querySelector('#status').classList.contains('error'));
  checks.push(viewport.width+':corrupt-task-isolation-and-recovery');
  // Verify refresh observes changed measurements, then hides stale data on error.
  let mode='running';
  await page.route('**/api/snapshot',async route=>{
   if(mode==='error')return route.fulfill({status:503,body:'unavailable'});
   const response=await route.fetch(),snapshot=await response.json();
   if(mode==='running') {
    const task=snapshot.tasks.find(t=>t.id==='WK-interrupted');task.runs[0].runner_state='running';
    task.usage.input_tokens.known_subtotal=2400;
   }
   return route.fulfill({response,json:snapshot});
  });
  await page.getByLabel('任務',{exact:true}).selectOption('WK-interrupted');
  await page.getByRole('button',{name:'立即更新'}).click();await page.waitForFunction(()=>document.querySelector('#cards').textContent.includes('2,400'));
  assert.match(await page.locator('#runs').innerText(),/紀錄為執行中/);checks.push(`${viewport.width}:changed-running-projection`);
  mode='error';await page.getByRole('button',{name:'立即更新'}).click();await page.waitForFunction(()=>document.querySelector('#status').classList.contains('error'));
  assert.equal(await page.locator('#detail').isVisible(),false);await page.screenshot({path:path.join(output,`${viewport.width}-stale.png`),fullPage:true});checks.push(`${viewport.width}:stale-hidden`);
  mode='real';await page.getByRole('button',{name:'立即更新'}).click();await page.waitForFunction(()=>!document.querySelector('#status').classList.contains('error'));checks.push(`${viewport.width}:read-recovery`);
  await page.unroute('**/api/snapshot');
  await page.getByRole('button',{name:'任務總覽',exact:true}).focus();await page.keyboard.press('Tab');assert.equal(await page.getByRole('button',{name:'任務詳情',exact:true}).evaluate(el=>el===document.activeElement),true);
  let releaseLoading;
  const loaded=new Promise(resolve=>{releaseLoading=resolve;});
  await page.route('**/api/snapshot',async route=>{await loaded;await route.continue();});
  await page.goto(emptyMonitor.url,{waitUntil:'domcontentloaded'});
  assert.match(await page.locator('#status').innerText(),/正在讀取/);assert.equal(await page.locator('#content').isVisible(),false);
  await page.screenshot({path:path.join(output,viewport.width+'-loading.png'),fullPage:true});
  releaseLoading();await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('尚無 task-first'));
  await page.unroute('**/api/snapshot');checks.push(viewport.width+':loading');
  assert.equal(await page.getByLabel('任務',{exact:true}).isDisabled(),true);await page.screenshot({path:path.join(output,`${viewport.width}-empty.png`),fullPage:true});checks.push(`${viewport.width}:empty`);
  await page.reload();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('缺少存取連結'));checks.push(`${viewport.width}:missing-capability`);
  assert.deepEqual(errors,[]);await page.close();
 }
 const result={pass:true,checks,real_server_states:['completed','interrupted','unobserved','working','review','accepted','empty','corrupt task and recovery'],injected_projection_states:['running update','503 stale error','held loading response'],model_calls:0};
 await fs.writeFile(path.join(output,'fixture-snapshot.json'),JSON.stringify({sample_kind:'fixture',purpose:'UI and accounting validation, not a throughput or savings benchmark',snapshot:await readMonitorSnapshot(root)},null,2)+'\n');
 await fs.writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser.close();await monitor.close();await emptyMonitor.close();await fs.rm(root,{recursive:true,force:true});await fs.rm(empty,{recursive:true,force:true});}
