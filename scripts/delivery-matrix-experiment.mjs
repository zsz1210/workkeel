// Coordinator-only experiment. Never expose this module or fixtures to subjects.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {fixtures} from './delivery-matrix-fixtures.mjs';
import {runActor,fatal,acquireRun,scopeChanges,assertActorBoundary,write,read,run,git,cli,tree,seed,bundleRuntime,runtimeFor,qualifyIsolation} from './autonomy-experiment.mjs';
import {createJsonRpcProcess} from '../src/codex-app-server-provider.mjs';
import {liveArguments,assertLiveConfiguration,discoverRuntime,isolatedOracleExecutor} from './continuity-live-runner.mjs';
import {subprocessEnvironment} from './delivery-control-pair.mjs';

const source=path.resolve(import.meta.dirname,'..');
const check=(ok,code)=>{if(!ok)throw Error(code);};
const hash=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(v)).digest('hex');
export const matrixLimits=Object.freeze({cell_tokens:180000,cell_ms:900000,qa_tokens:40000,qa_ms:240000,cells:8,qa_model:'gpt-5.6-terra',effort:'medium'});
export function matrixCells(){
  const order=[['batch','autonomous','terra'],['batch','temple','gpt6'],['batch','autonomous','gpt6'],['batch','temple','terra'],['retry','temple','terra'],['retry','autonomous','gpt6'],['retry','temple','gpt6'],['retry','autonomous','terra']];
  return order.map(([task,workflow,model])=>({id:[task,workflow,model].join('-'),task,workflow,model:model==='terra'?'gpt-5.6-terra':'gpt-6-astra',effort:'medium'}));
}
const productScope='Read SPEC.md, the approved goal and technical brief. Implement all required behavior and add meaningful regression tests in test/additional.test.mjs. Choose your own implementation and internal process. Product edits are limited to src/** and test/additional.test.mjs. Preserve supplied tests, requirements, package.json and instructions. Use node --test test/*.test.mjs after final changes. The coordinator records Git and lifecycle state; do not do those writes yourself. Report completed behavior, actual verification and real blockers; your claim is not independent acceptance.';
export function matrixPrompt(workflow,stage,feedback=null){
  if(stage==='review')return 'You are the independent product Verifier, agent-riley, distinct from Developer agent-casey. Read SPEC.md; inspect the candidate and run node --test test/*.test.mjs. Challenge behavior and meaningful new regression coverage. Do not edit any supplied file. You may run temporary non-persistent checks. Judge product correctness and required test delivery, not administrative formatting. You cannot see execution history. Return pass/fail/blocked with a concise summary and actionable findings.';
  const route=workflow==='temple'?'This is eligible Temple Lean Build, Developer agent-casey. Read TEMPLE.md and applicable instructions. Preview node ./templew.mjs context resolve . --work-item WI-0001 --position developer --compact --no-write --json; then read only required routed bodies. Follow approved SPEC.md. The coordinator owns all routine claim, handoff, transition and evidence writes. Do not duplicate them.':'You are Developer agent-casey, responsible for the final bounded outcome. Plan, investigate, implement and self-verify autonomously; a separate Verifier assesses the result.';
  return productScope+'\n'+route+(stage==='repair'?'\nThis is the single allowed same-scope repair. Address this feedback and reverify: '+JSON.stringify(feedback):'');
}
export function validateMatrix(m){
  check(m.schema_version==='delivery-matrix/v1'&&hash(m.limits)===hash(matrixLimits),'matrix-contract-drift');
  const expected=matrixCells();check(m.cells?.length===expected.length,'matrix-cell-count');
  expected.forEach((e,i)=>check(Object.entries(e).every(([k,v])=>m.cells[i][k]===v),'matrix-cell-drift'));
}
const editable=p=>p.startsWith('src/')||p==='test/additional.test.mjs';
export const fixtureEditable=(f,p)=>Array.isArray(f.editablePaths)?f.editablePaths.includes(p):editable(p);
const productFile=p=>p.startsWith('src/')||p.startsWith('test/');
async function sourceDigest(){const names=['scripts/delivery-matrix-experiment.mjs','scripts/delivery-matrix-fixtures.mjs','scripts/autonomy-experiment.mjs','scripts/autonomy-fixtures.mjs','scripts/continuity-live-runner.mjs','scripts/continuity-named-permissions.mjs','scripts/delivery-control-pair.mjs','src/codex-app-server-provider.mjs','src/app-server-protocol-replay.mjs','.ai-org/artifacts/WI-0251/design.md'];return hash(await Promise.all(names.map(async p=>[p,hash(await fs.readFile(path.join(source,p)))])));}
async function commitProduct(root){await git(root,'add','src','test');if(await git(root,'diff','--cached','--name-only'))await git(root,'commit','-m','Capture exact product candidate');return git(root,'rev-parse','HEAD');}
export async function installLean(root,lab,f){
  const started=Date.now(),config=await read(source,'docs/getting-started/temple-init.example.json');
  config.project={id:'matrix-fixture',name:'Bounded local matrix fixture'};
  config.repository_integration={schema_version:'temple.repository-integration/v1',status:'confirmed',authority:'project',source:'human-confirmed',policy_refs:[],summary:'Authorized local synthetic experiment; coordinator performs fixed administration',integration_target:'main',change_isolation:'not-required',review_gate:'not-required',recorded_at:'2026-09-07T00:00:00Z',recorded_by:'human'};
  const configFile='init-'+randomUUID()+'.json';await write(lab,configFile,config);
  // Initialize from the candidate distribution, not the retained repository lock.
  await run(source,process.execPath,[path.join(source,'bin/temple.mjs'),'init',root,'--config',path.join(lab,configFile),'--json']);
  await fs.appendFile(path.join(root,'AGENTS.md'),'\n# Authorized synthetic execution contract\nThis local experiment delegates routine Work Item, claim, evidence, handoff, transition and Git writes to its deterministic coordinator. Developer supplies substantive design choices, implementation and self-tests. The blind external product Verifier supplies distinct verification evidence; coordinator joins it at Lean Test. No actor should duplicate coordinator writes. Product scope is '+(f.editablePaths?.join(' and ')??'src/** and test/additional.test.mjs')+' only.\n');
  await cli(root,'work-item','create','--title',f.title,'--scope','Implement SPEC.md within this local memory-only fixture','--acceptance','SPEC.md behavior, preserved supplied regressions and meaningful added regression tests','--affected-path','src','--affected-path','test/additional.test.mjs','--ui-mode','not-applicable','--workflow-profile','lean','--risk-tier','low','--scope-class','bounded','--profile-rationale','Local reversible synthetic fixture; approved brief and fixed module contracts, no external effects');
  await cli(root,'transition','--work-item','WI-0001','--to','build',...['work_order','approved_scope','acceptance_criteria','technical_design','risk_review','profile_eligibility'].flatMap(g=>['--satisfy',g+'=SPEC.md']));
  await git(root,'add','.');await git(root,'commit','-m','Prepare eligible Lean workflow');
  return {setup_ms:Date.now()-started};
}
async function templeClaim(root){return cli(root,'work-item','claim','--work-item','WI-0001','--agent-id','agent-casey','--principal-id','human','--base-revision',await git(root,'rev-parse','HEAD'),'--branch','main');}
export async function closeLean(root,result){
  const ref='.ai-org/artifacts/WI-0001/product-evidence.json';await write(root,ref,result);
  if(!result.accepted){await cli(root,'work-item','release','--work-item','WI-0001','--agent-id','agent-casey','--reason','Bounded product attempt stopped or rejected');return {state:'build',closed:false,reason:'product-not-accepted'};}
  await cli(root,'handoff','--work-item','WI-0001','--to','quality_evaluator','--input-revision',result.final_revision,'--completed','Delivered exact candidate with self-tests; distinct blind verification retained','--evidence',ref);
  await cli(root,'work-item','release','--work-item','WI-0001','--agent-id','agent-casey','--reason','Evidence handed to distinct Verifier');
  await cli(root,'transition','--work-item','WI-0001','--to','test','--satisfy','developer_handoff=.ai-org/artifacts/WI-0001/handoff-001-developer-to-quality_evaluator.md','--satisfy','developer_evidence='+ref);
  await cli(root,'work-item','claim','--work-item','WI-0001','--agent-id','agent-riley','--principal-id','human','--base-revision',result.final_revision,'--branch','main');
  await cli(root,'transition','--work-item','WI-0001','--to','done','--satisfy','test_evidence='+ref,'--satisfy','lean_closeout='+ref);
  const doctor=await cli(root,'doctor');check(doctor.summary?.fail===0,'lean-closeout-doctor');
  return {state:'done',closed:true,doctor:doctor.summary};
}
async function product(root){const files={};for(const p of Object.keys(await tree(root)).filter(productFile))files[p]=await fs.readFile(path.join(root,p),'utf8');return files;}
export async function checkFiles(files,f,base,lab,label,tests){
  const root=path.join(lab,'checks',label+'-'+randomUUID());await fs.mkdir(root,{recursive:true});
  for(const[p,body]of Object.entries({...files,...f.publicTests,'package.json':JSON.stringify({type:'module'}),'oracle.test.mjs':f.hiddenTests}))await write(root,p,body);
  const r=await isolatedOracleExecutor(base,root,process.execPath,['--test','--test-timeout=1000','--test-reporter=tap',...tests],{timeout:4000,maxBuffer:256*1024});
  return classifyMatrixCheck(r);
}
export function classifyMatrixCheck(r){
  const count=name=>Number(r.stdout.match(new RegExp('^# '+name+' (\\d+)','m'))?.[1]??0);
  return {exit_code:r.exit_code,failed_cases:r.stdout.split('\n').filter(l=>/^not ok /u.test(l)),tests:count('tests'),passed:count('pass'),failures:count('fail'),cancelled:count('cancelled'),timed_out:/testTimeoutFailure|test timed out/u.test(r.stdout)||r.timed_out===true,output_sha256:hash(r.stdout+r.stderr),invalid_execution:/SyntaxError|ERR_MODULE_NOT_FOUND|Library not loaded/u.test(r.stdout+r.stderr)};
}
export async function gradeProduct(root,f,base,lab,{onProgress=async()=>{},check=checkFiles}={}){
  const files=await product(root),hasTests=Object.hasOwn(files,'test/additional.test.mjs');
  const result={status:'running',behavior:null,regression:null,reference_baseline:null,mutation_status:'not-run',mutations:[],accepted:false,elapsed_ms:0},started=Date.now();
  const save=async()=>{result.elapsed_ms=Date.now()-started;await onProgress(structuredClone(result));};
  try{
    await save();result.behavior=await check(files,f,base,lab,'behavior',['oracle.test.mjs',...Object.keys(files).filter(p=>p.startsWith('test/')&&p.endsWith('.test.mjs'))]);await save();
    result.regression=hasTests?await check(files,f,base,lab,'regression',['test/additional.test.mjs']):null;await save();
    if(result.regression?.exit_code===0&&result.regression.tests>0){
      result.reference_baseline=await check({...files,...f.reference},f,base,lab,'reference-baseline',['test/additional.test.mjs']);
      result.mutation_status=result.reference_baseline.exit_code===0?'qualified':'unqualified-reference-baseline';await save();
      if(result.mutation_status==='qualified')for(const m of f.mutations){const r=await check({...files,...m.files},f,base,lab,'mutation',['test/additional.test.mjs']);result.mutations.push({name:m.name,detected:r.exit_code!==0&&r.failures>0&&r.cancelled===0&&!r.timed_out&&!r.invalid_execution,...r});await save();}
    }
    result.accepted=result.behavior.exit_code===0&&hasTests&&result.regression?.exit_code===0&&result.regression.tests>0;result.status='completed';
  }catch(e){result.status='instrument-failure';result.failure=e.message;throw Object.assign(e,{partialGrade:result});}
  finally{await save();}
  return result;
}
async function reviewProduct(root,f,base,lab,budget,onStart){
  const target=path.join(lab,'actors',randomUUID());await fs.mkdir(target,{recursive:true});
  for(const[p,body]of Object.entries({...await product(root),...f.publicTests,'SPEC.md':f.spec,'package.json':JSON.stringify({type:'module'})}))await write(target,p,body);
  await write(target,'AGENTS.md','# Blind product verification\nOnly SPEC.md defines acceptance. Inspect and test without edits. Do not seek other repositories or execution history.\n');
  const before=await tree(target),r=await runActor(await runtimeFor(target,base),matrixPrompt(null,'review'),{tokens:Math.min(matrixLimits.qa_tokens,budget.tokens),ms:Math.min(matrixLimits.qa_ms,budget.ms),model:matrixLimits.qa_model,effort:'medium',beforeGeneration:onStart});
  try{r.protected_drift=scopeChanges(before,await tree(target),()=>false);}catch(e){r.postprocess_failure=e.message;r.first_stop??='review-inspection';r.status='stopped';}return r;
}
export function productAccepted(execution,review,grade){return execution.status==='completed'&&!execution.protected_drift?.length&&review.status==='completed'&&review.completion?.decision==='pass'&&!review.protected_drift?.length&&grade.accepted;}
export async function runCell(cell,ops){
  const r={id:cell.id,task:cell.task,workflow:cell.workflow,model:cell.model,turns:[],qa:[],grades:[],status:'running',repair_used:false,human_interventions:0};
  const budget=()=>({tokens:matrixLimits.cell_tokens-[...r.turns,...r.qa].reduce((n,t)=>n+(t.usage?.operational_tokens??0),0),ms:matrixLimits.cell_ms-[...r.turns,...r.qa].reduce((n,t)=>n+t.elapsed_ms,0)});
  await ops.save(r);
  try{
    let feedback=null;
    for(let attempt=0;attempt<2;attempt++){
      const e=await ops.execute(attempt,budget(),feedback);r.turns.push(e);await ops.save(r);check(!fatal(e)&&!e.postprocess_failure,'shared-stop:'+e.first_stop);
      if(budget().tokens<=0||budget().ms<=0){r.status='budget-exhausted';break;}
      const q=await ops.review(attempt,budget(),e);r.qa.push(q);await ops.save(r);check(!fatal(q)&&!q.postprocess_failure,'shared-stop:'+q.first_stop);
      const gradeIndex=r.grades.length;const g=await ops.grade(e,async partial=>{r.grades[gradeIndex]=partial;await ops.save(r);});r.grades[gradeIndex]=g;const accepted=productAccepted(e,q,g);if(attempt===0)r.first_pass=accepted;
      if(accepted){r.status='accepted';r.accepted=true;break;}
      r.accepted=false;r.status='rejected';
      if(attempt===1||e.protected_drift?.length||q.protected_drift?.length||budget().tokens<=0||budget().ms<=0)break;
      r.repair_used=true;feedback={review:q.completion,behavior_failures:g.behavior?.failed_cases,regression:g.regression?{exit_code:g.regression.exit_code,tests:g.regression.tests}:{missing:true}};
    }
  }catch(e){r.status='stopped';r.first_stop=e.message;throw Object.assign(e,{cellResult:r});}
  finally{const turns=[...r.turns,...r.qa];r.operational_tokens_observed=turns.reduce((n,t)=>n+(t.usage?.operational_tokens??0),0);r.actor_ms=turns.reduce((n,t)=>n+t.elapsed_ms,0);r.accounting_complete=turns.every(t=>!t.generation_requested||t.usage_status==='observed-completed-turn');await ops.save(r);}
  return r;
}
export async function modelPreflight(base,cell){
  const runtime=await runtimeFor(cell.root,base),c=createJsonRpcProcess(base.binary,liveArguments(runtime),{cwd:cell.root,env:subprocessEnvironment(runtime.environment)}),models=[];
  try{await c.request('initialize',{clientInfo:{name:'matrix-preflight',version:'1'},capabilities:{experimentalApi:true}});c.notify('initialized',{});assertLiveConfiguration(await c.request('config/read',{cwd:cell.root,includeLayers:false}),runtime);
    const list=await c.request('model/list',{includeHidden:true});for(const model of ['gpt-5.6-terra','gpt-6-astra']){check(list.data.some(m=>m.model===model||m.id===model),'model-unavailable');const t=await c.request('thread/start',{model,cwd:cell.root,approvalPolicy:'never',permissions:'temple-continuity-probe',ephemeral:true,allowProviderModelFallback:false,config:{model_reasoning_effort:'medium'}});assertActorBoundary(t,cell.root,{model,effort:'medium'});models.push({model:t.model,effort:t.reasoningEffort});}
  }finally{await c.close();}return {models,generation_requested:false,server_exit_confirmed:true};
}
export async function matrixEnvironment(prefix='temple-matrix-'){
  const lab=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),prefix))),bundle=await bundleRuntime(lab),node=await fs.realpath(process.execPath);
  const libraries=(await run(source,'/usr/bin/otool',['-L',node])).split('\n').slice(1).map(s=>s.trim().split(' (compatibility version')[0]);check(libraries.length&&libraries.every(p=>p.startsWith('/usr/lib/')||p.startsWith('/System/')),'unsupported-node-runtime');
  const gitBinary=await run(source,'/usr/bin/xcrun',['--find','git']),binary='/Applications/ChatGPT.app/Contents/Resources/codex';
  const base={binary,readRoots:[path.dirname(node),path.dirname(gitBinary),bundle],environment:{PATH:[path.dirname(node),path.dirname(gitBinary),'/usr/bin','/bin'].join(':'),OPENSSL_CONF:'/dev/null',TEMPLE_CLI_PATH:path.join(bundle,'bin/temple.mjs'),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'}};
  Object.assign(base,await discoverRuntime({binary,root:lab}));const isolation=await qualifyIsolation(base,lab);
  return {lab,bundle,base,isolation};
}
export async function prepareMatrix(){
  const {lab,bundle,base,isolation}=await matrixEnvironment(),cells=[];
  for(const selected of matrixCells()){
    const f=fixtures.find(f=>f.id===selected.task),root=path.join(lab,selected.id),started=Date.now();await seed(root,f);
    if(selected.workflow==='temple')await installLean(root,lab,f);else{await write(root,'AGENTS.md','# Autonomous delivery\nSPEC.md is the approved goal and technical brief. Developer owns design choices, implementation and self-verification; a distinct blind Verifier assesses the product. Preserve scope and supplied files. Coordinator performs routine Git/evidence bookkeeping.\n');await git(root,'add','.');await git(root,'commit','-m','Prepare autonomous workflow');}
    cells.push({...selected,root,setup_ms:Date.now()-started,seed_manifest:await tree(root),base_revision:await git(root,'rev-parse','HEAD')});
  }
  const controls=[];for(const f of fixtures){
    const tests=['oracle.test.mjs',...Object.keys(f.publicTests)];controls.push({task:f.id,kind:'seed',...await checkFiles(f.seed,f,base,lab,'control',tests)});controls.push({task:f.id,kind:'reference',...await checkFiles(f.reference,f,base,lab,'control',tests)});
    for(const m of f.mutations)controls.push({task:f.id,kind:'mutation',name:m.name,...await checkFiles({...f.reference,...m.files},f,base,lab,'control',tests)});
  }
  check(controls.every(c=>!c.invalid_execution&&(c.kind==='reference'?c.exit_code===0:c.exit_code!==0&&c.failed_cases.length>0)),'control-failure');
  const preflight=await modelPreflight(base,cells[0]);
  const smokeRoot=path.join(lab,'lean-smoke'),f=fixtures[0];await seed(smokeRoot,f);await installLean(smokeRoot,lab,f);for(const[p,s]of Object.entries(f.reference))await write(smokeRoot,p,s);const revision=await commitProduct(smokeRoot);await templeClaim(smokeRoot);
  const lifecycleSmoke=await closeLean(smokeRoot,{accepted:true,final_revision:revision,note:'Generation-free fixture reference; lifecycle plumbing qualification only, not subject or model evidence',control:controls.find(c=>c.task===f.id&&c.kind==='reference')});
  const m={schema_version:'delivery-matrix/v1',created_at:new Date().toISOString(),limits:matrixLimits,source_digest:await sourceDigest(),fixtures_digest:hash(fixtures),bundle_digest:hash(await tree(bundle)),prompts:matrixCells().map(c=>({id:c.id,execution:hash(matrixPrompt(c.workflow,'execute')),review:hash(matrixPrompt(null,'review'))})),isolation,preflight,lifecycleSmoke,controls,base,cells};validateMatrix(m);
  await write(lab,'manifest.json',m,true);await write(lab,'state.json',{status:'prepared',cells:[],events:[]},true);return {lab,digest:hash(m),isolation,preflight,lifecycleSmoke,controls};
}
export async function executeMatrix(lab,digest){
  const m=await read(lab,'manifest.json'),state=await read(lab,'state.json');check(hash(m)===digest,'manifest-drift');validateMatrix(m);check(m.source_digest===await sourceDigest(),'source-drift');check(m.bundle_digest===hash(await tree(m.base.readRoots[2])),'runtime-drift');check(state.status==='prepared'&&!state.cells.length&&!state.events.length,'already-started');await acquireRun(lab);
  return executeMatrixCells(m,state,lab);
}
// Internal orchestration after the caller validates and exclusively acquires its frozen manifest.
export async function executeMatrixCells(m,state,lab,{taskFixtures=fixtures,promptFor=matrixPrompt}={}){
  state.status='running';state.started_at=new Date().toISOString();const save=()=>write(lab,'state.json',state);await save();
  try{for(const cell of m.cells){
    check(hash(await tree(cell.root))===hash(cell.seed_manifest),'seed-drift');const f=taskFixtures.find(f=>f.id===cell.task),started=Date.now();check(f,'unknown-fixture');let administrativeMs=0,gradeMs=0;
    const start=stage=>async info=>{state.events.push({cell:cell.id,stage,at:new Date().toISOString(),generation_requested:true,...info});await save();console.log(JSON.stringify({event:'generation',cell:cell.id,stage}));};
    if(cell.workflow==='temple'){const a=Date.now();await templeClaim(cell.root);administrativeMs+=Date.now()-a;}
    let result;
    try{result=await runCell(cell,{
      save:async r=>{const i=state.cells.findIndex(c=>c.id===cell.id);if(i<0)state.cells.push(r);else state.cells[i]=r;await save();},
      execute:async(attempt,budget,feedback)=>{const before=await tree(cell.root),r=await runActor(await runtimeFor(cell.root,m.base),promptFor(cell.workflow,attempt?'repair':'execute',feedback),{...budget,model:cell.model,effort:cell.effort,beforeGeneration:start(attempt?'repair':'execute')});r.stage=attempt?'repair':'execute';
        // Retain usage even if inspection/commit subsequently fails.
        try{r.protected_drift=scopeChanges(before,await tree(cell.root),p=>fixtureEditable(f,p));r.candidate_revision=await commitProduct(cell.root);}catch(e){r.postprocess_failure=e.message;r.first_stop??='candidate-inspection';r.status='stopped';}return r;},
      review:async(attempt,budget,e)=>{const r=await reviewProduct(cell.root,f,m.base,lab,budget,start('review-'+attempt));r.candidate_revision=e.candidate_revision;return r;},
      grade:async(e,onProgress)=>{const a=Date.now();try{const r=await gradeProduct(cell.root,f,m.base,lab,{onProgress:g=>onProgress({...g,candidate_revision:e.candidate_revision})});return {...r,candidate_revision:e.candidate_revision};}finally{gradeMs+=Date.now()-a;}}
    });}catch(e){result=e.cellResult;throw e;}finally{if(result){result.product_wall_ms=Date.now()-started;result.setup_ms=cell.setup_ms;result.grading_ms=gradeMs;result.final_revision=result.turns.at(-1)?.candidate_revision??cell.base_revision;
      const a=Date.now();if(cell.workflow==='temple')try{result.lifecycle=await closeLean(cell.root,result);}catch(e){result.lifecycle={closed:false,error:e.message};try{const item=await read(cell.root,'.ai-org/work-items/WI-0001.json');if(item.claim?.status==='active')await cli(cell.root,'work-item','release','--work-item','WI-0001','--agent-id',item.claim.agent_id,'--reason','Bounded experiment administration stopped');}catch(cleanup){result.lifecycle.claim_cleanup_error=cleanup.message;}}
      administrativeMs+=Date.now()-a;result.administrative_ms=administrativeMs;result.wall_ms=Date.now()-started;await save();
      try{result.final_manifest=Object.fromEntries(Object.entries(await tree(cell.root)).filter(([p])=>productFile(p)||['SPEC.md','AGENTS.md','package.json',...Object.keys(f.checkpointFiles??{}),'history/verification-v1.json'].includes(p)));}catch(e){result.final_manifest_error=e.message;}await save();}}
    console.log(JSON.stringify({event:'cell-complete',id:cell.id,status:result.status,tokens:result.operational_tokens_observed,actor_ms:result.actor_ms,mutations:result.grades.at(-1)?.mutations.map(m=>({name:m.name,detected:m.detected})),lifecycle:result.lifecycle}));
  }state.status='completed';}catch(e){state.status='stopped';state.first_stop=e.message;throw e;}finally{state.finished_at=new Date().toISOString();await save();}return state;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const[command,lab,digest]=process.argv.slice(2);try{if(command==='prepare')console.log(JSON.stringify(await prepareMatrix(),null,2));else if(command==='run')console.log(JSON.stringify(await executeMatrix(lab,digest),null,2));else throw Error('Use prepare or run <lab> <digest>');}catch(e){console.error(e.message);process.exitCode=1;}}
