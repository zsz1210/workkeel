import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { atomicCreate, atomicWrite, formatJson, pathExists, readJson, sha256, sha256File } from "./files.mjs";
import { isSafeRepositoryPath } from "./context.mjs";
import { isWorkItemId } from "./ids.mjs";
import { appendEvent } from "./project.mjs";
import { readWorkItem } from "./work-items.mjs";

export const EVIDENCE_REGISTRY_RELATIVE_PATH = ".ai-org/project/evidence.json";
export const EVIDENCE_SCHEMA = "temple.evidence/v1";
export const EVIDENCE_KINDS = ["git-revision", "test", "runtime", "unverified-claim", "risk", "rollback", "github"];
export const EVIDENCE_TAG_PREFIX = "temple/evidence";

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const EVIDENCE_ID = /^EVID-[0-9]{8}T[0-9]{6}Z-[A-F0-9]{8}$/;
const RISK_SEVERITIES = ["low", "medium", "high", "critical"];
const RISK_STATUSES = ["open", "accepted", "mitigated"];
const ROLLBACK_STATUSES = ["planned", "verified"];
const RUNTIME_PROVENANCE = ["live", "device", "simulator", "fixture", "build-time"];
const GIT_ARTIFACT_MAX_BUFFER = 256 * 1024 * 1024;

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validTimestamp(value) {
  return nonEmpty(value) && !Number.isNaN(Date.parse(value));
}

function uniqueStrings(values) {
  return [...new Set((values ?? []).map((value) => String(value).trim()).filter(Boolean))];
}

export function evidenceId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `EVID-${stamp}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

export function emptyEvidenceRegistry() {
  return { schema_version: EVIDENCE_SCHEMA, entries: [] };
}

export async function ensureEvidenceRegistry(target) {
  const registryPath = path.join(target, EVIDENCE_REGISTRY_RELATIVE_PATH);
  if (await pathExists(registryPath)) return { path: registryPath, created: false, afterHash: null };
  const content = formatJson(emptyEvidenceRegistry());
  try {
    await atomicCreate(registryPath, content);
    return { path: registryPath, created: true, afterHash: sha256(content) };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return { path: registryPath, created: false, afterHash: null };
  }
}

export async function readEvidenceRegistry(target) {
  const ensured = await ensureEvidenceRegistry(target);
  return readJson(ensured.path);
}

export function validateEvidenceRegistry(registry) {
  const errors = [];
  if (registry?.schema_version !== EVIDENCE_SCHEMA) errors.push(`schema_version must be ${EVIDENCE_SCHEMA}`);
  if (!Array.isArray(registry?.entries)) return { valid: false, errors: [...errors, "entries must be an array"] };
  const ids = new Set();
  for (const [index, entry] of registry.entries.entries()) {
    const label = `entries[${index}]`;
    if (!EVIDENCE_ID.test(entry?.id ?? "") || ids.has(entry?.id)) errors.push(`${label}.id is invalid or duplicated`);
    ids.add(entry?.id);
    if (!isWorkItemId(entry?.work_item_id)) errors.push(`${label}.work_item_id is invalid`);
    if (!EVIDENCE_KINDS.includes(entry?.kind)) errors.push(`${label}.kind is invalid`);
    if (!nonEmpty(entry?.title)) errors.push(`${label}.title is required`);
    if (!nonEmpty(entry?.outcome)) errors.push(`${label}.outcome is required`);
    if (!(entry?.scope_revision === null || SHA.test(entry?.scope_revision ?? ""))) {
      errors.push(`${label}.scope_revision must be null or an exact Git commit`);
    }
    if (!validTimestamp(entry?.recorded_at) || !validTimestamp(entry?.observed_at)) {
      errors.push(`${label} timestamps are invalid`);
    }
    if (!nonEmpty(entry?.recorded_by)) errors.push(`${label}.recorded_by is required`);
    if (!nonEmpty(entry?.summary)) errors.push(`${label}.summary is required`);
    if (!nonEmpty(entry?.adapter?.id) || !nonEmpty(entry?.adapter?.version)) errors.push(`${label}.adapter is invalid`);
    if (entry?.external_action_performed !== false) errors.push(`${label}.external_action_performed must be false`);
    if (!Array.isArray(entry?.artifacts)) errors.push(`${label}.artifacts must be an array`);
    for (const artifact of entry?.artifacts ?? []) {
      if (!isSafeRepositoryPath(artifact?.path) || !DIGEST.test(artifact?.sha256 ?? "")) {
        errors.push(`${label}.artifacts contains an invalid path or digest`);
      }
    }
    if (!entry?.details || typeof entry.details !== "object" || Array.isArray(entry.details)) {
      errors.push(`${label}.details must be an object`);
    }
    if (!(entry?.expires_at === null || validTimestamp(entry?.expires_at))) errors.push(`${label}.expires_at is invalid`);
    if (!(entry?.invalidated_at === null || validTimestamp(entry?.invalidated_at))) errors.push(`${label}.invalidated_at is invalid`);
    if (!(entry?.invalidated_by === null || nonEmpty(entry?.invalidated_by))) errors.push(`${label}.invalidated_by is invalid`);
    if (!(entry?.invalidation_reason === null || nonEmpty(entry?.invalidation_reason))) errors.push(`${label}.invalidation_reason is invalid`);
    if (entry?.invalidated_at === null && (entry?.invalidated_by !== null || entry?.invalidation_reason !== null)) {
      errors.push(`${label} has invalidation metadata without invalidated_at`);
    }
    if (entry?.invalidated_at !== null && (!nonEmpty(entry?.invalidated_by) || !nonEmpty(entry?.invalidation_reason))) {
      errors.push(`${label} invalidation requires actor and reason`);
    }
    const replacementId = entry?.details?.invalidation?.replacement_evidence_id;
    if (!(replacementId === undefined || replacementId === null || EVIDENCE_ID.test(replacementId))) {
      errors.push(`${label}.details.invalidation.replacement_evidence_id is invalid`);
    }
  }
  return { valid: errors.length === 0, errors };
}

function gitObjectExists(target, object) {
  const result = spawnSync("git", ["-C", target, "cat-file", "-e", object], { encoding: "utf8" });
  return result.status === 0;
}

function gitOutput(target, args) {
  const result = spawnSync("git", ["-C", target, ...args], { encoding: "utf8" });
  if (result.status !== 0 || result.error) {
    throw new Error(result.error?.message ?? result.stderr?.trim() ?? `Git ${args[0]} failed`);
  }
  return result.stdout.trim();
}

export function evidencePreservationTag(revision) {
  const normalized = String(revision ?? "").trim().toLowerCase();
  if (!SHA.test(normalized)) throw new Error(`Evidence preservation requires an exact Git commit: ${revision ?? "missing"}`);
  return `${EVIDENCE_TAG_PREFIX}/${normalized}`;
}

function preservedEvidenceRevision(target, revision) {
  const tag = evidencePreservationTag(revision);
  const result = spawnSync("git", ["-C", target, "rev-parse", "--verify", `refs/tags/${tag}^{commit}`], { encoding: "utf8" });
  if (result.status !== 0) return { durable: false, tag, target_revision: null };
  const targetRevision = result.stdout.trim().toLowerCase();
  return { durable: targetRevision === revision, tag, target_revision: targetRevision };
}

export function evidenceRevisionDurability(target, revision) {
  const ancestor = spawnSync("git", ["-C", target, "merge-base", "--is-ancestor", revision, "HEAD"], { encoding: "utf8" });
  if (ancestor.status === 0) return { durable: true, method: "head-ancestry", tag: null, target_revision: revision };
  const preserved = preservedEvidenceRevision(target, revision);
  return { ...preserved, method: preserved.durable ? "evidence-tag" : null };
}

function gitArtifactAtRevision(target, revision, relativePath) {
  const gitPath = relativePath.split(/[\\/]+/).join("/");
  const object = `${revision}:${gitPath}`;
  if (!gitObjectExists(target, object)) return { status: "absent" };
  const result = spawnSync("git", ["-C", target, "cat-file", "blob", object], {
    encoding: null,
    maxBuffer: GIT_ARTIFACT_MAX_BUFFER
  });
  if (result.status !== 0 || result.error) {
    return { status: "error", message: result.error?.message ?? result.stderr?.toString().trim() ?? "unknown Git error" };
  }
  return { status: "found", content: result.stdout };
}

// Cache digests, not artifact bodies, and only for this validation invocation.
// Batch framing is byte-based: blobs may contain newlines and arbitrary bytes.
function historicalArtifactDigests(target, objects) {
  const results = new Map();
  const individual = (object, source) => {
    const result = gitArtifactAtRevision(target, source.revision, source.path);
    results.set(object, result.status === "found" ? { status: "found", digest: sha256(result.content) } : result);
  };
  const entries = [...objects];
  for (let start = 0; start < entries.length; start += 64) {
    const chunk = entries.slice(start, start + 64);
    const batch = chunk.filter(([object]) => !/[\r\n]/.test(object));
    for (const [object, source] of chunk.filter(([object]) => /[\r\n]/.test(object))) individual(object, source);
    if (!batch.length) continue;
    const result = spawnSync("git", ["-C", target, "cat-file", "--batch"], {
      input: `${batch.map(([object]) => object).join("\n")}\n`,
      encoding: null,
      maxBuffer: GIT_ARTIFACT_MAX_BUFFER
    });
    const parsed = new Map();
    let offset = 0;
    let valid = result.status === 0 && !result.error && Buffer.isBuffer(result.stdout);
    if (valid) {
      for (const [object] of batch) {
        const end = result.stdout.indexOf(10, offset);
        if (end < 0) { valid = false; break; }
        const header = result.stdout.subarray(offset, end).toString("utf8");
        offset = end + 1;
        if (header === `${object} missing`) {
          parsed.set(object, { status: "absent" });
          continue;
        }
        const match = /^[0-9a-f]+ blob ([0-9]+)$/.exec(header);
        const size = match ? Number(match[1]) : NaN;
        if (!Number.isSafeInteger(size) || size < 0 || offset + size >= result.stdout.length || result.stdout[offset + size] !== 10) {
          valid = false; break;
        }
        parsed.set(object, { status: "found", digest: sha256(result.stdout.subarray(offset, offset + size)) });
        offset += size + 1;
      }
      valid &&= offset === result.stdout.length;
    }
    if (valid) for (const [object, digest] of parsed) results.set(object, digest);
    // Preserve the old per-object error semantics on oversized batches, unusual
    // object types, or Git/protocol failures. Never interpret partial output as success.
    else for (const [object, source] of batch) individual(object, source);
  }
  return results;
}

export async function validateEvidenceArtifacts(target, registry, workItemIds = null) {
  const errors = [];
  const revisions = new Map();
  const objects = new Map();
  for (const entry of registry?.entries ?? []) {
    if (entry.invalidated_at || !entry.scope_revision) continue;
    const revision = entry.scope_revision;
    if (!revisions.has(revision)) {
      const exists = gitObjectExists(target, `${revision}^{commit}`);
      revisions.set(revision, { exists, durability: exists ? evidenceRevisionDurability(target, revision) : null });
    }
    if (!revisions.get(revision).durability?.durable) continue;
    for (const artifact of entry.artifacts ?? []) {
      const object = `${revision}:${artifact.path.split(/[\\/]+/).join("/")}`;
      objects.set(object, { revision, path: artifact.path });
    }
  }
  const historicalDigests = historicalArtifactDigests(target, objects);
  for (const entry of registry?.entries ?? []) {
    if (workItemIds && !workItemIds.has(entry.work_item_id)) errors.push(`${entry.id}: unknown Work Item ${entry.work_item_id}`);
    if (entry.invalidated_at) continue;
    if (entry.scope_revision && !revisions.get(entry.scope_revision).exists) {
      errors.push(`${entry.id}: recorded revision ${entry.scope_revision} is unavailable`);
      continue;
    }
    if (entry.scope_revision) {
      const durability = revisions.get(entry.scope_revision).durability;
      if (!durability.durable) {
        const tagRef = `refs/tags/${durability.tag}`;
        const conflict = durability.target_revision ? ` but that tag targets ${durability.target_revision}` : "";
        errors.push(
          `${entry.id}: recorded revision ${entry.scope_revision} is not durable; retain it in HEAD ancestry or preserve it as ${tagRef}${conflict}`
        );
        continue;
      }
    }
    for (const artifact of entry.artifacts ?? []) {
      if (entry.scope_revision) {
        const historical = historicalDigests.get(`${entry.scope_revision}:${artifact.path.split(/[\\/]+/).join("/")}`);
        if (historical.status === "found") {
          if (historical.digest !== artifact.sha256) {
            errors.push(`${entry.id}:${artifact.path} digest mismatch at recorded revision ${entry.scope_revision}`);
          }
          continue;
        }
        if (historical.status === "error") {
          errors.push(
            `${entry.id}:${artifact.path} cannot be read at recorded revision ${entry.scope_revision}: ${historical.message}`
          );
          continue;
        }
      }
      const absolute = path.join(target, artifact.path);
      if (!(await pathExists(absolute))) errors.push(`${entry.id}:${artifact.path} is missing`);
      else if ((await sha256File(absolute)) !== artifact.sha256) errors.push(`${entry.id}:${artifact.path} digest mismatch`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function resolveGitRevision(target, revision) {
  const requested = String(revision ?? "").trim();
  if (!requested) throw new Error("A Git revision is required");
  const result = spawnSync("git", ["-C", target, "rev-parse", "--verify", `${requested}^{commit}`], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Git revision cannot be resolved to a commit: ${requested}`);
  const resolved = result.stdout.trim().toLowerCase();
  if (!SHA.test(resolved)) throw new Error(`Git returned an invalid commit for ${requested}`);
  return resolved;
}

function gitPathList(target, args) {
  const result = spawnSync("git", ["-C", target, ...args, "-z"], { encoding: "utf8" });
  if (result.status !== 0 || result.error) throw new Error("Git working-tree paths could not be inspected");
  return result.stdout.split("\0").filter(Boolean);
}

function overlapStem(value) {
  return String(value ?? "").split("*")[0].replace(/\/+$/, "");
}

function pathsOverlap(left, right) {
  const leftStem = overlapStem(left);
  const rightStem = overlapStem(right);
  if (!leftStem || !rightStem) return false;
  return leftStem === rightStem || leftStem.startsWith(`${rightStem}/`) || rightStem.startsWith(`${leftStem}/`);
}

function gitWorkingTreeScope(target, workItem) {
  const dirtyPaths = [...new Set([
    ...gitPathList(target, ["diff", "--name-only"]),
    ...gitPathList(target, ["diff", "--cached", "--name-only"]),
    ...gitPathList(target, ["ls-files", "--others", "--exclude-standard"])
  ])].sort();
  const affectedPathsDirty = dirtyPaths.filter((dirtyPath) =>
    (workItem.affected_paths ?? []).some((affectedPath) => pathsOverlap(dirtyPath, affectedPath))
  );
  return {
    working_tree_dirty: dirtyPaths.length > 0,
    dirty_path_count: dirtyPaths.length,
    dirty_scope: affectedPathsDirty.length > 0 ? "affected-scope" : dirtyPaths.length > 0 ? "outside-affected-scope" : "clean",
    affected_paths_dirty: affectedPathsDirty
  };
}

async function repositoryArtifact(target, relativePath) {
  if (!isSafeRepositoryPath(relativePath)) throw new Error(`Unsafe repository artifact path: ${relativePath}`);
  const absolute = path.join(target, relativePath);
  if (!(await pathExists(absolute))) throw new Error(`Evidence artifact is missing: ${relativePath}`);
  return { path: relativePath, sha256: await sha256File(absolute) };
}

async function observationArtifacts(target, observationPath, artifactRefs) {
  const refs = uniqueStrings([observationPath, ...(artifactRefs ?? [])]);
  return Promise.all(refs.map((reference) => repositoryArtifact(target, reference)));
}

async function readObservationJson(target, observationPath, label, templatePath) {
  try {
    return await readJson(path.join(target, observationPath));
  } catch (error) {
    throw new Error(
      `${label} observation must be valid JSON. Copy ${templatePath} to a project-owned artifact path and replace its placeholders. ${error.message}`
    );
  }
}

function assertObservationTimes(startedAt, completedAt) {
  if (!validTimestamp(startedAt) || !validTimestamp(completedAt)) throw new Error("Observation timestamps are invalid");
  if (Date.parse(completedAt) < Date.parse(startedAt)) throw new Error("Observation completed_at precedes started_at");
}

async function buildTestEvidence(target, options, base) {
  const observationPath = String(options.observation ?? "").trim();
  if (!isSafeRepositoryPath(observationPath)) throw new Error("--observation must be a safe repository-relative path");
  const observation = await readObservationJson(
    target,
    observationPath,
    "Test",
    ".ai-org/templates/test-observation.json"
  );
  if (observation.schema_version !== "temple.test-observation/v1") {
    throw new Error("Invalid test observation schema_version; start with .ai-org/templates/test-observation.json");
  }
  if (!Array.isArray(observation.command) || observation.command.length === 0 || !observation.command.every(nonEmpty)) {
    throw new Error("Test observation command must be a non-empty string array");
  }
  if (!["pass", "fail"].includes(observation.result) || !Number.isInteger(observation.exit_code)) {
    throw new Error("Test observation result or exit_code is invalid");
  }
  if ((observation.result === "pass") !== (observation.exit_code === 0)) {
    throw new Error("Test observation result and exit_code disagree");
  }
  assertObservationTimes(observation.started_at, observation.completed_at);
  const scopeRevision = resolveGitRevision(target, observation.revision);
  return {
    ...base,
    kind: "test",
    title: options.title ?? `Test observation: ${observation.command.join(" ")}`,
    outcome: observation.result,
    scope_revision: scopeRevision,
    observed_at: observation.completed_at,
    summary: options.summary ?? `${observation.command.join(" ")} ${observation.result}`,
    adapter: { id: "test-observation", version: "1", source_ref: observationPath },
    artifacts: await observationArtifacts(target, observationPath, observation.artifact_refs),
    details: { command: observation.command, exit_code: observation.exit_code, started_at: observation.started_at }
  };
}

async function buildRuntimeEvidence(target, options, base) {
  const observationPath = String(options.observation ?? "").trim();
  if (!isSafeRepositoryPath(observationPath)) throw new Error("--observation must be a safe repository-relative path");
  const observation = await readObservationJson(
    target,
    observationPath,
    "Runtime",
    ".ai-org/templates/runtime-observation.json"
  );
  if (observation.schema_version !== "temple.runtime-observation/v1") {
    throw new Error("Invalid runtime observation schema_version; start with .ai-org/templates/runtime-observation.json");
  }
  if (!nonEmpty(observation.environment) || !nonEmpty(observation.scenario)) throw new Error("Runtime environment and scenario are required");
  if (!["pass", "fail"].includes(observation.result)) throw new Error("Runtime result must be pass or fail");
  if (!RUNTIME_PROVENANCE.includes(observation.provenance)) throw new Error("Runtime provenance is invalid");
  if (!validTimestamp(observation.observed_at)) throw new Error("Runtime observed_at is invalid");
  const scopeRevision = resolveGitRevision(target, observation.revision);
  return {
    ...base,
    kind: "runtime",
    title: options.title ?? `Runtime observation: ${observation.scenario}`,
    outcome: observation.result,
    scope_revision: scopeRevision,
    observed_at: observation.observed_at,
    summary: options.summary ?? `${observation.scenario} ${observation.result} in ${observation.environment}`,
    adapter: { id: "runtime-observation", version: "1", source_ref: observationPath },
    artifacts: await observationArtifacts(target, observationPath, observation.artifact_refs),
    details: { environment: observation.environment, scenario: observation.scenario, provenance: observation.provenance }
  };
}

async function buildEvidence(target, kind, options) {
  const workItem = await readWorkItem(target, options.workItemId);
  const timestamp = new Date().toISOString();
  const recordedBy = String(options.actor ?? "human").trim() || "human";
  const agents = await readJson(path.join(target, ".ai-org/project/agents.json"));
  if (recordedBy !== "human" && !(agents.agents ?? []).some((agent) => agent.id === recordedBy && agent.active !== false)) {
    throw new Error(`Unknown evidence actor: ${recordedBy}`);
  }
  const base = {
    id: evidenceId(),
    work_item_id: options.workItemId,
    recorded_at: timestamp,
    recorded_by: recordedBy,
    expires_at: null,
    invalidated_at: null,
    invalidated_by: null,
    invalidation_reason: null,
    external_action_performed: false
  };
  if (kind === "test") return buildTestEvidence(target, options, base);
  if (kind === "runtime") return buildRuntimeEvidence(target, options, base);
  if (kind === "git-revision") {
    const scopeRevision = resolveGitRevision(target, options.revision);
    const workingTree = gitWorkingTreeScope(target, workItem);
    if (workingTree.affected_paths_dirty.length > 0) {
      throw new Error(
        `Cannot record exact Git evidence while declared affected paths are uncommitted: ${workingTree.affected_paths_dirty.join(", ")}`
      );
    }
    return {
      ...base,
      kind,
      title: options.title ?? "Exact Git revision",
      outcome: "verified",
      scope_revision: scopeRevision,
      observed_at: timestamp,
      summary: options.summary ?? `Resolved ${options.revision} to ${scopeRevision}`,
      adapter: { id: "git-local", version: "1", source_ref: String(options.revision) },
      artifacts: [],
      details: { requested_revision: String(options.revision), ...workingTree }
    };
  }
  if (kind === "unverified-claim") {
    if (!nonEmpty(options.summary) || !nonEmpty(options.reason) || !nonEmpty(options.expectedVerification)) {
      throw new Error("Unverified evidence requires --summary, --reason, and --expected-verification");
    }
    return {
      ...base,
      kind,
      title: options.title ?? "Explicitly unverified claim",
      outcome: "unverified",
      scope_revision: null,
      observed_at: timestamp,
      summary: options.summary.trim(),
      adapter: { id: "manual-unverified-claim", version: "1" },
      artifacts: [],
      details: { reason: options.reason.trim(), expected_verification: options.expectedVerification.trim() }
    };
  }
  if (kind === "risk") {
    const severity = String(options.severity ?? "").trim();
    const status = String(options.riskStatus ?? "open").trim();
    if (!nonEmpty(options.summary) || !RISK_SEVERITIES.includes(severity) || !RISK_STATUSES.includes(status) || !nonEmpty(options.mitigation)) {
      throw new Error("Risk evidence requires --summary, --severity, --risk-status, and --mitigation");
    }
    return {
      ...base,
      kind,
      title: options.title ?? `${severity} risk`,
      outcome: status,
      scope_revision: options.revision ? resolveGitRevision(target, options.revision) : null,
      observed_at: timestamp,
      summary: options.summary.trim(),
      adapter: { id: "manual-risk-record", version: "1" },
      artifacts: [],
      details: { severity, status, mitigation: options.mitigation.trim() }
    };
  }
  if (kind === "rollback") {
    const status = String(options.rollbackStatus ?? "planned").trim();
    if (!nonEmpty(options.summary) || !ROLLBACK_STATUSES.includes(status) || !isSafeRepositoryPath(options.procedure)) {
      throw new Error("Rollback evidence requires --summary, --procedure, and a valid --rollback-status");
    }
    if (status === "verified" && !options.revision) throw new Error("A verified rollback requires --revision");
    return {
      ...base,
      kind,
      title: options.title ?? `Rollback ${status}`,
      outcome: status,
      scope_revision: options.revision ? resolveGitRevision(target, options.revision) : null,
      observed_at: timestamp,
      summary: options.summary.trim(),
      adapter: { id: "rollback-record", version: "1", source_ref: options.procedure },
      artifacts: [await repositoryArtifact(target, options.procedure)],
      details: { status, procedure: options.procedure }
    };
  }
  throw new Error(`Unsupported evidence kind: ${kind}`);
}

export async function preserveEvidenceRevision(target, options) {
  const workItem = await readWorkItem(target, options.workItemId);
  const revision = resolveGitRevision(target, options.revision);
  const actor = String(options.actor ?? "human").trim() || "human";
  const agents = await readJson(path.join(target, ".ai-org/project/agents.json"));
  if (actor !== "human" && !(agents.agents ?? []).some((agent) => agent.id === actor && agent.active !== false)) {
    throw new Error(`Unknown evidence actor: ${actor}`);
  }
  const registry = await readEvidenceRegistry(target);
  const evidenceIds = registry.entries
    .filter((entry) => entry.work_item_id === workItem.id && entry.scope_revision === revision)
    .map((entry) => entry.id);
  if (evidenceIds.length === 0) {
    throw new Error(`${workItem.id} has no recorded evidence bound to ${revision}`);
  }

  const tag = evidencePreservationTag(revision);
  const existing = preservedEvidenceRevision(target, revision);
  if (existing.target_revision && !existing.durable) {
    throw new Error(`Evidence tag ${tag} targets ${existing.target_revision}, not ${revision}`);
  }
  if (existing.durable) {
    return { work_item_id: workItem.id, revision, tag, created: false, evidence_ids: evidenceIds, external_action_performed: false };
  }

  gitOutput(target, ["tag", tag, revision]);
  const timestamp = new Date().toISOString();
  await appendEvent(target, {
    timestamp,
    event_type: "evidence_revision_preserved",
    actor,
    work_item_id: workItem.id,
    revision,
    tag: `refs/tags/${tag}`,
    evidence_ids: evidenceIds,
    external_action_performed: false,
    refs: [EVIDENCE_REGISTRY_RELATIVE_PATH, `refs/tags/${tag}`]
  });
  return { work_item_id: workItem.id, revision, tag, created: true, evidence_ids: evidenceIds, external_action_performed: false };
}

export async function recordEvidence(target, kind, options) {
  const entry = await buildEvidence(target, kind, options);
  return appendNormalizedEvidence(target, entry);
}

export async function invalidateEvidence(target, options) {
  const evidenceIdValue = String(options.evidenceId ?? "").trim();
  const reason = String(options.reason ?? "").trim();
  const replacementEvidenceId = String(options.replacementEvidenceId ?? "").trim() || null;
  if (!EVIDENCE_ID.test(evidenceIdValue)) throw new Error("--evidence-id must be a valid Evidence ID");
  if (!reason) throw new Error("Evidence invalidation requires --reason");

  const registryPath = path.join(target, EVIDENCE_REGISTRY_RELATIVE_PATH);
  const registry = await readEvidenceRegistry(target);
  const validation = validateEvidenceRegistry(registry);
  if (!validation.valid) throw new Error(`Invalid evidence registry: ${validation.errors.join("; ")}`);
  const index = registry.entries.findIndex((entry) => entry.id === evidenceIdValue);
  if (index < 0) throw new Error(`Unknown Evidence ID: ${evidenceIdValue}`);
  const current = registry.entries[index];
  if (current.invalidated_at) throw new Error(`${evidenceIdValue} is already invalidated`);

  const actor = String(options.actor ?? "human").trim() || "human";
  const agents = await readJson(path.join(target, ".ai-org/project/agents.json"));
  if (actor !== "human" && !(agents.agents ?? []).some((agent) => agent.id === actor && agent.active !== false)) {
    throw new Error(`Unknown evidence actor: ${actor}`);
  }

  let replacement = null;
  if (replacementEvidenceId) {
    if (replacementEvidenceId === evidenceIdValue) throw new Error("Replacement evidence must differ from the invalidated record");
    replacement = registry.entries.find((entry) => entry.id === replacementEvidenceId) ?? null;
    if (!replacement) throw new Error(`Unknown replacement Evidence ID: ${replacementEvidenceId}`);
    if (replacement.work_item_id !== current.work_item_id) throw new Error("Replacement evidence must belong to the same Work Item");
    if (replacement.invalidated_at || (replacement.expires_at && Date.parse(replacement.expires_at) <= Date.now())) {
      throw new Error("Replacement evidence must be current");
    }
  }

  const timestamp = new Date().toISOString();
  const invalidated = {
    ...current,
    invalidated_at: timestamp,
    invalidated_by: actor,
    invalidation_reason: reason,
    details: {
      ...current.details,
      invalidation: {
        replacement_evidence_id: replacementEvidenceId
      }
    }
  };
  const entries = [...registry.entries];
  entries[index] = invalidated;
  const updated = { ...registry, entries };
  const updatedValidation = validateEvidenceRegistry(updated);
  if (!updatedValidation.valid) throw new Error(`Invalid evidence invalidation: ${updatedValidation.errors.join("; ")}`);

  const before = await fs.readFile(registryPath);
  await atomicWrite(registryPath, formatJson(updated));
  try {
    await appendEvent(target, {
      timestamp,
      event_type: "evidence_invalidated",
      actor,
      work_item_id: current.work_item_id,
      evidence_id: current.id,
      replacement_evidence_id: replacementEvidenceId,
      reason,
      external_action_performed: false,
      refs: [EVIDENCE_REGISTRY_RELATIVE_PATH, ...current.artifacts.map((artifact) => artifact.path)]
    });
  } catch (error) {
    await atomicWrite(registryPath, before);
    throw error;
  }
  return invalidated;
}

export async function appendNormalizedEvidence(target, entry) {
  const registryPath = path.join(target, EVIDENCE_REGISTRY_RELATIVE_PATH);
  const registry = await readEvidenceRegistry(target);
  const validation = validateEvidenceRegistry(registry);
  if (!validation.valid) throw new Error(`Invalid evidence registry: ${validation.errors.join("; ")}`);
  const updated = { ...registry, entries: [...registry.entries, entry] };
  const updatedValidation = validateEvidenceRegistry(updated);
  if (!updatedValidation.valid) throw new Error(`Invalid evidence entry: ${updatedValidation.errors.join("; ")}`);
  const before = await fs.readFile(registryPath);
  await atomicWrite(registryPath, formatJson(updated));
  try {
    await appendEvent(target, {
      timestamp: entry.recorded_at,
      event_type: "evidence_recorded",
      actor: entry.recorded_by,
      work_item_id: entry.work_item_id,
      evidence_id: entry.id,
      evidence_kind: entry.kind,
      outcome: entry.outcome,
      refs: [EVIDENCE_REGISTRY_RELATIVE_PATH, ...entry.artifacts.map((artifact) => artifact.path)]
    });
  } catch (error) {
    await atomicWrite(registryPath, before);
    throw error;
  }
  return entry;
}
