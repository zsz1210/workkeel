import {withLoopRun, countLoopOperation, readLoopRun, isLoopRunActive, requestLoopStop, assertLoopAdmission} from './workkeel-loop-run.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {exactKeys,executionDigest} from './workkeel-execution-policy.mjs';
import {readTaskFile} from './task-contract.mjs';
import {checkEvidencePin} from './workkeel-evidence-file.mjs';
import {assertRequirementAssessment} from './workkeel-requirements.mjs';
import {readTaskProject,assertActor,assertApprover,safeDirectory,readNativeGit} from './workkeel-project.mjs';
import {assertTaskExecutionContext,readNativeTask,mutateNativeTask,evidenceStatus} from './workkeel-tasks.mjs';
import {withProjectMutationLock} from './workkeel-lock.mjs';
import {MAX_REWORKS,taskRisk} from './workkeel-risk.mjs';
import {durableAtomicCreate,durableAtomicWrite,formatJson} from './files.mjs';

const ROOT='.ai-org/goals',SCHEMA='workkeel.goal/v1',trustedAdapters=new WeakSet();
const phases=['planning','implementation','verification','repair','review'];
const fail=m=>{throw Error('Native goal: '+m);};
const id=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(v))fail('invalid identifier');};
const text=(v,max=4000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail('invalid text');};
const hex=v=>{if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))fail('invalid digest');};
const integer=(v,min,max)=>{if(!Number.isSafeInteger(v)||v<min||v>max)fail('invalid bounded integer');};
const under=(ref,root)=>root==='.'||ref===root||ref.startsWith(root+'/');
const sameActor=(a,b)=>a?.agent_id===b?.agent_id&&a?.principal_id===b?.principal_id;
const array=(v,check,min=0,max=64)=>{if(!Array.isArray(v)||v.length<min||v.length>max)fail('invalid array');for(let n=0;n<v.length;n++){if(!Object.hasOwn(v,n))fail('sparse array');check(v[n]);}if(new Set(v.map(executionDigest)).size!==v.length)fail('duplicate value');};
const actor=v=>{exactKeys(v,['agent_id','principal_id']);id(v.agent_id);id(v.principal_id);};
function relative(v){text(v,1024);if(path.isAbsolute(v)||/[\\:\x00-\x1f]/.test(v)||v.split('/').some(p=>!p||p==='.'||p==='..'))fail('unsafe relative path');}
function tuple(v){exactKeys(v,['provider','model','reasoning','service']);for(const field of Object.keys(v))text(v[field],128);}
export function validateGoalManifest(m){
  exactKeys(m,['schema_version','id','title','approval_ref','approved_by','expires_at','components','integration','roles','models','limits','control'],['admission','derived_from']);
  if(m.schema_version!==SCHEMA)fail('unsupported manifest');id(m.id);text(m.title);relative(m.approval_ref);actor(m.approved_by);
  if(m.expires_at!==null&&(typeof m.expires_at!=='string'||!Number.isFinite(Date.parse(m.expires_at))))fail('invalid expiry');
  exactKeys(m.roles,['implementer','reviewer','approver']);Object.values(m.roles).forEach(actor);
  if(m.roles.implementer.agent_id===m.roles.reviewer.agent_id)fail('reviewer must be a distinct registered Agent');
  exactKeys(m.models,phases);Object.values(m.models).forEach(tuple);
  exactKeys(m.limits,['max_operations','max_reworks','timeout_ms','max_cost_usd'],['operation_timeout_ms']);
  integer(m.limits.max_operations,1,1000);integer(m.limits.max_reworks,0,10);integer(m.limits.timeout_ms,1,86400000);
  if(m.limits.operation_timeout_ms!==undefined)integer(m.limits.operation_timeout_ms,1,m.limits.timeout_ms);
  if(m.limits.max_cost_usd!==null&&(!Number.isFinite(m.limits.max_cost_usd)||m.limits.max_cost_usd<0))fail('invalid financial cap');
  exactKeys(m.control,['release_parent']);if(typeof m.control.release_parent!=='boolean')fail('explicit parent release policy required');
  array(m.components,c=>{
    exactKeys(c,['id','project_id','repo_id','root','task_id','contract_sha256','depends_on','checks','rollback','interface_refs'],['purpose']);
    if(c.purpose!==undefined&&!['execution','discovery'].includes(c.purpose))fail('invalid component purpose');
    for(const f of ['id','project_id','repo_id','task_id'])id(c[f]);hex(c.contract_sha256);text(c.root,4096);if(!path.isAbsolute(c.root)||path.resolve(c.root)!==c.root)fail('canonical absolute repository root required');
    array(c.depends_on,id);array(c.interface_refs,relative);text(c.rollback);
    array(c.checks,check=>{exactKeys(check,['id','command','args']);id(check.id);text(check.command,128);if(!/^[A-Za-z0-9._-]+$/.test(check.command))fail('check executable must be an explicit tool name');array(check.args,v=>text(v,4096),0,64);},1,16);
  },1,64);
  const ids=new Set(m.components.map(c=>c.id));if(ids.size!==m.components.length||new Set(m.components.map(c=>c.root+':'+c.task_id)).size!==m.components.length)fail('duplicate component or canonical task');
  for(const c of m.components)if(c.depends_on.some(ref=>!ids.has(ref)||ref===c.id))fail('unknown component dependency');
  const visiting=new Set(),done=new Set();function visit(v){if(visiting.has(v))fail('dependency cycle');if(done.has(v))return;visiting.add(v);m.components.find(c=>c.id===v).depends_on.forEach(visit);visiting.delete(v);done.add(v);}m.components.forEach(c=>visit(c.id));
  exactKeys(m.integration,['component_id','criteria']);id(m.integration.component_id);array(m.integration.criteria,v=>text(v),1,64);
  const integration=m.components.find(c=>c.id===m.integration.component_id);
  if(!integration||executionDigest([...integration.depends_on].sort())!==executionDigest(m.components.filter(c=>c!==integration).map(c=>c.id).sort()))fail('integration must depend on the complete mandatory component set');
  if(m.derived_from){exactKeys(m.derived_from,['goal_id','manifest_sha256','admission_ref','admission_sha256'],['source_root']);id(m.derived_from.goal_id);hex(m.derived_from.manifest_sha256);relative(m.derived_from.admission_ref);hex(m.derived_from.admission_sha256);if(m.derived_from.source_root!==undefined&&(!path.isAbsolute(m.derived_from.source_root)||path.resolve(m.derived_from.source_root)!==m.derived_from.source_root))fail('invalid source goal root');}
  if(m.admission){if(!m.admission||typeof m.admission!=='object'||Array.isArray(m.admission))fail('invalid standing admission grant');if(Buffer.byteLength(formatJson(m.admission))>65536)fail('admission grant exceeds bound');}
  return m;
}
export function goalAdmissionManifestDigest(manifest){const body=structuredClone(manifest);if(body.derived_from)delete body.derived_from.admission_sha256;return executionDigest(body);}
function ref(idValue,file='state.json'){id(idValue);return ROOT+'/'+idValue+'/'+file;}
// Atomic replacement can race a no-symlink reader's final inode check. Retry that
// specific observation, never malformed data or a failed integrity check.
async function readStable(target,file){for(let attempt=0;;attempt++){try{return await readTaskFile(target,file);}catch(e){if(e.message==='Contract input changed while reading'&&attempt<2)continue;throw e;}}}
async function envelopeAt(target,file){const input=await readStable(target,file);const e=JSON.parse(input.content);exactKeys(e,['value','sha256']);if(executionDigest(e.value)!==e.sha256)fail('state integrity');return {value:e.value,sha256:e.sha256,bytes_sha256:input.bytes_digest};}
async function stateAt(target,goalId){
  const s=(await envelopeAt(target,ref(goalId))).value;
  exactKeys(s,['schema_version','id','version','manifest_ref','manifest_sha256','manifest_frozen','approval_pin','controller','roots','status','components','operations','receipts','reserved_ms','known_cost_usd','cost_complete','completion','last_error','created_at']);
  if(s.schema_version!=='workkeel.goal-state/v1'||s.id!==goalId)fail('invalid goal state');integer(s.version,1,10000);
  if(!['running','paused','cancel-requested','cancelled','done','blocked','recovery-required'].includes(s.status))fail('invalid goal status');
  array(s.components,c=>{id(c.id);integer(c.cycle,0,10);array(c.threads,v=>text(v,128),0,32);array(c.failures,v=>{text(v.kind);hex(v.operation_sha256);},0,32);},1,64);
  array(s.operations,o=>{id(o.id);if(!['native','runtime'].includes(o.kind)||!['intent','running','completed','unknown'].includes(o.status))fail('invalid operation');hex(o.input_sha256);if(executionDigest(o.input)!==o.input_sha256)fail('operation input changed');},0,1000);
  array(s.receipts,r=>{id(r.operation_id);hex(r.sha256);},0,1000);return s;
}
async function save(target,s){s.version++;const content=formatJson({value:s,sha256:executionDigest(s)});if(Buffer.byteLength(content)>1024*1024)fail('goal state limit');const dir=await safeDirectory(target,ROOT+'/'+s.id,{create:true});await durableAtomicWrite(path.join(dir,'state.json'),content);return s;}
async function ignore(target){const dir=await safeDirectory(target,ROOT,{create:true});try{if((await readTaskFile(target,ROOT+'/.gitignore')).content!=='*\n')fail('goal ignore policy changed');}catch(e){if(e.code!=='ENOENT')throw e;await durableAtomicCreate(path.join(dir,'.gitignore'),'*\n');}}
async function rootIdentity(root){if(await fs.realpath(root)!==root)fail('repository root identity changed');await readTaskProject(root);const stat=await fs.stat(root);return {root,dev:stat.dev,ino:stat.ino};}
async function freshPin(target,pin){try{return await checkEvidencePin(target,['.'],pin);}catch(error){if(error.message==='Evidence digest mismatch')return false;throw error;}}
async function standing(target,s,m,{stop=false}={}){
  const project=await readTaskProject(target);assertApprover(project.policy,m.roles.approver);
  if(stop)return;
  const task=await readNativeTask(target,s.controller.task_id);
  if(s.controller.policy_sha256!==project.digest&&s.controller.policy_sha256!==executionDigest(project.policy))fail('standing project policy changed');
  if(task.contract_sha256!==s.controller.contract_sha256||task.policy_sha256!==s.controller.policy_sha256||task.state==='cancelled')fail('standing goal authority changed or cancelled');
  if(executionDigest(task.authority_pins)!==executionDigest(s.controller.authority_pins))fail('standing authority pins changed');
  for(const p of s.controller.authority_pins){const input=await readTaskFile(target,p.path);if(input.digest!==p.sha256)fail('standing task authority source changed');}
  if(!await freshPin(target,{path:s.manifest_ref,sha256:s.manifest_sha256})||!await freshPin(target,s.approval_pin))fail('approved goal manifest or approval bytes changed');
  for(const expiry of [m.expires_at,task.contract.authorization.expires_at])if(expiry&&Date.parse(expiry)<=Date.now())fail('goal authority expired');
  await validateDerived(target,m);
}
async function manifestAt(target,s,{frozen=false}={}){if(frozen)return validateGoalManifest(structuredClone(s.manifest_frozen));const input=await readTaskFile(target,s.manifest_ref);if(input.bytes_digest!==s.manifest_sha256)fail('immutable goal manifest changed');return validateGoalManifest(JSON.parse(input.content));}
export async function assertNativeGoalAuthority(target,goalOrId,{actor:operator,execution=true}={}){
  const s=await stateAt(target,typeof goalOrId==='string'?goalOrId:goalOrId.id),m=await manifestAt(target,s,{frozen:true}),project=await readTaskProject(target);
  if(operator){assertApprover(project.policy,operator);if(!sameActor(operator,m.roles.approver))fail('goal operator is not the approved original actor');}
  await standing(target,s,m,{stop:!execution});
  if(execution)for(const c of m.components)await componentTask(s,c);
  return {id:s.id,manifest:m,manifest_sha256:s.manifest_sha256,controller:s.controller,approval_pin:s.approval_pin,roots:s.roots,standing_authorized:execution,authority:'sealed-standing-goal'};
}
// The manifest limit is clamped to the risk-tier limit of the component's task.
const reworkLimit=(m,t)=>Math.min(m.limits.max_reworks,MAX_REWORKS[taskRisk(t)]);
async function componentTask(s,c){
  const identity=s.roots.find(r=>r.root===c.root),current=await rootIdentity(c.root);
  if(!identity||identity.dev!==current.dev||identity.ino!==current.ino)fail('component repository identity changed');
  const task=await readNativeTask(c.root,c.task_id),project=await readTaskProject(c.root);
  if(task.contract_sha256!==c.contract_sha256||task.policy_sha256!==project.digest&&task.policy_sha256!==executionDigest(project.policy))fail('component contract or policy changed');
  for(const p of task.authority_pins)if((await readTaskFile(c.root,p.path)).digest!==p.sha256)fail('component approval source changed');
  if(task.contract.authorization.expires_at&&Date.parse(task.contract.authorization.expires_at)<=Date.now())fail('component authority expired');
  return task;
}
async function evidenceCurrent(root,values){for(const p of values)if(!await freshPin(root,p))return false;return true;}
async function acceptedFact(s,c){
  const t=await componentTask(s,c);if(t.state!=='done'||t.review?.judgment!=='pass'||!t.closeout||!t.delivery)return null;
  for(const entry of [...t.delivery.evidence,...t.review.evidence,...t.closeout.evidence])if(await evidenceStatus(c.root,t.delivery.revision,entry)==='unavailable')return null;
  if((await readNativeGit(c.root,['rev-parse','--verify',t.delivery.revision+'^{commit}'])).trim()!==t.delivery.revision)return null;
  const interface_pins=[];
  for(const ref of c.interface_refs){const file=await readTaskFile(c.root,ref,{preserveBom:true}),tree=await readNativeGit(c.root,['ls-tree','-z',t.delivery.revision,'--',ref]),match=/^100(?:644|755) blob ([a-f0-9]{40}(?:[a-f0-9]{24})?)\t/.exec(tree);if(!match)return null;const bytes=Buffer.from(file.content),blob=createHash(match[1].length===40?'sha1':'sha256').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');if(blob!==match[1])return null;interface_pins.push({path:ref,sha256:file.bytes_digest});}
  return {id:c.id,project_id:c.project_id,repo_id:c.repo_id,root:c.root,task_id:c.task_id,contract_sha256:t.contract_sha256,task_version:t.version,task_sha256:executionDigest(t),revision:t.delivery.revision,review_sha256:executionDigest(t.review),closeout_sha256:executionDigest(t.closeout),interface_pins,evidence:[...t.delivery.evidence,...t.review.evidence,...t.closeout.evidence]};
}
async function validateDerived(target,m){
  if(!m.derived_from)return;const d=m.derived_from,sourceRoot=d.source_root??target;await rootIdentity(sourceRoot);const parent=await stateAt(sourceRoot,d.goal_id),source=await manifestAt(sourceRoot,parent);await standing(sourceRoot,parent,source);
  if(parent.manifest_sha256!==d.manifest_sha256||!source.admission)fail('derived goal has no frozen standing admission grant');
  const file=await readTaskFile(target,d.admission_ref);if(file.bytes_digest!==d.admission_sha256)fail('admission receipt bytes changed');
  const receipt=(await envelopeAt(target,d.admission_ref)).value;
  exactKeys(receipt,['schema_version','id','source_goal_id','source_manifest_sha256','source_task_id','source_contract_sha256','proposal_id','proposal_sha256','problem_sha256','direction','derived_goal_id','derived_manifest_body_sha256','control_task_id','components','reservation','created_at'],['source_goal_root','kind','source_fingerprint','source_refs','extension_sha256','continuation_sha256']);
  if((receipt.source_goal_root??target)!==sourceRoot)fail('source admission goal root differs');
  if(receipt.schema_version!=='workkeel.goal-admission/v1'||receipt.source_goal_id!==d.goal_id||receipt.source_manifest_sha256!==d.manifest_sha256||receipt.source_task_id!==parent.controller.task_id||receipt.source_contract_sha256!==parent.controller.contract_sha256||receipt.derived_goal_id!==m.id||receipt.derived_manifest_body_sha256!==goalAdmissionManifestDigest(m))fail('admission receipt does not authorize this exact derived goal');
  const {readGoalAdmissions,readGoalAdmissionAuthority}=await import('./workkeel-autonomy-admission.mjs'),journal=await readGoalAdmissions(sourceRoot),entry=journal.entries.find(e=>e.id===receipt.id&&e.goal_id===d.goal_id);
  if(!entry||entry.intent.root!==target||entry.intent.manifest.id!==m.id||executionDigest(entry.intent.manifest)!==executionDigest(m)||executionDigest(entry.intent.receipt)!==executionDigest(receipt)||executionDigest(entry.reservation)!==executionDigest(receipt.reservation)||entry.source_manifest_sha256!==parent.manifest_sha256)fail('admission requires the exact durable standing-budget reservation');
  const reserved=journal.entries.filter(e=>e.goal_id===d.goal_id),authority=await readGoalAdmissionAuthority(sourceRoot,{id:d.goal_id,manifest:source,manifest_sha256:parent.manifest_sha256},{journal}),grant=authority.grant;
  if(receipt.extension_sha256&&!authority.authorizations.some(a=>a.sha256===receipt.extension_sha256)||receipt.continuation_sha256&&!authority.authorizations.some(a=>a.sha256===receipt.continuation_sha256&&a.reevaluation))fail('admission extension authority differs');
  if(reserved.length>grant.max_goals||reserved.reduce((n,e)=>n+e.reservation.operations,0)>grant.max_total_operations||reserved.reduce((n,e)=>n+e.reservation.max_runtime_ms,0)>grant.max_total_runtime_ms||grant.max_total_cost_usd!==null&&(reserved.some(e=>e.reservation.max_cost_usd===null)||reserved.reduce((n,e)=>n+e.reservation.max_cost_usd,0)>grant.max_total_cost_usd))fail('standing cumulative reservation exceeded');
  if(executionDigest(m.roles)!==executionDigest(source.roles)||executionDigest(m.models)!==executionDigest(source.models))fail('derived roles or models widened');
  const expected=m.components.map(c=>({id:c.id,root:c.root,task_id:c.task_id,contract_sha256:c.contract_sha256})).sort((a,b)=>a.id.localeCompare(b.id));
  if(executionDigest([...receipt.components].sort((a,b)=>a.id.localeCompare(b.id)))!==executionDigest(expected))fail('admission component set changed');
  if(!source.admission.enabled||!source.admission.directions?.includes(receipt.direction)||m.limits.max_operations>source.admission.max_operations||m.limits.max_reworks>source.admission.max_reworks||m.limits.timeout_ms>source.admission.max_runtime_ms)fail('derived goal exceeds standing admission');
  const template=JSON.parse((await readTaskFile(sourceRoot,source.admission.template_ref)).content),origin=source.components.find(c=>c.id===template.source_component_id);
  if(!origin||m.components.some(c=>c.root!==origin.root))fail('derived goal root was not the explicitly selected source component');
  const originTask=await componentTask(parent,origin);
  for(const c of m.components){
    const child=await readNativeTask(c.root,c.task_id),a=child.contract.environment,b=originTask.contract.environment,controlTask=await readNativeTask(sourceRoot,parent.controller.task_id);
    const discoveryRoot='.ai-org/autonomy/admissions/'+receipt.id+'/discovery',receiptRoot='.ai-org/autonomy/admissions/'+receipt.id+'/receipt.json';
    const writesAllowed=c.purpose==='discovery'?receipt.kind==='discovery'&&d.admission_ref===receiptRoot&&a.write_paths.every(p=>under(p,discoveryRoot)):a.write_paths.every(p=>b.write_paths.some(root=>under(p,root))&&source.admission.write_paths.some(root=>under(p,root)));
    if(!['low','standard'].includes(child.contract.verification.risk_tier)||originTask.contract.verification.risk_tier==='low'&&child.contract.verification.risk_tier!=='low'||!sameActor(child.contract.actor,originTask.contract.actor)||a.read_paths.some(p=>!b.read_paths.some(root=>under(p,root))||!source.admission.read_paths.some(root=>under(p,root)))||!writesAllowed||a.tools.some(tool=>!b.tools.includes(tool))||a.resources.some(resource=>!b.resources.includes(resource))||a.external_actions.some(action=>!b.external_actions.includes(action))||executionDigest(a.network)!==executionDigest(b.network)||a.data.classification!==b.data.classification||a.data.model_access!==b.data.model_access||b.data.policy_refs.some(ref=>!a.data.policy_refs.includes(ref))||executionDigest(child.contract.execution)!==executionDigest(originTask.contract.execution))fail('derived native task widens source authority');
  }
  if(source.admission.max_cost_usd!==null&&(m.limits.max_cost_usd===null||m.limits.max_cost_usd>source.admission.max_cost_usd))fail('derived financial cap widened');
  if(receipt.reservation.operations<m.limits.max_operations||receipt.reservation.max_runtime_ms<m.limits.timeout_ms||receipt.control_task_id===undefined)fail('admission budget was not reserved');
}
export async function createNativeGoal(target,r){
  await assertLoopAdmission(target);
  exactKeys(r,['task_id','actor','claim_id','contract_sha256','operation_id','expected_version','manifest_ref']);id(r.operation_id);if(r.expected_version!==0)fail('new goal expects version zero');
  return withProjectMutationLock(target,async()=>{
    const replayFile=await readTaskFile(target,r.manifest_ref),replayManifest=validateGoalManifest(JSON.parse(replayFile.content));
    try{const prior=await stateAt(target,replayManifest.id);if(prior.receipts[0]?.sha256!==executionDigest(r)||prior.manifest_sha256!==replayFile.bytes_digest)fail('goal registration conflict');await assertNativeGoalAuthority(target,prior.id,{actor:r.actor});return {goal:await readNativeGoal(target,prior.id),replayed:true};}catch(e){if(e.code!=='ENOENT')throw e;}
    const task=await assertTaskExecutionContext(target,r.task_id,r),project=await readTaskProject(target);assertApprover(project.policy,r.actor);
    const file=await readTaskFile(target,r.manifest_ref),m=validateGoalManifest(JSON.parse(file.content));
    const loopRun=await readLoopRun(target);if(isLoopRunActive(loopRun)){await assertLoopAdmission(target,m.id);if(m.components.some(c=>c.root!==target)||m.admission||m.derived_from)fail('L2 is limited to one project and one goal, without new admission');}
    if(!sameActor(m.approved_by,r.actor)||!sameActor(m.roles.approver,r.actor))fail('manifest approver must be the actual approving controller');
    if(!task.contract.environment.write_paths.some(root=>under(ROOT+'/'+m.id,root)))fail('goal store outside controller write authority');
    if(!task.authority_pins.some(p=>p.path===r.manifest_ref&&p.sha256===file.bytes_digest))fail('goal manifest must be explicitly task-authority pinned');
    const approval=await readTaskFile(target,m.approval_ref);if(!task.authority_pins.some(p=>p.path===m.approval_ref&&p.sha256===approval.bytes_digest)||!approval.content.trim())fail('goal approval must be task-authority pinned');
    await validateDerived(target,m);if(m.derived_from){const receipt=(await envelopeAt(target,m.derived_from.admission_ref)).value;if(receipt.control_task_id!==task.id)fail('admission control task differs');}
    if(m.admission){
      const {validateGoalAdmissionGrant}=await import('./workkeel-autonomy-admission.mjs'),grant=validateGoalAdmissionGrant(m.admission);
      const templateFile=await readTaskFile(target,grant.template_ref);if(!task.authority_pins.some(p=>p.path===grant.template_ref&&p.sha256===templateFile.bytes_digest))fail('admission template must be task-authority pinned');
      const template=JSON.parse(templateFile.content),source=m.components.find(c=>c.id===template.source_component_id);if(!source)fail('admission source component missing');const sourceTask=await readNativeTask(source.root,source.task_id);
      if(!['low','standard'].includes(sourceTask.contract.verification.risk_tier)||grant.read_paths.some(p=>!sourceTask.contract.environment.read_paths.some(root=>under(p,root)))||grant.write_paths.some(p=>!sourceTask.contract.environment.write_paths.some(root=>under(p,root))))fail('admission scope or risk exceeds approved source component');
    }
    const roots=[];for(const c of m.components){if(!roots.some(r=>r.root===c.root))roots.push(await rootIdentity(c.root));const cp=await readTaskProject(c.root);Object.values(m.roles).forEach(a=>assertActor(cp.policy,a));assertApprover(cp.policy,m.roles.approver);const t=await readNativeTask(c.root,c.task_id);if(t.contract_sha256!==c.contract_sha256||!sameActor(t.contract.actor,m.roles.implementer))fail('component task authority or implementer differs');if(c.id===m.integration.component_id&&m.integration.criteria.some(item=>!t.contract.acceptance.criteria.includes(item)))fail('whole integration criteria missing from canonical task');if(cp.policy.review_separation==='distinct-principal'&&m.roles.implementer.principal_id===m.roles.reviewer.principal_id)fail('reviewer violates component separation policy');}
    const hash=executionDigest(r);try{const old=await stateAt(target,m.id);if(old.receipts[0]?.sha256!==hash||old.manifest_sha256!==file.bytes_digest)fail('goal registration conflict');return {goal:await readNativeGoal(target,m.id),replayed:true};}catch(e){if(e.code!=='ENOENT')throw e;}
    await ignore(target);
    const s={schema_version:'workkeel.goal-state/v1',id:m.id,version:0,manifest_ref:r.manifest_ref,manifest_sha256:file.bytes_digest,manifest_frozen:structuredClone(m),approval_pin:{path:m.approval_ref,sha256:approval.bytes_digest},controller:{task_id:task.id,actor:r.actor,claim_id:r.claim_id,contract_sha256:task.contract_sha256,policy_sha256:task.policy_sha256,authority_pins:task.authority_pins,initial_version:task.version},roots,status:'running',components:m.components.map(c=>({id:c.id,cycle:0,phase:'planning',candidate:null,verification:null,threads:[],failures:[],review_proof:null,last_error:null})),operations:[],receipts:[{operation_id:r.operation_id,sha256:hash}],reserved_ms:0,known_cost_usd:0,cost_complete:true,completion:null,last_error:null,created_at:new Date().toISOString()};
    await save(target,s);return {goal:await readNativeGoal(target,m.id),replayed:false};
  });
}
export async function readNativeGoal(target,goalId){
  const s=await stateAt(target,goalId),m=await manifestAt(target,s,{frozen:true}),components=[];
  let authority_status='current';try{await standing(target,s,m);}catch(e){authority_status='unavailable';s.last_error=e.message;}
  for(const c of m.components){try{const task=await componentTask(s,c),fact=await acceptedFact(s,c);components.push({...c,key:c.project_id+':'+c.task_id,task_version:task.version,state:task.state,candidate_revision:task.delivery?.revision??null,review:task.review?{judgment:task.review.judgment,revision:task.review.revision,actor:task.review.actor}:null,reviews:task.history.filter(event=>event.action==='review').map(event=>({operation_id:event.operation_id,judgment:event.judgment,revision:event.revision,actor:event.actor,at:event.at})),accepted:!!fact,fact,read_status:'available',progress:s.components.find(p=>p.id===c.id)});}catch(e){components.push({...c,key:c.project_id+':'+c.task_id,accepted:false,read_status:'unavailable',reason:e.message,progress:s.components.find(p=>p.id===c.id)});}}
  const facts=components.filter(c=>c.fact).map(c=>c.fact).sort((a,b)=>a.id.localeCompare(b.id)),complete=components.every(c=>c.accepted);
  const historical=s.completion!==null,current=historical&&complete&&executionDigest(facts)===s.completion.candidate_set_sha256&&await evidenceCurrent(target,s.completion.pins);
  const discoveryReports=[];
  for(const c of components)if(c.purpose==='discovery'&&c.accepted&&c.progress?.review_proof){const operation=s.operations.filter(o=>o.input.component_id===c.id&&o.input.phase==='implementation'&&o.status==='completed'&&o.result?.proposal_report).at(-1);if(operation&&operation.result.report_pin&&await freshPin(c.root,operation.result.report_pin)&&await evidenceCurrent(c.root,operation.result.source_pins??[]))discoveryReports.push({component_id:c.id,root:c.root,task_id:c.task_id,task_version:c.task_version,candidate_revision:c.candidate_revision,operation_id:operation.id,report:operation.result.proposal_report,proposal_report:operation.result.proposal_report,report_pin:operation.result.report_pin,source_pins:operation.result.source_pins??[],usage:operation.result.usage,actual_actor:operation.result.actor,thread_id:operation.result.thread_id});}
  return {...s,state:s.status,manifest:m,mandatory_components:components,completed_discovery_reports:discoveryReports,component_set_sha256:executionDigest(m.components),whole_acceptance:current&&authority_status==='current'?'accepted':historical?'stale':'not-accepted',status:s.status,authority_status,authority:'observation-only',mutation_status:'no-write',model_calls:0,all_components_accepted:complete,integration:s.completion,accepted:current&&authority_status==='current',published:'not-performed',deployed:'not-performed'};
}
export async function listNativeGoals(target){let dir;try{dir=await safeDirectory(target,ROOT);}catch(e){if(e.code==='ENOENT')return [];throw e;}const names=(await fs.readdir(dir)).filter(n=>n!=='.gitignore').sort();if(names.length>200)fail('goal inventory bound');const items=[];for(const name of names){try{items.push(await readNativeGoal(target,name));}catch(e){items.push({id:name,read_status:'unavailable',accepted:false,reason:e.message});}}return items;}
export async function controlNativeGoal(target,goalId,action,r){
  exactKeys(r,['actor','operation_id','expected_version']);actor(r.actor);id(r.operation_id);if(!['pause','resume','cancel','recover'].includes(action))fail('unknown control');
  r=structuredClone(r);
  if(action==='cancel')await requestLoopStop(target,'user-requested');else await assertLoopAdmission(target,goalId);
  return withProjectMutationLock(target,async()=>{
    const s=await stateAt(target,goalId),m=await manifestAt(target,s,{frozen:true}),project=await readTaskProject(target);assertApprover(project.policy,r.actor);
    if(!sameActor(r.actor,m.roles.approver))fail('goal control actor differs');
    const hash=executionDigest({action,r}),prior=s.receipts.find(p=>p.operation_id===r.operation_id);if(prior){if(prior.sha256!==hash)fail('control replay conflict');return {goal:await readNativeGoal(target,goalId),replayed:true};}
    if(s.version!==r.expected_version)fail('stale goal version');
    if(['resume','recover'].includes(action))await standing(target,s,m);
    if(action==='pause'&&s.status!=='done')s.status='paused';
    if(action==='cancel'&&s.status!=='done')s.status='cancel-requested';
    if(['resume','recover'].includes(action)&&!['done','cancelled'].includes(s.status)){s.status='running';for(const c of s.components)c.last_error=null;s.last_error=null;}
    if(s.receipts.length>=1000)fail('receipt bound');s.receipts.push({operation_id:r.operation_id,sha256:hash});await save(target,s);return {goal:await readNativeGoal(target,goalId),replayed:false};
  });
}
export function createTrustedGoalAdapter(adapter){exactKeys(adapter,['id','assertCapabilities','execute','reconcile','cancel'],['costPath']);id(adapter.id);for(const f of ['assertCapabilities','execute','reconcile','cancel'])if(typeof adapter[f]!=='function')fail('trusted adapter function required');const value=Object.freeze(adapter);trustedAdapters.add(value);return value;}
function live(owner){if(!owner)return false;if(owner.host!==os.hostname())return true;try{process.kill(owner.pid,0);return true;}catch(e){return e.code!=='ESRCH';}}
function operationId(s,component,phase,version){return 'goal-'+executionDigest({goal:s.manifest_sha256,component,phase,version}).slice(0,40);}
function nativeInput(s,m,c,t,phase,p){
  const operation_id=operationId(s,c.id,phase,t.version),base={operation_id,expected_version:t.version,actor:m.roles.implementer};
  if(phase==='claim')return {action:'claim',request:{...base,base_revision:null}};
  if(phase==='handoff')return {action:'handoff',request:{...base,claim_id:t.claim.id,revision:p.candidate,summary:'Exact goal component verified',evidence:p.verification.evidence,unresolved:[]}};
  if(phase==='rework')return {action:'rework',request:{...base,actor:m.roles.approver,summary:'Repair the retained independent FAIL without expanding scope'}};
  if(phase==='close')return {action:'close',request:{...base,actor:m.roles.approver,revision:t.delivery.revision,summary:'Exact independently reviewed goal component accepted',rollback:c.rollback,evidence:[...new Set([...t.delivery.evidence,...t.review.evidence].map(pin=>pin.path))]}};
}
async function reserve(target,goalId,adapter,signal){
  return withProjectMutationLock(target,async()=>{
    if(signal?.aborted)return {idle:'aborted',model_called:false};
    const s=await stateAt(target,goalId);if(['paused','done','cancelled'].includes(s.status))return {idle:s.status};const m=await manifestAt(target,s,{frozen:s.status==='cancel-requested'});await standing(target,s,m,{stop:s.status==='cancel-requested'});
    const active=s.operations.filter(o=>['running','unknown','intent'].includes(o.status));
    if(s.status==='cancel-requested'){
      const op=active.find(o=>o.kind==='runtime');if(op)return {s,m,operation:op,mode:'cancel'};
      const pendingNative=active.find(o=>o.kind==='native');if(pendingNative){if(live(pendingNative.owner))return {idle:'awaiting-native-operation'};return recover(pendingNative,'execute');}
      // No unresolved model operation exists; cancel remaining native tasks through
      // their own approving Principal and native idempotent gates.
      for(const c of m.components){const identity=await rootIdentity(c.root),old=s.roots.find(r=>r.root===c.root);if(identity.ino!==old.ino||identity.dev!==old.dev)fail('stop root identity changed');const t=await readNativeTask(c.root,c.task_id);if(!['done','cancelled'].includes(t.state)){
        const operation_id=operationId(s,c.id,'cancel',t.version),evidenceRef='.ai-org/artifacts/'+c.task_id+'/goal-cancel-'+operation_id+'.json',content=formatJson({schema_version:'workkeel.goal-stop/v1',goal_id:s.id,manifest_sha256:s.manifest_sha256,operator:m.roles.approver,task_id:c.task_id,task_version:t.version,operation_id,reason:'Explicit frozen whole-goal cancellation; no new execution authority'}),dir=await safeDirectory(c.root,path.posix.dirname(evidenceRef),{create:true});
        try{await durableAtomicCreate(path.join(dir,path.posix.basename(evidenceRef)),content);}catch(e){if(e.code!=='EEXIST'||(await readTaskFile(c.root,evidenceRef)).content!==content)throw e;}
        const request={operation_id,expected_version:t.version,actor:m.roles.approver,summary:'Approved whole goal cancelled',evidence:[evidenceRef]};return add({kind:'native',phase:'cancel',component_id:c.id,root:c.root,task_id:c.task_id,action:'cancel',request});}}
      s.status='cancelled';await save(target,s);return {idle:'cancelled'};
    }
    // Pure native intents are safe to replay only with their exact request. A
    // model intent has unknown effects after a stopped process and is observed.
    const recoverable=active.find(op=>!live(op.owner));if(recoverable?.kind==='native'||recoverable?.status==='intent')return recover(recoverable,'execute');
    if(m.control.release_parent){const controller=await readNativeTask(target,s.controller.task_id);if(controller.state==='build'&&controller.claim?.id===s.controller.claim_id){if(active.some(o=>live(o.owner)))return {idle:'awaiting-controller-quiescence'};return add({kind:'native',phase:'release-controller',component_id:m.integration.component_id,root:target,task_id:controller.id,action:'release',request:{operation_id:operationId(s,'controller','release',controller.version),expected_version:controller.version,actor:s.controller.actor,claim_id:s.controller.claim_id,summary:'Sealed standing goal continues under its immutable approved authority'}});}}
    const facts=new Map();for(const c of m.components)try{const fact=await acceptedFact(s,c);if(fact)facts.set(c.id,fact);}catch{}
    if(facts.size===m.components.length){
      const exact=[...facts.values()].sort((a,b)=>a.id.localeCompare(b.id));
      const integration=s.components.find(p=>p.id===m.integration.component_id),accepted=m.components.find(c=>c.id===m.integration.component_id);
      if(!integration.verification?.integration_pin||!integration.review_proof){s.status='blocked';s.last_error='Whole integration has no retained exact-set verification and actual reviewer proof';await save(target,s);return {idle:'integration-evidence-required'};}
      const file=await readTaskFile(accepted.root,integration.verification.integration_pin.path);if(file.bytes_digest!==integration.verification.integration_pin.sha256)fail('integration evidence changed');
      const record=JSON.parse(file.content),others=exact.filter(f=>f.id!==m.integration.component_id);
      if(record.schema_version!=='workkeel.goal-integration/v1'||record.manifest_sha256!==s.manifest_sha256||record.candidate_set_sha256!==executionDigest(others)||record.integration_candidate!==facts.get(m.integration.component_id).revision)fail('integration candidate set differs from approved whole goal');
      const completionRef=ref(s.id,'acceptance.json');let completion={schema_version:'workkeel.goal-acceptance/v1',manifest_sha256:s.manifest_sha256,components:exact,candidate_set_sha256:executionDigest(exact),integration:{root:accepted.root,...integration.verification.integration_pin},accepted_at:new Date().toISOString()};
      const dir=await safeDirectory(target,ROOT+'/'+s.id);try{await durableAtomicCreate(path.join(dir,'acceptance.json'),formatJson(completion));}catch(e){if(e.code!=='EEXIST')throw e;const old=JSON.parse((await readTaskFile(target,completionRef)).content);if(old.manifest_sha256!==s.manifest_sha256||old.candidate_set_sha256!==completion.candidate_set_sha256||executionDigest(old.components)!==executionDigest(exact))fail('whole acceptance conflict');completion=old;}
      s.completion={...completion,pins:[{path:completionRef,sha256:(await readTaskFile(target,completionRef)).bytes_digest}]};s.status='done';await save(target,s);return {idle:'whole-goal-accepted',accepted:true};
    }
    for(const c of m.components){
      const p=s.components.find(p=>p.id===c.id);if(p.last_error||active.some(o=>o.input.component_id===c.id))continue;
      if(c.depends_on.some(id=>!facts.has(id)))continue;
      let t;try{t=await componentTask(s,c);}catch(e){p.last_error=e.message;continue;}if(t.state==='done'){p.phase='accepted';continue;}if(t.state==='cancelled'){p.last_error='Canonical component was cancelled';continue;}
      if(t.state==='intake'){
        const input=nativeInput(s,m,c,t,'claim',p);input.request.base_revision=(await readNativeGit(c.root,['rev-parse','HEAD'])).trim();return add({kind:'native',phase:'claim',component_id:c.id,root:c.root,task_id:c.task_id,...input});
      }
      if(t.state==='test'&&t.review?.judgment==='fail'){
        if(p.cycle>=reworkLimit(m,t)){p.last_error='Risk-tier rework limit reached; original FAIL retained; human decision required';continue;}
        return add({kind:'native',phase:'rework',component_id:c.id,root:c.root,task_id:c.task_id,...nativeInput(s,m,c,t,'rework',p)});
      }
      if(t.state==='release_gate'){
        if(!p.review_proof){p.last_error='Actual reviewer proof missing; closure prohibited';continue;}
        return add({kind:'native',phase:'close',component_id:c.id,root:c.root,task_id:c.task_id,...nativeInput(s,m,c,t,'close',p)});
      }
      if(t.state==='test'&&!t.review){
        return runtime('review');
      }
      if(t.state!=='build'||!t.claim){p.last_error='Canonical lifecycle requires attention';continue;}
      await assertTaskExecutionContext(c.root,t.id,{actor:t.claim.actor,claim_id:t.claim.id,contract_sha256:t.contract_sha256});
      if(p.phase==='handoff')return add({kind:'native',phase:'handoff',component_id:c.id,root:c.root,task_id:c.task_id,...nativeInput(s,m,c,t,'handoff',p)});
      return runtime(p.phase==='repair'?'repair':p.phase);
      async function runtime(phase){
        const previous=s.operations.filter(o=>o.input.component_id===c.id&&o.input.phase!=='review'&&o.status==='completed'&&o.result?.runtime_selection).at(-1);
        const input={kind:'runtime',phase,component_id:c.id,root:c.root,task_id:c.task_id,cycle:p.cycle,task_version:t.version,task_sha256:executionDigest(t),task_snapshot:structuredClone(t),contract_sha256:t.contract_sha256,claim_id:t.claim?.id??t.delivery?.claim_id,actor:phase==='review'?m.roles.reviewer:m.roles.implementer,model:m.models[phase],candidate:p.candidate,verification:p.verification,previous_threads:p.threads,previous_model:previous?.result.runtime_selection??null,required_components:m.components.map(x=>x.id),accepted_components:[...facts.values()].filter(f=>f.id!==c.id).sort((a,b)=>a.id.localeCompare(b.id))};
        try{await adapter.assertCapabilities({target,controller:s.controller,manifest:m,component:c,task:t,input});}catch(e){p.last_error='Host capability unavailable: '+e.message.slice(0,500);await save(target,s);return {idle:'host-capability-unavailable',component_id:c.id,model_called:false};}
        if(signal?.aborted)return {idle:'aborted',model_called:false};
        await standing(target,s,m);
        if(executionDigest(await componentTask(s,c))!==input.task_sha256)fail('component changed during capability qualification');
        return add(input);
      }
    }
    if(recoverable)return recover(recoverable,'reconcile');
    s.last_error=s.components.filter(c=>c.last_error).map(c=>c.id+': '+c.last_error).join('; ')||null;if(s.last_error)await save(target,s);return {idle:s.last_error?'components-blocked':'waiting-for-dependencies',model_called:false};
    async function recover(op,mode){op.owner={pid:process.pid,host:os.hostname(),token:randomUUID()};op.status='running';await save(target,s);return {s,m,operation:structuredClone(op),mode};}
    async function add(input){
      if(signal?.aborted)return {idle:'aborted',model_called:false};
      if(s.operations.length>=m.limits.max_operations)fail('goal operation budget exhausted');
      const operation_id=operationId(s,input.component_id,input.phase,executionDigest(input)),duration=input.kind==='runtime'?(m.limits.operation_timeout_ms??Math.max(1,Math.floor(m.limits.timeout_ms/m.limits.max_operations))):0;
      if(s.reserved_ms+duration>m.limits.timeout_ms)fail('cumulative goal runtime budget exhausted');
      const op={id:operation_id,kind:input.kind,input,input_sha256:executionDigest(input),status:'running',owner:{pid:process.pid,host:os.hostname(),token:randomUUID()},reserved_ms:duration,result:null,at:new Date().toISOString()};
      const dir=await safeDirectory(target,ROOT+'/'+s.id+'/intents',{create:true});try{await durableAtomicCreate(path.join(dir,operation_id+'.json'),formatJson({value:op,sha256:executionDigest(op)}));}catch(e){if(e.code!=='EEXIST')throw e;const old=(await envelopeAt(target,ROOT+'/'+s.id+'/intents/'+operation_id+'.json')).value;if(old.input_sha256!==op.input_sha256||executionDigest(old.input)!==executionDigest(op.input))fail('orphan intent differs');op.at=old.at;}
      s.operations.push(op);s.reserved_ms+=duration;await save(target,s);return {s,m,operation:op,mode:'execute'};
    }
  });
}
export async function runNativeGoalStep(target,goalId,{adapter,signal}={}){
  if(!adapter){const {createCodexGoalAdapter}=await import('./workkeel-goal-runtime.mjs');adapter=await createCodexGoalAdapter();}
  if(!trustedAdapters.has(adapter))fail('qualified trusted goal adapter required');
  const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const cancel=async()=>{
    controller.abort();
    const snapshot=await withProjectMutationLock(target,async()=>{const s=await stateAt(target,goalId);if(s.status!=='done')s.status='cancel-requested';await save(target,s);return s;});
    const unknown=[];
    for(const op of snapshot.operations.filter(o=>['running','intent','unknown'].includes(o.status))){
      if(op.kind==='native'){if(live(op.owner))unknown.push(op.id);continue;}
      const m=snapshot.manifest_frozen,component=m.components.find(c=>c.id===op.input.component_id);
      try{
        await countLoopOperation('host-cancel',target,{cancellation:true});
        const result=await adapter.cancel({target,goal:goalId,controller:snapshot.controller,manifest:m,manifest_sha256:snapshot.manifest_sha256,component,operation_id:op.id,input:op.input,task:op.input.task_snapshot,signal:controller.signal});
        if(result?.status!=='cancelled'){unknown.push(op.id);continue;}
        await withProjectMutationLock(target,async()=>{const s=await stateAt(target,goalId),stored=s.operations.find(o=>o.id===op.id);stored.result={...stored.result,cancellation:result};stored.status='completed';stored.owner=null;await save(target,s);});
      }catch{unknown.push(op.id);}
    }
    await withProjectMutationLock(target,async()=>{const s=await stateAt(target,goalId);if(s.status!=='done')s.status=unknown.length?'cancel-requested':'cancelled';await save(target,s);});
    return unknown;
  };
  try{return await withLoopRun(target,goalId,adapter,async()=>{const run=await readLoopRun(target);if(isLoopRunActive(run)){const m=(await stateAt(target,goalId)).manifest_frozen;if(m.components.some(c=>c.root!==target)||m.admission||m.derived_from)fail('L2 requires one project and one goal without admission');}return runGoalStep(target,goalId,{adapter,signal:controller.signal});},cancel);}
  finally{signal?.removeEventListener('abort',abort);}
}
async function runGoalStep(target,goalId,{adapter,signal}={}){
  if(!adapter){const {createCodexGoalAdapter}=await import('./workkeel-goal-runtime.mjs');adapter=await createCodexGoalAdapter();}
  if(!trustedAdapters.has(adapter))fail('qualified trusted goal adapter required');
  if(signal?.aborted)return {idle:'aborted',model_called:false};
  const reservation=await reserve(target,goalId,adapter,signal);if(reservation.idle)return reservation;
  const {operation:op,m,s}=reservation,component=m.components.find(c=>c.id===op.input.component_id);
  const started_at=new Date().toISOString(),started_clock=performance.now();
  let result;const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});let timer;
  if(signal?.aborted)abort();
  if(op.reserved_ms)timer=setTimeout(abort,op.reserved_ms);
  let effects_started=false;
  try{
    const context={target,goal:s.id,controller:s.controller,manifest:m,manifest_sha256:s.manifest_sha256,component,operation_id:op.id,input:structuredClone(op.input),task:reservation.mode==='cancel'?op.input.task_snapshot:op.kind==='native'?await readNativeTask(op.input.root,op.input.task_id):await componentTask(s,component),signal:controller.signal};
    // Only an intent explicitly retained before any effects may be executed
    // again. Unknown started work continues to reconcile its exact operation.
    if(op.kind==='runtime'&&reservation.mode==='execute'&&op.result?.dispatch_started===false)await adapter.assertCapabilities(context);
    context.mutateNativeTask=(action,request)=>mutateNativeTask(component.root,component.task_id,action,request);
    context.beforeEffects=()=>withProjectMutationLock(target,async()=>{
      const current=await stateAt(target,goalId),stored=current.operations.find(o=>o.id===op.id);
      if(!stored||stored.input_sha256!==op.input_sha256||reservation.mode!=='cancel'&&stored.owner?.token!==op.owner?.token)fail('pre-dispatch operation identity or owner changed');
      const stopping=reservation.mode==='cancel'||op.input.phase==='cancel';
      if(stopping?current.status!=='cancel-requested':!['running','blocked','recovery-required'].includes(current.status))fail('goal control changed before dispatch');
      const root=op.input.root,identity=await rootIdentity(root),approved=current.roots.find(r=>r.root===root);
      if(!approved&&root!==target||approved&&(identity.ino!==approved.ino||identity.dev!==approved.dev))fail('pre-dispatch repository identity changed');
      if(!stopping&&op.kind==='runtime'){
        const task=await componentTask(current,component);
        // Reconciliation deliberately permits the exact operation's native
        // review to have committed before its host response was lost.
        if(reservation.mode==='execute'&&executionDigest(task)!==op.input.task_sha256)fail('component changed before dispatch');
      }
      await standing(target,current,m,{stop:stopping});
      if(controller.signal.aborted)fail('operation aborted before dispatch');
    });
    await context.beforeEffects();
    if(controller.signal.aborted)fail('operation aborted before dispatch');
    effects_started=true;
    if(reservation.mode==='cancel'){await countLoopOperation('host-cancel',target,{cancellation:true});result=await adapter.cancel(context);}
    else if(reservation.mode==='reconcile'){await countLoopOperation('host-reconcile');result=await adapter.reconcile(context);}
    else if(op.kind==='native'){result={status:'completed',native:await mutateNativeTask(op.input.root,op.input.task_id,op.input.action,op.input.request)};}
    else {await countLoopOperation('host-'+op.input.phase);result=await adapter.execute(context);}
  }catch(e){result={status:'unknown',reason:e.message.slice(0,1000)};}
  finally{if(timer)clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  if(!effects_started||reservation.mode==='execute'&&op.kind==='runtime'&&result?.dispatch_started===false&&result.model_called===false)return withProjectMutationLock(target,async()=>{
    const current=await stateAt(target,goalId),stored=current.operations.find(o=>o.id===op.id);
    if(reservation.mode!=='cancel'&&stored?.owner?.token===op.owner?.token&&stored.input_sha256===op.input_sha256){
      stored.owner=null;
      if(reservation.mode==='execute'){
        stored.status='intent';stored.result={status:'attention',reason:result.reason,dispatch_started:false,model_called:false};
        stored.first_result??=structuredClone(stored.result);
      }else stored.status='unknown';
      if(!controller.signal.aborted&&!['paused','cancel-requested','cancelled'].includes(current.status)){
        current.components.find(c=>c.id===component.id).last_error=result.reason;current.last_error=result.reason;
      }
      await save(target,current);
    }
    return {idle:controller.signal.aborted?'aborted':'pre-dispatch-blocked',reason:result.reason,operation:stored,status:current.status,accepted:false,model_called:false};
  });
  const timing={started_at,ended_at:new Date().toISOString(),duration_ms:Math.max(0,Math.round(performance.now()-started_clock)),basis:'goal-adapter-observed-wall-time',mode:reservation.mode};
  return withProjectMutationLock(target,async()=>{
    const current=await stateAt(target,goalId),stored=current.operations.find(o=>o.id===op.id),p=current.components.find(p=>p.id===component.id);
    if(controller.signal.aborted&&['cancel-requested','cancelled'].includes(current.status))return {idle:'loop-stopped',status:current.status,accepted:false,late_result_ignored:true};
    if(stored?.input_sha256===op.input_sha256&&reservation.mode!=='cancel'&&stored.status==='completed'&&stored.result?.status==='cancelled'&&['cancel-requested','cancelled'].includes(current.status))return {operation:stored,status:current.status,accepted:false,late_result_ignored:true,model_called:false};
    if(!stored||stored.input_sha256!==op.input_sha256||reservation.mode!=='cancel'&&stored.owner?.token!==op.owner?.token)fail('operation identity or owner changed');
    stored.timing??={execution:null,latest_observation:null,observation_count:0};
    if(reservation.mode==='execute')stored.timing.execution??=timing;
    else {stored.timing.latest_observation=timing;stored.timing.observation_count++;}
    if(!result||!['completed','unknown','cancelled','attention'].includes(result.status))result={status:'unknown',reason:'Invalid host result'};
    if(Buffer.byteLength(formatJson(result))>131072)result={status:'unknown',reason:'Oversized host result; retained source required'};
    if(reservation.mode==='cancel'){
      // A stop observation does not erase the execution it stopped or count as
      // another inference. Preserve measured facts and keep stop proof separate.
      const facts={};for(const key of ['actor','thread_id','operation_id','runtime_selection','product_access','usage','model_called','tool','report_pin']){
        const value=stored.result?.[key]??stored.first_result?.[key];if(value!==undefined)facts[key]=structuredClone(value);
      }
      result={...result,...facts,cancellation:structuredClone(result)};
    }
    stored.first_result??=structuredClone(result);stored.result=result;stored.owner=null;stored.status=result.status==='completed'?'completed':'unknown';
    if(result.status!=='completed'){p.last_error=result.reason??'Uncertain runtime effects require exact reconciliation';current.last_error=p.last_error;if(result.status==='cancelled'&&current.status==='cancel-requested')stored.status='completed';await save(target,current);return {operation:stored,status:current.status,accepted:false,model_called:op.kind==='runtime'&&reservation.mode==='execute'&&result.model_called!==false};}
    p.last_error=null;
    if(op.kind==='native'){
      if(op.input.phase==='rework'){p.failures.push({kind:'review',operation_sha256:executionDigest(stored),revision:p.candidate});p.cycle++;p.phase='repair';p.candidate=null;p.verification=null;p.review_proof=null;}
      if(op.input.phase==='handoff')p.phase='review';
      if(op.input.phase==='close')p.phase='accepted';
    }else{try{
      const deterministic=op.input.phase==='verification'&&result.model_called===false&&result.runtime_selection===null,access=component.purpose==='discovery'||['review','planning','verification'].includes(op.input.phase)?'read':'write';
      if(!sameActor(result.actor,op.input.actor)||typeof result.thread_id!=='string'||result.operation_id!==op.id||!deterministic&&executionDigest(result.runtime_selection)!==executionDigest(op.input.model)||result.product_access!==access){p.last_error='Actual actor, thread, operation, selection or scope proof differs';stored.status='unknown';await save(target,current);return {operation:stored,status:'blocked',accepted:false};}
      if(op.input.phase!=='review'&&!p.threads.includes(result.thread_id))p.threads.push(result.thread_id);
      if(op.input.phase==='review'){
        const task=await componentTask(current,component);
        if(p.threads.includes(result.thread_id)||!task.review||!sameActor(task.review.actor,m.roles.reviewer)||task.review.revision!==p.candidate||task.history.at(-1)?.operation_id!==op.id||!result.authored_request_pin||!await freshPin(component.root,result.authored_request_pin)){p.last_error='Actual distinct reviewer-authored native decision missing';stored.status='unknown';await save(target,current);return {operation:stored,status:'blocked',accepted:false};}
        const authored=JSON.parse((await readTaskFile(component.root,result.authored_request_pin.path)).content);
        if(authored.schema_version!=='workkeel.goal-authored-review/v1'||!sameActor(authored.actor,result.actor)||authored.thread_id!==result.thread_id||authored.operation_id!==op.id||authored.product_access!=='read'||executionDigest(authored.runtime_selection)!==executionDigest(op.input.model)||executionDigest({action:'review',request:authored.native_request})!==task.history.at(-1).request_sha256){p.last_error='Reviewer relay bytes do not match the native authored judgment';stored.status='unknown';await save(target,current);return {operation:stored,status:'blocked',accepted:false};}
        p.review_proof={actor:result.actor,thread_id:result.thread_id,operation_id:op.id,authored_request_pin:result.authored_request_pin};p.phase=task.review.judgment==='pass'?'close':'rework';
      }else if(op.input.phase==='planning')p.phase='implementation';
      else if(['implementation','repair'].includes(op.input.phase)){
        if(!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(result.candidate_revision??''))fail('host must supply exact committed candidate');
        if(component.purpose==='discovery'){
          const task=await componentTask(current,component),pins=await assertRequirementAssessment(component.root,task.contract,result.proposal_report);
          result.source_pins=[...new Map([...(result.source_pins??[]),...pins].map(pin=>[pin.path,pin])).values()];
        }
        p.candidate=result.candidate_revision;p.phase='verification';
      }
      else if(op.input.phase==='verification'){
        array(result.checks,c=>{exactKeys(c,['id','status']);id(c.id);if(!['pass','fail'].includes(c.status))fail('invalid actual check result');},1,16);
        if(executionDigest(result.checks.map(c=>c.id).sort())!==executionDigest(component.checks.map(c=>c.id).sort()))fail('mandatory verification checks missing');
        if(result.candidate_revision!==p.candidate||!Array.isArray(result.evidence)||!result.evidence.length)fail('verification does not bind exact candidate and evidence');
        for(const ref of result.evidence)await readTaskFile(component.root,ref);
        p.verification={checks:result.checks,evidence:result.evidence,integration_pin:result.integration_pin??null};
        if(result.checks.every(c=>c.status==='pass'))p.phase='handoff';
        else{p.failures.push({kind:'verification',operation_sha256:executionDigest(stored),revision:p.candidate});if(p.cycle>=reworkLimit(m,await componentTask(current,component)))p.last_error='Verification rework budget exhausted';else{p.cycle++;p.phase='repair';}}
      }
      const cost=result.usage?.cost_usd;if(Number.isFinite(cost)&&cost>=0)current.known_cost_usd+=cost;else current.cost_complete=false;
      if(m.limits.max_cost_usd!==null&&(!current.cost_complete||current.known_cost_usd>m.limits.max_cost_usd))fail('enforced goal cost evidence unavailable or exceeded');
    }catch(e){stored.status='unknown';stored.result={status:'unknown',reason:e.message.slice(0,1000)};p.last_error=stored.result.reason;await save(target,current);return {operation:stored,status:'blocked',accepted:false};}
    }
    current.last_error=current.components.filter(c=>c.last_error).map(c=>c.id+': '+c.last_error).join('; ')||null;
    await save(target,current);return {operation:stored,status:current.status,accepted:false,model_called:op.kind==='runtime'&&reservation.mode==='execute'&&result.model_called!==false};
  });
}
export async function serveNativeGoal(target,goalId,{adapter,signal,onError=()=>{},onStep=()=>{},reconcile_ms=30000}={}){
  integer(reconcile_ms,10,60000);if(!adapter){const {createCodexGoalAdapter}=await import('./workkeel-goal-runtime.mjs');adapter=await createCodexGoalAdapter();}
  const initial=await readNativeGoal(target,goalId);let closed=false,running=false,observing=false,pending=false,timer=null,lastObserved,runningPromise=null,observingPromise=null,closePromise=null;
  const observation=view=>executionDigest({status:view.state,receipts:view.receipts,components:view.mandatory_components.map(c=>({id:c.id,version:c.task_version,read_status:c.read_status}))});lastObserved=observation(initial);
  const trigger=()=>{if(closed||signal?.aborted)return;if(running){pending=true;return;}if(timer)return;timer=setTimeout(()=>{timer=null;void tick();},20);};
  const tick=()=>{if(closed||running||signal?.aborted)return;if(observing){pending=true;return;}running=true;return runningPromise=(async()=>{try{const result=await runNativeGoalStep(target,goalId,{adapter,signal});await onStep(result);const loop=await readLoopRun(target);if(isLoopRunActive(loop)&&(result.accepted||loop.stop.requested))close();else if(result.operation?.status==='completed')pending=true;}catch(e){onError(e);if((await readLoopRun(target))?.stop.requested)close();}finally{try{lastObserved=observation(await readNativeGoal(target,goalId));}catch(e){onError(e);}running=false;if(pending){pending=false;trigger();}}})();};
  const observe=()=>{if(closed||running||observing)return;observing=true;return observingPromise=(async()=>{try{const next=observation(await readNativeGoal(target,goalId));if(next!==lastObserved){lastObserved=next;trigger();}}catch(e){onError(e);}finally{observing=false;if(pending){pending=false;trigger();}}})();};
  const {watch}=await import('node:fs'),watchers=[];for(const dir of new Set([path.join(target,ROOT,goalId),...initial.manifest.components.map(c=>path.join(c.root,'.ai-org/work-items'))]))try{watchers.push(watch(dir,()=>{void observe();}));}catch(e){if(e.code!=='ENOENT')throw e;}
  const interval=setInterval(trigger,reconcile_ms),close=()=>{
    if(closed)return closePromise;
    closed=true;if(timer)clearTimeout(timer);clearInterval(interval);watchers.forEach(w=>w.close());signal?.removeEventListener('abort',close);signal?.removeEventListener('abort',userStop);
    // Stop scheduling synchronously, then drain state writes, callbacks and reads
    // before callers remove the goal's files. Internal callers must not await this.
    return closePromise=Promise.all([runningPromise,observingPromise]).then(()=>{});
  };
  const userStop=()=>{void requestLoopStop(target,'user-requested').catch(onError);close();};signal?.addEventListener('abort',userStop,{once:true});if(signal?.aborted)userStop();else trigger();return {close,trigger};
}
