// Repository-only coordinator. Never export this module or its oracle to actors.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {matrixEnvironment} from './delivery-matrix-experiment.mjs';
import {runActor,assertActorBoundary,runtimeFor,git,cli,acquireRun} from './autonomy-experiment.mjs';
import {liveArguments,assertLiveConfiguration} from './continuity-live-runner.mjs';
import {createJsonRpcProcess} from '../src/codex-app-server-provider.mjs';
import {subprocessEnvironment} from './delivery-control-pair.mjs';
import {runReviewAcceptance} from './learning-review-oracle.mjs';

const source=path.resolve(import.meta.dirname,'..'),exec=promisify(execFile);
const assert=(ok,code)=>{if(!ok)throw Error(code);};
export const digest=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(v)).digest('hex');
export const productRevision='2c778dca5f5d5ade464e9caa6b62b9e1584c1023';
const protocolPath='.ai-org/artifacts/WI-0262/protocol.json';
const profile='temple-continuity-probe';
export const gradeReserveMs=900000;
const deps=['ajv','ajv-formats','fast-deep-equal','fast-uri','json-schema-traverse','require-from-string'];
const exportPaths=['bin','src','project-overlay','packs','package.json','package-lock.json','test/learning-operations.test.mjs','docs/extensions/engineering-learning.md'];
const ignored=p=>p==='.git'||p.startsWith('.git/');
export const editable=p=>p.startsWith('product/src/')||/^product\/test\/learning-review-[a-z0-9-]+\.test\.mjs$/u.test(p);
const enginePaths=['scripts/learning-review-experiment.mjs','scripts/learning-review-oracle.mjs','scripts/delivery-matrix-experiment.mjs','scripts/autonomy-experiment.mjs','scripts/autonomy-fixtures.mjs','scripts/delivery-matrix-fixtures.mjs','scripts/continuity-live-runner.mjs','scripts/continuity-named-permissions.mjs','scripts/delivery-control-pair.mjs','src/codex-app-server-provider.mjs','src/app-server-protocol-replay.mjs',protocolPath,'.ai-org/artifacts/WI-0262/product-brief.md','.ai-org/artifacts/WI-0262/scenario-cases.json','.ai-org/artifacts/WI-0263/interface-contract.md','.ai-org/artifacts/WI-0263/runtime-amendment.md'];
async function json(p){return JSON.parse(await fs.readFile(p,'utf8'));}
async function put(p,v,{exclusive=false}={}){await fs.mkdir(path.dirname(p),{recursive:true});const body=typeof v==='string'?v:JSON.stringify(v,null,2)+'\n';if(exclusive)return fs.writeFile(p,body,{flag:'wx',mode:0o600});const temp=p+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,body,{mode:0o600});await fs.rename(temp,p);}
export async function manifestTree(root,prefix=''){
  const out={};for(const e of await fs.readdir(path.join(root,prefix),{withFileTypes:true})){const p=path.posix.join(prefix,e.name);if(ignored(p))continue;assert(!e.isSymbolicLink(),'export-symlink');if(e.isDirectory())Object.assign(out,await manifestTree(root,p));else{assert(e.isFile(),'export-special-file');const b=await fs.readFile(path.join(root,p));assert(b.length<=32*1024*1024,'export-file-too-large');out[p]=digest(b);}}
  return Object.fromEntries(Object.entries(out).sort(([a],[b])=>a.localeCompare(b)));
}
async function engineDigest(){
  const entries=await Promise.all(enginePaths.map(async p=>[p,digest(await fs.readFile(path.join(source,p)))]));
  return digest(entries);
}
async function copy(from,to){await fs.mkdir(path.dirname(to),{recursive:true});await fs.cp(from,to,{recursive:true,dereference:true,errorOnExist:true,force:false});}
async function snapshot(revision,to){await fs.mkdir(to);const archive=to+'.tar';await exec('git',['archive','--format=tar','-o',archive,revision],{cwd:source});await exec('/usr/bin/tar',['-xf',archive,'-C',to]);await fs.unlink(archive);}
async function installDependencies(root,all=false){if(all){await copy(path.join(source,'node_modules'),path.join(root,'node_modules'));return;}for(const p of deps)await copy(path.join(source,'node_modules',p),path.join(root,'node_modules',p));}
const sharedRules='# Shared bounded delivery rules\nRead SPEC.md and INTERFACE.md. The product under product/ is an exported source project, not the organization governing this task. Product changes are limited to product/src/** and new product/test/learning-review-*.test.mjs. Preserve all supplied tests, docs, package files and instructions. No dependencies, schema migrations, gates, external actions or auto-promotion. Choose your own investigation, design and implementation process. Run node --test product/test/*.test.mjs after final edits. Coordinator owns commits and routine lifecycle records. Return actual outcomes and blockers; another Identity verifies the product.\n';
export function actorPrompt(arm,phase,feedback=null){
  if(phase==='verify'||phase==='reverify')return 'You are product Verifier Riley, distinct from Developer Casey. Read SPEC.md and INTERFACE.md. Independently inspect product/src/** and tests and run node --test product/test/*.test.mjs. Challenge version, evidence, duplicate, concurrent and invalid-state behavior against the public contract. Do not edit any supplied file or infer execution history. Temporary tests may be created only inside .git/runtime-tmp. Judge actual product correctness and meaningful added tests; report pass/fail/blocked and actionable findings. The coordinator separately executes the shared oracle and full repository verification.';
  return 'You are Developer Casey and own the final outcome in SPEC.md and INTERFACE.md. Read AGENTS.md and all applicable instructions. Investigate, design, implement and self-test autonomously; do not stop after a plan. Preserve the public contract and allowed paths. The coordinator records Git and routine administration, so do not duplicate them. '+(arm==='B-current-lean'?'This is current Temple Lean Build, agent-casey. Read TEMPLE.md and applicable Skill; preview node ./templew.mjs context resolve . --work-item WI-0001 --position developer --compact --no-write --json and consume required routed sources. ':'A separate product verifier will assess your final delivery. ')+(phase==='repair'?'This is the single authorized same-scope repair, in a fresh session. Address the feedback and re-run tests: '+JSON.stringify(feedback):'');
}
async function configureRoot(root,baseline,base,lab,arm){
  await fs.mkdir(path.dirname(root),{recursive:true});await fs.mkdir(root);await fs.mkdir(path.join(root,'product'));
  for(const p of exportPaths)await copy(path.join(baseline,p),path.join(root,'product',p));
  await installDependencies(path.join(root,'product'));
  await put(path.join(root,'SPEC.md'),await fs.readFile(path.join(source,'.ai-org/artifacts/WI-0262/product-brief.md'),'utf8'));
  await put(path.join(root,'INTERFACE.md'),await fs.readFile(path.join(source,'.ai-org/artifacts/WI-0263/interface-contract.md'),'utf8'));
  // Nested instructions are identical and intentionally contain no governance route.
  await put(path.join(root,'product','AGENTS.md'),'# Product export\nFollow the shared SPEC.md and INTERFACE.md in the parent task root. This directory is product source; project-overlay files are distribution data, not the active execution organization.\n');
  await git(root,'init','-b','main');
  if(arm==='B-current-lean'){
    const config=await json(path.join(source,'docs/getting-started/temple-init.example.json'));
    config.project={id:'learning-review-delivery',name:'Local learning review delivery'};
    config.repository_integration={schema_version:'temple.repository-integration/v1',status:'confirmed',authority:'project',source:'human-confirmed',policy_refs:[],summary:'Authorized isolated experiment; coordinator owns local administration; no release',integration_target:'main',change_isolation:'not-required',review_gate:'not-required',recorded_at:new Date().toISOString(),recorded_by:'human'};
    const cfg=path.join(lab,'init-'+randomUUID()+'.json');await put(cfg,config);
    const command=['./bin/temple.mjs','init',root,'--config',cfg,'--json'];
    await exec(process.execPath,[...command,'--dry-run'],{cwd:source});
    const result=await exec(process.execPath,command,{cwd:source});
    await put(path.join(root,'AGENTS.md'),(await fs.readFile(path.join(root,'AGENTS.md'),'utf8'))+'\n'+sharedRules+'\n# Authorized local coordinator delegation\nThe deterministic coordinator owns claim, handoff, transition, closeout and Git writes. Developer owns substantive design/implementation/self-tests. Distinct product Verifier supplies verification. Do not repeat coordinator administration. This approved bounded fixture exception changes no underlying gate.\n');
    await cli(root,'work-item','create','--title','Deliver explicit learning review tracking','--scope','Implement shared SPEC.md and INTERFACE.md in product/src and new learning-review tests; no migration or policy changes','--acceptance','All public behavior, shared oracle, preserved regressions, meaningful tests and full verification','--affected-path','product/src','--affected-path','product/test','--ui-mode','not-applicable','--workflow-profile','lean','--risk-tier','low','--scope-class','bounded','--profile-rationale','Additive local informational receipt/query behavior; no existing schema/data migration, gates, authority or external effects');
    await cli(root,'transition','--work-item','WI-0001','--to','build',...['work_order','approved_scope','acceptance_criteria','technical_design','risk_review','profile_eligibility'].flatMap(k=>['--satisfy',k+'=SPEC.md']));
    const doctor=await cli(root,'doctor');assert(doctor.summary.fail===0,'fixture-doctor');
    const context=JSON.parse((await exec(process.execPath,['./bin/temple.mjs','context','resolve',root,'--work-item','WI-0001','--position','developer','--compact','--no-write','--json'],{cwd:source})).stdout);
    await cli(root,'status','--no-write');await fs.unlink(cfg);
    await put(path.join(lab,'lean-bootstrap.json'),{dry_run_passed:true,init_output_sha256:digest(result.stdout),doctor:doctor.summary,context,requires_fresh_actor_reads:true});
  }else await put(path.join(root,'AGENTS.md'),sharedRules);
  await git(root,'add','.');await git(root,'commit','-m','Freeze bounded source export and execution treatment');
  if(arm==='B-current-lean')await cli(root,'work-item','claim','--work-item','WI-0001','--agent-id','agent-casey','--principal-id','human','--base-revision',await git(root,'rev-parse','HEAD'),'--branch','main');
  return {id:arm,root,base_revision:await git(root,'rev-parse','HEAD'),seed:await manifestTree(root)};
}
export function validateBudget(p){
  assert(p.execution.max_generation_calls===8&&p.execution.aggregate_operational_token_limit===1920000&&Number.isSafeInteger(p.execution.wall_clock_limit_ms),'budget-envelope-drift');
  assert(p.planning_budget.phases.map(x=>x.id).join(',')==='build,verify,repair,reverify','budget-phase-drift');
  let tokens=0,ms=0;for(const f of p.planning_budget.phases){assert([f.expected_tokens,f.variability_tokens,f.observation_tokens,f.expected_ms,f.variability_ms,f.cleanup_ms].every(x=>Number.isSafeInteger(x)&&x>0),'missing-buffer');assert(f.stop_tokens===f.expected_tokens+f.variability_tokens&&f.reserved_tokens===f.stop_tokens+f.observation_tokens,'phase-token-formula');assert(f.reserved_ms===f.expected_ms+f.variability_ms+f.cleanup_ms,'phase-time-formula');tokens+=f.reserved_tokens;ms+=f.reserved_ms;}
  assert(tokens===960000&&ms===4560000&&p.planning_budget.seal_and_cleanup_ms===600000&&2*ms+p.planning_budget.shared_check_ms+p.planning_budget.seal_and_cleanup_ms===p.execution.wall_clock_limit_ms,'full-path-reserve');return true;
}
export function reserve(p,phase,calls,otherArmReserved=0){
  validateBudget(p);const phases=p.planning_budget.phases,index=phases.findIndex(f=>f.id===phase);assert(index>=0,'unknown-phase');
  const used=calls.reduce((n,c)=>n+(c.usage?.operational_tokens??0),0),time=calls.reduce((n,c)=>n+(c.elapsed_ms??0),0);
  const future=phases.slice(index).reduce((n,f)=>n+f.reserved_tokens,0),futureMs=phases.slice(index).reduce((n,f)=>n+f.reserved_ms,0);
  assert(used+future<=960000&&time+futureMs<=4560000&&used+future+otherArmReserved<=1920000,'downstream-reserve-unavailable');
  return {tokens:phases[index].stop_tokens,ms:phases[index].reserved_ms-phases[index].cleanup_ms,phase:phases[index]};
}
export function callSafe(r,phase){return r.status==='completed'&&r.usage_status==='observed-completed-turn'&&r.usage&&Number.isSafeInteger(r.usage.operational_tokens)&&r.usage.operational_tokens>=0&&r.terminals_empty===true&&r.server_exit_confirmed===true&&!r.first_stop&&!r.cleanup_failure&&!r.protected_drift?.length&&r.usage.operational_tokens<=phase.reserved_tokens&&Number.isFinite(r.elapsed_ms)&&r.elapsed_ms>=0&&r.elapsed_ms<=phase.reserved_ms;}

// Command-only server, shared across concurrent CLI assertions. No turn/start.
async function learningRuntime(root,base){const rt=await runtimeFor(root,base);rt.environment.NPM_CONFIG_CACHE=path.join(root,'.git/runtime-tmp/npm-cache');rt.environment.NPM_CONFIG_USERCONFIG='/dev/null';return rt;}
export async function withCommands(base,root,operation,{deadline=Infinity}={}){
  const rt=await learningRuntime(root,base);let protocolFailure=null;
  const c=createJsonRpcProcess(base.binary,liveArguments(rt),{cwd:root,env:subprocessEnvironment(rt.environment),onProtocolError:()=>{protocolFailure='command-protocol-error';},onRequest:(_m,responder)=>{protocolFailure='unexpected-command-server-request';responder.respond({decision:'decline'});},onNotification:m=>{if(m.method==='turn/started'||m.method==='thread/tokenUsage/updated')protocolFailure='unexpected-generation';}});let primary;const active=new Set();
  try{await c.request('initialize',{clientInfo:{name:'learning-review-offline',version:'1'},capabilities:{experimentalApi:true}});c.notify('initialized',{});assertLiveConfiguration(await c.request('config/read',{cwd:root,includeLayers:false}),rt);
    const result=await operation(async(args,{cwd=root,timeout=30000,maxBuffer=2*1024*1024}={})=>{assert(cwd===root,'oracle-cwd');assert(!protocolFailure,protocolFailure);timeout=Math.min(timeout,deadline-Date.now()-5000);assert(timeout>0,'shared-check-deadline');const id='learning-check-'+randomUUID();active.add(id);try{const r=await c.request('command/exec',{command:['/usr/bin/env','-i',...Object.entries(rt.environment).map(([k,v])=>k+'='+v),process.execPath,...args],cwd,processId:id,permissionProfile:profile,timeoutMs:timeout,outputBytesCap:maxBuffer},timeout+5000);assert(Number.isInteger(r.exitCode)&&typeof r.stdout==='string'&&typeof r.stderr==='string','invalid-command-result');assert(!protocolFailure,protocolFailure);active.delete(id);return{exit_code:r.exitCode,stdout:r.stdout,stderr:r.stderr,timed_out:r.exitCode===124};}catch(e){e.instrumentFailure=true;throw e;}});
    assert(!protocolFailure,protocolFailure);return result;
  }catch(e){primary=e;throw e;}finally{let failure=false;for(const id of active)try{await c.request('command/exec/terminate',{processId:id},5000);}catch{failure=true;}try{await c.close();}catch{failure=true;}if(failure){if(primary)primary.cleanup_failure=true;else throw Error('command-cleanup-unconfirmed');}}
}
async function preflight(base,cell){const rt=await learningRuntime(cell.root,base),c=createJsonRpcProcess(base.binary,liveArguments(rt),{cwd:cell.root,env:subprocessEnvironment(rt.environment)});try{await c.request('initialize',{clientInfo:{name:'learning-review-preflight',version:'1'},capabilities:{experimentalApi:true}});c.notify('initialized',{});assertLiveConfiguration(await c.request('config/read',{cwd:cell.root,includeLayers:false}),rt);const list=await c.request('model/list',{includeHidden:true});assert(list.data.some(m=>(m.model??m.id)==='gpt-5.6-terra'),'terra-unavailable');const t=await c.request('thread/start',{model:'gpt-5.6-terra',cwd:cell.root,approvalPolicy:'never',permissions:profile,ephemeral:true,allowProviderModelFallback:false,config:{model_reasoning_effort:'medium'}});assertActorBoundary(t,cell.root,{model:'gpt-5.6-terra',effort:'medium'});const cap=await c.request('account/rateLimits/read',{});return{model:t.model,effort:t.reasoningEffort,instruction_sources:t.instructionSources.map(p=>path.relative(cell.root,p)),capacity:{limits:Object.fromEntries(Object.entries(cap.rateLimitsByLimitId??{codex:cap.rateLimits}).map(([id,v])=>[id,{primary:v.primary,secondary:v.secondary,spend_control_reached:v.spendControlReached,rate_limit_reached:v.rateLimitReachedType}]))},generation_requested:false};}finally{await c.close();}}
async function toolsInBundle(bundle,base){const npmCli=await fs.realpath('/opt/homebrew/bin/npm'),npmRoot=path.dirname(path.dirname(npmCli));await copy(npmRoot,path.join(bundle,'tools/npm'));const bin=path.join(bundle,'tools/bin');await fs.mkdir(bin,{recursive:true});await put(path.join(bin,'npm'),'#!/bin/sh\nexec '+JSON.stringify(process.execPath)+' '+JSON.stringify(path.join(bundle,'tools/npm/bin/npm-cli.js'))+' "$@"\n');await fs.chmod(path.join(bin,'npm'),0o755);base.environment.PATH=bin+':'+base.environment.PATH;await seedOfflineCache(path.join(bundle,'tools/npm'),path.join(bundle,'tools/npm-offline-cache'));return {npm_version:(await json(path.join(npmRoot,'package.json'))).version};}
async function instructionInventory(cell){const rows=[];for(const p of Object.keys(cell.seed).filter(p=>!p.startsWith('product/')&&(p==='AGENTS.md'||p==='TEMPLE.md'||p==='SPEC.md'||p==='INTERFACE.md'||p.startsWith('.agents/skills/')))){const body=await fs.readFile(path.join(cell.root,p));rows.push({path:p,bytes:body.length,sha256:digest(body),loading:p==='AGENTS.md'?'native':'on-demand'});}return{id:cell.id,files:rows,bytes:rows.reduce((n,r)=>n+r.bytes,0),actual_tokens:null};}
export async function prepareLearningReview({budgetPath=protocolPath}={}){
  const p=await json(path.resolve(source,budgetPath));validateBudget(p);
  const {lab,bundle,base,isolation}=await matrixEnvironment('temple-learning-review-');
  const tooling=await toolsInBundle(bundle,base),baseline=path.join(lab,'baseline');await snapshot(productRevision,baseline);
  const cells=[];for(const id of ['A-autonomous','B-current-lean'])cells.push(await configureRoot(path.join(lab,'actors',id),baseline,base,lab,id));
  // configureRoot needs only an owned parent directory; actor roots stay distinct.
  const common=cells.map(c=>Object.fromEntries(Object.entries(c.seed).filter(([p])=>p.startsWith('product/')||['SPEC.md','INTERFACE.md'].includes(p))));assert(digest(common[0])===digest(common[1]),'product-parity');
  const profiles=[];for(const cell of cells)profiles.push(await preflight(base,cell));
  const native={node:process.execPath,node_version:process.version,codex_version:(await exec(base.binary,['--version'])).stdout.trim(),...tooling};
  const m={schema_version:'learning-review-experiment/v1',created_at:new Date().toISOString(),product_revision:productRevision,engine_digest:await engineDigest(),bundle_digest:digest(await manifestTree(bundle)),baseline,base,budget:p,tooling,native,isolation,preflight:profiles,cells,common_digest:digest(common[0]),prompt_digests:cells.map(c=>({id:c.id,build:digest(actorPrompt(c.id,'build')),verify:digest(actorPrompt(c.id,'verify'))})),generation_authorized:false};
  m.instruction_inventory=await Promise.all(cells.map(instructionInventory));
  await put(path.join(lab,'manifest.json'),m,{exclusive:true});await put(path.join(lab,'state.json'),{status:'prepared',generation_calls:0,cells:[],events:[]},{exclusive:true});
  return{lab,digest:digest(m),native,isolation,preflight:profiles,common_files:Object.keys(common[0]).length,common_digest:m.common_digest};
}

async function capture(root){await git(root,'add','product/src','product/test');await git(root,'commit','--allow-empty','-m','Capture delivered product');return git(root,'rev-parse','HEAD');}
async function reviewRoot(lab,cell){const root=path.join(lab,'reviews',randomUUID());await fs.mkdir(root,{recursive:true});for(const p of ['product','SPEC.md','INTERFACE.md'])await copy(path.join(cell.root,p),path.join(root,p));await put(path.join(root,'AGENTS.md'),sharedRules+'\nThis task is read-only independent product verification. Do not modify product or supplied files.\n');await git(root,'init','-b','main');return root;}
export async function verifyFull(m,cell,lab,label,deadline=Infinity){
  const started=Date.now(),container=path.join(lab,'full-checks',label+'-'+randomUUID()),root=path.join(container,'repository');
  await fs.mkdir(container,{recursive:true});
  // The unchanged suite exercises historical revisions and sibling disposable roots.
  // Only this command-only checker receives complete repository history.
  await git(container,'clone','--quiet','--no-hardlinks','--no-checkout',source,root);
  await git(root,'checkout','--quiet',productRevision);await installDependencies(root,true);
  const current=await manifestTree(cell.root);
  for(const p of Object.keys(current).filter(editable)){const target=path.join(root,p.slice('product/'.length));await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(cell.root,p),target);}
  for(const p of Object.keys(cell.seed).filter(editable))if(!current[p])await fs.rm(path.join(root,p.slice('product/'.length)));
  await git(root,'add','src','test');await git(root,'commit','--allow-empty','-m','Exact baseline plus permitted candidate delta');
  const cache=path.join(container,'.git/runtime-tmp/npm-cache');
  await copy(path.join(m.base.readRoots[2],'tools/npm-offline-cache'),cache);
  const npm=path.join(m.base.readRoots[2],'tools/npm/bin/npm-cli.js');
  // This is the repository's normal offline gate, in a disposable full checkout.
  // Its tests need system services and sibling scratch. It is not an actor sandbox.
  const rt=await learningRuntime(container,m.base);
  const result=await repositoryCheck(process.execPath,[npm,'run','verify'],{cwd:root,env:{...rt.environment,HOME:container},timeout:Math.min(600000,deadline-Date.now()-5000)});
  return{exit_code:result.exit_code,timed_out:result.timed_out,cleanup_failure:result.cleanup_failure,elapsed_ms:Date.now()-started,output_sha256:digest(result.stdout+result.stderr),diagnostics:verificationDiagnostics(result.stdout+result.stderr),accepted:result.exit_code===0&&!result.timed_out&&!result.cleanup_failure};
}
export async function repositoryCheck(binary,args,{cwd,env,timeout}){
  assert(timeout>0,'full-check-deadline');
  const child=spawn(binary,args,{cwd,env,detached:true,stdio:['ignore','pipe','pipe']});
  const result={exit_code:-1,stdout:'',stderr:'',timed_out:false,cleanup_failure:false,detected_faults:[]};
  const pid=child.pid;let bytes=0,closed=false;
  const groupAlive=()=>{if(!pid)return false;try{process.kill(-pid,0);return true;}catch(e){return e.code!=='ESRCH';}};
  const signal=sig=>{try{if(pid)process.kill(-pid,sig);}catch(e){if(e.code!=='ESRCH')result.cleanup_failure=true;}};
  const fault=code=>{if(!result.detected_faults.includes(code))result.detected_faults.push(code);result.cleanup_failure=true;};
  let escalate=null;
  const stop=()=>{signal('SIGTERM');escalate??=setTimeout(()=>signal('SIGKILL'),250);};
  const collect=field=>chunk=>{bytes+=chunk.length;if(bytes>8*1024*1024){fault('output-limit');stop();return;}result[field]+=chunk.toString();};
  child.stdout.on('data',collect('stdout'));child.stderr.on('data',collect('stderr'));
  const timer=setTimeout(()=>{result.timed_out=true;fault('timeout');stop();},timeout);
  // A detached spawn must form its own group, verified by the same OS group query.
  result.group_formed=groupAlive();if(!result.group_formed&&pid){fault('process-group-not-formed');try{child.kill('SIGKILL');}catch{}}
  await new Promise(resolve=>{
    const hard=setTimeout(()=>{fault('stream-close-unconfirmed');child.stdout.destroy();child.stderr.destroy();resolve();},timeout+1500);
    const finish=()=>{clearTimeout(hard);resolve();};
    child.once('error',()=>{fault('spawn-error');finish();});
    child.once('exit',code=>{result.exit_code=Number.isInteger(code)?code:-1;if(groupAlive()){fault('surviving-descendant');stop();}});
    child.once('close',()=>{closed=true;finish();});
  });
  clearTimeout(timer);if(escalate)clearTimeout(escalate);
  if(groupAlive()){fault('surviving-descendant');for(const sig of ['SIGTERM','SIGKILL']){signal(sig);await new Promise(r=>setTimeout(r,250));if(!groupAlive())break;}}
  result.process_group_empty=Boolean(pid)&&!groupAlive();
  result.streams_closed=closed;
  if(!result.process_group_empty||!closed)fault('cleanup-unconfirmed');
  return result;
}
async function seedOfflineCache(npmRoot,to){
  const {createRequire}=await import('node:module'),require=createRequire(path.join(npmRoot,'package.json')),cacache=require('cacache');
  const from=path.join(process.env.HOME,'.npm/_cacache'),entries=await cacache.ls(from);
  const names=new Set(deps),chosen=Object.keys(entries).filter(k=>{const m=k.match(/^make-fetch-happen:request-cache:https:\/\/registry.npmjs.org\/([^/]+)(?:\/|$)/u);return m&&names.has(m[1]);});
  assert(chosen.length>=deps.length,'offline-dependency-cache-missing');
  for(const key of chosen){const value=await cacache.get(from,key);await cacache.put(path.join(to,'_cacache'),key,value.data,{metadata:value.metadata});}
}
export function verificationDiagnostics(output){return output.split('\n').filter(l=>/^(?:not ok|✖|# (?:tests|pass|fail|duration)|.*(?:Error:|FAIL|must not exceed|exceeds|violations?:))/u.test(l)).map(l=>l.replaceAll(/\/private\/var\/folders\/\S+|\/var\/folders\/\S+/gu,'[scratch]')).slice(-80);}
async function grade(m,cell,lab,label,deadline=Infinity,verifierPass=true){const root=path.join(lab,'oracle-checks',label+'-'+randomUUID());await copy(path.join(cell.root,'product'),root);await git(root,'init','-b','main');const acceptance=await withCommands(m.base,root,command=>runReviewAcceptance({productRoot:root,scratchRoot:path.join(root,'.git','acceptance'),exec:command}),{deadline});if(acceptance.instrument_failure)return{acceptance,accepted:false,instrument_failure:acceptance.instrument_failure};if(!verifierPass||acceptance.passed!==true)return{acceptance,full:{accepted:false,not_run:true,reason:'prior-quality-gate-failed'},accepted:false};const full=await verifyFull(m,cell,lab,label,deadline);return{acceptance,full,accepted:acceptance.passed===true&&full.accepted,instrument_failure:full.timed_out||full.cleanup_failure?{code:'full-check-runtime-failure',cleanup_failure:full.cleanup_failure}:null};}
export async function releaseFixture(cell,result){if(cell.id!=='B-current-lean')return null;const ref='.ai-org/artifacts/WI-0001/experiment-result.json';await put(path.join(cell.root,ref),result);if(!result.accepted){await cli(cell.root,'work-item','release','--work-item','WI-0001','--agent-id','agent-casey','--reason','Bounded experiment stopped or product failed');return{accepted:false};}await cli(cell.root,'handoff','--work-item','WI-0001','--to','quality_evaluator','--input-revision',result.final_revision,'--completed','Exact product with distinct verifier and shared acceptance passed','--evidence',ref);await cli(cell.root,'work-item','release','--work-item','WI-0001','--agent-id','agent-casey','--reason','Verification evidence joined');await cli(cell.root,'transition','--work-item','WI-0001','--to','test','--satisfy','developer_handoff=.ai-org/artifacts/WI-0001/handoff-001-developer-to-quality_evaluator.md','--satisfy','developer_evidence='+ref);await cli(cell.root,'work-item','claim','--work-item','WI-0001','--agent-id','agent-riley','--principal-id','human','--base-revision',result.final_revision,'--branch','main');await cli(cell.root,'work-item','release','--work-item','WI-0001','--agent-id','agent-riley','--reason','Distinct verifier pass recorded');await cli(cell.root,'transition','--work-item','WI-0001','--to','done','--satisfy','test_evidence='+ref,'--satisfy','lean_closeout='+ref);const d=await cli(cell.root,'doctor');assert(d.summary.fail===0,'closeout-doctor');return{accepted:true,doctor:d.summary};}

export async function runLearningCell(cell,p,ops){
  const r={id:cell.id,status:'running',calls:[],grades:[],accepted:false,repair_used:false,human_interventions:0};
  let feedback=null,inFlight=false;
  try{
    for(let attempt=0;attempt<2;attempt++){
      const build=attempt?'repair':'build',q=attempt?'reverify':'verify';
      const b=reserve(p,build,r.calls);inFlight=true;
      const e=await ops.actor(build,b,feedback);inFlight=false;r.calls.push(e);await ops.save(r);
      assert(callSafe(e,b.phase),'unsafe-build-stop');r.final_revision=await ops.capture();
      const qb=reserve(p,q,r.calls);inFlight=true;
      const v=await ops.actor(q,qb);inFlight=false;r.calls.push(v);await ops.save(r);
      assert(callSafe(v,qb.phase),'unsafe-verifier-stop');
      const g=await ops.grade(attempt,{verifier_pass:v.completion?.decision==='pass'});r.grades.push(g);await ops.save(r);
      assert(!g.instrument_failure,'shared-acceptance-instrument-failure');
      r.accepted=v.completion?.decision==='pass'&&g.accepted===true;
      if(attempt===0)r.first_pass=r.accepted;
      if(r.accepted){r.status='accepted';break;}
      if(attempt===1){r.status='rejected';break;}
      r.repair_used=true;feedback={review:v.completion,acceptance:g.acceptance,full_verification:g.full};
    }
  }catch(e){r.status='stopped';r.first_stop=e.message;r.cohort_stop=true;if(inFlight)r.unreturned_call=true;}
  finally{r.observed_tokens=r.calls.reduce((n,c)=>n+(c.usage?.operational_tokens??0),0);r.accounting_complete=!r.unreturned_call&&r.calls.every(c=>c.usage_status==='observed-completed-turn'&&Number.isSafeInteger(c.usage?.operational_tokens));await ops.save(r);}
  return r;
}

export async function qualifyLearningReview(lab){
  const m=await json(path.join(lab,'manifest.json')),checks=[],started=Date.now();
  const before=m.cells.map(c=>digest(c.seed));
  for(const cell of m.cells){
    const r=await withCommands(m.base,cell.root,c=>c(['--test',path.join(cell.root,'product/test/learning-operations.test.mjs')],{cwd:cell.root,timeout:120000}));
    checks.push({id:cell.id+'-existing-learning',passed:r.exit_code===0&&!r.timed_out,exit_code:r.exit_code,output_sha256:digest(r.stdout+r.stderr),diagnostics:verificationDiagnostics(r.stdout+r.stderr)});
  }
  const root=path.join(lab,'negative-oracle-control');await copy(path.join(m.cells[0].root,'product'),root);await git(root,'init','-b','main');
  const oracle=await withCommands(m.base,root,c=>runReviewAcceptance({productRoot:root,scratchRoot:path.join(root,'.git/acceptance'),exec:c}));
  checks.push({id:'missing-product-is-rejected',passed:!oracle.passed&&!oracle.instrument_failure&&oracle.cases.length===20&&oracle.cases.filter(c=>!['S1-13','S1-14'].includes(c.id)).every(c=>!c.passed),oracle});
  const clone=path.join(lab,'lean-lifecycle-control');await copy(m.cells[1].root,clone);
  const lifecycle=await releaseFixture({...m.cells[1],root:clone},{accepted:true,final_revision:m.cells[1].base_revision,note:'Generation-free lifecycle plumbing only; no product or model acceptance is claimed.'});
  checks.push({id:'lean-lifecycle',passed:lifecycle.accepted===true,lifecycle});
  const blind=await reviewRoot(lab,m.cells[1]),visible=await manifestTree(blind);
  checks.push({id:'blind-verifier-export',passed:Object.keys(visible).every(p=>p.startsWith('product/')||['SPEC.md','INTERFACE.md','AGENTS.md'].includes(p)),native:await preflight(m.base,{root:blind})});
  for(let i=0;i<m.cells.length;i++)assert(digest(await manifestTree(m.cells[i].root))===before[i],'qualification-mutated-seed');
  const full=await verifyFull(m,m.cells[0],lab,'baseline-qualified');
  checks.push({id:'unchanged-full-baseline',passed:full.accepted,full});
  const q={schema_version:'learning-review-qualification/v1',manifest_sha256:digest(m),checks,passed:checks.every(c=>c.passed),generation_calls:0,elapsed_ms:Date.now()-started};
  q.check_budget={per_grade_reserved_ms:gradeReserveMs,max_grades:4,required_shared_ms:4*gradeReserveMs,configured_shared_ms:m.budget.planning_budget.shared_check_ms,baseline_ms:full.elapsed_ms};
  if(m.budget.planning_budget.shared_check_ms<4*gradeReserveMs||full.elapsed_ms>600000){q.passed=false;q.launch_blocker='insufficient-shared-check-reserve';}
  await put(path.join(lab,'qualification.json'),q,{exclusive:true});return q;
}

export function remainingBatchReserve(p,state,cellIndex,phase,elapsed){
  validateBudget(p);
  const rows=state.cells,all=rows.flatMap(c=>c.calls??[]),current=rows[cellIndex]?.calls??[];
  reserve(p,phase,current);
  const phases=p.planning_budget.phases,index=phases.findIndex(f=>f.id===phase);
  const other=1-cellIndex;
  const remainingTokens=phases.slice(index).reduce((n,f)=>n+f.reserved_tokens,0)+other*960000;
  const remainingMs=phases.slice(index).reduce((n,f)=>n+f.reserved_ms,0)+other*4560000;
  const usedTokens=all.reduce((n,c)=>n+(c.usage?.operational_tokens??0),0);
  const actorMs=all.reduce((n,c)=>n+(c.elapsed_ms??0),0),checkMs=state.shared_check_ms??0;
  const overheadMs=Math.max(0,elapsed-actorMs-checkMs);
  assert(checkMs<=p.planning_budget.shared_check_ms,'shared-check-budget');
  assert(overheadMs<p.planning_budget.seal_and_cleanup_ms-5000,'seal-buffer-exhausted');
  assert(usedTokens+remainingTokens<=1920000,'aggregate-token-reserve');
  const checkLeft=p.planning_budget.shared_check_ms-checkMs;
  const futureGrades=(index<2?2:1)+other*2;
  assert(checkLeft>=futureGrades*gradeReserveMs,'downstream-check-reserve-unavailable');
  const sealLeft=p.planning_budget.seal_and_cleanup_ms-overheadMs;
  assert(elapsed+remainingMs+checkLeft+sealLeft<=p.execution.wall_clock_limit_ms,'aggregate-time-reserve');
  return {remainingTokens,remainingMs,checkLeft,sealLeft};
}

export async function executeLearningReview(lab,expected,approvalPath){
  const m=await json(path.join(lab,'manifest.json')),state=await json(path.join(lab,'state.json')),approval=await json(approvalPath);
  validateBudget(m.budget);
  assert(digest(m)===expected&&m.engine_digest===await engineDigest(),'frozen-source-drift');
  assert(m.bundle_digest===digest(await manifestTree(m.base.readRoots[2])),'bundle-drift');
  assert(approval.approved===true&&approval.manifest_sha256===expected&&approval.instrument_revision===await git(source,'rev-parse','HEAD')&&approval.readiness_passed===true,'launch-not-approved');
  assert(approval.approved_wall_clock_limit_ms===m.budget.execution.wall_clock_limit_ms&&approval.approved_operational_tokens===1920000&&approval.approved_generation_calls===8,'launch-budget-not-approved');
  const qualification=await json(path.join(lab,'qualification.json'));
  assert(qualification.passed===true&&qualification.manifest_sha256===expected&&qualification.generation_calls===0,'runtime-not-qualified');
  assert(state.status==='prepared'&&state.generation_calls===0&&state.cells.length===0,'lab-not-fresh');
  for(const c of m.cells)assert(digest(await manifestTree(c.root))===digest(c.seed),'seed-drift');
  await acquireRun(lab);
  const started=Date.now(),deadline=started+m.budget.execution.wall_clock_limit_ms;
  state.status='running';state.started_at=new Date(started).toISOString();state.shared_check_ms=0;
  let pending=Promise.resolve();
  const save=()=>put(path.join(lab,'state.json'),state);
  try{
    for(const cell of m.cells){
      assert(Date.now()<deadline,'batch-time-limit');
      const index=state.cells.length;state.cells.push({id:cell.id,status:'starting',calls:[]});
      const ops={
        save:async r=>{state.cells[index]=structuredClone(r);await pending;await save();},
        capture:()=>capture(cell.root),
        grade:async (attempt,{verifier_pass})=>{
          const checkStarted=Date.now(),left=Math.min(gradeReserveMs,m.budget.planning_budget.shared_check_ms-state.shared_check_ms);
          assert(left>5000,'shared-check-budget');
          try{return await grade(m,cell,lab,cell.id+'-'+attempt,Math.min(checkStarted+left,deadline-5000),verifier_pass);}
          finally{state.shared_check_ms+=Date.now()-checkStarted;await save();}
        },
        actor:async(phase,budget,feedback)=>{
          assert(state.generation_calls<8,'generation-limit');
          remainingBatchReserve(m.budget,state,index,phase,Date.now()-started);
          const review=phase==='verify'||phase==='reverify',root=review?await reviewRoot(lab,cell):cell.root;
          const before=await manifestTree(root),rt=await learningRuntime(root,m.base);
          const r=await runActor(rt,actorPrompt(cell.id,phase,feedback),{
            tokens:budget.tokens,ms:budget.ms,model:'gpt-5.6-terra',effort:'medium',
            beforeGeneration:async info=>{
              state.generation_calls++;state.events.push({kind:'generation-start',cell:cell.id,phase,at:new Date().toISOString(),...info});
              await save();
            },
            onProgress:u=>{pending=pending.then(async()=>{state.latest={cell:cell.id,phase,...u,warning:u.operational_tokens>=budget.phase.expected_tokens};await save();});}
          });
          await pending;r.phase=phase;
          return finalizeActorObservation(r,before,()=>manifestTree(root),review);
        }
      };
      const result=await runLearningCell(cell,m.budget,ops);
      try{result.lifecycle=await releaseFixture(cell,result);}
      catch(e){result.lifecycle_error=e.message;result.cohort_stop=true;}
      state.cells[index]=result;await save();
      if(result.cohort_stop){state.status='stopped';break;}
    }
    if(state.status==='running')state.status='completed';
  }catch(e){state.status='stopped';state.first_stop=e.message;}
  finally{
    await pending;state.finished_at=new Date().toISOString();state.elapsed_ms=Date.now()-started;
    state.observed_tokens=state.cells.reduce((n,c)=>n+(c.observed_tokens??0),0);
    const returnedCalls=state.cells.flatMap(c=>c.calls??[]);
    state.accounting_complete=state.generation_calls===returnedCalls.filter(c=>c.generation_requested!==false).length&&state.cells.every(c=>c.accounting_complete===true);
    await save();
    await put(path.join(lab,'seal.json'),{manifest_sha256:expected,state_sha256:digest(state),status:state.status,finished_at:state.finished_at},{exclusive:true});
  }
  return state;
}
export async function finalizeActorObservation(result,before,scan,review){
  try{const after=await scan();result.protected_drift=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(p=>before[p]!==after[p]&&(review||!editable(p)));}
  catch(error){result.post_call_fault=error.message;result.protected_drift=['post-call-scope-unverified'];}
  return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const [command,lab,hash,approval]=process.argv.slice(2);try{const r=command==='prepare'?await prepareLearningReview({budgetPath:lab??protocolPath}):command==='qualify'?await qualifyLearningReview(lab):command==='run'?await executeLearningReview(lab,hash,approval):null;assert(r,'unknown-command');console.log(JSON.stringify(r,null,2));if(r.status==='stopped')process.exitCode=1;}catch(e){console.error(e.stack);process.exitCode=1;}}
