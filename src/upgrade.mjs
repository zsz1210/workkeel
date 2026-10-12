import fs from "node:fs/promises";
import path from "node:path";
import {
  GENERATED_PATHS,
  KNOWN_PACKAGE_NAMES,
  MANAGED_EXACT_PATHS,
  MANAGED_SOURCE_PREFIXES,
  PACKAGE_NAME,
  PROJECT_OVERLAY_ROOT,
  PROJECT_OWNED_PATHS,
  TEMPLATE_REPOSITORY,
  TEMPLATE_VERSION
} from "./constants.mjs";
import {
  atomicCreate,
  atomicWrite,
  formatJson,
  pathExists,
  readJson,
  rollbackFileChanges,
  sha256,
  sha256File,
  walkFiles
} from "./files.mjs";
import { packLockMetadata, packSourcesForLock } from "./packs.mjs";
import { CONTEXT_MAP_RELATIVE_PATH, ensureContextMap } from "./context.mjs";
import { ensureLearningIndex, LEARNING_INDEX_RELATIVE_PATH } from "./learning.mjs";
import { ensureSpecIndex, SPEC_INDEX_RELATIVE_PATH } from "./specifications.mjs";
import { ensureTrackerConfig, TRACKER_CONFIG_RELATIVE_PATH } from "./tracker.mjs";
import { ensureTaskRegistry } from "./project.mjs";
import {
  COLLABORATION_RELATIVE_PATH,
  ensureCollaborationState,
  synchronizeDefaultMembershipDocument
} from "./collaboration.mjs";
import { buildCliBootstrapMetadata } from "./bootstrap.mjs";
import { ensureResourceRegistry, RESOURCE_REGISTRY_RELATIVE_PATH } from "./resources.mjs";
import { ensureRuntimeWorkerRegistry, RUNTIME_WORKER_REGISTRY_RELATIVE_PATH } from "./workers.mjs";
import { ensureEvidenceRegistry, EVIDENCE_REGISTRY_RELATIVE_PATH } from "./evidence.mjs";
import { applyMigrationPlanToLock, buildMigrationPlan } from "./migrations.mjs";
import { ensureRetrievalConfig, RETRIEVAL_CONFIG_RELATIVE_PATH } from "./retrieval.mjs";
import {
  CONTROL_PLANE_CONFIG_RELATIVE_PATH,
  ensureControlPlaneConfig
} from "./control-plane-config.mjs";
import { ensureFederationRegistry, FEDERATION_REGISTRY_RELATIVE_PATH } from "./federation.mjs";
import { ensureUsagePolicy, USAGE_POLICY_RELATIVE_PATH } from "./usage-policy.mjs";
import { ensureExecutionPolicy, EXECUTION_POLICY_RELATIVE_PATH } from "./execution-routing.mjs";
import { ensureRepositoryIntegration } from "./repository-integration.mjs";
import { ensureEvidenceProfiles, EVIDENCE_PROFILES_RELATIVE_PATH } from "./evidence-profiles.mjs";

function isManaged(relativePath) {
  return MANAGED_EXACT_PATHS.has(relativePath) || MANAGED_SOURCE_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

function isSafeManagedPath(relativePath) {
  return (
    typeof relativePath === "string" &&
    relativePath.length > 0 &&
    !path.isAbsolute(relativePath) &&
    !path.win32.isAbsolute(relativePath) &&
    !relativePath.includes("\\") &&
    path.posix.normalize(relativePath) === relativePath &&
    isManaged(relativePath)
  );
}

async function filesEqual(leftPath, rightPath) {
  const [left, right] = await Promise.all([fs.readFile(leftPath), fs.readFile(rightPath)]);
  return left.equals(right);
}

async function planUiAssignmentMigration(target, conflicts) {
  const assignmentsPath = path.join(target, ".ai-org/project/assignments.json");
  const agentsPath = path.join(target, ".ai-org/project/agents.json");
  if (!(await pathExists(assignmentsPath)) || !(await pathExists(agentsPath))) {
    conflicts.push("UI Designer assignment migration requires project assignments and Agent identities");
    return null;
  }

  try {
    const [before, assignmentsDocument, agentsDocument] = await Promise.all([
      fs.readFile(assignmentsPath),
      readJson(assignmentsPath),
      readJson(agentsPath)
    ]);
    if (assignmentsDocument.schema_version !== "temple.assignments/v1" || !Array.isArray(assignmentsDocument.assignments)) {
      conflicts.push("UI Designer assignment migration requires a valid assignments document");
      return null;
    }

    const activeAssignments = assignmentsDocument.assignments.filter((assignment) => assignment.active !== false);
    const uiAssignments = activeAssignments.filter((assignment) => assignment.position_id === "ui_designer");
    const agentIds = new Set((agentsDocument.agents ?? []).map((agent) => agent.id));
    if (uiAssignments.length === 1) {
      if (!agentIds.has(uiAssignments[0].agent_id)) {
        conflicts.push("UI Designer assignment references an unknown Agent Identity");
      }
      return null;
    }
    if (uiAssignments.length > 1) {
      conflicts.push("UI Designer has more than one active assignment");
      return null;
    }

    const uxAssignments = activeAssignments.filter((assignment) => assignment.position_id === "ux_designer");
    if (uxAssignments.length !== 1) {
      conflicts.push("Cannot infer UI Designer owner without exactly one active UX Designer assignment");
      return null;
    }
    if (!agentIds.has(uxAssignments[0].agent_id)) {
      conflicts.push("UX Designer assignment references an unknown Agent Identity");
      return null;
    }
    return {
      path: ".ai-org/project/assignments.json",
      agentId: uxAssignments[0].agent_id,
      beforeHash: sha256(before)
    };
  } catch (error) {
    conflicts.push(`Cannot plan UI Designer assignment migration: ${error.message}`);
    return null;
  }
}

export async function planUpgrade(target) {
  const lockPath = path.join(target, "temple.lock");
  if (!(await pathExists(lockPath))) throw new Error("temple.lock is missing; run temple init instead of upgrade");
  const lock = await readJson(lockPath);
  if (!KNOWN_PACKAGE_NAMES.has(lock.template?.name)) throw new Error("temple.lock belongs to an unknown template");

  const conflicts = [];
  const actions = [];
  const migrationPlan = await buildMigrationPlan(target, lock);
  const previousManaged = new Map((lock.managed_files ?? []).map((entry) => [entry.path, entry.sha256]));
  for (const [relativePath, expectedHash] of previousManaged) {
    if (!isSafeManagedPath(relativePath)) {
      conflicts.push(`invalid managed path in temple.lock: ${relativePath}`);
      continue;
    }
    const installedPath = path.join(target, relativePath);
    if (!(await pathExists(installedPath))) {
      conflicts.push(`managed file is missing: ${relativePath}`);
    } else if ((await sha256File(installedPath)) !== expectedHash) {
      conflicts.push(`managed file changed since ${lock.template.version}: ${relativePath}`);
    }
  }

  const sourceFiles = new Map();
  for (const relativePath of (await walkFiles(PROJECT_OVERLAY_ROOT)).filter(isManaged)) {
    sourceFiles.set(relativePath, path.join(PROJECT_OVERLAY_ROOT, relativePath));
  }
  const packSources = await packSourcesForLock(lock);
  conflicts.push(...packSources.conflicts);
  for (const [relativePath, sourcePath] of packSources.sources) {
    if (sourceFiles.has(relativePath)) conflicts.push(`optional pack overlaps core managed path: ${relativePath}`);
    else sourceFiles.set(relativePath, sourcePath);
  }
  const templateFiles = [...sourceFiles.keys()].sort();
  const currentManaged = new Set(templateFiles);
  for (const relativePath of templateFiles) {
    const sourcePath = sourceFiles.get(relativePath);
    const installedPath = path.join(target, relativePath);
    if (!(await pathExists(installedPath))) {
      actions.push({ type: "add-managed", path: relativePath });
    } else {
      if (!previousManaged.has(relativePath)) {
        conflicts.push(`untracked file blocks new managed path: ${relativePath}`);
      } else if (await filesEqual(sourcePath, installedPath)) {
        actions.push({ type: "skip-identical", path: relativePath });
      } else {
        actions.push({ type: "update-managed", path: relativePath });
      }
    }
  }

  for (const relativePath of previousManaged.keys()) {
    if (isSafeManagedPath(relativePath) && !currentManaged.has(relativePath)) {
      actions.push({ type: "remove-managed", path: relativePath });
    }
  }

  const tasksPath = path.join(target, ".ai-org/project/tasks.json");
  const hasTasks = await pathExists(tasksPath);
  actions.push({ type: hasTasks ? "skip-project-tasks" : "create-project-tasks", path: ".ai-org/project/tasks.json" });
  const hasLearningIndex = await pathExists(path.join(target, LEARNING_INDEX_RELATIVE_PATH));
  actions.push({
    type: hasLearningIndex ? "skip-learning-index" : "create-learning-index",
    path: LEARNING_INDEX_RELATIVE_PATH
  });
  const hasContextMap = await pathExists(path.join(target, CONTEXT_MAP_RELATIVE_PATH));
  actions.push({
    type: hasContextMap ? "skip-context-map" : "create-context-map",
    path: CONTEXT_MAP_RELATIVE_PATH
  });
  const hasSpecIndex = await pathExists(path.join(target, SPEC_INDEX_RELATIVE_PATH));
  actions.push({
    type: hasSpecIndex ? "skip-spec-index" : "create-spec-index",
    path: SPEC_INDEX_RELATIVE_PATH
  });
  const hasTrackerConfig = await pathExists(path.join(target, TRACKER_CONFIG_RELATIVE_PATH));
  actions.push({
    type: hasTrackerConfig ? "skip-tracker-config" : "create-tracker-config",
    path: TRACKER_CONFIG_RELATIVE_PATH
  });
  const hasCollaboration = await pathExists(path.join(target, COLLABORATION_RELATIVE_PATH));
  actions.push({
    type: hasCollaboration ? "skip-collaboration-state" : "create-collaboration-state",
    path: COLLABORATION_RELATIVE_PATH
  });
  const hasResourceRegistry = await pathExists(path.join(target, RESOURCE_REGISTRY_RELATIVE_PATH));
  actions.push({
    type: hasResourceRegistry ? "skip-resource-registry" : "create-resource-registry",
    path: RESOURCE_REGISTRY_RELATIVE_PATH
  });
  const hasWorkerRegistry = await pathExists(path.join(target, RUNTIME_WORKER_REGISTRY_RELATIVE_PATH));
  actions.push({
    type: hasWorkerRegistry ? "skip-runtime-worker-registry" : "create-runtime-worker-registry",
    path: RUNTIME_WORKER_REGISTRY_RELATIVE_PATH
  });
  const hasEvidenceRegistry = await pathExists(path.join(target, EVIDENCE_REGISTRY_RELATIVE_PATH));
  actions.push({
    type: hasEvidenceRegistry ? "skip-evidence-registry" : "create-evidence-registry",
    path: EVIDENCE_REGISTRY_RELATIVE_PATH
  });
  const hasRetrievalConfig = await pathExists(path.join(target, RETRIEVAL_CONFIG_RELATIVE_PATH));
  actions.push({
    type: hasRetrievalConfig ? "skip-retrieval-config" : "create-retrieval-config",
    path: RETRIEVAL_CONFIG_RELATIVE_PATH
  });
  const hasControlPlaneConfig = await pathExists(path.join(target, CONTROL_PLANE_CONFIG_RELATIVE_PATH));
  actions.push({
    type: hasControlPlaneConfig ? "skip-control-plane-config" : "create-control-plane-config",
    path: CONTROL_PLANE_CONFIG_RELATIVE_PATH
  });
  const hasFederationRegistry = await pathExists(path.join(target, FEDERATION_REGISTRY_RELATIVE_PATH));
  actions.push({
    type: hasFederationRegistry ? "skip-federation-registry" : "create-federation-registry",
    path: FEDERATION_REGISTRY_RELATIVE_PATH
  });
  const hasUsagePolicy = await pathExists(path.join(target, USAGE_POLICY_RELATIVE_PATH));
  actions.push({
    type: hasUsagePolicy ? "skip-usage-policy" : "create-usage-policy",
    path: USAGE_POLICY_RELATIVE_PATH
  });
  const hasExecutionPolicy = await pathExists(path.join(target, EXECUTION_POLICY_RELATIVE_PATH));
  actions.push({
    type: hasExecutionPolicy ? "skip-execution-policy" : "create-execution-policy",
    path: EXECUTION_POLICY_RELATIVE_PATH
  });
  const hasEvidenceProfiles = await pathExists(path.join(target, EVIDENCE_PROFILES_RELATIVE_PATH));
  actions.push({
    type: hasEvidenceProfiles ? "skip-evidence-profiles" : "create-evidence-profiles",
    path: EVIDENCE_PROFILES_RELATIVE_PATH
  });
  const assignmentMigration = await planUiAssignmentMigration(target, conflicts);
  actions.push({
    type: assignmentMigration ? "add-ui-assignment" : "skip-ui-assignment",
    path: ".ai-org/project/assignments.json"
  });
  let collaborationSync = null;
  if (hasCollaboration) {
    try {
      const collaborationPath = path.join(target, COLLABORATION_RELATIVE_PATH);
      const assignmentsPath = path.join(target, ".ai-org/project/assignments.json");
      const [before, collaborationDocument, assignmentsDocument] = await Promise.all([
        fs.readFile(collaborationPath),
        readJson(collaborationPath),
        readJson(assignmentsPath)
      ]);
      const plannedAssignments = assignmentMigration
        ? {
            ...assignmentsDocument,
            assignments: [
              ...assignmentsDocument.assignments,
              { position_id: "ui_designer", agent_id: assignmentMigration.agentId, active: true }
            ]
          }
        : assignmentsDocument;
      const expected = synchronizeDefaultMembershipDocument(collaborationDocument, plannedAssignments);
      if (JSON.stringify(expected) !== JSON.stringify(collaborationDocument)) {
        collaborationSync = { beforeHash: sha256(before), expected };
      }
    } catch (error) {
      conflicts.push(`Cannot plan collaboration default-membership synchronization: ${error.message}`);
    }
  }
  actions.push({
    type: collaborationSync ? "sync-collaboration-defaults" : "skip-collaboration-defaults",
    path: COLLABORATION_RELATIVE_PATH
  });
  const managedChanges = actions.some((action) =>
    ["add-managed", "update-managed", "remove-managed"].includes(action.type)
  );
  const packMetadataChanges = packSources.definitions.some(
    ({ definition, installed }) =>
      definition.manifest.version !== installed.version ||
      Object.entries(packLockMetadata(definition.manifest)).some(
        ([key, value]) => JSON.stringify(installed[key]) !== JSON.stringify(value)
      )
  );
  const capabilityChanges =
    lock.capabilities?.engineering_learning !== true ||
    lock.capabilities?.ui_delivery_modes !== true ||
    lock.capabilities?.product_specifications !== true ||
    lock.capabilities?.external_spec_sources !== true ||
    lock.capabilities?.work_item_spec_refs !== true ||
    lock.capabilities?.work_item_specification_modes !== true ||
    lock.capabilities?.specification_source_integrity !== true ||
    lock.capabilities?.ui_delivery_mode_overrides !== true ||
    lock.capabilities?.ui_evidence_gates !== true ||
    lock.capabilities?.iterative_delivery_contract !== true ||
    lock.capabilities?.tracker_contract !== true ||
    lock.capabilities?.tracker_field_ownership !== true ||
    lock.capabilities?.work_item_tracker_links !== true ||
    lock.capabilities?.tracker_observations !== true ||
    lock.capabilities?.tracker_reconciliation !== true ||
    lock.capabilities?.github_tracker_adapter !== true ||
    lock.capabilities?.progressive_context_routing !== true ||
    lock.capabilities?.capability_registry !== true ||
    lock.capabilities?.retrieval_provider_contract !== true;
  const collaborationCapabilityChanges =
    lock.capabilities?.collaboration_profiles !== true ||
    lock.capabilities?.human_principals !== true ||
    lock.capabilities?.position_memberships !== true ||
    lock.capabilities?.work_item_claims !== true ||
    lock.capabilities?.parallel_readiness !== true ||
    lock.capabilities?.group_parallel_planning !== true ||
    lock.capabilities?.parallel_dispatch_manifest !== true ||
    lock.capabilities?.parallel_plan_freshness !== true ||
    lock.capabilities?.parallel_join_gate !== true ||
    lock.capabilities?.version_pinned_cli_bootstrap !== true ||
    lock.capabilities?.atomic_worker_preparation !== true ||
    lock.capabilities?.runtime_worker_registry !== true ||
    lock.capabilities?.stage_execution_requirements !== true ||
    lock.capabilities?.shared_resource_coordination !== true ||
    lock.capabilities?.normalized_evidence_registry !== true ||
    lock.capabilities?.local_evidence_adapters !== true ||
    lock.capabilities?.observer_projection !== true ||
    lock.capabilities?.read_only_overview !== true ||
    lock.capabilities?.pack_manifest_v2 !== true ||
    lock.capabilities?.runtime_json_schema !== true ||
    lock.capabilities?.migration_registry !== true ||
    lock.capabilities?.learning_cli !== true ||
    lock.capabilities?.learning_revalidation !== true ||
    lock.capabilities?.retrieval_evaluation !== true ||
    lock.capabilities?.local_hybrid_provider_contract !== true ||
    lock.capabilities?.archify_adapter !== true ||
    lock.capabilities?.high_assurance_profile !== true ||
    lock.capabilities?.control_plane_config !== true ||
    lock.capabilities?.telemetry_event_envelope !== true ||
    lock.capabilities?.local_telemetry_journal !== true ||
    lock.capabilities?.provider_capability_contract !== true ||
    lock.capabilities?.repository_telemetry_provider !== true ||
    lock.capabilities?.fixture_telemetry_provider !== true ||
    lock.capabilities?.control_plane_http_sse !== true ||
    lock.capabilities?.live_observer !== true ||
    lock.capabilities?.codex_app_server_adapter !== true ||
    lock.capabilities?.control_plane_conditions !== true ||
    lock.capabilities?.human_inbox !== true ||
    lock.capabilities?.inbox_command_gateway !== true ||
    lock.capabilities?.github_pr_checks_provider !== true ||
    lock.capabilities?.github_evidence_capture !== true ||
    lock.capabilities?.versioned_project_backup !== true ||
    lock.capabilities?.backup_integrity_verification !== true ||
    lock.capabilities?.restore_preview !== true ||
    lock.capabilities?.transactional_restore_recovery !== true ||
    lock.capabilities?.adversarial_policy_catalog !== true ||
    lock.capabilities?.policy_evaluation_scorecard !== true ||
    lock.capabilities?.usage_attribution !== true ||
    lock.capabilities?.usage_baseline_report !== true ||
    lock.capabilities?.usage_telemetry_preflight !== true ||
    lock.capabilities?.codex_account_usage_probe !== true ||
    lock.capabilities?.backup_retention !== true ||
    lock.capabilities?.redacted_audit_export !== true ||
    lock.capabilities?.usage_qualification !== true ||
    lock.capabilities?.progressive_usage_calibration !== true ||
    lock.capabilities?.matched_model_advisory !== true ||
    lock.capabilities?.read_only_model_onboarding !== true ||
    lock.capabilities?.exception_only_autonomy !== true ||
    lock.capabilities?.provider_attach_outcomes !== true ||
    lock.capabilities?.repository_federation !== true ||
    lock.capabilities?.read_only_portfolio !== true ||
    lock.capabilities?.auditable_self_hosting !== true ||
    lock.capabilities?.evidence_profiles !== true ||
    lock.capabilities?.publication_audit !== true;
  if (packMetadataChanges) actions.push({ type: "update-pack-metadata", path: "temple.lock" });
  if (capabilityChanges || collaborationCapabilityChanges) actions.push({ type: "update-capabilities", path: "temple.lock" });
  if (migrationPlan.pending.length > 0) actions.push({ type: "record-migrations", path: "temple.lock" });
  actions.push({
    type:
      lock.template.version === TEMPLATE_VERSION &&
      !managedChanges &&
      !packMetadataChanges &&
      !capabilityChanges &&
      !collaborationCapabilityChanges &&
      !assignmentMigration &&
      !collaborationSync &&
      hasTasks &&
      hasLearningIndex &&
      hasContextMap &&
      hasSpecIndex &&
      hasTrackerConfig &&
      hasCollaboration &&
      hasResourceRegistry &&
      hasWorkerRegistry &&
      hasEvidenceRegistry &&
      hasRetrievalConfig &&
      hasControlPlaneConfig &&
      hasFederationRegistry &&
      hasUsagePolicy &&
      hasEvidenceProfiles &&
      migrationPlan.pending.length === 0
        ? "skip-current-lock"
        : "update-lock",
    path: "temple.lock"
  });

  return {
    target,
    lock,
    fromVersion: lock.template.version,
    toVersion: TEMPLATE_VERSION,
    templateFiles,
    sourceFiles,
    packDefinitions: packSources.definitions,
    assignmentMigration,
    collaborationSync,
    migrationPlan,
    actions,
    conflicts
  };
}

export async function executeUpgrade(plan) {
  if (plan.conflicts.length > 0) {
    throw new Error(`Upgrade stopped before writing:\n- ${plan.conflicts.join("\n- ")}`);
  }

  const changes = [];
  try {
    for (const action of plan.actions) {
      const installedPath = path.join(plan.target, action.path);
      if (action.type === "remove-managed") {
        const expectedHash = (plan.lock.managed_files ?? []).find((entry) => entry.path === action.path)?.sha256;
        if (!expectedHash || (await sha256File(installedPath)) !== expectedHash) {
          throw new Error(`Managed file changed before removal: ${action.path}`);
        }
        const before = await fs.readFile(installedPath);
        await fs.unlink(installedPath);
        changes.push({ path: installedPath, before, afterHash: null });
        continue;
      }
      if (!["add-managed", "update-managed"].includes(action.type)) continue;
      const sourcePath = plan.sourceFiles.get(action.path);
      const sourceContent = await fs.readFile(sourcePath);
      if (action.type === "add-managed") {
        await atomicCreate(installedPath, sourceContent);
        changes.push({ path: installedPath, before: null, afterHash: sha256(sourceContent) });
      } else {
        const expectedHash = (plan.lock.managed_files ?? []).find((entry) => entry.path === action.path)?.sha256;
        if (!expectedHash || (await sha256File(installedPath)) !== expectedHash) {
          throw new Error(`Managed file changed before update: ${action.path}`);
        }
        const before = await fs.readFile(installedPath);
        await atomicWrite(installedPath, sourceContent);
        changes.push({ path: installedPath, before, afterHash: sha256(sourceContent) });
      }
    }

    const taskRegistry = await ensureTaskRegistry(plan.target);
    if (taskRegistry.created) {
      changes.push({ path: taskRegistry.path, before: null, afterHash: taskRegistry.afterHash });
    }
    const learningIndex = await ensureLearningIndex(plan.target);
    if (learningIndex.created) {
      changes.push({ path: learningIndex.path, before: null, afterHash: learningIndex.afterHash });
    }
    const contextMap = await ensureContextMap(plan.target);
    if (contextMap.created) {
      changes.push({ path: contextMap.path, before: null, afterHash: contextMap.afterHash });
    }
    const specIndex = await ensureSpecIndex(plan.target);
    if (specIndex.created) {
      changes.push({ path: specIndex.path, before: null, afterHash: specIndex.afterHash });
    }
    const trackerConfig = await ensureTrackerConfig(plan.target);
    if (trackerConfig.created) {
      changes.push({ path: trackerConfig.path, before: null, afterHash: trackerConfig.afterHash });
    }
    const resourceRegistry = await ensureResourceRegistry(plan.target);
    if (resourceRegistry.created) {
      changes.push({ path: resourceRegistry.path, before: null, afterHash: resourceRegistry.afterHash });
    }
    const workerRegistry = await ensureRuntimeWorkerRegistry(plan.target);
    if (workerRegistry.created) {
      changes.push({ path: workerRegistry.path, before: null, afterHash: workerRegistry.afterHash });
    }
    const evidenceRegistry = await ensureEvidenceRegistry(plan.target);
    if (evidenceRegistry.created) {
      changes.push({ path: evidenceRegistry.path, before: null, afterHash: evidenceRegistry.afterHash });
    }
    const retrievalConfig = await ensureRetrievalConfig(plan.target);
    if (retrievalConfig.created) {
      changes.push({ path: retrievalConfig.path, before: null, afterHash: retrievalConfig.afterHash });
    }
    const controlPlaneConfig = await ensureControlPlaneConfig(plan.target);
    if (controlPlaneConfig.created) {
      changes.push({ path: controlPlaneConfig.path, before: null, afterHash: controlPlaneConfig.afterHash });
    }
    const federationRegistry = await ensureFederationRegistry(plan.target);
    if (federationRegistry.created) {
      changes.push({ path: federationRegistry.path, before: null, afterHash: federationRegistry.afterHash });
    }
    const usagePolicy = await ensureUsagePolicy(plan.target);
    if (usagePolicy.created) {
      changes.push({ path: usagePolicy.path, before: null, afterHash: usagePolicy.afterHash });
    }
    const executionPolicy = await ensureExecutionPolicy(plan.target);
    if (executionPolicy.created) {
      changes.push({ path: executionPolicy.path, before: null, afterHash: executionPolicy.afterHash });
    }
    const evidenceProfiles = await ensureEvidenceProfiles(plan.target);
    if (evidenceProfiles.created) {
      changes.push({ path: evidenceProfiles.path, before: null, afterHash: evidenceProfiles.afterHash });
    }
    const repositoryIntegration = await ensureRepositoryIntegration(plan.target);
    if (repositoryIntegration.created) {
      changes.push({ path: repositoryIntegration.path, before: null, afterHash: repositoryIntegration.afterHash });
    }
    if (plan.assignmentMigration) {
      const assignmentsPath = path.join(plan.target, plan.assignmentMigration.path);
      const before = await fs.readFile(assignmentsPath);
      if (sha256(before) !== plan.assignmentMigration.beforeHash) {
        throw new Error("assignments.json changed after upgrade planning");
      }
      const assignmentsDocument = JSON.parse(before.toString("utf8"));
      const activeUiAssignments = assignmentsDocument.assignments.filter(
        (assignment) => assignment.active !== false && assignment.position_id === "ui_designer"
      );
      if (activeUiAssignments.length > 0) throw new Error("UI Designer assignment appeared after upgrade planning");
      const content = formatJson({
        ...assignmentsDocument,
        assignments: [
          ...assignmentsDocument.assignments,
          { position_id: "ui_designer", agent_id: plan.assignmentMigration.agentId, active: true }
        ].sort((left, right) => left.position_id.localeCompare(right.position_id))
      });
      await atomicWrite(assignmentsPath, content);
      changes.push({ path: assignmentsPath, before, afterHash: sha256(content) });
    }
    const collaboration = await ensureCollaborationState(plan.target);
    if (collaboration.created) {
      changes.push({ path: collaboration.path, before: null, afterHash: collaboration.afterHash });
    } else if (plan.collaborationSync) {
      const collaborationPath = path.join(plan.target, COLLABORATION_RELATIVE_PATH);
      const before = await fs.readFile(collaborationPath);
      if (sha256(before) !== plan.collaborationSync.beforeHash) {
        throw new Error("collaboration.json changed after upgrade planning");
      }
      const content = formatJson(plan.collaborationSync.expected);
      await atomicWrite(collaborationPath, content);
      changes.push({ path: collaborationPath, before, afterHash: sha256(content) });
    }

    if (!plan.actions.some((action) => action.type === "update-lock")) return plan.lock;

    const managedFiles = [];
    for (const relativePath of plan.templateFiles) {
      managedFiles.push({ path: relativePath, sha256: await sha256File(path.join(plan.target, relativePath)) });
    }
    const timestamp = new Date().toISOString();
    const optionalPacks = plan.packDefinitions.map(({ definition, installed }) => ({
      id: definition.manifest.id,
      version: definition.manifest.version,
      installed_at: installed.installed_at ?? timestamp,
      ...(installed.version === definition.manifest.version
        ? {}
        : { upgraded_at: timestamp, upgraded_from: installed.version }),
      ...packLockMetadata(definition.manifest)
    }));
    const bootstrap = await buildCliBootstrapMetadata();
    const lock = {
      ...plan.lock,
      template: {
        name: PACKAGE_NAME,
        version: TEMPLATE_VERSION,
        repository: TEMPLATE_REPOSITORY,
        bootstrap,
        installed_at: plan.lock.template.installed_at,
        upgraded_at: timestamp,
        upgraded_from: plan.fromVersion
      },
      boundaries: {
        managed_files_authoritative: true,
        allowed_managed_roots: MANAGED_SOURCE_PREFIXES,
        allowed_managed_exact_paths: [...MANAGED_EXACT_PATHS],
        ownership_precedence: "exact managed_files entry, otherwise project-owned",
        project_owned: PROJECT_OWNED_PATHS,
        generated: GENERATED_PATHS
      },
      migrations: applyMigrationPlanToLock(plan.lock, plan.migrationPlan, timestamp),
      capabilities: {
        ...(plan.lock.capabilities ?? {}),
        work_item_cli: true,
        task_registry: true,
        engineering_learning: true,
        ui_delivery_modes: true,
        product_specifications: true,
        external_spec_sources: true,
        work_item_spec_refs: true,
        work_item_specification_modes: true,
        specification_source_integrity: true,
        ui_delivery_mode_overrides: true,
        ui_evidence_gates: true,
        iterative_delivery_contract: true,
        tracker_contract: true,
        tracker_field_ownership: true,
        work_item_tracker_links: true,
        tracker_observations: true,
        tracker_reconciliation: true,
        github_tracker_adapter: true,
        progressive_context_routing: true,
        capability_registry: true,
        retrieval_provider_contract: true,
        repository_integration_contract: true,
        collaboration_profiles: true,
        human_principals: true,
        position_memberships: true,
        work_item_claims: true,
        parallel_readiness: true,
        group_parallel_planning: true,
        parallel_dispatch_manifest: true,
        parallel_plan_freshness: true,
        parallel_join_gate: true,
        version_pinned_cli_bootstrap: true,
        atomic_worker_preparation: true,
        runtime_worker_registry: true,
        stage_execution_requirements: true,
        shared_resource_coordination: true,
        normalized_evidence_registry: true,
        local_evidence_adapters: true,
        observer_projection: true,
        read_only_overview: true,
        pack_manifest_v2: true,
        runtime_json_schema: true,
        migration_registry: true,
        learning_cli: true,
        learning_revalidation: true,
        retrieval_evaluation: true,
        local_hybrid_provider_contract: true,
        archify_adapter: true,
        high_assurance_profile: true,
        control_plane_config: true,
        telemetry_event_envelope: true,
        local_telemetry_journal: true,
        provider_capability_contract: true,
        repository_telemetry_provider: true,
        fixture_telemetry_provider: true,
        control_plane_http_sse: true,
        live_observer: true,
        codex_app_server_adapter: true,
        control_plane_conditions: true,
        human_inbox: true,
        inbox_command_gateway: true,
        github_pr_checks_provider: true,
        github_evidence_capture: true,
        versioned_project_backup: true,
        backup_integrity_verification: true,
        restore_preview: true,
        transactional_restore_recovery: true,
        adversarial_policy_catalog: true,
        policy_evaluation_scorecard: true,
        usage_attribution: true,
        usage_baseline_report: true,
        usage_telemetry_preflight: true,
        codex_account_usage_probe: true,
        backup_retention: true,
        redacted_audit_export: true,
        usage_qualification: true,
        progressive_usage_calibration: true,
        matched_model_advisory: true,
        adaptive_execution_routing: true,
        read_only_model_onboarding: true,
        typed_resource_observations: true,
        non_executing_route_resolution: true,
        exception_only_autonomy: true,
        provider_attach_outcomes: true,
        repository_federation: true,
        read_only_portfolio: true,
        auditable_self_hosting: true,
        evidence_profiles: true,
        publication_audit: true,
        checksum_upgrade: true,
        optional_packs: true,
        toolkit_self_hosting: true
      },
      optional_packs: optionalPacks,
      managed_files: managedFiles
    };
    if (JSON.stringify(await readJson(path.join(plan.target, "temple.lock"))) !== JSON.stringify(plan.lock)) {
      throw new Error("temple.lock changed after upgrade planning");
    }
    await atomicWrite(path.join(plan.target, "temple.lock"), formatJson(lock));
    return lock;
  } catch (error) {
    try {
      await rollbackFileChanges(changes);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Upgrade failed and rollback was incomplete");
    }
    throw error;
  }
}

export function formatUpgradePlan(plan) {
  const lines = [`Temple upgrade plan for ${plan.target}`, `- version: ${plan.fromVersion} -> ${plan.toVersion}`];
  const counts = new Map();
  for (const action of plan.actions) counts.set(action.type, (counts.get(action.type) ?? 0) + 1);
  for (const [type, count] of [...counts].sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`- ${type}: ${count}`);
  }
  if (plan.conflicts.length > 0) lines.push("Conflicts:", ...plan.conflicts.map((conflict) => `- ${conflict}`));
  return lines.join("\n");
}
