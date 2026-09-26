import {watch} from 'node:fs';
import {createHash} from 'node:crypto';
import {operationRows,filterRows,aggregateRows,trendRows,executionSummary} from './workkeel-monitor-analytics.mjs';
import {validTimeZone} from './workkeel-monitor-time.mjs';
import {measureReads} from './workkeel-read-metrics.mjs';

// Normalize only observer-derived clocks. Recorded operation durations, terminal
// lifecycle totals and measured stage phases remain part of the revision.
export function semanticObserverValue(value){
 if(Array.isArray(value))return value.map(semanticObserverValue);
 if(!value||typeof value!=='object')return value;
 const result={};for(const key of Object.keys(value).sort()){
  if(key==='read_at')continue;
  if(key==='wall_elapsed_ms'&&value.runner_state&&!['completed','cancelled','rejected'].includes(value.runner_state))continue;
  if(key==='lifecycle'&&value.lifecycle){
   const lifecycle={...value.lifecycle};delete lifecycle.as_of;
   if(lifecycle.ongoing){
    const last=value.timeline?.at(-1),tail=Date.parse(value.lifecycle.as_of)-Date.parse(last?.at);
    if(Number.isFinite(tail)&&tail>=0){
     const rework=value.timeline.some(event=>event.action==='rework'),phase={intake:'waiting',build:rework?'rework':'implementation',test:'review',release_gate:'acceptance'}[last.state];
     if(typeof lifecycle.elapsed_ms==='number')lifecycle.elapsed_ms-=tail;
     if(phase&&typeof lifecycle.phases?.[phase]==='number')lifecycle.phases={...lifecycle.phases,[phase]:lifecycle.phases[phase]-tail};
    }else if(value.record_mode==='work-items'&&Object.keys(lifecycle.phases??{}).length===0)delete lifecycle.elapsed_ms;
   }
   result[key]=semanticObserverValue(lifecycle);continue;
  }
  result[key]=semanticObserverValue(value[key]);
 }return result;
}
const hash=value=>createHash('sha256').update(JSON.stringify(semanticObserverValue(value))).digest('hex');
const bounds=(value,fallback,max)=>{const n=value==null?fallback:Number(value);if(!Number.isSafeInteger(n)||n<1||n>max)throw Error('Invalid page size');return n;};
const summaries=tasks=>tasks.map(task=>({id:task.id,title:task.title,task_state:task.task_state,record_mode:task.record_mode??'native',updated_at:task.updated_at,created_at:task.created_at,
  read_status:task.read_status,needs_attention:task.needs_attention,attention_reasons:task.attention_reasons??[],
  execution:(({intervals,...summary})=>summary)(executionSummary(task)),document_count:task.documents?.length??0,
  models:[...new Set(operationRows([task]).map(r=>r.model))],coverage:task.coverage}));
const newest=(a,b)=>String(b.updated_at??'').localeCompare(String(a.updated_at??''))||a.id.localeCompare(b.id);

/** Rebuildable in-memory query index. No authority is granted by this cache.
 * Watch invalidation is reconciled by fresh safe-reader validation every 30s.
 * Detail/document requests revalidate; the UI displays the last validation time. */
export function createObserverIndex(target,reader,{catalogRoots=[],reconcileMs=30000,historyReader=null,detailReader=null}={}) {
  let current=null,compact=[],rows=[],revision='',dirty=true,validated=0,changed=null,pending=null,closed=false,generation=0,lastError=false,lastAttempt=0;
  const taskCache=new Map(),changes=new Set(),watchers=[],stats={builds:0,hits:0,watch_events:0,model_calls:0};
  const invalidate=(file='*')=>{dirty=true;generation++;stats.watch_events++;changes.add(typeof file==='string'?file:'*');if(changes.size>256){changes.clear();changes.add('*');}};
  for(const root of [target,...catalogRoots.map(r=>r.path)])try{
    const watcher=watch(root,{recursive:true},(event,file)=>{
      const name=String(file??'').replaceAll('\\','/');
      if(name.startsWith('.git/')||name==='output'||name.startsWith('output/')||name.startsWith('node_modules/'))return;
      invalidate(name?root+'/'+name:'*');
    });watcher.on('error',invalidate);watchers.push(watcher);
  }catch{/* Timed reconciliation remains available. */}
  async function read(force=false) {
    if(closed)throw Error('Observer index closed');
    if(!force&&!dirty&&current&&Date.now()-validated<reconcileMs){stats.hits++;return current;}
    if(pending)return pending;
    const version=generation,changedPaths=[...changes];changes.clear();lastAttempt=Date.now();
    if(force||Date.now()-validated>=reconcileMs)taskCache.clear();
    pending=(async()=>{
      try{const measured=await measureReads(()=>reader({taskCache,changedPaths})),value=measured.result;stats.last_build=measured.metrics;const next=hash(value);if(next!==revision)changed=new Date().toISOString();
        current=value;revision=next;compact=summaries(value.tasks).sort(newest);rows=operationRows(value.tasks);
        if(rows.length>50000)throw Error('Operation index limit exceeded');
        validated=Date.now();dirty=generation!==version;lastError=false;stats.builds++;return value;
      }catch(error){current=null;compact=[];rows=[];dirty=true;lastError=true;throw error;}
      finally{pending=null;}
    })();return pending;
  }
  function health(){return {revision,last_validated_at:new Date(validated).toISOString(),last_changed_at:changed,
    source_status:lastError?'unavailable':pending?'indexing':current?.complete?'healthy':'partial',watching:watchers.length>0,reconcile_ms:reconcileMs,index_tasks:compact.length};}
  function page(items,params,scope){
    const limit=bounds(params.get('limit'),50,100),cursor=params.get('cursor');let offset=0;
    if(cursor){const decoded=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));
      if(decoded.revision!==revision||decoded.scope!==scope)return {items:[],total:items.length,next_cursor:null,reset_required:true};
      offset=decoded.offset;if(!Number.isSafeInteger(offset)||offset<0||offset>items.length)throw Error('Invalid cursor');
    }
    return {items:items.slice(offset,offset+limit),total:items.length,
      next_cursor:offset+limit<items.length?Buffer.from(JSON.stringify({revision,scope,offset:offset+limit})).toString('base64url'):null};
  }
  return {snapshot:()=>read(),async close(){closed=true;for(const w of watchers)w.close();await pending?.catch(()=>{});},diagnostics:()=>({...stats,entries:compact.length,operations:rows.length}),invalidate,
    async query(route,params=new URLSearchParams()){
      if(route==='/api/changes'){
        if(!pending&&(!current||dirty||Date.now()-validated>=reconcileMs)&&(!lastError||Date.now()-lastAttempt>=2000))void read().catch(()=>{});
        return {...health(),indexing:!!pending,ready:!!current&&!pending&&!lastError,changed:!!current&&!pending&&params.get('revision')!==revision,checked_at:new Date().toISOString()};
      }
      if(route==='/api/task'&&detailReader){const task=await detailReader(params.get('id'));if(task)return {...task,execution:executionSummary(task)};}
      await read();
      if(route==='/api/task'){let task=current.tasks.find(t=>t.id===params.get('id'));if(!task&&historyReader&&current.legacy_tasks_excluded)task=(await historyReader()).tasks.find(t=>t.id===params.get('id'));if(!task)throw Error('Task not found');return {...task,execution:executionSummary(task)};}
      if(route==='/api/workspace'){
        const counts=Object.fromEntries(['intake','build','test','release_gate','done','cancelled','unknown'].map(s=>[s,compact.filter(t=>t.task_state===s).length]));
        return {schema_version:'workkeel.workspace/v1',read_at:current.read_at,complete:current.complete,project:current.project,health:health(),
          legacy_tasks_excluded:current.legacy_tasks_excluded,counts,total_tasks:compact.length,
          tasks:compact,runtime_tools:[...new Set(current.tasks.map(t=>t.settings?.runtime?.adapter_id??t.settings?.runtime?.kind).filter(Boolean))],overview_usage:aggregateRows(rows.map(r=>({...r,total:'all'})),'total')[0]??null,
          recent_events:current.tasks.flatMap(task=>(task.timeline??[]).map(e=>({...e,task_id:task.id,title:task.title}))).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,3),
          usage_coverage:{tasks_with_operations:new Set(rows.map(r=>r.task_id)).size,total_tasks:compact.length,operations:rows.length}};
      }
      if(route==='/api/tasks'){
        const q=(params.get('q')??'').toLocaleLowerCase();if(q.length>200)throw Error('Search limit');
        const state=params.get('state')??'all',mode=params.get('mode')??'all',cutoff=Date.now()-7*86400000;
        const history=params.get('history')==='1';
        const inventory=history&&historyReader&&current.legacy_tasks_excluded?summaries((await historyReader()).tasks).sort(newest):history?[]:compact;
        const matches=inventory.filter(t=>(t.id+' '+t.title).toLocaleLowerCase().includes(q)&&(state==='all'||state==='attention'&&t.needs_attention||state==='unfinished'&&!['done','cancelled','concluded'].includes(t.task_state)||t.task_state===state));
        const items=matches.filter(t=>mode==='all'||mode==='recent'&&Date.parse(t.updated_at)>=cutoff||mode==='unresolved'&&!['done','cancelled'].includes(t.task_state));
        return {...page(items,params,JSON.stringify([q,state,mode,history])),revision,history};
      }
      if(route==='/api/analysis'){
        const filters=Object.fromEntries(['model','tool','reasoning','kind','outcome','task_type','task','days'].map(k=>[k,params.get(k)??'all']));
        const timeZone=params.get('timezone')??'UTC';if(!validTimeZone(timeZone))throw Error('Invalid time zone');
        if(!['all','7','30','90'].includes(filters.days))throw Error('Invalid period');
        const group=params.get('group')==='model'?'model':'task_id',period=params.get('period')==='week'?'week':'day';
        const selected=filterRows(rows,{...filters,timeZone}),groups=aggregateRows(selected,group).sort((a,b)=>(b.ms??-1)-(a.ms??-1)||a.id.localeCompare(b.id));
        const taskGroups=aggregateRows(selected),full=aggregateRows(rows);
        const totals=aggregateRows(selected.map(r=>({...r,total:'all'})),'total')[0]??null;
        return {filters,totals,operation_count:selected.length,task_count:taskGroups.length,total_groups:groups.length,
          metric_scope:{coverage:'filtered-recorded-operations',active_ms:'reported-active-duration',turn_ms:'reported-full-turn-duration',paired:'same-terminal-records-with-tokens-and-turn-duration'},
          groups:groups.slice(0,20),tasks:taskGroups.slice(0,100).map(t=>({...t,models:full.find(f=>f.id===t.id)?.models??[]})),
          trends:trendRows(selected,period,timeZone).slice(-180),trend_count:trendRows(selected,period,timeZone).length,operations:page(selected,params,JSON.stringify([filters,timeZone,group,period])),
          dimensions:Object.fromEntries(['model','tool','reasoning','sample_kind','outcome','task_type','task_id'].map(k=>[k,[...new Set(rows.map(r=>r[k]))].sort()])),
          coverage:{tasks_with_operations:new Set(rows.map(r=>r.task_id)).size,total_tasks:compact.length,measured_time:selected.filter(r=>r.time_complete).length,measured_tokens:selected.filter(r=>r.tokens_complete).length},
          limits:{bars:20,points:100,buckets:180},revision};
      }
      if(route==='/api/activity'){
        const hours=bounds(params.get('hours'),24,168),end=Date.now(),start=end-hours*3600000,q=(params.get('q')??'').toLocaleLowerCase();
        const candidates=current.tasks.filter(t=>(t.id+' '+t.title).toLocaleLowerCase().includes(q)),intervals=candidates.flatMap(task=>executionSummary(task).intervals.map(([a,b])=>({task_id:task.id,title:task.title,start:a,end:b,type:'execution'}))).filter(i=>i.end>=start&&i.start<=end);
        const events=candidates.flatMap(task=>(task.timeline??[]).map(e=>({...e,task_id:task.id,title:task.title}))).filter(e=>Date.parse(e.at)>=start&&Date.parse(e.at)<=end).sort((a,b)=>b.at.localeCompare(a.at));
        return {start,end,intervals:intervals.slice(0,300),interval_count:intervals.length,events:page(events,params,JSON.stringify([hours,q])),observation:'gaps-unknown',revision};
      }
      throw Error('Unknown index route');
    }};
}
