import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { atomicWrite, formatJson, pathExists, readJson } from "./files.mjs";
import { readControlPlaneConfig } from "./control-plane-config.mjs";
import { openTelemetryJournal, resolveControlPlaneStateDirectory } from "./telemetry.mjs";
import { classifyCodexTasks, createJsonRpcProcess } from "./codex-app-server-provider.mjs";
import { listWorkItemDocuments } from "./work-items.mjs";
import {
  defaultUsagePolicy,
  MATCHED_EVALUATION_METHOD,
  MATCHED_EVALUATION_ROOT,
  matchedEvaluationPolicy,
  readUsagePolicy,
  usagePolicyProjection,
  validateUsagePolicy
} from "./usage-policy.mjs";

export const USAGE_BASELINE_VIEW = ".ai-org/views/usage-baseline.json";
export const USAGE_DIMENSIONS = [
  "project_id",
  "work_item_id",
  "position_id",
  "lifecycle_stage",
  "task_shape_id",
  "task_kind",
  "risk_class",
  "context_profile_digest",
  "task_id",
  "attempt_id",
  "provider_id",
  "model",
  "model_version",
  "requested_reasoning_effort",
  "observed_thread_reasoning_effort",
  "effective_turn_reasoning_effort",
  "reasoning_effort",
  "reasoning_effort_source",
  "service_tier",
  "context_capsule_digest",
  "capability_set_digest",
  "outcome"
];

const TOKEN_FIELDS = ["input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens"];
const USAGE_EVENT_TYPE = "org.temple.codex.usage.updated.v1";
const ARCHIVE_FILE_PATTERN = /^events-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.jsonl$/;
const DEFAULT_ARCHIVE_LIMITS = {
  maxArchiveFiles: 64,
  maxArchiveBytes: 32 * 1024 * 1024,
  maxTotalArchiveBytes: 128 * 1024 * 1024,
  maxArchiveLineBytes: 1024 * 1024,
  maxWarnings: 32
};
const archiveUsageFileCache = new Map();
const MATCHED_EVALUATION_SCHEMA = "temple.matched-model-evaluation/v1";
const MATCHED_ADVISORY_SCHEMA = "temple.matched-model-advisory/v1";
const MAX_MATCHED_EVALUATION_BYTES = 1024 * 1024;
const MATCHED_PRIVACY_FIELDS = [
  "raw_prompts_retained",
  "responses_retained",
  "hidden_reasoning_retained",
  "credentials_retained",
  "raw_provider_payloads_retained"
];

function usageEventIdentity(record) {
  return `${record.source}\u0000${record.id}`;
}

function stableValue(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stableValue);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function comparableUsageRecord(record) {
  const { templecursor: _cursor, templeobservedat: _observedAt, ...stable } = record;
  return JSON.stringify(stableValue(stable));
}

function boundedString(value, field, options = {}) {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "string" ||
    (!options.allowEmpty && !value.trim()) ||
    value.length > (options.maxLength ?? 512) ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`invalid-${field}`);
  }
  return value;
}

function validDateTime(value) {
  return typeof value === "string" && value.length <= 64 && !Number.isNaN(Date.parse(value));
}

function exactObjectShape(value, label, keys, errors) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${label} must be an object`);
    return false;
  }
  const allowed = new Set(keys);
  for (const key of keys) if (!Object.hasOwn(value, key)) errors.push(`${label}.${key} is required`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${label}.${key} is not allowed`);
  return true;
}

function boundedNonEmpty(value, maximum = 256) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
}

function uniqueBoundedStrings(values, minimum = 1, maximum = 256) {
  return Array.isArray(values) && values.length >= minimum && values.length <= 1000 && values.every((value) => boundedNonEmpty(value, maximum)) && new Set(values).size === values.length;
}

function finiteRange(value, minimum, maximum, options = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (options.integer && !Number.isSafeInteger(value)) return false;
  if (options.exclusiveMinimum ? value <= minimum : value < minimum) return false;
  if (options.exclusiveMaximum ? value >= maximum : value > maximum) return false;
  return true;
}

function validSha256Digest(value) {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

export function validateMatchedModelEvaluation(document) {
  const errors = [];
  exactObjectShape(document, "evaluation", [
    "schema_version",
    "evaluation_id",
    "project_id",
    "observed_at",
    "expires_at",
    "task_shape",
    "rubric",
    "decision_contract",
    "baseline_profile_id",
    "candidates",
    "privacy"
  ], errors);
  if (document?.schema_version !== MATCHED_EVALUATION_SCHEMA) errors.push(`schema_version must be ${MATCHED_EVALUATION_SCHEMA}`);
  if (!boundedNonEmpty(document?.evaluation_id, 128) || !/^[a-z0-9][a-z0-9._-]*$/.test(document.evaluation_id)) errors.push("evaluation_id is invalid");
  if (!boundedNonEmpty(document?.project_id)) errors.push("project_id is invalid");
  if (!validDateTime(document?.observed_at)) errors.push("observed_at is invalid");
  if (!validDateTime(document?.expires_at)) errors.push("expires_at is invalid");
  if (validDateTime(document?.observed_at) && validDateTime(document?.expires_at) && Date.parse(document.expires_at) <= Date.parse(document.observed_at)) {
    errors.push("expires_at must be after observed_at");
  }

  const shape = document?.task_shape;
  exactObjectShape(shape, "task_shape", ["position_id", "lifecycle_stage", "task_kind", "risk_class", "context_profile_digest"], errors);
  for (const field of ["position_id", "lifecycle_stage", "task_kind"]) if (!boundedNonEmpty(shape?.[field], 128)) errors.push(`task_shape.${field} is invalid`);
  if (!["low", "standard", "high", "critical"].includes(shape?.risk_class)) errors.push("task_shape.risk_class is invalid");
  if (!validSha256Digest(shape?.context_profile_digest)) errors.push("task_shape.context_profile_digest is invalid");

  const rubric = document?.rubric;
  exactObjectShape(rubric, "rubric", ["id", "revision", "required_case_ids", "minimum_score"], errors);
  if (!boundedNonEmpty(rubric?.id) || !boundedNonEmpty(rubric?.revision)) errors.push("rubric identity is invalid");
  if (!uniqueBoundedStrings(rubric?.required_case_ids, 2)) errors.push("rubric.required_case_ids must contain unique bounded case IDs");
  if (!finiteRange(rubric?.minimum_score, 0, 1)) errors.push("rubric.minimum_score must be from 0 to 1");

  const contract = document?.decision_contract;
  exactObjectShape(contract, "decision_contract", ["method", "minimum_effect", "alpha", "power", "pilot_variance"], errors);
  if (contract?.method !== MATCHED_EVALUATION_METHOD) errors.push(`decision_contract.method must be ${MATCHED_EVALUATION_METHOD}`);
  for (const field of ["minimum_effect", "alpha", "power"]) {
    if (!finiteRange(contract?.[field], 0, 1, { exclusiveMinimum: true, exclusiveMaximum: true })) errors.push(`decision_contract.${field} must be greater than 0 and less than 1`);
  }
  if (!finiteRange(contract?.pilot_variance, 0, Number.MAX_VALUE)) errors.push("decision_contract.pilot_variance must be non-negative");
  if (!boundedNonEmpty(document?.baseline_profile_id, 128)) errors.push("baseline_profile_id is invalid");

  const candidates = document?.candidates;
  if (!Array.isArray(candidates) || candidates.length < 2 || candidates.length > 64) errors.push("candidates must contain 2 to 64 profiles");
  const profileIds = [];
  for (const [candidateIndex, candidate] of (Array.isArray(candidates) ? candidates : []).entries()) {
    const label = `candidates[${candidateIndex}]`;
    exactObjectShape(candidate, label, [
      "profile_id",
      "provider_id",
      "requested_model",
      "effective_model",
      "requested_reasoning_effort",
      "effective_reasoning_effort",
      "cases"
    ], errors);
    for (const field of ["profile_id", "provider_id", "requested_model", "effective_model", "requested_reasoning_effort", "effective_reasoning_effort"]) {
      if (!boundedNonEmpty(candidate?.[field], field === "profile_id" || field === "provider_id" ? 128 : 256)) errors.push(`${label}.${field} is invalid`);
    }
    profileIds.push(candidate?.profile_id);
    if (!Array.isArray(candidate?.cases) || candidate.cases.length < 2 || candidate.cases.length > 1000) errors.push(`${label}.cases must contain 2 to 1000 cases`);
    const caseIds = [];
    for (const [caseIndex, item] of (Array.isArray(candidate?.cases) ? candidate.cases : []).entries()) {
      const caseLabel = `${label}.cases[${caseIndex}]`;
      exactObjectShape(item, caseLabel, [
        "case_id",
        "input_digest",
        "source_revision",
        "quality_score",
        "quality_evidence_refs",
        "total_tokens",
        "latency_ms",
        "rework_count",
        "human_intervention_count"
      ], errors);
      if (!boundedNonEmpty(item?.case_id)) errors.push(`${caseLabel}.case_id is invalid`);
      caseIds.push(item?.case_id);
      if (!validSha256Digest(item?.input_digest)) errors.push(`${caseLabel}.input_digest is invalid`);
      if (!boundedNonEmpty(item?.source_revision)) errors.push(`${caseLabel}.source_revision is invalid`);
      if (!finiteRange(item?.quality_score, 0, 1)) errors.push(`${caseLabel}.quality_score must be from 0 to 1`);
      if (!uniqueBoundedStrings(item?.quality_evidence_refs, 1, 1024)) errors.push(`${caseLabel}.quality_evidence_refs is invalid`);
      for (const field of ["total_tokens", "latency_ms", "rework_count", "human_intervention_count"]) {
        if (!finiteRange(item?.[field], 0, Number.MAX_SAFE_INTEGER, { integer: true })) errors.push(`${caseLabel}.${field} must be a non-negative integer`);
      }
    }
    if (caseIds.some((value) => !boundedNonEmpty(value)) || new Set(caseIds).size !== caseIds.length) errors.push(`${label}.cases contains duplicate case IDs`);
  }
  if (profileIds.some((value) => !boundedNonEmpty(value, 128)) || new Set(profileIds).size !== profileIds.length) errors.push("candidates contains duplicate profile IDs");
  if (boundedNonEmpty(document?.baseline_profile_id, 128) && !profileIds.includes(document.baseline_profile_id)) errors.push("baseline_profile_id does not reference a candidate");

  const privacy = document?.privacy;
  exactObjectShape(privacy, "privacy", MATCHED_PRIVACY_FIELDS, errors);
  for (const field of MATCHED_PRIVACY_FIELDS) if (privacy?.[field] !== false) errors.push(`privacy.${field} must be false`);
  return { valid: errors.length === 0, errors: [...new Set(errors)].sort() };
}

function taskShapeIdentity(shape) {
  return [shape.position_id, shape.lifecycle_stage, shape.task_kind, shape.risk_class, shape.context_profile_digest].join(":");
}

function seedProfileForShape(policy, shape) {
  const rule = policy.seed_policy.rules.find((entry) => entry.task_kinds.includes(shape.task_kind) && entry.risk_classes.includes(shape.risk_class));
  return rule?.profile_id ?? policy.seed_policy.fallback_profile_id;
}

function roundMetric(value) {
  return Number(value.toFixed(12));
}

function average(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function combination(n, k) {
  const limit = Math.min(k, n - k);
  let result = 1;
  for (let index = 1; index <= limit; index += 1) result = (result * (n - limit + index)) / index;
  return result;
}

function twoSidedSignTest(wins, losses) {
  const pairs = wins + losses;
  if (pairs === 0) return 1;
  const extreme = Math.min(wins, losses);
  let probability = 0;
  for (let index = 0; index <= extreme; index += 1) probability += combination(pairs, index) / (2 ** pairs);
  return roundMetric(Math.min(1, probability * 2));
}

function candidateAggregate(candidate, minimumScore) {
  const cases = [...candidate.cases].sort((left, right) => left.case_id.localeCompare(right.case_id));
  return {
    profile_id: candidate.profile_id,
    provider_id: candidate.provider_id,
    requested_model: candidate.requested_model,
    effective_model: candidate.effective_model,
    requested_reasoning_effort: candidate.requested_reasoning_effort,
    effective_reasoning_effort: candidate.effective_reasoning_effort,
    cases,
    case_count: cases.length,
    quality_gate_passed: cases.every((item) => item.quality_score >= minimumScore),
    average_quality_score: roundMetric(average(cases.map((item) => item.quality_score))),
    average_total_tokens: roundMetric(average(cases.map((item) => item.total_tokens))),
    average_latency_ms: roundMetric(average(cases.map((item) => item.latency_ms))),
    average_rework_count: roundMetric(average(cases.map((item) => item.rework_count))),
    average_human_intervention_count: roundMetric(average(cases.map((item) => item.human_intervention_count)))
  };
}

function advisoryAuthorityFields(policy) {
  return {
    routing_authority: false,
    automatic_routing_eligible: false,
    automatic_routing: false,
    model_switch_performed: false,
    policy_change_performed: false,
    provider_call_performed: false,
    budget_can_skip_gates: false,
    lifecycle_authority_granted: false,
    approval_mode: policy.autonomy.mode,
    approval_triggers: [...policy.autonomy.approval_triggers]
  };
}

export function evaluateMatchedModelEvaluation(project, document, usagePolicy, options = {}) {
  const policyValidation = validateUsagePolicy(usagePolicy);
  if (!policyValidation.valid) throw new Error(`Invalid usage policy: ${policyValidation.errors.join("; ")}`);
  const validation = validateMatchedModelEvaluation(document);
  const base = {
    schema_version: MATCHED_ADVISORY_SCHEMA,
    evaluation_id: boundedNonEmpty(document?.evaluation_id, 128) ? document.evaluation_id : null,
    source: options.source ?? null,
    status: "invalid",
    reason: validation.valid ? null : "invalid-evaluation-document",
    errors: validation.errors,
    task_shape: validation.valid ? taskShapeIdentity(document.task_shape) : null,
    task_shape_dimensions: validation.valid ? { ...document.task_shape } : null,
    observed_at: validation.valid ? document.observed_at : null,
    expires_at: validation.valid ? document.expires_at : null,
    baseline_profile_id: validation.valid ? document.baseline_profile_id : null,
    recommended_profile_id: null,
    fallback_profile_id: validation.valid ? seedProfileForShape(usagePolicy, document.task_shape) : usagePolicy.seed_policy.fallback_profile_id,
    recommendation_mode: usagePolicy.calibration.recommendation_mode,
    confidence: "none",
    evidence_basis: "project-owned-matched-evaluation",
    matched_evaluation: validation.valid,
    statistical_qualification_status: usagePolicy.calibration.statistical_qualification.status,
    candidates: [],
    ...advisoryAuthorityFields(usagePolicy)
  };
  if (!validation.valid) return base;
  if (document.project_id !== project.id) return { ...base, reason: "project-id-mismatch", errors: ["evaluation project does not match the current project"] };

  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const matchedPolicy = matchedEvaluationPolicy(usagePolicy);
  const maximumAge = Date.parse(document.observed_at) + matchedPolicy.maximum_age_days * 24 * 60 * 60 * 1000;
  const staleAt = Math.min(Date.parse(document.expires_at), maximumAge);
  if (!Number.isFinite(now.getTime())) return { ...base, reason: "invalid-evaluation-time", errors: ["evaluation time is invalid"] };
  if (now.getTime() > staleAt) return { ...base, status: "stale", reason: "evaluation-expired", errors: [] };
  if (usagePolicy.objective !== "balanced") return { ...base, status: "not-qualified", reason: "unsupported-policy-objective", errors: [] };

  const statistical = usagePolicy.calibration.statistical_qualification;
  if (statistical.status !== "satisfied") {
    return { ...base, status: "not-qualified", reason: `statistical-qualification-${statistical.status}`, errors: [] };
  }
  const contract = document.decision_contract;
  const contractMatches =
    contract.method === matchedPolicy.supported_method &&
    contract.method === statistical.method &&
    ["minimum_effect", "alpha", "power", "pilot_variance"].every((field) => contract[field] === statistical[field]);
  if (!contractMatches) return { ...base, status: "not-qualified", reason: "statistical-contract-mismatch", errors: [] };

  const profileById = new Map(usagePolicy.seed_policy.profiles.map((profile) => [profile.id, profile]));
  for (const candidate of document.candidates) {
    const profile = profileById.get(candidate.profile_id);
    if (!profile) return { ...base, reason: "candidate-profile-not-in-seed-policy", errors: [`unknown profile ${candidate.profile_id}`] };
    const mappingMatches =
      boundedNonEmpty(profile.provider_id) &&
      profile.provider_id === candidate.provider_id &&
      profile.model === candidate.requested_model &&
      profile.model === candidate.effective_model &&
      profile.reasoning_effort === candidate.requested_reasoning_effort &&
      profile.reasoning_effort === candidate.effective_reasoning_effort;
    if (!mappingMatches) return { ...base, reason: "candidate-profile-mapping-mismatch", errors: [`profile mapping mismatch for ${candidate.profile_id}`] };
  }

  const requiredCaseIds = [...document.rubric.required_case_ids].sort((left, right) => left.localeCompare(right));
  const aggregates = document.candidates.map((candidate) => candidateAggregate(candidate, document.rubric.minimum_score));
  const baseline = aggregates.find((candidate) => candidate.profile_id === document.baseline_profile_id);
  const baselineCases = new Map(baseline.cases.map((item) => [item.case_id, item]));
  for (const candidate of aggregates) {
    const ids = candidate.cases.map((item) => item.case_id);
    if (JSON.stringify(ids) !== JSON.stringify(requiredCaseIds)) {
      return { ...base, reason: "candidate-case-set-mismatch", errors: [`case set mismatch for ${candidate.profile_id}`] };
    }
    for (const item of candidate.cases) {
      const expected = baselineCases.get(item.case_id);
      if (!expected || item.input_digest !== expected.input_digest || item.source_revision !== expected.source_revision) {
        return { ...base, reason: "candidate-case-provenance-mismatch", errors: [`case provenance mismatch for ${candidate.profile_id}:${item.case_id}`] };
      }
    }
  }

  const publicCandidate = (candidate, extra = {}) => ({
    profile_id: candidate.profile_id,
    provider_id: candidate.provider_id,
    requested_model: candidate.requested_model,
    effective_model: candidate.effective_model,
    requested_reasoning_effort: candidate.requested_reasoning_effort,
    effective_reasoning_effort: candidate.effective_reasoning_effort,
    case_count: candidate.case_count,
    quality_gate_passed: candidate.quality_gate_passed,
    average_quality_score: candidate.average_quality_score,
    average_total_tokens: candidate.average_total_tokens,
    average_latency_ms: candidate.average_latency_ms,
    average_rework_count: candidate.average_rework_count,
    average_human_intervention_count: candidate.average_human_intervention_count,
    ...extra
  });

  if (!baseline.quality_gate_passed) {
    return {
      ...base,
      status: "not-qualified",
      reason: "baseline-quality-gate-failed",
      errors: [],
      candidates: aggregates.map((candidate) => publicCandidate(candidate, { qualified: false, rejection_reasons: candidate.quality_gate_passed ? [] : ["quality-gate-failed"] }))
    };
  }
  if (baseline.average_total_tokens <= 0) return { ...base, status: "not-qualified", reason: "baseline-total-tokens-not-positive", errors: [] };

  const evaluated = [];
  for (const candidate of aggregates) {
    if (candidate.profile_id === baseline.profile_id) {
      evaluated.push(publicCandidate(candidate, { qualified: false, baseline: true, token_reduction_ratio: 0, sign_test_p_value: null, wins: 0, losses: 0, ties: candidate.case_count, rejection_reasons: [] }));
      continue;
    }
    let wins = 0;
    let losses = 0;
    let ties = 0;
    for (const item of candidate.cases) {
      const baselineCase = baselineCases.get(item.case_id);
      if (item.total_tokens < baselineCase.total_tokens) wins += 1;
      else if (item.total_tokens > baselineCase.total_tokens) losses += 1;
      else ties += 1;
    }
    const effect = roundMetric((baseline.average_total_tokens - candidate.average_total_tokens) / baseline.average_total_tokens);
    const probability = twoSidedSignTest(wins, losses);
    const rejectionReasons = [
      ...(candidate.quality_gate_passed ? [] : ["quality-gate-failed"]),
      ...(effect >= contract.minimum_effect ? [] : ["minimum-effect-not-met"]),
      ...(probability <= contract.alpha ? [] : ["sign-test-alpha-not-met"])
    ];
    evaluated.push(publicCandidate(candidate, {
      qualified: rejectionReasons.length === 0,
      baseline: false,
      token_reduction_ratio: effect,
      sign_test_p_value: probability,
      wins,
      losses,
      ties,
      rejection_reasons: rejectionReasons
    }));
  }
  const qualified = evaluated
    .filter((candidate) => candidate.qualified)
    .sort((left, right) =>
      left.average_total_tokens - right.average_total_tokens ||
      left.average_latency_ms - right.average_latency_ms ||
      left.average_rework_count - right.average_rework_count ||
      left.average_human_intervention_count - right.average_human_intervention_count ||
      left.profile_id.localeCompare(right.profile_id));
  if (qualified.length === 0) return { ...base, status: "not-qualified", reason: "no-challenger-qualified", errors: [], candidates: evaluated };

  const recommendationMode = usagePolicy.calibration.recommendation_mode;
  return {
    ...base,
    status: recommendationMode === "shadow" ? "qualified-shadow" : "available",
    reason: recommendationMode === "shadow" ? "recommendation-mode-shadow" : "matched-quality-and-resource-contract-satisfied",
    errors: [],
    recommended_profile_id: qualified[0].profile_id,
    confidence: "project-qualified",
    candidates: evaluated
  };
}

function safeMatchedEvaluationPath(value) {
  return typeof value === "string" && value.startsWith(MATCHED_EVALUATION_ROOT) && value.endsWith(".json") && !value.includes("\\") && path.posix.normalize(value) === value;
}

function matchedSourceError(error) {
  if (error?.message === "unsafe-evaluation-source") return "unsafe-evaluation-source";
  if (error?.message === "evaluation-source-too-large") return "evaluation-source-too-large";
  if (error?.code === "ENOENT") return "evaluation-source-missing";
  if (String(error?.message ?? "").startsWith("Invalid JSON")) return "evaluation-source-invalid-json";
  return "evaluation-source-unavailable";
}

async function readMatchedEvaluationSource(target, source) {
  if (!safeMatchedEvaluationPath(source)) throw new Error("unsafe-evaluation-source");
  const repository = await fs.realpath(target);
  const absolute = path.resolve(target, source);
  const metadata = await fs.lstat(absolute);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("unsafe-evaluation-source");
  if (metadata.size > MAX_MATCHED_EVALUATION_BYTES) throw new Error("evaluation-source-too-large");
  const real = await fs.realpath(absolute);
  const relative = path.relative(repository, real);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("unsafe-evaluation-source");
  return readJson(real);
}

export async function readMatchedEvaluationSources(target, usagePolicy, options = {}) {
  const policyValidation = validateUsagePolicy(usagePolicy);
  if (!policyValidation.valid) throw new Error(`Invalid usage policy: ${policyValidation.errors.join("; ")}`);
  const sources = options.sources ?? matchedEvaluationPolicy(usagePolicy).sources;
  const output = [];
  for (const source of [...new Set(sources)].sort((left, right) => left.localeCompare(right))) {
    try {
      output.push({ source, document: await readMatchedEvaluationSource(target, source), error: null });
    } catch (error) {
      output.push({ source, document: null, error: matchedSourceError(error) });
    }
  }
  return output;
}

export function buildMatchedModelAdvisory(project, sourceEntries, usagePolicy, options = {}) {
  const results = (sourceEntries ?? []).map((entry) => entry.error
    ? {
        schema_version: MATCHED_ADVISORY_SCHEMA,
        evaluation_id: null,
        source: entry.source,
        status: "invalid",
        reason: entry.error,
        errors: [entry.error],
        task_shape: null,
        task_shape_dimensions: null,
        observed_at: null,
        expires_at: null,
        baseline_profile_id: null,
        recommended_profile_id: null,
        fallback_profile_id: usagePolicy.seed_policy.fallback_profile_id,
        recommendation_mode: usagePolicy.calibration.recommendation_mode,
        confidence: "none",
        evidence_basis: "project-owned-matched-evaluation",
        matched_evaluation: false,
        statistical_qualification_status: usagePolicy.calibration.statistical_qualification.status,
        candidates: [],
        ...advisoryAuthorityFields(usagePolicy)
      }
    : evaluateMatchedModelEvaluation(project, entry.document, usagePolicy, { ...options, source: entry.source }));
  results.sort((left, right) => String(left.task_shape ?? "").localeCompare(String(right.task_shape ?? "")) || String(left.evaluation_id ?? left.source ?? "").localeCompare(String(right.evaluation_id ?? right.source ?? "")));
  const recommendations = results.filter((result) => result.status === "available");
  const shadowQualified = results.filter((result) => result.status === "qualified-shadow");
  const status = recommendations.length > 0
    ? "available"
    : shadowQualified.length > 0
      ? "qualified-shadow"
      : results.length === 0
        ? "not-configured"
        : results.some((result) => result.status === "stale")
          ? "stale"
          : results.every((result) => result.status === "invalid")
            ? "invalid"
            : "not-qualified";
  return {
    schema_version: "temple.matched-model-advisory-set/v1",
    status,
    reason: status === "not-configured" ? "no-configured-matched-evaluation-sources" : status,
    configured_sources: sourceEntries?.length ?? 0,
    evaluated_sources: results.length,
    qualified_sources: recommendations.length + shadowQualified.length,
    invalid_sources: results.filter((result) => result.status === "invalid").length,
    stale_sources: results.filter((result) => result.status === "stale").length,
    recommendations,
    shadow_qualified: shadowQualified,
    results,
    ...advisoryAuthorityFields(usagePolicy)
  };
}

export async function evaluateMatchedModelFixture(target, fixturePath, options = {}) {
  const [project, usagePolicyResult] = await Promise.all([
    readJson(path.join(target, ".ai-org/project/project.json")),
    readUsagePolicy(target)
  ]);
  const [source] = await readMatchedEvaluationSources(target, usagePolicyResult.policy, { sources: [fixturePath] });
  return source.error
    ? buildMatchedModelAdvisory(project, [source], usagePolicyResult.policy, options).results[0]
    : evaluateMatchedModelEvaluation(project, source.document, usagePolicyResult.policy, { ...options, source: fixturePath });
}

function validSource(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function projectTokenFields(value, options = {}) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    if (options.required) throw new Error(`invalid-${options.field ?? "token-fields"}`);
    return null;
  }
  const projected = {};
  for (const field of TOKEN_FIELDS) {
    const candidate = value[field];
    if (candidate === null || candidate === undefined) continue;
    if (!Number.isSafeInteger(candidate) || candidate < 0) throw new Error(`invalid-${options.field ?? "token-fields"}`);
    projected[field] = candidate;
  }
  if (options.required && Object.keys(projected).length === 0) throw new Error(`invalid-${options.field ?? "token-fields"}`);
  return projected;
}

function projectUsageRecord(record, projectId = null) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) throw new Error("invalid-event");
  if (record.specversion !== "1.0" || record.type !== USAGE_EVENT_TYPE) throw new Error("invalid-event-envelope");
  const id = boundedString(record.id, "event-id");
  if (!validSource(record.source)) throw new Error("invalid-event-source");
  if (!validDateTime(record.time) || !validDateTime(record.templeobservedat)) throw new Error("invalid-event-time");
  if (!Number.isSafeInteger(record.templecursor) || record.templecursor < 1) throw new Error("invalid-event-cursor");
  const data = record.data;
  if (data === null || typeof data !== "object" || Array.isArray(data)) throw new Error("invalid-event-data");
  const observedProjectId = boundedString(data.project_id ?? data.attribution?.project_id, "project-id");
  if (projectId && observedProjectId !== projectId) throw new Error("project-mismatch");
  const attribution = {};
  for (const field of USAGE_DIMENSIONS) {
    const candidate = data.attribution?.[field] ?? data[field] ?? null;
    attribution[field] = candidate === null ? null : boundedString(candidate, `attribution-${field}`);
  }
  const total = projectTokenFields(data.usage?.total, { field: "usage-total" });
  const last = projectTokenFields(data.usage?.last, { field: "usage-last", required: true });
  const modelContextWindow = data.usage?.model_context_window;
  if (modelContextWindow !== null && modelContextWindow !== undefined && (!Number.isSafeInteger(modelContextWindow) || modelContextWindow < 0)) {
    throw new Error("invalid-model-context-window");
  }
  return {
    specversion: "1.0",
    id,
    source: record.source,
    type: USAGE_EVENT_TYPE,
    ...(record.subject ? { subject: boundedString(record.subject, "event-subject", { maxLength: 2048 }) } : {}),
    time: record.time,
    templeobservedat: record.templeobservedat,
    templecursor: record.templecursor,
    data: {
      project_id: observedProjectId,
      work_item_id: attribution.work_item_id,
      task_id: attribution.task_id,
      scope_revision: data.scope_revision === null || data.scope_revision === undefined
        ? null
        : boundedString(data.scope_revision, "scope-revision"),
      attribution,
      usage: {
        total,
        last,
        model_context_window: modelContextWindow ?? null,
        monetary_cost: null,
        price_source: null
      }
    }
  };
}

function archiveWarning(history, code, file = null) {
  if (history.warnings.length >= history.limits.max_warnings) return;
  history.warnings.push({ code, ...(file ? { file } : {}) });
}

async function readArchiveUsageFile(filePath, metadata, options) {
  const fingerprint = `${filePath}\u0000${metadata.dev}\u0000${metadata.ino}\u0000${metadata.size}\u0000${metadata.mtimeMs}\u0000${metadata.ctimeMs}\u0000${options.projectId ?? ""}\u0000${options.maxArchiveLineBytes}`;
  const cached = archiveUsageFileCache.get(fingerprint);
  if (cached) return cached;
  const records = [];
  const input = createReadStream(filePath, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (Buffer.byteLength(line, "utf8") > options.maxArchiveLineBytes) throw new Error("archive-line-too-large");
      if (!/"type"\s*:\s*"org\.temple\.codex\.usage\.updated\.v1"/.test(line)) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new Error("invalid-usage-json");
      }
      if (parsed.type !== USAGE_EVENT_TYPE) continue;
      records.push(projectUsageRecord(parsed, options.projectId));
    }
  } finally {
    lines.close();
    input.destroy();
  }
  const after = await fs.stat(filePath);
  if (
    !after.isFile() ||
    after.dev !== metadata.dev ||
    after.ino !== metadata.ino ||
    after.size !== metadata.size ||
    after.mtimeMs !== metadata.mtimeMs ||
    after.ctimeMs !== metadata.ctimeMs
  ) {
    throw new Error("archive-changed-during-read");
  }
  const result = { records };
  archiveUsageFileCache.set(fingerprint, result);
  return result;
}

async function readArchivedUsageRecords(stateDirectory, projectId, history, limits) {
  if (!stateDirectory) return [];
  const archiveDirectory = path.join(stateDirectory, "archive");
  let entries;
  try {
    entries = await fs.readdir(archiveDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    archiveWarning(history, "archive-directory-unreadable");
    return [];
  }
  const namedEntries = entries
    .filter((entry) => ARCHIVE_FILE_PATTERN.test(entry.name))
    .sort((left, right) => right.name.localeCompare(left.name));
  history.archive_files.discovered = namedEntries.length;
  const candidates = [];
  for (const entry of namedEntries) {
    if (!entry.isFile()) {
      history.archive_files.skipped += 1;
      archiveWarning(history, "unsafe-archive-file-type", entry.name);
      continue;
    }
    const filePath = path.join(archiveDirectory, entry.name);
    try {
      const metadata = await fs.lstat(filePath);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("unsafe-archive-file-type");
      if (metadata.size > limits.maxArchiveBytes) throw new Error("archive-file-too-large");
      candidates.push({ name: entry.name, filePath, metadata });
    } catch (error) {
      history.archive_files.skipped += 1;
      archiveWarning(history, error.message === "archive-file-too-large" ? error.message : "archive-file-unreadable", entry.name);
    }
  }
  const selected = candidates.slice(0, limits.maxArchiveFiles);
  if (candidates.length > selected.length) {
    const skipped = candidates.length - selected.length;
    history.archive_files.skipped += skipped;
    history.archive_files.over_limit += skipped;
    archiveWarning(history, "archive-file-count-limit");
  }
  const records = [];
  let totalBytes = 0;
  for (const candidate of selected) {
    if (totalBytes + candidate.metadata.size > limits.maxTotalArchiveBytes) {
      history.archive_files.skipped += 1;
      history.archive_files.over_limit += 1;
      archiveWarning(history, "archive-total-byte-limit", candidate.name);
      continue;
    }
    totalBytes += candidate.metadata.size;
    history.archive_files.scanned += 1;
    try {
      const result = await readArchiveUsageFile(candidate.filePath, candidate.metadata, {
        ...limits,
        projectId
      });
      history.archive_files.accepted += 1;
      records.push(...result.records.map((record) => ({ record, origin: "archive" })));
    } catch (error) {
      history.archive_files.skipped += 1;
      archiveWarning(history, String(error.message || "invalid-archive-usage-record").slice(0, 96), candidate.name);
    }
  }
  history.archive_bytes_scanned = totalBytes;
  return records;
}

export async function readUsageTelemetryHistory(stateDirectory, activeRecords = [], options = {}) {
  const limits = {
    maxArchiveFiles: options.maxArchiveFiles ?? DEFAULT_ARCHIVE_LIMITS.maxArchiveFiles,
    maxArchiveBytes: options.maxArchiveBytes ?? DEFAULT_ARCHIVE_LIMITS.maxArchiveBytes,
    maxTotalArchiveBytes: options.maxTotalArchiveBytes ?? DEFAULT_ARCHIVE_LIMITS.maxTotalArchiveBytes,
    maxArchiveLineBytes: options.maxArchiveLineBytes ?? DEFAULT_ARCHIVE_LIMITS.maxArchiveLineBytes,
    maxWarnings: options.maxWarnings ?? DEFAULT_ARCHIVE_LIMITS.maxWarnings
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Usage history ${name} must be a positive integer`);
  }
  const history = {
    schema_version: "temple.usage-history/v1",
    status: "active-only",
    active_observations_read: 0,
    archived_observations_read: 0,
    active_observations_included: 0,
    archived_observations_included: 0,
    observations_included: 0,
    duplicates_removed: 0,
    conflicting_identities: 0,
    invalid_active_observations: 0,
    archive_bytes_scanned: 0,
    archive_files: { discovered: 0, scanned: 0, accepted: 0, skipped: 0, over_limit: 0 },
    warnings: [],
    limits: {
      max_archive_files: limits.maxArchiveFiles,
      max_archive_bytes: limits.maxArchiveBytes,
      max_total_archive_bytes: limits.maxTotalArchiveBytes,
      max_archive_line_bytes: limits.maxArchiveLineBytes,
      max_warnings: limits.maxWarnings
    },
    archive_mutation_performed: false,
    canonical_state_changed: false
  };
  const candidates = [];
  for (const record of activeRecords.filter((entry) => entry.type === USAGE_EVENT_TYPE)) {
    try {
      candidates.push({ record: projectUsageRecord(record, options.projectId), origin: "active" });
      history.active_observations_read += 1;
    } catch {
      history.invalid_active_observations += 1;
      archiveWarning(history, "invalid-active-usage-record");
    }
  }
  const archived = await readArchivedUsageRecords(stateDirectory, options.projectId ?? null, history, limits);
  history.archived_observations_read = archived.length;
  candidates.push(...archived);

  const byIdentity = new Map();
  const conflicts = new Set();
  for (const candidate of candidates) {
    const identity = usageEventIdentity(candidate.record);
    if (conflicts.has(identity)) continue;
    const existing = byIdentity.get(identity);
    if (!existing) {
      byIdentity.set(identity, { ...candidate, origins: new Set([candidate.origin]) });
      continue;
    }
    if (comparableUsageRecord(existing.record) === comparableUsageRecord(candidate.record)) {
      existing.origins.add(candidate.origin);
      history.duplicates_removed += 1;
      continue;
    }
    byIdentity.delete(identity);
    conflicts.add(identity);
    history.conflicting_identities += 1;
    archiveWarning(history, "usage-event-identity-conflict");
  }
  const included = [...byIdentity.values()];
  history.active_observations_included = included.filter((entry) => entry.origins.has("active")).length;
  history.archived_observations_included = included.filter((entry) => entry.origins.has("archive") && !entry.origins.has("active")).length;
  history.observations_included = included.length;
  const partial = history.archive_files.skipped > 0 || history.invalid_active_observations > 0 || history.conflicting_identities > 0;
  history.status = partial ? "partial" : history.archive_files.accepted > 0 ? "complete" : "active-only";
  const records = included
    .map((entry) => entry.record)
    .sort((left, right) =>
      String(left.templeobservedat).localeCompare(String(right.templeobservedat)) ||
      String(left.time).localeCompare(String(right.time)) ||
      left.source.localeCompare(right.source) ||
      left.id.localeCompare(right.id));
  return {
    records,
    history,
    activeJournal: {
      first_cursor: activeRecords[0]?.templecursor ?? null,
      last_cursor: activeRecords.at(-1)?.templecursor ?? 0
    }
  };
}

function usageRecordsFrom(records) {
  return records.filter((record) => record.type === USAGE_EVENT_TYPE && record.data?.usage);
}

function zeroTokens() {
  return Object.fromEntries(TOKEN_FIELDS.map((field) => [field, 0]));
}

function zeroTokenSamples() {
  return Object.fromEntries(TOKEN_FIELDS.map((field) => [field, 0]));
}

function addTokens(target, samples, source) {
  for (const field of TOKEN_FIELDS) {
    if (!Number.isFinite(source?.[field]) || source[field] < 0) continue;
    target[field] += source[field];
    samples[field] += 1;
  }
}

function finalizeTokens(tokens, samples, expectedSamples) {
  return Object.fromEntries(TOKEN_FIELDS.map((field) => [
    field,
    samples[field] > 0 && samples[field] === expectedSamples ? tokens[field] : null
  ]));
}

function dimensionsFor(record) {
  const attribution = record.data?.attribution ?? {};
  return Object.fromEntries(USAGE_DIMENSIONS.map((field) => [field, attribution[field] ?? record.data?.[field] ?? null]));
}

function correlateRegisteredTaskUsage(registeredTasks, usageRecords) {
  const registeredTaskById = new Map(registeredTasks.map((task) => [task.id, task]));
  const correlatedRecords = [];
  for (const record of usageRecords) {
    const dimensions = dimensionsFor(record);
    const task = registeredTaskById.get(dimensions.task_id);
    if (!task || task.work_item_id !== dimensions.work_item_id) continue;
    correlatedRecords.push({ record, workItemId: dimensions.work_item_id, task });
  }
  return correlatedRecords;
}

function sortedUnique(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))].sort((left, right) => left.localeCompare(right));
}

function tokenFieldCoverage(usageRecords, correlatedRecords) {
  return Object.fromEntries(TOKEN_FIELDS.map((field) => {
    const observed = usageRecords.filter((record) => Number.isFinite(record.data?.usage?.last?.[field]) && record.data.usage.last[field] >= 0);
    const correlated = correlatedRecords.filter(({ record }) => Number.isFinite(record.data?.usage?.last?.[field]) && record.data.usage.last[field] >= 0);
    return [field, {
      support_status: observed.length === 0 ? "unknown" : observed.length === usageRecords.length ? "observed" : "partial",
      observations_with_value: observed.length,
      correlated_observations_with_value: correlated.length,
      correlated_work_items_with_value: sortedUnique(correlated.map(({ workItemId }) => workItemId)).length
    }];
  }));
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function knownString(value) {
  return nonEmptyString(value) && value !== "unknown";
}

function taskShapeFor(dimensions) {
  if (knownString(dimensions.task_shape_id)) return { id: dimensions.task_shape_id, source: "explicit" };
  if (!knownString(dimensions.position_id) || !knownString(dimensions.lifecycle_stage)) return null;
  return { id: `${dimensions.position_id}:${dimensions.lifecycle_stage}`, source: "fallback-position-stage" };
}

function qualificationSamples(correlatedRecords, completedItemIdSet) {
  const staleRecords = [];
  const incompleteRecords = [];
  const candidatesByWorkItem = new Map();
  for (const entry of correlatedRecords) {
    const { record, task, workItemId } = entry;
    const dimensions = dimensionsFor(record);
    const observedRevision = record.data?.scope_revision;
    const expectedRevision = task.launch_revision ?? task.current_revision;
    if (nonEmptyString(expectedRevision) && nonEmptyString(observedRevision) && expectedRevision !== observedRevision) {
      staleRecords.push(entry);
      continue;
    }
    const revisionProven = nonEmptyString(expectedRevision) && observedRevision === expectedRevision;
    const totalTokens = record.data?.usage?.last?.total_tokens;
    const taskShape = taskShapeFor(dimensions);
    const complete = completedItemIdSet.has(workItemId) && task.status === "completed";
    const positionMatches = knownString(task.position_id) && dimensions.position_id === task.position_id;
    if (!complete || !revisionProven || !positionMatches || !Number.isFinite(totalTokens) || totalTokens < 0 || !knownString(dimensions.model) || !taskShape) {
      incompleteRecords.push(entry);
      continue;
    }
    const candidate = candidatesByWorkItem.get(workItemId) ?? [];
    candidate.push({
      work_item_id: workItemId,
      task_id: task.id,
      task_shape: taskShape.id,
      task_shape_source: taskShape.source,
      model: dimensions.model,
      total_tokens: totalTokens
    });
    candidatesByWorkItem.set(workItemId, candidate);
  }

  const samples = [];
  for (const [workItemId, candidates] of [...candidatesByWorkItem.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const identities = sortedUnique(candidates.map((candidate) => `${candidate.task_id}\u0000${candidate.task_shape}\u0000${candidate.model}`));
    if (identities.length !== 1) {
      incompleteRecords.push(...candidates.map((candidate) => ({ workItemId, candidate })));
      continue;
    }
    const first = candidates[0];
    samples.push({
      work_item_id: workItemId,
      task_id: first.task_id,
      task_shape: first.task_shape,
      task_shape_source: first.task_shape_source,
      model: first.model,
      observations: candidates.length,
      total_tokens: candidates.reduce((sum, candidate) => sum + candidate.total_tokens, 0)
    });
  }
  return { samples, staleRecords, incompleteRecords };
}

function buildReadOnlyRecommendation(samples, thresholdMet, usagePolicy) {
  const mode = usagePolicy.calibration.recommendation_mode;
  const statisticalStatus = usagePolicy.calibration.statistical_qualification.status;
  const minimumSamples = usagePolicy.calibration.observation_threshold.samples_per_candidate;
  const base = {
    status: "not-qualified",
    mode,
    task_shape: null,
    recommended_model: null,
    compared_models: [],
    qualified_samples: 0,
    reason: thresholdMet ? "insufficient-comparable-model-evidence" : "longitudinal-threshold-not-met",
    confidence: "none",
    evidence_basis: "accepted-closeout-token-observation-only",
    matched_evaluation: false,
    statistical_qualification_status: statisticalStatus,
    automatic_routing_eligible: false,
    routing_authority: false,
    automatic_routing: false,
    model_switch_performed: false,
    budget_can_skip_gates: false,
    context_required: true,
    developer_evidence_required: true,
    independent_qa_required: true,
    approval_mode: usagePolicy.autonomy.mode,
    routine_human_approval_required: false,
    routing_change_requires_approval: true,
    approval_triggers: usagePolicy.autonomy.approval_triggers,
    human_approval_required: false,
    release_authority_granted: false
  };
  if (!thresholdMet) return base;

  const byShapeAndModel = new Map();
  for (const sample of samples) {
    const key = `${sample.task_shape}\u0000${sample.model}`;
    const group = byShapeAndModel.get(key) ?? {
      task_shape: sample.task_shape,
      model: sample.model,
      work_items: new Set(),
      total_tokens: 0
    };
    group.work_items.add(sample.work_item_id);
    group.total_tokens += sample.total_tokens;
    byShapeAndModel.set(key, group);
  }
  const comparableByShape = new Map();
  for (const group of byShapeAndModel.values()) {
    if (group.work_items.size < minimumSamples) continue;
    const models = comparableByShape.get(group.task_shape) ?? [];
    models.push({
      model: group.model,
      samples: group.work_items.size,
      average_total_tokens: group.total_tokens / group.work_items.size
    });
    comparableByShape.set(group.task_shape, models);
  }
  const comparisons = [...comparableByShape.entries()]
    .filter(([, models]) => models.length >= 2)
    .map(([taskShape, models]) => ({
      task_shape: taskShape,
      models: models.sort((left, right) =>
        left.average_total_tokens - right.average_total_tokens || left.model.localeCompare(right.model))
    }))
    .sort((left, right) => left.task_shape.localeCompare(right.task_shape));
  if (comparisons.length === 0) return base;
  const comparison = comparisons[0];
  const winner = comparison.models[0];
  const runnerUp = comparison.models[1];
  if (winner.average_total_tokens >= runnerUp.average_total_tokens) {
    return { ...base, reason: "no-observed-token-difference" };
  }
  return {
    ...base,
    status: "available",
    task_shape: comparison.task_shape,
    recommended_model: winner.model,
    compared_models: comparison.models.map((model) => model.model),
    qualified_samples: comparison.models.reduce((total, model) => total + model.samples, 0),
    reason: "exploratory-lower-observed-token-candidate",
    confidence: "low"
  };
}

function buildLongitudinalCoverage(workItems = [], tasks = [], usageRecords = [], options = {}) {
  const usagePolicy = options.usagePolicy ?? defaultUsagePolicy();
  const policyValidation = validateUsagePolicy(usagePolicy);
  if (!policyValidation.valid) throw new Error(`Invalid usage policy: ${policyValidation.errors.join("; ")}`);
  const canonicalItems = [...workItems]
    .filter((item) => typeof item?.id === "string" && item.id.trim())
    .sort((left, right) => left.id.localeCompare(right.id));
  const canonicalItemIds = new Set(canonicalItems.map((item) => item.id));
  const completedItemIds = sortedUnique(canonicalItems.filter((item) => item.state === "done").map((item) => item.id));
  const completedItemIdSet = new Set(completedItemIds);
  const topology = classifyCodexTasks(tasks, { workItems: canonicalItems });
  const registeredTasks = [...topology.registered].sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const registeredWorkItemIds = sortedUnique(registeredTasks.map((task) => task.work_item_id).filter((id) => canonicalItemIds.has(id)));
  const completedWithRegisteredTaskIds = registeredWorkItemIds.filter((id) => completedItemIdSet.has(id));
  const liveTaskIds = new Set(topology.live_resumable.map((task) => task.id));
  const historicalOnlyTasks = topology.history_reconcilable.filter((task) => !liveTaskIds.has(task.id));
  const correlatedRecords = correlateRegisteredTaskUsage(registeredTasks, usageRecords);
  const correlatedWorkItemIds = sortedUnique(correlatedRecords.map(({ workItemId }) => workItemId));
  const correlatedCompletedWorkItemIds = correlatedWorkItemIds.filter((id) => completedItemIdSet.has(id));
  const requiredWorkItems = Number.isInteger(options.longitudinalWorkItemsRequired) && options.longitudinalWorkItemsRequired > 0
    ? options.longitudinalWorkItemsRequired
    : usagePolicy.calibration.observation_threshold.completed_work_items;
  const requiredTaskShapes = usagePolicy.calibration.observation_threshold.task_shapes;
  const qualificationEvidence = qualificationSamples(correlatedRecords, completedItemIdSet);
  const qualifiedWorkItemIds = sortedUnique(qualificationEvidence.samples.map((sample) => sample.work_item_id));
  const qualifiedTaskShapes = sortedUnique(qualificationEvidence.samples.map((sample) => sample.task_shape));
  const explicitTaskShapeSamples = qualificationEvidence.samples.filter((sample) => sample.task_shape_source === "explicit");
  const thresholdMet = qualifiedWorkItemIds.length >= requiredWorkItems && qualifiedTaskShapes.length >= requiredTaskShapes;
  const recommendation = buildReadOnlyRecommendation(qualificationEvidence.samples, thresholdMet, usagePolicy);
  const matchedAdvisory = options.matchedAdvisory ?? buildMatchedModelAdvisory({ id: options.projectId ?? "unknown" }, [], usagePolicy, options);
  const matchedEvaluationAvailable = ["available", "qualified-shadow"].includes(matchedAdvisory.status);
  const statisticalStatus = usagePolicy.calibration.statistical_qualification.status;
  const promotionBlockers = [
    ...(thresholdMet ? [] : ["diagnostic-observation-threshold-not-met"]),
    ...(explicitTaskShapeSamples.length === qualificationEvidence.samples.length && qualificationEvidence.samples.length > 0
      ? []
      : ["exact-task-shape-evidence-missing"]),
    ...(statisticalStatus === "satisfied" ? [] : [`statistical-qualification-${statisticalStatus}`]),
    ...(matchedEvaluationAvailable ? [] : ["matched-quality-evaluation-missing"]),
    ...(usagePolicy.calibration.recommendation_mode === "automatic" ? [] : [`recommendation-mode-${usagePolicy.calibration.recommendation_mode}`])
  ];
  const remainingObserved = Math.max(0, requiredWorkItems - correlatedWorkItemIds.length);
  const remainingCompletedObserved = Math.max(0, requiredWorkItems - qualifiedWorkItemIds.length);
  return {
    schema_version: "temple.usage-longitudinal-coverage/v1",
    canonical_work_items: {
      total: canonicalItems.length,
      completed: completedItemIds.length,
      completed_ids: completedItemIds
    },
    registered_task_coverage: {
      registered_tasks: registeredTasks.length,
      registered_work_items: registeredWorkItemIds.length,
      registered_work_item_ids: registeredWorkItemIds,
      completed_work_items_with_registered_task: completedWithRegisteredTaskIds.length,
      completed_work_item_ids_with_registered_task: completedWithRegisteredTaskIds,
      completed_work_item_coverage_ratio: completedItemIds.length > 0
        ? completedWithRegisteredTaskIds.length / completedItemIds.length
        : null
    },
    task_eligibility: {
      live_resumable: topology.live_resumable.length,
      live_resumable_task_ids: sortedUnique(topology.live_resumable.map((task) => task.id)),
      history_reconcilable: topology.history_reconcilable.length,
      history_reconcilable_task_ids: sortedUnique(topology.history_reconcilable.map((task) => task.id)),
      historical_only: historicalOnlyTasks.length,
      historical_only_task_ids: sortedUnique(historicalOnlyTasks.map((task) => task.id)),
      terminal: topology.terminal.length,
      detached_archived: topology.registered.length - topology.history_reconcilable.length
    },
    detailed_token_observation_coverage: {
      observations: usageRecords.length,
      correlated_observations: correlatedRecords.length,
      uncorrelated_observations: usageRecords.length - correlatedRecords.length,
      correlated_work_items: correlatedWorkItemIds.length,
      correlated_work_item_ids: correlatedWorkItemIds,
      correlated_completed_work_items: correlatedCompletedWorkItemIds.length,
      correlated_completed_work_item_ids: correlatedCompletedWorkItemIds,
      stale_observations: qualificationEvidence.staleRecords.length,
      incomplete_qualification_observations: qualificationEvidence.incompleteRecords.length,
      qualified_completed_work_items: qualifiedWorkItemIds.length,
      qualified_completed_work_item_ids: qualifiedWorkItemIds,
      qualified_task_shapes: qualifiedTaskShapes.length,
      qualified_task_shape_ids: qualifiedTaskShapes,
      token_fields: tokenFieldCoverage(usageRecords, correlatedRecords)
    },
    qualification: {
      status: thresholdMet ? "qualified" : "not-qualified",
      required_correlated_work_items: requiredWorkItems,
      remaining_correlated_work_items: remainingObserved,
      remaining_correlated_completed_work_items: remainingCompletedObserved,
      completed_coverage_threshold_met: qualifiedWorkItemIds.length >= requiredWorkItems,
      varied_task_shapes: qualifiedTaskShapes.length >= requiredTaskShapes ? "qualified" : "insufficient",
      longitudinal_comparison: recommendation.status === "available" ? "exploratory-only" : "insufficient",
      observation_threshold_purpose: usagePolicy.calibration.observation_threshold.purpose,
      savings_claim_allowed: false,
      cost_claim_allowed: false,
      model_quality_claim_allowed: false,
      routing_claim_allowed: false
    },
    calibration: {
      state: usagePolicy.calibration.state,
      recommendation_mode: usagePolicy.calibration.recommendation_mode,
      diagnostic_observation_threshold_met: thresholdMet,
      exact_task_shape_samples: explicitTaskShapeSamples.length,
      statistical_qualification_status: statisticalStatus,
      matched_evaluation_available: matchedEvaluationAvailable,
      automatic_routing_eligible: false,
      promotion_blockers: sortedUnique(promotionBlockers)
    },
    recommendation
  };
}

export function buildUsageBaselineFromRecords(project, records, options = {}) {
  const usagePolicy = options.usagePolicy ?? defaultUsagePolicy();
  const policyValidation = validateUsagePolicy(usagePolicy);
  if (!policyValidation.valid) throw new Error(`Invalid usage policy: ${policyValidation.errors.join("; ")}`);
  const policy = usagePolicyProjection(usagePolicy, options.usagePolicySource ?? "framework-default");
  const matchedAdvisory = buildMatchedModelAdvisory(project, options.matchedEvaluationSources ?? [], usagePolicy, options);
  const usageRecords = usageRecordsFrom(records);
  const groups = new Map();
  const unknownDimensions = Object.fromEntries(USAGE_DIMENSIONS.map((field) => [field, 0]));
  const totals = zeroTokens();
  const totalSamples = zeroTokenSamples();
  for (const record of usageRecords) {
    const dimensions = dimensionsFor(record);
    for (const field of USAGE_DIMENSIONS) if (dimensions[field] === null || dimensions[field] === "unknown") unknownDimensions[field] += 1;
    const delta = record.data.usage.last ?? {};
    addTokens(totals, totalSamples, delta);
    const key = JSON.stringify(dimensions);
    const group = groups.get(key) ?? {
      dimensions,
      observations: 0,
      tokens: zeroTokens(),
      tokenSamples: zeroTokenSamples(),
      first_observed_at: record.templeobservedat,
      last_observed_at: record.templeobservedat
    };
    group.observations += 1;
    addTokens(group.tokens, group.tokenSamples, delta);
    group.first_observed_at = String(group.first_observed_at).localeCompare(String(record.templeobservedat)) <= 0 ? group.first_observed_at : record.templeobservedat;
    group.last_observed_at = String(group.last_observed_at).localeCompare(String(record.templeobservedat)) >= 0 ? group.last_observed_at : record.templeobservedat;
    groups.set(key, group);
  }
  const finalTotals = finalizeTokens(totals, totalSamples, usageRecords.length);
  const driverGroups = [...groups.values()]
    .map(({ tokenSamples, tokens, ...group }) => ({ ...group, tokens: finalizeTokens(tokens, tokenSamples, group.observations) }))
    .sort((left, right) => (right.tokens.total_tokens ?? -1) - (left.tokens.total_tokens ?? -1) || JSON.stringify(left.dimensions).localeCompare(JSON.stringify(right.dimensions)));
  const cachedDenominator = finalTotals.input_tokens !== null && finalTotals.cached_input_tokens !== null
    ? finalTotals.input_tokens + finalTotals.cached_input_tokens
    : null;
  const longitudinalCoverage = buildLongitudinalCoverage(options.workItems, options.tasks, usageRecords, {
    ...options,
    usagePolicy,
    projectId: project.id,
    matchedAdvisory
  });
  const captureHealth = buildUsageCaptureHealth(
    options.providers ?? [],
    options.tasks ?? [],
    options.workItems ?? [],
    usageRecords,
    longitudinalCoverage,
    options.observationContext
  );
  const matchedAvailable = matchedAdvisory.status === "available";
  const shadowAvailable = longitudinalCoverage.recommendation.status === "available";
  return {
    schema_version: "temple.usage-baseline/v1",
    generated_at: new Date().toISOString(),
    project: { id: project.id, name: project.name },
    baseline_status: usageRecords.length > 0 ? "observed" : "insufficient-data",
    source: {
      kind: "provider-reported",
      state_directory: options.stateDirectory ?? null,
      first_cursor: options.activeJournal?.first_cursor ?? records[0]?.templecursor ?? null,
      last_cursor: options.activeJournal?.last_cursor ?? records.at(-1)?.templecursor ?? 0,
      observations: usageRecords.length,
      aggregation_basis: "provider-last-usage-delta",
      capture_health: captureHealth,
      history: options.history ?? {
        schema_version: "temple.usage-history/v1",
        status: "active-only",
        active_observations_read: usageRecords.length,
        archived_observations_read: 0,
        active_observations_included: usageRecords.length,
        archived_observations_included: 0,
        observations_included: usageRecords.length,
        duplicates_removed: 0,
        conflicting_identities: 0,
        invalid_active_observations: 0,
        archive_files: { discovered: 0, scanned: 0, accepted: 0, skipped: 0, over_limit: 0 },
        warnings: [],
        archive_mutation_performed: false,
        canonical_state_changed: false
      },
      longitudinal_coverage: longitudinalCoverage
    },
    totals: {
      ...finalTotals,
      cached_input_ratio: cachedDenominator !== null && cachedDenominator > 0 ? finalTotals.cached_input_tokens / cachedDenominator : null,
      monetary_cost: null,
      price_source: null,
      cost_status: "unknown"
    },
    unknown_dimensions: unknownDimensions,
    driver_groups: driverGroups,
    policy,
    routing: {
      recommendation_status: matchedAvailable ? "available" : longitudinalCoverage.recommendation.status,
      recommendation_source: matchedAvailable ? "matched-evaluation" : shadowAvailable ? "observational-shadow" : null,
      recommendation_mode: usagePolicy.calibration.recommendation_mode,
      shadow_recommendation: longitudinalCoverage.recommendation,
      matched_advisory: matchedAdvisory,
      execution_status: "not-implemented",
      automatic_routing: false,
      budget_can_skip_gates: false,
      model_switch_performed: false,
      approval_mode: usagePolicy.autonomy.mode,
      routine_human_approval_required: false,
      approval_triggers: usagePolicy.autonomy.approval_triggers
    },
    privacy: {
      raw_prompts_retained: false,
      hidden_reasoning_retained: false,
      source_bodies_retained: false,
      tool_payloads_retained: false,
      credentials_retained: false
    },
    canonical_state_changed: false,
    external_action_performed: false
  };
}

function buildCaptureGap(workItems, longitudinalCoverage, observationContext) {
  const mode = observationContext?.mode ?? "off";
  const startedAt = observationContext?.started_at ?? null;
  const boundary = typeof startedAt === "string" ? Date.parse(startedAt) : Number.NaN;
  if (mode === "off" || !Number.isFinite(boundary)) {
    return {
      status: "not-applicable",
      completed_since_observation_started: 0,
      captured_completed_since_observation_started: 0,
      uncaptured_completed_since_observation_started: 0,
      uncaptured_work_item_ids: [],
      work_item_backfill_supported: false,
      account_usage_allocation: "unallocated"
    };
  }
  const completed = [...workItems]
    .filter((item) => item?.state === "done" && typeof item.id === "string" && Number.isFinite(Date.parse(item.updated_at)))
    .filter((item) => Date.parse(item.updated_at) >= boundary)
    .map((item) => item.id)
    .sort((left, right) => left.localeCompare(right));
  const captured = new Set(
    longitudinalCoverage?.detailed_token_observation_coverage?.correlated_completed_work_item_ids ?? []
  );
  const capturedAfterStart = completed.filter((id) => captured.has(id));
  const uncaptured = completed.filter((id) => !captured.has(id));
  return {
    status: uncaptured.length > 0 ? "unobserved-completed-work" : "clear",
    completed_since_observation_started: completed.length,
    captured_completed_since_observation_started: capturedAfterStart.length,
    uncaptured_completed_since_observation_started: uncaptured.length,
    uncaptured_work_item_ids: uncaptured,
    work_item_backfill_supported: false,
    account_usage_allocation: "unallocated"
  };
}

function buildUsageCaptureHealth(providers, tasks, workItems, usageRecords, longitudinalCoverage = null, observationContext = null) {
  const provider = providers.find((entry) => entry.kind === "codex-app-server" || entry.id === "codex-local") ?? null;
  const providerStatus = provider?.status ?? "unobserved";
  const tokenCapability = provider?.capabilities?.token_usage ?? "unknown";
  const topology = classifyCodexTasks(tasks, { workItems });
  const providerReady = providerStatus === "ready" && tokenCapability === "supported";
  const liveTasks = topology.live_resumable.length;
  const observations = usageRecords.length;
  const observedTimes = usageRecords
    .map((record) => record.templeobservedat ?? record.time ?? null)
    .filter((value) => typeof value === "string" && value.length > 0)
    .sort();
  const lastObservedAt = observedTimes.at(-1) ?? null;
  const coverage = longitudinalCoverage ?? buildLongitudinalCoverage(workItems, tasks, usageRecords);
  const capturedCompleted = coverage.detailed_token_observation_coverage?.correlated_completed_work_items ?? 0;
  const completed = coverage.canonical_work_items?.completed ?? 0;
  const normalizedObservationContext = {
    mode: observationContext?.mode ?? "off",
    started_at: observationContext?.started_at ?? null,
    continuous_expected: Boolean(observationContext?.continuous_expected),
    service_status: observationContext?.service_status ?? "not-installed"
  };

  let status;
  let reason;
  if (providerReady && liveTasks > 0) {
    status = "capturing";
    reason = "provider-ready-with-live-task";
  } else if (providerReady) {
    status = "ready-no-live-task";
    reason = "no-live-registered-task";
  } else if (observations > 0) {
    status = "historical-only";
    reason = !provider
      ? "provider-unobserved"
      : tokenCapability !== "supported"
        ? "token-usage-capability-unavailable"
        : `provider-${providerStatus}`;
  } else {
    status = "not-capturing";
    reason = !provider
      ? "provider-unobserved"
      : tokenCapability !== "supported"
        ? "token-usage-capability-unavailable"
        : liveTasks > 0
          ? "live-task-without-ready-provider"
          : `provider-${providerStatus}`;
  }

  return {
    schema_version: "temple.usage-capture-health/v1",
    status,
    provider_id: provider?.id ?? "codex-local",
    provider_status: providerStatus,
    token_usage_capability: tokenCapability,
    provider_detail: provider?.degraded_reason ?? null,
    reason,
    live_resumable_tasks: liveTasks,
    observations,
    last_observed_at: lastObservedAt,
    captured_completed_work_items: capturedCompleted,
    completed_work_items: completed,
    completed_work_item_coverage_ratio: completed > 0 ? capturedCompleted / completed : null,
    observation_mode: normalizedObservationContext.mode,
    observation_started_at: normalizedObservationContext.started_at,
    continuous_observation_expected: normalizedObservationContext.continuous_expected,
    service_status: normalizedObservationContext.service_status,
    capture_gap: buildCaptureGap(workItems, coverage, normalizedObservationContext)
  };
}

function unavailableAccountProbe(requested = false, reason = null) {
  return {
    requested,
    availability: requested ? "unavailable" : "not-probed",
    scope: "account-wide",
    allocation: "unallocated",
    summary_fields: [],
    non_null_summary_fields: [],
    daily_buckets_available: null,
    daily_bucket_count: null,
    latency_ms: null,
    model_generation_requested: false,
    raw_values_retained: false,
    reason
  };
}

function probeFailureReason(error) {
  const message = String(error?.message ?? "").toLowerCase();
  if (message.includes("timed out")) return "request-timed-out";
  if (message.includes("initialize")) return "initialization-failed";
  if (message.includes("account/usage/read")) return "account-usage-read-failed";
  return "provider-unavailable";
}

export async function probeCodexAccountUsage(target, options = {}) {
  const startedAt = Date.now();
  let connection = null;
  try {
    const factory = options.connectionFactory ?? ((command, args, connectionOptions) =>
      createJsonRpcProcess(command, args, connectionOptions));
    connection = await factory(
      options.command ?? "codex",
      options.commandArgs ?? ["app-server", "--stdio"],
      { cwd: target }
    );
    const initialized = await connection.request("initialize", {
      clientInfo: {
        name: "temple-usage-preflight",
        title: "Temple Usage Preflight",
        version: options.version ?? "unknown"
      },
      capabilities: { experimentalApi: false }
    });
    connection.notify?.("initialized", {});
    const result = await connection.request("account/usage/read", {});
    const summary = result?.summary && typeof result.summary === "object" ? result.summary : null;
    const dailyBuckets = Array.isArray(result?.dailyUsageBuckets) ? result.dailyUsageBuckets : null;
    return {
      requested: true,
      availability: "available",
      scope: "account-wide",
      allocation: "unallocated",
      server_version_present: Boolean(initialized?.serverInfo?.version ?? initialized?.userAgent),
      summary_fields: summary ? Object.keys(summary).sort() : [],
      non_null_summary_fields: summary
        ? Object.entries(summary).filter(([, value]) => value !== null).map(([field]) => field).sort()
        : [],
      daily_buckets_available: dailyBuckets !== null,
      daily_bucket_count: dailyBuckets?.length ?? null,
      latency_ms: Math.max(0, Date.now() - startedAt),
      model_generation_requested: false,
      raw_values_retained: false,
      reason: null
    };
  } catch (error) {
    return {
      ...unavailableAccountProbe(true, probeFailureReason(error)),
      latency_ms: Math.max(0, Date.now() - startedAt)
    };
  } finally {
    await connection?.close?.().catch(() => {});
  }
}

export function buildUsagePreflightFromRecords(project, tasks, records, providers = [], accountProbe = null, options = {}) {
  const usagePolicy = options.usagePolicy ?? defaultUsagePolicy();
  const policyValidation = validateUsagePolicy(usagePolicy);
  if (!policyValidation.valid) throw new Error(`Invalid usage policy: ${policyValidation.errors.join("; ")}`);
  const policy = usagePolicyProjection(usagePolicy, options.usagePolicySource ?? "framework-default");
  const matchedAdvisory = buildMatchedModelAdvisory(project, options.matchedEvaluationSources ?? [], usagePolicy, options);
  const topology = classifyCodexTasks(tasks, { workItems: options.workItems });
  const usageRecords = usageRecordsFrom(records);
  const longitudinalCoverage = buildLongitudinalCoverage(options.workItems, tasks, usageRecords, {
    ...options,
    usagePolicy,
    projectId: project.id,
    matchedAdvisory
  });
  const codexProvider = providers.find((provider) => provider.kind === "codex-app-server" || provider.id === "codex-local") ?? null;
  const tokenCapability = codexProvider?.capabilities?.token_usage ?? "unknown";
  const correlated = correlateRegisteredTaskUsage(topology.registered, usageRecords);
  const captureHealth = buildUsageCaptureHealth(
    providers,
    tasks,
    options.workItems ?? [],
    usageRecords,
    longitudinalCoverage,
    options.observationContext
  );
  const detailedStatus = captureHealth.status;
  const probe = accountProbe ?? unavailableAccountProbe(false);
  const nextAction = matchedAdvisory.status === "available"
    ? "Review the matched advisory and its bounded evidence; no model switch is authorized or performed."
    : matchedAdvisory.status === "qualified-shadow"
      ? "The matched evaluation is qualified in shadow mode; changing project policy to advisory is a separate policy decision and still performs no model switch."
      : usageRecords.length > 0 && ["capturing", "ready-no-live-task"].includes(detailedStatus)
    ? longitudinalCoverage.qualification.status === "qualified"
      ? "Review the shadow recommendation and its evidence gaps; routine observation needs no approval and no model switch is authorized."
      : "Accumulate varied, completed, revision-current real Work Items before comparing usage or recommending a model."
    : detailedStatus === "capturing"
      ? "Run a real turn on the provider-owned active task and check for a detailed usage notification."
      : detailedStatus === "ready-no-live-task"
        ? "Use a provider-owned active task or a future Codex host event bridge; registration alone does not create a live subscription."
        : detailedStatus === "historical-only"
          ? "Enable the Codex Provider before the next registered task starts; retained totals cannot represent work that was not observed."
          : "Restore the configured Codex Provider before attempting a detailed usage baseline.";
  return {
    schema_version: "temple.usage-preflight/v1",
    generated_at: new Date().toISOString(),
    project: { id: project.id, name: project.name },
    protocol: {
      official_documentation: "https://developers.openai.com/codex/app-server/",
      detailed_notification: "thread/tokenUsage/updated",
      account_method: "account/usage/read"
    },
    provider: codexProvider
      ? {
          id: codexProvider.id,
          status: codexProvider.status,
          token_usage_capability: tokenCapability,
          detected_cli_version: codexProvider.protocol?.detected_cli_version ?? null,
          degraded_reason: codexProvider.degraded_reason ?? null
        }
      : {
          id: "codex-local",
          status: "unobserved",
          token_usage_capability: "unknown",
          detected_cli_version: null,
          degraded_reason: "provider-registry-unavailable"
        },
    task_topology: {
      registered: topology.registered.length,
      history_reconcilable: topology.history_reconcilable.length,
      live_resumable: topology.live_resumable.length,
      terminal: topology.terminal.length,
      non_live: topology.non_live.length,
      live_task_ids: topology.live_resumable.map((task) => task.id),
      terminal_task_ids: topology.terminal.map((task) => task.id),
      terminal_tasks_are_live_resumable: false
    },
    detailed_thread_usage: {
      status: detailedStatus,
      evidence_status: usageRecords.length > 0 ? "observed" : "none",
      scope: "registered-provider-active-thread",
      allocation: "work-item-capable",
      observations: usageRecords.length,
      correlated_observations: correlated.length,
      uncorrelated_observations: usageRecords.length - correlated.length,
      aggregation_basis: "provider-last-usage-delta"
    },
    capture_health: captureHealth,
    account_usage: probe,
    baseline_qualification: {
      status: longitudinalCoverage.qualification.status,
      requires_detailed_thread_usage: true,
      account_usage_can_qualify: false,
      longitudinal_work_items_required: longitudinalCoverage.qualification.required_correlated_work_items,
      qualified_completed_work_items: longitudinalCoverage.detailed_token_observation_coverage.qualified_completed_work_items,
      remaining_qualified_completed_work_items: longitudinalCoverage.qualification.remaining_correlated_completed_work_items,
      savings_claim_allowed: false
    },
    measurement_overhead: {
      account_probe_latency_ms: probe.latency_ms,
      model_generation_requested: false,
      token_counting_model_call_performed: false
    },
    policy,
    routing: {
      recommendation_status: matchedAdvisory.status === "available" ? "available" : longitudinalCoverage.recommendation.status,
      recommendation_source: matchedAdvisory.status === "available"
        ? "matched-evaluation"
        : longitudinalCoverage.recommendation.status === "available"
          ? "observational-shadow"
          : null,
      recommendation: longitudinalCoverage.recommendation,
      recommendation_mode: usagePolicy.calibration.recommendation_mode,
      shadow_recommendation: longitudinalCoverage.recommendation,
      matched_advisory: matchedAdvisory,
      execution_status: "not-implemented",
      automatic_routing: false,
      model_switch_performed: false,
      budget_can_skip_gates: false,
      approval_mode: usagePolicy.autonomy.mode,
      routine_human_approval_required: false,
      approval_triggers: usagePolicy.autonomy.approval_triggers
    },
    privacy: {
      raw_account_values_retained: false,
      raw_prompts_retained: false,
      hidden_reasoning_retained: false,
      credentials_retained: false
    },
    recommended_next_action: nextAction,
    canonical_state_changed: false,
    external_read_performed: probe.requested === true,
    external_action_performed: false
  };
}

export async function buildUsagePreflight(target, options = {}) {
  const [project, taskRegistry, workItems, usagePolicyResult] = await Promise.all([
    readJson(path.join(target, ".ai-org/project/project.json")),
    readJson(path.join(target, ".ai-org/project/tasks.json")),
    listWorkItemDocuments(target),
    readUsagePolicy(target)
  ]);
  const matchedEvaluationSources = await readMatchedEvaluationSources(target, usagePolicyResult.policy);
  const config = await readControlPlaneConfig(target);
  const stateDirectory = resolveControlPlaneStateDirectory(target, options.stateDirectory ?? config.state_directory);
  const journalPath = path.join(stateDirectory, "journal/events.jsonl");
  const providerPath = path.join(stateDirectory, "providers.json");
  let activeRecords = [];
  if (await pathExists(journalPath)) {
    const journal = await openTelemetryJournal(stateDirectory, {
      maxEvents: config.retention.max_events,
      privacy: config.privacy,
      readOnly: true
    });
    try {
      activeRecords = journal.readAfter(0).records;
    } finally {
      await journal.close();
    }
  }
  const providers = await pathExists(providerPath)
    ? (await readJson(providerPath)).providers ?? []
    : [];
  const configuredCodex = config.providers.find((provider) => provider.kind === "codex-app-server" && provider.enabled !== false);
  const accountProbe = options.probeCodexAccount === true
    ? await probeCodexAccountUsage(target, {
        command: options.command ?? configuredCodex?.options?.command,
        commandArgs: options.commandArgs ?? configuredCodex?.options?.command_args,
        connectionFactory: options.connectionFactory,
        version: options.version
      })
    : unavailableAccountProbe(false);
  const usageHistory = await readUsageTelemetryHistory(stateDirectory, activeRecords, { projectId: project.id });
  const report = buildUsagePreflightFromRecords(
    project,
    taskRegistry.tasks ?? [],
    usageHistory.records,
    providers,
    accountProbe,
    {
      workItems,
      usagePolicy: usagePolicyResult.policy,
      usagePolicySource: usagePolicyResult.source,
      matchedEvaluationSources
    }
  );
  report.detailed_thread_usage.history = usageHistory.history;
  return report;
}

export async function buildUsageBaseline(target, options = {}) {
  const [project, taskRegistry, workItems, usagePolicyResult] = await Promise.all([
    readJson(path.join(target, ".ai-org/project/project.json")),
    readJson(path.join(target, ".ai-org/project/tasks.json")),
    listWorkItemDocuments(target),
    readUsagePolicy(target)
  ]);
  const matchedEvaluationSources = await readMatchedEvaluationSources(target, usagePolicyResult.policy);
  const config = await readControlPlaneConfig(target);
  const stateDirectory = resolveControlPlaneStateDirectory(target, options.stateDirectory ?? config.state_directory);
  const journalPath = path.join(stateDirectory, "journal/events.jsonl");
  const providerPath = path.join(stateDirectory, "providers.json");
  let activeRecords = [];
  if (await pathExists(journalPath)) {
    const journal = await openTelemetryJournal(stateDirectory, {
      maxEvents: config.retention.max_events,
      privacy: config.privacy,
      readOnly: true
    });
    try {
      activeRecords = journal.readAfter(0).records;
    } finally {
      await journal.close();
    }
  }
  const providers = await pathExists(providerPath)
    ? (await readJson(providerPath)).providers ?? []
    : [];
  const usageHistory = await readUsageTelemetryHistory(stateDirectory, activeRecords, { projectId: project.id });
  const report = buildUsageBaselineFromRecords(project, usageHistory.records, {
    stateDirectory,
    workItems,
    tasks: taskRegistry.tasks ?? [],
    providers,
    usagePolicy: usagePolicyResult.policy,
    usagePolicySource: usagePolicyResult.source,
    matchedEvaluationSources,
    longitudinalWorkItemsRequired: options.longitudinalWorkItemsRequired,
    history: usageHistory.history,
    activeJournal: usageHistory.activeJournal
  });
  if (options.write !== false) await atomicWrite(path.join(target, USAGE_BASELINE_VIEW), formatJson(report));
  return report;
}
