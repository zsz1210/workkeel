import path from 'node:path';
import {exactKeys,executionDigest} from './workkeel-execution-policy.mjs';
import {assertTaskExecutionContext,readNativeTask} from './workkeel-tasks.mjs';
import {assertActor,assertApprover,readTaskProject,safeDirectory} from './workkeel-project.mjs';
import {readTaskFile} from './task-contract.mjs';
import {withProjectMutationLock} from './workkeel-lock.mjs';
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
  const {readNativeGoal,assertNativeGoalAuthority}=await import('./workkeel-goals.mjs'),{readGoalAdmissionAuthority}=await import('./workkeel-autonomy-admission.mjs');
  const goal=await readNativeGoal(target,p.admission.goal_id);await assertNativeGoalAuthority(target,goal,{actor,execution:true});const {grant:g}=await readGoalAdmissionAuthority(target,goal);
  if(!g.enabled||p.directions.some(d=>!g.directions.includes(d))||p.max_attempts>g.max_attempts)throw Error('Policy exceeds the sealed standing admission grant');
  if(p.discovery){const d=p.discovery;if(d.read_paths.some(root=>!g.read_paths.some(base=>under(root,base)))||d.write_paths.some(root=>!g.write_paths.some(base=>under(root,base)))||d.max_rounds>g.max_rounds||d.max_source_bytes>g.max_source_bytes||d.max_runtime_ms>g.max_runtime_ms||!costWithin(d.max_cost_usd,g.max_cost_usd)||d.cooldown_ms<g.cooldown_ms)throw Error('Discovery policy exceeds standing scope or resources');}
}
export async function mutateAutonomy(target,action,r){
  const fields={policy:['policy'],pause:[],resume:[],event:['event_id']};
  if(['enqueue','cancel','resume-job','discover'].includes(action))throw Error('Autonomy jobs and marker discovery are retired; use goal delivery and goal controls');
  if(!fields[action])throw Error('Unknown autonomy action');exactKeys(r,[...common,...fields[action]],['goal_id']);ident(r.operation_id);integer(r.expected_version,0,Number.MAX_SAFE_INTEGER);if(r.goal_id)ident(r.goal_id);
  return withProjectMutationLock(target,async()=>{
    const s=await readAutonomy(target);r.goal_id?await authorizeStandingControl(target,action,r,s):await authorize(target,r);const hash=digest({action,r});
    const prior=s.receipts.find(x=>x.id===r.operation_id&&(x.task_id??r.task_id)===r.task_id);if(prior){if(prior.sha256!==hash)throw Error('Autonomy operation conflict');return {state:s,replayed:true};}
    if(s.version!==r.expected_version)throw Error('Autonomy version conflict');if(s.receipts.length>=1000)throw Error('Autonomy receipt limit');
    if(action==='policy'){assertApprover((await readTaskProject(target)).policy,r.actor);validatePolicy(r.policy);if(r.policy.enabled)await admissionPolicy(target,r.policy,r.actor);s.policy=structuredClone(r.policy);}
    if(action==='pause')s.paused=true;if(action==='resume')s.paused=false;
    if(action==='event'){ident(r.event_id);s.last_event=r.event_id;}
    s.receipts.push({id:r.operation_id,sha256:hash,task_id:r.task_id});const state=await save(target,s);
    return {state,replayed:false,task_created:false,provider_contact:false};
  });
}
/** Autonomy selects bounded work; goals own every delivery operation. Legacy
 * jobs with possibly live executions require reconciliation first. */
export async function runAutonomyStep(target,{goalAdapter,signal}={}){
  if(signal?.aborted)return {idle:'aborted',model_called:false};
  const s=await readAutonomy(target);
  if(s.paused)return {idle:'paused',model_called:false};
  if(s.jobs.some(j=>['running','recovery-required'].includes(j.status)&&j.execution_id!==null))throw Error('Legacy autonomy executions require reconciliation with their original runner: the CLI from before b7dd85b2..f3f97d97, using autonomy tick/cancel, before goal delivery');
  const {runImprovementCycle}=await import('./workkeel-improvement-cycle.mjs');
  return runImprovementCycle(target,{adapter:goalAdapter,signal});
}

/** Timers observe approved sources and advance their derived goals. Unchanged
 * sources and idle observations never initiate speculative model calls. */
export async function serveAutonomy(target,{goalAdapter,signal,onError=()=>{},debounce_ms=100,reconcile_ms=30000,watchFactory=null,onStep=()=>{}}={}){
  integer(debounce_ms,0,10000);integer(reconcile_ms,10,60000);await safeDirectory(target,ROOT,{create:true});
  let working=false,pending=false,timer=null,retryTimer=null,closed=false,startedAt=null;
  const signature=s=>digest({paused:s.paused,policy:s.policy,event:s.last_event,receipts:s.receipts.at(-1)??null});
  let last=signature(await readAutonomy(target));
  const trigger=()=>{if(timer||closed||signal?.aborted)return;timer=setTimeout(()=>{timer=null;void tick();},debounce_ms);};
  const schedule=async progressed=>{
    if(retryTimer)clearTimeout(retryTimer);retryTimer=null;if(closed||signal?.aborted)return;
    const s=await readAutonomy(target);last=signature(s);if(s.paused)return;
    if(progressed&&s.policy.enabled&&s.policy.admission?.enabled)retryTimer=setTimeout(trigger,1);
  };
  const tick=async()=>{if(closed||signal?.aborted)return;if(working){pending=true;return;}working=true;startedAt=now();
    let progressed=false;try{const result=await runAutonomyStep(target,{goalAdapter,signal});progressed=result.progressed===true;await onStep(result);}catch(e){onError(e);}finally{working=false;try{await schedule(progressed);}catch(e){onError(e);}if(pending){pending=false;trigger();}}};
  const changed=async()=>{try{const next=signature(await readAutonomy(target));if(next!==last){last=next;trigger();}}catch(e){onError(e);}};
  const watchers=[],watch=watchFactory??(await import('node:fs')).watch;
  for(const ref of [ROOT,'.ai-org/work-items'])try{watchers.push(watch(path.join(target,ref),ref===ROOT?()=>void changed():trigger));}catch(e){if(e.code!=='ENOENT')throw e;}
  const interval=setInterval(trigger,reconcile_ms);
  const close=()=>{if(closed)return;closed=true;if(timer)clearTimeout(timer);if(retryTimer)clearTimeout(retryTimer);clearInterval(interval);watchers.forEach(w=>w.close());signal?.removeEventListener('abort',close);};
  signal?.addEventListener('abort',close,{once:true});if(signal?.aborted)close();else trigger();return {close,trigger,observe:()=>({state:closed?'stopped':working?'checking':'listening',started_at:working?startedAt:null,reconcile_ms})};
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
