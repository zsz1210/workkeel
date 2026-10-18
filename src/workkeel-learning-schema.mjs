import { isWorkItemId } from "./ids.mjs";

// Pure learning record validators shared by the native monitor and the legacy store.
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

export const LEARNING_ID = /^(LESSON|PRACTICE)-[0-9]{4,}$/;
export const SKILL_PROPOSAL_ID = /^SKILL-PROPOSAL-[0-9]{4,}$/;
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const REVALIDATION_RESULTS = ["confirmed", "narrowed", "contradicted"];
export const SKILL_PROPOSAL_STATUSES = ["proposed", "approved", "rejected", "deferred"];
export const SKILL_RISK_CLASSES = ["low", "standard", "high", "critical"];

export function emptyLearningIndex() {
  return { schema_version: LEARNING_INDEX_SCHEMA, entries: [] };
}

export function uniqueStrings(values) {
  return (
    Array.isArray(values) &&
    values.every((value) => typeof value === "string" && value.trim().length > 0) &&
    new Set(values).size === values.length
  );
}

export function validDate(value, { nullable = false } = {}) {
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

export function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function proposalRelativePath(proposalId) {
  return `${SKILL_PROPOSALS_RELATIVE_PATH}/${proposalId}.json`;
}

export function optionalNonEmptyString(value) {
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
