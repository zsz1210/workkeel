import test from 'node:test';
import {projectWorkspaceGoals} from '../src/workkeel-workspace.mjs';
import {buildExecutionVisual} from '../src/workkeel-execution-visuals.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync,spawn} from 'node:child_process';
import {initializeTaskProject} from '../src/workkeel-project.mjs';
import {createNativeTask,readNativeTask,mutateNativeTask} from '../src/workkeel-tasks.mjs';
import {executionDigest} from '../src/workkeel-execution-policy.mjs';
import {readTaskFile} from '../src/task-contract.mjs';
import {createNativeGoal,readNativeGoal,controlNativeGoal,runNativeGoalStep,serveNativeGoal,createTrustedGoalAdapter,validateGoalManifest,assertNativeGoalAuthority,goalAdmissionManifestDigest} from '../src/workkeel-goals.mjs';

const builder={agent_id:'builder',principal_id:'owner'},reviewer={agent_id:'reviewer',principal_id:'owner'};
const model={provider:'openai',model:'fixture-model',reasoning:'high',service:'provider-default'};
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
async function fixture(t,{count=1,maxReworks=2,purpose='execution',release=false,expiresAt=null}={}){
  const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'workkeel-whole-goal-')));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const roots=[];
  for(let n=0;n<count;n++){
    const root=directory+'/repo-'+n;roots.push(root);await fs.mkdir(root+'/src',{recursive:true});await fs.mkdir(root+'/docs');git(root,'init','-q');git(root,'config','user.name','Synthetic');git(root,'config','user.email','fixture@example.invalid');
    await fs.writeFile(root+'/.gitignore','.ai-org/\n');await fs.writeFile(root+'/docs/approval.md','Explicit synthetic whole-goal scope, distinct review and bounded rework.');await fs.writeFile(root+'/src/value.mjs','export const value="baseline";\n');
    await initializeTaskProject(root,{schema_version:'workkeel.task-policy/v1',principals:['owner'],agents:[builder,reviewer],approvers:['owner'],review_separation:'distinct-agent'});
    git(root,'add','.');git(root,'commit','-qm','Synthetic initial project');
  }
  const target=roots[0],contracts=[];
  for(let n=0;n<count;n++){
    const root=roots[n],id='WK-component-'+n;
    const contract={schema_version:'workkeel.task-contract/v2',id,goal:'Exact synthetic component',actor:builder,state:'intake',scope:{include:['src'],exclude:['publication']},dependencies:[],acceptance:{criteria:['Exact synthetic component verified','Whole combination accepted'],evidence:[]},verification:{risk_tier:'standard',separation:'distinct-agent',implementer:null,reviewer:null,candidate_revision:null},handoff:null,environment:{cwd:'.',read_paths:['.'],write_paths:['src'],tools:['node','git'],resources:[],network:{mode:'none',hosts:[]},external_actions:[],data:{classification:'internal',model_access:'none',policy_refs:['docs/approval.md']}},authorization:{approved_by:'owner',approval_ref:'docs/approval.md',operations:['read','write','execute'],expires_at:null},execution:{runtime:{kind:'host-owned',adapter_id:null,required_features:[]},model_connection:{kind:'native'}},skills:[]};
    await createNativeTask(root,contract,{operation_id:'create-component-'+n,expected_version:0,actor:builder});contracts.push(await readNativeTask(root,id));
  }
  const manifest={schema_version:'workkeel.goal/v1',id:'goal-one',title:'All agreed synthetic components',approval_ref:'docs/approval.md',approved_by:builder,expires_at:expiresAt,components:roots.map((root,n)=>({id:'component-'+n,project_id:'project-'+n,repo_id:'repo-'+n,root,task_id:contracts[n].id,contract_sha256:contracts[n].contract_sha256,depends_on:n===count-1?roots.slice(0,-1).map((_,k)=>'component-'+k):[],checks:[{id:'syntax',command:'node',args:['--check','src/value.mjs']}],rollback:'Restore the recorded source baseline with a separately governed revert',interface_refs:['src/value.mjs'],purpose})),integration:{component_id:'component-'+(count-1),criteria:['Whole combination accepted']},roles:{implementer:builder,reviewer,approver:builder},models:Object.fromEntries(['planning','implementation','verification','repair','review'].map(phase=>[phase,model])),limits:{max_operations:80,max_reworks:maxReworks,timeout_ms:80000,operation_timeout_ms:1000,max_cost_usd:null},control:{release_parent:release}};
  await fs.writeFile(target+'/docs/goal.json',JSON.stringify(manifest,null,2)+'\n');
  // The approved manifest is committed before intake so source drift never hides
  // in task metadata, even when it lives beside component documentation.
  git(target,'add','docs/goal.json');git(target,'commit','-qm','Approve synthetic mandatory whole goal');
  const control={...structuredClone(contracts[0].contract),id:'WK-controller',goal:'Coordinate the explicitly approved whole goal',environment:{...contracts[0].contract.environment,write_paths:release?['.']:['.ai-org/goals'],data:{...contracts[0].contract.environment.data,policy_refs:['docs/approval.md','docs/goal.json']}},acceptance:{criteria:['Coordinate exact goal'],evidence:[]}};
  await createNativeTask(target,control,{operation_id:'create-controller',expected_version:0,actor:builder});await mutateNativeTask(target,control.id,'claim',{operation_id:'claim-controller',expected_version:1,actor:builder,base_revision:git(target,'rev-parse','HEAD')});
  const task=await readNativeTask(target,control.id),request={task_id:task.id,actor:builder,claim_id:task.claim.id,contract_sha256:task.contract_sha256,operation_id:'register-whole-goal',expected_version:0,manifest_ref:'docs/goal.json'};
  await createNativeGoal(target,request);
  return {target,roots,manifest,request,directory};
}
async function artifact(ctx,kind,value){const ref='.ai-org/artifacts/'+ctx.task.id+'/goal-'+kind+'-'+ctx.operation_id+'.json';await fs.mkdir(path.dirname(ctx.component.root+'/'+ref),{recursive:true});await fs.writeFile(ctx.component.root+'/'+ref,JSON.stringify(value,null,2)+'\n');return {path:ref,sha256:(await readTaskFile(ctx.component.root,ref)).bytes_digest};}
function fixtureAdapter({firstFail=true,alwaysFail=false,onExecute=()=>{},wrongThread=false,interruptAfterNativeReview=false,costPath}={}){
  const reviews=new Map(),receipts=new Map();
  return createTrustedGoalAdapter({id:'synthetic-goal-host',...(costPath?{costPath}:{}),assertCapabilities:async()=>{},cancel:async()=>({status:'cancelled',reason:'Synthetic exact owned host stopped'}),reconcile:async ctx=>receipts.get(ctx.operation_id)??{status:'unknown',reason:'Synthetic effects are unknown'},
    execute:async ctx=>{
      onExecute(ctx);const phase=ctx.input.phase,thread=phase==='review'&&!wrongThread?'synthetic-review-'+ctx.task.id+'-'+ctx.input.cycle:'synthetic-builder-'+ctx.task.id;
      const result={status:'completed',operation_id:ctx.operation_id,actor:ctx.input.actor,thread_id:thread,runtime_selection:ctx.input.model,product_access:['planning','review','verification'].includes(phase)||ctx.component.purpose==='discovery'?'read':'write',usage:{input_tokens:0,output_tokens:0,cost_usd:0}};
      if(phase==='planning'){await artifact(ctx,'planning',{synthetic_role:'builder',phase});}
      if(['implementation','repair'].includes(phase)){
        await fs.writeFile(ctx.component.root+'/src/value.mjs','export const value="'+(alwaysFail?ctx.operation_id:phase==='repair'||!firstFail?'fixed':'first')+'";\n');git(ctx.component.root,'add','src/value.mjs');git(ctx.component.root,'commit','-qm','Synthetic exact '+ctx.operation_id);
        result.candidate_revision=git(ctx.component.root,'rev-parse','HEAD');await artifact(ctx,phase,{synthetic_role:'builder',actual_changed_file:'src/value.mjs'});
      }
      if(phase==='verification'){
        const check=execFileSync(process.execPath,['--check',ctx.component.root+'/src/value.mjs'],{encoding:'utf8'});const pin=await artifact(ctx,'verification',{checks:[{id:'syntax',status:'pass'}],actual_output:check,candidate:ctx.input.candidate});
        result.candidate_revision=ctx.input.candidate;result.checks=[{id:'syntax',status:'pass'}];result.evidence=[pin.path];
        if(ctx.component.id===ctx.manifest.integration.component_id)result.integration_pin=await artifact(ctx,'integration',{schema_version:'workkeel.goal-integration/v1',manifest_sha256:ctx.manifest_sha256,required_components:ctx.input.required_components,components:ctx.input.accepted_components,candidate_set_sha256:executionDigest(ctx.input.accepted_components),integration_candidate:ctx.input.candidate,checks:result.checks});
        if(result.integration_pin)result.evidence.push(result.integration_pin.path);
      }
      if(phase==='review'){
        const n=reviews.get(ctx.task.id)??0;reviews.set(ctx.task.id,n+1);
        const proofPath='.ai-org/artifacts/'+ctx.task.id+'/goal-review-'+ctx.operation_id+'.json';
        const native_request={operation_id:ctx.operation_id,expected_version:ctx.task.version,actor:reviewer,revision:ctx.input.candidate,judgment:alwaysFail||firstFail&&n===0?'fail':'pass',summary:firstFail&&n===0?'Synthetic distinct reviewer observes value first; acceptance requires fixed':'Synthetic distinct reviewer verified repaired exact candidate',evidence:[...ctx.input.verification.evidence,proofPath]};
        result.authored_request_pin=await artifact(ctx,'review',{schema_version:'workkeel.goal-authored-review/v1',actor:reviewer,thread_id:thread,operation_id:ctx.operation_id,product_access:'read',runtime_selection:ctx.input.model,native_request});
        await mutateNativeTask(ctx.component.root,ctx.task.id,'review',native_request);
        receipts.set(ctx.operation_id,result);
        if(interruptAfterNativeReview&&n===0)throw Error('Synthetic crash after actual native review');
      }
      receipts.set(ctx.operation_id,result);return result;
    }
  });
}
async function finish(f,adapter,max=60){for(let n=0;n<max;n++){const view=await readNativeGoal(f.target,f.manifest.id);if(view.accepted)return view;const step=await runNativeGoalStep(f.target,f.manifest.id,{adapter});if(step.idle&&['components-blocked','host-capability-unavailable'].includes(step.idle))throw Error(step.idle+': '+JSON.stringify((await readNativeGoal(f.target,f.manifest.id)).components));}const view=await readNativeGoal(f.target,f.manifest.id);throw Error('Goal did not accept: '+JSON.stringify({status:view.status,components:view.components,canonical:view.mandatory_components.map(c=>({id:c.id,state:c.state,accepted:c.accepted,reason:c.reason})),ops:view.operations.slice(-3).map(o=>({phase:o.input.phase,status:o.status,reason:o.result?.reason,first:o.first_result?.reason}))}));}

test('whole goal continues first FAIL, native rework, fresh candidate, distinct PASS and authorized closure',async t=>{
  const f=await fixture(t),adapter=fixtureAdapter();let failed;
  for(let n=0;n<12;n++){await runNativeGoalStep(f.target,f.manifest.id,{adapter});failed=await readNativeGoal(f.target,f.manifest.id);if(failed.mandatory_components[0].review?.judgment==='fail')break;}
  assert.equal(failed.mandatory_components[0].review.judgment,'fail');
  const registry={projects:[{id:'project-0',task_root:f.target,repositories:[{id:'repo-0',path:f.target,scope:'.'}]}]},projected=projectWorkspaceGoals([failed],registry,'project-0')[0],row=projected.operations.find(op=>op.review_judgment==='fail');
  assert.ok(row);assert.equal(row.state,'completed','successful host execution does not mean a passing verdict');assert.equal(buildExecutionVisual(projected.operations).nodes[3].state,'failed');assert.equal(projected.mandatory_components[0].review_judgment,'fail');
  const accepted=await finish(f,adapter),task=await readNativeTask(f.target,'WK-component-0');
  assert.equal(task.state,'done');assert.equal(task.attempts[0].kind,'rejected');assert.equal(task.attempts[0].review.judgment,'fail');assert.notEqual(task.attempts[0].delivery.revision,task.delivery.revision);
  assert.equal(task.review.actor.agent_id,'reviewer');assert.equal(accepted.whole_acceptance,'accepted');assert.equal(accepted.components[0].failures[0].kind,'review');assert.equal(accepted.mandatory_components.length,1);assert.equal(accepted.published,'not-performed');
  const failProof=task.attempts[0].review.evidence.find(p=>p.path.includes('goal-review-'));assert.equal(JSON.parse((await readTaskFile(f.target,failProof.path)).content).native_request.judgment,'fail');
  const repaired=projectWorkspaceGoals([accepted],registry,'project-0')[0];assert.deepEqual(repaired.mandatory_components[0].reviews.map(value=>value.judgment),['fail','pass']);assert.deepEqual(repaired.operations.filter(op=>op.review_judgment).map(op=>op.review_judgment),['fail','pass']);assert.equal(buildExecutionVisual(repaired.operations,{review_judgments:repaired.mandatory_components.map(value=>value.review_judgment)}).nodes[3].state,'review-passed');
});

test('three repositories remain partial until every required task and exact integration set are accepted',async t=>{
  const f=await fixture(t,{count:3}),adapter=fixtureAdapter({firstFail:false});
  let partial;for(let n=0;n<25;n++){await runNativeGoalStep(f.target,f.manifest.id,{adapter});partial=await readNativeGoal(f.target,f.manifest.id);if(partial.mandatory_components.filter(c=>c.accepted).length===1)break;}
  assert.equal(partial.accepted,false);assert.equal(partial.mandatory_components.length,3);assert.equal(partial.all_components_accepted,false);
  const done=await finish(f,adapter);assert.equal(done.integration.components.length,3);
  const record=JSON.parse((await readTaskFile(f.roots[2],done.integration.integration.path)).content);assert.equal(record.components.length,2);assert.deepEqual(record.required_components,['component-0','component-1','component-2']);
  await fs.appendFile(f.roots[1]+'/docs/approval.md','Changed authorization');const stale=await readNativeGoal(f.target,f.manifest.id);assert.equal(stale.accepted,false);assert.equal(stale.whole_acceptance,'stale');
});

test('manifest validates mandatory set, dependencies, reviewer identity and exact integration requirements',async t=>{
  const f=await fixture(t,{count:3});const missing=structuredClone(f.manifest);missing.components.pop();assert.throws(()=>validateGoalManifest(missing),/integration/);
  const cycle=structuredClone(f.manifest);cycle.components[0].depends_on=['component-1'];cycle.components[1].depends_on=['component-0'];assert.throws(()=>validateGoalManifest(cycle),/cycle/);
  const subset=structuredClone(f.manifest);subset.components[2].depends_on=['component-0'];assert.throws(()=>validateGoalManifest(subset),/complete mandatory/);
  const wrong=structuredClone(f.manifest);wrong.roles.reviewer=builder;assert.throws(()=>validateGoalManifest(wrong),/distinct/);
  const sparse=structuredClone(f.manifest);sparse.components=new Array(3);assert.throws(()=>validateGoalManifest(sparse),/sparse/);
  const body={...f.manifest,derived_from:{goal_id:'old',manifest_sha256:'a'.repeat(64),admission_ref:'docs/receipt.json',admission_sha256:'b'.repeat(64)}};
  assert.equal(goalAdmissionManifestDigest(body),goalAdmissionManifestDigest({...body,derived_from:{...body.derived_from,admission_sha256:'c'.repeat(64)}}));
});

test('actual host thread separation is enforced even if a native reviewer label is distinct',async t=>{
  const f=await fixture(t),adapter=fixtureAdapter({wrongThread:true});for(let n=0;n<10;n++){await runNativeGoalStep(f.target,f.manifest.id,{adapter});const view=await readNativeGoal(f.target,f.manifest.id);if(view.components[0].last_error)break;}
  const view=await readNativeGoal(f.target,f.manifest.id);assert.equal(view.accepted,false);assert.match(view.components[0].last_error,/distinct reviewer/);assert.notEqual((await readNativeTask(f.target,'WK-component-0')).state,'done');
});

test('review-result interruption reconciles the exact authored native operation without redispatch or rewriting FAIL',async t=>{
  const f=await fixture(t),calls=[],adapter=fixtureAdapter({interruptAfterNativeReview:true,onExecute:ctx=>calls.push(ctx.operation_id)});
  const view=await finish(f,adapter);assert.equal(view.accepted,true);assert.equal(new Set(calls).size,calls.length,'unknown review result is reconciled, not repeated');assert.equal((await readNativeTask(f.target,'WK-component-0')).attempts[0].review.judgment,'fail');
});

test('unknown component work does not starve another repository and live ownership prevents duplicate dispatch',async t=>{
  const f=await fixture(t,{count:3});let release,entered=false,executions=0;
  const adapter=createTrustedGoalAdapter({id:'unknown-fixture',assertCapabilities:async()=>{},execute:async()=>{executions++;entered=true;await new Promise(r=>release=r);return {status:'unknown',reason:'Fixture lost result'};},reconcile:async()=>({status:'unknown',reason:'No inference during reconciliation'}),cancel:async()=>({status:'cancelled'})});
  await runNativeGoalStep(f.target,f.manifest.id,{adapter});const active=runNativeGoalStep(f.target,f.manifest.id,{adapter});while(!entered)await new Promise(r=>setTimeout(r,5));
  const second=await runNativeGoalStep(f.target,f.manifest.id,{adapter});assert.equal(executions,1);assert.equal(second.operation.input.component_id,'component-1');
  release();await active;
  const nextPromise=runNativeGoalStep(f.target,f.manifest.id,{adapter});while(executions<2)await new Promise(r=>setTimeout(r,5));release();const next=await nextPromise;assert.equal(next.operation.input.component_id,'component-1');assert.equal(executions,2);
});

test('bounded repair stops after first retained FAIL and source drift never grants a new operation',async t=>{
  const f=await fixture(t,{maxReworks:0}),adapter=fixtureAdapter();for(let n=0;n<12;n++){const result=await runNativeGoalStep(f.target,f.manifest.id,{adapter});if(result.idle==='components-blocked')break;}
  const state=await readNativeGoal(f.target,f.manifest.id);assert.equal(state.accepted,false);assert.match(state.components[0].last_error,/rework limit/);assert.equal((await readNativeTask(f.target,'WK-component-0')).review.judgment,'fail');
  await fs.appendFile(f.target+'/docs/goal.json',' ');await assert.rejects(runNativeGoalStep(f.target,f.manifest.id,{adapter}),/manifest changed/);
  assert.equal((await readNativeGoal(f.target,f.manifest.id)).authority_status,'unavailable');
});

test('cancelling settled attention preserves execution identity, usage and original report without counting stop as inference',async t=>{
  const f=await fixture(t),usage={input_tokens:31,output_tokens:7},actor={agent_id:'builder',principal_id:'owner'};let calls=0;
  const adapter=createTrustedGoalAdapter({id:'attention-usage',assertCapabilities:async()=>{},execute:async ctx=>{calls++;return {status:'attention',reason:'Current visual evidence required',model_called:true,usage,actor:ctx.input.actor,thread_id:'actual-synthetic-thread',operation_id:ctx.operation_id,runtime_selection:ctx.input.model,product_access:'read',tool:'synthetic'};},reconcile:async()=>({status:'unknown',reason:'No new model turn'}),cancel:async()=>({status:'cancelled',reason:'Settled exact runtime',model_called:false,usage:{input_tokens:0,output_tokens:0}})});
  for(let n=0;n<4&&!calls;n++)await runNativeGoalStep(f.target,f.manifest.id,{adapter});assert.equal(calls,1);
  const before=await readNativeGoal(f.target,f.manifest.id),original=before.operations.find(o=>o.kind==='runtime');
  await controlNativeGoal(f.target,f.manifest.id,'cancel',{actor:builder,operation_id:'stop-measured-attention',expected_version:before.version});
  for(let n=0;n<8&&(await readNativeGoal(f.target,f.manifest.id)).state!=='cancelled';n++)await runNativeGoalStep(f.target,f.manifest.id,{adapter});
  const stopped=await readNativeGoal(f.target,f.manifest.id),op=stopped.operations.find(o=>o.id===original.id);assert.equal(stopped.state,'cancelled');assert.deepEqual(op.first_result,original.first_result);assert.deepEqual(op.result.usage,usage);assert.deepEqual(op.result.actor,original.result.actor);assert.equal(op.result.thread_id,'actual-synthetic-thread');assert.deepEqual(op.result.runtime_selection,original.result.runtime_selection);assert.equal(op.result.model_called,true);assert.equal(op.result.status,'cancelled');assert.equal(op.result.cancellation.model_called,false);assert.equal(calls,1);assert.deepEqual(op.timing.execution,original.timing.execution);
});

test('frozen goal remains cancellable after approved manifest and approval bytes drift',async t=>{
  const f=await fixture(t),adapter=fixtureAdapter();await runNativeGoalStep(f.target,f.manifest.id,{adapter});
  await fs.appendFile(f.target+'/docs/goal.json',' ');await fs.appendFile(f.target+'/docs/approval.md','Drift');
  const stale=await readNativeGoal(f.target,f.manifest.id);assert.equal(stale.manifest.id,f.manifest.id);assert.equal(stale.authority_status,'unavailable');
  await controlNativeGoal(f.target,f.manifest.id,'cancel',{actor:builder,operation_id:'cancel-drift',expected_version:stale.version});
  for(let n=0;n<5;n++)await runNativeGoalStep(f.target,f.manifest.id,{adapter});const stopped=await readNativeGoal(f.target,f.manifest.id);assert.equal(stopped.status,'cancelled',JSON.stringify(stopped.operations.map(o=>({phase:o.input.phase,result:o.result}))));assert.equal((await readNativeTask(f.target,'WK-component-0')).state,'cancelled');
});

test('explicit safe parent release preserves sealed standing authority while native overlap gates remain active',async t=>{
  const f=await fixture(t,{release:true}),adapter=fixtureAdapter({firstFail:false});
  const first=await runNativeGoalStep(f.target,f.manifest.id,{adapter});assert.equal(first.operation.input.phase,'release-controller');assert.equal((await readNativeTask(f.target,'WK-controller')).state,'intake');
  assert.equal((await assertNativeGoalAuthority(f.target,f.manifest.id,{actor:builder})).standing_authorized,true);
  assert.equal((await finish(f,adapter)).accepted,true);
  assert.equal((await createNativeGoal(f.target,f.request)).replayed,true,'registration replay does not require released original claim');
});

test('whole acceptance becomes stale when an approved interface differs from its reviewed Git candidate',async t=>{
  const f=await fixture(t),adapter=fixtureAdapter({firstFail:false});assert.equal((await finish(f,adapter)).accepted,true);
  await fs.appendFile(f.target+'/src/value.mjs','// Unreviewed interface change\n');const stale=await readNativeGoal(f.target,f.manifest.id);assert.equal(stale.accepted,false);assert.equal(stale.whole_acceptance,'stale');assert.equal(stale.mandatory_components[0].accepted,false);
  // A stale historical acceptance is not an execution fault: the goal stays done and needs no recovery.
  assert.equal(stale.status,'done');const registry={projects:[{id:'project-0',task_root:f.target,repositories:[{id:'repo-0',path:f.target,scope:'.'}]}]},projected=projectWorkspaceGoals([stale],registry,'project-0')[0];
  assert.equal(projected.acceptance,'stale');assert.equal(projected.requires_recovery,false);
});

test('separate scheduler process cannot double-start an operation owned by a live process',async t=>{
  const f=await fixture(t),adapter=fixtureAdapter();await runNativeGoalStep(f.target,f.manifest.id,{adapter});
  const module=new URL('../src/workkeel-goals.mjs',import.meta.url).href,source=`import {runNativeGoalStep,createTrustedGoalAdapter} from ${JSON.stringify(module)};const adapter=createTrustedGoalAdapter({id:'actual-child-fixture',assertCapabilities:async()=>{},execute:async ctx=>{process.stdout.write('entered\\n');await new Promise(r=>process.stdin.once('data',r));return {status:'unknown',reason:'Actual fixture child held exact operation'};},reconcile:async()=>({status:'unknown'}),cancel:async()=>({status:'cancelled'})});await runNativeGoalStep(${JSON.stringify(f.target)},'goal-one',{adapter});`;
  const child=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['pipe','pipe','pipe']});t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});let stderr='';child.stderr.on('data',d=>stderr+=d);const exited=new Promise(r=>child.once('exit',r));
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Child did not acquire: '+stderr)),5000);child.stdout.on('data',d=>{if(String(d).includes('entered')){clearTimeout(timer);resolve();}});});
  const result=await runNativeGoalStep(f.target,f.manifest.id,{adapter});assert.equal(result.idle,'waiting-for-dependencies');child.stdin.end('release\n');assert.equal(await exited,0,stderr);
  const view=await readNativeGoal(f.target,f.manifest.id);assert.equal(view.operations.filter(o=>o.kind==='runtime').length,1);assert.equal(view.operations.at(-1).first_result.reason,'Actual fixture child held exact operation');
});

test('expiry prohibits new dispatch while frozen explicit cancellation still closes native tasks',async t=>{
  const f=await fixture(t,{expiresAt:new Date(Date.now()+3600000).toISOString()}),adapter=fixtureAdapter();await runNativeGoalStep(f.target,f.manifest.id,{adapter});const clock=Date.now;Date.now=()=>clock()+7200000;
  try{await assert.rejects(runNativeGoalStep(f.target,f.manifest.id,{adapter}),/expired/);const stale=await readNativeGoal(f.target,f.manifest.id);await controlNativeGoal(f.target,f.manifest.id,'cancel',{actor:builder,operation_id:'stop-expired',expected_version:stale.version});for(let n=0;n<4;n++)await runNativeGoalStep(f.target,f.manifest.id,{adapter});assert.equal((await readNativeGoal(f.target,f.manifest.id)).status,'cancelled');}finally{Date.now=clock;}
});

test('service does not spin on its own uncertain result writes or invoke inference during idle reconciliation',async t=>{
  const f=await fixture(t);let calls=0,reconciliations=0;const errors=[];
  const adapter=createTrustedGoalAdapter({id:'bounded-watcher-fixture',assertCapabilities:async()=>{},execute:async()=>{calls++;return {status:'unknown',reason:'Synthetic unknown; never infer on poll'};},reconcile:async()=>{reconciliations++;return {status:'unknown',reason:'Still unknown'};},cancel:async()=>({status:'cancelled'})});
  let ready;const observed=new Promise(r=>ready=r),service=await serveNativeGoal(f.target,f.manifest.id,{adapter,reconcile_ms:1000,onError:e=>errors.push(e),onStep:result=>{if(result.operation?.kind==='runtime')ready();}});t.after(()=>service.close());let timer;await Promise.race([observed,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Service did not dispatch')),4000))]);clearTimeout(timer);await new Promise(r=>setTimeout(r,250));service.close();assert.equal(calls,1);assert.ok(reconciliations<=1);assert.deepEqual(errors.map(e=>e.message),[]);
});

test('abort during capability qualification never dispatches or reserves model work',async t=>{
  const f=await fixture(t),controller=new AbortController();let calls=0;
  const adapter=createTrustedGoalAdapter({id:'abort-during-qualification',assertCapabilities:async()=>controller.abort(),execute:async()=>{calls++;return {status:'unknown'};},reconcile:async()=>({status:'unknown'}),cancel:async()=>({status:'cancelled'})});
  await runNativeGoalStep(f.target,f.manifest.id,{adapter});
  const step=await runNativeGoalStep(f.target,f.manifest.id,{adapter,signal:controller.signal});
  assert.equal(step.idle,'aborted');assert.equal(step.model_called,false);assert.equal(calls,0);
  assert.equal((await readNativeGoal(f.target,f.manifest.id)).operations.filter(o=>o.kind==='runtime').length,0);
});

test('standing manifest drift during qualification blocks new dispatch without a model intent',async t=>{
  const f=await fixture(t);let calls=0;
  const adapter=createTrustedGoalAdapter({id:'authority-during-qualification',assertCapabilities:async()=>fs.appendFile(f.target+'/docs/goal.json',' '),execute:async()=>{calls++;return {status:'unknown'};},reconcile:async()=>({status:'unknown'}),cancel:async()=>({status:'cancelled'})});
  await runNativeGoalStep(f.target,f.manifest.id,{adapter});
  await assert.rejects(runNativeGoalStep(f.target,f.manifest.id,{adapter}),/goal manifest or approval bytes changed|authority source changed/);
  assert.equal(calls,0);assert.equal((await readNativeGoal(f.target,f.manifest.id)).operations.filter(o=>o.kind==='runtime').length,0);
});

for(const interruption of ['abort','authority'])test('persisted but unstarted intent safely resumes after '+interruption+' at the dispatch boundary',async t=>{
  const f=await fixture(t),controller=new AbortController();let calls=0;
  const adapter=fixtureAdapter({firstFail:false,onExecute:()=>calls++});
  await runNativeGoalStep(f.target,f.manifest.id,{adapter});
  const manifestPath=f.target+'/docs/goal.json',original=await fs.readFile(manifestPath),rename=fs.rename;let injected=false;
  fs.rename=async(from,to)=>{
    const value=await rename(from,to);
    if(!injected&&to===f.target+'/.ai-org/goals/goal-one/state.json'){
      const state=JSON.parse(await fs.readFile(to,'utf8')).value;
      if(state.operations.at(-1)?.kind==='runtime'){
        injected=true;if(interruption==='abort')controller.abort();else await fs.appendFile(manifestPath,' ');
      }
    }
    return value;
  };
  let step;try{step=await runNativeGoalStep(f.target,f.manifest.id,{adapter,signal:controller.signal});}finally{fs.rename=rename;}
  assert.equal(injected,true);assert.equal(calls,0);assert.equal(step.model_called,false);
  assert.equal(step.operation.status,'intent');assert.equal(step.operation.result.dispatch_started,false);assert.equal(step.operation.timing,undefined);
  const before=await readNativeGoal(f.target,f.manifest.id),intent=before.operations.at(-1);
  if(interruption==='authority')await fs.writeFile(manifestPath,original);
  const resumed=await runNativeGoalStep(f.target,f.manifest.id,{adapter});
  assert.equal(calls,1);assert.equal(resumed.operation.id,intent.id);assert.equal(resumed.operation.status,'completed');
  const after=await readNativeGoal(f.target,f.manifest.id);assert.equal(after.operations.length,before.operations.length);assert.equal(after.reserved_ms,before.reserved_ms);
  assert.equal(after.components[0].phase,'implementation');
  assert.equal(after.operations.at(-1).first_result.dispatch_started,false,'retain the original no-effects boundary result after resumption');
});

test('explicit recovery and successful planning clear the recovered aggregate error',async t=>{
  const f=await fixture(t),bad=createTrustedGoalAdapter({id:'blocked-then-recover',assertCapabilities:async()=>{throw Error('Fixed planning model unavailable');},execute:async()=>({status:'unknown'}),reconcile:async()=>({status:'unknown'}),cancel:async()=>({status:'cancelled'})});
  await runNativeGoalStep(f.target,f.manifest.id,{adapter:bad});await runNativeGoalStep(f.target,f.manifest.id,{adapter:bad});await runNativeGoalStep(f.target,f.manifest.id,{adapter:bad});
  const blocked=await readNativeGoal(f.target,f.manifest.id);assert.match(blocked.last_error,/Fixed planning model unavailable/);
  await controlNativeGoal(f.target,f.manifest.id,'recover',{actor:builder,operation_id:'recover-restored-model',expected_version:blocked.version});
  assert.equal((await readNativeGoal(f.target,f.manifest.id)).last_error,null);
  const step=await runNativeGoalStep(f.target,f.manifest.id,{adapter:fixtureAdapter({firstFail:false})});assert.equal(step.operation.status,'completed');
  const recovered=await readNativeGoal(f.target,f.manifest.id);assert.equal(recovered.components[0].phase,'implementation');assert.equal(recovered.components[0].last_error,null);assert.equal(recovered.last_error,null);
});

test('successful exact reconciliation retains another component recovery reason',async t=>{
  const f=await fixture(t,{count:3}),base=fixtureAdapter({firstFail:false});
  const adapter=createTrustedGoalAdapter({...base,id:'preserve-other-error',assertCapabilities:async ctx=>{if(ctx.component.id==='component-1')throw Error('Other model unavailable');},execute:async ctx=>{const result=await base.execute(ctx);return ctx.component.id==='component-0'&&ctx.input.phase==='planning'?{status:'unknown',reason:'Lost planning response'}:result;}});
  await runNativeGoalStep(f.target,f.manifest.id,{adapter});await runNativeGoalStep(f.target,f.manifest.id,{adapter});await runNativeGoalStep(f.target,f.manifest.id,{adapter});await runNativeGoalStep(f.target,f.manifest.id,{adapter});
  const result=await runNativeGoalStep(f.target,f.manifest.id,{adapter});assert.equal(result.operation.status,'completed');
  const view=await readNativeGoal(f.target,f.manifest.id);assert.equal(view.components[0].last_error,null);assert.match(view.components[1].last_error,/Other model unavailable/);assert.match(view.last_error,/Other model unavailable/);assert.doesNotMatch(view.last_error,/Lost planning response/);
});

test('goal rework is clamped to the risk-tier limit and then waits for a person',async t=>{
  const f=await fixture(t,{maxReworks:10}),adapter=fixtureAdapter({alwaysFail:true});let view;
  for(let n=0;n<60;n++){const step=await runNativeGoalStep(f.target,f.manifest.id,{adapter});view=await readNativeGoal(f.target,f.manifest.id);if(step.idle)break;}
  assert.match(view.components[0].last_error,/Risk-tier rework limit reached/);
  assert.equal((await readNativeTask(f.target,'WK-component-0')).attempts.filter(a=>a.kind==='rejected').length,3);
});

test('the existing goal path shares the trial ledger and persists a user stop before any further dispatch',async t=>{
  const {startLoopRun,readLoopRun,requestLoopStop}=await import('../src/workkeel-loop-run.mjs');
  const f=await fixture(t),costPath={path:'synthetic-goal-host',billing:'local'},adapter=fixtureAdapter({costPath});
  await startLoopRun(f.target,{id:'synthetic-trial',goal_id:f.manifest.id,proposal_sha256:'a'.repeat(64),baseline_sha256:'b'.repeat(64),cost_path:costPath},{authorizeUser:async()=>true,costPath});
  await runNativeGoalStep(f.target,f.manifest.id,{adapter});
  assert.equal((await readLoopRun(f.target)).operations,1,'native claim is charged once');
  await runNativeGoalStep(f.target,f.manifest.id,{adapter});
  assert.equal((await readLoopRun(f.target)).operations,2,'host planning is charged once');
  await requestLoopStop(f.target);
  await assert.rejects(runNativeGoalStep(f.target,f.manifest.id,{adapter}),/stop/);
  const run=await readLoopRun(f.target),goal=await readNativeGoal(f.target,f.manifest.id);
  assert.equal(run.stop.requested,true);assert.equal(run.stop.confirmed,true);assert.deepEqual(run.stop.unknown,[]);
  assert.equal(goal.status,'cancelled');assert.equal(goal.operations.length,2);assert.equal(run.operations,2);
});

test('an unqualified cost path cannot dispatch even the first native goal operation',async t=>{
  const {startLoopRun,readLoopRun}=await import('../src/workkeel-loop-run.mjs');
  const f=await fixture(t),costPath={path:'synthetic-goal-host',billing:'local'};
  await startLoopRun(f.target,{id:'synthetic-trial',goal_id:f.manifest.id,proposal_sha256:'a'.repeat(64),baseline_sha256:'b'.repeat(64),cost_path:costPath},{authorizeUser:async()=>true,costPath});
  await assert.rejects(runNativeGoalStep(f.target,f.manifest.id,{adapter:fixtureAdapter()}),/Missing|unknown|cost/);
  assert.equal((await readNativeGoal(f.target,f.manifest.id)).operations.length,0);
  assert.equal((await readLoopRun(f.target)).stop.requested,true);
});

test('an already-aborted user signal persists a trial stop before a native claim can start',async t=>{
  const {startLoopRun,readLoopRun}=await import('../src/workkeel-loop-run.mjs');
  const f=await fixture(t),costPath={path:'synthetic-goal-host',billing:'local'},signal=new AbortController();
  await startLoopRun(f.target,{id:'synthetic-trial',goal_id:f.manifest.id,proposal_sha256:'a'.repeat(64),baseline_sha256:'b'.repeat(64),cost_path:costPath},{authorizeUser:async()=>true,costPath});
  signal.abort();await runNativeGoalStep(f.target,f.manifest.id,{adapter:fixtureAdapter({costPath}),signal:signal.signal});
  assert.equal((await readLoopRun(f.target)).stop.requested,true);assert.equal((await readNativeGoal(f.target,f.manifest.id)).operations.length,0);
});

for (const terminal of ['finish', 'clear']) test(`ordinary goals run after ${terminal} without trial cost qualification`, async t => {
  const {startLoopRun,finishLoopRun,requestLoopStop,confirmLoopStop,clearLoopStop,readLoopRun}=await import('../src/workkeel-loop-run.mjs');
  const f=await fixture(t),costPath={path:'synthetic-goal-host',billing:'local'};
  await startLoopRun(f.target,{id:'synthetic-trial',goal_id:'another-goal',proposal_sha256:'a'.repeat(64),baseline_sha256:'b'.repeat(64),cost_path:costPath},{authorizeUser:async()=>true,costPath});
  if(terminal==='finish')await finishLoopRun(f.target);
  else {await requestLoopStop(f.target);await confirmLoopStop(f.target);await clearLoopStop(f.target,{authorizeUser:async()=>true});}
  const before=await readLoopRun(f.target);
  const adapter=fixtureAdapter();
  await runNativeGoalStep(f.target,f.manifest.id,{adapter});
  await runNativeGoalStep(f.target,f.manifest.id,{adapter});
  assert.equal((await readNativeGoal(f.target,f.manifest.id)).operations.length,2);
  const after=await readLoopRun(f.target);
  assert.equal(after.operations,before.operations);assert.equal(after.stop.requested,false);assert.equal(after.status,before.status);
});
