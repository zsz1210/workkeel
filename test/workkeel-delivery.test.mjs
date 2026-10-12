import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {initializeTaskProject} from '../src/workkeel-project.mjs';
import {previewTaskIntake,applyTaskIntake} from '../src/workkeel-intake.mjs';
import {readNativeTask,mutateNativeTask} from '../src/workkeel-tasks.mjs';
import {prepareDispatchTicket} from '../src/workkeel-dispatch.mjs';
import {readDeliveryContext,attachDelivery,finishDelivery,checkDeliveryReports,readDeliveryReview} from '../scripts/workkeel-delivery.mjs';

async function fixture(t,{activity_kind='implementation'}={}) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'workkeel-delivery-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  const actor={agent_id:'builder',principal_id:'owner'};
  await initializeTaskProject(root,{schema_version:'workkeel.task-policy/v1',principals:['owner'],agents:[actor,{agent_id:'reviewer',principal_id:'owner'}],approvers:['owner'],review_separation:'distinct-agent'});
  await fs.mkdir(root+'/docs');await fs.mkdir(root+'/src');await fs.writeFile(root+'/docs/approval.md','Approved offline fixture.');
  const policy={schema_version:'workkeel.dispatch-policy/v1',models:[{alias:'fixture',provider:'local',model:'requested-model',reasoning:null,data_classes:['internal']}],default_alias:'fixture',conservative_alias:'fixture',parallelism:1};
  await fs.writeFile(root+'/docs/dispatch.json',JSON.stringify(policy));git('add','.');git('commit','-qm','Fixture');
  const brief={schema_version:'workkeel.task-brief/v1',id:'WK-delivery',goal:'Bounded delivery fixture',actor,acceptance:['Preserve exact scope and unknown measurements'],
    environment:{cwd:'.',read_paths:['src','docs'],write_paths:['src'],tools:['node'],resources:[],network:{mode:'none',hosts:[]},external_actions:[],data:{classification:'internal',model_access:'approved-connection',policy_refs:['docs/approval.md','docs/dispatch.json']}},
    authorization:{approved_by:'owner',approval_ref:'docs/approval.md',operations:['read','write','execute'],expires_at:null}};
  const preview=await previewTaskIntake(root,brief);await applyTaskIntake(root,brief,preview.fingerprint);
  await mutateNativeTask(root,brief.id,'claim',{operation_id:'claim',expected_version:1,actor,base_revision:git('rev-parse','HEAD')});
  const task=await readNativeTask(root,brief.id);
  const ticket=await prepareDispatchTicket(root,{task_id:task.id,actor,claim_id:task.claim.id,contract_sha256:task.contract_sha256,policy_ref:'docs/dispatch.json',
    node:{id:activity_kind,activity_kind,depends_on:[],read_paths:['src'],write_paths:activity_kind==='review'?[]:['src']},
    capabilities:{host:'fixture',models:[{provider:'local',model:'requested-model',reasoning:[null]}]},operation_id:'dispatch'});
  const execution_id=ticket.execution_id;
  const host=()=>attachDelivery(root,{execution_id,source:{kind:'host-report',thread_id:'fixture-thread',turn_id:'fixture-turn'},sample_kind:'fixture'});
  const report=()=>({report_id:'final',status:'completed',usage:{input_tokens:0,output_tokens:0},tool:'fixture',observed_at:new Date().toISOString()});
  const binding=()=>fs.readFile(`${root}/.ai-org/host-usage/${execution_id}/binding.json`,'utf8');
  return {root,task,ticket,actor,execution_id,host,report,binding,git};
}

test('context is read-only, retains full scope and criteria, and exposes evidence warnings without bodies/history',async t=>{
  const f=await fixture(t),before=await readNativeTask(f.root,f.task.id);
  const context=await readDeliveryContext(f.root,f.task.id);
  assert.deepEqual(context.scope,f.task.contract.scope);
  assert.deepEqual(context.acceptance_criteria,f.task.contract.acceptance.criteria);
  assert.equal(context.authority,'observation-only');assert.equal(context.execution_authorized,false);
  assert.equal(context.mutation_status,'no-write');assert.equal(context.timeline,undefined);
  assert.equal(context.evidence.every(e=>e.status==='verified'),true);
  assert.equal(JSON.stringify(context).includes('Approved offline fixture.'),false);
  await fs.writeFile(f.root+'/docs/approval.md','Changed authority evidence');
  const warning=await readDeliveryContext(f.root,f.task.id);
  assert.ok(warning.attention_reasons.includes('evidence-unavailable'));
  assert.ok(warning.evidence.some(e=>e.status==='changed'));
  assert.match(warning.next_action,/exact recorded evidence/);
  assert.deepEqual(await readNativeTask(f.root,f.task.id),before);
});

test('host reports preserve zero, unknown model and active time, replay exactly and reject overrides',async t=>{
  const f=await fixture(t),attached=await f.host();
  assert.equal(attached.usage.input_tokens,null);assert.equal(attached.operation_completed,false);
  const request={execution_id:f.execution_id,report:f.report()};
  const receipt=await finishDelivery(f.root,request),saved=await f.binding();
  assert.equal(receipt.usage.input_tokens,0);assert.equal(receipt.usage.total_tokens,null);
  assert.equal(receipt.model,null);assert.equal(receipt.requested_model,'requested-model');
  assert.equal(receipt.active_duration_ms,null);assert.equal(receipt.turn_duration_ms,null);
  assert.equal(receipt.operation_completed,true);assert.equal(receipt.task_coverage_complete,false);
  assert.equal(receipt.collection_closed,false);assert.equal(receipt.activity_kind,'implementation');
  assert.ok(receipt.missing_fields.includes('model'));assert.ok(!receipt.missing_fields.includes('usage.input_tokens'));
  assert.deepEqual(await finishDelivery(f.root,request),receipt);assert.equal(await f.binding(),saved);
  await assert.rejects(finishDelivery(f.root,{...request,report:{...request.report,model:'invented'}}),/conflict/);
  await assert.rejects(finishDelivery(f.root,{...request,report:{...request.report,actor:f.actor}}),/fields/);
  await assert.rejects(finishDelivery(f.root,{...request,collect:true}),/choose report/);
  await assert.rejects(finishDelivery(f.root,{execution_id:f.execution_id,collect:true}),/source mismatch/);
  assert.equal(await f.binding(),saved);
});

test('explicit actual model remains distinct from requested and active zero requires intervals',async t=>{
  const f=await fixture(t);await f.host();const report=f.report();
  const at=report.observed_at;
  const receipt=await finishDelivery(f.root,{execution_id:f.execution_id,report:{...report,model:'actual-model',provider:'actual-provider',execution_duration_ms:0,execution_intervals:[{started_at:at,completed_at:at}]}});
  assert.equal(receipt.model,'actual-model');assert.equal(receipt.requested_model,'requested-model');
  assert.equal(receipt.selection_match,'mismatch');assert.equal(receipt.active_duration_ms,0);
});

async function rollout(f) {
  const source={kind:'codex-rollout',path:f.root+'/private-source.jsonl',thread_id:'fixture-thread',turn_id:'fixture-turn'};
  const start=Date.parse(f.ticket.created_at)+1,at=n=>new Date(start+n).toISOString();
  const rows=[{type:'session_meta',payload:{id:source.thread_id,model_provider:'local'}},
    {timestamp:at(0),type:'event_msg',payload:{type:'task_started',turn_id:source.turn_id}},
    {timestamp:at(1),type:'turn_context',payload:{turn_id:source.turn_id,model:'actual-model',effort:'medium'}}];
  await fs.writeFile(source.path,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
  await attachDelivery(f.root,{execution_id:f.execution_id,source,capture_turn_from_start:true,approval_ref:'docs/approval.md',sample_kind:'fixture'});
  const append=values=>fs.appendFile(source.path,values.map(r=>JSON.stringify(r)).join('\n')+'\n');
  return {source,at,append};
}

test('exact source collection keeps turn separate, accepts explicit activity and does not freeze a live source',async t=>{
  const f=await fixture(t),r=await rollout(f);
  const request={execution_id:f.execution_id,collect:true};
  const empty=await finishDelivery(f.root,request);assert.equal(empty.operation_completed,false);assert.equal(empty.collection_closed,false);
  const usage={input_tokens:5,output_tokens:2};
  await r.append([{timestamp:r.at(2),type:'token_usage_record',ordinal:1,payload:{thread_id:r.source.thread_id,turn_id:r.source.turn_id,response_id:'response-1',usage,turn_token_usage:usage}},
    {timestamp:r.at(10),type:'event_msg',payload:{type:'task_complete',turn_id:r.source.turn_id,duration_ms:10}}]);
  const before=await f.binding();
  await assert.rejects(finishDelivery(f.root,{...request,activity:{report_id:'activity',observed_at:r.at(10),execution_duration_ms:4,execution_intervals:[{started_at:r.at(2),completed_at:r.at(5)}]}}),/duration-mismatch/);
  await assert.rejects(finishDelivery(f.root,{execution_id:f.execution_id,report:f.report()}),/source mismatch/);
  assert.equal(await f.binding(),before,'invalid requests never collect pending tokens');
  const receipt=await finishDelivery(f.root,request);assert.equal(receipt.usage.input_tokens,5);
  assert.equal(receipt.turn_duration_ms,10);assert.equal(receipt.active_duration_ms,null);
  const activity={report_id:'activity',observed_at:r.at(10),execution_duration_ms:3,execution_intervals:[{started_at:r.at(2),completed_at:r.at(5)}]};
  const measured=await finishDelivery(f.root,{...request,activity});
  assert.equal(measured.active_duration_ms,3);assert.equal(measured.model,'actual-model');
  assert.equal(JSON.stringify(measured).includes(r.source.path),false);
  const saved=await f.binding();assert.deepEqual(await finishDelivery(f.root,{...request,activity}),measured);assert.equal(await f.binding(),saved);
});

test('changed authority and ended claims refuse new host reports before mutation',async t=>{
  const f=await fixture(t);await f.host();const saved=await f.binding();
  await fs.writeFile(f.root+'/docs/approval.md','Changed approval');
  await assert.rejects(finishDelivery(f.root,{execution_id:f.execution_id,report:f.report()}));assert.equal(await f.binding(),saved);
  for(const action of ['release','cancel']) {
    const g=await fixture(t);await g.host();const original=await g.binding();
    await mutateNativeTask(g.root,g.task.id,action,{operation_id:action,expected_version:g.task.version,actor:g.actor,
      ...(action==='release'?{claim_id:g.task.claim.id}:{evidence:['docs/approval.md']}),summary:'Stop fixture'});
    await assert.rejects(finishDelivery(g.root,{execution_id:g.execution_id,report:g.report()}));
    assert.equal(await g.binding(),original);
  }
});

test('pre-bound operations report after handoff while new attachments require an active claim',async t=>{
  const f=await fixture(t);await f.host();
  const proofDir=f.root+'/.ai-org/artifacts/'+f.task.id;
  const proofName=(await fs.readdir(proofDir)).find(n=>n.startsWith('dispatch-claim-'));
  const proofFile=proofDir+'/'+proofName,original=await fs.readFile(proofFile,'utf8');
  const handoff={operation_id:'handoff',expected_version:2,actor:f.actor,claim_id:f.task.claim.id,
    revision:f.git('rev-parse','HEAD'),summary:'Exact candidate handed off',evidence:['docs/approval.md'],unresolved:[]};
  await fs.writeFile(proofFile,original.replace('"build"','"done"'));
  await assert.rejects(mutateNativeTask(f.root,f.task.id,'handoff',handoff),/clean product tree/);
  await fs.writeFile(proofFile,original);
  const wrong=proofDir+'/dispatch-claim-'+('0'.repeat(64))+'.json';
  await fs.writeFile(wrong,original);
  await assert.rejects(mutateNativeTask(f.root,f.task.id,'handoff',handoff),/clean product tree/);
  await fs.unlink(wrong);
  await mutateNativeTask(f.root,f.task.id,'handoff',{operation_id:'handoff',expected_version:2,actor:f.actor,claim_id:f.task.claim.id,
    revision:f.git('rev-parse','HEAD'),summary:'Exact candidate handed off',evidence:['docs/approval.md'],unresolved:[]});
  const receipt=await finishDelivery(f.root,{execution_id:f.execution_id,report:f.report()});
  assert.equal(receipt.operation_completed,true);assert.equal(receipt.task_acceptance,'not-performed');
  await assert.rejects(attachDelivery(f.root,{execution_id:f.execution_id,source:{kind:'host-report',thread_id:'new-thread',turn_id:'new-turn'}}),/matching implementation claim/);
});

test('source failure is explicit after a valid activity observation and never implies completion',async t=>{
  const f=await fixture(t),r=await rollout(f);
  await fs.unlink(r.source.path);
  const result=await finishDelivery(f.root,{execution_id:f.execution_id,collect:true,
    activity:{report_id:'activity',observed_at:r.at(5),execution_duration_ms:2,execution_intervals:[{started_at:r.at(2),completed_at:r.at(4)}]}});
  assert.equal(result.state,'error');assert.equal(result.error_code,'host-source-unavailable');
  assert.equal(result.active_duration_ms,2);assert.equal(result.operation_completed,false);
  assert.equal(result.usage.input_tokens,null);assert.equal(result.collection_closed,false);
  assert.equal(JSON.stringify(result).includes(r.source.path),false);
});

test('CLI bounds JSON and redacts source paths on failure',async t=>{
  const f=await fixture(t),script=new URL('../scripts/workkeel-delivery.mjs',import.meta.url);
  const run=(...args)=>spawnSync(process.execPath,[script.pathname,...args],{encoding:'utf8'});
  const context=run('context',f.root,f.task.id);assert.equal(context.status,0);assert.equal(JSON.parse(context.stdout).task_id,f.task.id);
  const file=f.root+'/oversize.json';await fs.writeFile(file,' '.repeat(65537));
  const oversized=run('finish',f.root,file);assert.equal(oversized.status,1);assert.equal(oversized.stdout,'');assert.equal(oversized.stderr.includes(f.root),false);
  await fs.writeFile(file,JSON.stringify({execution_id:f.execution_id,source:{kind:'codex-rollout',path:f.root+'/missing-private.jsonl',thread_id:'t',turn_id:'t'}}));
  const absent=run('attach',f.root,file);assert.equal(absent.status,1);assert.equal(absent.stderr.includes('missing-private'),false);
  await f.host();const report=f.report();
  await finishDelivery(f.root,{execution_id:f.execution_id,report});
  await fs.writeFile(file,JSON.stringify({execution_id:f.execution_id,report:{...report,model:'different'}}));
  const conflict=run('finish',f.root,file);assert.equal(conflict.status,1);assert.match(conflict.stderr,/host-report-conflict/);
});

const expected=(f,activity_kind='implementation')=>({task_id:f.task.id,expected:[{label:'worker',activity_kind,binding:{kind:'dispatch',id:f.execution_id}}]});

test('expected report check distinguishes absent, prepared, bound, partial and measured zero without writes',async t=>{
  const f=await fixture(t),request=expected(f),taskBefore=await readNativeTask(f.root,f.task.id);
  let result=await checkDeliveryReports(f.root,request);
  assert.equal(result.bindings_ready,false);assert.equal(result.declared_reports_complete,false);
  assert.equal(result.expected_operations[0].status,'missing-binding');
  assert.equal(result.collection.status,'unavailable');assert.equal(result.collection.counts.missing,1);
  await f.host();const before=await f.binding();
  result=await checkDeliveryReports(f.root,request);
  assert.equal(result.bindings_ready,true);assert.equal(result.declared_reports_complete,false);
  assert.ok(result.expected_operations[0].issues.includes('operation-not-completed'));
  assert.equal(result.collection.status,'pending');assert.equal(result.task_state,'build');assert.equal(result.task_locally_accepted,false);
  assert.ok(result.collection.follow_up[0].actions.includes('collect-after-operation-ends'));
  assert.equal(await f.binding(),before);
  await finishDelivery(f.root,{execution_id:f.execution_id,report:{...f.report(),status:'partial'}});
  result=await checkDeliveryReports(f.root,request);
  assert.ok(result.expected_operations[0].issues.includes('missing:active_duration_ms'));
  assert.ok(!result.expected_operations[0].issues.includes('missing:usage.input_tokens'));
  const report={...f.report(),report_id:'with-time'},at=report.observed_at;
  await finishDelivery(f.root,{execution_id:f.execution_id,report:{...report,execution_duration_ms:0,execution_intervals:[{started_at:at,completed_at:at}]}});
  result=await checkDeliveryReports(f.root,request);
  assert.equal(result.declared_reports_complete,true);assert.equal(result.task_coverage_complete,false);
  assert.equal(result.activity_coverage.implementation.status,'reported');
  assert.equal(result.activity_coverage.planning.status,'not-declared');
  assert.equal(result.collection.status,'completed');assert.equal(result.collection.counts.completed,1);
  assert.equal(result.expected_operations[0].receipt.cutoffs.usage_observed_after_activity,false);
  assert.equal(result.coverage,'declared-operations-only');assert.equal(result.expected_operations[0].receipt.active_duration_ms,0);
  assert.equal(result.expected_operations[0].receipt.usage.total_tokens,null);
  assert.deepEqual(await readNativeTask(f.root,f.task.id),taskBefore);
  result=await checkDeliveryReports(f.root,{...request,expected:[...request.expected,{label:'coordinator',activity_kind:'planning',binding:null},{label:'repair',activity_kind:'repair',binding:null}]});
  assert.equal(result.declared_reports_complete,false);assert.equal(result.expected_operations.length,3);
  assert.equal(result.activity_coverage.planning.status,'incomplete');assert.equal(result.activity_coverage.planning.reported,0);
});

test('report check rejects duplicate/oversized expectations and exposes activity mismatch and corrupt inventory',async t=>{
  const f=await fixture(t),request=expected(f);await f.host();
  await assert.rejects(checkDeliveryReports(f.root,{...request,expected:[]}),/expected operations/);
  await assert.rejects(checkDeliveryReports(f.root,{...request,expected:Array(65).fill(request.expected[0])}),/expected operations/);
  await assert.rejects(checkDeliveryReports(f.root,{...request,expected:[request.expected[0],{...request.expected[0],label:'copy'}]}),/duplicate/);
  await assert.rejects(checkDeliveryReports(f.root,{...request,expected:[{...request.expected[0],binding:{kind:'host',id:'../private'}}]}),/invalid/);
  let result=await checkDeliveryReports(f.root,expected(f,'review'));
  assert.equal(result.bindings_ready,false);assert.equal(result.expected_operations[0].status,'unavailable');
  result=await checkDeliveryReports(f.root,{...request,expected:[{...request.expected[0],binding:{kind:'host',id:f.execution_id}}]});
  assert.equal(result.bindings_ready,false);assert.ok(result.expected_operations[0].issues.includes('binding-kind-mismatch'));
  assert.equal(result.collection.status,'unavailable');assert.equal(result.collection.counts.unavailable,1);
  result=await checkDeliveryReports(f.root,{...request,expected:[{label:'missing',activity_kind:'repair',binding:null}]});
  assert.equal(result.unlisted_binding_count,1);
  await fs.writeFile(`${f.root}/.ai-org/host-usage/${f.execution_id}/measurement.json`,'{}');
  result=await checkDeliveryReports(f.root,request);
  assert.equal(result.declared_reports_complete,false);assert.equal(result.inventory_errors.length,1);
  assert.equal(result.collection.status,'unavailable');
  assert.equal(JSON.stringify(result).includes(f.root),false);
});

test('report check supports coordinator host bindings without a dispatch ticket and preserves missing tokens',async t=>{
  const f=await fixture(t);
  const {bindHostUsage,reportHostUsage}=await import('../src/workkeel-host-usage.mjs');
  const identity={task_id:f.task.id,actor:f.actor,claim_id:f.task.claim.id,contract_sha256:f.task.contract_sha256};
  await bindHostUsage(f.root,{...identity,binding_id:'coordinator',source:{kind:'host-report',thread_id:'coordinator',turn_id:'current-task'}});
  const {task_id,...reportIdentity}=identity;
  const at=new Date().toISOString();
  await reportHostUsage(f.root,{...reportIdentity,binding_id:'coordinator',report_id:'final',status:'completed',tool:'host',usage:{},observed_at:at,activity_kind:'planning',execution_duration_ms:0,execution_intervals:[{started_at:at,completed_at:at}]});
  const result=await checkDeliveryReports(f.root,{task_id,expected:[{label:'coordinator',activity_kind:'planning',binding:{kind:'host',id:'coordinator'}}]});
  assert.equal(result.bindings_ready,true);assert.equal(result.declared_reports_complete,false);
  assert.ok(result.expected_operations[0].issues.includes('missing:usage.input_tokens'));
  assert.equal(result.expected_operations[0].receipt.active_duration_ms,0);
  assert.equal(result.collection.status,'completed');
  assert.equal(result.expected_operations[0].receipt.cutoffs.usage_observed_at,null);
  assert.equal(result.expected_operations[0].receipt.cutoffs.usage_observed_after_activity,null);
});

test('accepted task and pending measurement remain separate, and checking never collects the source',async t=>{
  const f=await fixture(t);await f.host();
  const revision=f.git('rev-parse','HEAD');
  await mutateNativeTask(f.root,f.task.id,'handoff',{operation_id:'handoff',expected_version:2,actor:f.actor,claim_id:f.task.claim.id,revision,summary:'Fixture delivery',evidence:['docs/approval.md'],unresolved:[]});
  await mutateNativeTask(f.root,f.task.id,'review',{operation_id:'review',expected_version:3,actor:{agent_id:'reviewer',principal_id:'owner'},revision,judgment:'pass',summary:'Independent fixture',evidence:['docs/approval.md']});
  await mutateNativeTask(f.root,f.task.id,'close',{operation_id:'close',expected_version:4,actor:f.actor,revision,summary:'Accepted; source still pending',rollback:'Revert fixture',evidence:['docs/approval.md']});
  const before=await f.binding(),taskBefore=await readNativeTask(f.root,f.task.id);
  const result=await checkDeliveryReports(f.root,expected(f));
  assert.equal(result.task_state,'done');assert.equal(result.task_locally_accepted,true);
  assert.equal(result.collection.status,'pending');assert.equal(result.declared_reports_complete,false);
  assert.equal(await f.binding(),before);assert.deepEqual(await readNativeTask(f.root,f.task.id),taskBefore);
});

test('late token observation preserves the original activity cutoff and explicit collection stop',async t=>{
  const f=await fixture(t),r=await rollout(f);
  await r.append([{timestamp:r.at(2),type:'token_usage_record',ordinal:1,payload:{thread_id:r.source.thread_id,turn_id:r.source.turn_id,response_id:'first',usage:{input_tokens:5,output_tokens:2},turn_token_usage:{input_tokens:5,output_tokens:2}}}]);
  const activity={report_id:'activity',observed_at:r.at(10),execution_duration_ms:3,execution_intervals:[{started_at:r.at(2),completed_at:r.at(5)}]};
  const first=await finishDelivery(f.root,{execution_id:f.execution_id,collect:true,activity});
  assert.equal(first.collection_status,'pending');assert.equal(first.cutoffs.usage_observed_after_activity,false);
  await r.append([{timestamp:r.at(20),type:'token_usage_record',ordinal:2,payload:{thread_id:r.source.thread_id,turn_id:r.source.turn_id,response_id:'late',usage:{input_tokens:3,output_tokens:1},turn_token_usage:{input_tokens:8,output_tokens:3}}},
    {timestamp:r.at(30),type:'event_msg',payload:{type:'task_complete',turn_id:r.source.turn_id,duration_ms:30}}]);
  const saved=await f.binding(),stale=await checkDeliveryReports(f.root,expected(f));
  assert.equal(stale.collection.status,'pending');assert.equal(await f.binding(),saved);
  const last=await finishDelivery(f.root,{execution_id:f.execution_id,collect:true});
  assert.equal(last.collection_status,'completed');assert.equal(last.active_duration_ms,3);
  assert.equal(last.cutoffs.activity_ended_at,r.at(5));assert.equal(last.cutoffs.usage_observed_at,r.at(20));
  assert.equal(last.cutoffs.usage_observed_after_activity,true);assert.ok(last.cutoffs.collected_at);
  let check=await checkDeliveryReports(f.root,expected(f));
  assert.ok(check.collection.follow_up[0].actions.includes('keep-usage-and-activity-cutoffs-separate'));
  assert.equal(check.declared_reports_complete,true);
  const {closeHostUsage}=await import('../src/workkeel-host-usage.mjs');
  await closeHostUsage(f.root,{binding_id:f.execution_id,actor:f.actor});
  check=await checkDeliveryReports(f.root,expected(f));
  assert.equal(check.collection.status,'stopped');assert.equal(check.declared_reports_complete,true);
  assert.equal(JSON.stringify(check).includes(r.source.path),false);
});

test('terminal interruption completes collection without success; source failure remains unavailable',async t=>{
  const f=await fixture(t),r=await rollout(f);
  await r.append([{timestamp:r.at(4),type:'event_msg',payload:{type:'turn_aborted',turn_id:r.source.turn_id}}]);
  const receipt=await finishDelivery(f.root,{execution_id:f.execution_id,collect:true});
  assert.equal(receipt.state,'interrupted');assert.equal(receipt.collection_status,'completed');
  assert.equal(receipt.operation_completed,false);assert.equal(receipt.cutoffs.usage_observed_at,null);
  let check=await checkDeliveryReports(f.root,expected(f));
  assert.equal(check.declared_reports_complete,false);assert.equal(check.collection.status,'completed');
  assert.ok(check.collection.follow_up[0].actions.includes('preserve-unsuccessful-outcome'));
  await fs.rename(r.source.path,r.source.path+'.moved');
  const unavailable=await finishDelivery(f.root,{execution_id:f.execution_id,collect:true});
  assert.equal(unavailable.collection_status,'unavailable');
  check=await checkDeliveryReports(f.root,expected(f));
  assert.equal(check.collection.status,'unavailable');assert.equal(JSON.stringify(check).includes(r.source.path),false);
});

test('one review packet preserves separation and exact candidate; same reviewer records the native judgment',async t=>{
  const f=await fixture(t,{activity_kind:'review'}),reviewer={agent_id:'reviewer',principal_id:'owner'};
  const request={task_id:f.task.id,execution_id:f.execution_id,reviewer};
  await assert.rejects(readDeliveryReview(f.root,request),/not awaiting review/);
  await f.host();const revision=f.git('rev-parse','HEAD');
  await mutateNativeTask(f.root,f.task.id,'handoff',{operation_id:'handoff',expected_version:2,actor:f.actor,claim_id:f.task.claim.id,revision,summary:'Exact candidate',evidence:['docs/approval.md'],unresolved:[]});
  const before=await readNativeTask(f.root,f.task.id),binding=await f.binding();
  await assert.rejects(readDeliveryReview(f.root,{...request,reviewer:f.actor}),/separation/);
  const packet=await readDeliveryReview(f.root,request);
  assert.equal(packet.ready_for_review,true);assert.equal(packet.candidate_revision,revision);
  assert.equal(packet.review_request_template.expected_version,3);assert.equal(packet.review_request_template.judgment,null);
  assert.deepEqual(await readNativeTask(f.root,f.task.id),before);assert.equal(await f.binding(),binding);
  await mutateNativeTask(f.root,f.task.id,'review',{...packet.review_request_template,operation_id:'review',judgment:'pass',summary:'Fixture independently checked',evidence:['docs/approval.md']});
  assert.equal((await readNativeTask(f.root,f.task.id)).state,'release_gate');
  await assert.rejects(readDeliveryReview(f.root,request),/not awaiting review/);
});

test('review packet refuses unbound/wrong-kind operations and reports changed delivery evidence',async t=>{
  for(const activity_kind of ['implementation','review']) {
    const f=await fixture(t,{activity_kind}),request={task_id:f.task.id,execution_id:f.execution_id,reviewer:{agent_id:'reviewer',principal_id:'owner'}};
    if(activity_kind==='implementation')await f.host();
    await mutateNativeTask(f.root,f.task.id,'handoff',{operation_id:'handoff',expected_version:2,actor:f.actor,claim_id:f.task.claim.id,revision:f.git('rev-parse','HEAD'),summary:'Fixture',evidence:['docs/approval.md'],unresolved:[]});
    await assert.rejects(readDeliveryReview(f.root,request),activity_kind==='review'?/pre-bound/:/exact review ticket/);
  }
  const f=await fixture(t,{activity_kind:'review'});await f.host();
  await fs.writeFile(f.root+'/src/check.md','Recorded verification');f.git('add','src/check.md');f.git('commit','-qm','Evidence');
  await mutateNativeTask(f.root,f.task.id,'handoff',{operation_id:'handoff',expected_version:2,actor:f.actor,claim_id:f.task.claim.id,revision:f.git('rev-parse','HEAD'),summary:'Fixture',evidence:['src/check.md'],unresolved:[]});
  await fs.writeFile(f.root+'/src/check.md','Changed verification');
  const packet=await readDeliveryReview(f.root,{task_id:f.task.id,execution_id:f.execution_id,reviewer:{agent_id:'reviewer',principal_id:'owner'}});
  assert.equal(packet.ready_for_review,false);assert.ok(packet.blocking_reasons.includes('evidence-unavailable'));
  assert.deepEqual(packet.changed_paths,['src/check.md']);
});

test('ordinary host binding cannot impersonate a dispatch by reusing its UUID, even after reporting',async t=>{
  const f=await fixture(t,{activity_kind:'review'});
  const {bindHostUsage,reportHostUsage}=await import('../src/workkeel-host-usage.mjs');
  const identity={actor:f.actor,claim_id:f.task.claim.id,contract_sha256:f.task.contract_sha256};
  await bindHostUsage(f.root,{...identity,task_id:f.task.id,binding_id:f.execution_id,source:{kind:'host-report',thread_id:'ordinary-host',turn_id:'ordinary-turn'}});
  const request=expected(f,'review');
  let check=await checkDeliveryReports(f.root,request);
  assert.equal(check.bindings_ready,false);assert.equal(check.expected_operations[0].status,'unavailable');
  const saved=await f.binding();
  await assert.rejects(finishDelivery(f.root,{execution_id:f.execution_id,report:f.report()}),/verified dispatch host binding/);
  assert.equal(await f.binding(),saved);
  const at=new Date().toISOString();
  await reportHostUsage(f.root,{...identity,binding_id:f.execution_id,...f.report(),activity_kind:'review',execution_duration_ms:0,execution_intervals:[{started_at:at,completed_at:at}]});
  check=await checkDeliveryReports(f.root,request);
  assert.equal(check.declared_reports_complete,false);assert.ok(check.expected_operations[0].issues.includes('dispatch-binding-mismatch'));
  await mutateNativeTask(f.root,f.task.id,'handoff',{operation_id:'handoff',expected_version:2,actor:f.actor,claim_id:f.task.claim.id,revision:f.git('rev-parse','HEAD'),summary:'Fixture',evidence:['docs/approval.md'],unresolved:[]});
  await assert.rejects(readDeliveryReview(f.root,{task_id:f.task.id,execution_id:f.execution_id,reviewer:{agent_id:'reviewer',principal_id:'owner'}}),/pre-bound review operation/);
});
