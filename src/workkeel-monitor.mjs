import http from "node:http";
import fs from "node:fs/promises";
import {randomBytes, timingSafeEqual} from "node:crypto";
import path from "node:path";
import {readTaskProject} from "./workkeel-project.mjs";
import {listTaskItems} from "./workkeel-tasks.mjs";
import {readProjectMeasurements,projectTaskMeasurements} from "./workkeel-measurements.mjs";
import {readTaskSummary} from './workkeel-task-summary.mjs';
import {renderMonitorPage} from './workkeel-monitor-page.mjs';
import {readContinuationView} from './workkeel-continuation.mjs';
import {createLibraryCache,readMonitorLibrary,readMonitorDocument,readCatalogueDocument,readLearningDocument,taskResourceView,monitorProjectView} from './workkeel-monitor-data.mjs';
import {measureReads,trackSources} from './workkeel-read-metrics.mjs';
import {readWorkItemProject,readWorkItemSnapshot,readWorkItemDocument} from './workkeel-monitor-work-items.mjs';
import {createObserverIndex} from './workkeel-observer-index.mjs';
import {listNativeLearning} from './workkeel-learning.mjs';

/** A stopped attempt is history after local closeout. Corrupt measurements and
 * activity recorded after closeout still require attention; reading never closes a run. */
export function workflowNeedsAttention(summary,measurements) {
  if(measurements.measurement_errors.length)return true;
  const terminal=['done','cancelled'].includes(summary.task_state)?[...(summary.timeline??[])].reverse().find(e=>['close','cancel'].includes(e.action)&&e.state===summary.task_state):null;
  const closedAt=Date.parse(terminal?.at);
  return measurements.runs.some(run=>{
    if(run.measurement_source==='native-host-report'&&run.collection_closed===true)return false;
    if(!['interrupted','rejected','cancelled','blocked','paused','awaiting-approval'].includes(run.runner_state)&&!(run.progress?.unresolved_attempts>0))return false;
    const times=[run.created_at,run.last_observed_at,...(run.operations??[]).flatMap(op=>[op.dispatched_at,op.last_observed_at,op.ended_at,op.completed_at])].filter(v=>v!==null&&v!==undefined).map(Date.parse);
    return !Number.isFinite(closedAt)||!times.length||times.some(at=>!Number.isFinite(at)||at>closedAt);
  });
}

/** Read-only projection; no runtime adapter, model connection or lifecycle writer. */
export async function readMonitorSnapshot(target,{maxTasks=200,taskCache=null,changedPaths=[],onlyIds=null}={}) {
  const now=new Date();
  const items=await listTaskItems(target,{isolateErrors:true});
  const visible=items.filter(item=>item.mode!=='legacy-read-only'&&(!onlyIds||onlyIds.includes(item.id)));
  if(visible.length>maxTasks) throw Error("Monitor task limit exceeded; use per-task metrics");
  const index=await readProjectMeasurements(target);
  const tasks=[];
  // Bound filesystem fan-out; each summary still performs fresh validation.
  // Preserve input order before the final attention sort, including errors.
  for(let offset=0;offset<visible.length;offset+=8) {
    const batch=await Promise.all(visible.slice(offset,offset+8).map(async item=>{
    try {
      if(item.mode==='unavailable')throw Error('Task unavailable');
      let cached=taskCache?.get(item.id);
      if(cached&&(cached.version!==item.version||changedPaths.some(changed=>changed==='*'||[...cached.dependencies].some(ref=>ref===changed||ref.startsWith(changed+'/')||changed.startsWith(ref+'/')))))cached=null;
      if(!cached){const tracked=await trackSources(async()=>({summary:await readTaskSummary(target,item.id,{now}),resources:await taskResourceView(target,item.id)}));
        tracked.dependencies.add(target+'/.ai-org/observations/'+item.id);
        cached={...tracked,version:item.version};taskCache?.set(item.id,cached);}
      const {summary,resources}=cached.result,measurements=projectTaskMeasurements({id:item.id,state:summary.task_state},index);
      const runAttention=workflowNeedsAttention(summary,measurements);
      const latest=[...measurements.runs].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))[0];
      const continuation=runAttention&&!['done','cancelled'].includes(summary.task_state)&&latest&&latest.measurement_source!=='native-host-report'&&['interrupted','cancelled','blocked'].includes(latest.runner_state)?await readContinuationView(target,latest.run_id):null;
      resources.documents=resources.documents.map(doc=>({...doc,digest:summary.evidence.find(e=>e.path===doc.path)?.current_digest??null}));
      return {...summary,...measurements,...resources,id:item.id,title:item.title.slice(0,180),read_status:'available',needs_attention:summary.needs_attention||runAttention,
        continuation,
        attention_reasons:[...summary.attention_reasons,...(runAttention?['workflow-incomplete']:[])],
        next_action:continuation?continuation.next_action:runAttention?'Inspect the interrupted or incomplete workflow record before continuing. '+summary.next_action:summary.next_action};
    }catch{taskCache?.delete(item.id);return {id:item.id,title:item.id,task_state:'unknown',display_state:'unavailable',read_status:'unavailable',needs_attention:true,next_action:'Inspect this task record; its state could not be verified.'};}
    }));
    tasks.push(...batch);
  }
  tasks.sort((a,b)=>Number(b.needs_attention)-Number(a.needs_attention)||String(b.updated_at??'').localeCompare(String(a.updated_at??''))||a.id.localeCompare(b.id));
  if(taskCache)for(const id of taskCache.keys())if(!visible.some(t=>t.id===id))taskCache.delete(id);
  return {schema_version:"workkeel.monitor/v2",authority:"observation-only",mutation_status:"no-write",
    read_at:now.toISOString(),legacy_tasks_excluded:items.length-visible.length,tasks,
    complete:index.errors.length===0&&tasks.every(t=>t.read_status==='available'&&t.observation.status!=='unavailable'&&t.quality.evidence_current&&t.lifecycle.coverage==='complete-history'),
    measurement_errors:index.errors,inventory_reads:index.index_reads,project:await monitorProjectView(target)};
}


export async function startTaskMonitor(targetInput,{port=0,recordMode='native',service='foreground',accessToken=null,catalogRoots=[]}={}) {
  if(!Number.isInteger(port)||port<0||port>65535)throw Error("Invalid monitor port");
  if(!['native','work-items'].includes(recordMode))throw Error('Invalid observer record mode');
  const target=await fs.realpath(targetInput);await (recordMode==='work-items'?readWorkItemProject:readTaskProject)(target);
  const snapshotReader=recordMode==='work-items'?readWorkItemSnapshot:readMonitorSnapshot;
  if(accessToken!==null&&!/^[a-f0-9]{64}$/.test(accessToken))throw Error('Invalid observer access token');
  const token=accessToken??randomBytes(32).toString('hex'),nonce=randomBytes(24).toString('base64');
  const view=await fs.readFile(new URL('./workkeel-monitor-view.mjs',import.meta.url));
  const client=await fs.readFile(new URL('./workkeel-monitor-client.mjs',import.meta.url));
  const assets=new Map();
  for(const name of ['analytics','style'])assets.set('/'+name+(name==='style'?'.css':'.mjs'),await fs.readFile(new URL('./workkeel-monitor-'+name+(name==='style'?'.css':'.mjs'),import.meta.url)));
  assets.set('/workkeel-monitor-time.mjs',await fs.readFile(new URL('./workkeel-monitor-time.mjs',import.meta.url)));
  assets.set('/dom.mjs',await fs.readFile(new URL('./workkeel-monitor-dom.mjs',import.meta.url)));
  const html=renderMonitorPage(nonce);let origin,busy=false;
  const cache=createLibraryCache(),diagnostics={requests:0,model_calls:0,last:null};
  const index=createObserverIndex(target,options=>snapshotReader(target,{maxTasks:2000,...options}),{catalogRoots,historyReader:()=>readWorkItemSnapshot(target),detailReader:async id=>{
    const task=(await snapshotReader(target,{maxTasks:2000,onlyIds:[id]})).tasks.find(t=>t.id===id);
    if(task&&recordMode==='native')try{const learning=await listNativeLearning(target),uses=learning.uses.filter(use=>use.task_id===id);task.learning_uses=uses.slice(-100);task.learning_use_count=uses.length;}catch{task.learning_unavailable=true;}
    return task;
  }});
  const server=http.createServer(async(req,res)=>{
    const headers={'Cache-Control':'no-store','Content-Type':'text/plain; charset=utf-8','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':`default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`};
    const send=(status,body,type)=>{res.writeHead(status,{...headers,...(type?{'Content-Type':type}:{})});res.end(body);};
    if(req.headers.host!==new URL(origin).host||req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')return send(403,'Forbidden origin');
    if(req.method!=='GET')return send(405,'Read-only monitor');
    if(req.url.split('?')[0]==='/')return send(200,html,'text/html; charset=utf-8');
    if(req.url==='/view.mjs')return send(200,view,'text/javascript; charset=utf-8');
    if(req.url==='/client.mjs')return send(200,client,'text/javascript; charset=utf-8');
    if(assets.has(req.url))return send(200,assets.get(req.url),req.url.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');
    const route=new URL(req.url,origin);
    if(!['/api/snapshot','/api/workspace','/api/tasks','/api/task','/api/analysis','/api/activity','/api/changes','/api/library','/api/document','/api/diagnostics'].includes(route.pathname))return send(404,'Not found');
    const supplied=Buffer.from(req.headers.authorization??''),expected=Buffer.from('Bearer '+token);
    if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return send(401,'Access denied');
    if(busy)return send(429,'Snapshot in progress');busy=true;
    try{
      const hits=cache.hits,misses=cache.misses;
      const {result,metrics}=await measureReads(async()=>{
        if(route.pathname==='/api/diagnostics')return {...diagnostics,index:index.diagnostics(),cache_entries:cache.entries.size};
        if(['/api/workspace','/api/tasks','/api/task','/api/analysis','/api/activity','/api/changes'].includes(route.pathname)){
          const value=await index.query(route.pathname,route.searchParams);if(value.project)value.project.observer.service=service;return value;
        }
        if(route.pathname==='/api/snapshot'){const snapshot=await snapshotReader(target);snapshot.project.observer.service=service;return snapshot;}
        if(route.pathname==='/api/document'){
          const id=route.searchParams.get('id');if(!/^[a-f0-9]{64}$/.test(id??''))throw Error('Invalid document identifier');
          const snapshot=await index.snapshot(),skillRefs=snapshot.tasks.flatMap(t=>(t.skills??[]).map(s=>s.path));
          if(recordMode==='native'&&route.searchParams.get('history')==='1'&&snapshot.legacy_tasks_excluded)return readWorkItemDocument(target,id);
          return await readCatalogueDocument(target,id,{cache,skillRefs,catalogRoots})??await readLearningDocument(target,id,{cache})??await (recordMode==='work-items'?readWorkItemDocument:readMonitorDocument)(target,id,{cache});
        }
        const q=route.searchParams.get('q')??'';if(q.length>200)throw Error('Search limit');
        const snapshot=await index.snapshot();
        return readMonitorLibrary(target,{cache,query:q,catalogRoots,skillRefs:snapshot.tasks.flatMap(t=>(t.skills??[]).map(s=>s.path))});
      });
      const body=JSON.stringify(result);if(Buffer.byteLength(body)>4*1024*1024)throw Error('Snapshot limit');
      if(route.pathname!=='/api/diagnostics'){diagnostics.requests++;diagnostics.last={route:route.pathname,...metrics,response_bytes:Buffer.byteLength(body),cache_hits:cache.hits-hits,cache_misses:cache.misses-misses};}
      send(200,body,'application/json; charset=utf-8');
    }
    catch{send(503,'Measurements unavailable; inspect locally.');}finally{busy=false;}
  });
  server.requestTimeout=10000;server.headersTimeout=5000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${server.address().port}`;
  return {url:`${origin}/#${token}`,close:async()=>{await index.close();await new Promise((resolve,reject)=>{server.close(e=>e?reject(e):resolve());server.closeIdleConnections();});}};
}

export async function monitorMain(args) {
  if(args.length>1)throw Error('Usage: workkeel monitor [task-first project]');
  const monitor=await startTaskMonitor(path.resolve(args[0]??'.'));
  console.log(`Workkeel read-only monitor: ${monitor.url}\nKeep this access link private. Ctrl-C stops the server. No background service installed.`);
  await new Promise(resolve=>{const stop=()=>{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);monitor.close().then(resolve);};process.once('SIGINT',stop);process.once('SIGTERM',stop);});
  return 0;
}
