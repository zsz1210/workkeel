import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {validateModelPolicy, validateModelSnapshot, resolveModelPolicy, selectModelPolicy, readModelPolicy, saveModelPolicyDraft, approveModelPolicy} from '../src/workkeel-model-policy.mjs';
import {initializeTaskProject} from '../src/workkeel-project.mjs';
import {previewTaskIntake, applyTaskIntake} from '../src/workkeel-intake.mjs';
import {createNativeTask, mutateNativeTask, readNativeTask} from '../src/workkeel-tasks.mjs';

const auto = () => ({mode: 'auto'}), fixed = value => ({mode: 'fixed', value}), inherit = () => ({mode: 'inherit'});
const model = (id, provider = 'codex', overrides = {}) => ({id, provider, model: `${id}-model`, data_classes: ['public', 'internal'],
  risk_tiers: ['low', 'standard', 'high'], quality: 80, reasoning_efforts: ['low', 'high', 'max'], service_tiers: ['standard', 'priority'],
  auto_efforts: {low: 'low', standard: 'high', high: 'max'}, auto_service: 'standard', cost: 1, quota_remaining: 1, ...overrides});
const policy = () => ({schema_version: 'workkeel.model-policy/v1', id: 'synthetic-policy', version: 1,
  project: {model: auto(), reasoning: auto(), service: auto()}, rules: [], models: [model('one'), model('two', 'claude', {
    reasoning_efforts: ['medium', 'high'], auto_efforts: {low: 'medium', standard: 'high', high: 'high'}, cost: 2})]});
const context = p => ({authority: {allowed_models: p.models.map(m => m.id), data_class: 'internal', risk_tier: 'standard', min_quality: 70},
  host_models: p.models.map(m => ({provider: m.provider, model: m.model, reasoning_efforts: [...m.reasoning_efforts], service_tiers: [...m.service_tiers]}))});
const rule = (id, layer, match, settings) => ({id, layer, match, settings});

test('dimensions inherit independently through project/activity/task/node without mutating input', () => {
  const p = policy();
  p.rules.push(rule('dev', 'role', 'developer', {model: fixed('two'), reasoning: inherit()}),
    rule('edit', 'activity', 'edit', {service: fixed('priority')}),
    rule('task-override', 'task', 'WK-synthetic', {reasoning: fixed('medium'), model: inherit()}),
    rule('node-override', 'node', 'review', {service: auto(), model: inherit(), reasoning: inherit()}));
  const input = structuredClone(p);
  const resolved = selectModelPolicy(p, {...context(p), activity: 'edit', role: 'developer', task: 'WK-synthetic', node: 'review'});
  assert.deepEqual(resolved.selected, {id: 'two', provider: 'claude', model: 'two-model', reasoning: 'medium', service: 'standard'});
  assert.deepEqual(resolved.source.dimensions, {model: 'role:dev', reasoning: 'task:task-override', service: 'node:node-override'});
  assert.deepEqual(p, input); assert.deepEqual(resolved.reported, {model: null, reasoning: null, service: null});
  assert.equal(resolved.report_status, 'unknown'); assert.equal(resolved.dispatch_performed, false); assert.equal(resolved.execution_authorized, false);
  assert.throws(() => { resolved.selected.model = 'changed'; }, TypeError);
});

test('same-layer conflict fails even if a later layer would override it; identical assignments are allowed', () => {
  const p = policy();
  p.rules = [rule('role', 'role', 'developer', {model: fixed('one')}), rule('activity', 'activity', 'edit', {model: fixed('two')}),
    rule('node', 'node', 'build', {model: fixed('one')})];
  assert.throws(() => resolveModelPolicy(p, {role: 'developer', activity: 'edit', node: 'build'}), /Conflicting model/);
  p.rules[1].settings.model = fixed('one');
  assert.equal(resolveModelPolicy(p, {role: 'developer', activity: 'edit'}).sources.model, 'activity:activity,role:role');
  p.rules = [rule('a', 'task', 'WK-one', {reasoning: fixed('low')}), rule('b', 'task', 'WK-one', {reasoning: auto()})];
  assert.throws(() => resolveModelPolicy(p, {task: 'WK-one'}), /Conflicting reasoning/);
});

test('fixed unavailable model, effort, service and exhausted quota never silently fall back', () => {
  const p = policy(); p.project.model = fixed('one');
  const c = context(p); c.host_models.splice(0, 1);
  assert.throws(() => selectModelPolicy(p, c), /Fixed model one.*no fallback/);
  for (const [key, value] of [['reasoning', 'medium'], ['service', 'premium']]) {
    const copy = structuredClone(p); copy.project[key] = fixed(value);
    assert.throws(() => selectModelPolicy(copy, context(copy)), /no fallback/);
  }
  p.models[0].quota_remaining = 0;
  assert.throws(() => selectModelPolicy(p, context(p)), /quota exhausted; no fallback/);
});

test('automatic reasoning on a fixed model uses exact provider effort scale and actual host support', () => {
  const p = policy(); p.project.model = fixed('two');
  const c = context(p); c.authority.risk_tier = 'low';
  assert.equal(selectModelPolicy(p, c).selected.reasoning, 'medium');
  c.authority.risk_tier = 'high';
  assert.equal(selectModelPolicy(p, c).selected.reasoning, 'high');
  c.host_models[1].reasoning_efforts = ['medium'];
  assert.throws(() => selectModelPolicy(p, c), /host-effort-unavailable/);
});

test('allowlist/data/risk/quality/host filtering precedes quota and cost preference', () => {
  for (const reason of ['outside-allowlist', 'data-boundary', 'risk-boundary', 'quality-floor', 'host-model-unavailable', 'host-service-unavailable']) {
    const p = policy(), c = context(p); p.models[0].cost = 0; p.models[0].quota_remaining = 100000;
    if (reason === 'outside-allowlist') c.authority.allowed_models = ['two'];
    if (reason === 'data-boundary') p.models[0].data_classes = ['public'];
    if (reason === 'risk-boundary') p.models[0].risk_tiers = ['low'];
    if (reason === 'quality-floor') p.models[0].quality = 0;
    if (reason === 'host-model-unavailable') c.host_models.splice(0, 1);
    if (reason === 'host-service-unavailable') c.host_models[0].service_tiers = [];
    const result = selectModelPolicy(p, c); assert.equal(result.selected.id, 'two');
    assert.ok(result.rejected.find(r => r.id === 'one').reasons.includes(reason));
  }
});

test('auto resource ranking is deterministic, handles explicit zero and unknown observations', () => {
  const p = policy(); p.models[0].cost = null; p.models[1].cost = 0;
  assert.equal(selectModelPolicy(p, context(p)).selected.id, 'two');
  p.models[1].quota_remaining = 0;
  assert.equal(selectModelPolicy(p, context(p)).selected.id, 'one');
  p.models.forEach(m => {m.cost = null; m.quota_remaining = null;});
  assert.equal(selectModelPolicy(p, context(p)).selected.id, 'one');
  p.models.reverse(); assert.equal(selectModelPolicy(p, context(p)).selected.id, 'one');
  const c = context(p); c.authority.allowed_models = [];
  assert.throws(() => selectModelPolicy(p, c), /No eligible/);
});

test('reported dimensions remain independent unknowns and never copy requested selections', () => {
  const p = policy(), c = context(p);
  c.reported = {model: 'different-model'};
  const result = selectModelPolicy(p, c);
  assert.equal(result.reported.model, 'different-model'); assert.equal(result.reported.reasoning, null); assert.equal(result.report_status, 'partial');
  assert.equal(result.policy_version, 1); assert.match(result.source.policy_sha256, /^[a-f0-9]{64}$/);
  c.reported = {model: 'one-model', reasoning: 'high', service: 'standard'};
  assert.equal(selectModelPolicy(p, c).report_status, 'reported');
});

test('immutable selection pins reject policy rewrites and malformed snapshot fields', () => {
  const p = policy(), c = context(p), pinned = selectModelPolicy(p, c);
  assert.equal(validateModelSnapshot(pinned), pinned);
  assert.deepEqual(selectModelPolicy(p, {...c, pinned}).selected, pinned.selected);
  for (const change of [s => s.extra = true, s => s.source.extra = true, s => s.requested.model.extra = true,
    s => s.selected.extra = true, s => s.reported.extra = true, s => s.rejected = Array(1),
    s => s.report_status = 'reported', s => s.execution_authorized = true]) {
    const snapshot = structuredClone(pinned); change(snapshot); assert.throws(() => validateModelSnapshot(snapshot));
  }
  p.version = 2;
  assert.throws(() => selectModelPolicy(p, {...context(p), pinned}), /Pinned model snapshot cannot change/);
  assert.equal(pinned.policy_version, 1);
});

test('strict input validation rejects sparse arrays, extra fields, ambiguous defaults and prototype tricks', () => {
  for (const change of [p => p.extra = true, p => p.models = Array(1), p => p.rules = Array(1),
    p => p.models[0].reasoning_efforts = Array(1), p => p.models[0].cost = NaN,
    p => p.project.model = {mode: 'auto', value: 'one'}, p => p.models[0].auto_efforts.low = 'medium',
    p => p.models[0].id = '__proto__', p => p.version = 1.5, p => p.models.push(structuredClone(p.models[0]))]) {
    const p = policy(); change(p); assert.throws(() => validateModelPolicy(p));
  }
  const p = policy(); p.project.service = inherit();
  assert.throws(() => resolveModelPolicy(p), /no concrete ancestor/);
  const c = context(policy()); c.host_models = Array(1);
  assert.throws(() => selectModelPolicy(policy(), c));
  assert.throws(() => resolveModelPolicy(policy(), {role: '__proto__'}));
});

async function fixture(t, {writePaths = ['.'], expiresAt = null, actorPrincipal = 'owner'} = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'workkeel-model-policy-')));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  git('init', '-q'); git('config', 'user.name', 'Synthetic'); git('config', 'user.email', 'synthetic@example.invalid');
  const actor = {agent_id: 'builder', principal_id: actorPrincipal}, other = {agent_id: 'outsider', principal_id: 'guest'};
  const approver = {agent_id: 'coordinator', principal_id: 'owner'};
  await initializeTaskProject(root, {schema_version: 'workkeel.task-policy/v1', principals: ['owner', 'guest'], agents: [actor, other, approver], approvers: ['owner'], review_separation: 'distinct-agent'});
  await fs.mkdir(root + '/docs'); await fs.mkdir(root + '/src'); await fs.writeFile(root + '/docs/approval.md', 'Synthetic model policy development authority.');
  git('add', '.'); git('commit', '-qm', 'Synthetic fixture');
  const brief = {schema_version: 'workkeel.task-brief/v1', id: 'WK-policy', goal: 'Synthetic policy development', actor, acceptance: ['Policy behavior checked'],
    environment: {cwd: '.', read_paths: ['.'], write_paths: writePaths, tools: ['node'], resources: [], network: {mode: 'none', hosts: []}, external_actions: [],
      data: {classification: 'internal', model_access: 'approved-connection', policy_refs: ['docs/approval.md']}},
    authorization: {approved_by: 'owner', approval_ref: 'docs/approval.md', operations: ['read', 'write', 'execute'], expires_at: expiresAt}};
  if (actorPrincipal === 'owner') {
    const preview = await previewTaskIntake(root, brief); await applyTaskIntake(root, brief, preview.fingerprint);
  } else {
    const preview = await previewTaskIntake(root, {...brief, actor: approver});
    await createNativeTask(root, {...preview.contract, actor}, preview.request);
  }
  await mutateNativeTask(root, brief.id, 'claim', {operation_id: 'claim', expected_version: 1, actor, base_revision: git('rev-parse', 'HEAD')});
  const task = await readNativeTask(root, brief.id);
  const request = {task_id: task.id, actor, claim_id: task.claim.id, expected_task_version: task.version, expected_version: 0};
  return {root, request, task, other};
}

test('native draft and exact approval preserve immutable versions and task contract bytes', async t => {
  const f = await fixture(t), p = policy();
  const taskBefore = await fs.readFile(f.root + '/.ai-org/work-items/WK-policy.json', 'utf8');
  assert.equal((await readModelPolicy(f.root, p.id)).version, 0);
  const draft = await saveModelPolicyDraft(f.root, {...f.request, policy: p});
  assert.equal(draft.version, 1); assert.equal(draft.active_version, null);
  assert.equal(await fs.readFile(f.root + '/.ai-org/model-policies/.gitignore', 'utf8'), '*\n');
  assert.equal(execFileSync('git', ['-C', f.root, 'check-ignore', '--', `.ai-org/model-policies/${p.id}.json`], {encoding: 'utf8'}).trim(), `.ai-org/model-policies/${p.id}.json`);
  const approve = {...f.request, expected_version: 1, policy_id: p.id, policy_version: 1, policy_sha256: draft.entries[0].sha256};
  const active = await approveModelPolicy(f.root, approve); assert.equal(active.version, 2); assert.equal(active.active_version, 1);
  p.version = 2; p.project.model = fixed('two');
  const next = await saveModelPolicyDraft(f.root, {...f.request, expected_version: 2, policy: p});
  assert.equal(next.version, 3); assert.equal(next.active_version, 1); assert.deepEqual(next.entries[0], active.entries[0]);
  assert.equal((await readModelPolicy(f.root, p.id)).entries[1].policy.project.model.value, 'two');
  assert.equal(await fs.readFile(f.root + '/.ai-org/work-items/WK-policy.json', 'utf8'), taskBefore);
});

test('native mutations reject stale versions, changed authority, wrong identity and scope', async t => {
  const f = await fixture(t), p = policy();
  await assert.rejects(saveModelPolicyDraft(f.root, {...f.request, expected_task_version: 1, policy: p}), /Stale task version/);
  await assert.rejects(saveModelPolicyDraft(f.root, {...f.request, actor: f.other, policy: p}), /matching implementation claim/);
  const draft = await saveModelPolicyDraft(f.root, {...f.request, policy: p});
  await assert.rejects(saveModelPolicyDraft(f.root, {...f.request, policy: p}), /Stale model policy version/);
  const request = {...f.request, expected_version: 1, policy_id: p.id, policy_version: 1, policy_sha256: '0'.repeat(64)};
  await assert.rejects(approveModelPolicy(f.root, request), /exact unapproved policy draft/);
  await fs.writeFile(f.root + '/docs/approval.md', 'Changed authority');
  await assert.rejects(approveModelPolicy(f.root, {...request, policy_sha256: draft.entries[0].sha256}), /Referenced approval.*changed/);
  const narrow = await fixture(t, {writePaths: ['src']});
  await assert.rejects(saveModelPolicyDraft(narrow.root, {...narrow.request, policy: policy()}), /outside the approved task write paths/);
});

test('concurrent same-version drafts yield one winner; superseded drafts and unsafe stores cannot approve', async t => {
  const f = await fixture(t), p = policy();
  const outcomes = await Promise.allSettled([saveModelPolicyDraft(f.root, {...f.request, policy: p}), saveModelPolicyDraft(f.root, {...f.request, policy: p})]);
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
  const prior = await readModelPolicy(f.root, p.id); p.version = 2;
  await saveModelPolicyDraft(f.root, {...f.request, expected_version: 1, policy: p});
  await assert.rejects(approveModelPolicy(f.root, {...f.request, expected_version: 2, policy_id: p.id, policy_version: 1, policy_sha256: prior.entries[0].sha256}), /supersedes/);
  const file = f.root + `/.ai-org/model-policies/${p.id}.json`;
  await fs.unlink(file); await fs.symlink(f.root + '/docs/approval.md', file);
  await assert.rejects(readModelPolicy(f.root, p.id));
});

test('policy storage rejects changed private ignore policy and non-approving claim owners', async t => {
  const f = await fixture(t), p = policy();
  const prior = await saveModelPolicyDraft(f.root, {...f.request, policy: p});
  await fs.writeFile(f.root + '/.ai-org/model-policies/.gitignore', '!*.json\n');
  await assert.rejects(approveModelPolicy(f.root, {...f.request, expected_version: 1, policy_id: p.id, policy_version: 1, policy_sha256: prior.entries[0].sha256}), /private ignore policy changed/);
  assert.equal((await readModelPolicy(f.root, p.id)).version, 1);
  const guest = await fixture(t, {actorPrincipal: 'guest'});
  const draft = await saveModelPolicyDraft(guest.root, {...guest.request, policy: p});
  await assert.rejects(approveModelPolicy(guest.root, {...guest.request, expected_version: 1, policy_id: p.id, policy_version: 1, policy_sha256: draft.entries[0].sha256}), /registered approving Principal/);
});

test('expired task authorization cannot persist a new model policy', async t => {
  const now = Date.now(), f = await fixture(t, {expiresAt: new Date(now + 300000).toISOString()});
  const originalNow = Date.now;
  try {
    Date.now = () => now + 600000;
    await assert.rejects(saveModelPolicyDraft(f.root, {...f.request, policy: policy()}), /approval expired/);
  } finally { Date.now = originalNow; }
  assert.equal((await readModelPolicy(f.root, policy().id)).version, 0);
});
