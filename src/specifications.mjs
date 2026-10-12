import path from "node:path";
import { atomicCreate, formatJson, pathExists, readJson, sha256, sha256File } from "./files.mjs";

export const SPEC_INDEX_RELATIVE_PATH = ".ai-org/project/spec-index.json";

const ADOPTION_PROFILES = ["federated", "hybrid", "temple-native"];
const DELIVERY_METHODS = ["contract-guided-iterative"];
const SPEC_KINDS = [
  "product_charter",
  "product_requirements",
  "feature_spec",
  "ux_flow",
  "ui_contract",
  "api_contract",
  "technical_design"
];
const AUTHORITIES = ["temple_native", "authoritative_external", "derived_projection", "legacy_unverified"];
const STATUSES = ["draft", "approved", "superseded", "archived"];
const SOURCE_KINDS = ["repository", "external"];
const SPEC_ID_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9][A-Z0-9._-]*)+$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const REFERENCE_FIELDS = {
  spec_refs: new Set(["product_charter", "product_requirements", "feature_spec"]),
  ux_refs: new Set(["ux_flow"]),
  ui_refs: new Set(["ui_contract"]),
  contract_refs: new Set(["api_contract", "technical_design"])
};
const INDEX_KEYS = new Set(["schema_version", "adoption_profile", "delivery_method", "entries"]);
const ENTRY_KEYS = new Set([
  "id",
  "kind",
  "title",
  "authority",
  "status",
  "revision",
  "source",
  "owner_position",
  "approved_by",
  "approved_at",
  "approval_ref",
  "source_refs",
  "related_work_items",
  "updated_at"
]);
const SOURCE_KEYS = new Set(["kind", "location", "system", "content_sha256"]);
const REVISION_REFERENCE_KEYS = new Set(["id", "revision"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableString(value) {
  return value === null || isNonEmptyString(value);
}

function isIsoTimestamp(value) {
  return isNonEmptyString(value) && ISO_TIMESTAMP_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

function isSafeRepositoryLocation(location) {
  return (
    isNonEmptyString(location) &&
    !path.isAbsolute(location) &&
    !path.win32.isAbsolute(location) &&
    !location.includes("\\") &&
    location !== "." &&
    path.posix.normalize(location) === location &&
    !location.startsWith("../")
  );
}

function isExternalUrl(location) {
  if (!isNonEmptyString(location)) return false;
  try {
    const url = new URL(location);
    return (url.protocol === "https:" || url.protocol === "http:") && isNonEmptyString(url.hostname);
  } catch {
    return false;
  }
}

function validateStringArray(value, label, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return [];
  }
  const strings = [];
  for (const [index, entry] of value.entries()) {
    if (!isNonEmptyString(entry)) errors.push(`${label}[${index}] must be a non-empty string`);
    else strings.push(entry);
  }
  return strings;
}

function validateRevisionReferences(value, label, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return [];
  }
  const references = [];
  const seen = new Set();
  for (const [index, reference] of value.entries()) {
    if (!isObject(reference) || !isNonEmptyString(reference.id) || !isNonEmptyString(reference.revision)) {
      errors.push(`${label}[${index}] must contain non-empty id and revision strings`);
      continue;
    }
    const unknownKeys = Object.keys(reference).filter((key) => !REVISION_REFERENCE_KEYS.has(key));
    if (unknownKeys.length > 0) errors.push(`${label}[${index}] has unknown properties: ${unknownKeys.join(", ")}`);
    if (!SPEC_ID_PATTERN.test(reference.id)) {
      errors.push(`${label}[${index}].id must use a stable uppercase specification ID`);
      continue;
    }
    if (seen.has(reference.id)) {
      errors.push(`${label} contains duplicate reference: ${reference.id}`);
      continue;
    }
    seen.add(reference.id);
    references.push({ id: reference.id, revision: reference.revision });
  }
  return references;
}

function zeroCounts(values) {
  return Object.fromEntries(values.map((value) => [value, 0]));
}

export function emptySpecIndex() {
  return {
    schema_version: "temple.spec-index/v1",
    adoption_profile: "hybrid",
    delivery_method: "contract-guided-iterative",
    entries: []
  };
}

export async function ensureSpecIndex(target) {
  const specIndexPath = path.join(target, SPEC_INDEX_RELATIVE_PATH);
  let created = false;
  let afterHash = null;
  if (!(await pathExists(specIndexPath))) {
    const content = formatJson(emptySpecIndex());
    try {
      await atomicCreate(specIndexPath, content);
      created = true;
      afterHash = sha256(content);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  return { path: specIndexPath, created, afterHash };
}

export async function readSpecIndex(target) {
  return readJson(path.join(target, SPEC_INDEX_RELATIVE_PATH));
}

export function validateSpecIndex(document, positionIds = null) {
  const errors = [];
  const warnings = [];
  if (!isObject(document)) return { valid: false, errors: ["spec index must be an object"], warnings };
  const unknownIndexKeys = Object.keys(document).filter((key) => !INDEX_KEYS.has(key));
  if (unknownIndexKeys.length > 0) errors.push(`spec index has unknown properties: ${unknownIndexKeys.join(", ")}`);

  if (document.schema_version !== "temple.spec-index/v1") {
    errors.push("schema_version must be temple.spec-index/v1");
  }
  if (!ADOPTION_PROFILES.includes(document.adoption_profile)) {
    errors.push(`adoption_profile must be one of: ${ADOPTION_PROFILES.join(", ")}`);
  }
  if (!DELIVERY_METHODS.includes(document.delivery_method)) {
    errors.push(`delivery_method must be one of: ${DELIVERY_METHODS.join(", ")}`);
  }
  if (!Array.isArray(document.entries)) {
    errors.push("entries must be an array");
    return { valid: false, errors, warnings };
  }

  let knownPositions = null;
  if (positionIds !== null && positionIds !== undefined) {
    if (typeof positionIds === "string" || positionIds[Symbol.iterator] === undefined) {
      errors.push("positionIds must be an iterable of position IDs");
    } else {
      knownPositions = new Set(positionIds);
    }
  }

  const ids = new Set();
  const sourceRefsByEntry = [];
  for (const [index, entry] of document.entries.entries()) {
    const label = `entries[${index}]`;
    if (!isObject(entry)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    const unknownEntryKeys = Object.keys(entry).filter((key) => !ENTRY_KEYS.has(key));
    if (unknownEntryKeys.length > 0) errors.push(`${label} has unknown properties: ${unknownEntryKeys.join(", ")}`);

    if (!isNonEmptyString(entry.id)) errors.push(`${label}.id must be a non-empty string`);
    else if (!SPEC_ID_PATTERN.test(entry.id)) errors.push(`${label}.id must use a stable uppercase specification ID`);
    else if (ids.has(entry.id)) errors.push(`duplicate specification ID: ${entry.id}`);
    else ids.add(entry.id);

    if (!SPEC_KINDS.includes(entry.kind)) errors.push(`${label}.kind is invalid`);
    if (!isNonEmptyString(entry.title)) errors.push(`${label}.title must be a non-empty string`);
    if (!AUTHORITIES.includes(entry.authority)) errors.push(`${label}.authority is invalid`);
    if (!STATUSES.includes(entry.status)) errors.push(`${label}.status is invalid`);
    if (!isNonEmptyString(entry.revision)) errors.push(`${label}.revision must be a non-empty string`);

    if (!isObject(entry.source)) {
      errors.push(`${label}.source must be an object`);
    } else {
      const unknownSourceKeys = Object.keys(entry.source).filter((key) => !SOURCE_KEYS.has(key));
      if (unknownSourceKeys.length > 0) errors.push(`${label}.source has unknown properties: ${unknownSourceKeys.join(", ")}`);
      if (!SOURCE_KINDS.includes(entry.source.kind)) errors.push(`${label}.source.kind is invalid`);
      if (!isNonEmptyString(entry.source.location)) errors.push(`${label}.source.location must be a non-empty string`);
      if (!isNonEmptyString(entry.source.system)) errors.push(`${label}.source.system must be a non-empty string`);
      if (entry.source.content_sha256 !== null && !SHA256_PATTERN.test(entry.source.content_sha256 ?? "")) {
        errors.push(`${label}.source.content_sha256 must be a SHA-256 digest or null`);
      }
      if (entry.source.kind === "repository" && !isSafeRepositoryLocation(entry.source.location)) {
        errors.push(`${label}.source.location must be a safe repository-relative path`);
      }
      if (entry.source.kind === "external" && !isExternalUrl(entry.source.location)) {
        errors.push(`${label}.source.location must be an HTTP(S) URL for an external source`);
      }
      if (entry.authority === "temple_native" && entry.source.kind !== "repository") {
        errors.push(`${label} temple_native authority requires a repository source`);
      }
      if (entry.authority === "authoritative_external" && entry.source.kind !== "external") {
        errors.push(`${label} authoritative_external authority requires an external source`);
      }
      if (entry.authority === "derived_projection" && entry.source.kind !== "repository") {
        errors.push(`${label} derived_projection authority requires a repository source`);
      }
      if (
        entry.authority === "temple_native" &&
        entry.status === "approved" &&
        !SHA256_PATTERN.test(entry.source.content_sha256 ?? "")
      ) {
        errors.push(`${label} approved temple_native authority requires source.content_sha256`);
      }
    }

    if (!isNonEmptyString(entry.owner_position)) {
      errors.push(`${label}.owner_position must be a non-empty string`);
    } else if (knownPositions && !knownPositions.has(entry.owner_position)) {
      errors.push(`${label}.owner_position is unknown: ${entry.owner_position}`);
    }

    if (!isNullableString(entry.approved_by)) errors.push(`${label}.approved_by must be a non-empty string or null`);
    if (!isNullableString(entry.approved_at)) errors.push(`${label}.approved_at must be a non-empty string or null`);
    if (entry.approved_at !== null && !isIsoTimestamp(entry.approved_at)) {
      errors.push(`${label}.approved_at must be an ISO 8601 UTC timestamp or null`);
    }
    if (!isNullableString(entry.approval_ref)) errors.push(`${label}.approval_ref must be a non-empty string or null`);
    if (
      entry.status === "approved" &&
      (!isNonEmptyString(entry.approved_by) || !isIsoTimestamp(entry.approved_at) || !isNonEmptyString(entry.approval_ref))
    ) {
      errors.push(`${label} approved status requires approved_by, approved_at, and approval_ref`);
    }
    if (entry.authority === "legacy_unverified" && entry.status === "approved") {
      errors.push(`${label} legacy_unverified authority cannot be approved`);
    }
    if (entry.authority === "derived_projection" && !["draft", "superseded", "archived"].includes(entry.status)) {
      errors.push(`${label} derived_projection authority must be draft, superseded, or archived`);
    }

    const sourceRefs = validateRevisionReferences(entry.source_refs, `${label}.source_refs`, errors);
    sourceRefsByEntry.push({ id: entry.id, label, refs: sourceRefs });
    validateStringArray(entry.related_work_items, `${label}.related_work_items`, errors);
    if (entry.authority === "derived_projection" && sourceRefs.length === 0) {
      errors.push(`${label} derived_projection authority requires source_refs`);
    }
    if (!isNonEmptyString(entry.updated_at)) errors.push(`${label}.updated_at must be a non-empty string`);
  }

  const entriesById = new Map(document.entries.filter(isObject).map((entry) => [entry.id, entry]));
  for (const { id, label, refs } of sourceRefsByEntry) {
    for (const ref of refs) {
      if (ref.id === id) errors.push(`${label}.source_refs cannot reference itself: ${ref.id}`);
      else if (!ids.has(ref.id)) errors.push(`${label}.source_refs references unknown specification: ${ref.id}`);
      else if (
        entriesById.get(id)?.authority === "derived_projection" &&
        !["temple_native", "authoritative_external"].includes(entriesById.get(ref.id)?.authority)
      ) {
        errors.push(`${label}.source_refs must cite a canonical authority: ${ref.id}`);
      } else if (entriesById.get(ref.id)?.revision !== ref.revision) {
        warnings.push(
          `${label}.source_refs revision ${ref.revision} is stale; ${ref.id} is ${entriesById.get(ref.id)?.revision}`
        );
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function summarizeSpecIndex(document) {
  const entries = Array.isArray(document?.entries) ? document.entries : [];
  const byKind = zeroCounts(SPEC_KINDS);
  const byAuthority = zeroCounts(AUTHORITIES);
  const byStatus = zeroCounts(STATUSES);
  const bySourceKind = zeroCounts(SOURCE_KINDS);
  let approvedEntries = 0;

  for (const entry of entries) {
    if (Object.hasOwn(byKind, entry?.kind)) byKind[entry.kind] += 1;
    if (Object.hasOwn(byAuthority, entry?.authority)) byAuthority[entry.authority] += 1;
    if (Object.hasOwn(byStatus, entry?.status)) byStatus[entry.status] += 1;
    if (Object.hasOwn(bySourceKind, entry?.source?.kind)) bySourceKind[entry.source.kind] += 1;
    if (entry?.status === "approved") approvedEntries += 1;
  }

  return {
    schema_version: document?.schema_version ?? null,
    adoption_profile: document?.adoption_profile ?? null,
    delivery_method: document?.delivery_method ?? null,
    total_entries: entries.length,
    approved_entries: approvedEntries,
    by_kind: byKind,
    by_authority: byAuthority,
    by_status: byStatus,
    by_source_kind: bySourceKind
  };
}

export async function validateRepositorySpecSources(target, document, entryIds = null) {
  const errors = [];
  const selectedIds = entryIds === null ? null : new Set(entryIds);
  for (const entry of Array.isArray(document?.entries) ? document.entries : []) {
    if (selectedIds && !selectedIds.has(entry?.id)) continue;
    if (entry?.source?.kind !== "repository" || !isSafeRepositoryLocation(entry.source.location)) continue;
    const sourcePath = path.join(target, entry.source.location);
    if (!(await pathExists(sourcePath))) {
      errors.push(`${entry.id}:${entry.source.location} is missing`);
      continue;
    }
    if (SHA256_PATTERN.test(entry.source.content_sha256 ?? "")) {
      const actual = await sha256File(sourcePath);
      if (actual !== entry.source.content_sha256) {
        errors.push(`${entry.id}:${entry.source.location} content does not match source.content_sha256`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function evaluateWorkItemSpecRefs(item, index) {
  const errors = [];
  const warnings = [];
  const resolvedRefs = [];
  let staleCount = 0;
  let unapprovedCount = 0;

  if (!isObject(item)) {
    return {
      valid: false,
      errors: ["work item must be an object"],
      warnings,
      stale_count: staleCount,
      unapproved_count: unapprovedCount,
      resolved_refs: resolvedRefs
    };
  }
  if (!isObject(index) || !Array.isArray(index.entries)) {
    return {
      valid: false,
      errors: ["spec index entries must be an array"],
      warnings,
      stale_count: staleCount,
      unapproved_count: unapprovedCount,
      resolved_refs: resolvedRefs
    };
  }

  const entriesById = new Map();
  for (const [entryIndex, entry] of index.entries.entries()) {
    if (!isObject(entry) || !isNonEmptyString(entry.id)) {
      errors.push(`spec index entry ${entryIndex} has no valid ID`);
      continue;
    }
    if (entriesById.has(entry.id)) errors.push(`spec index contains duplicate ID: ${entry.id}`);
    else entriesById.set(entry.id, entry);
  }

  for (const [field, allowedKinds] of Object.entries(REFERENCE_FIELDS)) {
    const refs = item[field] ?? [];
    if (!Array.isArray(refs)) {
      errors.push(`${field} must be an array`);
      continue;
    }
    const seen = new Set();
    for (const [refIndex, ref] of refs.entries()) {
      const label = `${field}[${refIndex}]`;
      if (!isObject(ref) || !isNonEmptyString(ref.id) || !isNonEmptyString(ref.revision)) {
        errors.push(`${label} must contain non-empty id and revision strings`);
        continue;
      }
      if (seen.has(ref.id)) {
        errors.push(`${field} contains duplicate reference: ${ref.id}`);
        continue;
      }
      seen.add(ref.id);
      const entry = entriesById.get(ref.id);
      if (!entry) {
        errors.push(`${label} references unknown specification: ${ref.id}`);
        continue;
      }
      if (!allowedKinds.has(entry.kind)) {
        errors.push(`${label} category does not accept ${entry.kind}: ${ref.id}`);
        continue;
      }
      if (entry.authority === "derived_projection") {
        errors.push(`${label} cannot use derived projection as a canonical Work Item reference: ${ref.id}`);
        continue;
      }
      const unavailable = ["superseded", "archived"].includes(entry.status);
      const stale = entry.revision !== ref.revision || unavailable;
      if (stale) {
        staleCount += 1;
        warnings.push(
          unavailable
            ? `${label} references ${entry.status} specification ${ref.id}`
            : `${label} revision ${ref.revision} is stale; current revision is ${entry.revision}`
        );
      }
      if (entry.authority === "legacy_unverified") {
        warnings.push(`${label} references legacy-unverified specification ${ref.id}`);
      }
      const approved = entry.status === "approved";
      if (!approved) unapprovedCount += 1;
      resolvedRefs.push({
        field,
        id: ref.id,
        revision: ref.revision,
        current_revision: entry.revision,
        kind: entry.kind,
        status: entry.status,
        authority: entry.authority,
        approved,
        stale
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stale_count: staleCount,
    unapproved_count: unapprovedCount,
    resolved_refs: resolvedRefs
  };
}
