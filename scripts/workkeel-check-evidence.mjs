import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv from 'ajv';
import {isDeepStrictEqual} from 'node:util';
import {sha256} from '../src/files.mjs';
import {readTaskFile} from '../src/task-contract.mjs';
import {readNativeTask,assertTaskExecutionContext} from '../src/workkeel-tasks.mjs';
import {readTaskProject,assertActor,safeDirectory} from '../src/workkeel-project.mjs';
import {assessNativeTask} from '../src/workkeel-review-assessment.mjs';
import {recordDeliveryCheck,deliveryCheckEnvironment} from './workkeel-delivery-request.mjs';

const text={type:'string',minLength:1,maxLength:2000,pattern:'\\S'};
const digest={type:'string',pattern:'^[a-f0-9]{64}$'};
const revision={type:'string',pattern:'^(?:[a-f0-9]{40}|[a-f0-9]{64})$'};
const name={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$'};
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const list=(items,minItems=0,maxItems=32)=>({type:'array',items,minItems,maxItems,uniqueItems:true});
const nullable=schema=>({anyOf:[schema,{type:'null'}]});
const actor=object({agent_id:text,principal_id:text});
const pin=object({path:text,sha256:digest});
const versions=list(object({name:text,version:text}));
const envNames=list({type:'string',pattern:'^(?:TZ|LANG|LC_ALL|NODE_ENV|CI|NODE_OPTIONS|NODE_PATH|NODE_TEST_CONTEXT|WK_CHECK_[A-Z0-9_]+)$'},0,16);
const inventory=object({tests:list(text,1,16),oracles:list(text,1),inputs:list(text,1),configuration:list(text),packages:versions,environment:envNames});
const environment=object({tests:list(pin,1,16),oracles:list(pin,1),inputs:list(pin,1),configuration:list(pin),packages:versions,
  runtime:list(object({name:text,version:text}),1),tools:list(object({name:text,version:text}),1),command:text});
const selectedEnvironment=list(object({name:text,present:{type:'boolean'},sha256:nullable(digest)}),0,16);
const coverage=list(object({criterion:text,extent:{enum:['complete','partial']}}),1);
const dimensions=object({candidate_revision:revision,contract_sha256:digest,policy_sha256:digest,dependency_snapshot_sha256:nullable(digest)});
const reason=object({code:text,detail:{type:'string',maxLength:8000},blocking:{type:'boolean'}});
const snapshot=object({observed_at:text,task_version:{type:'integer',minimum:1},head_revision:revision,dimensions,
  environment,selected_environment:selectedEnvironment,reasons:list(reason,0,256)});
const hashes={type:'object',minProperties:1,maxProperties:32,propertyNames:text,additionalProperties:digest};
const rawReceipt=object({schema_version:{const:'workkeel.check-receipt/v1'},task_id:name,task_version:{type:'integer',minimum:1},
  status:{enum:['pass','fail','blocked','instrument-failure','invalidated']},exit_code:{type:['integer','null']},
  command:object({executable:text,args:list(text,3,18),cwd:{const:'.'}}),
  output:object({stdout:{type:'string',maxLength:16384},stderr:{type:'string',maxLength:16384},truncated:{type:'boolean'}}),
  execution_started:{type:'boolean'},log_ref:text,files_before:hashes,files_after:nullable(hashes),changed_files:list(text),
  context_error:nullable(text),instrument_error:nullable(text),timed_out:{type:'boolean'},process_exit_confirmed:{type:'boolean'},
  acceptance_granted:{const:false},lifecycle_mutation:{const:false},boundary_enforcement:{const:'host-responsibility'}});
const bundleSchema=object({schema_version:{const:'workkeel.check-evidence/v1'},task_id:name,name,author:actor,inventory,
  coverage:object({contract_sha256:digest,author:actor,criteria:coverage}),
  runtime:object({executable:text,version:text,method:{const:'running-node-process'},observed_at:text}),
  started_at:text,completed_at:nullable(text),state:{enum:['capturing','complete','incomplete']},
  before:snapshot,after:nullable(snapshot),launch_environment:nullable(selectedEnvironment),receipt:nullable(rawReceipt),log:nullable(pin),issues:list(text)});
const captureSchema=object({schema_version:{const:'workkeel.capture-check/v1'},task_id:name,actor,expected_version:{type:'integer',minimum:1},name,inventory,coverage});
const assessSchema={...object({schema_version:{const:'workkeel.assess-checks/v1'},task_id:name,inventory,attempts:list(pin,1,24)}),
  properties:{schema_version:{const:'workkeel.assess-checks/v1'},task_id:name,inventory,attempts:list(pin,1,24),impact_ref:text,confirmation:pin}};
const confirmationSchema=object({schema_version:{const:'workkeel.criterion-confirmation/v1'},task_id:name,candidate_revision:revision,contract_sha256:digest,reviewer:actor,
  criteria:list(object({criterion:text,status:{enum:['confirmed','partial','contradicted','unknown']},evidence:list(pin,1)}),1)});
const ajv=new Ajv({strict:true});
const validators=[captureSchema,assessSchema,bundleSchema,confirmationSchema].map(schema=>ajv.compile(schema));
const keys=['tests','oracles','inputs','configuration'];
const hash=value=>sha256(JSON.stringify(value));
const same=isDeepStrictEqual;
const under=(ref,roots)=>roots.some(root=>root==='.'||ref===root||ref.startsWith(root+'/'));
const exactActor=(a,b)=>a?.agent_id===b?.agent_id&&a?.principal_id===b?.principal_id;
function validate(index,value) {
  if(!validators[index](value)||Buffer.byteLength(JSON.stringify(value))>900*1024)throw Error('Check evidence: invalid bounded versioned input');
}
function checkedInventory(value) {
  const result=structuredClone(value);
  for(const key of keys)result[key].sort();
  result.packages.sort((a,b)=>a.name.localeCompare(b.name));result.environment.sort();
  if(new Set(result.packages.map(p=>p.name)).size!==result.packages.length||
    result.environment.some(n=>/(?:SECRET|TOKEN|PASSWORD|CREDENTIAL|COOKIE|AUTHORIZATION|PRIVATE|KEY)/.test(n)))throw Error('Check evidence: duplicate package or unsafe environment name');
  if(new Set(keys.flatMap(key=>result[key])).size>32)throw Error('Check evidence: at most 32 input files');
  return result;
}
function environmentPins(names,env=deliveryCheckEnvironment()) {
  return names.map(name=>{
    const value=env[name];
    if(value!==undefined&&Buffer.byteLength(value)>4096)throw Error('Check evidence: selected environment value exceeds bound');
    return {name,present:value!==undefined,sha256:value===undefined?null:sha256(value)};
  });
}
async function measuredEnvironment(root,task,inv,read=ref=>readTaskFile(root,ref)) {
  const result={};
  for(const key of keys)result[key]=await Promise.all(inv[key].map(async ref=>{
    if(!under(ref,task.contract.environment.read_paths))throw Error('Check evidence: input outside approved read scope');
    return {path:ref,sha256:(await read(ref)).bytes_digest};
  }));
  result.packages=inv.packages;
  result.runtime=[{name:'node',version:process.version}];result.tools=[{name:'node',version:process.version}];
  result.command=JSON.stringify([process.execPath,'--test','--test-reporter=tap',...inv.tests.map(ref=>'./'+ref)]);
  return result;
}
async function observe(root,taskId,inv) {
  const task=await readNativeTask(root,taskId),environment=await measuredEnvironment(root,task,inv);
  const report=await assessNativeTask(root,taskId,{schema_version:'workkeel.review-assessment-input/v1',current:environment});
  return {observed_at:new Date().toISOString(),task_version:task.version,head_revision:report.repository_observed.head_revision,
    dimensions:report.repository_observed.dimensions,environment,selected_environment:environmentPins(inv.environment),reasons:report.reasons};
}
const snapshotProblems=s=>s.reasons.filter(r=>r.blocking&&!['unlisted-report','irreversible-impact-unknown'].includes(r.code)).map(r=>`original-${r.code}`);
function stableProblems(bundle) {
  const errors=[...bundle.issues,...snapshotProblems(bundle.before)],receipt=bundle.receipt,after=bundle.after;
  if(bundle.state!=='complete'||!bundle.completed_at||!Number.isFinite(Date.parse(bundle.started_at))||
    !Number.isFinite(Date.parse(bundle.completed_at))||Date.parse(bundle.completed_at)<Date.parse(bundle.started_at))errors.push('capture-incomplete');
  if(!after||!bundle.launch_environment||!receipt||!bundle.log)errors.push('original-snapshot-or-receipt-missing');
  if(after) {
    errors.push(...snapshotProblems(after));
    for(const key of ['task_version','head_revision','dimensions','environment','selected_environment'])if(!same(bundle.before[key],after[key]))errors.push(`capture-${key}-changed`);
  }
  const times=[bundle.before.observed_at,bundle.started_at,after?.observed_at,bundle.completed_at].map(Date.parse);
  if(times.some(t=>!Number.isFinite(t))||times.some((t,i)=>i>0&&t<times[i-1])||bundle.runtime.observed_at!==bundle.before.observed_at)errors.push('observation-time-invalid');
  if(!same(bundle.before.selected_environment,bundle.launch_environment))errors.push('launch-environment-changed');
  for(const selection of [bundle.before.selected_environment,after?.selected_environment,bundle.launch_environment].filter(Boolean)) {
    if(!same(selection.map(e=>e.name),bundle.inventory.environment)||selection.some(e=>e.present!==(e.sha256!==null)))errors.push('environment-inventory-mismatch');
  }
  if(bundle.coverage.contract_sha256!==bundle.before.dimensions.contract_sha256||!exactActor(bundle.coverage.author,bundle.author))errors.push('coverage-attribution-mismatch');
  const expectedFiles=Object.fromEntries(keys.flatMap(key=>bundle.before.environment[key].map(p=>[p.path,p.sha256])));
  if(receipt) {
    if(receipt.task_id!==bundle.task_id||receipt.task_version!==bundle.before.task_version||
      receipt.command.executable!==bundle.runtime.executable||bundle.runtime.version!==bundle.before.environment.runtime[0]?.version||
      JSON.stringify([receipt.command.executable,...receipt.command.args])!==bundle.before.environment.command||
      !same(receipt.files_before,expectedFiles)||!same(receipt.files_after,expectedFiles)||receipt.changed_files.length)errors.push('receipt-context-mismatch');
    if(!receipt.execution_started||!receipt.process_exit_confirmed||receipt.timed_out||receipt.instrument_error||receipt.context_error||
      !['pass','fail'].includes(receipt.status)||receipt.exit_code===null||receipt.status==='pass'&&receipt.exit_code!==0||
      receipt.status==='fail'&&receipt.exit_code===0)errors.push('execution-incomplete-or-invalid');
    if(receipt.log_ref!==`.ai-org/artifacts/${bundle.task_id}/${bundle.name}.log`||bundle.log?.path!==receipt.log_ref)errors.push('receipt-log-mismatch');
  }
  return [...new Set(errors)];
}

/** Opt-in capture around the existing recorder, never an alternate executor. */
export async function captureDeliveryCheck(target,input) {
  validate(0,input);input=structuredClone(input);
  const root=await fs.realpath(target),task=await readNativeTask(root,input.task_id),inv=checkedInventory(input.inventory);
  await assertTaskExecutionContext(root,task.id,{actor:input.actor,claim_id:task.claim?.id,contract_sha256:task.contract_sha256});
  if(task.version!==input.expected_version)throw Error('Check evidence: stale task version');
  if(new Set(input.coverage.map(c=>c.criterion)).size!==input.coverage.length||input.coverage.some(c=>!task.contract.acceptance.criteria.includes(c.criterion)))throw Error('Check evidence: exact approved criteria required');
  const directory=`.ai-org/artifacts/${task.id}`,ref=`${directory}/${input.name}.json`,logRef=`${directory}/${input.name}.log`;
  for(const p of [ref,logRef])if(!under(p,task.contract.environment.write_paths)||!under(p,task.contract.environment.read_paths))throw Error('Check evidence: artifact outside approved read/write scope');
  const before=await observe(root,task.id,inv);
  await safeDirectory(root,directory,{create:true});
  const handle=await fs.open(path.join(root,ref),'wx',0o600);
  const started=new Date().toISOString();
  const bundle={schema_version:'workkeel.check-evidence/v1',task_id:task.id,name:input.name,author:input.actor,inventory:inv,
    coverage:{contract_sha256:task.contract_sha256,author:input.actor,criteria:input.coverage},
    runtime:{executable:process.execPath,version:process.version,method:'running-node-process',observed_at:before.observed_at},
    started_at:started,completed_at:null,state:'capturing',before,after:null,launch_environment:null,receipt:null,log:null,issues:[]};
  let persisted=null;
  const persist=async()=>{
    validate(2,bundle);const bytes=JSON.stringify(bundle,null,2)+'\n';
    if(persisted&&(await readTaskFile(root,ref)).bytes_digest!==persisted)throw Error('Check evidence: reserved bundle changed');
    // This handle owns the exclusively reserved new file. No existing capture is replaced.
    await handle.truncate(0);await handle.write(bytes,0,'utf8');await handle.sync();
    if((await readTaskFile(root,ref)).bytes_digest!==sha256(bytes))throw Error('Check evidence: reserved bundle changed');
    persisted=sha256(bytes);
    return {path:ref,sha256:sha256(bytes)};
  };
  try {
    await persist();
    try {
      bundle.receipt=await recordDeliveryCheck(root,{task_id:task.id,actor:input.actor,expected_version:input.expected_version,name:input.name,
        tests:inv.tests,files:[...new Set(keys.flatMap(key=>inv[key]))]},
      {observeEnvironment:env=>{bundle.launch_environment=environmentPins(inv.environment,env);}});
      bundle.log={path:bundle.receipt.log_ref,sha256:(await readTaskFile(root,bundle.receipt.log_ref)).bytes_digest};
      bundle.after=await observe(root,task.id,inv);bundle.state='complete';
    } catch {
      bundle.state='incomplete';bundle.issues.push('capture-operation-failed');
      // The environment hook runs only after this invocation has exclusively
      // created its log. Preserve that log if completion could not be captured.
      if(bundle.launch_environment&&!bundle.log)try {bundle.log={path:logRef,sha256:(await readTaskFile(root,logRef)).bytes_digest};}catch { /* missing stays incomplete */ }
    }
    bundle.completed_at=new Date().toISOString();
    const pin=await persist(),problems=stableProblems(bundle);
    return {schema_version:'workkeel.capture-check-result/v1',task_id:task.id,status:problems.length?'incomplete':bundle.receipt.status,
      bundle:pin,log:bundle.log,issues:problems,acceptance_granted:false,lifecycle_mutation:false};
  } finally {await handle.close();}
}

/** Read only caller-listed captures. Local pins attribute bytes, not authenticity. */
export async function assessDeliveryChecks(target,input) {
  validate(1,input);input=structuredClone(input);
  if(new Set(input.attempts.map(p=>p.path)).size!==input.attempts.length)throw Error('Check evidence: duplicate attempt paths');
  const root=await fs.realpath(target),taskRef=`.ai-org/work-items/${input.task_id}.json`;
  // Pin before reading the records used for attribution, not afterward: a change
  // between those reads must not become the new baseline for an old review.
  const initialTask=(await readTaskFile(root,taskRef)).bytes_digest;
  const initialLock=(await readTaskFile(root,'workkeel.lock')).bytes_digest;
  const task=await readNativeTask(root,input.task_id),project=await readTaskProject(root),inv=checkedInventory(input.inventory);
  const reads=new Map();
  const read=async ref=>{
    if(!under(ref,task.contract.environment.read_paths))throw Error('Check evidence: outside approved read scope');
    const file=await readTaskFile(root,ref);
    if(reads.has(ref)&&reads.get(ref)!==file.bytes_digest)throw Error('Check evidence: concurrent input change');
    reads.set(ref,file.bytes_digest);return file;
  };
  // Framework authority files are read by the existing assessor; retain their byte
  // pins here too so confirmation cannot survive a review changed mid-observation.
  const pinned=async p=>{const file=await read(p.path);if(file.bytes_digest!==p.sha256)throw Error('Check evidence: bytes changed');return file;};
  const current=await measuredEnvironment(root,task,inv,read),currentSelected=environmentPins(inv.environment);
  const observations=await assessNativeTask(root,task.id,{schema_version:'workkeel.review-assessment-input/v1',current});
  const currentCandidate=observations.repository_observed.dimensions.candidate_revision;
  const attempts=[],measurements=[],blockers=[],seen=new Set();
  for(const p of input.attempts) {
    let bundle;
    try {
      const file=await pinned(p);bundle=JSON.parse(file.content);
      if(bundle.schema_version==='workkeel.check-receipt/v1')throw Error('legacy');
      validate(2,bundle);checkedInventory(bundle.inventory);
      if(bundle.task_id!==task.id||p.path!==`.ai-org/artifacts/${task.id}/${bundle.name}.json`||seen.has(bundle.name))throw Error('identity');
      for(const s of [bundle.before,bundle.after].filter(Boolean))for(const key of keys)for(const pin of s.environment[key])
        if(!under(pin.path,task.contract.environment.read_paths))throw Error('scope');
      seen.add(bundle.name);
    } catch {
      const legacy=bundle?.schema_version==='workkeel.check-receipt/v1';
      attempts.push({bundle:p,status:legacy?'legacy-incomplete':'unavailable',issues:[legacy?'original-snapshot-missing:fresh-capture-required':'invalid-missing-or-changed-bundle']});
      blockers.push(`Unresolved retained attempt: ${p.path}`);continue;
    }
    const problems=stableProblems(bundle),historical=bundle.before.dimensions.candidate_revision!==currentCandidate;
    if(!same(bundle.inventory,inv))problems.push('inventory-mismatch');
    if(!same(bundle.launch_environment,currentSelected))problems.push('selected-environment-mismatch');
    const actualInventoryPaths=Object.fromEntries(keys.map(key=>[key,bundle.before.environment[key].map(p=>p.path)]));
    if(keys.some(key=>!same(actualInventoryPaths[key],bundle.inventory[key]))||!same(bundle.before.environment.packages,bundle.inventory.packages))problems.push('original-inventory-mismatch');
    try {
      if(!bundle.log)throw Error('missing');
      const log=await pinned(bundle.log),r=bundle.receipt;
      if(!r||!log.content.endsWith(`Process exit confirmed: ${r.process_exit_confirmed}\n`)||
        !log.content.includes(`\nExit code: ${r.exit_code??'unknown'}\nStatus: ${r.status}\nExecution started: ${r.execution_started}\nCompleted: `))throw Error('inconsistent');
    } catch {problems.push('log-missing-changed-or-inconsistent');}
    const coverage=bundle.coverage.criteria.filter(c=>task.contract.acceptance.criteria.includes(c.criterion));
    if(new Set(bundle.coverage.criteria.map(c=>c.criterion)).size!==bundle.coverage.criteria.length||coverage.length!==bundle.coverage.criteria.length)problems.push('coverage-contract-mismatch');
    const complete=problems.length===0,status=bundle.receipt?.status==='fail'?'fail':complete?'pass':'incomplete';
    const row={bundle:p,name:bundle.name,candidate_revision:bundle.before.dimensions.candidate_revision,candidate_status:historical?'historical':'current',
      status,recorded_status:bundle.receipt?.status??'unknown',issues:[...new Set(problems)],coverage_declaration:bundle.coverage};
    attempts.push(row);
    if(problems.length&&!historical)blockers.push(`Incomplete current attempt: ${bundle.name}`);
    if(!bundle.before.dimensions.dependency_snapshot_sha256||!coverage.length)continue;
    measurements.push({id:bundle.name,dimensions:{...bundle.before.dimensions,...bundle.before.environment},coverage,status,
      provenance:{kind:'captured',source:p.path,actor:bundle.author,files:[p,...(bundle.log?[bundle.log]:[])],completed:complete,exit_code:bundle.receipt?.exit_code??null}});
  }
  let confirmations=task.contract.acceptance.criteria.map(criterion=>({criterion,status:'unknown',reviewer:null,evidence:[]}));
  const confirmationIssues=[];
  let confirmationBinding='unresolved';
  if(input.confirmation)try {
    const file=await pinned(input.confirmation),document=JSON.parse(file.content);validate(3,document);
    assertActor(project.policy,document.reviewer);
    if(!task.review||!task.delivery||document.task_id!==task.id||document.contract_sha256!==task.contract_sha256||
      document.candidate_revision!==currentCandidate||document.candidate_revision!==task.review.revision||task.delivery.revision!==task.review.revision||
      !exactActor(document.reviewer,task.review.actor)||document.reviewer.agent_id===task.delivery.implementer.agent_id||
      (project.policy.review_separation==='distinct-principal'||task.contract.verification.separation==='distinct-principal')&&document.reviewer.principal_id===task.delivery.implementer.principal_id||
      !task.review.evidence.some(p=>p.path===input.confirmation.path))throw Error('review binding');
    if(new Set(document.criteria.map(c=>c.criterion)).size!==document.criteria.length||document.criteria.some(c=>!task.contract.acceptance.criteria.includes(c.criterion)))throw Error('criteria');
    for(const row of document.criteria)for(const p of row.evidence) {
      const support=await pinned(p);
      if(p.path===input.confirmation.path||!task.review.evidence.some(e=>e.path===p.path))throw Error('support not bound to review');
    }
    confirmations=confirmations.map(row=>{
      const declaration=document.criteria.find(c=>c.criterion===row.criterion);
      return declaration?{...declaration,reviewer:document.reviewer}:row;
    });
    confirmationBinding='current-pinned-distinct-review';
  } catch {confirmationIssues.push('confirmation-unavailable-or-not-bound-to-current-distinct-review');}
  const recheck=async()=>{
    const changes=[];
    for(const [ref,expected] of reads)try {if((await readTaskFile(root,ref)).bytes_digest!==expected)throw Error('changed');}
    catch {changes.push(`Evidence changed during assessment: ${ref}`);}
    try {
      if((await readTaskFile(root,taskRef)).bytes_digest!==initialTask||(await readTaskFile(root,'workkeel.lock')).bytes_digest!==initialLock||!same(environmentPins(inv.environment),currentSelected))throw Error('changed');
    } catch {changes.push('Authority or selected environment changed during assessment');}
    return changes;
  };
  const beforeChanges=await recheck();blockers.push(...beforeChanges);
  const assessment=await assessNativeTask(root,task.id,{schema_version:'workkeel.review-assessment-input/v1',current,measurements,blockers,
    ...(input.impact_ref?{impact_ref:input.impact_ref}:{})});
  const afterChanges=await recheck();
  if(afterChanges.length) {
    // Only downgrade the observer on a late change; never recompute an affirmative
    // result from newer files or transplant the original observations.
    assessment.route='blocked';
    assessment.reasons.push(...afterChanges.map(detail=>({code:'adapter-concurrent-input-change',detail,blocking:true})));
    for(const m of assessment.measurements)if(m.reuse==='candidate-for-independent-confirmation') {
      m.reuse='ineligible';m.reasons.push('adapter-concurrent-input-change');
    }
    for(const row of assessment.coverage) {
      row.reuse_candidates=[];
      if(row.status==='declared-coverage-awaiting-independent-confirmation')row.status='missing-or-ineligible';
    }
  }
  // A negative outcome or missing declared measurement does not invalidate the
  // reviewer's attributed finding. Changed authority, candidate or pinned review
  // context does, including drift already present before this invocation. Keep
  // unknown future blocking reasons conservative rather than labelling a stale
  // review current merely because its local reads were stable.
  const outcomeOnlyBlocks=new Set(['current-measurement-failed','failed-independent-review','declared-blocker','irreversible-impact-unknown']);
  const contextProblems=[...observations.reasons,...assessment.reasons].filter(r=>r.blocking&&!outcomeOnlyBlocks.has(r.code));
  if(beforeChanges.length||afterChanges.length||contextProblems.length) {
    confirmations=confirmations.map(row=>({...row,status:'unknown',reviewer:null,evidence:[]}));
    confirmationBinding='unresolved';
    if(input.confirmation) {
      if(beforeChanges.length||afterChanges.length)confirmationIssues.push('confirmation-withheld-due-to-changing-evidence');
      if(contextProblems.length)confirmationIssues.push('confirmation-withheld-due-to-invalid-review-context',
        ...new Set(contextProblems.map(r=>`confirmation-context:${r.code}`)));
    }
  }
  return {schema_version:'workkeel.check-evidence-assessment/v1',authority:'observation-only',mutation_status:'no-write',execution_authorized:false,
    attempt_inventory:'caller-listed-only',attempts,current_selected_environment:currentSelected,assessment,criterion_confirmation:confirmations,confirmation_binding:confirmationBinding,confirmation_issues:confirmationIssues,
    limitations:['The caller-listed attempts do not prove omitted failures do not exist.',
      'Pins and reviewer records attribute local bytes and declarations; they do not authenticate execution or semantic truth.',
      'Packages and input completeness are author declarations. Only selected environment names are compared; other ambient inputs remain unknown.',
      'Before/after checks are not atomic and cannot detect every transient change. A legacy receipt requires a fresh authorized capture.',
      'Criterion confirmation is a separate attributed review statement, never a route upgrade, reused acceptance, or lifecycle operation.']};
}
