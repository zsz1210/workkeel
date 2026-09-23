// Repository-only continuity experiment. Importing this module never launches Codex.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Ajv from 'ajv';
import { createJsonRpcProcess } from '../src/codex-app-server-provider.mjs';
import { digest, subprocessEnvironment, files } from './delivery-control-pair.mjs';
import { readInstalledContinuitySchemas } from './continuity-codex-adapter.mjs';
import {deliveryProtocol,deliveryContinuation,deliveryRequests,deliveryCompletion,assessDeliveryCompletion} from './continuity-delivery-contract.mjs';
import {assessmentDecision} from './evaluation-sequence.mjs';
import {createCommandObservations,requestByteObservation,qualifyNativeObservations} from './continuity-observations.mjs';
import { namedPermissionArguments } from './continuity-named-permissions.mjs';
import { normalizeTokenUsage } from '../src/app-server-protocol-replay.mjs';
import { createContinuityPair, assessContinuityCandidate,referenceQuote,recordContinuityControl } from './continuity-fixture.mjs';

const exec = promisify(execFile);
const check = (ok, code) => { if (!ok) throw Error(code); };
export const envelope = Object.freeze({ model:'gpt-5.6-terra', effort:'medium', subjects:4,
  subject_tokens:100000, subject_ms:480000, total_tokens:400000, total_ms:2400000,
  retries:0, fallback:false, purchase:false, reset:false });
// One pair per requirement condition. Reverse arm order in the second pair;
// this is a small diagnostic, not replicated or randomized statistical evidence.
export const matrixConditions=Object.freeze(['stable','changed-spec']);
export const instructionComparisonProtocol = 'continuity-instructions-approved/v1';
export const instructionComparisonEnvelope = Object.freeze({...envelope,subjects:6,total_tokens:600000,total_ms:3600000});
// Missing-treatment screen only. Historical controls remain separate evidence;
// this never resumes a sealed matrix or grants an arbitrary subject selection.
export const incrementalProtocol = 'continuity-incremental-approved/v1';
export const incrementalEnvelope = Object.freeze({...envelope,subjects:2,total_tokens:200000,total_ms:1200000});
export const previousInstructionRevision = '4c606f7113600caeec04daf29477daa17b07409c';
export const instructionPaths = Object.freeze(['AGENTS.md','TEMPLE.md','.agents/skills/temple-work/SKILL.md',
  '.agents/skills/temple-work/references/lean-execution.md']);
const instructionMatrix = p => p.version === instructionComparisonProtocol;
const incrementalMatrix = p => p.version === incrementalProtocol;
const matrixLimits = p => incrementalMatrix(p) ? incrementalEnvelope : instructionMatrix(p) ? instructionComparisonEnvelope : envelope;
const matrixArms = (p,index) => incrementalMatrix(p) ? ['temple'] : instructionMatrix(p)
  ? (index===0?['ordinary','temple_previous','temple']:['temple','temple_previous','ordinary'])
  : (index===0?['ordinary','temple']:['temple','ordinary']);
const fixtureKey = s => s.variant ?? s.arm;
export function assertInstructionOnlyRuntimes(current, previous) {
  const allowed = instructionPaths.map(p=>'project-overlay/'+p);
  const keys = new Set([...Object.keys(current),...Object.keys(previous)]);
  const changed = [...keys].filter(p=>current[p]!==previous[p]).sort();
  check(digest(changed)===digest([...allowed].sort())&&allowed.every(p=>current[p]&&previous[p]),'instruction-treatment-confounded');
  return {previous_revision:previousInstructionRevision,changed_paths:changed,
    instructions:allowed.map(p=>({path:p,current:current[p],previous:previous[p]}))};
}
export async function preparePreviousInstructionRuntime(bundle, target) {
  // Coordinator-owned fresh runtime: same executable code, only pinned old
  // distribution instructions. No actor sees coordinator Git or the other arm.
  // Reserve the target atomically: Node's recursive cp may otherwise merge an
  // existing directory even with errorOnExist.
  await fs.mkdir(path.dirname(target),{recursive:true});
  try {
    await fs.mkdir(target);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const collision = new Error(`Previous-instruction runtime target already exists: ${target}`,{cause:error});
    collision.code = 'ERR_FS_CP_EEXIST';
    throw collision;
  }
  await fs.cp(bundle,target,{recursive:true,errorOnExist:true,force:false});
  for(const p of instructionPaths) {
    const {stdout}=await exec('git',['show',`${previousInstructionRevision}:project-overlay/${p}`],
      {cwd:path.resolve(import.meta.dirname,'..'),encoding:'buffer',maxBuffer:1024*1024});
    await fs.writeFile(path.join(target,'project-overlay',p),stdout);
  }
  const current=await files(bundle),previous=await files(target);
  return {...assertInstructionOnlyRuntimes(current,previous),bundle_root:target,bundle_sha256:digest(previous)};
}
export function assertContinuityMatrix(protocol) {
  const width=incrementalMatrix(protocol)?1:instructionMatrix(protocol)?3:2;
  check(Array.isArray(protocol.subjects)&&protocol.subjects.length===width*2&&
    Array.isArray(protocol.pairs)&&protocol.pairs.length===matrixConditions.length,'matrix-size');
  if(incrementalMatrix(protocol))check(!protocol.instruction_comparison&&
    new Set(protocol.subjects.map(s=>s.root)).size===2,'matrix-layout');
  for(const [index,state] of matrixConditions.entries()) {
    for(const [offset,key] of matrixArms(protocol,index).entries()) {
      const arm=key==='ordinary'?'ordinary':'temple';
      const subject=protocol.subjects[index*width+offset];
      check(subject?.pair===index+1&&subject.state===state&&subject.arm===arm&&
        fixtureKey(subject)===key&&subject.root===protocol.pairs[index]?.arms?.[key]?.root,'matrix-layout');
    }
  }
}
export const disabledFeatures = Object.freeze(['memories','external_agent_memory_import','chronicle',
  'hooks','multi_agent','multi_agent_v2','tool_suggest','remote_plugin','plugins','apps',
  'browser_use','browser_use_external','browser_use_full_cdp_access','computer_use',
  'in_app_browser','in_app_chat','in_app_local_automation','image_generation','view_image',
  'workspace_dependencies','code_mode','code_mode_only','code_mode_prewarm',
  'shell_snapshot','goals','request_permissions_tool','unbounded_connection_retries']);
const ownedProfile = 'temple-continuity-probe';
// The first planned subject is a canary, not proof supplied by command/exec.
// Only the frozen current-contract batch may launch a real subject; direct calls stay closed.
export const nativeToolRouteStatus = 'canary-required';
const batchPermit = Symbol('frozen-continuity-batch');
export const liveCompletion = structuredClone(deliveryCompletion);
const safeKey = x => typeof x==='string' && /^[a-zA-Z0-9_@-]{1,160}$/.test(x);
const absolute = x => typeof x==='string' && path.isAbsolute(x) && path.normalize(x)===x && x!==path.parse(x).root;

export async function prepareContinuityRuntime({scratchParent=os.tmpdir(),instructionComparison=false,incremental=false}={}) {
  check(!(instructionComparison&&incremental),'incompatible-matrix-modes');
  const source=path.resolve(import.meta.dirname,'..');
  const lab=await fs.realpath(await fs.mkdtemp(path.join(scratchParent,'temple-continuity-live-')));
  const bundle=path.join(lab,'runtime');await fs.mkdir(bundle);
  // Copy only distributable runtime roots; never grant a read of the instrument,
  // its oracle, other actors, source .git, private reports or coordinator files.
  for(const name of ['bin','src','project-overlay','packs','package.json'])
    await fs.cp(path.join(source,name),path.join(bundle,name),{recursive:true,errorOnExist:true,force:false});
  const dependencies=['ajv','ajv-formats','fast-deep-equal','fast-uri','json-schema-traverse','require-from-string'];
  for(const name of dependencies)await fs.cp(path.join(source,'node_modules',name),path.join(bundle,'node_modules',name),{recursive:true,errorOnExist:true,force:false});
  const bundleManifest=await files(bundle); // rejects symlinks
  const previous=instructionComparison
    ? await preparePreviousInstructionRuntime(bundle,path.join(lab,'runtime-previous')) : null;
  const node=await fs.realpath(process.execPath);
  const libraries=(await exec('/usr/bin/otool',['-L',node],{timeout:2000})).stdout.split('\n').slice(1).map(s=>s.trim().split(' (compatibility version')[0]).filter(Boolean);
  check(libraries.length>0&&libraries.every(p=>p.startsWith('/usr/lib/')||p.startsWith('/System/')),'unsupported-runtime');
  const git=(await exec('/usr/bin/xcrun',['--find','git'],{timeout:3000})).stdout.trim();check(absolute(git),'invalid-git');
  const pair=await createContinuityPair(path.join(lab,'qualification'),'stable');
  const root=pair.arms.temple.root;
  const identities=JSON.parse(await fs.readFile(path.join(root,'.ai-org/project/assignments.json'),'utf8'));
  const agentId=identities.assignments.find(a=>a.position_id==='developer'&&a.active)?.agent_id;
  check(typeof agentId==='string','fixture-developer-missing');
  await fs.mkdir(path.join(root,'.git','runtime-tmp'));
  const binary=(await exec('/usr/bin/which',['codex'],{timeout:2000})).stdout.trim();check(absolute(binary),'invalid-provider-binary');
  const runtime={root,binary,readRoots:[path.dirname(node),path.dirname(git),bundle],
    environment:{PATH:[path.dirname(node),path.dirname(git),'/usr/bin','/bin'].join(':'),OPENSSL_CONF:'/dev/null',
      TMPDIR:path.join(root,'.git','runtime-tmp'),TEMPLE_CLI_PATH:path.join(bundle,'bin','temple.mjs'),
      GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',
      GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'}};
  Object.assign(runtime,await discoverRuntime({root}));
  const prepared={lab,runtime,subject:{root,arm:'temple',itemId:pair.arms.temple.item_id,agentId},bundle_sha256:digest(bundleManifest),
    ...(incremental?{incremental:true}:{})};
  if(instructionComparison)prepared.instruction_comparison=previous;
  await fs.writeFile(path.join(lab,'qualification-runtime.json'),JSON.stringify(prepared,null,2)+'\n',{flag:'wx',mode:0o600});
  return prepared;
}

export function liveArguments({root,readRoots,disabledTools,disabledSkills=[],environment}) {
  check(absolute(root) && Array.isArray(readRoots) && readRoots.every(absolute),'invalid-runtime-roots');
  check(environment && typeof environment.PATH==='string' && environment.OPENSSL_CONF==='/dev/null','missing-runtime-environment');
  const args=namedPermissionArguments(root,readRoots);
  args.push('--enable','code_mode_host','--enable','shell_tool','--enable','unified_exec',
    ...disabledFeatures.flatMap(k=>['--disable',k]),'-c','web_search="disabled"','-c','apps._default.enabled=false',
    '-c','shell_environment_policy.inherit="none"','-c','shell_environment_policy.experimental_use_profile=false',
    '-c',`shell_environment_policy.set={${Object.entries(environment).map(([k,v])=>{check(/^[A-Z_][A-Z0-9_]*$/.test(k)&&typeof v==='string','invalid-shell-environment');return `${k}=${JSON.stringify(v)}`}).join(',')}}`);
  for(const kind of ['mcp_servers','plugins','apps']) {
    const keys=disabledTools?.[kind];check(Array.isArray(keys)&&keys.length<=200&&keys.every(safeKey),'unsupported-inherited-tool-key');
    for(const key of new Set(keys))args.push('-c',`${kind}.${key}.enabled=false`);
  }
  check(disabledSkills.length<=1000 && disabledSkills.every(absolute),'invalid-disabled-skills');
  args.push('-c',`skills.config=[${disabledSkills.map(p=>`{path=${JSON.stringify(p)},enabled=false}`).join(',')}]`);
  return args;
}

export function assertLiveConfiguration(reply, runtime) {
  const c=reply?.config;
  check(c&&disabledFeatures.every(k=>c.features?.[k]===false),'effective-feature-isolation');
  check(['code_mode_host','shell_tool','unified_exec'].every(k=>c.features?.[k]===true),'native-host-disabled');
  check(c.web_search==='disabled'&&c.memories?.use_memories===false&&c.memories?.generate_memories===false,'effective-context-isolation');
  check(c.shell_environment_policy?.inherit==='none'&&c.shell_environment_policy?.experimental_use_profile===false,'effective-shell-isolation');
  for(const [k,v] of Object.entries(runtime.environment))check(c.shell_environment_policy.set?.[k]===v,'effective-shell-environment');
  for(const kind of ['mcp_servers','plugins','apps']) {
    check(c[kind] && typeof c[kind]==='object'&&!Array.isArray(c[kind]),'effective-tool-map-missing');
    check(Object.values(c[kind]).every(v=>v?.enabled===false),'effective-external-tool-enabled');
  }
  check(c.default_permissions===ownedProfile,'effective-profile-mismatch');
  const p=c.permissions?.[ownedProfile];
  check(p?.network?.enabled===false,'effective-command-network');
  // Compare the complete profile, not just the existence of our root grant.
  const expected={':minimal':'read',[runtime.root]:'write',[path.join(runtime.root,'.git')]:'write',
    ...Object.fromEntries(runtime.readRoots.map(p=>[p,'read']))};
  const observed={...p.filesystem};
  if(observed.glob_scan_max_depth===null)delete observed.glob_scan_max_depth;
  check(digest(observed)===digest(expected)&&!p.extends&&!p.workspace_roots,'effective-filesystem-mismatch');
  return true;
}

export function liveRequests(subject) {
  const r=deliveryRequests({...subject,model:envelope.model,effort:envelope.effort});
  delete r.thread.sandbox;delete r.turn.sandboxPolicy;
  r.thread.permissions=ownedProfile;r.turn.permissions=ownedProfile;
  r.thread.config={model_reasoning_effort:envelope.effort};
  // Preserve Codex's native base instructions and native project AGENTS loading.
  r.thread.developerInstructions+=' Do not spawn background or detached processes. Use non-login shells. Runtime tools are on PATH. Do not read any other repository or change permissions.';
  r.thread.developerInstructions+=' If tools or execution are unavailable, stop and report the blocker; use null for an unavailable candidate_revision or test_exit_code. Never invent a commit or test result.';
  r.turn.outputSchema=structuredClone(liveCompletion);
  return r;
}

export function createSubjectLedger({threadId,turnId,remainingTokens,deadline,now=Date.now}) {
  check(typeof threadId==='string'&&typeof turnId==='string'&&Number.isSafeInteger(remainingTokens)&&remainingTokens>0,'invalid-ledger');
  const state={status:'running',first_stop:null,usage:null,completed:null,commands:0,completed_commands:0,file_changes:0,unrecognized_items:0,events:[]};
  const observations=createCommandObservations();state.command_observations=observations.state;
  const stop=reason=>{state.first_stop??=reason;state.status='stopped';};
  const accept=message=>{
    const {method,params:p={}}=message;
    if(now()>=deadline)stop('time-limit');
    if(method==='model/rerouted') {stop('model-rerouted');return;}
    if(method==='model/verification') {stop('unqualified-model-verification');return;}
    if(!['thread/tokenUsage/updated','turn/completed','turn/started','item/started','item/completed'].includes(method))return;
    if(p.threadId!==threadId||(p.turnId??p.turn?.id)!==turnId){stop('event-correlation');return;}
    if(state.events.length>=10000){stop('event-count-limit');return;}
    state.events.push({method,item_type:p.item?.type??null,
      command_sha256:p.item?.type==='commandExecution'?digest([p.item.command,p.item.cwd]):null,
      exit_code:Number.isInteger(p.item?.exitCode)?p.item.exitCode:null,at_ms:now()});
    if(method==='thread/tokenUsage/updated') {
      const u=normalizeTokenUsage(p);
      if(!u||u.cached_input_tokens>u.input_tokens||u.total_tokens!==u.input_tokens+u.output_tokens||u.reasoning_output_tokens>u.output_tokens) {stop('invalid-usage');return;}
      if(state.usage && Object.keys(u).some(k=>u[k]<state.usage[k])) {stop('usage-regression');return;}
      state.usage={...u,operational_tokens:u.input_tokens-u.cached_input_tokens+u.output_tokens};
      if(state.usage.operational_tokens>=Math.min(envelope.subject_tokens,remainingTokens))stop('token-limit');
    }
    if(method==='item/started') {
      const type=p.item?.type;
      if(type==='commandExecution')state.commands++;
      else if(type==='fileChange')state.file_changes++;
      else if(!['userMessage','agentMessage','reasoning','plan'].includes(type)) {state.unrecognized_items++;stop('unexpected-tool-item');}
    }
    if(method==='item/completed'&&p.item?.type==='commandExecution') {
      if(Number.isInteger(p.item.exitCode))state.completed_commands++;
      observations.accept(p.item);
    }
    if(method==='turn/completed') {state.completed=p.turn;if(p.turn.status!=='completed')stop('actor-not-completed');else if(!state.first_stop)state.status='completed';}
  };
  return {state,accept,stop};
}

// Generation-free first: inspect the installed configuration and native discovery.
// Returned bodies stay in memory. Only hashes/counts belong in public evidence.
export async function discoverRuntime({binary='codex',root,providerFactory=createJsonRpcProcess}) {
  let c;
  try {
    c=providerFactory(binary,['app-server','--listen','stdio://','--strict-config'],{cwd:root,env:subprocessEnvironment()});
    await c.request('initialize',{clientInfo:{name:'continuity-discovery',version:'1'},capabilities:{experimentalApi:true}});c.notify('initialized',{});
    const config=await c.request('config/read',{cwd:root,includeLayers:true});
    const skills=await c.request('skills/list',{cwds:[root],forceReload:true});
    const disabledTools=Object.fromEntries(['mcp_servers','plugins','apps'].map(k=>[k,Object.keys(config.config?.[k]??{})]));
    const records=skills.data?.flatMap(g=>g.skills??[]);
    check(Array.isArray(records),'unknown-skills-response');
    const disabledSkills=records.map(s=>s.path).filter(p=>!p.startsWith(root+path.sep));
    check(disabledSkills.every(absolute),'unknown-skill-path');
    return {disabledTools,disabledSkills,configuration_sha256:digest(config),skill_inventory_sha256:digest(skills)};
  } finally {if(c)await c.close();}
}

export async function qualifyThread(subject,runtime,{binary=runtime.binary,providerFactory=createJsonRpcProcess,onDiagnostic=()=>{}}={}) {
  let c,threadId,unexpected=false;
  const result={status:'failed',model_generation_performed:false,server_exit_confirmed:false,live_ready:false};
  try {
    result.last_phase='initialize';
    c=providerFactory(binary,liveArguments(runtime),{cwd:subject.root,env:subprocessEnvironment(runtime.environment),
      onRequest:()=>{unexpected=true;},onProtocolError:()=>{unexpected=true;},
      onNotification:m=>{if(m.method?.startsWith('turn/')||m.method==='thread/tokenUsage/updated')unexpected=true;}});
    c.child?.stderr?.on('data',b=>onDiagnostic(String(b)));
    await c.request('initialize',{clientInfo:{name:'continuity-qualification',version:'1'},capabilities:{experimentalApi:true}});c.notify('initialized',{});
    result.last_phase='config';
    const config=await c.request('config/read',{cwd:subject.root,includeLayers:false});
    assertLiveConfiguration(config,runtime);
    result.last_phase='runtime-controls';
    const node=path.join(runtime.readRoots[0],'node');
    const invoke=async(args)=>c.request('command/exec',{command:['/usr/bin/env','-i',...Object.entries(runtime.environment).map(([k,v])=>`${k}=${v}`),node,...args],
      cwd:subject.root,permissionProfile:ownedProfile,timeoutMs:10000,outputBytesCap:65536},15000);
    const script="try{require('node:fs').readFileSync(process.argv[1]);process.stdout.write('allowed')}catch(e){if(!['EPERM','EACCES'].includes(e.code))process.exit(3);process.stdout.write('denied')}";
    const own=await invoke(['-e',script,path.join(subject.root,'SPEC.md')]);
    const denied=await invoke(['-e',script,path.join(path.dirname(runtime.readRoots[2]),'qualification-runtime.json')]);
    check(own.exitCode===0&&own.stdout==='allowed'&&denied.exitCode===0&&denied.stdout==='denied','runtime-read-controls');
    const cli=await invoke(['templew.mjs','doctor','.','--json']);
    check(cli.exitCode===0,'isolated-temple-runtime');
    result.runtime_controls='passed';
    result.last_phase='account';const account=await c.request('account/read',{refreshToken:false});
    check(account.account?.type==='chatgpt','subscription-required');
    result.last_phase='models';const models=await c.request('model/list',{includeHidden:true});
    check(models.data?.some(m=>m.model===envelope.model&&m.supportedReasoningEfforts?.some(e=>e.reasoningEffort===envelope.effort)),'model-unavailable');
    result.last_phase='thread';const response=await c.request('thread/start',liveRequests(subject).thread);
    threadId=response.thread?.id;
    check(typeof threadId==='string'&&response.model===envelope.model&&response.reasoningEffort===envelope.effort,'thread-settings-mismatch');
    check(response.thread?.turns?.length===0,'not-empty-thread');
    assertThreadBoundary(response,subject);
    const terminals=await c.request('thread/backgroundTerminals/list',{threadId});
    check(Array.isArray(terminals.data)&&terminals.data.length===0&&!terminals.nextCursor,'unexpected-background-terminal');
    result.thread_response_sha256=digest(response);result.terminals_response_sha256=digest(terminals);
    result.thread_response_fields=Object.keys(response);result.terminal_response_fields=Object.keys(terminals);
    result.status='thread-configured';
  } catch(e) {
    onDiagnostic(e.message);if(e.providerReason)onDiagnostic(e.providerReason);
    // Only bounded error codes; no account IDs, prompts, local paths or provider strings.
    result.failure=/^[a-z-]{1,80}$/.test(e.message)?e.message:'provider-or-local-operation-failed';
    if(Number.isInteger(e.rpcCode))result.rpc_code=e.rpcCode;
  } finally {
    if(c&&threadId)try {await c.request('thread/backgroundTerminals/clean',{threadId});}catch{result.cleanup_failure='terminal-cleanup-failed';}
    if(c)try{await c.close();result.server_exit_confirmed=true;}catch{result.cleanup_failure='server-close-failed';}
    if(unexpected){result.failure='unexpected-generation-or-protocol';result.model_generation_performed='unknown';}
    if(result.failure||result.cleanup_failure)result.status='failed';
  }
  return result;
}

export function assertThreadBoundary(reply,subject) {
  check(reply.model===envelope.model&&reply.reasoningEffort===envelope.effort,'thread-settings-mismatch');
  check(reply.activePermissionProfile?.id===ownedProfile&&!reply.activePermissionProfile.extends&&reply.approvalPolicy==='never','thread-permissions-mismatch');
  const sources=reply.instructionSources;
  check(Array.isArray(sources)&&sources.every(p=>typeof p==='string'&&p.startsWith(subject.root+path.sep)),'external-native-instructions');
  if(subject.arm==='temple')check(sources.includes(path.join(subject.root,'AGENTS.md')),'native-instructions-missing');
  check(reply.cwd===subject.root&&reply.thread?.turns?.length===0,'fresh-thread-boundary');
}

export async function isolatedOracleExecutor(runtime,cwd,binary,args,options,{providerFactory=createJsonRpcProcess}={}) {
  check(Number.isSafeInteger(options.timeout)&&options.timeout>0&&options.timeout<=2147478647,'oracle-timeout');
  const environment={...runtime.environment,TMPDIR:cwd};delete environment.TEMPLE_CLI_PATH;
  const restricted={...runtime,root:cwd,readRoots:runtime.readRoots.slice(0,2),environment};
  const processId='continuity-oracle-'+randomUUID(),cleanupMs=5000;
  let c,primary,commandPending=false;
  try {
    c=providerFactory(runtime.binary,liveArguments(restricted),{cwd,env:subprocessEnvironment()});
    await c.request('initialize',{clientInfo:{name:'continuity-oracle',version:'1'},capabilities:{experimentalApi:true}});c.notify('initialized',{});
    assertLiveConfiguration(await c.request('config/read',{cwd,includeLayers:false}),restricted);
    commandPending=true;
    // Let the native command deadline terminate its process group and drain
    // output before the RPC expires. Closing the server first can orphan it.
    const r=await c.request('command/exec',{command:['/usr/bin/env','-i',...Object.entries(environment).map(([k,v])=>`${k}=${v}`),binary,...args],
      cwd,processId,permissionProfile:ownedProfile,timeoutMs:options.timeout,outputBytesCap:options.maxBuffer},options.timeout+cleanupMs);
    check(Number.isInteger(r.exitCode)&&typeof r.stdout==='string'&&typeof r.stderr==='string','oracle-response');
    commandPending=false;
    // Native command timeout uses 124. Treat a candidate choosing that code
    // conservatively too; it must never become a clean assertion/mutant kill.
    return {exit_code:r.exitCode,stdout:r.stdout,stderr:r.stderr,...(r.exitCode===124?{timed_out:true}:{})};
  } catch(error) {primary=error;error.instrumentFailure=true;throw error;}
  finally {
    let cleanupFailure=false;
    // The id belongs only to this connection. A transport failure is never a
    // behavioral timeout, even if terminating the owned session succeeds.
    if(c&&commandPending)try{await c.request('command/exec/terminate',{processId},cleanupMs);}catch{cleanupFailure=true;}
    if(c)try{await c.close();}catch{cleanupFailure=true;}
    if(cleanupFailure){const error=primary??Error('oracle-cleanup-unconfirmed');error.instrumentFailure=true;error.retainScratch=true;error.cleanupFailure='oracle-cleanup-unconfirmed';throw error;}
  }
}

export async function runContinuitySubject(subject,runtime,{remainingTokens,deadline,schemas,providerFactory=createJsonRpcProcess,signal,permit}={}) {
  check(providerFactory!==createJsonRpcProcess||permit===batchPermit,'native-tool-route-unqualified');
  let c,threadId,turnId,ledger,completion,turnStart=null,closing=false,earlyStop=null;
  let wake,wakeTerminal,wakeStop;const terminal=new Promise(r=>{wake=r});const terminalObserved=new Promise(r=>{wakeTerminal=r});const stopped=new Promise(r=>{wakeStop=r});const pending=[];
  const start=Date.now();deadline=Math.min(deadline,start+envelope.subject_ms);
  const observation={status:'stopped',generation_requested:false,usage:null,first_stop:null,server_exit_confirmed:false,terminals_empty:false};
  const stop=code=>{earlyStop??=code;ledger?.stop(code);wakeStop();wake();};
  const cancel=()=>stop('operator-cancelled');
  signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted)cancel();
  const consume=m=>{
    if(closing)return;
    if(!ledger) {
      if(turnStart){
        if(pending.length>=10000)stop('event-count-limit');else pending.push(m);
        // Bind from correlated native events even before turn/start returns so
        // token and tool guards stay active during a delayed dispatch response.
        const eventTurn=m.params?.turnId??m.params?.turn?.id;
        if(m.params?.threadId===threadId&&typeof eventTurn==='string') {
          turnId=eventTurn;ledger=createSubjectLedger({threadId,turnId,remainingTokens,deadline});if(earlyStop)ledger.stop(earlyStop);
          const queued=pending.splice(0);for(const event of queued)consume(event);
        } else if(m.method==='model/rerouted')stop('model-rerouted');
        else if(m.method==='model/verification')stop('unqualified-model-verification');
      }return;
    }
    ledger.accept(m);
    if(ledger.state.first_stop)stop(ledger.state.first_stop);
    if(ledger.state.completed)wakeTerminal();
    if(m.method==='item/completed'&&m.params?.item?.type==='agentMessage')completion=m.params.item.text;
    if(ledger.state.first_stop||ledger.state.completed)wake();
  };
  const timer=setTimeout(()=>stop('time-limit'),Math.max(1,deadline-Date.now()));
  try {
    check(!earlyStop,earlyStop);
    c=providerFactory(runtime.binary,liveArguments(runtime),{cwd:subject.root,env:subprocessEnvironment(runtime.environment),
      onNotification:consume,onProtocolError:()=>stop('invalid-protocol'),onRequest:()=>stop('unexpected-server-request'),
      onExit:()=>{if(!closing&&!ledger?.state.completed)stop('provider-exit');}});
    const request=async(method,params)=>{
      check(!earlyStop,earlyStop);
      const response=c.request(method,params,Math.max(1,deadline-Date.now()));
      const outcome=await Promise.race([response.then(value=>({value})),stopped.then(()=>({cancelled:true}))]);
      if(outcome.cancelled) {
        if(method==='turn/start') {
          let reconciliationTimer;
          const late=await Promise.race([response.then(value=>({value}),()=>({})),new Promise(r=>{reconciliationTimer=setTimeout(()=>r({}),2000)})]);
          clearTimeout(reconciliationTimer);
          if(late.value)return late.value;
          // Queued events might precede the abort itself.
          const queued=pending.splice(0);for(const event of queued)consume(event);
        }
        throw Error(earlyStop);
      }
      if(method!=='turn/start')check(!earlyStop,earlyStop);return outcome.value;
    };
    await request('initialize',{clientInfo:{name:'continuity-subject',version:'1'},capabilities:{experimentalApi:true}});c.notify('initialized',{});
    assertLiveConfiguration(await request('config/read',{cwd:subject.root,includeLayers:false}),runtime);
    const account=await request('account/read',{refreshToken:false});check(account.account?.type==='chatgpt','subscription-required');
    const capacity=await request('account/rateLimits/read',{});
    const buckets=Object.values(capacity.rateLimitsByLimitId??{}).concat(capacity.rateLimits?[capacity.rateLimits]:[]);
    check(buckets.length>0&&!buckets.some(b=>[b.primary,b.secondary].some(w=>w?.usedPercent>=100)),'subscription-capacity-unavailable');
    const r=liveRequests(subject);observation.request_bytes=requestByteObservation(r);
    const ajv=new Ajv({strict:false,validateFormats:false});
    check(ajv.compile(schemas.ThreadStartParams)(r.thread),'thread-request-schema');
    const response=await request('thread/start',r.thread);threadId=response.thread?.id;
    check(typeof threadId==='string','thread-id-missing');assertThreadBoundary(response,subject);
    observation.model=response.model;observation.effort=response.reasoningEffort;
    r.turn.threadId=threadId;check(ajv.compile(schemas.TurnStartParams)(r.turn),'turn-request-schema');
    turnStart=Date.now();observation.generation_requested=true;
    const started=await request('turn/start',r.turn);
    check(typeof started.turn?.id==='string','turn-id-missing');
    check(!turnId||turnId===started.turn.id,'event-correlation');turnId=started.turn.id;
    ledger??=createSubjectLedger({threadId,turnId,remainingTokens,deadline});
    if(earlyStop)ledger.stop(earlyStop);
    for(const m of pending)consume(m);pending.length=0;
    await terminal;
    check(!earlyStop&&!ledger.state.first_stop,earlyStop??ledger.state.first_stop);
    check(ledger.state.completed?.status==='completed','terminal-missing');
    let parsed;try{parsed=JSON.parse(completion);}catch{throw Error('structured-completion-missing');}
    check(ajv.compile(liveCompletion)(parsed),'structured-completion-schema');
    observation.completion=parsed;
    check(ledger.state.completed_commands>0,'native-execution-unobserved');
    check(parsed.candidate_revision!==null&&parsed.test_exit_code!==null,'actor-blocked');
    observation.status='completed';
  } catch(e) {stop(/^[a-z-]{1,80}$/.test(e.message)?e.message:'provider-or-local-operation-failed');}
  finally {
    clearTimeout(timer);
    if(c&&threadId&&turnId&&!ledger?.state.completed) {
      observation.interrupt_requested=true;
      try{await c.request('turn/interrupt',{threadId,turnId},2000);}catch{observation.interrupt_unconfirmed=true;}
      await Promise.race([terminalObserved,new Promise(r=>setTimeout(r,2000))]);
    }
    // Keep observing trailing usage through terminal cleanup, never resume a turn.
    if(c&&threadId)try {
      await c.request('thread/backgroundTerminals/clean',{threadId},5000);
      const remaining=await c.request('thread/backgroundTerminals/list',{threadId},5000);
      check(Array.isArray(remaining.data)&&remaining.data.length===0&&!remaining.nextCursor,'terminal-cleanup-unconfirmed');observation.terminals_empty=true;
    }catch{observation.cleanup_failure='terminal-cleanup-unconfirmed';stop('terminal-cleanup-unconfirmed');}
    if(observation.generation_requested)await new Promise(r=>setTimeout(r,250));
    closing=true;
    try{if(c){await c.close();observation.server_exit_confirmed=true;}}catch{observation.cleanup_failure??='provider-exit-unconfirmed';stop('provider-exit-unconfirmed');}
    observation.first_stop=earlyStop??ledger?.state.first_stop??null;
    observation.usage=ledger?.state.usage??null;
    if(observation.generation_requested&&!observation.usage){observation.first_stop??='usage-missing';observation.status='stopped';}
    observation.usage_status=!observation.generation_requested?'not-generated':!observation.usage?'unknown':observation.first_stop?'incomplete-observation':'observed-completed-turn';
    observation.commands=ledger?.state.commands??0;observation.file_changes=ledger?.state.file_changes??0;
    observation.completed_commands=ledger?.state.completed_commands??0;
    observation.command_observations=ledger?.state.command_observations??null;
    observation.events=(ledger?.state.events??[]).map(e=>({...e,at_ms:e.at_ms-start}));
    observation.setup_ms=(turnStart??Date.now())-start;observation.turn_ms=turnStart?Date.now()-turnStart:null;
    observation.elapsed_ms=Date.now()-start;
    if(observation.first_stop)observation.status='stopped';
    signal?.removeEventListener('abort',cancel);
  }
  return observation;
}

async function instrumentHash() {
  const source=path.resolve(import.meta.dirname,'..');
  const tracked=(await exec('git',['ls-files','-z','--','bin','src','project-overlay','packs','package.json','package-lock.json','scripts'],{cwd:source,maxBuffer:1024*1024})).stdout.split('\0').filter(Boolean);
  tracked.push('scripts/continuity-live-runner.mjs');
  return digest(Object.fromEntries(await Promise.all([...new Set(tracked)].sort().map(async p=>[p,digest(await fs.readFile(path.join(source,p)))]))));
}
export async function qualifyIsolatedOracle(prepared) {
  const checkpoint=await createContinuityPair(path.join(prepared.lab,'oracle-control'),'changed-spec');
  const observations=[];
  for(const arm of ['ordinary','temple']) {
    const root=checkpoint.arms[arm].root;
    for(const threshold of [5000,3000]) {
      await fs.writeFile(path.join(root,'quote.mjs'),referenceQuote(threshold));
      const git=async args=>(await exec('git',args,{cwd:root,env:subprocessEnvironment()})).stdout.trim();
      await git(['add','quote.mjs']);await git(['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','commit','-qm','synthetic oracle control']);
      const revision=await git(['rev-parse','HEAD']);
      const observed=await assessContinuityCandidate(root,checkpoint,arm,revision,{scratchParent:prepared.lab,
        candidateExecutor:(cwd,binary,args,opts)=>isolatedOracleExecutor(prepared.runtime,cwd,binary,args,opts)});
      check(observed.passed===(threshold===5000),'isolated-oracle-control-failed');
      observations.push({arm,current_requirement:threshold===5000,passed:observed.passed,reason:observed.reason});
    }
  }
  const recordCheckpoint=await createContinuityPair(path.join(prepared.lab,'record-control'),'changed-spec');
  const recorded=await recordContinuityControl(recordCheckpoint);
  const recordOracle=await assessContinuityCandidate(recordCheckpoint.arms.temple.root,recordCheckpoint,'temple',recorded.revision,
    {allowRecordDescendant:true,scratchParent:prepared.lab,candidateExecutor:(cwd,binary,args,opts)=>isolatedOracleExecutor(prepared.runtime,cwd,binary,args,opts)});
  check(recordOracle.passed&&recordOracle.delivery_revision===recorded.delivery_revision&&recordOracle.revision!==recordOracle.delivery_revision,'record-control-failed');
  const result={status:'passed',model_generation_performed:false,observations,recordOracle};
  if(prepared.instruction_comparison) {
    const previous=await createContinuityPair(path.join(prepared.lab,'previous-record-control'),'changed-spec',
      {currentRuntime:prepared.runtime.readRoots[2],previousRuntime:prepared.instruction_comparison.bundle_root});
    const control=await recordContinuityControl(previous,'temple_previous');
    result.previousRecordOracle=await assessContinuityCandidate(previous.arms.temple_previous.root,previous,'temple_previous',control.revision,
      {allowRecordDescendant:true,scratchParent:prepared.lab,candidateExecutor:(cwd,binary,args,opts)=>isolatedOracleExecutor(prepared.runtime,cwd,binary,args,opts)});
    check(result.previousRecordOracle.passed,'previous-record-control-failed');
  }
  await fs.writeFile(path.join(prepared.lab,'oracle-qualification.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  return result;
}
export async function prepareContinuityMatrix(prepared) {
  const qualification=await qualifyThread(prepared.subject,prepared.runtime);
  check(qualification.status==='thread-configured'&&qualification.runtime_controls==='passed'&&qualification.server_exit_confirmed&&!qualification.cleanup_failure,'qualification-not-passed');
  const oracleQualification=JSON.parse(await fs.readFile(path.join(prepared.lab,'oracle-qualification.json'),'utf8'));
  check(oracleQualification.status==='passed'&&oracleQualification.observations.length===4&&oracleQualification.recordOracle?.passed===true&&
    oracleQualification.recordOracle.revision!==oracleQualification.recordOracle.delivery_revision,'oracle-qualification-missing');
  const observationQualification=qualifyNativeObservations();
  check(observationQualification.status==='passed','observation-qualification-failed');
  const installed=await readInstalledContinuitySchemas({binary:prepared.runtime.binary});
  const comparison=prepared.instruction_comparison;
  check(!(comparison&&prepared.incremental),'incompatible-matrix-modes');
  if(comparison)check(oracleQualification.previousRecordOracle?.passed===true,'previous-oracle-qualification-missing');
  const version=prepared.incremental?incrementalProtocol:comparison?instructionComparisonProtocol:deliveryProtocol;
  const pairs=[],subjects=[];
  for(const [index,state] of matrixConditions.entries()) {
    const checkpoint=await createContinuityPair(path.join(prepared.lab,`pair-${index+1}`),state,
      {currentRuntime:prepared.runtime.readRoots[2],previousRuntime:comparison?.bundle_root});pairs.push(checkpoint);
    for(const key of matrixArms({version},index)) {
      const root=checkpoint.arms[key].root;await fs.mkdir(path.join(root,'.git','runtime-tmp'));
      const bundle=key==='temple_previous'?comparison.bundle_root:prepared.runtime.readRoots[2];
      subjects.push({root,arm:key==='ordinary'?'ordinary':'temple',...(comparison?{variant:key}:{}),itemId:checkpoint.arms[key].item_id,agentId:prepared.subject.agentId,pair:index+1,state,
        runtime:{...prepared.runtime,root,readRoots:[...prepared.runtime.readRoots.slice(0,2),bundle],
          environment:{...prepared.runtime.environment,TEMPLE_CLI_PATH:path.join(bundle,'bin/temple.mjs'),TMPDIR:path.join(root,'.git','runtime-tmp')}}});
    }
  }
  let previousQualification;
  if(comparison) {
    const s=subjects.find(s=>s.variant==='temple_previous');previousQualification=await qualifyThread(s,s.runtime);
    check(previousQualification.status==='thread-configured'&&previousQualification.runtime_controls==='passed'&&previousQualification.server_exit_confirmed&&!previousQualification.cleanup_failure,'previous-qualification-not-passed');
  }
  const protocol={version,native_tool_route:'canary-required',envelope:matrixLimits({version}),continuation:deliveryContinuation,subjects,pairs,qualification,oracleQualification,observationQualification,
    ...(comparison?{instruction_comparison:comparison,previousQualification}:{}),
    schemas:installed.experimental,cli_version:installed.cli_version,bundle_root:prepared.runtime.readRoots[2],
    bundle_sha256:prepared.bundle_sha256,instrument_sha256:await instrumentHash(),
    interpretation:prepared.incremental
      ? 'Two missing compact conditions only; historical references are not contemporaneous controls or causal evidence.'
      : 'Diagnostic pairs only; no resource-quality exchange rate or automatic default change.'};
  assertContinuityMatrix(protocol);
  await fs.writeFile(path.join(prepared.lab,'protocol.json'),JSON.stringify(protocol,null,2)+'\n',{flag:'wx',mode:0o600});
  return {lab:prepared.lab,protocol_sha256:digest(protocol),subjects:subjects.length,model_generation_performed:false};
}

export async function runApprovedContinuity(lab,approvedDigest,{onProgress=()=>{},signal}={}) {
  check(!signal?.aborted,'operator-cancelled');
  const protocol=JSON.parse(await fs.readFile(path.join(lab,'protocol.json'),'utf8'));
  const limits=matrixLimits(protocol);
  check([deliveryProtocol,instructionComparisonProtocol,incrementalProtocol].includes(protocol.version)&&protocol.native_tool_route==='canary-required'&&digest(protocol)===approvedDigest&&digest(protocol.envelope)===digest(limits),'frozen-protocol-mismatch');
  check(digest(protocol.continuation)===digest(deliveryContinuation),'continuation-policy-mismatch');
  assertContinuityMatrix(protocol);
  check(await instrumentHash()===protocol.instrument_sha256,'instrument-drift');
  check(digest(await files(protocol.bundle_root))===protocol.bundle_sha256,'runtime-bundle-drift');
  const checkPrevious=async()=>{
    if(!instructionMatrix(protocol))return;
    const previous=protocol.instruction_comparison;
    check(previous?.previous_revision===previousInstructionRevision&&
      digest(await files(previous.bundle_root))===previous.bundle_sha256,'previous-runtime-drift');
    check(digest(assertInstructionOnlyRuntimes(await files(protocol.bundle_root),await files(previous.bundle_root)))===
      digest({previous_revision:previous.previous_revision,changed_paths:previous.changed_paths,instructions:previous.instructions}),'instruction-manifest-drift');
    for(const s of protocol.subjects) {
      const bundle=s.variant==='temple_previous'?previous.bundle_root:protocol.bundle_root;
      check(s.runtime.readRoots[2]===bundle&&s.runtime.readRoots.length===3&&
        s.runtime.environment.TEMPLE_CLI_PATH===path.join(bundle,'bin/temple.mjs'),'variant-runtime-mismatch');
    }
  };
  await checkPrevious();
  const start=Date.now(),deadline=start+limits.total_ms;
  await fs.writeFile(path.join(lab,'consumed.json'),JSON.stringify({protocol_sha256:approvedDigest,started_at:new Date(start).toISOString()})+'\n',{flag:'wx',mode:0o600});
  const result={version:'continuity-result/v2',protocol_sha256:approvedDigest,status:'running',subjects:[],
    operational_tokens:0,attempted_subjects:0,unknown_usage:false,first_stop:null};
  const persist=()=>fs.writeFile(path.join(lab,'run.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
  await persist();
  try {
    for(const [index,s] of protocol.subjects.entries()) {
      check(!signal?.aborted,'operator-cancelled');
      check(Date.now()<deadline&&result.operational_tokens<limits.total_tokens,'aggregate-limit');
      check(await instrumentHash()===protocol.instrument_sha256&&digest(await files(protocol.bundle_root))===protocol.bundle_sha256,'source-drift');
      await checkPrevious();
      const checkpoint=protocol.pairs[s.pair-1];
      check(digest(await files(s.root))===digest(await fixtureHashes(s.root,checkpoint.arms[fixtureKey(s)].baseline)),'fixture-drift');
      const observation={index:index+1,pair:s.pair,state:s.state,arm:s.arm,...(s.variant?{variant:s.variant}:{}),status:'starting'};
      result.subjects.push(observation);await persist();onProgress({subject:index+1,arm:s.arm,state:s.state,status:'starting'});
      const stage=await runContinuitySubject(s,s.runtime,{remainingTokens:limits.total_tokens-result.operational_tokens,deadline,schemas:protocol.schemas,signal,permit:batchPermit});
      Object.assign(observation,stage);
      if(stage.first_stop)result.first_stop??=stage.first_stop;
      if(stage.generation_requested)result.attempted_subjects++;
      if(stage.usage)result.operational_tokens+=stage.usage.operational_tokens;
      if(stage.generation_requested&&stage.usage_status!=='observed-completed-turn')result.unknown_usage=true;
      await persist();onProgress({subject:index+1,status:stage.status,tokens:stage.usage?.operational_tokens??null});
      check(!result.unknown_usage,'usage-unknown');
      check(stage.server_exit_confirmed&&stage.terminals_empty,'cleanup-unknown');
      // Conservative shared-validity stop. Never quietly relabel an instrument
      // failure as a low-scoring model or launch a replacement subject.
      check(stage.status==='completed',stage.first_stop??'actor-stopped');
      try {
        observation.oracle=await assessContinuityCandidate(s.root,checkpoint,fixtureKey(s),stage.completion.candidate_revision,
          {allowRecordDescendant:true,candidateExecutor:(cwd,binary,args,opts)=>isolatedOracleExecutor(s.runtime,cwd,binary,args,opts)});
      } catch(e) {observation.oracle={passed:false,reason:e.instrumentFailure?'oracle-instrument-failure':/^[a-z-]{1,80}$/.test(e.message)?e.message:'oracle-operation-failed'};}
      observation.completion_assessment=assessDeliveryCompletion(stage.completion,{oraclePassed:observation.oracle.passed,arm:s.arm});
      observation.accepted=observation.completion_assessment.accepted;
      if(s.arm==='temple') {
        const work=JSON.parse(await fs.readFile(path.join(s.root,'.ai-org/work-items',s.itemId+'.json'),'utf8'));
        observation.administration_complete=work.state==='test'&&work.claim?.status==='released'&&
          work.developer_candidate_revision===stage.completion.candidate_revision&&work.handoffs?.some(h=>h.actor===s.agentId&&h.from_position==='developer'&&h.to_position==='quality_evaluator'&&h.input_revision===stage.completion.candidate_revision);
      } else observation.administration_complete=null;
      observation.accepted=observation.accepted&&(s.arm!=='temple'||observation.administration_complete===true);
      observation.sequence_decision=continuityAssessmentDecision(observation,protocol.continuation);
      await persist();
      if(observation.sequence_decision.stop)throw Error(observation.sequence_decision.stop);
      check(!signal?.aborted,'operator-cancelled');
    }
    result.status=result.subjects.every(s=>s.accepted)?'completed':'completed-with-failures';
  } catch(e) {result.status='stopped';result.first_stop??=/^[a-z-]{1,80}$/.test(e.message)?e.message:'instrument-operation-failed';}
  result.elapsed_ms=Date.now()-start;await persist();
  const seal={protocol_sha256:approvedDigest,run_sha256:digest(result),sealed_at:new Date().toISOString()};
  await fs.writeFile(path.join(lab,'seal.json'),JSON.stringify(seal,null,2)+'\n',{flag:'wx',mode:0o600});
  return result;
}

// Called only after an isolated oracle attempt. Runtime/source guards remain
// separate and cannot be overridden by a product or administration score.
export function continuityAssessmentDecision(observation,continuation) {
  const runtime=observation?.status==='completed'&&observation.usage_status==='observed-completed-turn'&&
    observation.server_exit_confirmed===true&&observation.terminals_empty===true;
  const accounted=Number.isSafeInteger(observation?.usage?.operational_tokens)&&observation.usage.operational_tokens>=0;
  const valid=runtime&&accounted&&['accepted','product-mismatch','regression-failed','oracle-process-failed'].includes(observation.oracle?.reason);
  return assessmentDecision({outcome:observation?.accepted===true?'passed':'product-failure',
    validity_confirmed:valid,isolation_confirmed:valid,cleanup_confirmed:runtime},continuation);
}

async function fixtureHashes(root,revision) {
  const env=subprocessEnvironment();const names=(await exec('git',['ls-tree','-r','--name-only','-z',revision],{cwd:root,env})).stdout.split('\0').filter(Boolean);
  return Object.fromEntries(await Promise.all(names.map(async name=>{
    const {stdout}=await exec('git',['show',`${revision}:${name}`],{cwd:root,env,encoding:'buffer',maxBuffer:1024*1024});return [name,digest(stdout)];
  })));
}
