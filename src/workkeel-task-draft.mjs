import { TASK_CONTRACT_SCHEMA } from "./task-contract.mjs";
import { contractRiskFloor } from "./workkeel-risk.mjs";

const object = value => value && typeof value === "object" && !Array.isArray(value);
// Adds only absent keys, in place, so a complete contract keeps its exact bytes and digest.
function fill(target, defaults) {
  for (const [key, value] of Object.entries(defaults)) if (target[key] === undefined) target[key] = value;
  return target;
}

/**
 * Completes an author's short task description into the explicit canonical
 * contract. Only the goal, scope and acceptance criteria must be written; every
 * other field gets a recorded default. Provided values are kept as given, so an
 * existing full contract is returned unchanged.
 */
export function completeTaskContract(input, policy, actor) {
  if (!object(input)) throw new Error("A task contract object is required");
  const c = structuredClone(input);
  fill(c, { schema_version: TASK_CONTRACT_SCHEMA, state: "intake", actor, dependencies: [], handoff: null, skills: [] });
  if (object(c.scope)) fill(c.scope, { exclude: [] });
  if (object(c.acceptance)) fill(c.acceptance, { evidence: [] });
  if (c.environment === undefined) c.environment = {};
  const e = c.environment;
  if (object(e)) {
    fill(e, { cwd: ".", read_paths: ["."], write_paths: ["."], tools: [], resources: [],
      network: { mode: "none", hosts: [] }, external_actions: [], data: {} });
    if (object(e.data)) fill(e.data, { classification: "internal", model_access: "none", policy_refs: [...(policy.requirements_refs ?? [])] });
  }
  if (c.authorization === undefined && object(e)) {
    const needed = [["read", e.read_paths?.length], ["write", e.write_paths?.length], ["execute", e.tools?.length],
      ["network", e.network?.hosts?.length], ["external", e.external_actions?.length]];
    const operations = needed.filter(([, count]) => count).map(([operation]) => operation);
    c.authorization = { approved_by: actor?.principal_id ?? null, approval_ref: null,
      operations: operations.length ? operations : ["read"], expires_at: null };
  }
  fill(c, { execution: { runtime: { kind: "host-owned", adapter_id: null, required_features: [] }, model_connection: { kind: "native" } } });
  if (c.verification === undefined) c.verification = {};
  if (object(c.verification)) {
    // Unstated risk is the floor implied by the write paths and data; it can be raised, never lowered.
    if (c.verification.risk_tier === undefined && object(e)) c.verification.risk_tier = contractRiskFloor(policy, c);
    fill(c.verification, { separation: policy.review_separation, implementer: null, reviewer: null, candidate_revision: null });
  }
  return c;
}
