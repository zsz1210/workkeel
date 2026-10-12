import fs from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import reviewSchema from "../project-overlay/.ai-org/core/schemas/learning-review.schema.json" with { type: "json" };
import { atomicCreate, formatJson, sha256 } from "./files.mjs";
import { isWorkItemId } from "./ids.mjs";
import { validateLearningIndex } from "./learning.mjs";
import { validateEvidenceRegistry } from "./evidence.mjs";
import { LIFECYCLE_OUTCOMES } from "./workflow.mjs";

export const REVIEW_ROOT = ".ai-org/learning/reviews";
export const REVIEW_SCHEMA = "temple.learning-review/v1";
const TERMINAL = new Set(["done", "concluded", "cancelled"]);
const SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const HASH = /^[a-f0-9]{64}$/;
const LESSON = /^LESSON-[0-9]{4,}$/;
const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const schemaCheck = ajv.compile(reviewSchema);
const strings = value => Array.isArray(value) && value.every(v => typeof v === "string" && v.trim().length > 0) && new Set(value).size === value.length;
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value);
const canonical = value => JSON.stringify(sortObject(value));
export const learningReviewDigest = record => sha256(canonical(record));
function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!plain(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortObject(value[key])]));
}

function safeRelative(ref) {
  return typeof ref === "string" && ref.length > 0 && !ref.includes("\\") && !ref.includes("\0") && !path.posix.isAbsolute(ref) && !path.win32.isAbsolute(ref) && path.posix.normalize(ref) === ref && ref !== "." && ref !== ".." && !ref.startsWith("../");
}

// Check each existing component, including dangling symlinks. The repository root
// itself may have a platform alias (/tmp on macOS); descendants may not redirect.
async function safePath(root, ref) {
  if (!safeRelative(ref)) throw new Error(`Unsafe repository path: ${ref}`);
  let current = path.resolve(root);
  for (const part of ref.split("/")) {
    current = path.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`Symlink is not allowed: ${ref}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return current;
}

async function readFile(root, ref) {
  const absolute = await safePath(root, ref);
  if (!(await fs.stat(absolute)).isFile()) throw new Error(`Expected regular file: ${ref}`);
  return fs.readFile(absolute);
}
async function json(root, ref) { return JSON.parse((await readFile(root, ref)).toString("utf8")); }
async function fingerprint(root, ref) { return { path: ref, sha256: sha256(await readFile(root, ref)) }; }
async function directory(root, ref) {
  const absolute = await safePath(root, ref);
  try { return await fs.readdir(absolute, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

function revisionOf(item) {
  const revision = item.tested_revision ?? item.developer_candidate_revision;
  if (typeof revision !== "string" || !SHA.test(revision)) throw new Error("Outcome has no full tested/developer candidate revision");
  return revision;
}

async function reviewableSource(root, id) {
  const item = await json(root, `.ai-org/work-items/${id}.json`);
  if (!plain(item) || item.id !== id || item.schema_version !== "temple.work-item/v1") throw new Error("Invalid Work Item identity/schema");
  const workflow = await json(root, ".ai-org/core/workflow.json");
  if (!["temple.workflow/v1", "temple.workflow/v2"].includes(workflow?.schema_version) || !Array.isArray(workflow.states) || !workflow.states.every(s => plain(s) && typeof s.id === "string") || !strings(workflow.terminal_states)) throw new Error("Invalid workflow state registry");
  if (typeof item.state !== "string" || !workflow.states.some(s => s.id === item.state)) throw new Error("Invalid Work Item state");
  if (TERMINAL.has(item.state) && !workflow.terminal_states.includes(item.state)) throw new Error("Invalid terminal state contract");
  if (![item.scope, item.acceptance_criteria, item.evidence].every(strings)) throw new Error("Invalid Work Item scope, acceptance or evidence");
  if (Object.hasOwn(item, "unresolved") && !strings(item.unresolved)) throw new Error("Invalid Work Item unresolved items");
  if (Object.hasOwn(item, "gate_evidence") && (!plain(item.gate_evidence) || !Object.values(item.gate_evidence).every(strings))) throw new Error("Invalid Work Item gate evidence");
  if (Object.hasOwn(item, "lifecycle_outcome") && !LIFECYCLE_OUTCOMES.includes(item.lifecycle_outcome)) throw new Error("Invalid Work Item lifecycle outcome");
  for (const field of ["tested_revision", "developer_candidate_revision"]) {
    if (Object.hasOwn(item, field) && item[field] !== null && (typeof item[field] !== "string" || !SHA.test(item[field]))) throw new Error(`Invalid Work Item ${field}`);
  }
  return item;
}

async function outcome(root, item) {
  if (!TERMINAL.has(item.state)) throw new Error("Review requires a terminal Work Item");
  if (![item.scope, item.acceptance_criteria, item.unresolved ?? [], item.evidence ?? []].every(strings) || !plain(item.gate_evidence ?? {})) throw new Error("Invalid Work Item outcome fields");
  const gates = item.gate_evidence ?? {};
  if (!Object.values(gates).every(strings)) throw new Error("Invalid gate evidence references");
  const refs = [...new Set([...(item.evidence ?? []), ...Object.values(gates).flat()])].sort();
  const sources = [];
  for (const ref of refs) {
    if (SHA.test(ref) || /^https?:\/\//.test(ref)) {
      sources.push({ reference: ref, kind: "opaque" });
    } else if (/^EVID-[0-9]{8}T[0-9]{6}Z-[A-F0-9]{8}$/.test(ref)) {
      const registry = await json(root, ".ai-org/project/evidence.json");
      const matches = registry.entries?.filter(entry => entry.id === ref);
      if (matches?.length !== 1) throw new Error(`Missing or ambiguous Evidence ID: ${ref}`);
      if (!validateEvidenceRegistry({ schema_version: registry.schema_version, entries: matches }).valid) throw new Error(`Invalid Evidence record: ${ref}`);
      for (const artifact of matches[0].artifacts) {
        if (sha256(await readFile(root, artifact.path)) !== artifact.sha256) throw new Error(`Evidence artifact digest mismatch: ${artifact.path}`);
      }
      sources.push({ reference: ref, kind: "registry", sha256: sha256(canonical(matches[0])) });
    } else {
      const fileRef = ref.split("#")[0];
      sources.push({ reference: ref, kind: "file", ...await fingerprint(root, fileRef) });
    }
  }
  const snapshot = {
    work_item_id: item.id, state: item.state, lifecycle_outcome: item.lifecycle_outcome ?? null,
    revision: revisionOf(item), developer_candidate_revision: item.developer_candidate_revision ?? null,
    scope: item.scope, acceptance_criteria: item.acceptance_criteria, unresolved: item.unresolved ?? [],
    evidence: [...(item.evidence ?? [])].sort(), gate_evidence: Object.fromEntries(Object.entries(gates).map(([key, refs]) => [key, [...refs].sort()])), sources
  };
  return { snapshot, digest: sha256(canonical(snapshot)) };
}

function validFingerprint(value) {
  return plain(value) && safeRelative(value.path) && HASH.test(value.sha256 ?? "") && Object.keys(value).every(k => ["path", "sha256"].includes(k));
}
export function validateLearningReview(record) {
  if (!schemaCheck(record)) return { valid: false, errors: schemaCheck.errors.map(e => `${e.instancePath} ${e.message}`) };
  const keys = ["schema_version", "work_item_id", "outcome_digest", "outcome", "result", "actor", "reviewed_at", "review_note", "lessons", ...(record.schema_version === "temple.learning-review/v2" ? ["supersedes", "reason"] : [])];
  const errors = [];
  if (!plain(record) || Object.keys(record).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(record, key))) return { valid: false, errors: ["Invalid review record fields"] };
  if (![REVIEW_SCHEMA, "temple.learning-review/v2"].includes(record.schema_version) || !isWorkItemId(record.work_item_id) || !HASH.test(record.outcome_digest ?? "")) errors.push("Invalid review identity");
  if (record.schema_version === "temple.learning-review/v2" && (!HASH.test(record.supersedes ?? "") || typeof record.reason !== "string" || !record.reason.trim())) errors.push("Invalid supersession provenance");
  const o = record.outcome;
  if (!plain(o) || o.work_item_id !== record.work_item_id || !TERMINAL.has(o.state) || !SHA.test(o.revision ?? "") || ![o.scope, o.acceptance_criteria, o.unresolved, o.evidence].every(strings) || !plain(o.gate_evidence) || !Object.values(o.gate_evidence ?? {}).every(strings) || !Array.isArray(o.sources) || sha256(canonical(o)) !== record.outcome_digest) errors.push("Invalid outcome snapshot/digest");
  if (!["no-new-lesson", "linked-lessons"].includes(record.result) || typeof record.actor !== "string" || !record.actor.trim() || typeof record.reviewed_at !== "string" || Number.isNaN(Date.parse(record.reviewed_at))) errors.push("Invalid review judgment/provenance");
  if (!validFingerprint(record.review_note)) errors.push("Invalid review note");
  if (!Array.isArray(record.lessons) || record.lessons.some(l => !plain(l) || !LESSON.test(l.id ?? "") || !validFingerprint({ path: l.path, sha256: l.sha256 }) || !HASH.test(l.entry_digest ?? "") || l.path !== `.ai-org/learning/lessons/${l.id}.md` || Object.keys(l).some(k => !["id", "path", "sha256", "entry_digest"].includes(k))) || new Set(record.lessons?.map(l => l.id)).size !== record.lessons?.length) errors.push("Invalid Lesson links");
  if ((record.result === "no-new-lesson" && record.lessons?.length !== 0) || (record.result === "linked-lessons" && !record.lessons?.length)) errors.push("Lesson links disagree with judgment");
  return { valid: errors.length === 0, errors };
}

async function recordsFor(root, id) {
  const ref = `${REVIEW_ROOT}/${id}`;
  const entries = await directory(root, ref);
  const records = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !/^[a-f0-9]{64}(?:\.[a-f0-9]{64})?\.json$/.test(entry.name)) throw new Error(`Unexpected review entry: ${ref}/${entry.name}`);
    const record = await json(root, `${ref}/${entry.name}`);
    const validation = validateLearningReview(record);
    if (!validation.valid || record.work_item_id !== id || reviewFilename(record) !== entry.name) throw new Error(`Invalid review record: ${ref}/${entry.name}: ${validation.errors.join("; ")}`);
    records.push(record);
  }
  const ordered = [], children = new Map(), byDigest = new Map(records.map(r => [learningReviewDigest(r), r]));
  for (const record of records.filter(r => r.supersedes)) {
    const parent = byDigest.get(record.supersedes);
    if (!parent || parent.outcome_digest !== record.outcome_digest || children.has(record.supersedes)) throw new Error("Broken or forked review history");
    children.set(record.supersedes, record);
  }
  for (const rootRecord of records.filter(r => !r.supersedes)) {
    let record = rootRecord;
    while (record) {
      if (ordered.includes(record)) throw new Error("Cyclic review history");
      ordered.push(record);
      record = children.get(learningReviewDigest(record));
    }
  }
  if (ordered.length !== records.length) throw new Error("Unrooted review history");
  return ordered;
}

function reviewFilename(record) {
  return `${record.outcome_digest}${record.supersedes ? `.${learningReviewDigest(record)}` : ""}.json`;
}

async function lessonLinks(root, ids) {
  if (!strings(ids) || ids.some(id => !LESSON.test(id))) throw new Error("Expected unique Lesson IDs");
  if (!ids.length) return [];
  const index = await json(root, ".ai-org/learning/index.json");
  if (!validateLearningIndex(index).valid) throw new Error("Invalid Learning index");
  const output = [];
  for (const id of [...ids].sort()) {
    const entry = index.entries.find(e => e.id === id && e.kind === "lesson");
    if (!entry) throw new Error(`Missing Lesson: ${id}`);
    output.push({ id, ...await fingerprint(root, entry.path), entry_digest: sha256(canonical(entry)) });
  }
  return output;
}

export async function recordLearningReview(root, options) {
  const replacing = options.supersedes !== undefined;
  if (replacing && (typeof options.supersedes !== "string" || !HASH.test(options.supersedes) || typeof options.reason !== "string" || !options.reason.trim())) throw new Error("Supersession requires a full review digest and nonempty --reason");
  if (!replacing && options.reason !== undefined) throw new Error("--reason requires --supersedes");
  const id = options.workItemId;
  if (!isWorkItemId(id)) throw new Error("Valid --work-item is required");
  const item = await reviewableSource(root, id);
  const current = await outcome(root, item);
  if (options.revision !== current.snapshot.revision) throw new Error("Review revision must match the exact recorded outcome revision");
  const agents = await json(root, ".ai-org/project/agents.json");
  if (!agents.agents?.some(agent => agent.id === options.actor && agent.active === true)) throw new Error("Review requires an active --actor Agent Identity");
  const record = {
    schema_version: replacing ? "temple.learning-review/v2" : REVIEW_SCHEMA, work_item_id: id, outcome_digest: current.digest, outcome: current.snapshot,
    result: options.result, actor: options.actor, reviewed_at: new Date().toISOString(),
    review_note: await fingerprint(root, options.evidence), lessons: await lessonLinks(root, options.learningIds ?? []),
    ...(replacing ? { supersedes: options.supersedes, reason: options.reason.trim() } : {})
  };
  const validation = validateLearningReview(record);
  if (!validation.valid) throw new Error(validation.errors.join("; "));
  const records = (await recordsFor(root, id)).filter(r => r.outcome_digest === current.digest);
  const previous = records.at(-1);
  const ref = `${REVIEW_ROOT}/${id}/${reviewFilename(record)}`;
  const content = r => canonical({ result: r.result, actor: r.actor, review_note: r.review_note, lessons: r.lessons, ...(replacing ? { supersedes: r.supersedes, reason: r.reason } : {}) });
  if (replacing) {
    if (previous?.supersedes === options.supersedes && content(previous) === content(record)) return { record: previous, path: `${REVIEW_ROOT}/${id}/${reviewFilename(previous)}`, idempotent: true };
    if (!previous || learningReviewDigest(previous) !== options.supersedes) throw new Error("Stale supersession: expected current review digest for this outcome");
    if (previous.review_note.path === record.review_note.path) throw new Error("Supersession requires a new review note path; preserve the prior note");
    await atomicCreate(await safePath(root, ref), formatJson(record));
    return { record, path: ref, idempotent: false };
  }
  if (previous) {
    if (content(previous) !== content(record)) throw new Error("Review conflict: an immutable judgment already exists for this outcome");
    return { record: previous, path: `${REVIEW_ROOT}/${id}/${reviewFilename(previous)}`, idempotent: true };
  }
  await atomicCreate(await safePath(root, ref), formatJson(record));
  return { record, path: ref, idempotent: false };
}

async function statusFor(root, id) {
  const base = { work_item_id: id, status: "unknown", outcome_digest: null, lesson_ids: [], record_count: 0 };
  try {
    const item = await reviewableSource(root, id);
    const records = await recordsFor(root, id);
    base.record_count = records.length;
    if (!TERMINAL.has(item.state)) return { ...base, status: "not-eligible", reason: "Work Item is not terminal" };
    revisionOf(item);
    if (!records.length) return { ...base, status: "not-reviewed", reason: "No review recorded; evidence has not been inspected" };
    const current = await outcome(root, item);
    base.outcome_digest = current.digest;
    const record = records.filter(r => r.outcome_digest === current.digest).at(-1);
    if (!record) return { ...base, status: "review-required", reason: "Outcome or its evidence changed" };
    base.review_digest = learningReviewDigest(record);
    const note = await fingerprint(root, record.review_note.path);
    const lessons = await lessonLinks(root, record.lessons.map(l => l.id));
    if (canonical(note) !== canonical(record.review_note) || canonical(lessons) !== canonical(record.lessons)) return { ...base, status: "review-required", reason: "Review note or linked Lesson changed" };
    return { ...base, status: record.result, lesson_ids: record.lessons.map(l => l.id), reviewed_at: record.reviewed_at, actor: record.actor, reason: "Explicit review matches the current recorded outcome" };
  } catch (error) { return { ...base, reason: error.message }; }
}

export async function queryLearningReviews(root, { workItemId, compact = false } = {}) {
  if (typeof compact !== "boolean") throw new Error("compact must be boolean");
  if (workItemId !== undefined && !isWorkItemId(workItemId)) throw new Error("Invalid Work Item ID");
  const ids = new Set();
  const errors = [];
  if (workItemId) ids.add(workItemId);
  else {
    for (const entry of await directory(root, ".ai-org/work-items")) {
      if (entry.name.endsWith(".json") && isWorkItemId(entry.name.slice(0, -5))) ids.add(entry.name.slice(0, -5));
    }
    try {
      for (const entry of await directory(root, REVIEW_ROOT)) {
        if (!entry.isDirectory() || !isWorkItemId(entry.name)) errors.push(`Unexpected review directory: ${entry.name}`);
        else ids.add(entry.name);
      }
    } catch (error) { errors.push(error.message); }
  }
  const items = [];
  for (const id of [...ids].sort()) items.push(await statusFor(root, id));
  const counts = Object.fromEntries(["not-reviewed", "no-new-lesson", "linked-lessons", "review-required", "not-eligible", "unknown"].map(status => [status, items.filter(i => i.status === status).length]));
  return { schema_version: "temple.learning-review-status/v1", ...(compact ? { projection: "counts-only", total: items.length, ...(workItemId ? { work_item_id: workItemId } : {}) } : { items }), counts, errors, model_calls_performed: 0, mutation_performed: false };
}

// Existing projects pay no Work Item/evidence scan when the optional store is absent.
export async function summarizeLearningReviews(root) {
  try {
    const entries = await directory(root, REVIEW_ROOT);
    if (!entries.length) return { recorded: 0, counts: {}, errors: [] };
    const errors = [], items = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !isWorkItemId(entry.name)) { errors.push(`Unexpected review directory: ${entry.name}`); continue; }
      const item = await statusFor(root, entry.name);
      items.push(item);
      if (item.status === "unknown") errors.push(`${item.work_item_id}: ${item.reason}`);
    }
    const counts = Object.fromEntries(["no-new-lesson", "linked-lessons", "review-required", "not-eligible", "unknown"].map(status => [status, items.filter(i => i.status === status).length]));
    return { recorded: items.reduce((sum, item) => sum + item.record_count, 0), counts, errors };
  } catch (error) { return { recorded: null, counts: {}, errors: [error.message] }; }
}
