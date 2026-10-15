import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {initializeTaskProject} from '../src/workkeel-project.mjs';
import {createNativeTask,readNativeTask,mutateNativeTask} from '../src/workkeel-tasks.mjs';
import {createNativeGoal,readNativeGoal,runNativeGoalStep,createTrustedGoalAdapter} from '../src/workkeel-goals.mjs';
import {readTaskFile} from '../src/task-contract.mjs';
import {executionDigest} from '../src/workkeel-execution-policy.mjs';
import {mutateAutonomy,readAutonomy,runAutonomyStep,serveAutonomy} from '../src/workkeel-autonomy.mjs';
import {readGoalAdmissions,admitGoalImprovement,reconcileGoalAdmission} from '../src/workkeel-autonomy-admission.mjs';
import {runImprovementCycle} from '../src/workkeel-improvement-cycle.mjs';
import {createWorkspaceHooks} from '../src/workkeel-workspace-hooks.mjs';
import {inventoryRetention} from '../src/workkeel-retention.mjs';

const actor={agent_id:'builder',principal_id:'owner'},reviewer={agent_id:'reviewer',principal_id:'owner'};
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const tuple={provider:'openai',model:'synthetic-only',reasoning:'high',service:'provider-default'};
async function fixture(t,{risk='standard',maxGoals=8,empty=false}={}){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'workkeel-improvement-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(root+'/src');await fs.mkdir(root+'/docs');git(root,'init','-q');git(root,'config','user.name','Synthetic');git(root,'config','user.email','fixture@example.invalid');
  await fs.writeFile(root+'/.gitignore','.ai-org/\n');await fs.writeFile(root+'/docs/approval.md','Synthetic explicit bounded source/goal/improvement approval.');await fs.writeFile(root+'/src/value.mjs','export const value="baseline";\n');
  await initializeTaskProject(root,{schema_version:'workkeel.task-policy/v1',principals:['owner'],agents:[actor,reviewer],approvers:['owner'],review_separation:'distinct-agent'});
  const template={schema_version:'workkeel.improvement-template/v1',id:'template-one',source_component_id:'source',title_prefix:'Improve',acceptance:['Syntax remains valid'],include:['src/value.mjs'],exclude:['Publication']};await fs.writeFile(root+'/docs/template.json',JSON.stringify(template)+'\n');
  git(root,'add','.');git(root,'commit','-qm','Synthetic baseline');
  const contract={schema_version:'workkeel.task-contract/v1',id:'WK-source',goal:'Synthetic source',actor,state:'intake',scope:{include:['src'],exclude:['Publication']},dependencies:[],acceptance:{criteria:['Verified source'],evidence:[]},verification:{risk_tier:'standard',separation:'distinct-agent',implementer:null,reviewer:null,candidate_revision:null},handoff:null,environment:{cwd:'.',read_paths:['.'],write_paths:['src'],tools:['node','git'],resources:[],network:{mode:'none',hosts:[]},external_actions:[],data:{classification:'internal',model_access:'none',policy_refs:['docs/approval.md','docs/template.json']}},authorization:{approved_by:'owner',approval_ref:'docs/approval.md',operations:['read','write','execute'],expires_at:null},execution:{runtime:{kind:'host-owned',adapter_id:null,required_features:[]},model_connection:{kind:'native'}},skills:[],legacy:null};
  await createNativeTask(root,contract,{operation_id:'intake-source',expected_version:0,actor});const sourceTask=await readNativeTask(root,contract.id);
  const grant={enabled:true,directions:['quality'],read_paths:['.'],write_paths:['src'],template_ref:'docs/template.json',source_refs:['src/value.mjs'],max_source_bytes:65536,max_rounds:2,cooldown_ms:0,max_goals:maxGoals,max_total_operations:320,max_total_runtime_ms:400000,max_total_cost_usd:null,max_reworks:1,max_operations:40,max_attempts:2,max_runtime_ms:50000,max_cost_usd:null};
  const manifest={schema_version:'workkeel.goal/v1',id:'source-goal',title:'Synthetic accepted source',approval_ref:'docs/approval.md',approved_by:actor,expires_at:null,components:[{id:'source',project_id:'project',repo_id:'repo',root,task_id:contract.id,contract_sha256:sourceTask.contract_sha256,depends_on:[],checks:[{id:'syntax',command:'node',args:['--check','src/value.mjs']}],rollback:'Governed revert to baseline',interface_refs:['src/value.mjs']}],integration:{component_id:'source',criteria:['Verified source']},roles:{implementer:actor,reviewer,approver:actor},models:Object.fromEntries(['planning','implementation','verification','repair','review'].map(p=>[p,tuple])),limits:{max_operations:40,max_reworks:1,timeout_ms:50000,max_cost_usd:null},control:{release_parent:true},admission:grant};
  await fs.writeFile(root+'/docs/goal.json',JSON.stringify(manifest)+'\n');git(root,'add','.');git(root,'commit','-qm','Approve exact synthetic standing goal');
  const controller={...structuredClone(contract),id:'WK-controller',environment:{...contract.environment,write_paths:['.'],data:{...contract.environment.data,policy_refs:[...contract.environment.data.policy_refs,'docs/goal.json']}}};
  await createNativeTask(root,controller,{operation_id:'intake-controller',expected_version:0,actor});await mutateNativeTask(root,controller.id,'claim',{operation_id:'claim-controller',expected_version:1,actor,base_revision:git(root,'rev-parse','HEAD')});
  const control=await readNativeTask(root,controller.id),request={task_id:control.id,actor,claim_id:control.claim.id,contract_sha256:control.contract_sha256,operation_id:'create-goal',expected_version:0,manifest_ref:'docs/goal.json'};await createNativeGoal(root,request);
  const calls=[],receipts=new Map(),reviews=new Map();
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
    if(phase==='verification'){execFileSync(process.execPath,['--check',root+'/src/value.mjs']);result.candidate_revision=ctx.input.candidate;result.checks=[{id:'syntax',status:'pass'}];const pin=await artifact(ctx,phase,{synthetic:true,candidate:ctx.input.candidate});result.evidence=[pin.path];result.integration_pin=await artifact(ctx,'integration',{schema_version:'workkeel.goal-integration/v1',manifest_sha256:ctx.manifest_sha256,required_components:ctx.input.required_components,components:ctx.input.accepted_components,candidate_set_sha256:executionDigest(ctx.input.accepted_components),integration_candidate:ctx.input.candidate,checks:result.checks});result.evidence.push(result.integration_pin.path);}
    if(phase==='review'){const count=reviews.get(ctx.task.id)??0;reviews.set(ctx.task.id,count+1);const proof='.ai-org/artifacts/'+ctx.task.id+'/review-'+ctx.operation_id+'.json',judgment=!discovery&&ctx.manifest.id!=='source-goal'&&count===0?'fail':'pass';const native_request={operation_id:ctx.operation_id,expected_version:ctx.task.version,actor:reviewer,revision:ctx.input.candidate,judgment,summary:judgment==='fail'?'Synthetic actual reviewer rejects defective value':'Synthetic distinct reviewer verifies exact candidate',evidence:[...ctx.input.verification.evidence,proof]};result.authored_request_pin=await artifact(ctx,'review',{schema_version:'workkeel.goal-authored-review/v1',actor:reviewer,thread_id:thread,operation_id:ctx.operation_id,product_access:'read',runtime_selection:ctx.input.model,native_request});await mutateNativeTask(root,ctx.task.id,'review',native_request);}
    receipts.set(ctx.operation_id,result);return result;
  }});
  for(let n=0;n<30&&!(await readNativeGoal(root,manifest.id)).accepted;n++)await runNativeGoalStep(root,manifest.id,{adapter});assert.equal((await readNativeGoal(root,manifest.id)).accepted,true);
  delete request.manifest_ref;
  const policy={enabled:true,directions:['quality'],max_jobs:20,max_attempts:2,cooldown_ms:0,admission:{enabled:true,goal_id:manifest.id},discovery:{enabled:true,read_paths:['.'],write_paths:['src'],max_proposals:10,max_source_bytes:65536,max_rounds:2,cooldown_ms:0,max_runtime_ms:50000,max_cost_usd:null}};
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

test('high-risk suggestions remain proposals and cumulative standing goal budget prevents extra inference',async t=>{
  const f=await fixture(t,{risk:'high',maxGoals:1});let result;for(let n=0;n<30;n++){result=await runImprovementCycle(f.root,{adapter:f.adapter});if(result.idle==='unchanged-approved-sources')break;}assert.equal(result.manual_proposals,1);assert.equal((await readGoalAdmissions(f.root)).entries.length,1);const before=f.calls.length;await fs.appendFile(f.root+'/src/value.mjs','// changed\n');assert.equal((await runImprovementCycle(f.root,{adapter:f.adapter})).idle,'standing-budget-or-cooldown');assert.equal(f.calls.length,before);
});

test('event driver progresses native derived goals without a human continue and stops cleanly',async t=>{
  const f=await fixture(t,{empty:true});const errors=[],controller=new AbortController();const workflow={id:'unused-workflow',idempotent:true,start:async()=>({status:'unknown'}),reconcile:async()=>({status:'unknown'}),cancel:async()=>({status:'cancelled'})};
  const service=await serveAutonomy(f.root,{adapter:workflow,goalAdapter:f.adapter,signal:controller.signal,debounce_ms:1,reconcile_ms:20,onError:e=>errors.push(e)});t.after(()=>{controller.abort();service.close();});
  for(let n=0;n<200;n++){const entries=(await readGoalAdmissions(f.root)).entries;if(entries[0]?.status==='created'&&(await readNativeGoal(f.root,entries[0].intent.manifest.id)).accepted)break;await new Promise(r=>setTimeout(r,10));}
  const entry=(await readGoalAdmissions(f.root)).entries[0];assert.ok(entry);assert.equal((await readNativeGoal(f.root,entry.intent.manifest.id)).accepted,true);assert.deepEqual(errors,[]);controller.abort();service.close();
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
