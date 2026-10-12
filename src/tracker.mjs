import fs from "node:fs/promises";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { atomicCreate, atomicWrite, formatJson, pathExists, readJson, sha256 } from "./files.mjs";
import { isWorkItemId } from "./ids.mjs";
import { appendEvent, loadProjectContext, resolveActor, uniqueStrings } from "./project.mjs";
import { readWorkItem } from "./work-items.mjs";
import { isLegacyConcludedItem } from "./workflow.mjs";

const execFile = promisify(execFileCallback);

export const TRACKER_CONFIG_RELATIVE_PATH = ".ai-org/project/tracker.json";
export const TRACKER_VIEW_RELATIVE_PATH = ".ai-org/views/tracker.json";

export const TRACKER_PROFILES = ["repository-only", "linked-tracker", "externally-planned"];
export const TRACKER_GRANULARITIES = ["parent-only", "team-visible", "full"];
export const TRACKER_PROVIDER_KINDS = ["github", "jira", "generic"];
export const TRACKER_VISIBILITIES = ["internal", "team-visible"];
export const TRACKER_WRITE_POLICIES = ["disabled", "plan-only", "approved"];

const PROVIDER_STATUSES = ["active", "paused"];
const READ_POLICIES = ["manual", "live"];
const TRACKER_ROLES = ["primary", "supporting"];
const OBSERVATION_STATUSES = ["open", "in_progress", "blocked", "done", "cancelled", "unknown"];
const RECONCILIATION_RESOLUTIONS = ["acknowledge", "keep-temple", "accept-external", "defer"];
const PROVIDER_ID = /^[a-z][a-z0-9-]*$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const ROOT_KEYS = new Set([
  "schema_version",
  "profile",
  "sync_granularity",
  "default_provider_id",
  "providers",
  "field_ownership",
  "updated_at",
  "updated_by"
]);
const PROVIDER_KEYS = new Set([
  "id",
  "kind",
  "status",
  "project",
  "base_url",
  "read_policy",
  "write_policy"
]);
const OWNERSHIP_KEYS = new Set(["temple", "external", "negotiated"]);
const TRACKER_REF_KEYS = new Set(["provider_id", "item_id", "url", "role"]);
const TRACKER_RECONCILIATION_KEYS = new Set([
  "provider_id",
  "item_id",
  "observation_revision",
  "resolution",
  "recorded_at",
  "recorded_by",
  "evidence_ref",
  "external_write_performed"
]);
const TRACKER_PLAN_KEYS = new Set([
  "schema_version",
  "generated_at",
  "work_item_id",
  "provider_id",
  "provider_kind",
  "item_id",
  "observation_revision",
  "write_policy",
  "actions",
  "conflict_count",
  "review_count",
  "external_write_performed"
]);
const TRACKER_ACTION_KEYS = new Set([
  "id",
  "field",
  "owner",
  "direction",
  "severity",
  "temple_value",
  "external_value",
  "automatic",
  "reason"
]);
const TRACKER_ARTIFACT_KEYS = new Set([
  "schema_version",
  "recorded_at",
  "recorded_by",
  "work_item_id",
  "provider_id",
  "item_id",
  "observation_revision",
  "resolution",
  "reason",
  "external_write_performed",
  "observation",
  "plan"
]);
const OBSERVATION_KEYS = new Set([
  "schema_version",
  "provider_id",
  "provider_kind",
  "item_id",
  "url",
  "observed_at",
  "external_updated_at",
  "revision",
  "title",
  "status",
  "fields",
  "source"
]);
const OBSERVATION_FIELD_KEYS = new Set([
  "priority",
  "iteration",
  "estimate",
  "due_date",
  "business_assignee",
  "labels"
]);
const SUPPORTED_FIELDS = new Set([
  "lifecycle_state",
  "specification_refs",
  "interface_contracts",
  "gate_evidence",
  "claim",
  "tested_revision",
  "release_decision",
  "priority",
  "iteration",
  "estimate",
  "due_date",
  "business_assignee",
  "labels",
  "title",
  "parent",
  "dependencies"
]);
const PROTECTED_TEMPLE_FIELDS = [
  "lifecycle_state",
  "specification_refs",
  "interface_contracts",
  "gate_evidence",
  "claim",
  "tested_revision",
  "release_decision"
];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoTimestamp(value) {
  return isNonEmptyString(value) && ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}

function isDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function isHttpsUrl(value) {
  if (!isNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && isNonEmptyString(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function unknownKeys(document, allowed) {
  return isObject(document) ? Object.keys(document).filter((key) => !allowed.has(key)) : [];
}

function validateStringArray(value, label, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return [];
  }
  const seen = new Set();
  const result = [];
  for (const [index, entry] of value.entries()) {
    if (!isNonEmptyString(entry)) {
      errors.push(`${label}[${index}] must be a non-empty string`);
    } else if (!SUPPORTED_FIELDS.has(entry)) {
      errors.push(`${label}[${index}] is not a supported tracker field: ${entry}`);
    } else if (seen.has(entry)) {
      errors.push(`${label} contains duplicate field: ${entry}`);
    } else {
      seen.add(entry);
      result.push(entry);
    }
  }
  return result;
}

export function emptyTrackerConfig() {
  return {
    schema_version: "temple.tracker/v1",
    profile: "repository-only",
    sync_granularity: "team-visible",
    default_provider_id: null,
    providers: [],
    field_ownership: {
      temple: [...PROTECTED_TEMPLE_FIELDS],
      external: ["priority", "iteration", "estimate", "due_date", "business_assignee", "labels"],
      negotiated: ["title", "parent", "dependencies"]
    },
    updated_at: null,
    updated_by: null
  };
}

export async function ensureTrackerConfig(target) {
  const configPath = path.join(target, TRACKER_CONFIG_RELATIVE_PATH);
  let created = false;
  let afterHash = null;
  if (!(await pathExists(configPath))) {
    const content = formatJson(emptyTrackerConfig());
    try {
      await atomicCreate(configPath, content);
      created = true;
      afterHash = sha256(content);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  return { path: configPath, created, afterHash };
}

export async function readTrackerConfig(target) {
  return readJson(path.join(target, TRACKER_CONFIG_RELATIVE_PATH));
}

export function validateTrackerConfig(document) {
  const errors = [];
  const warnings = [];
  if (!isObject(document)) return { valid: false, errors: ["tracker config must be an object"], warnings };
  const rootUnknown = unknownKeys(document, ROOT_KEYS);
  if (rootUnknown.length) errors.push(`tracker config has unknown properties: ${rootUnknown.join(", ")}`);
  if (document.schema_version !== "temple.tracker/v1") errors.push("schema_version must be temple.tracker/v1");
  if (!TRACKER_PROFILES.includes(document.profile)) {
    errors.push(`profile must be one of: ${TRACKER_PROFILES.join(", ")}`);
  }
  if (!TRACKER_GRANULARITIES.includes(document.sync_granularity)) {
    errors.push(`sync_granularity must be one of: ${TRACKER_GRANULARITIES.join(", ")}`);
  }
  if (!Array.isArray(document.providers)) {
    errors.push("providers must be an array");
  }

  const providerIds = new Set();
  for (const [index, provider] of (document.providers ?? []).entries()) {
    const label = `providers[${index}]`;
    if (!isObject(provider)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    const providerUnknown = unknownKeys(provider, PROVIDER_KEYS);
    if (providerUnknown.length) errors.push(`${label} has unknown properties: ${providerUnknown.join(", ")}`);
    if (!PROVIDER_ID.test(provider.id ?? "")) errors.push(`${label}.id must use lowercase letters, digits, and hyphens`);
    else if (providerIds.has(provider.id)) errors.push(`duplicate tracker provider ID: ${provider.id}`);
    else providerIds.add(provider.id);
    if (!TRACKER_PROVIDER_KINDS.includes(provider.kind)) errors.push(`${label}.kind is invalid`);
    if (!PROVIDER_STATUSES.includes(provider.status)) errors.push(`${label}.status is invalid`);
    if (!isNonEmptyString(provider.project)) errors.push(`${label}.project is required`);
    if (!isHttpsUrl(provider.base_url)) errors.push(`${label}.base_url must be an HTTPS URL without credentials`);
    if (!READ_POLICIES.includes(provider.read_policy)) errors.push(`${label}.read_policy is invalid`);
    if (!TRACKER_WRITE_POLICIES.includes(provider.write_policy)) errors.push(`${label}.write_policy is invalid`);
    if (provider.kind === "github" && !/^[^/\s]+\/[^/\s]+$/.test(provider.project ?? "")) {
      errors.push(`${label}.project must use owner/repository for GitHub`);
    }
  }

  if (document.default_provider_id !== null && !isNonEmptyString(document.default_provider_id)) {
    errors.push("default_provider_id must be a provider ID or null");
  } else if (document.default_provider_id !== null && !providerIds.has(document.default_provider_id)) {
    errors.push(`default_provider_id references unknown provider: ${document.default_provider_id}`);
  }

  if (document.profile === "repository-only") {
    if ((document.providers ?? []).length > 0) errors.push("repository-only profile cannot configure external providers");
    if (document.default_provider_id !== null) errors.push("repository-only profile requires default_provider_id null");
  } else {
    if ((document.providers ?? []).length === 0) errors.push(`${document.profile} profile requires at least one provider`);
    if (!document.default_provider_id) errors.push(`${document.profile} profile requires default_provider_id`);
    const defaultProvider = (document.providers ?? []).find((provider) => provider.id === document.default_provider_id);
    if (defaultProvider && defaultProvider.status !== "active") errors.push("default tracker provider must be active");
  }

  if (!isObject(document.field_ownership)) {
    errors.push("field_ownership must be an object");
  } else {
    const ownershipUnknown = unknownKeys(document.field_ownership, OWNERSHIP_KEYS);
    if (ownershipUnknown.length) errors.push(`field_ownership has unknown properties: ${ownershipUnknown.join(", ")}`);
    const ownership = {};
    for (const owner of OWNERSHIP_KEYS) {
      ownership[owner] = validateStringArray(document.field_ownership[owner], `field_ownership.${owner}`, errors);
    }
    const allFields = Object.values(ownership).flat();
    const duplicates = [...new Set(allFields.filter((field, index) => allFields.indexOf(field) !== index))];
    if (duplicates.length) errors.push(`tracker fields have multiple owners: ${duplicates.join(", ")}`);
    const missingProtected = PROTECTED_TEMPLE_FIELDS.filter((field) => !ownership.temple.includes(field));
    if (missingProtected.length) errors.push(`Temple-owned fields cannot be delegated: ${missingProtected.join(", ")}`);
  }

  if (document.updated_at !== null && !isIsoTimestamp(document.updated_at)) {
    errors.push("updated_at must be an ISO 8601 UTC timestamp or null");
  }
  if (document.updated_by !== null && !isNonEmptyString(document.updated_by)) {
    errors.push("updated_by must be a non-empty string or null");
  }
  if ((document.providers ?? []).some((provider) => provider.write_policy === "approved")) {
    warnings.push("At least one provider permits approved write-back; every external mutation still requires explicit authorization");
  }
  return { valid: errors.length === 0, errors, warnings };
}

function providerById(config, providerId) {
  return (config.providers ?? []).find((provider) => provider.id === providerId);
}

function providerUrlError(provider, itemId, value) {
  if (!provider || !isHttpsUrl(value)) return null;
  const expected = new URL(provider.base_url);
  const actual = new URL(value);
  if (expected.origin !== actual.origin) return `URL origin must match provider base_url ${expected.origin}`;
  if (provider.kind === "github") {
    const issueNumber = normalizedIssueNumber(itemId);
    const expectedPath = `/${provider.project}/issues/${issueNumber}`;
    if (actual.pathname.replace(/\/$/, "") !== expectedPath) {
      return `GitHub URL must be ${expected.origin}${expectedPath}`;
    }
  }
  return null;
}

function requireValidTrackerConfig(config) {
  const validation = validateTrackerConfig(config);
  if (!validation.valid) throw new Error(`Invalid tracker config: ${validation.errors.join("; ")}`);
  return validation;
}

export async function configureTracker(target, options) {
  const context = await loadProjectContext(target);
  const current = await readTrackerConfig(target);
  requireValidTrackerConfig(current);
  const actor = resolveActor(context, "engineering_manager", options.actor);
  let providers = [...current.providers];
  if (options.providerId) {
    const id = String(options.providerId).trim();
    if (!PROVIDER_ID.test(id)) throw new Error("--provider-id must use lowercase letters, digits, and hyphens");
    const index = providers.findIndex((provider) => provider.id === id);
    const existing = index >= 0 ? providers[index] : null;
    const kind = options.providerKind ?? existing?.kind;
    const project = options.project ?? existing?.project;
    const baseUrl = options.baseUrl ?? existing?.base_url ?? (kind === "github" ? "https://github.com" : null);
    if (!kind || !project || !baseUrl) {
      throw new Error("A new tracker provider requires --provider-kind, --project, and --base-url (GitHub defaults to https://github.com)");
    }
    const provider = {
      id,
      kind,
      status: options.providerStatus ?? existing?.status ?? "active",
      project,
      base_url: baseUrl,
      read_policy: options.readPolicy ?? existing?.read_policy ?? (kind === "github" ? "live" : "manual"),
      write_policy: options.writePolicy ?? existing?.write_policy ?? "plan-only"
    };
    if (index >= 0) providers[index] = provider;
    else providers.push(provider);
  }
  const profile = options.profile ?? current.profile;
  const defaultProviderId =
    options.defaultProviderId === undefined
      ? current.default_provider_id ?? (profile === "repository-only" ? null : options.providerId ?? null)
      : options.defaultProviderId;
  const timestamp = new Date().toISOString();
  const updated = {
    ...current,
    profile,
    sync_granularity: options.syncGranularity ?? current.sync_granularity,
    default_provider_id: defaultProviderId,
    providers,
    updated_at: timestamp,
    updated_by: actor
  };
  requireValidTrackerConfig(updated);
  await atomicWrite(path.join(target, TRACKER_CONFIG_RELATIVE_PATH), formatJson(updated));
  await appendEvent(target, {
    timestamp,
    event_type: "tracker_configuration_updated",
    actor,
    profile: updated.profile,
    provider_id: options.providerId ?? null,
    refs: [TRACKER_CONFIG_RELATIVE_PATH]
  });
  return updated;
}

async function listWorkItems(target) {
  const directory = path.join(target, ".ai-org/work-items");
  if (!(await pathExists(directory))) return [];
  const items = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".json")) items.push(await readJson(path.join(directory, entry.name)));
  }
  return items;
}

export async function removeTrackerProvider(target, options) {
  const context = await loadProjectContext(target);
  const config = await readTrackerConfig(target);
  requireValidTrackerConfig(config);
  const providerId = String(options.providerId ?? "").trim();
  if (!providerById(config, providerId)) throw new Error(`Tracker provider not found: ${providerId || "missing"}`);
  const referencing = (await listWorkItems(target)).filter((item) =>
    (item.tracker_refs ?? []).some((reference) => reference.provider_id === providerId)
  );
  if (referencing.length) {
    throw new Error(`Cannot remove ${providerId}; referenced by Work Items: ${referencing.map((item) => item.id).join(", ")}`);
  }
  const actor = resolveActor(context, "engineering_manager", options.actor);
  const providers = config.providers.filter((provider) => provider.id !== providerId);
  const timestamp = new Date().toISOString();
  const updated = {
    ...config,
    providers,
    default_provider_id: config.default_provider_id === providerId ? providers[0]?.id ?? null : config.default_provider_id,
    profile: providers.length === 0 ? "repository-only" : config.profile,
    updated_at: timestamp,
    updated_by: actor
  };
  requireValidTrackerConfig(updated);
  await atomicWrite(path.join(target, TRACKER_CONFIG_RELATIVE_PATH), formatJson(updated));
  await appendEvent(target, {
    timestamp,
    event_type: "tracker_provider_removed",
    actor,
    provider_id: providerId,
    refs: [TRACKER_CONFIG_RELATIVE_PATH]
  });
  return updated;
}

function defaultTrackerVisibility(item) {
  return item.parent_work_item_id ? "internal" : "team-visible";
}

export function trackerVisibility(item) {
  return item.tracker_visibility ?? defaultTrackerVisibility(item);
}

export function validateWorkItemTrackerRefs(item, config) {
  const errors = [];
  const warnings = [];
  const visibility = trackerVisibility(item);
  if (!TRACKER_VISIBILITIES.includes(visibility)) errors.push(`${item.id}.tracker_visibility is invalid`);
  if (!Array.isArray(item.tracker_refs ?? [])) errors.push(`${item.id}.tracker_refs must be an array`);
  const refs = Array.isArray(item.tracker_refs) ? item.tracker_refs : [];
  if (visibility === "internal" && refs.length) errors.push(`${item.id} is internal and cannot have tracker_refs`);
  if (config.profile === "repository-only" && refs.length) errors.push(`${item.id} cannot link external items in repository-only profile`);
  if (config.profile !== "repository-only" && visibility === "team-visible" && refs.length === 0) {
    warnings.push(`${item.id} is team-visible but has no direct tracker reference`);
  }
  if (config.sync_granularity === "parent-only" && item.parent_work_item_id && visibility === "team-visible") {
    errors.push(`${item.id} is a child Work Item but parent-only tracker granularity is selected`);
  }
  if (config.sync_granularity === "full" && visibility === "internal") {
    warnings.push(`${item.id} is internal while full tracker granularity is selected`);
  }
  const seen = new Set();
  const primaryByProvider = new Set();
  for (const [index, reference] of refs.entries()) {
    const label = `${item.id}.tracker_refs[${index}]`;
    if (!isObject(reference)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    const refUnknown = unknownKeys(reference, TRACKER_REF_KEYS);
    if (refUnknown.length) errors.push(`${label} has unknown properties: ${refUnknown.join(", ")}`);
    if (!isNonEmptyString(reference.provider_id)) errors.push(`${label}.provider_id is required`);
    const provider = providerById(config, reference.provider_id);
    if (!provider) errors.push(`${label} references unknown provider: ${reference.provider_id}`);
    else if (provider.status !== "active") warnings.push(`${label} references paused provider: ${reference.provider_id}`);
    if (!isNonEmptyString(reference.item_id)) errors.push(`${label}.item_id is required`);
    if (!isHttpsUrl(reference.url)) errors.push(`${label}.url must be an HTTPS URL without credentials`);
    else {
      try {
        const urlError = providerUrlError(provider, reference.item_id, reference.url);
        if (urlError) errors.push(`${label}.${urlError}`);
      } catch (error) {
        errors.push(`${label}.${error.message}`);
      }
    }
    if (!TRACKER_ROLES.includes(reference.role)) errors.push(`${label}.role is invalid`);
    const key = `${reference.provider_id}:${reference.item_id}`;
    if (seen.has(key)) errors.push(`${item.id} contains duplicate tracker reference: ${key}`);
    seen.add(key);
    if (reference.role === "primary") {
      if (primaryByProvider.has(reference.provider_id)) {
        errors.push(`${item.id} has more than one primary tracker item for ${reference.provider_id}`);
      }
      primaryByProvider.add(reference.provider_id);
    }
  }
  if (!Array.isArray(item.tracker_reconciliations ?? [])) {
    errors.push(`${item.id}.tracker_reconciliations must be an array`);
  } else {
    for (const [index, reconciliation] of (item.tracker_reconciliations ?? []).entries()) {
      const label = `${item.id}.tracker_reconciliations[${index}]`;
      if (!isObject(reconciliation)) {
        errors.push(`${label} must be an object`);
        continue;
      }
      const reconciliationUnknown = unknownKeys(reconciliation, TRACKER_RECONCILIATION_KEYS);
      if (reconciliationUnknown.length) {
        errors.push(`${label} has unknown properties: ${reconciliationUnknown.join(", ")}`);
      }
      if (!PROVIDER_ID.test(reconciliation.provider_id ?? "")) errors.push(`${label}.provider_id is invalid`);
      if (!isNonEmptyString(reconciliation.item_id)) errors.push(`${label}.item_id is required`);
      if (!isNonEmptyString(reconciliation.observation_revision)) {
        errors.push(`${label}.observation_revision is required`);
      }
      if (!RECONCILIATION_RESOLUTIONS.includes(reconciliation.resolution)) {
        errors.push(`${label}.resolution is invalid`);
      }
      if (!isIsoTimestamp(reconciliation.recorded_at)) errors.push(`${label}.recorded_at is invalid`);
      if (!isNonEmptyString(reconciliation.recorded_by)) errors.push(`${label}.recorded_by is required`);
      if (
        !isNonEmptyString(reconciliation.evidence_ref) ||
        path.isAbsolute(reconciliation.evidence_ref) ||
        !reconciliation.evidence_ref.startsWith(".ai-org/artifacts/tracker-reconciliations/") ||
        reconciliation.evidence_ref.split(/[\\/]+/).includes("..")
      ) {
        errors.push(`${label}.evidence_ref must be a safe tracker reconciliation artifact path`);
      }
      if (reconciliation.external_write_performed !== false) {
        errors.push(`${label}.external_write_performed must be false in this release`);
      }
    }
  }
  return { valid: errors.length === 0, errors, warnings, visibility, refs };
}

export function validateTrackerMappings(config, items) {
  const errors = [];
  const warnings = [];
  const primaryMappings = new Map();
  for (const item of items) {
    const validation = validateWorkItemTrackerRefs(item, config);
    errors.push(...validation.errors);
    warnings.push(...validation.warnings);
    for (const reference of validation.refs.filter((entry) => entry?.role === "primary")) {
      const key = `${reference.provider_id}:${reference.item_id}`;
      if (primaryMappings.has(key)) {
        errors.push(`Primary tracker item ${key} is mapped to both ${primaryMappings.get(key)} and ${item.id}`);
      } else {
        primaryMappings.set(key, item.id);
      }
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

async function writeWorkItem(target, item) {
  if (!isWorkItemId(item.id)) throw new Error(`Invalid Work Item ID: ${item.id}`);
  await atomicWrite(path.join(target, ".ai-org/work-items", `${item.id}.json`), formatJson(item));
}

function actorForWorkItem(context, item, requestedActor) {
  return resolveActor(
    context,
    item.owner_position,
    requestedActor ?? (item.claim?.status === "active" ? item.claim.agent_id : undefined),
    item.claim?.status === "active" ? [item.claim.agent_id] : []
  );
}

export async function setTrackerVisibility(target, options) {
  const context = await loadProjectContext(target);
  const config = await readTrackerConfig(target);
  requireValidTrackerConfig(config);
  const item = await readWorkItem(target, options.workItemId);
  const visibility = String(options.visibility ?? "").trim();
  if (!TRACKER_VISIBILITIES.includes(visibility)) {
    throw new Error(`Tracker visibility must be one of: ${TRACKER_VISIBILITIES.join(", ")}`);
  }
  const updated = { ...item, tracker_visibility: visibility, updated_at: new Date().toISOString() };
  const validation = validateWorkItemTrackerRefs(updated, config);
  if (!validation.valid) throw new Error(`Invalid tracker visibility: ${validation.errors.join("; ")}`);
  const actor = actorForWorkItem(context, item, options.actor);
  await writeWorkItem(target, updated);
  await appendEvent(target, {
    timestamp: updated.updated_at,
    event_type: "work_item_tracker_visibility_changed",
    actor,
    work_item_id: item.id,
    visibility,
    refs: [`.ai-org/work-items/${item.id}.json`]
  });
  return updated;
}

export async function linkTrackerItem(target, options) {
  const context = await loadProjectContext(target);
  const config = await readTrackerConfig(target);
  requireValidTrackerConfig(config);
  if (config.profile === "repository-only") throw new Error("Configure linked-tracker or externally-planned before linking an item");
  const item = await readWorkItem(target, options.workItemId);
  if (trackerVisibility(item) !== "team-visible") {
    throw new Error(`${item.id} is internal; set tracker visibility to team-visible before linking`);
  }
  const providerId = String(options.providerId ?? config.default_provider_id ?? "").trim();
  const provider = providerById(config, providerId);
  if (!provider || provider.status !== "active") throw new Error(`Active tracker provider not found: ${providerId || "missing"}`);
  const reference = {
    provider_id: providerId,
    item_id:
      provider.kind === "github"
        ? normalizedIssueNumber(options.itemId)
        : String(options.itemId ?? "").trim(),
    url: String(options.url ?? "").trim(),
    role: options.role ?? "primary"
  };
  const existing = item.tracker_refs ?? [];
  const updatedRefs = [...existing.filter((entry) => !(entry.provider_id === providerId && entry.item_id === reference.item_id)), reference];
  const updated = { ...item, tracker_visibility: "team-visible", tracker_refs: updatedRefs, updated_at: new Date().toISOString() };
  const validation = validateWorkItemTrackerRefs(updated, config);
  if (!validation.valid) throw new Error(`Invalid tracker link: ${validation.errors.join("; ")}`);
  const allItems = (await listWorkItems(target)).map((candidate) => (candidate.id === item.id ? updated : candidate));
  const mappings = validateTrackerMappings(config, allItems);
  if (!mappings.valid) throw new Error(`Invalid tracker mapping: ${mappings.errors.join("; ")}`);
  const actor = actorForWorkItem(context, item, options.actor);
  await writeWorkItem(target, updated);
  await appendEvent(target, {
    timestamp: updated.updated_at,
    event_type: "work_item_tracker_linked",
    actor,
    work_item_id: item.id,
    provider_id: providerId,
    external_item_id: reference.item_id,
    role: reference.role,
    refs: [`.ai-org/work-items/${item.id}.json`, reference.url]
  });
  return { item: updated, reference };
}

export async function unlinkTrackerItem(target, options) {
  const context = await loadProjectContext(target);
  const config = await readTrackerConfig(target);
  requireValidTrackerConfig(config);
  const item = await readWorkItem(target, options.workItemId);
  const providerId = String(options.providerId ?? config.default_provider_id ?? "").trim();
  const provider = providerById(config, providerId);
  if (!provider) throw new Error(`Tracker provider not found: ${providerId || "missing"}`);
  const itemId =
    provider.kind === "github"
      ? normalizedIssueNumber(options.itemId)
      : String(options.itemId ?? "").trim();
  const existing = item.tracker_refs ?? [];
  const updatedRefs = existing.filter((entry) => !(entry.provider_id === providerId && entry.item_id === itemId));
  if (updatedRefs.length === existing.length) throw new Error(`Tracker link not found: ${providerId}:${itemId}`);
  const actor = actorForWorkItem(context, item, options.actor);
  const timestamp = new Date().toISOString();
  const updated = { ...item, tracker_refs: updatedRefs, updated_at: timestamp };
  await writeWorkItem(target, updated);
  await appendEvent(target, {
    timestamp,
    event_type: "work_item_tracker_unlinked",
    actor,
    work_item_id: item.id,
    provider_id: providerId,
    external_item_id: itemId,
    refs: [`.ai-org/work-items/${item.id}.json`]
  });
  return updated;
}

export function validateTrackerObservation(document) {
  const errors = [];
  if (!isObject(document)) return { valid: false, errors: ["tracker observation must be an object"] };
  const observationUnknown = unknownKeys(document, OBSERVATION_KEYS);
  if (observationUnknown.length) errors.push(`tracker observation has unknown properties: ${observationUnknown.join(", ")}`);
  if (document.schema_version !== "temple.tracker-observation/v1") {
    errors.push("schema_version must be temple.tracker-observation/v1");
  }
  if (!PROVIDER_ID.test(document.provider_id ?? "")) errors.push("provider_id is invalid");
  if (!TRACKER_PROVIDER_KINDS.includes(document.provider_kind)) errors.push("provider_kind is invalid");
  if (!isNonEmptyString(document.item_id)) errors.push("item_id is required");
  if (!isHttpsUrl(document.url)) errors.push("url must be an HTTPS URL without credentials");
  if (!isIsoTimestamp(document.observed_at)) errors.push("observed_at must be an ISO 8601 UTC timestamp");
  if (document.external_updated_at !== null && !isIsoTimestamp(document.external_updated_at)) {
    errors.push("external_updated_at must be an ISO 8601 UTC timestamp or null");
  }
  if (!isNonEmptyString(document.revision)) errors.push("revision is required");
  if (!isNonEmptyString(document.title)) errors.push("title is required");
  if (!OBSERVATION_STATUSES.includes(document.status)) errors.push("status is invalid");
  if (!isObject(document.fields)) {
    errors.push("fields must be an object");
  } else {
    const fieldUnknown = unknownKeys(document.fields, OBSERVATION_FIELD_KEYS);
    if (fieldUnknown.length) errors.push(`fields has unknown properties: ${fieldUnknown.join(", ")}`);
    for (const field of ["priority", "iteration", "estimate", "due_date", "business_assignee"]) {
      if (document.fields[field] !== null && !isNonEmptyString(document.fields[field])) {
        errors.push(`fields.${field} must be a non-empty string or null`);
      }
    }
    if (
      document.fields.due_date !== null &&
      isNonEmptyString(document.fields.due_date) &&
      !isDateOnly(document.fields.due_date)
    ) {
      errors.push("fields.due_date must use YYYY-MM-DD or null");
    }
    if (!Array.isArray(document.fields.labels) || document.fields.labels.some((label) => !isNonEmptyString(label))) {
      errors.push("fields.labels must be an array of non-empty strings");
    }
  }
  if (!isObject(document.source) || !["live", "file"].includes(document.source.kind) || !isNonEmptyString(document.source.adapter)) {
    errors.push("source must contain kind live|file and a non-empty adapter");
  } else {
    const sourceUnknown = unknownKeys(document.source, new Set(["kind", "adapter"]));
    if (sourceUnknown.length) errors.push(`source has unknown properties: ${sourceUnknown.join(", ")}`);
  }
  return { valid: errors.length === 0, errors };
}

function normalizedIssueNumber(value) {
  const match = /^(?:#)?([1-9][0-9]*)$/.exec(String(value ?? "").trim());
  if (!match) throw new Error(`GitHub item ID must be an issue number: ${value ?? "missing"}`);
  return match[1];
}

async function executeGitHubApi(args) {
  return execFile("gh", args, { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
}

export function createGitHubTrackerAdapter(options = {}) {
  const execute = options.execute ?? executeGitHubApi;
  return {
    id: "github-issues-v1",
    kind: "github",
    async inspect(provider, itemId) {
      if (provider.kind !== "github") throw new Error(`GitHub adapter cannot inspect provider kind ${provider.kind}`);
      const issueNumber = normalizedIssueNumber(itemId);
      const endpoint = `repos/${provider.project}/issues/${issueNumber}`;
      const hostname = new URL(provider.base_url).hostname;
      const args = ["api", "--method", "GET"];
      if (hostname !== "github.com") args.push("--hostname", hostname);
      args.push(endpoint);
      let response;
      try {
        response = await execute(args);
      } catch (error) {
        throw new Error(`GitHub tracker inspect failed for ${provider.project}#${issueNumber}: ${error.stderr || error.message}`);
      }
      const payload = JSON.parse(typeof response === "string" ? response : response.stdout);
      if (payload.pull_request) throw new Error(`${provider.project}#${issueNumber} is a pull request, not an issue`);
      const observation = {
        schema_version: "temple.tracker-observation/v1",
        provider_id: provider.id,
        provider_kind: "github",
        item_id: issueNumber,
        url: payload.html_url,
        observed_at: new Date().toISOString(),
        external_updated_at: payload.updated_at ?? null,
        revision: `${payload.updated_at ?? "unknown"}:${payload.id ?? issueNumber}`,
        title: payload.title,
        status: payload.state === "closed" ? "done" : "open",
        fields: {
          priority: null,
          iteration: payload.milestone?.title ?? null,
          estimate: null,
          due_date: null,
          business_assignee: payload.assignees?.[0]?.login ?? null,
          labels: (payload.labels ?? []).map((label) => (typeof label === "string" ? label : label.name)).filter(Boolean)
        },
        source: { kind: "live", adapter: "github-issues-v1" }
      };
      const validation = validateTrackerObservation(observation);
      if (!validation.valid) throw new Error(`GitHub returned an invalid tracker observation: ${validation.errors.join("; ")}`);
      return observation;
    }
  };
}

function selectTrackerReference(item, config, providerId) {
  const requestedProvider = providerId ?? config.default_provider_id;
  const candidates = (item.tracker_refs ?? []).filter(
    (reference) => !requestedProvider || reference.provider_id === requestedProvider
  );
  return candidates.find((reference) => reference.role === "primary") ?? candidates[0] ?? null;
}

async function observationFromOptions(provider, reference, options) {
  if (options.observationPath) {
    const observation = await readJson(path.resolve(options.observationPath));
    const validation = validateTrackerObservation(observation);
    if (!validation.valid) throw new Error(`Invalid tracker observation: ${validation.errors.join("; ")}`);
    return observation;
  }
  if (provider.read_policy !== "live") {
    throw new Error(`${provider.id} uses manual reads; provide --observation with a normalized observation file`);
  }
  const adapters = options.adapters ?? { github: createGitHubTrackerAdapter() };
  const adapter = adapters[provider.kind];
  if (!adapter) throw new Error(`No live tracker adapter is installed for ${provider.kind}; provide --observation`);
  return adapter.inspect(provider, reference.item_id);
}

export async function inspectTrackerItem(target, options) {
  const config = await readTrackerConfig(target);
  requireValidTrackerConfig(config);
  const item = await readWorkItem(target, options.workItemId);
  const reference = selectTrackerReference(item, config, options.providerId);
  if (!reference) throw new Error(`${item.id} has no matching tracker reference`);
  const provider = providerById(config, reference.provider_id);
  if (!provider) throw new Error(`Tracker provider not found: ${reference.provider_id}`);
  const observation = await observationFromOptions(provider, reference, options);
  if (
    observation.provider_id !== reference.provider_id ||
    String(observation.item_id) !== String(reference.item_id) ||
    observation.provider_kind !== provider.kind
  ) {
    throw new Error(
      `Tracker observation ${observation.provider_id}:${observation.item_id} does not match ${reference.provider_id}:${reference.item_id}`
    );
  }
  const observationUrlError = providerUrlError(provider, observation.item_id, observation.url);
  if (observationUrlError) throw new Error(`Tracker observation URL is invalid: ${observationUrlError}`);
  return { config, item, provider, reference, observation };
}

function templeTrackerStatus(item) {
  if (item.state === "done") return "done";
  if (["concluded", "cancelled"].includes(item.state) || isLegacyConcludedItem(item)) return "cancelled";
  if (item.state === "blocked") return "blocked";
  if (["build", "test", "eval", "independent_qa", "release_gate"].includes(item.state)) return "in_progress";
  return "open";
}

export function planTrackerReconciliation(config, item, observation) {
  requireValidTrackerConfig(config);
  const observationValidation = validateTrackerObservation(observation);
  if (!observationValidation.valid) {
    throw new Error(`Invalid tracker observation: ${observationValidation.errors.join("; ")}`);
  }
  const actions = [];
  const templeStatus = templeTrackerStatus(item);
  if (templeStatus !== observation.status) {
    const externalClaimsCompletion = ["done", "cancelled"].includes(observation.status) && !["done", "cancelled"].includes(templeStatus);
    actions.push({
      id: externalClaimsCompletion ? "external-completion-cannot-advance-temple" : "tracker-status-drift",
      field: "lifecycle_state",
      owner: "temple",
      direction: externalClaimsCompletion ? "inbound-blocked" : "outbound-proposal",
      severity: externalClaimsCompletion ? "conflict" : "warning",
      temple_value: templeStatus,
      external_value: observation.status,
      automatic: false,
      reason: externalClaimsCompletion
        ? "External completion cannot bypass Temple lifecycle evidence and release gates"
        : "Temple lifecycle state may be projected externally only after explicit authorization"
    });
  }
  if (String(item.title).trim() !== String(observation.title).trim()) {
    actions.push({
      id: "tracker-title-drift",
      field: "title",
      owner: "negotiated",
      direction: "manual-review",
      severity: "warning",
      temple_value: item.title,
      external_value: observation.title,
      automatic: false,
      reason: "Title ownership is negotiated; neither side silently overwrites the other"
    });
  }
  const provider = providerById(config, observation.provider_id);
  return {
    schema_version: "temple.tracker-plan/v1",
    generated_at: new Date().toISOString(),
    work_item_id: item.id,
    provider_id: observation.provider_id,
    provider_kind: observation.provider_kind,
    item_id: observation.item_id,
    observation_revision: observation.revision,
    write_policy: provider?.write_policy ?? "disabled",
    actions,
    conflict_count: actions.filter((action) => action.severity === "conflict").length,
    review_count: actions.length,
    external_write_performed: false
  };
}

export function validateTrackerPlan(document) {
  const errors = [];
  if (!isObject(document)) return { valid: false, errors: ["tracker plan must be an object"] };
  const planUnknown = unknownKeys(document, TRACKER_PLAN_KEYS);
  if (planUnknown.length) errors.push(`tracker plan has unknown properties: ${planUnknown.join(", ")}`);
  if (document.schema_version !== "temple.tracker-plan/v1") errors.push("tracker plan schema_version is invalid");
  if (!isIsoTimestamp(document.generated_at)) errors.push("tracker plan generated_at is invalid");
  if (!isWorkItemId(document.work_item_id)) errors.push("tracker plan work_item_id is invalid");
  if (!PROVIDER_ID.test(document.provider_id ?? "")) errors.push("tracker plan provider_id is invalid");
  if (!TRACKER_PROVIDER_KINDS.includes(document.provider_kind)) errors.push("tracker plan provider_kind is invalid");
  if (!isNonEmptyString(document.item_id)) errors.push("tracker plan item_id is required");
  if (!isNonEmptyString(document.observation_revision)) errors.push("tracker plan observation_revision is required");
  if (!TRACKER_WRITE_POLICIES.includes(document.write_policy)) errors.push("tracker plan write_policy is invalid");
  if (!Array.isArray(document.actions)) {
    errors.push("tracker plan actions must be an array");
  } else {
    for (const [index, action] of document.actions.entries()) {
      if (!isObject(action)) {
        errors.push(`tracker plan actions[${index}] must be an object`);
        continue;
      }
      const actionUnknown = unknownKeys(action, TRACKER_ACTION_KEYS);
      if (actionUnknown.length) errors.push(`tracker plan actions[${index}] has unknown properties: ${actionUnknown.join(", ")}`);
      if (!isNonEmptyString(action.id) || !isNonEmptyString(action.field) || !isNonEmptyString(action.reason)) {
        errors.push(`tracker plan actions[${index}] requires id, field, and reason`);
      }
      if (!OWNERSHIP_KEYS.has(action.owner)) errors.push(`tracker plan actions[${index}].owner is invalid`);
      if (!["inbound-blocked", "outbound-proposal", "manual-review"].includes(action.direction)) {
        errors.push(`tracker plan actions[${index}].direction is invalid`);
      }
      if (!["conflict", "warning"].includes(action.severity)) errors.push(`tracker plan actions[${index}].severity is invalid`);
      if (action.automatic !== false) errors.push(`tracker plan actions[${index}].automatic must be false`);
    }
  }
  if (!Number.isInteger(document.review_count) || document.review_count !== (document.actions ?? []).length) {
    errors.push("tracker plan review_count must equal the action count");
  }
  const conflicts = Array.isArray(document.actions)
    ? document.actions.filter((action) => action?.severity === "conflict").length
    : 0;
  if (!Number.isInteger(document.conflict_count) || document.conflict_count !== conflicts) {
    errors.push("tracker plan conflict_count must equal the conflict action count");
  }
  if (document.external_write_performed !== false) errors.push("tracker plan external_write_performed must be false");
  return { valid: errors.length === 0, errors };
}

export function validateTrackerReconciliationArtifact(document) {
  const errors = [];
  if (!isObject(document)) return { valid: false, errors: ["tracker reconciliation artifact must be an object"] };
  const artifactUnknown = unknownKeys(document, TRACKER_ARTIFACT_KEYS);
  if (artifactUnknown.length) errors.push(`tracker reconciliation artifact has unknown properties: ${artifactUnknown.join(", ")}`);
  if (document.schema_version !== "temple.tracker-reconciliation/v1") {
    errors.push("tracker reconciliation artifact schema_version is invalid");
  }
  if (!isIsoTimestamp(document.recorded_at)) errors.push("tracker reconciliation artifact recorded_at is invalid");
  if (!isNonEmptyString(document.recorded_by)) errors.push("tracker reconciliation artifact recorded_by is required");
  if (!isWorkItemId(document.work_item_id)) errors.push("tracker reconciliation artifact work_item_id is invalid");
  if (!PROVIDER_ID.test(document.provider_id ?? "")) errors.push("tracker reconciliation artifact provider_id is invalid");
  if (!isNonEmptyString(document.item_id)) errors.push("tracker reconciliation artifact item_id is required");
  if (!isNonEmptyString(document.observation_revision)) {
    errors.push("tracker reconciliation artifact observation_revision is required");
  }
  if (!RECONCILIATION_RESOLUTIONS.includes(document.resolution)) {
    errors.push("tracker reconciliation artifact resolution is invalid");
  }
  if (!isNonEmptyString(document.reason)) errors.push("tracker reconciliation artifact reason is required");
  if (document.external_write_performed !== false) {
    errors.push("tracker reconciliation artifact external_write_performed must be false");
  }
  const observationValidation = validateTrackerObservation(document.observation);
  errors.push(...observationValidation.errors.map((error) => `observation: ${error}`));
  const planValidation = validateTrackerPlan(document.plan);
  errors.push(...planValidation.errors.map((error) => `plan: ${error}`));
  if (observationValidation.valid && planValidation.valid) {
    if (
      document.provider_id !== document.observation.provider_id ||
      String(document.item_id) !== String(document.observation.item_id) ||
      document.observation_revision !== document.observation.revision ||
      document.work_item_id !== document.plan.work_item_id ||
      document.provider_id !== document.plan.provider_id ||
      String(document.item_id) !== String(document.plan.item_id) ||
      document.observation_revision !== document.plan.observation_revision
    ) {
      errors.push("tracker reconciliation artifact identity does not match its observation and plan");
    }
  }
  return { valid: errors.length === 0, errors };
}

function emptyTrackerView() {
  return { schema_version: "temple.tracker-view/v1", generated_at: null, entries: [] };
}

export function validateTrackerView(document) {
  const errors = [];
  if (!isObject(document) || document.schema_version !== "temple.tracker-view/v1" || !Array.isArray(document.entries)) {
    return { valid: false, errors: ["tracker view must use temple.tracker-view/v1 with entries"] };
  }
  const viewUnknown = unknownKeys(document, new Set(["schema_version", "generated_at", "entries"]));
  if (viewUnknown.length) errors.push(`tracker view has unknown properties: ${viewUnknown.join(", ")}`);
  if (document.generated_at !== null && !isIsoTimestamp(document.generated_at)) {
    errors.push("tracker view generated_at must be an ISO 8601 UTC timestamp or null");
  }
  const seen = new Set();
  for (const [index, entry] of document.entries.entries()) {
    if (!isObject(entry) || !isWorkItemId(entry.work_item_id) || !isObject(entry.observation) || !isObject(entry.plan)) {
      errors.push(`entries[${index}] is invalid`);
      continue;
    }
    const entryUnknown = unknownKeys(entry, new Set(["work_item_id", "observation", "plan", "last_reconciliation"]));
    if (entryUnknown.length) errors.push(`entries[${index}] has unknown properties: ${entryUnknown.join(", ")}`);
    const observationValidation = validateTrackerObservation(entry.observation);
    if (!observationValidation.valid) errors.push(...observationValidation.errors.map((error) => `entries[${index}]: ${error}`));
    const key = `${entry.work_item_id}:${entry.observation.provider_id}:${entry.observation.item_id}`;
    if (seen.has(key)) errors.push(`tracker view contains duplicate entry: ${key}`);
    seen.add(key);
    const planValidation = validateTrackerPlan(entry.plan);
    if (!planValidation.valid) {
      errors.push(...planValidation.errors.map((error) => `entries[${index}]: ${error}`));
    }
    if (
      entry.plan.work_item_id !== entry.work_item_id ||
      entry.plan.provider_id !== entry.observation.provider_id ||
      String(entry.plan.item_id) !== String(entry.observation.item_id) ||
      entry.plan.observation_revision !== entry.observation.revision
    ) {
      errors.push(`entries[${index}].plan is inconsistent with its observation`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export async function readTrackerView(target) {
  const viewPath = path.join(target, TRACKER_VIEW_RELATIVE_PATH);
  return (await pathExists(viewPath)) ? readJson(viewPath) : emptyTrackerView();
}

export async function writeTrackerView(target, item, observation, plan, reconciliation = null) {
  const current = await readTrackerView(target);
  const validation = validateTrackerView(current);
  const base = validation.valid ? current : emptyTrackerView();
  const key = `${item.id}:${observation.provider_id}:${observation.item_id}`;
  const entries = [
    ...base.entries.filter(
      (entry) => `${entry.work_item_id}:${entry.observation.provider_id}:${entry.observation.item_id}` !== key
    ),
    {
      work_item_id: item.id,
      observation,
      plan,
      last_reconciliation: reconciliation
    }
  ].sort((left, right) => left.work_item_id.localeCompare(right.work_item_id));
  const view = { schema_version: "temple.tracker-view/v1", generated_at: new Date().toISOString(), entries };
  await atomicWrite(path.join(target, TRACKER_VIEW_RELATIVE_PATH), formatJson(view));
  return view;
}

export async function inspectAndPlanTrackerItem(target, options) {
  const inspected = await inspectTrackerItem(target, options);
  const plan = planTrackerReconciliation(inspected.config, inspected.item, inspected.observation);
  if (options.writeView !== false) {
    await writeTrackerView(target, inspected.item, inspected.observation, plan);
  }
  return { ...inspected, plan };
}

export async function reconcileTrackerItem(target, options) {
  const inspected = await inspectTrackerItem(target, options);
  const plan = planTrackerReconciliation(inspected.config, inspected.item, inspected.observation);
  const resolution = String(options.resolution ?? "").trim();
  if (!RECONCILIATION_RESOLUTIONS.includes(resolution)) {
    throw new Error(`Resolution must be one of: ${RECONCILIATION_RESOLUTIONS.join(", ")}`);
  }
  const reason = String(options.reason ?? "").trim();
  if (!reason) throw new Error("Tracker reconciliation requires --reason");
  if (resolution === "acknowledge" && plan.actions.length > 0) {
    throw new Error("acknowledge is allowed only when the tracker plan has no actions");
  }
  if (resolution === "accept-external") {
    const protectedActions = plan.actions.filter((action) => action.owner === "temple");
    if (protectedActions.length) {
      throw new Error(`Cannot accept external values for Temple-owned fields: ${protectedActions.map((action) => action.field).join(", ")}`);
    }
  }
  const context = await loadProjectContext(target);
  const actor = actorForWorkItem(context, inspected.item, options.actor);
  const timestamp = new Date().toISOString();
  const safeTime = timestamp.replace(/[:.]/g, "-");
  const relativeArtifact = `.ai-org/artifacts/tracker-reconciliations/${inspected.item.id}-${safeTime}.json`;
  const artifact = {
    schema_version: "temple.tracker-reconciliation/v1",
    recorded_at: timestamp,
    recorded_by: actor,
    work_item_id: inspected.item.id,
    provider_id: inspected.observation.provider_id,
    item_id: inspected.observation.item_id,
    observation_revision: inspected.observation.revision,
    resolution,
    reason,
    external_write_performed: false,
    observation: inspected.observation,
    plan
  };
  const artifactPath = path.join(target, relativeArtifact);
  await atomicCreate(artifactPath, formatJson(artifact));
  let workItemWritten = false;
  try {
    const trackerReconciliations = [
      ...(inspected.item.tracker_reconciliations ?? []),
      {
        provider_id: inspected.observation.provider_id,
        item_id: inspected.observation.item_id,
        observation_revision: inspected.observation.revision,
        resolution,
        recorded_at: timestamp,
        recorded_by: actor,
        evidence_ref: relativeArtifact,
        external_write_performed: false
      }
    ];
    let updated = {
      ...inspected.item,
      tracker_reconciliations: trackerReconciliations,
      evidence: uniqueStrings([...(inspected.item.evidence ?? []), relativeArtifact]),
      updated_at: timestamp
    };
    if (resolution === "accept-external") updated = { ...updated, title: inspected.observation.title };
    if (resolution === "defer") {
      updated = {
        ...updated,
        unresolved: uniqueStrings([
          ...(inspected.item.unresolved ?? []),
          `Tracker reconciliation deferred for ${inspected.observation.provider_id}:${inspected.observation.item_id}@${inspected.observation.revision}`
        ])
      };
    }
    await writeWorkItem(target, updated);
    workItemWritten = true;
    await appendEvent(target, {
      timestamp,
      event_type: "tracker_reconciliation_recorded",
      actor,
      work_item_id: inspected.item.id,
      provider_id: inspected.observation.provider_id,
      external_item_id: inspected.observation.item_id,
      resolution,
      external_write_performed: false,
      refs: [relativeArtifact, `.ai-org/work-items/${inspected.item.id}.json`]
    });
    const resultingPlan = planTrackerReconciliation(inspected.config, updated, inspected.observation);
    await writeTrackerView(target, updated, inspected.observation, resultingPlan, {
      resolution,
      recorded_at: timestamp,
      evidence_ref: relativeArtifact,
      external_write_performed: false
    });
    return { item: updated, artifact: relativeArtifact, resolution, plan: resultingPlan, external_write_performed: false };
  } catch (error) {
    // Once the Work Item cites the artifact, retain it even if a later generated
    // view or append-only event write fails. Deleting it would corrupt evidence.
    if (!workItemWritten) await fs.unlink(artifactPath).catch(() => {});
    throw error;
  }
}

export async function inheritedTrackerReferences(target, item, config = null) {
  const inherited = [];
  const visited = new Set([item.id]);
  let parentId = item.parent_work_item_id;
  while (parentId) {
    if (visited.has(parentId)) break;
    visited.add(parentId);
    const parent = await readWorkItem(target, parentId);
    if (config) {
      const validation = validateWorkItemTrackerRefs(parent, config);
      if (!validation.valid) {
        throw new Error(`Invalid ancestor Work Item tracker references: ${validation.errors.join("; ")}`);
      }
    }
    for (const reference of parent.tracker_refs ?? []) {
      inherited.push({ ...reference, inherited_from: parent.id });
    }
    parentId = parent.parent_work_item_id;
  }
  return inherited;
}
