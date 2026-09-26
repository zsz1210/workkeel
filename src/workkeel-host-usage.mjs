import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {hostname} from 'node:os';
import {durableAtomicCreate, durableAtomicWrite, formatJson} from './files.mjs';
import {safeDirectory, existsEntry, readTaskProject, assertActor} from './workkeel-project.mjs';
import {assertTaskExecutionContext, readNativeTask} from './workkeel-tasks.mjs';
import {executionDigest} from './workkeel-execution-policy.mjs';
import {observeSource, observeFileRead} from './workkeel-read-metrics.mjs';
import {readTaskFile} from './task-contract.mjs';

const ROOT='.ai-org/host-usage', SCHEMA='workkeel.host-usage/v1';
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const TOKEN_KEYS=['input_tokens','cached_input_tokens','cache_write_input_tokens','output_tokens','reasoning_output_tokens','total_tokens'];
const ACTIVITY_KINDS=['planning','implementation','review','repair','verification'];
function activityKind(value) {if(value!==undefined&&value!==null&&!ACTIVITY_KINDS.includes(value))fail('host-activity-kind');return value??null;}
const LIMITS={bindings:128,record:1024*1024,responses:4096,scan:32*1024*1024,line:64*1024,chunk:64*1024};
const hash=value=>createHash('sha256').update(value).digest('hex');
const now=()=>new Date().toISOString();
const sameActor=(a,b)=>a?.agent_id===b?.agent_id&&a?.principal_id===b?.principal_id;
const number=x=>Number.isSafeInteger(x)&&x>=0;
const fail=code=>{throw Object.assign(new Error(code),{code});};
function object(value,keys) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail('invalid-host-fields');
}
function id(value) {if(typeof value!=='string'||!ID.test(value))fail('invalid-host-identity');return value;}
function text(value,max=160) {if(value===null||value===undefined)return null;if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f]/.test(value))fail('invalid-host-label');return value;}
function date(value) {if(typeof value!=='string'||value.length>40||!Number.isFinite(Date.parse(value)))fail('invalid-host-time');return new Date(value).toISOString();}
function tokens(value) {
  object(value,[...TOKEN_KEYS,'cost_usd']);
  if(value.cost_usd!==undefined&&value.cost_usd!==null)fail('host-cost-unsupported');
  return Object.fromEntries(TOKEN_KEYS.map(k=>{const v=value[k]??null;if(v!==null&&!number(v))fail('invalid-host-tokens');return [k,v];}));
}
function add(a,b) {return Object.fromEntries(TOKEN_KEYS.map(k=>{if(a[k]===null&&b[k]===null)return [k,null];const n=(a[k]??0)+(b[k]??0);if(!number(n))fail('host-token-overflow');return [k,n];}));}
const unknown=()=>Object.fromEntries(TOKEN_KEYS.map(k=>[k,null]));
const zeros=()=>Object.fromEntries(TOKEN_KEYS.map(k=>[k,0]));

async function readFile(file,max=LIMITS.record) {
  const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const before=await handle.stat();if(!before.isFile()||before.size>max)fail('host-record-bound');
    const bytes=Buffer.alloc(before.size+1);const {bytesRead}=await handle.read(bytes,0,bytes.length,0);
    const after=await handle.stat();
    if(bytesRead!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs)fail('host-record-changed');
    observeFileRead(bytesRead);
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,bytesRead));
  } finally {await handle.close();}
}
async function record(target,ref) {
  const dir=await safeDirectory(target,path.posix.dirname(ref));
  observeSource(target,ref);
  const envelope=JSON.parse(await readFile(path.join(dir,path.posix.basename(ref))));
  object(envelope,['value','sha256']);
  if(executionDigest(envelope.value)!==envelope.sha256)fail('host-record-integrity');
  return envelope.value;
}
async function storeRoot(target,create=false) {
  const dir=await safeDirectory(target,ROOT,{create});
  const ignore=path.join(dir,'.gitignore');
  if(create&&!await existsEntry(target,`${ROOT}/.gitignore`))await durableAtomicCreate(ignore,'*\n');
  if(await readFile(ignore,32)!=='*\n')fail('host-ignore-policy');
  return dir;
}
async function names(target) {
  const dir=await storeRoot(target);observeSource(target,ROOT);
  const out=[];
  const entries=await fs.opendir(dir);
  for await(const entry of entries) {
    if(['.gitignore','.locks'].includes(entry.name))continue;
    if(out.length>=LIMITS.bindings)fail('host-inventory-bound');
    if(!ID.test(entry.name)||!entry.isDirectory()||entry.isSymbolicLink())fail('host-inventory-invalid');
    out.push(entry.name);
  }
  return out.sort();
}
async function lock(target,fn) {
  await storeRoot(target,true);
  const dir=await safeDirectory(target,`${ROOT}/.locks`,{create:true});
  const owner={pid:process.pid,host:hostname(),token:randomUUID(),choosing:true,ticket:0},lockPath=path.join(dir,`claim-${owner.token}.json`);
  // Bakery tickets avoid unlinking/replacing a shared lock pathname. A dead
  // owner's unique claim can be removed without racing a successor's identity.
  async function owners() {
    const out=[],entries=await fs.opendir(dir);let count=0;
    for await(const entry of entries) {
      if(++count>128)fail('host-lock-inventory-bound');
      if(/^\.temple-durable-[A-Za-z0-9-]+$/.test(entry.name))continue;
      if(!/^claim-[a-f0-9-]{36}\.json$/.test(entry.name)||!entry.isFile()||entry.isSymbolicLink())fail('host-writer-busy');
      let bytes;try{bytes=await readFile(path.join(dir,entry.name),1024);}catch(e){if(e.code==='ENOENT')continue;throw e;}
      const candidate=JSON.parse(bytes);object(candidate,['pid','host','token','choosing','ticket']);
      if(!number(candidate.pid)||candidate.pid<1||candidate.host!==hostname()||entry.name!==`claim-${candidate.token}.json`||
        typeof candidate.choosing!=='boolean'||!number(candidate.ticket)||!candidate.choosing&&candidate.ticket<1)fail('host-writer-busy');
      let dead=false;try{process.kill(candidate.pid,0);}catch(e){if(e.code==='ESRCH')dead=true;else fail('host-writer-busy');}
      if(dead){await fs.unlink(path.join(dir,entry.name)).catch(e=>{if(e.code!=='ENOENT')throw e;});continue;}
      out.push(candidate);
    }
    return out;
  }
  await durableAtomicCreate(lockPath,formatJson(owner));
  try {
    owner.ticket=Math.max(0,...(await owners()).map(o=>o.ticket))+1;
    if(!number(owner.ticket))fail('host-writer-busy');owner.choosing=false;
    await durableAtomicWrite(lockPath,formatJson(owner));
    let acquired=false;
    for(let attempt=0;attempt<40;attempt++) {
      const blocked=(await owners()).some(o=>o.token!==owner.token&&(o.choosing||o.ticket<owner.ticket||o.ticket===owner.ticket&&o.token<owner.token));
      if(!blocked){acquired=true;break;}
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    if(!acquired)fail('host-writer-busy');return await fn();
  }finally {await fs.unlink(lockPath).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
function assertBinding(b,bindingId) {
  if(b?.schema_version!==SCHEMA||b.binding_id!==bindingId||!ID.test(b.task_id??'')||
    !['active','paused','completed','interrupted','stopped','cancelled','error'].includes(b.status)||
    !['codex-rollout','host-report'].includes(b.source?.kind)||!ID.test(b.source.thread_id??'')||!ID.test(b.source.turn_id??'')||
    !Array.isArray(b.responses)||b.responses.length>LIMITS.responses||!Array.isArray(b.reports)||b.reports.length>LIMITS.responses)fail('host-binding-invalid');
  const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
  if(!sha(b.contract_sha256)||!sha(b.task_hash)||!number(b.task_version)||b.task_version<1||typeof b.capture_turn_from_start!=='boolean'||
    !['real-task','fixture','paired-experiment','unspecified'].includes(b.sample_kind)||!number(b.assigned_responses)||!number(b.unassigned_responses)||
    b.assigned_responses>LIMITS.responses||b.unassigned_responses>LIMITS.responses)fail('host-binding-invalid');
  object(b.actor,['agent_id','principal_id']);id(b.actor.agent_id);id(b.actor.principal_id);id(b.claim_id);
  object(b.source,['kind','path','thread_id','turn_id','start_offset']);
  if(b.source.start_offset!==undefined&&(!number(b.source.start_offset)||b.source.kind!=='codex-rollout'))fail('host-source-offset');
  activityKind(b.activity_kind);
  if(b.activity_reports!==undefined){if(!Array.isArray(b.activity_reports)||b.activity_reports.length>LIMITS.responses)fail('host-binding-invalid');const seen=new Set();for(const r of b.activity_reports){object(r,['id','digest']);id(r.id);if(!sha(r.digest)||seen.has(r.id))fail('host-binding-invalid');seen.add(r.id);}}
  if(b.source.kind==='codex-rollout'&&(typeof b.source.path!=='string'||b.source.path.length>4096||!path.isAbsolute(b.source.path)))fail('host-binding-invalid');
  if(b.source.kind==='host-report'&&b.source.path!==undefined)fail('host-binding-invalid');
  for(const field of ['created_at','claim_at'])date(b[field]);
  for(const field of ['observed_at','collected_at','last_source_at','turn_started_at','turn_ended_at','stop_at','activity_observed_at'])if(b[field]!==null&&b[field]!==undefined)date(b[field]);
  for(const field of ['tool','provider','model','reasoning'])text(b[field]);
  for(const field of ['model_mixed','reasoning_mixed','collection_closed'])if(b[field]!==undefined&&typeof b[field]!=='boolean')fail('host-binding-invalid');
  if(b.source_status!==undefined&&!['unobserved','partial-source','observed','reporter-observed','unavailable'].includes(b.source_status))fail('host-binding-invalid');
  if(b.turn_terminal!==null&&!['completed','interrupted'].includes(b.turn_terminal))fail('host-binding-invalid');
  if(b.error_code!==null&&b.error_code!==undefined&&(typeof b.error_code!=='string'||!/^host-[a-z-]{1,90}$/.test(b.error_code)))fail('host-binding-invalid');
  tokens(b.usage);if(b.last_cumulative!==null)tokens(b.last_cumulative);
  if(b.last_ordinal!==null&&!number(b.last_ordinal)||b.turn_duration_ms!==null&&!number(b.turn_duration_ms))fail('host-binding-invalid');
  if(b.execution_duration_ms===null) {if(!Array.isArray(b.execution_intervals)||b.execution_intervals.length)fail('host-binding-invalid');}
  else {if(!number(b.execution_duration_ms))fail('host-binding-invalid');intervals(b.execution_intervals,b.execution_duration_ms);}
  const seen=new Set();
  for(const entry of b.responses) {object(entry,['key','digest']);if(!sha(entry.key)||!sha(entry.digest)||seen.has(entry.key))fail('host-binding-invalid');seen.add(entry.key);}
  seen.clear();for(const entry of b.reports) {object(entry,['id','digest']);id(entry.id);if(!sha(entry.digest)||seen.has(entry.id))fail('host-binding-invalid');seen.add(entry.id);}
  if(b.source.kind==='codex-rollout'&&b.assigned_responses+b.unassigned_responses!==b.responses.length||b.source.kind==='host-report'&&b.assigned_responses!==b.reports.length)fail('host-binding-invalid');
  if(b.checkpoint!==null) {
    object(b.checkpoint,['ino','dev','offset','anchor']);
    if(!/^[0-9]{1,32}$/.test(b.checkpoint.ino)||!/^[0-9]{1,32}$/.test(b.checkpoint.dev)||!number(b.checkpoint.offset)||!sha(b.checkpoint.anchor))fail('host-binding-invalid');
  }
}
async function load(target,bindingId) {
  id(bindingId);const b=await record(target,`${ROOT}/${bindingId}/binding.json`);assertBinding(b,bindingId);return b;
}
function measurement(b) {
  const final=b.status==='completed';
  const observed=b.assigned_responses>0||b.reports.length>0||Boolean(b.turn_terminal)||b.execution_duration_ms!==null;
  const intervals=b.execution_intervals??[];
  const op={operation_id:b.binding_id,node:'native-host',visit:0,attempt:0,model_id:null,selection_reason:'host-owned',
    requested_model:null,runtime_model:b.model??null,observed_model:null,tool:b.tool??null,provider:b.provider??null,
    requested_reasoning:b.reasoning?{name:'effort',value:b.reasoning}:null,reported_reasoning:b.reasoning??null,
    sample_kind:b.sample_kind,connection_kind:'native',state:b.status==='active'?'unconfirmed':b.status,
    result_recorded:final,coverage_complete:false,usage_source:'native-host-report',usage:{...b.usage,cost_usd:null},
    dispatched_at:intervals.length===1?intervals[0].started_at:null,completed_at:intervals.length===1?intervals[0].completed_at:null,
    ended_at:intervals.length===1?intervals[0].completed_at:null,last_observed_at:b.observed_at??null,
    adapter_elapsed_ms:b.execution_duration_ms??null,observed_elapsed_ms:null,execution_intervals:intervals,
    timing_source:b.execution_duration_ms!==null?'reporter-declared execution intervals':null,
    reported_turn_duration_ms:b.turn_duration_ms??null,
    reported_turn_duration_basis:b.turn_duration_ms!==null?'host-reported turn duration including tools; not active or model compute time':null};
  op.activity_kind=b.activity_kind??null;
  if(b.dispatch){Object.assign(op,{execution_id:b.dispatch.execution_id,display_label:b.dispatch.display_label,selection_reason:b.dispatch.selection_reason,requested_model:b.dispatch.model,requested_reasoning:b.dispatch.reasoning?{name:'effort',value:b.dispatch.reasoning}:null,activity_kind:b.dispatch.activity_kind});}
  op.selection_match=!b.dispatch||!b.model?'unknown':b.dispatch.model!==b.model?'mismatch':b.dispatch.reasoning===null?'match':b.reasoning===null?'unknown':b.dispatch.reasoning===b.reasoning?'match':'mismatch';
  const usage=Object.fromEntries(['input_tokens','output_tokens','cost_usd'].map(k=>[k,{total:null,known_subtotal:op.usage[k]??null,
    observed_operations:op.usage[k]!==null?1:0,complete_operations:final&&op.usage[k]!==null?1:0,total_operations:observed?1:0,complete:false}]));
  return {schema_version:'workkeel.host-measurements/v1',authority:'observation-only',mutation_status:'no-write',
    measurement_source:'native-host-report',run_id:b.binding_id,task_id:b.task_id,runner_state:b.status==='active'?'running':b.status,created_at:b.created_at,
    last_observed_at:b.observed_at??null,collection_closed:Boolean(b.collection_closed),collection_status:b.collection_closed?'stopped':b.status==='active'?'running':b.status==='completed'?'completed':b.status==='error'?'error':'stopped',
    capture_start:b.capture_turn_from_start?b.claim_at:b.created_at,capture_label:b.capture_turn_from_start?'Explicit bound turn, samples before claim excluded':'After explicit attachment baseline',
    read_at:now(),coverage_complete:false,coverage:b.capture_turn_from_start?'bound-turn-after-claim-only':'bound-host-interval-only',
    reporter_trust:'attributed local report; not provider-authenticated',source_kind:b.source.kind,
    wall_elapsed_ms:null,wall_time_basis:'Unavailable; never inferred from task or binding residence.',
    progress:{recorded_attempts:observed?1:0,completed_attempts:final?1:0,unresolved_attempts:['paused','interrupted','error'].includes(b.status)?1:0,percent:null},usage,
    timing:{adapter_work_ms:b.execution_duration_ms??null,known_adapter_work_ms:b.execution_duration_ms??null,
      measured_operations:b.execution_duration_ms!==null?1:0,total_operations:observed?1:0,meaning:'Reporter-declared execution intervals only; host turn elapsed time is separate.'},
    observations:{response_count:b.assigned_responses,unassigned_response_count:b.unassigned_responses,last_observed_at:b.observed_at??null,
      last_collected_at:b.collected_at??null,source_status:b.source_status??'unobserved',error_code:b.error_code??null,
      reported_turn_duration_ms:b.turn_duration_ms??null,mixed_model:b.model_mixed??false,mixed_reasoning:b.reasoning_mixed??false},operations:observed?[op]:[],task_acceptance:'not-performed',
    limitations:['Coverage is limited to the explicitly bound host operation; other turns and child agents are not inferred.',
      'Unknown remains null; observations are not a process liveness guarantee or task acceptance.']};
}
async function save(target,b) {
  const dir=await safeDirectory(target,`${ROOT}/${b.binding_id}`,{create:true});
  const serialized=formatJson({value:b,sha256:executionDigest(b)});
  if(Buffer.byteLength(serialized)>LIMITS.record)fail('host-record-bound');
  await durableAtomicWrite(path.join(dir,'binding.json'),serialized);
  await saveProjection(target,b);
}
async function saveProjection(target,b) {
  const dir=await safeDirectory(target,`${ROOT}/${b.binding_id}`);
  const projection={binding_sha256:executionDigest(b),measurement:measurement(b)};
  await durableAtomicWrite(path.join(dir,'measurement.json'),formatJson({value:projection,sha256:executionDigest(projection)}));
}
async function ensureProjection(target,b) {
  try {
    const p=await record(target,`${ROOT}/${b.binding_id}/measurement.json`);
    if(p.binding_sha256===executionDigest(b)&&p.measurement?.task_id===b.task_id&&p.measurement?.run_id===b.binding_id)return;
  }catch{}
  await saveProjection(target,b);
}
async function checkTask(target,b) {
  const task=await readNativeTask(target,b.task_id);
  const claim=task.history[b.task_version-1];
  if(task.contract_sha256!==b.contract_sha256||task.contract.execution.runtime.kind!=='host-owned'||claim?.hash!==b.task_hash||claim.action!=='claim'||
    !sameActor(claim.actor,b.actor)||claim.at!==b.claim_at)fail('host-task-binding-changed');
  const stop=task.history.slice(b.task_version).find(e=>['release','rework','cancel'].includes(e.action));
  if(b.dispatch){const {readDispatchTicket}=await import('./workkeel-dispatch.mjs');const ticket=await readDispatchTicket(target,b.dispatch.execution_id);if(ticket.task_id!==b.task_id||ticket.claim_id!==b.claim_id||!sameActor(ticket.actor,b.actor)||executionDigest(dispatchFields(ticket))!==executionDigest(b.dispatch))fail('host-dispatch-binding');}
  return {task,stopAt:stop?.at??null};
}
function dispatchFields(ticket){return {execution_id:ticket.execution_id,display_label:ticket.display_label,model:ticket.selected.model,reasoning:ticket.selected.reasoning,selection_reason:ticket.selected.selection_reason,activity_kind:ticket.node.activity_kind,created_at:ticket.created_at};}
async function assertReportContext(target,b,actor){
  const project=await readTaskProject(target);assertActor(project.policy,actor);
  const {task,stopAt}=await checkTask(target,b);if(stopAt)fail('host-binding-closed');
  if(executionDigest(project.policy)!==task.policy_sha256)fail('host-task-authority-changed');
  for(const pin of task.authority_pins)if((await readTaskFile(target,pin.path)).digest!==pin.sha256)fail('host-task-authority-changed');
}

// Exact opt-in source only. No session discovery, SQLite traversal or provider call.
async function openSource(file) {
  if(typeof file!=='string'||file.length>4096||!path.isAbsolute(file)||path.normalize(file)!==file)fail('host-source-path');
  let parent=path.parse(file).root;
  for(const part of file.slice(parent.length).split(path.sep).slice(0,-1)) {
    parent=path.join(parent,part);const s=await fs.lstat(parent);if(!s.isDirectory()||s.isSymbolicLink())fail('host-source-symlink');
  }
  const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const stat=await handle.stat();if(!stat.isFile()){await handle.close();fail('host-source-type');}return {handle,stat};
}
async function anchor(handle,end) {
  const start=Math.max(0,end-LIMITS.chunk),buffer=Buffer.alloc(end-start);
  const {bytesRead}=await handle.read(buffer,0,buffer.length,start);
  if(bytesRead!==buffer.length)fail('host-source-truncated');return hash(buffer);
}
function envelopeType(prefix) {
  // Only the first envelope type, before payload, can opt a row into parsing.
  const before=prefix.indexOf('"payload"'),match=/"type"\s*:\s*"([A-Za-z_]+)"/.exec(prefix);
  if(!match||before>=0&&match.index>before)return null;return match[1];
}
async function scan(b,{initial=false}={}) {
  const {handle,stat}=await openSource(b.source.path);
  try {
    const prior=b.checkpoint;
    if(prior&&(String(stat.ino)!==prior.ino||String(stat.dev)!==prior.dev||stat.size<prior.offset||await anchor(handle,prior.offset)!==prior.anchor))fail('host-source-replaced-or-truncated');
    const start=prior?.offset??b.source.start_offset??0,end=Math.min(stat.size,start+LIMITS.scan);
    if(initial&&stat.size-start>LIMITS.scan)fail('host-initial-source-bound');
    if(initial&&b.source.start_offset!==undefined){
      async function rowAt(position){const buf=Buffer.alloc(Math.min(LIMITS.line,Math.max(0,stat.size-position)));const {bytesRead}=await handle.read(buf,0,buf.length,position);const e=buf.subarray(0,bytesRead).indexOf(10);if(e<0)fail('host-source-offset');try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buf.subarray(0,e)));}catch{fail('host-source-offset');}}
      const header=await rowAt(0);if(header.type!=='session_meta'||header.payload?.id!==b.source.thread_id)fail('host-source-thread-mismatch');
      b.provider=text(header.payload.model_provider);
      if(start<=0||start>=stat.size)fail('host-source-offset');
      const previous=Buffer.alloc(1);await handle.read(previous,0,1,start-1);if(previous[0]!==10)fail('host-source-offset');
      const first=await rowAt(start);if(first.type!=='event_msg'||first.payload?.type!=='task_started'||first.payload?.turn_id!==b.source.turn_id)fail('host-source-offset');
    }
    let offset=start,lineStart=start,pieces=[],lineSize=0,prefix='',type=null,completeOffset=start;
    let seenHeader=!initial||b.source.start_offset!==undefined;
    const allowed=new Set(['session_meta','turn_context','event_msg','token_usage_record']);
    async function line(bytes,endOffset) {
      if(!allowed.has(type))return;
      if(type==='event_msg') {
        // Content events and legacy token_count are never parsed. The payload's
        // first structural type precedes any message body in this source format.
        const subtype=/"payload"\s*:\s*\{\s*"type"\s*:\s*"([A-Za-z_]+)"/.exec(prefix)?.[1];
        if(!['task_started','task_complete','turn_aborted'].includes(subtype))return;
      }
      if(lineSize>LIMITS.line)fail('host-relevant-line-bound');
      let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('host-source-malformed');}
      if(value.type!==type||!value.payload||typeof value.payload!=='object')fail('host-source-malformed');
      const p=value.payload;
      if(type==='session_meta') {
        if(p.id!==b.source.thread_id)fail('host-source-thread-mismatch');seenHeader=true;
        b.provider=text(p.model_provider);return;
      }
      if(!seenHeader)fail('host-source-header-missing');
      if(type==='turn_context'&&p.turn_id===b.source.turn_id) {
        const model=text(p.model),reasoning=text(p.effort);
        if(b.assigned_responses&&b.model!==model)b.model_mixed=true;
        if(b.assigned_responses&&b.reasoning!==reasoning)b.reasoning_mixed=true;
        b.model=b.model_mixed?null:model;b.reasoning=b.reasoning_mixed?null:reasoning;return;
      }
      if(type==='event_msg'&&p.turn_id===b.source.turn_id) {
        if(p.type==='task_started') {
          const at=date(value.timestamp);if(b.turn_started_at&&b.turn_started_at!==at)fail('host-turn-restarted');b.turn_started_at=at;
        } else if(['task_complete','turn_aborted'].includes(p.type)) {
          b.turn_ended_at=date(value.timestamp);b.turn_terminal=p.type==='task_complete'?'completed':'interrupted';
          if(b.capture_turn_from_start&&number(p.duration_ms))b.turn_duration_ms=p.duration_ms;
        }
        return;
      }
      if(type!=='token_usage_record'||p.thread_id!==b.source.thread_id||p.turn_id!==b.source.turn_id)return;
      const ordinal=value.ordinal;if(!number(ordinal))fail('host-source-ordinal');
      const response=text(p.response_id,256);if(!response)fail('host-response-identity');
      const at=date(value.timestamp),usage=tokens(p.usage),cumulative=tokens(p.turn_token_usage);
      if(Date.parse(at)>Date.now()+60000)fail('host-source-time-boundary');
      const key=hash(`${p.thread_id}\n${p.turn_id}\n${response}`),digest=executionDigest({usage,cumulative,at});
      const previous=b.responses.find(r=>r.key===key);
      if(previous){if(previous.digest!==digest)fail('host-response-conflict');return;}
      if(b.responses.length>=LIMITS.responses)fail('host-response-bound');
      if(b.last_cumulative)for(const k of TOKEN_KEYS) {
        const priorValue=b.last_cumulative[k],next=cumulative[k],delta=usage[k];
        if(priorValue!==null&&next!==null&&(next<priorValue||delta!==null&&next-priorValue!==delta))fail('host-token-counter-discontinuity');
      }
      if(b.last_ordinal!==null&&ordinal<=b.last_ordinal)fail('host-source-ordinal-regressed');
      b.responses.push({key,digest});b.last_cumulative=cumulative;b.last_ordinal=ordinal;
      const assigned=(!initial||b.capture_turn_from_start)&&Date.parse(at)>=Date.parse(b.claim_at)&&(!b.stop_at||Date.parse(at)<Date.parse(b.stop_at));
      if(assigned) {b.usage=b.assigned_responses?add(b.usage,usage):usage;b.assigned_responses++;b.observed_at=at;}
      else b.unassigned_responses++;
      b.last_source_at=at;
    }
    while(offset<end) {
      const buffer=Buffer.alloc(Math.min(LIMITS.chunk,end-offset));const {bytesRead}=await handle.read(buffer,0,buffer.length,offset);
      if(!bytesRead)fail('host-source-truncated');offset+=bytesRead;
      let pos=0;
      while(pos<bytesRead) {
        const newline=buffer.indexOf(10,pos),finish=newline<0?bytesRead:newline+1,part=buffer.subarray(pos,finish);
        if(prefix.length<1024)prefix+=part.subarray(0,1024-prefix.length).toString('utf8');
        type??=envelopeType(prefix);lineSize+=part.length;
        if(lineSize<=LIMITS.line)pieces.push(part);else pieces=[];
        pos=finish;
        if(newline>=0) {
          const endOffset=offset-bytesRead+finish;
          await line(Buffer.concat(pieces),endOffset);completeOffset=endOffset;lineStart=endOffset;
          pieces=[];lineSize=0;prefix='';type=null;
        }
      }
    }
    if(initial&&!seenHeader)fail('host-source-header-missing');
    if(lineSize&&lineStart===start&&end<stat.size)fail('host-source-line-scan-bound');
    const after=await handle.stat(),entry=await fs.lstat(b.source.path);
    if(after.size<stat.size||entry.isSymbolicLink()||entry.ino!==stat.ino||entry.dev!==stat.dev)fail('host-source-changed');
    b.checkpoint={ino:String(stat.ino),dev:String(stat.dev),offset:completeOffset,anchor:await anchor(handle,completeOffset)};
    b.source_status=completeOffset<stat.size?'partial-source':'observed';b.collected_at=now();
  } finally {await handle.close();}
}

export async function bindHostUsage(targetInput,request) {
  object(request,['binding_id','task_id','contract_sha256','claim_id','actor','source','capture_turn_from_start','approval_ref','sample_kind','dispatch_id']);
  const target=await fs.realpath(targetInput),bindingId=id(request.binding_id);id(request.task_id);
  if(!/^[a-f0-9]{64}$/.test(request.contract_sha256??''))fail('host-contract-required');
  object(request.source,['kind','path','thread_id','turn_id','start_offset']);id(request.source.thread_id);id(request.source.turn_id);
  if(request.source.start_offset!==undefined&&(!number(request.source.start_offset)||request.source.kind!=='codex-rollout'))fail('host-source-offset');
  if(!['codex-rollout','host-report'].includes(request.source.kind)||request.source.kind==='host-report'&&request.source.path!==undefined)fail('invalid-host-source');
  if(request.capture_turn_from_start!==undefined&&typeof request.capture_turn_from_start!=='boolean')fail('invalid-host-capture-mode');
  const task=await assertTaskExecutionContext(target,request.task_id,request);
  let ticket=null;
  if(request.dispatch_id!==undefined){
    const {readDispatchTicket}=await import('./workkeel-dispatch.mjs');ticket=await readDispatchTicket(target,id(request.dispatch_id));
    if(bindingId!==ticket.execution_id||ticket.task_id!==task.id||ticket.claim_id!==request.claim_id||ticket.contract_sha256!==request.contract_sha256||!sameActor(ticket.actor,request.actor)||ticket.host_binding_id&&ticket.host_binding_id!==bindingId)fail('host-dispatch-binding');
  }
  if(task.contract.execution.runtime.kind!=='host-owned')fail('host-runtime-required');
  if(request.capture_turn_from_start&&(request.source.kind!=='codex-rollout'||request.approval_ref!==task.contract.authorization.approval_ref))fail('host-full-turn-approval-required');
  const sample=request.sample_kind??'real-task';if(!['real-task','fixture','paired-experiment','unspecified'].includes(sample))fail('invalid-host-sample-kind');
  return lock(target,async()=>{
    const entries=await names(target);if(entries.includes(bindingId))fail('host-binding-exists');if(entries.length>=LIMITS.bindings)fail('host-inventory-bound');
    const dispatchBindings=[];
    for(const entry of entries) {
      const other=await load(target,entry);
      // Closed records from other claims cannot occupy a live scope or satisfy
      // this claim's dependencies. Preserve their integrity/identity checks but
      // do not reinterpret their historical tickets as current authorization.
      const relevant=!other.collection_closed||(other.task_id===task.id&&other.claim_id===request.claim_id);
      if(ticket&&other.dispatch&&relevant){const {readDispatchTicket}=await import('./workkeel-dispatch.mjs');dispatchBindings.push({binding:other,ticket:await readDispatchTicket(target,other.dispatch.execution_id)});}
      if(['active','paused','error'].includes(other.status)&&other.source.thread_id===request.source.thread_id)fail('host-thread-already-bound');
      if(other.source.thread_id===request.source.thread_id&&other.source.turn_id===request.source.turn_id)fail('host-turn-already-bound');
    }
    if(ticket){
      const overlaps=(a,b)=>a==='.'||b==='.'||a===b||a.startsWith(b+'/')||b.startsWith(a+'/');
      const active=dispatchBindings.filter(({binding})=>['active','paused','error'].includes(binding.status)&&!binding.collection_closed);
      if(active.length>=ticket.policy_parallelism)fail('host-dispatch-parallelism');
      for(const {ticket:other} of active)if(ticket.node.write_paths.some(a=>[...other.node.read_paths,...other.node.write_paths].some(b=>overlaps(a,b)))||ticket.node.read_paths.some(a=>other.node.write_paths.some(b=>overlaps(a,b))))fail('host-dispatch-scope-conflict');
      for(const dependency of ticket.node.depends_on)if(!dispatchBindings.some(({binding,ticket:other})=>other.task_id===ticket.task_id&&other.claim_id===ticket.claim_id&&other.node.id===dependency&&binding.status==='completed'))fail('host-dispatch-dependency');
    }
    const b={schema_version:SCHEMA,binding_id:bindingId,task_id:task.id,contract_sha256:task.contract_sha256,
      actor:structuredClone(request.actor),claim_id:task.claim.id,claim_at:task.history.at(-1).at,task_version:task.version,task_hash:task.history.at(-1).hash,
      created_at:now(),source:structuredClone(request.source),capture_turn_from_start:request.capture_turn_from_start??false,sample_kind:sample,
      status:'active',usage:unknown(),assigned_responses:0,unassigned_responses:0,responses:[],reports:[],last_cumulative:null,last_ordinal:null,
      checkpoint:null,tool:request.source.kind==='codex-rollout'?'codex':null,provider:null,model:null,reasoning:null,observed_at:null,collected_at:null,
      turn_started_at:null,turn_ended_at:null,turn_terminal:null,turn_duration_ms:null,execution_duration_ms:null,execution_intervals:[],error_code:null,
      model_mixed:false,reasoning_mixed:false,collection_closed:false,activity_reports:[],activity_kind:ticket?.node.activity_kind??null};
    if(ticket)b.dispatch=dispatchFields(ticket);
    if(b.source.kind==='codex-rollout') {
      await scan(b,{initial:true});
      const dispatchedTurn=ticket&&b.capture_turn_from_start&&b.turn_started_at&&Date.parse(ticket.created_at)<=Date.parse(b.turn_started_at)&&Date.parse(b.claim_at)<=Date.parse(b.turn_started_at);
      if(!b.turn_started_at||b.turn_terminal&&!dispatchedTurn)fail('host-active-turn-required');
      if(b.capture_turn_from_start&&(Date.parse(task.history[0].at)<Date.parse(b.turn_started_at)||Date.parse(b.claim_at)<Date.parse(b.turn_started_at))&&!(ticket&&Date.parse(ticket.created_at)<=Date.parse(b.turn_started_at)&&Date.parse(b.claim_at)<=Date.parse(b.turn_started_at)))fail('host-full-turn-task-boundary');
      if(b.turn_terminal)b.status=b.turn_terminal;
    }
    // A claim may have changed while waiting for the host lock or source scan.
    await assertTaskExecutionContext(target,request.task_id,request);
    await save(target,b);return measurement(b);
  });
}

export async function collectHostUsage(targetInput,bindingId) {
  const target=await fs.realpath(targetInput);id(bindingId);
  return lock(target,async()=>{
    const b=await load(target,bindingId);if(b.source.kind!=='codex-rollout')fail('host-collector-source-required');
    const retryable=b.status==='error'&&b.error_code==='host-source-unavailable';
    if(b.collection_closed||!['active','paused','completed','interrupted'].includes(b.status)&&!retryable){await ensureProjection(target,b);return measurement(b);}
    const next=structuredClone(b);
    try {
      const {stopAt}=await checkTask(target,next);next.stop_at=stopAt;
      await scan(next);
      if(stopAt)next.status='stopped';else if(next.turn_terminal)next.status=next.turn_terminal;else if(retryable)next.status='active';
      next.error_code=null;
      const comparable=value=>({...value,collected_at:null});
      if(executionDigest(comparable(b))===executionDigest(comparable(next))){await ensureProjection(target,b);return measurement(b);}
      await save(target,next);return measurement(next);
    }catch(error) {
      b.status='error';b.error_code=safeError(error);b.source_status='unavailable';b.collected_at=now();
      await save(target,b);return measurement(b);
    }
  });
}

function intervals(value,duration) {
  if(value===undefined) {if(duration!==undefined&&duration!==null)fail('host-execution-intervals-required');return [];}
  if(!Array.isArray(value)||!value.length||value.length>128||!number(duration))fail('invalid-host-execution-intervals');
  let previous=-Infinity;
  const out=[];
  for(const v of value) {
    object(v,['started_at','completed_at']);const start=date(v.started_at),end=date(v.completed_at),a=Date.parse(start),z=Date.parse(end);
    if(a<previous||z<a)fail('invalid-host-execution-interval-order');previous=a;
    const last=out.at(-1);
    if(last&&a<=Date.parse(last.completed_at)){if(z>Date.parse(last.completed_at))last.completed_at=end;}
    else out.push({started_at:start,completed_at:end});
  }
  const total=out.reduce((sum,r)=>sum+Date.parse(r.completed_at)-Date.parse(r.started_at),0);
  if(total!==duration)fail('host-execution-duration-mismatch');return out;
}
export async function reportHostUsage(targetInput,request) {
  object(request,['binding_id','report_id','actor','claim_id','contract_sha256','status','usage','tool','provider','model','reported_reasoning','sample_kind','observed_at','execution_duration_ms','execution_intervals','activity_kind']);
  activityKind(request.activity_kind);
  const target=await fs.realpath(targetInput);id(request.binding_id);id(request.report_id);
  if(!['partial','completed','interrupted','paused','cancelled'].includes(request.status))fail('invalid-host-report-status');
  const usage=tokens(request.usage),observed=date(request.observed_at),ranges=intervals(request.execution_intervals,request.execution_duration_ms);
  const tool=text(request.tool),provider=text(request.provider),model=text(request.model),reasoning=text(request.reported_reasoning);
  if(!tool)fail('host-tool-required');
  return lock(target,async()=>{
    const b=await load(target,request.binding_id);if(b.source.kind!=='host-report')fail('host-report-source-required');
    if(!sameActor(request.actor,b.actor)||request.claim_id!==b.claim_id||request.contract_sha256!==b.contract_sha256)fail('host-reporter-binding');
    await assertReportContext(target,b,request.actor);
    const digest=executionDigest(request),prior=b.reports.find(r=>r.id===request.report_id);
    if(prior){if(prior.digest!==digest)fail('host-report-conflict');await ensureProjection(target,b);return measurement(b);}
    if(!['active','paused'].includes(b.status))fail('host-binding-closed');
    if(request.activity_kind!==undefined&&b.activity_kind&&request.activity_kind!==b.activity_kind)fail('host-activity-kind-changed');
    b.activity_kind??=request.activity_kind??null;
    if(Date.parse(observed)<Date.parse(b.claim_at)||b.observed_at&&Date.parse(observed)<Date.parse(b.observed_at)||Date.parse(observed)>Date.now()+60000)fail('host-report-time-boundary');
    if(ranges.some(r=>Date.parse(r.started_at)<Date.parse(b.claim_at)||Date.parse(r.completed_at)>Date.parse(observed)))fail('host-report-interval-boundary');
    if(request.sample_kind!==undefined&&request.sample_kind!==b.sample_kind)fail('host-report-sample-changed');
    if(b.reports.length>=LIMITS.responses)fail('host-report-bound');
    if(Object.values(b.usage).some(v=>v!==null)&&(tool!==b.tool||provider!==b.provider||model!==b.model||reasoning!==b.reasoning))fail('host-report-labels-changed');
    for(const k of TOKEN_KEYS)if(b.usage[k]!==null&&usage[k]!==null&&usage[k]<b.usage[k])fail('host-token-counter-discontinuity');
    b.usage=usage;b.reports.push({id:request.report_id,digest});b.assigned_responses=b.reports.length;
    Object.assign(b,{tool,provider,model,reasoning,observed_at:observed,collected_at:now(),source_status:'reporter-observed',
      execution_duration_ms:request.execution_duration_ms??null,execution_intervals:ranges,status:request.status==='partial'?'active':request.status});
    await save(target,b);return measurement(b);
  });
}

/** Attributed execution intervals only: source-derived tokens and model remain untouched. */
export async function reportHostActivity(targetInput,request) {
  object(request,['binding_id','report_id','actor','claim_id','contract_sha256','observed_at','execution_duration_ms','execution_intervals','activity_kind']);
  id(request.binding_id);id(request.report_id);activityKind(request.activity_kind);
  const observed=date(request.observed_at),ranges=intervals(request.execution_intervals,request.execution_duration_ms);
  if(!ranges.length)fail('host-execution-intervals-required');
  const target=await fs.realpath(targetInput);
  return lock(target,async()=>{
    const b=await load(target,request.binding_id);if(b.source.kind!=='codex-rollout')fail('host-collector-source-required');
    if(!sameActor(request.actor,b.actor)||request.claim_id!==b.claim_id||request.contract_sha256!==b.contract_sha256)fail('host-reporter-binding');
    await assertReportContext(target,b,request.actor);
    const digest=executionDigest(request),prior=(b.activity_reports??[]).find(r=>r.id===request.report_id);
    if(prior){if(prior.digest!==digest)fail('host-report-conflict');await ensureProjection(target,b);return measurement(b);}
    if(b.collection_closed||!['active','paused','completed','interrupted'].includes(b.status))fail('host-binding-closed');
    if(Date.parse(observed)<Date.parse(b.claim_at)||Date.parse(observed)>Date.now()+60000||b.activity_observed_at&&Date.parse(observed)<Date.parse(b.activity_observed_at))fail('host-report-time-boundary');
    if(ranges.some(r=>Date.parse(r.started_at)<Date.parse(b.claim_at)||Date.parse(r.completed_at)>Date.parse(observed)))fail('host-report-interval-boundary');
    if(request.activity_kind!==undefined&&b.activity_kind&&request.activity_kind!==b.activity_kind)fail('host-activity-kind-changed');
    // Cumulative reports may extend measured coverage, but cannot erase earlier intervals.
    if(b.execution_intervals.some(old=>!ranges.some(r=>Date.parse(r.started_at)<=Date.parse(old.started_at)&&Date.parse(r.completed_at)>=Date.parse(old.completed_at))))fail('host-activity-regressed');
    b.activity_reports??=[];if(b.activity_reports.length>=LIMITS.responses)fail('host-report-bound');
    b.activity_reports.push({id:request.report_id,digest});b.activity_kind??=request.activity_kind??null;
    Object.assign(b,{activity_observed_at:observed,execution_duration_ms:request.execution_duration_ms,execution_intervals:ranges,collected_at:now()});
    await save(target,b);return measurement(b);
  });
}

export async function closeHostUsage(targetInput,request) {
  object(request,['binding_id','actor','status']);id(request.binding_id);
  if(request.status!==undefined&&!['stopped','cancelled'].includes(request.status))fail('invalid-host-close-status');
  const target=await fs.realpath(targetInput);
  return lock(target,async()=>{
    const b=await load(target,request.binding_id),project=await readTaskProject(target);assertActor(project.policy,request.actor);
    if(!sameActor(request.actor,b.actor))fail('host-reporter-binding');
    if(!b.collection_closed){b.collection_closed=true;if(['active','paused','error'].includes(b.status))b.status=request.status??'stopped';b.collected_at=now();await save(target,b);}
    else await ensureProjection(target,b);
    return measurement(b);
  });
}
const safeError=error=>typeof error?.code==='string'&&/^host-[a-z-]+$/.test(error.code)?error.code:'host-source-unavailable';

/** Reads sanitized projections only for output; never opens bound host sources. */
export async function readHostMeasurements(target) {
  const byTask=new Map(),errors=[];let indexReads=0;
  if(!await existsEntry(target,ROOT))return {byTask,errors,index_reads:0};
  let entries;
  try{entries=await names(target);}catch{return {byTask,errors:[{run_id:null,task_id:null,code:'host-inventory-unavailable'}],index_reads:0};}
  for(const entry of entries) {
    let taskId=null;
    try {
      indexReads++;const b=await load(target,entry);taskId=b.task_id;await checkTask(target,b);
      const p=await record(target,`${ROOT}/${entry}/measurement.json`);
      if(p.binding_sha256!==executionDigest(b)||p.measurement?.task_id!==taskId||p.measurement?.run_id!==entry)fail('host-projection-changed');
      // Re-project verified private state rather than trusting arbitrary display fields.
      const m=measurement(b);if(!byTask.has(taskId))byTask.set(taskId,[]);byTask.get(taskId).push(m);
      if(b.error_code)errors.push({run_id:entry,task_id:taskId,code:b.error_code});
    }catch{errors.push({run_id:entry,task_id:taskId,code:'host-measurement-unavailable'});}
  }
  return {byTask,errors,index_reads:indexReads};
}
