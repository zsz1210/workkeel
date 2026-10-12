import fs from "node:fs/promises";
import path from "node:path";
import {
  atomicWrite,
  formatJson,
  pathExists,
  readJson,
  rollbackFileChanges,
  sha256
} from "./files.mjs";
import { validateProjectSchemas } from "./schema-validation.mjs";

export const PUBLICATION_NORMALIZATION_PLAN_SCHEMA = "temple.publication-normalization-plan/v1";
export const PUBLICATION_NORMALIZATION_RESULT_SCHEMA = "temple.publication-normalization-result/v1";

const WORK_ITEMS_DIRECTORY = ".ai-org/work-items";
const RUNTIME_WORKERS_PATH = ".ai-org/project/runtime-workers.json";
const TASKS_PATH = ".ai-org/project/tasks.json";
const EVIDENCE_PATH = ".ai-org/project/evidence.json";
const EVENTS_PATH = ".ai-org/events/events.jsonl";
const TERMINAL_WORKER_STATUSES = new Set(["completed", "failed", "cancelled"]);
const TERMINAL_TASK_STATUSES = new Set(["completed", "archived"]);

const DETAIL_RULES = [
  {
    id: "maintainer-home-path-posix",
    pattern: /\/(?:Users|home)\/[A-Za-z0-9._-]+/g,
    replacement: "<LOCAL_HOME>"
  },
  {
    id: "maintainer-home-path-windows",
    pattern: /\b[A-Za-z]:\\Users\\[A-Za-z0-9._-]+/g,
    replacement: "<LOCAL_HOME>"
  },
  {
    id: "private-ipv4",
    pattern: /\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/g,
    replacement: "<PRIVATE_IPV4>",
    skip: (source, index, matched) => /^\/\d{1,2}/.test(source.slice(index + matched.length))
  },
  {
    id: "private-tailnet-hostname",
    pattern: /\b[a-z0-9][a-z0-9-]*\.tail[a-z0-9-]*\.ts\.net\b/gi,
    replacement: "<PRIVATE_TAILNET_HOST>"
  }
];

function addCount(counts, key, amount = 1) {
  counts[key] = (counts[key] ?? 0) + amount;
}

function replaceDetailString(value, counts) {
  let output = value;
  for (const rule of DETAIL_RULES) {
    const source = output;
    output = source.replace(rule.pattern, (matched, offset) => {
      if (rule.skip?.(source, offset, matched)) return matched;
      addCount(counts, rule.id);
      return rule.replacement;
    });
  }
  return output;
}

export function normalizePublicationLocalText(value) {
  const counts = {};
  const text = replaceDetailString(value, counts);
  return {
    text,
    counts: Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)))
  };
}

function normalizeDetails(value, counts) {
  if (typeof value === "string") return replaceDetailString(value, counts);
  if (Array.isArray(value)) return value.map((entry) => normalizeDetails(entry, counts));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeDetails(entry, counts)]));
  }
  return value;
}

function normalizeReleasedClaim(claim, counts) {
  if (!claim || typeof claim !== "object" || claim.status !== "released" || claim.worktree === null || claim.worktree === undefined) {
    return claim;
  }
  addCount(counts, "released-claim-worktree");
  return { ...claim, worktree: null };
}

function activeCoordinateCount(value, status, terminalStatuses) {
  return value !== null && value !== undefined && !terminalStatuses.has(status) ? 1 : 0;
}

function normalizeWorkItem(document) {
  const counts = {};
  let retainedActiveCoordinates = 0;
  const claim = document.claim;
  if (claim?.worktree !== null && claim?.worktree !== undefined && claim?.status !== "released") {
    retainedActiveCoordinates += 1;
  }
  for (const entry of document.claims ?? []) {
    if (entry?.worktree !== null && entry?.worktree !== undefined && entry?.status !== "released") {
      retainedActiveCoordinates += 1;
    }
  }
  return {
    document: {
      ...document,
      scope: normalizeDetails(document.scope, counts),
      acceptance_criteria: normalizeDetails(document.acceptance_criteria, counts),
      unresolved: normalizeDetails(document.unresolved, counts),
      claim: normalizeReleasedClaim(claim, counts),
      claims: Array.isArray(document.claims)
        ? document.claims.map((entry) => normalizeReleasedClaim(entry, counts))
        : document.claims
    },
    counts,
    retainedActiveCoordinates
  };
}

function normalizeRuntimeWorkers(document) {
  const counts = {};
  let retainedActiveCoordinates = 0;
  const workers = (document.workers ?? []).map((worker) => {
    retainedActiveCoordinates += activeCoordinateCount(worker.worktree, worker.status, TERMINAL_WORKER_STATUSES);
    if (!TERMINAL_WORKER_STATUSES.has(worker.status) || worker.worktree === null || worker.worktree === undefined) return worker;
    addCount(counts, "terminal-worker-worktree");
    return { ...worker, worktree: null };
  });
  return { document: { ...document, workers }, counts, retainedActiveCoordinates };
}

function normalizeTasks(document) {
  const counts = {};
  let retainedActiveCoordinates = 0;
  const tasks = (document.tasks ?? []).map((task) => {
    retainedActiveCoordinates += activeCoordinateCount(task.worktree, task.status, TERMINAL_TASK_STATUSES);
    if (!TERMINAL_TASK_STATUSES.has(task.status) || task.worktree === null || task.worktree === undefined) return task;
    addCount(counts, "terminal-task-worktree");
    return { ...task, worktree: null };
  });
  return { document: { ...document, tasks }, counts, retainedActiveCoordinates };
}

function normalizeEvidence(document) {
  const counts = {};
  const entries = (document.entries ?? []).map((entry) => (
    Object.hasOwn(entry, "details") ? { ...entry, details: normalizeDetails(entry.details, counts) } : entry
  ));
  return { document: { ...document, entries }, counts, retainedActiveCoordinates: 0 };
}

async function workItemPaths(target) {
  const directory = path.join(target, WORK_ITEMS_DIRECTORY);
  if (!(await pathExists(directory))) return [];
  return (await fs.readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => `${WORK_ITEMS_DIRECTORY}/${entry.name}`)
    .sort();
}

function planDigest(plan) {
  return sha256(formatJson(plan));
}

function mergeCounts(target, source) {
  for (const [key, count] of Object.entries(source)) addCount(target, key, count);
}

async function candidate(target, relativePath, normalizer) {
  if (!(await pathExists(path.join(target, relativePath)))) return null;
  const beforeDocument = await readJson(path.join(target, relativePath));
  const normalized = normalizer(beforeDocument);
  const before = formatJson(beforeDocument);
  const after = formatJson(normalized.document);
  if (before === after) {
    return {
      relativePath,
      changed: false,
      retainedActiveCoordinates: normalized.retainedActiveCoordinates,
      counts: normalized.counts
    };
  }
  return {
    relativePath,
    changed: true,
    before,
    after,
    beforeHash: sha256(before),
    afterHash: sha256(after),
    retainedActiveCoordinates: normalized.retainedActiveCoordinates,
    counts: normalized.counts
  };
}

async function buildCandidates(target) {
  const candidates = [];
  for (const relativePath of await workItemPaths(target)) {
    candidates.push(await candidate(target, relativePath, normalizeWorkItem));
  }
  candidates.push(await candidate(target, RUNTIME_WORKERS_PATH, normalizeRuntimeWorkers));
  candidates.push(await candidate(target, TASKS_PATH, normalizeTasks));
  candidates.push(await candidate(target, EVIDENCE_PATH, normalizeEvidence));
  return candidates.filter(Boolean);
}

export async function buildPublicationNormalizationPlan(target) {
  const candidates = await buildCandidates(target);
  const changes = {};
  let retainedActiveCoordinates = 0;
  for (const entry of candidates) {
    mergeCounts(changes, entry.counts);
    retainedActiveCoordinates += entry.retainedActiveCoordinates;
  }
  const changed = candidates.filter((entry) => entry.changed);
  const changeCount = Object.values(changes).reduce((total, count) => total + count, 0);
  const plan = {
    schema_version: PUBLICATION_NORMALIZATION_PLAN_SCHEMA,
    status: retainedActiveCoordinates > 0 ? "blocked-active-coordinates" : (changeCount > 0 ? "changes-pending" : "no-changes"),
    matched_values_retained: false,
    files: changed.map((entry) => ({
      path: entry.relativePath,
      before_sha256: entry.beforeHash,
      after_sha256: entry.afterHash,
      change_count: Object.values(entry.counts).reduce((total, count) => total + count, 0),
      changes: Object.fromEntries(Object.entries(entry.counts).sort(([left], [right]) => left.localeCompare(right)))
    })),
    summary: {
      changed_files: changed.length,
      change_count: changeCount,
      retained_active_coordinates: retainedActiveCoordinates,
      changes: Object.fromEntries(Object.entries(changes).sort(([left], [right]) => left.localeCompare(right)))
    },
    authority: {
      canonical_state_changed: false,
      publication_authorized: false
    }
  };
  plan.plan_digest = planDigest(plan);
  return plan;
}

async function assertGoverningWorkItem(target, options) {
  if (!options.workItemId) throw new Error("Publication normalization apply requires --work-item");
  const workItemPath = path.join(target, WORK_ITEMS_DIRECTORY, `${options.workItemId}.json`);
  if (!(await pathExists(workItemPath))) throw new Error(`Work item not found: ${options.workItemId}`);
  const workItem = await readJson(workItemPath);
  if (workItem.claim?.status !== "active") {
    throw new Error(`Publication normalization requires an active claim on ${options.workItemId}`);
  }
  const actor = options.actor ?? workItem.claim.agent_id;
  if (!["human", workItem.claim.agent_id, workItem.claim.principal_id].includes(actor)) {
    throw new Error(`Actor ${actor} is not authorized by the active claim on ${options.workItemId}`);
  }
  return { workItem, actor };
}

export async function applyPublicationNormalization(target, options = {}) {
  if (!options.expectedPlan) throw new Error("Publication normalization apply requires the digest returned by normalize-plan");
  if (options.confirmNormalization !== true) throw new Error("Publication normalization apply requires explicit normalization confirmation");
  const { actor } = await assertGoverningWorkItem(target, options);
  const plan = await buildPublicationNormalizationPlan(target);
  if (plan.plan_digest !== options.expectedPlan) {
    throw new Error("Publication normalization plan is stale; create and review a new plan");
  }
  if (plan.summary.retained_active_coordinates > 0) {
    throw new Error("Publication normalization found active execution coordinates; finish or release them before applying the plan");
  }
  if (plan.summary.change_count === 0) {
    return {
      schema_version: PUBLICATION_NORMALIZATION_RESULT_SCHEMA,
      applied: false,
      plan_digest: plan.plan_digest,
      work_item_id: options.workItemId,
      changed_files: 0,
      change_count: 0,
      event_recorded: false,
      publication_authorized: false
    };
  }

  const candidates = (await buildCandidates(target)).filter((entry) => entry.changed);
  const plannedByPath = new Map(plan.files.map((entry) => [entry.path, entry]));
  if (candidates.length !== plan.files.length) {
    throw new Error("Publication normalization inputs changed after plan verification");
  }
  for (const entry of candidates) {
    const planned = plannedByPath.get(entry.relativePath);
    if (!planned || planned.before_sha256 !== entry.beforeHash || planned.after_sha256 !== entry.afterHash) {
      throw new Error("Publication normalization inputs changed after plan verification");
    }
  }

  const written = [];
  try {
    for (const entry of candidates) {
      const absolutePath = path.join(target, entry.relativePath);
      await atomicWrite(absolutePath, entry.after);
      written.push({ path: absolutePath, before: entry.before, afterHash: entry.afterHash });
      if (options.simulateFailureAfterWrites === written.length) {
        throw new Error("Simulated publication normalization failure");
      }
    }
    const validation = await validateProjectSchemas(target);
    if (!validation.valid) throw new Error(`Publication normalization produced invalid canonical state (${validation.errors.length} schema errors)`);

    const eventsPath = path.join(target, EVENTS_PATH);
    const eventBefore = (await pathExists(eventsPath)) ? await fs.readFile(eventsPath, "utf8") : null;
    const event = {
      timestamp: new Date().toISOString(),
      event_type: "publication_canonical_state_normalized",
      actor,
      work_item_id: options.workItemId,
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
  } catch (error) {
    try {
      await rollbackFileChanges(written);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Publication normalization failed and automatic rollback was incomplete");
    }
    throw error;
  }

  return {
    schema_version: PUBLICATION_NORMALIZATION_RESULT_SCHEMA,
    applied: true,
    plan_digest: plan.plan_digest,
    work_item_id: options.workItemId,
    changed_files: plan.summary.changed_files,
    change_count: plan.summary.change_count,
    changes: plan.summary.changes,
    event_recorded: true,
    publication_authorized: false
  };
}
