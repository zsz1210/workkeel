import fs from "node:fs/promises";
import path from "node:path";

import { isSafeRepositoryPath } from "./context.mjs";
import { atomicCreate, formatJson, pathExists, readJson, sha256 } from "./files.mjs";

export const EXECUTION_POLICY_SCHEMA = "temple.execution-policy/v1";
export const EXECUTION_REQUEST_SCHEMA = "temple.execution-request/v1";
export const EXECUTION_ROUTE_SCHEMA = "temple.execution-route/v1";
export const EXECUTION_POLICY_RELATIVE_PATH = ".ai-org/project/execution-policy.json";

const SELECTION_MODES = ["pinned", "shadow", "advisory"];
const RISK_CLASSES = ["low", "standard", "high", "critical"];
const MEASURE_QUALITIES = ["declared", "observed", "qualified"];
const OBSERVATION_STATUSES = ["observed", "unavailable"];
const POLICY_SOURCES = ["project", "framework-default", "provided"];
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]*$/;
const CANONICAL_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const DEFAULT_CAPABILITIES = [
  {
    id: "text.reasoning",
    kind: "model",
    description: "Analyze structured or natural-language inputs and produce text.",
    modalities: ["text"]
  },
  {
    id: "architecture.design",
    kind: "method",
    description: "Design technical boundaries, interfaces, and trade-offs.",
    modalities: ["text"]
  },
  {
    id: "code.change",
    kind: "method",
    description: "Create or modify repository implementation files.",
    modalities: ["text"]
  },
  {
    id: "documentation.author",
    kind: "method",
    description: "Create or reconcile human-facing project documentation.",
    modalities: ["text"]
  },
  {
    id: "quality.evaluate",
    kind: "method",
    description: "Evaluate an outcome against explicit acceptance evidence.",
    modalities: ["text"]
  }
];

const DEFAULT_MEASURES = [
  { id: "tokens.total", unit: "token", aggregation: "sum" },
  { id: "latency", unit: "millisecond", aggregation: "sum" },
  { id: "retries", unit: "count", aggregation: "sum" },
  { id: "credits", unit: "credit", aggregation: "sum" },
  { id: "gpu.time", unit: "second", aggregation: "sum" },
  { id: "image.count", unit: "count", aggregation: "sum" },
  { id: "image.pixels", unit: "pixel", aggregation: "sum" },
  { id: "video.duration", unit: "second", aggregation: "sum" },
  { id: "audio.duration", unit: "second", aggregation: "sum" },
  { id: "human.editing", unit: "minute", aggregation: "sum" }
];

const DEFAULT_PROFILE_DEFINITIONS = [
  {
    id: "mechanical-fast",
    model_class: "efficient",
    reasoning_class: "light",
    capabilities: ["text.reasoning", "code.change", "documentation.author"],
    risk_classes: ["low"]
  },
  {
    id: "lightweight-quality",
    model_class: "efficient",
    reasoning_class: "deep",
    capabilities: ["text.reasoning", "code.change", "documentation.author", "quality.evaluate"],
    risk_classes: ["low", "standard"]
  },
  {
    id: "standard",
    model_class: "balanced",
    reasoning_class: "balanced",
    capabilities: [
      "text.reasoning",
      "architecture.design",
      "code.change",
      "documentation.author",
      "quality.evaluate"
    ],
    risk_classes: ["low", "standard"]
  },
  {
    id: "critical-planning",
    model_class: "frontier",
    reasoning_class: "deep",
    capabilities: [
      "text.reasoning",
      "architecture.design",
      "code.change",
      "documentation.author",
      "quality.evaluate"
    ],
    risk_classes: ["low", "standard", "high", "critical"]
  }
];

function profile(definition, mapping = {}) {
  return {
    ...definition,
    status: "active",
    provider_id: mapping.provider_id ?? null,
    model: mapping.model ?? null,
    reasoning_effort: mapping.reasoning_effort ?? null,
    modalities: ["text"],
    allowed_data_classes: ["public", "internal"],
    execution_boundaries: ["local", "approved-provider"],
    resource_estimates: []
  };
}

export function defaultExecutionPolicy(options = {}) {
  const mappings = new Map((options.profileMappings ?? []).map((entry) => [entry.id, entry]));
  return {
    schema_version: EXECUTION_POLICY_SCHEMA,
    authority: {
      default_selection_mode: "advisory",
      supported_selection_modes: [...SELECTION_MODES],
      automatic_execution: false,
      provider_contact: false,
      mutation_performed: false
    },
    capabilities: DEFAULT_CAPABILITIES.map((entry) => ({ ...entry, modalities: [...entry.modalities] })),
    profiles: DEFAULT_PROFILE_DEFINITIONS.map((entry) => profile(entry, mappings.get(entry.id))),
    rules: [
      {
        id: "mechanical-low-risk",
        match: { task_kinds: ["mechanical"], lifecycle_stages: ["*"], risk_classes: ["low"] },
        preference_order: ["mechanical-fast", "lightweight-quality", "standard"]
      },
      {
        id: "explicit-bounded-delivery",
        match: { task_kinds: ["bounded"], lifecycle_stages: ["*"], risk_classes: ["low", "standard"] },
        preference_order: ["standard", "lightweight-quality"]
      },
      {
        id: "semantic-ambiguity-escalation",
        match: {
          task_kinds: ["semantic-ambiguity", "invariant-sensitive"],
          lifecycle_stages: ["*"],
          risk_classes: ["low", "standard"]
        },
        preference_order: ["lightweight-quality", "standard"]
      },
      {
        id: "ordinary-delivery",
        match: {
          task_kinds: ["implementation", "diagnosis", "documentation"],
          lifecycle_stages: ["*"],
          risk_classes: ["low", "standard"]
        },
        preference_order: ["standard", "lightweight-quality"]
      },
      {
        id: "consequential-work",
        match: {
          task_kinds: ["planning", "architecture", "security", "migration", "independent-qa"],
          lifecycle_stages: ["*"],
          risk_classes: ["high", "critical"]
        },
        preference_order: ["critical-planning"]
      }
    ],
    fallback_profile_id: "standard",
    resource_measures: DEFAULT_MEASURES.map((entry) => ({ ...entry }))
  };
}

function uniqueNonEmptyStrings(values, { allowWildcard = false } = {}) {
  return (
    Array.isArray(values) &&
    values.length > 0 &&
    values.every((value) => typeof value === "string" && value.trim() && (allowWildcard || value !== "*")) &&
    new Set(values).size === values.length
  );
}

function validIdentifier(value) {
  return typeof value === "string" && IDENTIFIER.test(value);
}

function validateConcreteMapping(entry, label, errors) {
  const values = [entry?.provider_id, entry?.model, entry?.reasoning_effort];
  const allNull = values.every((value) => value === null);
  const allStrings = values.every((value) => typeof value === "string" && value.trim());
  if (!allNull && !allStrings) errors.push(`${label} must map provider_id, model, and reasoning_effort together or leave all three null`);
}

export function validateExecutionPolicy(document) {
  const errors = [];
  if (document?.schema_version !== EXECUTION_POLICY_SCHEMA) errors.push(`schema_version must be ${EXECUTION_POLICY_SCHEMA}`);
  const authority = document?.authority;
  if (!SELECTION_MODES.includes(authority?.default_selection_mode)) errors.push("authority.default_selection_mode is invalid");
  if (
    !Array.isArray(authority?.supported_selection_modes) ||
    authority.supported_selection_modes.length !== SELECTION_MODES.length ||
    !SELECTION_MODES.every((mode) => authority.supported_selection_modes.includes(mode))
  ) {
    errors.push("authority.supported_selection_modes must contain pinned, shadow, and advisory");
  }
  if (authority?.automatic_execution !== false || authority?.provider_contact !== false || authority?.mutation_performed !== false) {
    errors.push("execution routing must remain read-only and non-executing");
  }

  const capabilityIds = new Set();
  if (!Array.isArray(document?.capabilities) || document.capabilities.length === 0) errors.push("capabilities must be non-empty");
  else for (const [index, capability] of document.capabilities.entries()) {
    const label = `capabilities[${index}]`;
    if (!validIdentifier(capability?.id) || capabilityIds.has(capability.id)) errors.push(`${label}.id is invalid or duplicated`);
    capabilityIds.add(capability?.id);
    if (!validIdentifier(capability?.kind)) errors.push(`${label}.kind is invalid`);
    if (typeof capability?.description !== "string" || !capability.description.trim()) errors.push(`${label}.description is required`);
    if (!uniqueNonEmptyStrings(capability?.modalities)) errors.push(`${label}.modalities is invalid`);
  }

  const measureIds = new Set();
  if (!Array.isArray(document?.resource_measures) || document.resource_measures.length === 0) errors.push("resource_measures must be non-empty");
  else for (const [index, measure] of document.resource_measures.entries()) {
    const label = `resource_measures[${index}]`;
    if (!validIdentifier(measure?.id) || measureIds.has(measure.id)) errors.push(`${label}.id is invalid or duplicated`);
    measureIds.add(measure?.id);
    if (!validIdentifier(measure?.unit)) errors.push(`${label}.unit is invalid`);
    if (!['sum', 'maximum', 'latest'].includes(measure?.aggregation)) errors.push(`${label}.aggregation is invalid`);
  }

  const profileIds = new Set();
  if (!Array.isArray(document?.profiles) || document.profiles.length === 0) errors.push("profiles must be non-empty");
  else for (const [index, entry] of document.profiles.entries()) {
    const label = `profiles[${index}]`;
    if (!validIdentifier(entry?.id) || profileIds.has(entry.id)) errors.push(`${label}.id is invalid or duplicated`);
    profileIds.add(entry?.id);
    if (!['active', 'disabled'].includes(entry?.status)) errors.push(`${label}.status is invalid`);
    if (!['efficient', 'balanced', 'frontier', 'specialized', 'local'].includes(entry?.model_class)) errors.push(`${label}.model_class is invalid`);
    if (!['none', 'light', 'balanced', 'deep'].includes(entry?.reasoning_class)) errors.push(`${label}.reasoning_class is invalid`);
    validateConcreteMapping(entry, label, errors);
    if (!uniqueNonEmptyStrings(entry?.capabilities) || entry.capabilities.some((id) => !capabilityIds.has(id))) errors.push(`${label}.capabilities contains an unknown or invalid capability`);
    if (!uniqueNonEmptyStrings(entry?.modalities)) errors.push(`${label}.modalities is invalid`);
    if (!uniqueNonEmptyStrings(entry?.allowed_data_classes)) errors.push(`${label}.allowed_data_classes is invalid`);
    if (!uniqueNonEmptyStrings(entry?.execution_boundaries)) errors.push(`${label}.execution_boundaries is invalid`);
    if (!uniqueNonEmptyStrings(entry?.risk_classes) || entry.risk_classes.some((value) => !RISK_CLASSES.includes(value))) errors.push(`${label}.risk_classes is invalid`);
    if (!Array.isArray(entry?.resource_estimates)) errors.push(`${label}.resource_estimates must be an array`);
    else {
      const estimates = new Set();
      for (const estimate of entry.resource_estimates) {
        if (!measureIds.has(estimate?.measure_id) || estimates.has(estimate?.measure_id)) errors.push(`${label}.resource_estimates contains an unknown or duplicate measure`);
        estimates.add(estimate?.measure_id);
        if (typeof estimate?.value !== "number" || !Number.isFinite(estimate.value) || estimate.value < 0) errors.push(`${label}.resource_estimates value must be a non-negative number`);
        if (!MEASURE_QUALITIES.includes(estimate?.quality)) errors.push(`${label}.resource_estimates quality is invalid`);
        if (typeof estimate?.evidence_ref !== "string" || !estimate.evidence_ref.trim()) errors.push(`${label}.resource_estimates evidence_ref is required`);
      }
    }
  }

  const ruleIds = new Set();
  const matchKeys = new Set();
  if (!Array.isArray(document?.rules) || document.rules.length === 0) errors.push("rules must be non-empty");
  else for (const [index, rule] of document.rules.entries()) {
    const label = `rules[${index}]`;
    if (!validIdentifier(rule?.id) || ruleIds.has(rule.id)) errors.push(`${label}.id is invalid or duplicated`);
    ruleIds.add(rule?.id);
    for (const field of ["task_kinds", "lifecycle_stages", "risk_classes"]) {
      if (!uniqueNonEmptyStrings(rule?.match?.[field], { allowWildcard: true })) errors.push(`${label}.match.${field} is invalid`);
    }
    if (rule?.match?.risk_classes?.some((value) => value !== "*" && !RISK_CLASSES.includes(value))) errors.push(`${label}.match.risk_classes is invalid`);
    const matchKey = JSON.stringify([
      [...(rule?.match?.task_kinds ?? [])].sort(),
      [...(rule?.match?.lifecycle_stages ?? [])].sort(),
      [...(rule?.match?.risk_classes ?? [])].sort()
    ]);
    if (matchKeys.has(matchKey)) errors.push(`${label}.match duplicates an earlier rule`);
    matchKeys.add(matchKey);
    if (!uniqueNonEmptyStrings(rule?.preference_order) || rule.preference_order.some((id) => !profileIds.has(id))) errors.push(`${label}.preference_order references an unknown or duplicate profile`);
  }
  if (!profileIds.has(document?.fallback_profile_id)) errors.push("fallback_profile_id references an unknown profile");
  return { valid: errors.length === 0, errors };
}

function rejectUnknownProperties(value, allowedKeys, label, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unexpected.length > 0) errors.push(`${label} has unknown properties: ${unexpected.join(", ")}`);
}

function validateResourceEntries(entries, measureIds, label, { observation = false } = {}) {
  const errors = [];
  if (entries === undefined) return errors;
  if (!Array.isArray(entries)) return [`${label} must be an array`];
  const seen = new Set();
  for (const [index, entry] of entries.entries()) {
    const location = `${label}[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${location} must be an object`);
      continue;
    }
    rejectUnknownProperties(
      entry,
      observation
        ? ["measure_id", "status", "value", "source", "quality"]
        : ["measure_id", "maximum", "unknown_handling"],
      location,
      errors
    );
    if (!measureIds.has(entry?.measure_id) || seen.has(entry?.measure_id)) errors.push(`${location}.measure_id is unknown or duplicated`);
    seen.add(entry?.measure_id);
    if (observation) {
      if (!OBSERVATION_STATUSES.includes(entry?.status)) errors.push(`${location}.status is invalid`);
      if (entry?.status === "observed" && (typeof entry?.value !== "number" || !Number.isFinite(entry.value) || entry.value < 0)) errors.push(`${location}.value must be a non-negative number when observed`);
      if (entry?.status === "unavailable" && entry?.value !== null) errors.push(`${location}.value must be null when unavailable`);
      if (typeof entry?.source !== "string" || !entry.source.trim()) errors.push(`${location}.source is required`);
      if (!MEASURE_QUALITIES.includes(entry?.quality)) errors.push(`${location}.quality is invalid`);
    } else {
      if (typeof entry?.maximum !== "number" || !Number.isFinite(entry.maximum) || entry.maximum < 0) errors.push(`${location}.maximum must be a non-negative number`);
      if (!['reject', 'allow'].includes(entry?.unknown_handling)) errors.push(`${location}.unknown_handling is invalid`);
    }
  }
  return errors;
}

export function validateExecutionRequest(document, policy) {
  const errors = [];
  rejectUnknownProperties(document, ["schema_version", "work_item_id", "steps"], "request", errors);
  if (document?.schema_version !== EXECUTION_REQUEST_SCHEMA) errors.push(`schema_version must be ${EXECUTION_REQUEST_SCHEMA}`);
  if (typeof document?.work_item_id !== "string" || !document.work_item_id.trim()) errors.push("work_item_id is required");
  if (!Array.isArray(document?.steps) || document.steps.length === 0) return { valid: false, errors: [...errors, "steps must be non-empty"] };
  const measureIds = new Set((policy?.resource_measures ?? []).map((entry) => entry.id));
  const stepIds = new Set();
  for (const [index, step] of document.steps.entries()) {
    const label = `steps[${index}]`;
    rejectUnknownProperties(
      step,
      ["step_id", "responsibility", "task_shape", "capability_route", "constraints", "selection", "resource_observations"],
      label,
      errors
    );
    if (!validIdentifier(step?.step_id) || stepIds.has(step.step_id)) errors.push(`${label}.step_id is invalid or duplicated`);
    stepIds.add(step?.step_id);
    if (!(step?.responsibility === null || step?.responsibility === undefined || validIdentifier(step.responsibility))) errors.push(`${label}.responsibility is invalid`);
    const shape = step?.task_shape;
    rejectUnknownProperties(shape, ["position_id", "lifecycle_stage", "task_kind", "risk_class", "context_profile_digest"], `${label}.task_shape`, errors);
    for (const field of ["position_id", "lifecycle_stage", "task_kind", "context_profile_digest"]) {
      if (typeof shape?.[field] !== "string" || !shape[field].trim()) errors.push(`${label}.task_shape.${field} is required`);
    }
    if (!RISK_CLASSES.includes(shape?.risk_class)) errors.push(`${label}.task_shape.risk_class is invalid`);
    const required = step?.capability_route?.required;
    const optional = step?.capability_route?.optional;
    rejectUnknownProperties(step?.capability_route, ["required", "optional"], `${label}.capability_route`, errors);
    if (!uniqueNonEmptyStrings(required) || required.some((value) => !validIdentifier(value))) {
      errors.push(`${label}.capability_route.required is invalid`);
    }
    if (
      !Array.isArray(optional) ||
      optional.some((value) => !validIdentifier(value)) ||
      new Set(optional).size !== optional.length
    ) {
      errors.push(`${label}.capability_route.optional is invalid`);
    }
    if (Array.isArray(required) && Array.isArray(optional) && optional.some((id) => required.includes(id))) errors.push(`${label}.capability_route required and optional capabilities overlap`);
    rejectUnknownProperties(
      step?.constraints,
      ["required_modalities", "allowed_provider_ids", "data_class", "execution_boundary", "resource_limits"],
      `${label}.constraints`,
      errors
    );
    if (!uniqueNonEmptyStrings(step?.constraints?.required_modalities)) errors.push(`${label}.constraints.required_modalities is invalid`);
    if (!Array.isArray(step?.constraints?.allowed_provider_ids) || new Set(step.constraints.allowed_provider_ids).size !== step.constraints.allowed_provider_ids.length || step.constraints.allowed_provider_ids.some((value) => typeof value !== "string" || !value.trim())) errors.push(`${label}.constraints.allowed_provider_ids is invalid`);
    if (typeof step?.constraints?.data_class !== "string" || !step.constraints.data_class.trim()) errors.push(`${label}.constraints.data_class is required`);
    if (typeof step?.constraints?.execution_boundary !== "string" || !step.constraints.execution_boundary.trim()) errors.push(`${label}.constraints.execution_boundary is required`);
    errors.push(...validateResourceEntries(step?.constraints?.resource_limits, measureIds, `${label}.constraints.resource_limits`));
    errors.push(...validateResourceEntries(step?.resource_observations, measureIds, `${label}.resource_observations`, { observation: true }));
    rejectUnknownProperties(step?.selection, ["mode", "pinned_profile_id"], `${label}.selection`, errors);
    if (!step?.selection || typeof step.selection !== "object" || Array.isArray(step.selection)) {
      errors.push(`${label}.selection is required`);
    }
    const mode = step?.selection?.mode ?? policy?.authority?.default_selection_mode;
    if (!SELECTION_MODES.includes(mode)) errors.push(`${label}.selection.mode is invalid`);
    if (mode === "pinned" && !validIdentifier(step?.selection?.pinned_profile_id)) errors.push(`${label}.selection.pinned_profile_id is required for pinned mode`);
    if (mode !== "pinned" && step?.selection?.pinned_profile_id != null) errors.push(`${label}.selection.pinned_profile_id is allowed only for pinned mode`);
  }
  return { valid: errors.length === 0, errors };
}

function duplicateStrings(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const duplicated = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicated.add(value);
    seen.add(value);
  }
  return [...duplicated];
}

function duplicateEntryIds(entries, field) {
  return duplicateStrings(Array.isArray(entries) ? entries.map((entry) => entry?.[field]) : []);
}

function nonBlankString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateRouteStrings(values, label, errors, { identifiers = false } = {}) {
  if (!Array.isArray(values)) return;
  for (const value of values) {
    if (!nonBlankString(value)) errors.push(`${label} contains a blank value`);
    else if (identifiers && !validIdentifier(value)) errors.push(`${label} contains an invalid identifier: ${value}`);
  }
}

export function validateExecutionRoute(document) {
  const errors = [];
  if (document?.schema_version !== EXECUTION_ROUTE_SCHEMA) {
    errors.push(`schema_version must be ${EXECUTION_ROUTE_SCHEMA}`);
  }
  if (
    document?.authority?.automatic_execution !== false ||
    document?.authority?.provider_contact !== false ||
    document?.authority?.mutation_performed !== false
  ) {
    errors.push("route authority must remain read-only and non-executing");
  }
  if (!nonBlankString(document?.request?.work_item_id)) errors.push("request.work_item_id must be non-blank");
  if (!Array.isArray(document?.steps) || document.steps.length === 0) {
    return { valid: false, errors: [...errors, "steps must be non-empty"] };
  }

  const duplicateStepIds = duplicateEntryIds(document.steps, "step_id");
  if (duplicateStepIds.length > 0) errors.push(`step_id is duplicated: ${duplicateStepIds.join(", ")}`);

  let resolved = 0;
  let unresolved = 0;
  for (const [index, step] of document.steps.entries()) {
    const label = `steps[${index}]`;
    for (const field of ["position_id", "lifecycle_stage", "task_kind", "context_profile_digest"]) {
      if (!nonBlankString(step?.task_shape?.[field])) errors.push(`${label}.task_shape.${field} must be non-blank`);
    }
    const required = Array.isArray(step?.capability_route?.required) ? step.capability_route.required : [];
    const optional = Array.isArray(step?.capability_route?.optional) ? step.capability_route.optional : [];
    const unknownRequired = Array.isArray(step?.capability_route?.unknown_required)
      ? step.capability_route.unknown_required
      : [];
    const unknownOptional = Array.isArray(step?.capability_route?.unknown_optional)
      ? step.capability_route.unknown_optional
      : [];
    validateRouteStrings(required, `${label}.capability_route.required`, errors, { identifiers: true });
    validateRouteStrings(optional, `${label}.capability_route.optional`, errors, { identifiers: true });
    validateRouteStrings(unknownRequired, `${label}.capability_route.unknown_required`, errors, { identifiers: true });
    validateRouteStrings(unknownOptional, `${label}.capability_route.unknown_optional`, errors, { identifiers: true });
    const requiredOptionalOverlap = optional.filter((id) => required.includes(id));
    if (requiredOptionalOverlap.length > 0) {
      errors.push(`${label}.capability_route required and optional capabilities overlap: ${[...new Set(requiredOptionalOverlap)].join(", ")}`);
    }
    for (const id of unknownRequired) {
      if (!required.includes(id)) errors.push(`${label}.capability_route.unknown_required is not a subset of required: ${id}`);
    }
    for (const id of unknownOptional) {
      if (!optional.includes(id)) errors.push(`${label}.capability_route.unknown_optional is not a subset of optional: ${id}`);
    }

    const expectedAuthority = routeAuthority(step?.selection?.mode);
    if (!SELECTION_MODES.includes(step?.selection?.mode)) errors.push(`${label}.selection.mode is invalid`);
    if (step?.selection?.authority !== expectedAuthority) {
      errors.push(`${label}.selection.authority must be ${expectedAuthority}`);
    }
    const selectionMode = step?.selection?.mode;
    const selectionStatus = step?.selection?.status;
    const unresolvedReason = step?.selection?.unresolved_reason;
    const pinnedReasons = new Set(["pinned-profile-not-found", "pinned-profile-ineligible"]);
    if (selectionMode === "pinned") {
      if (step?.selection?.fallback_applied !== false) errors.push(`${label}.selection pinned mode cannot apply fallback`);
      if (selectionStatus === "unresolved" && !pinnedReasons.has(unresolvedReason)) {
        errors.push(`${label}.selection pinned mode requires a pinned-specific unresolved reason`);
      }
    } else if (pinnedReasons.has(unresolvedReason)) {
      errors.push(`${label}.selection non-pinned mode cannot use a pinned-specific unresolved reason`);
    }
    if (unknownRequired.length > 0) {
      const expectedUnknownReason = selectionMode === "pinned"
        ? pinnedReasons.has(unresolvedReason)
        : unresolvedReason === "unknown-required-capability";
      if (selectionStatus !== "unresolved" || !expectedUnknownReason) {
        errors.push(`${label}.selection must fail closed for unknown required capabilities`);
      }
    } else if (unresolvedReason === "unknown-required-capability") {
      errors.push(`${label}.selection cannot claim unknown required capabilities when none are reported`);
    }

    const eligibleIds = Array.isArray(step?.eligibility?.eligible_profile_ids)
      ? step.eligibility.eligible_profile_ids
      : [];
    const rejected = Array.isArray(step?.eligibility?.rejected) ? step.eligibility.rejected : [];
    for (const [rejectedIndex, entry] of rejected.entries()) {
      validateRouteStrings(entry?.reasons, `${label}.eligibility.rejected[${rejectedIndex}].reasons`, errors);
    }
    const rejectedIds = rejected.map((entry) => entry?.profile_id);
    const duplicateRejectedIds = duplicateStrings(rejectedIds);
    if (duplicateRejectedIds.length > 0) {
      errors.push(`${label}.eligibility.rejected profile_id is duplicated: ${duplicateRejectedIds.join(", ")}`);
    }
    const overlap = rejectedIds.filter((id) => eligibleIds.includes(id));
    if (overlap.length > 0) {
      errors.push(`${label}.eligibility profiles cannot be both eligible and rejected: ${[...new Set(overlap)].join(", ")}`);
    }

    if (step?.selection?.status === "resolved") {
      resolved += 1;
      if (!step.selected || typeof step.selected !== "object") errors.push(`${label}.selected is required when resolved`);
      if (step?.selection?.unresolved_reason !== null) errors.push(`${label}.selection.unresolved_reason must be null when resolved`);
      if (step?.selected?.profile_id && !eligibleIds.includes(step.selected.profile_id)) {
        errors.push(`${label}.selected.profile_id must be eligible`);
      }
      const requested = step?.selected?.requested;
      const mapping = [requested?.provider_id, requested?.model, requested?.reasoning_effort];
      const allNull = mapping.every((value) => value === null);
      const allConcrete = mapping.every((value) => nonBlankString(value));
      if (!allNull && !allConcrete) {
        errors.push(`${label}.selected.requested must map provider_id, model, and reasoning_effort together or leave all three null`);
      }
      if (
        selectionMode !== "pinned" &&
        step?.selection?.rule_id === null &&
        step?.selection?.fallback_applied !== true
      ) {
        errors.push(`${label}.selection resolved non-pinned mode requires rule or fallback provenance`);
      }
    } else if (step?.selection?.status === "unresolved") {
      unresolved += 1;
      if (step.selected !== null) errors.push(`${label}.selected must be null when unresolved`);
      if (typeof step?.selection?.unresolved_reason !== "string") {
        errors.push(`${label}.selection.unresolved_reason is required when unresolved`);
      }
      if (step?.selection?.fallback_applied !== false) {
        errors.push(`${label}.selection.fallback_applied must be false when unresolved`);
      }
    }
    if (step?.selection?.fallback_applied === true && step?.selection?.status !== "resolved") {
      errors.push(`${label}.selection.fallback_applied requires a resolved route`);
    }

    for (const [field, entries] of [
      ["resource_limits", step?.resource_limits],
      ["resource_observations", step?.resource_observations]
    ]) {
      if (!Array.isArray(entries)) {
        errors.push(`${label}.${field} must be an array`);
        continue;
      }
      const duplicated = duplicateEntryIds(entries, "measure_id");
      if (duplicated.length > 0) errors.push(`${label}.${field} measure_id is duplicated: ${duplicated.join(", ")}`);
    }
    const resourceObservations = Array.isArray(step?.resource_observations) ? step.resource_observations : [];
    for (const [observationIndex, observation] of resourceObservations.entries()) {
      if (!nonBlankString(observation?.source)) {
        errors.push(`${label}.resource_observations[${observationIndex}].source must be non-blank`);
      }
    }
  }

  if (document?.summary?.steps !== document.steps.length) errors.push("summary.steps must equal steps.length");
  if (document?.summary?.resolved !== resolved) errors.push("summary.resolved must equal resolved step count");
  if (document?.summary?.unresolved !== unresolved) errors.push("summary.unresolved must equal unresolved step count");
  if (resolved + unresolved !== document.steps.length) errors.push("every step must be resolved or unresolved");
  return { valid: errors.length === 0, errors };
}

function listContains(values, value) {
  return values.includes("*") || values.includes(value);
}

function matchingRule(policy, shape) {
  return policy.rules.find((rule) =>
    listContains(rule.match.task_kinds, shape.task_kind) &&
    listContains(rule.match.lifecycle_stages, shape.lifecycle_stage) &&
    listContains(rule.match.risk_classes, shape.risk_class)
  ) ?? null;
}

function profileRejections(profileEntry, step) {
  const reasons = [];
  if (profileEntry.status !== "active") reasons.push("profile-disabled");
  for (const capability of step.capability_route.required) {
    if (!profileEntry.capabilities.includes(capability)) reasons.push(`missing-capability:${capability}`);
  }
  for (const modality of step.constraints.required_modalities) {
    if (!profileEntry.modalities.includes(modality)) reasons.push(`missing-modality:${modality}`);
  }
  if (step.constraints.allowed_provider_ids.length > 0) {
    if (profileEntry.provider_id === null) reasons.push("provider-unmapped");
    else if (!step.constraints.allowed_provider_ids.includes(profileEntry.provider_id)) reasons.push(`provider-not-allowed:${profileEntry.provider_id}`);
  }
  if (!profileEntry.allowed_data_classes.includes(step.constraints.data_class)) reasons.push(`data-class-not-allowed:${step.constraints.data_class}`);
  if (!profileEntry.execution_boundaries.includes(step.constraints.execution_boundary)) reasons.push(`execution-boundary-not-allowed:${step.constraints.execution_boundary}`);
  if (!profileEntry.risk_classes.includes(step.task_shape.risk_class)) reasons.push(`risk-class-not-supported:${step.task_shape.risk_class}`);
  for (const limit of step.constraints.resource_limits ?? []) {
    const estimate = profileEntry.resource_estimates.find((entry) => entry.measure_id === limit.measure_id);
    if (!estimate && limit.unknown_handling === "reject") reasons.push(`resource-measure-unknown:${limit.measure_id}`);
    else if (estimate && estimate.value > limit.maximum) reasons.push(`resource-limit-exceeded:${limit.measure_id}`);
  }
  return [...new Set(reasons)];
}

function routeAuthority(mode) {
  if (mode === "pinned") return "human-or-coordinator-pinned";
  if (mode === "advisory") return "advisory";
  return "none";
}

function selectedRoute(profileEntry) {
  return {
    profile_id: profileEntry.id,
    requested: {
      provider_id: profileEntry.provider_id,
      model: profileEntry.model,
      reasoning_effort: profileEntry.reasoning_effort,
      model_class: profileEntry.model_class,
      reasoning_class: profileEntry.reasoning_class
    },
    effective: {
      status: "unobserved",
      provider_id: null,
      model: null,
      reasoning_effort: null
    }
  };
}

function canonicalGeneratedAt(value) {
  if (typeof value !== "string" || !CANONICAL_UTC_TIMESTAMP.test(value)) return null;
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return null;
  return timestamp.toISOString() === value ? value : null;
}

export function resolveExecutionRequest(policy, request, options = {}) {
  const policySource = options.policySource === undefined ? "provided" : options.policySource;
  if (!POLICY_SOURCES.includes(policySource)) {
    throw new Error(`Invalid execution route policy source: ${policySource}`);
  }
  const generatedAt = options.generatedAt === undefined
    ? new Date().toISOString()
    : canonicalGeneratedAt(options.generatedAt);
  if (generatedAt === null) {
    throw new Error("Invalid execution route generatedAt: expected a canonical UTC ISO-8601 timestamp");
  }
  const policyValidation = validateExecutionPolicy(policy);
  if (!policyValidation.valid) throw new Error(`Invalid execution policy: ${policyValidation.errors.join("; ")}`);
  const requestValidation = validateExecutionRequest(request, policy);
  if (!requestValidation.valid) throw new Error(`Invalid execution request: ${requestValidation.errors.join("; ")}`);
  const profileMap = new Map(policy.profiles.map((entry) => [entry.id, entry]));
  const capabilityIds = new Set(policy.capabilities.map((entry) => entry.id));
  const steps = request.steps.map((step) => {
    const mode = step.selection?.mode ?? policy.authority.default_selection_mode;
    const unknownRequiredCapabilities = step.capability_route.required
      .filter((id) => !capabilityIds.has(id));
    const unknownOptionalCapabilities = step.capability_route.optional
      .filter((id) => !capabilityIds.has(id));
    const evaluated = policy.profiles.map((entry) => ({
      profile_id: entry.id,
      reasons: profileRejections(entry, step)
    }));
    if (unknownRequiredCapabilities.length > 0) {
      for (const candidate of evaluated) {
        candidate.reasons.push(...unknownRequiredCapabilities.map((id) => `unknown-capability:${id}`));
        candidate.reasons = [...new Set(candidate.reasons)];
      }
    }
    const eligibleIds = evaluated.filter((entry) => entry.reasons.length === 0).map((entry) => entry.profile_id);
    const rule = matchingRule(policy, step.task_shape);
    let selectedProfileId = null;
    let fallbackApplied = false;
    let unresolvedReason = null;
    if (mode === "pinned") {
      const pinned = step.selection.pinned_profile_id;
      if (!profileMap.has(pinned)) unresolvedReason = "pinned-profile-not-found";
      else if (!eligibleIds.includes(pinned)) unresolvedReason = "pinned-profile-ineligible";
      else selectedProfileId = pinned;
    } else {
      selectedProfileId = rule?.preference_order.find((id) => eligibleIds.includes(id)) ?? null;
      if (!selectedProfileId && eligibleIds.includes(policy.fallback_profile_id)) {
        selectedProfileId = policy.fallback_profile_id;
        fallbackApplied = true;
      }
      if (!selectedProfileId) unresolvedReason = unknownRequiredCapabilities.length > 0 ? "unknown-required-capability" : "no-eligible-profile";
    }
    const selected = selectedProfileId ? selectedRoute(profileMap.get(selectedProfileId)) : null;
    return {
      step_id: step.step_id,
      responsibility: step.responsibility ?? null,
      task_shape: {
        position_id: step.task_shape.position_id,
        lifecycle_stage: step.task_shape.lifecycle_stage,
        task_kind: step.task_shape.task_kind,
        risk_class: step.task_shape.risk_class,
        context_profile_digest: step.task_shape.context_profile_digest
      },
      capability_route: {
        required: [...step.capability_route.required],
        optional: [...step.capability_route.optional],
        unknown_required: [...new Set(unknownRequiredCapabilities)],
        unknown_optional: [...new Set(unknownOptionalCapabilities)]
      },
      selection: {
        mode,
        authority: routeAuthority(mode),
        status: selected ? "resolved" : "unresolved",
        rule_id: rule?.id ?? null,
        fallback_applied: fallbackApplied,
        unresolved_reason: unresolvedReason
      },
      selected,
      eligibility: {
        eligible_profile_ids: eligibleIds,
        rejected: evaluated.filter((entry) => entry.reasons.length > 0)
      },
      resource_limits: (step.constraints.resource_limits ?? []).map((entry) => ({
        measure_id: entry.measure_id,
        maximum: entry.maximum,
        unknown_handling: entry.unknown_handling
      })),
      resource_observations: (step.resource_observations ?? []).map((entry) => ({
        measure_id: entry.measure_id,
        status: entry.status,
        value: entry.value,
        source: entry.source,
        quality: entry.quality
      }))
    };
  });
  return {
    schema_version: EXECUTION_ROUTE_SCHEMA,
    generated_at: generatedAt,
    policy: {
      schema_version: policy.schema_version,
      source: policySource
    },
    request: {
      schema_version: request.schema_version,
      work_item_id: request.work_item_id
    },
    authority: {
      automatic_execution: false,
      provider_contact: false,
      mutation_performed: false
    },
    summary: {
      steps: steps.length,
      resolved: steps.filter((entry) => entry.selection.status === "resolved").length,
      unresolved: steps.filter((entry) => entry.selection.status === "unresolved").length
    },
    steps
  };
}

export async function ensureExecutionPolicy(target) {
  const policyPath = path.join(target, EXECUTION_POLICY_RELATIVE_PATH);
  if (await pathExists(policyPath)) return { path: policyPath, created: false, afterHash: null };
  const content = formatJson(defaultExecutionPolicy());
  try {
    await atomicCreate(policyPath, content);
    return { path: policyPath, created: true, afterHash: sha256(content) };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return { path: policyPath, created: false, afterHash: null };
  }
}

export async function readExecutionPolicy(target) {
  const policyPath = path.join(target, EXECUTION_POLICY_RELATIVE_PATH);
  const source = await pathExists(policyPath) ? "project" : "framework-default";
  const policy = source === "project" ? await readJson(policyPath) : defaultExecutionPolicy();
  const validation = validateExecutionPolicy(policy);
  if (!validation.valid) throw new Error(`Invalid execution policy: ${validation.errors.join("; ")}`);
  return { policy, source };
}

export async function resolveExecutionRequestFile(target, requestPath) {
  if (!isSafeRepositoryPath(requestPath)) throw new Error("--request must be a safe repository-relative path");
  const projectRoot = await fs.realpath(path.resolve(target));
  const absoluteRequest = await fs.realpath(path.resolve(target, requestPath));
  const relative = path.relative(projectRoot, absoluteRequest);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("execution request escapes the project repository");
  const [{ policy, source }, request] = await Promise.all([readExecutionPolicy(target), readJson(absoluteRequest)]);
  return resolveExecutionRequest(policy, request, { policySource: source });
}

export function executionPolicyProjection(policy, source = "provided") {
  const mappedProfiles = policy.profiles.filter((entry) => entry.provider_id && entry.model && entry.reasoning_effort).length;
  return {
    schema_version: policy.schema_version,
    source,
    selection_mode: policy.authority.default_selection_mode,
    supported_selection_modes: [...policy.authority.supported_selection_modes],
    automatic_execution: false,
    provider_contact: false,
    profiles: policy.profiles.length,
    mapped_profiles: mappedProfiles,
    capabilities: policy.capabilities.length,
    resource_measures: policy.resource_measures.length,
    fallback_profile_id: policy.fallback_profile_id
  };
}
