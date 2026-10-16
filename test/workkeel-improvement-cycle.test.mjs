import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {initializeTaskProject} from '../src/workkeel-project.mjs';
import {createNativeTask,readNativeTask,mutateNativeTask} from '../src/workkeel-tasks.mjs';
import {createNativeGoal,readNativeGoal,runNativeGoalStep,createTrustedGoalAdapter,controlNativeGoal} from '../src/workkeel-goals.mjs';
import {readTaskFile} from '../src/task-contract.mjs';
import {executionDigest} from '../src/workkeel-execution-policy.mjs';
import {mutateAutonomy,readAutonomy,runAutonomyStep,serveAutonomy} from '../src/workkeel-autonomy.mjs';
import {readGoalAdmissions,admitGoalImprovement,reconcileGoalAdmission,extendGoalAdmission,readGoalAdmissionAuthority} from '../src/workkeel-autonomy-admission.mjs';
import {runImprovementCycle} from '../src/workkeel-improvement-cycle.mjs';
import {createWorkspaceHooks} from '../src/workkeel-workspace-hooks.mjs';
import {inventoryRetention} from '../src/workkeel-retention.mjs';
import {loadTaskRequirements} from '../src/workkeel-requirements.mjs';
import {createHash} from 'node:crypto';
import {crc32,deflateSync} from 'node:zlib';

const actor={agent_id:'builder',principal_id:'owner'},reviewer={agent_id:'reviewer',principal_id:'owner'};
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const tuple={provider:'openai',model:'synthetic-only',reasoning:'high',service:'provider-default'};
async function fixture(t,{risk='standard',maxGoals=8,empty=false,maxRounds=2,guarded=false}={}){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'workkeel-improvement-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(root+'/src');await fs.mkdir(root+'/docs');git(root,'init','-q');git(root,'config','user.name','Synthetic');git(root,'config','user.email','fixture@example.invalid');
  await fs.writeFile(root+'/.gitignore','.ai-org/\n');await fs.writeFile(root+'/docs/approval.md','Synthetic explicit bounded source/goal/improvement approval.');await fs.writeFile(root+'/src/value.mjs','export const value="baseline";\n');
  await initializeTaskProject(root,{schema_version:'workkeel.task-policy/v1',principals:['owner'],agents:[actor,reviewer],approvers:['owner'],review_separation:'distinct-agent'});
  const template={schema_version:'workkeel.improvement-template/v1',id:'template-one',source_component_id:'source',title_prefix:'Improve',acceptance:['Syntax remains valid'],include:['src/value.mjs'],exclude:['Publication']};await fs.writeFile(root+'/docs/template.json',JSON.stringify(template)+'\n');
  git(root,'add','.');git(root,'commit','-qm','Synthetic baseline');
  const contract={schema_version:'workkeel.task-contract/v1',id:'WK-source',goal:'Synthetic source',actor,state:'intake',scope:{include:['src'],exclude:['Publication']},dependencies:[],acceptance:{criteria:['Verified source'],evidence:[]},verification:{risk_tier:'standard',separation:'distinct-agent',implementer:null,reviewer:null,candidate_revision:null},handoff:null,environment:{cwd:'.',read_paths:['.'],write_paths:['src'],tools:['node','git'],resources:[],network:{mode:'none',hosts:[]},external_actions:[],data:{classification:'internal',model_access:'none',policy_refs:['docs/approval.md','docs/template.json']}},authorization:{approved_by:'owner',approval_ref:'docs/approval.md',operations:['read','write','execute'],expires_at:null},execution:{runtime:{kind:'host-owned',adapter_id:null,required_features:[]},model_connection:{kind:'native'}},skills:[],legacy:null};
  if(guarded){
    await fs.writeFile(root+'/docs/original.md','Synthetic original decision: preserve the value export binding.');
    const requirement={id:'R-export',criterion:'Preserve the value export binding',paths:['src'],sources:[{path:'docs/original.md',sha256:(await readTaskFile(root,'docs/original.md')).bytes_digest,quote:'preserve the value export binding'}],superseded_by:null,visual:false};
    await fs.writeFile(root+'/docs/requirements.json',JSON.stringify({schema_version:'workkeel.requirements/v1',id:'source-decisions',requirements:[requirement]}));
    contract.environment.data.policy_refs.push('docs/requirements.json');contract.acceptance.criteria.push(requirement.criterion);
  }
  await createNativeTask(root,contract,{operation_id:'intake-source',expected_version:0,actor});const sourceTask=await readNativeTask(root,contract.id);
  const grant={enabled:true,directions:['quality'],read_paths:['.'],write_paths:['src'],template_ref:'docs/template.json',source_refs:['src/value.mjs'],max_source_bytes:65536,max_rounds:maxRounds,cooldown_ms:0,max_goals:maxGoals,max_total_operations:320,max_total_runtime_ms:400000,max_total_cost_usd:null,max_reworks:1,max_operations:40,max_attempts:2,max_runtime_ms:50000,max_cost_usd:null};
  const manifest={schema_version:'workkeel.goal/v1',id:'source-goal',title:'Synthetic accepted source',approval_ref:'docs/approval.md',approved_by:actor,expires_at:null,components:[{id:'source',project_id:'project',repo_id:'repo',root,task_id:contract.id,contract_sha256:sourceTask.contract_sha256,depends_on:[],checks:[{id:'syntax',command:'node',args:['--check','src/value.mjs']}],rollback:'Governed revert to baseline',interface_refs:['src/value.mjs']}],integration:{component_id:'source',criteria:['Verified source']},roles:{implementer:actor,reviewer,approver:actor},models:Object.fromEntries(['planning','implementation','verification','repair','review'].map(p=>[p,tuple])),limits:{max_operations:40,max_reworks:1,timeout_ms:50000,max_cost_usd:null},control:{release_parent:true},admission:grant};
  await fs.writeFile(root+'/docs/goal.json',JSON.stringify(manifest)+'\n');git(root,'add','.');git(root,'commit','-qm','Approve exact synthetic standing goal');
  const controller={...structuredClone(contract),id:'WK-controller',environment:{...contract.environment,write_paths:['.'],data:{...contract.environment.data,policy_refs:[...contract.environment.data.policy_refs,'docs/goal.json']}}};
  await createNativeTask(root,controller,{operation_id:'intake-controller',expected_version:0,actor});await mutateNativeTask(root,controller.id,'claim',{operation_id:'claim-controller',expected_version:1,actor,base_revision:git(root,'rev-parse','HEAD')});
  const control=await readNativeTask(root,controller.id),request={task_id:control.id,actor,claim_id:control.claim.id,contract_sha256:control.contract_sha256,operation_id:'create-goal',expected_version:0,manifest_ref:'docs/goal.json'};await createNativeGoal(root,request);
  const calls=[],receipts=new Map(),reviews=new Map(),deliveries=new Map();
  async function artifact(ctx,kind,value){const ref='.ai-org/artifacts/'+ctx.task.id+'/'+kind+'-'+ctx.operation_id+'.json';await fs.mkdir(path.dirname(root+'/'+ref),{recursive:true});await fs.writeFile(root+'/'+ref,JSON.stringify(value)+'\n');return {path:ref,sha256:(await readTaskFile(root,ref)).bytes_digest};}
  const adapter=createTrustedGoalAdapter({id:'synthetic-improvement-only',assertCapabilities:async()=>{},cancel:async()=>({status:'cancelled'}),reconcile:async ctx=>receipts.get(ctx.operation_id)??{status:'unknown'},execute:async ctx=>{
    calls.push(ctx);const phase=ctx.input.phase,discovery=ctx.component.purpose==='discovery',thread=phase==='review'?'synthetic-review-'+ctx.task.id+'-'+ctx.input.cycle:'synthetic-builder-'+ctx.task.id;
    const result={status:'completed',operation_id:ctx.operation_id,actor:ctx.input.actor,thread_id:thread,runtime_selection:ctx.input.model,product_access:discovery||['planning','verification','review'].includes(phase)?'read':'write',usage:{input_tokens:null,output_tokens:null,cost_usd:null}};
    if(phase==='planning')result.report_pin=await artifact(ctx,phase,{synthetic:true});
    if(['implementation','repair'].includes(phase)){
      if(discovery){const evidence={path:'src/value.mjs',sha256:(await readTaskFile(root,'src/value.mjs')).bytes_digest};result.proposal_report={proposals:empty?[]:[{id:'improve-value',title:'Remove the observed fixture defect',direction:'quality',risk_tier:risk,expected_benefit:'Value equals improved',acceptance:['Exported value equals improved'],evidence:[evidence],scope:{read_paths:['.'],write_paths:['src']},budget:{max_attempts:2,max_runtime_ms:50000,max_cost_usd:null}}]};result.source_pins=[evidence];result.report_pin=await artifact(ctx,'discovery',result.proposal_report);}
      else{const value=ctx.manifest.id==='source-goal'?'source':phase==='repair'?'improved':'defective';await fs.writeFile(root+'/src/value.mjs','export const value="'+value+'";\n');git(root,'add','src/value.mjs');git(root,'commit','-qm','Synthetic '+ctx.operation_id);result.report_pin=await artifact(ctx,phase,{synthetic:true,value});}
      result.candidate_revision=git(root,'rev-parse','HEAD');
    }
    if(guarded&&['implementation','repair'].includes(phase)){
      const set=await loadTaskRequirements(root,ctx.task.contract),evidence={path:'src/value.mjs',sha256:(await readTaskFile(root,'src/value.mjs')).bytes_digest,kind:'observation'};
      if(discovery)result.proposal_report.requirement_assessments=set.active.map(r=>({id:r.id,status:'observed-satisfied',observation:'Synthetic source retains its exported binding',sources:r.sources.map(({path,sha256})=>({path,sha256})),evidence:[evidence],proposal_id:null}));
      if(set.applicable.length)deliveries.set(ctx.task.id,await artifact(ctx,'requirements-delivery',{schema_version:'workkeel.requirement-outcomes/v1',task_id:ctx.task.id,contract_sha256:ctx.task.contract_sha256,candidate_revision:result.candidate_revision,requirements_sha256:set.sha256,phase:'delivery',actor,requirements:set.applicable.map(r=>({id:r.id,status:'pass',observation:'Synthetic implementation retains export',sources:r.sources.map(({path,sha256})=>({path,sha256})),evidence:[evidence]})),open_findings:[]}));
    }
    if(phase==='verification'){execFileSync(process.execPath,['--check',root+'/src/value.mjs']);result.candidate_revision=ctx.input.candidate;result.checks=[{id:'syntax',status:'pass'}];const pin=await artifact(ctx,phase,{synthetic:true,candidate:ctx.input.candidate});result.evidence=[pin.path];result.integration_pin=await artifact(ctx,'integration',{schema_version:'workkeel.goal-integration/v1',manifest_sha256:ctx.manifest_sha256,required_components:ctx.input.required_components,components:ctx.input.accepted_components,candidate_set_sha256:executionDigest(ctx.input.accepted_components),integration_candidate:ctx.input.candidate,checks:result.checks});result.evidence.push(result.integration_pin.path);}
    if(phase==='verification'&&deliveries.has(ctx.task.id))result.evidence.push(deliveries.get(ctx.task.id).path);
    if(phase==='review'&&guarded){
      const set=await loadTaskRequirements(root,ctx.task.contract),evidence={path:'src/value.mjs',sha256:(await readTaskFile(root,'src/value.mjs')).bytes_digest,kind:'observation'};
      if(set.applicable.length){const p=await artifact(ctx,'requirements-review',{schema_version:'workkeel.requirement-outcomes/v1',task_id:ctx.task.id,contract_sha256:ctx.task.contract_sha256,candidate_revision:ctx.input.candidate,requirements_sha256:set.sha256,phase:'review',actor:reviewer,requirements:set.applicable.map(r=>({id:r.id,status:'pass',observation:'Synthetic distinct reviewer sees exported value',sources:r.sources.map(({path,sha256})=>({path,sha256})),evidence:[evidence]})),open_findings:[]});ctx.input.verification.evidence.push(p.path);}
    }
    if(phase==='review'){const count=reviews.get(ctx.task.id)??0;reviews.set(ctx.task.id,count+1);const proof='.ai-org/artifacts/'+ctx.task.id+'/review-'+ctx.operation_id+'.json',judgment=!discovery&&ctx.manifest.id!=='source-goal'&&count===0?'fail':'pass';const native_request={operation_id:ctx.operation_id,expected_version:ctx.task.version,actor:reviewer,revision:ctx.input.candidate,judgment,summary:judgment==='fail'?'Synthetic actual reviewer rejects defective value':'Synthetic distinct reviewer verifies exact candidate',evidence:[...ctx.input.verification.evidence,proof]};result.authored_request_pin=await artifact(ctx,'review',{schema_version:'workkeel.goal-authored-review/v1',actor:reviewer,thread_id:thread,operation_id:ctx.operation_id,product_access:'read',runtime_selection:ctx.input.model,native_request});await mutateNativeTask(root,ctx.task.id,'review',native_request);}
    receipts.set(ctx.operation_id,result);return result;
  }});
  for(let n=0;n<30&&!(await readNativeGoal(root,manifest.id)).accepted;n++)await runNativeGoalStep(root,manifest.id,{adapter});assert.equal((await readNativeGoal(root,manifest.id)).accepted,true);
  delete request.manifest_ref;
  const policy={enabled:true,directions:['quality'],max_jobs:20,max_attempts:2,cooldown_ms:0,admission:{enabled:true,goal_id:manifest.id},discovery:{enabled:true,read_paths:['.'],write_paths:['src'],max_proposals:10,max_source_bytes:65536,max_rounds:maxRounds,cooldown_ms:0,max_runtime_ms:50000,max_cost_usd:null}};
  await mutateAutonomy(root,'policy',{...request,goal_id:manifest.id,operation_id:'enable-standing',expected_version:0,policy});calls.length=0;return {root,manifest,request,policy,adapter,calls};
}

test('opt-in discovery creates bounded work, retains reviewer FAIL, repairs, accepts and reexplores changed sources',async t=>{
  const f=await fixture(t);let execution;
  for(let n=0;n<90;n++){await runImprovementCycle(f.root,{adapter:f.adapter});const journal=await readGoalAdmissions(f.root);execution=journal.entries.find(e=>e.kind==='execution');if(execution&&(await readNativeGoal(f.root,execution.intent.manifest.id)).accepted)break;}
  assert.ok(execution);const goal=await readNativeGoal(f.root,execution.intent.manifest.id);assert.equal(goal.accepted,true);const task=await readNativeTask(f.root,execution.intent.product.id);assert.equal(task.attempts[0].review.judgment,'fail');assert.notEqual(task.attempts[0].delivery.revision,task.delivery.revision);assert.equal(task.review.actor.agent_id,'reviewer');assert.equal(task.state,'done');
  assert.ok(f.calls.some(c=>c.component.purpose==='discovery'));assert.ok(f.calls.some(c=>c.input.phase==='repair'));
  for(const op of goal.operations.filter(o=>o.kind==='runtime')){assert.equal(op.timing.execution.basis,'goal-adapter-observed-wall-time');assert.ok(op.timing.execution.duration_ms>=0);assert.equal(op.result.usage.input_tokens,null);}
  const footprint=await inventoryRetention(f.root,{schema_version:'workkeel.retention-policy/v1',roots:['.ai-org/goals','.ai-org/autonomy','.ai-org/artifacts','.ai-org/work-items'],protected_paths:[],archive_root:'.ai-org/retention',limits:{max_files:1024,max_bytes:16777216,max_file_bytes:1048576}});t.diagnostic('Synthetic accepted improvement footprint: '+JSON.stringify({bytes:footprint.bytes,files:footprint.file_count,roots:footprint.roots,scope:'one source goal, one discovery, one repaired improvement; not a daily production estimate'}));
  const after=await runImprovementCycle(f.root,{adapter:f.adapter});assert.equal(after.progressed,true);assert.equal((await readGoalAdmissions(f.root)).entries.filter(e=>e.kind==='discovery').length,2);
  assert.equal((await readNativeGoal(f.root,f.manifest.id)).whole_acceptance,'stale');
});

test('off and unchanged empty discovery are idle without model turns; supported source changes trigger a new round',async t=>{
  const f=await fixture(t,{empty:true});const state=await readAutonomy(f.root);await mutateAutonomy(f.root,'policy',{...f.request,goal_id:f.manifest.id,operation_id:'off',expected_version:state.version,policy:{...f.policy,enabled:false}});assert.equal((await runImprovementCycle(f.root,{adapter:f.adapter})).idle,'improvement-disabled');assert.equal(f.calls.length,0);
  await mutateAutonomy(f.root,'policy',{...f.request,goal_id:f.manifest.id,operation_id:'on',expected_version:(await readAutonomy(f.root)).version,policy:f.policy});
  let result;for(let n=0;n<30;n++){result=await runImprovementCycle(f.root,{adapter:f.adapter});assert.notEqual(result.idle,'derived-goal-needs-attention','newly accepted discovery must settle directly to its real idle state');if(result.idle==='unchanged-approved-sources')break;}assert.equal(result.idle,'unchanged-approved-sources');const count=f.calls.length;await runImprovementCycle(f.root,{adapter:f.adapter});assert.equal(f.calls.length,count);
  await fs.appendFile(f.root+'/src/value.mjs','// source event\n');assert.equal((await runImprovementCycle(f.root,{adapter:f.adapter})).progressed,true);
});

test('PNG-backed proposals admit once and reject stale evidence without spending another reservation',async t=>{
  const f=await fixture(t),chunk=(type,bytes)=>{const out=Buffer.alloc(bytes.length+12);out.writeUInt32BE(bytes.length);out.write(type,4);bytes.copy(out,8);out.writeUInt32BE(crc32(out.subarray(4,-4)),out.length-4);return out;};
  const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
  const bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc(5))),chunk('IEND',Buffer.alloc(0))]);
  const pin={path:'.ai-org/artifacts/observed.png',sha256:createHash('sha256').update(bytes).digest('hex')};await fs.writeFile(f.root+'/'+pin.path,bytes);
  const proposal={id:'screenshot-finding',title:'Fix an observed bounded issue',direction:'quality',risk_tier:'low',expected_benefit:'The visible issue is resolved',acceptance:['Screenshot is legible'],evidence:[pin],scope:{read_paths:['.'],write_paths:['src']},budget:{max_attempts:1,max_runtime_ms:10000,max_cost_usd:null}};
  const request={goal_id:f.manifest.id,actor,operation_id:'admit-png',expected_version:0,proposal_id:proposal.id};
  const admitted=await admitGoalImprovement(f.root,request,{proposal});assert.ok(admitted.goal_id);assert.equal((await readGoalAdmissions(f.root)).entries.length,1);
  assert.equal((await admitGoalImprovement(f.root,request,{proposal})).replayed,true);
  await fs.writeFile(f.root+'/'+pin.path,Buffer.from('changed screenshot'));
  await assert.rejects(admitGoalImprovement(f.root,{...request,operation_id:'another-png',expected_version:(await readGoalAdmissions(f.root)).version,proposal_id:'another-png'},{proposal:{...proposal,id:'another-png'}}),/digest mismatch/);
  assert.equal((await readGoalAdmissions(f.root)).entries.length,1);
});

test('unresolved derived results remain visible while service listens and clear only after exact reconciliation',async t=>{
  const f=await fixture(t),reason='Synthetic screenshot result collection failed';let held=null,recover=false,executions=0;
  const adapter=createTrustedGoalAdapter({id:'held-result',assertCapabilities:f.adapter.assertCapabilities,cancel:f.adapter.cancel,execute:async ctx=>{executions++;held=await f.adapter.execute(ctx);return {status:'unknown',reason,model_called:true};},reconcile:async()=>recover?held:{status:'unknown',reason}});
  let failed;for(let n=0;n<8;n++){failed=await runImprovementCycle(f.root,{adapter});if(failed.idle==='derived-goal-needs-attention')break;}
  assert.equal(failed.idle,'derived-goal-needs-attention');assert.equal(failed.reason,reason);assert.equal(failed.phase,'planning');
  const hooks=createWorkspaceHooks(),project={id:'fixture',task_root:f.root};
  const view=await hooks.autonomy.read({project,actor});assert.equal(view.state,'needs-reconciliation');assert.equal(view.needs_attention.length,1);assert.equal(view.needs_attention[0].reason,reason);assert.equal(view.needs_attention[0].goal_id,failed.goal_id);
  const before=await readNativeGoal(f.root,failed.goal_id),count=executions;
  const again=await runImprovementCycle(f.root,{adapter});assert.equal(again.idle,'derived-goal-needs-attention');assert.equal(executions,count);
  recover=true;const resumed=await runImprovementCycle(f.root,{adapter});assert.equal(resumed.operation.id,failed.operation.id);assert.equal(resumed.operation.status,'completed');assert.equal(executions,count);
  const after=await readNativeGoal(f.root,failed.goal_id);assert.equal(after.operations.length,before.operations.length);assert.equal(after.reserved_ms,before.reserved_ms);assert.deepEqual(resumed.operation.first_result,failed.operation.first_result);
  const clear=await hooks.autonomy.read({project,actor});assert.deepEqual(clear.needs_attention,[]);assert.equal(clear.state,'execution-recorded');
});

test('known high-risk findings stop speculative discovery without spending another model turn',async t=>{
  const f=await fixture(t,{risk:'high',maxGoals:3});let result;for(let n=0;n<30;n++){result=await runImprovementCycle(f.root,{adapter:f.adapter});if(result.idle==='known-findings-need-attention')break;}assert.equal(result.manual_proposals,1);assert.equal(result.idle,'known-findings-need-attention');assert.equal((await readGoalAdmissions(f.root)).entries.length,1);const before=f.calls.length;await fs.appendFile(f.root+'/src/value.mjs','// changed\n');assert.equal((await runImprovementCycle(f.root,{adapter:f.adapter})).idle,'known-findings-need-attention');assert.equal(f.calls.length,before);assert.equal((await readGoalAdmissions(f.root)).entries.length,1);
});

test('derived admission preserves original decisions for assessment and inherits applicable delivery criteria',async t=>{
  const f=await fixture(t,{guarded:true}),evidence={path:'src/value.mjs',sha256:(await readTaskFile(f.root,'src/value.mjs')).bytes_digest};
  const discovery=await admitGoalImprovement(f.root,{goal_id:f.manifest.id,actor,operation_id:'guarded-discovery',expected_version:0},{trigger:{direction:'quality',source_refs:['src/value.mjs']}});
  const journal=await readGoalAdmissions(f.root),assessment=journal.entries[0].intent.product;
  assert.ok(assessment.environment.data.policy_refs.includes('docs/requirements.json'));
  assert.equal((await loadTaskRequirements(f.root,assessment)).active.length,1);
  assert.equal((await loadTaskRequirements(f.root,assessment)).applicable.length,0);
  const proposal={id:'guarded-fix',title:'Observed bounded repair',direction:'quality',risk_tier:'standard',expected_benefit:'Retain export while correcting value',acceptance:['Correct value'],evidence:[evidence],scope:{read_paths:['.'],write_paths:['src/value.mjs']},budget:{max_attempts:1,max_runtime_ms:5000,max_cost_usd:null}};
  await admitGoalImprovement(f.root,{goal_id:f.manifest.id,actor,operation_id:'guarded-implementation',expected_version:journal.version,proposal_id:proposal.id},{proposal});
  const delivery=(await readGoalAdmissions(f.root)).entries.find(e=>e.kind==='execution').intent.product;
  assert.ok(delivery.acceptance.criteria.includes('Correct value'));assert.ok(delivery.acceptance.criteria.includes('Preserve the value export binding'));
});

test('exhausted discovery is explicit on unchanged sources without blocking admitted improvements',async t=>{
  for(const empty of [true,false]){
    const f=await fixture(t,{empty,maxRounds:1});let result;
    for(let n=0;n<90;n++){result=await runImprovementCycle(f.root,{adapter:f.adapter});if(result.idle==='discovery-round-budget')break;}
    assert.equal(result.idle,'discovery-round-budget');assert.equal(result.rounds_used,1);assert.equal(result.rounds_limit,1);
    const journal=await readGoalAdmissions(f.root),execution=journal.entries.find(e=>e.kind==='execution');
    if(!empty){assert.ok(execution);assert.equal((await readNativeGoal(f.root,execution.intent.manifest.id)).accepted,true);}
    const before=f.calls.length,reservations=JSON.stringify(journal.entries.map(e=>e.reservation));
    assert.equal((await runImprovementCycle(f.root,{adapter:f.adapter})).idle,'discovery-round-budget');
    await fs.appendFile(f.root+'/src/value.mjs','// new event cannot renew an exhausted allowance\n');
    assert.equal((await runImprovementCycle(f.root,{adapter:f.adapter})).idle,'discovery-round-budget');assert.equal(f.calls.length,before);
    assert.equal(JSON.stringify((await readGoalAdmissions(f.root)).entries.map(e=>e.reservation)),reservations);
    const hooks=createWorkspaceHooks({goalAdapter:f.adapter}),project={task_root:f.root};
    try{
      await hooks.autonomy.execute({action:'autonomy.start-service',expectedVersion:(await readAutonomy(f.root)).version,idempotencyKey:'observe-exhausted',payload:{},project,actor});
      let observed;
      for(let n=0;n<100;n++){observed=await hooks.autonomy.read({project,actor});if(observed.service.last_step?.idle==='discovery-round-budget')break;await new Promise(r=>setTimeout(r,20));}
      assert.equal(observed.service.last_step.idle,'discovery-round-budget');assert.equal(observed.service.last_step.rounds_used,1);assert.equal(observed.service.last_step.rounds_limit,1);assert.deepEqual(observed.service.errors,[]);assert.equal(f.calls.length,before);
      assert.ok(Number.isFinite(Date.parse(observed.service.observed_at)));assert.equal(observed.service.check_interval_ms,30000);assert.ok(['checking','listening'].includes(observed.service.activity));assert.deepEqual(observed.watch_scope.repositories.map(r=>r.root),[f.root]);assert.deepEqual(observed.watch_scope.source_refs,['src/value.mjs']);
    }finally{hooks.autonomy.close();}
  }
});

test('event driver progresses native derived goals without a human continue and stops cleanly',{timeout:60000},async t=>{
  const f=await fixture(t,{empty:true});const errors=[],controller=new AbortController();const workflow={id:'unused-workflow',idempotent:true,start:async()=>({status:'unknown'}),reconcile:async()=>({status:'unknown'}),cancel:async()=>({status:'cancelled'})};
  const settled=Promise.withResolvers();
  const service=await serveAutonomy(f.root,{adapter:workflow,goalAdapter:f.adapter,signal:controller.signal,debounce_ms:1,reconcile_ms:20,onError:e=>{errors.push(e);settled.reject(e);},onStep:result=>{if(result.idle==='unchanged-approved-sources')settled.resolve();}});t.after(()=>{controller.abort();service.close();});
  t.signal.addEventListener('abort',()=>{controller.abort();service.close();settled.reject(t.signal.reason);},{once:true});
  // Observe the driver's actual settled event, not a machine-speed dependent poll count.
  await settled.promise;
  const entry=(await readGoalAdmissions(f.root)).entries[0];assert.ok(entry);assert.equal((await readNativeGoal(f.root,entry.intent.manifest.id)).accepted,true);assert.deepEqual(errors,[]);controller.abort();service.close();
});

test('explicit extension preserves spent rounds, reexamines once, and enforces the total through actual hooks and derived authority',async t=>{
  const f=await fixture(t,{empty:true,maxRounds:1,maxGoals:1}),root=f.root;
  async function settle(){let result;for(let n=0;n<50;n++){result=await runImprovementCycle(root,{adapter:f.adapter});if(result.idle)return result;}assert.fail('cycle did not settle: '+JSON.stringify(result));}
  assert.equal((await settle()).idle,'discovery-round-budget');
  const before=await readGoalAdmissions(root),oldEntry=JSON.stringify(before.entries[0]),goal=await readNativeGoal(root,f.manifest.id),fields=['max_rounds','max_goals','max_total_operations','max_total_runtime_ms'];
  const stale=structuredClone(goal);stale.manifest.admission.max_rounds=99;assert.equal((await readGoalAdmissionAuthority(root,stale)).grant.max_rounds,1);
  const from=Object.fromEntries(fields.map(k=>[k,goal.manifest.admission[k]])),approval={schema_version:'workkeel.admission-extension/v1',goal_id:goal.id,manifest_sha256:goal.manifest_sha256,from,to:{max_rounds:5,max_goals:5,max_total_operations:480,max_total_runtime_ms:600000},reevaluate_unchanged_sources:true,reason:'Explicit synthetic total five including the spent round'};
  await fs.writeFile(root+'/docs/extension.json',JSON.stringify(approval)+'\n');git(root,'add','docs/extension.json');git(root,'commit','-qm','Approve synthetic extra discovery capacity');
  const contract=structuredClone((await readNativeTask(root,'WK-source')).contract);contract.id='WK-extend';contract.environment.write_paths=['.ai-org/autonomy'];contract.environment.data.policy_refs.push('docs/extension.json');
  await createNativeTask(root,contract,{actor,operation_id:'create-extension-task',expected_version:0});await mutateNativeTask(root,contract.id,'claim',{actor,operation_id:'claim-extension-task',expected_version:1,base_revision:git(root,'rev-parse','HEAD')});
  const task=await readNativeTask(root,contract.id),request={actor,task_id:task.id,claim_id:task.claim.id,contract_sha256:task.contract_sha256,operation_id:'extend-five',expected_version:before.version,approval_ref:'docs/extension.json'};
  await assert.rejects(extendGoalAdmission(root,{...request,actor:reviewer}),/operator|actor|claim/);
  await assert.rejects(extendGoalAdmission(root,{...request,expected_version:before.version+1}),/version/);
  assert.equal((await readGoalAdmissions(root)).version,before.version);
  const mutable=structuredClone(request),pending=extendGoalAdmission(root,mutable);mutable.approval_ref='docs/approval.md';const extended=await pending;
  assert.equal(extended.grant.max_rounds,5);assert.equal((await extendGoalAdmission(root,request)).replayed,true);assert.equal((await readGoalAdmissions(root)).version,extended.version);
  await assert.rejects(extendGoalAdmission(root,{...request,expected_version:extended.version}),/replay conflict/);
  assert.equal(JSON.stringify((await readGoalAdmissions(root)).entries[0]),oldEntry);assert.equal((await readNativeGoal(root,goal.id)).manifest_sha256,goal.manifest_sha256);
  const revision=git(root,'rev-parse','HEAD'),evidence=['docs/extension.json'];
  await mutateNativeTask(root,task.id,'handoff',{actor,operation_id:'handoff-extension',expected_version:2,claim_id:task.claim.id,revision,summary:'Synthetic authorized configuration',evidence,unresolved:[]});
  await mutateNativeTask(root,task.id,'review',{actor:reviewer,operation_id:'review-extension',expected_version:3,revision,judgment:'pass',summary:'Synthetic distinct authority fixture',evidence});
  await mutateNativeTask(root,task.id,'close',{actor,operation_id:'close-extension',expected_version:4,revision,summary:'Synthetic configuration accepted',rollback:'Explicit reviewed follow-up',evidence});
  assert.equal((await readGoalAdmissionAuthority(root,goal)).grant.max_rounds,5);assert.equal((await extendGoalAdmission(root,request)).replayed,true);
  const policy={...f.policy,discovery:{...f.policy.discovery,max_rounds:5}};
  await mutateAutonomy(root,'policy',{...f.request,goal_id:goal.id,operation_id:'use-five',expected_version:(await readAutonomy(root)).version,policy});
  const hooks=createWorkspaceHooks({goalAdapter:f.adapter});try{const view=await hooks.autonomy.read({project:{task_root:root},actor});assert.equal(view.available_goals[0].grant.max_rounds,5);}finally{hooks.autonomy.close();}
  assert.equal((await settle()).idle,'unchanged-approved-sources');assert.equal((await readGoalAdmissions(root)).entries.length,2);
  const count=f.calls.length;assert.equal((await settle()).idle,'unchanged-approved-sources');assert.equal(f.calls.length,count);
  for(let round=3;round<=5;round++){await fs.appendFile(root+'/src/value.mjs','// actual synthetic source event '+round+'\n');git(root,'add','src/value.mjs');git(root,'commit','-qm','Synthetic approved source event '+round);assert.equal((await settle()).idle,round===5?'discovery-round-budget':'unchanged-approved-sources');}
  const after=await readGoalAdmissions(root);assert.equal(after.entries.length,5);assert.equal(JSON.stringify(after.entries[0]),oldEntry);
  for(const entry of after.entries.slice(1)){assert.equal(entry.intent.receipt.extension_sha256,extended.extension_sha256);assert.equal(entry.intent.receipt.continuation_sha256,extended.continuation_sha256);const child=await readNativeGoal(root,entry.intent.manifest.id);assert.ok(child.accepted||child.state==='done'&&child.integration);assert.equal(child.authority_status,'current');}
  const finalCalls=f.calls.length;await fs.appendFile(root+'/src/value.mjs','// cannot renew five\n');assert.equal((await settle()).idle,'discovery-round-budget');assert.equal(f.calls.length,finalCalls);
  await fs.appendFile(root+'/docs/extension.json',' ');await assert.rejects(readGoalAdmissionAuthority(root,goal),/approval source changed/);await assert.rejects(runImprovementCycle(root,{adapter:f.adapter}),/approval source changed/);
  await mutateAutonomy(root,'pause',{...f.request,goal_id:goal.id,operation_id:'stop-after-extension-drift',expected_version:(await readAutonomy(root)).version});assert.equal((await runImprovementCycle(root,{adapter:f.adapter})).idle,'improvement-disabled');
});

test('settled cancellation retains spent discovery and cannot starve new source events or retry unchanged input',async t=>{
  const f=await fixture(t,{empty:true});await runImprovementCycle(f.root,{adapter:f.adapter});
  const before=await readGoalAdmissions(f.root),child=await readNativeGoal(f.root,before.entries[0].intent.manifest.id);
  await controlNativeGoal(f.root,child.id,'cancel',{actor,operation_id:'stop-exact-discovery',expected_version:child.version});
  assert.equal((await runImprovementCycle(f.root,{adapter:f.adapter})).idle,'derived-goal-needs-attention');
  for(let n=0;n<8&&(await readNativeGoal(f.root,child.id)).state!=='cancelled';n++)await runNativeGoalStep(f.root,child.id,{adapter:f.adapter});
  assert.equal((await readNativeGoal(f.root,child.id)).state,'cancelled');assert.equal(f.calls.length,0);
  assert.equal((await runImprovementCycle(f.root,{adapter:f.adapter})).idle,'unchanged-approved-sources');assert.deepEqual((await readGoalAdmissions(f.root)).entries,before.entries);
  await fs.appendFile(f.root+'/src/value.mjs','// distinct approved event\n');git(f.root,'add','src/value.mjs');git(f.root,'commit','-qm','Synthetic source event');
  assert.equal((await runImprovementCycle(f.root,{adapter:f.adapter})).progressed,true);assert.equal((await readGoalAdmissions(f.root)).entries.length,2);assert.equal(f.calls.length,0);
});

test('automatic admission rejects widening, unknown risk and missing outcomes, and stops on approval drift',async t=>{
  const f=await fixture(t,{empty:true}),evidence={path:'src/value.mjs',sha256:(await readTaskFile(f.root,'src/value.mjs')).bytes_digest};
  const proposal={id:'bounded-one',title:'Specific observed defect',direction:'quality',risk_tier:'standard',expected_benefit:'Correct observed result',acceptance:['Exact behavior changes with unchanged interfaces'],evidence:[evidence],scope:{read_paths:['.'],write_paths:['src']},budget:{max_attempts:2,max_runtime_ms:50000,max_cost_usd:null}};
  const request={goal_id:f.manifest.id,actor,operation_id:'reject-bounds',expected_version:0,proposal_id:proposal.id};
  await assert.rejects(admitGoalImprovement(f.root,request,{proposal:{...proposal,risk_tier:'unknown'}}),/assessed/);
  await assert.rejects(admitGoalImprovement(f.root,request,{proposal:{...proposal,acceptance:[]}}),/bounded array/);
  await assert.rejects(admitGoalImprovement(f.root,request,{proposal:{...proposal,scope:{...proposal.scope,write_paths:['.']}}}),/standing scope/);
  await assert.rejects(admitGoalImprovement(f.root,{...request,actor:reviewer},{proposal}),/original actor/);
  assert.equal((await readGoalAdmissions(f.root)).entries.length,0);assert.equal(f.calls.length,0);
  await fs.appendFile(f.root+'/docs/approval.md','Unauthorized drift');await assert.rejects(runImprovementCycle(f.root,{adapter:f.adapter}),/authority source changed/);
  const state=await readAutonomy(f.root);await mutateAutonomy(f.root,'policy',{...f.request,goal_id:f.manifest.id,operation_id:'disable-after-drift',expected_version:state.version,policy:{...f.policy,enabled:false}});assert.equal((await runImprovementCycle(f.root,{adapter:f.adapter})).idle,'improvement-disabled');
});

test('partial native intake reconciles frozen IDs and reserved budgets instead of creating duplicate tasks',async t=>{
  const f=await fixture(t,{empty:true}),evidence={path:'src/value.mjs',sha256:(await readTaskFile(f.root,'src/value.mjs')).bytes_digest};
  const proposal={id:'recover-one',title:'Specific recovery fixture',direction:'quality',risk_tier:'standard',expected_benefit:'Improved exact result',acceptance:['Exact repaired result verified'],evidence:[evidence],scope:{read_paths:['.'],write_paths:['src']},budget:{max_attempts:2,max_runtime_ms:50000,max_cost_usd:null}};
  const problem=executionDigest({direction:proposal.direction,title:proposal.title,scope:proposal.scope,paths:['src/value.mjs']}),derivedId='improve-'+executionDigest({goal_id:f.manifest.id,kind:'execution',problem}).slice(0,24),location=f.root+'/.ai-org/goals/'+derivedId;
  const foreign=await fs.mkdtemp(path.join(os.tmpdir(),'workkeel-denied-intake-'));t.after(()=>fs.rm(foreign,{recursive:true,force:true}));await fs.symlink(foreign,location);
  const request={goal_id:f.manifest.id,actor,operation_id:'recover-intake',expected_version:0,proposal_id:proposal.id};await assert.rejects(admitGoalImprovement(f.root,request,{proposal}),/directory|symlink/);
  const before=await readGoalAdmissions(f.root);assert.equal(before.entries.length,1);assert.equal(before.entries[0].status,'recovery-required');const taskBefore=await readNativeTask(f.root,before.entries[0].intent.product.id);
  await fs.unlink(location);const result=await reconcileGoalAdmission(f.root,{admission_id:before.entries[0].id,actor});assert.equal(result.goal_id,derivedId);assert.equal((await readNativeTask(f.root,taskBefore.id)).version,taskBefore.version);assert.equal((await readGoalAdmissions(f.root)).entries.length,1);
  const replay=await admitGoalImprovement(f.root,request,{proposal});assert.equal(replay.replayed,true);assert.equal((await readGoalAdmissions(f.root)).entries.length,1);assert.equal(f.calls.length,0);
});

test('derived execution rechecks cancelled parent authority while its original operator can still cancel through UI hooks',async t=>{
  const f=await fixture(t,{empty:true});await runImprovementCycle(f.root,{adapter:f.adapter});const entry=(await readGoalAdmissions(f.root)).entries[0],before=await readNativeGoal(f.root,entry.intent.manifest.id);
  const sourceController=await readNativeTask(f.root,f.request.task_id);await mutateNativeTask(f.root,sourceController.id,'cancel',{operation_id:'revoke-parent-coordination',expected_version:sourceController.version,actor,summary:'Explicitly revoke original standing task authority',evidence:['docs/approval.md']});
  await assert.rejects(runNativeGoalStep(f.root,before.id,{adapter:f.adapter}),/authority changed or cancelled/);assert.equal(f.calls.length,0);
  const hooks=createWorkspaceHooks({goalAdapter:f.adapter});t.after(()=>hooks.goals.close());
  const result=await hooks.goals.execute({project:{task_root:f.root},actor,action:'goals.cancel',expectedVersion:before.version,idempotencyKey:'stop-derived-after-grant-drift',payload:{goal_id:before.id}});assert.equal(result.goal.state,'cancel-requested');
  for(let n=0;n<100&&(await readNativeGoal(f.root,before.id)).state!=='cancelled';n++)await new Promise(r=>setTimeout(r,10));assert.equal((await readNativeGoal(f.root,before.id)).state,'cancelled');assert.equal(f.calls.length,0);
  assert.equal((await readNativeTask(f.root,entry.intent.product.id)).state,'cancelled');
});

test('one registered project routes equal goal IDs to their exact repository without changing the primary store',async t=>{
  const first=await fixture(t,{empty:true}),second=await fixture(t,{empty:true}),hooks=createWorkspaceHooks({goalAdapter:first.adapter});t.after(()=>hooks.goals.close());
  const project={id:'suite',task_root:first.root,repositories:[{id:'primary',path:first.root,scope:'.'},{id:'secondary',path:second.root,scope:'.'}]},view=await hooks.goals.read({project,actor});assert.equal(view.entries.filter(g=>g.id==='source-goal').length,2);assert.equal(view.services.length,2);
  const primary=await readNativeGoal(first.root,'source-goal'),foreign=await readNativeGoal(second.root,'source-goal');
  await assert.rejects(hooks.goals.execute({project,actor,action:'goals.pause',expectedVersion:foreign.version,idempotencyKey:'deny-unregistered',payload:{goal_id:'source-goal',repo_id:'arbitrary'}}),/explicitly registered/);
  await hooks.goals.execute({project,actor,action:'goals.pause',expectedVersion:foreign.version,idempotencyKey:'foreign-goal-control',payload:{goal_id:'source-goal',repo_id:'secondary'}});
  assert.equal((await readNativeGoal(first.root,'source-goal')).version,primary.version);assert.equal((await readNativeGoal(second.root,'source-goal')).version,foreign.version+1);
});
