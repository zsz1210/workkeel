import assert from 'node:assert/strict';
import path from 'node:path';
import {operationRows,aggregateRows} from '../src/workkeel-monitor-analytics.mjs';

// Desktop-only UI projections. No model calls or canonical task mutations.
export async function verifyObserverRelease(page,monitor,output){
 let version=0,served=-1,analysisVersion=-1,detailVersion=-1,lastAnalysis,pairedProjection=false;
 const pairedTasks=aggregateRows(operationRows(['paired','active-only'].map((kind,i)=>({id:'WK-chart-'+kind,title:kind,task_state:'done',runs:[{run_id:'chart-run',operations:[{operation_id:kind,result_recorded:true,state:'completed',coverage_complete:true,runtime_model:'chart-model',adapter_elapsed_ms:900000+i,reported_turn_duration_ms:i===0?2000:null,usage:{input_tokens:80,output_tokens:20}}]}]}))));
 await page.route('**/api/changes?*',async route=>{const data=await (await route.fetch()).json();await route.fulfill({json:{...data,changed:version!==served}});});
 await page.route('**/api/workspace',async route=>{const data=await (await route.fetch()).json();served=version;await route.fulfill({json:data});});
 await page.route('**/api/analysis?*',async route=>{const data=await (await route.fetch()).json();if(pairedProjection){data.tasks=pairedTasks;data.task_count=pairedTasks.length;}lastAnalysis=data;analysisVersion=version;await route.fulfill({json:data});});
 await page.route('**/api/task?*',async route=>{const data=await (await route.fetch()).json();data.evidence=[{path:'fixture/evidence.md',status:'verified'}];data.learning_uses=[{learning_id:'LESSON-stale',stage:'outcome',outcome:'verified',decision:'Historical fixture outcome',at:'2026-09-26T00:00:00Z',reasons:[{code:'stale-evidence',source:'fixture/evidence.md'}]}];data.goal+=' release-refresh-'+version;detailVersion=version;await route.fulfill({json:data});});
 const heartbeat=async(detail=false)=>{version++;await page.waitForFunction(()=>document.querySelector('#connection').dataset.health==='healthy');await assertEventually(()=>detail?detailVersion===version:analysisVersion===version);await page.waitForTimeout(100);};
 const assertSplit=async()=>{
  const actual=await page.locator('#usage-token-breakdown').evaluate(el=>Object.fromEntries([...el.querySelectorAll('[data-token-metric]')].map(cell=>[cell.dataset.tokenMetric,{value:cell.textContent,coverage:el.querySelector('[data-coverage-metric="'+cell.dataset.tokenMetric+'"]').textContent}])));
  for(const key of ['input','cached_input','uncached_input','output','total']){const value=lastAnalysis.totals.token_breakdown[key],c=lastAnalysis.totals.metric_coverage[key];assert.equal(actual[key].coverage,c.known+' / '+c.total);assert.equal(c.total,lastAnalysis.operation_count);if(value===null)assert.match(actual[key].value,/未知|Unknown/);else assert.equal(Number(actual[key].value.replaceAll(',','')),value);}
  const eligible=lastAnalysis.tasks.filter(r=>r.paired_operations>0&&r.paired_turn_ms!=null&&r.paired_tokens!=null);
  assert.equal(await page.locator('[data-paired-operations]').count(),eligible.length);
  for(const row of eligible){const point=page.locator('[data-paired-operations]').filter({has:page.locator('title',{hasText:row.id+' · '})});assert.equal(await point.getAttribute('data-paired-operations'),String(row.paired_operations));assert.match(await point.getAttribute('aria-label'),/配對操作|paired operations/);}
  assert.match(await page.locator('#paired-coverage').innerText(),new RegExp(eligible.length+' / '+lastAnalysis.tasks.length));
 };
 await page.goto(monitor.url);await page.waitForFunction(()=>document.querySelector('#project-name').textContent);
 await page.locator('#nav-usage').click();await page.locator('svg.chart').first().waitFor();
 await assertSplit();
 const filters=page.locator('#usage-filters'),summary=page.locator('#usage-filters > summary');
 assert.equal(await filters.evaluate(e=>e.open),false);
 assert.equal(await page.getByRole('button',{name:'模型',exact:true}).getAttribute('aria-pressed'),'true');
 assert.equal(await page.getByRole('button',{name:'任務',exact:true}).count(),1);
 assert.ok(await filters.evaluate(e=>e.getBoundingClientRect().bottom<document.querySelector('.section-head').getBoundingClientRect().bottom));
 await summary.click();await page.locator('#usage-model').selectOption('fixture-local-model');
 await page.waitForFunction(()=>document.querySelector('.summary-metrics').textContent.includes('300'));
 await assertSplit();
 // The local fixture reports input/output but no cache. Neither missing cache nor
 // derived uncached input may be silently displayed as measured zero.
 assert.equal(lastAnalysis.totals.token_breakdown.cached_input,null);assert.equal(lastAnalysis.totals.token_breakdown.uncached_input,null);
 assert.match(await page.locator('#usage-token-breakdown [data-token-metric="cached_input"]').innerText(),/未知/);
 await page.locator('#usage-model').focus();await page.evaluate(()=>{window.releaseFilter=document.activeElement;window.releaseScroll=scrollY;});
 await heartbeat();assert.deepEqual(await page.evaluate(()=>({same:releaseFilter===document.activeElement,open:document.querySelector('#usage-filters').open,value:releaseFilter.value,scroll:Math.abs(scrollY-releaseScroll)<2})),{same:true,open:true,value:'fixture-local-model',scroll:true});
 await assertSplit();
 await summary.click();await heartbeat();assert.equal(await filters.evaluate(e=>e.open),false);assert.match(await summary.innerText(),/fixture-local-model/);
 await summary.focus();await page.keyboard.press('Enter');await page.locator('#usage-model').selectOption('all');await page.waitForFunction(()=>document.querySelector('.summary-metrics').textContent.includes('2,860'));assert.match(await summary.innerText(),/全部資料/);
 await summary.click();await page.locator('#nav-settings').click();await page.locator('#language').selectOption('en');await page.locator('#nav-usage').click();await page.locator('svg.chart').first().waitFor();
 assert.equal(await page.getByRole('button',{name:'Model',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await page.getByRole('button',{name:'Task',exact:true}).count(),1);assert.match(await summary.innerText(),/All data/);assert.equal(await filters.evaluate(e=>e.open),false);
 await assertSplit();assert.match(await page.locator('#usage-token-breakdown').innerText(),/Input \(includes cache\)/);
 // A bounded chart projection exercises positive pairing and excludes a record
 // that has tokens plus active/tool time but no explicit full-turn duration.
 pairedProjection=true;await heartbeat();await assertSplit();
 assert.equal(await page.locator('[data-paired-operations]').count(),1);
 const pairedPoint=page.locator('[data-paired-operations]');assert.equal(await pairedPoint.getAttribute('data-key'),'WK-chart-paired');assert.match(await pairedPoint.getAttribute('aria-label'),/2\.0 s.*100 tokens.*1 paired operations/);
 assert.match(await page.locator('#paired-coverage').innerText(),/1 \/ 2.*omitted 1/);
 pairedProjection=false;await heartbeat();await assertSplit();
 await page.screenshot({path:path.join(output,'observer-release-usage-desktop.png'),fullPage:true});
 await page.locator('#nav-board').click();await page.locator('[data-task-id="WK-unobserved"]').click();await page.locator('#task-evidence').waitFor();
 assert.equal(await page.locator('#task-evidence').evaluate(e=>e.open),false);assert.equal(await page.locator('#task-evidence .panel').isVisible(),false);
 await page.locator('#task-evidence > summary').click();await page.locator('#task-evidence > summary').focus();
 await page.evaluate(()=>{window.releaseEvidence=document.querySelector('#task-evidence');window.releaseDrawerScroll=document.querySelector('#drawer').scrollTop;});
 await heartbeat(true);assert.deepEqual(await page.evaluate(()=>({same:releaseEvidence===document.querySelector('#task-evidence'),open:releaseEvidence.open,focus:document.activeElement===releaseEvidence.querySelector('summary'),scroll:Math.abs(document.querySelector('#drawer').scrollTop-releaseDrawerScroll)<2})),{same:true,open:true,focus:true,scroll:true});
 await page.locator('#task-evidence > summary').click();await heartbeat(true);assert.equal(await page.locator('#task-evidence').evaluate(e=>e.open),false);
 await page.screenshot({path:path.join(output,'observer-release-evidence-desktop.png'),fullPage:true});
 await page.locator('#detail-tabs').getByRole('button',{name:'Skills',exact:true}).click();
 const learning=page.locator('#detail-content');assert.match(await learning.innerText(),/Verified outcome/);assert.match(await learning.innerText(),/Evidence needs review/);assert.match(await learning.innerText(),/Historical fixture outcome/);
 for(const pattern of ['**/api/changes?*','**/api/workspace','**/api/analysis?*','**/api/task?*'])await page.unroute(pattern);
 return {width:1440,default_model:true,bilingual_group_labels:true,token_split_coverage:true,missing_cache_unknown:true,paired_turn_scatter:true,filters_collapsed:true,active_filter_recovery:true,filter_focus_scroll_retained:true,evidence_collapsed:true,evidence_focus_scroll_retained:true,live_open_and_closed_retained:true,stale_use_warning:true,model_calls:0};
}
async function assertEventually(check){for(let i=0;i<80;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(check(),'heartbeat delivered the updated projection');}
