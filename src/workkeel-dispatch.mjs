import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {exactKeys, boundedInteger, executionDigest} from './workkeel-execution-policy.mjs';
import {assertTaskExecutionContext, readNativeTask, validateNativeTaskSnapshot} from './workkeel-tasks.mjs';
import {safeDirectory, existsEntry} from './workkeel-project.mjs';
import {withProjectMutationLock} from './project.mjs';
import {durableAtomicCreate, formatJson} from './files.mjs';
import {readTaskFile, readTaskContractInput} from './task-contract.mjs';

const ROOT='.ai-org/dispatch';
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail=message=>{throw new Error(`Dispatch: ${message}`);};
function label(value) {if(typeof value!=='string'||!value.trim()||value.length>160||/[\x00-\x1f\x7f]/.test(value))fail('invalid label');}
function id(value) {if(typeof value!=='string'||!ID.test(value))fail('invalid identifier');}
function repositoryPath(value) {
  if(typeof value!=='string'||value.length>1024||value.trim()!==value||!value||/[\\\x00-\x1f\x7f*?\[\]{}:]/.test(value)||path.posix.isAbsolute(value)||path.win32.isAbsolute(value)||
    value!=='.'&&value.split('/').some(p=>!p||p==='.'||p==='..'))fail('invalid scope path');
}
const under=(file,root)=>root==='.'||file===root||file.startsWith(`${root}/`);
const overlap=(a,b)=>under(a,b)||under(b,a);
function paths(values) {if(!Array.isArray(values)||values.length>128||new Set(values).size!==values.length)fail('invalid scope paths');values.forEach(repositoryPath);}

/** Project-owned aliases, without provider-specific connection or credential handling. */
export function validateDispatchPolicy(policy) {
  exactKeys(policy,['schema_version','models','default_alias','conservative_alias','parallelism']);
  if(policy.schema_version!=='workkeel.dispatch-policy/v1'||!Array.isArray(policy.models)||!policy.models.length||policy.models.length>32)fail('invalid policy');
  boundedInteger(policy.parallelism,1,16,'dispatch parallelism');
  const aliases=new Set();
  for(const model of policy.models) {
    exactKeys(model,['alias','provider','model','reasoning','data_classes']);id(model.alias);label(model.provider);label(model.model);
    if(model.reasoning!==null)label(model.reasoning);
    if(aliases.has(model.alias))fail('duplicate model alias');aliases.add(model.alias);
    if(!Array.isArray(model.data_classes)||!model.data_classes.length||new Set(model.data_classes).size!==model.data_classes.length||model.data_classes.some(x=>!['public','internal'].includes(x)))fail('invalid data classes');
  }
  if(!aliases.has(policy.default_alias)||!aliases.has(policy.conservative_alias))fail('unapproved default alias');
  return policy;
}

/** Classifier output is bounded advisory metadata. High risk always uses the conservative alias. */
export function selectDispatchModel(policy,route={}) {
  validateDispatchPolicy(policy);exactKeys(route,[],['alias','risk','classifier']);
  if(route.risk!==undefined&&!['standard','high'].includes(route.risk))fail('invalid risk');
  if(route.alias!==undefined&&!policy.models.some(m=>m.alias===route.alias))fail('unapproved explicit alias');
  let advisory=null;
  if(route.classifier!==undefined) {
    exactKeys(route.classifier,['alias','eligible'],['name','tier','selection_reason','model_called']);id(route.classifier.alias);
    for(const key of ['name','tier','selection_reason'])if(route.classifier[key]!==undefined)label(route.classifier[key]);
    if(route.classifier.model_called!==undefined&&route.classifier.model_called!==false)fail('classifier must be local advisory metadata');
    if(typeof route.classifier.eligible!=='boolean')fail('invalid classifier eligibility');
    advisory=structuredClone(route.classifier);
  }
  let alias=policy.default_alias,reason='default';
  if(route.alias!==undefined) {alias=route.alias;reason='explicit';}
  else if(advisory) {
    const eligible=policy.models.some(m=>m.alias===advisory.alias)&&advisory.eligible;
    alias=eligible?advisory.alias:policy.conservative_alias;reason=eligible?'classifier-advisory':'conservative-uncertain-classifier';
  }
  if(route.risk==='high') {alias=policy.conservative_alias;reason='conservative-high-risk';}
  return {...structuredClone(policy.models.find(m=>m.alias===alias)),selection_reason:reason,classifier:advisory,policy_sha256:executionDigest(policy)};
}

export function assertDispatchCapability(selection,capabilities) {
  exactKeys(capabilities,['host','models']);label(capabilities.host);
  if(!Array.isArray(capabilities.models)||!capabilities.models.length||capabilities.models.length>128)fail('invalid host capabilities');
  for(const model of capabilities.models) {
    exactKeys(model,['provider','model','reasoning']);label(model.provider);label(model.model);
    if(!Array.isArray(model.reasoning)||!model.reasoning.length||model.reasoning.length>16)fail('invalid reasoning capabilities');
    for(const effort of model.reasoning)if(effort!==null)label(effort);
  }
  if(!capabilities.models.some(m=>m.provider===selection.provider&&m.model===selection.model&&m.reasoning.includes(selection.reasoning)))fail('host capability mismatch; explicit model and reasoning support required');
  return capabilities.host;
}

function nodeShape(node) {
  exactKeys(node,['id','activity_kind','depends_on','read_paths','write_paths']);id(node.id);paths(node.read_paths);paths(node.write_paths);
  if(!['implementation','review','repair','verification','planning'].includes(node.activity_kind))fail('invalid activity kind');
  if(node.activity_kind==='review'&&node.write_paths.length)fail('review must be read-only');
  if(!Array.isArray(node.depends_on)||node.depends_on.length>64||new Set(node.depends_on).size!==node.depends_on.length)fail('invalid dependencies');node.depends_on.forEach(id);
}
const conflicts=(a,b)=>a.write_paths.some(w=>[...b.read_paths,...b.write_paths].some(p=>overlap(w,p)))||b.write_paths.some(w=>a.read_paths.some(p=>overlap(w,p)));

/** One deterministic ready group. The host owns execution, completion and subsequent planning. */
export function planDispatch(policy,{nodes,completed=[],running=[]}) {
  validateDispatchPolicy(policy);
  if(!Array.isArray(nodes)||!nodes.length||nodes.length>64)fail('invalid node bound');nodes.forEach(nodeShape);
  const byId=new Map(nodes.map(n=>[n.id,n]));if(byId.size!==nodes.length)fail('duplicate node');
  for(const node of nodes)if(node.depends_on.some(d=>!byId.has(d)||d===node.id))fail('unknown or self dependency');
  const visited=new Set(),visiting=new Set();
  function visit(key) {if(visiting.has(key))fail('dependency cycle');if(visited.has(key))return;visiting.add(key);byId.get(key).depends_on.forEach(visit);visiting.delete(key);visited.add(key);}
  nodes.forEach(n=>visit(n.id));
  for(const list of [completed,running])if(!Array.isArray(list)||new Set(list).size!==list.length||list.some(k=>!byId.has(k)))fail('invalid execution state');
  if(running.length>policy.parallelism||running.some(k=>completed.includes(k)))fail('invalid running group');
  for(const key of [...completed,...running])if(byId.get(key).depends_on.some(d=>!completed.includes(d)))fail('unsatisfied execution dependency');
  const active=running.map(k=>byId.get(k));
  if(active.some((n,i)=>active.slice(i+1).some(m=>conflicts(n,m))))fail('running scope conflict');
  const ready=[],blocked=[];
  for(const node of nodes) {
    if(completed.includes(node.id)||running.includes(node.id))continue;
    if(node.depends_on.some(d=>!completed.includes(d))) {blocked.push({id:node.id,reason:'dependency'});continue;}
    if([...active,...ready.map(k=>byId.get(k))].some(other=>conflicts(node,other))) {blocked.push({id:node.id,reason:'scope-conflict'});continue;}
    if(active.length+ready.length>=policy.parallelism) {blocked.push({id:node.id,reason:'parallelism'});continue;}
    ready.push(node.id);
  }
  return {ready,blocked,parallelism:policy.parallelism};
}

async function safeScope(target,ref) {
  repositoryPath(ref);if(ref==='.')return;
  let current=target;
  for(const part of ref.split('/')) {
    current=path.join(current,part);
    try {if((await fs.lstat(current)).isSymbolicLink())fail('scope contains symlink');}
    catch(error) {if(error.code==='ENOENT')return;throw error;}
  }
}

/** Record a dispatch intent under the existing task claim. This does not launch a host or grant authority. */
export async function prepareDispatchTicket(targetInput,request) {
  exactKeys(request,['task_id','actor','claim_id','contract_sha256','policy_ref','node','capabilities','operation_id'],['route','display_label']);
  const target=await fs.realpath(targetInput);nodeShape(request.node);
  id(request.operation_id);
  if(request.display_label!==undefined)label(request.display_label);
  repositoryPath(request.policy_ref);
  if(!/^[a-f0-9]{64}$/.test(request.contract_sha256??''))fail('contract digest required');
  return withProjectMutationLock(target,async()=>{
    const task=await assertTaskExecutionContext(target,request.task_id,request),env=task.contract.environment;
    const policyInput=await pinnedPolicy(target,task,request.policy_ref);
    const selected=selectDispatchModel(policyInput.document,request.route);
    const host=assertDispatchCapability(selected,request.capabilities);
    if(task.contract.execution.runtime.kind!=='host-owned'||env.data.model_access!=='approved-connection'||!task.contract.authorization.operations.includes('execute'))fail('approved host execution required');
    if(!selected.data_classes.includes(env.data.classification))fail('model data boundary');
    for(const kind of ['read_paths','write_paths'])for(const ref of request.node[kind]) {
      if(!env[kind].some(root=>under(ref,root)))fail('scope exceeds task contract');
      await safeScope(target,ref);
    }
    const dir=await safeDirectory(target,ROOT,{create:true});
    if(!await existsEntry(target,`${ROOT}/.gitignore`))await durableAtomicCreate(path.join(dir,'.gitignore'),'*\n');
    if((await readTaskFile(target,`${ROOT}/.gitignore`)).content!=='*\n')fail('ignore policy changed');
    const entries=await inventory(target);
    const operationKey=executionDigest({task_id:task.id,operation_id:request.operation_id});
    const existing=entries.find(name=>name.endsWith(`-${operationKey}.json`));
    if(existing) {
      const prior=await readDispatchTicket(target,existing.slice(0,36));
      if(prior.request_sha256!==executionDigest(request))fail('operation replay conflict');
      return prior;
    }
    if(entries.length>=1024)fail('ticket inventory bound');
    const ticket={schema_version:'workkeel.dispatch-ticket/v1',execution_id:randomUUID(),display_label:request.display_label??null,
      operation_id:request.operation_id,request_sha256:executionDigest(request),
      task_id:task.id,task_version:task.version,task_hash:task.history.at(-1).hash,contract_sha256:task.contract_sha256,
      actor:structuredClone(request.actor),claim_id:task.claim.id,created_at:new Date().toISOString(),
      cwd:env.cwd,node:structuredClone(request.node),route:structuredClone(request.route??{}),selected,requested_host:host,host_binding_id:null,
      policy_ref:request.policy_ref,policy_file_sha256:policyInput.digest,policy_parallelism:policyInput.document.parallelism,
      status:'prepared',usage:{input_tokens:null,output_tokens:null,execution_duration_ms:null},authority:'task-claim-only'};
    await durableAtomicCreate(path.join(dir,`${ticket.execution_id}-${operationKey}.json`),formatJson({value:ticket,sha256:executionDigest(ticket)}));
    return ticket;
  });
}

export async function readDispatchTicket(target,executionId) {
  if(typeof executionId!=='string'||!UUID.test(executionId))fail('invalid execution ID');
  const matches=(await inventory(target)).filter(name=>name.startsWith(`${executionId}-`));
  if(matches.length!==1)fail('ticket missing or ambiguous');
  const envelope=JSON.parse((await readTaskFile(target,`${ROOT}/${matches[0]}`)).content);
  exactKeys(envelope,['value','sha256']);
  if(envelope.value?.schema_version!=='workkeel.dispatch-ticket/v1'||envelope.value.execution_id!==executionId||executionDigest(envelope.value)!==envelope.sha256)fail('ticket integrity');
  const ticket=envelope.value;
  exactKeys(ticket,['schema_version','execution_id','display_label','operation_id','request_sha256','task_id','task_version','task_hash','contract_sha256','actor','claim_id','created_at','cwd','node','route','selected','requested_host','host_binding_id','policy_ref','policy_file_sha256','policy_parallelism','status','usage','authority']);
  id(ticket.operation_id);label(ticket.requested_host);if(ticket.display_label!==null)label(ticket.display_label);
  if(!/^[a-f0-9]{64}$/.test(ticket.request_sha256)||ticket.status!=='prepared'||ticket.host_binding_id!==null||ticket.authority!=='task-claim-only'||
    executionDigest(ticket.usage)!==executionDigest({input_tokens:null,output_tokens:null,execution_duration_ms:null})||!Number.isFinite(Date.parse(ticket.created_at)))fail('invalid ticket metadata');
  exactKeys(ticket.actor,['agent_id','principal_id']);id(ticket.actor.agent_id);id(ticket.actor.principal_id);
  nodeShape(ticket.node);
  if(!Number.isSafeInteger(ticket.task_version)||ticket.task_version<1)fail('invalid task version');
  const task=await readNativeTask(target,ticket.task_id),claim=task.history[ticket.task_version-1];
  if(task.contract_sha256!==ticket.contract_sha256||claim?.action!=='claim'||claim.hash!==ticket.task_hash||
    claim.actor.agent_id!==ticket.actor?.agent_id||claim.actor.principal_id!==ticket.actor?.principal_id)fail('historical claim mismatch');
  if(![task.claim?.id,task.delivery?.claim_id,...task.attempts.flatMap(a=>[a.claim?.id,a.delivery?.claim_id])].includes(ticket.claim_id)) {
    // Cancellation can remove the active claim ID. Only an explicitly retained
    // original body, anchored to the current canonical hash chain, can prove it.
    // This read-only proof never makes an ended claim eligible for new execution.
    const ref=`.ai-org/artifacts/${task.id}/dispatch-claim-${claim.hash}.json`;
    if(!await existsEntry(target,ref))fail('historical claim mismatch');
    const snapshot=validateNativeTaskSnapshot((await readTaskContractInput(target,ref)).document,task.id);
    if(snapshot.version!==ticket.task_version||snapshot.state!=='build'||snapshot.contract_sha256!==ticket.contract_sha256||
      snapshot.claim?.id!==ticket.claim_id||snapshot.claim?.actor?.agent_id!==ticket.actor.agent_id||snapshot.claim?.actor?.principal_id!==ticket.actor.principal_id||
      executionDigest(snapshot.history)!==executionDigest(task.history.slice(0,ticket.task_version)))fail('historical claim snapshot mismatch');
  }
  const policyInput=await pinnedPolicy(target,task,ticket.policy_ref);
  if(policyInput.digest!==ticket.policy_file_sha256||executionDigest(policyInput.document)!==ticket.selected.policy_sha256||
    policyInput.document.parallelism!==ticket.policy_parallelism)fail('policy binding changed');
  if(executionDigest(selectDispatchModel(policyInput.document,ticket.route))!==executionDigest(ticket.selected))fail('selected model changed');
  if(ticket.cwd!==task.contract.environment.cwd)fail('task working directory changed');
  for(const kind of ['read_paths','write_paths'])if(ticket.node[kind].some(ref=>!task.contract.environment[kind].some(root=>under(ref,root))))fail('scope exceeds task contract');
  const operationKey=executionDigest({task_id:task.id,operation_id:ticket.operation_id});
  if(matches[0]!==`${executionId}-${operationKey}.json`)fail('operation identity changed');
  return ticket;
}

async function inventory(target) {
  const dir=await safeDirectory(target,ROOT),entries=[];
  for await(const entry of await fs.opendir(dir)) {
    if(entry.name==='.gitignore')continue;
    if(entries.length>=1024||!entry.isFile()||entry.isSymbolicLink()||!UUID.test(entry.name.slice(0,36))||!/^-[a-f0-9]{64}\.json$/.test(entry.name.slice(36)))fail('invalid ticket inventory');
    entries.push(entry.name);
  }
  return entries;
}

async function pinnedPolicy(target,task,ref) {
  repositoryPath(ref);
  if(!task.contract.environment.data.policy_refs.includes(ref))fail('policy must be pinned in task data policy refs');
  const pin=task.authority_pins.find(p=>p.path===ref);
  const input=await readTaskContractInput(target,ref);
  if(!pin||pin.sha256!==input.digest)fail('policy authority pin changed');
  validateDispatchPolicy(input.document);return input;
}

/** The existing host collector owns exact source binding and usage, never this ticket. */
export async function bindDispatchTicket(target,request) {
  exactKeys(request,['execution_id','source'],['capture_turn_from_start','approval_ref','sample_kind']);
  const ticket=await readDispatchTicket(target,request.execution_id);
  const {bindHostUsage}=await import('./workkeel-host-usage.mjs');
  return bindHostUsage(target,{binding_id:ticket.execution_id,dispatch_id:ticket.execution_id,
    task_id:ticket.task_id,actor:ticket.actor,claim_id:ticket.claim_id,contract_sha256:ticket.contract_sha256,
    source:request.source,...Object.fromEntries(['capture_turn_from_start','approval_ref','sample_kind'].filter(k=>request[k]!==undefined).map(k=>[k,request[k]]))});
}
