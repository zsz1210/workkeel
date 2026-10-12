import fs from "node:fs/promises";
import path from "node:path";
import { atomicCreate, atomicWrite, formatJson, pathExists, readJson, rollbackFileChanges, sha256 } from "./files.mjs";
import { isWorkItemId } from "./ids.mjs";
import { appendEvent } from "./project.mjs";
import { readCollaborationState } from "./collaboration.mjs";
import { createWorkItem, listWorkItemDocuments, readWorkItem } from "./work-items.mjs";

export const LEARNING_INDEX_RELATIVE_PATH = ".ai-org/learning/index.json";
export const LEARNING_INDEX_SCHEMA = "ai-org.learning-index/v2";
export const LEGACY_LEARNING_INDEX_SCHEMA = "ai-org.learning-index/v1";
export const SKILL_PROPOSAL_SCHEMA = "temple.skill-proposal/v1";
export const SKILL_PROPOSALS_RELATIVE_PATH = ".ai-org/learning/proposals";
export const LEARNING_STATUSES_BY_KIND = {
  lesson: ["candidate", "validated", "deprecated"],
  practice: ["candidate", "active", "deprecated"]
};
export const LEARNING_CONFIDENCE = ["low", "medium", "high"];
export const LEARNING_PROMOTION_TARGETS = [
  "none",
  "practice",
  "skill",
  "automated-check",
  "adr",
  "instruction"
];
export const LEARNING_PROMOTION_STATUSES = ["none", "proposed", "accepted", "rejected", "deferred"];

const LEARNING_ID = /^(LESSON|PRACTICE)-[0-9]{4,}$/;
const SKILL_PROPOSAL_ID = /^SKILL-PROPOSAL-[0-9]{4,}$/;
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REVALIDATION_RESULTS = ["confirmed", "narrowed", "contradicted"];
const SKILL_PROPOSAL_STATUSES = ["proposed", "approved", "rejected", "deferred"];
const SKILL_RISK_CLASSES = ["low", "standard", "high", "critical"];

export function emptyLearningIndex() {
  return { schema_version: LEARNING_INDEX_SCHEMA, entries: [] };
}

function uniqueStrings(values) {
  return (
    Array.isArray(values) &&
    values.every((value) => typeof value === "string" && value.trim().length > 0) &&
    new Set(values).size === values.length
  );
}

function validDate(value, { nullable = false } = {}) {
  if (nullable && value === null) return true;
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

export function validateLearningIndex(index) {
  const errors = [];
  if (![LEGACY_LEARNING_INDEX_SCHEMA, LEARNING_INDEX_SCHEMA].includes(index?.schema_version)) {
    errors.push(`schema_version must be ${LEGACY_LEARNING_INDEX_SCHEMA} or ${LEARNING_INDEX_SCHEMA}`);
  }
  if (!Array.isArray(index?.entries)) return { valid: false, errors: [...errors, "entries must be an array"] };

  const ids = new Set();
  const paths = new Set();
  for (const [position, entry] of index.entries.entries()) {
    const label = `entries[${position}]`;
    if (!LEARNING_ID.test(entry?.id ?? "")) errors.push(`${label}.id is invalid`);
    if (ids.has(entry?.id)) errors.push(`${label}.id is duplicated`);
    ids.add(entry?.id);

    const expectedKind = entry?.id?.startsWith("LESSON-") ? "lesson" : entry?.id?.startsWith("PRACTICE-") ? "practice" : null;
    if (entry?.kind !== expectedKind) errors.push(`${label}.kind must match the ID prefix`);
    if (typeof entry?.title !== "string" || entry.title.trim().length === 0) errors.push(`${label}.title is required`);
    if (typeof entry?.summary !== "string" || entry.summary.trim().length === 0) errors.push(`${label}.summary is required`);
    if (!LEARNING_STATUSES_BY_KIND[expectedKind]?.includes(entry?.status)) {
      errors.push(`${label}.status is invalid for ${expectedKind ?? "an unknown kind"}`);
    }
    if (!LEARNING_CONFIDENCE.includes(entry?.confidence)) errors.push(`${label}.confidence is invalid`);
    if (!uniqueStrings(entry?.tags)) errors.push(`${label}.tags must contain unique non-empty strings`);
    if (!uniqueStrings(entry?.applies_to)) errors.push(`${label}.applies_to must contain unique non-empty strings`);
    if (
      !Array.isArray(entry?.source_work_items) ||
      !entry.source_work_items.every(isWorkItemId) ||
      new Set(entry.source_work_items).size !== entry.source_work_items.length
    ) {
      errors.push(`${label}.source_work_items must contain unique work item IDs`);
    }

    const expectedPath = expectedKind ? `.ai-org/learning/${expectedKind === "lesson" ? "lessons" : "practices"}/${entry.id}.md` : null;
    if (entry?.path !== expectedPath) errors.push(`${label}.path must be ${expectedPath ?? "derived from a valid ID"}`);
    if (paths.has(entry?.path)) errors.push(`${label}.path is duplicated`);
    paths.add(entry?.path);

    if (!validDate(entry?.updated_at)) errors.push(`${label}.updated_at must be an ISO-compatible date`);
    if (!validDate(entry?.last_validated_at, { nullable: true })) {
      errors.push(`${label}.last_validated_at must be null or an ISO-compatible date`);
    }

    if (!LEARNING_PROMOTION_TARGETS.includes(entry?.promotion?.target)) {
      errors.push(`${label}.promotion.target is invalid`);
    }
    if (!LEARNING_PROMOTION_STATUSES.includes(entry?.promotion?.status)) {
      errors.push(`${label}.promotion.status is invalid`);
    }
    if (!(entry?.promotion?.reference === null || typeof entry?.promotion?.reference === "string")) {
      errors.push(`${label}.promotion.reference must be null or a string`);
    }
    if (!(entry?.promotion?.proposal_id === undefined || entry?.promotion?.proposal_id === null || SKILL_PROPOSAL_ID.test(entry.promotion.proposal_id))) {
      errors.push(`${label}.promotion.proposal_id is invalid`);
    }
    if (!(entry?.promotion?.review_after === undefined || validDate(entry.promotion.review_after, { nullable: true }))) {
      errors.push(`${label}.promotion.review_after is invalid`);
    }
    if (!(entry?.promotion?.work_item_id === undefined || entry?.promotion?.work_item_id === null || isWorkItemId(entry.promotion.work_item_id))) {
      errors.push(`${label}.promotion.work_item_id is invalid`);
    }
    if (index.schema_version === LEARNING_INDEX_SCHEMA) {
      if (!Array.isArray(entry?.derived_from) || entry.derived_from.some((value) => !/^LESSON-[0-9]{4,}$/.test(value)) || new Set(entry.derived_from).size !== entry.derived_from.length) {
        errors.push(`${label}.derived_from must contain unique Lesson IDs`);
      }
      if (!(entry?.owner_position === null || typeof entry?.owner_position === "string")) errors.push(`${label}.owner_position is invalid`);
      const revalidation = entry?.revalidation;
      if (!(revalidation?.last_result === null || REVALIDATION_RESULTS.includes(revalidation?.last_result))) {
        errors.push(`${label}.revalidation.last_result is invalid`);
      }
      if (!validDate(revalidation?.review_after, { nullable: true })) errors.push(`${label}.revalidation.review_after is invalid`);
      if (!uniqueStrings(revalidation?.evidence_refs)) errors.push(`${label}.revalidation.evidence_refs must contain unique strings`);
      if (!Array.isArray(revalidation?.history)) errors.push(`${label}.revalidation.history must be an array`);
      for (const [historyIndex, history] of (revalidation?.history ?? []).entries()) {
        if (!REVALIDATION_RESULTS.includes(history?.result) || !validDate(history?.validated_at) || !nonEmptyString(history?.validated_by) || !uniqueStrings(history?.evidence_refs) || !validDate(history?.review_after, { nullable: true })) {
          errors.push(`${label}.revalidation.history[${historyIndex}] is invalid`);
        }
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function uniqueNormalized(values) {
  return [...new Set((values ?? []).map((value) => String(value).trim()).filter(Boolean))];
}

function v2Entry(entry) {
  if (entry.revalidation && Array.isArray(entry.derived_from) && Object.hasOwn(entry, "owner_position")) return entry;
  return {
    ...entry,
    derived_from: [],
    owner_position: null,
    revalidation: { last_result: null, review_after: null, evidence_refs: [], history: [] }
  };
}

export function migrateLearningIndexDocument(index) {
  const validation = validateLearningIndex(index);
  if (!validation.valid) throw new Error(`Cannot migrate invalid learning index: ${validation.errors.join("; ")}`);
  if (index.schema_version === LEARNING_INDEX_SCHEMA) return index;
  return { schema_version: LEARNING_INDEX_SCHEMA, entries: index.entries.map(v2Entry) };
}

function normalizedPromotion(entry) {
  return {
    target: entry?.promotion?.target ?? "none",
    status: entry?.promotion?.status ?? "none",
    reference: entry?.promotion?.reference ?? null,
    proposal_id: entry?.promotion?.proposal_id ?? null,
    review_after: entry?.promotion?.review_after ?? null,
    work_item_id: entry?.promotion?.work_item_id ?? null
  };
}

function sourceWorkItemsForPractice(index, practice) {
  const lessonIds = new Set(practice.derived_from ?? []);
  return uniqueNormalized([
    ...(practice.source_work_items ?? []),
    ...index.entries
      .filter((entry) => entry.kind === "lesson" && lessonIds.has(entry.id))
      .flatMap((entry) => entry.source_work_items ?? [])
  ]).sort();
}

export function skillPromotionCandidate(entry, index, now = new Date()) {
  const promotion = normalizedPromotion(entry);
  const sourceWorkItems = entry.kind === "practice" ? sourceWorkItemsForPractice(index, entry) : [];
  const blockers = [];
  if (entry.kind !== "practice") blockers.push("not_practice");
  if (entry.status !== "active") blockers.push("not_active");
  if (entry.confidence !== "high") blockers.push("confidence_not_high");
  if (entry.revalidation?.last_result !== "confirmed") blockers.push("not_confirmed");
  if (sourceWorkItems.length < 2) blockers.push("recurrence-evidence-missing");

  let decisionSignal = "unreviewed";
  if (promotion.status === "proposed") decisionSignal = "approval_pending";
  else if (promotion.status === "accepted") decisionSignal = "authoring_created";
  else if (promotion.status === "rejected") decisionSignal = "rejected";
  else if (promotion.status === "deferred") {
    decisionSignal = promotion.review_after && Date.parse(promotion.review_after) <= now.getTime() ? "review_due" : "deferred";
  }
  if (["proposed", "accepted", "rejected"].includes(promotion.status)) blockers.push(`promotion_${promotion.status}`);
  if (promotion.status === "deferred" && decisionSignal !== "review_due") blockers.push("promotion_deferred");

  return {
    learning_id: entry.id,
    title: entry.title,
    eligible: blockers.length === 0,
    blockers,
    recurrence_count: sourceWorkItems.length,
    source_work_items: sourceWorkItems,
    decision_signal: decisionSignal,
    promotion
  };
}

export function buildSkillPromotionCandidates(index, now = new Date()) {
  const migrated = migrateLearningIndexDocument(index);
  const candidates = migrated.entries
    .filter((entry) => entry.kind === "practice")
    .map((entry) => skillPromotionCandidate(entry, migrated, now));
  return {
    schema_version: "temple.skill-promotion-candidates/v1",
    generated_at: now.toISOString(),
    policy: {
      practice_status: "active",
      confidence: "high",
      revalidation_result: "confirmed",
      minimum_distinct_work_items: 2,
      human_approval_required: true,
      automatic_skill_activation: false
    },
    summary: {
      practices: candidates.length,
      eligible: candidates.filter((entry) => entry.eligible).length,
      approval_pending: candidates.filter((entry) => entry.decision_signal === "approval_pending").length,
      review_due: candidates.filter((entry) => entry.decision_signal === "review_due").length,
      authoring_created: candidates.filter((entry) => entry.decision_signal === "authoring_created").length
    },
    candidates
  };
}

export async function migrateLearningIndex(target, { dryRun = false } = {}) {
  const indexPath = path.join(target, LEARNING_INDEX_RELATIVE_PATH);
  const current = await readJson(indexPath);
  const migrated = migrateLearningIndexDocument(current);
  const changed = JSON.stringify(current) !== JSON.stringify(migrated);
  if (changed && !dryRun) {
    await atomicWrite(indexPath, formatJson(migrated));
    await appendEvent(target, {
      timestamp: new Date().toISOString(),
      event_type: "learning_index_migrated",
      actor: "human",
      from_schema: current.schema_version,
      to_schema: migrated.schema_version,
      refs: [LEARNING_INDEX_RELATIVE_PATH]
    });
  }
  return { changed, from_schema: current.schema_version, to_schema: migrated.schema_version, index: migrated };
}

function nextLearningId(index, kind) {
  const prefix = kind === "lesson" ? "LESSON" : "PRACTICE";
  const numbers = index.entries
    .map((entry) => new RegExp(`^${prefix}-([0-9]+)$`).exec(entry.id)?.[1])
    .filter(Boolean)
    .map(Number);
  return `${prefix}-${String((numbers.length ? Math.max(...numbers) : 0) + 1).padStart(4, "0")}`;
}

function markdownList(values, empty = "None recorded.") {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : empty;
}

function learningMarkdown(entry, options, timestamp) {
  return `# ${entry.kind === "lesson" ? "Engineering lesson" : "Engineering practice"}: ${entry.title}\n\n- ID: \`${entry.id}\`\n- Status: \`${entry.status}\`\n- Confidence: \`${entry.confidence}\`\n- Owner Position: ${entry.owner_position ?? "not assigned"}\n- Created: \`${timestamp}\`\n- Last validated: not yet\n\n## Summary\n\n${entry.summary}\n\n## Applicability\n\n${markdownList(entry.applies_to)}\n\n## Tags\n\n${markdownList(entry.tags)}\n\n## Source Work Items\n\n${markdownList(entry.source_work_items)}\n\n## Derived Lessons\n\n${markdownList(entry.derived_from)}\n\n## Evidence\n\n${markdownList(uniqueNormalized(options.evidence))}\n\n## Authority boundary\n\nThis learning guides relevant work. It does not grant permission, change lifecycle state, or replace verification.\n\n## Validation history\n\nNo revalidation recorded.\n`;
}

export async function addLearningEntry(target, kind, options) {
  if (!["lesson", "practice"].includes(kind)) throw new Error(`Unsupported learning kind: ${kind}`);
  const title = String(options.title ?? "").trim();
  const summary = String(options.summary ?? "").trim();
  if (!title || !summary) throw new Error("Learning requires --title and --summary");
  if (!LEARNING_CONFIDENCE.includes(options.confidence)) throw new Error(`--confidence must be ${LEARNING_CONFIDENCE.join(", ")}`);
  const current = await readLearningIndex(target);
  const index = migrateLearningIndexDocument(current);
  const derivedFrom = uniqueNormalized(options.derivedFrom);
  if (kind === "lesson" && derivedFrom.length > 0) throw new Error("A Lesson cannot use --derived-from");
  const missingLessons = derivedFrom.filter((id) => !index.entries.some((entry) => entry.id === id && entry.kind === "lesson"));
  if (missingLessons.length > 0) throw new Error(`Unknown derived Lesson: ${missingLessons.join(", ")}`);
  const sourceWorkItems = uniqueNormalized(options.sourceWorkItems);
  if (sourceWorkItems.some((id) => !isWorkItemId(id))) throw new Error("--source-work-item must contain Work Item IDs");
  const id = nextLearningId(index, kind);
  const timestamp = new Date().toISOString();
  const entry = {
    id,
    kind,
    title,
    summary,
    status: "candidate",
    confidence: options.confidence,
    tags: uniqueNormalized(options.tags),
    applies_to: uniqueNormalized(options.appliesTo),
    source_work_items: sourceWorkItems,
    path: `.ai-org/learning/${kind === "lesson" ? "lessons" : "practices"}/${id}.md`,
    updated_at: timestamp,
    last_validated_at: null,
    promotion: { target: "none", status: "none", reference: null },
    derived_from: derivedFrom,
    owner_position: String(options.ownerPosition ?? "").trim() || null,
    revalidation: { last_result: null, review_after: null, evidence_refs: uniqueNormalized(options.evidence), history: [] }
  };
  const updated = { schema_version: LEARNING_INDEX_SCHEMA, entries: [...index.entries, entry] };
  const validation = validateLearningIndex(updated);
  if (!validation.valid) throw new Error(`Invalid learning entry: ${validation.errors.join("; ")}`);
  const recordPath = path.join(target, entry.path);
  const indexPath = path.join(target, LEARNING_INDEX_RELATIVE_PATH);
  const beforeIndex = await fs.readFile(indexPath);
  const changes = [];
  try {
    const record = learningMarkdown(entry, options, timestamp);
    await atomicCreate(recordPath, record);
    changes.push({ path: recordPath, before: null, afterHash: sha256(record) });
    await atomicWrite(indexPath, formatJson(updated));
    await appendEvent(target, { timestamp, event_type: "learning_added", actor: options.actor ?? "human", learning_id: id, learning_kind: kind, refs: [entry.path, LEARNING_INDEX_RELATIVE_PATH] });
  } catch (error) {
    await atomicWrite(indexPath, beforeIndex).catch(() => {});
    await rollbackFileChanges(changes).catch(() => {});
    throw error;
  }
  return entry;
}

export function revalidationSignal(entry, now = new Date()) {
  if (entry.status === "deprecated") return "not_applicable";
  if (entry.revalidation?.last_result === "contradicted") return "contradicted";
  const reviewAfter = entry.revalidation?.review_after;
  if (!reviewAfter) return "not_scheduled";
  const dueAt = Date.parse(reviewAfter);
  if (dueAt <= now.getTime()) return "overdue";
  if (dueAt - now.getTime() <= 30 * 24 * 60 * 60 * 1000) return "due";
  return "current";
}

export async function listLearningEntries(target) {
  const index = migrateLearningIndexDocument(await readLearningIndex(target));
  return {
    schema_version: "temple.learning-list/v1",
    index_schema: index.schema_version,
    entries: index.entries.map((entry) => ({
      ...entry,
      promotion: normalizedPromotion(entry),
      revalidation: { ...entry.revalidation, signal: revalidationSignal(entry) },
      skill_promotion: entry.kind === "practice" ? skillPromotionCandidate(entry, index) : null
    }))
  };
}

export async function listSkillPromotionCandidates(target) {
  return buildSkillPromotionCandidates(await readLearningIndex(target));
}

function currentLearningHeader(text, entry) {
  const end = text.search(/^## /m);
  if (end < 0) throw new Error("Learning document has no bounded metadata header");
  let header = text.slice(0, end);
  const identity = header.match(/^- ID: `([^`]+)`\r?$/gm) ?? [];
  if (identity.length !== 1 || identity[0].replace(/\r$/, "") !== `- ID: \`${entry.id}\``) throw new Error("Learning document header identity mismatch");
  for (const [label, value] of [["Status", `\`${entry.status}\``], ["Last validated", entry.last_validated_at ? `\`${entry.last_validated_at}\`` : "not yet"]]) {
    const pattern = new RegExp(`^- ${label}: [^\\r\\n]*(?=\\r?$)`, "gm");
    if ((header.match(pattern) ?? []).length !== 1) throw new Error(`Learning header requires exactly one ${label} field`);
    header = header.replace(pattern, () => `- ${label}: ${value}`);
  }
  return header + text.slice(end);
}

async function learningDocumentPath(target, entry) {
  const expected = `.ai-org/learning/${entry.kind === "lesson" ? "lessons" : "practices"}/${entry.id}.md`;
  if (entry.path !== expected) throw new Error("Invalid Learning record path");
  let current = path.resolve(target);
  for (const part of entry.path.split("/")) {
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error("Symlink Learning record path is not allowed");
  }
  if (!(await fs.stat(current)).isFile()) throw new Error("Learning record must be a regular file");
  return current;
}

// Reconcile presentation from existing authority, without asserting a new review.
export async function syncLearningMetadata(target, options) {
  const index = await readLearningIndex(target);
  const validation = validateLearningIndex(index);
  if (!validation.valid) throw new Error(`Invalid Learning index: ${validation.errors.join("; ")}`);
  const entry = index.entries.find(e => e.id === options.learningId);
  if (!entry) throw new Error(`Learning entry not found: ${options.learningId}`);
  const recordPath = await learningDocumentPath(target, entry);
  const before = await fs.readFile(recordPath, "utf8");
  const after = currentLearningHeader(before, entry);
  if (after !== before && !options.dryRun) await atomicWrite(recordPath, after);
  return { learning_id: entry.id, path: entry.path, changed: before !== after, dry_run: Boolean(options.dryRun), mutation_performed: before !== after && !options.dryRun, before_sha256: sha256(before), after_sha256: sha256(after), revalidation_performed: false, index_changed: false };
}

export async function revalidateLearningEntry(target, options) {
  const result = String(options.result ?? "").trim();
  if (!REVALIDATION_RESULTS.includes(result)) throw new Error(`--result must be ${REVALIDATION_RESULTS.join(", ")}`);
  const reviewAfter = String(options.reviewAfter ?? "").trim() || null;
  if (!validDate(reviewAfter, { nullable: true })) throw new Error("--review-after must be an ISO-compatible timestamp");
  const indexPath = path.join(target, LEARNING_INDEX_RELATIVE_PATH);
  const current = await readLearningIndex(target);
  const index = migrateLearningIndexDocument(current);
  const entryIndex = index.entries.findIndex((entry) => entry.id === options.learningId);
  if (entryIndex < 0) throw new Error(`Learning entry not found: ${options.learningId}`);
  const originalEntry = index.entries[entryIndex];
  const timestamp = new Date().toISOString();
  const evidenceRefs = uniqueNormalized(options.evidence);
  const history = { result, validated_at: timestamp, validated_by: options.actor ?? "human", evidence_refs: evidenceRefs, review_after: reviewAfter };
  const entry = {
    ...originalEntry,
    status: result === "confirmed" ? (originalEntry.kind === "lesson" ? "validated" : "active") : originalEntry.status,
    updated_at: timestamp,
    last_validated_at: timestamp,
    revalidation: {
      last_result: result,
      review_after: reviewAfter,
      evidence_refs: uniqueNormalized([...(originalEntry.revalidation?.evidence_refs ?? []), ...evidenceRefs]),
      history: [...(originalEntry.revalidation?.history ?? []), history]
    }
  };
  const entries = [...index.entries];
  entries[entryIndex] = entry;
  const updated = { schema_version: LEARNING_INDEX_SCHEMA, entries };
  const validation = validateLearningIndex(updated);
  if (!validation.valid) throw new Error(`Invalid learning revalidation: ${validation.errors.join("; ")}`);
  const recordPath = await learningDocumentPath(target, entry);
  const [beforeIndex, beforeRecord] = await Promise.all([fs.readFile(indexPath), fs.readFile(recordPath)]);
  const addition = `\n### ${timestamp}\n\n- Result: \`${result}\`\n- Validated by: \`${history.validated_by}\`\n- Review after: ${reviewAfter ? `\`${reviewAfter}\`` : "not scheduled"}\n- Evidence:\n${markdownList(evidenceRefs)}\n`;
  try {
    await atomicWrite(recordPath, `${currentLearningHeader(beforeRecord.toString("utf8"), entry).trimEnd()}\n${addition}`);
    await atomicWrite(indexPath, formatJson(updated));
    await appendEvent(target, { timestamp, event_type: "learning_revalidated", actor: history.validated_by, learning_id: entry.id, result, refs: [entry.path, ...evidenceRefs] });
  } catch (error) {
    await Promise.all([atomicWrite(indexPath, beforeIndex).catch(() => {}), atomicWrite(recordPath, beforeRecord).catch(() => {})]);
    throw error;
  }
  return { ...entry, revalidation: { ...entry.revalidation, signal: revalidationSignal(entry) } };
}

function proposalRelativePath(proposalId) {
  return `${SKILL_PROPOSALS_RELATIVE_PATH}/${proposalId}.json`;
}

function proposalPath(target, proposalId) {
  if (!SKILL_PROPOSAL_ID.test(proposalId ?? "")) throw new Error(`Invalid Skill Proposal ID: ${proposalId ?? "missing"}`);
  return path.join(target, proposalRelativePath(proposalId));
}

function optionalNonEmptyString(value) {
  return value === null || nonEmptyString(value);
}

export function validateSkillProposal(proposal) {
  const errors = [];
  if (proposal?.schema_version !== SKILL_PROPOSAL_SCHEMA) errors.push(`schema_version must be ${SKILL_PROPOSAL_SCHEMA}`);
  if (!SKILL_PROPOSAL_ID.test(proposal?.id ?? "")) errors.push("id is invalid");
  if (proposal?.path !== proposalRelativePath(proposal?.id ?? "")) errors.push("path must match the proposal ID");
  if (!SKILL_PROPOSAL_STATUSES.includes(proposal?.status)) errors.push("status is invalid");
  if (!/^PRACTICE-[0-9]{4,}$/.test(proposal?.source_learning_id ?? "")) errors.push("source_learning_id must be a Practice ID");
  if (!isWorkItemId(proposal?.review_work_item_id)) errors.push("review_work_item_id must be a Work Item ID");
  if (!SKILL_NAME.test(proposal?.skill_name ?? "")) errors.push("skill_name is invalid");
  if (proposal?.skill_path !== `.agents/skills/${proposal?.skill_name}`) errors.push("skill_path must match skill_name");
  for (const field of ["summary", "trigger", "non_trigger", "authority", "overlap_review"]) {
    if (!nonEmptyString(proposal?.[field])) errors.push(`${field} is required`);
  }
  if (!SKILL_RISK_CLASSES.includes(proposal?.risk_class)) errors.push("risk_class is invalid");
  for (const field of ["dependencies", "alternatives", "evidence_refs"]) {
    if (!uniqueStrings(proposal?.[field])) errors.push(`${field} must contain unique non-empty strings`);
  }
  if (
    !Array.isArray(proposal?.source_work_items) ||
    proposal.source_work_items.length < 2 ||
    !proposal.source_work_items.every(isWorkItemId) ||
    new Set(proposal.source_work_items).size !== proposal.source_work_items.length
  ) {
    errors.push("source_work_items must contain at least two distinct Work Item IDs");
  }
  if (!validDate(proposal?.created_at) || !nonEmptyString(proposal?.created_by)) errors.push("creation metadata is invalid");
  if (!validDate(proposal?.updated_at) || !nonEmptyString(proposal?.updated_by)) errors.push("update metadata is invalid");
  if (!optionalNonEmptyString(proposal?.authoring_work_item_id) || (proposal?.authoring_work_item_id !== null && !isWorkItemId(proposal.authoring_work_item_id))) {
    errors.push("authoring_work_item_id is invalid");
  }
  if (proposal?.decision !== null) {
    const decision = proposal?.decision;
    if (!SKILL_PROPOSAL_STATUSES.filter((status) => status !== "proposed").includes(decision?.status)) errors.push("decision.status is invalid");
    if (!nonEmptyString(decision?.principal_id) || !nonEmptyString(decision?.reason) || !validDate(decision?.decided_at)) {
      errors.push("decision metadata is invalid");
    }
    if (!validDate(decision?.review_after, { nullable: true })) errors.push("decision.review_after is invalid");
  }
  if (proposal?.status === "proposed" && proposal?.decision !== null) errors.push("a proposed record cannot contain a decision");
  if (proposal?.status !== "proposed" && proposal?.decision?.status !== proposal?.status) errors.push("status must match decision.status");
  if (proposal?.status === "approved" && !isWorkItemId(proposal?.authoring_work_item_id)) errors.push("an approved proposal requires authoring_work_item_id");
  if (proposal?.status !== "approved" && proposal?.authoring_work_item_id !== null) errors.push("only an approved proposal may link an authoring Work Item");
  if (proposal?.status === "deferred" && !validDate(proposal?.decision?.review_after)) errors.push("a deferred proposal requires review_after");
  return { valid: errors.length === 0, errors };
}

export async function listSkillProposals(target) {
  const directory = path.join(target, SKILL_PROPOSALS_RELATIVE_PATH);
  if (!(await pathExists(directory))) return [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const proposals = [];
  for (const entry of entries.filter((candidate) => candidate.isFile() && candidate.name.endsWith(".json")).sort((left, right) => left.name.localeCompare(right.name))) {
    const proposal = await readJson(path.join(directory, entry.name));
    const validation = validateSkillProposal(proposal);
    if (!validation.valid) throw new Error(`Invalid Skill Proposal ${entry.name}: ${validation.errors.join("; ")}`);
    proposals.push(proposal);
  }
  return proposals;
}

export async function validateSkillProposalRepository(target) {
  const directory = path.join(target, SKILL_PROPOSALS_RELATIVE_PATH);
  if (!(await pathExists(directory))) return { valid: true, proposals_checked: 0, checked: [], errors: [] };
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const checked = [];
  const errors = [];
  for (const entry of entries.filter((candidate) => candidate.isFile() && candidate.name.endsWith(".json")).sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = `${SKILL_PROPOSALS_RELATIVE_PATH}/${entry.name}`;
    try {
      const validation = validateSkillProposal(await readJson(path.join(directory, entry.name)));
      checked.push({ document: relativePath, valid: validation.valid });
      errors.push(...validation.errors.map((message) => `${relativePath}: ${message}`));
    } catch (error) {
      checked.push({ document: relativePath, valid: false });
      errors.push(`${relativePath}: ${error.message}`);
    }
  }
  return { valid: errors.length === 0, proposals_checked: checked.length, checked, errors };
}

export async function validateLearningRepository(target) {
  const errors = [];
  let index;
  try {
    index = migrateLearningIndexDocument(await readLearningIndex(target));
  } catch (error) {
    return { valid: false, proposals_checked: 0, checked: [], proposals: [], errors: [error.message] };
  }
  const proposalValidation = await validateSkillProposalRepository(target);
  errors.push(...proposalValidation.errors);
  let proposals = [];
  if (proposalValidation.valid) proposals = await listSkillProposals(target);
  const proposalsById = new Map(proposals.map((proposal) => [proposal.id, proposal]));
  const learningById = new Map(index.entries.map((entry) => [entry.id, entry]));
  const workItems = new Map((await listWorkItemDocuments(target)).map((item) => [item.id, item]));

  for (const entry of index.entries) {
    const promotion = normalizedPromotion(entry);
    if (!promotion.proposal_id) continue;
    const proposal = proposalsById.get(promotion.proposal_id);
    if (!proposal) {
      errors.push(`${entry.id} references missing Skill Proposal ${promotion.proposal_id}`);
      continue;
    }
    const expectedStatus = proposal.status === "approved" ? "accepted" : proposal.status;
    if (proposal.source_learning_id !== entry.id) errors.push(`${proposal.id} source_learning_id does not match ${entry.id}`);
    if (promotion.reference !== proposal.path) errors.push(`${entry.id} promotion.reference does not match ${proposal.id}`);
    if (promotion.status !== expectedStatus) errors.push(`${entry.id} promotion.status does not match ${proposal.id}`);
    if ((promotion.work_item_id ?? null) !== (proposal.authoring_work_item_id ?? null)) {
      errors.push(`${entry.id} promotion.work_item_id does not match ${proposal.id}`);
    }
    if ((promotion.review_after ?? null) !== (proposal.decision?.review_after ?? null)) {
      errors.push(`${entry.id} promotion.review_after does not match ${proposal.id}`);
    }
  }

  for (const proposal of proposals) {
    const learning = learningById.get(proposal.source_learning_id);
    if (!learning) errors.push(`${proposal.id} references missing Learning entry ${proposal.source_learning_id}`);
    else if (normalizedPromotion(learning).proposal_id !== proposal.id) errors.push(`${proposal.id} is not correlated from ${learning.id}`);
    if (proposal.status === "approved") {
      const item = workItems.get(proposal.authoring_work_item_id);
      if (!item) errors.push(`${proposal.id} references missing authoring Work Item ${proposal.authoring_work_item_id}`);
      else {
        if (!(item.evidence ?? []).includes(proposal.path)) errors.push(`${item.id} does not preserve ${proposal.id} as evidence`);
        if (item.parent_work_item_id !== proposal.review_work_item_id) errors.push(`${item.id} parent does not match ${proposal.id} review Work Item`);
        if (!(item.affected_paths ?? []).includes(`${proposal.skill_path}/**`)) errors.push(`${item.id} does not declare the proposed Skill path`);
      }
    }
  }

  const reservedPaths = new Map();
  for (const proposal of proposals.filter((entry) => entry.status !== "rejected")) {
    if (reservedPaths.has(proposal.skill_path)) errors.push(`${proposal.id} duplicates Skill path reserved by ${reservedPaths.get(proposal.skill_path)}`);
    else reservedPaths.set(proposal.skill_path, proposal.id);
  }
  return {
    valid: errors.length === 0,
    proposals_checked: proposalValidation.proposals_checked,
    checked: proposalValidation.checked,
    proposals,
    errors
  };
}

async function nextSkillProposalId(target) {
  const directory = path.join(target, SKILL_PROPOSALS_RELATIVE_PATH);
  if (!(await pathExists(directory))) return "SKILL-PROPOSAL-0001";
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const numbers = entries
    .filter((entry) => entry.isFile())
    .map((entry) => /^SKILL-PROPOSAL-([0-9]+)\.json$/.exec(entry.name)?.[1])
    .filter(Boolean)
    .map(Number);
  return `SKILL-PROPOSAL-${String((numbers.length ? Math.max(...numbers) : 0) + 1).padStart(4, "0")}`;
}

function requireProposalReviewAuthority(item, actor) {
  if (item.state !== "design" || item.owner_position !== "tech_lead") {
    throw new Error(`${item.id} must be in design and owned by tech_lead to create a Skill Proposal`);
  }
  if (item.claim?.status !== "active" || item.claim.agent_id !== item.assigned_agent_id) {
    throw new Error(`${item.id} requires an active Tech Lead claim to create a Skill Proposal`);
  }
  const resolvedActor = actor ?? item.claim.agent_id;
  if (![item.claim.agent_id, "human"].includes(resolvedActor)) {
    throw new Error(`Actor ${resolvedActor} does not hold the active Tech Lead claim for ${item.id}`);
  }
  return resolvedActor;
}

export async function proposeSkillFromLearning(target, options) {
  const skillName = String(options.skillName ?? "").trim();
  if (!SKILL_NAME.test(skillName)) throw new Error("--skill-name must use lowercase kebab-case");
  for (const field of ["summary", "trigger", "nonTrigger", "authority", "overlapReview", "reviewWorkItemId"]) {
    if (!nonEmptyString(options[field])) throw new Error(`--${field.replace(/[A-Z]/g, (value) => `-${value.toLowerCase()}`)} is required`);
  }
  if (!SKILL_RISK_CLASSES.includes(options.riskClass)) throw new Error(`--risk-class must be ${SKILL_RISK_CLASSES.join(", ")}`);
  if (await pathExists(path.join(target, ".agents/skills", skillName))) throw new Error(`Skill path already exists: .agents/skills/${skillName}`);

  const reviewItem = await readWorkItem(target, options.reviewWorkItemId);
  const actor = requireProposalReviewAuthority(reviewItem, options.actor);
  const indexPath = path.join(target, LEARNING_INDEX_RELATIVE_PATH);
  const index = migrateLearningIndexDocument(await readLearningIndex(target));
  const entryIndex = index.entries.findIndex((entry) => entry.id === options.learningId);
  if (entryIndex < 0) throw new Error(`Learning entry not found: ${options.learningId}`);
  const candidate = skillPromotionCandidate(index.entries[entryIndex], index);
  if (!candidate.eligible) throw new Error(`${options.learningId} is not eligible for Skill promotion: ${candidate.blockers.join(", ")}`);

  const proposals = await listSkillProposals(target);
  const duplicate = proposals.find((entry) => entry.skill_name === skillName && entry.status !== "rejected");
  if (duplicate) throw new Error(`Skill Proposal ${duplicate.id} already reserves .agents/skills/${skillName}`);
  const proposalId = await nextSkillProposalId(target);
  const relativePath = proposalRelativePath(proposalId);
  const timestamp = new Date().toISOString();
  const evidenceRefs = uniqueNormalized([
    index.entries[entryIndex].path,
    ...(index.entries[entryIndex].revalidation?.evidence_refs ?? []),
    ...candidate.source_work_items.map((id) => `.ai-org/work-items/${id}.json`),
    ...(options.evidence ?? [])
  ]);
  const proposal = {
    schema_version: SKILL_PROPOSAL_SCHEMA,
    id: proposalId,
    path: relativePath,
    status: "proposed",
    source_learning_id: options.learningId,
    source_work_items: candidate.source_work_items,
    review_work_item_id: options.reviewWorkItemId,
    skill_name: skillName,
    skill_path: `.agents/skills/${skillName}`,
    summary: String(options.summary).trim(),
    trigger: String(options.trigger).trim(),
    non_trigger: String(options.nonTrigger).trim(),
    authority: String(options.authority).trim(),
    risk_class: options.riskClass,
    dependencies: uniqueNormalized(options.dependencies),
    alternatives: uniqueNormalized(options.alternatives),
    overlap_review: String(options.overlapReview).trim(),
    evidence_refs: evidenceRefs,
    created_at: timestamp,
    created_by: actor,
    updated_at: timestamp,
    updated_by: actor,
    decision: null,
    authoring_work_item_id: null
  };
  const proposalValidation = validateSkillProposal(proposal);
  if (!proposalValidation.valid) throw new Error(`Invalid Skill Proposal: ${proposalValidation.errors.join("; ")}`);

  const updatedIndex = structuredClone(index);
  updatedIndex.entries[entryIndex] = {
    ...updatedIndex.entries[entryIndex],
    updated_at: timestamp,
    promotion: {
      target: "skill",
      status: "proposed",
      reference: relativePath,
      proposal_id: proposalId,
      review_after: null,
      work_item_id: null
    }
  };
  const indexValidation = validateLearningIndex(updatedIndex);
  if (!indexValidation.valid) throw new Error(`Invalid Skill promotion update: ${indexValidation.errors.join("; ")}`);
  const beforeIndex = await fs.readFile(indexPath);
  const absoluteProposalPath = path.join(target, relativePath);
  const changes = [];
  try {
    const proposalContent = formatJson(proposal);
    await atomicCreate(absoluteProposalPath, proposalContent);
    changes.push({ path: absoluteProposalPath, before: null, afterHash: sha256(proposalContent) });
    await atomicWrite(indexPath, formatJson(updatedIndex));
    await appendEvent(target, {
      timestamp,
      event_type: "skill_proposal_created",
      actor,
      work_item_id: options.reviewWorkItemId,
      learning_id: options.learningId,
      proposal_id: proposalId,
      refs: [relativePath, LEARNING_INDEX_RELATIVE_PATH]
    });
  } catch (error) {
    await atomicWrite(indexPath, beforeIndex).catch(() => {});
    await rollbackFileChanges(changes).catch(() => {});
    throw error;
  }
  return proposal;
}

function normalizedProposalDecision(value) {
  return { approve: "approved", reject: "rejected", defer: "deferred" }[String(value ?? "").trim()] ?? null;
}

async function assertHumanPrincipal(target, principalId) {
  const collaboration = await readCollaborationState(target);
  if (collaboration.profile === "solo") {
    if (principalId !== "human") throw new Error("Solo projects require --principal-id human");
    return;
  }
  const principal = (collaboration.principals ?? []).find((entry) => entry.id === principalId && entry.active !== false);
  if (!principal) throw new Error(`Unknown active Human Principal: ${principalId}`);
}

async function authoringWorkItemForProposal(target, proposal) {
  const workItems = await listWorkItemDocuments(target);
  const matches = workItems.filter((item) => (item.evidence ?? []).includes(proposal.path));
  if (matches.length > 1) throw new Error(`${proposal.id} is linked by multiple authoring Work Items: ${matches.map((item) => item.id).join(", ")}`);
  return matches[0] ?? null;
}

async function createSkillAuthoringWorkItem(target, proposal) {
  const existing = await authoringWorkItemForProposal(target, proposal);
  if (existing) return existing;
  const reviewItem = await readWorkItem(target, proposal.review_work_item_id);
  const riskAcceptance = {
    low: "Focused routing and authority scenarios pass for the bounded low-risk procedure.",
    standard: "An isolated forward test plus focused routing and authority scenarios pass.",
    high: "An isolated forward test, adversarial authority scenarios, and a documented rollback review pass.",
    critical: "An isolated forward test, adversarial authority scenarios, verified rollback evidence, and the project's strongest applicable human release review pass."
  }[proposal.risk_class];
  const created = await createWorkItem(target, {
    title: `Author repository Skill: ${proposal.skill_name}`,
    scope: [
      `Author ${proposal.skill_path}/SKILL.md from ${proposal.id} without expanding the approved procedure or authority.`,
      "Preserve explicit trigger and non-trigger boundaries, dependency review, and risk-proportionate validation.",
      "Keep the Skill project-owned; do not install dependencies, publish it, or activate integrations."
    ],
    acceptance: [
      "The repository-local Skill follows docs/extensions/skill-authoring.md and docs/extensions/skill-design.md.",
      "The Skill states its trigger, non-trigger, authority limits, dependencies, and evidence provenance.",
      riskAcceptance,
      "Focused tests and independent QA verify routing and confirm that no broader capability or permission was activated."
    ],
    affectedPaths: [`${proposal.skill_path}/**`, proposal.path],
    parentWorkItemId: proposal.review_work_item_id,
    trackerVisibility: "internal",
    requiredDisciplines: ["general-development"],
    baseRevision: reviewItem.base_revision ?? null,
    parallelMode: "sequential",
    integrationOwnerAgentId: reviewItem.integration_owner_agent_id ?? null,
    contractStatus: "not_required",
    specificationMode: "gate-evidence",
    uiDeliveryMode: "not-applicable",
    evidence: [proposal.path]
  });
  return created.item;
}

export async function decideSkillProposal(target, options) {
  const proposalId = String(options.proposalId ?? "").trim();
  const decisionStatus = normalizedProposalDecision(options.decision);
  if (!decisionStatus) throw new Error("--decision must be approve, reject, or defer");
  const principalId = String(options.principalId ?? "").trim();
  const reason = String(options.reason ?? "").trim();
  if (!principalId || !reason) throw new Error("Skill Proposal decisions require --principal-id and --reason");
  await assertHumanPrincipal(target, principalId);
  const reviewAfter = String(options.reviewAfter ?? "").trim() || null;
  if (decisionStatus === "deferred" && (!validDate(reviewAfter) || Date.parse(reviewAfter) <= Date.now())) {
    throw new Error("A deferred decision requires a future --review-after timestamp");
  }
  if (decisionStatus !== "deferred" && reviewAfter !== null) throw new Error("--review-after is only valid with --decision defer");

  const absoluteProposalPath = proposalPath(target, proposalId);
  const proposal = await readJson(absoluteProposalPath);
  const validation = validateSkillProposal(proposal);
  if (!validation.valid) throw new Error(`Invalid Skill Proposal ${proposalId}: ${validation.errors.join("; ")}`);
  if (["approved", "rejected"].includes(proposal.status)) {
    if (proposal.status !== decisionStatus) throw new Error(`${proposalId} already has final decision ${proposal.status}`);
    return { proposal, authoring_work_item: proposal.authoring_work_item_id ? await readWorkItem(target, proposal.authoring_work_item_id) : null, idempotent: true };
  }

  let authoringWorkItem = null;
  if (decisionStatus === "approved") authoringWorkItem = await createSkillAuthoringWorkItem(target, proposal);
  const timestamp = new Date().toISOString();
  const decided = {
    ...proposal,
    status: decisionStatus,
    updated_at: timestamp,
    updated_by: principalId,
    decision: { status: decisionStatus, principal_id: principalId, reason, decided_at: timestamp, review_after: reviewAfter },
    authoring_work_item_id: authoringWorkItem?.id ?? null
  };
  const decidedValidation = validateSkillProposal(decided);
  if (!decidedValidation.valid) throw new Error(`Invalid Skill Proposal decision: ${decidedValidation.errors.join("; ")}`);

  const indexPath = path.join(target, LEARNING_INDEX_RELATIVE_PATH);
  const index = migrateLearningIndexDocument(await readLearningIndex(target));
  const entryIndex = index.entries.findIndex((entry) => entry.id === proposal.source_learning_id);
  if (entryIndex < 0) throw new Error(`Learning entry not found: ${proposal.source_learning_id}`);
  const updatedIndex = structuredClone(index);
  updatedIndex.entries[entryIndex] = {
    ...updatedIndex.entries[entryIndex],
    updated_at: timestamp,
    promotion: {
      target: "skill",
      status: decisionStatus === "approved" ? "accepted" : decisionStatus,
      reference: proposal.path,
      proposal_id: proposal.id,
      review_after: reviewAfter,
      work_item_id: authoringWorkItem?.id ?? null
    }
  };
  const indexValidation = validateLearningIndex(updatedIndex);
  if (!indexValidation.valid) throw new Error(`Invalid Skill Proposal decision update: ${indexValidation.errors.join("; ")}`);
  const [beforeProposal, beforeIndex] = await Promise.all([fs.readFile(absoluteProposalPath), fs.readFile(indexPath)]);
  try {
    await atomicWrite(absoluteProposalPath, formatJson(decided));
    await atomicWrite(indexPath, formatJson(updatedIndex));
    await appendEvent(target, {
      timestamp,
      event_type: "skill_proposal_decided",
      actor: principalId,
      work_item_id: proposal.review_work_item_id,
      proposal_id: proposal.id,
      decision: decisionStatus,
      authoring_work_item_id: authoringWorkItem?.id ?? null,
      refs: [proposal.path, LEARNING_INDEX_RELATIVE_PATH, ...(authoringWorkItem ? [`.ai-org/work-items/${authoringWorkItem.id}.json`] : [])]
    });
  } catch (error) {
    await Promise.all([
      atomicWrite(absoluteProposalPath, beforeProposal).catch(() => {}),
      atomicWrite(indexPath, beforeIndex).catch(() => {})
    ]);
    throw error;
  }
  return { proposal: decided, authoring_work_item: authoringWorkItem, idempotent: false };
}

export async function readLearningIndex(target) {
  return readJson(path.join(target, LEARNING_INDEX_RELATIVE_PATH));
}

export async function ensureLearningIndex(target) {
  const indexPath = path.join(target, LEARNING_INDEX_RELATIVE_PATH);
  if (await pathExists(indexPath)) return { path: indexPath, created: false, afterHash: null };
  const content = formatJson(emptyLearningIndex());
  try {
    await atomicCreate(indexPath, content);
    return { path: indexPath, created: true, afterHash: sha256(content) };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return { path: indexPath, created: false, afterHash: null };
  }
}

export function summarizeLearningIndex(index) {
  const entries = Array.isArray(index?.entries) ? index.entries : [];
  const indexValidation = validateLearningIndex(index);
  const candidates = indexValidation.valid
    ? buildSkillPromotionCandidates(migrateLearningIndexDocument(index))
    : { summary: { eligible: 0, approval_pending: 0, review_due: 0, authoring_created: 0 } };
  return {
    total: entries.length,
    lessons: entries.filter((entry) => entry.kind === "lesson").length,
    practices: entries.filter((entry) => entry.kind === "practice").length,
    candidates: entries.filter((entry) => entry.status === "candidate").length,
    validated: entries.filter((entry) => entry.status === "validated").length,
    active: entries.filter((entry) => entry.status === "active").length,
    deprecated: entries.filter((entry) => entry.status === "deprecated").length,
    revalidation_due: entries.filter((entry) => ["due", "overdue"].includes(revalidationSignal(v2Entry(entry)))).length,
    contradicted: entries.filter((entry) => revalidationSignal(v2Entry(entry)) === "contradicted").length,
    skill_candidates: candidates.summary.eligible,
    skill_proposals_pending: candidates.summary.approval_pending,
    skill_proposal_reviews_due: candidates.summary.review_due,
    skill_authoring_created: candidates.summary.authoring_created,
    entries
  };
}
