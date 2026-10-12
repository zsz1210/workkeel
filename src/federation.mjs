import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { atomicCreate, formatJson, pathExists, sha256 } from "./files.mjs";
import { normalizeWorkflow } from "./workflow.mjs";

const execFile = promisify(execFileCallback);

export const FEDERATION_REGISTRY_RELATIVE_PATH = ".ai-org/project/federation.json";
export const FEDERATION_REGISTRY_SCHEMA = "temple.federation/v1";
export const FEDERATION_PORTFOLIO_SCHEMA = "temple.federated-portfolio/v1";

const PROJECT_ID = /^[a-z0-9][a-z0-9-]*$/;
const WORK_ITEM_ID = /^WI-(?:[0-9]{4,}|[0-9]{8}-[A-F0-9]{10})$/;
const RECORD_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const SOURCE_REVISION = /^[0-9a-f]{40,64}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_TREE_BYTES = 1024 * 1024;
const MAX_DISCOVERED_WORK_ITEMS = 1000;
const REGULAR_GIT_MODES = new Set(["100644", "100755"]);
const GIT_CONFIG_ARGS = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  `core.hooksPath=${os.devNull}`,
  "-c",
  "credential.helper=",
  "-c",
  "core.askPass=",
  "-c",
  "protocol.allow=never",
  "-c",
  "protocol.file.allow=never",
  "-c",
  "protocol.git.allow=never",
  "-c",
  "protocol.http.allow=never",
  "-c",
  "protocol.https.allow=never",
  "-c",
  "protocol.ssh.allow=never",
  "-c",
  "protocol.ext.allow=never"
];

export function emptyFederationRegistry(now = new Date(0)) {
  const updatedAt = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(updatedAt.getTime())) throw new Error("now must be a valid date");
  return {
    schema_version: FEDERATION_REGISTRY_SCHEMA,
    participants: [],
    initiatives: [],
    dependencies: [],
    contracts: [],
    rollout_waves: [],
    updated_at: updatedAt.toISOString()
  };
}

export async function ensureFederationRegistry(target) {
  const registryPath = path.join(target, FEDERATION_REGISTRY_RELATIVE_PATH);
  if (await pathExists(registryPath)) return { path: registryPath, created: false, afterHash: null };
  const content = formatJson(emptyFederationRegistry());
  try {
    await atomicCreate(registryPath, content);
    return { path: registryPath, created: true, afterHash: sha256(content) };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return { path: registryPath, created: false, afterHash: null };
  }
}

const ROOT_KEYS = new Set([
  "schema_version",
  "participants",
  "initiatives",
  "dependencies",
  "contracts",
  "rollout_waves",
  "updated_at"
]);
const PARTICIPANT_KEYS = new Set([
  "id",
  "path",
  "expected_project_id",
  "expected_revision",
  "expected_revision_observed_at",
  "max_age_seconds",
  "max_work_items"
]);
const VERSIONED_KEYS = new Set(["id", "version", "revision", "work_items"]);
const DEPENDENCY_KEYS = new Set(["id", "version", "revision", "predecessor", "successor"]);
const CONTRACT_KEYS = new Set([
  "id",
  "kind",
  "version",
  "revision",
  "compatibility",
  "owner",
  "consumers"
]);
const WAVE_KEYS = new Set(["id", "version", "revision", "order", "work_items", "contract_refs"]);
const COMPOSITE_KEYS = new Set(["project_id", "work_item_id", "revision"]);
const CONTRACT_REF_KEYS = new Set(["id", "version", "revision"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value, maximum = 200) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function hasOnlyKeys(value, allowed) {
  return isObject(value) && Object.keys(value).every((key) => allowed.has(key));
}

function isIsoTimestamp(value) {
  return isNonEmptyString(value) && ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}

function isRepositoryPath(value) {
  return (
    isNonEmptyString(value, 500) &&
    !path.isAbsolute(value) &&
    !path.win32.isAbsolute(value) &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    path.posix.normalize(value) === value &&
    value !== "." &&
    value !== ".."
  );
}

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function validateComposite(value, label, errors) {
  if (!isObject(value)) {
    errors.push(`${label} must be a composite reference object; bare Work Item IDs are not accepted`);
    return;
  }
  if (!hasOnlyKeys(value, COMPOSITE_KEYS)) errors.push(`${label} has unknown properties`);
  if (!PROJECT_ID.test(value.project_id ?? "")) errors.push(`${label}.project_id is invalid`);
  if (!WORK_ITEM_ID.test(value.work_item_id ?? "")) errors.push(`${label}.work_item_id is invalid`);
  if (!SOURCE_REVISION.test(value.revision ?? "")) errors.push(`${label}.revision must be an exact source revision`);
}

function validateContractReference(value, label, errors) {
  if (!isObject(value) || !hasOnlyKeys(value, CONTRACT_REF_KEYS)) {
    errors.push(`${label} must contain only id, version, and revision`);
    return;
  }
  if (!RECORD_ID.test(value.id ?? "")) errors.push(`${label}.id is invalid`);
  if (!isNonEmptyString(value.version)) errors.push(`${label}.version is required`);
  if (!isNonEmptyString(value.revision)) errors.push(`${label}.revision is required`);
}

function validateUniqueRecords(records, label, errors, validator) {
  if (!Array.isArray(records)) {
    errors.push(`${label} must be an array`);
    return;
  }
  const ids = new Set();
  for (const [index, record] of records.entries()) {
    const itemLabel = `${label}[${index}]`;
    if (!isObject(record)) {
      errors.push(`${itemLabel} must be an object`);
      continue;
    }
    if (!RECORD_ID.test(record.id ?? "")) errors.push(`${itemLabel}.id is invalid`);
    if (ids.has(record.id)) errors.push(`${itemLabel}.id is duplicated`);
    ids.add(record.id);
    validator(record, itemLabel, errors);
  }
}

export function validateFederationRegistry(document) {
  const errors = [];
  if (!isObject(document)) return { valid: false, errors: ["federation registry must be an object"] };
  if (!hasOnlyKeys(document, ROOT_KEYS)) errors.push("federation registry has unknown properties");
  if (document.schema_version !== FEDERATION_REGISTRY_SCHEMA) {
    errors.push(`schema_version must be ${FEDERATION_REGISTRY_SCHEMA}`);
  }
  if (!isIsoTimestamp(document.updated_at)) errors.push("updated_at must be an ISO timestamp");

  validateUniqueRecords(document.participants, "participants", errors, (participant, label) => {
    if (!hasOnlyKeys(participant, PARTICIPANT_KEYS)) errors.push(`${label} has unknown properties`);
    if (!isRepositoryPath(participant.path)) errors.push(`${label}.path is not a safe relative repository path`);
    if (!PROJECT_ID.test(participant.expected_project_id ?? "")) errors.push(`${label}.expected_project_id is invalid`);
    if (participant.id !== participant.expected_project_id) {
      errors.push(`${label}.id must equal the participant's immutable project ID`);
    }
    if (!SOURCE_REVISION.test(participant.expected_revision ?? "")) {
      errors.push(`${label}.expected_revision must be an exact source revision`);
    }
    if (!isIsoTimestamp(participant.expected_revision_observed_at)) {
      errors.push(`${label}.expected_revision_observed_at must be an ISO timestamp`);
    }
    if (
      participant.max_age_seconds !== undefined &&
      (!Number.isInteger(participant.max_age_seconds) || participant.max_age_seconds < 1 || participant.max_age_seconds > 31_536_000)
    ) {
      errors.push(`${label}.max_age_seconds must be an integer from 1 to 31536000`);
    }
    if (
      participant.max_work_items !== undefined &&
      (!Number.isInteger(participant.max_work_items) || participant.max_work_items < 1 || participant.max_work_items > 250)
    ) {
      errors.push(`${label}.max_work_items must be an integer from 1 to 250`);
    }
  });

  validateUniqueRecords(document.initiatives, "initiatives", errors, (record, label) => {
    if (!hasOnlyKeys(record, VERSIONED_KEYS)) errors.push(`${label} has unknown properties`);
    if (!isNonEmptyString(record.version)) errors.push(`${label}.version is required`);
    if (!isNonEmptyString(record.revision)) errors.push(`${label}.revision is required`);
    if (!Array.isArray(record.work_items) || record.work_items.length === 0) errors.push(`${label}.work_items is required`);
    for (const [index, reference] of (record.work_items ?? []).entries()) {
      validateComposite(reference, `${label}.work_items[${index}]`, errors);
    }
  });

  validateUniqueRecords(document.dependencies, "dependencies", errors, (record, label) => {
    if (!hasOnlyKeys(record, DEPENDENCY_KEYS)) errors.push(`${label} has unknown properties`);
    if (!isNonEmptyString(record.version)) errors.push(`${label}.version is required`);
    if (!isNonEmptyString(record.revision)) errors.push(`${label}.revision is required`);
    validateComposite(record.predecessor, `${label}.predecessor`, errors);
    validateComposite(record.successor, `${label}.successor`, errors);
  });

  validateUniqueRecords(document.contracts, "contracts", errors, (record, label) => {
    if (!hasOnlyKeys(record, CONTRACT_KEYS)) errors.push(`${label} has unknown properties`);
    if (!["api", "event"].includes(record.kind)) errors.push(`${label}.kind must be api or event`);
    if (!isNonEmptyString(record.version)) errors.push(`${label}.version is required`);
    if (!isNonEmptyString(record.revision)) errors.push(`${label}.revision is required`);
    if (!["compatible", "incompatible", "unknown"].includes(record.compatibility)) {
      errors.push(`${label}.compatibility must be compatible, incompatible, or unknown`);
    }
    validateComposite(record.owner, `${label}.owner`, errors);
    if (!Array.isArray(record.consumers) || record.consumers.length === 0) errors.push(`${label}.consumers is required`);
    for (const [index, reference] of (record.consumers ?? []).entries()) {
      validateComposite(reference, `${label}.consumers[${index}]`, errors);
    }
  });

  validateUniqueRecords(document.rollout_waves, "rollout_waves", errors, (record, label) => {
    if (!hasOnlyKeys(record, WAVE_KEYS)) errors.push(`${label} has unknown properties`);
    if (!isNonEmptyString(record.version)) errors.push(`${label}.version is required`);
    if (!isNonEmptyString(record.revision)) errors.push(`${label}.revision is required`);
    if (!Number.isInteger(record.order) || record.order < 1) errors.push(`${label}.order must be a positive integer`);
    if (!Array.isArray(record.work_items) || record.work_items.length === 0) errors.push(`${label}.work_items is required`);
    for (const [index, reference] of (record.work_items ?? []).entries()) {
      validateComposite(reference, `${label}.work_items[${index}]`, errors);
    }
    if (!Array.isArray(record.contract_refs) || record.contract_refs.length === 0) {
      errors.push(`${label}.contract_refs is required`);
    }
    for (const [index, reference] of (record.contract_refs ?? []).entries()) {
      validateContractReference(reference, `${label}.contract_refs[${index}]`, errors);
    }
  });

  const participants = new Map((document.participants ?? []).map((entry) => [entry.expected_project_id, entry]));
  if (participants.size !== (document.participants ?? []).length) {
    errors.push("participants.expected_project_id values must be unique");
  }
  const compositeReferences = [
    ...(document.initiatives ?? []).flatMap((entry) => entry.work_items ?? []),
    ...(document.dependencies ?? []).flatMap((entry) => [entry.predecessor, entry.successor]),
    ...(document.contracts ?? []).flatMap((entry) => [entry.owner, ...(entry.consumers ?? [])]),
    ...(document.rollout_waves ?? []).flatMap((entry) => entry.work_items ?? [])
  ].filter(isObject);
  for (const reference of compositeReferences) {
    const participant = participants.get(reference.project_id);
    if (!participant) errors.push(`composite reference uses undeclared project: ${reference.project_id}`);
    else if (reference.revision !== participant.expected_revision) {
      errors.push(`composite reference for ${reference.project_id} does not match its expected revision`);
    }
  }

  const contracts = new Map((document.contracts ?? []).map((entry) => [entry.id, entry]));
  const waveOrders = new Set();
  const wavedContracts = new Set();
  const workItemsByWavedContract = new Map();
  for (const wave of document.rollout_waves ?? []) {
    if (waveOrders.has(wave.order)) errors.push(`rollout wave order is duplicated: ${wave.order}`);
    waveOrders.add(wave.order);
    for (const reference of wave.contract_refs ?? []) {
      const contract = contracts.get(reference.id);
      if (!contract) errors.push(`rollout wave references unknown contract: ${reference.id}`);
      else if (reference.version !== contract.version || reference.revision !== contract.revision) {
        errors.push(`rollout wave contract reference is stale: ${reference.id}`);
      } else {
        wavedContracts.add(reference.id);
        const workItems = workItemsByWavedContract.get(reference.id) ?? new Set();
        for (const workItem of wave.work_items ?? []) workItems.add(JSON.stringify(workItem));
        workItemsByWavedContract.set(reference.id, workItems);
      }
    }
  }
  for (const contract of document.contracts ?? []) {
    if (contract.compatibility === "incompatible" && !wavedContracts.has(contract.id)) {
      errors.push(`incompatible contract requires an explicit rollout wave: ${contract.id}`);
    } else if (contract.compatibility === "incompatible") {
      const wavedWorkItems = workItemsByWavedContract.get(contract.id) ?? new Set();
      const required = [contract.owner, ...(contract.consumers ?? [])];
      if (required.some((reference) => !wavedWorkItems.has(JSON.stringify(reference)))) {
        errors.push(`incompatible contract rollout waves must include its owner and every consumer: ${contract.id}`);
      }
    }
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export function compositeWorkItemReference(projectId, workItemId, revision) {
  const reference = { project_id: projectId, work_item_id: workItemId, revision };
  const errors = [];
  validateComposite(reference, "reference", errors);
  if (errors.length > 0) throw new Error(errors.join("; "));
  return reference;
}

export function parseCompositeWorkItemReference(value) {
  const errors = [];
  validateComposite(value, "reference", errors);
  if (errors.length > 0) throw new Error(errors.join("; "));
  return { project_id: value.project_id, work_item_id: value.work_item_id, revision: value.revision };
}

export async function readFederationRegistry(target) {
  return secureReadJson(await fs.realpath(target), FEDERATION_REGISTRY_RELATIVE_PATH);
}

async function secureReadJson(repositoryRoot, relativePath) {
  const candidate = path.resolve(repositoryRoot, relativePath);
  if (!within(repositoryRoot, candidate)) {
    const error = new Error("repository path escapes its authority boundary");
    error.code = "EBOUNDARY";
    throw error;
  }
  let current = repositoryRoot;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    const component = await fs.lstat(current);
    if (component.isSymbolicLink()) {
      const error = new Error("repository path contains a symbolic link");
      error.code = "EINVAL";
      throw error;
    }
  }
  const stat = await fs.lstat(candidate);
  if (!stat.isFile()) {
    const error = new Error("repository path is not a regular file");
    error.code = "EINVAL";
    throw error;
  }
  if (stat.size > MAX_JSON_BYTES) {
    const error = new Error("repository document exceeds the read limit");
    error.code = "ETOOBIG";
    throw error;
  }
  return JSON.parse(await fs.readFile(candidate, "utf8"));
}

async function gitOutput(repositoryRoot, args, maxBuffer = 256 * 1024) {
  const env = {
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: os.devNull,
    GIT_LITERAL_PATHSPECS: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C"
  };
  const executablePath = process.env.PATH ?? process.env.Path;
  if (executablePath) env.PATH = executablePath;
  if (process.platform === "win32" && process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  const result = await execFile("git", [...GIT_CONFIG_ARGS, "-C", repositoryRoot, ...args], {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer,
    env
  });
  return result.stdout;
}

async function git(repositoryRoot, args) {
  return (await gitOutput(repositoryRoot, args)).trim();
}

function gitPathError(message, code = "EINVAL") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseGitTreeEntries(output) {
  if (!output) return [];
  return output
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const match = /^(\d{6}) ([a-z]+) ([0-9a-f]{40,64})\t([\s\S]+)$/.exec(record);
      if (!match) throw gitPathError("Git returned an invalid tree entry");
      return { mode: match[1], type: match[2], object: match[3], path: match[4] };
    });
}

async function gitTreeEntry(repositoryRoot, revision, relativePath) {
  const entries = parseGitTreeEntries(
    await gitOutput(repositoryRoot, ["ls-tree", "-z", "--full-tree", revision, "--", relativePath], 64 * 1024)
  ).filter((entry) => entry.path === relativePath);
  if (entries.length === 0) throw gitPathError("canonical path is missing from the expected revision", "ENOENT");
  if (entries.length !== 1) throw gitPathError("canonical path is ambiguous in the expected revision");
  return entries[0];
}

async function gitReadJson(repositoryRoot, revision, relativePath) {
  const entry = await gitTreeEntry(repositoryRoot, revision, relativePath);
  if (entry.type !== "blob" || !REGULAR_GIT_MODES.has(entry.mode)) {
    throw gitPathError("canonical document is not a regular Git blob");
  }
  const objectSpec = `${revision}:${relativePath}`;
  const size = Number(await git(repositoryRoot, ["cat-file", "-s", objectSpec]));
  if (!Number.isSafeInteger(size) || size < 0) throw gitPathError("canonical document has an invalid Git object size");
  if (size > MAX_JSON_BYTES) throw gitPathError("canonical document exceeds the read limit", "ETOOBIG");
  const content = await gitOutput(repositoryRoot, ["cat-file", "blob", objectSpec], MAX_JSON_BYTES + 1024);
  if (Buffer.byteLength(content, "utf8") !== size) throw gitPathError("canonical Git blob size changed while reading");
  return JSON.parse(content);
}

async function gitDirectoryEntries(repositoryRoot, revision, relativePath) {
  const directory = await gitTreeEntry(repositoryRoot, revision, relativePath);
  if (directory.type !== "tree" || directory.mode !== "040000") {
    throw gitPathError("canonical directory is not a Git tree");
  }
  return parseGitTreeEntries(
    await gitOutput(repositoryRoot, ["ls-tree", "-z", `${revision}:${relativePath}`], MAX_TREE_BYTES)
  );
}

function diagnostic(code) {
  return { code };
}

function unknownSignal(reasonCode, sourceKind = "canonical-aggregate") {
  return { status: "unknown", source_kind: sourceKind, authoritative: false, reason_code: reasonCode };
}

function unknownSignals(reasonCode = "participant_unknown") {
  return {
    status: unknownSignal(reasonCode),
    capacity: unknownSignal(reasonCode),
    evidence: unknownSignal(reasonCode),
    risk: unknownSignal(reasonCode),
    usage: unknownSignal(reasonCode, "generated-projection")
  };
}

function unknownParticipant(participant, code, observedAt) {
  return {
    participant_id: participant.id,
    expected_project_id: participant.expected_project_id,
    status: "unknown",
    diagnostics: [diagnostic(code)],
    provenance: {
      expected_revision: participant.expected_revision,
      source_revision: null,
      observed_at: observedAt
    },
    project: null,
    work_items: [],
    signals: unknownSignals()
  };
}

function classifyReadFailure(error) {
  if (["ENOENT", "ENOTDIR"].includes(error?.code)) return "participant_missing";
  if (error?.code === "EBOUNDARY") return "unsafe_path";
  if (["EACCES", "EPERM"].includes(error?.code)) return "participant_unreadable";
  return "participant_invalid";
}

function validateProjectDocuments(lock, project) {
  return (
    isObject(lock) &&
    lock.schema_version === "temple.lock/v1" &&
    isObject(lock.template) &&
    isNonEmptyString(lock.template.version) &&
    PROJECT_ID.test(lock.project_id ?? "") &&
    isObject(project) &&
    project.schema_version === "temple.project/v1" &&
    PROJECT_ID.test(project.id ?? "") &&
    isNonEmptyString(project.name) &&
    isIsoTimestamp(project.initialized_at)
  );
}

function validateProjectedWorkItem(item, lifecycleStates) {
  return (
    isObject(item) &&
    item.schema_version === "temple.work-item/v1" &&
    WORK_ITEM_ID.test(item.id ?? "") &&
    isNonEmptyString(item.title, 500) &&
    isNonEmptyString(item.state, 100) &&
    lifecycleStates.has(item.state) &&
    isNonEmptyString(item.owner_position, 100) &&
    Array.isArray(item.evidence) &&
    (item.updated_at === undefined || isIsoTimestamp(item.updated_at))
  );
}

function projectWorkItem(projectId, sourceRevision, item) {
  const documentRefs = (values) =>
    Array.isArray(values)
      ? values
          .filter((entry) => isObject(entry) && isNonEmptyString(entry.id) && isNonEmptyString(entry.revision))
          .map((entry) => ({ id: entry.id, revision: entry.revision }))
      : [];
  return {
    ref: { project_id: projectId, work_item_id: item.id, revision: sourceRevision },
    title: item.title,
    state: item.state,
    updated_at: item.updated_at ?? null,
    specification_mode: item.specification_mode ?? null,
    ui_delivery_mode: item.ui_delivery_mode ?? null,
    spec_refs: documentRefs(item.spec_refs),
    ux_refs: documentRefs(item.ux_refs),
    ui_refs: documentRefs(item.ui_refs),
    contract_refs: documentRefs(item.contract_refs)
  };
}

function countsBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

async function optionalRevisionJson(repositoryRoot, revision, relativePath) {
  try {
    return { status: "found", document: await gitReadJson(repositoryRoot, revision, relativePath) };
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error?.code)) return { status: "missing", document: null };
    return { status: "invalid", document: null };
  }
}

async function optionalWorkingJson(repositoryRoot, relativePath) {
  try {
    return { status: "found", document: await secureReadJson(repositoryRoot, relativePath) };
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error?.code)) return { status: "missing", document: null };
    return { status: "invalid", document: null };
  }
}

function statusSignal(items, truncated) {
  if (truncated) {
    return {
      ...unknownSignal("projection_truncated"),
      work_items_projected: items.length,
      by_state: countsBy(items.map((item) => item.state))
    };
  }
  return {
    status: "observed",
    source_kind: "canonical-aggregate",
    authoritative: false,
    work_items_projected: items.length,
    by_state: countsBy(items.map((item) => item.state))
  };
}

function riskSignal(items, truncated) {
  if (truncated) return unknownSignal("projection_truncated");
  const allowed = new Set(["low", "standard", "high", "critical"]);
  if (items.some((item) => item.risk_tier !== undefined && !allowed.has(item.risk_tier))) {
    return unknownSignal("risk_signal_invalid");
  }
  const declared = items.filter((item) => allowed.has(item.risk_tier));
  if (declared.length === 0) return unknownSignal("risk_signal_not_declared");
  if (declared.length !== items.length) {
    return {
      ...unknownSignal("risk_signal_incomplete"),
      work_items_with_risk: declared.length,
      work_items_projected: items.length,
      by_tier: countsBy(declared.map((item) => item.risk_tier))
    };
  }
  return {
    status: "observed",
    source_kind: "canonical-aggregate",
    authoritative: false,
    work_items_with_risk: declared.length,
    work_items_projected: items.length,
    by_tier: countsBy(declared.map((item) => item.risk_tier))
  };
}

async function capacitySignal(repositoryRoot, revision) {
  const source = await optionalRevisionJson(repositoryRoot, revision, ".ai-org/project/resources.json");
  if (source.status === "missing") return unknownSignal("capacity_source_missing");
  if (source.status !== "found") return unknownSignal("capacity_source_invalid");
  const document = source.document;
  if (
    document?.schema_version !== "temple.resources/v1" ||
    !Array.isArray(document.resources) ||
    !Array.isArray(document.reservations)
  ) {
    return unknownSignal("capacity_source_invalid");
  }
  const resourceIds = new Set();
  for (const resource of document.resources) {
    if (
      !RECORD_ID.test(resource?.id ?? "") ||
      resourceIds.has(resource.id) ||
      !Number.isInteger(resource.capacity) ||
      resource.capacity < 1 ||
      resource.capacity > 100 ||
      typeof resource.active !== "boolean"
    ) {
      return unknownSignal("capacity_source_invalid");
    }
    resourceIds.add(resource.id);
  }
  const resources = document.resources.filter((entry) => entry.active === true);
  if (
    document.reservations.some(
      (entry) =>
        !resourceIds.has(entry?.resource_id) ||
        !["active", "released"].includes(entry?.status) ||
        !Number.isInteger(entry?.units) ||
        entry.units < 1
    )
  ) {
    return unknownSignal("capacity_source_invalid");
  }
  for (const resource of document.resources) {
    const activeUnits = document.reservations
      .filter((entry) => entry.resource_id === resource.id && entry.status === "active")
      .reduce((total, entry) => total + entry.units, 0);
    if (activeUnits > resource.capacity || (resource.active === false && activeUnits > 0)) {
      return unknownSignal("capacity_source_invalid");
    }
  }
  return {
    status: "observed",
    source_kind: "canonical-aggregate",
    authoritative: false,
    active_resources: resources.length,
    total_capacity_units: resources.reduce((total, entry) => total + entry.capacity, 0),
    active_reserved_units: document.reservations
      .filter((entry) => entry.status === "active")
      .reduce((total, entry) => total + entry.units, 0)
  };
}

async function evidenceSignal(repositoryRoot, revision, now) {
  const source = await optionalRevisionJson(repositoryRoot, revision, ".ai-org/project/evidence.json");
  if (source.status === "missing") return unknownSignal("evidence_source_missing");
  if (source.status !== "found") return unknownSignal("evidence_source_invalid");
  const document = source.document;
  const kinds = new Set(["git-revision", "test", "runtime", "unverified-claim", "risk", "rollback", "github"]);
  const ids = new Set();
  if (
    document?.schema_version !== "temple.evidence/v1" ||
    !Array.isArray(document.entries) ||
    document.entries.some(
      (entry) =>
        !isNonEmptyString(entry?.id) ||
        ids.has(entry.id) ||
        !WORK_ITEM_ID.test(entry?.work_item_id ?? "") ||
        !kinds.has(entry?.kind) ||
        !isIsoTimestamp(entry.recorded_at) ||
        !isIsoTimestamp(entry.observed_at) ||
        !(entry.invalidated_at === null || isIsoTimestamp(entry.invalidated_at)) ||
        !(entry.expires_at === null || isIsoTimestamp(entry.expires_at)) ||
        entry.external_action_performed !== false ||
        (ids.add(entry.id), false)
    )
  ) {
    return unknownSignal("evidence_source_invalid");
  }
  const invalidated = document.entries.filter((entry) => entry.invalidated_at !== null).length;
  const expired = document.entries.filter(
    (entry) => entry.invalidated_at === null && entry.expires_at !== null && Date.parse(entry.expires_at) <= now.getTime()
  ).length;
  return {
    status: "observed",
    source_kind: "canonical-aggregate",
    authoritative: false,
    entries: document.entries.length,
    not_expired_or_invalidated: document.entries.length - invalidated - expired,
    expired,
    invalidated,
    by_kind: countsBy(document.entries.map((entry) => entry.kind))
  };
}

async function usageSignal(repositoryRoot, expectedProjectId) {
  const source = await optionalWorkingJson(repositoryRoot, ".ai-org/views/usage-baseline.json");
  if (source.status === "missing") return unknownSignal("usage_projection_missing", "generated-projection");
  if (source.status !== "found") return unknownSignal("usage_projection_invalid", "generated-projection");
  const document = source.document;
  const observations = document?.source?.observations;
  const totalTokens = document?.totals?.total_tokens;
  if (
    document?.schema_version !== "temple.usage-baseline/v1" ||
    !isIsoTimestamp(document.generated_at) ||
    document?.project?.id !== expectedProjectId ||
    !["observed", "insufficient-data"].includes(document.baseline_status) ||
    !(Number.isInteger(observations) && observations >= 0) ||
    !(totalTokens === null || (Number.isInteger(totalTokens) && totalTokens >= 0))
  ) {
    return unknownSignal("usage_projection_invalid", "generated-projection");
  }
  if (document.baseline_status !== "observed" || observations === 0) {
    return {
      ...unknownSignal("usage_insufficient_data", "generated-projection"),
      generated_at: document.generated_at,
      observations,
      total_tokens: null
    };
  }
  return {
    status: "observed",
    source_kind: "generated-projection",
    authoritative: false,
    generated_at: document.generated_at,
    observations,
    total_tokens: totalTokens
  };
}

async function readParticipant(coordinatorRoot, allowedRoot, participant, now) {
  const observedAt = now.toISOString();
  let repositoryRoot;
  try {
    const candidate = path.resolve(coordinatorRoot, participant.path);
    repositoryRoot = await fs.realpath(candidate);
    if (!within(allowedRoot, repositoryRoot)) return unknownParticipant(participant, "unsafe_path", observedAt);
    if (!(await fs.stat(repositoryRoot)).isDirectory()) return unknownParticipant(participant, "participant_invalid", observedAt);
  } catch (error) {
    return unknownParticipant(participant, classifyReadFailure(error), observedAt);
  }

  try {
    const reportedRoot = await git(repositoryRoot, ["rev-parse", "--show-toplevel"]);
    if (!path.isAbsolute(reportedRoot) || (await fs.realpath(reportedRoot)) !== repositoryRoot) {
      return unknownParticipant(participant, "repository_root_mismatch", observedAt);
    }
  } catch {
    return unknownParticipant(participant, "participant_invalid", observedAt);
  }

  let sourceRevision;
  try {
    sourceRevision = await git(repositoryRoot, ["rev-parse", "--verify", "HEAD"]);
  } catch {
    return unknownParticipant(participant, "source_revision_unavailable", observedAt);
  }
  if (!SOURCE_REVISION.test(sourceRevision)) return unknownParticipant(participant, "source_revision_unavailable", observedAt);
  if (sourceRevision !== participant.expected_revision) {
    const result = unknownParticipant(participant, "source_revision_mismatch", observedAt);
    result.provenance.source_revision = sourceRevision;
    return result;
  }

  if (
    participant.max_age_seconds !== undefined &&
    now.getTime() - Date.parse(participant.expected_revision_observed_at) > participant.max_age_seconds * 1000
  ) {
    const result = unknownParticipant(participant, "stale_revision_observation", observedAt);
    result.provenance.source_revision = sourceRevision;
    return result;
  }

  try {
    const dirty = await git(repositoryRoot, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      "temple.lock",
      ".ai-org/core/workflow.json",
      ".ai-org/project/project.json",
      ".ai-org/project/resources.json",
      ".ai-org/project/evidence.json",
      ".ai-org/work-items"
    ]);
    if (dirty) {
      const result = unknownParticipant(participant, "canonical_state_dirty", observedAt);
      result.provenance.source_revision = sourceRevision;
      return result;
    }
  } catch {
    return unknownParticipant(participant, "source_revision_unavailable", observedAt);
  }

  let lock;
  let project;
  let workflow;
  try {
    [lock, project, workflow] = await Promise.all([
      gitReadJson(repositoryRoot, participant.expected_revision, "temple.lock"),
      gitReadJson(repositoryRoot, participant.expected_revision, ".ai-org/project/project.json"),
      gitReadJson(repositoryRoot, participant.expected_revision, ".ai-org/core/workflow.json")
    ]);
  } catch (error) {
    const result = unknownParticipant(participant, classifyReadFailure(error), observedAt);
    result.provenance.source_revision = sourceRevision;
    return result;
  }
  if (!validateProjectDocuments(lock, project)) {
    const result = unknownParticipant(participant, "participant_invalid", observedAt);
    result.provenance.source_revision = sourceRevision;
    return result;
  }
  if (lock.project_id !== project.id || project.id !== participant.expected_project_id) {
    const result = unknownParticipant(participant, "identity_mismatch", observedAt);
    result.provenance.source_revision = sourceRevision;
    return result;
  }
  let normalizedWorkflow;
  try {
    normalizedWorkflow = normalizeWorkflow(workflow);
  } catch {
    const result = unknownParticipant(participant, "participant_invalid", observedAt);
    result.provenance.source_revision = sourceRevision;
    return result;
  }
  if (
    !Array.isArray(normalizedWorkflow.states) ||
    normalizedWorkflow.states.some((entry) => !isNonEmptyString(entry?.id))
  ) {
    const result = unknownParticipant(participant, "participant_invalid", observedAt);
    result.provenance.source_revision = sourceRevision;
    return result;
  }
  const lifecycleStates = new Set(normalizedWorkflow.states.map((entry) => entry.id));

  const maxWorkItems = participant.max_work_items ?? 100;
  let names;
  try {
    const entries = await gitDirectoryEntries(repositoryRoot, participant.expected_revision, ".ai-org/work-items");
    names = [];
    for (const entry of entries) {
      if (entry.path.endsWith(".json")) {
        if (entry.type !== "blob" || !REGULAR_GIT_MODES.has(entry.mode)) {
          throw gitPathError("Work Item entry is not a regular Git blob");
        }
        names.push(entry.path);
      }
      if (names.length > MAX_DISCOVERED_WORK_ITEMS) break;
    }
  } catch (error) {
    const result = unknownParticipant(participant, classifyReadFailure(error), observedAt);
    result.provenance.source_revision = sourceRevision;
    return result;
  }
  names.sort();

  const selected = names.slice(0, maxWorkItems);
  const workItems = [];
  const sourceWorkItems = [];
  try {
    for (const name of selected) {
      if (!WORK_ITEM_ID.test(name.slice(0, -5))) throw new Error("invalid Work Item filename");
      const item = await gitReadJson(
        repositoryRoot,
        participant.expected_revision,
        `.ai-org/work-items/${name}`
      );
      if (!validateProjectedWorkItem(item, lifecycleStates) || `${item.id}.json` !== name) throw new Error("invalid Work Item");
      sourceWorkItems.push(item);
      workItems.push(projectWorkItem(project.id, sourceRevision, item));
    }
  } catch {
    const result = unknownParticipant(participant, "participant_invalid", observedAt);
    result.provenance.source_revision = sourceRevision;
    return result;
  }

  const diagnostics = [];
  const truncated = names.length > maxWorkItems || names.length > MAX_DISCOVERED_WORK_ITEMS;
  if (truncated) {
    diagnostics.push(diagnostic("projection_truncated"));
  }
  const signals = {
    status: statusSignal(workItems, truncated),
    capacity: await capacitySignal(repositoryRoot, participant.expected_revision),
    evidence: await evidenceSignal(repositoryRoot, participant.expected_revision, now),
    risk: riskSignal(sourceWorkItems, truncated),
    usage: await usageSignal(repositoryRoot, project.id)
  };
  return {
    participant_id: participant.id,
    expected_project_id: participant.expected_project_id,
    status: "current",
    diagnostics,
    provenance: {
      expected_revision: participant.expected_revision,
      source_revision: sourceRevision,
      observed_at: observedAt,
      template_version: lock.template.version
    },
    project: { id: project.id, name: project.name },
    work_items: workItems,
    signals
  };
}

function referenceKey(reference) {
  return `${reference.project_id}\0${reference.work_item_id}\0${reference.revision}`;
}

function coordinationProjection(registry, participants) {
  const currentReferences = new Set(
    participants
      .filter((participant) => participant.status === "current")
      .flatMap((participant) => participant.work_items.map((item) => referenceKey(item.ref)))
  );
  const project = (kind, record, references) => ({
    kind,
    ...record,
    resolution: references.every((reference) => currentReferences.has(referenceKey(reference))) ? "current" : "unknown"
  });
  return {
    initiatives: registry.initiatives.map((record) => project("initiative", record, record.work_items)),
    dependencies: registry.dependencies.map((record) =>
      project("dependency", record, [record.predecessor, record.successor])
    ),
    contracts: registry.contracts.map((record) =>
      project("contract", record, [record.owner, ...record.consumers])
    ),
    rollout_waves: registry.rollout_waves
      .slice()
      .sort((left, right) => left.order - right.order)
      .map((record) => project("rollout-wave", record, record.work_items))
  };
}

export async function buildFederatedPortfolio(target, options = {}) {
  const coordinatorRoot = await fs.realpath(target);
  const allowedRoot = await fs.realpath(options.allowedRoot ?? path.dirname(coordinatorRoot));
  if (!within(allowedRoot, coordinatorRoot)) throw new Error("coordinator repository is outside the allowed federation root");
  const registry = options.registry ?? (await readFederationRegistry(coordinatorRoot));
  const validation = validateFederationRegistry(registry);
  if (!validation.valid) throw new Error(`Invalid federation registry:\n- ${validation.errors.join("\n- ")}`);
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  if (Number.isNaN(now.getTime())) throw new Error("now must be a valid date");

  const participants = [];
  for (const participant of registry.participants) {
    participants.push(await readParticipant(coordinatorRoot, allowedRoot, participant, now));
  }
  participants.sort((left, right) => left.participant_id.localeCompare(right.participant_id));

  return {
    schema_version: FEDERATION_PORTFOLIO_SCHEMA,
    generated_at: now.toISOString(),
    authority: {
      mode: "read-only-projection",
      lifecycle_owner: "participant-repositories",
      coordination_owner: "coordinator-repository",
      lifecycle_mutations_performed: false,
      external_actions_performed: false
    },
    summary: {
      participants: participants.length,
      current: participants.filter((entry) => entry.status === "current").length,
      unknown: participants.filter((entry) => entry.status === "unknown").length,
      work_items_projected: participants.reduce((total, entry) => total + entry.work_items.length, 0),
      overall_completion: null
    },
    participants,
    coordination: coordinationProjection(registry, participants)
  };
}
