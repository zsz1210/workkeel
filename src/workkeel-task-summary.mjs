import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { readNativeTask } from './workkeel-tasks.mjs';
import { readTaskProject, assertActor, safeDirectory, existsEntry } from './workkeel-project.mjs';
import { readTaskContractInput, readTaskFile } from './task-contract.mjs';
import { withProjectMutationLock } from './project.mjs';
import { durableAtomicCreate } from './files.mjs';
import { executionDigest, exactKeys } from './workkeel-execution-policy.mjs';
import { projectTaskTiming } from './workkeel-task-timing.mjs';
import { observeFileRead, observeSource } from './workkeel-read-metrics.mjs';

const SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const bounded = (value, max=2000) => typeof value==='string' && value.trim().length>0 && value.length<=max;
export function safeObservationLink(value, kind) {
  if (typeof value !== 'string' || value.length>500) return null;
  if (kind==='conversation') return /^codex:\/\/threads\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value) ? value : null;
  return /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(value) ? value : null;
}
function validateObservation(value, task) {
  exactKeys(value,['schema_version','task_id','task_version','actor','candidate_revision','observed_at','source','sample_kind','comparison_group','checks','links','note']);
  if (value.schema_version!=='workkeel.task-observation/v1' || value.task_id!==task.id || !Number.isSafeInteger(value.task_version) || value.task_version<1 || value.task_version>task.version) throw Error('Invalid task observation binding');
  if (!(value.candidate_revision===null || SHA.test(value.candidate_revision)) || !bounded(value.source,160) || !bounded(value.note)) throw Error('Invalid observation metadata');
  if (typeof value.observed_at!=='string' || !/^\d{4}-\d\d-\d\dT/.test(value.observed_at) || !Number.isFinite(Date.parse(value.observed_at)) || Date.parse(value.observed_at)>Date.now()+300000) throw Error('Invalid observation timestamp');
  if (!['real-task','paired-experiment','fixture','unspecified'].includes(value.sample_kind) || !(value.comparison_group===null || bounded(value.comparison_group,120))) throw Error('Invalid measurement grouping');
  if (!Array.isArray(value.checks) || value.checks.length>40) throw Error('Invalid check inventory');
  for (const check of value.checks) {
    exactKeys(check,['name','status','evidence_ref']);
    if (!bounded(check.name,160) || !['pass','fail','unknown'].includes(check.status) || !(check.evidence_ref===null || bounded(check.evidence_ref,500))) throw Error('Invalid check observation');
  }
  exactKeys(value.links,['conversation','pull_request']);
  for (const kind of ['conversation','pull_request']) if (value.links[kind]!==null && !safeObservationLink(value.links[kind],kind)) throw Error('Unsupported observation link');
  return value;
}
async function checkEvidence(target, value) {
  const pins=[];
  for(const check of value.checks) if(check.evidence_ref!==null) {
    const file=await readTaskFile(target,check.evidence_ref);
    if(!file.content.trim())throw Error('Check evidence is empty');
    pins.push({path:check.evidence_ref,sha256:file.digest});
  }
  return pins;
}
/** Append attributed observations, without modifying task state or acceptance. */
export async function recordTaskObservation(target, id, value) {
  return withProjectMutationLock(target,async()=>{
    const task=await readNativeTask(target,id),project=await readTaskProject(target);
    validateObservation(value,task);assertActor(project.policy,value.actor);
    if(value.task_version!==task.version)throw Error('Stale task observation; inspect the current task');
    const record={value,evidence:await checkEvidence(target,value)},sha256=executionDigest(record);
    const ref=`.ai-org/observations/${id}`,directory=await safeDirectory(target,ref,{create:true});
    // Keep project-local observations out of product changes and ordinary Git staging.
    const ignoreRef='.ai-org/observations/.gitignore';
    try{await durableAtomicCreate(path.join(target,ignoreRef),'*\n');}
    catch(error){if(error.code!=='EEXIST')throw error;if((await readTaskFile(target,ignoreRef)).content!=='*\n')throw Error('Observation ignore policy changed; inspect before recording');}
    const file=path.join(directory,sha256+'.json');
    if(await existsEntry(target,`${ref}/${sha256}.json`)) {
      const existing=(await readTaskContractInput(target,`${ref}/${sha256}.json`)).document;
      if(executionDigest(existing.record)!==sha256 || existing.sha256!==sha256)throw Error('Observation digest mismatch');
      return {schema_version:'workkeel.observation-result/v1',path:`${ref}/${sha256}.json`,replayed:true,acceptance_granted:false};
    }
    if((await fs.readdir(directory)).length>=64)throw Error('Observation limit reached; preserve this history');
    await durableAtomicCreate(file,JSON.stringify({record,sha256},null,2)+'\n');
    return {schema_version:'workkeel.observation-result/v1',path:`${ref}/${sha256}.json`,replayed:false,acceptance_granted:false};
  });
}
async function observation(target,task) {
  const ref=`.ai-org/observations/${task.id}`;
  if(!await existsEntry(target,ref))return {status:'unobserved',value:null};
  const directory=await safeDirectory(target,ref),names=(await fs.readdir(directory)).sort();
  if(names.length>64)throw Error('Observation history exceeds limit');
  const records=[],project=await readTaskProject(target);
  for(const name of names){
    if(!/^[a-f0-9]{64}\.json$/.test(name))throw Error('Invalid observation file');
    const doc=(await readTaskContractInput(target,`${ref}/${name}`)).document;
    exactKeys(doc,['record','sha256']);exactKeys(doc.record,['value','evidence']);
    if(doc.sha256!==name.slice(0,-5)||executionDigest(doc.record)!==doc.sha256)throw Error('Observation integrity failure');
    validateObservation(doc.record.value,task);
    assertActor(project.policy,doc.record.value.actor);
    if(executionDigest(await checkEvidence(target,doc.record.value))!==executionDigest(doc.record.evidence))throw Error('Observation evidence changed');
    records.push(doc.record.value);
  }
  records.sort((a,b)=>Date.parse(b.observed_at)-Date.parse(a.observed_at));
  const value=records[0]??null;
  return {status:!value?'unobserved':value.candidate_revision===null?'unbound':value.candidate_revision===task.delivery?.revision?'candidate-matched':'stale',value};
}

const REASON_ACTIONS=new Set(['release','handoff','review','rework','close','cancel']);
const REQUEST_NAME=/^(?:request|release|handoff|review|rework|close|cancel)(?:-[A-Za-z0-9][A-Za-z0-9._-]{0,95})?\.json$/;
const REQUEST_FILE_LIMIT=64*1024,REQUEST_TOTAL_LIMIT=512*1024;
// Read only bounded operation-request candidates in this task's own artifact
// directory. Keep decoding separate from the exact parsed-request digest.
async function readReasonRequest(target,ref,limit) {
  const name=path.join(target,ref);
  observeSource(target,ref);
  const file=await fs.open(name,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  let length=0;
  try {
    const before=await file.stat();
    if(!before.isFile()||before.size>limit)return {document:null,bytes:0};
    const buffer=Buffer.alloc(limit+1);
    while(length<buffer.length) {
      const {bytesRead}=await file.read(buffer,length,buffer.length-length,null);
      if(!bytesRead)break;
      length+=bytesRead;
    }
    const after=await file.stat(),entry=await fs.lstat(name);
    if(length>limit||length!==before.size||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||
      before.dev!==entry.dev||before.ino!==entry.ino||entry.isSymbolicLink()||await fs.realpath(name)!==name)return {document:null,bytes:length};
    try {return {document:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,length))),bytes:length};}
    catch {return {document:null,bytes:length};}
  } catch {return {document:null,bytes:length};
  } finally {observeFileRead(length);await file.close();}
}
async function recordedReasons(target,task) {
  const missing=new Map(task.history.filter(e=>REASON_ACTIONS.has(e.action)&&
    (!bounded(e.summary,8000)||e.action==='review'&&!['pass','fail'].includes(e.judgment))).map(e=>[e.operation_id,e]));
  const recovered=new Map();
  if(!missing.size)return recovered;
  const root=await fs.realpath(target),ref=`.ai-org/artifacts/${task.id}`;
  // Watching the directory also invalidates summaries when a missing request
  // is restored or a previously nonmatching request is replaced.
  observeSource(root,ref);
  try {
    const directory=await fs.opendir(await safeDirectory(root,ref)),names=[];
    let entries=0;
    for await(const entry of directory) {
      if(++entries>128)return recovered;
      if(entry.isFile()&&REQUEST_NAME.test(entry.name))names.push(entry.name);
    }
    if(names.length>64)return recovered;
    let remaining=REQUEST_TOTAL_LIMIT;
    for(const name of names.sort()) {
      if(remaining<=0||recovered.size===missing.size)break;
      let input;
      try {input=await readReasonRequest(root,`${ref}/${name}`,Math.min(REQUEST_FILE_LIMIT,remaining));}
      catch {continue;}
      remaining-=input.bytes;
      const request=input.document;
      if(!request||typeof request!=='object'||Array.isArray(request))continue;
      const event=missing.get(request.operation_id);
      if(!event||executionDigest({action:event.action,request})!==event.request_sha256)continue;
      recovered.set(event.operation_id,{reason:bounded(request.summary,8000)?request.summary:null,
        outcome:event.action==='review'&&['pass','fail'].includes(request.judgment)?request.judgment:null});
    }
  } catch {/* Unavailable historical requests never invalidate canonical state. */}
  return recovered;
}
async function taskTimeline(target,task) {
  const recovered=await recordedReasons(target,task);
  return task.history.map(event=>{
    const recorded=bounded(event.summary,8000),request=recovered.get(event.operation_id);
    return {action:event.action,at:event.at,state:event.state,revision:event.revision,
      actor:bounded(event.actor?.agent_id,96)&&bounded(event.actor?.principal_id,96)?
        {agent_id:event.actor.agent_id,principal_id:event.actor.principal_id}:null,
      reason:recorded?event.summary:request?.reason??null,
      outcome:event.action==='review'?(['pass','fail'].includes(event.judgment)?event.judgment:request?.outcome??null):null,
      reason_source:recorded?'event':request?.reason?'request':'unknown'};
  });
}
export async function readTaskSummary(target,id,{now=new Date()}={}) {
  const task=await readNativeTask(target,id);
  const project=await readTaskProject(target),policyCurrent=executionDigest(project.policy)===task.policy_sha256;
  const authorityExpired=task.contract.authorization.expires_at!==null&&Date.parse(task.contract.authorization.expires_at)<=now.getTime();
  const activeAuthorityExpired=authorityExpired&&!['done','cancelled'].includes(task.state);
  const rejected=task.attempts.filter(a=>a.kind==='rejected').length;
  let observed;
  try{observed=await observation(target,task);}catch{observed={status:'unavailable',value:null};}
  const last=task.history.at(-1),runStates={intake:'ready',build:'working',test:'review',release_gate:'acceptance',done:'done',cancelled:'cancelled'};
  let next={intake:'Claim this approved task to begin.',build:'Inspect the recorded run and continue within the active claim.',test:'Review the delivered candidate with a distinct Agent.',release_gate:'Record acceptance and rollback for the reviewed candidate.',done:'Accepted locally. External merge or release is a separate observation.',cancelled:'Task cancelled; preserve its evidence.'}[task.state];
  if(task.review?.judgment==='fail')next='Resolve the review findings and request same-scope rework.';
  if(observed.status==='unavailable')next='Inspect the observation record and its referenced evidence.';
  const evidenceStatus=[];
  for(const stage of ['authority','delivery','review','closeout'])for(const pin of (stage==='authority'?task.authority_pins:task[stage]?.evidence)??[]){
    let status='verified',current_digest=null;try{current_digest=(await readTaskFile(target,pin.path)).digest;if(current_digest!==pin.sha256)status='changed';}catch{status='unavailable';}
    evidenceStatus.push({stage,...pin,status,current_digest});
  }
  if(evidenceStatus.some(p=>p.status!=='verified'))next='Recover the exact recorded evidence before continuing this task.';
  if(!policyCurrent)next='Inspect the project policy change and re-establish task authority before continuing.';
  if(activeAuthorityExpired)next='Task approval has expired. Obtain renewed approval through a new task before continuing.';
  const attentionReasons=[];
  if(activeAuthorityExpired)attentionReasons.push('approval-expired');
  if(!policyCurrent)attentionReasons.push('policy-changed');
  if(evidenceStatus.some(p=>p.status!=='verified'))attentionReasons.push('evidence-unavailable');
  if(observed.status==='unavailable')attentionReasons.push('observation-unavailable');
  if(task.review?.judgment==='fail')attentionReasons.push('review-failed');
  else if(task.state==='test')attentionReasons.push('awaiting-review');
  if(task.state==='release_gate')attentionReasons.push('awaiting-acceptance');
  const lifecycle=projectTaskTiming(task,{now});
  if(lifecycle.coverage!=='complete-history')attentionReasons.push('timing-unavailable');
  return {schema_version:'workkeel.task-summary/v1',authority:'observation-only',mutation_status:'no-write',
    task_id:id,title:task.contract.goal,goal:task.contract.goal,scope:task.contract.scope,
    execution_scope:{read_paths:task.contract.environment.read_paths,write_paths:task.contract.environment.write_paths,tools:task.contract.environment.tools,network:task.contract.environment.network},task_state:task.state,version:task.version,
    display_state:runStates[task.state],needs_attention:attentionReasons.length>0,
    next_action:next,attention_reasons:attentionReasons,lifecycle,updated_at:last.at,created_at:task.history[0].at,
    actor:task.claim?.actor??task.contract.actor,acceptance_criteria:task.contract.acceptance.criteria,
    candidate_revision:task.delivery?.revision??null,delivery:task.delivery,review:task.review,closeout:task.closeout,
    evidence:evidenceStatus,observation:observed,
    quality:{rework_count:rejected,review_judgment:task.review?.judgment??null,
      first_review_pass:rejected>0?false:task.review?task.review.judgment==='pass':null,
      approval_status:authorityExpired?'expired':'current',
      locally_accepted:task.state==='done',evidence_current:policyCurrent&&evidenceStatus.every(p=>p.status==='verified'),policy_current:policyCurrent,
      lifecycle_elapsed_ms:['done','cancelled'].includes(task.state)?lifecycle.elapsed_ms:null},
    timeline:await taskTimeline(target,task),
    limitations:['Recorded task state is not process liveness.','Attribution is not provider authentication.','Check and PR observations never satisfy acceptance gates.']};
}
