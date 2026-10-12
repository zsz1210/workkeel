import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  atomicCreate,
  atomicWrite,
  formatJson,
  pathExists,
  readJson,
  rollbackFileChanges,
  sha256
} from "./files.mjs";
import { EVIDENCE_REGISTRY_RELATIVE_PATH, readEvidenceRegistry } from "./evidence.mjs";
import { normalizePublicationLocalText } from "./publication-normalization.mjs";

const execFileAsync = promisify(execFile);

export const PUBLICATION_ARTIFACT_PLAN_SCHEMA = "temple.publication-artifact-normalization-plan/v1";
export const PUBLICATION_ARTIFACT_RESULT_SCHEMA = "temple.publication-artifact-normalization-result/v1";

const ARTIFACT_ROOT = ".ai-org/artifacts";
const WORK_ITEMS_DIRECTORY = ".ai-org/work-items";
const EVENTS_PATH = ".ai-org/events/events.jsonl";
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

function safeArtifactPath(value) {
  const normalized = String(value).split(path.sep).join("/");
  if (!normalized.startsWith(`${ARTIFACT_ROOT}/`) || normalized.includes("\\") || path.posix.normalize(normalized) !== normalized) {
    throw new Error("Artifact normalization encountered an unsafe tracked path");
  }
  return normalized;
}

function safeEvidenceOutputPath(value, workItemId = null) {
  const normalized = String(value ?? "").split(path.sep).join("/");
  const requiredRoot = workItemId ? `${ARTIFACT_ROOT}/${workItemId}/` : `${ARTIFACT_ROOT}/`;
  if (!normalized.startsWith(requiredRoot) || normalized.includes("\\") || path.posix.normalize(normalized) !== normalized) {
    throw new Error(`Artifact normalization output must be below ${requiredRoot}`);
  }
  return normalized;
}

async function git(target, args, options = {}) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: target,
      encoding: options.encoding ?? "buffer",
      maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024
    });
    return stdout;
  } catch {
    throw new Error("Artifact normalization requires a readable Git repository");
  }
}

async function repositoryRevision(target) {
  return String(await git(target, ["rev-parse", "HEAD"], { encoding: "utf8", maxBuffer: 1024 * 1024 })).trim();
}

async function trackedArtifactPaths(target) {
  const output = await git(target, ["ls-files", "-z", "--", ARTIFACT_ROOT]);
  return Buffer.from(output).toString("utf8").split("\0").filter(Boolean).map(safeArtifactPath).sort();
}

function mergeCounts(target, source) {
  for (const [ruleId, count] of Object.entries(source)) target[ruleId] = (target[ruleId] ?? 0) + count;
}

async function artifactCandidate(target, relativePath) {
  const absolutePath = path.join(target, ...relativePath.split("/"));
  const stat = await fs.lstat(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Artifact normalization requires a regular tracked file: ${relativePath}`);
  if (stat.size > MAX_TEXT_BYTES) return { relativePath, kind: "oversize", changed: false };
  const buffer = await fs.readFile(absolutePath);
  if (buffer.includes(0)) return { relativePath, kind: "binary", changed: false };
  const before = buffer.toString("utf8");
  const normalized = normalizePublicationLocalText(before);
  if (normalized.text === before) return { relativePath, kind: "text", changed: false, counts: {} };
  return {
    relativePath,
    kind: "text",
    changed: true,
    before,
    after: normalized.text,
    beforeHash: sha256(before),
    afterHash: sha256(normalized.text),
    counts: normalized.counts
  };
}

async function buildCandidates(target) {
  const candidates = [];
  for (const relativePath of await trackedArtifactPaths(target)) {
    candidates.push(await artifactCandidate(target, relativePath));
  }
  return candidates;
}

async function historicalArtifactMatches(target, entry, artifact) {
  if (!entry.scope_revision) return false;
  try {
    const content = await git(target, ["show", `${entry.scope_revision}:${artifact.path}`]);
    return sha256(content) === artifact.sha256;
  } catch {
    return false;
  }
}

async function activeEvidenceImpacts(target, changed) {
  if (!(await pathExists(path.join(target, EVIDENCE_REGISTRY_RELATIVE_PATH)))) return [];
  const registry = await readEvidenceRegistry(target);
  const changedPaths = new Set(changed.map((entry) => entry.relativePath));
  const impacts = [];
  for (const entry of registry.entries ?? []) {
    if (entry.invalidated_at) continue;
    for (const artifact of entry.artifacts ?? []) {
      if (!changedPaths.has(artifact.path)) continue;
      if (await historicalArtifactMatches(target, entry, artifact)) continue;
      impacts.push({ evidence_id: entry.id, work_item_id: entry.work_item_id, path: artifact.path });
    }
  }
  return impacts.sort((left, right) =>
    left.evidence_id.localeCompare(right.evidence_id) || left.path.localeCompare(right.path)
  );
}

function planDigest(plan) {
  return sha256(formatJson(plan));
}

export async function buildPublicationArtifactNormalizationPlan(target) {
  const revision = await repositoryRevision(target);
  const candidates = await buildCandidates(target);
  const changed = candidates.filter((entry) => entry.changed);
  const evidenceImpacts = await activeEvidenceImpacts(target, changed);
  const changes = {};
  for (const entry of changed) mergeCounts(changes, entry.counts);
  const changeCount = Object.values(changes).reduce((total, count) => total + count, 0);
  const plan = {
    schema_version: PUBLICATION_ARTIFACT_PLAN_SCHEMA,
    status: changeCount > 0 ? "changes-pending" : "no-changes",
    source_revision: revision,
    matched_values_retained: false,
    files: changed.map((entry) => ({
      path: entry.relativePath,
      before_sha256: entry.beforeHash,
      after_sha256: entry.afterHash,
      change_count: Object.values(entry.counts).reduce((total, count) => total + count, 0),
      changes: entry.counts
    })),
    active_evidence_impacts: evidenceImpacts,
    summary: {
      tracked_artifact_files: candidates.length,
      text_files: candidates.filter((entry) => entry.kind === "text").length,
      binary_files_skipped: candidates.filter((entry) => entry.kind === "binary").length,
      oversize_files_skipped: candidates.filter((entry) => entry.kind === "oversize").length,
      changed_files: changed.length,
      change_count: changeCount,
      active_evidence_records_affected: new Set(evidenceImpacts.map((entry) => entry.evidence_id)).size,
      active_evidence_artifacts_affected: evidenceImpacts.length,
      changes: Object.fromEntries(Object.entries(changes).sort(([left], [right]) => left.localeCompare(right)))
    },
    authority: {
      git_history_changed: false,
      canonical_state_changed: false,
      publication_authorized: false
    }
  };
  plan.plan_digest = planDigest(plan);
  return plan;
}

export async function writePublicationArtifactNormalizationPlan(target, outputPath) {
  const relativePath = safeEvidenceOutputPath(outputPath);
  const plan = await buildPublicationArtifactNormalizationPlan(target);
  await atomicCreate(path.join(target, ...relativePath.split("/")), formatJson(plan));
  return { ...plan, output: relativePath };
}

async function assertGoverningWorkItem(target, options) {
  if (!options.workItemId) throw new Error("Artifact normalization apply requires --work-item");
  const workItemPath = path.join(target, WORK_ITEMS_DIRECTORY, `${options.workItemId}.json`);
  if (!(await pathExists(workItemPath))) throw new Error(`Work item not found: ${options.workItemId}`);
  const workItem = await readJson(workItemPath);
  if (workItem.claim?.status !== "active") throw new Error(`Artifact normalization requires an active claim on ${options.workItemId}`);
  const actor = options.actor ?? workItem.claim.agent_id;
  if (!["human", workItem.claim.agent_id, workItem.claim.principal_id].includes(actor)) {
    throw new Error(`Actor ${actor} is not authorized by the active claim on ${options.workItemId}`);
  }
  return actor;
}

async function validateWrittenCandidate(target, entry) {
  if (entry.relativePath.endsWith(".json")) JSON.parse(entry.after);
  if (entry.relativePath.endsWith(".mjs") || entry.relativePath.endsWith(".js") || entry.relativePath.endsWith(".cjs")) {
    try {
      await execFileAsync(process.execPath, ["--check", path.join(target, ...entry.relativePath.split("/"))], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    } catch {
      throw new Error(`Artifact normalization produced invalid JavaScript: ${entry.relativePath}`);
    }
  }
}

export async function applyPublicationArtifactNormalization(target, options = {}) {
  if (!options.expectedPlan) throw new Error("Artifact normalization apply requires the digest returned by artifact-plan");
  if (options.confirmNormalization !== true) throw new Error("Artifact normalization apply requires explicit normalization confirmation");
  const actor = await assertGoverningWorkItem(target, options);
  const plan = await buildPublicationArtifactNormalizationPlan(target);
  if (plan.plan_digest !== options.expectedPlan) throw new Error("Artifact normalization plan is stale; create and review a new plan");
  if (plan.summary.active_evidence_records_affected > 0) {
    const evidenceIds = [...new Set(plan.active_evidence_impacts.map((entry) => entry.evidence_id))];
    throw new Error(
      `Artifact normalization would change ${evidenceIds.length} active evidence record(s); invalidate or replace them first: ${evidenceIds.join(", ")}`
    );
  }
  if (plan.summary.change_count === 0) {
    return {
      schema_version: PUBLICATION_ARTIFACT_RESULT_SCHEMA,
      applied: false,
      plan_digest: plan.plan_digest,
      source_revision: plan.source_revision,
      work_item_id: options.workItemId,
      changed_files: 0,
      change_count: 0,
      event_recorded: false,
      git_history_changed: false,
      publication_authorized: false
    };
  }

  const candidates = (await buildCandidates(target)).filter((entry) => entry.changed);
  const plannedByPath = new Map(plan.files.map((entry) => [entry.path, entry]));
  if (candidates.length !== plan.files.length) throw new Error("Artifact normalization inputs changed after plan verification");
  for (const entry of candidates) {
    const planned = plannedByPath.get(entry.relativePath);
    if (!planned || planned.before_sha256 !== entry.beforeHash || planned.after_sha256 !== entry.afterHash) {
      throw new Error("Artifact normalization inputs changed after plan verification");
    }
  }

  const written = [];
  let result;
  try {
    for (const entry of candidates) {
      const absolutePath = path.join(target, ...entry.relativePath.split("/"));
      await atomicWrite(absolutePath, entry.after);
      written.push({ path: absolutePath, before: entry.before, afterHash: entry.afterHash });
      if (options.simulateFailureAfterWrites === written.length) throw new Error("Simulated artifact normalization failure");
      await validateWrittenCandidate(target, entry);
    }
    const eventsPath = path.join(target, EVENTS_PATH);
    const eventBefore = (await pathExists(eventsPath)) ? await fs.readFile(eventsPath, "utf8") : null;
    const event = {
      timestamp: new Date().toISOString(),
      event_type: "publication_retained_artifacts_normalized",
      actor,
      work_item_id: options.workItemId,
      source_revision: plan.source_revision,
      plan_digest: plan.plan_digest,
      changed_files: plan.summary.changed_files,
      change_count: plan.summary.change_count,
      matched_values_retained: false,
      refs: plan.files.map((entry) => entry.path)
    };
    const existingEvents = eventBefore ?? "";
    const normalizedEvents = existingEvents.length === 0 || existingEvents.endsWith("\n") ? existingEvents : `${existingEvents}\n`;
    const eventAfter = `${normalizedEvents}${JSON.stringify(event)}\n`;
    await atomicWrite(eventsPath, eventAfter);
    written.push({ path: eventsPath, before: eventBefore, afterHash: sha256(eventAfter) });
    result = {
      schema_version: PUBLICATION_ARTIFACT_RESULT_SCHEMA,
      applied: true,
      plan_digest: plan.plan_digest,
      source_revision: plan.source_revision,
      work_item_id: options.workItemId,
      changed_files: plan.summary.changed_files,
      change_count: plan.summary.change_count,
      changes: plan.summary.changes,
      event_recorded: true,
      git_history_changed: false,
      publication_authorized: false
    };
    if (options.output) {
      const outputPath = safeEvidenceOutputPath(options.output, options.workItemId);
      const absoluteOutput = path.join(target, ...outputPath.split("/"));
      await atomicCreate(absoluteOutput, formatJson(result));
      written.push({ path: absoluteOutput, before: null, afterHash: sha256(formatJson(result)) });
      result.output = outputPath;
    }
  } catch (error) {
    try {
      await rollbackFileChanges(written);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Artifact normalization failed and automatic rollback was incomplete");
    }
    throw error;
  }

  return result;
}
