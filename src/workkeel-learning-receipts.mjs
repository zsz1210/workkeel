import fs from 'node:fs/promises';
import path from 'node:path';
import {exactKeys,executionDigest} from './workkeel-execution-policy.mjs';
import {readTaskFile} from './task-contract.mjs';
import {safeDirectory} from './workkeel-project.mjs';
import {durableAtomicCreate,formatJson} from './files.mjs';

/** Shared receipt storage; each caller still validates its own event semantics. */
export async function readLearningReceipts(target,{root,schema,limit,extra=[],validate,fail}){
  let dir;try{dir=await safeDirectory(target,root);}catch(e){if(e.code==='ENOENT')return [];throw e;}
  const names=(await fs.readdir(dir)).sort(),result=[];
  if(names.length>limit)fail('event inventory limit');
  for(const [n,name] of names.entries()){
    if(name!==`${String(n+1).padStart(6,'0')}.json`)fail('invalid event inventory or sequence gap');
    const envelope=JSON.parse((await readTaskFile(target,`${root}/${name}`)).content);
    exactKeys(envelope,['event','sha256']);const e=envelope.event;
    exactKeys(e,['schema_version','sequence','previous_hash','action','request','request_sha256','at','pins',...extra]);
    if(e.schema_version!==schema||e.sequence!==n+1||e.previous_hash!==(result.at(-1)?.sha256??null)||executionDigest(e)!==envelope.sha256||executionDigest(e.request)!==e.request_sha256||!Number.isFinite(Date.parse(e.at)))fail('event integrity failure');
    validate(e);result.push(envelope);
  }
  return result;
}
export function replayLearningReceipt(events,action,request,fail){
  const prior=events.find(({event:e})=>e.request.task_id===request.task_id&&e.request.operation_id===request.operation_id);
  if(!prior)return null;
  if(prior.event.action!==action||prior.event.request_sha256!==executionDigest(request))fail('operation replay conflict');
  return {...prior,replayed:true,mutation_status:'already-applied'};
}
export async function appendLearningReceipt(target,root,event,{maxBytes=Infinity,fail}={}){
  const envelope={event,sha256:executionDigest(event)},content=formatJson(envelope);
  if(Buffer.byteLength(content)>maxBytes)fail('event exceeds bounded size');
  const dir=await safeDirectory(target,root,{create:true});
  await durableAtomicCreate(path.join(dir,`${String(event.sequence).padStart(6,'0')}.json`),content);
  return {...envelope,replayed:false,mutation_status:'applied'};
}
export async function learningEvidenceProblems(target,pins,field){
  const reasons=[];
  for(const p of pins)try{if((await readTaskFile(target,p.path)).bytes_digest!==p.sha256)reasons.push({code:'stale-evidence',[field]:p.path});}
  catch{reasons.push({code:'unknown-evidence',[field]:p.path});}
  return reasons;
}
