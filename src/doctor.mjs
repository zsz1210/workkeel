import fs from "node:fs/promises";
import { summarizeLearningReviews } from "./learning-review.mjs";
import path from "node:path";
import { leanFinishAttention } from "./lean-delivery-state.mjs";
import {
  AGENTS_MARKER_START,
  REPOSITORY_ROOT,
  REQUIRED_POSITIONS,
  REQUIRED_SKILLS,
  SELF_HOST_ADOPTABLE_MANAGED_PATHS,
  TASK_STATUSES,
  TEMPLATE_VERSION
} from "./constants.mjs";
import {
  buildCapabilityRegistry,
  CONTEXT_MAP_RELATIVE_PATH,
  createRepositoryRetrievalProvider,
  isSafeRepositoryPath,
  validateContextMap,
  validateRetrievalProvider
} from "./context.mjs";
import { pathExists, readJson, sha256File } from "./files.mjs";
import {
  LEARNING_INDEX_RELATIVE_PATH,
  summarizeLearningIndex,
  validateLearningIndex
} from "./learning.mjs";
import { validateProjectState } from "./model.mjs";
import { listPackDefinitions, packLockMetadata } from "./packs.mjs";
import {
  COLLABORATION_RELATIVE_PATH,
  DISCIPLINES,
  agentIsEligible,
  validateCollaborationState
} from "./collaboration.mjs";
import { isWorkItemId } from "./ids.mjs";
import { inspectParallelPlan } from "./orchestration.mjs";
import { activeExecutionRequirements } from "./work-items.mjs";
import { validateCliBootstrapMetadata } from "./bootstrap.mjs";
import {
  RESOURCE_REGISTRY_RELATIVE_PATH,
  validateResourceRegistry
} from "./resources.mjs";
import {
  RUNTIME_WORKER_REGISTRY_RELATIVE_PATH,
  validateRuntimeWorkerRegistry
} from "./workers.mjs";
import {
  EVIDENCE_REGISTRY_RELATIVE_PATH,
  validateEvidenceArtifacts,
  validateEvidenceRegistry
} from "./evidence.mjs";
import { validateProjectSchemas } from "./schema-validation.mjs";
import { readRetrievalConfig, validateRetrievalConfig } from "./retrieval.mjs";
import { inspectArchifyAdapter } from "./archify-adapter.mjs";
import { validateWorkItemAssurance } from "./assurance.mjs";
import {
  SPEC_INDEX_RELATIVE_PATH,
  evaluateWorkItemSpecRefs,
  summarizeSpecIndex,
  validateRepositorySpecSources,
  validateSpecIndex
} from "./specifications.mjs";
import {
  TRACKER_CONFIG_RELATIVE_PATH,
  TRACKER_VIEW_RELATIVE_PATH,
  validateTrackerConfig,
  validateTrackerMappings,
  validateTrackerReconciliationArtifact,
  validateTrackerView
} from "./tracker.mjs";
import { REASONING_EFFORT_SOURCES, TASK_EXECUTION_ORIGINS } from "./tasks.mjs";
import {
  REPOSITORY_INTEGRATION_RELATIVE_PATH,
  validateRepositoryIntegration
} from "./repository-integration.mjs";

function summarize(checks) {
  return checks.reduce(
    (summary, check) => {
      summary[check.status] += 1;
      return summary;
    },
    { pass: 0, warn: 0, fail: 0 }
  );
}

async function safeJson(targetPath, checks, id) {
  try {
    return await readJson(targetPath);
  } catch (error) {
    checks.push({ id, status: "fail", message: error.message });
    return null;
  }
}

function hasDependencyCycle(itemId, itemsById, visiting = new Set(), visited = new Set()) {
  if (visiting.has(itemId)) return true;
  if (visited.has(itemId)) return false;
  visiting.add(itemId);
  for (const dependencyId of itemsById.get(itemId)?.dependencies ?? []) {
    if (itemsById.has(dependencyId) && hasDependencyCycle(dependencyId, itemsById, visiting, visited)) return true;
  }
  visiting.delete(itemId);
  visited.add(itemId);
  return false;
}

export async function runDoctor(target, options = {}) {
  const checks = [];
  const lockPath = path.join(target, "temple.lock");
  if (!(await pathExists(lockPath))) {
    checks.push({ id: "temple_lock", status: "fail", message: "temple.lock is missing; run temple init first" });
    return { target, checks, summary: summarize(checks), healthy: false };
  }

  const lock = await safeJson(lockPath, checks, "temple_lock");
  if (!lock) {
    return { target, checks, summary: summarize(checks), healthy: false };
  }
  if (lock.schema_version === "temple.lock/v1" && lock.template?.version === TEMPLATE_VERSION) {
    checks.push({ id: "temple_lock", status: "pass", message: `Organization system ${lock.template.version} lock is valid` });
  } else {
    checks.push({
      id: "temple_lock",
      status: "fail",
      message: `Unsupported or mismatched organization lock version: ${lock.template?.version ?? "unknown"}`
    });
  }
  const bootstrapValidation = validateCliBootstrapMetadata(lock.template?.bootstrap, lock.template?.version);
  checks.push({
    id: "cli_bootstrap",
    status: bootstrapValidation.valid ? "pass" : "fail",
    message: bootstrapValidation.valid
      ? `Repository launcher pins Temple ${lock.template.version}`
      : bootstrapValidation.errors.join("; ")
  });
  const installationMode = lock.installation?.mode ?? "project";
  const adoptedManagedFiles = lock.installation?.adopted_managed_files ?? [];
  const adoptedManagedFilesValid =
    Array.isArray(adoptedManagedFiles) &&
    new Set(adoptedManagedFiles).size === adoptedManagedFiles.length &&
    adoptedManagedFiles.every((relativePath) => SELF_HOST_ADOPTABLE_MANAGED_PATHS.has(relativePath));
  const [resolvedTarget, resolvedRepositoryRoot] = await Promise.all([
    fs.realpath(target).catch(() => path.resolve(target)),
    fs.realpath(REPOSITORY_ROOT).catch(() => path.resolve(REPOSITORY_ROOT))
  ]);
  const selfHostValid =
    installationMode === "toolkit-self-host" &&
    resolvedTarget === resolvedRepositoryRoot &&
    lock.installation?.source_overlay === "project-overlay" &&
    adoptedManagedFilesValid &&
    (await pathExists(path.join(target, "project-overlay")));
  checks.push({
    id: "installation_mode",
    status: installationMode === "project" || selfHostValid ? "pass" : "fail",
    message:
      installationMode === "project"
        ? "Project installation boundary is valid"
        : selfHostValid
          ? "Toolkit self-host boundary is valid and project-overlay remains the distribution source"
          : `Invalid or misplaced installation mode: ${installationMode}`
  });
  try {
    const schemaReport = await validateProjectSchemas(target);
    checks.push({
      id: "runtime_json_schema",
      status: schemaReport.valid ? "pass" : "fail",
      message: schemaReport.valid
        ? `${schemaReport.documents_checked} JSON document(s) match ${schemaReport.schemas_checked} cataloged Draft 2020-12 schema(s)`
        : schemaReport.errors.map((error) => `${error.document ?? error.schema}${error.instance_path}: ${error.message}`).join("; ")
    });
  } catch (error) {
    checks.push({ id: "runtime_json_schema", status: "fail", message: error.message });
  }

  const changedManaged = [];
  const missingManaged = [];
  for (const entry of lock.managed_files ?? []) {
    const managedPath = path.join(target, entry.path);
    if (!(await pathExists(managedPath))) {
      missingManaged.push(entry.path);
    } else if ((await sha256File(managedPath)) !== entry.sha256) {
      changedManaged.push(entry.path);
    }
  }
  if (missingManaged.length || changedManaged.length) {
    checks.push({
      id: "managed_files",
      status: "fail",
      message: [
        missingManaged.length ? `missing: ${missingManaged.join(", ")}` : null,
        changedManaged.length ? `changed: ${changedManaged.join(", ")}` : null
      ]
        .filter(Boolean)
        .join("; ")
    });
  } else {
    checks.push({ id: "managed_files", status: "pass", message: `${lock.managed_files?.length ?? 0} managed files match checksums` });
  }

  const availablePacks = new Map((await listPackDefinitions()).map((definition) => [definition.manifest.id, definition]));
  const invalidPacks = [];
  const installedPackIds = new Set();
  const managedPaths = new Set((lock.managed_files ?? []).map((entry) => entry.path));
  for (const installed of lock.optional_packs ?? []) {
    const definition = availablePacks.get(installed.id);
    if (
      !definition ||
      installedPackIds.has(installed.id) ||
      installed.version !== definition.manifest.version ||
      Object.entries(packLockMetadata(definition.manifest)).some(
        ([key, value]) => JSON.stringify(installed[key]) !== JSON.stringify(value)
      ) ||
      definition.manifest.files.some((relativePath) => !managedPaths.has(relativePath))
    ) {
      invalidPacks.push(installed.id ?? "unknown");
    }
    installedPackIds.add(installed.id);
  }
  checks.push({
    id: "optional_packs",
    status: invalidPacks.length ? "fail" : "pass",
    message: invalidPacks.length
      ? `Invalid or outdated optional packs: ${invalidPacks.join(", ")}`
      : `${installedPackIds.size} optional packs are valid`
  });

  const positionsDocument = await safeJson(
    path.join(target, ".ai-org/core/positions.json"),
    checks,
    "positions_document"
  );
  const positionIds = new Set((positionsDocument?.positions ?? []).map((position) => position.id));
  const exactPositions =
    positionIds.size === REQUIRED_POSITIONS.length && REQUIRED_POSITIONS.every((positionId) => positionIds.has(positionId));
  checks.push({
    id: "position_catalog",
    status: exactPositions ? "pass" : "fail",
    message: exactPositions
      ? `All ${REQUIRED_POSITIONS.length} required Positions are present`
      : `Position catalog differs from the required ${REQUIRED_POSITIONS.length} Positions`
  });

  const specIndex = await safeJson(path.join(target, SPEC_INDEX_RELATIVE_PATH), checks, "spec_index_json");
  let specIndexValidation = { valid: false, errors: ["spec index is missing"], warnings: [] };
  if (specIndex) {
    specIndexValidation = validateSpecIndex(specIndex, positionIds);
    const repositorySourceValidation = specIndexValidation.valid
      ? await validateRepositorySpecSources(target, specIndex)
      : { valid: false, errors: [] };
    const issues = [
      ...specIndexValidation.errors,
      ...repositorySourceValidation.errors
    ];
    const specSummary = summarizeSpecIndex(specIndex);
    checks.push({
      id: "specification_index",
      status: issues.length ? "fail" : specIndexValidation.warnings.length ? "warn" : "pass",
      message: issues.length
        ? issues.join("; ")
        : `${specSummary.total_entries} specifications are indexed (${specSummary.approved_entries} approved, profile=${specSummary.adoption_profile})${
            specIndexValidation.warnings.length ? `; ${specIndexValidation.warnings.join("; ")}` : ""
          }`
    });
  }

  const trackerConfig = await safeJson(path.join(target, TRACKER_CONFIG_RELATIVE_PATH), checks, "tracker_config_json");
  const trackerConfigValidation = trackerConfig
    ? validateTrackerConfig(trackerConfig)
    : { valid: false, errors: ["tracker config is missing"], warnings: [] };
  if (trackerConfig) {
    checks.push({
      id: "tracker_configuration",
      status: trackerConfigValidation.valid ? (trackerConfigValidation.warnings.length ? "warn" : "pass") : "fail",
      message: trackerConfigValidation.valid
        ? `${trackerConfig.profile} profile has ${(trackerConfig.providers ?? []).length} provider(s); granularity=${trackerConfig.sync_granularity}${
            trackerConfigValidation.warnings.length ? `; ${trackerConfigValidation.warnings.join("; ")}` : ""
          }`
        : trackerConfigValidation.errors.join("; ")
    });
  }

  const [project, agents, assignments, collaboration, repositoryIntegration] = await Promise.all([
    safeJson(path.join(target, ".ai-org/project/project.json"), checks, "project_json"),
    safeJson(path.join(target, ".ai-org/project/agents.json"), checks, "agents_json"),
    safeJson(path.join(target, ".ai-org/project/assignments.json"), checks, "assignments_json"),
    safeJson(path.join(target, COLLABORATION_RELATIVE_PATH), checks, "collaboration_json"),
    safeJson(path.join(target, REPOSITORY_INTEGRATION_RELATIVE_PATH), checks, "repository_integration_json")
  ]);
  if (project && agents && assignments) {
    checks.push(...validateProjectState(project, agents, assignments, positionIds));
  }
  if (collaboration && agents && assignments) {
    const validation = validateCollaborationState(collaboration, agents, assignments, positionIds);
    checks.push({
      id: "collaboration_model",
      status: validation.valid ? "pass" : "fail",
      message: validation.valid
        ? `${collaboration.profile} profile has ${(collaboration.principals ?? []).length} Human Principals and ${(collaboration.memberships ?? []).length} Position memberships`
        : validation.errors.join("; ")
    });
    if (validation.warnings.length > 0) {
      checks.push({ id: "collaboration_validation", status: "warn", message: validation.warnings.join("; "),
        ...(validation.warnings.length === 1 && validation.warnings[0] === "real multi-human, multi-machine validation has not passed"
          ? { code: "COLLABORATION_REAL_VALIDATION_NOT_PASSED" } : {}) });
    }
  }
  if (repositoryIntegration) {
    const validation = validateRepositoryIntegration(repositoryIntegration);
    checks.push({
      id: "repository_integration",
      status: validation.valid ? (repositoryIntegration.status === "confirmed" ? "pass" : "warn") : "fail",
      message: validation.valid
        ? repositoryIntegration.status === "confirmed"
          ? `Project repository integration is confirmed (${repositoryIntegration.source})`
          : `Project repository integration is ${repositoryIntegration.status}; inspect existing policy and ask only when the missing choice affects work`
        : validation.errors.join("; ")
    });
  }

  const contextMap = await safeJson(
    path.join(target, CONTEXT_MAP_RELATIVE_PATH),
    checks,
    "context_map_json"
  );
  const contextRouteIds = new Set();
  if (contextMap) {
    const validation = validateContextMap(contextMap, positionIds);
    const missingPaths = [];
    for (const route of contextMap.routes ?? []) {
      contextRouteIds.add(route.id);
      if (route.status !== "active") continue;
      for (const relativePath of route.paths ?? []) {
        if (isSafeRepositoryPath(relativePath) && !(await pathExists(path.join(target, relativePath)))) {
          missingPaths.push(`${route.id}:${relativePath}`);
        }
      }
    }
    const issues = [
      ...validation.errors,
      ...(missingPaths.length ? [`active route paths are missing: ${missingPaths.join(", ")}`] : [])
    ];
    checks.push({
      id: "context_map",
      status: issues.length ? "fail" : "pass",
      message: issues.length
        ? issues.join("; ")
        : `${contextMap.routes.filter((route) => route.status === "active").length} active context routes are valid`
    });
  }

  const providerValidation = validateRetrievalProvider(createRepositoryRetrievalProvider());
  checks.push({
    id: "retrieval_provider",
    status: providerValidation.valid ? "pass" : "fail",
    message: providerValidation.valid
      ? "Default repository-deterministic Retrieval Provider contract is valid; semantic retrieval is disabled"
      : providerValidation.errors.join("; ")
  });
  try {
    const retrievalConfig = await readRetrievalConfig(target);
    const validation = validateRetrievalConfig(retrievalConfig);
    checks.push({
      id: "retrieval_configuration",
      status: validation.valid ? "pass" : "fail",
      message: validation.valid
        ? `Selected ${retrievalConfig.selected_provider}; local hybrid=${retrievalConfig.local_hybrid.status}; no model, embeddings, vector database, daemon, or remote search installed`
        : validation.errors.join("; ")
    });
  } catch (error) {
    checks.push({ id: "retrieval_configuration", status: "fail", message: error.message });
  }

  const archify = await inspectArchifyAdapter(target);
  checks.push({
    id: "archify_adapter",
    status: archify.status === "invalid" ? "fail" : "pass",
    message: archify.reason
  });

  const workflow = await safeJson(path.join(target, ".ai-org/core/workflow.json"), checks, "workflow_json");
  const highAssurancePolicy = await safeJson(
    path.join(target, ".ai-org/core/high-assurance.json"),
    checks,
    "high_assurance_policy_json"
  );
  const workflowStates = new Set((workflow?.states ?? []).map((state) => state.id));
  const resourceRegistry = await safeJson(
    path.join(target, RESOURCE_REGISTRY_RELATIVE_PATH),
    checks,
    "resource_registry_json"
  );
  const resourceValidation = resourceRegistry
    ? validateResourceRegistry(resourceRegistry)
    : { valid: false, errors: ["resource registry unavailable"] };
  checks.push({
    id: "shared_resources",
    status: resourceValidation.valid ? "pass" : "fail",
    message: resourceValidation.valid
      ? `${resourceRegistry.resources.length} shared resource(s), ${resourceRegistry.reservations.filter((entry) => entry.status === "active").length} active reservation(s)`
      : resourceValidation.errors.join("; ")
  });
  const resourceIds = new Set(
    (Array.isArray(resourceRegistry?.resources) ? resourceRegistry.resources : [])
      .filter((entry) => entry.active !== false)
      .map((entry) => entry.id)
  );
  const agentIds = new Set((agents?.agents ?? []).map((agent) => agent.id));
  const ownersForDoctor = new Map(
    (assignments?.assignments ?? [])
      .filter((assignment) => assignment.active !== false)
      .map((assignment) => [assignment.position_id, assignment.agent_id])
  );
  const workItemsDirectory = path.join(target, ".ai-org/work-items");
  const invalidWorkItems = [];
  const staleSpecificationWorkItems = [];
  const unapprovedSpecificationWorkItems = [];
  const workItemsForDoctor = new Map();
  const activeClaimBranches = new Set();
  const activeClaimWorktrees = new Set();
  let workItemCount = 0;
  if (await pathExists(workItemsDirectory)) {
    const entries = await fs.readdir(workItemsDirectory, { withFileTypes: true });
    const seenWorkItemIds = new Set();
    for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json"))) {
      workItemCount += 1;
      try {
        const item = await readJson(path.join(workItemsDirectory, entry.name));
        const valid =
          item.schema_version === "temple.work-item/v1" &&
          isWorkItemId(item.id) &&
          entry.name === `${item.id}.json` &&
          !seenWorkItemIds.has(item.id) &&
          workflowStates.has(item.state) &&
          positionIds.has(item.owner_position) &&
          (item.assigned_agent_id === null || item.assigned_agent_id === undefined || agentIds.has(item.assigned_agent_id)) &&
          Array.isArray(item.evidence) &&
          (item.affected_paths === undefined ||
            (Array.isArray(item.affected_paths) && item.affected_paths.every(isSafeRepositoryPath))) &&
          (item.context_refs === undefined ||
            (Array.isArray(item.context_refs) &&
              item.context_refs.every((value) => typeof value === "string" && contextRouteIds.has(value)))) &&
          (item.unresolved === undefined ||
            (Array.isArray(item.unresolved) && item.unresolved.every((value) => typeof value === "string"))) &&
          (item.parent_work_item_id === undefined || item.parent_work_item_id === null || isWorkItemId(item.parent_work_item_id)) &&
          (item.dependencies === undefined ||
            (Array.isArray(item.dependencies) && item.dependencies.every(isWorkItemId))) &&
          (item.required_disciplines === undefined ||
            (Array.isArray(item.required_disciplines) && item.required_disciplines.every((value) => DISCIPLINES.includes(value)))) &&
          (item.stage_requirements === undefined ||
            (item.stage_requirements &&
              typeof item.stage_requirements === "object" &&
              !Array.isArray(item.stage_requirements) &&
              Object.entries(item.stage_requirements).every(
                ([stage, requirement]) =>
                  workflowStates.has(stage) &&
                  Array.isArray(requirement?.disciplines) &&
                  requirement.disciplines.every((value) => DISCIPLINES.includes(value)) &&
                  Array.isArray(requirement?.resources) &&
                  requirement.resources.every(
                    (value) =>
                      resourceIds.has(value?.resource_id) && Number.isInteger(value?.units) && value.units > 0
                  )
              ))) &&
          (item.parallel_mode === undefined || ["pending", "parallel", "sequential", "blocked"].includes(item.parallel_mode)) &&
          (item.contract_status === undefined || ["not_required", "draft", "stable"].includes(item.contract_status)) &&
          (item.integration_owner_agent_id === undefined || item.integration_owner_agent_id === null || agentIds.has(item.integration_owner_agent_id));
        const uiModeValid =
          ((item.ui_delivery_mode === undefined || item.ui_delivery_mode === null) &&
            (item.ui_refs ?? []).length === 0 &&
            !(
              Object.hasOwn(item, "ui_delivery_mode") &&
              ["build", "test", "eval", "independent_qa", "release_gate", "done"].includes(item.state)
            )) ||
          (["not-applicable", "code-first", "preview-first", "design-led"].includes(item.ui_delivery_mode) &&
            !(item.ui_delivery_mode === "not-applicable" && (item.ui_refs ?? []).length > 0) &&
            !(["preview-first", "design-led"].includes(item.ui_delivery_mode) && (item.ui_refs ?? []).length === 0));
        const specificationModeValid =
          item.specification_mode === undefined ||
          (["gate-evidence", "indexed"].includes(item.specification_mode) &&
            !(item.specification_mode === "gate-evidence" && (item.spec_refs ?? []).length > 0) &&
            !(
              item.specification_mode === "indexed" &&
              (item.spec_refs ?? []).length === 0 &&
              ["design", "build", "test", "eval", "independent_qa", "release_gate", "done"].includes(item.state)
            ));
        const assuranceValid = highAssurancePolicy
          ? validateWorkItemAssurance(highAssurancePolicy, item).valid
          : false;
        const specificationReferences = specIndex
          ? evaluateWorkItemSpecRefs(item, specIndex)
          : { valid: false, errors: ["spec index unavailable"], warnings: [], stale_count: 0, unapproved_count: 0 };
        if (specificationReferences.stale_count > 0 || specificationReferences.warnings.length > 0) {
          staleSpecificationWorkItems.push({ id: item.id, warnings: specificationReferences.warnings });
        }
        if (specificationReferences.unapproved_count > 0) {
          unapprovedSpecificationWorkItems.push({ id: item.id, count: specificationReferences.unapproved_count });
        }
        const currentRequirements = activeExecutionRequirements(item);
        const plannedValid =
          item.planned_agent_id === undefined ||
          item.planned_agent_id === null ||
          (agentIds.has(item.planned_agent_id) &&
            Boolean(collaboration) &&
            agentIsEligible(collaboration, item.planned_agent_id, item.owner_position, currentRequirements.disciplines));
        let claimValid = true;
        if (item.claim?.status === "active") {
          claimValid =
            agentIds.has(item.claim.agent_id) &&
            typeof item.claim.principal_id === "string" &&
            typeof item.claim.base_revision === "string" &&
            item.claim.base_revision.length > 0 &&
            typeof item.claim.branch === "string" &&
            item.claim.branch.length > 0 &&
            Boolean(collaboration) &&
            agentIsEligible(collaboration, item.claim.agent_id, item.owner_position, currentRequirements.disciplines) &&
            !activeClaimBranches.has(item.claim.branch) &&
            (!item.claim.worktree || !activeClaimWorktrees.has(item.claim.worktree));
          activeClaimBranches.add(item.claim.branch);
          if (item.claim.worktree) activeClaimWorktrees.add(item.claim.worktree);
        }
        if (!valid || !uiModeValid || !specificationModeValid || !assuranceValid || !specificationReferences.valid || !plannedValid || !claimValid) {
          invalidWorkItems.push(entry.name);
        }
        workItemsForDoctor.set(item.id, item);
        seenWorkItemIds.add(item.id);
      } catch {
        invalidWorkItems.push(entry.name);
      }
    }
    for (const [itemId, item] of workItemsForDoctor) {
      const references = [item.parent_work_item_id, ...(item.dependencies ?? [])].filter(Boolean);
      if (references.some((reference) => !workItemsForDoctor.has(reference)) || hasDependencyCycle(itemId, workItemsForDoctor)) {
        invalidWorkItems.push(`${itemId}.json`);
      }
    }
  }
  const uniqueInvalidWorkItems = [...new Set(invalidWorkItems)];
  checks.push({
    id: "work_items",
    status: uniqueInvalidWorkItems.length ? "fail" : "pass",
    message: uniqueInvalidWorkItems.length
      ? `Invalid work item files: ${uniqueInvalidWorkItems.join(", ")}`
      : `${workItemCount} canonical work items are valid`
  });
  const evidenceRegistry = await safeJson(
    path.join(target, EVIDENCE_REGISTRY_RELATIVE_PATH),
    checks,
    "evidence_registry_json"
  );
  if (evidenceRegistry) {
    const registryValidation = validateEvidenceRegistry(evidenceRegistry);
    const artifactValidation = registryValidation.valid
      ? await validateEvidenceArtifacts(target, evidenceRegistry, new Set(workItemsForDoctor.keys()))
      : { valid: false, errors: [] };
    const issues = [...registryValidation.errors, ...artifactValidation.errors];
    checks.push({
      id: "evidence_registry",
      status: issues.length ? "fail" : "pass",
      message: issues.length
        ? issues.join("; ")
        : `${evidenceRegistry.entries.length} normalized evidence record(s) and artifact digest(s) are valid`
    });
  }
  if (trackerConfig && trackerConfigValidation.valid) {
    const trackerMappings = validateTrackerMappings(trackerConfig, [...workItemsForDoctor.values()]);
    checks.push({
      id: "tracker_mappings",
      status: trackerMappings.errors.length ? "fail" : trackerMappings.warnings.length ? "warn" : "pass",
      message: trackerMappings.errors.length
        ? trackerMappings.errors.join("; ")
        : trackerMappings.warnings.length
          ? trackerMappings.warnings.join("; ")
          : "Work Item tracker mappings are valid"
    });
  }
  const trackerEvidenceIssues = [];
  for (const item of workItemsForDoctor.values()) {
    for (const reconciliation of item.tracker_reconciliations ?? []) {
      const evidenceRef = reconciliation?.evidence_ref;
      if (
        typeof evidenceRef !== "string" ||
        !evidenceRef.startsWith(".ai-org/artifacts/tracker-reconciliations/") ||
        evidenceRef.split(/[\\/]+/).includes("..")
      ) {
        continue;
      }
      if (!(item.evidence ?? []).includes(evidenceRef)) {
        trackerEvidenceIssues.push(`${item.id}:${evidenceRef} is not linked from evidence`);
      }
      const evidencePath = path.join(target, evidenceRef);
      if (!(await pathExists(evidencePath))) {
        trackerEvidenceIssues.push(`${item.id}:${evidenceRef} is missing`);
        continue;
      }
      try {
        const artifact = await readJson(evidencePath);
        const validation = validateTrackerReconciliationArtifact(artifact);
        if (!validation.valid) {
          trackerEvidenceIssues.push(`${item.id}:${evidenceRef} is invalid: ${validation.errors.join("; ")}`);
        } else if (
          artifact.work_item_id !== item.id ||
          artifact.provider_id !== reconciliation.provider_id ||
          String(artifact.item_id) !== String(reconciliation.item_id) ||
          artifact.observation_revision !== reconciliation.observation_revision ||
          artifact.resolution !== reconciliation.resolution ||
          artifact.recorded_at !== reconciliation.recorded_at ||
          artifact.recorded_by !== reconciliation.recorded_by
        ) {
          trackerEvidenceIssues.push(`${item.id}:${evidenceRef} does not match its Work Item reconciliation record`);
        }
      } catch (error) {
        trackerEvidenceIssues.push(`${item.id}:${evidenceRef} cannot be read: ${error.message}`);
      }
    }
  }
  checks.push({
    id: "tracker_reconciliation_evidence",
    status: trackerEvidenceIssues.length ? "fail" : "pass",
    message: trackerEvidenceIssues.length
      ? trackerEvidenceIssues.join("; ")
      : "Tracker reconciliation evidence is present and consistent"
  });
  const trackerViewPath = path.join(target, TRACKER_VIEW_RELATIVE_PATH);
  if (await pathExists(trackerViewPath)) {
    const trackerView = await safeJson(trackerViewPath, checks, "tracker_view_json");
    if (trackerView) {
      const trackerViewValidation = validateTrackerView(trackerView);
      checks.push({
        id: "tracker_view",
        status: trackerViewValidation.valid ? "pass" : "warn",
        message: trackerViewValidation.valid
          ? `${trackerView.entries.length} generated tracker observation(s) are valid`
          : `Generated tracker view can be rebuilt: ${trackerViewValidation.errors.join("; ")}`
      });
    }
  }
  const parallelInspection = await inspectParallelPlan(target);
  checks.push({
    id: "parallel_plan",
    status:
      !parallelInspection.installed || (parallelInspection.valid && parallelInspection.fresh)
        ? "pass"
        : "warn",
    message: !parallelInspection.installed
      ? "No generated parallel plan is present; planning remains optional until a group is ready"
      : !parallelInspection.valid
        ? `Generated parallel plan can be rebuilt: ${parallelInspection.errors.join("; ")}`
        : parallelInspection.fresh
          ? `${parallelInspection.plan.summary.waves} generated parallel wave(s) match current canonical state`
          : "Generated parallel plan is stale and must be rebuilt before dispatch"
  });
  if (staleSpecificationWorkItems.length > 0) {
    checks.push({
      id: "specification_reference_staleness",
      status: "warn",
      message: staleSpecificationWorkItems
        .map((entry) => `${entry.id}: ${entry.warnings.join("; ")}`)
        .join(" | ")
    });
  } else {
    checks.push({
      id: "specification_reference_staleness",
      status: "pass",
      message: "All Work Item specification references use current indexed revisions"
    });
  }
  checks.push({
    id: "specification_reference_approval",
    status: unapprovedSpecificationWorkItems.length ? "warn" : "pass",
    message: unapprovedSpecificationWorkItems.length
      ? unapprovedSpecificationWorkItems
          .map((entry) => `${entry.id}: ${entry.count} unapproved reference(s)`)
          .join(" | ")
      : "All referenced Work Item specifications are approved"
  });

  if (specIndex && specIndexValidation.valid) {
    const missingWorkItemLinks = (specIndex.entries ?? []).flatMap((entry) =>
      (entry.related_work_items ?? [])
        .filter((workItemId) => !isWorkItemId(workItemId) || !workItemsForDoctor.has(workItemId))
        .map((workItemId) => `${entry.id}:${workItemId}`)
    );
    checks.push({
      id: "specification_work_item_links",
      status: missingWorkItemLinks.length ? "fail" : "pass",
      message: missingWorkItemLinks.length
        ? `Specification index references missing Work Items: ${missingWorkItemLinks.join(", ")}`
        : "Specification-to-Work-Item links are valid"
    });
  }

  try {
    const capabilityRegistry = await buildCapabilityRegistry(target);
    checks.push({
      id: "capability_registry",
      status: capabilityRegistry.issues.length ? "fail" : "pass",
      message: capabilityRegistry.issues.length
        ? capabilityRegistry.issues.join("; ")
        : `${capabilityRegistry.counts.available} repository capabilities are discoverable without changing project ownership`
    });
  } catch (error) {
    checks.push({ id: "capability_registry", status: "fail", message: error.message });
  }

  const workersDocument = await safeJson(
    path.join(target, RUNTIME_WORKER_REGISTRY_RELATIVE_PATH),
    checks,
    "runtime_workers_json"
  );
  const workerValidation = workersDocument
    ? validateRuntimeWorkerRegistry(workersDocument)
    : { valid: false, errors: ["runtime worker registry unavailable"] };
  const workersById = new Map((workersDocument?.workers ?? []).map((worker) => [worker.id, worker]));
  const reservationIds = new Set((resourceRegistry?.reservations ?? []).map((entry) => entry.id));
  const invalidWorkerReferences = [];
  if (workerValidation.valid) {
    for (const worker of workersDocument.workers) {
      const item = workItemsForDoctor.get(worker.work_item_id);
      if (!item) invalidWorkerReferences.push(`${worker.id}: unknown Work Item`);
      else if (!(item.claim?.id === worker.claim_id || (item.claims ?? []).some((claim) => claim.id === worker.claim_id))) {
        invalidWorkerReferences.push(`${worker.id}: unknown claim`);
      }
      if (!positionIds.has(worker.position_id) || !agentIds.has(worker.agent_id)) {
        invalidWorkerReferences.push(`${worker.id}: unknown Position or Agent Identity`);
      }
      if (worker.resource_reservation_ids.some((id) => !reservationIds.has(id))) {
        invalidWorkerReferences.push(`${worker.id}: unknown resource reservation`);
      }
      const reservations = (resourceRegistry?.reservations ?? []).filter((entry) => entry.worker_id === worker.id);
      if (worker.resource_reservation_ids.some((id) => !reservations.some((entry) => entry.id === id))) {
        invalidWorkerReferences.push(`${worker.id}: resource reservation ownership mismatch`);
      }
      if (["completed", "failed", "cancelled"].includes(worker.status) && reservations.some((entry) => entry.status === "active")) {
        invalidWorkerReferences.push(`${worker.id}: terminal worker retains an active resource reservation`);
      }
    }
  }
  checks.push({
    id: "runtime_workers",
    status: !workerValidation.valid || invalidWorkerReferences.length ? "fail" : "pass",
    message: !workerValidation.valid
      ? workerValidation.errors.join("; ")
      : invalidWorkerReferences.length
        ? invalidWorkerReferences.join("; ")
        : `${workersDocument.workers.length} runtime worker record(s) are valid`
  });

  const tasksDocument = await safeJson(path.join(target, ".ai-org/project/tasks.json"), checks, "tasks_json");
  if (tasksDocument) {
    const seenTaskIds = new Set();
    const seenThreadIds = new Set();
    const workItemIds = new Set();
    if (await pathExists(workItemsDirectory)) {
      for (const entry of await fs.readdir(workItemsDirectory, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".json")) workItemIds.add(entry.name.replace(/\.json$/, ""));
      }
    }
    const invalidTasks = [];
    const principalIds = new Set((collaboration?.principals ?? []).map((principal) => principal.id));
    for (const task of tasksDocument.tasks ?? []) {
      const taskThreadIds = [task.thread_id, task.client_thread_id].filter(Boolean);
      const optionalMetadata = [
        [task.provider_id, 160],
        [task.requested_model, 160],
        [task.effective_model, 160],
        [task.requested_reasoning_effort, 80],
        [task.observed_thread_reasoning_effort, 80],
        [task.effective_turn_reasoning_effort, 80],
        [task.reasoning_effort, 80],
        [task.service_tier, 80],
        [task.launch_revision, 240]
      ];
      const executionOriginValid =
        task.execution_origin === undefined || TASK_EXECUTION_ORIGINS.includes(task.execution_origin);
      const metadataValid = optionalMetadata.every(([value, maximum]) =>
        value === undefined || value === null ||
        (typeof value === "string" && value.trim().length > 0 && value.length <= maximum && !value.includes("\0"))
      );
      const providerIdValid =
        task.provider_id === undefined || task.provider_id === null || /^[a-z0-9][a-z0-9-]*$/.test(task.provider_id);
      const reasoningSourceValid = task.reasoning_effort_source === undefined || task.reasoning_effort_source === null ||
        REASONING_EFFORT_SOURCES.includes(task.reasoning_effort_source);
      const providerOwnedValid = task.execution_origin !== "temple-provider-owned" ||
        (providerIdValid && Boolean(task.provider_id) && Boolean(task.thread_id) && Boolean(task.launch_revision));
      const valid =
        /^task-[0-9]{4,}$/.test(task.id ?? "") &&
        !seenTaskIds.has(task.id) &&
        workItemIds.has(task.work_item_id) &&
        positionIds.has(task.position_id) &&
        agentIds.has(task.agent_id) &&
        (ownersForDoctor.get(task.position_id) === task.agent_id ||
          (collaboration && agentIsEligible(collaboration, task.agent_id, task.position_id))) &&
        TASK_STATUSES.includes(task.status) &&
        taskThreadIds.length > 0 &&
        executionOriginValid &&
        metadataValid &&
        providerIdValid &&
        reasoningSourceValid &&
        providerOwnedValid &&
        (!task.registered_by || task.registered_by === "human" || agentIds.has(task.registered_by)) &&
        (!task.last_updated_by || task.last_updated_by === "human" || agentIds.has(task.last_updated_by)) &&
        (!task.principal_id || task.principal_id === "human" || principalIds.has(task.principal_id)) &&
        (!task.claim_id ||
          workItemsForDoctor.get(task.work_item_id)?.claim?.id === task.claim_id ||
          (workItemsForDoctor.get(task.work_item_id)?.claims ?? []).some((claim) => claim.id === task.claim_id)) &&
        (!task.branch || typeof task.branch === "string") &&
        (!task.worker_id ||
          (workersById.get(task.worker_id)?.runtime_kind === "user-task" &&
            workersById.get(task.worker_id)?.task_id === task.id)) &&
        taskThreadIds.every((threadId) => !seenThreadIds.has(threadId));
      if (!valid) invalidTasks.push(task.id ?? "unknown");
      seenTaskIds.add(task.id);
      for (const threadId of taskThreadIds) seenThreadIds.add(threadId);
    }
    checks.push({
      id: "task_registry",
      status: invalidTasks.length ? "fail" : "pass",
      message: invalidTasks.length
        ? `Invalid task records: ${invalidTasks.join(", ")}`
        : `${tasksDocument.tasks?.length ?? 0} Codex task records are valid`
    });
  }
  if (workersDocument && tasksDocument) {
    const tasksById = new Map((tasksDocument.tasks ?? []).map((task) => [task.id, task]));
    const danglingTaskWorkers = workersDocument.workers
      .filter((worker) => worker.task_id && tasksById.get(worker.task_id)?.worker_id !== worker.id)
      .map((worker) => worker.id);
    checks.push({
      id: "runtime_task_correlation",
      status: danglingTaskWorkers.length ? "fail" : "pass",
      message: danglingTaskWorkers.length
        ? `Runtime workers have invalid Codex task correlation: ${danglingTaskWorkers.join(", ")}`
        : "Internal subagents and user-owned Codex tasks have distinct valid correlation"
    });
  }

  const learningIndex = await safeJson(
    path.join(target, LEARNING_INDEX_RELATIVE_PATH),
    checks,
    "learning_index_json"
  );
  if (learningIndex) {
    const validation = validateLearningIndex(learningIndex);
    const indexedPaths = new Set((learningIndex.entries ?? []).map((entry) => entry.path));
    const missingRecords = [];
    const orphanRecords = [];
    if (validation.valid) {
      for (const relativePath of indexedPaths) {
        if (!(await pathExists(path.join(target, relativePath)))) missingRecords.push(relativePath);
      }
      for (const kind of ["lessons", "practices"]) {
        const directory = path.join(target, `.ai-org/learning/${kind}`);
        if (!(await pathExists(directory))) continue;
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
          if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
          const relativePath = `.ai-org/learning/${kind}/${entry.name}`;
          if (!indexedPaths.has(relativePath)) orphanRecords.push(relativePath);
        }
      }
    }
    const issues = [
      ...validation.errors,
      ...(missingRecords.length ? [`missing records: ${missingRecords.join(", ")}`] : []),
      ...(orphanRecords.length ? [`unindexed records: ${orphanRecords.join(", ")}`] : [])
    ];
    const summary = summarizeLearningIndex(learningIndex);
    const reviews = await summarizeLearningReviews(target);
    issues.push(...reviews.errors.map(error => `Learning reviews: ${error}`));
    checks.push({
      id: "engineering_learning",
      status: issues.length ? "fail" : "pass",
      message: issues.length
        ? issues.join("; ")
        : `${summary.lessons} Lessons and ${summary.practices} Practices are indexed`
    });
  }

  const optionalSkills = [...installedPackIds].flatMap((packId) => availablePacks.get(packId)?.manifest.skills ?? []);
  const expectedSkills = [...REQUIRED_SKILLS, ...optionalSkills];
  const missingSkills = [];
  for (const skill of expectedSkills) {
    if (!(await pathExists(path.join(target, `.agents/skills/${skill}/SKILL.md`)))) {
      missingSkills.push(skill);
    }
  }
  checks.push({
    id: "repository_skills",
    status: missingSkills.length ? "fail" : "pass",
    message: missingSkills.length
      ? `Missing repository skills: ${missingSkills.join(", ")}`
      : `All ${REQUIRED_SKILLS.length} core and ${optionalSkills.length} optional repository Skills are installed`
  });

  const agentsPath = path.join(target, "AGENTS.md");
  const agentsIntegrated =
    (await pathExists(agentsPath)) && (await fs.readFile(agentsPath, "utf8")).includes(AGENTS_MARKER_START);
  checks.push({
    id: "agents_md_integration",
    status: agentsIntegrated ? "pass" : "warn",
    message: agentsIntegrated
      ? "Root AGENTS.md includes AI organization instructions"
      : "AI organization instructions are not in root AGENTS.md; review .ai-org/project/AGENTS.temple.md"
  });

  const eventsPath = path.join(target, ".ai-org/events/events.jsonl");
  if (!(await pathExists(eventsPath))) {
    checks.push({ id: "events_stream", status: "fail", message: "events.jsonl is missing" });
  } else {
    const lines = (await fs.readFile(eventsPath, "utf8")).split(/\r?\n/).filter((line) => line.trim());
    const badLines = [];
    for (const [index, line] of lines.entries()) {
      try {
        JSON.parse(line);
      } catch {
        badLines.push(index + 1);
      }
    }
    checks.push({
      id: "events_stream",
      status: badLines.length ? "fail" : "pass",
      message: badLines.length ? `Invalid JSONL at event lines: ${badLines.join(", ")}` : `${lines.length} event records are valid`
    });
  }

  const finishAttention = await leanFinishAttention(target, options.settlingLeanFinish);
  if (finishAttention.length) checks.push({ id: "lean_finish_diagnostics", status: "fail", message: finishAttention.map(entry => entry.message).join("; ") });
  const summary = summarize(checks);
  return { target, checks, summary, healthy: summary.fail === 0 };
}

export function compactDoctor(result) {
  return {
    schema_version: "temple.doctor-summary/v1",
    validation_scope: "full",
    target: result.target,
    healthy: result.healthy,
    summary: result.summary,
    omitted_passing_checks: result.checks.filter((check) => check.status === "pass").length,
    checks: result.checks.filter((check) => check.status !== "pass")
  };
}

export function formatDoctor(result) {
  const lines = [`AI development organization doctor — ${result.target}`];
  for (const check of result.checks) {
    const symbol = check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
    lines.push(`[${symbol}] ${check.id}: ${check.message}`);
  }
  lines.push(`Summary: ${result.summary.pass} pass, ${result.summary.warn} warn, ${result.summary.fail} fail`);
  return lines.join("\n");
}
