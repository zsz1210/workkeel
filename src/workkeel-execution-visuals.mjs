/** Read-only execution projections shared by workspace and project observer.
 * A workflow activity is not an Agent or an acceptance state. */
export const executionActivities=['planning','implementation','verification','independent-review','repair'];
const aliases={review:'independent-review',rework:'repair',remediation:'repair',validation:'verification'};
const labels={planning:['Planning','規劃'],implementation:['Implementation','實作'],verification:['Verification','驗證'],'independent-review':['Independent review','獨立審查'],repair:['Repair','修正']};
const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER;
const count=value=>Number.isSafeInteger(value)&&value>=0;
const text=value=>typeof value==='string'&&value.trim()&&value!=='unreported'?value:null;
const instant=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):null;
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sum=values=>{const result=values.reduce((a,b)=>a+b,0);return number(result)?result:null;};
export const activityOf=row=>{const key=row.activity_kind??row.node;return Object.hasOwn(aliases,key)?aliases[key]:key??null;};
export function taskVisualRows(task){
  const seen=new Set(),rows=[];
  for(const run of task.runs??[])for(const operation of run.operations??[]){
    const key=JSON.stringify([run.run_id,operation.operation_id]);if(seen.has(key))continue;seen.add(key);
    const usage=operation.usage??{},input=count(usage.input_tokens)?usage.input_tokens:null,output=count(usage.output_tokens)?usage.output_tokens:null,known=[input,output].filter(value=>value!==null),snapshot=operation.model_snapshot??operation.selection_snapshot;
    rows.push({...operation,key,run_id:run.run_id,actor:operation.actor??run.actor??null,
      state:operation.state??operation.runner_state??(operation.result_recorded?'completed':run.runner_state),
      last_observed_at:operation.last_observed_at??run.last_observed_at,
      reported_running:run.runner_state==='running'&&!run.collection_closed&&operation.state==='unconfirmed',
      running_eligible:run.runner_state==='running'&&!run.collection_closed&&!run.observations?.error_code,
      reported:{model:operation.observed_model??operation.runtime_model??null,reasoning:operation.reported_reasoning??null,service:operation.reported_service??null},
      selected:{model:operation.selected_model??snapshot?.selected?.model??null},
      ms:number(operation.adapter_elapsed_ms)?operation.adapter_elapsed_ms:number(operation.observed_elapsed_ms)?operation.observed_elapsed_ms:null,
      time_complete:operation.coverage_complete!==false&&number(operation.adapter_elapsed_ms),
      tokens:known.length?sum(known):null,tokens_complete:operation.result_recorded===true&&operation.coverage_complete!==false&&input!==null&&output!==null});
  }
  return rows;
}
export const executionLabel=(activity,language='en')=>(Object.hasOwn(labels,activity)?labels[activity]:[activity,activity])[language==='zh-TW'?1:0];
const translate=(language,en,zh)=>language==='zh-TW'?zh:en;
export function recordedDuration(value){if(!number(value))return '—';if(value<1000)return Math.round(value)+' ms';if(value<60000)return (value/1000).toFixed(value<10000?1:0)+' s';return Math.floor(value/60000)+' m '+Math.round(value%60000/1000)+' s';}
function intervals(row){
  const values=Array.isArray(row.execution_intervals)?row.execution_intervals:[{started_at:row.start_at??row.dispatched_at,completed_at:row.end_at??row.ended_at??row.completed_at}];
  return values.flatMap(value=>{const start=instant(value?.started_at),end=instant(value?.completed_at);return start!==null&&end!==null&&end>=start?[[start,end]]:[];});
}
function union(spans){let total=0,edge=null;for(const [start,end] of [...spans].sort((a,b)=>a[0]-b[0])){total+=Math.max(0,end-Math.max(start,edge??start));edge=Math.max(edge??end,end);}return number(total)?total:null;}
function normalize(row,index){
  const spans=intervals(row),ms=spans.length?union(spans):number(row.interval_ms)?row.interval_ms:number(row.reported_ms)?row.reported_ms:number(row.ms)?row.ms:null;
  const actual=text(row.reported?.model)??text(row.observed_model)??text(row.runtime_model)??text(row.model);
  const selected=text(row.selected?.model)??text(row.selected_model);
  const actor=row.actor&&text(row.actor.agent_id)?{agent_id:row.actor.agent_id,principal_id:text(row.actor.principal_id)}:null;
  return {...row,index,activity:activityOf(row),spans,ms,actual_model:actual,selected_model:selected,actor,
    tokens:count(row.tokens)?row.tokens:null,tokens_complete:row.tokens_complete===true,
    time_complete:row.time_complete===true&&ms!==null,
    observation_at:instant(row.last_observed_at),order_at:instant(row.start_at??row.dispatched_at??row.at??row.date),
    state:text(row.state)??text(row.runner_state)??'unknown'};
}
/** Aggregates only the supplied complete operation set. Pagination completeness
 * is a caller-owned fact; never infer missing nodes from lifecycle residence. */
export function buildExecutionVisual(rows,{now=Date.now(),connected=true,read_status='available',complete=true,review_judgment=null,pending_activities=[],blocked_activities=[]}={}){
  if(!Array.isArray(rows)||rows.length>4096)throw Error('Execution visualization requires a bounded operation set');
  for(let i=0;i<rows.length;i++)if(!Object.hasOwn(rows,i)||!rows[i]||typeof rows[i]!=='object'||Array.isArray(rows[i]))throw Error('Execution visualization requires explicit operation records');
  const operations=rows.map(normalize),fresh=row=>connected&&read_status==='available'&&row.running_eligible!==false&&(['running','inProgress'].includes(row.state)||row.reported_running===true)&&row.observation_at!==null&&now>=row.observation_at&&now-row.observation_at<60000;
  const ordered=[...operations].sort((a,b)=>a.order_at===null||b.order_at===null?a.index-b.index:a.order_at-b.order_at||a.index-b.index);
  const active=ordered.filter(fresh).at(-1),recent=ordered.filter(row=>executionActivities.includes(row.activity)).at(-1);
  const nodes=executionActivities.map(activity=>{
    const items=ordered.filter(row=>row.activity===activity),last=items.at(-1),knownTime=items.filter(row=>row.ms!==null),knownTokens=items.filter(row=>row.tokens!==null),spans=items.flatMap(row=>row.spans);
    const measured=knownTime.length?spans.length&&items.every(row=>row.spans.length)?union(spans):sum(knownTime.map(row=>row.ms)):null;
    const live=items.some(fresh);let state=!last?'unreported':live?'reported-running':['failed','error'].includes(last.state)?'failed':['completed','done'].includes(last.state)?'completed':['cancelled','interrupted'].includes(last.state)?'stopped':['running','inProgress'].includes(last.state)||last.reported_running===true?'stale':last.state==='intent'?'queued':'unconfirmed';
    if(activity==='independent-review'&&review_judgment==='fail')state='failed';
    if(activity==='independent-review'&&review_judgment==='pass'&&!live)state='review-passed';
    if(blocked_activities.includes(activity))state='blocked';
    else if(pending_activities.includes(activity)&&!live)state='queued';
    return {activity,items,state,current:live,latest:!active&&recent?.activity===activity,
      ms:measured,time_complete:complete&&items.length>0&&items.every(row=>row.time_complete),
      tokens:knownTokens.length?sum(knownTokens.map(row=>row.tokens)):null,tokens_complete:complete&&items.length>0&&items.every(row=>row.tokens_complete),
      actors:[...new Set(items.map(row=>row.actor?.agent_id).filter(Boolean))],models:[...new Set(items.map(row=>row.actual_model).filter(Boolean))],
      selected_model:last?.selected_model??null,attempts:items.length};
  });
  const measured=operations.filter(row=>row.ms!==null),known=operations.filter(row=>row.tokens!==null),spans=operations.flatMap(row=>row.spans);
  return {nodes,operations,other_operations:operations.filter(row=>!executionActivities.includes(row.activity)),current_activity:active?.activity??null,recent_activity:recent?.activity??null,
    ms:spans.length?union(spans):null,time_complete:complete&&operations.length>0&&operations.every(row=>row.spans.length&&row.time_complete),
    tokens:known.length?sum(known.map(row=>row.tokens)):null,tokens_complete:complete&&operations.length>0&&operations.every(row=>row.tokens_complete),
    measured_operations:measured.length,complete,connected,read_status};
}
const stateLabel=(state,language)=>translate(language,...({unreported:['Not recorded','尚無紀錄'],'reported-running':['Recently reported running','近期回報執行中'],completed:['Execution completed','執行已完成'],'review-passed':['Recorded review passed','已記錄審查通過'],blocked:['Needs reconciliation','需要核對'],failed:['Needs repair','需要修正'],stopped:['Stopped','已停止'],stale:['Awaiting confirmation','待確認'],queued:['Awaiting dispatch','等待派工'],unconfirmed:['Awaiting reconciliation','待核對']}[state]??['Unknown','未知']));
const tokenLabel=(node,language)=>node.tokens===null?translate(language,'Tokens unknown','Tokens 未回報'):(node.tokens_complete?'':'≥ ')+node.tokens.toLocaleString('en-US')+' tokens';
function modelLabel(node,language){return node.models.length?node.models.length===1?node.models[0]:translate(language,node.models.length+' reported models',node.models.length+' 個回報模型'):node.selected_model?translate(language,'Selected: ','指定：')+node.selected_model:translate(language,'Model unreported','模型未回報');}
export function renderExecutionVisual(rows,{language='en',...options}={}){
  const value=buildExecutionVisual(rows,options),recent=value.nodes.find(node=>node.current||node.latest);
  return '<section class="ev execution-visual" aria-label="'+translate(language,'Execution activity flow','執行活動流程')+'"><div class="ev-heading"><h3>'+translate(language,'Execution flow','執行流程')+'</h3><span class="ev-status">'+escape(recent?executionLabel(recent.activity,language)+' · '+stateLabel(recent.state,language):translate(language,'No execution recorded','尚無執行紀錄'))+'</span></div><ol class="ev-track">'+value.nodes.map(node=>'<li class="ev-node" data-state="'+node.state+'" data-recorded="'+(node.attempts>0)+'" '+(node.current?'aria-current="step"':'')+'><button class="ev-node-button" data-flow-node="'+node.activity+'" aria-label="'+escape(executionLabel(node.activity,language)+' · '+stateLabel(node.state,language)+' · '+modelLabel(node,language)+' · '+recordedDuration(node.ms)+' · '+tokenLabel(node,language))+'"><span class="ev-node-title"><span class="ev-dot" aria-hidden="true">'+({completed:'✓',failed:'!',stopped:'−','reported-running':'●'}[node.state]??'○')+'</span>'+escape(executionLabel(node.activity,language))+'</span><span class="ev-model">'+escape(node.attempts?modelLabel(node,language):translate(language,'No activity recorded','尚無活動紀錄'))+'</span><span class="ev-executor">'+escape(node.actors.length===1?node.actors[0]:node.actors.length?translate(language,node.actors.length+' recorded executors',node.actors.length+' 位已記錄執行者'):translate(language,'Executor unreported','執行者未回報'))+'</span><span class="ev-measures">'+escape(node.ms===null?'—':(node.time_complete?'':'≥ ')+recordedDuration(node.ms))+'<span aria-hidden="true"> · </span>'+escape(tokenLabel(node,language))+'</span><span class="ev-node-state">'+escape(stateLabel(node.state,language))+(node.attempts>1?' · '+node.attempts+' '+translate(language,'operations','次執行'):'')+'</span></button></li>').join('')+'</ol><div class="ev-foot"><span>'+translate(language,'↶ Repair returns to verification and review. Activities do not imply separate Agents.','↶ 修正後回到驗證與審查；活動不代表不同 Agent。')+'</span><details><summary>'+translate(language,'Measurement details','量測說明')+'</summary><p>'+translate(language,'Only recorded operations count. Missing data is not zero; selected models are not actual host reports. Recent running reports expire after 60 seconds. Completed execution is not task acceptance.','只計已記錄執行。缺失不等於零；指定模型不等於主機實際回報。執行中回報超過 60 秒後待確認。執行完成不等於任務驗收。')+'</p></details></div></section>';
}
export function renderExecutionTimeline(rows,{language='en',...options}={}){
  const value=buildExecutionVisual(rows,options),operations=value.operations,spans=operations.flatMap(row=>row.spans);
  if(!operations.length)return '<section class="ev ev-timeline"><h3>'+translate(language,'Executor timeline','執行者時間軸')+'</h3><p>'+translate(language,'No execution intervals recorded.','尚無執行區間紀錄。')+'</p></section>';
  const start=spans.length?Math.min(...spans.map(span=>span[0])):null,end=spans.length?Math.max(...spans.map(span=>span[1])):null,range=start!==null?Math.max(1,end-start):1;
  const lanes=new Map();for(const row of operations){const key=row.actor?JSON.stringify(row.actor):'unknown-'+row.index;if(!lanes.has(key))lanes.set(key,{actor:row.actor,items:[]});lanes.get(key).items.push(row);}
  let offset=40;const content=[];
  for(const lane of lanes.values()){
    content.push('<text x="16" y="'+offset+'" class="ev-lane-label">'+escape(lane.actor?.agent_id??translate(language,'Executor unreported','執行者未回報'))+'</text>');offset+=22;
    for(const row of lane.items){
      const y=offset,title=executionLabel(row.activity??'unknown',language)+' · '+(row.actual_model??translate(language,'Model unreported','模型未回報'))+' · '+recordedDuration(row.ms)+' · '+tokenLabel(row,language);
      content.push('<g class="ev-interval" tabindex="0" role="img" aria-label="'+escape(title)+'"><title>'+escape(title)+'</title><line x1="180" x2="970" y1="'+(y+12)+'" y2="'+(y+12)+'" class="ev-grid"/><text x="16" y="'+(y+16)+'" class="ev-activity-label">'+escape(executionLabel(row.activity??'unknown',language))+'</text>');
      if(row.spans.length)for(const [a,b] of row.spans){const x=180+(a-start)/range*790,width=Math.max(3,(b-a)/range*790);content.push('<rect x="'+x.toFixed(2)+'" y="'+y+'" width="'+width.toFixed(2)+'" height="24" rx="5" class="ev-bar" data-activity="'+escape(executionActivities.includes(row.activity)?row.activity:'other')+'"/>');}
      else content.push('<text x="190" y="'+(y+16)+'" class="ev-unknown">'+translate(language,'Interval not recorded','區間未回報')+'</text>');
      content.push('</g>');offset+=36;
    }offset+=18;
  }
  return '<section class="ev ev-timeline"><div class="ev-heading"><h3>'+translate(language,'Executor timeline','執行者時間軸')+'</h3><span>'+translate(language,'Recorded intervals','已記錄區間')+' · '+operations.filter(row=>row.spans.length).length+' / '+operations.length+'</span></div><div class="ev-scroll" tabindex="0" aria-label="'+translate(language,'Scrollable execution timeline','可捲動執行時間軸')+'"><svg viewBox="0 0 1000 '+offset+'" role="img" aria-label="'+translate(language,'Recorded executor intervals, including overlap','已記錄執行者區間，包含並行')+'"><text x="180" y="17" class="ev-axis">'+(start===null?'': '0 s')+'</text><text x="970" y="17" text-anchor="end" class="ev-axis">'+escape(start===null?'—':recordedDuration(end-start))+'</text>'+content.join('')+'</svg></div><details class="ev-definition"><summary>'+translate(language,'Time and identity details','時間與身分說明')+'</summary><p>'+translate(language,'Positions use confirmed start/end intervals. Empty space has no inferred waiting classification. Unreported identities stay separate; the same named Agent may perform several activities. Unknown or running durations are not extrapolated.','位置依已確認的開始／結束區間。空白區間不推定等待類型；未回報身分分開列出，同一 Agent 可執行多種活動。不推算未知或正在執行的工時。')+'</p></details></section>';
}
export function dependencyLayout(components){
  if(!Array.isArray(components)||components.length>128)throw Error('Dependency diagram exceeds its 128-component bound');
  const nodes=components.map((node,index)=>({...node,index,dependencies:Array.isArray(node.depends_on)?node.depends_on:[]})),map=new Map(nodes.map(node=>[node.id,node])),problems=[];
  if(map.size!==nodes.length)problems.push('duplicate-component-id');
  const level=new Map(),visiting=new Set();
  function depth(id){if(level.has(id))return level.get(id);if(visiting.has(id)){problems.push('cyclic-dependency');return 0;}const node=map.get(id);if(!node){problems.push('missing-component');return 0;}visiting.add(id);const result=node.dependencies.length?1+Math.max(...node.dependencies.map(depth)):0;visiting.delete(id);level.set(id,result);return result;}
  for(const node of nodes)depth(node.id);
  const columns=new Map();for(const node of nodes){const column=level.get(node.id)??0;if(!columns.has(column))columns.set(column,[]);columns.get(column).push(node);}
  const positioned=nodes.map(node=>{const column=level.get(node.id)??0;return {...node,x:24+column*280,y:24+columns.get(column).findIndex(item=>item.index===node.index)*108};});
  return {nodes:positioned,edges:positioned.flatMap(node=>node.dependencies.filter(id=>map.has(id)).map(id=>({from:id,to:node.id}))),problems:[...new Set(problems)],width:Math.max(320,...positioned.map(node=>node.x+256)),height:Math.max(130,...positioned.map(node=>node.y+96))};
}
export function renderActivityComparison(groups,{language='en',metric='time'}={}){
  if(!Array.isArray(groups)||groups.length>100)throw Error('Activity comparison requires bounded groups');
  const field=metric==='tokens'?'tokens':'ms',values=groups.map(group=>number(group[field])?group[field]:null),known=values.filter(value=>value!==null),maximum=known.length?Math.max(1,...known):1;
  const rows=groups.map((group,index)=>{const value=values[index],y=42+index*44,complete=metric==='tokens'?group.tokens_complete:group.time_complete,label=executionActivities.includes((Object.hasOwn(aliases,group.id)?aliases[group.id]:group.id))?executionLabel((Object.hasOwn(aliases,group.id)?aliases[group.id]:group.id),language):String(group.id??translate(language,'Unreported','未回報')),measure=value===null?translate(language,'Unreported','未回報'):(complete?'':'≥ ')+(metric==='tokens'?value.toLocaleString('en-US')+' tokens':recordedDuration(value));
    return '<g role="img" tabindex="0" aria-label="'+escape(label+' · '+measure)+'"><title>'+escape(label+' · '+measure)+'</title><text x="16" y="'+(y+16)+'" class="ev-activity-label">'+escape(label.slice(0,24))+'</text><line x1="200" x2="830" y1="'+(y+12)+'" y2="'+(y+12)+'" class="ev-grid"/>'+(value===null?'':'<rect x="200" y="'+y+'" width="'+Math.max(3,value/maximum*630).toFixed(2)+'" height="24" rx="5" class="ev-bar"/>')+'<text x="980" y="'+(y+16)+'" text-anchor="end" class="ev-axis">'+escape(measure)+'</text></g>';});
  return '<section class="ev ev-comparison"><div class="ev-heading"><h3>'+translate(language,metric==='tokens'?'Reported tokens by group':'Reported time by group',metric==='tokens'?'各組已回報 tokens':'各組已回報時間')+'</h3><span>'+translate(language,'Known reports only','僅含已知回報')+'</span></div>'+(groups.length?'<div class="ev-scroll" tabindex="0"><svg viewBox="0 0 1000 '+(groups.length*44+60)+'" role="img" aria-label="'+translate(language,'Comparison of recorded groups','已記錄分組比較')+'">'+rows.join('')+'</svg></div>':'<p>'+translate(language,'No measurements match the current filters.','目前篩選沒有量測資料。')+'</p>')+'<details class="ev-definition"><summary>'+translate(language,'Coverage and interpretation','涵蓋率與解讀')+'</summary><p>'+translate(language,'Partial values are lower bounds; unreported values have no bar. Time sums may include overlapping operations and do not equal goal elapsed time. This is not a model quality ranking.','部分值為已知下限，未回報值不繪製長條。時間加總可能包含並行執行，不等於整個目標經過時間；此圖不是模型品質排名。')+'</p></details></section>';
}
export function renderDependencyDiagram(components,{language='en'}={}){
  const layout=dependencyLayout(components),position=new Map(layout.nodes.map(node=>[node.id,node]));
  return '<section class="ev ev-dependencies"><div class="ev-heading"><h3>'+translate(language,'Required work & dependencies','必要工作與依賴')+'</h3><span>'+components.length+' '+translate(language,'mandatory components','必要元件')+'</span></div>'+(layout.problems.length?'<p class="ev-warning">'+translate(language,'Relationships need reconciliation; this diagram does not establish integration acceptance.','關係需要核對；此圖不代表整合已驗收。')+'</p>':'')+'<div class="ev-scroll" tabindex="0" aria-label="'+translate(language,'Scrollable dependency diagram','可捲動依賴圖')+'"><svg viewBox="0 0 '+layout.width+' '+layout.height+'" role="img" aria-label="'+translate(language,'Complete mandatory component dependencies','完整必要元件依賴')+'">'+layout.edges.map(edge=>{const a=position.get(edge.from),b=position.get(edge.to);return '<path d="M '+(a.x+236)+' '+(a.y+38)+' C '+(a.x+258)+' '+(a.y+38)+', '+(b.x-22)+' '+(b.y+38)+', '+b.x+' '+(b.y+38)+'" class="ev-edge"/><path d="M '+(b.x-6)+' '+(b.y+34)+' L '+b.x+' '+(b.y+38)+' L '+(b.x-6)+' '+(b.y+42)+'" class="ev-arrow"/>';}).join('')+layout.nodes.map(node=>'<g tabindex="0" role="img" aria-label="'+escape(node.id+' · '+(node.repo_id??'')+' · '+(node.accepted===true?translate(language,'Accepted','已驗收'):node.state??translate(language,'Unknown','未知'))+' · '+translate(language,'Requires: ','需要：')+node.dependencies.join(', '))+'"><title>'+escape(node.id+' · '+node.dependencies.join(', '))+'</title><rect x="'+node.x+'" y="'+node.y+'" width="236" height="80" rx="9" class="ev-component" data-accepted="'+String(node.accepted===true)+'"/><text x="'+(node.x+14)+'" y="'+(node.y+25)+'" class="ev-component-title">'+escape(String(node.id).slice(0,27))+'</text><text x="'+(node.x+14)+'" y="'+(node.y+47)+'" class="ev-component-repo">'+escape(String(node.repo_id??translate(language,'Repository unreported','Repo 未回報')).slice(0,29))+'</text><text x="'+(node.x+14)+'" y="'+(node.y+66)+'" class="ev-component-state">'+escape(node.accepted===true?translate(language,'Accepted','已驗收'):node.state??translate(language,'Unknown','未知'))+'</text></g>').join('')+'</svg></div><p class="ev-caption">'+translate(language,'Whole delivery requires the exact accepted component set and integration evidence.','整體交付仍需符合精確已驗收元件組合與整合證據。')+'</p></section>';
}
