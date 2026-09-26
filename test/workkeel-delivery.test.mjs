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
import {readDeliveryContext,attachDelivery,finishDelivery} from '../scripts/workkeel-delivery.mjs';

async function fixture(t) {
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
    node:{id:'implementation',activity_kind:'implementation',depends_on:[],read_paths:['src'],write_paths:['src']},
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
