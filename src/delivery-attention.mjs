const REVIEW_POSITIONS = new Set(["quality_evaluator", "independent_qa", "verifier"]);
const TERMINAL_STATES = new Set(["done", "concluded", "cancelled"]);
const nonEmpty = value => typeof value === "string" && value.trim().length > 0;

function condition(value, owner) {
  if (typeof value === "string") return { kind: "decision", description: value, owner, next_action: "Resolve this recorded condition with the responsible owner." };
  if (!value || typeof value !== "object" || value.satisfied === true) return null;
  const description = value.description ?? value.message ?? value.condition;
  if (!nonEmpty(description)) return null;
  return { kind: ["environment", "decision", "evidence", "owner"].includes(value.kind) ? value.kind : "decision",
    description, owner: value.owner ?? owner, next_action: value.next_action ?? "Resolve this recorded condition with the responsible owner." };
}

/** Navigation only. Runtime completion, archived measurements and merged Git state do not grant acceptance. */
export function deriveDeliveryAttention(workItem, options = {}) {
  const item = workItem ?? {};
  const candidateRevision = options.candidateRevision ?? item.developer_candidate_revision ?? item.tested_revision
    ?? [...(item.handoffs ?? [])].reverse().find(entry => entry.from_position === "developer")?.input_revision ?? null;
  const claim = item.claim?.status === "active" ? item.claim : null;
  const owner = { position_id: item.owner_position ?? null, agent_id: claim?.agent_id ?? item.assigned_agent_id ?? null,
    principal_id: claim?.principal_id ?? null, source: claim ? "active-claim" : item.assigned_agent_id ? "recorded-assignment" : "unknown" };
  const relevantWorkers = (options.workers ?? []).filter(worker => worker.work_item_id === item.id);
  const activeWorkers = relevantWorkers.filter(worker => worker.status === "active" && !worker.completed_at && nonEmpty(worker.attached_at)
    && ((worker.runtime_kind === "internal-subagent" && nonEmpty(worker.runtime_id)) || (worker.runtime_kind === "user-task" && nonEmpty(worker.task_id)))
    && claim && worker.claim_id === claim.id && worker.agent_id === claim.agent_id && worker.position_id === item.owner_position);
  const reviewerWorkers = activeWorkers.filter(worker => REVIEW_POSITIONS.has(worker.position_id));
  const entries = (Array.isArray(options.evidence) ? options.evidence : options.evidence?.entries ?? []).filter(entry => entry.work_item_id === item.id);
  const now = options.now === undefined ? Date.now() : Date.parse(options.now);
  const currentEvidence = entries.filter(entry => !entry.invalidated_at && ["test", "runtime"].includes(entry.kind)
    && (!entry.expires_at || (Number.isFinite(Date.parse(entry.expires_at)) && Date.parse(entry.expires_at) > now))
    && candidateRevision && entry.scope_revision === candidateRevision);
  const durabilityItems = options.durability?.items ?? [];
  const debt = durabilityItems.filter(entry => entry.work_item_id === item.id && entry.status === "historical-evidence-debt");
  const historicalDebt = debt.filter(entry => candidateRevision && entry.scope_revision !== candidateRevision);
  const currentDebt = debt.filter(entry => !candidateRevision || entry.scope_revision === candidateRevision);
  const structured = [...(item.missing_conditions ?? []), ...(options.missingConditions ?? [])].map(value => condition(value, owner)).filter(Boolean);
  const described = new Set(structured.map(value => value.description));
  const missing = [...structured, ...(item.unresolved ?? []).filter(value => !described.has(typeof value === "string" ? value : value?.description))
    .map(value => condition(value, owner)).filter(Boolean)]
    .filter((value, index, values) => values.findIndex(entry => entry.description === value.description) === index);
  for (const entry of currentDebt) missing.push({ kind: "evidence", description: `Recorded artifact bytes are missing or invalid: ${entry.evidence_id}`,
    owner, next_action: entry.next_action ?? "Retrieve the recorded artifact bytes and verify their digest." });
  const latestDeveloperHandoff = [...(item.handoffs ?? [])].reverse().find(entry => entry.from_position === "developer");
  const reviewerHandoff = [...(item.handoffs ?? [])].reverse().find(entry => REVIEW_POSITIONS.has(entry.from_position)
    && nonEmpty(entry.artifact) && candidateRevision && entry.input_revision === candidateRevision
    && nonEmpty(entry.actor) && entry.actor !== latestDeveloperHandoff?.actor
    && (!latestDeveloperHandoff?.created_at || entry.created_at >= latestDeveloperHandoff.created_at));
  // A canonical completed handoff records completed responsibility. Its acceptance
  // judgment remains distinct from the Work Item's organizational closeout.
  const reviewCompleted = Boolean(reviewerHandoff);
  const accepted = item.state === "done" && (item.release_gate_result === "go"
    || (item.workflow_profile === "lean" && (item.gate_evidence?.lean_closeout?.length ?? 0) > 0)
    || (item.workflow_profile === "mechanical" && (item.gate_evidence?.mechanical_closeout?.length ?? 0) > 0));
  let state;
  let nextAction;
  if (missing.some(entry => entry.kind === "environment")) {
    state = "awaiting-environment";
    nextAction = missing.find(entry => entry.kind === "environment").next_action;
  } else if (missing.some(entry => entry.kind === "decision")) {
    state = "awaiting-decision";
    nextAction = missing.find(entry => entry.kind === "decision").next_action;
  } else if (currentDebt.length || missing.some(entry => entry.kind === "evidence")) {
    state = "awaiting-evidence";
    nextAction = missing.find(entry => entry.kind === "evidence").next_action;
  } else if (missing.some(entry => entry.kind === "owner")) {
    state = "awaiting-owner";
    nextAction = missing.find(entry => entry.kind === "owner").next_action;
  } else if (accepted) {
    state = "acceptance-complete";
    nextAction = "Organizational acceptance is recorded; any publication or deployment needs its own authorization.";
  } else if (activeWorkers.length) {
    state = "active-execution";
    nextAction = reviewerWorkers.length ? "Await the attached reviewer's candidate judgment and evidence." : "Await the attached worker's scoped result and evidence.";
  } else if (reviewCompleted) {
    state = "review-completed";
    nextAction = "Complete the next eligible owner or acceptance step using the recorded review and remaining requirements.";
  } else if (historicalDebt.length && TERMINAL_STATES.has(item.state)) {
    state = "historical-evidence-debt";
    nextAction = "Recover the historical evidence bytes while preserving the recorded lifecycle and invalidated attempts.";
  } else {
    state = "awaiting-owner";
    nextAction = claim ? "The recorded owner can continue the scoped work; no attached active worker is recorded." : "Have the eligible owner claim or resume the next scoped responsibility.";
  }
  if (state === "awaiting-owner" && !missing.some(entry => entry.kind === "owner")) missing.push({ kind: "owner", description: claim ? "No attached active runtime is recorded for this claim." : "No active eligible ownership claim is recorded.", owner, next_action: nextAction });
  return { schema_version: "temple.delivery-attention/v1", authority: "navigation-only", mutation_performed: false,
    work_item_id: item.id ?? null, candidate_revision: candidateRevision, state, owner,
    execution_state: activeWorkers.length ? "active" : "not-running", active_worker_ids: activeWorkers.map(worker => worker.id),
    review_state: reviewCompleted ? "completed" : reviewerWorkers.length ? "running" : "not-running",
    acceptance_state: accepted ? "complete" : "not-complete",
    evidence_state: currentDebt.length ? "missing-current-evidence" : currentEvidence.length ? "recorded-measurement" : "no-current-measurement",
    historical_evidence_debt: historicalDebt.map(entry => ({ evidence_id: entry.evidence_id, scope_revision: entry.scope_revision, next_action: entry.next_action })),
    missing_conditions: missing, next_action: nextAction };
}
