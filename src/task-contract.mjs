import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { isWorkItemId } from "./ids.mjs";
import { sha256 } from "./files.mjs";

export const TASK_CONTRACT_SCHEMA = "workkeel.task-contract/v1";
const MAX_BYTES = 1024 * 1024;
const text = { type: "string", minLength: 1, pattern: "\\S" };
const strings = { type: "array", items: text, uniqueItems: true };
const nonempty = { ...strings, minItems: 1 };
const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const choice = (...values) => ({ enum: values });
const object = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const identifier = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$" };
const identifiers = { type: "array", items: identifier, uniqueItems: true };
const actor = object({ agent_id: identifier, principal_id: nullable(identifier) });
const revision = { type: "string", pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" };
const nativeModel = object({ kind: { const: "native" } });
const gatewayModel = object({
  kind: { const: "gateway" }, provider: choice("litellm", "openai-compatible"),
  base_url: text, model: text, selection: { const: "fixed" },
  credential_env: { type: "string", pattern: "^[A-Z_][A-Z0-9_]*$" }
});

// This schema is a data boundary, never a grant or a runtime sandbox.
export const taskContractSchema = object({
  schema_version: { const: TASK_CONTRACT_SCHEMA }, id: identifier, goal: text,
  scope: object({ include: nonempty, exclude: strings }), actor: nullable(actor),
  state: choice("intake", "spec", "design", "build", "test", "eval", "independent_qa", "release_gate", "done", "concluded", "blocked", "cancelled"),
  dependencies: identifiers,
  acceptance: object({ criteria: nonempty, evidence: strings }),
  verification: object({
    risk_tier: nullable(choice("low", "standard", "high", "critical")),
    separation: choice("unresolved", "distinct-agent", "distinct-principal", "none"),
    implementer: nullable(actor), reviewer: nullable(actor), candidate_revision: nullable(revision)
  }),
  handoff: nullable(object({
    from_actor: nullable(actor), to_actor: nullable(actor), revision,
    summary: nullable(text), evidence: nonempty, unresolved: strings, next_action: nullable(text)
  })),
  environment: nullable(object({
    cwd: text, read_paths: strings, write_paths: strings, tools: identifiers, resources: identifiers,
    network: object({ mode: choice("none", "allowlist"), hosts: strings }),
    external_actions: identifiers,
    data: object({ classification: choice("public", "internal", "sensitive"), model_access: choice("none", "approved-connection"), policy_refs: nonempty })
  })),
  authorization: nullable(object({
    approved_by: identifier, approval_ref: text,
    operations: { type: "array", uniqueItems: true, items: choice("read", "write", "execute", "network", "external"), minItems: 1 },
    expires_at: nullable({ type: "string", format: "date-time" })
  })),
  skills: strings,
  execution: object({
    runtime: object({ kind: choice("host-owned", "adapter"), adapter_id: nullable(identifier), required_features: identifiers }),
    model_connection: { oneOf: [nativeModel, gatewayModel] }
  }),
  legacy: nullable(object({ schema_version: { const: "temple.work-item/v1" }, source_ref: text,
    source_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" }, owner_position: nullable(text), assigned_agent_id: nullable(text) }))
});
const ajv = new Ajv({ allErrors: true, strict: true, ownProperties: true });
addFormats(ajv);
const validate = ajv.compile(taskContractSchema);

function repositoryPath(value, allowRoot = false) {
  return typeof value === "string" && (allowRoot && value === "." ||
    value.length > 0 && value.trim() === value && !/[\\\x00-\x1f\x7f*?\[\]{}:]/.test(value) &&
    !path.posix.isAbsolute(value) && !path.win32.isAbsolute(value) &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== ".."));
}

function validGatewayUrl(value) {
  try {
    const url = new URL(value);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return !url.username && !url.password && !url.search && !url.hash &&
      (url.protocol === "https:" || url.protocol === "http:" && loopback);
  } catch { return false; }
}

/** Validate shape/completeness only; do not read credentials or infer authority. */
export function validateTaskContract(document, { now = new Date() } = {}) {
  const errors = [];
  const incomplete = [];
  if (!validate(document)) errors.push(...validate.errors.map((entry) => `${entry.instancePath || "/"} ${entry.message}`));
  if (!errors.length) {
    if (document.dependencies.includes(document.id)) errors.push("/dependencies must not include the task itself");
    if (!document.actor?.principal_id) incomplete.push("actor.principal_id");
    const verification = document.verification;
    if (verification.risk_tier === null) incomplete.push("verification.risk_tier");
    if (verification.separation === "unresolved") incomplete.push("verification.separation");
    if (["high", "critical"].includes(verification.risk_tier) && verification.separation === "none") errors.push("/verification high-risk work requires explicit review separation");
    if (verification.reviewer && verification.separation !== "none") {
      if (!verification.implementer) incomplete.push("verification.implementer");
      else if (verification.implementer.agent_id === verification.reviewer.agent_id ||
        verification.separation === "distinct-principal" && (!verification.reviewer.principal_id || !verification.implementer.principal_id || verification.implementer.principal_id === verification.reviewer.principal_id)) errors.push("/verification reviewer does not satisfy the declared identity separation");
    }
    if (document.state === "done") {
      if (!document.acceptance.evidence.length) incomplete.push("acceptance.evidence");
      if (!verification.candidate_revision) incomplete.push("verification.candidate_revision");
      if (["distinct-agent", "distinct-principal"].includes(verification.separation) && !verification.reviewer?.principal_id) incomplete.push("verification.reviewer");
    }
    const env = document.environment;
    if (!env) incomplete.push("environment");
    else {
      if (!repositoryPath(env.cwd, true)) errors.push("/environment/cwd must be a normalized repository-relative directory");
      if (env.data.policy_refs.some((value) => !repositoryPath(value))) errors.push("/environment/data/policy_refs must contain repository-relative paths");
      for (const field of ["read_paths", "write_paths"]) {
        if (env[field].some((value) => !repositoryPath(value, true))) errors.push(`/environment/${field} must contain normalized repository-relative roots without globs`);
      }
      if (env.network.mode === "none" && env.network.hosts.length || env.network.mode === "allowlist" && !env.network.hosts.length) errors.push("/environment/network hosts must match mode");
      if (env.network.hosts.some((host) => !/^(?:localhost|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/.test(host))) errors.push("/environment/network/hosts must be explicit hostnames or IPv4 addresses, without wildcards or ports");
    }
    const authority = document.authorization;
    if (!authority) incomplete.push("authorization");
    else {
      if (!repositoryPath(authority.approval_ref)) errors.push("/authorization/approval_ref must be a repository-relative evidence path");
      if (authority.expires_at && Date.parse(authority.expires_at) <= now.getTime()) incomplete.push("authorization.expired");
      if (env) {
        for (const [operation, needed] of [["read", env.read_paths.length], ["write", env.write_paths.length], ["execute", env.tools.length], ["network", env.network.hosts.length], ["external", env.external_actions.length]]) {
          if (needed && !authority.operations.includes(operation)) errors.push(`/authorization/operations missing ${operation} for declared environment`);
        }
      }
    }
    const runtime = document.execution.runtime;
    if (document.skills.some((value) => !repositoryPath(value))) errors.push("/skills must contain repository-relative Skill paths");
    if (runtime.kind === "host-owned" && runtime.adapter_id !== null || runtime.kind === "adapter" && runtime.adapter_id === null) errors.push("/execution/runtime/adapter_id must match runtime kind");
    const model = document.execution.model_connection;
    if (model.kind === "gateway") {
      const urlValid = validGatewayUrl(model.base_url);
      if (!urlValid) errors.push("/execution/model_connection/base_url requires HTTPS or loopback HTTP, with no credentials, query or fragment");
      if (runtime.kind === "host-owned") errors.push("/execution/model_connection gateway requires an explicitly selected adapter");
      if (env && (env.data.model_access !== "approved-connection" || env.network.mode !== "allowlist" || urlValid && !env.network.hosts.includes(new URL(model.base_url).hostname))) errors.push("/execution/model_connection gateway must match the data and network boundaries");
    }
    if (document.handoff?.unresolved.length) incomplete.push("handoff.unresolved");
  }
  return {
    schema_version: "workkeel.task-contract-validation/v1", authority: "observation-only", mutation_status: "no-write",
    valid: errors.length === 0, contract_complete: errors.length === 0 && incomplete.length === 0,
    incomplete_fields: incomplete, errors, execution_authorized: false,
    boundary_enforcement: "not-performed", provider_contact: false
  };
}

/** Bounded input reader: no traversal, symlinks, devices or oversized JSON. */
export async function readTaskContractInput(target, source) {
  if (!repositoryPath(source)) throw new Error("Contract input must be a normalized repository-relative file path");
  const root = await fs.realpath(target);
  let current = root;
  const parts = source.split("/");
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    const info = await fs.lstat(current);
    if (info.isSymbolicLink() || (index < parts.length - 1 ? !info.isDirectory() : !info.isFile())) throw new Error("Contract input must be a regular file with no symlink components");
  }
  const file = await fs.open(current, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_BYTES) throw new Error("Contract input must be a regular JSON file of at most 1 MiB");
    // Bound the read even if the file grows after stat.
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_BYTES) throw new Error("Contract input exceeds 1 MiB");
    const after = await file.stat();
    const entry = await fs.lstat(current);
    if (info.dev !== entry.dev || info.ino !== entry.ino || entry.isSymbolicLink() ||
      info.size !== after.size || info.mtimeMs !== after.mtimeMs || info.ctimeMs !== after.ctimeMs ||
      await fs.realpath(current) !== current) throw new Error("Contract input changed while reading");
    let content;
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)); }
    catch { throw new Error("Contract input is not valid UTF-8"); }
    let document;
    try { document = JSON.parse(content); } catch { throw new Error("Contract input is not valid JSON"); }
    return { document, digest: sha256(content) };
  } finally { await file.close(); }
}

/** Project legacy data without converting scope, roles or assignment into grants. */
export function projectLegacyTask(item, { sourceRef, sourceSha256 }) {
  if (item?.schema_version !== "temple.work-item/v1" || !isWorkItemId(item?.id)) throw new Error("Unsupported legacy Work Item");
  const active = item.claim?.status === "active" ? item.claim : null;
  const last = item.handoffs?.at(-1);
  const contract = {
    schema_version: TASK_CONTRACT_SCHEMA, id: item.id, goal: item.title,
    scope: { include: structuredClone(item.scope), exclude: [] },
    actor: active ? { agent_id: active.agent_id, principal_id: active.principal_id ?? null } :
      item.assigned_agent_id ? { agent_id: item.assigned_agent_id, principal_id: null } : null,
    state: item.state, dependencies: structuredClone(item.dependencies ?? []),
    acceptance: { criteria: structuredClone(item.acceptance_criteria), evidence: structuredClone(item.evidence ?? []) },
    verification: { risk_tier: item.risk_tier ?? null, separation: "unresolved", implementer: null, reviewer: null,
      candidate_revision: item.developer_candidate_revision ?? null },
    handoff: last ? {
      from_actor: last.actor ? { agent_id: last.actor, principal_id: last.principal_id ?? null } : null,
      to_actor: null, revision: last.input_revision, summary: null, evidence: [last.artifact],
      unresolved: structuredClone(item.unresolved ?? []), next_action: null
    } : null,
    environment: null, authorization: null, skills: [],
    execution: { runtime: { kind: "host-owned", adapter_id: null, required_features: [] }, model_connection: { kind: "native" } },
    legacy: { schema_version: item.schema_version, source_ref: sourceRef, source_sha256: sourceSha256,
      owner_position: item.owner_position ?? null, assigned_agent_id: item.assigned_agent_id ?? null }
  };
  return {
    ...validateTaskContract(contract), contract,
    migration_notes: [
      "Legacy lifecycle authority is unchanged; this is not a migrated canonical Work Item.",
      "Affected paths describe change scope, not filesystem grants. Environment and authorization require explicit review.",
      "Host-owned/native execution is a proposed baseline, not an observation of the existing runtime or model.",
      "Source digest preserves provenance; review original gates, dependencies and handoff artifacts before migration."
    ]
  };
}

export async function inspectLegacyTaskContract(target, workItemId) {
  if (typeof workItemId !== "string" || !isWorkItemId(workItemId)) throw new Error("A valid Work Item ID is required");
  const sourceRef = `.ai-org/work-items/${workItemId}.json`;
  const input = await readTaskContractInput(target, sourceRef);
  if (input.document?.id !== workItemId) throw new Error("Legacy Work Item ID does not match its filename");
  return projectLegacyTask(input.document, { sourceRef, sourceSha256: input.digest });
}
