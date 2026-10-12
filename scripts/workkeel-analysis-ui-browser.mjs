import assert from 'node:assert/strict';
import path from 'node:path';

// UI projections only. No model calls and no mutation of real task records.
export async function verifyAnalysisUI(page,monitor,output){
 let mode='running',reportAt=new Date().toISOString();
 await page.route('**/api/changes?*',async route=>{const data=await (await route.fetch()).json();await route.fulfill({json:{...data,changed:true}});});
 await page.route('**/api/task?*',async route=>{
  const data=await (await route.fetch()).json();
  data.title='讓執行時間更有意義';data.goal='只計已回報的 AI 執行時間，排除人工等待。';
  data.task_state=mode==='done'?'done':mode==='waiting'?'release_gate':'build';
  data.runs=[{run_id:'analysis-ui-fixture',runner_state:mode==='paused'?'paused':'running',last_observed_at:reportAt==='near-expiry'?new Date(Date.now()-52000).toISOString():reportAt,operations:[{operation_id:'recorded',result_recorded:true,coverage_complete:false,activity_kind:'implementation',runtime_model:'fixture-model',execution_intervals:[{started_at:'2026-01-01T00:00:00Z',completed_at:'2026-01-01T00:05:00Z'}],adapter_elapsed_ms:300000,usage:{input_tokens:0,output_tokens:0}}]}];
  data.timeline=[{state:'intake',at:'2026-01-01T00:00:00Z'},{state:'build',at:'2026-01-01T00:00:01Z'},{state:'test',at:'2026-01-01T00:06:00Z'},{state:'build',action:'rework',at:'2026-01-01T00:07:00Z'}];
  delete data.execution;
  await route.fulfill({json:data});
 });
 for(const width of [1440,390]){
  mode='running';reportAt=new Date().toISOString();
  await page.setViewportSize({width,height:width===390?844:1000});
  await page.emulateMedia({reducedMotion:'no-preference',colorScheme:'dark'});
  await page.goto(monitor.url);await page.locator('#nav-board').click();
  await page.waitForFunction(()=>document.querySelector('.task-card'));
  assert.equal(await page.locator('#search').isVisible(),false);
  await page.locator('#search-filters > summary').focus();await page.keyboard.press('Enter');
  await page.locator('#search').fill('WK-working');await page.locator('.task-card').waitFor();
  assert.match(await page.locator('#search-filter-count').innerText(),/1/);
  await page.locator('#search-filters > summary').click();
  await page.waitForTimeout(2200);assert.equal(await page.locator('#search').isVisible(),false);
  assert.equal(await page.locator('.task-card').count(),1);
  await page.locator('.task-card').click();await page.locator('#task-flow').waitFor();
  await page.locator('#expand-task').click();await page.locator('.task-full-page').waitFor();
  await page.waitForFunction(()=>document.querySelector('#task-flow')?.dataset.moving==='true');
  assert.match(await page.locator('.flow-status').innerText(),/近期回報/);
  const current=page.locator('.task-flow-card[aria-current=step]');
  assert.equal(await current.evaluate(el=>getComputedStyle(el,'::after').animationName),'task-flow-scan');
  assert.equal(await page.locator('.task-flow-node[data-key="test"] .flow-record').innerText(),'曾到達');
  assert.equal(await page.locator('.task-flow-node[data-key="release_gate"] .flow-record').innerText(),'尚無紀錄');
  const flowBefore=await page.locator('#task-flow').boundingBox();
  await current.focus();await page.keyboard.press('Enter');
  const popup=page.locator('.help-popover:popover-open');await popup.waitFor();
  assert.match(await popup.innerText(),/退回修正/);
  assert.deepEqual(await page.locator('#task-flow').boundingBox(),flowBefore);
  const bounds=await popup.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width&&bounds.y>=0&&bounds.y+bounds.height<=page.viewportSize().height);
  await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelector('.task-flow-card[aria-current=step]')?.getAttribute('aria-expanded')==='false');
  await current.click();await page.locator('.flow-status').click();assert.equal(await popup.count(),0);
  await page.screenshot({path:path.join(output,width+'-analysis-flow.png'),fullPage:false});
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await current.evaluate(el=>getComputedStyle(el,'::after').animationName),'none');
  await page.emulateMedia({reducedMotion:'no-preference'});
  const time=page.getByText('AI 執行時間（含工具）',{exact:true}).locator('..').locator('..').locator('dd');
  const measured=await time.innerText();assert.match(measured,/5 分/);assert.match(measured,/部分/);
  for(const [next,label] of [['paused','暫停或中斷'],['waiting','等待下一步'],['done','已完成']]){
   mode=next;await page.waitForFunction(label=>document.querySelector('.flow-status')?.textContent.includes(label),label);
   assert.equal(await page.locator('#task-flow').getAttribute('data-moving'),'false');assert.equal(await time.innerText(),measured);
  }
  mode='running';reportAt=new Date(Date.now()-61000).toISOString();
  await page.waitForFunction(()=>document.querySelector('.flow-status')?.textContent.includes('等待最新執行回報'));assert.equal(await time.innerText(),measured);
  // Expiry must happen even when polling hangs before it can report a change.
  reportAt='near-expiry';await page.waitForFunction(()=>document.querySelector('#task-flow')?.dataset.moving==='true');
  await page.unroute('**/api/changes?*');
  let releasePoll,held=false;
  await page.route('**/api/changes?*',async route=>{held=true;await new Promise(resolve=>{releasePoll=resolve;});const data=await (await route.fetch()).json();await route.fulfill({json:{...data,changed:false}});});
  try{
   await page.waitForFunction(()=>document.querySelector('#task-flow')?.dataset.moving==='false',null,{timeout:10000});
   assert.equal(held,true,'expiry is checked with a poll still pending');
   assert.match(await page.locator('.flow-status').innerText(),/等待最新執行回報/);
  }finally{releasePoll?.();await page.unroute('**/api/changes?*');}
  await page.route('**/api/changes?*',async route=>{const data=await (await route.fetch()).json();await route.fulfill({json:{...data,changed:false}});});
  assert.equal(await time.innerText(),measured);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('.back-link').click();assert.equal(await page.locator('#search').inputValue(),'WK-working');assert.match(await page.locator('#search-filter-count').innerText(),/1/);
  await page.locator('#search-filters > summary').click();await page.locator('#reset-search').click();assert.equal(await page.locator('.task-card').count(),6);
  await page.locator('#nav-usage').click();await page.locator('#usage-filters').waitFor();
  assert.equal(await page.locator('#usage-filters').evaluate(el=>el.open),false);
  await page.locator('#usage-filters > summary').click();await page.locator('#usage-days').selectOption('7');
  await page.waitForFunction(()=>document.querySelector('#usage-filters .filter-summary')?.textContent.startsWith('1'));
  await page.locator('#usage-filters').getByRole('button',{name:'清除篩選',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#usage-filters .filter-summary')?.textContent==='全部資料');
  await page.unroute('**/api/changes?*');
  await page.route('**/api/changes?*',async route=>{const data=await (await route.fetch()).json();await route.fulfill({json:{...data,changed:true}});});
 }
 await page.unroute('**/api/task?*');await page.unroute('**/api/changes?*');
 return {analysis_ui:true,widths:[1440,390],filters:true,keyboard:true,popover_no_shift:true,reduced_motion:true,wait_excluded:true,stale_expiry:true,rework_history:true,fixture_only:true};
}
