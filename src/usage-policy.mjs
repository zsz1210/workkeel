import path from "node:path";
import { atomicCreate, formatJson, pathExists, readJson, sha256 } from "./files.mjs";

export const USAGE_POLICY_SCHEMA = "temple.usage-policy/v1";
export const USAGE_POLICY_RELATIVE_PATH = ".ai-org/project/usage-policy.json";
export const MATCHED_EVALUATION_METHOD = "paired-sign-test-v1";
export const MATCHED_EVALUATION_ROOT = ".ai-org/evaluations/model/";

const DEFAULT_MATCHED_EVALUATION_POLICY = Object.freeze({
  sources: [],
  maximum_age_days: 90,
  supported_method: MATCHED_EVALUATION_METHOD
});

export const USAGE_APPROVAL_TRIGGERS = [
  "external-spend",
  "external-write",
  "irreversible-action",
  "deployment-or-release",
  "privacy-boundary-change",
  "unapproved-provider-or-model",
  "budget-exceeded",
  "high-risk-low-confidence",
  "policy-change"
];

const DEFAULT_PROFILES = [
  { id: "mechanical-fast", model_class: "efficient", reasoning_class: "light" },
  { id: "lightweight-quality", model_class: "efficient", reasoning_class: "deep" },
  { id: "standard", model_class: "balanced", reasoning_class: "balanced" },
  { id: "critical-planning", model_class: "frontier", reasoning_class: "deep" }
];

function profile(profile, mapping = {}) {
  return {
    ...profile,
    provider_id: mapping.provider_id ?? null,
    model: mapping.model ?? null,
    reasoning_effort: mapping.reasoning_effort ?? null
  };
}

export function defaultUsagePolicy(options = {}) {
  const mappings = new Map((options.profileMappings ?? []).map((entry) => [entry.id, entry]));
  return {
    schema_version: USAGE_POLICY_SCHEMA,
    objective: "balanced",
    data_scope: {
      raw_observations: "project-local",
      organization_sharing: "disabled",
      framework_sharing: "disabled",
      raw_prompts_retained: false,
      hidden_reasoning_retained: false
    },
    task_shape: {
      required_dimensions: [
        "position_id",
        "lifecycle_stage",
        "task_kind",
        "risk_class",
        "context_profile_digest"
      ],
      fallback_dimensions: ["position_id", "lifecycle_stage"],
      unknown_handling: "separate"
    },
    seed_policy: {
      id: "framework-seed-v1",
      status: "active",
      profiles: DEFAULT_PROFILES.map((entry) => profile(entry, mappings.get(entry.id))),
      rules: [
        { id: "mechanical-low-risk", task_kinds: ["mechanical"], risk_classes: ["low"], profile_id: "mechanical-fast" },
        { id: "explicit-bounded-delivery", task_kinds: ["bounded"], risk_classes: ["low", "standard"], profile_id: "standard" },
        { id: "semantic-ambiguity-escalation", task_kinds: ["semantic-ambiguity", "invariant-sensitive"], risk_classes: ["low", "standard"], profile_id: "lightweight-quality" },
        { id: "ordinary-delivery", task_kinds: ["implementation", "diagnosis", "documentation"], risk_classes: ["low", "standard"], profile_id: "standard" },
        { id: "consequential-work", task_kinds: ["planning", "architecture", "security", "migration", "independent-qa"], risk_classes: ["high", "critical"], profile_id: "critical-planning" }
      ],
      fallback_profile_id: "standard"
    },
    calibration: {
      state: "cold-start",
      recommendation_mode: "shadow",
      observation_threshold: {
        completed_work_items: 10,
        task_shapes: 2,
        samples_per_candidate: 2,
        purpose: "diagnostic-only"
      },
      statistical_qualification: {
        status: "unconfigured",
        method: null,
        minimum_effect: null,
        alpha: null,
        power: null,
        pilot_variance: null
      },
      matched_evaluation: { ...DEFAULT_MATCHED_EVALUATION_POLICY, sources: [] },
      required_evidence: [
        "matched-task-evaluation",
        "quality",
        "tokens",
        "latency",
        "human-intervention",
        "rework",
        "exact-task-shape"
      ]
    },
    cost: {
      accounting_unit: "credits",
      budget_limit: null,
      source: null,
      source_version: null,
      effective_at: null,
      status: "unknown",
      token_limits_are_financial_limits: false
    },
    autonomy: {
      mode: "exceptions-only",
      routine_decision: "automatic",
      automatic_when: [
        "approved-scope",
        "reversible",
        "local-only",
        "within-configured-budget",
        "allowlisted-provider-and-model",
        "confidence-sufficient-for-risk"
      ],
      approval_triggers: [...USAGE_APPROVAL_TRIGGERS]
    }
  };
}

function uniqueNonEmptyStrings(values) {
  return Array.isArray(values) && values.every((value) => typeof value === "string" && value.trim()) && new Set(values).size === values.length;
}

function safeMatchedEvaluationSource(value) {
  if (typeof value !== "string" || !value.startsWith(MATCHED_EVALUATION_ROOT) || !value.endsWith(".json")) return false;
  if (value.includes("\\") || value.includes("//") || value.includes("/./") || value.includes("/../")) return false;
  return /^[A-Za-z0-9._/-]+$/.test(value) && path.posix.normalize(value) === value;
}

export function matchedEvaluationPolicy(policy) {
  const configured = policy?.calibration?.matched_evaluation;
  if (configured === undefined) return { ...DEFAULT_MATCHED_EVALUATION_POLICY, sources: [] };
  return {
    sources: [...configured.sources],
    maximum_age_days: configured.maximum_age_days,
    supported_method: configured.supported_method
  };
}

export function validateUsagePolicy(document) {
  const errors = [];
  if (document?.schema_version !== USAGE_POLICY_SCHEMA) errors.push(`schema_version must be ${USAGE_POLICY_SCHEMA}`);
  if (!["quality-first", "balanced", "cost-first", "latency-first"].includes(document?.objective)) errors.push("objective is invalid");
  if (document?.data_scope?.raw_observations !== "project-local") errors.push("raw observations must remain project-local");
  if (!['disabled', 'aggregated-opt-in'].includes(document?.data_scope?.organization_sharing)) errors.push("organization sharing is invalid");
  if (!['disabled', 'anonymous-aggregate-opt-in'].includes(document?.data_scope?.framework_sharing)) errors.push("framework sharing is invalid");
  if (document?.data_scope?.raw_prompts_retained !== false || document?.data_scope?.hidden_reasoning_retained !== false) {
    errors.push("raw prompts and hidden reasoning must not be retained");
  }
  if (!uniqueNonEmptyStrings(document?.task_shape?.required_dimensions)) errors.push("task_shape.required_dimensions is invalid");
  if (!uniqueNonEmptyStrings(document?.task_shape?.fallback_dimensions)) errors.push("task_shape.fallback_dimensions is invalid");
  if (document?.task_shape?.unknown_handling !== "separate") errors.push("unknown task-shape values must remain separate");
  const profiles = document?.seed_policy?.profiles;
  const profileIds = new Set();
  if (!Array.isArray(profiles) || profiles.length === 0) errors.push("seed_policy.profiles must be non-empty");
  else {
    for (const entry of profiles) {
      if (typeof entry?.id !== "string" || !entry.id.trim() || profileIds.has(entry.id)) errors.push("seed profiles contain an invalid or duplicate id");
      profileIds.add(entry?.id);
      if (!["efficient", "balanced", "frontier"].includes(entry?.model_class)) errors.push(`seed profile ${entry?.id ?? "unknown"} has an invalid model_class`);
      if (!["light", "balanced", "deep"].includes(entry?.reasoning_class)) errors.push(`seed profile ${entry?.id ?? "unknown"} has an invalid reasoning_class`);
      const concrete = [entry?.provider_id, entry?.model, entry?.reasoning_effort];
      if (concrete.some((value) => value !== null && value !== undefined) && concrete.some((value) => typeof value !== "string" || !value.trim())) {
        errors.push(`seed profile ${entry?.id ?? "unknown"} must map provider, model, and reasoning together`);
      }
    }
  }
  if (!Array.isArray(document?.seed_policy?.rules) || document.seed_policy.rules.length === 0) errors.push("seed_policy.rules must be non-empty");
  else for (const rule of document.seed_policy.rules) {
    if (!profileIds.has(rule?.profile_id)) errors.push(`seed rule ${rule?.id ?? "unknown"} references an unknown profile`);
  }
  if (!profileIds.has(document?.seed_policy?.fallback_profile_id)) errors.push("seed_policy.fallback_profile_id references an unknown profile");
  if (!["cold-start", "exploratory", "calibrating", "calibrated", "stale", "invalid"].includes(document?.calibration?.state)) errors.push("calibration.state is invalid");
  if (!["shadow", "advisory", "automatic"].includes(document?.calibration?.recommendation_mode)) errors.push("calibration.recommendation_mode is invalid");
  if (document?.calibration?.observation_threshold?.purpose !== "diagnostic-only") errors.push("the fixed observation threshold must remain diagnostic-only");
  const statistical = document?.calibration?.statistical_qualification;
  if (!["unconfigured", "pilot", "configured", "satisfied", "stale", "invalid"].includes(statistical?.status)) errors.push("statistical qualification status is invalid");
  if (["configured", "satisfied"].includes(statistical?.status)) {
    if (typeof statistical.method !== "string" || !statistical.method.trim()) errors.push("configured statistical qualification requires a method");
    for (const field of ["minimum_effect", "alpha", "power", "pilot_variance"]) {
      if (typeof statistical[field] !== "number" || !Number.isFinite(statistical[field])) errors.push(`configured statistical qualification requires ${field}`);
    }
  }
  if (document?.calibration?.recommendation_mode === "automatic" && statistical?.status !== "satisfied") {
    errors.push("automatic recommendation mode requires satisfied statistical qualification");
  }
  if (document?.calibration?.state === "calibrated" && statistical?.status !== "satisfied") {
    errors.push("calibrated state requires satisfied statistical qualification");
  }
  const matched = document?.calibration?.matched_evaluation;
  if (matched !== undefined) {
    if (!uniqueNonEmptyStrings(matched?.sources) || !matched.sources.every(safeMatchedEvaluationSource)) {
      errors.push(`calibration.matched_evaluation.sources must be unique JSON paths below ${MATCHED_EVALUATION_ROOT}`);
    }
    if (!Number.isInteger(matched?.maximum_age_days) || matched.maximum_age_days < 1 || matched.maximum_age_days > 3650) {
      errors.push("calibration.matched_evaluation.maximum_age_days must be an integer from 1 to 3650");
    }
    if (matched?.supported_method !== MATCHED_EVALUATION_METHOD) {
      errors.push(`calibration.matched_evaluation.supported_method must be ${MATCHED_EVALUATION_METHOD}`);
    }
  }
  if (!uniqueNonEmptyStrings(document?.calibration?.required_evidence)) errors.push("calibration.required_evidence is invalid");
  if (document?.cost?.accounting_unit !== "credits" || document?.cost?.token_limits_are_financial_limits !== false) errors.push("Token limits cannot be treated as financial limits");
  if (document?.cost?.status === "configured" && [document.cost.source, document.cost.source_version, document.cost.effective_at].some((value) => typeof value !== "string" || !value.trim())) {
    errors.push("configured cost accounting requires source, version, and effective_at");
  }
  if (document?.autonomy?.mode !== "exceptions-only" || document?.autonomy?.routine_decision !== "automatic") errors.push("autonomy must default to automatic routine decisions with exception-only approval");
  if (!uniqueNonEmptyStrings(document?.autonomy?.approval_triggers)) errors.push("autonomy.approval_triggers is invalid");
  else for (const trigger of USAGE_APPROVAL_TRIGGERS) if (!document.autonomy.approval_triggers.includes(trigger)) errors.push(`autonomy is missing approval trigger ${trigger}`);
  return { valid: errors.length === 0, errors };
}

export async function ensureUsagePolicy(target) {
  const policyPath = path.join(target, USAGE_POLICY_RELATIVE_PATH);
  if (await pathExists(policyPath)) return { path: policyPath, created: false, afterHash: null };
  const content = formatJson(defaultUsagePolicy());
  try {
    await atomicCreate(policyPath, content);
    return { path: policyPath, created: true, afterHash: sha256(content) };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return { path: policyPath, created: false, afterHash: null };
  }
}

export async function readUsagePolicy(target) {
  const policyPath = path.join(target, USAGE_POLICY_RELATIVE_PATH);
  const source = await pathExists(policyPath) ? "project" : "framework-default";
  const policy = source === "project" ? await readJson(policyPath) : defaultUsagePolicy();
  const validation = validateUsagePolicy(policy);
  if (!validation.valid) throw new Error(`Invalid usage policy: ${validation.errors.join("; ")}`);
  return { policy, source };
}

export function usagePolicyProjection(policy, source = "provided") {
  const mappedProfiles = policy.seed_policy.profiles.filter((entry) => entry.model !== null).length;
  const statisticalStatus = policy.calibration.statistical_qualification.status;
  const matched = matchedEvaluationPolicy(policy);
  return {
    schema_version: policy.schema_version,
    source,
    objective: policy.objective,
    data_scope: { ...policy.data_scope },
    seed_policy: {
      id: policy.seed_policy.id,
      status: policy.seed_policy.status,
      profiles: policy.seed_policy.profiles.length,
      mapped_profiles: mappedProfiles,
      mapping_status: mappedProfiles === policy.seed_policy.profiles.length ? "configured" : "provider-mapping-required"
    },
    calibration: {
      state: policy.calibration.state,
      recommendation_mode: policy.calibration.recommendation_mode,
      observation_threshold_purpose: policy.calibration.observation_threshold.purpose,
      statistical_qualification_status: statisticalStatus,
      matched_evaluation: {
        configured_sources: matched.sources.length,
        maximum_age_days: matched.maximum_age_days,
        supported_method: matched.supported_method
      },
      automatic_routing_eligible: policy.calibration.recommendation_mode === "automatic" && statisticalStatus === "satisfied"
    },
    cost: { ...policy.cost },
    autonomy: { ...policy.autonomy }
  };
}
