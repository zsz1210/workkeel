import path from "node:path";
import { atomicCreate, formatJson, pathExists, readJson, sha256 } from "./files.mjs";

export const REPOSITORY_INTEGRATION_SCHEMA = "temple.repository-integration/v1";
export const REPOSITORY_INTEGRATION_RELATIVE_PATH = ".ai-org/project/repository-integration.json";

const STATUSES = new Set(["unconfirmed", "deferred", "confirmed"]);
const SOURCES = new Set(["not-inspected", "repository-policy", "human-confirmed"]);
const CHANGE_ISOLATION = new Set(["unknown", "project-defined", "required", "recommended", "not-required"]);
const REVIEW_GATES = new Set(["unknown", "project-defined", "required", "not-required"]);
const ROOT_KEYS = new Set([
  "schema_version",
  "status",
  "authority",
  "source",
  "policy_refs",
  "summary",
  "integration_target",
  "change_isolation",
  "review_gate",
  "recorded_at",
  "recorded_by"
]);
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export function defaultRepositoryIntegration() {
  return {
    schema_version: REPOSITORY_INTEGRATION_SCHEMA,
    status: "unconfirmed",
    authority: "project",
    source: "not-inspected",
    policy_refs: [],
    summary: null,
    integration_target: null,
    change_isolation: "unknown",
    review_gate: "unknown",
    recorded_at: null,
    recorded_by: null
  };
}

export function validateRepositoryIntegration(document) {
  const errors = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return { valid: false, errors: ["repository integration must be an object"] };
  }
  const unsupported = Object.keys(document).filter((key) => !ROOT_KEYS.has(key));
  if (unsupported.length > 0) errors.push(`unsupported fields: ${unsupported.join(", ")}`);
  if (document.schema_version !== REPOSITORY_INTEGRATION_SCHEMA) {
    errors.push(`schema_version must be ${REPOSITORY_INTEGRATION_SCHEMA}`);
  }
  if (!STATUSES.has(document.status)) errors.push("status must be unconfirmed, deferred, or confirmed");
  if (document.authority !== "project") errors.push("authority must be project");
  if (!SOURCES.has(document.source)) errors.push("source must be not-inspected, repository-policy, or human-confirmed");
  if (
    !Array.isArray(document.policy_refs) ||
    document.policy_refs.some((entry) => typeof entry !== "string" || !entry.trim()) ||
    new Set(document.policy_refs).size !== document.policy_refs.length
  ) {
    errors.push("policy_refs must contain unique non-empty strings");
  }
  if (document.summary !== null && (typeof document.summary !== "string" || !document.summary.trim())) {
    errors.push("summary must be null or a non-empty string");
  }
  if (
    document.integration_target !== null &&
    (typeof document.integration_target !== "string" || !document.integration_target.trim())
  ) {
    errors.push("integration_target must be null or a non-empty string");
  }
  if (!CHANGE_ISOLATION.has(document.change_isolation)) {
    errors.push("change_isolation is unsupported");
  }
  if (!REVIEW_GATES.has(document.review_gate)) errors.push("review_gate is unsupported");
  if (document.recorded_at !== null && (typeof document.recorded_at !== "string" || !ISO_TIMESTAMP.test(document.recorded_at))) {
    errors.push("recorded_at must be null or an ISO UTC timestamp");
  }
  if (document.recorded_by !== null && (typeof document.recorded_by !== "string" || !document.recorded_by.trim())) {
    errors.push("recorded_by must be null or a non-empty actor ID");
  }

  if (document.status === "unconfirmed") {
    if (document.source !== "not-inspected") errors.push("unconfirmed state must use source not-inspected");
    if ((document.policy_refs ?? []).length > 0 || document.summary !== null || document.integration_target !== null) {
      errors.push("unconfirmed state cannot claim policy details");
    }
    if (document.change_isolation !== "unknown" || document.review_gate !== "unknown") {
      errors.push("unconfirmed state must keep integration decisions unknown");
    }
    if (document.recorded_at !== null || document.recorded_by !== null) {
      errors.push("unconfirmed state cannot claim confirmation provenance");
    }
  } else {
    if (document.source === "not-inspected") errors.push(`${document.status} state requires an inspected or human-confirmed source`);
    if (typeof document.summary !== "string" || !document.summary.trim()) {
      errors.push(`${document.status} state requires a summary`);
    }
    if (!document.recorded_at || !document.recorded_by) {
      errors.push(`${document.status} state requires recorded_at and recorded_by`);
    }
  }

  if (document.status === "confirmed") {
    if (document.change_isolation === "unknown") errors.push("confirmed state must decide change_isolation");
    if (document.review_gate === "unknown") errors.push("confirmed state must decide review_gate");
  }

  return { valid: errors.length === 0, errors };
}

export function normalizeRepositoryIntegration(document) {
  const normalized = document === undefined ? defaultRepositoryIntegration() : structuredClone(document);
  if (Array.isArray(normalized?.policy_refs)) {
    normalized.policy_refs = normalized.policy_refs.map((entry) => (typeof entry === "string" ? entry.trim() : entry));
  }
  if (typeof normalized?.summary === "string") normalized.summary = normalized.summary.trim();
  if (typeof normalized?.integration_target === "string") {
    normalized.integration_target = normalized.integration_target.trim();
  }
  if (typeof normalized?.recorded_by === "string") normalized.recorded_by = normalized.recorded_by.trim();
  const validation = validateRepositoryIntegration(normalized);
  if (!validation.valid) {
    throw new Error(`Invalid repository integration config:\n- ${validation.errors.join("\n- ")}`);
  }
  return normalized;
}

export async function ensureRepositoryIntegration(target) {
  const integrationPath = path.join(target, REPOSITORY_INTEGRATION_RELATIVE_PATH);
  let created = false;
  let afterHash = null;
  if (!(await pathExists(integrationPath))) {
    const content = formatJson(defaultRepositoryIntegration());
    try {
      await atomicCreate(integrationPath, content);
      created = true;
      afterHash = sha256(content);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  return { path: integrationPath, created, afterHash };
}

export async function readRepositoryIntegration(target) {
  return readJson(path.join(target, REPOSITORY_INTEGRATION_RELATIVE_PATH));
}
