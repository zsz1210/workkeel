import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { durableAtomicCreate, durableAtomicWrite, durableUnlink, formatJson, sha256 } from "./files.mjs";

export const RECONCILIATION_SCHEMA = "temple.reconciliation-preview/v1";
const REVISION = /^[a-f0-9]{40}$/;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_PATHS = 200;
const MAX_WORK_ITEM_ENTRIES = 10000;
const MAX_VALIDATION_BYTES = 64 * 1024 * 1024;
const SUPPORTED = /^(?:\.ai-org\/work-items\/WI-(?:[0-9]{4,}|[0-9]{8}-[A-F0-9]{10})\.json|\.ai-org\/project\/(?:collaboration|agents|assignments|tasks|evidence|runtime-workers|resources)\.json|\.ai-org\/events\/events\.jsonl)$/;
const SCHEMAS = { agents: "agents.schema.json", assignments: "assignments.schema.json", collaboration: "collaboration.schema.json",
  tasks: "task-registry.schema.json", evidence: "evidence-registry.schema.json", "runtime-workers": "runtime-worker-registry.schema.json", resources: "resource-registry.schema.json" };
const MISSING = Symbol("missing");
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
function canonical(value) {
  if (value === MISSING) return { "$temple_absent": true };
  if (Array.isArray(value)) return value.map(canonical);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const encode = value => JSON.stringify(canonical(value));
const equal = (left, right) => left === MISSING || right === MISSING ? left === right : encode(left) === encode(right);
const hash = value => sha256(encode(value));
const failure = (code, message, extras = {}) => ({ valid: false, code, errors: [message], mutation_performed: false,
  next_action: "Inspect the reported condition and current canonical records; resolve it before making a fresh preview or retrying recovery.", ...extras });

function recordKey(record, field) {
  if (isObject(record) && typeof record.id === "string" && record.id) return `id:${record.id}`;
  if (field === "memberships" && record?.position_id && record?.agent_id) return `member:${record.position_id}:${record.agent_id}`;
  if (field === "sponsorships" && record?.agent_id) return `sponsor:${record.agent_id}`;
  if (field === "assignments" && record?.position_id) return `position:${record.position_id}`;
  return null;
}
function conflict(conflicts, location, reason, base, local, incoming) {
  const competing = local?.claim?.status === "active" && incoming?.claim?.status === "active" &&
    !equal(local.claim, incoming.claim);
  conflicts.push({ path: location || "$", reason, base: base === MISSING ? null : base,
    local: local === MISSING ? null : local, incoming: incoming === MISSING ? null : incoming,
    ...(competing ? { condition: "competing-active-claims", responsible_actors: [local.claim, incoming.claim].map(claim => ({
      principal_id: claim.principal_id ?? null, agent_id: claim.agent_id, claim_id: claim.id,
      branch: claim.branch ?? null, base_revision: claim.base_revision ?? null })) } : {}),
    next_action: competing
      ? "Coordinate both named claim owners. Preserve both branches, explicitly release or hand off the displaced claim through the CLI, then make a fresh preview; never choose ours/theirs for canonical records."
      : "Resolve this record with its responsible owner, retain both histories, then create a fresh preview." });
  return local;
}
function validateIds(value, location, conflicts) {
  if (Array.isArray(value)) {
    const ids = new Set();
    const field = location.split(".").at(-1);
    for (const [index, entry] of value.entries()) {
      const id = recordKey(entry, field);
      if (id && ids.has(id)) conflicts.push({ path: location, reason: `duplicate-stable-id:${id}` });
      if (id) ids.add(id);
      validateIds(entry, `${location}[${index}]`, conflicts);
    }
  } else if (isObject(value)) for (const [key, entry] of Object.entries(value)) validateIds(entry, `${location}.${key}`, conflicts);
}
function validateResponsibilities(document, conflicts) {
  if (!isObject(document)) return;
  const assignments = new Map((document.assignments ?? []).filter(entry => entry.active !== false).map(entry => [entry.position_id, entry.agent_id]));
  if (assignments.get("developer") && assignments.get("developer") === assignments.get("independent_qa")) conflicts.push({ path: "assignments", reason: "developer-and-independent-qa-identity-collision" });
  const defaults = new Set();
  for (const member of document.memberships ?? []) {
    if (!member.default || member.active === false || (member.status && member.status !== "active")) continue;
    if (defaults.has(member.position_id)) conflicts.push({ path: "memberships", reason: `competing-active-defaults:${member.position_id}` });
    defaults.add(member.position_id);
  }
  const workers = new Set();
  for (const worker of document.workers ?? []) {
    if (!["active", "waiting", "attention"].includes(worker.status)) continue;
    const scope = `${worker.work_item_id}:${worker.position_id}`;
    if (workers.has(scope)) conflicts.push({ path: "workers", reason: `competing-active-workers:${scope}` });
    workers.add(scope);
  }
  if ((document.claims ?? []).filter(entry => entry.status === "active").length > 1) conflicts.push({ path: "claims", reason: "competing-active-claims" });
  const artifacts = new Map();
  for (const entry of document.entries ?? []) {
    if (entry.invalidated_at || !entry.scope_revision) continue;
    for (const artifact of entry.artifacts ?? []) {
      const key = JSON.stringify([entry.scope_revision, artifact.path]);
      if (artifacts.has(key) && artifacts.get(key) !== artifact.sha256) conflicts.push({ path: "entries", reason: `conflicting-evidence-artifact:${artifact.path}` });
      artifacts.set(key, artifact.sha256);
    }
  }
}
function merge(base, local, incoming, location, conflicts, atomicRecord = false) {
  if (equal(local, incoming)) return local;
  if (equal(base, local)) return incoming;
  if (equal(base, incoming)) return local;
  if (local === MISSING || incoming === MISSING) return conflict(conflicts, location, "deletion-versus-modification", base, local, incoming);
  if (base === MISSING) return conflict(conflicts, location, "divergent-addition", base, local, incoming);
  if (atomicRecord) return conflict(conflicts, location, "divergent-stable-id-record", base, local, incoming);
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(incoming)) {
    const field = location.split(".").at(-1);
    const all = [...base, ...local, ...incoming];
    if (all.every(record => recordKey(record, field))) {
      const maps = [base, local, incoming].map(records => new Map(records.map(record => [recordKey(record, field), record])));
      const ids = [...new Set(maps.flatMap(map => [...map.keys()]))].sort();
      return ids.flatMap(id => {
        const merged = merge(...maps.map(map => map.has(id) ? map.get(id) : MISSING), `${location}[${id}]`, conflicts, true);
        return merged === MISSING ? [] : [merged];
      });
    }
    // Histories without stable IDs are append-only. Exact duplicate entries collapse;
    // distinct events retain all payload fields and are never merged by timestamp.
    if (["events", "handoffs", "history", "rework_history"].includes(field)) {
      const maps = [base, local, incoming].map(records => new Map(records.map(record => [recordKey(record, field) ?? encode(record), record])));
      for (const [key, previous] of maps[0]) if (!maps[1].has(key) || !maps[2].has(key)
        || !equal(previous, maps[1].get(key)) || !equal(previous, maps[2].get(key))) return conflict(conflicts, location, "history-deletion-or-rewrite", base, local, incoming);
      for (const [key, value] of maps[1]) if (maps[2].has(key) && !equal(value, maps[2].get(key))) return conflict(conflicts, `${location}[${key}]`, "divergent-stable-id-record", base, local, incoming);
      return [...new Map([...maps[0], ...maps[1], ...maps[2]])].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
    }
    return conflict(conflicts, location, "ambiguous-array-changes", base, local, incoming);
  }
  if (isObject(base) && isObject(local) && isObject(incoming)) {
    // Work Items, evidence, claims and worker records are indivisible when both
    // sides changed the same stable identity. Do not synthesize a lifecycle.
    if (base.id || local.id || incoming.id) return conflict(conflicts, location, "divergent-stable-id-record", base, local, incoming);
    const result = {};
    for (const key of [...new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(incoming)])].sort()) {
      const merged = merge(...[base, local, incoming].map(value => Object.hasOwn(value, key) ? value[key] : MISSING), `${location}.${key}`, conflicts);
      if (merged !== MISSING) Object.defineProperty(result, key, { value: merged, enumerable: true, configurable: true, writable: true });
    }
    return result;
  }
  return conflict(conflicts, location, "divergent-value", base, local, incoming);
}

/** null means an absent file. No output from this function authorizes a gate. */
export function reconcileDocuments(base, local, incoming, options = {}) {
  const conflicts = [];
  for (const [name, value] of [["base", base], ["local", local], ["incoming", incoming]]) validateIds(value, name, conflicts);
  const isEvents = options.kind === "events";
  if (isEvents) {
    const previous = new Map((base ?? []).map(event => [recordKey(event, "events") ?? encode(event), event]));
    for (const side of [local, incoming]) {
      if (!Array.isArray(side)) { conflicts.push({ path: "events", reason: "event-history-missing" }); continue; }
      const map = new Map(side.map(event => [recordKey(event, "events") ?? encode(event), event]));
      for (const [id, event] of previous) if (!map.has(id) || !equal(event, map.get(id))) conflicts.push({ path: `events[${id}]`, reason: "history-deletion-or-rewrite" });
    }
  }
  let result = merge(base === null ? MISSING : base, local === null ? MISSING : local, incoming === null ? MISSING : incoming, isEvents ? "events" : "", conflicts);
  if (!conflicts.length) validateResponsibilities(result, conflicts);
  if (isEvents && Array.isArray(result)) result = [...result].sort((left, right) => encode(left).localeCompare(encode(right)));
  return { valid: conflicts.length === 0, conflicts, merged: conflicts.length ? null : result === MISSING ? null : canonical(result),
    mutation_performed: false, authority: "reconciliation-only", next_action: conflicts.length ? "Resolve the named conflicts and preview again." : "Review the preview, then apply only while its source fingerprint is current." };
}

function git(target, args, maxBuffer = MAX_FILE_BYTES + 1024) {
  return spawnSync("git", ["-C", target, ...args], { encoding: "utf8", maxBuffer });
}
function exactRevision(target, revision) {
  if (!REVISION.test(revision ?? "") || git(target, ["cat-file", "-e", `${revision}^{commit}`]).status !== 0) throw new Error(`Exact Git commit is unavailable: ${revision ?? "missing"}`);
  return revision;
}
async function safeFile(target, relativePath) {
  if (!SUPPORTED.test(relativePath)) throw new Error(`Unsupported reconciliation path: ${relativePath}`);
  let current = await fs.realpath(target);
  for (const part of relativePath.split("/")) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (stat?.isSymbolicLink()) throw new Error(`Symbolic link is not a reconciliation input: ${relativePath}`);
  }
  return current;
}
async function currentBytes(target, relativePath) {
  const file = await safeFile(target, relativePath);
  const stat = await fs.stat(file).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (!stat) return null;
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error(`Invalid or oversized reconciliation file: ${relativePath}`);
  return fs.readFile(file, "utf8");
}
function revisionBytes(target, revision, relativePath) {
  const tree = git(target, ["ls-tree", "-z", revision, "--", relativePath], 4096);
  if (tree.status !== 0 || tree.error) throw new Error(`Could not inspect source tree: ${relativePath}`);
  if (!tree.stdout) return null;
  if (!/^100(644|755) blob /.test(tree.stdout)) throw new Error(`Source is not a regular file: ${relativePath}`);
  const result = git(target, ["show", `${revision}:${relativePath}`]);
  if (result.status !== 0 || result.error || Buffer.byteLength(result.stdout) > MAX_FILE_BYTES) throw new Error(`Could not read bounded source file: ${relativePath}`);
  return result.stdout;
}
function parseBody(body, relativePath) {
  if (body === null) return null;
  if (relativePath.endsWith(".jsonl")) return body.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
  const value = JSON.parse(body);
  if (!isObject(value)) throw new Error(`Canonical JSON must be an object: ${relativePath}`);
  return value;
}
function serialize(value, relativePath) {
  if (value === null) return null;
  return relativePath.endsWith(".jsonl") ? value.map(entry => JSON.stringify(entry)).join("\n") + (value.length ? "\n" : "") : formatJson(value);
}

async function validationBytes(target, relativePath) {
  if (!SUPPORTED.test(relativePath) && !/^\.ai-org\/(?:core\/(?:positions\.json|schemas\/[a-z0-9-]+\.schema\.json)|project\/project\.json)$/.test(relativePath)) throw new Error(`Unsupported validation input: ${relativePath}`);
  let current = await fs.realpath(target);
  for (const part of relativePath.split("/")) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (stat?.isSymbolicLink()) throw new Error(`Unsafe validation input: ${relativePath}`);
  }
  const stat = await fs.stat(current).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (!stat) return null;
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error(`Invalid validation input: ${relativePath}`);
  return fs.readFile(current, "utf8");
}

async function workItemInventory(target) {
  const relativePath = ".ai-org/work-items/";
  let directory = await fs.realpath(target);
  for (const part of [".ai-org", "work-items"]) {
    directory = path.join(directory, part);
    const stat = await fs.lstat(directory).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (!stat) return { path: relativePath, digest: null, files: [] };
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe Work Item validation directory: ${relativePath}`);
  }
  const entries = [];
  const files = [];
  for await (const entry of await fs.opendir(directory)) {
    if (entries.length >= MAX_WORK_ITEM_ENTRIES) throw new Error(`Work Item validation inventory exceeds ${MAX_WORK_ITEM_ENTRIES} entries`);
    const kind = entry.isFile() ? "file" : entry.isDirectory() ? "directory" : "other";
    entries.push([entry.name, kind]);
    if (!entry.name.startsWith("WI-") || !entry.name.endsWith(".json")) continue;
    const file = relativePath + entry.name;
    if (!SUPPORTED.test(file) || !entry.isFile() || entry.isSymbolicLink()) throw new Error(`Unsafe Work Item validation input: ${file}`);
    files.push(file);
  }
  entries.sort(([a], [b]) => a.localeCompare(b));
  return { path: relativePath, digest: hash(entries), files: files.sort() };
}

// Validate the virtual result before any writes, including unchanged supporting
// identity records. Every consulted byte source joins the preview fingerprint.
async function validateCombinedDocuments(target, documents) {
  const conflicts = [];
  const inputs = new Map();
  const supportingDocuments = new Map();
  let validationSize = 0;
  const read = async (file, required = true) => {
    if (documents.has(file)) return documents.get(file);
    if (supportingDocuments.has(file)) return supportingDocuments.get(file);
    const bytes = await validationBytes(target, file);
    validationSize += bytes === null ? 0 : Buffer.byteLength(bytes);
    if (validationSize > MAX_VALIDATION_BYTES) throw new Error(`Reconciliation validation inputs exceed ${MAX_VALIDATION_BYTES} bytes`);
    inputs.set(file, bytes === null ? null : sha256(bytes));
    if (bytes === null) {
      if (required) throw new Error(`Required reconciliation validation input is missing: ${file}`);
      return null;
    }
    const document = JSON.parse(bytes);
    supportingDocuments.set(file, document);
    return document;
  };
  const [{ default: Ajv2020 }, { default: addFormats }] = await Promise.all([import("ajv/dist/2020.js"), import("ajv-formats")]);
  for (const [file, document] of documents) {
    if (file.endsWith(".jsonl")) {
      if (!Array.isArray(document) || document.some(entry => !isObject(entry) || typeof entry.event_type !== "string" || typeof entry.timestamp !== "string" || Number.isNaN(Date.parse(entry.timestamp)))) conflicts.push({ file, path: "$", reason: "invalid-event-record" });
      continue;
    }
    const workItem = file.startsWith(".ai-org/work-items/");
    if (document === null) {
      if (!workItem) conflicts.push({ file, path: "$", reason: "required-registry-deletion" });
      continue;
    }
    const schemaName = workItem ? "work-item.schema.json" : SCHEMAS[path.posix.basename(file, ".json")];
    const schema = await read(`.ai-org/core/schemas/${schemaName}`);
    const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    if (!validate(document)) conflicts.push(...validate.errors.map(error => ({ file, path: error.instancePath || "$", reason: `schema-invalid:${error.message}` })));
  }
  if (conflicts.length) return { conflicts, inputs: [...inputs] };
  const identityPaths = [".ai-org/project/collaboration.json", ".ai-org/project/agents.json", ".ai-org/project/assignments.json"];
  const needIdentity = [...documents.keys()].some(file => identityPaths.includes(file) || file.startsWith(".ai-org/work-items/") || file.endsWith("/runtime-workers.json") || file.endsWith("/tasks.json"));
  let identity = null;
  if (needIdentity) {
    const [collaboration, agents, assignments, positions, project] = await Promise.all([...identityPaths.map(file => read(file)), read(".ai-org/core/positions.json"), read(".ai-org/project/project.json")]);
    const [{ validateCollaborationState }, { validateProjectState }, { inspectActor }] = await Promise.all([import("./collaboration.mjs"), import("./model.mjs"), import("./actor-resolution.mjs")]);
    const positionIds = new Set((positions.positions ?? []).map(entry => entry.id));
    const validation = validateCollaborationState(collaboration, agents, assignments, positionIds);
    conflicts.push(...validation.errors.map(reason => ({ file: identityPaths[0], path: "$", reason: `combined-collaboration-invalid:${reason}` })));
    conflicts.push(...validateProjectState(project, agents, assignments, positionIds).filter(check => check.status === "fail")
      .map(check => ({ file: identityPaths[1], path: "$", reason: `combined-identity-invalid:${check.message}` })));
    identity = { collaboration, agents: new Map(agents.agents.map(entry => [entry.id, entry])), positionIds,
      positionsDocument: positions, assignmentsDocument: assignments, project, inspectActor };
  }
  const checkedItems = new Map();
  const checkItem = async (id, supplied = undefined) => {
    if (checkedItems.has(id)) return checkedItems.get(id);
    if (!/^WI-(?:[0-9]{4,}|[0-9]{8}-[A-F0-9]{10})$/.test(id ?? "")) throw new Error(`Invalid referenced Work Item: ${id}`);
    const file = `.ai-org/work-items/${id}.json`;
    const item = supplied === undefined ? await read(file, false) : supplied;
    checkedItems.set(id, item);
    if (!item) { conflicts.push({ file, path: "$", reason: "referenced-work-item-missing" }); return null; }
    if (item.id !== id) conflicts.push({ file, path: "id", reason: "work-item-path-identity-mismatch" });
    if (!identity.positionIds.has(item.owner_position)) conflicts.push({ file, path: "owner_position", reason: "unknown-owner-position" });
    const claim = item.claim;
    if (claim?.status === "active") {
      if (Array.isArray(item.claims) && !item.claims.some(entry => entry.id === claim.id && equal(entry, claim))) conflicts.push({ file, path: "claims", reason: "active-claim-history-mismatch" });
      if (!identity.agents.has(claim.agent_id) || identity.agents.get(claim.agent_id).active === false) conflicts.push({ file, path: "claim", reason: "active-claim-agent-unavailable" });
      if (identity.collaboration.profile !== "solo" && !claim.principal_id) conflicts.push({ file, path: "claim.principal_id",
        reason: "active-claim-principal-unattributed", next_action: "Recover or hand off the anonymous claim before reconciling team responsibility; do not infer its owner from current sponsorship." });
      // Reconciliation verifies recorded responsibility, not this clone's login.
      // The shared inspector retains eligibility checks even when verified-policy
      // provenance is unavailable locally. Never replace or infer another actor.
      const actor = identity.inspectActor(identity, { item, agentId: claim.agent_id, principalId: claim.principal_id,
        binding: { status: "missing" } });
      if (!actor.selected_actor) for (const blocker of actor.blockers) conflicts.push({ file, path: "claim",
        reason: "active-claim-actor-ineligible", code: blocker.code, message: blocker.message, next_action: blocker.next_action });
    }
    return item;
  };
  for (const [file, document] of documents) {
    if (!document) continue;
    if (file.startsWith(".ai-org/work-items/")) await checkItem(path.posix.basename(file, ".json"), document);
    if (file.endsWith("/runtime-workers.json")) {
      const { validateRuntimeWorkerRegistry } = await import("./workers.mjs");
      conflicts.push(...validateRuntimeWorkerRegistry(document).errors.map(reason => ({ file, path: "$", reason })));
      for (const worker of document.workers) {
        const item = await checkItem(worker.work_item_id);
        if (["active", "waiting", "attention", "reserved"].includes(worker.status) && item && (item.claim?.status !== "active" || item.claim.id !== worker.claim_id
          || item.claim.agent_id !== worker.agent_id || item.claim.principal_id !== worker.principal_id || item.owner_position !== worker.position_id)) conflicts.push({ file, path: worker.id, reason: "worker-current-ownership-conflict" });
      }
    }
    if (file.endsWith("/tasks.json")) for (const task of document.tasks) {
      await checkItem(task.work_item_id);
      if (!identity.agents.has(task.agent_id) || !identity.positionIds.has(task.position_id)) conflicts.push({ file, path: task.id, reason: "task-identity-or-position-missing" });
    }
    if (file.endsWith("/resources.json")) {
      const { validateResourceRegistry } = await import("./resources.mjs");
      conflicts.push(...validateResourceRegistry(document).errors.map(reason => ({ file, path: "$", reason })));
    }
    if (file.endsWith("/evidence.json")) {
      const { validateEvidenceRegistry } = await import("./evidence.mjs");
      conflicts.push(...validateEvidenceRegistry(document).errors.map(reason => ({ file, path: "$", reason })));
      for (const entry of document.entries) {
        const item = await read(`.ai-org/work-items/${entry.work_item_id}.json`, false);
        if (!item || item.id !== entry.work_item_id) conflicts.push({ file, path: entry.id, reason: "evidence-work-item-reference-missing" });
      }
    }
  }
  if (needIdentity) {
    if (identityPaths.some(file => documents.has(file))) {
      // Ordinary claimed work need not have a runtime or registered task. Identity
      // changes therefore inspect the complete bounded inventory, including bytes
      // of currently unclaimed/terminal records that could gain a claim later.
      const inventory = await workItemInventory(target);
      inputs.set(inventory.path, inventory.digest);
      for (const file of inventory.files) {
        const item = await read(file, false);
        if (item?.claim?.status === "active") await checkItem(path.posix.basename(file, ".json"), item);
      }
    }
    // Changing an identity or Work Item can invalidate an unchanged live runtime.
    // Inspect only live responsibilities here; retain completed history as history.
    const workersPath = ".ai-org/project/runtime-workers.json";
    const workers = await read(workersPath, false);
    if (workers && !documents.has(workersPath)) for (const worker of workers.workers ?? []) {
      if (!["active", "waiting", "attention", "reserved"].includes(worker.status)) continue;
      const item = await checkItem(worker.work_item_id);
      if (item && (item.claim?.status !== "active" || item.claim.id !== worker.claim_id || item.claim.agent_id !== worker.agent_id
        || item.claim.principal_id !== worker.principal_id || item.owner_position !== worker.position_id)) conflicts.push({ file: workersPath, path: worker.id, reason: "worker-current-ownership-conflict" });
    }
    const tasksPath = ".ai-org/project/tasks.json";
    const tasks = await read(tasksPath, false);
    if (tasks && !documents.has(tasksPath)) for (const task of tasks.tasks ?? []) {
      if (!["setup", "active", "waiting", "attention"].includes(task.status)) continue;
      await checkItem(task.work_item_id);
      if (!identity.agents.has(task.agent_id) || !identity.positionIds.has(task.position_id)) conflicts.push({ file: tasksPath, path: task.id, reason: "task-identity-or-position-missing" });
    }
  }
  return { conflicts, inputs: [...inputs].sort(([a], [b]) => a.localeCompare(b)) };
}

export async function previewReconciliation(target, options = {}) {
  try {
    const baseRevision = exactRevision(target, options.baseRevision);
    const incomingRevision = exactRevision(target, options.incomingRevision);
    if (!Array.isArray(options.paths) || !options.paths.length || options.paths.length > MAX_PATHS || new Set(options.paths).size !== options.paths.length) throw new Error("Select unique bounded canonical paths for reconciliation");
    const ignored = options.paths.filter(value => typeof value === "string" && value.startsWith(".ai-org/views/"));
    const paths = options.paths.filter(value => !ignored.includes(value)).sort();
    if (!paths.length) throw new Error("Generated views are not reconciliation authority; select canonical records");
    const files = [];
    const conflicts = [];
    const documents = new Map();
    for (const relativePath of paths) {
      const local = await currentBytes(target, relativePath);
      const base = revisionBytes(target, baseRevision, relativePath);
      const incoming = revisionBytes(target, incomingRevision, relativePath);
      const result = reconcileDocuments(parseBody(base, relativePath), parseBody(local, relativePath), parseBody(incoming, relativePath), { kind: relativePath.endsWith(".jsonl") ? "events" : "json" });
      conflicts.push(...result.conflicts.map(entry => ({ ...entry, file: relativePath })));
      if (result.valid) documents.set(relativePath, result.merged);
      files.push({ path: relativePath, base_sha256: base === null ? null : sha256(base), current_sha256: local === null ? null : sha256(local),
        incoming_sha256: incoming === null ? null : sha256(incoming), before: local,
        after: result.valid ? serialize(result.merged, relativePath) : null, valid: result.valid });
    }
    const validation = conflicts.length ? { conflicts: [], inputs: [] } : await validateCombinedDocuments(target, documents);
    conflicts.push(...validation.conflicts);
    const source = { base_revision: baseRevision, incoming_revision: incomingRevision, validation_inputs: validation.inputs,
      files: files.map(({ path: file, base_sha256, current_sha256, incoming_sha256 }) => ({ path: file, base_sha256, current_sha256, incoming_sha256 })) };
    const fingerprint = hash(source);
    return { schema_version: RECONCILIATION_SCHEMA, valid: conflicts.length === 0, errors: [], conflicts,
      mutation_performed: false, authority: "reconciliation-only", fingerprint, ...source, changes: files.filter(file => file.valid && file.before !== file.after),
      ignored_generated_paths: ignored.sort(), views_rebuild_required: true,
      next_action: conflicts.length ? "Resolve conflicts with the responsible owners and make a fresh preview." : "Apply the reviewed source fingerprint; rebuild views from the resulting canonical records." };
  } catch (error) { return failure("RECONCILIATION_INPUT_INVALID", error.message, { conflicts: [] }); }
}

async function stateDirectory(target, required = true) {
  const result = git(target, ["rev-parse", "--absolute-git-dir"]);
  if (result.status !== 0) {
    if (!required) return null;
    throw new Error("Reconciliation requires a Git checkout");
  }
  let directory = await fs.realpath(result.stdout.trim());
  const root = await fs.realpath(target);
  for (const part of ["temple", "reconciliation", sha256(root).slice(0, 20)]) {
    directory = path.join(directory, part);
    const stat = await fs.lstat(directory).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error("Unsafe reconciliation recovery directory");
  }
  return directory;
}
async function readPending(target, required = true) {
  const directory = await stateDirectory(target, required);
  if (!directory) return null;
  const file = path.join(directory, "pending.json");
  const stat = await fs.lstat(file).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES * MAX_PATHS * 2) throw new Error("Unsafe reconciliation journal");
  return { file, journal: JSON.parse(await fs.readFile(file, "utf8")) };
}
export async function assertNoPendingReconciliation(target) {
  const pending = await readPending(target, false);
  if (pending) {
    const error = new Error(`Reconciliation ${pending.journal.transaction_id ?? "unknown"} needs recovery; inspect it and roll back before another mutation`);
    error.code = "RECONCILIATION_PENDING_RECOVERY";
    throw error;
  }
}
async function withReconciliationLock(target, operation) {
  const directory = await stateDirectory(target);
  await fs.mkdir(directory, { recursive: true });
  const lock = path.join(directory, "mutation.lock");
  const identity = formatJson({ pid: process.pid, hostname: os.hostname() });
  try { await durableAtomicCreate(lock, identity); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const stat = await fs.lstat(lock);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe reconciliation lock");
    const owner = JSON.parse(await fs.readFile(lock, "utf8"));
    let alive = true;
    if (owner.hostname === os.hostname() && Number.isSafeInteger(owner.pid) && owner.pid > 0) {
      try { process.kill(owner.pid, 0); } catch (signalError) { if (signalError.code === "ESRCH") alive = false; }
    }
    if (alive || (await fs.lstat(lock)).ino !== stat.ino) throw error;
    await durableUnlink(lock);
    await durableAtomicCreate(lock, identity);
  }
  try { return await operation(directory); }
  finally { if (await fs.readFile(lock, "utf8") === identity) await durableUnlink(lock); }
}
function journalChecksum(journal) {
  const { journal_sha256: _digest, ...body } = journal;
  return hash(body);
}
async function saveJournal(file, journal) { await durableAtomicWrite(file, formatJson({ ...journal, journal_sha256: journalChecksum(journal) })); }
async function writeBody(target, relativePath, body) {
  const file = await safeFile(target, relativePath);
  if (body === null) await durableUnlink(file);
  else await durableAtomicWrite(file, body);
}
async function rollback(target, pending) {
  const { journal, file } = pending;
  if (journal.schema_version !== "temple.reconciliation-journal/v1" || journal.target !== await fs.realpath(target)
    || journal.journal_sha256 !== journalChecksum(journal) || !Array.isArray(journal.changes) || journal.changes.length > MAX_PATHS) throw new Error("Invalid reconciliation recovery journal; preserve it for investigation");
  // Preflight every path before restoring any: edits made after failure must survive.
  for (const change of journal.changes) {
    const current = await currentBytes(target, change.path);
    if (current !== change.before && current !== change.after) throw new Error(`Recovery conflict at ${change.path}; preserve the intervening edit and journal`);
  }
  for (const change of [...journal.changes].reverse()) {
    if (await currentBytes(target, change.path) !== change.before) await writeBody(target, change.path, change.before);
  }
  const receipt = { ...journal, status: "rolled-back" };
  await saveJournal(path.join(path.dirname(file), `${journal.transaction_id}.json`), receipt);
  await durableUnlink(file);
  return { valid: true, errors: [], transaction_id: journal.transaction_id, mutation_performed: true,
    canonical_mutation_performed: false, mutation_status: "rolled-back", views_rebuild_required: true };
}

/** Caller still holds the ordinary project mutation lock and existing authority. */
export async function applyReconciliation(target, preview, options = {}) {
  try {
    return await withReconciliationLock(target, async directory => {
      await assertNoPendingReconciliation(target);
      if (preview?.schema_version !== RECONCILIATION_SCHEMA || !preview.valid || !/^[a-f0-9]{64}$/.test(preview.fingerprint ?? "")) return failure("RECONCILIATION_PREVIEW_INVALID", "A conflict-free reviewed preview is required");
      if (options.expectedFingerprint && options.expectedFingerprint !== preview.fingerprint) return failure("RECONCILIATION_STALE_PREVIEW", "The requested fingerprint differs from the preview");
      // Recompute from actual files. Never execute client-supplied replacement bytes.
      const fresh = await previewReconciliation(target, { baseRevision: preview.base_revision, incomingRevision: preview.incoming_revision, paths: preview.files.map(file => file.path) });
      if (!fresh.valid || fresh.fingerprint !== preview.fingerprint) return failure("RECONCILIATION_STALE_PREVIEW", "Base, incoming or current records changed; make a fresh preview", { conflicts: fresh.conflicts });
      if (!fresh.changes.length) return { valid: true, errors: [], mutation_performed: false, mutation_status: "unchanged", fingerprint: fresh.fingerprint, views_rebuild_required: true };
      const transactionId = `reconcile-${fresh.fingerprint.slice(0, 24)}`;
      const journal = { schema_version: "temple.reconciliation-journal/v1", transaction_id: transactionId,
        target: await fs.realpath(target), fingerprint: fresh.fingerprint, changes: fresh.changes, status: "applying" };
      const pendingPath = path.join(directory, "pending.json");
      await durableAtomicCreate(pendingPath, formatJson({ ...journal, journal_sha256: journalChecksum(journal) }));
      try {
        for (const change of fresh.changes) {
          if (await currentBytes(target, change.path) !== change.before) throw new Error(`Current content changed before write: ${change.path}`);
          await writeBody(target, change.path, change.after);
        }
        await saveJournal(path.join(directory, `${transactionId}.json`), { ...journal, status: "applied" });
        await durableUnlink(pendingPath);
        return { valid: true, errors: [], mutation_performed: true, mutation_status: "applied", transaction_id: transactionId,
          changed_paths: fresh.changes.map(change => change.path), fingerprint: fresh.fingerprint, views_rebuild_required: true,
          acceptance_granted: false, next_action: "Rebuild generated views, run Doctor, and assess candidate acceptance separately." };
      } catch (error) {
        try {
          const recovered = await rollback(target, await readPending(target));
          return failure("RECONCILIATION_APPLY_FAILED", error.message, { ...recovered, valid: false, errors: [error.message] });
        } catch (recoveryError) {
          return failure("RECONCILIATION_PENDING_RECOVERY", `${error.message}; ${recoveryError.message}`, { mutation_performed: true,
            mutation_status: "pending-recovery", transaction_id: transactionId, next_action: "Preserve current files and the journal; resolve intervening edits and run reconciliation recovery." });
        }
      }
    });
  } catch (error) { return failure(error.code === "EEXIST" ? "RECONCILIATION_BUSY" : error.code ?? "RECONCILIATION_APPLY_FAILED", error.message); }
}

export async function recoverReconciliation(target, options = {}) {
  try {
    return await withReconciliationLock(target, async () => {
      const pending = await readPending(target);
      if (!pending) return { valid: true, errors: [], mutation_performed: false, mutation_status: "no-pending-recovery" };
      if (options.action !== "rollback" || options.transactionId !== pending.journal.transaction_id) return failure("RECONCILIATION_RECOVERY_REQUIRED", "Select rollback and the exact pending transaction ID", { transaction_id: pending.journal.transaction_id });
      return rollback(target, pending);
    });
  } catch (error) { return failure("RECONCILIATION_RECOVERY_FAILED", error.message, { mutation_status: "pending-recovery" }); }
}

/** Deterministic navigation data; callers rebuild their existing views from canonical files. */
export function reconciliationProjection(documents) {
  return { schema_version: "temple.reconciliation-view/v1", authority: "generated-navigation-only",
    records: Object.entries(documents).filter(([file]) => SUPPORTED.test(file)).sort(([a], [b]) => a.localeCompare(b))
      .map(([file, document]) => ({ path: file, semantic_sha256: hash(document), work_item_id: document?.id ?? null, state: document?.state ?? null })) };
}
