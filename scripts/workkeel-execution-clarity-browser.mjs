import assert from 'node:assert/strict';
import {executionSummary} from '../src/workkeel-monitor-analytics.mjs';

// Deterministic desktop regression data; no model execution or historical edits.
export async function verifyExecutionClarity(page,monitor){
 let attempts=0,fail=false,hold=false,release,held,changes=0;
 await page.route('**/api/analysis?*',async route=>{
  attempts++;
  if(fail)return route.fulfill({status:503,json:{error:'fixture-unavailable'}});
  if(attempts<=3)return route.fulfill({status:429,json:{error:'fixture-busy'}});
  if(hold){hold=false;held?.();await new Promise(resolve=>{release=resolve;});}
  return route.continue();
 });
 await page.goto(monitor.url);await page.waitForFunction(()=>document.querySelector('#project-name').textContent);
 await page.locator('#nav-usage').click();await page.locator('svg.chart').first().waitFor();
 assert.equal(attempts,4,'busy source recovers beyond the former three-attempt limit');
 await page.locator('#usage-filters > summary').click();
 fail=true;await page.locator('#usage-model').selectOption('fixture-local-model');await page.locator('.view-error').waitFor();
 // A workspace update must not replace a known error with an endless loading view.
 await page.route('**/api/changes?*',async route=>{const response=await route.fetch(),data=await response.json();changes++;await route.fulfill({json:{...data,changed:true}});});
 await page.waitForFunction(()=>document.querySelector('.view-error'));
 const start=changes;await page.waitForTimeout(2300);assert.ok(changes>start);assert.equal(await page.locator('.view-error').isVisible(),true);
 fail=false;await page.getByRole('button',{name:'重新讀取',exact:true}).click();await page.locator('svg.chart').first().waitFor();
 assert.match(await page.locator('.summary-metrics').innerText(),/300/);
 // Error recovery remounts the view; its new disclosure starts collapsed.
 await page.locator('#usage-filters > summary').click();
 // Hold one query over a heartbeat, then choose a newer filter. Only the latest wins.
 const pending=new Promise(resolve=>{held=resolve;});hold=true;
 await page.locator('#usage-model').selectOption('all');await pending;
 await page.locator('#usage-model').selectOption('fixture-local-model');await page.waitForTimeout(2200);release();
 await page.waitForFunction(()=>document.querySelector('#usage-model')?.value==='fixture-local-model'&&document.querySelector('.summary-metrics')?.textContent.includes('300'));
 await page.unroute('**/api/changes?*');await page.unroute('**/api/analysis?*');
 await page.route('**/api/task?*',async route=>{
  const response=await route.fetch(),task=await response.json(),at=Date.parse('2026-09-26T09:00:00Z');
  const op=(id,kind,offset,ms,model)=>({operation_id:id,execution_id:'execution-'+id,activity_kind:kind,tool:'fixture-host',runtime_model:model,reported_reasoning:'high',requested_reasoning:{name:'effort',value:'xhigh'},selection_reason:'classifier-advisory',result_recorded:true,coverage_complete:true,state:'completed',dispatched_at:new Date(at+offset).toISOString(),execution_intervals:ms===null?[]:[{started_at:new Date(at+offset).toISOString(),completed_at:new Date(at+offset+ms).toISOString()}],adapter_elapsed_ms:ms,usage:{input_tokens:120,output_tokens:30}});
  task.runs=[{run_id:'clarity',operations:[op('build','implementation',0,20000,'local-model'),op('review','review',10000,7000,'review-model'),op('repair','repair',25000,null,'repair-model')]}];
  task.execution=executionSummary(task);task.timeline=[{at:new Date(at).toISOString(),state:'build',action:'claim',actor:{agent_id:'agent-lulu',principal_id:'human'}}];
  await route.fulfill({json:task});
 });
 await page.locator('#nav-board').click();await page.locator('[data-task-id="WK-unobserved"]').click();await page.locator('#execution-breakdown').waitFor();
 const phase=label=>page.locator('#lifecycle .phase-row').filter({has:page.getByText(label,{exact:true})});
 assert.match(await phase('審查').innerText(),/7/);assert.match(await phase('修正').innerText(),/未記錄工時/);
 const overview=await page.locator('#execution-breakdown').innerText();
 for(const text of ['local-model','review-model','repair-model','實作 · 執行 01','審查 · 執行 02','修正 · 執行 03','最多 2','150'])assert.ok(overview.includes(text),text);
 assert.doesNotMatch(overview,/\[object|xhigh/);assert.doesNotMatch(await page.locator('#detail-content').innerText(),/agent-lulu/);
 await page.getByText('紀錄識別',{exact:true}).click();assert.match(await page.locator('#detail-content').innerText(),/agent-lulu/);
 await page.getByRole('button',{name:'查看每次執行',exact:true}).click();await page.locator('#execution-breakdown-full').waitFor();
 await page.locator('details[id^="operation-"] > summary').nth(1).click();
 await page.getByText('選模與執行識別',{exact:true}).nth(1).click();
 assert.match(await page.locator('#detail-content').innerText(),/execution-review/);
 assert.match(await page.locator('#detail-content').innerText(),/本機分類器依專案政策選擇/);
 await page.unroute('**/api/task?*');
 return {execution_clarity:true,busy_recovery:true,visible_retry:true,error_survives_heartbeat:true,latest_filter_wins:true,actual_models_reasoning:true,review_time:true,repair_unknown:true,overlap:true,technical_actor_identity:true,model_calls:0};
}
