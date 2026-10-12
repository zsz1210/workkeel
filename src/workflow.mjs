export const WORKFLOW_V1 = "temple.workflow/v1";
export const WORKFLOW_V2 = "temple.workflow/v2";
export const WORKFLOW_PROFILES = ["lean", "standard", "high-assurance"];
export const WORKFLOW_RISK_TIERS = ["low", "standard", "high", "critical"];
export const WORKFLOW_SCOPE_CLASSES = ["bounded", "ordinary", "cross-system"];
export const LIFECYCLE_OUTCOMES = ["accepted", "no-go", "inconclusive", "cancelled"];

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function profileIndex(workflow, profile) {
  const index = workflow.profile_order.indexOf(profile);
  if (index < 0) throw new Error(`Unknown workflow profile: ${profile}`);
  return index;
}

function standardProfile(workflow) {
  return { id: "standard", transitions: workflow.transitions ?? [] };
}

export function normalizeWorkflow(document) {
  if (!document || typeof document !== "object") throw new Error("Workflow document is required");
  if (document.schema_version === WORKFLOW_V1) {
    return {
      ...document,
      default_profile: "standard",
      profile_order: WORKFLOW_PROFILES,
      profiles: [standardProfile(document)],
      profile_assessment: {
        risk_tier_floors: { low: "lean", standard: "standard", high: "high-assurance", critical: "high-assurance" },
        scope_class_floors: { bounded: "lean", ordinary: "standard", "cross-system": "standard" },
        escalation_triggers: []
      }
    };
  }
  if (document.schema_version !== WORKFLOW_V2) {
    throw new Error(`Unsupported workflow schema: ${document.schema_version ?? "missing"}`);
  }
  const order = document.profile_order ?? [];
  if (JSON.stringify(order) !== JSON.stringify(WORKFLOW_PROFILES)) {
    throw new Error(`Workflow profile order must be ${WORKFLOW_PROFILES.join(", ")}`);
  }
  const profileIds = (document.profiles ?? []).map((entry) => entry.id);
  for (const id of WORKFLOW_PROFILES) {
    if (profileIds.filter((entry) => entry === id).length !== 1) {
      throw new Error(`Workflow must define profile ${id} exactly once`);
    }
  }
  const terminal = new Set(document.terminal_states ?? []);
  for (const state of ["done", "concluded", "cancelled"]) {
    if (!terminal.has(state)) throw new Error(`Workflow terminal states must include ${state}`);
  }
  return document;
}

export function workflowProfileForItem(workflowDocument, item) {
  const workflow = normalizeWorkflow(workflowDocument);
  if (WORKFLOW_PROFILES.includes(item?.workflow_profile)) return item.workflow_profile;
  if (item?.assurance?.profile === "high-assurance") return "high-assurance";
  return workflow.default_profile ?? "standard";
}

export function profileTransitions(workflowDocument, item) {
  const workflow = normalizeWorkflow(workflowDocument);
  const profile = workflowProfileForItem(workflow, item);
  return (workflow.profiles ?? []).find((entry) => entry.id === profile)?.transitions ?? workflow.transitions ?? [];
}

export function transitionFor(workflowDocument, item, toState) {
  const workflow = normalizeWorkflow(workflowDocument);
  const regular = profileTransitions(workflow, item).find(
    (transition) => transition.from === item.state && transition.to === toState
  );
  if (regular) return regular;
  return (workflow.escape_transitions ?? []).find((transition) => {
    if (!(transition.from === "*" || transition.from === item.state)) return false;
    if (transition.to === toState) return true;
    return transition.to === "previous" && item.previous_state === toState;
  }) ?? null;
}

export function nextStateForItem(workflowDocument, item) {
  return profileTransitions(workflowDocument, item).find((transition) => transition.from === item.state)?.to ?? null;
}

export function terminalStateSet(workflowDocument) {
  return new Set(normalizeWorkflow(workflowDocument).terminal_states ?? ["done", "cancelled"]);
}

export function isLegacyConcludedItem(item) {
  return Boolean(
    item?.state === "blocked" &&
    item?.previous_state === "release_gate" &&
    item?.release_gate_result === "no-go" &&
    item?.next_position === null &&
    (item?.gate_evidence?.rollback_plan ?? []).some((entry) => String(entry).endsWith("/release-record.md"))
  );
}

export function lifecycleProjection(workflowDocument, item) {
  const legacy = isLegacyConcludedItem(item);
  const effectiveState = legacy ? "concluded" : item.state;
  const terminal = legacy || terminalStateSet(workflowDocument).has(effectiveState);
  let outcome = item.lifecycle_outcome ?? null;
  if (!outcome && item.state === "done") outcome = "accepted";
  if (!outcome && item.state === "cancelled") outcome = "cancelled";
  if (!outcome && legacy) outcome = "no-go";
  return {
    state: item.state,
    effective_state: effectiveState,
    terminal,
    workflow_profile: workflowProfileForItem(workflowDocument, item),
    lifecycle_outcome: outcome,
    closeout_reasons: item.closeout_reasons ?? [],
    legacy_terminal_normalized: legacy
  };
}

export function assessWorkflowProfile(workflowDocument, input = {}) {
  const workflow = normalizeWorkflow(workflowDocument);
  const requestedProfile = String(input.requestedProfile ?? workflow.default_profile ?? "standard").trim();
  const riskTier = String(input.riskTier ?? (requestedProfile === "lean" ? "low" : "standard")).trim();
  const scopeClass = String(input.scopeClass ?? (requestedProfile === "lean" ? "bounded" : "ordinary")).trim();
  const triggers = uniqueStrings(input.escalationTriggers);
  if (!WORKFLOW_PROFILES.includes(requestedProfile)) {
    throw new Error(`--workflow-profile must be ${WORKFLOW_PROFILES.join(", ")}`);
  }
  if (!WORKFLOW_RISK_TIERS.includes(riskTier)) {
    throw new Error(`--risk-tier must be ${WORKFLOW_RISK_TIERS.join(", ")}`);
  }
  if (!WORKFLOW_SCOPE_CLASSES.includes(scopeClass)) {
    throw new Error(`--scope-class must be ${WORKFLOW_SCOPE_CLASSES.join(", ")}`);
  }
  const triggerFloors = new Map(
    (workflow.profile_assessment?.escalation_triggers ?? []).map((entry) => [entry.id, entry.minimum_profile])
  );
  const unknown = triggers.filter((entry) => !triggerFloors.has(entry));
  if (unknown.length) throw new Error(`Unsupported escalation trigger: ${unknown.join(", ")}`);
  const floors = [
    requestedProfile,
    workflow.profile_assessment?.risk_tier_floors?.[riskTier] ?? "standard",
    workflow.profile_assessment?.scope_class_floors?.[scopeClass] ?? "standard",
    ...triggers.map((entry) => triggerFloors.get(entry))
  ];
  const effectiveProfile = floors.reduce((strongest, candidate) =>
    profileIndex(workflow, candidate) > profileIndex(workflow, strongest) ? candidate : strongest
  , "lean");
  if (effectiveProfile === "high-assurance" && input.collaborationProfile !== "high-assurance") {
    throw new Error("This assessment requires High-Assurance collaboration prerequisites before the Work Item can proceed");
  }
  return {
    requested_profile: requestedProfile,
    effective_profile: effectiveProfile,
    scope_class: scopeClass,
    escalation_triggers: triggers,
    rationale: String(input.rationale ?? "").trim(),
    evidence_refs: uniqueStrings(input.evidenceRefs),
    evaluated_at: input.evaluatedAt ?? new Date().toISOString(),
    escalated: effectiveProfile !== requestedProfile,
    risk_tier: riskTier
  };
}

export function assertProfileChangeAllowed(workflowDocument, item, assessment) {
  const workflow = normalizeWorkflow(workflowDocument);
  const existing = workflowProfileForItem(workflow, item);
  if (profileIndex(workflow, assessment.effective_profile) < profileIndex(workflow, existing)) {
    throw new Error(`Workflow profile cannot be downgraded from ${existing} to ${assessment.effective_profile}`);
  }
  if (!["intake", "spec", "design", "blocked", "cancelled"].includes(item.state) && assessment.effective_profile !== existing) {
    throw new Error(`Workflow profile is locked after Build; block and replan ${item.id} before escalation`);
  }
}

export function trackerStatusForLifecycle(lifecycle) {
  if (lifecycle.effective_state === "done") return "done";
  if (lifecycle.effective_state === "cancelled" || lifecycle.effective_state === "concluded") return "cancelled";
  if (lifecycle.effective_state === "blocked") return "blocked";
  if (["build", "test", "eval", "independent_qa", "release_gate"].includes(lifecycle.effective_state)) return "in_progress";
  return "open";
}
