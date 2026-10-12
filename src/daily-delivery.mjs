import { execFileSync } from "node:child_process";
import { loadProjectContext } from "./project.mjs";
import { readWorkItem, claimWorkItem, reworkWorkItem, prepareWorkItemRework, listWorkItemDocuments, activeExecutionRequirements } from "./work-items.mjs";
import { assessWorkflowProfile, profileTransitions } from "./workflow.mjs";
import { deliveryStages } from "./workflow-completion.mjs";
import { readCollaborationState, agentIsEligible, sponsoredPrincipal } from "./collaboration.mjs";
import { resolveProjectActor } from "./actor-resolution.mjs";
import { resolveGitRevision } from "./evidence.mjs";
import { finishLeanWorkItem } from "./lean-finish.mjs";
import { requireProductScope } from "./lean-delivery.mjs";
import { OperationError } from "./operation-errors.mjs";
import { isWorkItemId } from "./ids.mjs";
import { resolveWorkItemContext } from "./context.mjs";
import { runLocalChecks, workspaceSnapshot } from "./delivery-check.mjs";
import { digest, ensure, textValue, readSource, readSession, saveSession, event, validatePlan, validateReceipt, deliveryReport, admission } from "./delivery-ledger.mjs";

const baseGates = ["work_order", "approved_scope", "acceptance_criteria", "technical_design", "risk_review"];
const gatesFor = item => [...baseGates, ...(item.workflow_profile === "lean" ? ["profile_eligibility"] : []), ...(item.workflow_profile === "high-assurance" ? ["assurance_risk_review"] : [])];
const autonomous = plan => plan.schema_version === "temple.delivery-plan/v2";
function planEligibility(plan, item) {
  if (!autonomous(plan)) ensure(item.workflow_profile === "lean" && item.risk_tier === "low" && item.profile_assessment?.scope_class === "bounded" && item.ui_delivery_mode === "not-applicable", "Daily core requires existing low-risk bounded Lean eligibility");
  // This pure eligibility guard runs before this operation claims or writes.
  // Completion retains its own mutation/recovery classification around the same rule.
  try { requireProductScope(item.affected_paths ?? []); }
  catch (error) { throw new OperationError("GUARD_REJECTED", error.message); }
}
const phases = item => item.state === "build" ? "build" : "verification";
const operationId = value => { ensure(typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value), "Stable operation_id required"); return value; };
async function coreItem(root, id, terminal = false) {
  const item = await readWorkItem(root, id), project = await loadProjectContext(root), collaboration = await readCollaborationState(root);
  const a = assessWorkflowProfile(project.workflow, { requestedProfile: item.workflow_profile, riskTier: item.risk_tier,
    scopeClass: item.profile_assessment?.scope_class, escalationTriggers: item.profile_assessment?.escalation_triggers, collaborationProfile: collaboration.profile });
  ensure(a.effective_profile === item.workflow_profile, "Reconcile changed workflow risk assessment before delivery");
  ensure((terminal ? [...deliveryStages, "done"] : deliveryStages).includes(item.state), "Delivery requires approved Build entry or a verification/closeout stage");
  ensure(item.scope?.length && item.acceptance_criteria?.length && item.affected_paths?.length && !item.unresolved?.length, "Explicit scope and acceptance without unresolved authority are required");
  ensure(gatesFor(item).every(g => Array.isArray(item.gate_evidence?.[g]) && item.gate_evidence[g].length), "All existing prebuild gates remain required");
  return { item, project, collaboration };
}
async function scopeState(root, item, plan) {
  const refs = gatesFor(item).flatMap(g => item.gate_evidence[g]);
  const normalized = [];
  const specifications = [];
  if (autonomous(plan)) {
    const registry = JSON.parse((await readSource(root, ".ai-org/project/spec-index.json")).body);
    for (const ref of [...(item.spec_refs ?? []), ...(item.ux_refs ?? []), ...(item.ui_refs ?? []), ...(item.contract_refs ?? [])]) {
      const entry = registry.entries.find(e => e.id === ref.id);
      ensure(entry, "Current specification entry required"); specifications.push(entry);
    }
  }
  if (refs.some(r => r.startsWith("EVID-"))) {
    const registry = JSON.parse((await readSource(root, ".ai-org/project/evidence.json")).body);
    for (const ref of refs.filter(r => r.startsWith("EVID-"))) {
      const entry = registry.entries.find(e => e.id === ref);
      ensure(entry && entry.work_item_id === item.id && !entry.invalidated_at, "Current prebuild Evidence ID required"); normalized.push(entry);
    }
  }
  const sources = [...new Set([...refs.filter(r => !r.startsWith("EVID-")), ...normalized.flatMap(e => (e.artifacts ?? []).map(a => a.path)), plan.authorization_ref,
    ...specifications.flatMap(e => [...(e.source?.kind === "repository" ? [e.source.location] : []), ...(e.approval_ref ? [e.approval_ref] : [])]),
    ".ai-org/core/workflow.json", ".ai-org/project/usage-policy.json", ".ai-org/project/repository-integration.json",
    ...(autonomous(plan) ? ["temple.lock", ".agents/skills/temple-work/references/daily-delivery.md", ".ai-org/core/positions.json", ".ai-org/core/high-assurance.json", ".ai-org/core/ui-design.json", ".ai-org/core/policies.json", ".ai-org/project/agents.json", ".ai-org/project/assignments.json", ".ai-org/project/collaboration.json"] : []),
    "AGENTS.md", "TEMPLE.md", ".agents/skills/temple-work/SKILL.md"])].sort();
  const context = await Promise.all(sources.map(p => readSource(root, p)));
  const fields = Object.fromEntries(["scope", "acceptance_criteria", "affected_paths", "specification_mode", "spec_refs", "contract_refs", "ux_refs", "ui_refs", "workflow_profile", "risk_tier", "profile_assessment", "ui_delivery_mode"].map(k => [k, item[k] ?? null]));
  return { digest: digest({ fields, sources: context.map(({ path, sha256 }) => ({ path, sha256 })), ...(autonomous(plan) ? { normalized, specifications } : {}) }), context };
}
async function unchanged(root, session, item) {
  planEligibility(session.plan, item);
  const p = await readSource(root, session.plan_ref);
  ensure(p.sha256 === session.plan_source_sha256, "Approved delivery plan changed; reconcile authority through the normal route");
  ensure((await scopeState(root, item, session.plan)).digest === session.scope_digest, "Delivery authority/scope changed; no automatic continuation");
}
async function actor(root, item, options, { claim = false } = {}) {
  ensure(textValue(options.agentId) && textValue(options.principalId), "Explicit Agent and Principal required");
  const { collaboration, project } = await coreItem(root, item.id);
  ensure(project.agents.get(options.agentId)?.active !== false && project.agents.has(options.agentId) && agentIsEligible(collaboration, options.agentId, item.owner_position, activeExecutionRequirements(item).disciplines), "Agent is not eligible for current Position");
  await resolveProjectActor(root, project, { collaboration, item, agentId: options.agentId, principalId: options.principalId,
    requiredDisciplines: activeExecutionRequirements(item).disciplines });
  const context = await resolveWorkItemContext(root, { workItemId: item.id, position: item.owner_position,
    agentId: options.agentId, principalId: options.principalId, compact: true });
  const active = new Set((await listWorkItemDocuments(root)).filter(w => w.claim?.status === "active").map(w => w.id));
  ensure(!context.references.overlaps.some(o => active.has(o.work_item_id)), "Conflicting active Work Item scope; coordinate before continuing");
  const runtime = await readSource(root, ".ai-org/project/runtime-workers.json").catch(e => { if (e.code === "ENOENT") return null; throw e; });
  if (runtime) ensure(!JSON.parse(runtime.body).workers.some(w => w.work_item_id === item.id && !["completed", "failed", "cancelled"].includes(w.status)), "Active workers require existing runtime coordination");
  if (item.state !== "build") ensure(item.handoffs?.findLast(h => h.from_position === "developer")?.actor && item.handoffs.findLast(h => h.from_position === "developer").actor !== options.agentId && item.developer_candidate_revision === resolveGitRevision(root, "HEAD"), "Verifier/release owner must be distinct and inspect the exact candidate");
  if (item.claim?.status !== "active" && claim) {
    item = (await claimWorkItem(root, { workItemId: item.id, agentId: options.agentId, principalId: options.principalId,
      baseRevision: resolveGitRevision(root, "HEAD"), branch: execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim(), worktree: root })).item;
  }
  ensure(item.claim?.status === "active" && item.claim.agent_id === options.agentId && item.claim.principal_id === options.principalId, "The current claim belongs to another actor or is missing");
  return item;
}
function allowed(session, item, requiredMs = 0) {
  ensure(!session.pause, "Delivery is paused; supply resolution evidence before resuming");
  const a = admission(session, phases(item));
  ensure(a.allowed && a.remaining_ms - a.downstream_reserve_ms > requiredMs, `Delivery admission blocked: ${a.reasons.join(",") || "insufficient-operation-time-reserve"}`);
}
function nextAction(session, item) {
  if (session.pending) return { action: session.pending.action === "finish" ? "recover-finish" : "reconcile", reason: "Preserve pending execution; never infer failure means no mutation", request: session.pending.request };
  if (session.pause) return { action: "resolve-pause", reason: session.pause.reason };
  if (item.state === "done") return { action: "complete", accepted_by_lifecycle: true };
  const a = admission(session, phases(item));
  if (!a.allowed) return { action: "resolve-capacity", reasons: a.reasons };
  if (item.claim?.status !== "active") return { action: "open", position: item.owner_position, reason: "Claim the current stage through delivery open" };
  const last = session.last_check;
  if (!last || last.revision !== item.developer_candidate_revision && item.state !== "build" || last.actor !== item.claim.agent_id) return { action: item.state === "build" ? "implement-and-check" : item.state === "release_gate" ? "review-release-evidence-and-check" : "review-and-check", position: item.owner_position };
  if (!last.result.accepted && session.repairs >= session.plan.budget.max_repairs) return { action: "resolve-capacity", reasons: ["repair-limit"] };
  if (!last.result.accepted) return { action: last.result.status === "instrument-failure" ? "reconcile" : item.state === "build" ? "repair-and-check" : "record-findings-and-rework" };
  return { action: item.state === "build" ? "finish-developer" : "finish-verifier-after-independent-pass", position: item.owner_position };
}
async function response(root, session, item, extra = {}) {
  const { workflow } = await loadProjectContext(root);
  return { schema_version: "temple.daily-delivery-result/v1", work_item_id: item.id, mode: autonomous(session.plan) ? "autonomous" : "daily-core", lifecycle_state: item.state,
    workflow_profile: item.workflow_profile, risk_tier: item.risk_tier, required_edge: profileTransitions(workflow, item).find(e => e.from === item.state) ?? null,
    next: nextAction(session, item), capacity: admission(session, phases(item)), authority_granted: false, model_calls_performed: 0, ...extra };
}
export async function openDelivery(root, options) {
  let { item } = await coreItem(root, options.workItemId);
  let session = await readSession(root, item.id).catch(e => { if (e.code === "ENOENT") return null; throw e; });
  if (session) {
    if (options.requestRef) ensure(options.requestRef === session.plan_ref, "Existing plan identity cannot be replaced");
    await unchanged(root, session, item); ensure(!session.pending, "Pending execution must be reconciled before opening another stage");
    allowed(session, item);
  } else {
    ensure(item.state === "build", "Open a new delivery at Build after approved prebuild evidence");
    const source = await readSource(root, options.requestRef), plan = validatePlan(JSON.parse(source.body));
    planEligibility(plan, item);
    const scope = await scopeState(root, item, plan);
    session = { schema_version: "temple.daily-delivery/v1", work_item_id: item.id, opened_at_ms: Date.now(), completed_at_ms: null,
      plan_ref: options.requestRef, plan_source_sha256: source.sha256, plan, scope_digest: scope.digest,
      repairs: 0, events: [], pending: null, pause: null, last_check: null, coverage: null };
    event(session, "opened", { phase: "build", actor: options.agentId });
  }
  // Claiming and recording are not a multi-file transaction. An interrupted open
  // may resume the same current actor's claim; it never steals or repeats a claim.
  const carried = autonomous(session.plan) && session.last_check?.actor === options.agentId && session.last_check.result.accepted && session.last_check.result.snapshot_digest === (await workspaceSnapshot(root, item.id)).digest;
  item = await actor(root, item, options, { claim: true });
  if (carried) session.last_check.result.snapshot_digest = (await workspaceSnapshot(root, item.id)).digest;
  if (session.events.findLast(e => e.kind === "entered")?.claim_id !== item.claim.id) {
    event(session, "entered", { phase: phases(item), actor: options.agentId, claim_id: item.claim.id });
    session.coverage = null;
  }
  await saveSession(root, session);
  const scope = await scopeState(root, item, session.plan), grouped = new Map();
  for (const s of scope.context) {
    if (!grouped.has(s.sha256)) grouped.set(s.sha256, { paths: [], sha256: s.sha256, body: s.body });
    grouped.get(s.sha256).paths.push(s.path);
  }
  return response(root, session, item, { contract: { goal: item.scope, acceptance: item.acceptance_criteria, allowed_paths: item.affected_paths,
    context: [...grouped.values()], claim_id: item.claim.id, candidate_revision: resolveGitRevision(root, "HEAD"),
    methods: "Choose investigation, design and implementation. Continue authorized work through tests and repair; another Identity independently verifies. Do not return only a plan or ask again for routine authorized work.",
    instructions: "Native/project instructions remain required; this packet grants no permissions or provider isolation." } });
}
// A deliberately bounded local viewer projection. Do not expose the report's raw
// pending request or receipt bodies, or follow paths supplied by an HTTP client.
export async function inspectDeliverySummary(root, id) {
  ensure(isWorkItemId(id), "Invalid Work Item ID");
  const text = value => String(value ?? "unknown").replace(/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g, " ").slice(0, 1000);
  const number = value => Number.isFinite(value) && value >= 0 ? value : null;
  const base = { schema_version: "temple.delivery-summary/v1", work_item_id: id,
    observed_at: new Date().toISOString(), model_calls_performed: 0 };
  let item;
  try {
    item = JSON.parse((await readSource(root, `.ai-org/work-items/${id}.json`)).body);
    ensure(item.id === id && typeof item.state === "string", "Invalid Work Item");
  } catch (error) {
    return { ...base, availability: error.code === "ENOENT" ? "work-item-missing" : "unavailable" };
  }
  const canonical = { lifecycle_state: text(item.state), outcome: text(item.lifecycle_outcome ?? "not recorded"),
    workflow_profile: text(item.workflow_profile ?? "not recorded"),
    developer_revision: text(item.developer_candidate_revision ?? "not recorded"),
    tested_revision: text(item.tested_revision ?? "not recorded") };
  try {
    const session = await readSession(root, id);
    ensure(Number.isSafeInteger(session.opened_at_ms) && session.opened_at_ms >= 0 &&
      (session.completed_at_ms === null || Number.isSafeInteger(session.completed_at_ms) && session.completed_at_ms >= session.opened_at_ms), "Invalid session timing");
    const report = deliveryReport(session, item);
    const refs = values => { const all = [...new Set(values ?? [])]; return { total: all.length, refs: all.slice(0, 3).map(text) }; };
    return { ...base, availability: "available", canonical,
      status_label: text(stateLabel(report, item, session)), session_completed: report.session_completed,
      time: Object.fromEntries(Object.entries(report.time).map(([key, value]) => [key, key.endsWith("_ms") ? number(value) : text(value)])),
      usage: { ...Object.fromEntries(["observed_calls", "known_calls", "unknown_calls", "known_operational_tokens", "total_operational_tokens"].map(key => [key, number(report.usage[key])])), complete_task_coverage: report.usage.complete_task_coverage === true },
      checks: { total: report.checks.length, items: report.checks.slice(-5).map(c => ({
        sequence: number(c.sequence), revision: text(c.revision), accepted: c.accepted === true ? true : c.accepted === false ? false : null, elapsed_ms: number(c.elapsed_ms),
        cache_status: text(c.cache_status ?? "not recorded"), cache_reason: text(c.cache_reason ?? "not recorded"),
        execution_started: typeof c.execution_started === "boolean" ? c.execution_started : null,
        measurement_ref: c.measurement_ref ? text(c.measurement_ref) : null
      })) },
      evidence: { test: refs(item.gate_evidence?.test_evidence), evaluation: refs(item.gate_evidence?.evaluation_report),
        independent_qa: refs([...(item.gate_evidence?.independent_qa_pass ?? []), ...(item.gate_evidence?.independent_qa_report ?? [])]) },
      repairs: number(report.repairs), pause_count: report.pauses.length,
      active_pause_reason: session.pause ? text(session.pause.reason ?? "not recorded") : null,
      pending_action: report.pending ? text(report.pending.action ?? "unknown operation") : null };
  } catch (error) {
    return { ...base, canonical, availability: error.code === "ENOENT" ? "session-missing" : "unavailable" };
  }
}

export async function inspectDelivery(root, options) {
  const session = await readSession(root, options.workItemId), item = await readWorkItem(root, options.workItemId);
  if (options.report) {
    const report = deliveryReport(session, item);
    return options.humanReadable ? formatDeliveryReport(report, item, session) : report;
  }
  await coreItem(root, item.id, true); await unchanged(root, session, item);
  const result = await response(root, session, item);
  if (session.last_check?.result.accepted && !session.pending && !session.pause && result.capacity.allowed && item.claim?.status === "active" && item.state !== "done" && (session.last_check.revision !== resolveGitRevision(root, "HEAD") || session.last_check.result.snapshot_digest !== (await workspaceSnapshot(root, item.id)).digest)) result.next = { action: "check-current-candidate", reason: "Candidate or working content changed after last check" };
  return result;
}
export async function checkDelivery(root, options) {
  const session = await readSession(root, options.workItemId); let { item } = await coreItem(root, options.workItemId);
  await unchanged(root, session, item); ensure(!session.pending, "Execution pending; reconcile before running checks");
  item = await actor(root, item, options); allowed(session, item, session.plan.test_timeout_ms);
  if (session.last_check && !session.last_check.result.accepted) {
    ensure(session.repairs < session.plan.budget.max_repairs, "Repair limit reached; no automatic retry");
    session.repairs++;
    event(session, "repair-started", { phase: "repair", actor: options.agentId, reason: "failed-check" });
  }
  session.pending = { action: "check", actor: options.agentId, revision: resolveGitRevision(root, "HEAD"), started_at_ms: Date.now() };
  await saveSession(root, session);
  const result = await runLocalChecks(root, item.id, session.plan, { started: async data => {
    Object.assign(session.pending, data); await saveSession(root, session);
  } });
  event(session, "checked", { phase: phases(item), actor: options.agentId, revision: session.pending.revision, result, elapsed_ms: result.elapsed_ms });
  session.last_check = { actor: options.agentId, revision: session.pending.revision, result };
  if (result.process_exit_confirmed) session.pending = null;
  if (result.status === "instrument-failure") session.pause = { at_ms: Date.now(), reason: "instrument-uncertain", evidence: result.instrument_error };
  await saveSession(root, session);
  return response(root, session, item, { check: result });
}
export async function finishDelivery(root, options, hooks = {}) {
  const source = await readSource(root, options.requestRef), request = JSON.parse(source.body); operationId(request.operation_id);
  const session = await readSession(root, options.workItemId);
  let item = await readWorkItem(root, options.workItemId);
  await unchanged(root, session, item);
  const prior = session.events.find(e => e.kind === "finished" && e.operation_id === request.operation_id && e.settled);
  if (prior && !session.pending) {
    ensure(prior.request_sha256 === source.sha256 && prior.actor === options.agentId && prior.principal === options.principalId, "Conflicting completed operation identity");
    return response(root, session, item, { already_recorded: true, historical: true });
  }
  if (session.pending) ensure(session.pending.action === "finish" && session.pending.request_sha256 === source.sha256 && session.pending.request_ref === options.requestRef, "Only the identical pending finish request can recover");
  else {
    ({ item } = await coreItem(root, item.id)); item = await actor(root, item, options); allowed(session, item);
    const check = session.last_check;
    ensure(check?.result.accepted && check.actor === options.agentId && check.revision === request.revision && check.revision === resolveGitRevision(root, "HEAD") && check.result.snapshot_digest === (await workspaceSnapshot(root, item.id)).digest, "A passing exact-current-candidate check by this actor is required");
    ensure(request.position === item.owner_position, "Finish Position mismatch");
    if (autonomous(session.plan)) ensure(request.stage === item.state, "Explicit autonomous completion stage must match current lifecycle");
    session.pending = { action: "finish", request_ref: options.requestRef, request_sha256: source.sha256,
      request: { workItemId: item.id, position: request.position, operationId: request.operation_id, claimId: item.claim.id,
        ...(autonomous(session.plan) ? { workflowStage: item.state, satisfied: request.satisfied, approval: request.approval, rollback: request.rollback } : {}),
        agentId: options.agentId, principalId: options.principalId, revision: request.revision,
        completed: request.completed, evidence: request.evidence, judgment: request.judgment, testEvidence: request.test_evidence, leanCloseout: request.lean_closeout }, started_at_ms: Date.now() };
    await finishLeanWorkItem(root, { ...session.pending.request, dryRun: true });
    await saveSession(root, session);
  }
  ensure(session.pending.request.agentId === options.agentId && session.pending.request.principalId === options.principalId, "Pending finish actor mismatch");
  const start = Date.now(), result = await finishLeanWorkItem(root, session.pending.request, hooks);
  event(session, "finished", { phase: request.position === "developer" ? "build" : "closeout", actor: options.agentId, principal: options.principalId, operation_id: request.operation_id, request_sha256: source.sha256, settled: result.success, status: result.status, elapsed_ms: Date.now() - start });
  if (result.success) {
    const checked = session.last_check;
    session.pending = null; session.last_check = null; session.coverage = null;
    item = await readWorkItem(root, item.id);
    // The actual same-Identity check remains evidence after only our validated
    // administrative writes. Any subsequent source/evidence edit invalidates it.
    if (autonomous(session.plan) && checked && ["eval", "independent_qa"].includes(item.state)) {
      session.last_check = structuredClone(checked);
      session.last_check.result.snapshot_digest = (await workspaceSnapshot(root, item.id)).digest;
    }
    if (item.state === "done") session.completed_at_ms = Date.now();
    else event(session, "awaiting-verifier", { phase: "verification" });
  }
  await saveSession(root, session);
  return response(root, session, item, { finish: result });
}
export async function reworkDelivery(root, options) {
  const session = await readSession(root, options.workItemId); let { item } = await coreItem(root, options.workItemId);
  const request = JSON.parse((await readSource(root, options.requestRef)).body);
  await unchanged(root, session, item); item = await actor(root, item, options); allowed(session, item);
  ensure(!session.pending && ["test", "eval", "independent_qa"].includes(item.state) && session.repairs < session.plan.budget.max_repairs, "No qualified repair capacity or another operation is pending");
  const capacity = admission(session, "repair"); ensure(capacity.allowed && capacity.remaining_ms > capacity.downstream_reserve_ms + session.plan.budget.repair_reserve_ms, "Complete repair and revalidation capacity must remain");
  const reworkOptions = { workItemId: item.id, sameScope: true, actor: options.agentId, inputRevision: request.revision, reason: request.reason, evidence: request.evidence };
  await prepareWorkItemRework(root, reworkOptions);
  session.pending = { action: "rework", request, started_at_ms: Date.now() }; await saveSession(root, session);
  const start = Date.now(), result = await reworkWorkItem(root, reworkOptions);
  session.repairs++; session.pending = null; session.last_check = null; session.coverage = null;
  event(session, "reworked", { phase: "repair", actor: options.agentId, rejected_revision: request.revision, evidence: request.evidence, elapsed_ms: Date.now() - start });
  await saveSession(root, session); return response(root, session, result.item, { rework: result.entry });
}
export async function observeDelivery(root, options) {
  const session = await readSession(root, options.workItemId), item = await readWorkItem(root, options.workItemId);
  const source = await readSource(root, options.requestRef), receipt = JSON.parse(source.body); validateReceipt(receipt, item.id);
  // Observations can arrive after a stage ends, but only from a recorded participant.
  ensure((await readCollaborationState(root)).profile === "solo" && session.events.some(e => e.kind === "entered" && e.actor === options.agentId) && options.principalId === "human", "Usage writer must be a recorded participant; non-solo uses the existing collector");
  const prior = session.events.find(e => e.kind === "usage" && e.receipt.call_id === receipt.call_id);
  if (prior) ensure(prior.source_sha256 === source.sha256, "Conflicting usage call ID");
  else event(session, "usage", { receipt, source_ref: options.requestRef, source_sha256: source.sha256, provenance: "supplied-task-scoped-provider-receipt" });
  const calls = session.events.filter(e => e.kind === "usage");
  if (receipt.coverage?.complete === true) {
    ensure(receipt.coverage.from_work_item_creation === true && Array.isArray(receipt.coverage.call_ids) && digest([...new Set(receipt.coverage.call_ids)].sort()) === digest(calls.map(e => e.receipt.call_id).sort()), "Complete coverage must attest every unique recorded task call from creation");
    session.coverage = { complete: true, source_ref: options.requestRef, source_sha256: source.sha256, kind: "provider-attestation; not independently inferred" };
  } else session.coverage = null;
  await saveSession(root, session); return deliveryReport(session, item);
}
export async function pauseDelivery(root, options) {
  const session = await readSession(root, options.workItemId); const { item } = await coreItem(root, options.workItemId);
  await actor(root, item, options);
  const request = JSON.parse((await readSource(root, options.requestRef)).body);
  ensure(["missing-input", "external-dependency", "authority-change", "budget-limit", "instrument-uncertain"].includes(request.reason) && textValue(request.detail), "Explicit classified pause reason required");
  ensure(!session.pause, "Pause already recorded");
  session.pause = { at_ms: Date.now(), reason: request.reason, detail: request.detail };
  event(session, "paused", { ...session.pause, phase: phases(item) }); await saveSession(root, session);
  return response(root, session, item);
}
export async function resumeDelivery(root, options) {
  const session = await readSession(root, options.workItemId); const { item } = await coreItem(root, options.workItemId);
  await unchanged(root, session, item); await actor(root, item, options);
  ensure(session.pause && !session.pending, "Pending execution needs exact recovery/reconciliation; resume cannot waive it");
  const resolution = await readSource(root, options.requestRef);
  ensure(admission(session, phases(item)).allowed, "Capacity remains insufficient");
  event(session, "resumed", { phase: phases(item), reason: session.pause.reason, pause_ms: Date.now() - session.pause.at_ms, resolution_ref: options.requestRef, resolution_sha256: resolution.sha256 });
  session.pause = null; await saveSession(root, session); return response(root, session, item);
}

// Presentation only: callers supply the already-read canonical item and session.
const text = value => String(value ?? "unknown").replace(/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g, " ");
const seconds = value => Number.isFinite(value) && value >= 0 ? `${(value / 1000).toFixed(3)} s` : "unknown";
const count = value => Number.isSafeInteger(value) && value >= 0 ? String(value) : "unknown";

function stateLabel(report, item, session) {
  if (report.pending) return "Needs attention: execution pending; inspect recovery before retrying";
  if (session.pause) return "Paused";
  if (item.state === "done") return "Completed according to the Work Item";
  if (["cancelled", "concluded"].includes(item.state)) return `Closed: ${text(item.lifecycle_outcome ?? item.state)}`;
  if (item.state === "blocked" || item.unresolved?.length) return "Needs attention: unresolved work";
  if (report.checks.at(-1)?.accepted === false) return "Incomplete: latest recorded check failed";
  return "Incomplete";
}

function references(lines, label, values) {
  const refs = [...new Set(values ?? [])];
  lines.push(`${label}: ${refs.length ? "recorded references (not revalidated)" : "none recorded"}`);
  for (const ref of refs.slice(0, 3)) lines.push(`  ${text(ref)}`);
  if (refs.length > 3) lines.push(`  ${refs.length - 3} more; see the Work Item gate_evidence`);
}

export function formatDeliveryReport(report, item, session) {
  const usage = report.usage, time = report.time;
  const lines = [
    `${text(item.id)} - ${text(item.title)}`,
    `Status: ${stateLabel(report, item, session)}`,
    `Lifecycle: ${text(item.state)} | Profile: ${text(item.workflow_profile)} | Outcome: ${text(item.lifecycle_outcome ?? "not recorded")}`,
    `Common entry session: ${report.session_completed ? "completed" : "not completed"}`,
    `Developer candidate: ${text(item.developer_candidate_revision ?? "not recorded")}`,
    `Tested revision in Work Item: ${text(item.tested_revision ?? "not recorded")}`,
    "",
    `Recorded delivery checks: ${report.checks.length} (not the full project test inventory)`
  ];
  for (const check of report.checks.slice(-5)) {
    lines.push(`  #${count(check.sequence)} ${check.accepted ? "PASS" : "FAIL"} | ${text(check.revision)} | ${seconds(check.elapsed_ms)}`);
  }
  if (report.checks.length > 5) lines.push(`  ${report.checks.length - 5} earlier checks omitted; use --json`);
  references(lines, "Test evidence", item.gate_evidence?.test_evidence);
  references(lines, "Evaluation evidence", item.gate_evidence?.evaluation_report);
  references(lines, "Independent QA", [...(item.gate_evidence?.independent_qa_pass ?? []), ...(item.gate_evidence?.independent_qa_report ?? [])]);
  if (item.workflow_profile === "lean") lines.push("  Lean verifier review does not imply formal Independent QA.");
  lines.push("", `Elapsed since task creation: ${seconds(time.task_elapsed_ms)}`,
    `Elapsed since common entry open: ${seconds(time.elapsed_ms)}`,
    `Before entry open (unmeasured): ${seconds(time.before_open_unmeasured_ms)}`,
    `Measured local delivery operations: ${seconds(time.measured_local_operations_ms)}`,
    `Explicit pause time: ${seconds(time.explicit_pause_ms)}`,
    `Other elapsed: ${seconds(time.other_elapsed_ms)} (model, coordination, tests, idle or unrecorded waiting; not model-only time)`,
    "", `Task Operational Tokens: ${usage.complete_task_coverage && usage.total_operational_tokens !== null ? count(usage.total_operational_tokens) : "unknown (coverage incomplete)"}`,
    `Observed calls: ${count(usage.observed_calls)}; known usage: ${count(usage.known_calls)}; unknown usage: ${count(usage.unknown_calls)}`,
    `Known Operational Tokens in observations: ${count(usage.known_operational_tokens)} (input minus cached input plus output; not money)`,
    "  Zero observed calls does not mean no AI use. Missing observations are not zero task usage.",
    "Monetary cost: unknown",
    "", `Recorded repair count: ${count(report.repairs)} (delivery rework/check retries only; not all development corrections)`,
    `Explicit pauses recorded: ${report.pauses.length} (not all waiting or human intervention)`);
  if (session.pause) lines.push(`Active pause reason: ${text(session.pause.reason)}`);
  if (report.pending) lines.push(`Pending operation: ${text(report.pending.action ?? "see --json")}`);
  lines.push("", "Read-only summary; no new tests, evidence validation or model calls performed.",
    `Full report counters: temple delivery report . --work-item ${text(item.id)} --json`);
  return lines;
}
