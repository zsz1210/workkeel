import path from "node:path";
import { atomicCreate, formatJson, pathExists, readJson, sha256 } from "./files.mjs";

export const EVIDENCE_PROFILES_SCHEMA = "temple.evidence-profiles/v1";
export const EVIDENCE_PROFILES_RELATIVE_PATH = ".ai-org/project/evidence-profiles.json";
export const EVIDENCE_PROFILE_IDS = ["private", "public", "restricted"];

const PROFILE_FLOORS = Object.freeze({
  private: { local_environment: "review-required", retained_legacy_repository: "review-required" },
  public: { local_environment: "blocked", retained_legacy_repository: "review-required" },
  restricted: { local_environment: "blocked", retained_legacy_repository: "blocked" }
});

const REQUIRED_PUBLIC_EVIDENCE = [
  "lifecycle-and-handoffs",
  "quality-and-release-gates",
  "model-routing-metadata",
  "token-counts-and-budgets",
  "credits-reset-retry-and-fallback-approvals",
  "experiment-protocols-observations-and-outcomes"
];

const REQUIRED_LOCAL_ONLY_EVIDENCE = [
  "credentials-and-secret-values",
  "raw-provider-telemetry",
  "raw-prompts-and-responses",
  "live-account-balance-and-reset-availability"
];

const SYNTHETIC_USERNAMES = ["demo", "example", "fixture", "sample", "test", "tester"];
const REVIEWABLE_ADAPTER_RULES = new Set([
  "maintainer-home-path-posix",
  "maintainer-home-path-windows",
  "private-ipv4",
  "private-tailnet-hostname"
]);

export function defaultEvidenceProfiles() {
  return {
    schema_version: EVIDENCE_PROFILES_SCHEMA,
    active_profile: "private",
    profiles: EVIDENCE_PROFILE_IDS.map((id) => ({ id, ...PROFILE_FLOORS[id] })),
    reviewed_legacy_baseline: null,
    reviewed_adapter_fixtures: [],
    public_evidence: [...REQUIRED_PUBLIC_EVIDENCE],
    local_only_evidence: [...REQUIRED_LOCAL_ONLY_EVIDENCE],
    synthetic_usernames: [...SYNTHETIC_USERNAMES],
    max_text_file_bytes: 2097152,
    binary_review: "required"
  };
}

function uniqueNonEmptyStrings(values) {
  return Array.isArray(values) && values.length > 0 &&
    values.every((value) => typeof value === "string" && value.trim()) &&
    new Set(values).size === values.length;
}

export function validateEvidenceProfiles(document) {
  const errors = [];
  if (document?.schema_version !== EVIDENCE_PROFILES_SCHEMA) {
    errors.push(`schema_version must be ${EVIDENCE_PROFILES_SCHEMA}`);
  }
  if (!EVIDENCE_PROFILE_IDS.includes(document?.active_profile)) errors.push("active_profile is invalid");
  const profiles = Array.isArray(document?.profiles) ? document.profiles : [];
  const byId = new Map(profiles.map((entry) => [entry?.id, entry]));
  if (profiles.length !== EVIDENCE_PROFILE_IDS.length || byId.size !== EVIDENCE_PROFILE_IDS.length) {
    errors.push("profiles must contain private, public, and restricted exactly once");
  }
  for (const id of EVIDENCE_PROFILE_IDS) {
    const profile = byId.get(id);
    if (!profile) {
      errors.push(`profile ${id} is missing`);
      continue;
    }
    for (const [field, expected] of Object.entries(PROFILE_FLOORS[id])) {
      if (profile[field] !== expected) errors.push(`profile ${id}.${field} must be ${expected}`);
    }
  }
  const baseline = document?.reviewed_legacy_baseline;
  if (baseline !== null) {
    if (!/^[0-9a-f]{40}$/.test(baseline?.revision ?? "")) errors.push("reviewed_legacy_baseline.revision must be a full Git commit id");
    if (typeof baseline?.approved_by !== "string" || !baseline.approved_by.trim()) errors.push("reviewed_legacy_baseline.approved_by is required");
    if (typeof baseline?.approved_at !== "string" || Number.isNaN(Date.parse(baseline.approved_at))) errors.push("reviewed_legacy_baseline.approved_at must be an ISO date-time");
    if (typeof baseline?.rationale !== "string" || !baseline.rationale.trim()) errors.push("reviewed_legacy_baseline.rationale is required");
  }
  const reviewedFixtures = document?.reviewed_adapter_fixtures ?? [];
  if (!Array.isArray(reviewedFixtures)) {
    errors.push("reviewed_adapter_fixtures must be an array");
  } else {
    const keys = new Set();
    for (const [index, entry] of reviewedFixtures.entries()) {
      const prefix = `reviewed_adapter_fixtures[${index}]`;
      const sourcePath = entry?.path;
      const manifestPath = entry?.manifest_path;
      if (typeof sourcePath !== "string" || !/^\.ai-org\/adapters\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/.+/.test(sourcePath) ||
          sourcePath.includes("\\") || path.posix.normalize(sourcePath) !== sourcePath) {
        errors.push(`${prefix}.path must be a safe installed-adapter path`);
      }
      if (typeof manifestPath !== "string" || !/^\.ai-org\/adapters\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/manifest\.json$/.test(manifestPath) ||
          manifestPath.includes("\\") || path.posix.normalize(manifestPath) !== manifestPath) {
        errors.push(`${prefix}.manifest_path must name an installed-adapter manifest`);
      } else if (typeof sourcePath === "string" && !sourcePath.startsWith(`${path.posix.dirname(manifestPath)}/`)) {
        errors.push(`${prefix}.path must be below its manifest root`);
      }
      if (!REVIEWABLE_ADAPTER_RULES.has(entry?.rule_id)) errors.push(`${prefix}.rule_id is not a reviewable local-environment rule`);
      if (!Number.isInteger(entry?.line) || entry.line < 1) errors.push(`${prefix}.line must be a positive integer`);
      if (!Number.isInteger(entry?.occurrence_count) || entry.occurrence_count < 1 || entry.occurrence_count > 100) {
        errors.push(`${prefix}.occurrence_count must be an integer from 1 to 100`);
      }
      if (!/^[0-9a-f]{64}$/.test(entry?.source_sha256 ?? "")) errors.push(`${prefix}.source_sha256 must be a SHA-256 digest`);
      if (typeof entry?.approved_by !== "string" || !entry.approved_by.trim()) errors.push(`${prefix}.approved_by is required`);
      if (typeof entry?.approved_at !== "string" || Number.isNaN(Date.parse(entry.approved_at))) errors.push(`${prefix}.approved_at must be an ISO date-time`);
      if (typeof entry?.rationale !== "string" || !entry.rationale.trim()) errors.push(`${prefix}.rationale is required`);
      const key = [sourcePath, entry?.rule_id, entry?.line].join("\0");
      if (keys.has(key)) errors.push(`${prefix} duplicates an earlier reviewed fixture`);
      keys.add(key);
    }
  }
  if (!uniqueNonEmptyStrings(document?.public_evidence)) errors.push("public_evidence must contain unique non-empty values");
  else for (const entry of REQUIRED_PUBLIC_EVIDENCE) if (!document.public_evidence.includes(entry)) errors.push(`public_evidence is missing ${entry}`);
  if (!uniqueNonEmptyStrings(document?.local_only_evidence)) errors.push("local_only_evidence must contain unique non-empty values");
  else for (const entry of REQUIRED_LOCAL_ONLY_EVIDENCE) if (!document.local_only_evidence.includes(entry)) errors.push(`local_only_evidence is missing ${entry}`);
  if (!uniqueNonEmptyStrings(document?.synthetic_usernames) ||
      document.synthetic_usernames.length !== SYNTHETIC_USERNAMES.length ||
      document.synthetic_usernames.some((entry, index) => entry !== SYNTHETIC_USERNAMES[index])) {
    errors.push(`synthetic_usernames must remain ${SYNTHETIC_USERNAMES.join(", ")}`);
  }
  if (!Number.isInteger(document?.max_text_file_bytes) || document.max_text_file_bytes < 16384 || document.max_text_file_bytes > 8388608) {
    errors.push("max_text_file_bytes must be an integer from 16384 to 8388608");
  }
  if (document?.binary_review !== "required") errors.push("binary_review must remain required");
  return { valid: errors.length === 0, errors };
}

export async function ensureEvidenceProfiles(target) {
  const policyPath = path.join(target, EVIDENCE_PROFILES_RELATIVE_PATH);
  if (await pathExists(policyPath)) return { path: policyPath, created: false, afterHash: null };
  const content = formatJson(defaultEvidenceProfiles());
  try {
    await atomicCreate(policyPath, content);
    return { path: policyPath, created: true, afterHash: sha256(content) };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return { path: policyPath, created: false, afterHash: null };
  }
}

export async function readEvidenceProfiles(target) {
  const policyPath = path.join(target, EVIDENCE_PROFILES_RELATIVE_PATH);
  const source = await pathExists(policyPath) ? "project" : "framework-default";
  const policy = source === "project" ? await readJson(policyPath) : defaultEvidenceProfiles();
  const validation = validateEvidenceProfiles(policy);
  if (!validation.valid) throw new Error(`Invalid Evidence Profiles: ${validation.errors.join("; ")}`);
  return { policy, source };
}

export function evidenceProfile(policy, requestedId) {
  const id = requestedId ?? policy.active_profile;
  const profile = policy.profiles.find((entry) => entry.id === id);
  if (!profile) throw new Error(`Unknown Evidence Profile: ${id}`);
  return profile;
}
