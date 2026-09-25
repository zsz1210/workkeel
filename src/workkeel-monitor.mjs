import http from "node:http";
import fs from "node:fs/promises";
import {randomBytes, timingSafeEqual} from "node:crypto";
import path from "node:path";
import {readTaskProject} from "./workkeel-project.mjs";
import {listTaskItems} from "./workkeel-tasks.mjs";
import {readProjectMeasurements,projectTaskMeasurements} from "./workkeel-measurements.mjs";
import {readTaskSummary} from './workkeel-task-summary.mjs';
import {renderMonitorPage} from './workkeel-monitor-page.mjs';

/** Read-only projection; no runtime adapter, model connection or lifecycle writer. */
export async function readMonitorSnapshot(target) {
  const now=new Date();
  const items=await listTaskItems(target,{isolateErrors:true});
  const visible=items.filter(item=>item.mode!=='legacy-read-only');
  if(visible.length>200) throw Error("Monitor task limit exceeded; use per-task metrics");
  const index=await readProjectMeasurements(target);
  const tasks=[];
  // Bound filesystem fan-out; each summary still performs fresh validation.
  // Preserve input order before the final attention sort, including errors.
  for(let offset=0;offset<visible.length;offset+=8) {
    const batch=await Promise.all(visible.slice(offset,offset+8).map(async item=>{
    try {
      if(item.mode==='unavailable')throw Error('Task unavailable');
      const summary=await readTaskSummary(target,item.id,{now}),measurements=projectTaskMeasurements({id:item.id,state:summary.task_state},index);
      const runAttention=measurements.measurement_errors.length>0||measurements.runs.some(r=>['interrupted','rejected','cancelled','blocked','paused','awaiting-approval'].includes(r.runner_state)||r.progress.unresolved_attempts>0);
      return {...summary,...measurements,id:item.id,title:item.title.slice(0,180),read_status:'available',needs_attention:summary.needs_attention||runAttention,
        attention_reasons:[...summary.attention_reasons,...(runAttention?['workflow-incomplete']:[])],
        next_action:runAttention?'Inspect the interrupted or incomplete workflow record before continuing. '+summary.next_action:summary.next_action};
    }catch{return {id:item.id,title:item.id,task_state:'unknown',display_state:'unavailable',read_status:'unavailable',needs_attention:true,next_action:'Inspect this task record; its state could not be verified.'};}
    }));
    tasks.push(...batch);
  }
  tasks.sort((a,b)=>Number(b.needs_attention)-Number(a.needs_attention)||String(b.updated_at??'').localeCompare(String(a.updated_at??''))||a.id.localeCompare(b.id));
  return {schema_version:"workkeel.monitor/v2",authority:"observation-only",mutation_status:"no-write",
    read_at:now.toISOString(),legacy_tasks_excluded:items.length-visible.length,tasks,
    complete:index.errors.length===0&&tasks.every(t=>t.read_status==='available'&&t.observation.status!=='unavailable'&&t.quality.evidence_current&&t.lifecycle.coverage==='complete-history'),
    measurement_errors:index.errors,inventory_reads:index.index_reads};
}


export async function startTaskMonitor(targetInput,{port=0}={}) {
  if(!Number.isInteger(port)||port<0||port>65535)throw Error("Invalid monitor port");
  const target=await fs.realpath(targetInput);await readTaskProject(target);
  const token=randomBytes(32).toString('hex'),nonce=randomBytes(24).toString('base64');
  const view=await fs.readFile(new URL('./workkeel-monitor-view.mjs',import.meta.url));
  const client=await fs.readFile(new URL('./workkeel-monitor-client.mjs',import.meta.url));
  const html=renderMonitorPage(nonce);let origin,busy=false;
  const server=http.createServer(async(req,res)=>{
    const headers={'Cache-Control':'no-store','Content-Type':'text/plain; charset=utf-8','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':`default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`};
    const send=(status,body,type)=>{res.writeHead(status,{...headers,...(type?{'Content-Type':type}:{})});res.end(body);};
    if(req.headers.host!==new URL(origin).host||req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')return send(403,'Forbidden origin');
    if(req.method!=='GET')return send(405,'Read-only monitor');
    if(req.url==='/')return send(200,html,'text/html; charset=utf-8');
    if(req.url==='/view.mjs')return send(200,view,'text/javascript; charset=utf-8');
    if(req.url==='/client.mjs')return send(200,client,'text/javascript; charset=utf-8');
    if(req.url!=='/api/snapshot')return send(404,'Not found');
    const supplied=Buffer.from(req.headers.authorization??''),expected=Buffer.from('Bearer '+token);
    if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return send(401,'Access denied');
    if(busy)return send(429,'Snapshot in progress');busy=true;
    try{const body=JSON.stringify(await readMonitorSnapshot(target));if(Buffer.byteLength(body)>4*1024*1024)throw Error('Snapshot limit');send(200,body,'application/json; charset=utf-8');}
    catch{send(503,'Measurements unavailable; inspect locally.');}finally{busy=false;}
  });
  server.requestTimeout=10000;server.headersTimeout=5000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${server.address().port}`;
  return {url:`${origin}/#${token}`,close:()=>new Promise((resolve,reject)=>{server.close(e=>e?reject(e):resolve());server.closeIdleConnections();})};
}

export async function monitorMain(args) {
  if(args.length>1)throw Error('Usage: workkeel monitor [task-first project]');
  const monitor=await startTaskMonitor(path.resolve(args[0]??'.'));
  console.log(`Workkeel read-only monitor: ${monitor.url}\nKeep this access link private. Ctrl-C stops the server. No background service installed.`);
  await new Promise(resolve=>{const stop=()=>{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);monitor.close().then(resolve);};process.once('SIGINT',stop);process.once('SIGTERM',stop);});
  return 0;
}
