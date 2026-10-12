import fs from "node:fs/promises";
import { deriveDeliveryAttention } from "./delivery-attention.mjs";
import { formatAgentIdentity } from "./actor-resolution.mjs";
import path from "node:path";
import { atomicWrite, formatJson, pathExists, readJson } from "./files.mjs";
import { readEvidenceRegistry, resolveGitRevision } from "./evidence.mjs";
import { listWorkItemDocuments } from "./work-items.mjs";
import { readRuntimeWorkerRegistry } from "./workers.mjs";
import { listLearningEntries, validateLearningRepository } from "./learning.mjs";
import {
  membershipStatus,
  normalizedCollaborationState,
  principalStatus,
  sponsorshipStatus
} from "./collaboration.mjs";
import { lifecycleProjection } from "./workflow.mjs";
import { executionPolicyProjection, readExecutionPolicy } from "./execution-routing.mjs";

export const OBSERVER_SCHEMA = "temple.observer/v1";
export const ORGANIZATION_VIEW_SCHEMA = "temple.organization-view/v1";
export const OBSERVER_JSON_RELATIVE_PATH = ".ai-org/views/observer.json";
export const OBSERVER_HTML_RELATIVE_PATH = ".ai-org/views/overview.html";

async function readEvents(target) {
  const eventPath = path.join(target, ".ai-org/events/events.jsonl");
  if (!(await pathExists(eventPath))) return [];
  return (await fs.readFile(eventPath, "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function currentRevisionReference(item) {
  return item.tested_revision ?? item.release_record?.tested_revision ?? item.independent_qa_revision ?? item.developer_candidate_revision ?? item.base_revision ?? null;
}

function resolveCurrentRevision(target, item) {
  const reference = currentRevisionReference(item);
  if (!reference) return { reference: null, revision: null, resolved: false };
  try {
    return { reference, revision: resolveGitRevision(target, reference), resolved: true };
  } catch {
    return { reference, revision: /^[0-9a-f]{40}$/.test(reference) ? reference : null, resolved: /^[0-9a-f]{40}$/.test(reference) };
  }
}

function categoryFor(item, workers, workflow) {
  const lifecycle = lifecycleProjection(workflow, item);
  if (lifecycle.terminal) return "terminal";
  if (lifecycle.effective_state === "blocked") return "blocked";
  if (lifecycle.effective_state === "release_gate") return "approval_pending";
  if (["test", "eval", "independent_qa"].includes(lifecycle.effective_state)) return "qa_pending";
  if (item.claim?.status === "active" || workers.some((worker) => ["reserved", "active", "waiting", "attention"].includes(worker.status))) {
    return "active";
  }
  return "queued";
}

function attentionForEvidence(entry, stale) {
  const output = [];
  const base = { work_item_id: entry.work_item_id, evidence_id: entry.id };
  if (stale) output.push({ ...base, type: "stale_evidence", message: `${entry.id} targets an older revision` });
  if (entry.invalidated_at) output.push({ ...base, type: "invalidated_evidence", message: `${entry.id} was invalidated` });
  if (entry.expires_at && Date.parse(entry.expires_at) <= Date.now()) output.push({ ...base, type: "expired_evidence", message: `${entry.id} expired` });
  if (entry.kind === "unverified-claim") output.push({ ...base, type: "unverified_claim", message: `${entry.id} is explicitly unverified` });
  if (["test", "runtime"].includes(entry.kind) && entry.outcome === "fail") {
    output.push({ ...base, type: "failed_evidence", message: `${entry.id} records a failed ${entry.kind} observation` });
  }
  if (entry.kind === "risk" && ["high", "critical"].includes(entry.details?.severity) && entry.outcome === "open") {
    output.push({ ...base, type: "open_high_risk", message: `${entry.id} is an open ${entry.details.severity} risk` });
  }
  return output;
}

function organizationSafeguard(id, leftPosition, rightPosition, assignments, agents) {
  const leftAgentId = assignments.get(leftPosition) ?? null;
  const rightAgentId = assignments.get(rightPosition) ?? null;
  const participant = (positionId, agentId) => ({
    position_id: positionId,
    agent_id: agentId,
    agent_display_name: agents.get(agentId)?.display_name ?? null
  });
  const participants = [participant(leftPosition, leftAgentId), participant(rightPosition, rightAgentId)];
  if (!leftAgentId || !rightAgentId) {
    return {
      id,
      status: "warning",
      participants,
      message: `${leftPosition} and ${rightPosition} must both be assigned before separation can be verified.`
    };
  }
  if (leftAgentId === rightAgentId) {
    return {
      id,
      status: "fail",
      participants,
      message: `${agents.get(leftAgentId)?.display_name ?? leftAgentId} holds both ${leftPosition} and ${rightPosition}.`
    };
  }
  return {
    id,
    status: "pass",
    participants,
    message: `${agents.get(leftAgentId)?.display_name ?? leftAgentId} and ${agents.get(rightAgentId)?.display_name ?? rightAgentId} are distinct Agent Identities.`
  };
}

function buildOrganizationProjection({ agentsDocument, assignmentsDocument, positionsDocument, collaboration, work }) {
  collaboration = normalizedCollaborationState(collaboration);
  const agents = new Map((agentsDocument.agents ?? []).map((agent) => [agent.id, agent]));
  const positions = new Map((positionsDocument.positions ?? []).map((position) => [position.id, position]));
  const activeAssignments = (assignmentsDocument.assignments ?? []).filter((assignment) => assignment.active !== false);
  const assignments = new Map(activeAssignments.map((assignment) => [assignment.position_id, assignment.agent_id]));
  const activeMemberships = (collaboration.memberships ?? []).filter((membership) => membershipStatus(membership) === "active");
  const activePrincipals = (collaboration.principals ?? []).filter((principal) => principalStatus(principal) === "active");
  const qualificationAttention = (collaboration.memberships ?? []).flatMap((membership) => {
    const status = membershipStatus(membership);
    const reviewDue = Boolean(membership.qualification?.review_after && Date.parse(membership.qualification.review_after) <= Date.now());
    const expired = Boolean(membership.qualification?.expires_at && Date.parse(membership.qualification.expires_at) <= Date.now());
    if (status === "provisional") return [{ type: "provisional", agent_id: membership.agent_id, position_id: membership.position_id }];
    if (expired) return [{ type: "expired", agent_id: membership.agent_id, position_id: membership.position_id }];
    if (reviewDue) return [{ type: "review_due", agent_id: membership.agent_id, position_id: membership.position_id }];
    return [];
  });
  const issues = [];

  for (const assignment of activeAssignments) {
    if (!agents.has(assignment.agent_id)) {
      issues.push({ type: "unknown_assignment_agent", position_id: assignment.position_id, agent_id: assignment.agent_id });
    }
    if (!positions.has(assignment.position_id)) {
      issues.push({ type: "unknown_assignment_position", position_id: assignment.position_id, agent_id: assignment.agent_id });
    }
  }
  for (const membership of activeMemberships) {
    if (!agents.has(membership.agent_id)) {
      issues.push({ type: "unknown_membership_agent", position_id: membership.position_id, agent_id: membership.agent_id });
    }
    if (!positions.has(membership.position_id)) {
      issues.push({ type: "unknown_membership_position", position_id: membership.position_id, agent_id: membership.agent_id });
    }
  }

  const currentWork = work.filter((item) => item.category !== "terminal");
  const organizationAgents = (agentsDocument.agents ?? []).map((agent) => {
    const agentAssignments = activeAssignments
      .filter((assignment) => assignment.agent_id === agent.id)
      .map((assignment) => ({
        position_id: assignment.position_id,
        display_name: positions.get(assignment.position_id)?.display_name ?? assignment.position_id
      }));
    const memberships = activeMemberships
      .filter((membership) => membership.agent_id === agent.id)
      .map((membership) => ({
        position_id: membership.position_id,
        disciplines: membership.disciplines ?? [],
        default: membership.default === true,
        status: membershipStatus(membership),
        qualification: membership.qualification ?? null
      }));
    const currentWorkItems = currentWork
      .filter((item) => item.active_claim_agent_id === agent.id || item.assigned_agent_id === agent.id)
      .map((item) => ({ id: item.id, title: item.title, state: item.state, category: item.category }));
    return {
      id: agent.id,
      display_name: formatAgentIdentity({ agents }, agent.id),
      active: agent.active !== false,
      assignments: agentAssignments,
      memberships,
      current_work_items: currentWorkItems
    };
  });

  const organizationPositions = (positionsDocument.positions ?? []).map((position) => {
    const agentId = assignments.get(position.id) ?? null;
    const positionMemberships = activeMemberships
      .filter((membership) => membership.position_id === position.id)
      .map((membership) => ({
        agent_id: membership.agent_id,
        agent_display_name: agents.get(membership.agent_id)?.display_name ?? null,
        disciplines: membership.disciplines ?? [],
        default: membership.default === true,
        status: membershipStatus(membership),
        qualification: membership.qualification ?? null
      }));
    return {
      id: position.id,
      display_name: position.display_name,
      purpose: position.purpose,
      owns: position.owns ?? [],
      cannot_approve: position.cannot_approve ?? [],
      assignment: agentId ? { agent_id: agentId, agent_display_name: agents.get(agentId)?.display_name ?? null } : null,
      memberships: positionMemberships,
      eligible_pool_size: positionMemberships.length,
      current_work_items: currentWork
        .filter((item) => item.owner_position === position.id)
        .map((item) => ({ id: item.id, title: item.title, state: item.state, category: item.category }))
    };
  });

  return {
    schema_version: ORGANIZATION_VIEW_SCHEMA,
    profile: collaboration.profile ?? "unknown",
    coordination_backend: collaboration.coordination_backend ?? "unknown",
    counts: {
      accountable_people: collaboration.profile === "solo" ? 1 : activePrincipals.length,
      active_agents: organizationAgents.filter((agent) => agent.active).length,
      positions: organizationPositions.length,
      assigned_positions: organizationPositions.filter((position) => position.assignment).length,
      active_memberships: activeMemberships.length,
      provisional_memberships: (collaboration.memberships ?? []).filter((entry) => membershipStatus(entry) === "provisional").length,
      active_authority_grants: (collaboration.authority_grants ?? []).filter((entry) => entry.status === "active").length,
      qualification_attention: qualificationAttention.length
    },
    principals: (collaboration.principals ?? []).map((principal) => ({
      id: principal.id,
      display_name: principal.display_name,
      status: principalStatus(principal),
      provider_identity_count: (principal.provider_identities ?? []).filter((entry) => entry.status === "active").length
    })),
    sponsorships: (collaboration.sponsorships ?? []).map((entry) => ({
      principal_id: entry.principal_id,
      agent_id: entry.agent_id,
      status: sponsorshipStatus(entry)
    })),
    authority_grants: collaboration.authority_grants ?? [],
    bootstrap_owner: collaboration.bootstrap_owner ?? null,
    recovery: collaboration.recovery ?? { status: "not_configured", trustee_principal_ids: [], threshold: 0 },
    validation: collaboration.validation,
    qualification_attention: qualificationAttention,
    agents: organizationAgents,
    positions: organizationPositions,
    safeguards: [
      organizationSafeguard("developer-independent-qa-separation", "developer", "independent_qa", assignments, agents),
      organizationSafeguard("developer-release-manager-separation", "developer", "release_manager", assignments, agents)
    ],
    issues,
    large_scale_validation: collaboration.validation?.real_collaborative ?? { status: "unknown", plan: null }
  };
}

export async function buildObserverProjection(target) {
  const [project, agentsDocument, assignmentsDocument, positionsDocument, workflow, collaboration, workItems, workersDocument, evidenceRegistry, events, learning, learningValidation, executionPolicyState] = await Promise.all([
    readJson(path.join(target, ".ai-org/project/project.json")),
    readJson(path.join(target, ".ai-org/project/agents.json")),
    readJson(path.join(target, ".ai-org/project/assignments.json")),
    readJson(path.join(target, ".ai-org/core/positions.json")),
    readJson(path.join(target, ".ai-org/core/workflow.json")),
    readJson(path.join(target, ".ai-org/project/collaboration.json")),
    listWorkItemDocuments(target),
    readRuntimeWorkerRegistry(target),
    readEvidenceRegistry(target),
    readEvents(target),
    listLearningEntries(target),
    validateLearningRepository(target),
    readExecutionPolicy(target)
  ]);
  const revisions = new Map(workItems.map((item) => [item.id, resolveCurrentRevision(target, item)]));
  const skillProposals = new Map((learningValidation.proposals ?? []).map((proposal) => [proposal.id, proposal]));
  const terminalWorkItemIds = new Set(
    workItems.filter((item) => lifecycleProjection(workflow, item).terminal).map((item) => item.id)
  );
  const evidence = evidenceRegistry.entries.map((entry) => {
    const current = revisions.get(entry.work_item_id) ?? { reference: null, revision: null, resolved: false };
    const stale = Boolean(entry.scope_revision && current.resolved && current.revision !== entry.scope_revision);
    return { ...entry, stale, current_scope_reference: current.reference, current_scope_revision: current.revision };
  });
  const work = workItems.map((item) => {
    const itemWorkers = workersDocument.workers.filter((worker) => worker.work_item_id === item.id);
    const lifecycle = lifecycleProjection(workflow, item);
    const category = categoryFor(item, itemWorkers, workflow);
    return {
      id: item.id,
      title: item.title,
      state: item.state,
      effective_state: lifecycle.effective_state,
      terminal: lifecycle.terminal,
      workflow_profile: lifecycle.workflow_profile,
      risk_tier: item.risk_tier ?? null,
      profile_assessment: item.profile_assessment ?? null,
      lifecycle_outcome: lifecycle.lifecycle_outcome,
      closeout_reasons: lifecycle.closeout_reasons,
      legacy_terminal_normalized: lifecycle.legacy_terminal_normalized,
      owner_position: item.owner_position,
      assigned_agent_id: item.assigned_agent_id ?? null,
      delivery_attention: deriveDeliveryAttention(item, { workers: itemWorkers, evidence }),
      category,
      current_revision: revisions.get(item.id),
      active_claim: item.claim?.status === "active" ? item.claim.id : null,
      active_claim_agent_id: item.claim?.status === "active" ? item.claim.agent_id ?? null : null,
      runtime_workers: itemWorkers.map((worker) => ({ id: worker.id, status: worker.status, runtime_kind: worker.runtime_kind })),
      evidence_count: evidence.filter((entry) => entry.work_item_id === item.id).length,
      artifact_ref_count: Array.isArray(item.evidence) ? item.evidence.length : 0,
      unresolved_count: (item.unresolved ?? []).length
    };
  });
  const attention = [
    ...work.filter((item) => item.category === "blocked").map((item) => ({ type: "blocked_work_item", work_item_id: item.id, message: `${item.id} is blocked` })),
    ...work.filter((item) => item.category === "approval_pending").map((item) => ({ type: "approval_pending", work_item_id: item.id, message: `${item.id} awaits release approval` })),
    ...workersDocument.workers
      .filter((worker) => ["attention", "failed"].includes(worker.status) && !terminalWorkItemIds.has(worker.work_item_id))
      .map((worker) => ({ type: "runtime_recovery", work_item_id: worker.work_item_id, worker_id: worker.id, message: `${worker.id} needs recovery (${worker.status})` })),
    ...evidence.flatMap((entry) => terminalWorkItemIds.has(entry.work_item_id) ? [] : attentionForEvidence(entry, entry.stale)),
    ...learning.entries
      .filter((entry) => entry.revalidation.signal === "overdue")
      .map((entry) => ({ type: "learning_revalidation_overdue", learning_id: entry.id, message: `${entry.id} is overdue for revalidation` })),
    ...learning.entries
      .filter((entry) => entry.revalidation.signal === "contradicted")
      .map((entry) => ({ type: "learning_contradicted", learning_id: entry.id, message: `${entry.id} has contradictory revalidation evidence` })),
    ...learning.entries
      .filter((entry) => entry.skill_promotion?.eligible)
      .map((entry) => ({
        type: "skill_candidate_ready",
        learning_id: entry.id,
        message: `${entry.id} is ready for an evidence-backed Skill Proposal from ${entry.skill_promotion.recurrence_count} Work Items`,
        suggested_action: "Review the candidate through the local CLI",
        jump_view: "system"
      })),
    ...learning.entries
      .filter((entry) => entry.skill_promotion?.decision_signal === "approval_pending")
      .map((entry) => {
        const proposal = skillProposals.get(entry.promotion.proposal_id);
        return {
          type: "skill_proposal_pending",
          learning_id: entry.id,
          proposal_id: entry.promotion.proposal_id,
          evidence_refs: proposal?.evidence_refs ?? [],
          authority: proposal?.authority ?? null,
          message: proposal
            ? `${proposal.id} awaits a Human Principal decision. ${proposal.summary} Authority: ${proposal.authority}`
            : `${entry.promotion.proposal_id} awaits a Human Principal decision`,
          suggested_action: "Approve, reject, or defer through the local CLI",
          jump_view: "system"
        };
      }),
    ...learning.entries
      .filter((entry) => entry.skill_promotion?.decision_signal === "review_due")
      .map((entry) => ({ type: "skill_proposal_review_due", learning_id: entry.id, proposal_id: entry.promotion.proposal_id, message: `${entry.promotion.proposal_id} is due for renewed human review` })),
    ...(!learningValidation.valid
      ? [{ type: "invalid_skill_promotion", message: `Skill promotion records are inconsistent: ${learningValidation.errors.join("; ")}` }]
      : [])
  ];
  const timeline = [
    ...events.map((event) => ({ timestamp: event.timestamp, type: "event", name: event.event_type, work_item_id: event.work_item_id ?? null, actor: event.actor ?? null, reference: null })),
    ...evidence.map((entry) => ({ timestamp: entry.observed_at, type: "evidence", name: entry.kind, work_item_id: entry.work_item_id, actor: entry.recorded_by, reference: entry.id, outcome: entry.outcome }))
  ].sort((left, right) => String(right.timestamp).localeCompare(String(left.timestamp))).slice(0, 100);
  const categories = Object.fromEntries(["active", "blocked", "qa_pending", "approval_pending", "queued", "terminal"].map((category) => [category, work.filter((item) => item.category === category).length]));
  const organization = buildOrganizationProjection({ agentsDocument, assignmentsDocument, positionsDocument, collaboration, work });
  return {
    schema_version: OBSERVER_SCHEMA,
    generated_at: new Date().toISOString(),
    project: { id: project.id, name: project.name },
    organization,
    execution_routing: executionPolicyProjection(executionPolicyState.policy, executionPolicyState.source),
    work: { total: work.length, categories, items: work },
    evidence: {
      total: evidence.length,
      stale: evidence.filter((entry) => entry.stale).length,
      unverified: evidence.filter((entry) => entry.kind === "unverified-claim").length,
      failed: evidence.filter((entry) => ["test", "runtime"].includes(entry.kind) && entry.outcome === "fail").length,
      items: evidence
    },
    learning: {
      total: learning.entries.length,
      revalidation_due: learning.entries.filter((entry) => ["due", "overdue"].includes(entry.revalidation.signal)).length,
      contradicted: learning.entries.filter((entry) => entry.revalidation.signal === "contradicted").length,
      skill_candidates: learning.entries.filter((entry) => entry.skill_promotion?.eligible).length,
      skill_proposals_pending: learning.entries.filter((entry) => entry.skill_promotion?.decision_signal === "approval_pending").length,
      skill_proposal_reviews_due: learning.entries.filter((entry) => entry.skill_promotion?.decision_signal === "review_due").length,
      skill_authoring_created: learning.entries.filter((entry) => entry.skill_promotion?.decision_signal === "authoring_created").length,
      valid: learningValidation.valid,
      errors: learningValidation.errors
    },
    attention,
    timeline,
    canonical_state_changed: false,
    external_action_performed: false
  };
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function renderObserverHtml(projection) {
  const cards = Object.entries(projection.work.categories).map(([name, count]) => `<section class="card"><strong>${count}</strong><span>${escapeHtml(name.replaceAll("_", " "))}</span></section>`).join("");
  const workRows = projection.work.items.length
    ? projection.work.items.map((item) => `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.state)}</td><td>${escapeHtml(item.category.replaceAll("_", " "))}</td><td>${item.evidence_count}</td></tr>`).join("")
    : '<tr><td colspan="5">No Work Items</td></tr>';
  const attention = projection.attention.length
    ? projection.attention.map((item) => `<li><strong>${escapeHtml(item.type)}</strong> ${escapeHtml(item.message)}</li>`).join("")
    : "<li>No attention signals.</li>";
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(projection.project.name)} Observer</title><style>:root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,sans-serif}body{max-width:1100px;margin:auto;padding:2rem;line-height:1.5}header{display:flex;justify-content:space-between;gap:2rem;align-items:end}.muted{opacity:.7}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:.75rem;margin:1.5rem 0}.card{border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:12px;padding:1rem;display:flex;flex-direction:column}.card strong{font-size:2rem}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:.65rem;border-bottom:1px solid color-mix(in srgb,currentColor 18%,transparent)}code{font-size:.9em}</style></head><body><header><div><p class="muted">Read-only Observer overview</p><h1>${escapeHtml(projection.project.name)}</h1></div><p class="muted">Generated ${escapeHtml(projection.generated_at)}</p></header><div class="cards">${cards}</div><h2>Work</h2><table><thead><tr><th>ID</th><th>Title</th><th>State</th><th>Category</th><th>Evidence</th></tr></thead><tbody>${workRows}</tbody></table><h2>Attention</h2><ul>${attention}</ul><p class="muted">This generated view cannot approve gates, mutate canonical state, or perform external actions.</p></body></html>\n`;
}

export async function writeObserverProjection(target, projection) {
  const jsonPath = path.join(target, OBSERVER_JSON_RELATIVE_PATH);
  const htmlPath = path.join(target, OBSERVER_HTML_RELATIVE_PATH);
  await atomicWrite(jsonPath, formatJson(projection));
  await atomicWrite(htmlPath, renderObserverHtml(projection));
  return { jsonPath, htmlPath };
}
