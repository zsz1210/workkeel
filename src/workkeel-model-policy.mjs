import fs from 'node:fs/promises';
import path from 'node:path';
import {durableAtomicCreate, durableAtomicWrite, formatJson, sha256} from './files.mjs';
import {withProjectMutationLock} from './project.mjs';
import {assertApprover, readTaskProject, safeDirectory} from './workkeel-project.mjs';
import {assertTaskExecutionContext} from './workkeel-tasks.mjs';
import {readTaskContractInput, readTaskFile} from './task-contract.mjs';
import {resolvePolicySettings} from './workkeel-model-policy-resolution.mjs';

const DIMENSIONS = ['model', 'reasoning', 'service'];
const RISKS = ['low', 'standard', 'high'];
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const digest = value => sha256(formatJson(value));
function keys(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      required.some(k => !Object.hasOwn(value, k)) || Object.keys(value).some(k => ![...required, ...optional].includes(k)))
    throw Error('Missing or unknown model policy fields');
}
function text(value, label = 'identifier') {
  if (typeof value !== 'string' || !ID.test(value) || ['constructor', 'prototype', '__proto__'].includes(value)) throw Error(`Invalid model policy ${label}`);
}
function list(value, label, {empty = false, max = 128} = {}) {
  if (!Array.isArray(value) || value.length > max || !empty && !value.length) throw Error(`Invalid model policy ${label}`);
  // Iteration checks holes as undefined; Array#some would silently miss them.
  for (const item of value) text(item, label);
  if (new Set(value).size !== value.length) throw Error(`Duplicate model policy ${label}`);
}
function integer(value, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw Error('Invalid model policy version');
}
function number(value, label, max = Infinity, nullable = false) {
  if (value === null && nullable) return;
  if (!Number.isFinite(value) || value < 0 || value > max) throw Error(`Invalid model policy ${label}`);
}
function dimension(value) {
  keys(value, ['mode'], ['value']);
  if (!['inherit', 'auto', 'fixed'].includes(value.mode)) throw Error('Invalid model policy mode');
  if (value.mode === 'fixed') text(value.value, 'fixed value');
  else if (Object.hasOwn(value, 'value')) throw Error('Only fixed model settings have a value');
}
function settings(value, full = false) {
  keys(value, full ? DIMENSIONS : [], full ? [] : DIMENSIONS);
  if (!Object.keys(value).length) throw Error('Model policy settings cannot be empty');
  for (const setting of Object.values(value)) dimension(setting);
}

/** Provider effort labels remain opaque and model-specific, never ordinal conversions. */
export function validateModelPolicy(policy) {
  keys(policy, ['schema_version', 'id', 'version', 'project', 'rules', 'models']);
  if (policy.schema_version !== 'workkeel.model-policy/v1') throw Error('Unsupported model policy schema');
  text(policy.id); integer(policy.version, 1); settings(policy.project, true);
  if (!Array.isArray(policy.models) || !policy.models.length || policy.models.length > 128) throw Error('Approved policy models are required');
  const ids = new Set(), connections = new Set();
  for (const model of policy.models) {
    keys(model, ['id', 'provider', 'model', 'data_classes', 'risk_tiers', 'quality', 'reasoning_efforts', 'service_tiers', 'auto_efforts', 'auto_service', 'cost', 'quota_remaining']);
    text(model.id); text(model.provider); text(model.model);
    const connection = `${model.provider}/${model.model}`;
    if (ids.has(model.id) || connections.has(connection)) throw Error('Duplicate model policy model or provider connection');
    ids.add(model.id); connections.add(connection);
    list(model.data_classes, 'data classes'); list(model.risk_tiers, 'risk tiers');
    if (model.data_classes.some(x => !['public', 'internal', 'sensitive'].includes(x)) || model.risk_tiers.some(x => !RISKS.includes(x))) throw Error('Invalid model data or risk policy');
    number(model.quality, 'quality', 100); number(model.cost, 'cost', Infinity, true); number(model.quota_remaining, 'quota', Infinity, true);
    list(model.reasoning_efforts, 'reasoning efforts'); list(model.service_tiers, 'service tiers');
    keys(model.auto_efforts, RISKS);
    for (const effort of Object.values(model.auto_efforts)) if (!model.reasoning_efforts.includes(effort)) throw Error('Automatic effort must be a supported provider-specific label');
    if (!model.service_tiers.includes(model.auto_service)) throw Error('Automatic service must be supported');
  }
  if (!Array.isArray(policy.rules) || policy.rules.length > 256) throw Error('Invalid model policy rules');
  const rules = new Set();
  for (const rule of policy.rules) {
    keys(rule, ['id', 'layer', 'match', 'settings'], ['task']); text(rule.id); text(rule.match); settings(rule.settings);
    if (Object.hasOwn(rule, 'task')) { text(rule.task, 'task scope'); if (rule.layer !== 'activity') throw Error('Only activity rules may narrow to a task'); }
    if (rules.has(rule.id) || !['activity', 'role', 'task', 'node'].includes(rule.layer)) throw Error('Invalid or duplicate model policy rule');
    rules.add(rule.id);
  }
  for (const setting of [policy.project, ...policy.rules.map(r => r.settings)])
    if (setting.model?.mode === 'fixed' && !ids.has(setting.model.value)) throw Error('Fixed model is absent from the approved policy models');
  if (Buffer.byteLength(formatJson(policy)) > 262144) throw Error('Model policy exceeds 256 KiB');
  return policy;
}

/** Independent dimensions; activity and role share precedence and cannot disagree. */
export function resolveModelPolicy(policy, context = {}) {
  validateModelPolicy(policy); keys(context, [], ['activity', 'role', 'task', 'node']);
  for (const value of Object.values(context)) text(value);
  return resolvePolicySettings(policy, context);
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function hostModels(models) {
  if (!Array.isArray(models) || models.length > 256) throw Error('Actual host model support is required');
  const connections = new Set();
  for (const model of models) {
    keys(model, ['provider', 'model', 'reasoning_efforts', 'service_tiers']); text(model.provider); text(model.model);
    list(model.reasoning_efforts, 'host efforts', {empty: true}); list(model.service_tiers, 'host services', {empty: true});
    const connection = `${model.provider}/${model.model}`;
    if (connections.has(connection)) throw Error('Duplicate host model connection');
    connections.add(connection);
  }
}

/** Read-only resolution. Authority and actual host support are hard constraints before resource ranking. */
export function selectModelPolicy(policy, context) {
  keys(context, ['authority', 'host_models'], ['activity', 'role', 'task', 'node', 'reported', 'pinned']);
  const selectors = Object.fromEntries(['activity', 'role', 'task', 'node'].filter(k => Object.hasOwn(context, k)).map(k => [k, context[k]]));
  const {requested, sources} = resolveModelPolicy(policy, selectors);
  const authority = context.authority;
  keys(authority, ['allowed_models', 'data_class', 'risk_tier', 'min_quality']);
  list(authority.allowed_models, 'authority allowlist', {empty: true});
  if (!['public', 'internal', 'sensitive'].includes(authority.data_class) || !RISKS.includes(authority.risk_tier)) throw Error('Invalid authority data class or risk tier');
  number(authority.min_quality, 'minimum quality', 100); hostModels(context.host_models);
  const rejected = [], eligible = [];
  for (const model of policy.models) {
    const host = context.host_models.find(h => h.provider === model.provider && h.model === model.model);
    const effort = requested.reasoning.mode === 'fixed' ? requested.reasoning.value : model.auto_efforts[authority.risk_tier];
    const service = requested.service.mode === 'fixed' ? requested.service.value : model.auto_service;
    const reasons = [];
    if (!authority.allowed_models.includes(model.id)) reasons.push('outside-allowlist');
    if (!model.data_classes.includes(authority.data_class)) reasons.push('data-boundary');
    if (!model.risk_tiers.includes(authority.risk_tier)) reasons.push('risk-boundary');
    if (model.quality < authority.min_quality) reasons.push('quality-floor');
    if (!host) reasons.push('host-model-unavailable');
    if (!model.reasoning_efforts.includes(effort) || !host?.reasoning_efforts.includes(effort)) reasons.push('host-effort-unavailable');
    if (!model.service_tiers.includes(service) || !host?.service_tiers.includes(service)) reasons.push('host-service-unavailable');
    if (reasons.length) rejected.push({id: model.id, reasons});
    else eligible.push({model, effort, service});
  }
  let chosen;
  if (requested.model.mode === 'fixed') {
    chosen = eligible.find(e => e.model.id === requested.model.value);
    if (!chosen) throw Error(`Fixed model ${requested.model.value} is unavailable or prohibited; no fallback: ${rejected.find(r => r.id === requested.model.value)?.reasons.join(',')}`);
    if (chosen.model.quota_remaining === 0) throw Error('Fixed model quota exhausted; no fallback');
  } else {
    // Deterministic explicit cost/quota observations, not model calls or inferred rankings.
    const available = eligible.filter(e => e.model.quota_remaining !== 0);
    available.sort((a, b) => (a.model.cost ?? Infinity) - (b.model.cost ?? Infinity) ||
      (b.model.quota_remaining ?? -1) - (a.model.quota_remaining ?? -1) ||
      b.model.quality - a.model.quality || (a.model.id < b.model.id ? -1 : a.model.id > b.model.id ? 1 : 0));
    chosen = available[0];
    if (!chosen) throw Error('No eligible approved host model with available quota');
  }
  const reported = {model: null, reasoning: null, service: null};
  if (context.reported !== undefined) {
    keys(context.reported, [], DIMENSIONS);
    for (const [key, value] of Object.entries(context.reported)) {
      if (value !== null) text(value, 'reported value');
      reported[key] = value;
    }
  }
  const snapshot = {schema_version: 'workkeel.model-snapshot/v1', policy_version: policy.version,
    source: {policy_id: policy.id, policy_sha256: digest(policy), dimensions: sources}, requested,
    selected: {id: chosen.model.id, provider: chosen.model.provider, model: chosen.model.model, reasoning: chosen.effort, service: chosen.service},
    reported, report_status: Object.values(reported).every(x => x === null) ? 'unknown' : Object.values(reported).some(x => x === null) ? 'partial' : 'reported',
    rejected, execution_authorized: false, dispatch_performed: false};
  if (context.pinned !== undefined) {
    validateModelSnapshot(context.pinned);
    for (const key of ['policy_version', 'source', 'requested', 'selected'])
      if (digest(context.pinned[key]) !== digest(snapshot[key])) throw Error('Pinned model snapshot cannot change; preserve the immutable task policy');
  }
  return freeze(snapshot);
}

export function validateModelSnapshot(snapshot) {
  keys(snapshot, ['schema_version', 'policy_version', 'source', 'requested', 'selected', 'reported', 'report_status', 'rejected', 'execution_authorized', 'dispatch_performed']);
  if (snapshot.schema_version !== 'workkeel.model-snapshot/v1' || snapshot.execution_authorized !== false || snapshot.dispatch_performed !== false) throw Error('Invalid model snapshot schema or authority');
  integer(snapshot.policy_version, 1); keys(snapshot.source, ['policy_id', 'policy_sha256', 'dimensions']); text(snapshot.source.policy_id);
  if (!/^[a-f0-9]{64}$/.test(snapshot.source.policy_sha256)) throw Error('Invalid model snapshot source digest');
  keys(snapshot.source.dimensions, DIMENSIONS);
  for (const source of Object.values(snapshot.source.dimensions))
    if (typeof source !== 'string' || !source || source.length > 32768 || !/^[A-Za-z0-9._,:-]+$/.test(source)) throw Error('Invalid model snapshot dimension source');
  settings(snapshot.requested, true);
  if (Object.values(snapshot.requested).some(s => s.mode === 'inherit')) throw Error('Unresolved inherited snapshot dimension');
  keys(snapshot.selected, ['id', 'provider', 'model', 'reasoning', 'service']);
  for (const value of Object.values(snapshot.selected)) text(value);
  for (const name of DIMENSIONS) {
    const selected = name === 'model' ? snapshot.selected.id : snapshot.selected[name];
    if (snapshot.requested[name].mode === 'fixed' && snapshot.requested[name].value !== selected) throw Error('Snapshot fixed request differs from selection');
  }
  keys(snapshot.reported, DIMENSIONS);
  for (const value of Object.values(snapshot.reported)) if (value !== null) text(value);
  const status = Object.values(snapshot.reported).every(x => x === null) ? 'unknown' : Object.values(snapshot.reported).some(x => x === null) ? 'partial' : 'reported';
  if (snapshot.report_status !== status) throw Error('Snapshot report status differs from actual reported dimensions');
  if (!Array.isArray(snapshot.rejected) || snapshot.rejected.length > 128) throw Error('Invalid snapshot rejected models');
  const ids = new Set();
  for (const rejection of snapshot.rejected) {
    keys(rejection, ['id', 'reasons']); text(rejection.id); list(rejection.reasons, 'rejection reasons');
    if (ids.has(rejection.id) || rejection.id === snapshot.selected.id || rejection.reasons.some(r => !['outside-allowlist', 'data-boundary', 'risk-boundary', 'quality-floor', 'host-model-unavailable', 'host-effort-unavailable', 'host-service-unavailable'].includes(r))) throw Error('Invalid snapshot rejection');
    ids.add(rejection.id);
  }
  return snapshot;
}

const storeRef = id => { text(id); return `.ai-org/model-policies/${id}.json`; };
function validateStore(store, id) {
  keys(store, ['schema_version', 'id', 'version', 'active_version', 'entries']);
  if (store.schema_version !== 'workkeel.model-policy-store/v1' || store.id !== id) throw Error('Invalid model policy store');
  integer(store.version);
  if (!Array.isArray(store.entries) || store.entries.length > 256) throw Error('Invalid model policy history');
  let operations = store.entries.length;
  for (const [index, entry] of store.entries.entries()) {
    keys(entry, ['policy', 'sha256', 'drafted_by', 'task_pin', 'approval']);
    validateModelPolicy(entry.policy);
    if (entry.policy.id !== id || entry.policy.version !== index + 1 || entry.sha256 !== digest(entry.policy)) throw Error('Model policy version or digest changed');
    keys(entry.drafted_by, ['agent_id', 'principal_id']); text(entry.drafted_by.agent_id); text(entry.drafted_by.principal_id);
    keys(entry.task_pin, ['task_id', 'version', 'contract_sha256']); text(entry.task_pin.task_id); integer(entry.task_pin.version, 1);
    if (!/^[a-f0-9]{64}$/.test(entry.task_pin.contract_sha256)) throw Error('Invalid model policy task pin');
    if (entry.approval !== null) {
      keys(entry.approval, ['actor', 'task_pin', 'policy_sha256']); keys(entry.approval.actor, ['agent_id', 'principal_id']);
      text(entry.approval.actor.agent_id); text(entry.approval.actor.principal_id);
      if (entry.approval.policy_sha256 !== entry.sha256 || digest(entry.approval.task_pin) !== digest(entry.task_pin)) throw Error('Model policy approval pin differs');
      operations++;
    }
  }
  const active = [...store.entries].reverse().find(e => e.approval !== null)?.policy.version ?? null;
  if (store.version !== operations || store.active_version !== active) throw Error('Model policy store operation version or active pin changed');
  return store;
}

/** Draft history is private and append-only logically. Never edits existing native task records. */
export async function readModelPolicy(target, id) {
  const ref = storeRef(id);
  try {
    const {document} = await readTaskContractInput(target, ref);
    keys(document, ['value', 'sha256']);
    if (digest(document.value) !== document.sha256) throw Error('Model policy store integrity failure');
    return freeze(validateStore(document.value, id));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return freeze({schema_version: 'workkeel.model-policy-store/v1', id, version: 0, active_version: null, entries: []});
  }
}
async function authorize(target, request) {
  const item = await assertTaskExecutionContext(target, request.task_id, request);
  if (item.version !== request.expected_task_version) throw Error('Stale task version; inspect current authority');
  if (!item.contract.authorization.operations.includes('write')) throw Error('Policy update requires task write authority');
  const ref = storeRef(request.policy?.id ?? request.policy_id);
  const canWrite = file => item.contract.environment.write_paths.some(root => root === '.' || file === root || file.startsWith(`${root}/`));
  if (!canWrite(ref) || !canWrite('.ai-org/model-policies/.gitignore')) throw Error('Policy store is outside the approved task write paths');
  if (item.contract.authorization.expires_at !== null && Date.parse(item.contract.authorization.expires_at) <= Date.now()) throw Error('Task approval expired');
  return item;
}
async function saveStore(target, store, first) {
  validateStore(store, store.id);
  if (Buffer.byteLength(formatJson(store)) > 1048576) throw Error('Model policy store exceeds 1 MiB; preserve history and use a successor policy');
  await safeDirectory(target, '.ai-org/model-policies', {create: true});
  const ignoreRef = '.ai-org/model-policies/.gitignore';
  try { await durableAtomicCreate(path.join(target, ignoreRef), '*\n'); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if ((await readTaskFile(target, ignoreRef)).content !== '*\n') throw Error('Model policy private ignore policy changed');
  }
  const file = path.join(target, storeRef(store.id)), content = formatJson({value: store, sha256: digest(store)});
  if (first) await durableAtomicCreate(file, content); else await durableAtomicWrite(file, content);
  return freeze(structuredClone(store));
}
function requestKeys(request, additional) {
  keys(request, ['task_id', 'actor', 'claim_id', 'expected_task_version', 'expected_version', ...additional], ['contract_sha256']);
  text(request.task_id); text(request.claim_id); integer(request.expected_task_version, 1); integer(request.expected_version);
}
export async function saveModelPolicyDraft(targetInput, request) {
  requestKeys(request, ['policy']); validateModelPolicy(request.policy);
  // Snapshot caller input before awaiting: later edits cannot alter what is authorized.
  request = structuredClone(request);
  const target = await fs.realpath(targetInput);
  return withProjectMutationLock(target, async () => {
    const item = await authorize(target, request), prior = await readModelPolicy(target, request.policy.id);
    if (prior.version !== request.expected_version) throw Error('Stale model policy version');
    if (request.policy.version !== prior.entries.length + 1) throw Error('New policy draft requires the next immutable version');
    const store = structuredClone(prior);
    store.entries.push({policy: request.policy, sha256: digest(request.policy), drafted_by: request.actor,
      task_pin: {task_id: item.id, version: item.version, contract_sha256: item.contract_sha256}, approval: null});
    store.version++;
    return saveStore(target, store, prior.version === 0);
  });
}
export async function approveModelPolicy(targetInput, request) {
  requestKeys(request, ['policy_id', 'policy_version', 'policy_sha256']); text(request.policy_id); integer(request.policy_version, 1);
  if (!/^[a-f0-9]{64}$/.test(request.policy_sha256)) throw Error('Exact policy digest is required for approval');
  request = structuredClone(request);
  const target = await fs.realpath(targetInput);
  return withProjectMutationLock(target, async () => {
    const item = await authorize(target, request), project = await readTaskProject(target);
    assertApprover(project.policy, request.actor);
    const prior = await readModelPolicy(target, request.policy_id);
    if (prior.version !== request.expected_version) throw Error('Stale model policy version');
    const store = structuredClone(prior), entry = store.entries.find(e => e.policy.version === request.policy_version);
    if (!entry || entry.sha256 !== request.policy_sha256 || entry.approval !== null) throw Error('Approve an exact unapproved policy draft');
    if (entry.policy.version !== store.entries.length) throw Error('A newer policy draft supersedes this approval request');
    if (entry.task_pin.task_id !== item.id || entry.task_pin.version !== item.version || entry.task_pin.contract_sha256 !== item.contract_sha256) throw Error('Policy draft task authority changed');
    entry.approval = {actor: request.actor, task_pin: entry.task_pin, policy_sha256: entry.sha256};
    store.active_version = entry.policy.version; store.version++;
    return saveStore(target, store, false);
  });
}
