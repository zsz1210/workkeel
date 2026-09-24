import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {createMonitorFixture} from './workkeel-monitor-fixture.mjs';
import {startTaskMonitor} from '../src/workkeel-monitor.mjs';

const output=path.resolve('output/playwright/workkeel-monitor');await fs.mkdir(output,{recursive:true});
const root=await createMonitorFixture(),empty=await createMonitorFixture({empty:true});
const monitor=await startTaskMonitor(root),emptyMonitor=await startTaskMonitor(empty);
const browser=await chromium.launch({channel:'chrome',headless:true});
const checks=[];let page;
try {
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
  page=await browser.newPage({viewport,reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(monitor.url);await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Read-only snapshot'));
  assert.equal(new URL(page.url()).hash,'');
  for(const state of ['completed','interrupted','unobserved']) {
   await page.getByLabel('Task',{exact:true}).selectOption('WK-'+state);
   await page.waitForFunction(s=>document.querySelector('#detail-title').textContent.includes(s==='unobserved'?'Unobserved':s),state);
   const cards=await page.locator('#cards').innerText();assert.match(cards,state==='completed'?/1,200/:state==='interrupted'?/>= 1,200 \(partial\)/:/Unknown/);
   assert.equal(await page.locator('#detail-title img').count(),0);
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
  await page.getByLabel('Task',{exact:true}).focus();await page.keyboard.press('Tab');assert.equal(await page.getByRole('button',{name:'Refresh now'}).evaluate(el=>el===document.activeElement),true);
  await page.goto(emptyMonitor.url);await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('No task-first'));
  assert.equal(await page.getByLabel('Task',{exact:true}).isDisabled(),true);await page.screenshot({path:path.join(output,`${viewport.width}-empty.png`),fullPage:true});checks.push(`${viewport.width}:empty`);
  await page.reload();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Access link missing'));checks.push(`${viewport.width}:missing-capability`);
  assert.deepEqual(errors,[]);await page.close();
 }
 const result={pass:true,checks,real_server_states:['completed','interrupted','unobserved','empty'],injected_projection_states:['running update','503 stale error'],model_calls:0};
 await fs.writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser.close();await monitor.close();await emptyMonitor.close();await fs.rm(root,{recursive:true,force:true});await fs.rm(empty,{recursive:true,force:true});}
