import { loadProjectContext, uniqueStrings } from "./project.mjs";
import { readWorkItem, activeExecutionRequirements, prepareHandoff, prepareClaimRelease, prepareWorkItemTransition, prepareWorkItemClose } from "./work-items.mjs";
import { readCollaborationState, agentIsEligible, sponsoredPrincipal } from "./collaboration.mjs";
import { assertLocalActorBinding } from "./local-identity.mjs";
import { assessWorkflowProfile, nextStateForItem, profileTransitions } from "./workflow.mjs";
import { resolveGitRevision } from "./evidence.mjs";
import { ensure, relativePath, textValue, readSource } from "./delivery-ledger.mjs";

export const deliveryStages = ["build", "test", "eval", "independent_qa", "release_gate"];
export function workflowRequest(target, options, request) {
  ensure(deliveryStages.includes(options.workflowStage), "Unsupported autonomous completion stage");
  ensure(textValue(options.position), "Explicit completion Position required");
  ensure(!options.mechanicalContract && !request.unresolved.length, "Autonomous completion cannot bypass unresolved work");
  const satisfied = options.satisfied ?? {};
  ensure(satisfied && typeof satisfied === "object" && !Array.isArray(satisfied), "Expected named satisfied requirements");
  for (const [key, values] of Object.entries(satisfied)) {
    ensure(/^[a-z][a-z0-9_]*$/.test(key) && Array.isArray(values) && values.length && values.every(v => relativePath(v) || /^EVID-[a-zA-Z0-9-]+$/.test(v)), "Named gate evidence must use local references or Evidence IDs");
  }
  if (options.workflowStage === "build") ensure(request.completed.length && request.evidence.length && options.judgment === undefined, "Developer needs completion evidence, not review judgment");
  else ensure(options.judgment === "pass" && !request.completed.length && !request.evidence.length, "Review/close requires an explicit substantive pass and named gates, not Developer fields");
  if (options.workflowStage === "release_gate") {
    ensure(relativePath(options.approval) && uniqueStrings(options.rollback).length, "Close requires local approval evidence and a rollback procedure");
  } else ensure(options.approval === undefined && !options.rollback?.length, "Approval/rollback belong to Release Gate");
  return { ...request, schema_version: "temple.workflow-finish-request/v1", workflow_stage: options.workflowStage,
    position: options.position, judgment: options.judgment ?? null, satisfied,
    approval: options.approval ?? null, rollback: uniqueStrings(options.rollback),
    evidence: uniqueStrings([...request.evidence, ...Object.values(satisfied).flat(), ...(options.approval ? [options.approval] : []), ...uniqueStrings(options.rollback).filter(v => v.startsWith("EVID-"))]) };
}

// Prepare only: the shared completion journal owns every resulting write.
export async function prepareWorkflowStage(target, request) {
  const context = await loadProjectContext(target), item = await readWorkItem(target, request.work_item_id);
  const collaboration = await readCollaborationState(target);
  const assessment = assessWorkflowProfile(context.workflow, { requestedProfile: item.workflow_profile, riskTier: item.risk_tier,
    scopeClass: item.profile_assessment?.scope_class, escalationTriggers: item.profile_assessment?.escalation_triggers, collaborationProfile: collaboration.profile });
  ensure(assessment.effective_profile === item.workflow_profile, "Reconcile workflow risk assessment before completion");
  ensure(item.state === request.workflow_stage && item.owner_position === request.position && !item.unresolved?.length, "Autonomous completion stage/owner mismatch or unresolved work");
  const edge = profileTransitions(context.workflow, item).find(e => e.from === item.state);
  const requirements = new Set(item.state === "release_gate" ? context.policies.release_gate.requires : edge?.requires ?? []);
  if (item.state === "release_gate" && item.ui_delivery_mode && item.ui_delivery_mode !== "not-applicable") {
    const uiPolicy = JSON.parse((await readSource(target, ".ai-org/core/ui-design.json")).body);
    const mode = uiPolicy.delivery_modes?.find(entry => entry.id === item.ui_delivery_mode);
    ensure(mode, `UI delivery mode is not defined by policy: ${item.ui_delivery_mode}`);
    // Permit the selected close contract; native close still requires and validates it.
    for (const key of mode.minimum_evidence ?? []) requirements.add(key);
  }
  if (item.workflow_profile === "high-assurance") {
    const assurance = JSON.parse((await readSource(target, ".ai-org/core/high-assurance.json")).body);
    const extra = assurance.transition_requirements[`${item.state}->${edge?.to}`]?.requirement;
    if (extra) requirements.add(extra);
  }
  ensure(Object.keys(request.satisfied).every(k => requirements.has(k)), "Completion cannot prefill another stage's gates");
  ensure(item.claim?.status === "active" && item.claim.id === request.claim_id && item.claim.agent_id === request.agent_id && item.claim.principal_id === request.principal_id, "Autonomous completion requires the current exact claim");
  ensure(context.agents.get(request.agent_id)?.active !== false && context.agents.has(request.agent_id) && agentIsEligible(collaboration, request.agent_id, request.position, activeExecutionRequirements(item).disciplines), "Completion actor is not eligible");
  if (collaboration.profile === "solo") ensure(request.principal_id === "human", "Solo completion Principal must be human");
  else {
    ensure(sponsoredPrincipal(collaboration, request.agent_id) === request.principal_id, "Completion Principal sponsorship mismatch");
    await assertLocalActorBinding(target, request.principal_id);
  }
  if (item.state !== "build") {
    const developer = item.handoffs?.findLast(h => h.from_position === "developer");
    ensure(developer?.actor && developer.actor !== request.agent_id, "Review and release require an Identity distinct from Developer");
    ensure(item.developer_candidate_revision === request.candidate_revision && resolveGitRevision(target, developer.input_revision) === request.candidate_revision && resolveGitRevision(target, item.claim.base_revision) === request.candidate_revision, "Review claim and Developer handoff must match exact candidate");
  }
  if (item.state === "release_gate") {
    const prepared = await prepareWorkItemClose(target, { workItemId: item.id, decision: "go", testedRevision: request.candidate_revision,
      actor: request.agent_id, approval: request.approval, rollback: request.rollback, satisfied: request.satisfied });
    return { item, prepared, artifact_kind: "release", events: prepared.events };
  }
  const handoff = item.state === "build" ? await prepareHandoff(target, { workItemId: item.id, toPosition: item.next_position,
    inputRevision: request.candidate_revision, actor: request.agent_id, completed: request.completed, evidence: request.evidence, unresolved: [] }) : null;
  const released = await prepareClaimRelease(target, { workItemId: item.id, agentId: request.agent_id, principalId: request.principal_id, reason: "autonomous-stage-completed" }, handoff?.item ?? item);
  const transition = await prepareWorkItemTransition(target, { workItemId: item.id, actor: request.agent_id,
    toState: nextStateForItem(context.workflow, item), satisfied: request.satisfied }, handoff?.item ?? item, new Map(handoff ? [[handoff.artifact, handoff.content]] : []));
  transition.item.claim = released.item.claim; transition.item.claims = released.item.claims;
  return { item, prepared: { ...transition, artifact: handoff?.artifact, content: handoff?.content }, artifact_kind: handoff ? "handoff" : null,
    events: [...(handoff?.events ?? []), ...released.events, ...transition.events] };
}
