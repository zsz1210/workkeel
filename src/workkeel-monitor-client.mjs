import {label, durationZh, countZh, costZh, phaseLabels, taskActions, handoffText} from '/view.mjs';

const $ = id => document.getElementById(id);
const token = location.hash.slice(1);
history.replaceState(null, '', location.pathname);
let snapshot = null, loading = false, timer, view = 'overview', copyEpoch = 0;
const node = (tag, text) => {const el = document.createElement(tag); if(text !== undefined)el.textContent = text; return el;};
const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-TW') : '未知';
function card(name, value, note) {
  const el = node('div'); el.className = 'card';
  const number = node('div', value); number.className = 'value';
  el.append(node('small', name), number, node('small', note)); return el;
}
function table(headers, rows) {
  const el=node('table'), head=node('tr'), body=node('tbody'), thead=node('thead');
  for(const text of headers){const th=node('th',text);th.scope='col';head.append(th);}
  thead.append(head);el.append(thead);
  for(const values of rows){const tr=node('tr');for(const value of values)tr.append(node('td',value));body.append(tr);}
  el.append(body);return el;
}
function resetCopy() {
  copyEpoch++; $('copy-status').textContent=''; $('copy-fallback').hidden=true; $('handoff-text').value='';
}
function showPage(name) {
  view=name;resetCopy();
  for(const key of ['overview','detail','quality']){$(key==='detail'?'detail-page':key).hidden=key!==name;$('tab-'+key).setAttribute('aria-pressed',String(key===name));}
  render();
}
function overview() {
  const tasks=snapshot.tasks;
  $('overview-counts').replaceChildren(...[
    ['需處理',tasks.filter(t=>t.needs_attention).length,'審查或檢查紀錄'],
    ['實作中',tasks.filter(t=>t.task_state==='build').length,'依任務狀態'],
    ['已驗收',tasks.filter(t=>t.task_state==='done').length,'本機驗收紀錄'],
    ['任務',tasks.length,'目前專案']].map(x=>card(...x)));
  const query=$('search').value.toLowerCase(),filter=$('filter').value;
  const visible=tasks.filter(t=>(t.id+' '+(t.goal??t.title)).toLowerCase().includes(query)&&(filter==='all'||filter==='attention'&&t.needs_attention||t.display_state===filter));
  const active=document.activeElement?.dataset.taskId;$('task-list').replaceChildren();
  for(const task of visible){
    const button=node('button');button.className='task-card'+(task.needs_attention?' attention':'');button.dataset.taskId=task.id;
    const tag=node('span',(task.needs_attention?'需處理 · ':'')+(task.display_state==='review'?'待審查':label(task.display_state)));tag.className='tag';
    button.append(tag,node('strong',task.title),node('small',task.id),node('p',taskActions(task)[0]));
    button.addEventListener('click',()=>{$('tasks').value=task.id;showPage('detail');$('detail-title').focus();});
    $('task-list').append(button);if(active===task.id)button.focus({preventScroll:true});
  }
  if(!visible.length){const empty=node('p',tasks.length?'沒有符合的任務，請調整搜尋或篩選。':'尚無任務。請先在 Codex 對話中準備任務 brief。');empty.className='empty';$('task-list').append(empty);}
}
function lifecycle(task) {
  const timing=task.lifecycle;
  $('lifecycle').append(node('p','總經過時間：'+durationZh(timing?.elapsed_ms)+(timing?.ongoing?'（持續中，計至快照時間）':'（已停止計時）')));
  if(timing?.coverage!=='complete-history'){$('lifecycle').append(node('p','歷程時間無法驗證，統計為未知。'));return;}
  for(const [key,name] of Object.entries(phaseLabels)){
    const row=node('div');row.className='phase-row';const progress=node('progress');progress.max=Math.max(1,timing.elapsed_ms);progress.value=timing.phases[key];progress.setAttribute('aria-label',name+'佔已經過時間');
    row.append(node('span',name),progress,node('span',durationZh(timing.phases[key])));$('lifecycle').append(row);
  }
  $('lifecycle').append(node('p','返工次數：'+task.quality.rework_count+' · 首次審查：'+(task.quality.first_review_pass===null?'尚未審查':task.quality.first_review_pass?'通過':'未通過')));
}
function detail() {
  const task=snapshot.tasks.find(t=>t.id===$('tasks').value);$('detail').hidden=!task;if(!task)return;
  $('detail-title').textContent=task.goal??task.title;
  $('state').textContent='任務：'+label(task.task_state)+' · 用量範圍：'+({'unobserved':'尚無執行觀測','recorded-workflow-runs-only':'僅已記錄的工作流程','incomplete-journal':'紀錄不完整'}[task.coverage]??'未知');
  $('freshness').textContent='最近任務事件：'+date(task.updated_at)+' · 最近外部觀測：'+date(task.observation?.value?.observed_at);
  $('next-action').replaceChildren(...taskActions(task).map(text=>node('p',text)));
  for(const id of ['delivery','evidence','timeline','task-links','cards','runs','lifecycle'])$(id).replaceChildren();
  $('copy-handoff').disabled=task.read_status!=='available';
  if(task.read_status!=='available'){resetCopy();$('delivery').append(node('p','任務紀錄無法驗證；不將舊狀態顯示為目前結果。'));return;}
  $('delivery').append(node('p','候選版本：'+(task.candidate_revision??'尚未交付')),node('p',task.delivery?.summary??'尚無交付紀錄。'),node('p','候選審查：'+(task.review?label(task.review.judgment):'尚未審查')),node('p',task.review?.summary??'需由另一位 Agent 核對候選版本。'),node('p','本機驗收：'+(task.quality.locally_accepted?'已記錄':'尚未完成')));
  if(task.closeout)$('delivery').append(node('p',task.closeout.summary));
  const criteria=node('ul');for(const text of task.acceptance_criteria)criteria.append(node('li',text));$('delivery').append(node('h3','驗收條件'),criteria);
  for(const pin of task.evidence)$('evidence').append(node('p',label(pin.stage)+' · '+label(pin.status)+' · '+pin.path));
  if(!task.evidence.length)$('evidence').append(node('p','尚無驗收證據。'));
  const obs=task.observation;$('evidence').append(node('p','外部／檢查觀測：'+label(obs.status)));
  if(obs.value){
    $('evidence').append(node('small',obs.value.source+' · '+date(obs.value.observed_at)),node('p',obs.value.note));
    for(const check of obs.value.checks)$('evidence').append(node('p',check.name+' · '+label(check.status)+(obs.status==='candidate-matched'?' · 候選版本吻合':' · 非目前候選版本的證據')));
    for(const [kind,name] of [['conversation','返回 Codex 任務'],['pull_request','開啟 Pull Request']]){
      const url=obs.value.links[kind];
      const valid=kind==='conversation'?/^codex:\/\/threads\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(url??''):/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(url??'');
      if(valid){const link=node('a',name);link.href=url;link.rel='noopener noreferrer';$('task-links').append(link);}
    }
  }
  for(const event of task.timeline){const li=node('li',label(event.action)+' · '+label(event.state));li.append(node('small',date(event.at)));$('timeline').append(li);}
  lifecycle(task);
  for(const args of [['輸入 tokens',countZh(task.usage.input_tokens),'僅有紀錄的操作'],['輸出 tokens',countZh(task.usage.output_tokens),'按操作計量'],['Adapter 呼叫時間',durationZh(task.timing.adapter_work_ms),'包含設定、工具與清理'],['觀測成本',costZh(task.usage.cost_usd),'非訂閱帳單']])$('cards').append(card(...args));
  if(task.measurement_errors.length)$('runs').append(node('p','部分執行紀錄無法驗證，總量不完整。請檢查專案 journal。'));
  if(!task.runs.length)$('runs').append(node('p','尚無可讀的執行紀錄。模型、tokens 與執行時間未知。'));
  for(const run of task.runs){
    const section=node('section');section.className='run';
    section.append(node('h3',run.run_id+' · '+label(run.runner_state)),node('p','已記錄嘗試：'+run.progress.recorded_attempts+' · 已完成：'+run.progress.completed_attempts+' · 待釐清：'+run.progress.unresolved_attempts),node('p','執行總經過時間：'+durationZh(run.wall_elapsed_ms)+'（包含等待與停機）'));
    const wrap=node('div');wrap.className='table-wrap';wrap.tabIndex=0;wrap.setAttribute('aria-label','可捲動的操作統計');
    wrap.append(table(['操作／狀態','選擇 → runtime 模型','後端模型','輸入／輸出 tokens','呼叫時間'],run.operations.map(op=>[op.operation_id+' / '+label(op.state),(op.requested_model??'未知')+' → '+(op.runtime_model??'未知'),op.observed_model??'未知',countZh({complete:op.result_recorded,total:op.usage.input_tokens,known_subtotal:op.usage.input_tokens})+' / '+countZh({complete:op.result_recorded,total:op.usage.output_tokens,known_subtotal:op.usage.output_tokens}),durationZh(op.adapter_elapsed_ms??op.observed_elapsed_ms)+(op.adapter_elapsed_ms===null?'（觀測快照）':'')])));
    section.append(wrap);$('runs').append(section);
  }
}
function quality() {
  const rows=snapshot.tasks.map(t=>t.read_status!=='available'?[t.id,...Array(13).fill('未知')]:[
    t.id,label(t.observation.value?.sample_kind??'unspecified'),countZh(t.usage.input_tokens)+' / '+countZh(t.usage.output_tokens),durationZh(t.timing.adapter_work_ms),durationZh(t.lifecycle?.elapsed_ms)+(t.lifecycle?.ongoing?'（持續中）':''),
    ...Object.keys(phaseLabels).map(key=>durationZh(t.lifecycle?.phases?.[key])),String(t.quality.rework_count),t.quality.first_review_pass===null?'尚未審查':t.quality.first_review_pass?'通過':'未通過',t.quality.review_judgment?label(t.quality.review_judgment):'尚未審查',t.quality.locally_accepted?'已驗收':'尚未驗收']);
  $('quality-table').replaceChildren(table(['任務','樣本類型','輸入／輸出 tokens','Adapter 時間','任務總時間',...Object.values(phaseLabels),'返工次數','首次審查','目前審查','本機驗收'],rows));
}
function render(){if(!snapshot)return;overview();detail();quality();}
async function refresh() {
  if(loading)return;clearTimeout(timer);loading=true;$('refresh').disabled=true;
  try{
    if(!token)throw Error('缺少存取連結，請重新開啟 monitor 指令印出的完整網址。');
    const response=await fetch('/api/snapshot',{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw Error(response.status===401?'存取遭拒，請重新開啟原始觀察連結。':'快照無法讀取，請檢查專案紀錄或等待寫入完成。');
    snapshot=await response.json();const selected=$('tasks').value;
    $('tasks').replaceChildren();for(const task of snapshot.tasks){const option=node('option',task.id+' — '+task.title);option.value=task.id;$('tasks').append(option);}
    if(snapshot.tasks.some(t=>t.id===selected))$('tasks').value=selected;else resetCopy();
    $('tasks').disabled=!snapshot.tasks.length;$('status').className=snapshot.complete?'':'error';
    $('status').textContent=snapshot.tasks.length?(snapshot.complete?'唯讀快照。':'部分紀錄無法驗證，請檢查標示的任務。')+' 已排除 '+snapshot.legacy_tasks_excluded+' 個 legacy 任務。':'尚無 task-first 任務；觀察頁不會建立任務。';
    $('updated').textContent='快照讀取時間：'+date(snapshot.read_at);$('content').hidden=false;render();
  }catch(error){snapshot=null;resetCopy();$('content').hidden=true;$('detail').hidden=true;$('status').className='error';$('status').textContent=error.message+' 舊資料已隱藏。';$('updated').textContent='資料非最新';}
  finally{loading=false;$('refresh').disabled=false;if(!document.hidden)timer=setTimeout(refresh,2000);}
}
$('copy-handoff').addEventListener('click',async()=>{
  const task=snapshot?.tasks.find(t=>t.id===$('tasks').value),text=handoffText(task,snapshot?.read_at);if(!text)return;
  const epoch=++copyEpoch;
  try{await navigator.clipboard.writeText(text);if(epoch===copyEpoch){$('copy-status').textContent='已複製此刻的接手摘要，可貼到 Codex。';$('copy-fallback').hidden=true;}}
  catch{if(epoch!==copyEpoch)return;$('handoff-text').value=text;$('copy-fallback').hidden=false;$('copy-status').textContent='瀏覽器未允許剪貼簿，請手動複製以下摘要。';$('handoff-text').focus();$('handoff-text').select();}
});
for(const name of ['overview','detail','quality'])$('tab-'+name).addEventListener('click',()=>showPage(name));
$('tasks').addEventListener('change',()=>{resetCopy();detail();});
$('search').addEventListener('input',()=>snapshot&&overview());$('filter').addEventListener('change',()=>snapshot&&overview());
$('refresh').addEventListener('click',refresh);
document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(!document.hidden)refresh();});refresh();
