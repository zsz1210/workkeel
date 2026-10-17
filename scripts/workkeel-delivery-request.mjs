import {execFile} from 'node:child_process';
import {promisify,isDeepStrictEqual} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import {readTaskFile} from '../src/task-contract.mjs';
import {sha256} from '../src/files.mjs';
import {runSupervisedCommand} from '../src/delivery-check.mjs';
import {readNativeTask,assertTaskExecutionContext} from '../src/workkeel-tasks.mjs';
import {readTaskProject,assertActor,assertApprover,safeDirectory} from '../src/workkeel-project.mjs';
import {exactKeys} from '../src/workkeel-execution-policy.mjs';

const FIELDS={claim:[],handoff:['summary','evidence','unresolved'],review:['judgment','summary','evidence'],close:['summary','rollback','evidence']};
const STATE={claim:'intake',handoff:'build',review:'test',close:'release_gate'};
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const sameActor=(a,b)=>a.agent_id===b.agent_id&&a.principal_id===b.principal_id;
const text=value=>{if(typeof value!=='string'||!value.trim()||value.length>8000)throw Error('Delivery: bounded nonempty decision text required');};

/** The recorder's launch environment; callers must never serialize this object. */
export function deliveryCheckEnvironment() {
  const env={...process.env};
  for(const key of ['NODE_TEST_CONTEXT','NODE_OPTIONS','NODE_PATH'])delete env[key];
  return env;
}

/** Record an actual Node test command and its input hashes; never accept a task. */
export async function recordDeliveryCheck(target,input,{observeEnvironment}={}) {
  exactKeys(input,['task_id','actor','expected_version','name','tests','files']);
  if(typeof input.name!=='string'||!ID.test(input.name))throw Error('Delivery: explicit check name required');
  if(!Array.isArray(input.files)||!input.files.length||input.files.length>32||new Set(input.files).size!==input.files.length||
     !Array.isArray(input.tests)||!input.tests.length||input.tests.length>16||new Set(input.tests).size!==input.tests.length||input.tests.some(f=>!input.files.includes(f)))throw Error('Delivery: bounded explicit test and source files required');
  input=structuredClone(input);
  const root=await fs.realpath(target),task=await readNativeTask(root,input.task_id);
  if(input.expected_version!==task.version)throw Error('Delivery: stale observed version');
  const context={actor:input.actor,claim_id:task.claim?.id,contract_sha256:task.contract_sha256};
  await assertTaskExecutionContext(root,task.id,context);
  if(!task.contract.environment.tools.includes('node'))throw Error('Delivery: approved Node tool required');
  if(task.contract.environment.cwd!=='.')throw Error('Delivery: check recording requires repository-root execution scope');
  for(const ref of input.files)if(typeof ref!=='string'||!task.contract.environment.read_paths.some(p=>p==='.'||ref===p||ref.startsWith(p+'/')))throw Error('Delivery: file outside approved read paths');
  const hashes=async()=>Object.fromEntries(await Promise.all(input.files.map(async ref=>[ref,(await readTaskFile(root,ref)).bytes_digest])));
  const before=await hashes(),directory=`.ai-org/artifacts/${task.id}`,logRef=`${directory}/${input.name}.log`;
  if(!task.contract.environment.write_paths.some(p=>p==='.'||logRef===p||logRef.startsWith(p+'/')))throw Error('Delivery: log outside approved write paths');
  await safeDirectory(root,directory,{create:true});
  // Exclusive creation preserves older evidence and reserves the name before execution.
  const handle=await fs.open(path.join(root,logRef),'wx',0o600);
  const args=['--test','--test-reporter=tap',...input.tests.map(f=>'./'+f)];
  const quote=s=>/^[A-Za-z0-9_./:=+-]+$/.test(s)?s:JSON.stringify(s);
  const header=`Command: node ${args.map(quote).join(' ')}\nExecutable: ${process.execPath}\nStarted: ${new Date().toISOString()}\nTask: ${task.id} version ${task.version}\nState: running; no completion recorded yet\n`+Object.entries(before).map(([p,h])=>`SHA256 ${p} ${h}\n`).join('');
  try {
    await handle.writeFile(header);await handle.sync();
    const env=deliveryCheckEnvironment();
    // Internal adapter hook observes the exact launch copy without changing it.
    if(observeEnvironment)observeEnvironment(Object.freeze({...env}));
    let startBlocked=false;
    const measured=await runSupervisedCommand({executable:process.execPath,args,cwd:root,env},{timeout_ms:60000,output_limit_bytes:512*1024,hooks:{started:async()=>{
      try {
        const current=await assertTaskExecutionContext(root,task.id,context);
        if(current.version!==task.version||!isDeepStrictEqual(before,await hashes()))throw Error('changed');
      } catch {startBlocked=true;throw Error('check-input-or-authority-changed-before-start');}
    }}});
    let after=null,contextError=null;
    try {
      after=await hashes();
      const current=await assertTaskExecutionContext(root,task.id,context);
      if(current.version!==task.version)contextError='task-version-changed';
    } catch {contextError='task-context-or-files-changed';}
    const changed=after?input.files.filter(p=>before[p]!==after[p]):input.files;
    if(!measured.execution_started&&!startBlocked)measured.instrument_error??='command-start-unconfirmed';
    if(measured.execution_started&&!Number.isInteger(measured.exit_code))measured.instrument_error??='command-exit-unconfirmed';
    const status=startBlocked?'blocked':measured.instrument_error||measured.timed_out||!measured.process_exit_confirmed||measured.surviving_descendants?'instrument-failure':
      contextError||changed.length?'invalidated':measured.exit_code===0?'pass':'fail';
    const footer=`\nSTDOUT\n${measured.stdout}\nSTDERR\n${measured.stderr}\nExit code: ${measured.exit_code??'unknown'}\nStatus: ${status}\nExecution started: ${measured.execution_started}\nCompleted: ${new Date().toISOString()}\nContext error: ${contextError??'none'}\nChanged files: ${JSON.stringify(changed)}\nInstrument error: ${measured.instrument_error??'none'}\nTimed out: ${measured.timed_out}\nProcess exit confirmed: ${measured.process_exit_confirmed}\n`;
    await handle.writeFile(footer);await handle.sync();
    // Detect replacement of the destination rather than reporting a redirected log as evidence.
    if((await readTaskFile(root,logRef)).bytes_digest!==sha256(header+footer))throw Error('Delivery: check log changed while recording');
    const excerpt=value=>new TextDecoder().decode(Buffer.from(value).subarray(0,12*1024),{stream:true});
    return {schema_version:'workkeel.check-receipt/v1',task_id:task.id,task_version:task.version,status,exit_code:measured.exit_code,
      command:{executable:process.execPath,args,cwd:'.'},
      output:{stdout:excerpt(measured.stdout),stderr:excerpt(measured.stderr),truncated:Buffer.byteLength(measured.stdout)>12*1024||Buffer.byteLength(measured.stderr)>12*1024},
      execution_started:measured.execution_started,log_ref:logRef,files_before:before,files_after:after,changed_files:changed,
      context_error:contextError,instrument_error:measured.instrument_error,timed_out:measured.timed_out,process_exit_confirmed:measured.process_exit_confirmed,
      acceptance_granted:false,lifecycle_mutation:false,boundary_enforcement:'host-responsibility'};
  } finally {await handle.close();}
}

/** Operation-specific input contract, not permission or a successful decision. */
export function deliveryOperationGuide(state,review) {
  const action=state==='intake'?'claim':state==='build'?'handoff':state==='test'&&!review?'review':state==='release_gate'?'close':null;
  return {action,input_fields:action?['task_id','action','actor','operation_id',...FIELDS[action]]:[],
    instructions:action?{
      claim:'Read the approved contract and required project instructions; confirm the current Git base before applying.',
      handoff:'Commit and verify the exact candidate. Supply actual evidence and an explicit empty unresolved list only when work is ready.',
      review:'The actual distinct reviewer inspects the delivered candidate and supplies its own judgment, summary and evidence.',
      close:'The authorized approver supplies the acceptance summary, rollback and evidence after independent review.'
    }[action]:'No supported preparation step; inspect the current task for explicit rework, cancellation or completed status.',
    required_reading:['Project instructions and WORKKEEL.md','Approved task contract and its referenced authority','Evidence needed for the current operation'],
    reference:'docs/operations/workkeel-native-dispatch.md#prepare-a-lifecycle-request'};
}

/** Fill mechanical fields only. The native mutation API remains the final gate. */
export async function prepareDeliveryRequest(target,input) {
  if(!input||!Object.hasOwn(FIELDS,input.action))throw Error('Delivery: unsupported preparation action');
  const {action}=input;
  exactKeys(input,['task_id','action','actor','operation_id',...FIELDS[action]]);
  if(typeof input.operation_id!=='string'||!ID.test(input.operation_id))throw Error('Delivery: explicit operation ID required');
  const task=await readNativeTask(target,input.task_id),project=await readTaskProject(target);
  assertActor(project.policy,input.actor);
  if(task.history.some(row=>row.operation_id===input.operation_id))throw Error('Delivery: operation ID already recorded; inspect history and retry the original saved request');
  if(task.state!==STATE[action])throw Error('Delivery: operation does not match current task stage');
  if(action==='claim'&&(task.claim||!sameActor(input.actor,task.contract.actor)))throw Error('Delivery: approved unclaimed task actor required');
  if(action==='handoff'&&(!task.claim||!sameActor(input.actor,task.claim.actor)))throw Error('Delivery: current matching implementation claim required');
  if(action==='review') {
    if(!task.delivery||task.review)throw Error('Delivery: candidate is not awaiting review');
    const implementer=task.delivery.implementer;
    if(input.actor.agent_id===implementer.agent_id||task.contract.verification.separation==='distinct-principal'&&input.actor.principal_id===implementer.principal_id)throw Error('Delivery: reviewer separation required');
    if(!['pass','fail'].includes(input.judgment))throw Error('Delivery: actual review judgment required');
  }
  if(action==='close') {
    assertApprover(project.policy,input.actor);
    if(!task.delivery||task.review?.judgment!=='pass'||task.review.revision!==task.delivery.revision)throw Error('Delivery: exact passing review required');
  }
  for(const field of ['summary','rollback'])if(Object.hasOwn(input,field))text(input[field]);
  if(Object.hasOwn(input,'evidence')&&(!Array.isArray(input.evidence)||!input.evidence.length||input.evidence.some(ref=>typeof ref!=='string'||!ref.trim())))throw Error('Delivery: explicit evidence references required');
  if(action==='handoff'&&(!Array.isArray(input.unresolved)||input.unresolved.length))throw Error('Delivery: resolve outstanding issues before preparing handoff');
  const request={operation_id:input.operation_id,expected_version:task.version,actor:{...input.actor}};
  if(action==='claim'||action==='handoff') {
    const {stdout}=await promisify(execFile)('git',['-C',target,'rev-parse','--verify','HEAD'],{maxBuffer:4096,timeout:5000});
    const revision=stdout.trim();
    if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision))throw Error('Delivery: exact Git revision required');
    if(action==='claim')request.base_revision=revision;
    else {request.claim_id=task.claim.id;request.revision=revision;}
  } else request.revision=task.delivery.revision;
  for(const field of FIELDS[action])request[field]=Array.isArray(input[field])?[...input[field]]:input[field];
  return {schema_version:'workkeel.delivery-request/v1',authority:'observation-only',mutation_status:'no-write',execution_authorized:false,
    task_id:task.id,action,request,validation_status:'native-apply-required',
    limitations:['Save and inspect request before using the existing native task command; preparation does not perform the operation.',
      'Native apply rechecks authority, version, candidate, scope, evidence, dependencies and reviewer separation. A prepared request is not verification or acceptance.',
      'Do not regenerate after an uncertain write. Inspect history and replay the identical saved request; changed input requires a new operation ID.']};
}
