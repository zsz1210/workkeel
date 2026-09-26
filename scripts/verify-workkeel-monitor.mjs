import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {createObserverFixture} from './workkeel-observer-fixture.mjs';
import {createMonitorFixture} from './workkeel-monitor-fixture.mjs';
import {startTaskMonitor} from '../src/workkeel-monitor.mjs';
import {createObserverIndex} from '../src/workkeel-observer-index.mjs';
import {verifyExecutionClarity} from './workkeel-execution-clarity-browser.mjs';
import {verifyObserverRelease} from './workkeel-observer-release-browser.mjs';

// Focused desktop reproduction of the four independent observer-review findings.
// The default gate also runs these checks after its existing responsive coverage.
const regressionsOnly=process.env.OBSERVER_REGRESSIONS_ONLY==='1';
const clarityOnly=process.env.OBSERVER_CLARITY_ONLY==='1';
const followupOnly=process.env.OBSERVER_FOLLOWUP_ONLY==='1';
const liveOnly=process.env.OBSERVER_LIVE_ONLY==='1';
const executionOnly=process.env.OBSERVER_EXECUTION_ONLY==='1';
const releaseOnly=process.env.OBSERVER_RELEASE_ONLY==='1';
const focusedOnly=regressionsOnly||clarityOnly||followupOnly||liveOnly||executionOnly||releaseOnly;
async function verifyLiveState(page,monitor,root){
 let version=0,served=-1,workspaceRequests=0,hold=false,release,held;
 await page.route('**/api/changes?*',async route=>{const response=await route.fetch(),data=await response.json();await route.fulfill({json:{...data,changed:version!==served}});});
 await page.route('**/api/workspace',async route=>{workspaceRequests++;served=version;const response=await route.fetch(),data=await response.json();data.project.name='Live fixture '+version;await route.fulfill({json:data});});
 await page.route('**/api/task?*',async route=>{const response=await route.fetch(),data=await response.json();data.goal+=' live-change-'+version;for(const doc of data.documents??[])doc.digest='live-'+version;if(hold){hold=false;held?.();await new Promise(resolve=>{release=resolve;});}await route.fulfill({json:data});});
 await page.route('**/api/document?*',async route=>{const response=await route.fetch(),data=await response.json();await route.fulfill({json:{...data,digest:'live-'+version}});});
 await page.goto(monitor.url);await page.waitForFunction(()=>document.querySelector('#project-name').textContent==='Live fixture 0');
 await page.locator('#nav-board').click();await page.locator('[data-task-id="WK-unobserved"]').click();await page.locator('#handoff-details').waitFor();
 await page.locator('#handoff-details summary').click();
 await page.evaluate(()=>{const input=document.querySelector('#handoff-text');input.hidden=false;input.value='retained selection';input.focus();input.setSelectionRange(2,8);});
 await page.locator('#lifecycle .help button').click();
 await page.evaluate(()=>{const input=document.querySelector('#handoff-text');input.focus({preventScroll:true});input.setSelectionRange(2,8);window.liveNodes={details:document.querySelector('#handoff-details'),input,pop:document.querySelector('.help-popover:popover-open'),surface:document.querySelector('#detail-surface'),scroll:document.querySelector('#drawer').scrollTop};});
 const initialRequests=workspaceRequests;await page.waitForTimeout(2300);assert.equal(workspaceRequests,initialRequests,'unchanged heartbeat must not reload workspace');
 version++;await page.waitForFunction(()=>document.querySelector('#detail-content').textContent.includes('live-change-1'));
 assert.deepEqual(await page.evaluate(()=>({details:liveNodes.details===document.querySelector('#handoff-details'),open:liveNodes.details.open,input:liveNodes.input===document.activeElement,selection:[liveNodes.input.selectionStart,liveNodes.input.selectionEnd],popover:liveNodes.pop.matches(':popover-open'),surface:liveNodes.surface===document.querySelector('#detail-surface'),scroll:Math.abs(liveNodes.scroll-document.querySelector('#drawer').scrollTop)<2})),{details:true,open:true,input:true,selection:[2,8],popover:true,surface:true,scroll:true});
 await page.keyboard.press('Escape');await page.locator('#handoff-details summary').click();version++;await page.waitForFunction(()=>document.querySelector('#detail-content').textContent.includes('live-change-2'));assert.equal(await page.locator('#handoff-details').evaluate(e=>e.open),false);
 await page.locator('#expand-task').click();await page.locator('.task-full-page').waitFor();
 await page.evaluate(()=>{window.scrollTo(0,400);window.fullNode=document.querySelector('.task-full-page');window.fullScroll=scrollY;});version++;await page.waitForFunction(()=>document.querySelector('#detail-content').textContent.includes('live-change-3'));assert.equal(await page.evaluate(()=>fullNode===document.querySelector('.task-full-page')&&Math.abs(fullScroll-scrollY)<2),true);
 await page.locator('#nav-activity').click();await page.locator('#activity-events').waitFor();await page.locator('#activity-events > summary').click();version++;await page.waitForFunction(()=>document.querySelector('#project-name').textContent==='Live fixture 4');await page.waitForTimeout(150);assert.equal(await page.locator('#activity-events').evaluate(e=>e.open),false,'default-open disclosure stays closed');
 await page.locator('#nav-board').click();await page.locator('[data-task-id="WK-unobserved"]').click();await page.locator('#handoff-details').waitFor();
 const pending=new Promise(resolve=>{held=resolve;});hold=true;version++;await pending;
 await page.locator('#close-drawer').click();await page.locator('[data-task-id="WK-working"]').click();release();await page.waitForFunction(()=>document.querySelector('#detail-id').textContent==='WK-working'&&document.querySelector('#handoff-details'));
 assert.equal(await page.locator('#detail-id').innerText(),'WK-working');
 await page.getByRole('button',{name:'文件',exact:true}).click();await page.locator('#detail-content button').first().click();await page.waitForFunction(()=>document.querySelector('#document-body').textContent.includes('Approved synthetic'));
 const text=await page.locator('#document-body').innerText();await page.evaluate(()=>{window.documentNode=document.querySelector('#document-body').firstChild;});version++;
 await page.waitForFunction(()=>document.querySelector('#document-status').textContent.includes('來源已更新'));assert.equal(await page.locator('#document-body').innerText(),text);assert.equal(await page.evaluate(()=>documentNode===document.querySelector('#document-body').firstChild),true);assert.equal(await page.locator('#detail-tabs [aria-current="page"]').innerText(),'文件');
 await page.unroute('**/api/changes?*');await page.unroute('**/api/workspace');await page.unroute('**/api/task?*');await page.unroute('**/api/document?*');
 await page.locator('#close-document').click();await page.locator('#close-drawer').click();await page.locator('#nav-learning').click();await page.getByRole('button',{name:'技能庫',exact:true}).click();await page.locator('#search').fill('copper kestrel');await page.getByRole('button',{name:'custom-check',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#document-body').textContent.includes('copper kestrel'));
 const original=await page.locator('#document-body').innerText();await fs.appendFile(path.join(root,'.agents/skills/custom-check/SKILL.md'),'\nLive-state source update.\n');await page.waitForFunction(()=>document.querySelector('#document-status').textContent.includes('來源已更新'));assert.equal(await page.locator('#document-body').innerText(),original);
 return {live_state:true,changed_data:true,heartbeat:true,node_identity:true,focus_selection:true,open_closed_disclosures:true,help:true,drawer_fullscreen_scroll:true,stale_task_response:true,document_update_notice:true,task_tab:true,actual_library_file_change:true};
}
async function verifyObserverRegressions(page,monitor,root,index){
 const waitText=(selector,text)=>page.waitForFunction(({selector,text})=>document.querySelector(selector)?.textContent.includes(text),{selector,text});
 const healthField=label=>page.locator('#connection-detail .setting').filter({has:page.locator('dt').getByText(label,{exact:true})}).locator('dd');
 const access=new URL(monitor.url),headers={Authorization:'Bearer '+access.hash.slice(1)};
 await page.goto(monitor.url);await page.waitForFunction(()=>document.querySelector('#connection').dataset.health==='healthy');

 await page.locator('#nav-board').click();await page.locator('#search').fill('Unobserved');
 await page.locator('.task-card').click();await page.locator('#lifecycle').waitFor();
 await page.locator('#expand-task').click();await page.locator('.task-full-page').waitFor();
 await page.locator('#nav-backlog').click();await page.locator('#state-filter').selectOption('test');
 await page.locator('#search').fill('review');await waitText('#content tbody','WK-review');
 await page.locator('#content tbody button').first().click();await page.locator('#lifecycle').waitFor();
 await page.locator('#expand-task').click();await page.locator('.task-full-page').waitFor();
 assert.match(await page.locator('.back-link').innerText(),/任務文件/);
 await page.locator('.back-link').click();await page.waitForFunction(()=>!document.querySelector('.task-full-page'));
 assert.equal(new URL(page.url()).searchParams.get('view'),'backlog');
 assert.equal(await page.locator('#nav button[aria-current="page"]').getAttribute('id'),'nav-backlog');
 assert.equal(await page.locator('#search').inputValue(),'review');
 assert.equal(await page.locator('#state-filter').inputValue(),'test');
 await waitText('#content tbody','WK-review');

 await page.locator('#nav-backlog').click();await waitText('#content tbody','WK-interrupted');
 const tasksResponse=await fetch(access.origin+'/api/tasks',{headers});assert.equal(tasksResponse.status,200);
 const interrupted=(await tasksResponse.json()).items.find(task=>task.id==='WK-interrupted');
 assert.equal(interrupted.execution.time_complete,false);assert.equal(interrupted.execution.tokens_complete,false);
 assert.ok(interrupted.execution.execution_ms>0);assert.equal(interrupted.execution.tokens,1280);
 const row=page.locator('#content tbody tr').filter({hasText:'WK-interrupted'});
 for(const column of [2,3]){
  const cell=row.locator('td').nth(column);assert.match(await cell.innerText(),/\*/,'partial subtotals have a visible marker');
  const explanation=await cell.evaluate(el=>[el,...el.querySelectorAll('*')].map(node=>[
   node.getAttribute('aria-label'),...(node.getAttribute('aria-describedby')??'').split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)?.textContent)
  ].filter(Boolean).join(' ')).join(' '));
  assert.match(explanation,/部分|partial/i,'both metric cells identify partial data to assistive technology');
 }
 assert.equal(await page.locator('#content').getByText(/[＊*].*部分/).isVisible(),true,'visible Backlog guidance explains the partial marker');

 await page.locator('#nav-board').click();await page.locator('.task-card[data-task-id="WK-interrupted"]').click();await page.locator('#lifecycle').waitFor();
 await page.keyboard.press('Escape');await page.locator('#connection').click();
 const validatedBefore=await healthField('來源核對').innerText();assert.doesNotMatch(validatedBefore,/尚未確認|未知/);
 await page.keyboard.press('Escape');
 await page.locator('.task-card[data-task-id="WK-interrupted"]').click();await page.locator('#lifecycle').waitFor();
 const lock=path.join(root,'workkeel.lock'),saved=await fs.readFile(lock);
 let sourceFailure;
 try{
  await fs.writeFile(lock,'malformed isolated fixture lock');
  await page.waitForFunction(()=>document.querySelector('#connection').dataset.health==='source-error');
  const response=await fetch(access.origin+'/api/changes',{headers}),health=await response.json();
  assert.equal(response.status,200);assert.equal(health.source_status,'unavailable');
  assert.equal(await page.locator('#connection-text').innerText(),'來源無法驗證');
  assert.equal(await page.locator('.task-card').count(),0);assert.equal(await page.locator('#detail-content #lifecycle').count(),0);
  assert.match(await page.locator('#status').innerText(),/舊資料已隱藏/);
  await page.keyboard.press('Escape');await page.locator('#connection').click();
  assert.equal(await healthField('連線').innerText(),'已連線');
  assert.equal(await healthField('來源核對').innerText(),validatedBefore);
  assert.match(await page.locator('#connection-detail').innerText(),/來源/);
  sourceFailure={http_status:response.status,source_status:health.source_status,transport:'connected',last_validation_preserved:true,stale_tasks_hidden:true};
 }finally{await fs.writeFile(lock,saved);}
 await page.waitForFunction(()=>document.querySelector('#connection').dataset.health==='healthy');
 await page.keyboard.press('Escape');await page.locator('#nav-board').click();
 await page.waitForFunction(()=>document.querySelectorAll('.task-card').length===6);

 return {width:1440,focused_regressions:true,second_task_return:true,backlog_partial_accessible:true,source_failure:{...sourceFailure,recovered:true},pagination:await verifyPagination(page,index)};
}

async function verifyPagination(page,index){
 const waitText=(selector,text)=>page.waitForFunction(({selector,text})=>document.querySelector(selector)?.textContent.includes(text),{selector,text});
 const resets={usage:0,activity:0};
 await page.route('**/api/{analysis,activity}?*',async route=>{
  const url=new URL(route.request().url()),result=await index.query(url.pathname,url.searchParams);
  if(result.operations?.reset_required)resets.usage++;if(result.events?.reset_required)resets.activity++;
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
 });
 const pagination=[];
 for(const [view,id,selector,prefix] of [['usage','operation-table','#operation-table tbody tr','work-'],['activity','activity-events','#activity-events .timeline-event','event-']]){
  await page.locator('#nav-'+view).click();await page.locator('#'+id).waitFor();
  if(!await page.locator('#'+id).evaluate(el=>el.open))await page.locator('#'+id+' summary').click();
  const list=page.locator('#'+id),next=()=>list.getByRole('button',{name:'下一頁',exact:true}).click(),previous=()=>list.getByRole('button',{name:'上一頁',exact:true}).click();
  const first=async offset=>{const marker=prefix+String(offset).padStart(3,'0');await waitText(selector,marker);assert.match(await page.locator(selector).first().innerText(),new RegExp(marker));};
  const firstPage=async()=>{await first(0);assert.equal(await list.getByRole('button',{name:'上一頁',exact:true}).count(),0,'first page cannot retain a previous cursor');};
  await firstPage();await next();await first(50);await next();await first(100);await previous();await first(50);await previous();await firstPage();
  await next();await first(50);
  if(view==='usage'){await page.locator('#usage-filters > summary').click();await page.locator('#usage-model').selectOption('fixture-pagination');}
  else await page.getByRole('button',{name:'7 天',exact:true}).click();
  await firstPage();await next();await first(50);await previous();await firstPage();
  if(view==='activity'){
   await next();await first(50);await page.locator('#search').fill('Pagination fixture');
   await firstPage();await next();await first(50);await previous();await firstPage();
  }
  await next();await first(50);(await index.snapshot()).tasks[0].title+=' revision-'+view;index.invalidate('synthetic-pagination-revision-'+view);
  await next();await firstPage();assert.equal(resets[view],1,'a stale revision must exercise the index reset response');
  await next();await first(50);await previous();await firstPage();
  pagination.push({view,rows:120,sequence:[0,50,100,50,0],filter_reset:true,revision_reset:true});
 }
 return pagination;
}

async function verifyObserverClarity(page,monitor,index){
 const waitText=(selector,text)=>page.waitForFunction(({selector,text})=>document.querySelector(selector)?.textContent.includes(text),{selector,text});
 const openTask=async id=>{await page.locator('#nav-board').click();await page.locator('.task-card[data-task-id="'+id+'"]').click();await page.locator('#lifecycle').waitFor();};
 const language=async value=>{await page.locator('#nav-settings').click();await page.getByLabel('Language',{exact:true}).selectOption(value);};
 await page.goto(monitor.url);await page.waitForFunction(()=>document.querySelector('#connection').dataset.health==='healthy');await language('en');

 await page.locator('#nav-backlog').click();await waitText('#content tbody','WK-accepted');
 const current=page.getByRole('button',{name:'Current tasks 6',exact:true}),retained=page.getByRole('button',{name:'Retained history 0',exact:true});
 assert.equal(await current.getAttribute('aria-pressed'),'true');assert.equal(await retained.getAttribute('aria-pressed'),'false');
 await retained.click();await page.waitForFunction(()=>!document.querySelector('#content tbody'));
 assert.equal(await retained.getAttribute('aria-pressed'),'true');assert.match(await page.locator('#content').innerText(),/Read-only history/);
 await current.click();await waitText('#content tbody','WK-accepted');
 const acceptedRow=page.locator('#content tbody tr').filter({hasText:'WK-accepted'});
 await acceptedRow.getByRole('button',{name:/^\d+ documents$/}).click();
 await page.locator('#detail-tabs button[aria-current="page"]').filter({hasText:'Documents'}).waitFor();
 await page.locator('#detail-content').getByRole('button',{name:'docs/approval.md',exact:true}).click();await waitText('#document-body','Approved synthetic');
 await page.locator('#close-document').click();await page.locator('#close-drawer').click();
 await page.locator('#search').fill('no-matching-clarity-fixture');await waitText('#content','No tasks match');
 await page.getByRole('button',{name:'Clear filters',exact:true}).click();await waitText('#content tbody','WK-unobserved');
 assert.equal(await page.locator('#search').inputValue(),'');assert.match(await page.locator('#content').innerText(),/not reported execution measurements/);

 await openTask('WK-unobserved');assert.match(await page.locator('#detail-content').innerText(),/This task has no execution measurements/);
 assert.match(await page.locator('#lifecycle').innerText(),/No AI execution times can be assigned/);assert.equal(await page.locator('#lifecycle progress').count(),0);
 const help=page.getByRole('button',{name:'Recorded time by stage',exact:true}),before=await page.locator('#lifecycle').boundingBox();
 const circle=await help.evaluate(el=>{const rect=el.getBoundingClientRect(),target=getComputedStyle(el,'::before');return {width:rect.width,height:rect.height,radius:getComputedStyle(el).borderRadius,targetWidth:parseFloat(target.width),targetHeight:parseFloat(target.height)};});
 assert.ok(Math.abs(circle.width-16)<.1&&Math.abs(circle.height-16)<.1,'visible help circle stays compact at 16 px');
 assert.ok(circle.targetWidth>=24&&circle.targetHeight>=24,'transparent pointer target remains at least 24 px');
 assert.ok(circle.radius==='50%'||parseFloat(circle.radius)>=circle.width/2,'help control is circular');assert.equal(await help.innerText(),'?');
 await help.click();const popover=page.locator('.help-popover:popover-open');
 assert.equal(await popover.getByRole('heading',{name:'Recorded time by stage',exact:true}).isVisible(),true);
 assert.match(await popover.locator('p').first().innerText(),/reported tool execution.*implementation, review and rework/i);
 assert.match(await popover.innerText(),/start\/end intervals/);assert.match(await popover.innerText(),/waiting.*does not accumulate/s);
 assert.equal((await page.locator('#lifecycle').boundingBox()).height,before.height,'help does not shift the panel');
 await page.keyboard.press('Escape');assert.equal(await page.locator('.help-popover:popover-open').count(),0);assert.equal(await page.locator('#drawer').evaluate(el=>el.open),true);
 await page.locator('#close-drawer').click();

 await openTask('WK-accepted');
 const nativeHistory=page.locator('#detail-content .panel').filter({has:page.getByRole('heading',{name:'Task history',exact:true})});
 assert.match(await nativeHistory.innerText(),/Synthetic delivery/);assert.match(await nativeHistory.innerText(),/Synthetic review only/);
 assert.match(await nativeHistory.innerText(),/Review passed/);assert.doesNotMatch(await nativeHistory.innerText(),/accepted synthetic task/);
 assert.match(await page.locator('#detail-content .panel').last().locator('h2').innerText(),/Evidence & observations/);
 await page.locator('#close-drawer').click();

 // UI-only projection with explicit expected durations: 2 min implementation,
 // 1 min review and 30 sec rework across six hours of lifecycle history.
 const start=Date.now()-7*3600000,at=minutes=>new Date(start+minutes*60000).toISOString();
 const failedReason='Synthetic failed review: <img src=x onerror=alert(1)> needs a correction';
 const syntheticHistory=[
  {at:at(0),action:'create',state:'intake'},
  {at:at(60),action:'claim',state:'build'},
  {at:at(120),action:'handoff',state:'test',reason:'Synthetic initial delivery'},
  {at:at(180),action:'review',state:'test',reason:failedReason,outcome:'fail'},
  {at:at(190),action:'rework',state:'intake',reason:'Synthetic same-scope correction'},
  {at:at(200),action:'claim',state:'build'},
  {at:at(240),action:'handoff',state:'test',reason:'Synthetic corrected delivery'},
  {at:at(241),action:'review',state:'release_gate',reason:'Synthetic corrected review passed',outcome:'pass'},
  {at:at(360),action:'close',state:'done',reason:'Synthetic local acceptance'}
 ];
 const stageRoute='**/api/task?id=WK-completed';let partialStage=false;
 await page.route(stageRoute,async route=>{
  const response=await route.fetch(),task=await response.json();
  const intervals=[[60,62],[150,151],[220,220.5]];
  task.timeline=syntheticHistory;task.runs=[{run_id:'injected-stage-clarity',operations:intervals.map(([a,b],i)=>({operation_id:'stage-'+i,result_recorded:true,runtime_model:'fixture-clarity',dispatched_at:at(a),ended_at:at(b),adapter_elapsed_ms:(b-a)*60000,usage:{input_tokens:100,output_tokens:10}}))}];
  task.execution={execution_ms:210000,recorded_operations:3,measured_intervals:3,time_complete:true,tokens:330,tokens_complete:true};
  if(partialStage){task.runs[0].operations.push({operation_id:'stage-open',result_recorded:false,runtime_model:'fixture-clarity',dispatched_at:at(220.25)});task.execution={...task.execution,recorded_operations:4,time_complete:false,tokens_complete:false};}
  task.lifecycle={coverage:'complete-history',elapsed_ms:21600000,phases:{waiting:3600000,implementation:3600000,review:3600000,rework:3600000,acceptance:7200000}};
  await route.fulfill({response,json:task});
 });
 await openTask('WK-completed');
 for(const [label,milliseconds] of [['Implementation',120000],['Review',60000],['Rework',30000]]){
  assert.equal(Number(await page.locator('#lifecycle').getByRole('progressbar',{name:label,exact:true}).getAttribute('value')),milliseconds,'stage shows recorded work, excluding lifecycle waits');
 }
 assert.equal(await page.locator('#lifecycle').getByText(/^Partial records:/).count(),0,'complete measurements are not labeled partial');
 const injectedHistory=page.locator('#detail-content .panel').filter({has:page.getByRole('heading',{name:'Task history',exact:true})});
 assert.match(await injectedHistory.innerText(),/Review failed; corrections are required/);assert.match(await injectedHistory.innerText(),/Review passed; ready for acceptance/);
 assert.equal(await injectedHistory.getByText(failedReason,{exact:true}).isVisible(),true);assert.equal(await injectedHistory.locator('img').count(),0);
 assert.doesNotMatch(await injectedHistory.innerText(),/completed synthetic task/);
 await page.locator('#close-drawer').click();

 partialStage=true;await openTask('WK-completed');
 const partialNote=page.locator('#lifecycle').getByText(/^Partial records:/);
 assert.equal(await partialNote.isVisible(),true,'known stage subtotals remain explicitly partial when an operation is unfinished');
 assert.match(await partialNote.innerText(),/reported tool execution only/);
 await page.getByRole('button',{name:'Recorded time by stage',exact:true}).click();
 assert.match(await page.locator('.help-popover:popover-open').innerText(),/Unfinished.*not treated as zero/);
 await page.keyboard.press('Escape');
 for(const [label,milliseconds] of [['Implementation',120000],['Review',60000],['Rework',30000]]){
  assert.equal(Number(await page.locator('#lifecycle').getByRole('progressbar',{name:label,exact:true}).getAttribute('value')),milliseconds,'an unfinished operation does not invent elapsed stage time');
 }
 await page.locator('#close-drawer').click();

 await page.locator('#nav-activity').click();await page.locator('#activity-events').waitFor();
 assert.equal(await page.locator('#activity-events').evaluate(el=>el.open),true,'task events are visible on first entry');
 await page.locator('#search').fill('WK-unobserved');await waitText('#activity-events','WK-unobserved');
 await page.waitForFunction(()=>!document.querySelector('.activity-span'));
 assert.match(await page.locator('#content').innerText(),/No execution timing has been reported/);
 assert.equal(await page.locator('#activity-events .timeline-event').first().isVisible(),true);
 assert.equal(await page.locator('#state-filter').isVisible(),false,'activity offers applicable filters only');
 await language('zh-TW');await openTask('WK-completed');assert.match(await page.locator('#lifecycle > h2').innerText(),/各階段已記錄時間/);
 assert.equal(await page.locator('#lifecycle').getByText(/^部分紀錄：/).isVisible(),true);
 await page.locator('#close-drawer').click();await page.unroute(stageRoute);
 return {width:1440,focused_clarity:true,help:{circular:true,titled:true,definition_and_calculation:true,escape:true},stage_execution:{lifecycle_ms:21600000,recorded_ms:210000,implementation_ms:120000,review_ms:60000,rework_ms:30000,partial_coverage_labeled:true,unfinished_operation_not_extrapolated:true,projection:'injected UI fixture'},native_event_reasons:true,injected_review_pass_fail:true,event_reason_escaped:true,evidence_last:true,activity_events_initially_open:true,empty_execution_explained:true,backlog_counts_and_documents:true,backlog_no_matches_recovery:true,bilingual_stage_heading:true,pagination:await verifyPagination(page,index)};
}

async function verifyObserverFollowup(page,monitor){
 const access=new URL(monitor.url),changesRoute='**/api/changes?*';let healthMode='initial';
 await page.route(changesRoute,async route=>{
  if(healthMode==='offline')return route.fulfill({status:503,body:'Offline fixture'});
  const response=await route.fetch(),state=await response.json();
  if(healthMode==='initial'||healthMode==='indexing')Object.assign(state,{indexing:true,ready:false,source_status:'indexing'});
  if(healthMode==='source-error')state.source_status='unavailable';
  await route.fulfill({response,json:state});
 });
 // Explicit zero is a UI projection; ordinary task states do not provide usage.
 await page.route('**/api/workspace',async route=>{const response=await route.fetch(),data=await response.json();const task=data.tasks.find(t=>t.id==='WK-working');task.execution={...task.execution,execution_ms:0,time_complete:false,tokens:0,tokens_complete:false};await route.fulfill({response,json:data});});
 await page.goto(monitor.url);await page.waitForFunction(()=>document.querySelector('#connection').dataset.health==='indexing');
 assert.equal(await page.locator('#recent-tasks').count(),0,'initial indexing cannot present a validated snapshot');
 assert.notEqual(await page.locator('#connection-text').innerText(),'已連線');
 healthMode='healthy';await page.waitForFunction(()=>document.querySelector('#connection').dataset.health==='healthy');
 await page.locator('#nav-settings').click();await page.getByLabel('Language',{exact:true}).selectOption('en');
 assert.equal(await page.locator('#agent-identities').evaluate(el=>el.open),false);
 assert.equal(await page.locator('#agent-identities dd').isVisible(),false,'registered IDs stay out of the normal settings view');
 await page.locator('#agent-identities summary').click();assert.match(await page.locator('#agent-identities').innerText(),/builder.*reviewer/);
 assert.match(await page.locator('#agent-identities').innerText(),/not positions or job titles/);
 await page.locator('#nav-dashboard').click();await page.locator('#recent-tasks tbody').waitFor();
 assert.equal(await page.locator('#recent-tasks tbody tr').count(),6);assert.equal(await page.locator('#recent-tasks th').allTextContents().then(x=>x.join('|')),'Task|Tool execution time|Tokens');
 assert.equal(await page.getByRole('heading',{name:'Execution coverage',exact:true}).count(),0);
 const unknown=page.locator('#recent-tasks tr').filter({hasText:'WK-unobserved'}),zero=page.locator('#recent-tasks tr').filter({hasText:'WK-working'}),partial=page.locator('#recent-tasks tr').filter({hasText:'WK-interrupted'});
 assert.equal(await unknown.locator('td').nth(1).innerText(),'Unreported');assert.equal(await unknown.locator('td').nth(2).innerText(),'Unreported');
 assert.match(await zero.locator('td').nth(1).innerText(),/^0\.0 s\s*Partial$/);assert.match(await zero.locator('td').nth(2).innerText(),/^0\s*Partial$/);
 assert.equal(await partial.locator('.measurement-partial').count(),2);assert.match(await partial.locator('.measurement-partial').first().getAttribute('aria-label'),/Recorded bindings only/);
 await page.screenshot({path:path.join(output,'followup-dashboard-en.png'),fullPage:true});
 healthMode='indexing';await page.waitForResponse(r=>r.url().includes('/api/changes?'));await page.waitForFunction(()=>document.querySelector('#connection-text').textContent==='Connected');
 assert.equal(await page.locator('#connection').getAttribute('data-health'),'healthy');assert.equal(await page.locator('#recent-tasks tbody tr').count(),6);
 await page.locator('#connection').click();assert.match(await page.locator('#connection-detail').innerText(),/Validating/);await page.keyboard.press('Escape');
 healthMode='healthy';
 await page.locator('#recent-tasks [data-task-id="WK-accepted"]').click();await page.locator('#lifecycle').waitFor();
 assert.match(await page.locator('#next-action').innerText(),/Done\s+Completion summary: Synthetic local acceptance/);assert.doesNotMatch(await page.locator('#next-action').innerText(),/merge|release.*observation/i);
 assert.equal(await page.locator('#handoff-details').evaluate(el=>el.open),false);assert.equal(await page.locator('#copy-handoff').isVisible(),false);
 await page.locator('#handoff-details summary').click();assert.match(await page.locator('#handoff-details').innerText(),/next executor.*read-only snapshot/s);
 await page.context().grantPermissions(['clipboard-read','clipboard-write']);await page.locator('#copy-handoff').click();await page.waitForFunction(()=>document.querySelector('#copy-status').textContent==='Copied');
 assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/WK-accepted/);await page.locator('#close-drawer').click();
 // Three token-only bound reports: completeness 0/3 is not zero execution time.
 await page.route('**/api/task?id=WK-unobserved',async route=>{const response=await route.fetch(),task=await response.json();task.execution={execution_ms:null,time_complete:false,tokens:120,tokens_complete:false,recorded_operations:3,measured_intervals:0};await route.fulfill({response,json:task});});
 await page.locator('#recent-tasks [data-task-id="WK-unobserved"]').click();await page.locator('#lifecycle').waitFor();
 const timing=page.locator('#detail-content .panel').filter({has:page.getByRole('heading',{name:/^Tool execution time/})});
 assert.equal(await timing.locator('.setting').first().locator('dd').innerText(),'Unreported');assert.match(await timing.locator('.setting').nth(1).locator('dd').innerText(),/120\s*Partial/);
 assert.equal(await page.locator('#task-coverage').evaluate(el=>el.open),false);assert.doesNotMatch(await timing.innerText(),/0 \/ 3/);
 await page.locator('#task-coverage summary').click();assert.match(await page.locator('#task-coverage').innerText(),/0 \/ 3 bound operations/);assert.match(await page.locator('#task-coverage').innerText(),/does not measure.*total effort/);
 await page.getByRole('button',{name:'Recorded time by stage',exact:true}).click();assert.match(await page.locator('.help-popover:popover-open').innerText(),/Verification tools run during implementation/);assert.match(await page.locator('.help-popover:popover-open').innerText(),/no timing stays unreported/);await page.keyboard.press('Escape');
 await page.locator('#close-drawer').click();await page.locator('#nav-usage').click();await page.locator('#usage-coverage').waitFor();assert.equal(await page.locator('#usage-coverage').evaluate(el=>el.open),false);
 assert.equal(await page.locator('svg.chart').count(),5,'Usage renders all five charts');assert.match(await page.locator('.summary-metrics').innerText(),/2,860/);
 await page.locator('#usage-coverage summary').click();assert.match(await page.locator('#usage-coverage').innerText(),/zero does not mean measured zero usage/);
 healthMode='source-error';await page.waitForFunction(()=>document.querySelector('#connection').dataset.health==='source-error');assert.equal(await page.locator('#recent-tasks,svg.chart').count(),0);
 healthMode='offline';await page.waitForFunction(()=>document.querySelector('#connection').dataset.health==='offline');
 healthMode='healthy';await page.waitForFunction(()=>document.querySelector('#connection').dataset.health==='healthy');await page.unroute(changesRoute);
 await page.locator('#nav-settings').click();await page.getByLabel('Language',{exact:true}).selectOption('zh-TW');await page.locator('#nav-dashboard').click();
 assert.equal(await page.getByRole('heading',{name:/^最近任務/}).isVisible(),true);assert.equal(await page.locator('#recent-tasks tr').filter({hasText:'WK-unobserved'}).locator('td').nth(1).innerText(),'未回報');
 await page.screenshot({path:path.join(output,'followup-dashboard-zh.png'),fullPage:true});
 // Client-only proxy transport fixture. The separate proxy tests verify identity.
 let proxyRequests=0;const savedToken=await page.evaluate(()=>sessionStorage.getItem('workkeel-monitor-access'));
 await page.route(access.origin+'/',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('<html ','<html data-observer-auth="tailscale" ')});});
 await page.route('**/api/**',async route=>{proxyRequests++;const headers=route.request().headers();assert.equal(headers.authorization,undefined);assert.equal(headers.cookie,undefined);const response=await route.fetch({headers:{...headers,Authorization:'Bearer '+access.hash.slice(1)}});await route.fulfill({response});});
 await page.context().addCookies([{name:'unneeded-cookie',value:'fixture',url:access.origin}]);
 await page.goto(access.origin+'/#unused-proxy-fragment');await page.waitForFunction(()=>document.querySelector('#connection').dataset.health==='healthy');assert.ok(proxyRequests>0);assert.equal(new URL(page.url()).hash,'');
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('workkeel-monitor-access')),savedToken,'proxy mode neither reads nor replaces stored bearer credentials');
 return {width:1440,focused_followup:true,recent_tasks:{clickable:true,unknown_not_zero:true,partial_badges:true,explicit_zero_projection:true,bilingual:true},completion_summary:true,collapsed_handoff_copy:true,collapsed_identity_ids:true,collapsed_coverage:true,bound_subset_zero_completeness_not_zero_usage:true,initial_indexing:true,background_indexing_connected:true,source_and_transport_failures:true,proxy_client_no_bearer_or_cookie:true,proxy_identity_validation:'separate server tests'};
}

const output=path.resolve('output/playwright/workkeel-monitor');await fs.mkdir(output,{recursive:true});
const root=await createObserverFixture(),empty=await createMonitorFixture({empty:true});
let monitor,emptyMonitor,browser,page,paginationIndex;const checks=[],external=[],errors=[];
try{
 monitor=await startTaskMonitor(root);emptyMonitor=await startTaskMonitor(empty);
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const viewport of (focusedOnly?[]:process.env.OBSERVER_DESKTOP_ONLY==='1'?[{width:1440,height:1000}]:[{width:1440,height:1000},{width:390,height:844}])){
  const context=await browser.newContext({viewport,reducedMotion:'reduce',colorScheme:'dark'});
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1'){external.push(url.origin);return route.abort();}return route.continue();});
  await page.goto(monitor.url);await page.waitForFunction(()=>document.querySelector('#project-name').textContent);
  assert.equal(new URL(page.url()).hash,'');
  assert.equal(await page.locator('#readonly-label').count(),0);
  assert.match(await page.locator('#timezone-label').innerText(),/UTC/);
  assert.deepEqual(await page.locator('#nav button').allTextContents(),['總覽','工作看板','用量分析','活動紀錄','任務文件','學習與技能','設定']);
  assert.equal(await page.locator('.dashboard-grid > section').count(),3);
  assert.equal(await page.locator('.overview-count').count(),4);
  if(viewport.width>700){
   const material=await page.locator('.sidebar').evaluate(e=>({radius:getComputedStyle(e).borderRadius,blur:getComputedStyle(e).backdropFilter,x:e.getBoundingClientRect().x}));
   assert.equal(material.radius,'18px');assert.match(material.blur,/blur\(26px\)/);assert.ok(material.x>16);
   const columns=await page.locator('.dashboard-grid').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length);assert.equal(columns,3);
  }
  await page.screenshot({path:path.join(output,viewport.width+'-dashboard.png'),fullPage:true});
  const refresh=async()=>{const response=page.waitForResponse(r=>r.url().includes('/api/workspace'));await page.locator('#connection').click();await page.getByRole('button',{name:'重新連線',exact:true}).click();await response;await page.waitForTimeout(350);await page.keyboard.press('Escape');};
  for(const name of ['board','usage','activity','backlog','learning','settings']){
   await page.locator('#nav-'+name).click();await page.waitForFunction(()=>document.querySelector('#content').textContent.trim().length>0);
   if(name==='board')assert.equal(await page.locator('.task-card').count(),6);
   if(name==='usage'){
    await page.locator('svg.chart').first().waitFor();
    assert.equal(await page.locator('svg.chart').count(),5);
    const checkChartSize=async()=>{
     const plots=await page.locator('svg.chart').evaluateAll(nodes=>nodes.map(e=>({height:e.getBoundingClientRect().height,scale:e.getScreenCTM().a,font:parseFloat(getComputedStyle(e.querySelector('text')).fontSize)})));
     assert.ok(plots.every(p=>Math.abs(p.scale-1)<.01&&p.font===11),'chart labels must retain their screen size');
     assert.ok(plots[2].height<=281,'scatter height must not grow with the viewport');
     assert.ok(plots[3].height<=217&&plots[4].height<=217,'trend heights remain bounded');
    };
    await checkChartSize();
    if(viewport.width>700){await page.setViewportSize({width:2560,height:1080});await page.waitForFunction(()=>[...document.querySelectorAll('svg.chart')].every(e=>Math.abs(e.getScreenCTM().a-1)<.01));await checkChartSize();await page.setViewportSize(viewport);await page.waitForFunction(()=>[...document.querySelectorAll('svg.chart')].every(e=>Math.abs(e.getScreenCTM().a-1)<.01));}
    assert.equal(await page.locator('svg.chart path[tabindex]').count(),1);
    assert.match(await page.locator('.summary-metrics').innerText(),/2,860/);
    await page.locator('#usage-filters > summary').click();await page.locator('#usage-model').selectOption('fixture-local-model');await page.waitForFunction(()=>document.querySelector('.summary-metrics').textContent.includes('300'));
    assert.match(await page.locator('.summary-metrics').innerText(),/300/);
    assert.equal(await page.locator('svg.chart path[tabindex]').count(),1);
    await page.locator('#usage-model').selectOption('all');await page.waitForFunction(()=>document.querySelector('.summary-metrics').textContent.includes('2,860'));
    await page.getByRole('button',{name:'模型',exact:true}).click();
    await page.getByRole('button',{name:'每週',exact:true}).click();await page.waitForTimeout(200);
    await page.locator('#operation-table summary').click();
    assert.match(await page.locator('#operation-table').innerText(),/fixture-local-model/);
   }
   if(name==='learning'){
    await page.locator('.learning-row').first().waitFor();assert.equal(await page.locator('.learning-row').count(),4);
    assert.equal(await page.locator('.learning-next').count(),4);
    await page.getByRole('button',{name:'已驗證',exact:true}).click();assert.equal(await page.locator('.learning-row').count(),1);
    await page.getByRole('button',{name:'全部',exact:true}).click();assert.equal(await page.locator('.learning-row').count(),4);
    assert.ok((await page.locator('.segments').first().boundingBox()).width<=120);
    await page.locator('.learning-row').nth(2).click();assert.match(await page.locator('#detail-content').innerText(),/還有 4 個階段尚未記錄完成/);
    await page.keyboard.press('Escape');
   }
   if(name==='settings'){
    const info=page.getByRole('button',{name:'審查安排',exact:true});const before=await page.locator('.settings-grid').boundingBox();
    await info.click();assert.equal(await page.locator('.help-popover:popover-open').count(),1);
    const after=await page.locator('.settings-grid').boundingBox();assert.equal(after.height,before.height);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#timezone').inputValue(),'system');
    await page.locator('#timezone').selectOption('UTC');
    assert.match(await page.locator('#timezone-label').innerText(),/^UTC/);
    await page.reload();await page.waitForFunction(()=>document.querySelector('#project-name').textContent);
    await page.locator('#nav-settings').click();
    assert.equal(await page.locator('#timezone').inputValue(),'UTC');
    await page.locator('#timezone').selectOption('Asia/Tokyo');
    assert.match(await page.locator('#timezone-label').innerText(),/Asia\/Tokyo.*UTC\+09:00/);
    await page.locator('#timezone').selectOption('system');
   }
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' overflow');
   await page.screenshot({path:path.join(output,viewport.width+'-'+name+'.png'),fullPage:true});
  }
  await page.getByLabel('Language',{exact:true}).selectOption('en');
  assert.equal(await page.locator('#page-title').innerText(),'Settings');
  await page.locator('#about-nav').click();assert.match(await page.locator('#content').innerText(),/local models/);
  assert.match(await page.locator('#content').innerText(),/at least two distinct tasks/);
  assert.match(await page.locator('#content').innerText(),/does not rerun experiments/);
  assert.match(await page.locator('#content').innerText(),/Graph engineering/);
  assert.equal(await page.locator('.parallel-branches .flow-step').count(),3);
  const tones=await page.locator('.guide .flow-step').evaluateAll(items=>items.map(e=>getComputedStyle(e).borderColor));
  assert.ok(new Set(tones).size>=4,'diagram colors distinguish semantic stages');
  assert.ok((await page.locator('.guide .flow-step p').allTextContents()).every(text=>!/[。.!?！？]$/.test(text)));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'About overflow');
  await page.screenshot({path:path.join(output,viewport.width+'-about-en.png'),fullPage:true});
  await page.locator('#nav-settings').click();await page.getByLabel('Language',{exact:true}).selectOption('zh-TW');
  await page.locator('#nav-board').click();await page.getByLabel('搜尋',{exact:true}).fill('Unobserved');
  assert.equal(await page.locator('.task-card').count(),1);await page.locator('.task-card').click();
  await page.locator('#detail-content #lifecycle').waitFor();
  await page.getByRole('button',{name:/各階段已記錄時間/}).click();
  assert.equal(await page.locator('.help-popover:popover-open').count(),1);
  assert.match(await page.locator('.help-popover:popover-open').innerText(),/待開始|等待/);
  await page.keyboard.press('Escape');assert.equal(await page.locator('#drawer').evaluate(e=>e.open),true);
  await page.locator('#expand-task').click();await page.locator('.task-full-page').waitFor();
  assert.match(page.url(),/view=task&task=WK-unobserved/);assert.equal(await page.locator('.sidebar').count(),1);
  await page.reload();await page.locator('.task-full-page #lifecycle').waitFor();
  await page.goBack();await page.locator('.task-card').waitFor();
  assert.equal(await page.getByLabel('搜尋',{exact:true}).inputValue(),'Unobserved');
  await page.locator('.task-card').click();await page.locator('#lifecycle').waitFor();
  await page.locator('#detail-title').click();assert.equal(await page.locator('#drawer').evaluate(e=>e.open),true);
  const drawer=await page.locator('#drawer').boundingBox();await page.mouse.move(drawer.x+30,drawer.y+30);await page.mouse.down();await page.mouse.move(2,100);await page.mouse.up();assert.equal(await page.locator('#drawer').evaluate(e=>e.open),true,'drag from inside does not dismiss');
  await page.mouse.click(2,100);assert.equal(await page.locator('#drawer').evaluate(e=>e.open),false,'outside click dismisses drawer');
  await page.locator('.task-card').click();
  await page.getByRole('button',{name:'文件',exact:true}).click();await page.locator('#detail-content button').first().click();await page.waitForFunction(()=>document.querySelector('#document').open);
  await page.mouse.click(2,100);assert.equal(await page.locator('#document').evaluate(e=>e.open),false);assert.equal(await page.locator('#drawer').evaluate(e=>e.open),true,'only the top dialog closes');
  await page.getByRole('button',{name:'內容',exact:true}).click();
  assert.equal(await page.locator('#detail-title img').count(),0);
  assert.match(await page.locator('#detail-title').innerText(),/<img/);
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  await page.locator('#handoff-details summary').click();await page.locator('#copy-handoff').click();await page.waitForFunction(()=>document.querySelector('#copy-status').textContent.includes('已複製'));
  const copied=await page.evaluate(()=>navigator.clipboard.readText());assert.match(copied,/WK-unobserved/);assert.doesNotMatch(copied,/PRIVATE_OUTPUT_NOT_FOR_MONITOR/);
  assert.deepEqual(copied.split('\n').filter(s=>s.startsWith('本機驗收：')),['本機驗收：尚未完成']);
  await page.getByRole('button',{name:'模型與執行',exact:true}).click();assert.match(await page.locator('#detail-content').innerText(),/尚無執行紀錄/);
  await page.keyboard.press('Escape');await page.getByLabel('搜尋',{exact:true}).fill('');
  for(const id of ['WK-completed','WK-interrupted','WK-review','WK-accepted','WK-working']){
   await page.locator('.task-card[data-task-id="'+id+'"]').click();
   await page.locator('#lifecycle').waitFor();assert.match(await page.locator('#lifecycle').innerText(),/各階段已記錄時間/);
   if(id==='WK-accepted')assert.match(await page.locator('#delivery').innerText(),/已驗收/);
   await page.getByRole('button',{name:'模型與執行',exact:true}).click();
   if(id==='WK-interrupted')assert.match(await page.locator('#detail-content').innerText(),/部分/);
   if(id==='WK-completed')assert.match(await page.locator('#detail-content').innerText(),/fixture-local-model/);
   await page.getByRole('button',{name:'設定',exact:true}).last().click();assert.match(await page.locator('#detail-content').innerText(),/審查安排/);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:path.join(output,viewport.width+'-'+id+'.png'),fullPage:true});
   await page.keyboard.press('Escape');
  }
  await page.locator('#nav-learning').click();await page.getByRole('button',{name:'技能庫',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#content').textContent.includes('尚未加入專案'));
  await page.getByLabel('搜尋',{exact:true}).fill('copper kestrel');
  await page.waitForFunction(()=>document.querySelector('#content').textContent.includes('custom-check')&&!document.querySelector('#content').textContent.includes('external-check'));
  await page.getByRole('button',{name:'custom-check',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#document-body').textContent.includes('copper kestrel'));
  assert.equal(await page.locator('#document-body script').count(),0);
  const body=await page.locator('#document-body').innerText();
  await fs.appendFile(path.join(root,'.agents/skills/custom-check/SKILL.md'),'\nSource changed for browser verification.\n');
  await page.waitForFunction(()=>document.querySelector('#document-status').textContent.includes('來源已更新'));
  assert.equal(await page.locator('#document-body').innerText(),body);
  await page.locator('#reload-document').click();await page.waitForFunction(()=>document.querySelector('#document-body').textContent.includes('Source changed'));
  await page.locator('#close-document').click();await page.getByLabel('搜尋',{exact:true}).fill('');await refresh();
  await page.locator('#nav-backlog').click();await page.locator('#content tbody button').first().click();await page.getByRole('button',{name:'文件',exact:true}).click();await page.locator('#detail-content button').first().click();await page.waitForFunction(()=>document.querySelector('#document-body').textContent.includes('Approved synthetic'));
  await page.locator('#close-document').click();await page.locator('#close-drawer').click();
  await page.locator('#nav-board').click();
  const ref=path.join(root,'.ai-org/work-items/WK-unobserved.json'),saved=await fs.readFile(ref);
  await fs.writeFile(ref,'broken fixture');await refresh();assert.match(await page.locator('#status').innerText(),/部分紀錄/);
  await page.locator('.task-card[data-task-id="WK-unobserved"]').click();assert.equal(await page.locator('#copy-handoff').isDisabled(),true);
  await page.keyboard.press('Escape');await fs.writeFile(ref,saved);await refresh();assert.equal(await page.locator('#status').innerText(),'');
  let requests=0;const track=req=>{if(req.url().includes('/api/changes'))requests++;};page.on('request',track);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  const start=requests;await page.waitForTimeout(2300);assert.equal(requests,start);
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForFunction(()=>document.querySelector('#connection').dataset.health==='healthy');page.off('request',track);
  await page.route('**/api/changes?*',route=>route.fulfill({status:503,body:'Offline fixture failure'}));
  await page.waitForFunction(()=>document.querySelector('#connection').dataset.health==='offline');assert.match(await page.locator('#status').innerText(),/舊資料已隱藏/);assert.equal(await page.locator('.task-card').count(),0);
  await page.unroute('**/api/changes?*');await refresh();assert.equal(await page.locator('.task-card').count(),6);
  await page.reload();await page.waitForFunction(()=>document.querySelector('#project-name').textContent);
  await page.locator('#nav-dashboard').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'nav-board');
  await page.emulateMedia({colorScheme:'light'});await page.screenshot({path:path.join(output,viewport.width+'-light.png'),fullPage:true});
  checks.push({width:viewport.width,navigation:true,charts:3,multiple_models:true,search:true,learning:true,documents:true,version_notice:true,unknown_partial:true,language:true,readonly:true,hidden_pause:true,error_recovery:true,keyboard:true,xss_escape:true});
  await context.close();
 }
 if(!focusedOnly){page=await browser.newPage();await page.goto(emptyMonitor.url);await page.waitForFunction(()=>document.querySelector('#project-name').textContent);assert.match(await page.locator('#content').innerText(),/沒有項目/);await page.close();}
 const now=Date.now(),operations=Array.from({length:120},(_,i)=>({operation_id:'work-'+String(i).padStart(3,'0'),result_recorded:true,runtime_model:'fixture-pagination',dispatched_at:new Date(now-i*60000-1000).toISOString(),ended_at:new Date(now-i*60000).toISOString(),adapter_elapsed_ms:1000,usage:{input_tokens:100,output_tokens:10}}));
 const task={id:'WK-pagination',title:'Pagination fixture',task_state:'done',read_status:'available',updated_at:new Date(now).toISOString(),runs:[{run_id:'pagination',operations}],timeline:operations.map((op,i)=>({at:op.dispatched_at,action:'event-'+String(i).padStart(3,'0'),state:'build'}))};
 paginationIndex=createObserverIndex(empty,async()=>({tasks:[task],complete:true,project:{}}));
 for(const mode of (releaseOnly?['release']:executionOnly?['execution','live']:liveOnly?['live']:followupOnly?['followup']:clarityOnly?['clarity']:regressionsOnly?['regressions']:['regressions','clarity','followup','live','execution','release'])){
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',colorScheme:'dark'});
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1'){external.push(url.origin);return route.abort();}return route.continue();});
  checks.push(mode==='release'?await verifyObserverRelease(page,monitor,output):mode==='execution'?await verifyExecutionClarity(page,monitor):mode==='live'?await verifyLiveState(page,monitor,root):mode==='followup'?await verifyObserverFollowup(page,monitor):mode==='clarity'?await verifyObserverClarity(page,monitor,paginationIndex):await verifyObserverRegressions(page,monitor,root,paginationIndex));await context.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 if(releaseOnly)await fs.writeFile(path.join(output,'observer-release-report.json'),JSON.stringify({passed:true,mode:'focused-desktop-observer-release',checks,errors,external_requests:external.length,model_calls:0},null,2)+'\n');
 else if(executionOnly)await fs.writeFile(path.join(output,'execution-clarity-report.json'),JSON.stringify({passed:true,mode:'focused-desktop-execution-and-live-state',checks,errors,external_requests:external.length,model_calls:0,fixture:'Offline desktop fixture: bounded 429 recovery, persistent retry UI, superseded queries, multi-model execution details, unknown repair timing, retained technical identity and live reading state. No narrow-screen checks.'},null,2)+'\n');
 else
 await fs.writeFile(path.join(output,liveOnly?'live-state-report.json':followupOnly?'followup-report.json':clarityOnly?'clarity-report.json':regressionsOnly?'regressions-report.json':'report.json'),JSON.stringify({passed:true,mode:liveOnly?'focused-desktop-live-state':followupOnly?'focused-desktop-followup':clarityOnly?'focused-desktop-clarity':regressionsOnly?'focused-desktop-regressions':'browser-gate',checks,errors,external_requests:external.length,model_calls:0,fixture:liveOnly?'Native offline fixture with changed workspace/detail/document API projections and a held background response; no model calls or narrow-screen checks.':followupOnly?'Native offline fixture; UI projections of explicit zero, three token-only bound reports, health states and authenticated proxy transport. No identity-validation or live Tailscale claim.':clarityOnly?'Generated native task/workflow journals and persisted event reasons with deterministic offline adapters; injected task-detail stage intervals and failed/passed review events; actual query index with injected 120-operation/event projection.':'Generated native task/workflow journals with deterministic offline adapters; real malformed fixture workkeel.lock and recovery; injected task-detail stage intervals and review events; actual query index with injected 120-operation/event projection. The full gate also uses synthetic learning records and injected visibility/503 failures and focused followup UI projections.'},null,2)+'\n');
 console.log(JSON.stringify({passed:true,checks:checks.length,external_requests:external.length,output}));
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{await browser?.close();await paginationIndex?.close();await monitor?.close();await emptyMonitor?.close();await fs.rm(root,{recursive:true,force:true});await fs.rm(empty,{recursive:true,force:true});}
