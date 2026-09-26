import {label as zhLabel,formatDuration,formatCount,taskActions,handoffText} from '/view.mjs';
import {operationRows,filterRows,aggregateRows,trendRows,executionSummary,stageExecutionSummary,executionBreakdown} from '/analytics.mjs';
import {resolveTimeZone,validTimeZone,zoneLabel} from '/workkeel-monitor-time.mjs';
import {reconcile,on} from '/dom.mjs';
const $=id=>document.getElementById(id);
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const append=(el,...children)=>{el.append(...children.filter(Boolean));return el;};
const button=(text,fn,cls)=>{const b=node('button',text,cls);b.type='button';on(b,'click',fn);return b;};
const t=(zh,en)=>lang==='en'?en:zh;
let lang='zh-TW';try{lang=localStorage.getItem('workkeel-language')==='en'?'en':'zh-TW';}catch{}
let timezonePreference='system';try{const saved=localStorage.getItem('workkeel-timezone');if(saved==='system'||validTimeZone(saved))timezonePreference=saved;}catch{}
const timeZone=()=>resolveTimeZone(timezonePreference);
let renderedZone=timeZone();
function updateZone(){const el=$('timezone-label');if(el){el.textContent=zoneLabel(timeZone());el.title=t('顯示時區，可在設定中調整','Display timezone; change it in Settings');}}
function setTimezone(value){timezonePreference=value;try{localStorage.setItem('workkeel-timezone',value);}catch{}renderedZone=timeZone();operationCursor=null;operationPrevious=[];updateZone();render();loadView();if($('drawer').open||fullTask)renderDetail();}
const proxyAuth=document.documentElement.dataset.observerAuth==='tailscale';
let token=proxyAuth?'':location.hash.slice(1);
try{if(!proxyAuth){if(token)sessionStorage.setItem('workkeel-monitor-access',token);else token=sessionStorage.getItem('workkeel-monitor-access')??'';}}catch{}
const initialRoute=new URLSearchParams(location.search);
history.replaceState(history.state,'',location.pathname+location.search);
let snapshot=null,library=null,view='dashboard',tab='overview',selected=null,learningSelected=null,loading=false,timer,libraryQuery='',searchTimer,bodyRequest=0,copyEpoch=0;
let openDocument=null,documentSignature=null,libraryMode='learning',learningFilter='all',analytics={model:'all',tool:'all',reasoning:'all',kind:'all',days:'all'},group='model',period='day',lastSignature='';
let historyBacklog=false,lastLibraryQuery=null;
let showLegacySkills=false,skillOrigin='all';
let detailOperationPage=0,detailRequest=0;
let selectedTask=null,fullTask=false,returnState=null,pageResult=null,analysisResult=null,activityResult=null,queryEpoch=0,backlogCursor=null,backlogPrevious=[],operationCursor=null,operationPrevious=[],activityCursor=null,activityPrevious=[],activityHours='24',lastChecked=null,lastChanged=null,lastValidated=null,sourceHealth='unknown',connection='connecting';
let pendingView=null,viewError=null;
const titles={dashboard:['總覽','Dashboard'],board:['工作看板','Task board'],usage:['用量分析','Usage analysis'],activity:['活動紀錄','Activity'],backlog:['任務文件','Backlog'],learning:['學習與技能','Learning & skills'],settings:['設定','Settings'],about:['運作說明','How Workkeel works']};
const stages=['intake','build','test','release_gate','done'];
const shownStages=()=>stages;
const states={intake:['待開始','Ready'],build:['實作中','In progress'],test:['待審查','In review'],release_gate:['待驗收','Awaiting acceptance'],done:['已完成','Done'],cancelled:['已取消','Cancelled'],unknown:['無法讀取','Unavailable'],candidate:['待驗證','To validate'],validated:['已驗證','Validated'],active:['已採用','Adopted'],deprecated:['已停用','Deprecated'],workkeel:['Workkeel 原生','Workkeel built-in'],project:['專案技能','Project Skills'],'third-party':['第三方','Third-party'],unreported:['未回報','Unreported'],unspecified:['未分類','Unclassified'],fixture:['測試資料','Fixture'],'real-task':['真實任務','Real task'],'paired-experiment':['配對實驗','Paired experiment']};
Object.assign(states,{'distinct-agent':['由不同 Agent 審查','Different agent reviews'],'distinct-principal':['由不同人審查','Different principal reviews'],'host-owned':['由執行工具管理','Managed by the execution tool'],native:['沿用執行工具','Native execution tool'],none:['不允許','Not allowed'],allowlist:['限定清單','Allowlist'],unclassified:['未分類','Unclassified'],user:['個人技能','Personal Skills'],work_item_created:['建立任務','Task created'],work_item_transitioned:['變更階段','Stage changed'],work_item_claimed:['接手任務','Ownership claimed'],work_item_claim_released:['交出任務','Ownership released'],handoff_created:['提交交接','Handoff recorded'],work_item_configured:['更新任務設定','Task configuration updated'],work_item_reworked:['退回修正','Returned for correction'],work_item_closed:['完成驗收','Accepted'],work_item_unresolved_updated:['更新待處理事項','Open issues updated'],spec:['規格確認','Specification'],design:['設計中','Design'],eval:['評估中','Evaluation'],independent_qa:['獨立審查','Independent review'],concluded:['已結束','Concluded'],blocked:['待排除問題','Blocked']});
const name=value=>states[value]?t(...states[value]):value==null?t('未記錄','Not recorded'):lang==='en'?String(value).replaceAll('-',' '):zhLabel(value);
const duration=n=>typeof n==='number'&&n>0&&n<1000?n.toLocaleString(lang,{maximumFractionDigits:1})+' ms':lang==='en'?formatDuration(n):formatDuration(n).replace('Unknown','未知').replace(' min ',' 分 ').replace(/ s$/,' 秒');
const count=m=>lang==='en'?formatCount(m):formatCount(m).replace('Unknown','未知').replace('(partial)','（部分）');
const number=n=>n==null?t('未知','Unknown'):n.toLocaleString(lang,{maximumFractionDigits:1});
const partialMeasurement=(value,complete,format)=>{const partial=typeof value==='number'&&complete!==true,text=format(value),el=node('span',text+(partial?' *':''));if(partial){el.title=t('僅含已記錄部分','Recorded subtotal only');el.setAttribute('aria-label',text+' · '+el.title);}return el;};
const reportedMeasurement=(value,complete,format)=>{if(typeof value!=='number')return node('span',t('未回報','Unreported'),'muted');const el=node('span',undefined,'reported-measurement');el.append(node('span',format(value)));if(complete!==true){const partial=node('span',t('部分','Partial'),'badge measurement-partial');partial.title=t('僅含已綁定的紀錄，其他執行未回報','Recorded bindings only; other execution is unreported');partial.setAttribute('aria-label',partial.title);el.append(partial);}return el;};
const date=at=>at&&Number.isFinite(Date.parse(at))?new Date(at).toLocaleString(lang,{timeZone:timeZone(),year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}):t('未知','Unknown');
const shortTime=at=>new Date(at).toLocaleTimeString(lang,{timeZone:timeZone(),hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const empty=message=>node('div',message??t('目前沒有資料','No records yet'),'empty');
const badge=(value,cls='')=>node('span',name(value),'badge '+cls);
const panel=(title,...children)=>{const el=append(node('section',undefined,'panel'),node('h2',title),...children);el.dataset.key=title;return el;};
const help=(title,body,id)=>{
 const wrap=node('span',undefined,'help'),b=button('?',()=>{}),pop=node('div',undefined,'help-popover');
 pop.append(node('h3',title));for(const paragraph of body.split('\n\n'))pop.append(node('p',paragraph));
 b.setAttribute('aria-label',title);b.setAttribute('aria-expanded','false');pop.id=id??'help-'+encodeURIComponent(title);pop.setAttribute('popover','auto');pop.setAttribute('role','note');b.setAttribute('aria-controls',pop.id);
 on(b,'click',event=>{const b=event.currentTarget,pop=b.parentElement.querySelector('.help-popover');if(pop.matches(':popover-open')){pop.hidePopover();return;}pop.showPopover();const r=b.getBoundingClientRect(),w=Math.min(330,innerWidth-32),h=pop.getBoundingClientRect().height;
 pop.style.width=w+'px';pop.style.left=Math.max(16,Math.min(r.left,innerWidth-w-16))+'px';pop.style.top=Math.max(16,Math.min(r.bottom+9,innerHeight-h-16))+'px';});
 on(pop,'toggle',event=>{const pop=event.currentTarget;pop.parentElement.querySelector('button').setAttribute('aria-expanded',String(pop.matches(':popover-open')));});
 return append(wrap,b,pop);
};
const closeHelp=()=>document.querySelectorAll('.help-popover:popover-open').forEach(p=>p.hidePopover());
const helpHeading=(box,body)=>{box.querySelector('h2').append(help(box.querySelector('h2').textContent,body));return box;};
const disclosure=(id,title,...children)=>{const el=append(node('details',undefined,'disclosure'),node('summary',title),...children);el.id=id;return el;};
const queryParams=values=>new URLSearchParams(Object.entries(values).filter(([,v])=>v!==null&&v!==undefined)).toString();
function loadView(refreshRequested=false){
 const requestedView=view,url=requestedView==='usage'?'/api/analysis?'+queryParams({...analytics,group,period,timezone:timeZone(),cursor:operationCursor}):requestedView==='backlog'?'/api/tasks?'+queryParams({q:$('search').value,state:$('state-filter').value,history:historyBacklog?'1':'0',mode:'all',cursor:backlogCursor}):requestedView==='activity'?'/api/activity?'+queryParams({q:$('search').value,hours:activityHours,cursor:activityCursor}):null;
 if(!url){queryEpoch++;pendingView=null;viewError=null;return Promise.resolve();}
 if(pendingView?.url===url&&pendingView.view===requestedView){if(refreshRequested)pendingView.reload=true;return pendingView.promise;}
 const epoch=++queryEpoch,entry={url,view:requestedView,reload:false,promise:null},current=()=>epoch===queryEpoch&&requestedView===view;
 pendingView=entry;viewError=null;
 entry.promise=(async()=>{try{
  const result=await api(url,current);if(!current())return;
  if(requestedView==='usage')analysisResult=result;if(requestedView==='backlog')pageResult=result;if(requestedView==='activity')activityResult=result;
  if(result?.reset_required||result?.operations?.reset_required||result?.events?.reset_required){
   if(requestedView==='usage'){operationCursor=null;operationPrevious=[];}if(requestedView==='backlog'){backlogCursor=null;backlogPrevious=[];}if(requestedView==='activity'){activityCursor=null;activityPrevious=[];}
   pendingView=null;return loadView();
  }
  render();
 }catch{if(current()){viewError={view:requestedView};render();}}
 finally{if(pendingView===entry){pendingView=null;if(entry.reload&&current()&&!viewError)void loadView();}}})();
 return entry.promise;
}

const paths={dashboard:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',board:'M3 4h18v16H3z M9 4v16 M15 4v16',usage:'M4 20V11 M10 20V4 M16 20V8 M22 20H2',activity:'M3 12h4l3-8 4 16 3-8h4',backlog:'M4 4h16v16H4z M4 9h16 M9 9v11',learning:'M3 5l9-2 9 2v15l-9-2-9 2z M12 3v15',settings:'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M9 15v6',about:'M12 11v6 M12 7v1 M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20'};
function icon(key){const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('class','nav-icon');s.setAttribute('aria-hidden','true');const p=document.createElementNS(s.namespaceURI,'path');p.setAttribute('d',paths[key]);s.append(p);return s;}
function table(headers,rows){const wrap=node('div',undefined,'table-wrap');wrap.tabIndex=0;const table=node('table'),head=node('tr'),body=node('tbody');for(const h of headers){const th=node('th',h);th.scope='col';head.append(th);}table.append(append(node('thead'),head),body);for(const row of rows){const tr=node('tr');for(const value of row)tr.append(append(node('td'),value instanceof Node?value:document.createTextNode(String(value??t('未知','Unknown')))));body.append(tr);}wrap.append(table);return wrap;}
function field(label,value,explanation){const row=node('div',undefined,'setting'),dt=node('dt');dt.append(node('span',label));if(explanation)dt.append(help(label,explanation));return append(row,dt,append(node('dd'),value instanceof Node?value:document.createTextNode(Array.isArray(value)?value.join(' · ')||t('無','None'):String(value??t('尚未記錄','Not recorded')))));}
function list(values){const ul=node('ul');for(const value of values??[])ul.append(node('li',value));return ul;}
function setLanguage(value){lang=value;try{localStorage.setItem('workkeel-language',value);}catch{}document.documentElement.lang=lang==='en'?'en':'zh-Hant';shell();render();if($('drawer').open||fullTask)renderDetail();}
function shell(){
 $('nav').replaceChildren(...Object.keys(titles).filter(k=>k!=='about').map(key=>{const b=button('',()=>showPage(key));b.id='nav-'+key;b.append(icon(key),node('span',t(...titles[key])));if(key===view)b.setAttribute('aria-current','page');return b;}));
 $('about-nav').replaceChildren(icon('about'),node('span',t(...titles.about)));$('about-nav').setAttribute('aria-current',view==='about'?'page':'false');
 updateZone();$('project-label').textContent=t('專案','Project');
 $('page-title').textContent=fullTask?t('任務詳情','Task details'):t(...titles[view]);
 $('search-label').textContent=t('搜尋','Search');$('search').placeholder=view==='learning'?t('搜尋名稱與內容','Search names and content'):t('任務名稱或 ID','Task title or ID');
 $('search').setAttribute('aria-label',t('搜尋','Search'));$('state-filter').setAttribute('aria-label',t('狀態','Status'));
 const filter=$('state-filter').value;
 $('state-filter').replaceChildren(...[['all',t('全部','All')],['attention',t('待處理','Needs attention')],['unfinished',t('所有未完成','All unfinished')],...shownStages().map(s=>[s,name(s)]),['cancelled',name('cancelled')],['unknown',name('unknown')]].map(([v,s])=>{const o=node('option',s);o.value=v;return o;}));$('state-filter').value=filter||'all';
 $('toolbar').hidden=fullTask||['dashboard','settings','about','usage'].includes(view);$('state-filter').hidden=['learning','board','activity'].includes(view);$('view-controls').replaceChildren();$('view-controls').className='row';
 if(view==='board'){$('view-controls').className='filter-chips';for(const [key,label] of [['all',t('全部','All')],['attention',t('待處理','Needs attention')]]){const n=(snapshot?.tasks??[]).filter(x=>key==='all'||x.needs_attention).length,b=button(label+' '+n,()=>{$('state-filter').value=key;shell();render();});b.setAttribute('aria-pressed',String(($('state-filter').value||'all')===key));$('view-controls').append(b);}}
 if(view==='learning'){$('view-controls').className='segment-control';for(const [key,label] of [['learning',t('學習紀錄','Lessons & practices')],['skills',t('技能庫','Skills')]]){const b=button(label,()=>{libraryMode=key;shell();render();});b.setAttribute('aria-pressed',String(libraryMode===key));$('view-controls').append(b);}}
 $('close-drawer').setAttribute('aria-label',t('關閉詳情','Close details'));$('close-document').setAttribute('aria-label',t('關閉文件','Close document'));$('reload-document').textContent=t('重新讀取','Reload document');
}
function capturePage(){return {view,search:$('search').value,filter:$('state-filter').value,scroll:window.scrollY,historyBacklog,backlogCursor,backlogPrevious:[...backlogPrevious],operationCursor,operationPrevious:[...operationPrevious],activityCursor,activityPrevious:[...activityPrevious],activityHours,analytics:{...analytics},group,period,libraryMode,learningFilter};}
function restorePage(state){if(!state)return;view=state.view??'board';shell();$('search').value=state.search??'';$('state-filter').value=state.filter??'all';historyBacklog=state.historyBacklog??false;backlogCursor=state.backlogCursor??null;backlogPrevious=state.backlogPrevious??[];operationCursor=state.operationCursor??null;operationPrevious=state.operationPrevious??[];activityCursor=state.activityCursor??null;activityPrevious=state.activityPrevious??[];activityHours=state.activityHours??'24';analytics=state.analytics??analytics;group=state.group??group;period=state.period??period;libraryMode=state.libraryMode??libraryMode;learningFilter=state.learningFilter??'all';}
function showPage(key){historyBacklog=false;closeHelp();if(fullTask){$('drawer').append($('detail-surface'));fullTask=false;selectedTask=null;}returnState=null;selected=null;view=key;$('search').value='';libraryQuery='';learningFilter='all';backlogCursor=null;backlogPrevious=[];operationCursor=null;operationPrevious=[];activityCursor=null;activityPrevious=[];$('state-filter').value='all';history.replaceState(null,'','?view='+key);shell();render();loadView();if(key==='learning')refresh();window.scrollTo({top:0});}

function tasks(){const q=$('search').value.toLocaleLowerCase(),state=$('state-filter').value;return (snapshot?.tasks??[]).filter(task=>(task.id+' '+task.title+' '+task.goal).toLocaleLowerCase().includes(q)&&(state==='all'||state==='attention'&&task.needs_attention||state===task.task_state));}
function taskButton(task,card=false){
 const b=button('',()=>openTask(task.id),card?'task-card':'task-row');b.dataset.taskId=task.id;b.dataset.stage=task.task_state;
 if(!card)return append(b,node('strong',task.title),node('small',task.id+' · '+(task.needs_attention?t('待處理','Needs attention'):name(task.task_state))));
 const info=node('div');info.append(node('small',task.id),node(card?'h3':'strong',task.title));
 const meta=node('div',undefined,'row');if(task.needs_attention)meta.append(badge(t('待處理','Attention'),'warn'));if(!card)meta.append(badge(task.task_state));
 if(card){const models=[...new Set((task.models??operationRows([task]).map(o=>o.model)).map(name))];meta.append(node('small',models.join(' / ')||t('尚無執行紀錄','No executions recorded')),node('small',(task.document_count??task.documents?.length??0)+' '+t('文件','docs')));}
 return append(b,info,meta);
}
function recentActivity(all){return append(node('section',undefined,'overview-timeline'),append(node('div',undefined,'section-head'),node('h2',t('最近活動','Recent activity')),button(t('所有活動','View all'),()=>showPage('activity'))),timeline(all,3));}
function dashboard(){
 const all=snapshot.tasks,box=node('div'),counts=node('div',undefined,'overview-counts');
 for(const [title,value,state] of [[t('實作中','In progress'),snapshot.counts.build,'build'],[t('待審查','Awaiting review'),snapshot.counts.test,'test'],[t('等你驗收','Awaiting acceptance'),snapshot.counts.release_gate,'release_gate'],[t('已完成','Completed'),snapshot.counts.done,'done']]){
  const b=button('',()=>{showPage('backlog');$('state-filter').value=state;loadView();},'overview-count');append(b,node('small',title),node('strong',value));b.dataset.stage=state;counts.append(b);}
 box.append(counts);
 const grid=node('div',undefined,'dashboard-grid'),blocked=all.filter(x=>x.needs_attention&&!(x.attention_reasons??[]).every(r=>['awaiting-review','awaiting-acceptance'].includes(r)));
 for(const [title,subset] of [[t('需要處理','Needs attention'),blocked],[t('目前工作','Current work'),all.filter(x=>['build','test','release_gate'].includes(x.task_state))],[t('最近完成','Recently completed'),all.filter(x=>x.task_state==='done')]]){
  const p=panel(title);p.append(...(subset.length?subset.slice(0,3).map(x=>taskButton(x)):[empty(t('目前沒有項目','Nothing here right now'))]));if(subset.length>3)p.append(button(t('查看其餘 ','View remaining ')+(subset.length-3),()=>showPage('backlog')));grid.append(p);}
 box.append(grid);
 const recentTasks=helpHeading(panel(t('最近任務','Recent tasks')),t('依最近更新排序，點選任務查看詳情。時間只計執行工具已回報的區間，同時執行的重疊區間只計一次。\n\n「部分」代表只收到部分用量；「未回報」不等於 0。原生紀錄只涵蓋明確綁定的回合或操作，不代表所有 AI 或審查工作。','Sorted by latest update. Select a task for details. Tool execution time counts reported intervals, with overlapping intervals counted once.\n\nPartial means only some usage is recorded; unreported does not mean zero. Native records cover explicitly bound turns or operations, not every AI or review activity.'));
 recentTasks.id='recent-tasks';const latest=[...all].sort((a,b)=>(Date.parse(b.updated_at)||0)-(Date.parse(a.updated_at)||0)||a.id.localeCompare(b.id)).slice(0,6);
 recentTasks.append(latest.length?table([t('任務','Task'),t('工具執行時間','Tool execution time'),'Tokens'],latest.map(task=>[taskButton(task),reportedMeasurement(task.execution?.execution_ms,task.execution?.time_complete,duration),reportedMeasurement(task.execution?.tokens,task.execution?.tokens_complete,number)])):empty(),button(t('查看用量分析','Open usage analysis'),()=>showPage('usage')));box.append(recentTasks);
 const recent=new Map();for(const e of snapshot.recent_events??[]){if(!recent.has(e.task_id))recent.set(e.task_id,{id:e.task_id,title:e.title,timeline:[]});recent.get(e.task_id).timeline.push(e);}box.append(recentActivity([...recent.values()]));return box;
}

function board(){
 const box=node('div'),cutoff=Date.now()-7*86400000,all=tasks(),recent=all.filter(t=>t.read_status==='unavailable'||Date.parse(t.updated_at)>=cutoff),older=all.filter(t=>Date.parse(t.updated_at)<cutoff&&!['done','cancelled'].includes(t.task_state));
 box.append(append(node('div',undefined,'section-head'),node('p',t('最近 7 天 · 每欄最多 10 件','Last 7 days · Up to 10 per column'),'chart-note'),button(t('查看較早未完成的任務 ','Older unfinished tasks ')+older.length,()=>{showPage('backlog');$('state-filter').value='unfinished';$('search').value='';loadView();})));
 const wrap=node('div',undefined,'board-scroll');wrap.tabIndex=0;wrap.setAttribute('aria-label',t('可左右捲動的工作看板','Scrollable task board'));const board=node('div',undefined,'board');
 const states=[...shownStages(),...['cancelled','unknown'].filter(s=>recent.some(x=>x.task_state===s))];board.style.gridTemplateColumns='repeat('+states.length+',minmax(180px,1fr))';
 for(const state of states){const col=node('section',undefined,'column');col.dataset.stage=state;const subset=recent.filter(t=>t.task_state===state);col.append(append(node('h2'),node('span',name(state)),node('span',subset.length)),...(subset.length?subset.slice(0,10).map(x=>taskButton(x,true)):[empty(t('沒有任務','No tasks'))]));if(subset.length>10)col.append(button(t('查看全部 ','View all ')+subset.length,()=>{showPage('backlog');$('state-filter').value=state;loadView();}));board.append(col);}
 return append(box,append(wrap,board));
}

function eventsFor(all){return all.flatMap(task=>(task.timeline??[]).map(event=>({...event,task}))).sort((a,b)=>String(b.at).localeCompare(String(a.at)));}
function eventMeaning(event){
 const meanings={create:['已建立任務，尚未有人接手','Task created; waiting for an executor'],claim:['已接手，開始處理這件任務','An executor claimed the task'],handoff:['實作已交付，接著進行獨立審查','Implementation delivered for independent review'],release:['暫時交出任務，之後可再次接手；不代表審查失敗','The executor released the task so it can be claimed again; this is not a failed review'],rework:['審查發現問題，退回修正後重新交付','Review found issues; correct them before submitting again'],close:['審查通過，已完成本機驗收','The reviewed result was accepted locally'],cancel:['已停止這件任務','The task was cancelled']};
 if(event.action==='review')return event.outcome==='fail'?t('審查未通過，需要修正','Review failed; corrections are required'):event.outcome==='pass'?t('審查通過，可以驗收','Review passed; ready for acceptance'):t('已留下審查紀錄','A review was recorded');
 return meanings[event.action]?t(...meanings[event.action]):t('已記錄這次狀態變更','This state change was recorded');
}
function timeline(all,limit=200){
 const box=node('div'),events=eventsFor(all).slice(0,limit),groups=new Map();
 for(const e of events){const key=new Date(e.at).toLocaleDateString(lang,{timeZone:timeZone(),year:'numeric',month:'short',day:'numeric'});if(!groups.has(key))groups.set(key,[]);groups.get(key).push(e);}
 for(const [day,events] of groups){const group=node('section',undefined,'timeline-day'),list=node('div');group.append(node('h3',day),list);
 for(const e of events){const item=node('div',undefined,'timeline-event'),time=node('time',shortTime(e.at));time.dateTime=e.at;item.dataset.stage=e.state;const dot=node('span',e.state==='done'?'✓':e.state==='build'?'▷':'○','event-dot');dot.setAttribute('aria-hidden','true');
 const content=append(node('div'),button(name(e.action)+' · '+name(e.state)+(e.action==='review'&&e.outcome?' · '+(e.outcome==='pass'?t('通過','Passed'):t('未通過','Failed')):''),()=>openTask(e.task.id)),append(node('p',undefined,'event-context'),node('b',e.task.id)),node('p',eventMeaning(e),'event-meaning'));
 if(e.reason)content.append(node('p',e.reason,'event-reason'));
 else if(['release','rework','review','handoff','close','cancel'].includes(e.action))content.append(node('small',t('未保存這次操作的具體說明','No specific explanation was retained for this event')));
 if(e.actor?.agent_id)content.append(disclosure('event-identity-'+encodeURIComponent(e.task.id+'-'+e.at+'-'+e.action),t('紀錄識別','Record identity'),field(t('登記身份 ID','Registered actor ID'),e.actor.agent_id),field(t('責任人 ID','Principal ID'),e.actor.principal_id)));
 item.append(time,dot,content);list.append(item);}box.append(group);}
 if(!events.length)box.append(empty());return box;
}
function pager(result,next,previous){const row=node('div',undefined,'pagination');row.append(node('span',(result?.total??0)+t(' 筆',' records')));if(previous)row.append(button(t('上一頁','Previous'),previous));if(result?.next_cursor)row.append(button(t('下一頁','Next'),()=>next(result.next_cursor)));return row;}
function backlog(){const result=pageResult;if(!result)return empty(t('讀取任務文件…','Loading tasks…'));const all=result.items;
 const toggle=node('div',undefined,'segment-control');for(const [history,label,total] of [[false,t('目前任務','Current tasks'),snapshot.total_tasks],[true,t('遷移前紀錄','Retained history'),snapshot.legacy_tasks_excluded??0]]){const b=button(label+' '+total,()=>{historyBacklog=history;backlogCursor=null;backlogPrevious=[];loadView();});b.setAttribute('aria-pressed',String(historyBacklog===history));toggle.append(b);}
 const missing=all.filter(task=>!task.execution?.recorded_operations).length;
 return append(node('div'),toggle,historyBacklog?node('p',t('遷移前的唯讀歷史。原階段保留，不代表已通過目前的驗收。','Read-only history from before migration. Original stages remain; they do not establish current acceptance.'),'chart-note'):null,pager(result,c=>{backlogPrevious.push(backlogCursor);backlogCursor=c;loadView();},backlogPrevious.length?()=>{backlogCursor=backlogPrevious.pop();loadView();}:null),
 all.length?table([t('任務','Task'),t('狀態','Status'),t('執行時間','Execution time'),'Tokens',t('文件','Documents'),t('最近更新','Updated')],all.map(task=>[append(node('div'),button(task.title,()=>openTask(task.id)),node('small',task.id)),badge(task.task_state),partialMeasurement(task.execution?.execution_ms,task.execution?.time_complete,duration),partialMeasurement(task.execution?.tokens,task.execution?.tokens_complete,number),button(task.document_count+t(' 份文件',' documents'),async()=>{await openTask(task.id);if(selected!==task.id)return;tab='documents';renderDetail();}),date(task.updated_at)])):append(empty(t('找不到符合目前搜尋或狀態的任務','No tasks match the current search or status')),button(t('清除篩選','Clear filters'),()=>{$('search').value='';$('state-filter').value='all';backlogCursor=null;backlogPrevious=[];loadView();})),
 missing?node('p',missing+t(' 件任務尚未回報用量',' tasks have not reported execution measurements'),'chart-note'):null,
 all.some(task=>typeof task.execution?.execution_ms==='number'&&!task.execution.time_complete||typeof task.execution?.tokens==='number'&&!task.execution.tokens_complete)?node('p',t('＊ 僅含已記錄部分，尚非完整用量','* Recorded subtotals; complete usage is unavailable'),'chart-note'):null);}
function activity(){
 const box=node('div'),controls=node('div',undefined,'segment-control');for(const [v,label] of [['24',t('24 小時','24 hours')],['168',t('7 天','7 days')]]){const b=button(label,()=>{activityHours=v;activityCursor=null;activityPrevious=[];loadView();});b.setAttribute('aria-pressed',String(activityHours===v));controls.append(b);}box.append(controls);
 const data=activityResult;if(!data)return append(box,empty(t('讀取活動紀錄…','Loading activity…')));
 const p=helpHeading(panel(t('執行時段','Execution intervals')),t('這張圖回答「AI 在什麼時候執行過哪些任務」。每列是一件任務，色塊的位置是開始時間，長度是已記錄的執行時間。\n\n需要執行工具提供每次開始、結束紀錄。任務建立、交付或待審查的時間，不能用來推算 AI 持續在工作。沒有色塊時，請看下方任務事件；它仍能說明狀態何時改變。','This chart shows when AI operations ran for each task. Each row is a task; the position of a span shows its start, and its width shows its recorded duration.\n\nThe execution tool must report start and end times. Creating, delivering or reviewing a task does not prove continuous execution. The events below remain useful when execution measurements are missing.'));
 p.append(node('p',date(new Date(data.start).toISOString())+' — '+date(new Date(data.end).toISOString()),'chart-note'));
 const lanes=node('div',undefined,'activity-lanes'),ids=[...new Set(data.intervals.map(i=>i.task_id))].slice(0,30);
 for(const id of ids){const lane=node('div',undefined,'activity-lane'),track=node('div',undefined,'activity-track');lane.append(button(id,()=>openTask(id)),track);
 for(const i of data.intervals.filter(i=>i.task_id===id)){const b=button('',()=>openTask(id),'activity-span');b.style.left=Math.max(0,(i.start-data.start)/(data.end-data.start)*100)+'%';b.style.width=Math.max(.3,(Math.min(i.end,data.end)-Math.max(i.start,data.start))/(data.end-data.start)*100)+'%';b.setAttribute('aria-label',i.title+' · '+date(new Date(i.start).toISOString())+' · '+duration(i.end-i.start));b.title=b.getAttribute('aria-label');track.append(b);}lanes.append(lane);}
 if(ids.length)p.append(node('p',t('最多顯示 30 件任務、300 個區間；此範圍共 ','Up to 30 tasks and 300 intervals; this range has ')+data.interval_count+t(' 個區間，可搜尋指定任務',' intervals. Search for a specific task'),'chart-note'),lanes,node('p',t('沒有色塊的位置未必是閒置，可能尚未收到執行紀錄','Gaps may indicate missing execution records, not idle time'),'chart-note'));
 else p.append(node('p',t('尚未收到這段期間的執行時間紀錄。以下仍可查看任務的狀態變化與原因。','No execution timing has been reported for this period. Task changes and their reasons are shown below.'),'coverage-note'));box.append(p);
 const eventTasks=new Map();for(const e of data.events.items){if(!eventTasks.has(e.task_id))eventTasks.set(e.task_id,{id:e.task_id,title:e.title,timeline:[]});eventTasks.get(e.task_id).timeline.push(e);}
 const details=node('details',undefined,'disclosure');details.id='activity-events';details.open=true;details.append(node('summary',t('任務事件 ','Task events ')+data.events.total),timeline([...eventTasks.values()],50),pager(data.events,c=>{activityPrevious.push(activityCursor);activityCursor=c;loadView();},activityPrevious.length?()=>{activityCursor=activityPrevious.pop();loadView();}:null));box.append(details);return box;
}

function stageProgress(task){const container=node('div',undefined,'detail-stage'),current=shownStages().indexOf(task.task_state);for(const [i,state] of shownStages().entries()){const el=node('span',name(state),i<current?'passed':'');if(i===current)el.setAttribute('aria-current','step');container.append(el);}return container;}
function taskNotice(task){if(task.read_status==='available'&&task.task_state==='done'&&task.record_mode!=='work-items')return [t('已完成','Done'),t('最後完成摘要：','Completion summary: ')+(task.closeout?.summary??[...(task.timeline??[])].reverse().find(event=>event.action==='close')?.reason??t('已記錄完成驗收','Completion recorded')),...(task.needs_attention?(lang==='en'?[task.next_action]:taskActions(task)):[])];if(task.record_mode==='work-items')return [t('目前階段：','Recorded stage: ')+name(task.source_state),...(task.unresolved??[])];if(lang!=='en')return taskActions(task);return task.read_status==='unavailable'?['This task record could not be verified.']:[task.next_action??'Inspect the task record.'];}
function lifecycle(task){
 const timing=stageExecutionSummary(task),box=helpHeading(panel(t('各階段已記錄時間','Recorded time by stage')),t('查看規劃、實作、審查、修正和驗證各花了多少執行時間。新紀錄以執行工具回報的工作種類分類；舊紀錄沒有分類時，才依任務當時的階段整理。\n\n只計入已回報的執行區間，排除等待你回覆的時間。同一分類內同時執行的區間只計一次；不同分類可能並行，因此各列相加可能大於任務的實際經過時間。\n\n未回報不代表 0。這是已綁定操作的工作時間，包含工具執行，不是模型的純推論時間。','See reported time for planning, implementation, review, repair and verification. New records use the reported activity kind; older records fall back to task stages.\n\nOnly reported execution intervals count, excluding human waits. Overlaps count once within a kind; different kinds may run concurrently, so rows can sum to more than task wall time.\n\nUnreported is not zero. Bound operation time includes tools and is not model-only compute time.'));
 box.id='lifecycle';
 for(const key of ['planning','implementation','review','rework','verification']){const label=activityLabel(key),row=node('div',undefined,'phase-row'),value=timing.phases[key];if(value===null){row.append(node('span',label),node('span','—','muted'),node('span',t('未記錄工時','Time not recorded')));}else{const p=node('progress');p.max=Math.max(1,timing.assigned_ms);p.value=value;p.setAttribute('aria-label',label);row.append(node('span',label),p,node('span',duration(value)));}box.append(row);}
 if(timing.assigned_ms===null)box.append(node('p',t('尚無可分階段的 AI 執行時間','No AI execution times can be assigned to stages yet.'),'coverage-note'));
 if(timing.assigned_ms!==null&&!timing.complete)box.append(node('p',t('部分紀錄：僅含已回報的工具執行時間','Partial records: reported tool execution only.'),'chart-note'));
 if(timing.unassigned_ms>0)box.append(node('p',duration(timing.unassigned_ms)+t(' 的已記錄時間無法歸入實作、審查或修正階段',' of recorded time cannot be assigned to implementation, review or rework'),'chart-note'));return box;
}
const splitHelp=()=>t('快取輸入是輸入的一部分，不另加進總數。非快取輸入＝輸入－快取輸入；未回報快取時，非快取也保留未知。推理 Tokens 已包含在輸出中。各列只加總已回報值，涵蓋率表示目前篩選內已收集操作的已知筆數／總筆數。不同列可能涵蓋不同操作，不能把部分小計當完整總量。','Cached input is part of input, not an extra total. Uncached input = input − cached input; missing cache leaves uncached input unknown. Reasoning tokens are included in output. Each row sums reported values; coverage is known / collected operations within the current filters. Rows may cover different operations, so partial subtotals are not complete totals.');
const turnHelp=()=>t('完整回合時間只採用執行端明確回報的整個回合耗時，包含工具與回合內等待，不是模型運算時間。工具執行時間另行統計，不與整回合 Tokens 混搭成效率指標。','Full-turn duration uses only explicitly reported host turn duration. It includes tools and waits within the turn, and is not model compute time. Tool execution time is recorded separately and is not paired with whole-turn tokens as an efficiency metric.');
function splitTable(record,id){
 const wrap=table([t('Tokens 分類','Token breakdown'),t('已回報小計','Reported subtotal'),t('涵蓋率','Coverage')],['input','cached_input','uncached_input','output','total'].map((key,i)=>{
  const value=record?.token_breakdown?.[key],coverage=record?.metric_coverage?.[key],cell=node('span',number(value));cell.dataset.tokenMetric=key;
  const count=node('span',coverage?coverage.known+' / '+coverage.total:t('未知','Unknown'));count.dataset.coverageMetric=key;
  return [[t('輸入（含快取）','Input (includes cache)'),t('快取輸入','Cached input'),t('非快取輸入','Uncached input'),t('輸出（含推理）','Output (includes reasoning)'),t('總計：輸入＋輸出','Total: input + output')][i],cell,count];
 }));if(id)wrap.id=id;return wrap;
}
function turnField(record){const c=record?.metric_coverage?.turn_ms;return field(t('完整回合時間','Full-turn duration'),duration(record?.turn_ms)+(c?' · '+c.known+' / '+c.total:''),turnHelp());}
function executionPanel(task){
 const m=task.execution??executionSummary(task),box=helpHeading(panel(t('工具執行時間','Tool execution time')),t('這裡顯示執行工具為這件任務回報的工作時間，以及模型輸入、輸出使用的 Tokens。Tokens 是模型處理文字等內容的計量單位，不是費用。\n\n時間以每次執行的開始與結束紀錄計算，多個 Agent 同時工作只計一次；未執行的等待時間不會從任務建立日期一路累加。\n\n「未回報」不代表 0；「部分」僅含已綁定的紀錄，未完成或缺少的紀錄不補成 0。未綁定回合、其他 Agent 與審查工作不會自動補入。','This section shows tool execution time reported for this task and model input/output tokens. Tokens measure processed content; they are not a price.\n\nTime comes from reported operation start/end intervals; overlapping agents count once. Waiting does not accumulate from the date the task was created.\n\nUnreported does not mean zero. Partial covers recorded bindings only; unfinished or missing records are not filled with zero. Unbound turns, other agents and review activity are not automatically included.'));
 const measured=aggregateRows(operationRows([task]),'task_id')[0];
 box.append(field(t('已回報工具時間','Reported tool time'),reportedMeasurement(m.execution_ms,m.time_complete,duration)),turnField(measured),splitTable(measured,'task-token-breakdown'),help(t('Tokens 分類說明','About token breakdown'),splitHelp()));
 if(!m.recorded_operations)box.append(node('p',t('這件任務尚無執行用量紀錄','This task has no execution measurements.'),'chart-note'));
 const hostRuns=(task.runs??[]).filter(run=>run.measurement_source==='native-host-report');
 if(m.recorded_operations)box.append(disclosure('task-coverage',t('紀錄涵蓋範圍','Record coverage'),node('p',m.measured_intervals+' / '+m.recorded_operations+t(' 筆已綁定操作有完整時間區間；此比例不代表整件任務的完成度或總工時。',' bound operations have complete time intervals. This ratio does not measure task completion or total effort.'),'chart-note'),hostRuns.length?node('p',t('原生工具僅回報明確綁定的回合或操作。Tokens 可先回報；若未提供扣除等待的執行區間，工具執行時間仍顯示未回報。','Native reports cover explicitly bound turns or operations. Tokens may arrive before timing; tool execution time remains unreported without wait-excluded intervals.'),'chart-note'):null));
 return box;
}

function activityLabel(kind){return ({planning:t('規劃','Planning'),implementation:t('實作','Implementation'),review:t('審查','Review'),repair:t('修正','Repair'),rework:t('修正','Repair'),verification:t('驗證','Verification')})[kind]??t('未分類','Unclassified');}
function executionLabel(op){return t('執行 ','Execution ')+String(op.index).padStart(2,'0');}
function executionOverview(task,all=false){
 const data=executionBreakdown(task),box=helpHeading(panel(t('執行分工','Execution breakdown')),t('每列是一筆已綁定的執行紀錄，列出工作分類、執行工具、實際回報的模型、推理強度和用量。執行編號方便對照，不代表有相同數量的 Agent；同一個 Agent 可以有多筆執行。\n\n並行狀況只依已記錄的時間區間判定，缺少的紀錄不會推測補入。審查、修正可能由不同執行者或模型完成。原始執行 ID 與選模原因可在「模型與執行」查看。','Each row is a bound execution record with its activity, tool, reported model, reasoning and usage. Execution numbers identify records, not distinct agents; one agent may have several records.\n\nOverlap is determined only from reported intervals. Missing records are not inferred. Review and repair may use different executors or models. Open Model & runtime for original execution IDs and model-selection reasons.'));
 box.id=all?'execution-breakdown-full':'execution-breakdown';
 if(!data.rows.length)return append(box,empty(t('尚無執行紀錄','No execution records')));
 box.append(field(t('已使用模型','Reported models'),data.models.length?data.models.join(' · '):t('未回報','Not reported')),node('p',data.mode==='observed-overlap'?t('已記錄區間有並行，最多 ','Recorded intervals overlap: up to ')+data.max_concurrent+t(' 筆同時執行',' concurrent operations'):data.mode==='no-observed-overlap'?t('已記錄的執行區間未重疊','Recorded execution intervals do not overlap'):t('尚無可判定並行狀況的時間區間','No intervals available to determine overlap'),'chart-note'));
 const rows=all?data.rows.slice(detailOperationPage*20,detailOperationPage*20+20):data.rows.slice(0,8);
 box.append(table([t('分工／執行','Activity / execution'),t('模型／強度','Model / reasoning'),t('工時／Tokens','Time / tokens')],rows.map(op=>[
 append(node('div'),node('b',activityLabel(op.stage)+' · '+executionLabel(op)),node('small',name(op.tool))),
 append(node('div'),node('span',op.model==='unreported'?t('模型未回報','Model not reported'):op.model),node('small',op.reasoning==='unreported'?t('強度未回報','Reasoning not reported'):op.reasoning)),
 append(node('div'),reportedMeasurement(op.ms,op.time_complete,duration),append(node('small'),reportedMeasurement(op.tokens,op.tokens_complete,number),node('span',' Tokens')))])));
 if(!all)box.append(button(t('查看每次執行','View execution details'),()=>{tab='model';renderDetail();}));return box;
}
function overviewDetail(task){
 const body=node('div');body.append(task.record_mode==='work-items'?node('p',t('歷史紀錄 · 原階段：','Historical record · Original stage: ')+name(task.task_state),'chart-note'):stageProgress(task),executionPanel(task));const action=panel(t('目前狀態','Current state'),...taskNotice(task).map(s=>node('p',s,'attention-text')));action.id='next-action';
 const copy=button(t('複製接手摘要','Copy handoff'),()=>copyHandoff(task)),status=node('span',undefined,'small'),fallback=node('textarea');copy.id='copy-handoff';copy.disabled=task.read_status!=='available';status.id='copy-status';status.setAttribute('role','status');fallback.id='handoff-text';fallback.readOnly=true;fallback.hidden=true;
 if(task.task_state==='done')action.classList.add('completion');
 action.append(disclosure('handoff-details',t('接手與技術詳情','Handoff & technical details'),node('p',t('複製任務範圍、目前狀態與證據，交給下一位執行者接續查閱。摘要是唯讀快照，不會啟動任務或變更授權。','Copy the task scope, current state and evidence for the next executor to inspect. This read-only snapshot does not start work or change authorization.'),'chart-note'),append(node('div',undefined,'row'),copy,status),fallback));body.append(action);
 if(task.read_status!=='available'){body.append(empty(t('紀錄無法驗證，請檢查來源文件。','Record unavailable. Inspect its source.')));return body;}
 body.append(panel(t('任務內容','Task brief'),node('p',task.goal),node('h3',t('範圍','Scope')),list(task.scope?.include),node('h3',t('不包含','Excluded')),list(task.scope?.exclude),node('h3',t('驗收條件','Acceptance criteria')),list(task.acceptance_criteria)));
 const delivery=panel(t('交付與審查','Delivery & review'));
 if(task.delivery){delivery.append(field(t('候選版本','Candidate'),task.candidate_revision),field(t('交付說明','Delivery'),task.delivery.summary));if(task.review)delivery.append(field(t('審查結果','Review'),name(task.review.judgment)),field(t('審查說明','Review summary'),task.review.summary));else delivery.append(node('p',t('已交付，等待獨立審查','Delivered; awaiting independent review')));
 delivery.append(field(t('驗收','Acceptance'),task.quality?.locally_accepted?t('已驗收','Accepted'):t('尚未驗收','Not accepted')));}
 else delivery.append(node('p',t('尚未交付候選版本；完成實作後才會產生交付與審查紀錄。','No candidate has been delivered. Delivery and review records appear after implementation.')));
 delivery.id='delivery';body.append(delivery,lifecycle(task),executionOverview(task));
 const evidence=task.evidence??[];

 const links=node('div',undefined,'row detail-links');
 for(const [key,label,pattern] of [['pull_request',t('開啟 Pull Request','Open pull request'),/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/],['conversation',t('開啟來源對話','Open source conversation'),/^codex:\/\/threads\/[a-f0-9-]{36}$/]]){const url=task.observation?.value?.links?.[key];if(pattern.test(url??'')){const a=node('a',label);a.href=url;a.rel='noopener noreferrer';links.append(a);}}
 body.append(links,panel(t('任務歷程','Task history'),timeline([task])));
 if(evidence.length)body.append(disclosure('task-evidence',t('證據與觀測','Evidence & observations'),helpHeading(panel(t('證據與觀測','Evidence & observations'),...evidence.map(e=>node('p',e.path+' · '+name(e.status))),task.observation?.value?.note?node('p',task.observation.value.note):null),t('這些是任務在核准、交付、審查或驗收時引用的檔案。「雜湊吻合」表示目前檔案內容符合當時保存的版本；它本身不代表測試通過，測試結果請看文件內容。','These files were referenced during approval, delivery, review or acceptance. A matching hash means the file still matches the retained version; it does not itself establish a passing test. Read the document for its actual result.'))));return body;
}
async function copyHandoff(task){
 const text=handoffText(task,snapshot.read_at);if(!text)return;const epoch=++copyEpoch;
 try{await navigator.clipboard.writeText(text);if(epoch===copyEpoch)$('copy-status').textContent=t('已複製','Copied');}
 catch{if(epoch!==copyEpoch)return;$('handoff-text').value=text;$('handoff-text').hidden=false;$('copy-status').textContent=t('請選取複製','Select and copy');$('handoff-text').focus();$('handoff-text').select();}
}


function modelDetail(task){
 const box=node('div'),rows=executionBreakdown(task).rows;
 box.append(append(node('div',undefined,'row'),node('h2',t('執行回報','Execution reports')),help(t('執行回報','Execution reports'),t('一件任務可以有多次執行，使用不同工具與模型。分別顯示任務指定的設定，以及實際執行時回報的設定。\n\n* 表示部分紀錄，尚非整件任務的總用量；未回報不代表 0。原生工具只涵蓋已綁定的回合或操作。','A task can use several tools and models. Requested settings and execution reports are shown separately.\n\n* marks partial records, not the whole task total. Unreported does not mean zero. Native tools cover bound turns or operations only.'))));
 if(!rows.length)box.append(empty(t('尚無執行紀錄；外部工具中的模型與用量未自動回報。','No execution records. External tool settings and usage have not been reported.')));
 const totalPages=Math.ceil(rows.length/20);if(totalPages>1){const nav=node('div',undefined,'pagination');if(detailOperationPage>0)nav.append(button(t('上一頁','Previous'),()=>{detailOperationPage--;renderDetail();}));nav.append(node('span',(detailOperationPage+1)+' / '+totalPages));if(detailOperationPage+1<totalPages)nav.append(button(t('下一頁','Next'),()=>{detailOperationPage++;renderDetail();}));box.append(nav);}
 box.append(executionOverview(task,true));
 for(const op of rows.slice(detailOperationPage*20,detailOperationPage*20+20)){const native=op.usage_source==='native-host-report',stateLabel=native&&op.state==='unconfirmed'?t('收集中','Collecting'):name(op.state),p=disclosure('operation-'+encodeURIComponent(op.key),activityLabel(op.stage)+' · '+executionLabel(op)+' · '+stateLabel);p.dataset.key=op.key;p.append(node('small',date(op.date)),
 field(t('執行工具','Execution tool'),name(op.tool)),field(t('連線類型','Connection type'),name(op.connection_kind)),field(t('模型來源','Model source'),name(op.provider)),
 field(t('指定模型','Requested model'),op.requested_model,t('任務或流程要求使用的模型，不保證執行端實際使用相同模型。','Model requested by the task or workflow; not confirmation of the model used.')),
 field(t('執行端回報','Runtime model'),op.runtime_model),field(t('供應端回報','Provider model'),op.observed_model),
 field(t('指定推理強度','Requested reasoning'),op.requested_reasoning?op.requested_reasoning.name+' · '+op.requested_reasoning.value:t('未記錄','Not recorded'),t('執行前要求模型投入多少推理工作，例如 medium、high、xhigh。較高設定可能需要更多時間與 Tokens，但不保證結果更好；不同模型的等級不能直接比較。','The requested reasoning level, such as medium, high or xhigh. A higher level may use more time and tokens but does not guarantee a better result. Levels are not directly comparable across models.')),
 field(t('回報的推理強度','Reported reasoning'),op.reported_reasoning??t('未回報','Not reported')),
 field(t('工具執行時間','Tool execution time'),duration(op.ms)+(op.ms!==null&&!op.time_complete?' *':'')),turnField(op),splitTable({...op,metric_coverage:Object.fromEntries(['input','cached_input','uncached_input','output','total'].map(key=>[key,{known:op.token_breakdown?.[key]!=null?1:0,total:1}]))}),help(t('Tokens 分類說明','About token breakdown'),splitHelp()));
 if(op.activity_kind)p.append(field(t('工作分類','Activity'),({planning:t('規劃','Planning'),implementation:t('實作','Implementation'),review:t('審查','Review'),repair:t('修正','Repair'),verification:t('驗證','Verification')})[op.activity_kind]??op.activity_kind));
 if(op.selection_match==='mismatch')p.append(node('p',t('執行端回報的模型或推理強度與指定值不同','Reported model or reasoning differs from the request'),'notice'));
 const reasons={'host-owned':t('沿用主工具的選擇','Selected by the host'),'explicit':t('任務明確指定','Explicit task selection'),'default':t('專案預設','Project default'),'classifier-advisory':t('本機分類器依專案政策選擇','Local classifier with project policy'),'conservative-uncertain-classifier':t('分類不確定，使用保守選項','Conservative model for uncertain classification'),'conservative-high-risk':t('風險較高，使用保守選項','Conservative model for higher risk')};
 p.append(disclosure('execution-'+encodeURIComponent(op.key),t('選模與執行識別','Selection and execution identity'),field(t('選擇原因','Selection reason'),reasons[op.selection_reason]??op.selection_reason),field(t('執行 ID','Execution ID'),op.execution_id??op.operation_id)));
 if(op.usage_source==='native-host-report'){
   p.append(field(t('紀錄來源','Measurement source'),t('已綁定的原生工具回報','Bound native tool report'),t('這份資料由執行工具的紀錄取出，未另行呼叫模型。僅涵蓋綁定範圍，不代表整件任務或所有 Agent 的總用量。','Collected from existing execution-tool records without a model call. It covers the binding only, not every operation or agent in the task.')));
 }box.append(p);}
 return box;
}
function skillDetail(task){const p=panel(t('任務使用的技能','Task Skills'),help(t('技能使用紀錄','About Skill records'),t('任務契約記錄了指定的 Skill。讀取、應用與驗證必須各自有紀錄，不從文字推測。下方經驗採用紀錄與 Skill 選取分開記錄。','The contract records selected Skills. Reading, application and verification need separate evidence. Learning use below is recorded separately from Skill selection.'),'task-skill-help'),
 task.skills?.length?table(['Skill',t('指定來源','Selection'),t('讀取／應用／驗證','Read / applied / verified')],task.skills.map(s=>[button(s.path,()=>showDocument(s.document_id)),t('任務契約','Task contract'),t('未記錄','Not recorded')])):empty(task.record_mode==='work-items'?t('這份任務紀錄尚未記載使用的技能','Skill use is not recorded for this task'):t('任務未指定 Skill','No Skills selected in the task contract')));
 p.append(node('h3',t('經驗採用','Learning use')));
 if(task.learning_unavailable)p.append(empty(t('經驗紀錄無法驗證','Learning records unavailable')));
 else p.append(task.learning_uses?.length?table([t('經驗','Learning'),t('階段','Stage'),t('決定與結果','Decision and outcome')],task.learning_uses.map(u=>[u.learning_id,learningState(u.outcome??u.stage),learningUseDecision(u)])):empty(t('尚無經驗採用紀錄','No learning use recorded')));
 return p;}
function taskSettings(task){const s=task.settings;if(!s)return empty();const p=panel(t('任務設定','Task settings'),node('p',t('來源：已核准的任務契約 · 適用範圍：此任務 · 唯讀','Source: approved task contract · Scope: this task · Read only'),'settings-source'),
 field(t('執行方式','Runtime'),name(s.runtime.adapter_id??s.runtime.kind),t('決定誰負責啟動模型、執行工具和回報結果。「由執行工具管理」表示目前聊天或開發工具負責；adapter 表示由 Workkeel 的流程連接器執行。原生工具若未回報用量，網站就沒有執行時間與 Tokens。','Who starts the model, runs tools and reports results. Host-owned means your chat or development tool manages execution; an adapter is a Workkeel workflow connector. Without host measurement reports, execution time and tokens are unavailable.')),field(t('連線','Connection'),name(s.connection?.kind),t('模型請求透過哪種方式送出。「沿用執行工具」使用原工具的模型連線；其他連線由任務或執行政策指定。這個欄位不是實際模型名稱。','How model requests are sent. Native uses the execution tool connection; other routes come from the task or execution policy. This field is not the actual model name.')),
 field(t('工具','Tools'),s.tools,t('任務核准可使用的工具。實際權限仍由執行環境強制執行。','Tools approved for this task; the execution host enforces actual permissions.')),field(t('可讀路徑','Read paths'),s.read_paths),field(t('可寫路徑','Write paths'),s.write_paths),
 field(t('網路','Network'),name(s.network_mode),t('任務核准的網路範圍，執行工具仍須限制連線。','Approved network scope, enforced by the execution tool.')),field(t('資料分類','Data class'),s.data_classification),field(t('模型資料存取','Model access'),s.model_access),
 field(t('允許操作','Operations'),s.operations),field(t('授權期限','Approval expiry'),s.expires_at?date(s.expires_at):t('未設定期限','No expiry recorded')),
 field(t('審查安排','Review separation'),name(s.separation),t('決定誰能檢查這件任務的交付結果。「由不同 Agent 審查」要求另一個 AI 執行者檢查；「由不同人審查」另外要求審查者歸屬不同的人。審查通過後才會進入待驗收。','Who may review the delivered result. Different-agent review requires another AI executor; different-principal review additionally requires a different person responsible for that reviewer. A passing review advances the task to acceptance.')));
 const policy=s.execution_policy;if(policy){p.append(node('h3',t('目前執行政策','Current execution policy')),node('p',policy.source_status==='pinned'?t('內容符合任務保存的版本；每次執行使用的設定請見「模型與執行」。','Matches the task-pinned source. See Model & runtime for individual execution settings.'):t('來源已變更或無法驗證，以下內容不代表原本核准的設定。','Source changed or unavailable; these values do not establish the originally approved settings.'),'chart-note'),field(t('來源','Source'),policy.source),field(t('預設模型代號','Default model ID'),policy.default_model),field('Headroom',policy.headroom,t('工具輸出處理方式。此設定不代表所有執行工具都具備相同整合。','Tool-output handling; support depends on the execution tool.')));
 for(const [key,label,explanation] of [['steps',t('最多執行步驟','Operation limit'),t('這個流程最多可以執行幾個步驟。','Maximum operations dispatched by this workflow.')],['attempts_per_node',t('每個步驟最多嘗試次數','Attempts per node'),t('每個步驟包含重試的上限。','Maximum attempts, including retries, for a step.')],['parallelism',t('最多同時執行步驟','Parallelism'),t('同時執行的步驟上限。','Maximum concurrently executing steps.')],['timeout_ms',t('逾時（毫秒）','Timeout (ms)'),t('核准的工作流程時間上限。','Approved workflow time limit.')]])p.append(field(label,policy.limits?.[key],explanation));
 p.append(field(t('路由規則','Routing rules'),policy.rules?.map(r=>r.nodes.join(', ')+' → '+r.model)),field(t('核准的模型','Approved model IDs'),policy.models?.map(m=>m.id)));}
 return p;}
async function openTask(id){
 const request=++detailRequest;detailOperationPage=0;selected=id;selectedTask=null;learningSelected=null;tab='overview';copyEpoch++;
 $('drawer').append($('detail-surface'));$('detail-id').textContent=id;$('detail-title').textContent=t('讀取任務…','Loading task…');$('detail-tabs').replaceChildren();$('detail-content').replaceChildren();
 if(!$('drawer').open)$('drawer').showModal();
 try{const task=await api('/api/task?id='+encodeURIComponent(id));if(selected!==id||request!==detailRequest)return;selectedTask=task;renderDetail();}
 catch{if(selected===id&&request===detailRequest)$('detail-content').replaceChildren(empty(t('任務無法讀取','Task unavailable')));}
}
function renderDetail(){
 $('expand-task').hidden=!!learningSelected||fullTask;
 if(learningSelected){renderLearningDetail(learningSelected);return;}
 const task=selectedTask;if(!task)return;
 $('detail-id').textContent=task.id;$('detail-title').textContent=task.title;$('expand-task').setAttribute('aria-label',t('開啟完整頁面','Open full page'));
 reconcile($('detail-tabs'),... [['overview',t('內容','Overview')],['documents',t('文件','Documents')],['model',t('模型與執行','Model & runtime')],['skills','Skills'],['settings',t('設定','Settings')]].map(([key,label])=>{const b=button(label,()=>{tab=key;copyEpoch++;renderDetail();if(fullTask)history.replaceState(history.state,'','?view=task&task='+encodeURIComponent(selected)+'&tab='+tab);});b.dataset.key=key;b.setAttribute('aria-current',tab===key?'page':'false');return b;}));
 const body=tab==='overview'?overviewDetail(task):tab==='model'?modelDetail(task):tab==='skills'?skillDetail(task):tab==='settings'?taskSettings(task):
 task.documents?.length?table([t('文件','Document'),t('版本','Version')],task.documents.map(d=>[button(d.path,()=>showDocument(d.id)),d.pinned_digest?.slice(0,12)])):empty(t('此階段尚無文件','No documents at this stage'));
 body.dataset.key=task.id+':'+tab;reconcile($('detail-content'),body);
}
function fullTaskPage(){
 const surface=$('detail-surface'),box=node('article',undefined,'task-full-page');
 box.append(button('← '+t('返回','Back')+' '+t(...titles[returnState?.view??view]),()=>{if(history.state?.taskPage)history.back();else leaveFullTask(returnState);},'back-link'),surface);
 return box;
}
function expandTask(push=true){
 if(!selectedTask)return;closeHelp();returnState=returnState??capturePage();fullTask=true;if($('drawer').open)$('drawer').close();
 if(push){history.replaceState({returnState},'','?view='+view);history.pushState({taskPage:true,returnState},'','?view=task&task='+encodeURIComponent(selected)+'&tab='+tab);}
 shell();render();renderDetail();window.scrollTo({top:0});
}
function leaveFullTask(state){
 if(fullTask)$('drawer').append($('detail-surface'));fullTask=false;returnState=null;selectedTask=null;selected=null;
 restorePage(state);shell();render();loadView().then(()=>window.scrollTo({top:state?.scroll??0}));history.replaceState(null,'','?view='+view);
}
window.addEventListener('popstate',async()=>{
 const route=new URLSearchParams(location.search);
 if(route.get('view')==='task'){const id=route.get('task'),request=++detailRequest;selected=id;try{const task=await api('/api/task?id='+encodeURIComponent(id));if(selected!==id||request!==detailRequest)return;selectedTask=task;tab=route.get('tab')??'overview';returnState=history.state?.returnState??{view:'board'};expandTask(false);}catch{if(selected===id&&request===detailRequest)showPage('backlog');}}
 else leaveFullTask(history.state?.returnState??returnState??{view:route.get('view')??'board'});
});

function markdown(content){const frag=document.createDocumentFragment();let code=null;
 for(const line of content.split('\n')){if(line.startsWith('~~~')||line.startsWith(String.fromCharCode(96).repeat(3))){if(code){frag.append(node('pre',code.join('\n')));code=null;}else code=[];continue;}if(code){code.push(line);continue;}
 const heading=line.match(/^(#{1,3})\s+(.*)$/);if(heading)frag.append(node('h'+heading[1].length,heading[2]));else if(line.trim())frag.append(node('p',line));}
 if(code)frag.append(node('pre',code.join('\n')));return frag;
}
async function showDocument(id,reload=false){
 const epoch=++bodyRequest;openDocument=id;
 if(!reload){$('document-body').replaceChildren(empty(t('讀取中…','Loading…')));$('document-source').textContent='';$('document-title').textContent=t('文件','Document');documentSignature=null;if(!$('document').open)$('document').showModal();}
 $('document-status').textContent=t('正在讀取來源','Reading source');
 try{const doc=await api('/api/document?id='+encodeURIComponent(id)+(selectedTask?.record_mode==='work-items'?'&history=1':''));if(epoch!==bodyRequest)return;
 $('document-source').textContent=doc.path;$('document-title').textContent=doc.path.split('/').at(-1);
 $('document-body').replaceChildren(markdown(doc.content));documentSignature=doc.digest;
 $('document-status').textContent=t('唯讀 · 版本 ','Read only · Version ')+doc.digest.slice(0,12);$('document').scrollTop=0;
 }catch{if(epoch===bodyRequest){$('document-status').textContent=t('來源無法讀取或已移除；保留的內容不是最新資料。','Source unavailable or removed. Retained content is not current.');if(!reload)$('document-body').replaceChildren(empty());}}
}
function learningPage(){
 if(!library)return empty(t('正在讀取學習與技能…','Reading local index…'));
 const box=node('div'),head=node('div',undefined,'section-head');head.append(node('h2',libraryMode==='skills'?t('技能庫','Skills'):t('學習紀錄','Lessons & practices')),
 help(t('學習與技能說明','About learning and Skills'),t('進度表示已完成並留下紀錄的階段。點開可查看各階段的條件；經驗不一定要製作成 Skill。技能庫包含框架內建、專案與啟動時指定的個人技能來源。','Milestones reflect recorded evidence, not time estimates. Open a record for the full criteria. Lessons do not all need to become Skills. The inventory includes bundled, project and explicitly configured personal Skill sources.'),'learning-help'));
 box.append(head);
 if(library.errors.length)box.append(node('p',t('部分來源無法讀取，清單可能不完整。','Some sources are unavailable; the inventory may be incomplete.'),'attention-text'));
 if(libraryMode==='skills'){
 const select=node('select');select.id='skill-origin';select.setAttribute('aria-label',t('技能來源','Skill origin'));for(const [value,label] of [['all',t('全部來源','All origins')],...['workkeel','project','user','third-party'].map(k=>[k,name(k)])]){const o=node('option',label);o.value=value;select.append(o);}
 const results=node('div');const fill=()=>{const skills=library.skills.filter(s=>(showLegacySkills||s.compatibility!=='legacy')&&(select.value==='all'||s.origin===select.value));results.replaceChildren(skills.length?table(['Skill',t('來源','Origin'),t('專案狀態','Project status'),t('說明','Description')],skills.map(s=>[append(node('div'),button(s.name,()=>showDocument(s.id)),node('small',s.path,'skill-location')),append(node('div'),badge(s.origin),node('small',s.compatibility==='legacy'?t('歷史相容用途','Legacy compatibility'):name(s.source_label))),s.availability==='project'?t('已在專案中','In this project'):s.availability==='different-version'?t('專案版本不同','Different project version'):t('尚未加入專案','Not added to project'),s.description])):empty(libraryQuery?t('找不到符合搜尋條件的技能','No Skills match your search'):t('目前來源沒有技能；可在啟動觀測服務時指定個人技能目錄','No Skills in these sources. Configure personal Skill directories when starting the observer')));};
 select.value=skillOrigin;on(select,'change',event=>{skillOrigin=event.currentTarget.value;render();});const legacyToggle=button(t('顯示歷史相容技能','Show legacy compatibility Skills'),()=>{showLegacySkills=!showLegacySkills;render();});legacyToggle.setAttribute('aria-pressed',String(showLegacySkills));box.append(append(node('div',undefined,'row'),select,legacyToggle),node('p',t('來源表示技能存放的位置；作者資訊以原始文件為準。','Origin identifies where a Skill is stored. Consult its source document for authorship.'),'chart-note'),results);fill();return box;
 }
 const filters=node('div',undefined,'filter-chips');for(const [key,label] of [['all',t('全部','All')],...['candidate','validated','active'].map(k=>[k,name(k)]),['proposal',t('Skill 提案','Skill proposals')],['deprecated',name('deprecated')]]){const b=button(label,()=>{learningFilter=key;render();});b.setAttribute('aria-pressed',String(learningFilter===key));filters.append(b);}box.append(filters);
 const entries=library.learning.filter(e=>learningFilter==='all'||learningFilter==='proposal'&&(e.proposal||e.promotion?.eligible)||learningFilter===e.status);
 for(const entry of entries){const b=button('',()=>{learningSelected=entry;renderLearningDetail(entry);if(!$('drawer').open)$('drawer').showModal();},'learning-row');b.dataset.learningId=entry.id;
 const title=append(node('div'),node('strong',entry.title),node('small',entry.id));
 const progress=node('span',undefined,'learning-progress');if(!entry.stopped){const seg=node('span',undefined,'segments');seg.setAttribute('aria-hidden','true');for(let i=0;i<7;i++)seg.append(node('span',undefined,i<entry.completed_milestones?'passed':''));progress.append(seg,node('span',entry.completed_milestones+'/7'));progress.setAttribute('aria-label',t('已完成 ','Completed ')+entry.completed_milestones+'/7');}
 const next=entry.native?(entry.effective_state==='review-required'?t('來源待複查','Review sources'):entry.promotion?.eligible?t('可提出 Skill 提案','Ready for a Skill proposal'):entry.eligible?t('可供任務參考','Available as guidance'):t('尚未列入推薦','Not recommended yet')):entry.stopped?t('已停止升格','Promotion stopped'):entry.proposal?.status==='approved'?t('已核准，待撰寫','Approved; awaiting draft'):entry.proposal?t('提案：','Proposal: ')+name(entry.proposal.status):entry.kind==='practice'?t('尚無 Skill 提案','No Skill proposal'):entry.status==='candidate'?t('尚需驗證','Awaiting validation'):t('保留為經驗','Retained as lesson');
 b.append(title,node('span',t(entry.kind==='practice'?'實務準則':'經驗紀錄',entry.kind==='practice'?'Practice':'Lesson'),'learning-type'),entry.native?node('span',learningState(entry.effective_state),'badge'):badge(entry.status),progress,node('span',next,'learning-next'),node('span','›'));box.append(b);}
 if(library.native_total>library.native_limit)box.append(node('p',t('僅顯示前 ','Showing the first ')+library.native_limit+t(' 筆；請搜尋以縮小範圍',' records; narrow the search'),'chart-note'));
 if(!entries.length)box.append(empty(t('此範圍沒有學習紀錄','No learning records in this view')));return box;
}
const milestones=()=>[[t('記錄','Capture'),t('保存經驗與來源。','Save the lesson and its sources.')],[t('驗證','Validate'),t('在適用情境核對經驗。','Check the lesson in an applicable context.')],[t('採用','Adopt'),t('建立並採用實務準則。','Adopt a reusable practice.')],[t('核准','Approve'),t('核准有明確範圍的 Skill 撰寫提案。','Approve a scoped Skill-authoring proposal.')],[t('撰寫','Author'),t('完成 Skill 草稿及必要資源。','Complete the Skill draft and its resources.')],[t('檢查','Check'),t('檢查觸發條件、內容與實際結果。','Check triggers, instructions and actual results.')],[t('啟用','Enable'),t('記錄啟用來源與適用範圍。','Record enablement and its scope.')]];
const learningState=value=>({candidate:t('待驗證','Awaiting validation'),validated:t('已驗證','Validated'),adopted:t('已採用','Adopted'),deferred:t('暫緩','Deferred'),contradicted:t('已推翻','Contradicted'),'review-required':t('待複查','Needs review'),found:t('已找到','Found'),read:t('已閱讀','Read'),applied:t('已應用','Applied'),outcome:t('結果','Outcome'),verified:t('已驗證結果','Verified outcome'),failed:t('結果未通過','Failed outcome'),unknown:t('結果未知','Unknown outcome')})[value]??name(value);
function learningUseDecision(use){return append(node('div'),node('p',use.decision),use.reasons?.length?node('small',t('證據需複查','Evidence needs review'),'notice'):node('small',date(use.at)));}
function nativeLearningDetail(entry){
 const box=node('div');box.append(node('p',entry.summary),field(t('狀態','Status'),learningState(entry.effective_state)),field(t('適用情境','Applies to'),entry.applicability),field(t('不適用情境','Exclusions'),entry.exclusions),field(t('來源任務','Source task'),entry.source_task));
 if(entry.reasons.length)box.append(panel(t('待處理原因','Review needed'),...entry.reasons.map(r=>field(({candidate:t('尚未驗證','Not validated'),deferred:t('驗證暫緩','Review deferred'),contradicted:t('經驗已被推翻','Guidance contradicted'),'not-adopted':t('尚未採用','Not adopted'),'stale-evidence':t('來源已變更','Source changed'),'unknown-evidence':t('來源無法讀取','Source unavailable'),'ancestor-ineligible':t('上游經驗需複查','Review upstream guidance')})[r.code]??t('紀錄需複查','Review record'),r.source??r.ancestor??entry.id))));
 if(entry.review)box.append(disclosure('learning-validation-'+entry.id,t('驗證紀錄','Validation record'),node('p',entry.review.decision),field(t('驗證任務','Review task'),entry.review.task_id),field(t('時間','Time'),date(entry.review.at))));
 const use=panel(t('任務採用紀錄','Use in tasks'));use.append(help(t('如何判讀採用紀錄','About use records'),t('找到與讀過只表示曾參考內容。應用紀錄須指出改變了哪個決定；結果紀錄另列驗證證據。這些紀錄不代表已證明節省時間或 Tokens。','Found and read mean the content was consulted. Application records state a changed decision; outcome records separately cite verification evidence. These records do not establish time or token savings.'),'learning-use-help'));
 use.append(entry.uses.length?table([t('任務','Task'),t('進度','Stage'),t('決定與結果','Decision and outcome')],entry.uses.map(u=>[u.task_id,learningState(u.outcome??u.stage),learningUseDecision(u)])):empty(t('尚無採用紀錄','No use recorded')));box.append(use);
 box.append(disclosure('learning-promotion-'+entry.id,t('轉為 Skill 的條件','Skill proposal criteria'),node('p',t('實務準則必須有現行驗證、來源仍有效，且至少兩個不同任務各自留下應用與通過驗證的結果，才會列為可提案。提案仍需人核准；不會自動產生或啟用 Skill。','A practice needs current validation, valid sources and applied plus verified outcomes from at least two distinct tasks to qualify for a proposal. Human approval is still required; no Skill is created or enabled automatically.')),field(t('有應用及驗證結果的任務','Tasks with application and verified outcome'),String(entry.promotion.distinct_actual_tasks)),field(t('提案條件','Proposal eligibility'),entry.promotion.eligible?t('已符合，可提出提案','Eligible for a proposal'):t('尚未符合','Not eligible'))));
 box.append(disclosure('learning-sources-'+entry.id,t('來源與關係','Sources and relationships'),field(t('衍生自','Derived from'),entry.derived_from),field(t('相關 Skills','Linked Skills'),entry.skill_refs),...entry.pins.map(pin=>field(pin.path,pin.sha256.slice(0,12)))),button(t('閱讀來源文件','Read source document'),()=>showDocument(entry.document_id)));
 return box;
}
function renderLearningDetail(entry){
 $('expand-task').hidden=true;$('detail-id').textContent=entry.id;$('detail-title').textContent=entry.title;$('detail-tabs').replaceChildren();
 if(entry.native){const box=nativeLearningDetail(entry);box.dataset.key='learning:'+entry.id;reconcile($('detail-content'),box);return;}
 const box=node('div');box.append(node('p',entry.summary),field(t('信心程度','Confidence'),({high:t('高','High'),medium:t('中','Medium'),low:t('低','Low')})[entry.confidence]??name(entry.confidence)),field(t('來源任務','Source tasks'),entry.sources),field(t('提案','Proposal'),entry.proposal?.status??t('尚無提案','No proposal')));
 const p=panel(t('成為 Skill 的里程碑','Milestones toward a Skill'));for(const [i,[label,explanation]] of milestones().entries())p.append(field((i<entry.completed_milestones?'✓ ':'○ ')+(i+1)+'. '+label,explanation));
 p.append(node('p',entry.stopped?t('此紀錄已停用，保留歷史，不要求繼續升格。','This record is deprecated. History is retained; no promotion is expected.'):t('若要製作成 Skill，還有 ','If promoted to a Skill, ')+(7-entry.completed_milestones)+t(' 個階段尚未記錄完成。',' milestones still require evidence.'),'chart-note'),
 node('p',t('目前能追蹤到提案核准。撰寫、檢查與啟用尚未有共用的完成紀錄，因此不會顯示為已完成。','Existing records can confirm proposal approval. Authoring, checking and enablement lack a unified completion record and are not inferred.'),'chart-note'));
 box.append(p,button(t('閱讀來源文件','Read source document'),()=>showDocument(entry.document_id)));box.dataset.key='learning:'+entry.id;reconcile($('detail-content'),box);
}
function settings(){
 const grid=node('div',undefined,'settings-grid'),display=panel(t('顯示','Display')),select=node('select');select.id='language';select.setAttribute('aria-label','Language');for(const [value,label] of [['zh-TW','繁體中文'],['en','English']]){const o=node('option',label);o.value=value;select.append(o);}select.value=lang;on(select,'change',event=>setLanguage(event.currentTarget.value));display.append(field(t('語言','Language'),select));
 const zones=node('select');zones.id='timezone';zones.setAttribute('aria-label',t('時區','Time zone'));
 const choices=[['system',t('跟隨系統','Follow system')+' — '+zoneLabel(resolveTimeZone())],['UTC','UTC'],...([...new Set([timeZone(),...(Intl.supportedValuesOf?.('timeZone')??['Asia/Tokyo','Asia/Taipei','America/New_York','Europe/London'])])].filter(x=>x!=='UTC').sort().map(x=>[x,x]))];
 for(const [value,label] of choices){const o=node('option',label);o.value=value;zones.append(o);}zones.value=timezonePreference;on(zones,'change',event=>setTimezone(event.currentTarget.value));
 display.append(field(t('時區','Time zone'),zones,t('活動時間、日期篩選與每日／每週圖表使用相同時區。任務耗時不受影響。','Activity, date filters and daily/weekly charts use this timezone. Durations do not change.')));grid.append(display);
 const p=snapshot.project;grid.append(panel(t('觀測服務','Observer'),
 field(t('讀取方式','Updates'),t('檔案變更後更新；每 2 秒確認連線','Update on file changes; check connection every 2 seconds'),t('背景程序監看檔案變更，更新可重建的本機索引；每 30 秒重新核對來源。瀏覽器只在資料版本改變時讀取頁面資料，隱藏時暫停。','The server watches changes and rebuilds its local index, with source reconciliation every 30 seconds. The browser fetches view data when its version changes and pauses while hidden.')),
 field(t('模型呼叫','Model calls'),'0',t('由本機程式讀取、驗證與彙整既有紀錄，不呼叫模型，也不使用模型產生說明。','Local code reads, validates and aggregates existing records. No model is called, including for explanations.')),
 field(t('服務','Service'),p.observer?.service==='background'?t('本機背景服務','Local background service'):p.observer?.service==='launch-agent'?t('登入時自動啟動','Starts at login'):t('隨終端程序執行','Runs in the terminal'),proxyAuth?t('經已驗證的 Tailscale 私人連線存取。背景服務的啟停由本機管理。','Access through the verified private Tailscale connection. Manage the background service locally.'):t('目前透過本機連線存取。背景服務的啟停由本機管理。','Currently accessed through a local connection. Manage the background service locally.'))));
 grid.append(helpHeading(panel(t('專案政策','Project policy'),field(t('Workkeel 版本','Workkeel version'),p.version),field(t('審查安排','Review separation'),name(p.review_separation),t('不同 Agent 或不同人負責審查；以已核准的專案政策為準。','A distinct agent or principal reviews the candidate, according to the approved project policy.')),disclosure('agent-identities',t('身份詳情','Identity details'),node('p',t('這些 Agent ID 用來追溯認領、交付與審查紀錄，是已登記的執行身份，不是職位或分工名稱。','These registered Agent IDs trace claims, deliveries and reviews. They identify execution identities, not positions or job titles.'),'chart-note'),field(t('已登記的 Agent','Registered agents'),p.agents))),t('這裡顯示唯讀政策。請透過原執行工具或專案設定調整。','These policies are read only. Change them in the owning execution tool or project configuration.')));
 const tools=snapshot.runtime_tools??[];
 grid.append(helpHeading(panel(t('模型與執行','Model & runtime'),field(t('任務設定的執行工具','Configured execution tools'),tools.map(name),t('來源是各任務的核准契約，實際執行情況請看任務詳情。','Source: approved task contracts. Inspect task details for actual execution reports.')),field(t('模型設定來源','Model settings'),t('逐任務／逐次執行','Per task / per operation'),t('各任務的指定設定與回報結果可在詳情中查看。Workkeel 不覆寫既有聊天工具的模型選擇。','Inspect requested and reported values in task details. Workkeel does not override the model selected in existing chats.'))),t('本機模型與不同供應商可透過原執行工具協作。自動執行需要對應 adapter；現有內建自動 adapter 是 Codex app-server。','Native tools can use local models or different providers. Automatic execution requires an adapter; the current built-in automatic adapter is Codex app-server.')));
 const bounds=helpHeading(panel(t('任務範圍與驗收','Task boundaries & acceptance')),t('範圍由每件任務的核准契約決定。選擇任務可查看有效值、來源與執行上限。','Boundaries come from each approved task contract. Select a task for effective values, sources and execution limits.'));
 for(const task of snapshot.tasks.slice(0,10))bounds.append(button(task.title,async()=>{await openTask(task.id);tab='settings';renderDetail();},'task-row'));
 if(snapshot.tasks.length>10)bounds.append(button(t('查找其他任務','Find another task'),()=>showPage('backlog')));grid.append(bounds);
 const sources=panel(t('技能與資料來源','Skills & data sources'));
 sources.append(field(t('任務資料','Task records'),'.ai-org/work-items',t('只讀取原生 Workkeel 任務；保留的舊紀錄不會冒充目前任務。','Reads native Workkeel tasks. Retained legacy records do not become current tasks.')),
 field(t('用量資料','Usage records'),'.ai-org/execution · .ai-org/host-usage',t('流程執行紀錄與明確綁定的原生工具回報。背景收集器只擷取已指定來源的用量欄位；觀測網站讀取整理後的資料，不呼叫模型。缺少的時間與 Tokens 保留為未知。','Workflow records and explicitly bound native-tool reports. The background collector extracts usage fields from specified sources; the observer reads the resulting metadata without calling models. Missing time and tokens remain unknown.')),
 field(t('技能來源','Skill sources'),t('內建、專案與啟動時指定的目錄','Bundled, project and launch-selected directories'),t('搜尋只讀取 SKILL.md 內容。網站不能增加來源、安裝或啟用技能。','Search reads SKILL.md files only. The website cannot add sources, install or enable Skills.')),
 field(t('學習資料','Learning records'),'.ai-org/learning',t('紀錄與驗證須由已授權流程明確保存；觀測頁不自動生成或升格。','Capture and validation must be explicitly recorded by an authorized workflow. The observer does not generate or promote Skills.')),
 field(t('索引與上限','Index & limits'),t('記憶體索引；最多 2,000 件原生任務','Memory index; up to 2,000 native tasks'),t('索引可從來源重建。列表每頁 50 筆，上限 100；超過讀取或回應上限會顯示錯誤，不會截斷後假稱完整。','The index is rebuilt from source. Lists default to 50 per page, capped at 100. Source and response limits fail explicitly.')));
 grid.append(sources);return grid;
}


function about(){
 const box=node('article',undefined,'guide');
 const section=(title,text)=>append(node('section',undefined,'guide-section'),node('h2',title),node('p',text));
 const diagramText=text=>text.replace(/[。.!?！？]+$/u,'');
 const tile=(title,text,tone='intake')=>{const el=append(node('div',undefined,'flow-step'),node('b',title),node('p',diagramText(text)));el.dataset.stage=tone;return el;};
 const flow=(items,tones=['intake','design','build','test'])=>{const row=node('div',undefined,'flow');items.forEach(([title,text],i)=>{if(i)row.append(node('span','→','flow-arrow'));row.append(tile(title,text,tones[i]));});return row;};
 const one=section(t('從目標到交付','From goal to delivery'),t('先定義要解決的問題、範圍與驗收條件，再設計解法、拆分工作。執行者依這份設計實作，保存結果，交給另一個 Agent 或人審查。','Define the problem, scope and acceptance criteria, then design the solution and split the work. Executors implement that design, preserve results and hand the candidate to a different agent or person for review.'));
 one.append(flow([[t('待開始','Ready'),t('目標、範圍、驗收與授權已記錄','Goal, scope, acceptance and authorization recorded')],[t('實作中','In progress'),t('接手任務，按設計實作並檢查','Claim the task, implement the design and verify')],[t('待審查','In review'),t('交付確切版本與證據，由不同 Agent 審查','Deliver the exact candidate and evidence for independent review')],[t('待驗收','Awaiting acceptance'),t('審查通過，由核准者確認結果與回復方式','Review passed; the approver checks results and rollback')],[t('已完成','Done'),t('保存驗收紀錄，合併與發布另行記錄','Acceptance recorded; merge and release are tracked separately')]],stages));

 const graph=node('div',undefined,'parallel-example');graph.setAttribute('aria-label',t('安全並行與整合示意','Safe parallel execution and integration'));

 graph.append(tile(t('已確認的設計','Confirmed design'),t('固定介面、範圍與相依關係','Stable interfaces, scope and dependencies'),'intake'),node('div','↓','graph-arrow'));
 const branches=node('div',undefined,'parallel-branches');
 for(const [title,body] of [[t('Agent A · 介面','Agent A · Interface'),t('實作畫面與互動','Build views and interactions')],[t('Agent B · 資料','Agent B · Data'),t('實作約定的資料介面','Implement the agreed data interface')],[t('Agent C · 文件','Agent C · Documentation'),t('依已確認的規格整理使用方式','Document the confirmed behavior')]])branches.append(tile(title,body,'build'));
 graph.append(branches,node('div','↓','graph-arrow'),tile(t('整合 → 測試 → 審查','Integrate → test → review'),t('收齊各自的版本與證據，再檢查整體結果','Collect exact revisions and evidence, then check the combined result'),'test'));
 one.append(node('h3',t('哪些工作可以同時進行','When work can run in parallel'),'guide-subhead'),graph,node('p',t('上圖是分工示例。並行需要工作已獲核准、前置工作已完成、共用的資料與介面已確認、檔案衝突已協調，且有可用的 Agent 與資源。條件不足就依序執行。多個 Agent 不代表必須使用同一模型。','This is a division-of-work example. Parallel work requires approved scope, ready dependencies, stable shared interfaces, coordinated file conflicts and available agents and resources. Otherwise work runs sequentially. Agents can use different models.'),'chart-note'),
 node('p',t('審查有具體問題時，保留原候選與失敗證據，回到實作修正後再檢查。超出範圍、達到設定的次數／時間限制，或無法確認先前操作是否完成時，會停止或轉交處理。','When review finds a concrete defect, preserve the candidate and failed evidence, make the scoped correction and check again. Scope changes, configured attempt or time limits, and uncertain previous operations require stopping or escalation.'),'chart-note'));box.append(one);
 const methods=section(t('這些工程概念如何用在 Workkeel','Engineering concepts in Workkeel'),t('這些概念對應不同的設計工作，可以一起使用。它們不代表每件任務都要經過固定四道額外程序。','These concepts address different design concerns and can work together. They do not require four extra procedures for every task.'));
 methods.append(table([t('概念','Concept'),t('處理什麼','Purpose'),t('框架中的做法','In Workkeel')],[
 ['Prompt engineering',t('把要求寫清楚','Make the instructions explicit'),t('任務目標、範圍、輸出、驗收條件，加上確實需要的 Skill；提示文字本身不是權限控制','Specify the goal, scope, output and acceptance criteria, with relevant Skills; prompts themselves do not enforce permissions')],
 ['Context engineering',t('提供這一步真正需要的資料','Supply the context needed for this step'),t('依任務、階段與用途選取目前規格、相關經驗、Skill 和接手紀錄，避免每次載入所有歷史','Select current specifications, relevant lessons, Skills and handoff records by task, stage and purpose')],
 ['Graph engineering',t('安排執行順序與分工','Define order, branches and joins'),t('相依關係決定順序；可安全並行的工作分開執行再整合。選配工作流程可明訂節點、條件分支、合併結果，以及暫停等待核准的步驟','Dependencies determine order; independent work can run concurrently and rejoin. Optional workflows declare nodes, conditional branches, joins and approval interrupts')],
 ['Loop engineering',t('依檢查結果修正，並設定停止條件','Use feedback in a bounded improvement cycle'),t('實作 → 檢查／審查 → 具體問題 → 修正；保留每次證據與停止條件，不把重試等同完成','Implement → check/review → concrete finding → correction, with evidence and stop conditions for each attempt')]
 ]),node('p',t('一般協作由使用中的工具按照任務紀錄進行。若要自動執行分支流程，需先設定流程並連接支援的執行工具。修正迴圈也需要明確授權與上限。觀測頁只顯示已有紀錄，不派工、不啟動模型。','Native collaboration is coordinated by the execution tool using task records. Automatic graph workflows need configuration and a compatible runtime. Repair loops also require explicit authorization and limits. This observer only displays records; it does not dispatch agents or start models.'),'chart-note'));box.append(methods);
 const two=section(t('資料與執行如何分工','How records and execution fit together'),t('模型與工具負責執行；Workkeel 保存任務、權限與證據；觀測頁用程式讀取這些紀錄。','Models and tools perform the work; Workkeel preserves task boundaries and evidence; the observer reads those records with local code.'));
 const architecture=node('div',undefined,'architecture');
 for(const [title,body] of [[t('任務與政策','Tasks & policies'),t('目標、核准、工具、讀寫範圍與審查條件','Goals, approval, tools, read/write scope and review requirements')],[t('執行工具與模型','Tools & models'),t('依工具能力使用雲端或本機模型','Use cloud or local models supported by the execution tool')],[t('檔案與執行紀錄','Files & execution records'),t('版本、交付、證據、時間、Tokens、學習與 Skill 來源','Revisions, delivery, evidence, time, tokens, learning and Skill sources')],[t('觀測網站','Observer website'),t('本機讀取 → 核對 → 彙整 → 顯示','Local read → validate → aggregate → display')]])architecture.append(tile(title,body));
 two.append(architecture);box.append(two);
 const three=section(t('什麼情況會留下學習紀錄','When learning is recorded'),t('任務遇到問題、找到有效做法或完成回顧時，執行者先判斷是否有值得再次使用的結論。獲准保存後，才會建立經驗紀錄；聊天中提過、測試通過或任務完成，都不會讓它自動出現在清單。','When work reveals a failure, a useful approach or a retrospective finding, the executor decides whether there is a reusable conclusion. An authorized, explicit capture creates a Lesson. A chat mention, passing test or completed task does not automatically create an entry.'));
 three.append(flow([[t('記錄','Capture'),t('保存結論與適用情境','Preserve the conclusion and applicable context')],[t('驗證','Validate'),t('重現、反例與範圍核對','Check reproduction, counterexamples and scope')],[t('採用','Adopt'),t('建立可重複使用的實務準則','Adopt a reusable practice')],[t('提案與撰寫','Propose & author'),t('達到門檻後，由人決定是否製作 Skill','Meet the threshold, then obtain a human decision to author a Skill')]],['intake','test','done','release_gate']));
 three.append(table([t('階段','Stage'),t('什麼條件下發生','Trigger and conditions'),t('留下什麼','Recorded result')],[
 [t('記錄經驗','Capture a Lesson'),t('執行者明確保存一個結論；必填標題、摘要與信心程度，可附來源任務、證據與適用範圍','An executor explicitly records a conclusion with a title, summary and confidence; source tasks, evidence and applicability can be attached'),t('初始狀態為待驗證，保存文件與索引','A document and index entry with candidate status')],
 [t('驗證經驗','Validate a Lesson'),t('驗證者檢查原情境、嘗試重現與反例，再記錄結果：「已確認」、「縮小適用範圍」或「與原結論矛盾」','A validator checks the original context, reproduction and counterexamples, then explicitly records confirmed, narrowed or contradicted'),t('「已確認」會標為已驗證，保存時間、記錄者與提供的證據；另外兩種結果不自動通過或停用','Confirmed marks the Lesson validated and saves time, recorder and supplied evidence; the other outcomes do not automatically pass or deprecate it')],
 [t('採用為實務準則','Adopt a Practice'),t('專案決定把適用的經驗整理成準則，連結來源經驗；新準則仍需驗證，驗證結果為「已確認」後才會標為已採用','The project chooses to formulate a practice linked to source Lessons; a new practice remains a candidate until confirmed'),t('保存適用範圍與責任歸屬，狀態為已採用','An active practice with its scope and ownership')],
 [t('列為 Skill 候選','Identify a Skill candidate'),t('實務準則已採用、信心程度為高、最近一次驗證結果為「已確認」，且來源至少涵蓋兩個不同任務','An active Practice with high confidence, confirmed revalidation and sources from at least two distinct tasks'),t('程式列出可提案項目或未滿足的條件，不會建立 Skill','Code reports eligibility or missing conditions; it does not create a Skill')],
 [t('核准提案','Approve a proposal'),t('提案交代觸發／不觸發條件、權限、風險、依賴、替代方案與重複性檢查，由人選擇核准、拒絕或延後','A proposal defines triggers, non-triggers, authority, risk, dependencies, alternatives and overlap; a human approves, rejects or defers it'),t('核准後建立一件限定範圍的撰寫任務','Approval creates a scoped authoring task')],
 [t('撰寫、檢查、啟用','Author, check & enable'),t('在撰寫任務中完成內容、觸發案例與檢查，依核准方式加入技能來源','Complete instructions, trigger scenarios and checks in the authoring task, then add the Skill through the approved process'),t('目前沒有一鍵自動撰寫／啟用流程，觀測頁也不推測這三階段已完成','There is no automatic author-and-enable command, and the observer does not infer completion of these stages')]
 ]),node('p',t('「已驗證」表示驗證者已留下「已確認」的結果。現有 CLI 會保存判斷與檢查資料格式，但不會自行重跑實驗來證明結論，也未強制每次都附證據；要判斷可信度，仍須查看來源文件。','Validated means a confirmed result was recorded. The CLI preserves that judgment and checks record structure; it does not rerun experiments to establish truth, and evidence is not mandatory for every revalidation. Inspect the source to assess the claim.'),'chart-note'),
 node('p',t('例：一次接手漏讀最新規格，先留下經驗紀錄。下一次針對漏讀原因與反例核對後記錄為「已確認」；專案再決定是否採用為準則。只有滿足候選門檻，才進入 Skill 提案。經驗也可以一直保留為經驗。','Example: a handoff misses the current specification, so the failure is captured as a Lesson. A later check of the cause and counterexamples may record confirmed, after which the project decides whether to adopt a practice. Skill proposals follow only when the candidate threshold is met. A useful lesson can remain a lesson.'),'learning-example'));
 const extra=node('details',undefined,'disclosure');extra.append(node('summary',t('提案重複與延後如何處理','How existing and deferred proposals are handled')),node('p',t('已有待審、已核准或被拒絕的提案時，不會再列為可重複提案的候選；延後的提案需等到再審日期。條件通過只表示可以提出提案，不等於已核准。','Pending, approved or rejected proposals prevent duplicate candidacy. Deferred proposals wait until their review date. Eligibility allows a proposal; it is not approval.')));three.append(extra);box.append(three);
 const four=section(t('圖表怎麼讀','Reading the charts'),t('工具執行時間依已回報區間合併計算，重疊區間只計一次。用量分析加總各次操作，可能包含重疊；階段圖依任務當時狀態分類工具時間。未回報的時間與審查工作不會推算。','Tool execution time combines reported intervals, counting overlaps once. Usage analysis sums operations that may overlap; stage charts classify tool time by the task state at that time. Unreported time and review activity are not inferred.'));
 four.append(node('p',t('未知不是 0。部分回報用 * 標示。趨勢依目前選定時區的執行開始日統計。跨日執行仍計入開始當日，不會推算每日分攤。','Unknown is not zero. Partial reports carry an asterisk. Trends use the operation start date in the selected timezone; cross-day usage is not apportioned by guessing.'),'chart-note'));box.append(four);
 box.append(node('footer','Workkeel '+(snapshot?.project.version??'')+' · MIT'));return box;
}
function svg(tag,attrs={},text){const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;return e;}
const compact=n=>n>=1000000?(n/1000000).toFixed(1)+'m':n>=1000?(n/1000).toFixed(1)+'k':number(n);
const timeTick=(n,max)=>max<1000?number(n)+'ms':compact(n/1000)+'s';
function chartRoot(title,w,h){const s=svg('svg',{class:'chart',viewBox:'0 0 '+w+' '+h,role:'img','aria-label':title});s.append(svg('title',{},title));return s;}
let chartObserver=null;
function chartWrap(draw){
 const wrap=node('div',undefined,'chart-wrap');wrap.drawChart=draw;wrap.append(draw(520));return wrap;
}
function resizeCharts(){
 chartObserver?.disconnect();
 const fit=wrap=>{const width=Math.max(280,Math.floor(wrap.clientWidth));if(wrap.dataset.chartWidth===String(width))return;wrap.dataset.chartWidth=String(width);reconcile(wrap,wrap.drawChart(width));};
 chartObserver=new ResizeObserver(entries=>{for(const entry of entries)if(entry.target.isConnected)fit(entry.target);});
 for(const wrap of $('content').querySelectorAll('.chart-wrap')){fit(wrap);chartObserver.observe(wrap);}
}
function bars(rows,metric,title,w=520){
 if(!rows.some(r=>r[metric]!=null))return empty(t('尚無可用數值','No measured values'));
 const max=Math.max(1,...rows.map(r=>r[metric]??0))*1.12,h=Math.max(144,rows.length*34+62),s=chartRoot(title,w,h),left=Math.min(156,Math.round(w*.34)),right=24,width=w-left-right,bottom=h-34;
 s.append(svg('rect',{x:left,y:12,width,height:bottom-12,class:'plot-frame'}));
 for(let i=0;i<=3;i++){const x=left+i*width/3;s.append(svg('line',{x1:x,y1:12,x2:x,y2:bottom,class:'gridline'}),svg('text',{x,y:h-16,'text-anchor':i===0?'start':i===3?'end':'middle'},metric==='ms'?timeTick(max*i/3,max):compact(max*i/3)));}
 for(const [i,row] of rows.entries()){
  const y=24+i*34,known=row[metric]!=null,complete=row[metric==='ms'?'time_complete':'tokens_complete'],chars=Math.max(8,Math.floor((left-12)/6.5));
  const label=svg('text',{x:left-10,y:y+13,'text-anchor':'end'},row.id.length>chars?row.id.slice(0,chars-1)+'…':row.id);label.append(svg('title',{},row.id));s.append(label);
  const rect=svg('rect',{x:left,y,width:known?Math.max(1,row[metric]/max*width):0,height:18,rx:3,class:complete?(metric==='ms'?'plot':'token-plot'):'partial'});
  rect.append(svg('title',{},row.id+' · '+(metric==='ms'?duration(row.ms):number(row.tokens))+(complete?'':' *')));s.append(rect);
  if(!known)s.append(svg('text',{x:left+5,y:y+13},t('未知','Unknown')));else if(!complete)s.append(svg('text',{x:left+Math.max(1,row[metric]/max*width)+4,y:y+13},'*'));
 }
 return s;
}
function scatter(rows,allRows,w=760){
 const valid=rows.filter(r=>r.paired_operations>0&&r.paired_turn_ms!=null&&r.paired_tokens!=null);if(!valid.length)return empty(t('尚無同時具備完整回合時間及輸入／輸出的終態操作','No terminal operations with full-turn duration and complete input/output'));
 const h=280,l=62,b=46,pw=w-l-24,ph=h-b-24,mx=Math.max(1,...valid.map(r=>r.paired_turn_ms))*1.08,my=Math.max(1,...valid.map(r=>r.paired_tokens))*1.08,s=chartRoot(t('完整回合時間與 Tokens','Full-turn duration and tokens'),w,h);
 s.append(svg('rect',{x:l,y:24,width:pw,height:ph,class:'plot-frame'}));
 for(let i=0;i<=3;i++){const x=l+i*pw/3,y=24+ph-i*ph/3;s.append(svg('line',{x1:l,y1:y,x2:w-24,y2:y,class:'gridline'}),svg('text',{x,y:h-24,'text-anchor':i===0?'start':i===3?'end':'middle'},timeTick(mx*i/3,mx)),svg('text',{x:l-10,y:y+4,'text-anchor':'end'},compact(my*i/3)));}
 s.append(svg('text',{x:l,y:13},'Tokens'),svg('text',{x:w-24,y:h-4,'text-anchor':'end'},t('完整回合（含工具／等待）','Full turn (includes tools / waits)')));
 for(const r of valid){const x=l+r.paired_turn_ms/mx*pw,y=24+ph-r.paired_tokens/my*ph,multi=(r.paired_models?.length??0)>1;const mark=multi?svg('path',{d:'M '+x+' '+(y-7)+' l7 7 -7 7 -7 -7z'}):svg('circle',{cx:x,cy:y,r:6});mark.setAttribute('class',r.paired_complete?'plot':'partial');mark.setAttribute('tabindex','0');const title=r.id+' · '+duration(r.paired_turn_ms)+' · '+number(r.paired_tokens)+' tokens · '+r.paired_operations+t(' 筆配對操作',' paired operations')+(multi?t(' · 多模型',' · Multiple models'):'');mark.setAttribute('aria-label',title);mark.append(svg('title',{},title));mark.dataset.key=r.id;mark.dataset.pairedOperations=r.paired_operations;on(mark,'click',()=>openTask(r.id));on(mark,'keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();openTask(r.id);}});s.append(mark);}
 return s;
}
function trend(rows,metric,title,w=520){
 const valid=rows.filter(r=>r[metric]!=null);if(!valid.length)return empty();
 const h=216,l=58,pw=w-l-24,ph=150,max=Math.max(1,...valid.map(r=>r[metric]))*1.08,s=chartRoot(title,w,h),start=Date.parse(rows[0].id),end=Date.parse(rows.at(-1).id),x=i=>l+(end===start?pw/2:(Date.parse(rows[i].id)-start)/(end-start)*pw),y=n=>20+ph-n/max*ph;
 s.append(svg('rect',{x:l,y:20,width:pw,height:ph,class:'plot-frame'}));
 for(let i=0;i<=3;i++){const yy=y(max*i/3);s.append(svg('line',{x1:l,y1:yy,x2:l+pw,y2:yy,class:'gridline'}),svg('text',{x:l-8,y:yy+4,'text-anchor':'end'},metric==='ms'?timeTick(max*i/3,max):compact(max*i/3)));}
 let segment=[];const flush=()=>{if(segment.length)s.append(svg('path',{d:segment.join(' '),class:'plot-line'+(metric==='tokens'?' token-line':'')}));segment=[];};
 rows.forEach((r,i)=>{if(r[metric]==null){flush();return;}if(i&&Date.parse(r.id)-Date.parse(rows[i-1].id)>(period==='week'?7:1)*86400000)flush();segment.push((segment.length?'L':'M')+x(i)+' '+y(r[metric]));const c=svg('circle',{cx:x(i),cy:y(r[metric]),r:4,class:r[metric==='ms'?'time_complete':'tokens_complete']?(metric==='tokens'?'token-plot':'plot'):'partial'});c.append(svg('title',{},r.id+' · '+(metric==='ms'?duration(r.ms):number(r.tokens))));s.append(c);if(i===0||i===rows.length-1||rows.length<=4)s.append(svg('text',{x:x(i),y:h-18,'text-anchor':end===start?'middle':i===0?'start':i===rows.length-1?'end':'middle'},r.id.slice(5)));});flush();return s;
}
function usage(){
 const box=node('div',undefined,'usage-page'),data=analysisResult,filters=node('div',undefined,'analytics-filters');if(!data)return empty(t('讀取用量統計…','Loading usage…'));
 const heading=node('div',undefined,'section-head'),headingLabel=append(node('div',undefined,'row'),node('h2',t('工具執行時間與 Tokens','Tool execution time & tokens')),help(t('統計說明','About these metrics'),t('比較已回報的工具執行時間與 Tokens，不代表所有 AI 或審查工作。上方篩選會同時更新比較圖、任務分布和用量趨勢。\n\n時間是符合篩選的各次操作耗時加總；多個 Agent 同時執行時可能重疊，所以可能大於任務詳情中的不重複時間。Tokens 加總模型回報的輸入與輸出，不換算費用。\n\n星號表示只收到部分紀錄；未知表示尚未回報。沒有資料的任務不會以 0 加進比較。','Compare reported tool execution time and tokens, which do not cover all AI or review activity. Filters apply to the comparison, task distribution and usage trend charts.\n\nTime sums matching operation durations. Parallel agents can overlap, so this sum may exceed the non-overlapping time in task details. Tokens sum reported model input and output, without a price conversion.\n\nAn asterisk marks partial records; unknown means unreported. Missing tasks are not added as zero.'))),toggle=node('div',undefined,'segment-control');
 for(const [value,label] of [['task_id',t('任務','Task')],['model',t('模型','Model')]]){const b=button(label,()=>{group=value;operationCursor=null;operationPrevious=[];loadView();});b.setAttribute('aria-pressed',String(group===value));toggle.append(b);}append(heading,headingLabel,toggle);
 for(const [key,label,options] of [['days',t('期間','Period'),[['all',t('全部','All time')],['7',t('近 7 天（含今天）','Last 7 days')],['30',t('近 30 天（含今天）','Last 30 days')]]],...['tool','model','reasoning','kind','outcome','task_type','task'].map((key,i)=>[key,[t('執行工具','Tool'),t('回報模型','Reported model'),t('回報推理強度','Reported reasoning'),t('樣本分類','Sample type'),t('任務結果','Task outcome'),t('比較分類','Comparison group'),t('任務','Task')][i],[['all',t('全部','All')],...(data.dimensions[key==='kind'?'sample_kind':key==='task'?'task_id':key]??[]).map(v=>[v,name(v)])]])]){
 const labelEl=node('label',label),select=node('select');select.id='usage-'+key;for(const [v,label] of options){const o=node('option',label);o.value=v;select.append(o);}if(!options.some(o=>o[0]===analytics[key]))analytics[key]='all';select.value=analytics[key];on(select,'change',event=>{analytics[key]=event.currentTarget.value;operationCursor=null;operationPrevious=[];loadView();});labelEl.append(select);filters.append(labelEl);}
 const activeFilters=[...filters.querySelectorAll('select')].filter(select=>select.value!=='all');
 const filterDisclosure=disclosure('usage-filters',t('篩選','Filters'),filters),filterSummary=node('span',activeFilters.length?activeFilters.map(select=>select.selectedOptions[0].textContent).join(' · '):t('全部資料','All data'),'filter-summary');
 filterSummary.title=filterSummary.textContent;filterDisclosure.querySelector('summary').append(filterSummary);box.append(filterDisclosure,heading);
 const rows=data.operations.items,groups=data.groups,taskGroups=data.tasks,totals=data.totals;
 const activeCoverage=totals?.metric_coverage?.active_ms;
 const metrics=node('div',undefined,'summary-metrics');for(const [label,value,note] of [[t('已記錄的執行','Recorded operations'),data.operation_count,t('依目前篩選','Current filters')],[t('工具執行時間加總','Sum of tool execution time'),duration(totals?.ms)+(totals&&!totals.time_complete?' *':''),(activeCoverage?activeCoverage.known+' / '+activeCoverage.total+' · ':'')+t('並行執行可能重疊','Parallel calls may overlap')],['Tokens',number(totals?.tokens)+(totals&&!totals.tokens_complete?' *':''),t('已知輸入／輸出小計','Known input / output subtotal')]])metrics.append(append(node('div',undefined,'metric'),node('small',label),node('strong',value),node('small',note)));
 box.append(metrics,helpHeading(panel(t('Tokens 分類','Token breakdown'),splitTable(totals,'usage-token-breakdown'),turnField(totals)),splitHelp()+'\n\n'+turnHelp()));
 if(totals&&(!totals.time_complete||!totals.tokens_complete))box.append(node('p',t('* 部分紀錄','* Partial records'),'chart-note'));
 const coverage=disclosure('usage-coverage',t('紀錄涵蓋範圍','Record coverage'),node('p',t('僅統計已綁定的操作，不涵蓋所有 AI 或審查工作。未回報不視為零。未記錄用量的任務：','Only bound operations are counted, not all AI or review activity. Unreported is not zero. Tasks without usage: ')+(data.coverage.total_tasks-data.coverage.tasks_with_operations),'chart-note'),node('p',data.coverage.measured_time+' / '+data.operation_count+t(' 筆已綁定操作有完整時間；',' bound operations have complete time; ')+data.coverage.measured_tokens+' / '+data.operation_count+t(' 筆有完整 Tokens。比例表示紀錄完整度，0 不代表實測用量為 0。',' have complete tokens. These ratios describe record completeness; zero does not mean measured zero usage.'),'chart-note'));box.append(coverage);
 if(!data.operation_count){box.append(empty(t('此範圍尚未回報執行用量','No execution measurements in this range.')));return box;}
 const comparison=helpHeading(panel(group==='model'?t('模型比較','Model comparison'):t('任務比較','Task comparison')),t('工具時間與 Tokens 各自加總已回報資料，涵蓋範圍可能不同；此圖不代表效率排名。','Tool time and tokens sum their own reported records; coverage may differ. This chart is not an efficiency ranking.'));
 const pair=node('div',undefined,'charts-pair');for(const [metric,title] of [['ms',t('工具執行時間','Tool execution time')],['tokens','Tokens']])pair.append(append(node('div'),node('h3',title,'chart-title'),chartWrap(width=>bars(groups,metric,title,width))));
 comparison.append(pair);if(data.total_groups>groups.length)comparison.append(node('p',t('顯示耗時最高的 ','Showing the longest ')+groups.length+' / '+data.total_groups+t(' 組；請用篩選縮小範圍',' groups; narrow the filters'),'chart-note'));box.append(comparison);
 const eligible=taskGroups.filter(r=>r.paired_operations>0&&r.paired_turn_ms!=null&&r.paired_tokens!=null),pointCoverage=node('p',eligible.length+' / '+taskGroups.length+t(' 件載入任務有配對資料；省略 ',' loaded tasks have paired data; omitted ')+(taskGroups.length-eligible.length)+t(' 件。配對操作：',' tasks. Paired operations: ')+(totals?.paired_operations??0)+' / '+data.operation_count,'chart-note');pointCoverage.id='paired-coverage';
 box.append(helpHeading(panel(t('完整回合分布','Full-turn distribution'),pointCoverage,chartWrap(width=>scatter(taskGroups,[],width))),t('每點是一件任務，兩軸只加總同一批已完成或失敗、且有完整輸入／輸出和明確整回合耗時的操作。不合條件的操作不畫入。點選查看詳情；菱形表示該任務篩選後的紀錄包含多模型。','Each point is a task. Both axes sum the same terminal operations with complete input/output and explicit full-turn duration. Ineligible operations are omitted. Select for details; diamonds indicate multiple models in the task’s filtered records.')+'\n\n'+turnHelp()));
 if(taskGroups.length<data.task_count)box.append(node('p',t('散點顯示 ','Points shown: ')+taskGroups.length+' / '+data.task_count+t(' 件任務；可用篩選縮小範圍',' tasks; narrow the filters for more detail'),'chart-note'));
 const trends=panel(t('用量趨勢','Usage over time')),togglePeriod=node('div',undefined,'segment-control');for(const [v,label] of [['day',t('每日','Daily')],['week',t('每週','Weekly')]]){const b=button(label,()=>{period=v;operationCursor=null;operationPrevious=[];loadView();});b.setAttribute('aria-pressed',String(period===v));togglePeriod.append(b);}trends.prepend(append(node('div',undefined,'section-head'),trends.firstElementChild,togglePeriod));const pair2=node('div',undefined,'charts-pair'),buckets=data.trends;
 for(const [metric,title] of [['ms',t('工具執行時間','Tool execution time')],['tokens','Tokens']])pair2.append(append(node('div'),node('h3',title,'chart-title'),chartWrap(width=>trend(buckets,metric,title,width))));trends.append(pair2);if(data.trends.length<data.trend_count)trends.append(node('p',t('顯示最近 ','Showing latest ')+data.trends.length+' / '+data.trend_count+t(' 個統計區間',' buckets'),'chart-note'));box.append(helpHeading(trends,t('按目前時區的執行開始日統計，每週從週一開始。沒有紀錄的日期不填 0。','Attributed to the operation start date in the selected timezone; weeks start Monday. Unrecorded dates are not filled with zeros.')));
 const operationDetails=node('details',undefined,'disclosure');operationDetails.id='operation-table';operationDetails.append(node('summary',t('查看逐次執行資料','View individual operations')),table([t('任務／操作','Task / operation'),t('工具','Tool'),t('回報模型','Reported model'),t('工具執行時間','Tool execution time'),t('完整回合時間','Full-turn duration'),'Tokens'],rows.map(r=>[button(r.task_id+' / '+r.operation_id,()=>openTask(r.task_id)),name(r.tool),name(r.model),duration(r.ms)+(r.time_complete?'':' *'),duration(r.turn_ms),number(r.tokens)+(r.tokens_complete?'':' *')])));operationDetails.append(pager(data.operations,c=>{operationPrevious.push(operationCursor);operationCursor=c;loadView();},operationPrevious.length?()=>{operationCursor=operationPrevious.pop();loadView();}:null));box.append(operationDetails);return box;
}


function render(){
 chartObserver?.disconnect();
 if(!snapshot&&view!=='about'){$('content').replaceChildren(empty(t('等待最新資料','Waiting for current records')));return;}
 // The full-page detail surface is already mounted; never detach it on a poll.
 if(fullTask&&$('content').querySelector('.task-full-page')){$('content').querySelector('.back-link').textContent='← '+t('返回','Back')+' '+t(...titles[returnState?.view??view]);return;}
 if(view==='board')for(const [index,key,label] of [[0,'all',t('全部','All')],[1,'attention',t('待處理','Needs attention')]]){const control=$('view-controls').children[index];if(control)control.textContent=label+' '+(snapshot.tasks??[]).filter(task=>key==='all'||task.needs_attention).length;}
 const fn=fullTask?fullTaskPage:{dashboard,board,usage,activity,backlog,learning:learningPage,settings,about}[view];
 const body=!fullTask&&viewError?.view===view?append(node('section',undefined,'panel view-error'),node('h2',t('目前無法讀取這個頁面','This view could not load')),node('p',t('資料可能暫時忙碌，請重試。這不代表沒有執行紀錄。','The source may be temporarily busy. Try again; this does not mean there are no execution records.')),button(t('重新讀取','Try again'),()=>loadView())):fn();body.dataset.key=fullTask?'task':view;reconcile($('content'),body);if(view==='usage')resizeCharts();
}
let requestQueue=Promise.resolve();
function api(url,isCurrent=()=>true){
 const request=async()=>{if(!token&&!proxyAuth)throw Error('missing-access');
  for(let attempt=0;attempt<5;attempt++){
   if(!isCurrent())throw Error('superseded');
   const response=await fetch(url,{headers:proxyAuth?{}:{Authorization:'Bearer '+token},credentials:proxyAuth?'omit':'same-origin',cache:'no-store',signal:AbortSignal.timeout(20000)});
   if(response.status===429&&attempt<4){await new Promise(resolve=>setTimeout(resolve,250*2**attempt));continue;}
   if(!response.ok)throw Error('read-failed');return response.json();
  }
 };
 const result=requestQueue.then(request,request);requestQueue=result.catch(()=>{});return result;
}
function signature(value){return JSON.stringify(value,(key,val)=>key==='read_at'?undefined:val);}
function updateConnection(){
 const label={connecting:t('連線中','Connecting'),indexing:t('同步中','Syncing'),healthy:t('已連線','Connected'),partial:t('來源需檢查','Check sources'),'source-error':t('來源無法驗證','Source unavailable'),offline:t('連線中斷','Disconnected'),paused:t('暫停更新','Updates paused')}[connection];
 $('connection').dataset.health=connection;$('connection-text').textContent=label;
 const reachable=['healthy','partial','indexing','source-error'].includes(connection),sourceLabel=connection==='offline'||connection==='paused'?t('尚未重新確認','Not rechecked'):{healthy:t('正常','Healthy'),partial:t('部分資料無法驗證','Some records unavailable'),indexing:t('核對中','Validating'),unavailable:t('來源無法驗證','Source unavailable')}[sourceHealth]??t('尚未確認','Not checked');
 reconcile($('connection-detail'),field(t('連線','Connection'),reachable?t('已連線','Connected'):label),field(t('來源狀態','Source status'),sourceLabel),field(t('最近確認','Last checked'),lastChecked?date(lastChecked):t('尚未確認','Not checked')),field(t('資料變更','Data changed'),lastChanged?date(lastChanged):t('尚未確認','Not checked')),field(t('來源核對','Sources validated'),lastValidated?date(lastValidated):t('尚未確認','Not checked')),node('p',t('綠燈表示觀測服務與來源正常，不代表有 Agent 正在執行。','Green means the observer and sources are healthy; it does not mean an agent is running.'),'chart-note'),button(t('重新連線','Reconnect'),()=>refresh(true)));
}
async function refresh(force=false){
 if(loading)return;clearTimeout(timer);loading=true;
 try{
 const state=await api('/api/changes?'+queryParams({revision:lastSignature}));lastChecked=state.checked_at;lastChanged=state.last_changed_at;sourceHealth=state.source_status;if(Date.parse(state.last_validated_at)>0)lastValidated=state.last_validated_at;
 if(state.source_status==='unavailable')throw Error('source-unavailable');
 if(state.indexing||!state.ready){connection=snapshot?(snapshot.complete?'healthy':'partial'):'indexing';updateConnection();if(!snapshot)$('content').replaceChildren(empty(t('正在核對來源與建立索引，完成後會自動顯示','Validating sources and building the index; this page will update automatically')));return;}
 const changed=force||!snapshot||state.changed;
 if(changed){const next=await api('/api/workspace');snapshot=next;lastSignature=next.health.revision;$('project-name').textContent=next.project.name;
  $('status').className=next.complete?'':'error';$('status').textContent=next.complete?'':t('部分紀錄無法驗證，請查看標示的任務。','Some records could not be verified. Inspect the marked tasks.');}
 if(snapshot)snapshot.health={...snapshot.health,...state};connection=state.source_status==='healthy'?'healthy':'partial';updateConnection();
 const zoneChanged=renderedZone!==timeZone();renderedZone=timeZone();updateZone();
 if(changed||zoneChanged){render();await loadView(true);}
 if(selected&&!learningSelected&&(changed||!selectedTask)){
  const requestedTask=selected,request=++detailRequest,detail=await api('/api/task?id='+encodeURIComponent(requestedTask));
  if(selected===requestedTask&&request===detailRequest&&!learningSelected){selectedTask=detail;if(fullTask||$('drawer').open)renderDetail();}
 }
 if(view==='learning'||learningSelected||openDocument&&library){const requestedQuery=libraryQuery,requestedLearning=learningSelected?.id;lastLibraryQuery=requestedQuery;const fresh=await api('/api/library?q='+encodeURIComponent(requestedQuery));if(requestedQuery===libraryQuery){const differs=signature(fresh)!==signature(library);library=fresh;if(differs&&view==='learning')render();if(learningSelected&&learningSelected.id===requestedLearning){const entry=fresh.learning.find(e=>e.id===learningSelected.id);if(entry){learningSelected=entry;renderLearningDetail(entry);}else if($('drawer').open)$('detail-content').replaceChildren(empty(t('紀錄已移除或無法讀取','Record removed or unavailable')));}}}
 if(openDocument&&documentSignature){const docs=[...(selectedTask?.documents??[]),...(library?.skills??[]),...(library?.learning??[]).map(e=>({...e,id:e.document_id}))],doc=docs.find(x=>x.id===openDocument);if(doc?.digest&&doc.digest!==documentSignature)$('document-status').textContent=t('來源已更新，按「重新讀取」查看。','Source updated. Reload when ready.');}
 }catch(error){const sourceFailure=error.message==='source-unavailable';snapshot=null;lastSignature='';selectedTask=null;library=null;connection=sourceFailure?'source-error':'offline';updateConnection();$('status').className='error';$('status').textContent=sourceFailure?t('服務已連線，但來源資料無法驗證；舊資料已隱藏。請檢查來源檔案與讀取權限。','The service is connected, but source records could not be verified. Stale data is hidden. Check source files and read access.'):t('無法讀取最新資料，舊資料已隱藏。請確認本機服務仍在執行。','Cannot read current records. Stale data is hidden. Check the local service.');if(fullTask)$('drawer').append($('detail-surface'));render();if($('drawer').open)$('detail-content').replaceChildren(empty(sourceFailure?t('來源無法驗證，暫停顯示任務資料','Source unavailable; task data is hidden'):t('連線中斷，暫停顯示任務資料','Disconnected; task data is hidden')));if(openDocument)$('document-status').textContent=sourceFailure?t('來源無法驗證；以下為先前讀取的版本。','Source unavailable; showing the previously read version.'):t('連線中斷；以下為先前讀取的版本。','Disconnected; showing the previously read version.');}
 finally{loading=false;if(!document.hidden)timer=setTimeout(refresh,2000);}
}

$('about-nav').addEventListener('click',()=>showPage('about'));
$('connection').addEventListener('click',()=>{updateConnection();const pop=$('connection-popover');if(pop.matches(':popover-open'))pop.hidePopover();else {pop.showPopover();const r=$('connection').getBoundingClientRect();pop.style.top=(r.bottom+10)+'px';pop.style.left=Math.max(16,Math.min(r.right-330,innerWidth-346))+'px';}});
$('expand-task').addEventListener('click',()=>expandTask());
$('close-drawer').addEventListener('click',()=>$('drawer').close());$('drawer').addEventListener('close',()=>{copyEpoch++;learningSelected=null;if(!fullTask){selected=null;selectedTask=null;}});
for(const dialog of [$('drawer'),$('document')]){
 let downOutside=false;
 const outside=e=>{const r=dialog.getBoundingClientRect();return e.target===dialog&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom);};
 dialog.addEventListener('pointerdown',e=>{downOutside=e.button===0&&outside(e);});
 dialog.addEventListener('pointerup',e=>{if(downOutside&&outside(e))dialog.close();downOutside=false;});
 dialog.addEventListener('pointercancel',()=>{downOutside=false;});
 dialog.addEventListener('close',()=>{downOutside=false;});
}
$('close-document').addEventListener('click',()=>$('document').close());$('document').addEventListener('close',()=>{bodyRequest++;openDocument=null;});
$('reload-document').addEventListener('click',()=>openDocument&&showDocument(openDocument,true));
$('search').addEventListener('input',()=>{if(view==='learning'){clearTimeout(searchTimer);searchTimer=setTimeout(()=>{libraryQuery=$('search').value.slice(0,200);refresh();},200);}else {backlogCursor=null;backlogPrevious=[];activityCursor=null;activityPrevious=[];if(['backlog','activity'].includes(view)){clearTimeout(searchTimer);searchTimer=setTimeout(loadView,150);}else render();}});
$('state-filter').addEventListener('change',()=>{backlogCursor=null;backlogPrevious=[];if(view==='backlog')loadView();else render();});
document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(!document.hidden)refresh();else{connection='paused';updateConnection();}});
window.addEventListener('resize',closeHelp);window.addEventListener('scroll',closeHelp,{passive:true});
if(titles[initialRoute.get('view')])view=initialRoute.get('view');
setLanguage(lang);updateConnection();refresh().then(async()=>{if(initialRoute.get('view')==='task'&&initialRoute.get('task')&&new URLSearchParams(location.search).toString()===initialRoute.toString()){const id=initialRoute.get('task'),request=++detailRequest;selected=id;try{const task=await api('/api/task?id='+encodeURIComponent(id));if(selected!==id||request!==detailRequest)return;selectedTask=task;tab=initialRoute.get('tab')??'overview';returnState=history.state?.returnState??{view:'board'};expandTask(false);}catch{if(selected===id&&request===detailRequest)showPage('backlog');}}});
