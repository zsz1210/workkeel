import http from "node:http";
import fs from "node:fs/promises";
import {randomBytes, timingSafeEqual} from "node:crypto";
import path from "node:path";
import {readTaskProject} from "./workkeel-project.mjs";
import {listTaskItems} from "./workkeel-tasks.mjs";
import {readTaskMeasurements} from "./workkeel-measurements.mjs";

/** Read-only projection; no runtime adapter, model connection or lifecycle writer. */
export async function readMonitorSnapshot(target) {
  const items=await listTaskItems(target);
  if(items.length>200) throw Error("Monitor task limit exceeded; use per-task metrics");
  const tasks=[];
  for(const item of items) {
    if(item.mode!=="task-first") continue;
    const measurements=await readTaskMeasurements(target,item.id);
    tasks.push({id:item.id,title:item.title.slice(0,180),...measurements});
  }
  return {schema_version:"workkeel.monitor/v1",authority:"observation-only",mutation_status:"no-write",
    read_at:new Date().toISOString(),legacy_tasks_excluded:items.length-tasks.length,tasks};
}

function page(nonce) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Workkeel · Task monitor</title>
<style nonce="${nonce}">
:root{font:16px/1.5 system-ui,sans-serif;color:#162b36;background:#f3f6f7;color-scheme:light}*{box-sizing:border-box}body{margin:0}main{max-width:1160px;margin:auto;padding:32px 24px}h1{font-size:30px;margin:8px 0}h2{font-size:22px}h3{font-size:18px}p{margin:8px 0}.eyebrow{color:#426574;font-weight:700;letter-spacing:.07em;font-size:13px}.muted,small{color:#526774}.toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:22px 0}button,select{font:inherit;border:1px solid #8499a3;background:white;color:inherit;border-radius:7px;padding:9px 12px;max-width:100%}button{cursor:pointer}button:focus-visible,select:focus-visible{outline:3px solid #197292;outline-offset:3px}.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.card,.run{background:white;border:1px solid #cbd8de;border-radius:10px;padding:18px}.value{font-size:23px;font-weight:650;overflow-wrap:anywhere}.card small{display:block}.run{margin:16px 0}.run h3{margin:0 0 10px}#status{padding:12px 16px;background:#e6f1f5;border-left:4px solid #287a97;margin:18px 0;overflow-wrap:anywhere}#status.error{background:#fff0ea;border-color:#a53e20}table{border-collapse:collapse;width:100%;font-size:14px}td,th{text-align:left;padding:10px 8px;border-bottom:1px solid #dfe7eb;vertical-align:top;overflow-wrap:anywhere}th{color:#46606d}.table-wrap{overflow:auto}td small{display:block}.note{border-top:1px solid #cbd8de;padding-top:18px;margin-top:26px}.counts{display:flex;gap:20px;flex-wrap:wrap}#detail-title{overflow-wrap:anywhere}@media(max-width:700px){main{padding:20px 14px}.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.value{font-size:19px}h1{font-size:26px}.toolbar{align-items:stretch}select{width:100%}table{min-width:750px}}
</style><main><header><div class="eyebrow">WORKKEEL / OBSERVATION ONLY</div><h1>Task monitor</h1><p class="muted">Models, recorded usage and execution time — without starting work.</p></header>
<div class="toolbar"><label for="tasks">Task</label><select id="tasks" aria-label="Task"><option>Loading…</option></select><button id="refresh">Refresh now</button><span id="updated" class="muted">Not updated yet</span></div>
<div id="status" role="status" aria-live="polite">Loading recorded measurements…</div><section id="detail" hidden><h2 id="detail-title"></h2><p id="state"></p><div class="cards" id="cards"></div><div id="runs"></div></section>
<footer class="note muted"><p>Only recorded Workkeel workflow runs are measured. Native coding sessions and other app tasks are not collected.</p><p>Unknown is not zero. Partial usage is not a final total. No percentage completion or subscription price is inferred. Recorded state is not proof that a process is alive or that a task passed review.</p><p>Refreshes every 2 seconds while visible. Stop the foreground command with Ctrl-C to stop this server.</p></footer></main>
<script type="module" nonce="${nonce}">
import {formatCount,formatDuration,formatCost} from '/view.mjs';
const $=id=>document.getElementById(id), token=location.hash.slice(1);history.replaceState(null,'',location.pathname);
let snapshot=null,loading=false,timer;
const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
function render(){
 const task=snapshot?.tasks.find(t=>t.id===$('tasks').value);$('detail').hidden=!task;if(!task)return;
 $('detail-title').textContent=task.title;$('state').textContent='Task: '+task.task_state+' · Coverage: '+task.coverage;
 $('cards').replaceChildren();
 for(const [label,value,note] of [['Input tokens',formatCount(task.usage.input_tokens),'Recorded operations only'],['Output tokens',formatCount(task.usage.output_tokens),'Includes tool-using turns'],['Adapter work',formatDuration(task.timing.adapter_work_ms),'Sum of calls; may overlap'],['Observed cost',formatCost(task.usage.cost_usd),'Not subscription billing']]){
  const card=node('div');card.className='card';card.append(node('small',label));const val=node('div',value);val.className='value';card.append(val,node('small',note));$('cards').append(card);
 }
 $('runs').replaceChildren();if(!task.runs.length)$('runs').append(node('p','No recorded workflow runs. Model, tokens and time are unknown.'));
 for(const run of task.runs){
  const section=node('section');section.className='run';section.append(node('h3',run.run_id+' · '+run.runner_state));
  const counts=node('p','Recorded attempts: '+run.progress.recorded_attempts+' · Completed: '+run.progress.completed_attempts+' · Unresolved: '+run.progress.unresolved_attempts);section.append(counts,node('p','Run wall time: '+formatDuration(run.wall_elapsed_ms)+' (includes waits and downtime)'));
  const wrap=node('div');wrap.className='table-wrap';wrap.tabIndex=0;wrap.setAttribute('aria-label','Scrollable operation measurements');
  const table=node('table'),head=node('tr');for(const label of ['Operation / state','Selected → runtime','Backend','Input / output tokens','Elapsed'])head.append(node('th',label));const thead=node('thead');thead.append(head);table.append(thead);const body=node('tbody');
  for(const op of run.operations){const row=node('tr');const known=v=>v??'Unknown';
   for(const value of [op.operation_id+' / '+op.state,known(op.requested_model)+' → '+known(op.runtime_model),known(op.observed_model),formatCount({complete:op.result_recorded,total:op.usage.input_tokens,known_subtotal:op.usage.input_tokens})+' / '+formatCount({complete:op.result_recorded,total:op.usage.output_tokens,known_subtotal:op.usage.output_tokens}),formatDuration(op.adapter_elapsed_ms??op.observed_elapsed_ms)+(op.adapter_elapsed_ms===null?' (snapshot)':'')])row.append(node('td',value));body.append(row);
  }table.append(body);wrap.append(table);section.append(wrap);$('runs').append(section);
 }
}
async function refresh(){
 if(loading)return;clearTimeout(timer);loading=true;$('refresh').disabled=true;
 try{if(!token)throw Error('Access link missing. Reopen the URL printed by the monitor command.');
  const response=await fetch('/api/snapshot',{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error(response.status===401?'Access denied. Reopen the original monitor link.':'Measurements unavailable. Inspect the project journal or wait for writes to settle.');
  snapshot=await response.json();const selected=$('tasks').value;$('tasks').replaceChildren();
  for(const task of snapshot.tasks){const option=node('option',task.id+' — '+task.title);option.value=task.id;$('tasks').append(option);}
  if(snapshot.tasks.some(t=>t.id===selected))$('tasks').value=selected;
  $('tasks').disabled=!snapshot.tasks.length;$('status').className='';$('status').textContent=snapshot.tasks.length?'Read-only snapshot. '+snapshot.legacy_tasks_excluded+' legacy tasks excluded.':'No task-first tasks yet. This monitor does not create tasks.';
  $('updated').textContent='Updated '+new Date(snapshot.read_at).toLocaleTimeString();render();
 }catch(error){snapshot=null;$('detail').hidden=true;$('status').className='error';$('status').textContent=error.message+' Previous data is not shown as current.';$('updated').textContent='Not current';}
 finally{loading=false;$('refresh').disabled=false;if(!document.hidden)timer=setTimeout(refresh,2000);}
}
$('tasks').addEventListener('change',render);$('refresh').addEventListener('click',refresh);document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(!document.hidden)refresh();});refresh();
</script></html>`;
}

export async function startTaskMonitor(targetInput,{port=0}={}) {
  if(!Number.isInteger(port)||port<0||port>65535)throw Error("Invalid monitor port");
  const target=await fs.realpath(targetInput);await readTaskProject(target);
  const token=randomBytes(32).toString('hex'),nonce=randomBytes(24).toString('base64');
  const view=await fs.readFile(new URL('./workkeel-monitor-view.mjs',import.meta.url));
  const html=page(nonce);let origin,busy=false;
  const server=http.createServer(async(req,res)=>{
    const headers={'Cache-Control':'no-store','Content-Type':'text/plain; charset=utf-8','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':`default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`};
    const send=(status,body,type)=>{res.writeHead(status,{...headers,...(type?{'Content-Type':type}:{})});res.end(body);};
    if(req.headers.host!==new URL(origin).host||req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')return send(403,'Forbidden origin');
    if(req.method!=='GET')return send(405,'Read-only monitor');
    if(req.url==='/')return send(200,html,'text/html; charset=utf-8');
    if(req.url==='/view.mjs')return send(200,view,'text/javascript; charset=utf-8');
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
