import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {initializeTaskProject} from '../src/workkeel-project.mjs';
import {previewTaskIntake,applyTaskIntake} from '../src/workkeel-intake.mjs';
import {mutateNativeTask,readNativeTask} from '../src/workkeel-tasks.mjs';
import {readAutonomy,mutateAutonomy,runAutonomyStep,serveAutonomy,cancelAutonomyJob,discoverAutonomyImprovements} from '../src/workkeel-autonomy.mjs';
import {createAutonomyWorkflowAdapter} from '../src/workkeel-autonomy-workflow.mjs';
import {readWorkflowRun} from '../src/workkeel-workflows.mjs';
import {sha256} from '../src/files.mjs';

async function fixture(t,{workflow=false,definition=null,budget=null}={}){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'workkeel-autonomy-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const git=(...a)=>execFileSync('git',['-C',root,...a],{encoding:'utf8'}).trim();
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  await fs.mkdir(root+'/docs');await fs.writeFile(root+'/docs/approval.md','Synthetic approval');
  await fs.writeFile(root+'/docs/run.json',JSON.stringify({run:{run_id:'sample',workflow_ref:'docs/workflow.json',policy_ref:'docs/policy.json'}}));
  await fs.writeFile(root+'/docs/run2.json',JSON.stringify({run:{run_id:'sample-two',workflow_ref:'docs/workflow.json',policy_ref:'docs/policy.json'}}));
  await fs.writeFile(root+'/docs/recovery.json','{}');await fs.writeFile(root+'/docs/improvements.md','TODO: Fix the exact observed stale state.\nFIXME: Preserve task receipt bytes.\n');
  await fs.writeFile(root+'/docs/workflow.json',JSON.stringify(definition??{schema_version:'workkeel.workflow/v1',nodes:[{id:'work',kind:'runtime',input:'Do bounded synthetic work'}],edges:[{from:'start',to:'work'},{from:'work',to:'end'}]}));
  await fs.writeFile(root+'/docs/policy.json',JSON.stringify({schema_version:'workkeel.execution-policy/v1',models:[{id:'native',connection:{kind:'native'},data_classes:['internal']}],default_model:'native',rules:[],headroom:{mode:'off'},limits:{steps:10,attempts_per_node:2,parallelism:1,timeout_ms:1000,max_cost_usd:budget}}));
  git('add','docs');git('commit','-qm','Synthetic baseline');
  const actor={agent_id:'builder',principal_id:'owner'};
  await initializeTaskProject(root,{schema_version:'workkeel.task-policy/v1',principals:['owner'],agents:[actor,{agent_id:'reviewer',principal_id:'owner'}],approvers:['owner'],review_separation:'distinct-agent'});
  const brief={schema_version:'workkeel.task-brief/v1',id:'WK-test',goal:'Synthetic bounded execution',actor,acceptance:['Approved goal accepted independently'],environment:{cwd:'.',read_paths:['docs'],write_paths:['.ai-org/autonomy'],tools:['node'],resources:[],network:{mode:'none',hosts:[]},external_actions:[],data:{classification:'internal',model_access:'none',policy_refs:['docs/approval.md','docs/run.json','docs/run2.json','docs/workflow.json','docs/policy.json']}},authorization:{approved_by:'owner',approval_ref:'docs/approval.md',operations:['read','write','execute'],expires_at:null},...(workflow?{execution:{runtime:{kind:'adapter',adapter_id:'fixture',required_features:[]},model_connection:{kind:'policy',policy_ref:'docs/policy.json'}}}:{})};
  const p=await previewTaskIntake(root,brief);await applyTaskIntake(root,brief,p.fingerprint);await mutateNativeTask(root,'WK-test','claim',{operation_id:'claim',expected_version:1,actor,base_revision:git('rev-parse','HEAD')});
  const task=await readNativeTask(root,'WK-test');let n=0;
  const request=async extra=>({task_id:task.id,actor,claim_id:task.claim.id,contract_sha256:task.contract_sha256,operation_id:'operation-'+(++n),expected_version:(await readAutonomy(root)).version,...extra});
  const enqueue=async(id='first',extra={})=>mutateAutonomy(root,'enqueue',await request({job:{id,origin:'assigned',direction:null,reason:'User assigned synthetic work',task_id:task.id,request_ref:id==='first'?'docs/run.json':'docs/run2.json',depends_on:[],...extra}}));
  return {root,task,request,enqueue};
}
const observer=start=>({idempotent:true,start,reconcile:async()=>({status:'unknown'})});
async function waitFor(check,timeout=4000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,15));}throw Error('Synthetic condition timed out');}
test('off and idle make no host calls; optimistic versions and retries are stable',async t=>{
  const f=await fixture(t);let calls=0;const adapter={idempotent:true,start:async()=>{calls++;return {status:'completed'};},reconcile:async()=>{calls++;return {status:'running'};}};
  assert.equal((await readAutonomy(f.root)).policy.enabled,false);
  assert.equal((await runAutonomyStep(f.root,{adapter})).model_called,false);assert.equal(calls,0);
  const req=await f.request({});const first=await mutateAutonomy(f.root,'pause',req);
  assert.equal(first.state.paused,true);assert.equal((await mutateAutonomy(f.root,'pause',req)).replayed,true);
  await assert.rejects(mutateAutonomy(f.root,'resume',{...req,operation_id:'stale'}),/version conflict/);
  await assert.rejects(mutateAutonomy(f.root,'resume',req),/operation conflict/);
  assert.equal((await runAutonomyStep(f.root,{adapter})).idle,'paused');assert.equal(calls,0);
});
test('improvement opt-in, explicit directions, pinned requests and dependency validation',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.enqueue('first',{origin:'improvement',direction:'docs'}),/disabled/);
  await mutateAutonomy(f.root,'policy',await f.request({policy:{enabled:true,directions:['docs'],max_jobs:3,max_attempts:2,cooldown_ms:0}}));
  await assert.rejects(f.enqueue('first',{origin:'improvement',direction:'unapproved'}),/disabled/);
  await f.enqueue('first',{origin:'improvement',direction:'docs'});
  await assert.rejects(f.enqueue('cycle',{depends_on:['cycle']}),/dependency/);
  await assert.rejects(f.enqueue('missing',{depends_on:['unknown']}),/dependency/);
  await fs.writeFile(f.root+'/docs/unpinned.json','{}');await assert.rejects(f.enqueue('unpinned',{request_ref:'docs/unpinned.json'}),/approval-pinned/);
  assert.equal((await readAutonomy(f.root)).jobs.length,1);
});
test('runtime completion waits for canonical acceptance and never resumes completed inference',async t=>{
  const f=await fixture(t);await f.enqueue();let starts=0,reconciles=0,id;
  const adapter={idempotent:true,start:async reservation=>{starts++;id=reservation.job.execution_id;return {status:'completed'};},reconcile:async reservation=>{reconciles++;assert.equal(reservation.job.execution_id,id);return {status:'running'};}};
  const first=await runAutonomyStep(f.root,{adapter});assert.equal(first.acceptance,'not-accepted');assert.equal(first.job.status,'awaiting-acceptance');
  await runAutonomyStep(f.root,{adapter});assert.equal((await readAutonomy(f.root)).jobs[0].execution_id,id);assert.equal(starts,1);assert.equal(reconciles,0);
  await fs.writeFile(f.root+'/docs/run.json','{"changed":true}');await runAutonomyStep(f.root,{adapter});
  assert.equal(starts,1);
});
test('failures obey attempt bounds; pause and disabling discovery are distinct',async t=>{
  const f=await fixture(t);await mutateAutonomy(f.root,'policy',await f.request({policy:{enabled:true,directions:['docs'],max_jobs:3,max_attempts:2,cooldown_ms:0}}));await f.enqueue();
  const adapter={idempotent:true,start:async()=>({status:'failed',reason:'Synthetic host failure'}),reconcile:async()=>({status:'unknown'})};
  assert.equal((await runAutonomyStep(f.root,{adapter})).job.status,'queued');assert.equal((await runAutonomyStep(f.root,{adapter})).job.status,'failed');
  assert.equal((await runAutonomyStep(f.root,{adapter})).model_called,false);
  await f.enqueue('improve',{origin:'improvement',direction:'docs'});
  await mutateAutonomy(f.root,'policy',await f.request({policy:{enabled:false,directions:['docs'],max_jobs:3,max_attempts:2,cooldown_ms:0}}));
  await assert.rejects(f.enqueue('new-improvement',{origin:'improvement',direction:'docs'}),/disabled/);
  assert.equal((await runAutonomyStep(f.root,{adapter})).job.id,'improve');
  await mutateAutonomy(f.root,'cancel',await f.request({job_id:'improve'}));
  assert.equal((await readAutonomy(f.root)).jobs[1].cancel_requested,true,'a dispatched workflow cancellation remains a request until confirmed');
});

test('unknown effects cannot block unrelated assignments or cause automatic redispatch',async t=>{
  const f=await fixture(t);await f.enqueue();await f.enqueue('second');let starts=0,reconciles=0,execution;
  const adapter={idempotent:true,start:async r=>{starts++;if(r.job.id==='first'){execution=r.job.execution_id;return {status:'unknown'};}return {status:'completed'};},reconcile:async r=>{reconciles++;assert.equal(r.job.execution_id,execution);return {status:'unknown'};}};
  assert.equal((await runAutonomyStep(f.root,{adapter})).job.status,'recovery-required');
  assert.equal((await runAutonomyStep(f.root,{adapter})).job.id,'second');
  await runAutonomyStep(f.root,{adapter});assert.equal(reconciles,0);
  await runAutonomyStep(f.root,{adapter,clock:()=>Date.now()+31000});assert.equal(reconciles,1);assert.equal(starts,2);
  await assert.rejects(f.enqueue('duplicate',{request_ref:'docs/run.json'}),/already has an autonomy job/);
});

test('parallel schedulers share one durable dispatcher; cancellation requests require host confirmation',async t=>{
  const f=await fixture(t);await f.enqueue();let release,started=false,starts=0;
  const adapter={idempotent:true,start:async()=>{starts++;started=true;await new Promise(r=>release=r);return {status:'running'};},reconcile:async()=>({status:'unknown'}),cancel:async()=>({status:'unknown',reason:'Cancellation only requested'})};
  const first=runAutonomyStep(f.root,{adapter});await waitFor(()=>started);
  const other=await runAutonomyStep(f.root,{adapter});assert.equal(other.model_called,false);assert.equal(starts,1);
  release();await first;
  const cancelled=await cancelAutonomyJob(f.root,await f.request({job_id:'first'}),{adapter});
  assert.equal(cancelled.cancellation,'requested-not-confirmed');assert.equal((await readAutonomy(f.root)).jobs[0].status,'recovery-required');
  adapter.cancel=async()=>({status:'cancelled'});
  const confirmed=await runAutonomyStep(f.root,{adapter,clock:()=>Date.now()+31000});assert.equal(confirmed.cancellation,'host-confirmed');assert.equal(confirmed.job.status,'cancelled');
});

test('service retries after cooldown without filesystem events and ignores its own status writes',async t=>{
  const f=await fixture(t);await mutateAutonomy(f.root,'policy',await f.request({policy:{enabled:false,directions:[],max_jobs:3,max_attempts:2,cooldown_ms:120}}));await f.enqueue();
  let starts=0,reconciles=0;const times=[],errors=[];
  const adapter={idempotent:true,start:async()=>{times.push(Date.now());return {status:++starts===1?'failed':'completed'};},reconcile:async()=>{reconciles++;return {status:'unknown'};}};
  const service=await serveAutonomy(f.root,{adapter,debounce_ms:0,reconcile_ms:300,watchFactory:()=>({close(){}}),onError:e=>errors.push(e)});t.after(()=>service.close());
  await waitFor(()=>starts===2);assert.ok(times[1]-times[0]>=110);assert.equal(reconciles,0);
  await new Promise(r=>setTimeout(r,350));assert.equal(starts,2);assert.equal(reconciles,0);assert.deepEqual(errors,[]);service.close();
});

test('periodic zero-model reconciliation observes canonical cancellation when watchers miss changes',async t=>{
  const f=await fixture(t);await f.enqueue();let starts=0;
  const adapter=observer(async()=>{starts++;return {status:'completed'};});
  const service=await serveAutonomy(f.root,{adapter,reconcile_ms:40,debounce_ms:0,watchFactory:()=>({close(){}})});t.after(()=>service.close());
  await waitFor(async()=>(await readAutonomy(f.root)).jobs[0].status==='awaiting-acceptance');
  await mutateNativeTask(f.root,f.task.id,'cancel',{operation_id:'canonical-cancel',expected_version:2,actor:f.task.claim.actor,summary:'Synthetic cancellation after settled runtime',evidence:['docs/approval.md']});
  await waitFor(async()=>(await readAutonomy(f.root)).jobs[0].status==='cancelled');assert.equal(starts,1);service.close();
});

test('discovery is default-off, source-pinned, bounded and proposal-only; disabling it preserves assignments',async t=>{
  const f=await fixture(t),source={event_id:'observed-one',direction:'docs',source_refs:['docs/improvements.md'],max_results:2};
  await assert.rejects(discoverAutonomyImprovements(f.root,await f.request(source)),/disabled/);
  const policy={enabled:true,directions:['docs'],max_jobs:3,max_attempts:2,cooldown_ms:0,discovery:{enabled:true,read_paths:['docs'],write_paths:['.ai-org/autonomy'],max_proposals:2,max_source_bytes:1024,max_rounds:2,cooldown_ms:0,max_runtime_ms:1000,max_cost_usd:0}};
  await mutateAutonomy(f.root,'policy',await f.request({policy}));
  const found=await discoverAutonomyImprovements(f.root,await f.request(source));assert.equal(found.proposal_ids.length,2);assert.equal(found.task_created,false);assert.equal(found.provider_contact,false);
  const state=await readAutonomy(f.root);assert.equal(state.proposals[0].status,'proposed');assert.equal(state.proposals[0].evidence[0].path,'docs/improvements.md');assert.equal(state.proposals[0].budget.max_cost_usd,0);
  assert.equal((await discoverAutonomyImprovements(f.root,await f.request(source))).proposal_ids.length,0,'event replay never rediscovers');
  await assert.rejects(discoverAutonomyImprovements(f.root,await f.request({...source,event_id:'over-budget'})),/proposal budget/);
  await assert.rejects(discoverAutonomyImprovements(f.root,await f.request({...source,event_id:'outside',source_refs:['.ai-org/autonomy/state.json']})),/outside explicit scope/);
  await f.enqueue();await mutateAutonomy(f.root,'policy',await f.request({policy:{...policy,enabled:false}}));
  await assert.rejects(discoverAutonomyImprovements(f.root,await f.request({...source,event_id:'disabled'})),/disabled/);
  assert.equal((await runAutonomyStep(f.root,{adapter:observer(async()=>({status:'completed'}))})).job.id,'first');
});

test('actual child-process crash retains exact execution identity, and a second process cannot start the live operation',async t=>{
  const f=await fixture(t);await f.enqueue();
  const module=fileURLToPath(new URL('../src/workkeel-autonomy.mjs',import.meta.url));
  const script='const [module,root]=process.argv.slice(1);const fs=await import("node:fs/promises");const {runAutonomyStep}=await import(module);await runAutonomyStep(root,{adapter:{idempotent:true,start:async r=>{await fs.writeFile(root+"/.ai-org/autonomy/dispatched.json",JSON.stringify(r.job));setInterval(()=>{},1000);await new Promise(()=>{});},reconcile:async()=>({status:"unknown"})}});';
  const child=spawn(process.execPath,['--input-type=module','-e',script,module,f.root],{stdio:'ignore'});t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
  await waitFor(async()=>fs.stat(f.root+'/.ai-org/autonomy/dispatched.json').then(()=>true,()=>false));
  const dispatched=JSON.parse(await fs.readFile(f.root+'/.ai-org/autonomy/dispatched.json','utf8'));let starts=0,reconciles=0;
  const adapter={idempotent:true,start:async()=>{starts++;return {status:'completed'};},reconcile:async r=>{reconciles++;assert.equal(r.job.execution_id,dispatched.execution_id);return {status:'unknown'};}};
  assert.equal((await runAutonomyStep(f.root,{adapter,clock:()=>Date.now()+31000})).model_called,false);assert.equal(starts,0);
  const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;
  assert.equal((await runAutonomyStep(f.root,{adapter,clock:()=>Date.now()+31000})).job.status,'recovery-required');assert.equal(starts,0);assert.equal(reconciles,1);
});

test('qualified native workflow recipe binds generated claim once and resumes exact checkpoints only after explicit request',async t=>{
  const f=await fixture(t,{workflow:true});await f.enqueue();let calls=0;
  const runtime={id:'fixture',assertCompatible:async()=>{},start:async()=>{calls++;return {status:'completed',conversation_id:'fixture-thread',output:'bounded result',outcome:'done',observed_model:null,usage:{input_tokens:null,output_tokens:null,cost_usd:null}};},resume:async()=>{throw Error('Completed conversation must not resume');},cancel:async()=>{}};
  const adapter=createAutonomyWorkflowAdapter(f.root,{runtimeFactory:async()=>runtime});
  const result=await runAutonomyStep(f.root,{adapter});assert.equal(result.job.status,'awaiting-acceptance');assert.equal(calls,1);
  const run=await readWorkflowRun(f.root,'sample');assert.equal(run.request.claim_id,f.task.claim.id);assert.equal(run.request.task_id,f.task.id);
  await runAutonomyStep(f.root,{adapter});assert.equal(calls,1);
  await assert.rejects(mutateAutonomy(f.root,'resume-job',await f.request({job_id:'first',recovery_ref:'docs/recovery.json'})),/unresolved/);
});

test('explicit recovery never rebinds an old run to a replacement claim',async t=>{
  const f=await fixture(t);await f.enqueue();let starts=0;
  const adapter=observer(async()=>{starts++;return {status:'unknown'};});await runAutonomyStep(f.root,{adapter});
  await mutateNativeTask(f.root,f.task.id,'release',{operation_id:'release-old',expected_version:2,actor:f.task.claim.actor,claim_id:f.task.claim.id,summary:'Stopped synthetic original claim'});
  const task=await readNativeTask(f.root,f.task.id);const revision=execFileSync('git',['-C',f.root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  await mutateNativeTask(f.root,f.task.id,'claim',{operation_id:'replacement-claim',expected_version:task.version,actor:f.task.contract.actor,base_revision:revision});
  const replacement=await readNativeTask(f.root,f.task.id);
  await assert.rejects(mutateAutonomy(f.root,'resume-job',{...await f.request({job_id:'first',recovery_ref:'docs/recovery.json'}),claim_id:replacement.claim.id}),/cannot rebind/);
  assert.equal(starts,1);
});

test('qualified checkpoint resume uses exact pending approval and never infers approval from a wakeup',async t=>{
  const definition={schema_version:'workkeel.workflow/v1',nodes:[{id:'confirm',kind:'approval',input:'Inspect exact synthetic approval'},{id:'work',kind:'runtime',input:'Bounded approved work'}],edges:[{from:'start',to:'confirm'},{from:'confirm',to:'work'},{from:'work',to:'end'}]};
  const f=await fixture(t,{workflow:true,definition});await f.enqueue();let calls=0;
  const runtime={id:'fixture',assertCompatible:async()=>{},start:async()=>{calls++;return {status:'completed',conversation_id:'approved-thread',output:'bounded approved result',outcome:'done',observed_model:null,usage:{input_tokens:0,output_tokens:0,cost_usd:0}};},resume:async()=>{throw Error('No old conversation expected');},cancel:async()=>{}};
  const adapter=createAutonomyWorkflowAdapter(f.root,{runtimeFactory:async()=>runtime});
  const first=await runAutonomyStep(f.root,{adapter});assert.equal(first.job.status,'recovery-required');assert.equal(calls,0);
  const paused=await readWorkflowRun(f.root,'sample'),entry=paused.status.interrupts[0];
  await runAutonomyStep(f.root,{adapter,clock:()=>Date.now()+31000});assert.equal(calls,0);
  await fs.writeFile(f.root+'/docs/recovery.json',JSON.stringify({approvals:{[entry.id]:{token:entry.value.token,approved:true,actor:f.task.claim.actor,evidence_ref:'docs/approval.md'}}}));
  await mutateAutonomy(f.root,'resume-job',await f.request({job_id:'first',recovery_ref:'docs/recovery.json'}));
  const resumed=await runAutonomyStep(f.root,{adapter});assert.equal(resumed.job.status,'awaiting-acceptance');assert.equal(resumed.job.execution_id,first.job.execution_id);assert.equal(calls,1);
  assert.equal((await readWorkflowRun(f.root,'sample')).run_id,paused.run_id);
});

test('qualified autonomous exploration consumes actual completed workflow output, source pins and usage without creating task authority',async t=>{
  const f=await fixture(t,{workflow:true,budget:0.1});
  const policy={enabled:true,directions:['docs'],max_jobs:3,max_attempts:2,cooldown_ms:0,discovery:{enabled:true,read_paths:['docs'],write_paths:['.ai-org/autonomy'],max_proposals:3,max_source_bytes:2048,max_rounds:1,cooldown_ms:0,max_runtime_ms:1000,max_cost_usd:0.1}};
  await mutateAutonomy(f.root,'policy',await f.request({policy}));
  await f.enqueue('first',{origin:'improvement',direction:'docs',purpose:'discovery'});
  let calls=0;const evidence=sha256(await fs.readFile(f.root+'/docs/improvements.md'));
  const report={proposals:[{title:'Evaluate recurring missing receipt state',evidence:[{path:'docs/improvements.md',sha256:evidence}],scope:{read_paths:['docs'],write_paths:['.ai-org/autonomy']},budget:{max_attempts:1,max_runtime_ms:1000,max_cost_usd:0.1}}]};
  const runtime={id:'fixture',assertCompatible:async({policy})=>{assert.equal(policy.limits.max_cost_usd,0.1);},start:async()=>{calls++;return {status:'completed',conversation_id:'exploration',output:JSON.stringify(report),outcome:'done',observed_model:'synthetic-no-inference',usage:{input_tokens:0,output_tokens:0,cost_usd:0}};},resume:async()=>{throw Error('No replay');},cancel:async()=>{}};
  const adapter=createAutonomyWorkflowAdapter(f.root,{runtimeFactory:async()=>runtime});
  const result=await runAutonomyStep(f.root,{adapter});assert.equal(result.job.discovery_error,null);assert.equal(result.job.status,'awaiting-acceptance');assert.equal(calls,1);
  const state=await readAutonomy(f.root);assert.equal(state.proposals.length,1);assert.equal(state.proposals[0].admission,'awaiting-authority');assert.equal(state.proposals[0].runtime_evidence.length,3);assert.equal(state.jobs[0].runtime_receipt.usage.cost_usd,0);
  assert.equal((await readNativeTask(f.root,f.task.id)).state,'build','exploration cannot fabricate task acceptance');
  await assert.rejects(f.enqueue('second',{origin:'improvement',direction:'docs',purpose:'discovery'}),/round or proposal budget/);
  await runAutonomyStep(f.root,{adapter,clock:()=>Date.now()+60000});assert.equal(calls,1);
});

test('unknown exploration keeps its one round identity and invalid output cannot widen scope or become authority',async t=>{
  const f=await fixture(t,{workflow:true,budget:0.1});const policy={enabled:true,directions:['docs'],max_jobs:3,max_attempts:2,cooldown_ms:0,discovery:{enabled:true,read_paths:['docs'],write_paths:['.ai-org/autonomy'],max_proposals:3,max_source_bytes:2048,max_rounds:1,cooldown_ms:0,max_runtime_ms:1000,max_cost_usd:0.1}};
  await mutateAutonomy(f.root,'policy',await f.request({policy}));await f.enqueue('first',{origin:'improvement',direction:'docs',purpose:'discovery'});
  let starts=0,reconciles=0,execution;
  const adapter={idempotent:true,discovery:true,start:async r=>{starts++;execution=r.job.execution_id;return {status:'unknown'};},reconcile:async r=>{reconciles++;assert.equal(r.job.execution_id,execution);return {status:'completed',proposal_report:{proposals:[{title:'Forbidden wider scope',evidence:[{path:'docs/improvements.md',sha256:sha256(await fs.readFile(f.root+'/docs/improvements.md'))}],scope:{read_paths:['.'],write_paths:['.']},budget:{max_attempts:1,max_runtime_ms:1000,max_cost_usd:0.1}}]}};}};
  await runAutonomyStep(f.root,{adapter});assert.equal((await readAutonomy(f.root)).proposals.length,0);
  const completed=await runAutonomyStep(f.root,{adapter,clock:()=>Date.now()+31000});assert.match(completed.job.discovery_error,/widens discovery scope/);assert.equal(starts,1);assert.equal(reconciles,1);assert.equal((await readAutonomy(f.root)).discovery_runs.length,1);assert.equal((await readAutonomy(f.root)).proposals.length,0);
});

test('native cancellation confirms a paused approval graph without fabricating acceptance or starting a model',async t=>{
  const definition={schema_version:'workkeel.workflow/v1',nodes:[{id:'confirm',kind:'approval',input:'Wait for human approval'},{id:'work',kind:'runtime',input:'Approved bounded work'}],edges:[{from:'start',to:'confirm'},{from:'confirm',to:'work'},{from:'work',to:'end'}]};
  const f=await fixture(t,{workflow:true,definition});await f.enqueue();let calls=0;
  const runtime={id:'fixture',assertCompatible:async()=>{},start:async()=>{calls++;throw Error('No approval granted');},resume:async()=>{calls++;throw Error('No approval granted');},cancel:async()=>{}};
  const adapter=createAutonomyWorkflowAdapter(f.root,{runtimeFactory:async()=>runtime});await runAutonomyStep(f.root,{adapter});
  await mutateAutonomy(f.root,'pause',await f.request({}));
  const result=await cancelAutonomyJob(f.root,await f.request({job_id:'first'}),{adapter});assert.equal(result.cancellation,'host-confirmed');assert.equal(result.job.status,'cancelled');assert.equal(calls,0);assert.equal((await readNativeTask(f.root,f.task.id)).state,'build');
});

test('native cancellation interrupts an actual pending host and confirms only after its runner lock is gone',async t=>{
  const f=await fixture(t,{workflow:true});await f.enqueue();let entered=false;
  const runtime={id:'fixture',assertCompatible:async()=>{},start:async({signal})=>{entered=true;await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));return {status:'interrupted',conversation_id:'cancelled-fixture',output:'Stopped',outcome:'attention',observed_model:null,usage:{input_tokens:0,output_tokens:0,cost_usd:0}};},resume:async()=>{throw Error('No new inference');},cancel:async()=>{}};
  const adapter=createAutonomyWorkflowAdapter(f.root,{runtimeFactory:async()=>runtime});const active=runAutonomyStep(f.root,{adapter});await waitFor(()=>entered);
  const requested=await cancelAutonomyJob(f.root,await f.request({job_id:'first'}),{adapter}),finished=await active;
  const settled=await runAutonomyStep(f.root,{adapter,clock:()=>Date.now()+31000});assert.equal((await readAutonomy(f.root)).jobs[0].status,'cancelled');assert.equal([requested,finished,settled].some(r=>r.cancellation==='host-confirmed'),true);
  assert.equal(await fs.stat(f.root+'/.ai-org/execution/sample/runner.lock').then(()=>true,()=>false),false);
});
