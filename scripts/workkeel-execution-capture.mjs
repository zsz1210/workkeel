import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {safeDirectory,existsEntry} from '../src/workkeel-project.mjs';
import {withProjectMutationLock} from '../src/project.mjs';
import {durableAtomicCreate,durableAtomicWrite,formatJson} from '../src/files.mjs';
import {exactKeys,executionDigest} from '../src/workkeel-execution-policy.mjs';
import {assertTaskExecutionContext} from '../src/workkeel-tasks.mjs';
import {readDispatchTicket,bindDispatchTicket} from '../src/workkeel-dispatch.mjs';
import {bindHostUsage,checkHostBindingReadiness,collectHostUsage,reportHostActivity,reportHostUsage,readHostMeasurements} from '../src/workkeel-host-usage.mjs';

const ROOT='.ai-org/execution-capture',SCHEMA='workkeel.execution-capture/v1';
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const SCAN=32*1024*1024,LINE=64*1024,RECORD=256*1024;
const READINESS_OBSERVATION={authority:'observation-only',mutation_status:'no-write',execution_authorized:false};
const HISTORY_LIMIT=1024,OPEN_LIMIT=128;
const fail=code=>{throw new Error(`Capture: ${code}`);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function id(value){if(typeof value!=='string'||!ID.test(value))fail('invalid identity');}
function clock(options={}){const n=options.now?options.now():Date.now();if(!Number.isSafeInteger(n)||n<0||n>Date.now()+60000)fail('invalid or future clock');return n;}
const iso=n=>new Date(n).toISOString();

async function readBounded(file,max=RECORD){
  const h=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const s=await h.stat();if(!s.isFile()||s.size>max)fail('file bound');
    const b=Buffer.alloc(s.size+1),{bytesRead}=await h.read(b,0,b.length,0),after=await h.stat();
    if(bytesRead!==s.size||after.size!==s.size||after.mtimeMs!==s.mtimeMs)fail('file changed');
    return new TextDecoder('utf-8',{fatal:true}).decode(b.subarray(0,bytesRead));
  }finally{await h.close();}
}

/** Exact single-file metadata resolution. No directory inventory or content output. */
export async function resolveCaptureSource(request){
  exactKeys(request,['path','thread_id','turn_id']);id(request.thread_id);id(request.turn_id);
  const file=request.path;
  if(typeof file!=='string'||file.length>4096||!path.isAbsolute(file)||path.normalize(file)!==file)fail('source path');
  let parent=path.parse(file).root;
  for(const part of file.slice(parent.length).split(path.sep).slice(0,-1)){
    parent=path.join(parent,part);const s=await fs.lstat(parent);if(!s.isDirectory()||s.isSymbolicLink())fail('source symlink');
  }
  const h=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const s=await h.stat();if(!s.isFile())fail('source type');
    async function bytes(start,length){const b=Buffer.alloc(length);const r=await h.read(b,0,length,start);if(r.bytesRead!==length)fail('source truncated');return b;}
    const head=await bytes(0,Math.min(LINE,s.size)),end=head.indexOf(10);if(end<0)fail('source header bound');
    const header=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(head.subarray(0,end)));
    if(header.type!=='session_meta'||header.payload?.id!==request.thread_id)fail('source thread mismatch');
    const start=Math.max(0,s.size-SCAN),tail=await bytes(start,s.size-start);
    let pos=start===0?0:tail.indexOf(10)+1;if(start&&pos===0)fail('source scan bound');
    const matches=[];
    while(pos<tail.length){const e=tail.indexOf(10,pos);if(e<0)break;
      const prefix=tail.subarray(pos,Math.min(e,pos+1024)).toString('utf8');
      if(/"type"\s*:\s*"event_msg"/.test(prefix)&&/"type"\s*:\s*"task_started"/.test(tail.subarray(pos,Math.min(e,pos+LINE)).toString('utf8'))){
        if(e-pos>LINE)fail('source metadata bound');
        const row=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(tail.subarray(pos,e)));
        if(row.type==='event_msg'&&row.payload?.type==='task_started'&&row.payload.turn_id===request.turn_id){
          const at=Date.parse(row.timestamp);if(!Number.isFinite(at)||at>Date.now()+60000)fail('source start time');matches.push({offset:start+pos,row_sha256:hash(tail.subarray(pos,e+1))});
        }
      }
      pos=e+1;
    }
    if(matches.length!==1)fail('source start missing or ambiguous in bounded tail');
    const offset=matches[0].offset,anchorStart=Math.max(0,offset-LINE),anchor=await bytes(anchorStart,offset-anchorStart);
    const after=await h.stat(),entry=await fs.lstat(file);
    if(after.size!==s.size||after.mtimeMs!==s.mtimeMs||entry.isSymbolicLink()||entry.ino!==s.ino||entry.dev!==s.dev)fail('source changed during resolution');
    return {source:{kind:'codex-rollout',path:file,thread_id:request.thread_id,turn_id:request.turn_id,start_offset:offset},
      fingerprint:{ino:String(s.ino),dev:String(s.dev),header_sha256:hash(head.subarray(0,end+1)),offset,anchor_sha256:hash(anchor),start_row_sha256:matches[0].row_sha256}};
  }finally{await h.close();}
}

async function directory(target,create=false){
  const dir=await safeDirectory(target,ROOT,{create});
  if(create&&!await existsEntry(target,`${ROOT}/.gitignore`))await durableAtomicCreate(path.join(dir,'.gitignore'),'*\n');
  if(await readBounded(path.join(dir,'.gitignore'),32)!=='*\n')fail('ignore policy');
  let count=0;for await(const e of await fs.opendir(dir)){
    if(e.name==='.gitignore')continue;
    if(++count>HISTORY_LIMIT||!e.isFile()||e.isSymbolicLink()||!e.name.endsWith('.json')||!ID.test(e.name.slice(0,-5)))fail('ledger inventory');
  }
  return dir;
}
async function save(target,value,create=false){
  validate(value);const dir=await directory(target,true),file=path.join(dir,`${value.capture_id}.json`);
  if(create){
    let count=0,open=0;
    for await(const e of await fs.opendir(dir))if(e.name!=='.gitignore'){
      count++;
      const old=await readLedger(path.join(dir,e.name),e.name.slice(0,-5));
      if(old.state!=='finished')open++;
    }
    if(count>=HISTORY_LIMIT)fail('ledger inventory capacity');
    if(open>=OPEN_LIMIT)fail('ledger open capacity');
  }
  const text=formatJson({value,sha256:executionDigest(value)});if(Buffer.byteLength(text)>RECORD)fail('ledger bound');
  if(!create&&await existsEntry(target,`${ROOT}/${value.capture_id}.json`))await load(target,value.capture_id);
  await (create?durableAtomicCreate:durableAtomicWrite)(file,text);
}
function validate(v){
  exactKeys(v,['schema_version','capture_id','request_sha256','identity','source','fingerprint','state','active_since','last_at','finished_at','intervals','operations','final_report']);
  if(v?.schema_version!==SCHEMA||!/^[a-f0-9]{64}$/.test(v.request_sha256))fail('ledger schema');id(v.capture_id);
  exactKeys(v.identity,['binding_id','task_id','actor','claim_id','contract_sha256','activity_kind']);
  for(const key of ['binding_id','task_id','claim_id'])id(v.identity[key]);
  exactKeys(v.identity.actor,['agent_id','principal_id']);id(v.identity.actor.agent_id);id(v.identity.actor.principal_id);
  if(!/^[a-f0-9]{64}$/.test(v.identity.contract_sha256)||!['planning','implementation','review','repair','verification'].includes(v.identity.activity_kind))fail('ledger identity');
  if(!['prepared','active','paused','finished'].includes(v.state)||!Array.isArray(v.intervals)||v.intervals.length>128||!Array.isArray(v.operations)||v.operations.length>256)fail('ledger state');
  if(!Number.isSafeInteger(v.last_at)||v.last_at<0||v.last_at>Date.now()+60000)fail('ledger clock');
  let end=-1;for(const r of v.intervals){exactKeys(r,['started_at','completed_at']);const a=Date.parse(r.started_at),z=Date.parse(r.completed_at);if(!Number.isFinite(a)||!Number.isFinite(z)||a<0||a<end||z<a||z>v.last_at)fail('ledger intervals');end=z;}
  if(v.state==='active'&&(!Number.isSafeInteger(v.active_since)||v.active_since<0||v.active_since<end||v.active_since>v.last_at)||v.state!=='active'&&v.active_since!==null)fail('ledger active clock');
  if(v.state==='finished'&&v.finished_at!==v.last_at||v.state!=='finished'&&v.finished_at!==null)fail('ledger final clock');
  if(new Set(v.operations.map(o=>o.id)).size!==v.operations.length)fail('ledger operation identities');
  for(const o of v.operations){exactKeys(o,['id','action']);id(o.id);if(!['pause','resume'].includes(o.action))fail('ledger operation');}
  if(v.state==='finished'&&!v.intervals.length||v.state==='prepared'&&(v.intervals.length||v.operations.length)||v.state!=='finished'&&v.final_report!==null)fail('ledger lifecycle');
}
async function load(target,captureId){
  id(captureId);const dir=await directory(target);return readLedger(path.join(dir,`${captureId}.json`),captureId);
}
async function readLedger(file,captureId){
  const e=JSON.parse(await readBounded(file));
  exactKeys(e,['value','sha256']);if(executionDigest(e.value)!==e.sha256||e.value.capture_id!==captureId)fail('ledger integrity');validate(e.value);return e.value;
}
const duration=v=>v.intervals.reduce((n,r)=>n+Date.parse(r.completed_at)-Date.parse(r.started_at),0);
function result(v,measurement=null){return {schema_version:SCHEMA,capture_id:v.capture_id,binding_id:v.identity.binding_id,
  state:v.state,active_duration_ms:v.state==='prepared'?null:duration(v),execution_intervals:v.intervals,
  // Collection can finish even when the operation was interrupted or cancelled.
  // Retain its actual outcome in measurement; never wait for a success row.
  final_collection:v.state!=='finished'?'not-requested':measurement?.observations.error_code?'unavailable':
    ['completed','interrupted','cancelled'].includes(measurement?.runner_state)?'completed':'pending',measurement};}
function advance(v,options){const at=clock(options);if(at<v.last_at)fail('backward clock');return at;}
function stop(v,at){if(v.state==='active'){if(v.intervals.length>=128)fail('interval bound');v.intervals.push({started_at:iso(v.active_since),completed_at:iso(at)});}v.active_since=null;v.last_at=at;}
async function identity(target,binding){
  if(binding.kind==='dispatch'){
    exactKeys(binding,['kind','execution_id']);const t=await readDispatchTicket(target,binding.execution_id);
    return {binding_id:t.execution_id,task_id:t.task_id,actor:t.actor,claim_id:t.claim_id,contract_sha256:t.contract_sha256,activity_kind:t.node.activity_kind};
  }
  exactKeys(binding,['kind','binding_id','task_id','actor','claim_id','contract_sha256']);if(binding.kind!=='host')fail('binding kind');
  return Object.fromEntries(Object.entries(binding).filter(([k])=>k!=='kind'));
}
function captureRequest(request){
  exactKeys(request,['capture_id','binding','source'],['source_fingerprint','capture_turn_from_start','approval_ref','sample_kind','activity_kind']);id(request.capture_id);
}
async function captureIdentity(target,request){
  const i=await identity(target,request.binding);if(request.activity_kind!==undefined&&i.activity_kind&&i.activity_kind!==request.activity_kind)fail('activity conflict');
  i.activity_kind??=request.activity_kind??null;
  if(!['planning','implementation','review','repair','verification'].includes(i.activity_kind))fail('activity kind required');
  return i;
}
function hostRequest(request,i,source=request.source){
  const {activity_kind,...bindingIdentity}=i;
  return {...bindingIdentity,source,...(request.binding.kind==='dispatch'?{dispatch_id:i.binding_id}:{}),
    ...Object.fromEntries(['capture_turn_from_start','approval_ref','sample_kind'].filter(k=>request[k]!==undefined).map(k=>[k,request[k]]))};
}

/** Predictable binding admission only. Ready is an observation, never a reservation. */
export async function checkCaptureReadiness(targetInput,request){
  try{
    captureRequest(request);const target=await fs.realpath(targetInput);
    if(await existsEntry(target,ROOT)){
      await directory(target);
      if(await existsEntry(target,`${ROOT}/${request.capture_id}.json`)){
        const v=await load(target,request.capture_id);
        return {...READINESS_OBSERVATION,ready:false,code:v.state==='prepared'?'capture-prepared-recovery-required':'capture-already-exists'};
      }
    }
    const i=await captureIdentity(target,request);
    return await checkHostBindingReadiness(target,hostRequest(request,i));
  }catch{return {...READINESS_OBSERVATION,ready:false,code:'capture-readiness-unavailable'};}
}

/** Bind before starting the explicit clock. Prepared retries fail closed after interruptions. */
export async function beginCapture(targetInput,request,options={}){
  captureRequest(request);
  const target=await fs.realpath(targetInput);
  return withProjectMutationLock(target,async()=>{
    await directory(target,true);
    if(await existsEntry(target,`${ROOT}/${request.capture_id}.json`)){
      const v=await load(target,request.capture_id);if(v.request_sha256!==executionDigest(request))fail('begin replay conflict');
      if(v.state==='prepared')fail('binding persistence interrupted; explicit recovery required');
      const inventory=await readHostMeasurements(target),bound=inventory.byTask.get(v.identity.task_id)?.find(m=>m.run_id===v.identity.binding_id);
      return result(v,bound??null);
    }
    const i=await captureIdentity(target,request);
    const task=await assertTaskExecutionContext(target,i.task_id,i);
    let source=request.source,fingerprint=null;
    if(source.kind==='codex-rollout'){
      exactKeys(source,['kind','path','thread_id','turn_id'],['start_offset']);
      const resolved=await resolveCaptureSource({path:source.path,thread_id:source.thread_id,turn_id:source.turn_id});
      if(source.start_offset!==undefined&&source.start_offset!==resolved.source.start_offset)fail('source offset changed');
      source=resolved.source;fingerprint=resolved.fingerprint;
      if(request.source_fingerprint&&executionDigest(request.source_fingerprint)!==executionDigest(fingerprint))fail('stale source fingerprint');
    }else{exactKeys(source,['kind','thread_id','turn_id']);if(source.kind!=='host-report'||request.source_fingerprint!==undefined)fail('source kind');id(source.thread_id);id(source.turn_id);}
    const at=clock(options);if(at<Date.parse(task.history.at(-1).at))fail('clock before claim');
    const readiness=await checkHostBindingReadiness(target,hostRequest(request,i,source));
    if(!readiness.ready)throw Object.assign(new Error(readiness.code),readiness);
    const v={schema_version:SCHEMA,capture_id:request.capture_id,request_sha256:executionDigest(request),identity:i,source,fingerprint,
      state:'prepared',active_since:null,last_at:at,finished_at:null,intervals:[],operations:[],final_report:null};
    await save(target,v,true);
    const extras=Object.fromEntries(['capture_turn_from_start','approval_ref','sample_kind'].filter(k=>request[k]!==undefined).map(k=>[k,request[k]]));
    let bound;
    if(request.binding.kind==='dispatch')bound=await bindDispatchTicket(target,{execution_id:i.binding_id,source,...extras});
    else {const {activity_kind,...bindingIdentity}=i;bound=await bindHostUsage(target,{...bindingIdentity,source,...extras});}
    if(bound.collection_closed||bound.runner_state!=='running')fail('binding is not active; explicit recovery required');
    // Source metadata is rechecked after the API's scan; append is allowed but identity/anchor drift is not.
    if(fingerprint){const checked=await resolveCaptureSource({path:source.path,thread_id:source.thread_id,turn_id:source.turn_id});if(executionDigest(checked.fingerprint)!==executionDigest(fingerprint))fail('source changed during bind');}
    const started=advance(v,options);v.state='active';v.active_since=started;v.last_at=started;await save(target,v);return result(v,bound);
  });
}

async function transition(targetInput,request,action,options){
  exactKeys(request,['capture_id','operation_id']);id(request.capture_id);id(request.operation_id);const target=await fs.realpath(targetInput);
  return withProjectMutationLock(target,async()=>{
    const v=await load(target,request.capture_id),prior=v.operations.find(o=>o.id===request.operation_id);
    if(prior){if(prior.action!==action)fail('operation replay conflict');return result(v);}
    if(v.operations.length>=256)fail('operation bound');
    if(v.state!==(action==='pause'?'active':'paused'))fail('unsupported clock transition');
    if(action==='resume'){
      await assertTaskExecutionContext(target,v.identity.task_id,v.identity);
      const inventory=await readHostMeasurements(target),bound=inventory.byTask.get(v.identity.task_id)?.find(m=>m.run_id===v.identity.binding_id);
      if(!bound||bound.collection_closed||bound.runner_state!=='running'||inventory.errors.some(e=>e.run_id===v.identity.binding_id||e.run_id===null))fail('binding is not active');
    }
    const at=advance(v,options);
    if(action==='pause'){stop(v,at);v.state='paused';}else{v.state='active';v.active_since=at;v.last_at=at;}
    v.operations.push({id:request.operation_id,action});await save(target,v);return result(v);
  });
}
export const pauseCapture=(target,request,options={})=>transition(target,request,'pause',options);
export const resumeCapture=(target,request,options={})=>transition(target,request,'resume',options);

function finalReport(report){
  exactKeys(report,['status','usage','tool'],['provider','model','reported_reasoning']);
  if(!['completed','interrupted','cancelled'].includes(report.status))fail('final report status');
  const keys=['input_tokens','cached_input_tokens','cache_write_input_tokens','output_tokens','reasoning_output_tokens','total_tokens'];
  exactKeys(report.usage,[],[...keys,'cost_usd']);
  for(const key of keys)if(report.usage[key]!==undefined&&report.usage[key]!==null&&(!Number.isSafeInteger(report.usage[key])||report.usage[key]<0))fail('invalid report tokens');
  if(report.usage.cost_usd!==undefined&&report.usage.cost_usd!==null)fail('unsupported report cost');
  for(const key of ['tool','provider','model','reported_reasoning']){
    const value=report[key];if(value===null||value===undefined){if(key==='tool')fail('report tool required');continue;}
    if(typeof value!=='string'||!value.trim()||value.length>160||/[\u0000-\u001f]/.test(value))fail('invalid report label');
  }
}

/** Freeze once, then retry collection without extending any completed interval. */
export async function finishCapture(targetInput,request,options={}){
  exactKeys(request,['capture_id'],['report']);id(request.capture_id);const target=await fs.realpath(targetInput);
  return withProjectMutationLock(target,async()=>{
    const v=await load(target,request.capture_id);if(v.state==='prepared')fail('binding persistence interrupted; explicit recovery required');
    const reporting=v.source.kind==='host-report';
    if(reporting)finalReport(request.report);
    else if(request.report!==undefined)fail('report/source mismatch');
    if(v.state==='finished'){
      if(executionDigest(v.final_report)!==executionDigest(request.report??null))fail('finish replay conflict');
    }else{
      const at=advance(v,options);stop(v,at);v.state='finished';v.finished_at=at;v.final_report=structuredClone(request.report??null);await save(target,v);
    }
    const {activity_kind,...i}=v.identity;const base={...i,report_id:`capture-${v.capture_id}`.slice(0,96),observed_at:iso(v.finished_at),
      execution_duration_ms:duration(v),execution_intervals:v.intervals,...(activity_kind?{activity_kind}:{})};delete base.task_id;
    let measurement;
    if(reporting)measurement=await reportHostUsage(target,{...base,...v.final_report});
    else{await reportHostActivity(target,base);measurement=await collectHostUsage(target,i.binding_id);}
    return result(v,measurement);
  });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)try{
  const [command,target,input,...extra]=process.argv.slice(2);
  if(extra.length||!target||!input||!['source','check','begin','pause','resume','finish'].includes(command))fail('command');
  const request=JSON.parse(await readBounded(input,64*1024));
  const output=command==='source'?await resolveCaptureSource(request):await ({check:checkCaptureReadiness,begin:beginCapture,pause:pauseCapture,resume:resumeCapture,finish:finishCapture}[command])(target,request);
  process.stdout.write(JSON.stringify(output,null,2)+'\n');
}catch{process.stderr.write('Capture request failed; inspect bounded request, exact source, ledger and current authority.\n');process.exitCode=1;}
