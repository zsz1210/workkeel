import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {initializeTaskProject} from '../src/workkeel-project.mjs';
import {previewTaskIntake, applyTaskIntake} from '../src/workkeel-intake.mjs';
import {mutateNativeTask, readNativeTask} from '../src/workkeel-tasks.mjs';
import {saveModelPolicyDraft, approveModelPolicy} from '../src/workkeel-model-policy.mjs';
import {prepareDispatchTicket, readDispatchTicket, bindDispatchTicket, validateDispatchPolicy, assertDispatchCapability} from '../src/workkeel-dispatch.mjs';
import {validateModelPolicyPin} from '../src/workkeel-model-routing.mjs';
import {executionDigest, validateExecutionPolicy} from '../src/workkeel-execution-policy.mjs';
import {bindHostUsage, reportHostUsage} from '../src/workkeel-host-usage.mjs';
import {executeWorkflow, planWorkflow, readExecutionRecord} from '../src/workkeel-workflows.mjs';
import {readWorkflowMeasurements} from '../src/workkeel-measurements.mjs';
import {planContinuation,continueWorkflow} from '../src/workkeel-continuation.mjs';

const fixed = value => ({mode: 'fixed', value}), auto = () => ({mode: 'auto'});
const layerPolicy = () => ({schema_version: 'workkeel.model-policy/v1', id: 'synthetic-routing', version: 1,
  project: {model: auto(), reasoning: auto(), service: auto()}, rules: [{id: 'planning', layer: 'activity', match: 'planning', settings: {model: fixed('careful'), reasoning: fixed('low'), service: fixed('priority')}}],
  models: ['fast', 'careful'].map((id, index) => ({id, provider: 'synthetic', model: `${id}-model`, data_classes: ['internal'], risk_tiers: ['low', 'standard', 'high'], quality: 80,
    reasoning_efforts: ['low', 'high'], service_tiers: ['standard', 'priority'], auto_efforts: {low: 'low', standard: 'high', high: 'high'}, auto_service: 'standard', cost: index + 1, quota_remaining: null}))});
const host = () => ({host: 'synthetic-host', models: ['fast', 'careful'].map(id => ({provider: 'synthetic', model: `${id}-model`, reasoning: ['low', 'high'], service_tiers: ['standard', 'priority']}))});
const authority = pin => ({schema_version: 'workkeel.dispatch-policy/v1', models: ['fast', 'careful'].map(alias => ({alias, provider: 'synthetic', model: `${alias}-model`, reasoning: 'high',
  reasoning_efforts: ['low', 'high'], service_tiers: ['standard', 'priority'], data_classes: ['internal']})), default_alias: 'fast', conservative_alias: 'careful', parallelism: 2, model_policy: {...pin, min_quality: 70}});

async function fixture(t, {mutateAuthority = () => {}, mutatePolicy = () => {}} = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'workkeel-model-routing-')));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  git('init', '-q'); git('config', 'user.name', 'Synthetic'); git('config', 'user.email', 'synthetic@example.invalid');
  const actor = {agent_id: 'builder', principal_id: 'owner'};
  await initializeTaskProject(root, {schema_version: 'workkeel.task-policy/v1', principals: ['owner'], agents: [actor], approvers: ['owner'], review_separation: 'distinct-agent'});
  await fs.mkdir(root + '/docs'); await fs.mkdir(root + '/src'); await fs.mkdir(root + '/.ai-org/model-policies', {recursive: true});
  await fs.writeFile(root + '/docs/approval.md', 'Synthetic offline model policy and dispatch approval; no provider call.');
  git('add', '.'); git('commit', '-qm', 'Synthetic initial source');
  const brief = (id, writePaths, refs) => ({schema_version: 'workkeel.task-brief/v1', id, goal: 'Synthetic runtime routing', actor, acceptance: ['Exact routed settings preserved'],
    environment: {cwd: '.', read_paths: ['.'], write_paths: writePaths, tools: ['node'], resources: [], network: {mode: 'none', hosts: []}, external_actions: [],
      data: {classification: 'internal', model_access: 'approved-connection', policy_refs: refs}},
    authorization: {approved_by: 'owner', approval_ref: 'docs/approval.md', operations: ['read', 'write', 'execute'], expires_at: null}});
  async function createClaim(b) {
    const preview = await previewTaskIntake(root, b); await applyTaskIntake(root, b, preview.fingerprint);
    await mutateNativeTask(root, b.id, 'claim', {operation_id: `claim-${b.id}`, expected_version: 1, actor, base_revision: git('rev-parse', 'HEAD')});
    return readNativeTask(root, b.id);
  }
  const administration = await createClaim(brief('WK-policy', ['.ai-org/model-policies'], ['docs/approval.md'])), policy = layerPolicy(); mutatePolicy(policy);
  const adminRequest = {task_id: administration.id, actor, claim_id: administration.claim.id, expected_task_version: administration.version, expected_version: 0};
  const draft = await saveModelPolicyDraft(root, {...adminRequest, policy});
  await approveModelPolicy(root, {...adminRequest, expected_version: 1, policy_id: policy.id, policy_version: 1, policy_sha256: draft.entries[0].sha256});
  const pin = {policy_id: policy.id, version: 1, sha256: draft.entries[0].sha256}, dispatchPolicy = authority(pin); mutateAuthority(dispatchPolicy);
  await fs.writeFile(root + '/docs/dispatch.json', JSON.stringify(dispatchPolicy));
  const task = await createClaim(brief('WK-runtime', ['src'], ['docs/approval.md', 'docs/dispatch.json']));
  const request = {task_id: task.id, actor, claim_id: task.claim.id, contract_sha256: task.contract_sha256, operation_id: 'dispatch-plan', policy_ref: 'docs/dispatch.json',
    node: {id: 'plan', activity_kind: 'planning', depends_on: [], read_paths: ['src'], write_paths: ['src']}, capabilities: host()};
  return {root, actor, task, request, adminRequest, pin, policy, dispatchPolicy};
}
const bind = (ticket, request) => ({execution_id: ticket.execution_id, source: {kind: 'host-report', thread_id: `thread-${ticket.execution_id}`, turn_id: 'turn-one'}, sample_kind: 'fixture',
  capabilities: request.capabilities, runtime_selection: Object.fromEntries(['provider', 'model', 'reasoning', 'service'].map(key => [key, ticket.selected[key]]))});

test('new native preparation consumes the active policy and binds the actual selected tuple', async t => {
  const f = await fixture(t), ticket = await prepareDispatchTicket(f.root, f.request);
  assert.deepEqual([ticket.selected.model, ticket.selected.reasoning, ticket.selected.service], ['careful-model', 'low', 'priority']);
  assert.equal(ticket.model_snapshot.source.policy_sha256, f.pin.sha256); assert.equal(ticket.model_snapshot.report_status, 'unknown');
  assert.equal(ticket.capability_sha256, executionDigest(f.request.capabilities)); assert.equal(ticket.selected.selection_reason, 'layered-model-policy');
  assert.deepEqual(await readDispatchTicket(f.root, ticket.execution_id), ticket);
  const request = bind(ticket, f.request), bound = await bindDispatchTicket(f.root, request);
  assert.equal(bound.run_id, ticket.execution_id); assert.equal(bound.model_policy_binding.runtime_selection.service, 'priority');
  const receipt = JSON.parse(await fs.readFile(f.root + '/' + bound.model_policy_binding.ref, 'utf8'));
  assert.equal(receipt.value.ticket_sha256, executionDigest(ticket)); assert.equal(receipt.value.proof_kind, 'attributed-host-acknowledgement');
  assert.equal(receipt.value.provider_authenticated, false);
  await reportHostUsage(f.root, {binding_id: ticket.execution_id, report_id: 'observed', actor: f.actor, claim_id: f.task.claim.id, contract_sha256: f.task.contract_sha256,
    status: 'completed', usage: {input_tokens: 0, output_tokens: 0}, tool: 'synthetic-host', provider: ticket.selected.provider, model: ticket.selected.model,
    reported_reasoning: ticket.selected.reasoning, observed_at: new Date().toISOString()});
  assert.equal((await readNativeTask(f.root, f.task.id)).version, f.task.version);
});

test('explicit context is fingerprinted, while forged policy pins and explicit alias conflicts cannot widen authority', async t => {
  const f = await fixture(t);
  const ticket = await prepareDispatchTicket(f.root, {...f.request, model_policy: {...f.pin, context: {role: 'developer'}}});
  assert.equal(ticket.model_policy.context.role, 'developer');
  await assert.rejects(prepareDispatchTicket(f.root, {...f.request, operation_id: 'wrong-pin', model_policy: {...f.pin, sha256: '0'.repeat(64)}}), /approved contract policy pin/);
  await assert.rejects(prepareDispatchTicket(f.root, {...f.request, operation_id: 'explicit-conflict', route: {alias: 'fast'}}), /Fixed model careful.*no fallback/);
  await assert.rejects(prepareDispatchTicket(f.root, {...f.request, operation_id: 'context-forged', model_policy: {...f.pin, context: {activity: 'implementation'}}}), /unknown execution fields/);
});

test('layered capability checks need only the selected host model and cannot substitute unavailable effort/service', async t => {
  const f = await fixture(t), selectedHost = host(); selectedHost.models.shift();
  const ticket = await prepareDispatchTicket(f.root, {...f.request, capabilities: selectedHost});
  assert.equal(ticket.selected.model, 'careful-model');
  for (const dimension of ['reasoning', 'service_tiers']) {
    const capabilities = host(); capabilities.models[1][dimension] = dimension === 'reasoning' ? ['high'] : ['standard'];
    await assert.rejects(prepareDispatchTicket(f.root, {...f.request, operation_id: `unavailable-${dimension}`, capabilities}), /Fixed model careful.*no fallback/);
  }
  const missing = host(); delete missing.models[1].service_tiers;
  await assert.rejects(prepareDispatchTicket(f.root, {...f.request, operation_id: 'unknown-service', capabilities: missing}), /host-service-unavailable/);
});

test('authoritative scalar effort and absent service grants block settings overrides', async t => {
  const effort = await fixture(t, {mutateAuthority: p => {delete p.models[1].reasoning_efforts;}});
  await assert.rejects(prepareDispatchTicket(effort.root, effort.request), /host-effort-unavailable/);
  const service = await fixture(t, {mutateAuthority: p => {delete p.models[1].service_tiers;}});
  await assert.rejects(prepareDispatchTicket(service.root, service.request), /host-service-unavailable/);
  const missingBridge = await fixture(t, {mutateAuthority: p => {delete p.model_policy;}});
  await assert.rejects(prepareDispatchTicket(missingBridge.root, {...missingBridge.request, model_policy: missingBridge.pin}), /lacks an approved policy bridge/);
});

test('actual bind must acknowledge model/reasoning/service plus the prepared host fingerprint', async t => {
  const f = await fixture(t), ticket = await prepareDispatchTicket(f.root, f.request), request = bind(ticket, f.request);
  await assert.rejects(bindDispatchTicket(f.root, {execution_id: ticket.execution_id, source: request.source}), /unknown execution fields/);
  for (const dimension of ['provider', 'model', 'reasoning', 'service']) {
    const changed = structuredClone(request); changed.runtime_selection[dimension] = 'different';
    await assert.rejects(bindDispatchTicket(f.root, changed), /runtime acknowledgement differs/);
  }
  const changed = structuredClone(request); changed.capabilities.host = 'different-host';
  await assert.rejects(bindDispatchTicket(f.root, changed), /capability fingerprint/);
  assert.equal((await bindDispatchTicket(f.root, request)).run_id, ticket.execution_id);
});

test('direct native host binding cannot bypass a layered ticket tuple acknowledgement', async t => {
  const f = await fixture(t), ticket = await prepareDispatchTicket(f.root, f.request), request = bind(ticket, f.request);
  const direct = {binding_id: ticket.execution_id, dispatch_id: ticket.execution_id, task_id: f.task.id, actor: f.actor,
    claim_id: f.task.claim.id, contract_sha256: f.task.contract_sha256, source: request.source, sample_kind: 'fixture'};
  await assert.rejects(bindHostUsage(f.root, direct));
  await assert.rejects(bindHostUsage(f.root, {...direct, routing_ack: {capabilities: request.capabilities, runtime_selection: {...request.runtime_selection, service: 'standard'}}}));
  await assert.rejects(bindHostUsage(f.root, {...direct, routing_ack: {capabilities: request.capabilities, runtime_selection: request.runtime_selection, extra: true}}));
});

test('later activation cannot rewrite existing tickets; new execution needs a fresh approved bridge pin', async t => {
  const f = await fixture(t), ticket = await prepareDispatchTicket(f.root, f.request);
  const policy = structuredClone(f.policy); policy.version = 2; policy.rules[0].settings.service = fixed('standard');
  const draft = await saveModelPolicyDraft(f.root, {...f.adminRequest, expected_version: 2, policy});
  await approveModelPolicy(f.root, {...f.adminRequest, expected_version: 3, policy_id: policy.id, policy_version: 2, policy_sha256: draft.entries[1].sha256});
  assert.deepEqual(await readDispatchTicket(f.root, ticket.execution_id), ticket);
  assert.deepEqual(await prepareDispatchTicket(f.root, f.request), ticket, 'Replay retains an existing immutable decision after settings activation');
  await assert.rejects(prepareDispatchTicket(f.root, {...f.request, operation_id: 'new-after-change'}), /new execution requires.*active/);
  assert.equal((await bindDispatchTicket(f.root, bind(ticket, f.request))).model_policy_binding.runtime_selection.service, 'priority');
});

test('rehashed persisted snapshots/capabilities/selected service cannot alter immutable tickets', async t => {
  const f = await fixture(t), ticket = await prepareDispatchTicket(f.root, f.request);
  const file = f.root + '/.ai-org/dispatch/' + (await fs.readdir(f.root + '/.ai-org/dispatch')).find(n => n.startsWith(ticket.execution_id));
  const original = JSON.parse(await fs.readFile(file, 'utf8'));
  for (const edit of [v => v.model_snapshot.selected.service = 'standard', v => v.selected.service = 'standard', v => v.model_policy.version = 2, v => v.requested_host = 'forged-host',
    v => {v.capabilities.models[1].service_tiers = ['standard']; v.capability_sha256 = executionDigest(v.capabilities);}, v => {delete v.model_policy;}]) {
    const envelope = structuredClone(original); edit(envelope.value); envelope.sha256 = executionDigest(envelope.value); await fs.writeFile(file, JSON.stringify(envelope));
    await assert.rejects(readDispatchTicket(f.root, ticket.execution_id));
  }
  await fs.writeFile(file, JSON.stringify(original)); assert.equal((await readDispatchTicket(f.root, ticket.execution_id)).selected.service, 'priority');
});

test('policy bridge and capability extensions reject malformed dimension lists and unknown fields', () => {
  const pin = {policy_id: 'synthetic', version: 1, sha256: 'a'.repeat(64)};
  assert.throws(() => validateModelPolicyPin({...pin, extra: true}));
  for (const value of [Array(1), [], ['high', 'high'], ['__proto__']]) {
    const p = authority(pin); p.models[0].reasoning_efforts = value; assert.throws(() => validateDispatchPolicy(p));
  }
  assert.throws(() => assertDispatchCapability({provider: 'synthetic', model: 'fast-model', reasoning: 'high', service: 'priority'}, {host: 'host', models: [{provider: 'synthetic', model: 'fast-model', reasoning: ['high']}]}), /capability mismatch/);
});

async function workflowFixture(t, {mutate = () => {}, resultChange = value => value, hookChange = value => value, includeHook = true} = {}) {
  const f = await fixture(t);
  await fs.mkdir(f.root + '/workflow-src');
  const definition = {schema_version: 'workkeel.workflow/v1', nodes: [{id: 'work', kind: 'runtime', input: 'Write exact synthetic model configuration'}], edges: [{from: 'start', to: 'work'}, {from: 'work', to: 'end'}]};
  const policy = {schema_version: 'workkeel.execution-policy/v1', models: ['fast', 'careful'].map(id => ({id, connection: {kind: 'native'}, data_classes: ['internal'],
    routing: {provider: 'synthetic', model: `${id}-model`, reasoning_efforts: ['low', 'high'], service_tiers: ['standard', 'priority']}})),
    model_policy: {...f.pin, min_quality: 70}, model_contexts: [{node: 'work', activity: 'planning', role: 'developer'}],
    default_model: 'fast', rules: [], headroom: {mode: 'off'}, limits: {steps: 10, attempts_per_node: 2, parallelism: 1, timeout_ms: 30000, max_cost_usd: null}};
  mutate({policy, definition});
  await fs.writeFile(f.root + '/docs/execution.json', JSON.stringify(policy)); await fs.writeFile(f.root + '/docs/workflow.json', JSON.stringify(definition));
  const brief = {schema_version: 'workkeel.task-brief/v1', id: 'WK-workflow-routing', goal: 'Synthetic actual workflow routing', actor: f.actor, acceptance: ['Exact selection delivered to runtime'],
    environment: {cwd: '.', read_paths: ['workflow-src'], write_paths: ['workflow-src'], tools: ['node'], resources: [], network: {mode: 'none', hosts: []}, external_actions: [],
      data: {classification: 'internal', model_access: 'approved-connection', policy_refs: ['docs/approval.md', 'docs/execution.json', 'docs/workflow.json']}},
    authorization: {approved_by: 'owner', approval_ref: 'docs/approval.md', operations: ['read', 'write', 'execute'], expires_at: null},
    execution: {runtime: {kind: 'adapter', adapter_id: 'synthetic-runtime', required_features: []}, model_connection: {kind: 'policy', policy_ref: 'docs/execution.json'}}};
  const preview = await previewTaskIntake(f.root, brief); await applyTaskIntake(f.root, brief, preview.fingerprint);
  const revision = execFileSync('git', ['-C', f.root, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
  await mutateNativeTask(f.root, brief.id, 'claim', {operation_id: 'claim-workflow', expected_version: 1, actor: f.actor, base_revision: revision});
  const task = await readNativeTask(f.root, brief.id), request = {run_id: 'routed-run', task_id: task.id, actor: f.actor, claim_id: task.claim.id,
    workflow_ref: 'docs/workflow.json', policy_ref: 'docs/execution.json', capabilities: host()};
  const delivered = []; let calls = 0;
  const operation = async context => {
    calls++; const config = structuredClone(context.selection.runtime_selection); delivered.push(config);
    await fs.writeFile(f.root + '/workflow-src/config.json', JSON.stringify(config));
    return resultChange({status: 'completed', conversation_id: 'synthetic-conversation', output: 'Synthetic exact configuration written', outcome: 'done',
      observed_model: config.model, runtime_model: config.model, runtime_selection: config, usage: {input_tokens: 0, output_tokens: 0, cost_usd: null}});
  };
  const adapter = {id: 'synthetic-runtime', assertCompatible: async () => {}, start: operation, resume: operation, cancel: async () => {}};
  if (includeHook) adapter.assertModelSelection = async ({selection}) => hookChange(structuredClone(selection.runtime_selection));
  const {run_id, ...planRequest} = request;
  return {...f, task, request, planRequest, policy, adapter, delivered, calls: () => calls};
}

test('real native workflow consumes model/reasoning/service and retains exact runtime acknowledgement', async t => {
  const f = await workflowFixture(t);
  const plan = await planWorkflow(f.root, f.planRequest, [f.adapter]);
  assert.deepEqual(plan.selections.work.runtime_selection, {provider: 'synthetic', model: 'careful-model', reasoning: 'low', service: 'priority'});
  assert.equal(plan.selections.work.model_snapshot.source.dimensions.model, 'activity:planning');
  assert.throws(() => {plan.selections.work.runtime_selection.service = 'standard';}, TypeError);
  const run = await executeWorkflow(f.root, f.request, {adapters: [f.adapter]});
  assert.equal(run.status.state, 'completed'); assert.equal(f.calls(), 1);
  assert.deepEqual(f.delivered[0], plan.selections.work.runtime_selection);
  const record = await readExecutionRecord(f.root, '.ai-org/execution/routed-run/operations/work-0-0.json');
  assert.equal(record.model_snapshot_sha256, executionDigest(plan.selections.work.model_snapshot));
  assert.deepEqual(record.result.runtime_selection, f.delivered[0]); assert.equal(record.result.usage.input_tokens, 0);
  const measurement = await readWorkflowMeasurements(f.root, f.request.run_id), observed = measurement.operations[0];
  assert.deepEqual(observed.actor, f.actor); assert.equal(observed.selected_service, 'priority'); assert.equal(observed.reported_service, 'priority');
  assert.equal(observed.selected_model, 'careful-model'); assert.equal(observed.reported_reasoning, 'low'); assert.equal(observed.usage.input_tokens, 0);
  assert.deepEqual(observed.model_snapshot, plan.selections.work.model_snapshot);
  assert.equal((await readNativeTask(f.root, f.task.id)).state, 'build');
  await executeWorkflow(f.root, f.request, {adapters: [f.adapter]}); assert.equal(f.calls(), 1);
});

test('confirmed layered continuation preserves capability and settings pins across a new claim without replaying the old operation',async t=>{
  let results=0;const f=await workflowFixture(t,{resultChange:value=>++results===1?{...value,status:'interrupted',outcome:'attention'}:value});
  await assert.rejects(executeWorkflow(f.root,f.request,{adapters:[f.adapter]}),/did not complete/);
  const prior=await fs.readFile(f.root+'/.ai-org/execution/routed-run/operations/work-0-0.json','utf8');
  const request={source_run_id:f.request.run_id,run_id:'layered-successor',actor:f.actor,workflow_ref:f.request.workflow_ref,policy_ref:f.request.policy_ref};
  const plan=await planContinuation(f.root,request);assert.deepEqual(plan.capabilities,f.request.capabilities);
  const run=await continueWorkflow(f.root,{...request,expected_plan:plan.sha256},{adapters:[f.adapter]});
  assert.equal(run.status.state,'completed');assert.equal(f.calls(),2);assert.deepEqual(run.request.capabilities,f.request.capabilities);
  assert.deepEqual(run.identity.selections.work.runtime_selection,f.delivered[0]);assert.notEqual(run.request.claim_id,f.request.claim_id);
  assert.equal(await fs.readFile(f.root+'/.ai-org/execution/routed-run/operations/work-0-0.json','utf8'),prior);
});

test('unsupported runtime service hook blocks before any workflow intent or model dispatch', async t => {
  const f = await workflowFixture(t, {includeHook: false});
  await assert.rejects(planWorkflow(f.root, f.planRequest, [f.adapter]), /Runtime cannot enforce/);
  await assert.rejects(executeWorkflow(f.root, f.request, {adapters: [f.adapter]}), /Runtime cannot enforce/);
  assert.equal(f.calls(), 0);
  await assert.rejects(fs.stat(f.root + '/.ai-org/execution/routed-run'), error => error.code === 'ENOENT');
  const mismatch = await workflowFixture(t, {hookChange: value => ({...value, service: 'standard'})});
  await assert.rejects(executeWorkflow(mismatch.root, mismatch.request, {adapters: [mismatch.adapter]}), /runtime acknowledgement differs/);
  assert.equal(mismatch.calls(), 0);
});

test('missing or wrong final tuple stays unresolved and cannot silently become accepted execution', async t => {
  for (const [name, resultChange] of [['missing', value => {delete value.runtime_selection; return value;}], ['mismatch', value => ({...value, runtime_selection: {...value.runtime_selection, service: 'standard'}})],
    ['contradiction', value => ({...value, runtime_model: 'different-model'})]]) {
    const f = await workflowFixture(t, {resultChange});
    await assert.rejects(executeWorkflow(f.root, f.request, {adapters: [f.adapter]})); assert.equal(f.calls(), 1);
    const op = await readExecutionRecord(f.root, '.ai-org/execution/routed-run/operations/work-0-0.json');
    assert.equal(op.result, null); assert.equal(op.unconfirmed_runtime_selection?.service ?? null, name === 'missing' ? null : name === 'mismatch' ? 'standard' : 'priority');
    const measurement = await readWorkflowMeasurements(f.root, f.request.run_id);
    assert.equal(measurement.operations[0].reported_service, null); assert.equal(measurement.operations[0].reported_reasoning, null);
    await assert.rejects(executeWorkflow(f.root, f.request, {adapters: [f.adapter]}), /Uncertain prior dispatch/); assert.equal(f.calls(), 1);
  }
});

test('completed workflow replays still reject tampered operation snapshot and runtime tuple evidence', async t => {
  const f = await workflowFixture(t); await executeWorkflow(f.root, f.request, {adapters: [f.adapter]});
  const ref = '.ai-org/execution/routed-run/operations/work-0-0.json', original = await readExecutionRecord(f.root, ref);
  for (const edit of [value => value.runtime_selection.service = 'standard', value => value.model_snapshot_sha256 = '0'.repeat(64), value => value.result.runtime_selection.service = 'standard']) {
    const value = structuredClone(original); edit(value); await fs.writeFile(f.root + '/' + ref, JSON.stringify({value, sha256: executionDigest(value)}));
    await assert.rejects(executeWorkflow(f.root, f.request, {adapters: [f.adapter]})); assert.equal(f.calls(), 1);
  }
});

test('workflow resume preserves historical settings while new plans require the active approved pin', async t => {
  const f = await workflowFixture(t); await executeWorkflow(f.root, f.request, {adapters: [f.adapter]});
  const policy = structuredClone(f.policy); // execution policy stays immutable; only settings history changes.
  const newSettings = layerPolicy(); newSettings.version = 2; newSettings.rules[0].settings.service = fixed('standard');
  const draft = await saveModelPolicyDraft(f.root, {...f.adminRequest, expected_version: 2, policy: newSettings});
  await approveModelPolicy(f.root, {...f.adminRequest, expected_version: 3, policy_id: newSettings.id, policy_version: 2, policy_sha256: draft.entries[1].sha256});
  const replay = await executeWorkflow(f.root, f.request, {adapters: [f.adapter]});
  assert.equal(replay.identity.selections.work.runtime_selection.service, 'priority'); assert.equal(f.calls(), 1);
  await assert.rejects(planWorkflow(f.root, f.planRequest, [f.adapter]), /new execution requires.*active/);
  const changedCapabilities = host(); changedCapabilities.host = 'different-host';
  await assert.rejects(executeWorkflow(f.root, {...f.request, capabilities: changedCapabilities}, {adapters: [f.adapter]}), /Resume requires/);
  assert.deepEqual(JSON.parse(await fs.readFile(f.root + '/docs/execution.json', 'utf8')), policy);
});

test('fixed workflow node/rule constraints, unsupported host service and approved role conflicts cannot be overridden', async t => {
  const node = await workflowFixture(t, {mutate: ({definition}) => {definition.nodes[0].model = 'fast';}});
  await assert.rejects(planWorkflow(node.root, node.planRequest, [node.adapter]), /Fixed model careful.*no fallback/);
  const rule = await workflowFixture(t, {mutate: ({policy}) => {policy.rules = [{id: 'fixed-rule', nodes: ['work'], model: 'fast'}];}});
  await assert.rejects(planWorkflow(rule.root, rule.planRequest, [rule.adapter]), /Fixed model careful.*no fallback/);
  const f = await workflowFixture(t), capabilities = host(); capabilities.models[1].service_tiers = ['standard'];
  await assert.rejects(planWorkflow(f.root, {...f.planRequest, capabilities}, [f.adapter]), /host-service-unavailable/);
  await assert.rejects(planWorkflow(f.root, {...f.planRequest, model_policy: {...f.pin, context: {role: 'reviewer'}}}, [f.adapter]), /approved workflow node context/);
  const fallback = await workflowFixture(t, {mutate: ({policy}) => {policy.fallbacks = [{node: 'work', models: ['fast', 'careful']}];}});
  await assert.rejects(planWorkflow(fallback.root, fallback.planRequest, [fallback.adapter]), /cannot silently fall back/);
});

test('subscription routing authority retains exact connection effort and provider; malformed contexts reject', () => {
  const base = {schema_version: 'workkeel.execution-policy/v1', models: [{id: 'subscription', connection: {kind: 'codex-subscription', model: 'synthetic-model', effort: 'high'}, data_classes: ['internal'],
    routing: {provider: 'openai', model: 'synthetic-model', reasoning_efforts: ['high'], service_tiers: ['provider-default']}}], default_model: 'subscription', rules: [], headroom: {mode: 'off'},
    limits: {steps: 10, attempts_per_node: 1, parallelism: 1, timeout_ms: 30000, max_cost_usd: null}};
  validateExecutionPolicy(base);
  for (const edit of [p => p.models[0].routing.provider = 'other', p => p.models[0].routing.model = 'different-model', p => p.models[0].routing.reasoning_efforts.push('low'),
    p => p.model_contexts = Array(1), p => p.model_contexts = [{node: 'work', activity: 'planning', extra: true}]]) {
    const copy = structuredClone(base); edit(copy); assert.throws(() => validateExecutionPolicy(copy));
  }
});
