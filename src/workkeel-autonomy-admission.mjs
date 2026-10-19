import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {exactKeys,executionDigest} from './workkeel-execution-policy.mjs';
import {loadTaskRequirements} from './workkeel-requirements.mjs';
import {readTaskFile,validateTaskContract} from './task-contract.mjs';
import {checkEvidencePin} from './workkeel-evidence-file.mjs';
import {readNativeTask,createNativeTask,mutateNativeTask,assertTaskExecutionContext,evidenceStatus} from './workkeel-tasks.mjs';
import {assertActor,assertApprover,readTaskProject,readNativeGit,safeDirectory} from './workkeel-project.mjs';
import {withProjectMutationLock} from './workkeel-lock.mjs';
import {durableAtomicCreate,durableAtomicWrite,formatJson,sha256} from './files.mjs';

const ROOT='.ai-org/autonomy/admissions',STATE=ROOT+'/state.json';
const fail=m=>{throw Error('Goal admission: '+m);};
const under=(p,r)=>r==='.'||p===r||p.startsWith(r+'/');
const sameActor=(a,b)=>a?.agent_id===b?.agent_id&&a?.principal_id===b?.principal_id;
const id=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(v))fail('invalid identifier');};
const pin=v=>{if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))fail('invalid digest');};
const integer=(v,min,max)=>{if(!Number.isSafeInteger(v)||v<min||v>max)fail('invalid resource bound');};
const bounded=(a,check,min=0,max=32)=>{if(!Array.isArray(a)||a.length<min||a.length>max)fail('invalid bounded array');for(let n=0;n<a.length;n++){if(!Object.hasOwn(a,n))fail('sparse array');check(a[n]);}if(new Set(a.map(executionDigest)).size!==a.length)fail('duplicate entry');};
const relative=v=>{if(typeof v!=='string'||!v||v.length>1024||v!=='.'&&(v.startsWith('/')||/[:\\\x00-\x1f]/.test(v)||v.split('/').some(p=>!p||p==='.'||p==='..')))fail('invalid relative path');};
const text=v=>{if(typeof v!=='string'||!v.trim()||v.length>4000)fail('invalid bounded text');};
const cost=v=>v===null||Number.isFinite(v)&&v>=0&&v<=100000;
const withinCost=(v,max)=>cost(v)&&(max===null||v!==null&&v<=max);
const current=()=>new Date().toISOString();
const limitFields=['max_rounds','max_goals','max_total_operations','max_total_runtime_ms'];
const limits=g=>Object.fromEntries(limitFields.map(k=>[k,g[k]]));
function extensionRequest(r){exactKeys(r,['operation_id','expected_version','actor','task_id','claim_id','contract_sha256','approval_ref']);id(r.operation_id);integer(r.expected_version,0,1000);exactKeys(r.actor,['agent_id','principal_id']);id(r.actor.agent_id);id(r.actor.principal_id);id(r.task_id);id(r.claim_id);pin(r.contract_sha256);relative(r.approval_ref);}
function extensionApproval(a){exactKeys(a,['schema_version','goal_id','manifest_sha256','from','to','reevaluate_unchanged_sources','reason']);if(a.schema_version!=='workkeel.admission-extension/v1')fail('invalid extension approval');id(a.goal_id);pin(a.manifest_sha256);text(a.reason);if(typeof a.reevaluate_unchanged_sources!=='boolean')fail('explicit reevaluation decision required');for(const p of [a.from,a.to]){exactKeys(p,limitFields);for(const v of Object.values(p))integer(v,1,86400000);}if(a.to.max_rounds<=a.from.max_rounds||limitFields.some(k=>a.to[k]<a.from[k]))fail('extension must increase rounds without reducing cumulative ceilings');}
function extensionRecord(e){exactKeys(e,['request','request_sha256','approval','approval_sha256','policy_sha256','created_at']);extensionRequest(e.request);extensionApproval(e.approval);for(const k of ['request_sha256','approval_sha256','policy_sha256'])pin(e[k]);if(executionDigest(e.request)!==e.request_sha256||!Number.isFinite(Date.parse(e.created_at)))fail('invalid extension record');}

export function validateGoalAdmissionGrant(g){
  exactKeys(g,['enabled','directions','read_paths','write_paths','template_ref','source_refs','max_source_bytes','max_rounds','cooldown_ms','max_goals','max_total_operations','max_total_runtime_ms','max_total_cost_usd','max_reworks','max_operations','max_attempts','max_runtime_ms','max_cost_usd']);
  if(typeof g.enabled!=='boolean')fail('invalid enabled state');bounded(g.directions,id,1,16);bounded(g.read_paths,relative,1);bounded(g.write_paths,relative,1);relative(g.template_ref);bounded(g.source_refs,relative,1);integer(g.max_source_bytes,1,1048576);integer(g.max_rounds,1,100);integer(g.cooldown_ms,0,86400000);
  integer(g.max_goals,1,100);integer(g.max_total_operations,1,10000);integer(g.max_total_runtime_ms,1,86400000);integer(g.max_reworks,0,10);integer(g.max_operations,1,Math.min(1000,g.max_total_operations));integer(g.max_attempts,1,10);integer(g.max_runtime_ms,1,g.max_total_runtime_ms);
  if(!cost(g.max_total_cost_usd)||!withinCost(g.max_cost_usd,g.max_total_cost_usd))fail('financial limit exceeds standing grant');
  if(g.source_refs.some(ref=>!g.read_paths.some(root=>under(ref,root))))fail('trigger sources exceed standing scope');return g;
}
const empty=()=>({schema_version:'workkeel.goal-admissions/v1',version:0,entries:[],receipts:[]});
function validateStore(s){
  exactKeys(s,['schema_version','version','entries','receipts'],['extensions']);if(s.schema_version!=='workkeel.goal-admissions/v1')fail('invalid journal');integer(s.version,0,1000);
  if(s.extensions!==undefined){bounded(s.extensions,extensionRecord,0,32);if(new Set(s.extensions.map(e=>e.request.operation_id)).size!==s.extensions.length)fail('duplicate extension operation');}
  bounded(s.entries,e=>{exactKeys(e,['id','goal_id','kind','proposal_id','problem_sha256','input_sha256','source_manifest_sha256','status','reservation','intent','owner','updated_at','error']);id(e.id);id(e.goal_id);id(e.proposal_id);pin(e.problem_sha256);pin(e.input_sha256);pin(e.source_manifest_sha256);if(!['discovery','execution'].includes(e.kind)||!['reserved','created','recovery-required'].includes(e.status))fail('invalid admission status');exactKeys(e.reservation,['operations','max_runtime_ms','max_cost_usd']);integer(e.reservation.operations,1,10000);integer(e.reservation.max_runtime_ms,1,86400000);if(!cost(e.reservation.max_cost_usd))fail('invalid reservation');if(!e.intent||typeof e.intent!=='object'||Array.isArray(e.intent))fail('invalid frozen intake intent');if(e.owner){exactKeys(e.owner,['pid','host','token']);integer(e.owner.pid,1,Number.MAX_SAFE_INTEGER);text(e.owner.host);text(e.owner.token);}if(!Number.isFinite(Date.parse(e.updated_at)))fail('invalid admission timestamp');},0,200);
  bounded(s.receipts,r=>{exactKeys(r,['operation_id','input_sha256','admission_id']);id(r.operation_id);id(r.admission_id);pin(r.input_sha256);},0,1000);return s;
}
export async function readGoalAdmissions(target){
  try{const e=JSON.parse((await readTaskFile(target,STATE)).content);exactKeys(e,['state','sha256']);if(executionDigest(e.state)!==e.sha256)fail('journal integrity');return structuredClone(validateStore(e.state));}
  catch(e){if(e.code==='ENOENT')return empty();throw e;}
}
async function save(target,s){
  s.version++;validateStore(s);const content=formatJson({state:s,sha256:executionDigest(s)});if(Buffer.byteLength(content)>1048576)fail('journal capacity');const directory=await safeDirectory(target,ROOT,{create:true});
  try{if((await readTaskFile(target,ROOT+'/.gitignore')).content!=='*\n')fail('private ignore policy changed');}catch(e){if(e.code!=='ENOENT')throw e;await durableAtomicCreate(path.join(directory,'.gitignore'),'*\n');}
  await durableAtomicWrite(path.join(directory,'state.json'),content);return s;
}
async function immutable(target,ref,content){
  relative(ref);const directory=await safeDirectory(target,path.posix.dirname(ref),{create:true});
  try{await durableAtomicCreate(path.join(directory,path.posix.basename(ref)),content);}catch(e){if(e.code!=='EEXIST')throw e;if((await readTaskFile(target,ref,{preserveBom:true})).content!==content)fail('frozen intake artifact conflict');}
}
/** Extra capacity is a separate pinned human authorization, never a rewritten
 * manifest or refunded reservation. Closed setup tasks retain their approval. */
export async function readGoalAdmissionAuthority(target,goal,{journal}={}){
  const goalId=goal.id,{assertNativeGoalAuthority}=await import('./workkeel-goals.mjs');goal=await assertNativeGoalAuthority(target,goalId,{execution:true});
  const original=validateGoalAdmissionGrant(goal.manifest.admission),s=journal??await readGoalAdmissions(target),project=await readTaskProject(target);
  let grant=structuredClone(original),extension_sha256=null,continuation_sha256=null;const authorizations=[];
  for(const e of (s.extensions??[]).filter(e=>e.approval.goal_id===goal.id)){
    const r=e.request,a=e.approval,t=await readNativeTask(target,r.task_id);assertActor(project.policy,r.actor);assertApprover(project.policy,r.actor);
    if(!sameActor(r.actor,goal.manifest.roles.approver)||a.manifest_sha256!==goal.manifest_sha256||t.contract_sha256!==r.contract_sha256||t.policy_sha256!==e.policy_sha256||e.policy_sha256!==executionDigest(project.policy)||t.state==='cancelled'||t.contract.authorization.expires_at&&Date.parse(t.contract.authorization.expires_at)<=Date.now())fail('extension authority changed or expired');
    for(const p of t.authority_pins)if((await readTaskFile(target,p.path)).digest!==p.sha256)fail('extension approval source changed');
    const approved=await readTaskFile(target,r.approval_ref);
    if(!t.authority_pins.some(p=>p.path===r.approval_ref&&p.sha256===approved.digest)||approved.bytes_digest!==e.approval_sha256||executionDigest(JSON.parse(approved.content))!==executionDigest(a))fail('extension requires exact pinned approval');
    if(executionDigest(a.from)!==executionDigest(limits(grant)))fail('extension prior limits differ');
    grant=validateGoalAdmissionGrant({...grant,...a.to});extension_sha256=executionDigest(e);authorizations.push({sha256:extension_sha256,reevaluation:a.reevaluate_unchanged_sources});
    if(a.reevaluate_unchanged_sources)continuation_sha256=extension_sha256;
  }
  return {grant,extension_sha256,continuation_sha256,authorizations};
}
export async function extendGoalAdmission(target,input){
  extensionRequest(input);const r=structuredClone(input),hash=executionDigest(r);
  return withProjectMutationLock(target,async()=>{
    const s=await readGoalAdmissions(target),{readNativeGoal,assertNativeGoalAuthority}=await import('./workkeel-goals.mjs');
    const approvalFile=await readTaskFile(target,r.approval_ref),approval=JSON.parse(approvalFile.content);extensionApproval(approval);
    const goal=await readNativeGoal(target,approval.goal_id);await assertNativeGoalAuthority(target,goal,{actor:r.actor,execution:true});
    if(goal.manifest.derived_from)fail('extend the original standing source goal');
    const authority=await readGoalAdmissionAuthority(target,goal,{journal:s}),prior=(s.extensions??[]).find(e=>e.request.operation_id===r.operation_id);
    if(prior){if(prior.request_sha256!==hash||prior.approval_sha256!==approvalFile.bytes_digest)fail('extension replay conflict');return {version:s.version,...authority,replayed:true};}
    if(s.version!==r.expected_version)fail('extension journal version conflict');
    const task=await assertTaskExecutionContext(target,r.task_id,r),project=await readTaskProject(target);assertApprover(project.policy,r.actor);
    if(!task.contract.environment.write_paths.some(p=>under(ROOT,p))||!task.contract.environment.read_paths.some(p=>under(r.approval_ref,p))||!task.contract.authorization.operations.includes('write'))fail('extension requires admission metadata write scope');
    if(!task.authority_pins.some(p=>p.path===r.approval_ref&&p.sha256===approvalFile.digest))fail('extension approval must be task-authority pinned');
    if(approval.manifest_sha256!==goal.manifest_sha256||executionDigest(approval.from)!==executionDigest(limits(authority.grant)))fail('extension prior limits or manifest differ');
    validateGoalAdmissionGrant({...authority.grant,...approval.to});
    s.extensions??=[];s.extensions.push({request:r,request_sha256:hash,approval,approval_sha256:approvalFile.bytes_digest,policy_sha256:executionDigest(project.policy),created_at:current()});await save(target,s);
    return {version:s.version,...await readGoalAdmissionAuthority(target,goal,{journal:s}),replayed:false};
  });
}
function alive(owner){if(!owner)return false;if(owner.host!==os.hostname())return true;try{process.kill(owner.pid,0);return true;}catch(e){return e.code!=='ESRCH';}}

async function source(target,request){
  const goals=await import('./workkeel-goals.mjs'),goal=await goals.readNativeGoal(target,request.goal_id);
  await goals.assertNativeGoalAuthority(target,goal,{actor:request.actor,execution:true});
  const authority=await readGoalAdmissionAuthority(target,goal),grant=authority.grant;if(!grant.enabled)fail('standing admission is disabled');
  // Subsequent approved improvements can change an interface at HEAD. Preserve
  // the original accepted baseline; never relabel it as current acceptance.
  if(!goal.accepted&&!(goal.state==='done'&&goal.integration))fail('complete the source goal before autonomous improvement');
  if(goal.integration){
    for(const p of goal.integration.pins)if((await readTaskFile(target,p.path)).bytes_digest!==p.sha256)fail('historical whole acceptance evidence changed');
    for(const fact of goal.integration.components){const actual=await readNativeTask(fact.root,fact.task_id);if(executionDigest(actual)!==fact.task_sha256||actual.state!=='done'||actual.review?.judgment!=='pass')fail('historical accepted component changed');for(const p of fact.evidence)if(await evidenceStatus(fact.root,fact.revision,p)==='unavailable')fail('historical review evidence is unavailable');}
  }
  const controller=await readNativeTask(target,goal.controller.task_id),templateFile=await readTaskFile(target,grant.template_ref);
  if(!controller.authority_pins.some(p=>p.path===grant.template_ref&&p.sha256===templateFile.digest))fail('template must be standing-authority pinned');
  const template=JSON.parse(templateFile.content);exactKeys(template,['schema_version','id','source_component_id','title_prefix','acceptance','include','exclude']);
  if(template.schema_version!=='workkeel.improvement-template/v1')fail('invalid task template');id(template.id);id(template.source_component_id);text(template.title_prefix);bounded(template.acceptance,text,1);bounded(template.include,text,1);bounded(template.exclude,text);
  const component=goal.manifest.components.find(c=>c.id===template.source_component_id);if(!component)fail('template source is outside the approved goal');
  const task=await readNativeTask(component.root,component.task_id),project=await readTaskProject(component.root);
  if(task.contract_sha256!==component.contract_sha256||task.policy_sha256!==executionDigest(project.policy))fail('source component authority changed');
  assertActor(project.policy,goal.manifest.roles.implementer);assertApprover(project.policy,request.actor);
  if(!sameActor(task.contract.actor,goal.manifest.roles.implementer))fail('template implementer differs from source task');
  if(task.contract.authorization.expires_at&&Date.parse(task.contract.authorization.expires_at)<=Date.now()||task.state==='cancelled')fail('source task authority expired or cancelled');
  for(const p of task.authority_pins)if((await readTaskFile(component.root,p.path)).digest!==p.sha256)fail('source component approval changed');
  if(!['low','standard'].includes(task.contract.verification.risk_tier)||task.contract.environment.data.classification==='sensitive')fail('unsupported automatic risk');
  if(grant.read_paths.some(root=>!task.contract.environment.read_paths.some(base=>under(root,base)))||grant.write_paths.some(root=>!task.contract.environment.write_paths.some(base=>under(root,base))))fail('standing scope exceeds approved source component');
  return {goals,goal,grant,controller,template,component,task,authority};
}

function contractFor(base,{id:taskId,goal,actor,read_paths,write_paths,refs,acceptance,include,exclude}){
  const contract=structuredClone(base.contract);contract.id=taskId;contract.goal=goal;contract.actor=actor;contract.state='intake';contract.dependencies=[];contract.scope={include,exclude:[...new Set([...contract.scope.exclude,...exclude])]};contract.acceptance={criteria:acceptance,evidence:[]};contract.verification={risk_tier:contract.verification.risk_tier,separation:contract.verification.separation,implementer:null,reviewer:null,candidate_revision:null};contract.handoff=null;
  contract.environment={...contract.environment,read_paths,write_paths,data:{...contract.environment.data,policy_refs:[...new Set([...contract.environment.data.policy_refs,...refs])]}};
  if(!validateTaskContract(contract).contract_complete)fail('derived task contract is incomplete');return contract;
}

/** Exact IDs, artifacts and receipts survive partial intake. Budget reservations
 * never refund an uncertain operation or manufacture a new human approval. */
export async function admitGoalImprovement(target,request,{proposal=null,trigger=null}={}){
  exactKeys(request,['goal_id','actor','operation_id','expected_version'],['proposal_id','event_id','direction']);id(request.goal_id);id(request.operation_id);integer(request.expected_version,0,1000);
  const context=await source(target,request),{goal,grant,controller,template,component,task,goals}=context;
  const kind=trigger?'discovery':'execution';if(!!proposal===!!trigger)fail('select one evidence-backed proposal or discovery trigger');
  let input,proposalId,problem,direction,read_paths,write_paths,attempts,max_runtime_ms,max_cost_usd;
  if(proposal){
    id(proposal.id);text(proposal.title);text(proposal.expected_benefit);bounded(proposal.acceptance,text,1);if(request.proposal_id!==proposal.id)fail('proposal selection changed');direction=proposal.direction;
    if(!['low','standard'].includes(proposal.risk_tier))fail('automatic work needs an explicitly assessed supported risk');
    if(task.contract.verification.risk_tier==='low'&&proposal.risk_tier!=='low')fail('proposal risk exceeds source task');
    bounded(proposal.scope.read_paths,relative,1);bounded(proposal.scope.write_paths,relative,1);bounded(proposal.evidence,p=>{exactKeys(p,['path','sha256']);relative(p.path);pin(p.sha256);},1);
    read_paths=proposal.scope.read_paths;write_paths=proposal.scope.write_paths;
    if(read_paths.some(root=>!grant.read_paths.some(base=>under(root,base)))||write_paths.some(root=>!grant.write_paths.some(base=>under(root,base))))fail('proposal exceeds standing scope');
    for(const p of proposal.evidence)await checkEvidencePin(component.root,read_paths,p);
    integer(proposal.budget.max_attempts,1,10);integer(proposal.budget.max_runtime_ms,1,86400000);if(!cost(proposal.budget.max_cost_usd))fail('invalid proposal budget');
    attempts=Math.min(grant.max_attempts,proposal.budget.max_attempts);max_runtime_ms=Math.min(grant.max_runtime_ms,proposal.budget.max_runtime_ms);max_cost_usd=grant.max_cost_usd===null?proposal.budget.max_cost_usd:proposal.budget.max_cost_usd===null?grant.max_cost_usd:Math.min(grant.max_cost_usd,proposal.budget.max_cost_usd);
    input=structuredClone(proposal);proposalId=proposal.id;problem=executionDigest({direction,title:proposal.title,scope:{read_paths:[...read_paths].sort(),write_paths:[...write_paths].sort()},paths:proposal.evidence.map(p=>p.path).sort()});
  }else{
    exactKeys(trigger,['direction','source_refs'],['read_paths','max_runtime_ms','max_cost_usd']);direction=trigger.direction;bounded(trigger.source_refs,relative,1);if(trigger.source_refs.some(ref=>!grant.source_refs.includes(ref)))fail('trigger source is outside the standing grant');
    if(trigger.read_paths){bounded(trigger.read_paths,relative,1);if(trigger.read_paths.some(root=>!grant.read_paths.some(base=>under(root,base)))||trigger.source_refs.some(ref=>!trigger.read_paths.some(root=>under(ref,root))))fail('trigger read scope exceeds policy');}
    if(trigger.max_runtime_ms!==undefined)integer(trigger.max_runtime_ms,1,grant.max_runtime_ms);if(trigger.max_cost_usd!==undefined&&!withinCost(trigger.max_cost_usd,grant.max_cost_usd))fail('trigger financial scope exceeds standing grant');
    let bytes=0;const pins=[];for(const ref of trigger.source_refs){const file=await readTaskFile(component.root,ref,{preserveBom:true});bytes+=Buffer.byteLength(file.content);if(bytes>grant.max_source_bytes)fail('trigger source capacity');pins.push({path:ref,sha256:file.bytes_digest});}
    problem=executionDigest({direction,source_refs:pins,...(context.authority.continuation_sha256?{continuation_sha256:context.authority.continuation_sha256}:{})});proposalId='discovery-'+problem.slice(0,24);read_paths=trigger.read_paths??grant.read_paths;write_paths=[];attempts=1;max_runtime_ms=trigger.max_runtime_ms??grant.max_runtime_ms;max_cost_usd=trigger.max_cost_usd===undefined?grant.max_cost_usd:trigger.max_cost_usd;input={direction,source_refs:pins,read_paths,max_runtime_ms,max_cost_usd};
  }
  if(!grant.directions.includes(direction))fail('direction is outside the standing grant');
  if(request.direction!==undefined&&request.direction!==direction)fail('requested direction differs');
  const inputHash=executionDigest(input),admissionId='admit-'+executionDigest({goal_id:goal.id,kind,proposal_id:proposalId}).slice(0,24),derivedId='improve-'+executionDigest({goal_id:goal.id,kind,problem}).slice(0,24),artifactRoot=ROOT+'/'+admissionId;
  const localReceipt=artifactRoot+'/receipt.json',manifestRef=artifactRoot+'/manifest.json',controlId='WK-control-'+derivedId.slice(8),componentId='WK-work-'+derivedId.slice(8);
  const accepted=template.acceptance.concat(proposal?proposal.acceptance:['Return source-pinned bounded proposals with explicit risk, expected benefit and verification criteria; do not modify product files.']);
  const controlBase=path.resolve(component.root)===path.resolve(target)?controller:task;
  for(const ref of [artifactRoot,'.ai-org/goals/'+derivedId])if(!controlBase.contract.environment.write_paths.some(root=>under(ref,root)))fail('explicit metadata write scope is required for derived coordination');
  if(kind==='discovery')write_paths=[artifactRoot+'/discovery'];
  const product=contractFor(task,{id:componentId,goal:template.title_prefix+': '+(proposal?.title??'Explore '+direction),actor:goal.manifest.roles.implementer,read_paths,write_paths,refs:[manifestRef,localReceipt],acceptance:accepted,include:template.include,exclude:template.exclude});
  // Admission receipts do not exist yet. Resolve inherited authority against the
  // narrowed product scope before adding the new coordinator-owned receipts.
  const requirementContract = structuredClone(product);
  requirementContract.environment.data.policy_refs = task.contract.environment.data.policy_refs;
  const requirements = await loadTaskRequirements(component.root, requirementContract, {enforceCoverage:false});
  for (const requirement of requirements.applicable) if (!accepted.includes(requirement.criterion)) accepted.push(requirement.criterion);
  const control=contractFor(controlBase,{id:controlId,goal:'Coordinate '+derivedId,actor:goal.controller.actor,read_paths:controlBase.contract.environment.read_paths,write_paths:['.ai-org/goals/'+derivedId],refs:[manifestRef,localReceipt],acceptance:['All mandatory derived components and their independent review/integration are accepted'],include:['Coordinate this exact bounded derived goal'],exclude:['Publication','Deployment']});
  const manifest={schema_version:'workkeel.goal/v1',id:derivedId,title:product.goal,approval_ref:product.authorization.approval_ref,approved_by:goal.manifest.approved_by,expires_at:goal.manifest.expires_at,components:[{...structuredClone(component),id:'work',root:component.root,task_id:componentId,contract_sha256:executionDigest(product),depends_on:[],...(kind==='discovery'?{purpose:'discovery'}:{})}],integration:{component_id:'work',criteria:accepted},roles:structuredClone(goal.manifest.roles),models:structuredClone(goal.manifest.models),limits:{max_operations:grant.max_operations,max_reworks:Math.min(grant.max_reworks,attempts-1),timeout_ms:max_runtime_ms,max_cost_usd},control:{release_parent:true},derived_from:{goal_id:goal.id,manifest_sha256:goal.manifest_sha256,admission_ref:localReceipt,admission_sha256:'0'.repeat(64),...(path.resolve(component.root)!==path.resolve(target)?{source_root:path.resolve(target)}:{})}};
  const receipt={schema_version:'workkeel.goal-admission/v1',id:admissionId,source_goal_id:goal.id,source_manifest_sha256:goal.manifest_sha256,source_task_id:controller.id,source_contract_sha256:controller.contract_sha256,proposal_id:proposalId,proposal_sha256:inputHash,problem_sha256:problem,direction,derived_goal_id:derivedId,derived_manifest_body_sha256:goals.goalAdmissionManifestDigest(manifest),control_task_id:controlId,components:[{id:'work',root:component.root,task_id:componentId,contract_sha256:executionDigest(product)}],reservation:{operations:grant.max_operations,max_runtime_ms,max_cost_usd},created_at:current(),kind,source_goal_root:path.resolve(target),...(trigger?{source_fingerprint:problem,source_refs:input.source_refs}:{})};
  if(context.authority.extension_sha256)receipt.extension_sha256=context.authority.extension_sha256;
  if(trigger&&context.authority.continuation_sha256)receipt.continuation_sha256=context.authority.continuation_sha256;
  const receiptContent=formatJson({value:receipt,sha256:executionDigest(receipt)});manifest.derived_from.admission_sha256=sha256(receiptContent);
  const intent={receipt,receipt_content:receiptContent,manifest,manifest_ref:manifestRef,receipt_ref:localReceipt,control,product,root:component.root};
  const owner={pid:process.pid,host:os.hostname(),token:randomUUID()};
  const reserved=await withProjectMutationLock(target,async()=>{
    const s=await readGoalAdmissions(target),prior=s.receipts.find(r=>r.operation_id===request.operation_id);
    if(prior){if(prior.input_sha256!==executionDigest({request,input}))fail('operation conflict');return {state:s,entry:s.entries.find(e=>e.id===prior.admission_id),replayed:true};}
    if(s.version!==request.expected_version)fail('journal version conflict');
    const original=s.entries.find(e=>e.id===admissionId||e.goal_id===goal.id&&e.kind===kind&&e.problem_sha256===problem);if(original){if(original.input_sha256!==inputHash)fail('equivalent issue already reserved; explicit reevaluation is required');return {state:s,entry:original,replayed:true};}
    const entries=s.entries.filter(e=>e.goal_id===goal.id),discoveries=entries.filter(e=>e.kind==='discovery');
    if(entries.length>=grant.max_goals||kind==='discovery'&&discoveries.length>=grant.max_rounds||entries.reduce((n,e)=>n+e.reservation.operations,0)+grant.max_operations>grant.max_total_operations||entries.reduce((n,e)=>n+e.reservation.max_runtime_ms,0)+max_runtime_ms>grant.max_total_runtime_ms)fail('cumulative standing budget exhausted');
    if(grant.max_total_cost_usd!==null&&(max_cost_usd===null||entries.some(e=>e.reservation.max_cost_usd===null)||entries.reduce((n,e)=>n+e.reservation.max_cost_usd,0)+max_cost_usd>grant.max_total_cost_usd))fail('cumulative financial budget exhausted');
    if(kind==='discovery'&&discoveries.at(-1)&&Date.now()-Date.parse(discoveries.at(-1).updated_at)<grant.cooldown_ms)fail('discovery cooldown');
    if(s.entries.length>=200||s.receipts.length>=1000)fail('journal capacity');
    const entry={id:admissionId,goal_id:goal.id,kind,proposal_id:proposalId,problem_sha256:problem,input_sha256:inputHash,source_manifest_sha256:goal.manifest_sha256,status:'reserved',reservation:receipt.reservation,intent,owner,updated_at:current(),error:null};s.entries.push(entry);s.receipts.push({operation_id:request.operation_id,input_sha256:executionDigest({request,input}),admission_id:admissionId});await save(target,s);return {state:s,entry,replayed:false};
  });
  if(reserved.entry.status==='created')return {admission:reserved.entry,goal_id:reserved.entry.intent.manifest.id,replayed:true,model_calls:0};
  if(reserved.replayed&&alive(reserved.entry.owner))return {admission:reserved.entry,replayed:true,needs_reconciliation:true,model_calls:0};
  return reconcileGoalAdmission(target,{admission_id:reserved.entry.id,actor:request.actor},{owner:reserved.replayed?null:owner});
}

export async function reconcileGoalAdmission(target,{admission_id,actor},{owner=null}={}){
  id(admission_id);let entry=await withProjectMutationLock(target,async()=>{
    const s=await readGoalAdmissions(target),e=s.entries.find(e=>e.id===admission_id);if(!e)fail('unknown admission');
    if(e.status==='created')return structuredClone(e);if(e.owner&&e.owner.token!==owner?.token&&alive(e.owner))fail('admission has a live owner; do not replay its intake');
    e.owner=owner??{pid:process.pid,host:os.hostname(),token:randomUUID()};e.updated_at=current();await save(target,s);return structuredClone(e);
  });
  if(entry.status==='created')return {admission:entry,goal_id:entry.intent.manifest.id,replayed:true,model_calls:0};
  try{
    const context=await source(target,{goal_id:entry.goal_id,actor});if(context.goal.manifest_sha256!==entry.source_manifest_sha256)fail('standing manifest changed');
    const i=entry.intent,root=i.root;await immutable(target,ROOT+'/'+entry.id+'/receipt.json',i.receipt_content);
    await immutable(root,i.receipt_ref,i.receipt_content);await immutable(root,i.manifest_ref,formatJson(i.manifest));
    for(const contract of [i.control,i.product]){
      let actual;try{actual=await readNativeTask(root,contract.id);}catch(e){if(e.code!=='ENOENT')throw e;}
      if(actual){if(actual.contract_sha256!==executionDigest(contract))fail('partial intake task conflicts with frozen intent');}
      else await createNativeTask(root,contract,{operation_id:'intake-'+entry.id+'-'+(contract.id===i.control.id?'control':'work'),expected_version:0,actor:contract.actor});
    }
    let task=await readNativeTask(root,i.control.id);
    if(task.state==='intake'&&!task.claim){const revision=(await readNativeGit(root,['rev-parse','HEAD'])).trim();await mutateNativeTask(root,task.id,'claim',{operation_id:'claim-'+entry.id,expected_version:task.version,actor:task.contract.actor,base_revision:revision});task=await readNativeTask(root,task.id);}
    const goals=await import('./workkeel-goals.mjs');let existing;try{existing=await goals.readNativeGoal(root,i.manifest.id);}catch(e){if(e.code!=='ENOENT')throw e;}
    if(existing){if(existing.manifest_sha256!==sha256(formatJson(i.manifest)))fail('derived goal registration differs');}
    else {if(task.state!=='build'||!task.claim)fail('derived control claim unavailable');await goals.createNativeGoal(root,{task_id:task.id,actor:task.claim.actor,claim_id:task.claim.id,contract_sha256:task.contract_sha256,operation_id:'register-'+entry.id,expected_version:0,manifest_ref:i.manifest_ref});}
    await withProjectMutationLock(target,async()=>{const s=await readGoalAdmissions(target),e=s.entries.find(e=>e.id===entry.id);if(e.owner?.token!==entry.owner.token)fail('admission ownership changed');e.status='created';e.owner=null;e.error=null;e.updated_at=current();await save(target,s);entry=structuredClone(e);});
    return {admission:entry,goal_id:i.manifest.id,goal_root:root,task_ids:[i.control.id,i.product.id],model_calls:0};
  }catch(error){
    await withProjectMutationLock(target,async()=>{const s=await readGoalAdmissions(target),e=s.entries.find(e=>e.id===entry.id);if(e.owner?.token!==entry.owner.token)fail('admission ownership changed');e.status='recovery-required';e.owner=null;e.error=String(error.message).slice(0,2000);e.updated_at=current();await save(target,s);});throw error;
  }
}
