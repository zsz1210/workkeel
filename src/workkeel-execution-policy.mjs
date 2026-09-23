import { formatJson, sha256 } from "./files.mjs";
import { codexModelConnectionParams } from "./workkeel-runtime.mjs";

export const executionDigest = value => sha256(formatJson(value));
export const EXECUTION_ID = /^[a-z][a-z0-9-]{0,63}$/;
export function exactKeys(value, required, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      required.some(key => !Object.hasOwn(value, key)) ||
      Object.keys(value).some(key => ![...required, ...optional].includes(key))) throw new Error("Missing or unknown execution fields");
}
export function boundedInteger(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${label}`);
}
function identifier(value) {
  if (typeof value !== "string" || !EXECUTION_ID.test(value) || ["constructor", "prototype"].includes(value)) throw new Error("Invalid execution identifier");
}
export function validateExecutionPolicy(policy) {
  exactKeys(policy, ["schema_version", "models", "default_model", "rules", "limits", "headroom"], ["fallbacks"]);
  if (policy.schema_version !== "workkeel.execution-policy/v1") throw new Error("Unsupported execution policy");
  if (!Array.isArray(policy.models) || !policy.models.length || policy.models.length > 32) throw new Error("An approved model list is required");
  const ids = new Set();
  for (const model of policy.models) {
    exactKeys(model, ["id", "connection", "data_classes"]); identifier(model.id);
    if (ids.has(model.id)) throw new Error("Duplicate approved model"); ids.add(model.id);
    codexModelConnectionParams(model.connection);
    if (Buffer.byteLength(formatJson(model.connection)) > 4096) throw new Error("Model connection exceeds the bounded configuration size");
    if (!Array.isArray(model.data_classes) || !model.data_classes.length ||
        model.data_classes.some(value => !["public", "internal"].includes(value)) ||
        new Set(model.data_classes).size !== model.data_classes.length) throw new Error("Invalid model data policy");
  }
  if (!ids.has(policy.default_model)) throw new Error("Default model is not approved");
  if (!Array.isArray(policy.rules) || policy.rules.length > 64) throw new Error("Invalid routing rules");
  const ruleIds = new Set(), routedNodes = new Set();
  for (const rule of policy.rules) {
    exactKeys(rule, ["id", "nodes", "model"]); identifier(rule.id);
    if (ruleIds.has(rule.id) || !ids.has(rule.model) || !Array.isArray(rule.nodes) || !rule.nodes.length ||
        new Set(rule.nodes).size !== rule.nodes.length) throw new Error("Invalid routing rule");
    for (const node of rule.nodes) {
      identifier(node);
      if (routedNodes.has(node)) throw new Error("Routing rules cannot overlap; use one rule or an explicit node override");
      routedNodes.add(node);
    }
    ruleIds.add(rule.id);
  }
  if (policy.fallbacks !== undefined) {
    if (!Array.isArray(policy.fallbacks) || policy.fallbacks.length > 100) throw new Error("Invalid fallback policy");
    const nodes = new Set();
    for (const fallback of policy.fallbacks) {
      exactKeys(fallback, ["node", "models"]); identifier(fallback.node);
      if (nodes.has(fallback.node) || !Array.isArray(fallback.models) || fallback.models.length < 2 || fallback.models.length > 10 ||
          new Set(fallback.models).size !== fallback.models.length || fallback.models.some(id => !ids.has(id))) throw new Error("Fallback must name a distinct approved model sequence");
      nodes.add(fallback.node);
    }
  }
  exactKeys(policy.limits, ["steps", "attempts_per_node", "parallelism", "timeout_ms", "max_cost_usd"]);
  boundedInteger(policy.limits.steps, 1, 1000, "step limit");
  boundedInteger(policy.limits.attempts_per_node, 1, 10, "attempt limit");
  if (policy.fallbacks?.some(fallback => fallback.models.length > policy.limits.attempts_per_node)) throw new Error("Attempt limit must cover the approved fallback sequence");
  boundedInteger(policy.limits.parallelism, 1, 16, "parallelism");
  boundedInteger(policy.limits.timeout_ms, 1, 86400000, "timeout");
  if (policy.limits.max_cost_usd !== null && (!Number.isFinite(policy.limits.max_cost_usd) || policy.limits.max_cost_usd <= 0)) throw new Error("Invalid cost limit");
  exactKeys(policy.headroom, ["mode"]);
  if (!["off", "lossless"].includes(policy.headroom.mode)) throw new Error("Unsupported Headroom policy; lossy compression requires separate approval");
  return policy;
}

/** Pure, explainable selection. No provider contact or capability guesses. */
export function selectNodeModel(policy, { node, explicit = null, dataClass, modelAccess, network, pinned = null }) {
  validateExecutionPolicy(policy); identifier(node);
  const rule = policy.rules.find(entry => entry.nodes.includes(node));
  const id = explicit ?? rule?.model ?? policy.default_model;
  const approved = policy.models.find(entry => entry.id === id);
  if (!approved || !approved.data_classes.includes(dataClass)) throw new Error("No eligible approved model for this data");
  if (approved.connection.kind === "codex-subscription" && modelAccess !== "approved-connection") throw new Error("Selected subscription model violates the task data boundary");
  if (approved.connection.kind === "gateway" && (modelAccess !== "approved-connection" ||
      network?.mode !== "allowlist" || !network.hosts.includes(new URL(approved.connection.base_url).hostname))) throw new Error("Selected model violates the task data or network boundary");
  const selected = { id, connection: approved.connection, fingerprint: executionDigest(approved.connection),
    reason: explicit !== null ? "explicit" : rule ? `rule:${rule.id}` : "default" };
  if (pinned && (pinned.id !== selected.id || pinned.fingerprint !== selected.fingerprint)) throw new Error("Pinned model cannot change on resume");
  return selected;
}

/** Trusted runtime implementations are supplied by the embedding host, never by graph JSON. */
export function validateRuntimeAdapter(adapter) {
  if (!adapter || !EXECUTION_ID.test(adapter.id ?? "") ||
      ["assertCompatible", "start", "resume", "cancel"].some(key => typeof adapter[key] !== "function")) throw new Error("Runtime adapter requires compatibility, start, resume and cancel operations");
  return adapter;
}
export function validateRuntimeResult(result) {
  exactKeys(result, ["status", "conversation_id", "output", "outcome", "observed_model", "usage"], ["runtime_model"]);
  if (!["completed", "failed", "interrupted", "not-started"].includes(result.status) ||
      result.conversation_id !== null && (typeof result.conversation_id !== "string" || result.conversation_id.length > 200) ||
      typeof result.output !== "string" || Buffer.byteLength(result.output) > 65536 ||
      !EXECUTION_ID.test(result.outcome ?? "") ||
      result.observed_model !== null && (typeof result.observed_model !== "string" || result.observed_model.length > 200)) throw new Error("Invalid bounded runtime result");
  if (result.runtime_model !== undefined && result.runtime_model !== null && (typeof result.runtime_model !== "string" || result.runtime_model.length > 200)) throw new Error("Invalid runtime-confirmed model");
  exactKeys(result.usage, ["input_tokens", "output_tokens", "cost_usd"]);
  for (const [key, value] of Object.entries(result.usage)) if (value !== null &&
      (!Number.isFinite(value) || value < 0 || key !== "cost_usd" && !Number.isSafeInteger(value))) throw new Error("Invalid runtime usage; unavailable values must be null");
  if (result.status === "not-started" && (result.conversation_id !== null || result.observed_model !== null || Object.values(result.usage).some(value => value !== 0))) throw new Error("Not-started requires confirmed zero model dispatch and no conversation");
  return result;
}
