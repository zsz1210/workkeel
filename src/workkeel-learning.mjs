import fs from 'node:fs/promises';
import path from 'node:path';
import {exactKeys, executionDigest} from './workkeel-execution-policy.mjs';
import {assertTaskExecutionContext} from './workkeel-tasks.mjs';
import {readTaskFile} from './task-contract.mjs';
import {safeDirectory} from './workkeel-project.mjs';
import {withProjectMutationLock} from './project.mjs';
import {durableAtomicCreate, formatJson} from './files.mjs';

const ROOT='.ai-org/learning/native', MAX=1000;
const fail=message=>{throw Error(`Native learning: ${message}`);};
const under=(file,root)=>root==='.'||file===root||file.startsWith(`${root}/`);
function text(value,max=4000) {if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))fail('invalid text');}
function id(value) {if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value))fail('invalid identifier');}
function refs(values,{empty=true}={}) {if(!Array.isArray(values)||values.length>32||(!empty&&!values.length)||new Set(values).size!==values.length)fail('invalid bounded references');values.forEach(v=>text(v,1024));}
function recordShape(record) {
  exactKeys(record,['id','kind','title','summary','applicability','exclusions','aliases','derived_from','evidence','skill_refs']);
  id(record.id);if(!['lesson','practice'].includes(record.kind))fail('invalid kind');
  for(const field of ['title','summary','applicability','exclusions'])text(record[field]);
  for(const field of ['aliases','derived_from','evidence','skill_refs'])refs(record[field],{empty:field!=='evidence'});
  record.derived_from.forEach(id);
  if(record.kind==='practice'&&!record.derived_from.length)fail('practice requires a derived lesson or practice');
  if(record.skill_refs.some(ref=>!ref.endsWith('/SKILL.md')))fail('Skill reference must identify SKILL.md');
}
const common=['task_id','actor','claim_id','contract_sha256','operation_id'];
function requestShape(action,r) {
  exactKeys(r,common.concat(action==='capture'?['record']:action==='review'?['learning_id','result','decision','evidence','adopt']:['learning_id','stage','decision','evidence','outcome']));
  id(r.operation_id);id(r.task_id);text(r.claim_id,128);
  if(!/^[a-f0-9]{64}$/.test(r.contract_sha256))fail('contract pin required');
  if(action==='capture')recordShape(r.record);
  else {
    id(r.learning_id);text(r.decision);refs(r.evidence,{empty:action==='use'&&['found','read'].includes(r.stage)});
    if(action==='review'&&(!['confirmed','contradicted','deferred'].includes(r.result)||typeof r.adopt!=='boolean'||r.adopt&&r.result!=='confirmed'))fail('invalid review judgment');
    if(action==='use'&&(!['found','read','applied','outcome'].includes(r.stage)||(r.stage==='outcome'?!['verified','failed','unknown'].includes(r.outcome):r.outcome!==null)))fail('invalid use stage or outcome');
  }
}
async function pins(target,values,env) {
  const result=[];
  for(const ref of values) {
    if(under(ref,ROOT))fail('learning storage cannot be its own evidence');
    if(env&&!env.read_paths.some(root=>under(ref,root)))fail('evidence outside task read scope');
    const file=await readTaskFile(target,ref);if(!file.content.trim())fail('empty evidence');
    result.push({path:ref,sha256:file.bytes_digest});
  }
  return result;
}
async function events(target) {
  let dir;
  try {dir=await safeDirectory(target,ROOT);}catch(error){if(error.code==='ENOENT')return [];throw error;}
  const names=(await fs.readdir(dir)).sort();
  if(names.length>MAX||names.some(name=>!/^\d{6}\.json$/.test(name)))fail('invalid or oversized event inventory');
  const result=[];
  for(const [index,name] of names.entries()) {
    if(name!==`${String(index+1).padStart(6,'0')}.json`)fail('event sequence gap');
    const envelope=JSON.parse((await readTaskFile(target,`${ROOT}/${name}`)).content);
    exactKeys(envelope,['event','sha256']);const e=envelope.event;
    exactKeys(e,['schema_version','sequence','previous_hash','action','request','request_sha256','at','pins']);
    if(e.schema_version!=='workkeel.learning-event/v1'||e.sequence!==index+1||e.previous_hash!==(result.at(-1)?.sha256??null)||executionDigest(e)!==envelope.sha256||executionDigest(e.request)!==e.request_sha256||!['capture','review','use'].includes(e.action)||!Number.isFinite(Date.parse(e.at)))fail('event integrity');
    requestShape(e.action,e.request);
    if(!Array.isArray(e.pins)||e.pins.length>64)fail('invalid evidence pins');
    for(const pin of e.pins){exactKeys(pin,['path','sha256']);text(pin.path,1024);if(!/^[a-f0-9]{64}$/.test(pin.sha256))fail('invalid evidence pin');}
    const expected=e.action==='capture'?[...e.request.record.evidence,...e.request.record.skill_refs]:e.request.evidence;
    if(executionDigest(expected)!==executionDigest(e.pins.map(p=>p.path)))fail('pin references mismatch');
    result.push(envelope);
  }
  return result;
}
async function pinProblems(target,values) {
  const reasons=[];
  for(const pin of values)try {if((await readTaskFile(target,pin.path)).bytes_digest!==pin.sha256)reasons.push({code:'stale-evidence',source:pin.path});}
  catch {reasons.push({code:'unknown-evidence',source:pin.path});}
  return reasons;
}
async function project(target,history) {
  const map=new Map(),uses=[];
  for(const {event:e,sha256} of history) {
    const r=e.request;
    if(e.action==='capture') {
      if(map.has(r.record.id)||r.record.derived_from.some(ref=>!map.has(ref)))fail('duplicate record or unknown/cyclic derivation');
      map.set(r.record.id,{...structuredClone(r.record),source_task:r.task_id,captured_at:e.at,capture_sha256:sha256,review:null,pins:e.pins,reasons:[],eligible:false});
    } else {
      const item=map.get(r.learning_id);if(!item)fail('unknown learning reference');
      if(e.action==='review')item.review={result:r.result,decision:r.decision,adopt:r.adopt,evidence:e.pins,task_id:r.task_id,at:e.at,event_sha256:sha256};
      else uses.push({learning_id:r.learning_id,task_id:r.task_id,stage:r.stage,decision:r.decision,outcome:r.outcome,evidence:e.pins,at:e.at,event_sha256:sha256});
    }
  }
  for(const item of map.values()) {
    // Only an explicit complete source review can replace current source pins.
    const repinned=item.review?.result==='confirmed'&&item.pins.every(pin=>item.review.evidence.some(p=>p.path===pin.path));
    item.current_pins=repinned?item.pins.map(pin=>item.review.evidence.find(p=>p.path===pin.path)):item.pins;
    item.reasons.push(...await pinProblems(target,item.current_pins));
    if(!item.review)item.reasons.push({code:'candidate'});
    else {item.reasons.push(...await pinProblems(target,item.review.evidence));if(item.review.result!=='confirmed')item.reasons.push({code:item.review.result});}
    if(item.kind==='practice'&&!item.review?.adopt)item.reasons.push({code:'not-adopted'});
    // Direct links preserve the cause graph without copying branching subtrees.
    for(const ref of item.derived_from)if(!map.get(ref).eligible)item.reasons.push({code:'ancestor-ineligible',ancestor:ref});
    item.eligible=!item.reasons.length;
    item.status=item.eligible?(item.kind==='practice'?'adopted':'validated'):item.review?.result??'candidate';
    item.effective_state=item.eligible?item.status:item.reasons.some(r=>['stale-evidence','unknown-evidence','ancestor-ineligible'].includes(r.code))?'review-required':item.status;
    const actual=new Set();
    for(const use of uses.filter(u=>u.learning_id===item.id&&u.stage==='applied')) {
      const outcome=uses.filter(u=>u.learning_id===item.id&&u.task_id===use.task_id&&u.stage==='outcome').at(-1);
      if(outcome?.outcome==='verified'&&!(await pinProblems(target,[...use.evidence,...outcome.evidence])).length)actual.add(use.task_id);
    }
    item.promotion={eligible:item.kind==='practice'&&item.eligible&&actual.size>=2,distinct_actual_tasks:actual.size,requires_human_approval:true,skill_activated:false};
  }
  for(const use of uses)use.reasons=await pinProblems(target,use.evidence);
  return {schema_version:'workkeel.learning-view/v1',items:[...map.values()],uses,authority:'observation-only',mutation_status:'no-write',quality_verified:false,
    limitations:['Recorded judgments and use facts are explicit reports, not independent quality acceptance.','No lifecycle acceptance, Skill activation or model call is performed.']};
}
export async function listNativeLearning(target) {return project(target,await events(target));}

async function mutate(target,action,request) {
  requestShape(action,request);
  return withProjectMutationLock(target,async()=>{
    const task=await assertTaskExecutionContext(target,request.task_id,request),env=task.contract.environment;
    if(!task.contract.authorization.operations.includes('write')||!env.write_paths.some(root=>under(ROOT,root)))fail('learning storage outside approved write scope');
    const history=await events(target),digest=executionDigest(request);
    const prior=history.find(({event:e})=>e.request.task_id===request.task_id&&e.request.operation_id===request.operation_id);
    if(prior){if(prior.event.action!==action||prior.event.request_sha256!==digest)fail('operation replay conflict');return {...prior,replayed:true,mutation_status:'already-applied'};}
    if(history.length>=MAX)fail('event inventory limit');
    const view=await project(target,history),r=request;
    if(action==='capture') {
      if(view.items.some(i=>i.id===r.record.id))fail('learning ID already exists');
      if(r.record.derived_from.some(ref=>ref===r.record.id||!view.items.some(i=>i.id===ref)))fail('unknown or cyclic derivation');
    }else {
      const item=view.items.find(i=>i.id===r.learning_id);if(!item)fail('unknown learning ID');
      if(action==='review'&&r.adopt&&item.kind!=='practice')fail('only practices can be adopted');
      if(action==='use') {
        if(['found','read','applied'].includes(r.stage)&&!item.eligible)fail('ineligible guidance');
        const preceding={read:'found',applied:'read',outcome:'applied'}[r.stage];
        if(preceding&&!view.uses.some(u=>u.learning_id===r.learning_id&&u.task_id===r.task_id&&u.stage===preceding))fail('missing explicit preceding use stage');
      }
    }
    const values=action==='capture'?[...r.record.evidence,...r.record.skill_refs]:r.evidence;
    const evidence=await pins(target,values,env);
    const event={schema_version:'workkeel.learning-event/v1',sequence:history.length+1,previous_hash:history.at(-1)?.sha256??null,action,request:structuredClone(request),request_sha256:digest,at:new Date().toISOString(),pins:evidence};
    const envelope={event,sha256:executionDigest(event)},dir=await safeDirectory(target,ROOT,{create:true});
    await durableAtomicCreate(path.join(dir,`${String(event.sequence).padStart(6,'0')}.json`),formatJson(envelope));
    return {...envelope,replayed:false,mutation_status:'applied'};
  });
}
export const captureNativeLearning=(target,request)=>mutate(target,'capture',request);
export const reviewNativeLearning=(target,request)=>mutate(target,'review',request);
export const recordNativeLearningUse=(target,request)=>mutate(target,'use',request);

const normalize=value=>value.normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g,' ').trim();
export async function searchNativeLearning(target,request) {
  exactKeys(request,['query'],['limit']);text(request.query,512);
  const limit=request.limit??5;if(!Number.isInteger(limit)||limit<1||limit>20)fail('invalid search limit');
  const query=normalize(request.query),terms=query.match(/[\p{L}\p{N}_-]+/gu)??[];
  const view=await listNativeLearning(target);
  const items=view.items.filter(i=>i.eligible).map(item=>{
    const phrases=[item.id,item.title,item.summary,...item.aliases].map(normalize),body=phrases.join(' ');
    const aliases=item.aliases.map(normalize).filter(alias=>alias.length>=2&&query.includes(alias));
    const score=aliases.length*10+terms.filter(term=>term.length>=2&&body.includes(term)).length;
    return {...item,score,matched_aliases:aliases};
  }).filter(i=>i.score>0).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,limit);
  return {...view,items,uses:[],query:request.query,semantic:false};
}
export async function nativeLearningImpact(target,request) {
  exactKeys(request,['source']);text(request.source,1024);
  const view=await listNativeLearning(target),affected=new Map();
  for(const item of view.items) {
    const reasons=[];
    if(item.id===request.source)reasons.push({code:'selected-learning',source:request.source});
    if([...item.pins,...(item.review?.evidence??[])].some(p=>p.path===request.source))reasons.push({code:'source-evidence',source:request.source});
    for(const ancestor of item.derived_from)if(affected.has(ancestor))reasons.push({code:'derived-from',ancestor});
    if(reasons.length)affected.set(item.id,{...item,impact_reasons:reasons});
  }
  const items=[...affected.values()];
  return {...view,items,uses:view.uses.filter(u=>affected.has(u.learning_id)),skills:items.flatMap(i=>i.skill_refs.map(ref=>({path:ref,learning_id:i.id,reason:'linked-guidance-requires-review',activation:'not-inferred'}))),historical_acceptance_changed:false};
}
