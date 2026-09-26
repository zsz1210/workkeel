// Pure projections shared by browser and offline data checks. No network or models.
import {calendarDate,calendarOffset} from './workkeel-monitor-time.mjs';
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=Number.MAX_SAFE_INTEGER;
const sum=values=>{const n=values.reduce((a,b)=>a+b,0);return finite(n)?n:null;};
const tokenFields=['input','cached_input','uncached_input','output','total'];
const tokenCount=n=>Number.isSafeInteger(n)&&n>=0;
const tokenSplit=usage=>{
  const input=tokenCount(usage?.input_tokens)?usage.input_tokens:null,output=tokenCount(usage?.output_tokens)?usage.output_tokens:null;
  const cached=tokenCount(usage?.cached_input_tokens)&&(input===null||usage.cached_input_tokens<=input)?usage.cached_input_tokens:null;
  return {input,cached_input:cached,uncached_input:input!==null&&cached!==null?input-cached:null,output,total:input!==null&&output!==null?sum([input,output]):null};
};
export function operationRows(tasks) {
  const seen=new Set(),rows=[];
  for(const task of tasks)for(const run of task.runs??[])for(const op of run.operations??[]){
    const key=JSON.stringify([task.id,run.run_id,op.operation_id]);if(seen.has(key))continue;seen.add(key);
    const values=[op.usage?.input_tokens,op.usage?.output_tokens],known=values.filter(finite);
    const token_breakdown=tokenSplit(op.usage),journal_complete=!(task.measurement_errors??[]).length;
    rows.push({...op,key,task_id:task.id,title:task.title,run_id:run.run_id,
      tool:op.tool??task.settings?.runtime?.adapter_id??task.settings?.runtime?.kind??'unreported',
      model:op.observed_model??op.runtime_model??'unreported',
      model_basis:op.observed_model?'provider-report':op.runtime_model?'runtime-report':'unreported',
      reasoning:op.reported_reasoning??'unreported',
      sample_kind:op.sample_kind??task.observation?.value?.sample_kind??'unspecified',outcome:task.task_state,task_type:task.observation?.value?.comparison_group??'unclassified',
      ms:finite(op.adapter_elapsed_ms)?op.adapter_elapsed_ms:finite(op.observed_elapsed_ms)?op.observed_elapsed_ms:null,
      time_complete:finite(op.adapter_elapsed_ms)&&op.coverage_complete!==false,tokens:known.length?sum(known):null,
      tokens_complete:op.result_recorded===true&&op.coverage_complete!==false&&token_breakdown.total!==null,
      token_breakdown,turn_ms:finite(op.reported_turn_duration_ms)?op.reported_turn_duration_ms:null,
      turn_complete:op.result_recorded===true&&journal_complete&&finite(op.reported_turn_duration_ms),
      date:op.dispatched_at??run.created_at??null,journal_complete});
  }
  return rows;
}
export function filterRows(rows,{model='all',tool='all',reasoning='all',kind='all',outcome='all',task_type='all',task='all',days='all',now=Date.now(),timeZone=null}={}) {
  const cutoff=days==='all'?-Infinity:now-Number(days)*86400000;
  const firstDay=days==='all'||!timeZone?null:calendarOffset(calendarDate(now,timeZone),1-Number(days));
  return rows.filter(r=>(model==='all'||r.model===model)&&(tool==='all'||r.tool===tool)&&
    (reasoning==='all'||r.reasoning===reasoning)&&(kind==='all'||r.sample_kind===kind)&&(outcome==='all'||r.outcome===outcome)&&(task_type==='all'||r.task_type===task_type)&&(task==='all'||r.task_id===task)&&
    (days==='all'||Number.isFinite(Date.parse(r.date))&&Date.parse(r.date)<=now&&(firstDay?calendarDate(r.date,timeZone)>=firstDay:Date.parse(r.date)>=cutoff)));
}

// The union of recorded intervals, never creation-to-now or a sum of overlaps.
export function executionSummary(task) {
  const rows=operationRows([task]),intervals=[];let measuredOperations=0;
  for(const op of rows){
    const reported=Array.isArray(op.execution_intervals)?op.execution_intervals:[{started_at:op.dispatched_at,completed_at:op.ended_at??op.completed_at}];
    let measured=false;
    for(const span of reported){const start=Date.parse(span.started_at),end=Date.parse(span.completed_at);
      if(Number.isFinite(start)&&Number.isFinite(end)&&end>=start){intervals.push([start,end]);measured=true;}}
    if(measured)measuredOperations++;
  }
  intervals.sort((a,b)=>a[0]-b[0]);let ms=0,edge=null;
  for(const [start,end] of intervals){ms+=Math.max(0,end-Math.max(start,edge??start));edge=Math.max(edge??end,end);}
  const total=aggregateRows(rows.map(r=>({...r,total:'all'})),'total')[0];
  return {execution_ms:intervals.length?ms:null,intervals,recorded_operations:rows.length,
    measured_intervals:measuredOperations,time_complete:rows.length>0&&measuredOperations===rows.length&&rows.every(r=>r.journal_complete&&r.result_recorded&&r.coverage_complete!==false),
    operation_ms:total?.ms??null,tokens:total?.tokens??null,tokens_complete:total?.tokens_complete??false,
    coverage:!rows.length?'no-execution-records':measuredOperations===rows.length?'recorded-operations-only':'partial-intervals'};
}

/** Attribute recorded execution intervals, never time spent waiting in a state.
 * Missing stage history stays unassigned; it is not an estimated phase duration. */
export function stageExecutionSummary(task) {
  const execution=executionSummary(task),history=task.timeline??[],segments=[];
  let rework=false;
  const valid=history.length>0&&history.every((e,i)=>Number.isFinite(Date.parse(e.at))&&(!i||Date.parse(e.at)>=Date.parse(history[i-1].at)));
  if(valid)for(let i=0;i<history.length;i++){
    const event=history[i];if(event.action==='rework')rework=true;
    const stage=event.state==='build'?(rework?'rework':'implementation'):event.state==='test'?'review':null;
    segments.push({start:Date.parse(event.at),end:i+1<history.length?Date.parse(history[i+1].at):Infinity,stage});
  }
  const union=intervals=>{let total=0,edge=-Infinity;for(const [a,b] of intervals.sort((x,y)=>x[0]-y[0])){total+=Math.max(0,b-Math.max(a,edge));edge=Math.max(edge,b);}return total;};
  const byStage={planning:[],implementation:[],review:[],rework:[],verification:[]},assigned=[],merged=[],zeroPoints=[],legacy=[];
  let explicit=false;
  for(const op of operationRows([task])){
    const stage=op.activity_kind==='repair'?'rework':op.activity_kind;
    const spans=Array.isArray(op.execution_intervals)?op.execution_intervals:[{started_at:op.dispatched_at,completed_at:op.ended_at??op.completed_at}];
    for(const span of spans){const a=Date.parse(span.started_at),b=Date.parse(span.completed_at);if(!Number.isFinite(a)||!Number.isFinite(b)||b<a)continue;
      if(Object.hasOwn(byStage,stage)){byStage[stage].push([a,b]);assigned.push([a,b]);explicit=true;}else legacy.push([a,b]);}
  }
  legacy.sort((a,b)=>a[0]-b[0]);
  for(const interval of legacy){
    if(interval[0]===interval[1]){zeroPoints.push(interval[0]);continue;}
    const previous=merged.at(-1);if(previous&&interval[0]<=previous[1])previous[1]=Math.max(previous[1],interval[1]);else merged.push([...interval]);
  }
  let cursor=0;
  for(const [a,b] of merged){
    while(cursor<segments.length&&segments[cursor].end<=a)cursor++;
    for(let i=cursor;i<segments.length&&segments[i].start<=b;i++){
      const segment=segments[i],start=Math.max(a,segment.start),end=Math.min(b,segment.end);
      if(segment.stage&&end>start){byStage[segment.stage].push([start,end]);assigned.push([start,end]);}
    }
  }
  // An explicit zero at a transition belongs to the new stage, even when a
  // preceding positive interval ends at that same instant.
  cursor=0;
  for(const point of zeroPoints){
    while(cursor<segments.length&&segments[cursor].end<=point)cursor++;
    const segment=segments[cursor];
    if(segment?.stage&&point>=segment.start&&point<segment.end){byStage[segment.stage].push([point,point]);assigned.push([point,point]);}
  }
  const phases=Object.fromEntries(Object.entries(byStage).map(([key,intervals])=>[key,intervals.length?union(intervals):null]));
  const assignedMs=assigned.length?union(assigned):null;
  return {phases,assigned_ms:assignedMs,unassigned_ms:execution.execution_ms===null?null:Math.max(0,execution.execution_ms-(assignedMs??0)),
    coverage:execution.execution_ms===null?'no-execution-records':!valid&&legacy.length?'stage-history-unavailable':explicit?'explicit-activity-and-recorded-intervals':'recorded-intervals-only',
    complete:execution.time_complete&&(!legacy.length||valid)&&assignedMs===execution.execution_ms};
}

/** Explain recorded operations without inferring agents or host scheduling.
 * Explicit interval arrays are authoritative, including an empty array. */
export function executionBreakdown(task) {
  const stageNames=['planning','implementation','review','rework','verification'];
  const spansFor=op=>{
    const reported=Array.isArray(op.execution_intervals)?op.execution_intervals:[{started_at:op.dispatched_at,completed_at:op.ended_at??op.completed_at}];
    const spans=reported.map(span=>[Date.parse(span?.started_at),Date.parse(span?.completed_at)])
      .filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&b>=a).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    const merged=[];
    for(const [a,b] of spans){const previous=merged.at(-1);if(previous&&a<=previous[1])previous[1]=Math.max(previous[1],b);else merged.push([a,b]);}
    return merged;
  };
  const prepared=operationRows([task]).map(row=>({row,spans:spansFor(row)}));
  const orderAt=({row,spans})=>spans[0]?.[0]??(Number.isFinite(Date.parse(row.date))?Date.parse(row.date):Infinity);
  prepared.sort((a,b)=>orderAt(a)-orderAt(b)||(a.row.key<b.row.key?-1:a.row.key>b.row.key?1:0));
  const rows=prepared.map(({row,spans},i)=>({...row,index:i+1,
    execution_ref:row.execution_id??row.operation_id??row.key,
    reasoning:row.reported_reasoning??'unreported',
    stage:row.activity_kind==='repair'?'rework':row.activity_kind??null,
    start_at:spans.length?new Date(spans[0][0]).toISOString():null,
    end_at:spans.length?new Date(spans.at(-1)[1]).toISOString():null,overlapping_with:[]}));
  // Merge spans within each operation first: overlapping spans from one operation
  // never increase concurrency. End events precede starts at the same instant.
  const events=[],overlaps=rows.map(()=>new Set());
  prepared.forEach(({spans},i)=>{for(const [a,b] of spans)if(b>a){events.push({at:a,start:true,i},{at:b,start:false,i});}});
  events.sort((a,b)=>a.at-b.at||Number(a.start)-Number(b.start)||a.i-b.i);
  const active=new Set();let maxConcurrent=prepared.some(({spans})=>spans.length)?1:0;
  for(const event of events){
    if(!event.start){active.delete(event.i);continue;}
    for(const other of active){overlaps[event.i].add(other);overlaps[other].add(event.i);}
    active.add(event.i);maxConcurrent=Math.max(maxConcurrent,active.size);
  }
  rows.forEach((row,i)=>{row.overlapping_with=[...new Set([...overlaps[i]].sort((a,b)=>a-b).map(other=>rows[other].execution_ref))];});
  const measured=prepared.filter(({spans})=>spans.length).length,summary=stageExecutionSummary(task);
  const stages=Object.fromEntries(stageNames.map(stage=>{
    const indices=rows.flatMap((row,i)=>row.stage===stage?[i]:[]),ms=summary.phases[stage];
    return [stage,{ms,operation_count:indices.length,measured_operations:indices.filter(i=>prepared[i].spans.length).length,
      status:ms!==null?'measured':indices.length?'missing-intervals':'unreported'}];
  }));
  const reported=field=>[...new Set(rows.map(row=>row[field]).filter(value=>typeof value==='string'&&value.length&&value!=='unreported'))];
  return {rows,models:reported('model'),tools:reported('tool'),max_concurrent:maxConcurrent,
    measured_operations:measured,total_operations:rows.length,
    mode:maxConcurrent>1?'observed-overlap':measured?'no-observed-overlap':'unreported',stages};
}
export function aggregateRows(rows,group='task_id') {
  const groups=new Map();
  for(const row of rows){const id=row[group]??'unreported';if(!groups.has(id))groups.set(id,[]);groups.get(id).push(row);}
  return [...groups].map(([id,items])=>{
    const times=items.map(i=>i.ms).filter(finite),tokens=items.map(i=>i.tokens).filter(finite);
    const turns=items.map(i=>i.turn_ms).filter(finite),ms=times.length?sum(times):null,tokenTotal=tokens.length?sum(tokens):null,turn_ms=turns.length?sum(turns):null;
    const token_breakdown={},metric_coverage={};
    for(const field of tokenFields){
      const values=items.map(i=>i.token_breakdown?.[field]).filter(finite);
      token_breakdown[field]=values.length?sum(values):null;
      metric_coverage[field]={known:token_breakdown[field]===null?0:values.length,total:items.length};
    }
    metric_coverage.active_ms={known:ms===null?0:times.length,total:items.length};
    metric_coverage.turn_ms={known:turn_ms===null?0:turns.length,total:items.length};
    metric_coverage.token_split={known:tokenFields.slice(0,4).every(k=>token_breakdown[k]!==null)?items.filter(i=>tokenFields.slice(0,4).every(k=>finite(i.token_breakdown?.[k]))).length:0,total:items.length};
    // Pair both axes from the same terminal records, never unrelated subtotals.
    const paired=items.filter(i=>i.result_recorded===true&&i.journal_complete&&i.turn_complete&&finite(i.token_breakdown?.total));
    const paired_turn_ms=paired.length?sum(paired.map(i=>i.turn_ms)):null,paired_tokens=paired.length?sum(paired.map(i=>i.token_breakdown.total)):null;
    return {id,rows:items.length,task_ids:[...new Set(items.map(i=>i.task_id))],
      ms,tokens:tokenTotal,token_breakdown,metric_coverage,turn_ms,
      turn_complete:turn_ms!==null&&items.every(i=>i.turn_complete&&i.journal_complete),
      paired_turn_ms,paired_tokens,paired_operations:paired.length,
      paired_models:[...new Set(paired.map(i=>i.model).filter(model=>typeof model==='string'&&model.length&&model!=='unreported'))],
      paired_complete:paired.length===items.length&&paired_turn_ms!==null&&paired_tokens!==null,
      time_complete:ms!==null&&items.every(i=>i.time_complete&&i.journal_complete),tokens_complete:tokenTotal!==null&&items.every(i=>i.tokens_complete&&i.journal_complete),
      models:[...new Set(items.map(i=>i.model).filter(model=>typeof model==='string'&&model.length&&model!=='unreported'))]};
  });
}
export function trendRows(rows,period='day',timeZone='UTC') {
  const dated=rows.filter(r=>Number.isFinite(Date.parse(r.date))).map(r=>{
    const date=new Date(calendarDate(r.date,timeZone)+'T00:00:00Z');
    if(period==='week')date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));
    return {...r,bucket:date.toISOString().slice(0,10)};
  });
  return aggregateRows(dated,'bucket').sort((a,b)=>a.id.localeCompare(b.id));
}
