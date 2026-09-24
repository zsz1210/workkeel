import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {createMonitorFixture} from './workkeel-monitor-fixture.mjs';
import {startTaskMonitor} from '../src/workkeel-monitor.mjs';
import {recordTaskObservation} from '../src/workkeel-task-summary.mjs';
import {readNativeTask} from '../src/workkeel-tasks.mjs';

const output=path.resolve('output/playwright/workkeel-monitor');await fs.mkdir(output,{recursive:true});
const root=await createMonitorFixture(),empty=await createMonitorFixture({empty:true});
const observed=await readNativeTask(root,'WK-completed');
await recordTaskObservation(root,observed.id,{schema_version:'workkeel.task-observation/v1',task_id:observed.id,task_version:observed.version,actor:observed.contract.actor,candidate_revision:null,observed_at:new Date().toISOString(),source:'Synthetic browser check',sample_kind:'fixture',comparison_group:null,checks:[{name:'Fixture check',status:'pass',evidence_ref:'docs/approval.md'}],links:{conversation:'codex://threads/01a0d1d2-b5ee-7c90-b7c5-178e65725b86',pull_request:'https://github.com/example/project/pull/1'},note:'Synthetic observation, not task acceptance.'});
const monitor=await startTaskMonitor(root),emptyMonitor=await startTaskMonitor(empty);
const browser=await chromium.launch({channel:'chrome',headless:true});
const checks=[];let page;
try {
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
  page=await browser.newPage({viewport,reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(monitor.url);await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Read-only snapshot'));
  assert.equal(new URL(page.url()).hash,'');
  assert.equal(await page.locator('#task-list button').count(),3);
  await page.screenshot({path:path.join(output,`${viewport.width}-overview.png`),fullPage:true});
  await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
  await page.screenshot({path:path.join(output,`${viewport.width}-dark.png`),fullPage:true});
  await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
  checks.push(`${viewport.width}:dark-layout`);
  await page.getByLabel('Search',{exact:true}).fill('no-match');
  assert.match(await page.locator('#task-list').innerText(),/No matching/);
  await page.getByLabel('Search',{exact:true}).fill('');
  await page.getByRole('button',{name:'Usage & quality',exact:true}).click();
  assert.match(await page.locator('#quality-table').innerText(),/Not reviewed/);
  await page.screenshot({path:path.join(output,`${viewport.width}-quality.png`),fullPage:true});
  await page.getByRole('button',{name:'Task detail',exact:true}).click();
  checks.push(`${viewport.width}:overview-search-quality-navigation`);
  for(const state of ['completed','interrupted','unobserved']) {
   await page.getByLabel('Task',{exact:true}).selectOption('WK-'+state);
   await page.waitForFunction(s=>document.querySelector('#detail-title').textContent.includes(s==='unobserved'?'Unobserved':s),state);
   const cards=await page.locator('#cards').innerText();assert.match(cards,state==='completed'?/1,200/:state==='interrupted'?/>= 1,200 \(partial\)/:/Unknown/);
   assert.equal(await page.locator('#detail-title img').count(),0);
   if(state==='completed'){
    assert.equal(await page.getByRole('link',{name:'Open pull request'}).getAttribute('href'),'https://github.com/example/project/pull/1');
    assert.match(await page.locator('#evidence').innerText(),/not current-candidate evidence/);
   }
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:path.join(output,`${viewport.width}-${state}.png`),fullPage:true});checks.push(`${viewport.width}:${state}`);
  }
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
  await page.getByLabel('Task',{exact:true}).selectOption('WK-interrupted');
  await page.getByRole('button',{name:'Refresh now'}).click();await page.waitForFunction(()=>document.querySelector('#cards').textContent.includes('2,400'));
  assert.match(await page.locator('#runs').innerText(),/running/);checks.push(`${viewport.width}:changed-running-projection`);
  mode='error';await page.getByRole('button',{name:'Refresh now'}).click();await page.waitForFunction(()=>document.querySelector('#status').classList.contains('error'));
  assert.equal(await page.locator('#detail').isVisible(),false);await page.screenshot({path:path.join(output,`${viewport.width}-stale.png`),fullPage:true});checks.push(`${viewport.width}:stale-hidden`);
  mode='real';await page.getByRole('button',{name:'Refresh now'}).click();await page.waitForFunction(()=>!document.querySelector('#status').classList.contains('error'));checks.push(`${viewport.width}:read-recovery`);
  await page.unroute('**/api/snapshot');
  await page.getByRole('button',{name:'Work overview',exact:true}).focus();await page.keyboard.press('Tab');assert.equal(await page.getByRole('button',{name:'Task detail',exact:true}).evaluate(el=>el===document.activeElement),true);
  await page.goto(emptyMonitor.url);await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('No task-first'));
  assert.equal(await page.getByLabel('Task',{exact:true}).isDisabled(),true);await page.screenshot({path:path.join(output,`${viewport.width}-empty.png`),fullPage:true});checks.push(`${viewport.width}:empty`);
  await page.reload();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Access link missing'));checks.push(`${viewport.width}:missing-capability`);
  assert.deepEqual(errors,[]);await page.close();
 }
 const result={pass:true,checks,real_server_states:['completed','interrupted','unobserved','empty'],injected_projection_states:['running update','503 stale error'],model_calls:0};
 await fs.writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser.close();await monitor.close();await emptyMonitor.close();await fs.rm(root,{recursive:true,force:true});await fs.rm(empty,{recursive:true,force:true});}
