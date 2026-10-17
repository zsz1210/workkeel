import { exactKeys, executionDigest } from "./workkeel-execution-policy.mjs";

// Role requirements are declared in JSON; satisfaction is only ever probed by
// trusted embedding code. Contradictions fail before any model is contacted.
const ROLES = {
  planning: { access: "read", tests: ["none"] },
  implementation: { access: "write", tests: ["role", "coordinator", "none"] },
  repair: { access: "write", tests: ["role", "coordinator", "none"] },
  review: { access: "read", tests: ["role", "coordinator", "none"] },
  verification: { access: "read", tests: ["role"] }
};
export const ROLE_USAGE_FIELDS = Object.freeze(["input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens"]);
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const TRUSTED = new WeakSet();
const fail = message => { throw new Error(`Role preflight: ${message}`); };
function label(value, name) { if (typeof value !== "string" || !LABEL.test(value)) fail(`invalid ${name}`); return value; }
// Holes and extra keys are rejected explicitly: forEach/some/includes skip or
// misread them, so a sparse array could otherwise satisfy a requirement.
function dense(value, name, { min = 0, max }) {
  if (!Array.isArray(value) || value.length < min || value.length > max || Object.keys(value).length !== value.length) fail(`malformed ${name}`);
  for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i)) fail(`malformed ${name}`);
  return value;
}
function labels(value, name) {
  dense(value, name, { max: 64 });
  for (let i = 0; i < value.length; i++) label(value[i], name);
  if (new Set(value).size !== value.length) fail(`invalid ${name}`);
  return value;
}
function strict(value, required, optional = []) {
  try { exactKeys(value, required, optional); } catch { fail("missing or unknown fields"); }
}
function usageFields(value, name) {
  dense(value, name, { min: 1, max: ROLE_USAGE_FIELDS.length });
  for (let i = 0; i < value.length; i++) if (!ROLE_USAGE_FIELDS.includes(value[i])) fail(`malformed ${name}`);
  if (new Set(value).size !== value.length) fail(`malformed ${name}`);
  return value;
}

/** Declared requirements only. Enforcement and tool availability cannot be asserted here. */
export function validateRoleContract(contract) {
  strict(contract, ["schema_version", "role", "product_access", "tests", "edit_tools", "model", "usage"]);
  if (contract.schema_version !== "workkeel.role-contract/v1") fail("unsupported role contract");
  if (!Object.hasOwn(ROLES, contract.role)) fail("unknown role");
  const rule = ROLES[contract.role];
  if (contract.product_access !== rule.access) fail(`${contract.role} requires product ${rule.access} access`);
  if (!rule.tests.includes(contract.tests)) fail(`${contract.role} cannot assign test ownership "${contract.tests}"`);
  labels(contract.edit_tools, "edit tools");
  if (rule.access === "write" && !contract.edit_tools.length) fail(`${contract.role} requires an editing tool`);
  if (rule.access === "read" && contract.edit_tools.length) fail("read-only roles cannot require editing tools");
  strict(contract.model, ["provider", "model", "effort"]);
  label(contract.model.provider, "provider"); label(contract.model.model, "model");
  if (contract.model.effort !== null) label(contract.model.effort, "effort");
  strict(contract.usage, ["fields"]); usageFields(contract.usage.fields, "usage requirement");
  return contract;
}

/** Register trusted application code. A parsed JSON object can never become a host. */
export function createTrustedRoleHost({ id, probe, runtimeState, launch, ...rest }) {
  if (Object.keys(rest).length) fail("unknown host members");
  label(id, "host ID");
  if (typeof probe !== "function") fail("a trusted host must supply an actual capability probe");
  for (const [name, fn] of Object.entries({ runtimeState, launch })) if (fn !== undefined && typeof fn !== "function") fail(`invalid host ${name}`);
  const host = Object.freeze({ id, probe, runtimeState, launch });
  TRUSTED.add(host); return host;
}
export function assertTrustedRoleHost(host, members = []) {
  if (!TRUSTED.has(host)) fail("requires a host registered by trusted embedding code; declarations cannot qualify a host");
  for (const name of members) if (typeof host[name] !== "function") fail(`trusted host does not support ${name}`);
  return host;
}

function validateProbe(result, role) {
  strict(result, ["host", "enforcement", "tools", "models", "usage"]);
  label(result.host, "probed host");
  strict(result.enforcement, ["sandbox", "product_access", "network", "test_scratch"]);
  const enforcement = result.enforcement;
  if (enforcement.sandbox !== "enforced") fail("host sandbox enforcement is unproven");
  if (!["read", "write"].includes(enforcement.product_access)) fail("unknown enforced product access");
  if (enforcement.product_access !== role.product_access) fail(`host enforces product ${enforcement.product_access} access, role requires ${role.product_access}`);
  if (enforcement.network !== "disabled") fail("host network isolation is unproven");
  if (!["host-private", "none"].includes(enforcement.test_scratch)) fail("unknown test scratch boundary");
  if (role.tests === "role" && role.product_access === "read" && enforcement.test_scratch !== "host-private") fail("read-only test execution requires host-private scratch");
  labels(result.tools, "probed tools");
  for (const tool of role.edit_tools) if (!result.tools.includes(tool)) fail(`required editing tool "${tool}" is unavailable`);
  dense(result.models, "probed model catalogue", { min: 1, max: 128 });
  for (let i = 0; i < result.models.length; i++) {
    const model = result.models[i];
    strict(model, ["provider", "model", "efforts"]); label(model.provider, "probed provider"); label(model.model, "probed model");
    dense(model.efforts, "probed efforts", { min: 1, max: 16 });
    for (let j = 0; j < model.efforts.length; j++) if (model.efforts[j] !== null) label(model.efforts[j], "probed effort");
  }
  if (!result.models.some(m => m.provider === role.model.provider && m.model === role.model.model && m.efforts.includes(role.model.effort))) fail("host does not support the exact model and effort");
  strict(result.usage, ["fields", "unknown"]);
  usageFields(result.usage.fields, "probed usage report");
  if (result.usage.unknown !== "null") fail("malformed usage report: unknown counters must remain null");
  for (const field of role.usage.fields) if (!result.usage.fields.includes(field)) fail(`partial usage report lacks ${field}`);
}

/**
 * Run before inference. The host probe may inspect connections and catalogues,
 * but must not start a model turn. The receipt is an observation, not authority.
 */
export async function runRolePreflight({ role, host, context = {} }) {
  // All checks and the receipt must describe the same request across the probe
  // await. The host receives its own copy below, never this private snapshot.
  role = structuredClone(role);
  context = structuredClone(context);
  validateRoleContract(role);
  assertTrustedRoleHost(host);
  strict(context, [], ["approved_tools", "coordinator_checks"]);
  if (context.approved_tools !== undefined) {
    labels(context.approved_tools, "approved tools");
    for (const tool of role.edit_tools) if (!context.approved_tools.includes(tool)) fail(`editing tool "${tool}" is not approved by the task`);
  }
  if (context.coordinator_checks !== undefined) {
    labels(context.coordinator_checks, "coordinator checks");
    const coordinatorTests = context.coordinator_checks.includes("tests");
    if (role.tests === "role" && coordinatorTests) fail("tests are assigned to both the role and the coordinator");
    if (role.tests === "coordinator" && !coordinatorTests) fail("role defers tests to a coordinator that does not own them");
  }
  let result;
  try { result = await host.probe(Object.freeze(structuredClone(role))); }
  catch { fail("host capability probe failed"); }
  validateProbe(result, role);
  return Object.freeze({ schema_version: "workkeel.role-preflight/v1", authority: "observation-only", execution_authorized: false,
    role: role.role, product_access: role.product_access, tests: role.tests, edit_tools: [...role.edit_tools],
    model: { ...role.model }, usage_fields: [...role.usage.fields], host_id: host.id, probed_host: result.host,
    probe_sha256: executionDigest(result), checked_at: new Date().toISOString(),
    limitations: ["The probe reflects trusted host code at one instant; it does not promise complete future token reports."] });
}
