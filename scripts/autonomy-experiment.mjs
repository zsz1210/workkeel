// Repository-only, bounded synthetic experiment. Never import into a subject.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash, randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createJsonRpcProcess} from '../src/codex-app-server-provider.mjs';
import {normalizeTokenUsage} from '../src/app-server-protocol-replay.mjs';
import {liveArguments, assertLiveConfiguration, discoverRuntime, isolatedOracleExecutor} from './continuity-live-runner.mjs';
import {subprocessEnvironment} from './delivery-control-pair.mjs';
import {fixtures} from './autonomy-fixtures.mjs';

const source=path.resolve(import.meta.dirname,'..'), exec=promisify(execFile);
const check=(condition,message)=>{if(!condition)throw Error(message);};
const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const profile='temple-continuity-probe';
export const limits=Object.freeze({model:'gpt-5.6-terra',effort:'medium',cell_tokens:180000,cell_ms:900000,qa_tokens:25000,qa_ms:180000,cells:6});
export function experimentCells(experiment='staged-v1'){
  if(experiment==='gpt6-autonomous-v1')return ['small','feature'].map(task=>({id:task+'-C',task,arm:'B',executor_model:'gpt-6-astra',executor_effort:'medium'}));
  check(experiment==='staged-v1','unknown-experiment');
  return fixtures.flatMap(f=>(f.id==='feature'?['B','A']:['A','B']).map(arm=>({id:f.id+'-'+arm,task:f.id,arm,executor_model:limits.model,executor_effort:limits.effort})));
}
export function actorSettings(cell,stage){return stage==='qa'?{model:limits.model,effort:limits.effort}:{model:cell.executor_model,effort:cell.executor_effort};}
// Keep the older continuity experiment's fixed-model assertion unchanged.
export function assertActorBoundary(reply,root,{model,effort}){
  check(reply.model===model&&reply.reasoningEffort===effort,'effective-model-mismatch');
  check(reply.activePermissionProfile?.id===profile&&!reply.activePermissionProfile.extends&&reply.approvalPolicy==='never','thread-permissions-mismatch');
  const sources=reply.instructionSources;
  check(Array.isArray(sources)&&sources.every(p=>typeof p==='string'&&p.startsWith(root+path.sep)),'external-native-instructions');
  check(sources.includes(path.join(root,'AGENTS.md')),'native-instructions-missing');
  check(reply.cwd===root&&reply.thread?.turns?.length===0,'fresh-thread-boundary');
}
export function validateExperiment(manifest){
  const expected=experimentCells(manifest.experiment);
  check(hash(manifest.limits)===hash({...limits,cells:expected.length}),'experiment-limits-drift');
  check(Array.isArray(manifest.cells)&&manifest.cells.length===expected.length,'experiment-cells-drift');
  for(let i=0;i<expected.length;i++)check(Object.entries(expected[i]).every(([k,v])=>manifest.cells[i][k]===v),'experiment-cell-model-drift');
}
const packageText=JSON.stringify({type:'module',scripts:{test:'node --test test/*.test.mjs'}},null,2)+'\n';
const stages=['spec','design','build','test','eval'];
const roles={spec:'product_manager',design:'tech_lead',build:'developer',test:'quality_evaluator',eval:'quality_evaluator'};
const next={spec:['design','approved_scope','acceptance_criteria'],design:['build','technical_design','risk_review'],build:['test','developer_handoff','developer_evidence'],test:['eval','test_evidence'],eval:['independent_qa','evaluation_report']};
const completionSchema={type:'object',additionalProperties:false,required:['decision','summary','findings'],properties:{decision:{type:'string',enum:['pass','fail','blocked']},summary:{type:'string'},findings:{type:'array',items:{type:'string'}}}};
const common='You are executing one authorized bounded local assignment. Use only this repository and native tools. No network, external tools, installations, model fallback, subagents, user questions, background/detached processes, permission changes or other repositories. Use non-login shells and apply_patch for edits. Do not access memories or parent paths. Preserve all supplied requirements and public tests. Runtime tools are on PATH. A final claim is not independent acceptance.';
const scope='Read SPEC.md. Product edits are restricted to src/** and optional test/additional.test.mjs. Do not edit package.json, supplied tests, instructions or other files. No symlinks, Git hooks or configuration edits. Run node --test test/*.test.mjs after final product/test changes. The coordinator commits the exact product and records evidence; do not perform Git or lifecycle writes yourself.';
const stageGoals={spec:'Define the required behavior, acceptance edges and ambiguity assessment. Do not implement or edit product/tests. Return your scoped analysis in summary/findings.',design:'Read preceding stage evidence in .ai-org/artifacts/WI-0001. Choose a concrete implementation and verification design and assess risks. Do not implement or edit product/tests. Return your design in summary/findings.',build:'Read preceding stage evidence in .ai-org/artifacts/WI-0001. Implement the approved requirements and add meaningful tests. Verify your final changes. Finish only Developer work.',test:'Independently inspect and execute product tests and any additional read-only checks needed to challenge requirements. You may not edit product or tests. Report real defects with reproduction details; do not repair them.',eval:'Evaluate whether the candidate and recorded test evidence cover SPEC.md, including likely regressions and untested edges. You may not edit product or tests. Return pass only if supported; identify gaps and defects without repairing them.'};
export function promptFor(arm,stage,feedback=null){
  if(stage==='qa')return 'You are Independent QA, identity agent-lulu, distinct from the implementer. This is a blind candidate: read SPEC.md and inspect src/** and supplied tests. Independently run node --test test/*.test.mjs and challenge boundary cases. Do not edit product, tests, requirements or any supplied file. You may execute temporary checks without persisting files. Judge actual product correctness against SPEC.md, not administrative records or report formatting. Return decision pass/fail/blocked, a concise summary and actionable findings. Do not infer which workflow produced this candidate.';
  if(stage==='repair')return scope+'\nRepair the delivered candidate within the original SPEC.md only. This is the single allowed repair after independent QA. Investigate the feedback, make necessary corrections and reverify. Do not broaden scope.\nFeedback: '+JSON.stringify(feedback);
  if(arm==='B')return scope+'\nYou own the final outcome. Plan, investigate, implement and self-verify using whatever intermediate process you judge useful within these boundaries. Continue until the approved goal is delivered or a real blocker remains. You decide how to organize the work. A separate Independent QA will assess the result.';
  return scope+`\nYou are the ${roles[stage]} for WI-0001. First read AGENTS.md, TEMPLE.md and applicable temple-work Skill. The runner has already acquired your eligible claim and owns fixed lifecycle recording; this assignment delegates only substantive ${stage} work. Do not duplicate claim/handoff/transition writes. Read routed context needed for this responsibility. `+stageGoals[stage];
}
async function write(root,name,value,exclusive=false){const file=path.join(root,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{flag:exclusive?'wx':'w',mode:0o600});}
async function read(root,name){return JSON.parse(await fs.readFile(path.join(root,name),'utf8'));}
async function run(root,binary,args){const r=await exec(binary,args,{cwd:root,env:subprocessEnvironment(),timeout:30000,maxBuffer:2*1024*1024});return r.stdout.trim();}
const git=(root,...args)=>run(root,'git',['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false',...args]);
async function cli(root,...args){const n=args[0]==='work-item'?2:1;return JSON.parse(await run(source,process.execPath,[path.join(source,'bin/temple.mjs'),...args.slice(0,n),root,...args.slice(n),'--json']));}
async function tree(root,prefix=''){
  const result={};for(const e of await fs.readdir(path.join(root,prefix),{withFileTypes:true})){
    if(e.name==='.git')continue;const p=path.posix.join(prefix,e.name);check(!e.isSymbolicLink(),'unsafe-symlink');
    if(e.isDirectory())Object.assign(result,await tree(root,p));else {check(e.isFile(),'unsafe-file');const s=await fs.stat(path.join(root,p));check(s.size<=1024*1024,'oversized-file');result[p]=hash(await fs.readFile(path.join(root,p)));}
  }return Object.fromEntries(Object.entries(result).sort(([a],[b])=>a.localeCompare(b)));
}
export function scopeChanges(before,after,editable){return [...new Set([...Object.keys(before),...Object.keys(after)])].filter(p=>before[p]!==after[p]&&!editable(p));}
const editable=p=>p.startsWith('src/')||p==='test/additional.test.mjs';
async function seed(root,f){await fs.mkdir(root);for(const [p,s]of Object.entries({...f.seed,...f.publicTests,'SPEC.md':f.spec,'package.json':packageText}))await write(root,p,s);await git(root,'init','-b','main');await git(root,'add','.');await git(root,'commit','-m','Frozen synthetic task');}
async function commitProduct(root,label){await git(root,'add','src','test');await git(root,'commit','--allow-empty','-m',label);return git(root,'rev-parse','HEAD');}
async function bundleRuntime(lab){const bundle=path.join(lab,'runtime');await fs.mkdir(bundle);for(const p of ['bin','src','project-overlay','packs','package.json'])await fs.cp(path.join(source,p),path.join(bundle,p),{recursive:true});for(const p of ['ajv','ajv-formats','fast-deep-equal','fast-uri','json-schema-traverse','require-from-string'])await fs.cp(path.join(source,'node_modules',p),path.join(bundle,'node_modules',p),{recursive:true});return bundle;}
async function runtimeFor(root,base){await fs.mkdir(path.join(root,'.git','runtime-tmp'),{recursive:true});return {...base,root,environment:{...base.environment,TMPDIR:path.join(root,'.git','runtime-tmp')}};}
async function sourceDigest(){const names=['scripts/autonomy-experiment.mjs','scripts/autonomy-fixtures.mjs','scripts/continuity-live-runner.mjs','scripts/continuity-named-permissions.mjs','src/codex-app-server-provider.mjs','src/app-server-protocol-replay.mjs','scripts/delivery-control-pair.mjs','.ai-org/artifacts/WI-0247/design.md','.ai-org/artifacts/WI-0249/design.md'];return hash(await Promise.all(names.map(async p=>[p,hash(await fs.readFile(path.join(source,p)))])));}
async function installTemple(root,lab,f){
  const config=await read(source,'docs/getting-started/temple-init.example.json');config.project={id:'autonomy-fixture',name:'Synthetic delivery fixture'};
  config.repository_integration={schema_version:'temple.repository-integration/v1',status:'confirmed',authority:'project',source:'human-confirmed',policy_refs:[],summary:'Synthetic local fixture; coordinator owns fixed administration',integration_target:'main',change_isolation:'not-required',review_gate:'not-required',recorded_at:'2026-09-07T00:00:00Z',recorded_by:'human'};
  const configFile=path.join(lab,'init.json');await write(lab,'init.json',config);
  await run(source,process.execPath,[path.join(source,'bin/temple.mjs'),'init',root,'--config',configFile,'--json']);
  await fs.appendFile(path.join(root,'AGENTS.md'),'\n# Explicit synthetic experiment assignment\nThe user authorizes the coordinator to perform fixed claim, handoff, transition, evidence and Git recording. Stage actors supply only substantive assigned work. Do not duplicate those administrative mutations. This exception is local to this synthetic fixture.\n');
  await cli(root,'work-item','create','--title',f.title,'--scope','Implement current SPEC.md','--acceptance','All current SPEC.md behavior with preserved public regressions','--affected-path','src','--affected-path','test/additional.test.mjs','--ui-mode','not-applicable','--workflow-profile','standard');
  await transition(root,'spec',['work_order'],'SPEC.md');
  await git(root,'add','.');await git(root,'commit','-m','Prepare Standard workflow');
  return (await read(root,'.ai-org/project/assignments.json')).assignments;
}
async function transition(root,to,gates,evidence){return cli(root,'transition','--work-item','WI-0001','--to',to,...gates.flatMap(g=>['--satisfy',`${g}=${evidence}`]));}
async function recordStage(root,stage,result,assignments){
  const ref=`.ai-org/artifacts/WI-0001/${stage}.json`;await write(root,ref,result);
  const to=next[stage][0],toPosition=roles[to]??'independent_qa';
  await cli(root,'handoff','--work-item','WI-0001','--to',toPosition,'--input-revision',result.candidate_revision,'--completed',result.completion?.summary??'Stage stopped','--evidence',ref);
  await cli(root,'work-item','release','--work-item','WI-0001','--agent-id',assignments.find(a=>a.position_id===roles[stage]&&a.active).agent_id,'--reason','Substantive stage evidence captured by coordinator');
  // A failed verification remains a real rejection; it is not a passing gate.
  if(result.status==='completed'&&result.completion?.decision==='pass')await transition(root,to,next[stage].slice(1),ref);
}

export function usageUpdate(previous,params){const u=normalizeTokenUsage(params);check(u&&u.cached_input_tokens<=u.input_tokens&&u.total_tokens===u.input_tokens+u.output_tokens&&u.reasoning_output_tokens<=u.output_tokens,'invalid-usage');if(previous)check(Object.keys(u).every(k=>u[k]>=previous[k]),'usage-regression');return {...u,operational_tokens:u.input_tokens-u.cached_input_tokens+u.output_tokens};}
export function nextAction({initialAccepted,repairUsed,remainingTokens,remainingMs}){if(initialAccepted)return 'accepted';if(repairUsed||remainingTokens<=0||remainingMs<=0)return 'rejected';return 'repair';}
export async function acquireRun(lab){const marker=await fs.open(path.join(lab,'STARTED'),'wx',0o600);try{await marker.writeFile(new Date().toISOString()+'\n');await marker.sync();}finally{await marker.close();}}
// Repository-only composition helpers; existing experiment entrypoints are unchanged.
export {write,read,run,git,cli,tree,seed,bundleRuntime,runtimeFor,qualifyIsolation};
export async function runActor(runtime,prompt,{tokens,ms,model=limits.model,effort=limits.effort,beforeGeneration=async()=>{},onProgress=()=>{},providerFactory=createJsonRpcProcess}){
  let c,threadId,turnId,usage=null,completion=null,terminal=null,stop=null,closing=false,generated=false,commands=0,changes=0,turnStart=null;
  let wake;const done=new Promise(r=>wake=r),started=Date.now(),deadline=started+ms;
  const halt=reason=>{stop??=reason;wake();};
  const consume=m=>{if(closing)return;const p=m.params??{};
    if(['model/rerouted','model/verification'].includes(m.method))return halt('model-changed');
    if(!['thread/tokenUsage/updated','turn/completed','turn/started','item/started','item/completed'].includes(m.method))return;
    if(!threadId||p.threadId!==threadId)return halt('event-correlation');
    const eventTurn=p.turnId??p.turn?.id;if(turnId&&eventTurn!==turnId)return halt('event-correlation');if(eventTurn)turnId??=eventTurn;
    try{if(m.method==='thread/tokenUsage/updated'){usage=usageUpdate(usage,p);onProgress({operational_tokens:usage.operational_tokens});if(usage.operational_tokens>=tokens)halt('token-limit');}}catch(e){halt(e.message);}
    if(m.method==='item/started'){const type=p.item?.type;if(type==='commandExecution')commands++;else if(type==='fileChange')changes++;else if(!['userMessage','agentMessage','reasoning','plan'].includes(type))halt('unexpected-tool-item');}
    if(m.method==='item/completed'&&p.item?.type==='agentMessage')completion=p.item.text;
    if(m.method==='turn/completed'){terminal=p.turn;if(terminal.status!=='completed')halt('actor-not-completed');wake();}
  };
  const timer=setTimeout(()=>halt('time-limit'),ms),result={status:'stopped',generation_requested:false};
  try{
    c=providerFactory(runtime.binary,liveArguments(runtime),{cwd:runtime.root,env:subprocessEnvironment(runtime.environment),onNotification:consume,onProtocolError:error=>{result.protocol_diagnostic??=error?.protocolDiagnostic;halt('protocol-error');},onRequest:()=>halt('unexpected-server-request'),onExit:()=>{if(!closing&&!terminal)halt('provider-exit');}});
    const request=async(method,params)=>{check(!stop,stop);const value=await c.request(method,params,Math.max(1,deadline-Date.now()));check(!stop,stop);return value;};
    await request('initialize',{clientInfo:{name:'temple-autonomy-pilot',version:'1'},capabilities:{experimentalApi:true}});c.notify('initialized',{});
    assertLiveConfiguration(await request('config/read',{cwd:runtime.root,includeLayers:false}),runtime);
    check((await request('account/read',{refreshToken:false})).account?.type==='chatgpt','subscription-required');
    const capacity=await request('account/rateLimits/read',{}),buckets=Object.values(capacity.rateLimitsByLimitId??{}).concat(capacity.rateLimits?[capacity.rateLimits]:[]);
    check(buckets.length&&!buckets.some(b=>[b.primary,b.secondary].some(w=>w?.usedPercent>=100)),'subscription-capacity-unavailable');
    const t=await request('thread/start',{model,cwd:runtime.root,approvalPolicy:'never',permissions:profile,ephemeral:true,allowProviderModelFallback:false,config:{model_reasoning_effort:effort},developerInstructions:common});
    threadId=t.thread?.id;check(typeof threadId==='string'&&t.model===model&&t.reasoningEffort===effort,'effective-model-mismatch');
    assertActorBoundary(t,runtime.root,{model,effort});
    result.model=t.model;result.effort=t.reasoningEffort;result.thread_id=threadId;
    await beforeGeneration({thread_id:threadId,prompt_sha256:hash(prompt),prompt_bytes:Buffer.byteLength(prompt),developer_bytes:Buffer.byteLength(common)});
    generated=true;turnStart=Date.now();result.generation_requested=true;
    const turn=await request('turn/start',{threadId,cwd:runtime.root,model,effort,approvalPolicy:'never',permissions:profile,input:[{type:'text',text:prompt}],outputSchema:completionSchema});
    check(typeof turn.turn?.id==='string'&&(!turnId||turnId===turn.turn.id),'event-correlation');turnId=turn.turn.id;
    await done;check(!stop&&terminal?.status==='completed',stop??'missing-terminal');
    let value;try{value=JSON.parse(completion);}catch{throw Error('missing-structured-completion');}
    check(value&&['pass','fail','blocked'].includes(value.decision)&&typeof value.summary==='string'&&Array.isArray(value.findings)&&value.findings.every(x=>typeof x==='string'),'invalid-completion');result.completion=value;result.status='completed';
  }catch(e){halt(/^[a-z-]{1,80}$/.test(e.message)?e.message:'provider-or-local-failure');result.failure_detail=e.providerReason??e.message;}
  finally{
    clearTimeout(timer);
    if(c&&threadId&&turnId&&!terminal)try{await c.request('turn/interrupt',{threadId,turnId},3000);}catch{result.interrupt_unconfirmed=true;}
    if(c&&threadId)try{await c.request('thread/backgroundTerminals/clean',{threadId},5000);const left=await c.request('thread/backgroundTerminals/list',{threadId},5000);check(Array.isArray(left.data)&&left.data.length===0&&!left.nextCursor,'cleanup-unconfirmed');result.terminals_empty=true;}catch{result.cleanup_failure='terminal-cleanup-unconfirmed';halt('cleanup-unconfirmed');}
    if(generated)await new Promise(r=>setTimeout(r,250));closing=true;
    try{if(c)await c.close();result.server_exit_confirmed=true;}catch{result.cleanup_failure??='server-exit-unconfirmed';halt('cleanup-unconfirmed');}
    if(generated&&!usage)halt('usage-missing');
    result.first_stop=stop;result.usage=usage;result.usage_status=!generated?'not-generated':!usage?'unknown':stop?'incomplete-observation':'observed-completed-turn';result.elapsed_ms=Date.now()-started;result.actor_ms=turnStart?Date.now()-turnStart:0;result.commands=commands;result.file_changes=changes;if(stop)result.status='stopped';
  }return result;
}

async function oracle(root,f,base,lab,label){
  const target=path.join(lab,'checks',label+'-'+randomUUID());await fs.mkdir(target,{recursive:true});
  for(const p of Object.keys(await tree(root)).filter(p=>p.startsWith('src/')||p.startsWith('test/')||p==='package.json')){await fs.mkdir(path.dirname(path.join(target,p)),{recursive:true});await fs.copyFile(path.join(root,p),path.join(target,p));}
  await write(target,'oracle.test.mjs',f.hiddenTests);
  const r=await isolatedOracleExecutor(base,target,process.execPath,['--test','--test-reporter=tap','oracle.test.mjs',...Object.keys(f.publicTests)],{timeout:20000,maxBuffer:128*1024});
  return {exit_code:r.exit_code,failed_cases:r.stdout.split('\n').filter(l=>/^not ok /u.test(l)),output_sha256:hash(r.stdout+r.stderr)};
}
async function blindQA(root,f,base,lab,budget,onStart){
  const target=path.join(lab,'actors',randomUUID());await fs.mkdir(target,{recursive:true});
  for(const p of Object.keys(await tree(root)).filter(p=>p.startsWith('src/')||p.startsWith('test/')||['package.json','SPEC.md'].includes(p))){await fs.mkdir(path.dirname(path.join(target,p)),{recursive:true});await fs.copyFile(path.join(root,p),path.join(target,p));}
  await write(target,'AGENTS.md','# Independent product verification\nOnly SPEC.md defines acceptance. Inspect and test; do not modify supplied files. Do not seek execution history or other repositories.\n');
  const before=await tree(target),runtime=await runtimeFor(target,base);
  const r=await runActor(runtime,promptFor(null,'qa'),{tokens:Math.min(limits.qa_tokens,budget.tokens),ms:Math.min(limits.qa_ms,budget.ms),beforeGeneration:onStart});
  r.protected_drift=scopeChanges(before,await tree(target),()=>false);if(r.protected_drift.length){r.status='stopped';r.first_stop='qa-source-drift';}return r;
}
export function fatal(r){return Boolean(r.cleanup_failure||r.generation_requested&&(!r.usage||r.usage_status!=='observed-completed-turn'||!r.terminals_empty||!r.server_exit_confirmed)||(!r.generation_requested&&r.first_stop&&r.first_stop!=='cell-budget'));}
async function qualifyIsolation(base,lab){const root=path.join(lab,'isolation');await fs.mkdir(root);await write(root,'own.txt','owned');await write(lab,'outside.txt','forbidden');let c;try{const rt=await runtimeFor(root,base);c=createJsonRpcProcess(base.binary,liveArguments(rt),{cwd:root,env:subprocessEnvironment()});await c.request('initialize',{clientInfo:{name:'autonomy-isolation',version:'1'},capabilities:{experimentalApi:true}});c.notify('initialized',{});assertLiveConfiguration(await c.request('config/read',{cwd:root,includeLayers:false}),rt);const probe=await c.request('command/exec',{cwd:root,permissionProfile:profile,command:[process.execPath,'--input-type=module','-e','import fs from "node:fs"; if(fs.readFileSync("own.txt","utf8")!=="owned")process.exit(2); try { fs.readFileSync("../outside.txt");process.exit(3); } catch(e) { if(!["EPERM","EACCES"].includes(e.code))process.exit(4); }'],timeoutMs:5000,outputBytesCap:4096});check(probe.exitCode===0,'isolation-canary-failed');return {effective_config:true,own_read:true,outside_denied:true,generation_requested:false};}finally{if(c)await c.close();}}

export async function prepare(experiment='staged-v1'){
  const selection=experimentCells(experiment);
  const lab=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'temple-autonomy-'))),bundle=await bundleRuntime(lab);
  const node=await fs.realpath(process.execPath),libraries=(await run(source,'/usr/bin/otool',['-L',node])).split('\n').slice(1).map(s=>s.trim().split(' (compatibility version')[0]);check(libraries.length&&libraries.every(p=>p.startsWith('/usr/lib/')||p.startsWith('/System/')),'unsupported-node-runtime');
  const gitBinary=await run(source,'/usr/bin/xcrun',['--find','git']),binary='/Applications/ChatGPT.app/Contents/Resources/codex';
  const base={binary,readRoots:[path.dirname(node),path.dirname(gitBinary),bundle],environment:{PATH:[path.dirname(node),path.dirname(gitBinary),'/usr/bin','/bin'].join(':'),OPENSSL_CONF:'/dev/null',TEMPLE_CLI_PATH:path.join(bundle,'bin/temple.mjs'),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'}};
  Object.assign(base,await discoverRuntime({binary,root:lab}));
  const qualification=await qualifyIsolation(base,lab),cells=[];
  for(const selected of selection){const f=fixtures.find(f=>f.id===selected.task),arm=selected.arm,pair=path.join(lab,f.id);await fs.mkdir(pair,{recursive:true});
    const root=path.join(pair,selected.id);await seed(root,f);let assignments=null;
    if(arm==='A')assignments=await installTemple(root,lab,f);else{await write(root,'AGENTS.md','# Autonomous delivery experiment\nSPEC.md is the approved goal. You own planning, investigation, implementation and self-verification. The user authorizes this bounded experimental route. A separate Agent performs Independent QA. Preserve scope and protected files.\n');await git(root,'add','.');await git(root,'commit','-m','Prepare autonomous workflow');}
    cells.push({...selected,root,assignments,seed_manifest:await tree(root),base_revision:await git(root,'rev-parse','HEAD')});
  }
  const controls=[];for(const f of fixtures){const root=path.join(lab,'controls',f.id);await fs.mkdir(path.dirname(root),{recursive:true});await seed(root,f);controls.push({task:f.id,kind:'seed',...await oracle(root,f,base,lab,'control')});for(const[p,s]of Object.entries(f.reference))await write(root,p,s);controls.push({task:f.id,kind:'reference',...await oracle(root,f,base,lab,'control')});}
  check(controls.every(r=>r.kind==='reference'?r.exit_code===0:r.exit_code!==0&&r.failed_cases.length>0),'oracle-control-failed');
  const manifest={schema_version:'autonomy-pilot/v1',experiment,created_at:new Date().toISOString(),limits:{...limits,cells:cells.length},source_digest:await sourceDigest(),bundle_digest:hash(await tree(bundle)),fixtures_digest:hash(fixtures),qualification,controls,base,cells};
  await write(lab,'manifest.json',manifest,true);await write(lab,'state.json',{status:'prepared',cells:[],events:[]},true);return {lab,digest:hash(manifest),qualification,controls};
}
export async function execute(lab,expectedDigest){
  const manifest=await read(lab,'manifest.json'),state=await read(lab,'state.json');check(hash(manifest)===expectedDigest,'manifest-drift');check(manifest.source_digest===await sourceDigest(),'source-drift');check(manifest.bundle_digest===hash(await tree(manifest.base.readRoots[2])),'runtime-drift');check(state.status==='prepared'&&state.cells.length===0&&state.events.length===0,'already-started-no-automatic-retry');
  validateExperiment(manifest);
  await acquireRun(lab);
  state.status='running';state.started_at=new Date().toISOString();const save=()=>write(lab,'state.json',state);
  await save();
  try{for(const cell of manifest.cells){
    check(hash(await tree(cell.root))===hash(cell.seed_manifest),'seed-drift');const f=fixtures.find(f=>f.id===cell.task),r={id:cell.id,arm:cell.arm,task:cell.task,turns:[],qa:[],oracles:[],human_interventions:0,repair_used:false,status:'running',coordinator_ms:0};state.cells.push(r);await save();
    const runtime=await runtimeFor(cell.root,manifest.base),started=Date.now();r.started_ms=started;let totalTokens=0,totalMs=0;
    const budget=()=>({tokens:limits.cell_tokens-totalTokens,ms:limits.cell_ms-totalMs});
    const startTurn=stage=>async info=>{state.events.push({cell:cell.id,stage,generation_requested:true,at:new Date().toISOString(),...info});await save();console.log(JSON.stringify({event:'generation',cell:cell.id,stage}));};
    const account=o=>{if(o.usage)totalTokens+=o.usage.operational_tokens;totalMs+=o.elapsed_ms;};
    for(const stage of cell.arm==='A'?stages:['autonomous']){
      if(budget().tokens<=0||budget().ms<=0)break;
      if(cell.arm==='A'){const agent=cell.assignments.find(a=>a.position_id===roles[stage]&&a.active).agent_id;await cli(cell.root,'work-item','claim','--work-item','WI-0001','--agent-id',agent,'--principal-id','human','--base-revision',await git(cell.root,'rev-parse','HEAD'),'--branch','main');}
      const before=await tree(cell.root),o=await runActor(runtime,promptFor(cell.arm,stage),{...budget(),...actorSettings(cell,stage),beforeGeneration:startTurn(stage)});o.stage=stage;o.protected_drift=scopeChanges(before,await tree(cell.root),stage==='build'||stage==='autonomous'?editable:()=>false);if(o.protected_drift.length){o.status='stopped';o.first_stop='protected-source-drift';}
      account(o);r.turns.push(o);o.candidate_revision=await commitProduct(cell.root,'Capture '+stage+' candidate');
      if(cell.arm==='A')await recordStage(cell.root,stage,o,cell.assignments);await save();check(!fatal(o),'shared-stop:'+o.first_stop);
      if(o.status!=='completed'||o.completion?.decision!=='pass')break;
    }
    for(let attempt=0;attempt<2;attempt++){
      const candidate=await git(cell.root,'rev-parse','HEAD'),beforeQA=Date.now();
      const q=budget().tokens>0&&budget().ms>0?await blindQA(cell.root,f,manifest.base,lab,budget(),startTurn('qa-'+attempt)):{status:'not-run',first_stop:'cell-budget',generation_requested:false,elapsed_ms:0,usage:null};q.candidate_revision=candidate;account(q);r.qa.push(q);await save();check(!fatal(q),'shared-stop:'+q.first_stop);
      const v=await oracle(cell.root,f,manifest.base,lab,cell.id);v.candidate_revision=candidate;r.oracles.push(v);r.oracle_ms=(r.oracle_ms??0)+Date.now()-beforeQA-q.elapsed_ms;
      const drift=r.turns.some(t=>t.protected_drift?.length)||q.protected_drift?.length;
      const accepted=q.status==='completed'&&q.completion.decision==='pass'&&v.exit_code===0&&!drift;
      if(attempt===0)r.first_pass=accepted;
      const action=nextAction({initialAccepted:accepted,repairUsed:attempt===1,remainingTokens:budget().tokens,remainingMs:budget().ms});
      if(action!=='repair'){r.status=action;r.accepted=accepted;break;}
      r.repair_used=true;const feedback={qa:q.completion??{decision:'blocked',reason:q.first_stop},hidden_failures:v.failed_cases,protected_drift:drift?true:false};
      const before=await tree(cell.root),o=await runActor(runtime,promptFor(cell.arm,'repair',feedback),{...budget(),...actorSettings(cell,'repair'),beforeGeneration:startTurn('repair')});o.stage='repair';o.protected_drift=scopeChanges(before,await tree(cell.root),editable);account(o);r.turns.push(o);o.candidate_revision=await commitProduct(cell.root,'Capture sole QA repair');await save();check(!fatal(o),'shared-stop:'+o.first_stop);
    }
    r.operational_tokens=totalTokens;r.measured_actor_ms=totalMs;r.final_revision=await git(cell.root,'rev-parse','HEAD');r.final_manifest=await tree(cell.root);await save();r.wall_ms=Date.now()-started;r.coordinator_ms=r.wall_ms-r.measured_actor_ms;await save();console.log(JSON.stringify({event:'cell-complete',id:r.id,status:r.status,first_pass:r.first_pass,tokens:totalTokens,ms:totalMs}));
  }state.status='completed';}catch(e){state.status='stopped';state.first_stop=e.message;throw e;}finally{for(const r of state.cells){const turns=[...r.turns,...r.qa];r.operational_tokens_observed=turns.reduce((n,t)=>n+(t.usage?.operational_tokens??0),0);r.accounting_complete=turns.every(t=>!t.generation_requested||t.usage_status==='observed-completed-turn');if(r.status==='running')r.status='stopped';}state.finished_at=new Date().toISOString();await save();}
  return state;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const [command,lab,digest]=process.argv.slice(2);try{if(command==='prepare')console.log(JSON.stringify(await prepare(lab),null,2));else if(command==='run')console.log(JSON.stringify(await execute(lab,digest),null,2));else throw Error('Use prepare [staged-v1|gpt6-autonomous-v1] or run <lab> <manifest-digest>');}catch(e){console.error(e.message);process.exitCode=1;}}
