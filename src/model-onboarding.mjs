import fs from "node:fs/promises";
import path from "node:path";

import { isSafeRepositoryPath } from "./context.mjs";
import { readExecutionPolicy, validateExecutionPolicy } from "./execution-routing.mjs";
import { readJson, sha256 } from "./files.mjs";

export const MODEL_ONBOARDING_INPUT_SCHEMA = "temple.model-onboarding-input/v1";
export const MODEL_ONBOARDING_PLAN_SCHEMA = "temple.model-onboarding-plan/v1";

const IDENTIFIER = /^[a-z0-9][a-z0-9._-]*$/;
const COMPATIBILITY_STATUSES = new Set(["compatible", "incompatible", "unknown"]);
const PREFERENCE_SOURCES = new Set(["user-stated", "project-decision"]);
const RESULT_STATUSES = new Set(["proposed", "already-adopted", "unresolved"]);
const RECOMMENDATION_BASES = new Set([
  "explicit-preference",
  "historical-familiarity",
  "sole-compatible-candidate"
]);

function nonBlank(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function canonicalTimestamp(value) {
  if (!nonBlank(value)) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString() === value ? value : null;
}

function uniqueStrings(values, { nonEmpty = false } = {}) {
  return (
    Array.isArray(values) &&
    (!nonEmpty || values.length > 0) &&
    values.every(nonBlank) &&
    new Set(values).size === values.length
  );
}

function rejectUnknownProperties(value, allowed, label, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) errors.push(`${label} has unknown properties: ${unexpected.join(", ")}`);
}

function candidateKey(value) {
  return JSON.stringify([value?.provider_id, value?.model, value?.reasoning_effort]);
}

function modelKey(providerId, model) {
  return JSON.stringify([providerId, model]);
}

function candidateValue(value) {
  return {
    provider_id: value.provider_id,
    model: value.model,
    reasoning_effort: value.reasoning_effort
  };
}

function existingMapping(profile) {
  const values = [profile.provider_id, profile.model, profile.reasoning_effort];
  return values.every(nonBlank) ? candidateValue(profile) : null;
}

export function validateModelOnboardingInput(document, policy) {
  const errors = [];
  rejectUnknownProperties(document, ["schema_version", "observation", "compatibility", "preferences", "history"], "input", errors);
  if (document?.schema_version !== MODEL_ONBOARDING_INPUT_SCHEMA) {
    errors.push(`schema_version must be ${MODEL_ONBOARDING_INPUT_SCHEMA}`);
  }
  const policyValidation = validateExecutionPolicy(policy);
  if (!policyValidation.valid) errors.push(...policyValidation.errors.map((error) => `execution policy: ${error}`));
  const profileIds = new Set((policy?.profiles ?? []).map((entry) => entry.id));

  const observation = document?.observation;
  rejectUnknownProperties(
    observation,
    ["provider_id", "provider_kind", "observed_at", "source", "models"],
    "observation",
    errors
  );
  if (!nonBlank(observation?.provider_id) || !IDENTIFIER.test(observation.provider_id)) {
    errors.push("observation.provider_id is invalid");
  }
  if (!nonBlank(observation?.provider_kind)) errors.push("observation.provider_kind is required");
  if (!canonicalTimestamp(observation?.observed_at)) errors.push("observation.observed_at must be a canonical UTC timestamp");
  if (!nonBlank(observation?.source)) errors.push("observation.source is required");

  const catalogModels = new Map();
  if (!Array.isArray(observation?.models) || observation.models.length === 0) {
    errors.push("observation.models must be non-empty");
  } else {
    for (const [index, model] of observation.models.entries()) {
      const label = `observation.models[${index}]`;
      rejectUnknownProperties(
        model,
        ["model", "supported_reasoning_efforts", "default_reasoning_effort", "input_modalities", "visibility", "is_default"],
        label,
        errors
      );
      if (!nonBlank(model?.model)) errors.push(`${label}.model is required`);
      if (!uniqueStrings(model?.supported_reasoning_efforts, { nonEmpty: true })) {
        errors.push(`${label}.supported_reasoning_efforts is invalid`);
      }
      if (!nonBlank(model?.default_reasoning_effort) || !model?.supported_reasoning_efforts?.includes(model.default_reasoning_effort)) {
        errors.push(`${label}.default_reasoning_effort must be supported`);
      }
      if (!uniqueStrings(model?.input_modalities, { nonEmpty: true })) errors.push(`${label}.input_modalities is invalid`);
      if (!["visible", "hidden"].includes(model?.visibility)) errors.push(`${label}.visibility is invalid`);
      if (typeof model?.is_default !== "boolean") errors.push(`${label}.is_default must be boolean`);
      const key = modelKey(observation?.provider_id, model?.model);
      if (catalogModels.has(key)) errors.push(`${label}.model is duplicated`);
      catalogModels.set(key, model);
    }
  }

  const compatibilityKeys = new Set();
  if (!Array.isArray(document?.compatibility)) errors.push("compatibility must be an array");
  else for (const [index, assessment] of document.compatibility.entries()) {
    const label = `compatibility[${index}]`;
    rejectUnknownProperties(
      assessment,
      ["provider_id", "model", "reasoning_effort", "status", "eligible_profile_ids", "evidence_refs", "unknowns"],
      label,
      errors
    );
    for (const field of ["provider_id", "model", "reasoning_effort"]) {
      if (!nonBlank(assessment?.[field])) errors.push(`${label}.${field} is required`);
    }
    if (!COMPATIBILITY_STATUSES.has(assessment?.status)) errors.push(`${label}.status is invalid`);
    if (!uniqueStrings(assessment?.eligible_profile_ids)) errors.push(`${label}.eligible_profile_ids is invalid`);
    else if (assessment.eligible_profile_ids.some((id) => !profileIds.has(id))) {
      errors.push(`${label}.eligible_profile_ids references an unknown profile`);
    }
    if (!uniqueStrings(assessment?.evidence_refs)) errors.push(`${label}.evidence_refs is invalid`);
    if (!uniqueStrings(assessment?.unknowns)) errors.push(`${label}.unknowns is invalid`);
    if (assessment?.status === "compatible" && assessment?.eligible_profile_ids?.length === 0) {
      errors.push(`${label}.eligible_profile_ids must be non-empty when compatible`);
    }
    if (assessment?.status !== "compatible" && assessment?.eligible_profile_ids?.length > 0) {
      errors.push(`${label}.eligible_profile_ids must be empty unless compatible`);
    }
    if (["compatible", "incompatible"].includes(assessment?.status) && assessment?.evidence_refs?.length === 0) {
      errors.push(`${label}.evidence_refs must be non-empty for a compatibility decision`);
    }
    if (assessment?.status === "unknown" && assessment?.unknowns?.length === 0) {
      errors.push(`${label}.unknowns must explain an unknown compatibility state`);
    }
    const catalogModel = catalogModels.get(modelKey(assessment?.provider_id, assessment?.model));
    if (!catalogModel) errors.push(`${label} references a model absent from the catalog observation`);
    else if (!catalogModel.supported_reasoning_efforts?.includes(assessment?.reasoning_effort)) {
      errors.push(`${label}.reasoning_effort is absent from the catalog observation`);
    }
    const key = candidateKey(assessment);
    if (compatibilityKeys.has(key)) errors.push(`${label} duplicates a compatibility assessment`);
    compatibilityKeys.add(key);
  }

  const preferenceProfiles = new Set();
  if (!Array.isArray(document?.preferences)) errors.push("preferences must be an array");
  else for (const [index, preference] of document.preferences.entries()) {
    const label = `preferences[${index}]`;
    rejectUnknownProperties(
      preference,
      ["profile_id", "provider_id", "model", "reasoning_effort", "source", "evidence_ref"],
      label,
      errors
    );
    if (!profileIds.has(preference?.profile_id)) errors.push(`${label}.profile_id is unknown`);
    for (const field of ["provider_id", "model", "reasoning_effort", "evidence_ref"]) {
      if (!nonBlank(preference?.[field])) errors.push(`${label}.${field} is required`);
    }
    if (!PREFERENCE_SOURCES.has(preference?.source)) errors.push(`${label}.source is invalid`);
    if (preferenceProfiles.has(preference?.profile_id)) errors.push(`${label}.profile_id is duplicated`);
    preferenceProfiles.add(preference?.profile_id);
  }

  const history = document?.history;
  if (history !== null && history !== undefined) {
    rejectUnknownProperties(history, ["data_scope", "raw_content_included", "observations"], "history", errors);
    if (history?.data_scope !== "aggregate-metadata-only") errors.push("history.data_scope must be aggregate-metadata-only");
    if (history?.raw_content_included !== false) errors.push("history.raw_content_included must be false");
    if (!Array.isArray(history?.observations)) errors.push("history.observations must be an array");
    else for (const [index, observationEntry] of history.observations.entries()) {
      const label = `history.observations[${index}]`;
      rejectUnknownProperties(
        observationEntry,
        ["profile_id", "provider_id", "model", "reasoning_effort", "executions", "source", "observed_from", "observed_to"],
        label,
        errors
      );
      if (!profileIds.has(observationEntry?.profile_id)) errors.push(`${label}.profile_id is unknown`);
      for (const field of ["provider_id", "model", "reasoning_effort", "source"]) {
        if (!nonBlank(observationEntry?.[field])) errors.push(`${label}.${field} is required`);
      }
      if (!Number.isSafeInteger(observationEntry?.executions) || observationEntry.executions < 1) {
        errors.push(`${label}.executions must be a positive safe integer`);
      }
      if (!canonicalTimestamp(observationEntry?.observed_from)) errors.push(`${label}.observed_from is invalid`);
      if (!canonicalTimestamp(observationEntry?.observed_to)) errors.push(`${label}.observed_to is invalid`);
      if (
        canonicalTimestamp(observationEntry?.observed_from) &&
        canonicalTimestamp(observationEntry?.observed_to) &&
        observationEntry.observed_from > observationEntry.observed_to
      ) {
        errors.push(`${label}.observed_from must not be after observed_to`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

function compatibilityCandidate(assessment) {
  return {
    ...candidateValue(assessment),
    compatibility_status: assessment.status,
    evidence_refs: [...assessment.evidence_refs],
    unknowns: [...assessment.unknowns]
  };
}

function proposalForProfile(profile, input, compatible) {
  const adopted = existingMapping(profile);
  const alternatives = compatible.map(compatibilityCandidate);
  const baseStates = {
    discovery: "observed",
    compatibility: alternatives.length > 0 ? "qualified" : "unavailable",
    adoption: adopted ? "adopted" : "unmapped",
    requested: "not-performed",
    effective: "unobserved"
  };
  if (adopted) {
    return {
      profile_id: profile.id,
      status: "already-adopted",
      states: { ...baseStates, proposal: "not-needed" },
      existing_mapping: adopted,
      recommendation: null,
      alternatives,
      unresolved_reasons: []
    };
  }

  const preference = input.preferences.find((entry) => entry.profile_id === profile.id) ?? null;
  if (preference) {
    const preferred = compatible.find((entry) => candidateKey(entry) === candidateKey(preference));
    if (preferred) {
      return {
        profile_id: profile.id,
        status: "proposed",
        states: { ...baseStates, proposal: "proposed" },
        existing_mapping: null,
        recommendation: {
          candidate: candidateValue(preferred),
          basis: "explicit-preference",
          confidence: "project-directed",
          historical_executions: null,
          evidence_refs: [...new Set([preference.evidence_ref, ...preferred.evidence_refs])],
          explanation: "A compatible project preference explicitly selected this configuration."
        },
        alternatives,
        unresolved_reasons: []
      };
    }
    return {
      profile_id: profile.id,
      status: "unresolved",
      states: { ...baseStates, proposal: "unresolved" },
      existing_mapping: null,
      recommendation: null,
      alternatives,
      unresolved_reasons: ["explicit-preference-not-compatible"]
    };
  }

  const compatibleKeys = new Set(compatible.map(candidateKey));
  const historyCounts = new Map();
  for (const entry of input.history?.observations ?? []) {
    if (entry.profile_id !== profile.id || !compatibleKeys.has(candidateKey(entry))) continue;
    historyCounts.set(candidateKey(entry), (historyCounts.get(candidateKey(entry)) ?? 0) + entry.executions);
  }
  const rankedHistory = [...historyCounts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  if (rankedHistory.length > 0 && (rankedHistory.length === 1 || rankedHistory[0][1] > rankedHistory[1][1])) {
    const selected = compatible.find((entry) => candidateKey(entry) === rankedHistory[0][0]);
    return {
      profile_id: profile.id,
      status: "proposed",
      states: { ...baseStates, proposal: "proposed" },
      existing_mapping: null,
      recommendation: {
        candidate: candidateValue(selected),
        basis: "historical-familiarity",
        confidence: "low",
        historical_executions: rankedHistory[0][1],
        evidence_refs: [...selected.evidence_refs],
        explanation: "This compatible configuration is the unique most-observed historical habit; familiarity is not quality or efficiency proof."
      },
      alternatives,
      unresolved_reasons: []
    };
  }
  if (rankedHistory.length > 1 && rankedHistory[0][1] === rankedHistory[1][1]) {
    return {
      profile_id: profile.id,
      status: "unresolved",
      states: { ...baseStates, proposal: "unresolved" },
      existing_mapping: null,
      recommendation: null,
      alternatives,
      unresolved_reasons: ["historical-familiarity-tied"]
    };
  }
  if (compatible.length === 1) {
    const selected = compatible[0];
    return {
      profile_id: profile.id,
      status: "proposed",
      states: { ...baseStates, proposal: "proposed" },
      existing_mapping: null,
      recommendation: {
        candidate: candidateValue(selected),
        basis: "sole-compatible-candidate",
        confidence: "low",
        historical_executions: null,
        evidence_refs: [...selected.evidence_refs],
        explanation: "This is the only configuration qualified as compatible for the profile; project suitability is not yet optimized."
      },
      alternatives,
      unresolved_reasons: []
    };
  }
  return {
    profile_id: profile.id,
    status: "unresolved",
    states: { ...baseStates, proposal: "unresolved" },
    existing_mapping: null,
    recommendation: null,
    alternatives,
    unresolved_reasons: [compatible.length === 0 ? "no-compatible-candidate" : "multiple-compatible-candidates-without-preference"]
  };
}

export function buildModelOnboardingPlan(policy, input, options = {}) {
  const validation = validateModelOnboardingInput(input, policy);
  if (!validation.valid) throw new Error(`Invalid model onboarding input: ${validation.errors.join("; ")}`);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  if (!canonicalTimestamp(generatedAt)) throw new Error("generatedAt must be a canonical UTC timestamp");
  const compatibilityByProfile = new Map(policy.profiles.map((profile) => [profile.id, []]));
  for (const assessment of input.compatibility) {
    if (assessment.status !== "compatible") continue;
    for (const profileId of assessment.eligible_profile_ids) compatibilityByProfile.get(profileId).push(assessment);
  }
  for (const candidates of compatibilityByProfile.values()) {
    candidates.sort((left, right) => candidateKey(left).localeCompare(candidateKey(right)));
  }
  const profiles = policy.profiles.map((profile) =>
    proposalForProfile(profile, input, compatibilityByProfile.get(profile.id))
  );
  return {
    schema_version: MODEL_ONBOARDING_PLAN_SCHEMA,
    generated_at: generatedAt,
    input: {
      schema_version: input.schema_version,
      digest: `sha256:${sha256(JSON.stringify(input))}`,
      provider_id: input.observation.provider_id,
      provider_kind: input.observation.provider_kind,
      observed_at: input.observation.observed_at,
      source: input.observation.source,
      history_scope: input.history?.data_scope ?? "not-provided"
    },
    authority: {
      provider_contact: false,
      policy_mutation: false,
      model_execution: false,
      automatic_adoption: false,
      raw_conversation_read: false
    },
    catalog: {
      status: "observed",
      models: input.observation.models.map((entry) => ({
        provider_id: input.observation.provider_id,
        model: entry.model,
        supported_reasoning_efforts: [...entry.supported_reasoning_efforts],
        default_reasoning_effort: entry.default_reasoning_effort,
        input_modalities: [...entry.input_modalities],
        visibility: entry.visibility,
        is_default: entry.is_default
      }))
    },
    unqualified_configurations: input.compatibility
      .filter((entry) => entry.status !== "compatible")
      .map(compatibilityCandidate),
    summary: {
      catalog_models: input.observation.models.length,
      compatibility_assessments: input.compatibility.length,
      compatible_configurations: input.compatibility.filter((entry) => entry.status === "compatible").length,
      proposed: profiles.filter((entry) => entry.status === "proposed").length,
      already_adopted: profiles.filter((entry) => entry.status === "already-adopted").length,
      unresolved: profiles.filter((entry) => entry.status === "unresolved").length
    },
    profiles,
    notices: [
      "Catalog presence is not compatibility evidence.",
      "Historical use is a familiarity prior, not proof of quality, efficiency, cost, or safety.",
      "A proposal has no authority until the project explicitly adopts a policy change."
    ]
  };
}

export function validateModelOnboardingPlan(document) {
  const errors = [];
  if (document?.schema_version !== MODEL_ONBOARDING_PLAN_SCHEMA) errors.push(`schema_version must be ${MODEL_ONBOARDING_PLAN_SCHEMA}`);
  if (!canonicalTimestamp(document?.generated_at)) errors.push("generated_at must be a canonical UTC timestamp");
  for (const field of ["provider_contact", "policy_mutation", "model_execution", "automatic_adoption", "raw_conversation_read"]) {
    if (document?.authority?.[field] !== false) errors.push(`authority.${field} must be false`);
  }
  if (document?.catalog?.status !== "observed" || !Array.isArray(document?.catalog?.models)) {
    errors.push("catalog must retain the observed model list");
  }
  if (!Array.isArray(document?.unqualified_configurations)) {
    errors.push("unqualified_configurations must be an array");
  }
  if (!Array.isArray(document?.profiles)) errors.push("profiles must be an array");
  else {
    const ids = new Set();
    for (const [index, profile] of document.profiles.entries()) {
      const label = `profiles[${index}]`;
      if (!nonBlank(profile?.profile_id) || ids.has(profile.profile_id)) errors.push(`${label}.profile_id is invalid or duplicated`);
      ids.add(profile?.profile_id);
      if (!RESULT_STATUSES.has(profile?.status)) errors.push(`${label}.status is invalid`);
      if (profile?.status === "proposed") {
        if (!profile.recommendation || !RECOMMENDATION_BASES.has(profile.recommendation.basis)) {
          errors.push(`${label}.recommendation is required for a proposal`);
        }
        if (profile?.states?.proposal !== "proposed" || profile?.states?.adoption !== "unmapped") {
          errors.push(`${label}.states contradict a proposal`);
        }
      } else if (profile?.recommendation !== null) errors.push(`${label}.recommendation must be null unless proposed`);
      if (profile?.status === "already-adopted" && profile?.states?.adoption !== "adopted") {
        errors.push(`${label}.adoption must be adopted`);
      }
      if (profile?.status === "unresolved" && (!Array.isArray(profile.unresolved_reasons) || profile.unresolved_reasons.length === 0)) {
        errors.push(`${label}.unresolved_reasons must explain an unresolved profile`);
      }
    }
  }
  const counts = {
    proposed: document?.profiles?.filter((entry) => entry.status === "proposed").length,
    already_adopted: document?.profiles?.filter((entry) => entry.status === "already-adopted").length,
    unresolved: document?.profiles?.filter((entry) => entry.status === "unresolved").length
  };
  for (const [field, value] of Object.entries(counts)) {
    if (document?.summary?.[field] !== value) errors.push(`summary.${field} does not match profiles`);
  }
  return { valid: errors.length === 0, errors };
}

export async function buildModelOnboardingPlanFile(target, inputPath, options = {}) {
  if (!isSafeRepositoryPath(inputPath)) throw new Error("--input must be a safe repository-relative path");
  const projectRoot = await fs.realpath(path.resolve(target));
  const absoluteInput = await fs.realpath(path.resolve(target, inputPath));
  const relative = path.relative(projectRoot, absoluteInput);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("model onboarding input escapes the project repository");
  const [{ policy }, input] = await Promise.all([readExecutionPolicy(target), readJson(absoluteInput)]);
  const plan = buildModelOnboardingPlan(policy, input, options);
  const planValidation = validateModelOnboardingPlan(plan);
  if (!planValidation.valid) throw new Error(`Invalid model onboarding plan: ${planValidation.errors.join("; ")}`);
  return plan;
}
