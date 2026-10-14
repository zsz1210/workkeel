import path from 'node:path';
import {exactKeys, executionDigest, selectNodeModel} from './workkeel-execution-policy.mjs';
import {readModelPolicy, selectModelPolicy, validateModelSnapshot} from './workkeel-model-policy.mjs';
import {assertApprover, readTaskProject, safeDirectory} from './workkeel-project.mjs';
import {readNativeTask} from './workkeel-tasks.mjs';
import {readTaskFile} from './task-contract.mjs';
import {durableAtomicCreate, formatJson} from './files.mjs';

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const fail = message => { throw Error(`Model routing: ${message}`); };
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function id(value) { if (typeof value !== 'string' || !ID.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value)) fail('invalid identifier'); }
function sha(value) { if (!/^[a-f0-9]{64}$/.test(value ?? '')) fail('exact digest required'); }
function list(values) {
  if (!Array.isArray(values) || !values.length || values.length > 32 || new Set(values).size !== values.length) fail('invalid supported dimension list');
  for (const value of values) id(value);
}
export function validateModelPolicyPin(pin, {bridge = false} = {}) {
  exactKeys(pin, ['policy_id', 'version', 'sha256', ...(bridge ? ['min_quality'] : [])], bridge ? [] : ['context']);
  id(pin.policy_id); sha(pin.sha256);
  if (!Number.isSafeInteger(pin.version) || pin.version < 1) fail('invalid policy version');
  if (bridge && (!Number.isFinite(pin.min_quality) || pin.min_quality < 0 || pin.min_quality > 100)) fail('invalid approved quality floor');
  if (pin.context !== undefined) { exactKeys(pin.context, [], ['role']); if (pin.context.role !== undefined) id(pin.context.role); }
  return pin;
}
export function validateRoutingDimensions(model) {
  if (model.reasoning_efforts !== undefined) list(model.reasoning_efforts);
  if (model.service_tiers !== undefined) list(model.service_tiers);
}
export function assertModelPolicyRequest(bridge, requestPin) {
  validateModelPolicyPin(bridge, {bridge: true});
  const pin = requestPin ?? {policy_id: bridge.policy_id, version: bridge.version, sha256: bridge.sha256};
  validateModelPolicyPin(pin);
  if (pin.policy_id !== bridge.policy_id || pin.version !== bridge.version || pin.sha256 !== bridge.sha256) fail('request policy differs from explicitly approved contract policy pin');
  return structuredClone(pin);
}
export async function readApprovedModelPolicy(target, pin, {require_active = false} = {}) {
  validateModelPolicyPin(pin);
  const store = await readModelPolicy(target, pin.policy_id), entry = store.entries.find(e => e.policy.version === pin.version);
  if (!entry || entry.sha256 !== pin.sha256 || !entry.approval) fail('exact approved model policy version is unavailable');
  if (require_active && store.active_version !== pin.version) fail('new execution requires the approved active model policy version; obtain a new contract pin');
  const project = await readTaskProject(target); assertApprover(project.policy, entry.approval.actor);
  const origin = await readNativeTask(target, entry.task_pin.task_id);
  if (origin.contract_sha256 !== entry.task_pin.contract_sha256 || origin.version < entry.task_pin.version || origin.history[entry.task_pin.version - 1]?.action !== 'claim') fail('model policy approval task provenance changed');
  return entry.policy;
}

/** Approved tuple lists constrain routing; a policy editor never supplies its own authority. */
export async function resolveDispatchModelRouting(target, task, authority, {model_policy, capabilities, node, route = {}}, {historical = false} = {}) {
  if (!authority.model_policy) fail('layered routing requires an explicitly pinned approved policy bridge');
  const pin = assertModelPolicyRequest(authority.model_policy, model_policy);
  const policy = await readApprovedModelPolicy(target, pin, {require_active: !historical});
  const restrictedAlias = route.risk === 'high' ? authority.conservative_alias : route.alias;
  const approved = authority.models.filter(m => (!restrictedAlias || m.alias === restrictedAlias) && m.data_classes.includes(task.contract.environment.data.classification));
  const allowedModels = policy.models.filter(m => approved.some(a => a.provider === m.provider && a.model === m.model)).map(m => m.id);
  const hostModels = [];
  for (const host of capabilities.models) {
    const matching = approved.filter(a => a.provider === host.provider && a.model === host.model);
    const reasoning = [...new Set(matching.flatMap(a => a.reasoning_efforts ?? (a.reasoning === null ? [] : [a.reasoning])))];
    const services = [...new Set(matching.flatMap(a => a.service_tiers ?? []))];
    hostModels.push({provider: host.provider, model: host.model,
      reasoning_efforts: host.reasoning.filter(e => e !== null && reasoning.includes(e)),
      service_tiers: (host.service_tiers ?? []).filter(t => services.includes(t))});
  }
  const snapshot = selectModelPolicy(policy, {task: task.id, node: node.id, activity: node.activity_kind,
    ...(pin.context?.role ? {role: pin.context.role} : {}), authority: {allowed_models: allowedModels,
      data_class: task.contract.environment.data.classification, risk_tier: route.risk === 'high' ? 'high' : task.contract.verification.risk_tier,
      min_quality: authority.model_policy.min_quality}, host_models: hostModels});
  const selected = snapshot.selected;
  const matches = approved.filter(a => a.provider === selected.provider && a.model === selected.model &&
    (a.reasoning_efforts ?? [a.reasoning]).includes(selected.reasoning) && (a.service_tiers ?? []).includes(selected.service));
  if (matches.length !== 1) fail('selected tuple lacks one exact approved dispatch connection');
  return {pin, snapshot, model: {...structuredClone(matches[0]), reasoning: selected.reasoning, service: selected.service}};
}

/** An attributed host acknowledgement is required; capability metadata alone is not execution proof. */
export function assertRoutingAcknowledgement(ticket, request) {
  exactKeys(request, ['capabilities', 'runtime_selection']);
  validateModelSnapshot(ticket.model_snapshot);
  exactKeys(request.runtime_selection, ['provider', 'model', 'reasoning', 'service']);
  for (const value of Object.values(request.runtime_selection)) id(value);
  const {provider, model, reasoning, service} = ticket.model_snapshot.selected;
  if (executionDigest(request.runtime_selection) !== executionDigest({provider, model, reasoning, service})) fail('actual runtime acknowledgement differs from the pinned provider/model/reasoning/service tuple');
  if (!request.capabilities || executionDigest(request.capabilities) !== ticket.capability_sha256) fail('actual host capability fingerprint differs from the prepared ticket');
  if (request.capabilities.host !== ticket.requested_host || !request.capabilities.models.some(m => m.provider === provider && m.model === model && m.reasoning.includes(reasoning) && m.service_tiers?.includes(service))) fail('selected tuple is unsupported by the acknowledged host');
}
export function validateRoutingTuple(value) {
  exactKeys(value, ['provider', 'model', 'reasoning', 'service']);
  for (const dimension of Object.values(value)) id(dimension);
  return value;
}
export function validateWorkflowRoutingAuthority(model) {
  exactKeys(model.routing, ['provider', 'model', 'reasoning_efforts', 'service_tiers']);
  id(model.routing.provider); id(model.routing.model); validateRoutingDimensions(model.routing);
  if (model.connection?.kind === 'codex-subscription' && (model.routing.provider !== 'openai' || model.routing.model !== model.connection.model ||
      model.routing.reasoning_efforts.length !== 1 || model.routing.reasoning_efforts[0] !== model.connection.effort)) fail('subscription routing must retain its exact approved provider/model/effort connection');
  if (model.connection?.kind === 'gateway' && model.routing.model !== model.connection.model) fail('gateway routing cannot change its fixed approved model');
  return model.routing;
}
export async function resolveWorkflowModelRouting(target, task, authority, {model_policy, capabilities, node}, {historical = false} = {}) {
  if (!authority.model_policy) fail('workflow routing requires an explicitly pinned approved policy bridge');
  const pin = assertModelPolicyRequest(authority.model_policy, model_policy);
  const policy = await readApprovedModelPolicy(target, pin, {require_active: !historical});
  if (task.contract.environment.data.model_access !== 'approved-connection') fail('workflow routing requires approved model data access');
  const route = authority.rules.find(rule => rule.nodes.includes(node.id));
  const fixedId = node.model ?? route?.model;
  const approved = [];
  for (const entry of authority.models) {
    if (!entry.routing || fixedId && entry.id !== fixedId) continue;
    try {
      const selected = selectNodeModel(authority, {node: node.id, explicit: entry.id, dataClass: task.contract.environment.data.classification,
        modelAccess: task.contract.environment.data.model_access, network: task.contract.environment.network});
      approved.push({entry, selected});
    } catch { /* Connections outside the fixed task data/network authority are ineligible. */ }
  }
  const hostModels = capabilities.models.map(host => {
    const matching = approved.filter(a => a.entry.routing.provider === host.provider && a.entry.routing.model === host.model);
    return {provider: host.provider, model: host.model,
      reasoning_efforts: host.reasoning.filter(e => e !== null && matching.some(a => a.entry.routing.reasoning_efforts.includes(e))),
      service_tiers: (host.service_tiers ?? []).filter(t => matching.some(a => a.entry.routing.service_tiers.includes(t)))};
  });
  const context = authority.model_contexts?.find(c => c.node === node.id);
  if (context?.role && pin.context?.role && context.role !== pin.context.role) fail('requested role conflicts with approved workflow node context');
  const role = context?.role ?? pin.context?.role;
  const snapshot = selectModelPolicy(policy, {task: task.id, node: node.id, activity: context?.activity ?? node.id, ...(role ? {role} : {}),
    authority: {allowed_models: policy.models.filter(m => approved.some(a => a.entry.routing.provider === m.provider && a.entry.routing.model === m.model)).map(m => m.id),
      data_class: task.contract.environment.data.classification, risk_tier: task.contract.verification.risk_tier, min_quality: authority.model_policy.min_quality}, host_models: hostModels});
  const tuple = Object.fromEntries(['provider', 'model', 'reasoning', 'service'].map(key => [key, snapshot.selected[key]]));
  const matches = approved.filter(a => a.entry.routing.provider === tuple.provider && a.entry.routing.model === tuple.model &&
    a.entry.routing.reasoning_efforts.includes(tuple.reasoning) && a.entry.routing.service_tiers.includes(tuple.service));
  if (matches.length !== 1) fail('workflow tuple lacks one exact approved connection');
  const selection = {...matches[0].selected, reason: 'layered-model-policy', model_policy: pin, model_snapshot: snapshot,
    runtime_selection: tuple, capability_sha256: executionDigest(capabilities), requested_host: capabilities.host};
  return {pin, selection: freeze(structuredClone(selection))};
}
export function assertWorkflowRuntimeSelection(selection, reported) {
  if (!selection.model_snapshot) return;
  validateModelSnapshot(selection.model_snapshot); validateRoutingTuple(reported);
  const expected = Object.fromEntries(['provider', 'model', 'reasoning', 'service'].map(k => [k, selection.model_snapshot.selected[k]]));
  if (executionDigest(selection.runtime_selection) !== executionDigest(expected)) fail('workflow tuple differs from its immutable model snapshot');
  if (executionDigest(expected) !== executionDigest(reported)) fail('workflow runtime acknowledgement differs from its pinned provider/model/reasoning/service tuple');
}
export async function recordRoutingBinding(target, ticket, request) {
  assertRoutingAcknowledgement(ticket, {capabilities: request.capabilities, runtime_selection: request.runtime_selection});
  const directory = await safeDirectory(target, '.ai-org/model-routing', {create: true});
  const ignoreRef = '.ai-org/model-routing/.gitignore';
  try { await durableAtomicCreate(path.join(directory, '.gitignore'), '*\n'); }
  catch (error) { if (error.code !== 'EEXIST') throw error; if ((await readTaskFile(target, ignoreRef)).content !== '*\n') fail('private routing ignore policy changed'); }
  const receipt = {schema_version: 'workkeel.model-routing-binding/v1', execution_id: ticket.execution_id,
    ticket_sha256: executionDigest(ticket), model_snapshot_sha256: executionDigest(ticket.model_snapshot), capability_sha256: ticket.capability_sha256,
    source_sha256: executionDigest(request.source), source: structuredClone(request.source), runtime_selection: structuredClone(request.runtime_selection),
    proof_kind: 'attributed-host-acknowledgement', provider_authenticated: false};
  const ref = `.ai-org/model-routing/${ticket.execution_id}.json`, content = formatJson({value: receipt, sha256: executionDigest(receipt)});
  try { await durableAtomicCreate(path.join(directory, `${ticket.execution_id}.json`), content); }
  catch (error) { if (error.code !== 'EEXIST') throw error; if ((await readTaskFile(target, ref)).content !== content) fail('runtime binding acknowledgement cannot change'); }
  return {ref, sha256: executionDigest(receipt), runtime_selection: receipt.runtime_selection, proof_kind: receipt.proof_kind};
}
