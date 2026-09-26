// Repository-only installed-provider qualification; never sends turn/start.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {createJsonRpcProcess} from '../src/codex-app-server-provider.mjs';
import {matrixEnvironment} from './delivery-matrix-experiment.mjs';
import {seed,write,read,run,cli,git,tree,runtimeFor} from './autonomy-experiment.mjs';
import {liveArguments,assertLiveConfiguration} from './continuity-live-runner.mjs';
import {subprocessEnvironment} from './delivery-control-pair.mjs';
import {probeNamedPermissions} from './continuity-named-permissions.mjs';
import {docFixture,referenceBoundaryMutations} from './real-doc-check-fixture-v5.mjs';
import {checkDeliveryFiles} from './core-delivery-grader.mjs';

const exec=promisify(execFile),source=path.resolve(import.meta.dirname,'..');
const check=(ok,message)=>{if(!ok)throw Error(message);};
export const digest=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(v)).digest('hex');
export async function installCoreControl(root,lab){
  const config=await read(source,'docs/getting-started/temple-init.example.json');
  config.project={id:'core-comparison-fixture',name:'Local documentation utility comparison'};
  config.repository_integration={schema_version:'temple.repository-integration/v1',status:'confirmed',authority:'project',source:'human-confirmed',policy_refs:[],summary:'Authorized isolated fixture; coordinator owns Git and lifecycle bookkeeping',integration_target:'main',change_isolation:'not-required',review_gate:'not-required',recorded_at:'2026-09-08T00:00:00Z',recorded_by:'human'};
  const configFile=path.join(lab,'init-'+path.basename(root)+'.json');await fs.writeFile(configFile,JSON.stringify(config),{flag:'wx'});
  await run(source,process.execPath,[path.join(source,'bin/temple.mjs'),'init',root,'--config',configFile,'--json']);
  await fs.appendFile(path.join(root,'AGENTS.md'),'\n# Authorized local experiment assignment\nThe deterministic coordinator owns Git, Work Item claims, handoffs, transitions and evidence recording. Developer agent-casey owns substantive design, implementation and self-tests; distinct agent-riley verifies the exact product. Do not duplicate coordinator writes. Preserve SPEC.md and all supplied files; only direct src/doc-*.mjs and test/additional.test.mjs may change.\n');
  await cli(root,'work-item','create','--title',docFixture.title,'--scope','Implement the selected Markdown file extension in SPEC.md within this isolated documentation utility','--acceptance','All SPEC.md requirements, preserved public regressions and meaningful additional tests','--affected-path','src/doc-*.mjs','--affected-path','test/additional.test.mjs','--ui-mode','not-applicable','--workflow-profile','lean','--risk-tier','low','--scope-class','bounded','--profile-rationale','Reversible local utility fixture, fixed brief and no external effects');
  await cli(root,'transition','--work-item','WI-0001','--to','build',...['work_order','approved_scope','acceptance_criteria','technical_design','risk_review','profile_eligibility'].flatMap(g=>['--satisfy',g+'=SPEC.md']));
  await git(root,'add','.');await git(root,'commit','-m','Prepare exact Lean control contract');
}
export async function fileDigest(file){const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex');}
export async function executionSourcePin(){
  const {stdout}=await exec('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:source});
  const names=[...new Set(stdout.split('\0').filter(p=>/^(src\/|bin\/|project-overlay\/|packs\/|scripts\/)|^package(-lock)?\.json$/.test(p)||p==='docs/getting-started/temple-init.example.json'))].sort();
  const files=Object.fromEntries(await Promise.all(names.map(async p=>[p,await fileDigest(path.join(source,p))])));
  return {sha256:digest(files),files};
}
export function validateReservations(settings){
  check(settings?.schema_version==='temple.core-runtime-settings/v1'&&settings.concurrency===1&&settings.repairs_per_cell===1,'settings-contract');
  check(settings.model_generation_authorized===false&&settings.external_spend_jpy===0&&settings.retry===false&&settings.fallback===false&&settings.reset===false,'settings-authority');
  const stages=['build','recovery','verify','repair','reverify'];
  check(JSON.stringify(Object.keys(settings.phases))===JSON.stringify(stages),'phase-contract');
  for(const p of Object.values(settings.phases))check(Object.values(p).every(n=>Number.isSafeInteger(n)&&n>0)&&p.expected_tokens<p.stop_tokens&&p.stop_tokens<p.reserve_tokens&&p.expected_ms<p.stop_ms&&p.stop_ms+20000<=p.reserve_ms,'missing-phase-buffer');
  check(settings.setup_reserve&&Number.isSafeInteger(settings.setup_reserve.tokens)&&settings.setup_reserve.tokens>=0&&Number.isSafeInteger(settings.setup_reserve.time_ms)&&settings.setup_reserve.time_ms>0&&settings.setup_reserve.calls===0,'missing-setup-reserve');
  for(const p of [settings.cell_extra_reserve,settings.batch_overhead])check(p&&['tokens','time_ms'].every(k=>Number.isSafeInteger(p[k])&&p[k]>0)&&p.calls===0,'missing-outer-buffer');
  const cell={tokens:Object.values(settings.phases).reduce((n,p)=>n+p.reserve_tokens,0)+settings.cell_extra_reserve.tokens+settings.setup_reserve.tokens,time_ms:Object.values(settings.phases).reduce((n,p)=>n+p.reserve_ms,0)+settings.cell_extra_reserve.time_ms+settings.setup_reserve.time_ms,calls:stages.length};
  check(['tokens','time_ms','calls'].every(k=>Number.isSafeInteger(settings.ceilings?.[k])&&settings.ceilings[k]===4*cell[k]+settings.batch_overhead[k]),'aggregate-reservation');
  return {cell,aggregate:settings.ceilings};
}
export function phaseReservation(settings,stage,observed){
  const totals=validateReservations(settings),names=Object.keys(settings.phases),index=names.indexOf(stage);
  check(index>=0&&observed&&['tokens','time_ms','calls'].every(k=>Number.isSafeInteger(observed[k])&&observed[k]>=0),'invalid-phase-observation');
  const remaining=names.slice(index).map(n=>settings.phases[n]);
  check(observed.tokens+remaining.reduce((n,p)=>n+p.reserve_tokens,0)+settings.cell_extra_reserve.tokens+settings.setup_reserve.tokens<=totals.cell.tokens&&observed.time_ms+remaining.reduce((n,p)=>n+p.reserve_ms,0)+settings.cell_extra_reserve.time_ms+settings.setup_reserve.time_ms<=totals.cell.time_ms&&observed.calls+remaining.length<=totals.cell.calls,'downstream-reserve-unavailable');
  return settings.phases[stage];
}

// Check effective fields and instruction inventory, not only schema acceptance.
export async function inspectArmRuntime(base,root,{core=false}={}){
  const runtime=await runtimeFor(root,base);let c,unexpected=false;
  const result={status:'failed',model_generation_performed:false,server_exit_confirmed:false,models:[],instruction_sources:[],controls:{}};
  try{
    c=createJsonRpcProcess(base.binary,liveArguments(runtime),{cwd:root,env:subprocessEnvironment(runtime.environment),onRequest:()=>{unexpected=true;},onProtocolError:()=>{unexpected=true;},onNotification:m=>{if(m.method?.startsWith('turn/')||m.method==='thread/tokenUsage/updated')unexpected=true;}});
    const request=async(method,params)=>{check(['initialize','config/read','model/list','thread/start','thread/backgroundTerminals/list','thread/backgroundTerminals/clean','command/exec'].includes(method),'generation-forbidden');const r=await c.request(method,params,15000);check(!unexpected,'unexpected-protocol-or-generation');return r;};
    await request('initialize',{clientInfo:{name:'temple-core-qualification',version:'1'},capabilities:{experimentalApi:true}});c.notify('initialized',{});
    assertLiveConfiguration(await request('config/read',{cwd:root,includeLayers:false}),runtime);
    const models=await request('model/list',{includeHidden:true});
    for(const model of ['gpt-5.6-terra','gpt-6-astra']){
      check(models.data?.some(m=>(m.model===model||m.id===model)&&m.supportedReasoningEfforts?.some(e=>e.reasoningEffort==='medium')),'model-effort-unavailable');
      const t=await request('thread/start',{model,cwd:root,approvalPolicy:'never',permissions:'temple-continuity-probe',ephemeral:true,allowProviderModelFallback:false,config:{model_reasoning_effort:'medium'}});
      check(t.model===model&&t.reasoningEffort==='medium'&&t.cwd===root&&t.thread?.turns?.length===0,'effective-thread-drift');
      check(t.activePermissionProfile?.id==='temple-continuity-probe'&&!t.activePermissionProfile.extends&&t.approvalPolicy==='never','effective-permissions');
      check(Array.isArray(t.instructionSources)&&t.instructionSources.includes(path.join(root,'AGENTS.md'))&&t.instructionSources.every(p=>typeof p==='string'&&p.startsWith(root+path.sep)),'native-instruction-leak');
      if(core)check(t.instructionSources.every(p=>p===path.join(root,'AGENTS.md')),'core-native-instruction-leak');
      const terminals=await request('thread/backgroundTerminals/list',{threadId:t.thread.id});check(Array.isArray(terminals.data)&&!terminals.data.length&&!terminals.nextCursor,'unexpected-terminal');
      await request('thread/backgroundTerminals/clean',{threadId:t.thread.id});
      result.models.push({model:t.model,effort:t.reasoningEffort});result.instruction_sources=t.instructionSources.map(p=>path.relative(root,p));
    }
    const outside=path.join(path.dirname(root),'private-control-marker');await fs.writeFile(outside,'private-control');
    const node=path.join(base.readRoots[0],'node');
    for(const [label,file,expected] of [['own',path.join(root,'SPEC.md'),'read'],['control',outside,'denied']]){
      const script="try{require('node:fs').readFileSync(process.argv[1]);process.stdout.write('read')}catch(e){if(!['EACCES','EPERM'].includes(e.code))process.exit(3);process.stdout.write('denied')}";
      const r=await request('command/exec',{command:[node,'-e',script,file],cwd:root,permissionProfile:'temple-continuity-probe',env:{OPENSSL_CONF:'/dev/null'},timeoutMs:5000,outputBytesCap:2048});
      check(r.exitCode===0&&r.stdout===expected,'arm-read-isolation');result.controls[label]=expected;
    }
    result.status='configured-empty-threads-and-command-controls-passed';
  }catch(e){result.failure=/^[a-z-]+$/.test(e.message)?e.message:'provider-or-local-operation-failed';}
  finally{try{if(c){await c.close();result.server_exit_confirmed=true;}}catch{result.cleanup_failure='server-close-unconfirmed';}if(unexpected){result.failure='unexpected-protocol-or-generation';result.model_generation_performed='unknown';}if(result.failure||result.cleanup_failure)result.status='failed';}
  return result;
}
export async function qualifyCoreRuntime(){
  const settings=JSON.parse(await fs.readFile(path.join(source,'scripts/evaluation-catalog/core-runtime.settings.json'))),reservations=validateReservations(settings);
  const environment=await matrixEnvironment('temple-core-qualification-');
  const {lab,base}=environment,checks=[];
  await write(lab,'adapter-base.json',base,true);
  const sandbox=await probeNamedPermissions({binary:base.binary});
  for(const [kind,files,name] of [['seed',docFixture.seed],['reference',docFixture.reference],...docFixture.mutations.map(m=>['mutant',{...docFixture.reference,...m.files},m.name]),...referenceBoundaryMutations.map(m=>['reference-fault',{...docFixture.reference,...m.files},m.name])])checks.push({kind,name,...await checkDeliveryFiles(files,docFixture,base,lab,'core-control',['oracle.test.mjs',...Object.keys(docFixture.publicTests)])});
  check(checks.every(c=>!c.invalid_execution&&!c.timed_out&&c.cancelled===0&&c.tests>0&&(c.kind==='reference'?c.exit_code===0&&c.passed===c.tests&&c.delivery.accepted:c.exit_code!==0&&c.failures>0)),'oracle-controls-failed');
  const arms={};
  for(const core of [false,true]){
    const root=path.join(lab,core?'core-product':'lean-product');await seed(root,docFixture);
    if(core)await write(root,'AGENTS.md','# Isolated core product assignment\nRead the coordinator task contract and SPEC.md. Keep scope, permissions and acceptance intact. Choose your own implementation method. Coordinator owns all Temple administration.\n');
    else await installCoreControl(root,lab);
    arms[core?'core':'lean']=await inspectArmRuntime(base,root,{core});
  }
  const result={schema_version:'temple.core-runtime-qualification/v1',source_pin:await executionSourcePin(),fixture_sha256:digest(docFixture),settings_sha256:digest(settings),reservations,native:{node:{version:process.version,sha256:await fileDigest(process.execPath)},codex:{sha256:await fileDigest(base.binary)}},bundle_sha256:digest(await tree(environment.bundle)),sandbox,oracle_controls:checks,arms,model_generation_performed:false,live_ready:false,native_model_tools:'first-authorized-subject-canary-required',handoff_restart:'not-yet-rehearsed',launch_approval:'not-present'};
  result.status=sandbox.status==='bounded-controls-passed'&&Object.values(arms).every(a=>a.status!=='failed')?'bounded-runtime-controls-passed':'blocked';
  await write(lab,'qualification.json',result,true);
  return {lab,result};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  if(process.argv[2]!=='qualify')throw Error('Use qualify; this entrypoint never generates a model turn');
  const r=await qualifyCoreRuntime();console.log(JSON.stringify(r,null,2));if(r.result.status==='blocked')process.exitCode=1;
}
