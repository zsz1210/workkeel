import fs from "node:fs/promises";
import path from "node:path";
import {
  AGENTS_MARKER_START,
  GENERATED_PATHS,
  KNOWN_PACKAGE_NAMES,
  MANAGED_EXACT_PATHS,
  MANAGED_SOURCE_PREFIXES,
  PACKAGE_NAME,
  PROJECT_OVERLAY_ROOT,
  PROJECT_OWNED_PATHS,
  REPOSITORY_ROOT,
  SELF_HOST_ADOPTABLE_MANAGED_PATHS,
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
import { buildProjectState } from "./model.mjs";
import { buildCollaborationState } from "./collaboration.mjs";
import { buildCliBootstrapMetadata } from "./bootstrap.mjs";
import { baselineMigrationState } from "./migrations.mjs";
import {
  REPOSITORY_INTEGRATION_RELATIVE_PATH,
  validateRepositoryIntegration
} from "./repository-integration.mjs";

function isManaged(relativePath) {
  return MANAGED_EXACT_PATHS.has(relativePath) || MANAGED_SOURCE_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function compareFile(leftPath, rightPath) {
  const [left, right] = await Promise.all([fs.readFile(leftPath), fs.readFile(rightPath)]);
  return left.equals(right);
}

async function sameDirectory(left, right) {
  const [resolvedLeft, resolvedRight] = await Promise.all([
    fs.realpath(left).catch(() => path.resolve(left)),
    fs.realpath(right).catch(() => path.resolve(right))
  ]);
  return resolvedLeft === resolvedRight;
}

function hasClaudeAgentsImport(content) {
  return String(content)
    .split(/\r?\n/)
    .some((line) => ["@AGENTS.md", "@./AGENTS.md"].includes(line.trim()));
}

export async function planInit(target, config, { integrateAgents = false, selfHost = false } = {}) {
  const templateFiles = await walkFiles(PROJECT_OVERLAY_ROOT);
  const actions = [];
  const conflicts = [];
  const warnings = [];
  const toolkitTarget = await sameDirectory(target, REPOSITORY_ROOT);

  if (selfHost && !toolkitTarget) {
    conflicts.push("--self-host is allowed only for the Temple toolkit repository itself");
  } else if (!selfHost && toolkitTarget) {
    conflicts.push("The Temple toolkit repository requires explicit --self-host initialization");
  }

  let existingLock = null;
  const lockPath = path.join(target, "temple.lock");
  if (await pathExists(lockPath)) {
    existingLock = await readJson(lockPath);
    if (!KNOWN_PACKAGE_NAMES.has(existingLock?.template?.name)) {
      conflicts.push("temple.lock belongs to an unknown template");
    } else if (existingLock.template.version !== TEMPLATE_VERSION) {
      conflicts.push(
        `Installed Temple version is ${existingLock.template.version}; use a future temple upgrade instead of init ${TEMPLATE_VERSION}`
      );
    }
    const installedMode = existingLock?.installation?.mode ?? "project";
    if (selfHost && installedMode !== "toolkit-self-host") {
      conflicts.push(`temple.lock installation mode is ${installedMode}, not toolkit-self-host`);
    } else if (!selfHost && installedMode === "toolkit-self-host") {
      conflicts.push("This toolkit self-host installation must be operated with --self-host");
    }
  }
  const existingManagedPaths = new Set((existingLock?.managed_files ?? []).map((entry) => entry.path));

  for (const relativePath of templateFiles) {
    if (["AGENTS.md", "CLAUDE.md"].includes(relativePath)) {
      continue;
    }
    const sourcePath = path.join(PROJECT_OVERLAY_ROOT, relativePath);
    const destinationPath = path.join(target, relativePath);
    if (!(await pathExists(destinationPath))) {
      actions.push({ type: "copy", ownership: isManaged(relativePath) ? "managed" : "project-owned", path: relativePath });
      continue;
    }

    if (isManaged(relativePath)) {
      if (!existingManagedPaths.has(relativePath)) {
        if (
          selfHost &&
          SELF_HOST_ADOPTABLE_MANAGED_PATHS.has(relativePath) &&
          (await compareFile(sourcePath, destinationPath))
        ) {
          actions.push({ type: "adopt-identical", ownership: "managed", path: relativePath });
        } else {
          conflicts.push(`untracked file blocks new managed path: ${relativePath}`);
        }
      } else if (await compareFile(sourcePath, destinationPath)) {
        actions.push({ type: "skip-identical", ownership: "managed", path: relativePath });
      } else {
        conflicts.push(`managed file has different content: ${relativePath}`);
      }
    } else {
      actions.push({ type: "skip-existing", ownership: "project-owned", path: relativePath });
    }
  }

  let initializedAt = new Date().toISOString();
  const existingProjectPath = path.join(target, ".ai-org/project/project.json");
  if (await pathExists(existingProjectPath)) {
    const existingProject = await readJson(existingProjectPath);
    initializedAt = existingProject.initialized_at ?? initializedAt;
  }
  const state = buildProjectState(config, initializedAt);
  state.collaboration = buildCollaborationState(state.assignments);

  const stateFiles = [
    [".ai-org/project/project.json", state.project],
    [".ai-org/project/agents.json", state.agents],
    [".ai-org/project/assignments.json", state.assignments]
  ];
  for (const [relativePath, expected] of stateFiles) {
    const destinationPath = path.join(target, relativePath);
    if (!(await pathExists(destinationPath))) {
      actions.push({ type: "write", ownership: "project-owned", path: relativePath });
      continue;
    }
    const actual = await readJson(destinationPath);
    if (sameJson(actual, expected)) {
      actions.push({ type: "skip-identical", ownership: "project-owned", path: relativePath });
    } else {
      conflicts.push(`project state differs from init config: ${relativePath}`);
    }
  }

  const collaborationPath = path.join(target, ".ai-org/project/collaboration.json");
  actions.push({
    type: (await pathExists(collaborationPath)) ? "skip-existing" : "write",
    ownership: "project-owned",
    path: ".ai-org/project/collaboration.json"
  });

  const repositoryIntegrationPath = path.join(target, REPOSITORY_INTEGRATION_RELATIVE_PATH);
  if (!(await pathExists(repositoryIntegrationPath))) {
    actions.push({ type: "write", ownership: "project-owned", path: REPOSITORY_INTEGRATION_RELATIVE_PATH });
  } else {
    const repositoryIntegration = await readJson(repositoryIntegrationPath);
    const validation = validateRepositoryIntegration(repositoryIntegration);
    if (!validation.valid) {
      conflicts.push(`project repository integration is invalid: ${validation.errors.join("; ")}`);
    } else {
      actions.push({ type: "skip-existing", ownership: "project-owned", path: REPOSITORY_INTEGRATION_RELATIVE_PATH });
    }
  }

  const tasksPath = path.join(target, ".ai-org/project/tasks.json");
  if (!(await pathExists(tasksPath))) {
    actions.push({ type: "write", ownership: "project-owned", path: ".ai-org/project/tasks.json" });
  } else {
    const tasks = await readJson(tasksPath);
    if (tasks.schema_version !== "temple.tasks/v1" || !Array.isArray(tasks.tasks)) {
      conflicts.push("project task registry is invalid: .ai-org/project/tasks.json");
    } else {
      actions.push({ type: "skip-existing", ownership: "project-owned", path: ".ai-org/project/tasks.json" });
    }
  }

  const eventsPath = path.join(target, ".ai-org/events/events.jsonl");
  if (await pathExists(eventsPath)) {
    actions.push({ type: "skip-existing", ownership: "project-owned", path: ".ai-org/events/events.jsonl" });
  } else {
    actions.push({ type: "write-empty", ownership: "project-owned", path: ".ai-org/events/events.jsonl" });
  }

  const sourceAgentsPath = path.join(PROJECT_OVERLAY_ROOT, "AGENTS.md");
  const targetAgentsPath = path.join(target, "AGENTS.md");
  let agentsIntegration = "installed";
  if (!(await pathExists(targetAgentsPath))) {
    actions.push({ type: "copy-agents", ownership: "project-owned", path: "AGENTS.md" });
  } else {
    const existingAgents = await fs.readFile(targetAgentsPath, "utf8");
    if (existingAgents.includes(AGENTS_MARKER_START)) {
      agentsIntegration = "present";
      actions.push({ type: "skip-integrated", ownership: "project-owned", path: "AGENTS.md" });
    } else if (integrateAgents) {
      agentsIntegration = "appended";
      actions.push({ type: "append-agents", ownership: "project-owned", path: "AGENTS.md" });
    } else {
      agentsIntegration = "pending_merge";
      const snippetPath = path.join(target, ".ai-org/project/AGENTS.temple.md");
      if (!(await pathExists(snippetPath))) {
        actions.push({ type: "copy-agents-snippet", ownership: "project-owned", path: ".ai-org/project/AGENTS.temple.md" });
      } else if (await compareFile(sourceAgentsPath, snippetPath)) {
        actions.push({ type: "skip-identical", ownership: "project-owned", path: ".ai-org/project/AGENTS.temple.md" });
      } else {
        warnings.push("Existing .ai-org/project/AGENTS.temple.md differs; it will not be overwritten");
      }
      warnings.push("Existing AGENTS.md was preserved; AI organization instructions still need an approved merge");
    }
  }

  const sourceClaudePath = path.join(PROJECT_OVERLAY_ROOT, "CLAUDE.md");
  const targetClaudePath = path.join(target, "CLAUDE.md");
  let claudeIntegration = "installed";
  if (!(await pathExists(targetClaudePath))) {
    actions.push({ type: "copy-claude", ownership: "project-owned", path: "CLAUDE.md" });
  } else {
    const existingClaude = await fs.readFile(targetClaudePath, "utf8");
    if (hasClaudeAgentsImport(existingClaude)) {
      claudeIntegration = "present";
      actions.push({ type: "skip-integrated", ownership: "project-owned", path: "CLAUDE.md" });
    } else {
      claudeIntegration = "pending_merge";
      const snippetPath = path.join(target, ".ai-org/project/CLAUDE.temple.md");
      if (!(await pathExists(snippetPath))) {
        actions.push({
          type: "copy-claude-snippet",
          ownership: "project-owned",
          path: ".ai-org/project/CLAUDE.temple.md"
        });
      } else if (await compareFile(sourceClaudePath, snippetPath)) {
        actions.push({
          type: "skip-identical",
          ownership: "project-owned",
          path: ".ai-org/project/CLAUDE.temple.md"
        });
      } else {
        warnings.push("Existing .ai-org/project/CLAUDE.temple.md differs; it will not be overwritten");
      }
      warnings.push("Existing CLAUDE.md was preserved; the @AGENTS.md import still needs an approved merge");
    }
  }

  if (existingLock?.project_id && existingLock.project_id !== config.project.id) {
    conflicts.push(`temple.lock belongs to project ${existingLock.project_id}, not ${config.project.id}`);
  }

  actions.push({ type: existingLock ? "update-lock" : "write-lock", ownership: "system", path: "temple.lock" });

  return {
    target,
    config,
    state,
    templateFiles,
    actions,
    conflicts,
    warnings,
    agentsIntegration,
    claudeIntegration,
    existingLock,
    selfHost
  };
}

export async function executeInit(plan) {
  if (plan.conflicts.length > 0) {
    throw new Error(`Initialization stopped before writing:\n- ${plan.conflicts.join("\n- ")}`);
  }

  await fs.mkdir(plan.target, { recursive: true });
  const changes = [];
  try {
    for (const action of plan.actions) {
      const destinationPath = path.join(plan.target, action.path);
      let before = null;
      let content = null;
      if (action.type === "copy") {
        content = await fs.readFile(path.join(PROJECT_OVERLAY_ROOT, action.path));
      } else if (action.type === "write") {
        const stateByPath = {
          ".ai-org/project/project.json": plan.state.project,
          ".ai-org/project/agents.json": plan.state.agents,
          ".ai-org/project/assignments.json": plan.state.assignments,
          ".ai-org/project/collaboration.json": plan.state.collaboration,
          ".ai-org/project/tasks.json": plan.state.tasks,
          [REPOSITORY_INTEGRATION_RELATIVE_PATH]: plan.state.repositoryIntegration
        };
        content = formatJson(stateByPath[action.path]);
      } else if (action.type === "write-empty") {
        content = "";
      } else if (action.type === "copy-agents" || action.type === "copy-agents-snippet") {
        content = await fs.readFile(path.join(PROJECT_OVERLAY_ROOT, "AGENTS.md"));
      } else if (action.type === "copy-claude" || action.type === "copy-claude-snippet") {
        content = await fs.readFile(path.join(PROJECT_OVERLAY_ROOT, "CLAUDE.md"));
      } else if (action.type === "append-agents") {
        before = await fs.readFile(destinationPath);
        const templeBlock = (await fs.readFile(path.join(PROJECT_OVERLAY_ROOT, "AGENTS.md"), "utf8")).trim();
        content = `${before.toString("utf8").trimEnd()}\n\n${templeBlock}\n`;
      }
      if (content === null) continue;
      if (before === null) await atomicCreate(destinationPath, content);
      else await atomicWrite(destinationPath, content);
      changes.push({ path: destinationPath, before, afterHash: sha256(content) });
    }

    const managedFiles = [];
    for (const relativePath of plan.templateFiles.filter(isManaged)) {
      managedFiles.push({
        path: relativePath,
        sha256: await sha256File(path.join(plan.target, relativePath))
      });
    }
    const optionalManagedPaths = new Set(
      (plan.existingLock?.optional_packs ?? []).flatMap((pack) => pack.managed_files ?? [])
    );
    for (const entry of plan.existingLock?.managed_files ?? []) {
      if (optionalManagedPaths.has(entry.path)) managedFiles.push(entry);
    }
    managedFiles.sort((left, right) => left.path.localeCompare(right.path));

    const bootstrap = await buildCliBootstrapMetadata();
    const installedAt = plan.existingLock?.template?.installed_at ?? new Date().toISOString();
    const migrations = plan.existingLock?.migrations ?? await baselineMigrationState(installedAt);
    const lock = {
      schema_version: "temple.lock/v1",
      template: {
        name: PACKAGE_NAME,
        version: TEMPLATE_VERSION,
        repository: TEMPLATE_REPOSITORY,
        bootstrap,
        installed_at: installedAt
      },
      installation: plan.selfHost
        ? (() => {
            const adoptedManagedFiles = new Set([
              ...(plan.existingLock?.installation?.adopted_managed_files ?? []),
              ...plan.actions
                .filter((action) => action.type === "adopt-identical")
                .map((action) => action.path)
            ]);
            return {
              mode: "toolkit-self-host",
              source_overlay: "project-overlay",
              adopted_managed_files: [...adoptedManagedFiles].sort()
            };
          })()
        : { mode: "project" },
      project_id: plan.config.project.id,
      migrations,
      boundaries: {
        managed_files_authoritative: true,
        allowed_managed_roots: MANAGED_SOURCE_PREFIXES,
        allowed_managed_exact_paths: [...MANAGED_EXACT_PATHS],
        ownership_precedence: "exact managed_files entry, otherwise project-owned",
        project_owned: PROJECT_OWNED_PATHS,
        generated: GENERATED_PATHS
      },
      integrations: {
        agents_md: plan.agentsIntegration,
        claude_md: plan.claudeIntegration,
        archify: {
          status: "available_not_enabled",
          pinned_tag: "v2.16.0",
          pinned_commit: "c826e6c3a7abad19c0f3cd1ca57207d54b1ad8de",
          downstream_patch_ids: ["fast-uri-3.1.7-security-override"]
        }
      },
      capabilities: {
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
      optional_packs: plan.existingLock?.optional_packs ?? [],
      managed_files: managedFiles
    };

    const lockPath = path.join(plan.target, "temple.lock");
    if (plan.existingLock) {
      if (!sameJson(await readJson(lockPath), plan.existingLock)) {
        throw new Error("temple.lock changed after initialization planning");
      }
      await atomicWrite(lockPath, formatJson(lock));
    } else await atomicCreate(lockPath, formatJson(lock));
    return { lock, actions: plan.actions, warnings: plan.warnings };
  } catch (error) {
    try {
      await rollbackFileChanges(changes);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Initialization failed and rollback was incomplete");
    }
    throw error;
  }
}

export function formatInitPlan(plan) {
  const lines = [`Temple init plan for ${plan.target}`];
  const counts = new Map();
  for (const action of plan.actions) {
    counts.set(action.type, (counts.get(action.type) ?? 0) + 1);
  }
  for (const [type, count] of [...counts].sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`- ${type}: ${count}`);
  }
  if (plan.conflicts.length > 0) {
    lines.push("Conflicts:", ...plan.conflicts.map((conflict) => `- ${conflict}`));
  }
  if (plan.warnings.length > 0) {
    lines.push("Warnings:", ...plan.warnings.map((warning) => `- ${warning}`));
  }
  lines.push(`AGENTS.md integration: ${plan.agentsIntegration}`);
  lines.push(`Claude Code entrypoint integration: ${plan.claudeIntegration}`);
  lines.push(`Repository integration: ${plan.state.repositoryIntegration.status}`);
  lines.push(`Installation mode: ${plan.selfHost ? "toolkit-self-host" : "project"}`);
  return lines.join("\n");
}
