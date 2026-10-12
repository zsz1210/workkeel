import fs from "node:fs/promises";
import { deriveDeliveryAttention } from "./delivery-attention.mjs";
import { formatAgentIdentity } from "./actor-resolution.mjs";
import { summarizeLearningReviews } from "./learning-review.mjs";
import path from "node:path";
import { leanFinishAttention } from "./lean-delivery-state.mjs";
import {
  buildCapabilityRegistry,
  CONTEXT_MAP_RELATIVE_PATH,
  emptyContextMap,
  readContextMap
} from "./context.mjs";
import { atomicWrite, pathExists, readJson } from "./files.mjs";
import { emptyLearningIndex, LEARNING_INDEX_RELATIVE_PATH, summarizeLearningIndex } from "./learning.mjs";
import {
  COLLABORATION_RELATIVE_PATH,
  buildCollaborationState,
  normalizedCollaborationState,
  membershipStatus,
  principalStatus,
  sponsorshipStatus
} from "./collaboration.mjs";
import { inspectParallelPlan, PARALLEL_PLAN_RELATIVE_PATH } from "./orchestration.mjs";
import {
  SPEC_INDEX_RELATIVE_PATH,
  emptySpecIndex,
  evaluateWorkItemSpecRefs,
  summarizeSpecIndex,
  validateRepositorySpecSources,
  validateSpecIndex
} from "./specifications.mjs";
import {
  TRACKER_CONFIG_RELATIVE_PATH,
  TRACKER_VIEW_RELATIVE_PATH,
  emptyTrackerConfig,
  trackerVisibility,
  validateTrackerConfig,
  validateTrackerMappings,
  validateTrackerView
} from "./tracker.mjs";
import { RESOURCE_REGISTRY_RELATIVE_PATH, emptyResourceRegistry } from "./resources.mjs";
import { RUNTIME_WORKER_REGISTRY_RELATIVE_PATH, emptyRuntimeWorkerRegistry } from "./workers.mjs";
import { activeExecutionRequirements } from "./work-items.mjs";
import { readRetrievalConfig, RETRIEVAL_EVALUATION_VIEW } from "./retrieval.mjs";
import { inspectArchifyAdapter } from "./archify-adapter.mjs";
import {
  defaultRepositoryIntegration,
  readRepositoryIntegration,
  REPOSITORY_INTEGRATION_RELATIVE_PATH,
  validateRepositoryIntegration
} from "./repository-integration.mjs";
import { lifecycleProjection } from "./workflow.mjs";
import { executionPolicyProjection, readExecutionPolicy } from "./execution-routing.mjs";

function markdown(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function shortRevision(value) {
  return value ? String(value).slice(0, 8) : "—";
}

async function readEvents(target) {
  const eventsPath = path.join(target, ".ai-org/events/events.jsonl");
  if (!(await pathExists(eventsPath))) return [];
  const lines = (await fs.readFile(eventsPath, "utf8")).split(/\r?\n/).filter((line) => line.trim());
  return lines.map((line) => JSON.parse(line));
}

export async function buildStatus(target, options = {}) {
  const specIndexInstalled = await pathExists(path.join(target, SPEC_INDEX_RELATIVE_PATH));
  const trackerConfigInstalled = await pathExists(path.join(target, TRACKER_CONFIG_RELATIVE_PATH));
  const trackerViewInstalled = await pathExists(path.join(target, TRACKER_VIEW_RELATIVE_PATH));
  const retrievalEvaluationInstalled = await pathExists(path.join(target, RETRIEVAL_EVALUATION_VIEW));
  const repositoryIntegrationInstalled = await pathExists(path.join(target, REPOSITORY_INTEGRATION_RELATIVE_PATH));
  const [
    lock,
    project,
    agentsDocument,
    assignmentsDocument,
    positionsDocument,
    workflow,
    tasksDocument,
    events,
    learningIndex,
    contextMap,
    specIndex,
    trackerConfig,
    trackerView,
    capabilityRegistry,
    collaboration,
    resourceRegistry,
    workerRegistry,
    retrievalConfig,
    retrievalEvaluation,
    archifyAdapter,
    repositoryIntegration,
    executionPolicyState
  ] =
    await Promise.all([
      readJson(path.join(target, "temple.lock")),
      readJson(path.join(target, ".ai-org/project/project.json")),
      readJson(path.join(target, ".ai-org/project/agents.json")),
      readJson(path.join(target, ".ai-org/project/assignments.json")),
      readJson(path.join(target, ".ai-org/core/positions.json")),
      readJson(path.join(target, ".ai-org/core/workflow.json")),
      pathExists(path.join(target, ".ai-org/project/tasks.json")).then((exists) =>
        exists ? readJson(path.join(target, ".ai-org/project/tasks.json")) : { schema_version: "temple.tasks/v1", tasks: [] }
      ),
      readEvents(target),
      pathExists(path.join(target, LEARNING_INDEX_RELATIVE_PATH)).then((exists) =>
        exists ? readJson(path.join(target, LEARNING_INDEX_RELATIVE_PATH)) : emptyLearningIndex()
      ),
      pathExists(path.join(target, CONTEXT_MAP_RELATIVE_PATH)).then((exists) =>
        exists ? readContextMap(target) : emptyContextMap()
      ),
      specIndexInstalled ? readJson(path.join(target, SPEC_INDEX_RELATIVE_PATH)) : emptySpecIndex(),
      trackerConfigInstalled
        ? readJson(path.join(target, TRACKER_CONFIG_RELATIVE_PATH))
        : emptyTrackerConfig(),
      trackerViewInstalled
        ? readJson(path.join(target, TRACKER_VIEW_RELATIVE_PATH))
        : { schema_version: "temple.tracker-view/v1", generated_at: null, entries: [] },
      options.capabilityRegistry ?? buildCapabilityRegistry(target),
      pathExists(path.join(target, COLLABORATION_RELATIVE_PATH)).then((exists) =>
        exists ? readJson(path.join(target, COLLABORATION_RELATIVE_PATH)) : null
      ),
      pathExists(path.join(target, RESOURCE_REGISTRY_RELATIVE_PATH)).then((exists) =>
        exists ? readJson(path.join(target, RESOURCE_REGISTRY_RELATIVE_PATH)) : emptyResourceRegistry()
      ),
      pathExists(path.join(target, RUNTIME_WORKER_REGISTRY_RELATIVE_PATH)).then((exists) =>
        exists ? readJson(path.join(target, RUNTIME_WORKER_REGISTRY_RELATIVE_PATH)) : emptyRuntimeWorkerRegistry()
      ),
      readRetrievalConfig(target),
      retrievalEvaluationInstalled
        ? readJson(path.join(target, RETRIEVAL_EVALUATION_VIEW))
        : Promise.resolve({ fixture: null, large_repository_validation: "not_run" }),
      inspectArchifyAdapter(target),
      repositoryIntegrationInstalled ? readRepositoryIntegration(target) : defaultRepositoryIntegration(),
      readExecutionPolicy(target)
    ]);

  const agents = new Map(agentsDocument.agents.map((agent) => [agent.id, agent]));
  const positions = new Map(positionsDocument.positions.map((position) => [position.id, position]));
  const specIndexValidation = validateSpecIndex(specIndex, new Set(positions.keys()));
  const repositoryIntegrationValidation = validateRepositoryIntegration(repositoryIntegration);
  const specSourceValidation = specIndexValidation.valid
    ? await validateRepositorySpecSources(target, specIndex)
    : { valid: false, errors: [] };
  const trackerConfigValidation = validateTrackerConfig(trackerConfig);
  const trackerViewValidation = validateTrackerView(trackerView);
  const assignmentMap = new Map(
    assignmentsDocument.assignments
      .filter((assignment) => assignment.active !== false)
      .map((assignment) => [assignment.position_id, assignment.agent_id])
  );
  const assignments = assignmentsDocument.assignments
    .filter((assignment) => assignment.active !== false)
    .map((assignment) => ({
      position_id: assignment.position_id,
      position_name: positions.get(assignment.position_id)?.display_name ?? assignment.position_id,
      agent_id: assignment.agent_id,
      agent_name: agents.get(assignment.agent_id)?.display_name ?? "Unknown Agent"
    }))
    .sort((left, right) => left.position_name.localeCompare(right.position_name));

  const workItemsDirectory = path.join(target, ".ai-org/work-items");
  const evidencePath = path.join(target, ".ai-org/project/evidence.json");
  const evidence = await pathExists(evidencePath) ? (await readJson(evidencePath)).entries ?? [] : [];
  const workItems = [];
  const completionAttention = await leanFinishAttention(target, options.settlingLeanFinish);
  const rawItems = new Map();
  if (await pathExists(workItemsDirectory)) {
    const entries = await fs.readdir(workItemsDirectory, { withFileTypes: true });
    for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json")).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(workItemsDirectory, entry.name);
      try {
        const item = await readJson(absolute);
        rawItems.set(item.id, item);
        const assignedAgentId =
          (item.claim?.status === "active" ? item.claim.agent_id : null) ??
          item.planned_agent_id ??
          item.assigned_agent_id ??
          assignmentMap.get(item.owner_position) ??
          null;
        const latestRevision =
          item.closeout_revision ??
          item.qa_evidence_revision ??
          item.tested_revision ??
          item.developer_candidate_revision ??
          item.dispatch_revision ??
          null;
        const specificationReferences = evaluateWorkItemSpecRefs(item, specIndex);
        const activeRequirements = activeExecutionRequirements(item);
        const lifecycle = lifecycleProjection(workflow, item);
        workItems.push({
          id: item.id ?? entry.name.replace(/\.json$/, ""),
          title: item.title ?? "Untitled",
          state: item.state ?? "unknown",
          owner_position: item.owner_position ?? "unknown",
          owner_name: positions.get(item.owner_position)?.display_name ?? item.owner_position ?? "unknown",
          assigned_agent_id: assignedAgentId,
          assigned_agent_name: assignedAgentId ? formatAgentIdentity({ agents }, assignedAgentId, collaboration ?? {}) : "Unassigned",
          delivery_attention: deriveDeliveryAttention(item, { workers: workerRegistry.workers ?? [], evidence,
            missingConditions: completionAttention.filter(entry => !entry.work_item_id || entry.work_item_id === item.id)
              .map(entry => ({ kind: "evidence", description: entry.message, next_action: entry.next_action ?? "Inspect unresolved completion diagnostics before continuing." })) }),
          latest_revision: latestRevision,
          evidence_count: Array.isArray(item.evidence) ? item.evidence.length : 0,
          unresolved_count: Array.isArray(item.unresolved) ? item.unresolved.length : 0,
          effective_state: lifecycle.effective_state,
          terminal: lifecycle.terminal,
          workflow_profile: lifecycle.workflow_profile,
          lifecycle_outcome: lifecycle.lifecycle_outcome,
          legacy_terminal_normalized: lifecycle.legacy_terminal_normalized,
          parallel_mode: item.parallel_mode ?? "pending",
          required_disciplines: item.required_disciplines ?? [],
          active_requirements: activeRequirements,
          active_claim: item.claim?.status === "active" ? item.claim : null,
          parent_work_item_id: item.parent_work_item_id ?? null,
          tracker_visibility: trackerVisibility(item),
          tracker_reference_count: (item.tracker_refs ?? []).length,
          tracker_refs: item.tracker_refs ?? [],
          dependency_count: (item.dependencies ?? []).length,
          specification_mode: item.specification_mode ?? null,
          ui_delivery_mode: item.ui_delivery_mode ?? null,
          risk_tier: item.risk_tier ?? null,
          assurance: item.assurance ?? null,
          specification_reference_count: specificationReferences.resolved_refs.length,
          stale_specification_count: specificationReferences.stale_count,
          unapproved_specification_count: specificationReferences.unapproved_count,
          specification_references: specificationReferences.resolved_refs,
          specification_warnings: specificationReferences.warnings
        });
      } catch (error) {
        workItems.push({
          id: entry.name,
          title: error.message,
          state: "invalid",
          owner_position: "unknown",
          owner_name: "unknown",
          assigned_agent_id: null,
          assigned_agent_name: "Unassigned",
          latest_revision: null,
          evidence_count: 0,
          unresolved_count: 1,
          terminal: false,
          tracker_visibility: "unknown",
          tracker_reference_count: 0,
          tracker_refs: [],
          ui_delivery_mode: null,
          specification_mode: null,
          specification_reference_count: 0,
          stale_specification_count: 0,
          unapproved_specification_count: 0,
          specification_references: [],
          specification_warnings: []
        });
      }
    }
  }

  const tasks = (tasksDocument.tasks ?? []).map((task) => {
    const workItem = rawItems.get(task.work_item_id);
    return {
      ...task,
      position_name: positions.get(task.position_id)?.display_name ?? task.position_id,
      agent_name: agents.get(task.agent_id)?.display_name ?? task.agent_id,
      archive_ready: task.status === "completed" && Boolean(workItem && lifecycleProjection(workflow, workItem).terminal)
    };
  });
  const workers = (workerRegistry.workers ?? []).map((worker) => ({
    ...worker,
    agent_name: agents.get(worker.agent_id)?.display_name ?? worker.agent_id,
    position_name: positions.get(worker.position_id)?.display_name ?? worker.position_id
  }));
  for (const item of workItems) item.task_count = tasks.filter((task) => task.work_item_id === item.id).length;

  const trackerMappings = trackerConfigValidation.valid
    ? validateTrackerMappings(trackerConfig, [...rawItems.values()])
    : { valid: false, errors: [], warnings: [] };
  const activeTrackerEntryKeys = new Set(
    [...rawItems.values()].flatMap((item) =>
      (item.tracker_refs ?? []).map((reference) => `${item.id}:${reference.provider_id}:${reference.item_id}`)
    )
  );
  const trackerEntries = trackerViewValidation.valid
    ? trackerView.entries.filter((entry) =>
        activeTrackerEntryKeys.has(`${entry.work_item_id}:${entry.observation.provider_id}:${entry.observation.item_id}`)
      )
    : [];

  const byState = {};
  for (const item of workItems) byState[item.state] = (byState[item.state] ?? 0) + 1;
  const collaborationState = normalizedCollaborationState(collaboration ?? buildCollaborationState(assignmentsDocument));
  const realCollaborativeValidation = collaborationState.validation?.real_collaborative ?? { status: "not_run", plan: null };
  const parallelInspection = await inspectParallelPlan(target);
  const parallelPlan = parallelInspection.plan;
  const orchestration = {
    installed: parallelInspection.installed,
    path: parallelInspection.path,
    valid: parallelInspection.valid,
    fresh: parallelInspection.fresh,
    errors: parallelInspection.errors,
    generated_at: parallelPlan?.generated_at ?? null,
    scope: parallelPlan?.scope ?? null,
    max_workers: parallelPlan?.max_workers ?? null,
    waves: parallelPlan?.summary?.waves ?? 0,
    dispatchable: parallelPlan?.summary?.dispatchable ?? 0,
    active: parallelPlan?.summary?.active ?? 0,
    sequential: parallelPlan?.summary?.sequential ?? 0,
    blocked: parallelPlan?.summary?.blocked ?? 0,
    next_wave: parallelPlan?.waves?.[0]?.dispatch?.map((entry) => entry.work_item_id) ?? [],
    task_creation_performed: false,
    claim_performed: false,
    external_action_performed: false
  };
  const attention = [
    ...completionAttention,
    ...workItems
      .filter((item) => item.state === "blocked")
      .map((item) => ({ type: "blocked_work_item", work_item_id: item.id, message: `${item.id} is blocked` })),
    ...tasks
      .filter((task) => task.status === "attention")
      .map((task) => ({ type: "task_attention", work_item_id: task.work_item_id, task_id: task.id, message: `${task.id} needs attention` })),
    ...tasks
      .filter((task) => task.archive_ready)
      .map((task) => ({ type: "archive_ready", work_item_id: task.work_item_id, task_id: task.id, message: `${task.id} can be archived` })),
    ...workers
      .filter((worker) => worker.status === "attention" || worker.status === "failed")
      .map((worker) => ({
        type: "runtime_worker_attention",
        work_item_id: worker.work_item_id,
        worker_id: worker.id,
        message: `${worker.id} is ${worker.status}`
      })),
    ...workItems
      .filter((item) => item.stale_specification_count > 0)
      .map((item) => ({
        type: "stale_specification_reference",
        work_item_id: item.id,
        message: `${item.id} has ${item.stale_specification_count} stale specification reference(s)`
      })),
    ...workItems
      .filter((item) => item.unapproved_specification_count > 0)
      .map((item) => ({
        type: "unapproved_specification_reference",
        work_item_id: item.id,
        message: `${item.id} has ${item.unapproved_specification_count} unapproved specification reference(s)`
      })),
    ...(summarizeLearningIndex(learningIndex).revalidation_due > 0
      ? [{ type: "learning_revalidation_due", message: `${summarizeLearningIndex(learningIndex).revalidation_due} learning entries require revalidation` }]
      : []),
    ...(summarizeLearningIndex(learningIndex).contradicted > 0
      ? [{ type: "contradicted_learning", message: `${summarizeLearningIndex(learningIndex).contradicted} learning entries are contradicted` }]
      : []),
    ...(summarizeLearningIndex(learningIndex).skill_candidates > 0
      ? [{ type: "skill_candidate_ready", message: `${summarizeLearningIndex(learningIndex).skill_candidates} Practice(s) are ready for a Skill Proposal` }]
      : []),
    ...(summarizeLearningIndex(learningIndex).skill_proposals_pending > 0
      ? [{ type: "skill_proposal_pending", message: `${summarizeLearningIndex(learningIndex).skill_proposals_pending} Skill Proposal(s) await human approval` }]
      : []),
    ...(summarizeLearningIndex(learningIndex).skill_proposal_reviews_due > 0
      ? [{ type: "skill_proposal_review_due", message: `${summarizeLearningIndex(learningIndex).skill_proposal_reviews_due} deferred Skill Proposal(s) are due for review` }]
      : []),
    ...(archifyAdapter.status === "invalid"
      ? [{ type: "invalid_archify_adapter", message: archifyAdapter.reason }]
      : []),
    ...(!repositoryIntegrationValidation.valid
      ? [{ type: "invalid_repository_integration", message: repositoryIntegrationValidation.errors.join("; ") }]
      : repositoryIntegration.status === "unconfirmed"
        ? [{ type: "repository_integration_unconfirmed", message: "Repository integration policy has not been confirmed" }]
        : []),
    ...(!trackerConfigInstalled
      ? [{ type: "tracker_config_missing", message: "Tracker configuration is missing; run temple upgrade" }]
      : []),
    ...(!trackerConfigValidation.valid
      ? [{ type: "invalid_tracker_config", message: `Tracker configuration is invalid: ${trackerConfigValidation.errors.join("; ")}` }]
      : []),
    ...trackerMappings.errors.map((message) => ({ type: "invalid_tracker_mapping", message })),
    ...trackerMappings.warnings.map((message) => ({ type: "tracker_mapping_attention", message })),
    ...trackerEntries
      .filter((entry) => entry.plan.review_count > 0)
      .map((entry) => ({
        type: "tracker_reconciliation_required",
        work_item_id: entry.work_item_id,
        message: `${entry.work_item_id} has ${entry.plan.review_count} tracker reconciliation action(s) from ${entry.observation.observed_at}`
      })),
    ...(!specIndexValidation.valid
      ? [{ type: "invalid_specification_index", message: `Specification index is invalid: ${specIndexValidation.errors.join("; ")}` }]
      : []),
    ...(!specIndexInstalled
      ? [{ type: "specification_index_missing", message: "Specification index is missing; run temple upgrade" }]
      : []),
    ...(!specSourceValidation.valid && specSourceValidation.errors.length > 0
      ? [{ type: "invalid_specification_source", message: `Specification source is invalid: ${specSourceValidation.errors.join("; ")}` }]
      : []),
    ...(orchestration.installed && !orchestration.valid
      ? [{ type: "invalid_parallel_plan", message: `Generated parallel plan is invalid: ${orchestration.errors.join("; ")}` }]
      : []),
    ...(orchestration.installed && orchestration.valid && orchestration.fresh === false
      ? [{ type: "stale_parallel_plan", message: "Generated parallel plan is stale; rebuild it before dispatch" }]
      : []),
    ...(orchestration.installed && orchestration.valid && orchestration.blocked > 0
      ? [{ type: "parallel_plan_blocked", message: `Parallel plan has ${orchestration.blocked} blocked Work Item(s)` }]
      : []),
    ...(["collaborative", "high-assurance"].includes(collaborationState.profile) && realCollaborativeValidation.status !== "passed"
      ? [{
          type: "real_collaborative_validation_pending",
          message: "Real multi-human, independently administered environment validation is still pending"
        }]
      : [])
  ];

  return {
    schema_version: "temple.status/v9",
    project: { id: project.id, name: project.name },
    template_version: lock.template.version,
    agents: agentsDocument.agents.map((agent) => ({ id: agent.id, display_name: agent.display_name, active: agent.active !== false })),
    assignments,
    work_items: { total: workItems.length, by_state: byState, items: workItems },
    tasks: { total: tasks.length, archive_ready: tasks.filter((task) => task.archive_ready).length, items: tasks },
    runtime_workers: {
      total: workers.length,
      reserved: workers.filter((worker) => worker.status === "reserved").length,
      active: workers.filter((worker) => ["active", "waiting", "attention"].includes(worker.status)).length,
      terminal: workers.filter((worker) => ["completed", "failed", "cancelled"].includes(worker.status)).length,
      internal_subagents: workers.filter((worker) => worker.runtime_kind === "internal-subagent").length,
      user_tasks: workers.filter((worker) => worker.runtime_kind === "user-task").length,
      items: workers
    },
    shared_resources: {
      defined: (resourceRegistry.resources ?? []).filter((entry) => entry.active !== false).length,
      active_reservations: (resourceRegistry.reservations ?? []).filter((entry) => entry.status === "active").length,
      resources: resourceRegistry.resources ?? [],
      reservations: resourceRegistry.reservations ?? []
    },
    attention,
    recent_events: events.slice(-8).reverse(),
    optional_packs: (lock.optional_packs ?? []).map((pack) => ({
      id: pack.id,
      version: pack.version,
      skills: pack.skills ?? []
    })),
    learning: { ...summarizeLearningIndex(learningIndex), reviews: await summarizeLearningReviews(target) },
    specifications: {
      ...summarizeSpecIndex(specIndex),
      installed: specIndexInstalled,
      valid: specIndexInstalled && specIndexValidation.valid,
      errors: specIndexValidation.errors,
      warnings: specIndexValidation.warnings,
      sources_valid: specIndexInstalled && specSourceValidation.valid,
      source_errors: specSourceValidation.errors
    },
    tracker: {
      installed: trackerConfigInstalled,
      valid: trackerConfigInstalled && trackerConfigValidation.valid,
      errors: trackerConfigValidation.errors,
      warnings: trackerConfigValidation.warnings,
      profile: trackerConfig.profile,
      sync_granularity: trackerConfig.sync_granularity,
      default_provider_id: trackerConfig.default_provider_id,
      providers: trackerConfig.providers ?? [],
      active_providers: (trackerConfig.providers ?? []).filter((provider) => provider.status === "active").length,
      linked_work_items: workItems.filter((item) => item.tracker_reference_count > 0).length,
      team_visible_work_items: workItems.filter((item) => item.tracker_visibility === "team-visible").length,
      generated_view_valid: trackerViewValidation.valid,
      observed_items: trackerEntries.length,
      reconciliation_actions: trackerEntries.reduce((count, entry) => count + entry.plan.review_count, 0),
      external_write_performed: false
    },
    repository_integration: {
      installed: repositoryIntegrationInstalled,
      valid: repositoryIntegrationValidation.valid,
      ...repositoryIntegration
    },
    context_routing: {
      routes: contextMap.routes?.length ?? 0,
      active_routes: (contextMap.routes ?? []).filter((route) => route.status === "active").length,
      provider_id: retrievalConfig.selected_provider,
      semantic: retrievalConfig.selected_provider === "local-hybrid",
      local_hybrid: retrievalConfig.local_hybrid,
      evaluation_fixture: retrievalEvaluation.fixture,
      large_repository_validation: retrievalEvaluation.large_repository_validation
    },
    execution_routing: executionPolicyProjection(executionPolicyState.policy, executionPolicyState.source),
    capabilities: capabilityRegistry.counts,
    collaboration: {
      profile: collaborationState.profile,
      coordination_backend: collaborationState.coordination_backend,
      principals: (collaborationState.principals ?? []).filter((entry) => principalStatus(entry) === "active").length,
      sponsorships: (collaborationState.sponsorships ?? []).filter((entry) => sponsorshipStatus(entry) === "active").length,
      memberships: (collaborationState.memberships ?? []).filter((entry) => membershipStatus(entry) === "active").length,
      authority_grants: (collaborationState.authority_grants ?? []).filter((entry) => entry.status === "active").length,
      active_claims: workItems.filter((item) => item.active_claim).length,
      principal_items: collaborationState.principals ?? [],
      sponsorship_items: collaborationState.sponsorships ?? [],
      membership_items: collaborationState.memberships ?? [],
      authority_grant_items: collaborationState.authority_grants ?? [],
      bootstrap_owner: collaborationState.bootstrap_owner,
      recovery: collaborationState.recovery,
      validation: collaborationState.validation,
      large_scale_validation: realCollaborativeValidation
    },
    orchestration,
    cli_bootstrap: lock.template.bootstrap ?? null,
    integrations: { ...lock.integrations, archify_adapter: archifyAdapter }
  };
}

export function compactStatus(status, workItemId) {
  const item = workItemId ? status.work_items.items.find((entry) => entry.id === workItemId) : null;
  if (workItemId && !item) throw new Error(`Unknown Work Item: ${workItemId}`);
  return {
    schema_version: "temple.status-summary/v1",
    authority: "observation-only",
    projection_scope: "full",
    project: status.project,
    work_items: { total: status.work_items.total, by_state: status.work_items.by_state },
    learning: { reviews: status.learning?.reviews ?? { recorded: 0, counts: {}, errors: [] } },
    selected_work_item: item,
    attention: status.attention,
    detail_command: "status --json --no-write"
  };
}

export function renderStatusMarkdown(status) {
  const activeItems = status.work_items.items.filter((item) => !item.terminal && item.state !== "cancelled").length;
  const lines = [
    `# ${status.project.name} — AI development organization status`,
    "",
    `- Project ID: \`${status.project.id}\``,
    `- Organization system version: \`${status.template_version}\``,
    `- Active Agent Identities: ${status.agents.filter((agent) => agent.active).length}`,
    `- Collaboration profile: \`${status.collaboration.profile}\` (${status.collaboration.principals} Human Principals, ${status.collaboration.active_claims} active claims)`,
    `- Parallel plan: ${status.orchestration.installed ? `${status.orchestration.waves} wave(s), fresh=${status.orchestration.fresh}` : "not generated"}`,
    `- Work items: ${status.work_items.total} total, ${activeItems} active`,
    `- Codex tasks: ${status.tasks.total} registered, ${status.tasks.archive_ready} archive-ready`,
    `- Runtime workers: ${status.runtime_workers.total} registered, ${status.runtime_workers.reserved} reserved, ${status.runtime_workers.active} active`,
    `- Shared resources: ${status.shared_resources.defined} defined, ${status.shared_resources.active_reservations} active reservation(s)`,
    `- Optional Skill packs: ${status.optional_packs.length} installed`,
    `- Repository capabilities: ${status.capabilities.available} available, ${status.capabilities.invalid} invalid`,
    `- Context routes: ${status.context_routing.active_routes} active (${status.context_routing.provider_id}, semantic=${status.context_routing.semantic})`,
    `- Engineering learning: ${status.learning.lessons} Lessons, ${status.learning.practices} Practices`,
    `- Learning revalidation: ${status.learning.revalidation_due} due, ${status.learning.contradicted} contradicted`,
    `- Skill promotion: ${status.learning.skill_candidates} candidate(s), ${status.learning.skill_proposals_pending} approval pending, ${status.learning.skill_authoring_created} authoring Work Item(s)`,
    `- Specifications: ${status.specifications.total_entries} indexed, ${status.specifications.approved_entries} approved (${status.specifications.adoption_profile})`,
    `- Tracker: \`${status.tracker.profile}\` (${status.tracker.active_providers} active provider(s), ${status.tracker.linked_work_items} linked Work Item(s))`,
    `- Repository integration: \`${status.repository_integration.status}\` (${markdown(status.repository_integration.summary ?? "no confirmed policy summary")})`,
    `- Attention signals: ${status.attention.length}`,
    "",
    "## Collaboration",
    "",
    `- Profile: \`${status.collaboration.profile}\``,
    `- Coordination backend: \`${status.collaboration.coordination_backend}\``,
    `- Human Principals: ${status.collaboration.principals}`,
    `- Agent sponsorships: ${status.collaboration.sponsorships}`,
    `- Active Position memberships: ${status.collaboration.memberships}`,
    `- Active Work Item claims: ${status.collaboration.active_claims}`,
    `- Active Human Authority Grants: ${status.collaboration.authority_grants}`,
    `- Governance recovery: \`${status.collaboration.recovery?.status ?? "unknown"}\``,
    `- Real Collaborative validation: \`${status.collaboration.validation?.real_collaborative?.status ?? "not_run"}\` (${status.collaboration.validation?.real_collaborative?.plan ?? "no plan recorded"})`,
    "",
    "## Parallel orchestration",
    "",
    `- Generated plan: \`${PARALLEL_PLAN_RELATIVE_PATH}\``,
    `- Installed: ${status.orchestration.installed ? "yes" : "no"}`,
    `- Valid: ${status.orchestration.installed ? (status.orchestration.valid ? "yes" : "no") : "not generated"}`,
    `- Fresh: ${status.orchestration.fresh === null ? "not generated" : status.orchestration.fresh ? "yes" : "no"}`,
    `- Safe waves: ${status.orchestration.waves}`,
    `- Dispatchable Work Items: ${status.orchestration.dispatchable}`,
    `- Active / sequential / blocked: ${status.orchestration.active} / ${status.orchestration.sequential} / ${status.orchestration.blocked}`,
    `- Next wave: ${status.orchestration.next_wave.join(", ") || "none"}`,
    `- Codex tasks, claims, or external actions performed by planning: no`,
    "",
    "## Work items",
    ""
  ];

  if (status.work_items.items.length === 0) {
    lines.push("No work items yet.");
  } else {
    lines.push(
      "| ID | Title | State | Owner | Agent | Parallel | Tracker | Links | Spec mode | UI | Specs | Stale | Unapproved | Claim | Revision | Tasks | Evidence | Unresolved |",
      "|---|---|---|---|---|---|---|---:|---|---|---:|---:|---:|---|---|---:|---:|---:|"
    );
    for (const item of status.work_items.items) {
      lines.push(
        `| ${item.id} | ${markdown(item.title)} | ${item.state} | ${markdown(item.owner_name)} | ${markdown(item.assigned_agent_name)} | ${item.parallel_mode} | ${markdown(item.tracker_visibility)} | ${item.tracker_reference_count} | ${markdown(item.specification_mode ?? "legacy")} | ${markdown(item.ui_delivery_mode ?? "undecided")} | ${item.specification_reference_count} | ${item.stale_specification_count} | ${item.unapproved_specification_count} | ${item.active_claim ? markdown(item.active_claim.id) : "—"} | \`${shortRevision(item.latest_revision)}\` | ${item.task_count} | ${item.evidence_count} | ${item.unresolved_count} |`
      );
    }
  }

  lines.push("", "## Delivery attention", "");
  for (const item of status.work_items.items.filter(entry => !entry.terminal)) {
    const delivery = item.delivery_attention;
    if (!delivery) continue;
    lines.push(`- ${item.id}: ${markdown(delivery.state)} — ${markdown(delivery.next_action)}`);
    for (const condition of delivery.missing_conditions) lines.push(`  - ${markdown(condition.kind)}: ${markdown(condition.description)}`);
  }
  lines.push("", "## Codex task registry", "");
  if (status.tasks.items.length === 0) {
    lines.push("No Codex tasks registered yet.");
  } else {
    lines.push(
      "| Task | Work item | Suggested title | Position / Agent | Principal | Branch | Status | Revision | Archive |",
      "|---|---|---|---|---|---|---|---|---|"
    );
    for (const task of status.tasks.items) {
      lines.push(
        `| ${task.id} | ${task.work_item_id} | ${markdown(task.suggested_title)} | ${markdown(task.position_name)} / ${markdown(task.agent_name)} | ${markdown(task.principal_id ?? "—")} | ${markdown(task.branch ?? "—")} | ${task.status} | \`${shortRevision(task.current_revision)}\` | ${task.archive_ready ? "ready" : "—"} |`
      );
    }
  }

  lines.push("", "## Runtime workers and shared resources", "");
  if (status.runtime_workers.items.length === 0) lines.push("No runtime workers registered yet.");
  else {
    lines.push(
      "| Worker | Kind | Work item | Position / Agent | Status | Correlation | Revision | Resources |",
      "|---|---|---|---|---|---|---|---:|"
    );
    for (const worker of status.runtime_workers.items) {
      lines.push(
        `| ${worker.id} | ${worker.runtime_kind} | ${worker.work_item_id} | ${markdown(worker.position_name)} / ${markdown(worker.agent_name)} | ${worker.status} | ${markdown(worker.task_id ?? worker.runtime_id ?? "reserved")} | \`${shortRevision(worker.current_revision)}\` | ${worker.resource_reservation_ids.length} |`
      );
    }
  }
  lines.push(
    "",
    `- Shared resource registry: \`${RESOURCE_REGISTRY_RELATIVE_PATH}\``,
    `- Runtime worker registry: \`${RUNTIME_WORKER_REGISTRY_RELATIVE_PATH}\``,
    `- Active resource reservations: ${status.shared_resources.active_reservations}`
  );

  lines.push("", "## Attention", "");
  if (status.attention.length === 0) lines.push("No blockers, task attention requests, or archive-ready tasks.");
  else for (const signal of status.attention) lines.push(`- ${signal.message}`);

  lines.push(
    "",
    "## External tracker coordination",
    "",
    `- Profile: \`${status.tracker.profile}\``,
    `- Sync granularity: \`${status.tracker.sync_granularity}\``,
    `- Active providers: ${status.tracker.active_providers}`,
    `- Team-visible Work Items: ${status.tracker.team_visible_work_items}`,
    `- Linked Work Items: ${status.tracker.linked_work_items}`,
    `- Observed external items: ${status.tracker.observed_items}`,
    `- Reconciliation actions: ${status.tracker.reconciliation_actions}`,
    `- External write performed by status: no`,
    `- Configuration: \`${TRACKER_CONFIG_RELATIVE_PATH}\``,
    `- Generated observations: \`${TRACKER_VIEW_RELATIVE_PATH}\``,
    "",
    "## Repository integration",
    "",
    `- Status: \`${status.repository_integration.status}\``,
    `- Authority: \`${status.repository_integration.authority}\``,
    `- Source: \`${status.repository_integration.source}\``,
    `- Integration target: ${markdown(status.repository_integration.integration_target ?? "not confirmed")}`,
    `- Change isolation: \`${status.repository_integration.change_isolation}\``,
    `- Review gate: \`${status.repository_integration.review_gate}\``,
    `- Policy references: ${status.repository_integration.policy_refs.map((entry) => `\`${markdown(entry)}\``).join(", ") || "none"}`,
    `- Temple mutates repository-hosting settings: no`,
    "",
    "## Product specifications",
    "",
    `- Adoption profile: \`${status.specifications.adoption_profile}\``,
    `- Delivery method: \`${status.specifications.delivery_method}\``,
    `- Indexed: ${status.specifications.total_entries}`,
    `- Approved: ${status.specifications.approved_entries}`,
    `- Registry installed: ${status.specifications.installed ? "yes" : "no"}`,
    `- Registry valid: ${status.specifications.valid ? "yes" : "no"}`,
    `- Repository sources valid: ${status.specifications.sources_valid ? "yes" : "no"}`,
    `- External authorities: ${status.specifications.by_authority.authoritative_external}`,
    `- Derived projections: ${status.specifications.by_authority.derived_projection}`,
    `- Legacy unverified: ${status.specifications.by_authority.legacy_unverified}`,
    `- Registry: \`${SPEC_INDEX_RELATIVE_PATH}\``,
    "",
    "## Progressive context routing",
    "",
    `- Context Map: \`${CONTEXT_MAP_RELATIVE_PATH}\``,
    `- Active routes: ${status.context_routing.active_routes}`,
    `- Capability Registry: \`.ai-org/views/capabilities.json\``,
    `- Available capabilities: ${status.capabilities.available}`,
    `- Retrieval Provider: \`${status.context_routing.provider_id}\``,
    `- Semantic retrieval: ${status.context_routing.semantic ? "enabled" : "disabled"}`,
    `- Local hybrid boundary: \`${status.context_routing.local_hybrid.status}\` (runtime installed: no)`,
    `- Large-repository retrieval validation: \`${status.context_routing.large_repository_validation}\``,
    "",
    "## Adaptive execution routing",
    "",
    `- Selection mode: \`${status.execution_routing.selection_mode}\``,
    `- Profiles: ${status.execution_routing.profiles} (${status.execution_routing.mapped_profiles} concretely mapped)`,
    `- Capabilities: ${status.execution_routing.capabilities}`,
    `- Resource measures: ${status.execution_routing.resource_measures}`,
    `- Fallback profile: \`${status.execution_routing.fallback_profile_id}\``,
    `- Automatic execution: ${status.execution_routing.automatic_execution ? "enabled" : "disabled"}`,
    `- Provider contact performed by resolution: ${status.execution_routing.provider_contact ? "yes" : "no"}`,
    "",
    "## Engineering learning",
    "",
    `- Candidate: ${status.learning.candidates}`,
    `- Validated: ${status.learning.validated}`,
    `- Active: ${status.learning.active}`,
    `- Deprecated: ${status.learning.deprecated}`,
    `- Revalidation due: ${status.learning.revalidation_due}`,
    `- Contradicted: ${status.learning.contradicted}`,
    `- Skill candidates: ${status.learning.skill_candidates}`,
    `- Skill Proposals awaiting approval: ${status.learning.skill_proposals_pending}`,
    `- Deferred Skill Proposals due: ${status.learning.skill_proposal_reviews_due}`,
    `- Skill authoring Work Items created: ${status.learning.skill_authoring_created}`,
    `- Explicit outcome reviews: ${status.learning.reviews?.recorded ?? 0}; stale: ${status.learning.reviews?.counts?.["review-required"] ?? 0}; storage issues: ${status.learning.reviews?.errors?.length ?? 0}`,
    "- Retrieval index: `.ai-org/learning/index.json`",
    ""
  );

  lines.push("", "## Recent events", "");
  if (status.recent_events.length === 0) lines.push("No events recorded.");
  else {
    lines.push("| Time | Event | Work item | Actor |", "|---|---|---|---|");
    for (const event of status.recent_events) {
      lines.push(
        `| ${markdown(event.timestamp ?? "unknown")} | ${markdown(event.event_type ?? "unknown")} | ${markdown(event.work_item_id ?? "—")} | ${markdown(event.actor ?? "—")} |`
      );
    }
  }

  lines.push(
    "",
    "## Assignments",
    "",
    "| Position | Agent Identity | Stable ID |",
    "|---|---|---|",
    ...status.assignments.map(
      (assignment) => `| ${assignment.position_name} | ${assignment.agent_name} | \`${assignment.agent_id}\` |`
    ),
    "",
    "## Optional Skill packs",
    ""
  );
  if (status.optional_packs.length === 0) {
    lines.push("No optional Skill packs installed.");
  } else {
    lines.push("| Pack | Version | Skills |", "|---|---|---|");
    for (const pack of status.optional_packs) {
      lines.push(`| ${markdown(pack.id)} | \`${markdown(pack.version)}\` | ${markdown(pack.skills.join(", "))} |`);
    }
  }

  lines.push(
    "",
    "## Integration",
    "",
    `- Root AGENTS.md: ${status.integrations?.agents_md ?? "unknown"}`,
    `- Archify contract: ${status.integrations?.archify?.status ?? "unknown"}`,
    `- Archify adapter: ${status.integrations?.archify_adapter?.status ?? "unknown"}`,
    "",
    "> This file is a generated projection. Update canonical files, then rebuild this view.",
    ""
  );
  return lines.join("\n");
}

export async function writeStatus(target, status) {
  const outputPath = path.join(target, ".ai-org/views/status.md");
  await atomicWrite(outputPath, renderStatusMarkdown(status));
  return outputPath;
}
