import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {exactKeys,executionDigest} from './workkeel-execution-policy.mjs';
import {assertTaskExecutionContext,readNativeTask} from './workkeel-tasks.mjs';
import {assertActor,assertApprover,readTaskProject,safeDirectory} from './workkeel-project.mjs';
import {readTaskFile} from './task-contract.mjs';
import {withProjectMutationLock} from './project.mjs';
import {durableAtomicWrite,durableAtomicCreate,formatJson} from './files.mjs';

const ROOT='.ai-org/autonomy',REF=ROOT+'/state.json';
const common=['task_id','actor','claim_id','contract_sha256','operation_id','expected_version'];
const ident=v=>{if(typeof v!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(v))throw Error('Invalid autonomy identifier');};
const integer=(v,min,max)=>{if(!Number.isSafeInteger(v)||v<min||v>max)throw Error('Invalid autonomy limit');};
const text=v=>{if(typeof v!=='string'||!v.trim()||v.length>2000)throw Error('Invalid autonomy text');};
const now=()=>new Date().toISOString(),digest=s=>executionDigest(s);
const under=(file,root)=>root==='.'||file===root||file.startsWith(root+'/');
const scopePath=v=>{text(v);if(v!=='.'&&(/[:\\\x00-\x1f]/.test(v)||v.startsWith('/')||v.split('/').some(p=>!p||p==='.'||p==='..')))throw Error('Invalid normalized discovery scope');};
const costBound=v=>v===null||Number.isFinite(v)&&v>=0&&v<=100000;
const costWithin=(value,limit)=>costBound(value)&&(limit===null||value!==null&&value<=limit);
const localControllers=new Map();
function bounded(values,check,max=32){if(!Array.isArray(values)||values.length>max)throw Error('Invalid bounded autonomy array');for(let n=0;n<values.length;n++){if(!Object.hasOwn(values,n))throw Error('Sparse autonomy array');check(values[n]);}if(new Set(values.map(digest)).size!==values.length)throw Error('Duplicate autonomy value');}
const empty=()=>({schema_version:'workkeel.autonomy/v1',version:0,paused:false,policy:{enabled:false,directions:[],max_jobs:20,max_attempts:2,cooldown_ms:3600000},jobs:[],receipts:[],last_event:null,proposals:[],discovery_runs:[]});
function validateDiscovery(d){
  exactKeys(d,['enabled','read_paths','write_paths','max_proposals','max_source_bytes','max_rounds','cooldown_ms','max_runtime_ms','max_cost_usd']);
  if(typeof d.enabled!=='boolean')throw Error('Invalid discovery policy');bounded(d.read_paths,scopePath);bounded(d.write_paths,scopePath);
  if(d.enabled&&(!d.read_paths.length||!d.write_paths.length))throw Error('Discovery requires explicit scope');
  integer(d.max_proposals,1,200);integer(d.max_source_bytes,1,1024*1024);integer(d.max_rounds,1,100);integer(d.cooldown_ms,0,86400000);integer(d.max_runtime_ms,1,86400000);
  if(!costBound(d.max_cost_usd))throw Error('Invalid discovery cost bound');
}
function validatePolicy(p){
  exactKeys(p,['enabled','directions','max_jobs','max_attempts','cooldown_ms'],['discovery','admission']);
  if(typeof p.enabled!=='boolean')throw Error('Invalid improvement policy');bounded(p.directions,ident,16);if(p.enabled&&!p.directions.length)throw Error('Improvement requires explicit directions');
  integer(p.max_jobs,1,200);integer(p.max_attempts,1,10);integer(p.cooldown_ms,0,86400000);if(p.discovery)validateDiscovery(p.discovery);
  if(p.admission){exactKeys(p.admission,['enabled','goal_id']);if(typeof p.admission.enabled!=='boolean')throw Error('Invalid admission policy');ident(p.admission.goal_id);}
}
function validate(s){
  exactKeys(s,['schema_version','version','paused','policy','jobs','receipts','last_event'],['proposals','discovery_runs']);
  if(s.schema_version!=='workkeel.autonomy/v1'||typeof s.paused!=='boolean')throw Error('Invalid autonomy state');integer(s.version,0,Number.MAX_SAFE_INTEGER);validatePolicy(s.policy);
  s.proposals??=[];s.discovery_runs??=[];
  bounded(s.receipts,r=>{exactKeys(r,['id','sha256'],['task_id']);ident(r.id);if(!/^[a-f0-9]{64}$/.test(r.sha256))throw Error('Invalid autonomy receipt');},1000);
  bounded(s.proposals,p=>{exactKeys(p,['id','direction','task_id','title','evidence','scope','budget','status','line','created_at'],['admission','runtime_evidence','risk_tier','expected_benefit','acceptance','origin_goal_id']);ident(p.id);ident(p.direction);ident(p.task_id);text(p.title);if(p.status!=='proposed')throw Error('Discovery cannot approve a task');bounded(p.evidence,pin=>{exactKeys(pin,['path','sha256']);text(pin.path);if(!/^[a-f0-9]{64}$/.test(pin.sha256))throw Error('Invalid discovery pin');});exactKeys(p.scope,['read_paths','write_paths']);bounded(p.scope.read_paths,scopePath);bounded(p.scope.write_paths,scopePath);exactKeys(p.budget,['max_attempts','max_runtime_ms','max_cost_usd']);integer(p.budget.max_attempts,1,10);integer(p.budget.max_runtime_ms,1,86400000);if(!costBound(p.budget.max_cost_usd))throw Error('Invalid proposal budget');integer(p.line,1,1024*1024);if(!Number.isFinite(Date.parse(p.created_at)))throw Error('Invalid proposal time');if(p.admission!==undefined&&p.admission!=='awaiting-authority')throw Error('Invalid proposal admission state');if(p.risk_tier!==undefined&&!['low','standard','high','critical','unknown'].includes(p.risk_tier))throw Error('Invalid assessed proposal risk');if(p.expected_benefit!==undefined)text(p.expected_benefit);if(p.acceptance!==undefined)bounded(p.acceptance,text);if(p.origin_goal_id!==undefined)ident(p.origin_goal_id);},200);
  bounded(s.discovery_runs,r=>{exactKeys(r,['event_id','fingerprint','at','proposal_ids'],['job_id']);ident(r.event_id);if(!/^[a-f0-9]{64}$/.test(r.fingerprint)||!Number.isFinite(Date.parse(r.at)))throw Error('Invalid discovery receipt');bounded(r.proposal_ids,ident,200);if(r.job_id)ident(r.job_id);},100);
  if(!Array.isArray(s.jobs)||s.jobs.length>200)throw Error('Autonomy storage limit');
  const ids=new Set();for(let n=0;n<s.jobs.length;n++){
    if(!Object.hasOwn(s.jobs,n))throw Error('Sparse autonomy jobs');const j=s.jobs[n];
    exactKeys(j,['id','origin','direction','reason','task_id','request_ref','request_sha256','depends_on','status','attempts','execution_id','updated_at','error','retry_at'],['authority','owner','resume_ref','resume_sha256','resume_requested','cancel_requested','limits','operation_key','proposal_id','request_snapshot','purpose','discovery_policy','runtime_receipt','discovery_error']);
    ident(j.id);ident(j.task_id);text(j.reason);if(ids.has(j.id))throw Error('Duplicate autonomy job');ids.add(j.id);
    if(!['assigned','improvement'].includes(j.origin)||!['queued','running','completed','failed','cancelled','recovery-required','awaiting-acceptance'].includes(j.status))throw Error('Invalid autonomy job state');
    if(j.origin==='improvement')ident(j.direction);else if(j.direction!==null)ident(j.direction);
    bounded(j.depends_on,ident);integer(j.attempts,0,1000);
    if(!/^[a-f0-9]{64}$/.test(j.request_sha256)||!Number.isFinite(Date.parse(j.updated_at))||j.retry_at!==null&&!Number.isFinite(Date.parse(j.retry_at))||j.execution_id!==null&&typeof j.execution_id!=='string')throw Error('Invalid autonomy source');
    j.authority??=null;j.owner??=null;j.resume_ref??=null;j.resume_sha256??=null;j.resume_requested??=false;j.cancel_requested??=false;j.operation_key??=null;j.proposal_id??=null;j.request_snapshot??=null;j.limits??={max_attempts:s.policy.max_attempts,cooldown_ms:s.policy.cooldown_ms};
    if(j.request_snapshot!==null&&(!j.request_snapshot||typeof j.request_snapshot!=='object'||Array.isArray(j.request_snapshot)))throw Error('Invalid frozen workflow request');
    j.purpose??='execution';j.discovery_policy??=null;j.runtime_receipt??=null;j.discovery_error??=null;
    if(!['execution','discovery'].includes(j.purpose))throw Error('Invalid autonomy purpose');if(j.discovery_policy)validateDiscovery(j.discovery_policy);
    if(typeof j.resume_requested!=='boolean'||typeof j.cancel_requested!=='boolean')throw Error('Invalid autonomy control');
    exactKeys(j.limits,['max_attempts','cooldown_ms']);integer(j.limits.max_attempts,1,10);integer(j.limits.cooldown_ms,0,86400000);
    if(j.authority){exactKeys(j.authority,['task_id','actor','claim_id','contract_sha256']);ident(j.authority.task_id);text(j.authority.claim_id);if(!/^[a-f0-9]{64}$/.test(j.authority.contract_sha256))throw Error('Invalid frozen task authority');exactKeys(j.authority.actor,['agent_id','principal_id']);ident(j.authority.actor.agent_id);ident(j.authority.actor.principal_id);}
    if(j.owner){exactKeys(j.owner,['pid','host','token']);integer(j.owner.pid,1,Number.MAX_SAFE_INTEGER);text(j.owner.host);text(j.owner.token);}
    if(j.resume_ref!==null)text(j.resume_ref);if(j.resume_sha256!==null&&!/^[a-f0-9]{64}$/.test(j.resume_sha256))throw Error('Invalid resume pin');
  }
  for(const j of s.jobs)if(j.depends_on.some(id=>!ids.has(id)||id===j.id))throw Error('Unknown autonomy dependency');
  const visiting=new Set(),visited=new Set();function walk(id){if(visiting.has(id))throw Error('Autonomy dependency cycle');if(visited.has(id))return;visiting.add(id);s.jobs.find(j=>j.id===id).depends_on.forEach(walk);visiting.delete(id);visited.add(id);}s.jobs.forEach(j=>walk(j.id));return s;
}
export async function readAutonomy(target){
  // Atomic replacement can race a no-symlink reader's final inode check. Retry
  // that specific observation, never malformed data or a failed integrity check.
  for(let attempt=0;attempt<3;attempt++){
    try{const envelope=JSON.parse((await readTaskFile(target,REF)).content);exactKeys(envelope,['state','sha256']);if(digest(envelope.state)!==envelope.sha256)throw Error('Autonomy state integrity');return structuredClone(validate(envelope.state));}
    catch(e){if(e.code==='ENOENT')return empty();if(e.message==='Contract input changed while reading'&&attempt<2)continue;throw e;}
  }
}
async function save(target,s){validate(s);const dir=await safeDirectory(target,ROOT,{create:true});
  try{if((await readTaskFile(target,ROOT+'/.gitignore')).content!=='*\n')throw Error('Autonomy ignore policy changed');}catch(e){if(e.code!=='ENOENT')throw e;await durableAtomicCreate(path.join(dir,'.gitignore'),'*'+'\n');}
  s.version++;const content=formatJson({state:s,sha256:digest(s)});if(Buffer.byteLength(content)>1024*1024)throw Error('Autonomy state exceeds 1 MiB');await durableAtomicWrite(path.join(dir,'state.json'),content);return structuredClone(s);
}
async function authorize(target,r){const t=await assertTaskExecutionContext(target,r.task_id,r);if(!t.contract.authorization.operations.includes('write')||!t.contract.environment.write_paths.some(p=>under(ROOT,p)))throw Error('Autonomy outside write authority');return t;}
async function authorizeStandingControl(target,action,r,s){
  if(!['policy','pause','resume','event'].includes(action))throw Error('Standing control does not authorize an execution claim');
  const {readNativeGoal,assertNativeGoalAuthority}=await import('./workkeel-goals.mjs'),goal=await readNativeGoal(target,r.goal_id);
  const stopping=action==='pause'||action==='policy'&&(r.policy.enabled===false||r.policy.admission?.enabled===false&&s.policy.admission?.enabled===true);
  await assertNativeGoalAuthority(target,goal,{actor:r.actor,execution:!stopping});
  if(r.task_id!==goal.controller.task_id||r.claim_id!==goal.controller.claim_id||r.contract_sha256!==goal.controller.contract_sha256)throw Error('Standing control requires its exact original authority');
  const task=await readNativeTask(target,r.task_id);if(!task.contract.authorization.operations.includes('write')||!task.contract.environment.write_paths.some(p=>under(ROOT,p)))throw Error('Standing control lacks explicit autonomy metadata scope');
  if(stopping&&action==='policy'){
    if(r.policy.enabled&&!s.policy.enabled||r.policy.admission?.enabled&&!s.policy.admission?.enabled)throw Error('Stopping cannot enable another execution mode');
    const strip=p=>({...p,enabled:false,admission:p.admission?{...p.admission,enabled:false}:undefined});
    if(digest(strip(r.policy))!==digest(strip(s.policy)))throw Error('Stopping cannot rewrite the frozen policy');
  }
  return task;
}
async function admissionPolicy(target,p,actor){
  if(!p.admission?.enabled)return;
  const {readNativeGoal,assertNativeGoalAuthority}=await import('./workkeel-goals.mjs'),{validateGoalAdmissionGrant}=await import('./workkeel-autonomy-admission.mjs');
  const goal=await readNativeGoal(target,p.admission.goal_id);await assertNativeGoalAuthority(target,goal,{actor,execution:true});const g=validateGoalAdmissionGrant(goal.manifest.admission);
  if(!g.enabled||p.directions.some(d=>!g.directions.includes(d))||p.max_attempts>g.max_attempts)throw Error('Policy exceeds the sealed standing admission grant');
  if(p.discovery){const d=p.discovery;if(d.read_paths.some(root=>!g.read_paths.some(base=>under(root,base)))||d.write_paths.some(root=>!g.write_paths.some(base=>under(root,base)))||d.max_rounds>g.max_rounds||d.max_source_bytes>g.max_source_bytes||d.max_runtime_ms>g.max_runtime_ms||!costWithin(d.max_cost_usd,g.max_cost_usd)||d.cooldown_ms<g.cooldown_ms)throw Error('Discovery policy exceeds standing scope or resources');}
}
// Stopping a recorded operation grants no new execution. Its original owner can
// stop it after approval/source drift, expiry or release of the original claim.
async function authorizeStop(target,r,s){
  assertActor((await readTaskProject(target)).policy,r.actor);
  const j=s.jobs.find(j=>j.id===r.job_id);if(!j)throw Error('Unknown job');
  const frozen={task_id:r.task_id,actor:r.actor,claim_id:r.claim_id,contract_sha256:r.contract_sha256};
  if(!j.authority||digest(j.authority)!==digest(frozen))throw Error('Cancellation requires exact original job authority');
  const task=await readNativeTask(target,j.task_id);
  if(task.id!==r.task_id||task.contract_sha256!==r.contract_sha256)throw Error('Cancellation task contract differs from frozen job');
  if(!task.contract.authorization.operations.includes('write')||!task.contract.environment.write_paths.some(p=>under(ROOT,p)))throw Error('Autonomy outside write authority');
  return task;
}
function authority(task){return {task_id:task.id,actor:task.claim.actor,claim_id:task.claim.id,contract_sha256:task.contract_sha256};}
async function readable(target,ref,task,options={}){if(!task.contract.environment.read_paths.some(p=>under(ref,p)))throw Error('Source outside task read authority');return readTaskFile(target,ref,options);}
async function discoveryAuthority(target,task,q,d){
  if(!d?.enabled)throw Error('Qualified discovery disabled');
  if(task.contract.environment.read_paths.some(root=>!d.read_paths.some(p=>under(root,p)))||task.contract.environment.write_paths.some(root=>!d.write_paths.some(p=>under(root,p))))throw Error('Discovery workflow task exceeds explicit scope');
  if(!q.run?.policy_ref)throw Error('Discovery requires a canonical bounded workflow recipe');
  const limits=JSON.parse((await readable(target,q.run.policy_ref,task)).content).limits;
  if(!limits||!Number.isSafeInteger(limits.timeout_ms)||limits.timeout_ms>d.max_runtime_ms||!costWithin(limits.max_cost_usd,d.max_cost_usd))throw Error('Discovery workflow exceeds resource budget');
}
async function consumeDiscovery(target,s,j,result,task){
  const d=j.discovery_policy,report=result.proposal_report;
  if(!report)throw Error('Completed discovery has no structured proposal report');exactKeys(report,['proposals']);bounded(report.proposals,p=>{exactKeys(p,['title','evidence','scope','budget']);text(p.title);bounded(p.evidence,pin=>{exactKeys(pin,['path','sha256']);text(pin.path);if(!/^[a-f0-9]{64}$/.test(pin.sha256))throw Error('Invalid proposal evidence');});if(!p.evidence.length)throw Error('Proposal needs actual evidence');exactKeys(p.scope,['read_paths','write_paths']);bounded(p.scope.read_paths,scopePath);bounded(p.scope.write_paths,scopePath);exactKeys(p.budget,['max_attempts','max_runtime_ms','max_cost_usd']);integer(p.budget.max_attempts,1,j.limits.max_attempts);integer(p.budget.max_runtime_ms,1,d.max_runtime_ms);if(!costWithin(p.budget.max_cost_usd,d.max_cost_usd))throw Error('Proposal exceeds resource budget');},32);
  if(s.proposals.length+report.proposals.length>d.max_proposals)throw Error('Discovery proposal budget');
  const additions=[],observedSources=new Map();let bytes=0;
  for(const p of report.proposals){
    if(p.scope.read_paths.some(root=>!d.read_paths.some(base=>under(root,base)))||p.scope.write_paths.some(root=>!d.write_paths.some(base=>under(root,base))))throw Error('Proposal widens discovery scope');
    for(const pin of p.evidence){
      if(!d.read_paths.some(root=>under(pin.path,root))||under(pin.path,ROOT))throw Error('Proposal evidence outside discovery scope');
      let file=observedSources.get(pin.path);if(!file){file=await readable(target,pin.path,task,{preserveBom:true});observedSources.set(pin.path,file);bytes+=Buffer.byteLength(file.content);if(bytes>d.max_source_bytes)throw Error('Proposal source byte budget');}
      if(file.bytes_digest!==pin.sha256||!file.content.trim())throw Error('Proposal evidence changed or empty');
    }
    const id='improvement-'+digest({execution_id:j.execution_id,title:p.title,evidence:p.evidence}).slice(0,24);
    if(s.proposals.some(old=>old.id===id)||additions.some(old=>old.id===id))continue;
    additions.push({id,direction:j.direction,task_id:j.task_id,title:p.title,evidence:p.evidence,scope:p.scope,budget:p.budget,status:'proposed',line:1,created_at:now(),admission:'awaiting-authority',runtime_evidence:result.source_pins??[]});
  }
  s.proposals.push(...additions);const round=s.discovery_runs.find(r=>r.job_id===j.id);if(round)round.proposal_ids=additions.map(p=>p.id);
}

/** Bounded deterministic marker discovery creates proposals, never inference or approvals. */
async function discover(target,s,task,r){
  const d=s.policy.discovery;
  if(!s.policy.enabled||!d?.enabled||!s.policy.directions.includes(r.direction))throw Error('Improvement discovery disabled or direction unapproved');
  ident(r.event_id);ident(r.direction);bounded(r.source_refs,text,32);if(!r.source_refs.length)throw Error('Discovery requires sources');integer(r.max_results,1,d.max_proposals);
  if(d.read_paths.some(p=>!task.contract.environment.read_paths.some(root=>under(p,root)))||d.write_paths.some(p=>!task.contract.environment.write_paths.some(root=>under(p,root))))throw Error('Discovery policy outside task scope');
  const sources=[];let bytes=0;
  for(const ref of r.source_refs){if(under(ref,ROOT)||!d.read_paths.some(p=>under(ref,p)))throw Error('Discovery source outside explicit scope');const source=await readable(target,ref,task,{preserveBom:true});bytes+=Buffer.byteLength(source.content);if(bytes>d.max_source_bytes)throw Error('Discovery source byte budget');sources.push({path:ref,sha256:source.bytes_digest,content:source.content});}
  const fingerprint=digest({direction:r.direction,sources:sources.map(({path,sha256})=>({path,sha256}))});
  const prior=s.discovery_runs.find(x=>x.event_id===r.event_id);if(prior){if(prior.fingerprint!==fingerprint)throw Error('Discovery event conflict');return [];}
  if(s.discovery_runs.length>=d.max_rounds)throw Error('Discovery round budget');
  if(s.discovery_runs.at(-1)&&Date.now()-Date.parse(s.discovery_runs.at(-1).at)<d.cooldown_ms)throw Error('Discovery cooldown');
  if(s.proposals.length>=d.max_proposals)throw Error('Discovery proposal budget');
  const added=[],deadline=Date.now()+d.max_runtime_ms;
  for(const source of sources){const lines=source.content.split(/\r?\n/);for(let n=0;n<lines.length;n++){
    if(Date.now()>deadline)throw Error('Discovery runtime budget');
    const title=lines[n].match(/(?:^|\s)(?:TODO|FIXME):\s*(\S.*)/)?.[1]?.slice(0,2000);if(!title)continue;
    const id='improvement-'+digest({direction:r.direction,path:source.path,sha256:source.sha256,line:n+1,title}).slice(0,24);
    if(s.proposals.some(p=>p.id===id))continue;
    if(added.length>=r.max_results||s.proposals.length>=d.max_proposals)break;
    const proposal={id,direction:r.direction,task_id:task.id,title,evidence:[{path:source.path,sha256:source.sha256}],scope:{read_paths:structuredClone(d.read_paths),write_paths:structuredClone(d.write_paths)},budget:{max_attempts:s.policy.max_attempts,max_runtime_ms:d.max_runtime_ms,max_cost_usd:d.max_cost_usd},status:'proposed',line:n+1,created_at:now()};s.proposals.push(proposal);added.push(id);
  }}
  s.discovery_runs.push({event_id:r.event_id,fingerprint,at:now(),proposal_ids:added});return added;
}
export async function mutateAutonomy(target,action,r){
  const fields={policy:['policy'],enqueue:['job'],pause:[],resume:[],cancel:['job_id'],event:['event_id'],'resume-job':['job_id','recovery_ref'],discover:['event_id','direction','source_refs','max_results']};
  if(!fields[action])throw Error('Unknown autonomy action');exactKeys(r,[...common,...fields[action]],['goal_id']);ident(r.operation_id);integer(r.expected_version,0,Number.MAX_SAFE_INTEGER);if(r.goal_id)ident(r.goal_id);
  return withProjectMutationLock(target,async()=>{
    const s=await readAutonomy(target),task=action==='cancel'?await authorizeStop(target,r,s):r.goal_id?await authorizeStandingControl(target,action,r,s):await authorize(target,r),hash=digest({action,r});
    const prior=s.receipts.find(x=>x.id===r.operation_id&&(x.task_id??r.task_id)===r.task_id);if(prior){if(prior.sha256!==hash)throw Error('Autonomy operation conflict');return {state:s,replayed:true};}
    if(s.version!==r.expected_version)throw Error('Autonomy version conflict');if(s.receipts.length>=1000)throw Error('Autonomy receipt limit');
    let proposal_ids=[];
    if(action==='policy'){assertApprover((await readTaskProject(target)).policy,r.actor);validatePolicy(r.policy);if(r.policy.enabled)await admissionPolicy(target,r.policy,r.actor);s.policy=structuredClone(r.policy);}
    if(action==='pause')s.paused=true;if(action==='resume')s.paused=false;
    if(action==='event'){ident(r.event_id);s.last_event=r.event_id;}
    if(action==='discover')proposal_ids=await discover(target,s,task,r);
    if(['cancel','resume-job'].includes(action)){
      const j=s.jobs.find(j=>j.id===r.job_id);if(!j)throw Error('Unknown job');if(j.task_id!==task.id)throw Error('Job control requires its own task authority');
      if(action==='cancel'){if(!['completed','cancelled'].includes(j.status)){j.cancel_requested=true;if(j.execution_id===null)j.status='cancelled';j.retry_at=null;}}
      else {if(!['running','recovery-required'].includes(j.status)||j.cancel_requested)throw Error('Only an unresolved uncancelled job can resume');if(j.authority&&digest(j.authority)!==digest(authority(task)))throw Error('Resume cannot rebind an old task claim');const input=await readable(target,r.recovery_ref,task);const control=JSON.parse(input.content);exactKeys(control,[],['approvals','reconciliations']);j.resume_ref=r.recovery_ref;j.resume_sha256=input.bytes_digest;j.resume_requested=true;j.retry_at=null;}
    }
    if(action==='enqueue'){
      const j=r.job;exactKeys(j,['id','origin','direction','reason','task_id','request_ref','depends_on'],['proposal_id','purpose']);ident(j.id);text(j.reason);bounded(j.depends_on,ident);
      if(j.task_id!==task.id)throw Error('Each job requires its own approved task context');
      if(j.depends_on.some(id=>id===j.id||!s.jobs.some(x=>x.id===id)))throw Error('Unknown autonomy dependency');
      if(j.origin==='improvement'&&(!s.policy.enabled||!s.policy.directions.includes(j.direction)))throw Error('Improvement direction disabled');
      if(s.jobs.length>=s.policy.max_jobs||s.jobs.some(x=>x.id===j.id))throw Error('Job limit or duplicate');
      const input=await readable(target,j.request_ref,task);
      if(!task.authority_pins.some(p=>p.path===j.request_ref&&p.sha256===input.bytes_digest))throw Error('Workflow request must be approval-pinned before intake');
      const q=JSON.parse(input.content),operation_key=digest({task_id:task.id,claim_id:task.claim.id,run_id:q.run?.run_id??input.bytes_digest});
      if(s.jobs.some(x=>x.operation_key===operation_key))throw Error('This workflow operation already has an autonomy job');
      if(j.purpose==='discovery'){
        if(j.origin!=='improvement')throw Error('Discovery requires opt-in improvement origin');
        const d=s.policy.discovery;await discoveryAuthority(target,task,q,d);
        if(s.discovery_runs.length>=d.max_rounds||s.proposals.length>=d.max_proposals)throw Error('Discovery round or proposal budget');
        if(s.discovery_runs.some(r=>r.event_id===j.id))throw Error('Discovery event already observed');
        if(s.discovery_runs.at(-1)&&Date.now()-Date.parse(s.discovery_runs.at(-1).at)<d.cooldown_ms)throw Error('Discovery cooldown');
        s.discovery_runs.push({event_id:j.id,fingerprint:input.bytes_digest,at:now(),proposal_ids:[],job_id:j.id});
      }
      let max_attempts=s.policy.max_attempts;
      if(j.proposal_id){
        const p=s.proposals.find(p=>p.id===j.proposal_id);if(j.origin!=='improvement'||!p||p.direction!==j.direction)throw Error('Unknown or mismatched improvement proposal');
        for(const pin of p.evidence)if((await readable(target,pin.path,task)).bytes_digest!==pin.sha256)throw Error('Proposal evidence changed');
        if(task.contract.environment.read_paths.some(root=>!p.scope.read_paths.some(p=>under(root,p)))||task.contract.environment.write_paths.some(root=>!p.scope.write_paths.some(p=>under(root,p))))throw Error('Approved improvement task exceeds proposal scope');
        max_attempts=Math.min(max_attempts,p.budget.max_attempts);
        if(!q.run?.policy_ref)throw Error('Improvement execution requires an explicit bounded workflow policy');
        const limits=JSON.parse((await readable(target,q.run.policy_ref,task)).content).limits;
        if(!limits||!Number.isSafeInteger(limits.timeout_ms)||limits.timeout_ms>p.budget.max_runtime_ms||!costWithin(limits.max_cost_usd,p.budget.max_cost_usd))throw Error('Improvement execution exceeds proposal resource budget');
      }
      s.jobs.push({...structuredClone(j),request_sha256:input.bytes_digest,request_snapshot:structuredClone(q),status:'queued',attempts:0,execution_id:null,updated_at:now(),error:null,retry_at:null,authority:authority(task),owner:null,resume_ref:null,resume_sha256:null,resume_requested:false,cancel_requested:false,limits:{max_attempts,cooldown_ms:s.policy.cooldown_ms},operation_key,proposal_id:j.proposal_id??null,purpose:j.purpose??'execution',discovery_policy:j.purpose==='discovery'?structuredClone(s.policy.discovery):null,runtime_receipt:null,discovery_error:null});
    }
    s.receipts.push({id:r.operation_id,sha256:hash,task_id:r.task_id});const state=await save(target,s);
    if(action==='cancel')localControllers.get(path.resolve(target)+':'+r.job_id)?.abort();
    return {state,replayed:false,proposal_ids,task_created:false,provider_contact:false};
  });
}
export const discoverAutonomyImprovements=(target,request)=>mutateAutonomy(target,'discover',request);
function ownerLive(owner){if(!owner)return false;if(owner.host!==os.hostname())return true;try{process.kill(owner.pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;return true;}}
function host(adapter){if(!adapter||typeof adapter.start!=='function'||typeof adapter.reconcile!=='function'||adapter.idempotent!==true)throw Error('Enforcing idempotent host adapter required');return adapter;}
function resultShape(result){if(!result||!['completed','failed','running','unknown','cancelled','paused'].includes(result.status)||Buffer.byteLength(formatJson(result))>262144)return {status:'unknown',reason:'Invalid or oversized host result; explicit reconciliation required'};return {...result,reason:typeof result.reason==='string'?result.reason.slice(0,500):null};}

/** Persisted process ownership never expires into a second dispatcher. Unknown
 * effects can be observed, but only explicit resume can invoke checkpoints. */
export async function runAutonomyStep(target,{adapter,goalAdapter,clock=Date.now,signal,reconcile_ms=30000,job_id=null}={}){
  host(adapter);integer(reconcile_ms,10,86400000);if(signal?.aborted)return {idle:'aborted',model_called:false};
  const reservation=await withProjectMutationLock(target,async()=>{
    const s=await readAutonomy(target);if(s.paused&&!s.jobs.some(j=>j.cancel_requested&&!['completed','cancelled'].includes(j.status)))return {idle:'paused'};
    let dirty=false;const candidates=[];
    for(const j of s.jobs){
      if(job_id&&j.id!==job_id||['completed','cancelled'].includes(j.status)||j.status==='failed'&&!j.cancel_requested||s.paused&&!j.cancel_requested)continue;
      let task;try{task=await readNativeTask(target,j.task_id);}catch{if(!ownerLive(j.owner)){j.status='recovery-required';j.error='Canonical task unavailable';j.retry_at=new Date(clock()+reconcile_ms).toISOString();dirty=true;}continue;}
      if(j.status==='awaiting-acceptance'){
        if(task.state==='done'){j.status='completed';dirty=true;}else if(task.state==='cancelled'){j.status='cancelled';dirty=true;}continue;
      }
      if(task.state==='cancelled'){j.cancel_requested=true;if(!j.execution_id){j.status='cancelled';dirty=true;continue;}}
      if(j.cancel_requested){if(!j.retry_at||Date.parse(j.retry_at)<=clock())candidates.push({j,task,mode:'cancel',priority:0});continue;}
      if(ownerLive(j.owner))continue;
      if(j.retry_at&&Date.parse(j.retry_at)>clock())continue;
      if(j.purpose==='discovery'&&j.status==='queued'&&(!s.policy.enabled||!s.policy.discovery?.enabled||!s.policy.directions.includes(j.direction))){
        const message='New discovery disabled; awaiting policy authority';if(j.error!==message){j.error=message;dirty=true;}continue;
      }
      if(j.status==='queued'&&j.depends_on.every(id=>s.jobs.find(k=>k.id===id)?.status==='completed'))candidates.push({j,task,mode:'start',priority:1});
      else if(j.resume_requested)candidates.push({j,task,mode:'resume',priority:2});
      else if(['running','recovery-required'].includes(j.status))candidates.push({j,task,mode:'reconcile',priority:3});
    }
    candidates.sort((a,b)=>a.priority-b.priority);
    for(const {j,task,mode} of candidates){
      if(mode!=='cancel'){
        if(mode!=='reconcile'&&(!task.claim||task.state!=='build'))continue;
        if(mode!=='reconcile'){
          const current=authority(task);if(j.authority&&digest(j.authority)!==digest(current)){j.status='recovery-required';j.error='Task claim changed; original operation cannot rebind';j.retry_at=new Date(clock()+reconcile_ms).toISOString();dirty=true;continue;}
          try{await authorize(target,current);}catch{j.status='recovery-required';j.error='Current execution authority unavailable';j.retry_at=new Date(clock()+reconcile_ms).toISOString();dirty=true;continue;}j.authority??=current;
        }
      }
      let input;try{
        if(['cancel','reconcile'].includes(mode)&&j.request_snapshot){
          if(!j.authority||j.authority.task_id!==task.id||j.authority.contract_sha256!==task.contract_sha256)throw Error('Frozen task changed');
          input={content:JSON.stringify(j.request_snapshot)};
        }else{input=await readTaskFile(target,j.request_ref);if(input.bytes_digest!==j.request_sha256)throw Error('changed');}
      }catch{
        j.status='recovery-required';j.error='Pinned workflow request changed or unavailable';j.retry_at=new Date(clock()+reconcile_ms).toISOString();dirty=true;continue;
      }
      if(j.proposal_id&&['start','resume'].includes(mode)){const p=s.proposals.find(p=>p.id===j.proposal_id);let stale=!p;for(const pin of p?.evidence??[])try{if((await readTaskFile(target,pin.path)).bytes_digest!==pin.sha256)stale=true;}catch{stale=true;}if(stale){j.status='recovery-required';j.error='Improvement proposal evidence changed';j.retry_at=new Date(clock()+reconcile_ms).toISOString();dirty=true;continue;}}
      if(mode==='start'){
        if(j.attempts>=j.limits.max_attempts){j.status='failed';dirty=true;continue;}
        j.attempts++;j.execution_id??=randomUUID();j.status='running';
      }
      if(mode==='resume'&&typeof adapter.resume!=='function')throw Error('Host does not support checkpoint resume');
      if(j.purpose==='discovery'&&['start','resume'].includes(mode)&&adapter.discovery!==true)throw Error('Qualified evidence-backed discovery adapter required');
      if(mode==='resume'){if(j.attempts>=j.limits.max_attempts){j.resume_requested=false;j.status='recovery-required';j.error='Resume attempt budget exhausted';dirty=true;continue;}j.attempts++;}
      let recovery={};if(mode==='resume'&&j.resume_ref){const value=await readTaskFile(target,j.resume_ref);if(value.bytes_digest!==j.resume_sha256)throw Error('Resume source changed');recovery=JSON.parse(value.content);exactKeys(recovery,[],['approvals','reconciliations']);}
      const token=randomUUID();if(mode!=='cancel')j.owner={pid:process.pid,host:os.hostname(),token};
      j.updated_at=now();j.retry_at=new Date(clock()+reconcile_ms).toISOString();await save(target,s);
      return {job:structuredClone(j),request:JSON.parse(input.content),task,recovery,recover:mode==='reconcile',mode,token,version:s.version};
    }
    if(dirty)await save(target,s);return {idle:dirty?'canonical-task-reconciled':'waiting-for-event-or-dependency'};
  });
  if(reservation.idle){
    if(job_id||reservation.idle==='paused')return {...reservation,model_called:false};
    const {runImprovementCycle}=await import('./workkeel-improvement-cycle.mjs');
    const improvement=await runImprovementCycle(target,{adapter:goalAdapter,signal});
    return improvement.idle==='improvement-disabled'?{...reservation,model_called:false}:improvement;
  }
  const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const controllerKey=path.resolve(target)+':'+reservation.job.id;if(reservation.mode!=='cancel')localControllers.set(controllerKey,controller);
  let result;
  try{
    if(reservation.mode==='cancel'&&typeof adapter.cancel!=='function')result={status:'unknown',reason:'Host cancellation capability unavailable'};
    else result=resultShape(await adapter[reservation.mode](reservation,{signal:controller.signal}));
  }catch{result={status:'unknown',reason:'Host operation stopped; inspect exact host evidence before recovery'};}
  finally{signal?.removeEventListener('abort',abort);if(localControllers.get(controllerKey)===controller)localControllers.delete(controllerKey);}
  return withProjectMutationLock(target,async()=>{
    const s=await readAutonomy(target),j=s.jobs.find(j=>j.id===reservation.job.id);
    if(!j||j.execution_id!==reservation.job.execution_id)throw Error('Autonomy reservation changed');
    if(reservation.mode!=='cancel'&&j.owner?.token!==reservation.token)throw Error('Autonomy runner ownership changed');
    if(reservation.mode!=='cancel')j.owner=null;
    j.updated_at=now();j.error=result.reason??null;
    j.runtime_receipt={status:result.status,run_id:result.run_id??null,usage:result.usage??null,source_pins:result.source_pins??[]};
    if(reservation.mode==='cancel'&&result.status!=='cancelled'&&result.status!=='completed'){j.retry_at=new Date(clock()+reconcile_ms).toISOString();await save(target,s);return {job:structuredClone(j),runtime_result:result,cancellation:'requested-not-confirmed',model_called:false,acceptance:'not-accepted'};}
    if(j.status==='cancelled'&&j.cancel_requested){j.retry_at=null;}
    else if(result.status==='completed'){
      j.status=(await readNativeTask(target,j.task_id)).state==='done'?'completed':'awaiting-acceptance';j.retry_at=null;
      if(j.purpose==='discovery')try{await consumeDiscovery(target,s,j,result,reservation.task);j.discovery_error=null;}catch(e){j.discovery_error=e.message.slice(0,500);}
    }
    else if(result.status==='failed'){j.status=j.attempts<j.limits.max_attempts?'queued':'failed';j.retry_at=new Date(clock()+j.limits.cooldown_ms).toISOString();}
    else if(result.status==='cancelled'){j.status='cancelled';j.retry_at=null;}
    else {j.status='recovery-required';j.retry_at=new Date(clock()+reconcile_ms).toISOString();}
    if(reservation.mode==='resume')j.resume_requested=false;
    await save(target,s);return {job:structuredClone(j),runtime_result:result,acceptance:j.status==='completed'?'canonical-task-accepted':'not-accepted',model_called:['start','resume'].includes(reservation.mode)?'host-dependent':false,cancellation:result.status==='cancelled'?'host-confirmed':null};
  });
}
export async function cancelAutonomyJob(target,request,{adapter}={}){
  host(adapter);const mutation=await mutateAutonomy(target,'cancel',request);
  const job=mutation.state.jobs.find(j=>j.id===request.job_id);if(job.status==='cancelled'&&!job.execution_id)return {...mutation,cancellation:'cancelled-before-dispatch'};
  if(job.status==='awaiting-acceptance')return {...mutation,job,cancellation:'runtime-already-completed',acceptance:'not-accepted',model_called:false};
  return runAutonomyStep(target,{adapter,job_id:request.job_id});
}

/** Timers only reconcile local state or dispatch approved queued operations.
 * Discovery requires an explicit bounded event and never runs on this timer. */
export async function serveAutonomy(target,{adapter,goalAdapter,signal,onError=()=>{},debounce_ms=100,reconcile_ms=30000,watchFactory=null,onStep=()=>{}}={}){
  host(adapter);integer(debounce_ms,0,10000);integer(reconcile_ms,10,60000);await safeDirectory(target,ROOT,{create:true});
  let working=false,pending=false,timer=null,retryTimer=null,closed=false;
  const signature=s=>digest({paused:s.paused,policy:s.policy,event:s.last_event,receipts:s.receipts.at(-1)??null,jobs:s.jobs.map(j=>({id:j.id,request:j.request_sha256,depends_on:j.depends_on,resume:j.resume_ref}))});
  let last=signature(await readAutonomy(target));
  const trigger=()=>{if(timer||closed||signal?.aborted)return;timer=setTimeout(()=>{timer=null;void tick();},debounce_ms);};
  const schedule=async progressed=>{
    if(retryTimer)clearTimeout(retryTimer);retryTimer=null;if(closed||signal?.aborted)return;
    const s=await readAutonomy(target);last=signature(s);if(s.paused)return;
    const due=s.jobs.filter(j=>!['completed','failed','cancelled','awaiting-acceptance'].includes(j.status)&&!ownerLive(j.owner)&&(j.status!=='queued'||j.depends_on.every(id=>s.jobs.find(k=>k.id===id)?.status==='completed'))).map(j=>j.retry_at?Date.parse(j.retry_at):Date.now());
    if(progressed&&s.policy.enabled&&s.policy.admission?.enabled)due.push(Date.now());
    if(due.length){const delay=Math.max(progressed?1:reconcile_ms,Math.min(...due)-Date.now());retryTimer=setTimeout(trigger,Math.min(delay,2147483647));}
  };
  const tick=async()=>{if(closed||signal?.aborted)return;if(working){pending=true;return;}working=true;
    let progressed=false;try{const result=await runAutonomyStep(target,{adapter,goalAdapter,signal,reconcile_ms});progressed=!!result.job||result.progressed===true;await onStep(result);}catch(e){onError(e);}finally{working=false;try{await schedule(progressed);}catch(e){onError(e);}if(pending){pending=false;trigger();}}};
  const changed=async()=>{try{const next=signature(await readAutonomy(target));if(next!==last){last=next;trigger();}}catch(e){onError(e);}};
  const watchers=[],watch=watchFactory??(await import('node:fs')).watch;
  for(const ref of [ROOT,'.ai-org/work-items'])try{watchers.push(watch(path.join(target,ref),ref===ROOT?()=>void changed():trigger));}catch(e){if(e.code!=='ENOENT')throw e;}
  const interval=setInterval(trigger,reconcile_ms);
  const close=()=>{if(closed)return;closed=true;if(timer)clearTimeout(timer);if(retryTimer)clearTimeout(retryTimer);clearInterval(interval);watchers.forEach(w=>w.close());signal?.removeEventListener('abort',close);};
  signal?.addEventListener('abort',close,{once:true});if(signal?.aborted)close();else trigger();return {close,trigger};
}

/** Only import proposals from a currently accepted, source-pinned discovery
 * component. A caller-supplied report is never an admission authority. */
export async function recordGoalDiscovery(target,{goal_root,goal_id}){
  const {readNativeGoal}=await import('./workkeel-goals.mjs'),goal=await readNativeGoal(goal_root,goal_id);
  if(!goal.accepted)return {recorded:0};
  return withProjectMutationLock(target,async()=>{
    const s=await readAutonomy(target);let recorded=0;
    if(goal.completed_discovery_reports.reduce((n,r)=>n+r.proposal_report.proposals.length,0)>(s.policy.discovery?.max_proposals??32))throw Error('Discovery exceeded the configured proposal bound');
    for(const report of goal.completed_discovery_reports)for(const proposal of report.proposal_report.proposals){
      exactKeys(proposal,['id','title','direction','risk_tier','expected_benefit','acceptance','evidence','scope','budget']);
      const candidate={...structuredClone(proposal),id:'proposal-'+digest({goal_id,proposal_id:proposal.id}).slice(0,24),task_id:report.task_id,status:'proposed',line:1,created_at:now(),admission:'awaiting-authority',origin_goal_id:goal_id,runtime_evidence:[report.report_pin,...report.source_pins]};
      if(s.proposals.some(p=>p.id===candidate.id))continue;
      if(s.proposals.length>=200)throw Error('Discovery proposal inventory exhausted');s.proposals.push(candidate);recorded++;
    }
    if(recorded){validate(s);await save(target,s);}return {recorded};
  });
}
