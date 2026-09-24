import fs from 'node:fs/promises';
import path from 'node:path';
import { readNativeTask } from './workkeel-tasks.mjs';
import { readTaskProject, assertActor, safeDirectory, existsEntry } from './workkeel-project.mjs';
import { readTaskContractInput, readTaskFile } from './task-contract.mjs';
import { withProjectMutationLock } from './project.mjs';
import { durableAtomicCreate } from './files.mjs';
import { executionDigest, exactKeys } from './workkeel-execution-policy.mjs';

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
export async function readTaskSummary(target,id) {
  const task=await readNativeTask(target,id);
  const project=await readTaskProject(target),policyCurrent=executionDigest(project.policy)===task.policy_sha256;
  const rejected=task.attempts.filter(a=>a.kind==='rejected').length;
  let observed;
  try{observed=await observation(target,task);}catch{observed={status:'unavailable',value:null};}
  const last=task.history.at(-1),runStates={intake:'ready',build:'working',test:'review',release_gate:'acceptance',done:'done',cancelled:'cancelled'};
  let next={intake:'Claim this approved task to begin.',build:'Inspect the recorded run and continue within the active claim.',test:'Review the delivered candidate with a distinct Agent.',release_gate:'Record acceptance and rollback for the reviewed candidate.',done:'Accepted locally. External merge or release is a separate observation.',cancelled:'Task cancelled; preserve its evidence.'}[task.state];
  if(task.review?.judgment==='fail')next='Resolve the review findings and request same-scope rework.';
  if(observed.status==='unavailable')next='Inspect the observation record and its referenced evidence.';
  const evidenceStatus=[];
  for(const stage of ['authority','delivery','review','closeout'])for(const pin of (stage==='authority'?task.authority_pins:task[stage]?.evidence)??[]){
    let status='verified';try{if((await readTaskFile(target,pin.path)).digest!==pin.sha256)status='changed';}catch{status='unavailable';}
    evidenceStatus.push({stage,...pin,status});
  }
  if(evidenceStatus.some(p=>p.status!=='verified'))next='Recover the exact recorded evidence before continuing this task.';
  if(!policyCurrent)next='Inspect the project policy change and re-establish task authority before continuing.';
  return {schema_version:'workkeel.task-summary/v1',authority:'observation-only',mutation_status:'no-write',
    task_id:id,title:task.contract.goal,task_state:task.state,version:task.version,
    display_state:runStates[task.state],needs_attention:!policyCurrent||['test','release_gate'].includes(task.state)||observed.status==='unavailable'||evidenceStatus.some(p=>p.status!=='verified'),
    next_action:next,updated_at:last.at,created_at:task.history[0].at,
    actor:task.claim?.actor??task.contract.actor,acceptance_criteria:task.contract.acceptance.criteria,
    candidate_revision:task.delivery?.revision??null,delivery:task.delivery,review:task.review,closeout:task.closeout,
    evidence:evidenceStatus,observation:observed,
    quality:{rework_count:rejected,review_judgment:task.review?.judgment??null,
      first_review_pass:task.review?task.review.judgment==='pass'&&rejected===0:null,
      locally_accepted:task.state==='done',evidence_current:policyCurrent&&evidenceStatus.every(p=>p.status==='verified'),policy_current:policyCurrent,
      lifecycle_elapsed_ms:['done','cancelled'].includes(task.state)?Date.parse(last.at)-Date.parse(task.history[0].at):null},
    timeline:task.history.map(e=>({action:e.action,at:e.at,state:e.state,revision:e.revision})),
    limitations:['Recorded task state is not process liveness.','Attribution is not provider authentication.','Check and PR observations never satisfy acceptance gates.']};
}
