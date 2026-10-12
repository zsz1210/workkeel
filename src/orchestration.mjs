import path from "node:path";
import { atomicWrite, formatJson, pathExists, readJson, sha256, sha256File } from "./files.mjs";
import { loadProjectContext, positionName, suggestedTaskTitle } from "./project.mjs";
import { activeExecutionRequirements, evaluateParallelReadiness, listWorkItemDocuments, readWorkItem } from "./work-items.mjs";
import { readResourceRegistry } from "./resources.mjs";
import { lifecycleProjection } from "./workflow.mjs";

export const PARALLEL_PLAN_RELATIVE_PATH = ".ai-org/views/parallel-plan.json";
export const PARALLEL_PLAN_SCHEMA = "temple.parallel-plan/v1";

const HARD_BLOCKING_CHECKS = new Set([
  "dependency_graph_acyclic",
  "shared_contract_stable",
  "unresolved_items_cleared",
  "specification_references_current",
  "specification_contract_ready",
  "specification_references_approved"
]);

function uniqueStrings(values) {
  return [...new Set((values ?? []).filter((value) => typeof value === "string" && value.length > 0))];
}

export function dispatchPreparationFingerprint(item, readiness, context, resourceRegistry) {
  return sha256(
    JSON.stringify({
      schema_version: "temple.dispatch-preparation/v1",
      work_item: item,
      active_requirements: readiness.active_requirements,
      readiness_checks: readiness.checks,
      specification_references: readiness.specification_references,
      template: context.lock.template,
      agents: context.agentsDocument,
      assignments: context.assignmentsDocument,
      workflow: context.workflow,
      policies: context.policies,
      shared_resource_definitions: [...(resourceRegistry.resources ?? [])].sort((left, right) =>
        left.id.localeCompare(right.id)
      )
    })
  );
}

function overlapStem(value) {
  return String(value ?? "").split("*")[0].replace(/\/+$/, "");
}

function pathsOverlap(left, right) {
  const leftStem = overlapStem(left);
  const rightStem = overlapStem(right);
  if (!leftStem || !rightStem) return false;
  return leftStem === rightStem || leftStem.startsWith(`${rightStem}/`) || rightStem.startsWith(`${leftStem}/`);
}

function overlapResolutionNamesWorkItem(item, workItemId) {
  return (item.overlap_resolution ?? []).some((entry) =>
    String(entry)
      .split(/[^A-Za-z0-9-]+/)
      .includes(workItemId)
  );
}

function overlapDetails(left, right) {
  const paths = [];
  for (const leftPath of left.affected_paths ?? []) {
    for (const rightPath of right.affected_paths ?? []) {
      if (pathsOverlap(leftPath, rightPath)) paths.push({ left_path: leftPath, right_path: rightPath });
    }
  }
  return paths;
}

function overlapIsBidirectionallyResolved(left, right) {
  return overlapResolutionNamesWorkItem(left, right.id) && overlapResolutionNamesWorkItem(right, left.id);
}

function descendantsOf(parentId, itemsById) {
  const selected = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of itemsById.values()) {
      if (item.id === parentId || selected.has(item.id)) continue;
      if (item.parent_work_item_id === parentId || selected.has(item.parent_work_item_id)) {
        selected.add(item.id);
        changed = true;
      }
    }
  }
  return selected;
}

function ancestorsOf(item, itemsById) {
  const ancestors = new Set();
  let current = item;
  while (current?.parent_work_item_id && !ancestors.has(current.parent_work_item_id)) {
    ancestors.add(current.parent_work_item_id);
    current = itemsById.get(current.parent_work_item_id);
  }
  return ancestors;
}

function canonicalSourceProjection(items, collaboration, assignments, agents, workflow, policies, lock, specIndex, sourceDigests, resources) {
  return {
    work_items: [...items].sort((left, right) => left.id.localeCompare(right.id)),
    collaboration,
    assignments,
    agents,
    workflow,
    policies,
    template: lock.template,
    specification_index: specIndex,
    specification_source_digests: sourceDigests,
    shared_resources: resources
  };
}

async function specificationSourceDigests(target, specIndex) {
  const digests = [];
  for (const entry of [...(specIndex.entries ?? [])].sort((left, right) => left.id.localeCompare(right.id))) {
    if (entry?.source?.kind !== "repository") continue;
    const relativePath = entry.source.location;
    if (
      typeof relativePath !== "string" ||
      path.isAbsolute(relativePath) ||
      path.win32.isAbsolute(relativePath) ||
      relativePath.includes("\\") ||
      path.posix.normalize(relativePath) !== relativePath ||
      relativePath === ".." ||
      relativePath.startsWith("../")
    ) {
      digests.push({ id: entry.id, path: relativePath, sha256: null });
      continue;
    }
    const absolutePath = path.join(target, relativePath);
    digests.push({
      id: entry.id,
      path: relativePath,
      sha256: (await pathExists(absolutePath)) ? await sha256File(absolutePath) : null
    });
  }
  return digests;
}

export async function parallelPlanSourceFingerprint(target) {
  const [items, collaboration, assignments, agents, workflow, policies, lock, specIndex, resources] = await Promise.all([
    listWorkItemDocuments(target),
    readJson(path.join(target, ".ai-org/project/collaboration.json")),
    readJson(path.join(target, ".ai-org/project/assignments.json")),
    readJson(path.join(target, ".ai-org/project/agents.json")),
    readJson(path.join(target, ".ai-org/core/workflow.json")),
    readJson(path.join(target, ".ai-org/core/policies.json")),
    readJson(path.join(target, "temple.lock")),
    readJson(path.join(target, ".ai-org/project/spec-index.json")),
    readResourceRegistry(target)
  ]);
  const sourceDigests = await specificationSourceDigests(target, specIndex);
  return sha256(
    JSON.stringify(
      canonicalSourceProjection(items, collaboration, assignments, agents, workflow, policies, lock, specIndex, sourceDigests, resources)
    )
  );
}

function dispatchManifest(context, item, readiness, resourceRegistry) {
  const agent = context.agents.get(readiness.agent_id);
  return {
    work_item_id: item.id,
    title: item.title,
    position_id: item.owner_position,
    agent_id: readiness.agent_id,
    agent_name: agent?.display_name ?? readiness.agent_id,
    suggested_task_title: suggestedTaskTitle(
      context,
      item.id,
      item.owner_position,
      item.title,
      agent?.display_name ?? readiness.agent_id
    ),
    base_revision: item.base_revision,
    affected_paths: item.affected_paths ?? [],
    dependencies: item.dependencies ?? [],
    required_disciplines: readiness.active_requirements.disciplines,
    active_requirements: readiness.active_requirements,
    preparation_fingerprint: dispatchPreparationFingerprint(item, readiness, context, resourceRegistry),
    integration_owner_agent_id: item.integration_owner_agent_id,
    context_command: `node ./templew.mjs context resolve . --work-item ${item.id} --position ${item.owner_position} --no-write --json`,
    claim_required_before_work: true,
    task_registration_required_after_creation: true,
    task_creation_performed: false,
    claim_performed: false,
    external_action_performed: false
  };
}

function disposition(item, readiness, reasons, kind) {
  return {
    work_item_id: item.id,
    title: item.title,
    disposition: kind,
    position_id: item.owner_position,
    agent_id: readiness.agent_id,
    integration_owner_agent_id: item.integration_owner_agent_id ?? null,
    reasons: uniqueStrings(reasons)
  };
}

function activeDisposition(item, readiness) {
  return {
    ...disposition(item, readiness, [], "active"),
    claim_id: item.claim.id,
    principal_id: item.claim.principal_id,
    branch: item.claim.branch,
    worktree: item.claim.worktree ?? null,
    base_revision: item.claim.base_revision
  };
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function arrayOfObjects(value) {
  return Array.isArray(value) && value.every(isObject);
}

export function validateParallelPlan(document) {
  const errors = [];
  if (document?.schema_version !== PARALLEL_PLAN_SCHEMA) errors.push(`schema_version must be ${PARALLEL_PLAN_SCHEMA}`);
  if (typeof document?.generated_at !== "string" || !document.generated_at) errors.push("generated_at is required");
  if (!/^[a-f0-9]{64}$/.test(document?.source_fingerprint ?? "")) errors.push("source_fingerprint must be a SHA-256 digest");
  if (!isObject(document?.scope)) errors.push("scope must be an object");
  else {
    if (!["all-active", "parent-descendants"].includes(document.scope.mode)) errors.push("scope.mode is invalid");
    if (!(document.scope.parent_work_item_id === null || typeof document.scope.parent_work_item_id === "string")) {
      errors.push("scope.parent_work_item_id must be null or a Work Item ID");
    }
    if (document.scope.mode === "all-active" && document.scope.parent_work_item_id !== null) {
      errors.push("all-active scope cannot name a parent Work Item");
    }
    if (document.scope.mode === "parent-descendants" && !document.scope.parent_work_item_id) {
      errors.push("parent-descendants scope requires a parent Work Item");
    }
    if (
      !Array.isArray(document.scope.selected_work_item_ids) ||
      document.scope.selected_work_item_ids.some((value) => typeof value !== "string") ||
      new Set(document.scope.selected_work_item_ids).size !== document.scope.selected_work_item_ids.length
    ) {
      errors.push("scope.selected_work_item_ids must contain unique Work Item IDs");
    }
  }
  if (!(document?.max_workers === null || (Number.isInteger(document?.max_workers) && document.max_workers > 0))) {
    errors.push("max_workers must be null or a positive integer");
  }
  if (!arrayOfObjects(document?.waves)) errors.push("waves must be an array of objects");
  if (!arrayOfObjects(document?.active)) errors.push("active must be an array of objects");
  if (!arrayOfObjects(document?.sequential)) errors.push("sequential must be an array of objects");
  if (!arrayOfObjects(document?.blocked)) errors.push("blocked must be an array of objects");
  if (!arrayOfObjects(document?.conflicts)) errors.push("conflicts must be an array of objects");
  if (!isObject(document?.summary)) errors.push("summary must be an object");
  if (!isObject(document?.execution_policy)) errors.push("execution_policy must be an object");
  const waveIds = new Set();
  const scheduledItems = new Set();
  for (const [index, wave] of (document?.waves ?? []).entries()) {
    if (!/^wave-[0-9]{3}$/.test(wave.id ?? "") || waveIds.has(wave.id)) errors.push(`waves[${index}].id is invalid or duplicated`);
    waveIds.add(wave.id);
    if (wave.order !== index + 1) errors.push(`waves[${index}].order must be ${index + 1}`);
    if (!arrayOfObjects(wave.dispatch) || wave.dispatch.length === 0) errors.push(`waves[${index}].dispatch must not be empty`);
    if (!isObject(wave.join_gate)) errors.push(`waves[${index}].join_gate must be an object`);
    if (document?.max_workers !== null && wave?.dispatch?.length > document.max_workers) {
      errors.push(`waves[${index}].dispatch exceeds max_workers`);
    }
    for (const entry of wave.dispatch ?? []) {
      if (typeof entry.work_item_id !== "string" || scheduledItems.has(entry.work_item_id)) {
        errors.push(`waves[${index}] has an invalid or duplicated work_item_id`);
      }
      scheduledItems.add(entry.work_item_id);
      for (const field of [
        "position_id",
        "agent_id",
        "suggested_task_title",
        "base_revision",
        "integration_owner_agent_id",
        "context_command"
      ]) {
        if (typeof entry[field] !== "string" || !entry[field]) errors.push(`waves[${index}] dispatch entry ${field} is required`);
      }
      if (!/^[a-f0-9]{64}$/.test(entry.preparation_fingerprint ?? "")) {
        errors.push(`waves[${index}] dispatch entry preparation_fingerprint must be a SHA-256 digest`);
      }
      for (const field of ["affected_paths", "dependencies", "required_disciplines"]) {
        if (!Array.isArray(entry[field]) || entry[field].some((value) => typeof value !== "string")) {
          errors.push(`waves[${index}] dispatch entry ${field} must be an array of strings`);
        }
      }
      if (entry.task_creation_performed !== false || entry.claim_performed !== false || entry.external_action_performed !== false) {
        errors.push(`waves[${index}] dispatch entries must remain plan-only`);
      }
    }
  }
  const dispositionItems = new Set(scheduledItems);
  for (const key of ["active", "sequential", "blocked"]) {
    for (const [index, entry] of (document?.[key] ?? []).entries()) {
      if (typeof entry.work_item_id !== "string" || dispositionItems.has(entry.work_item_id)) {
        errors.push(`${key}[${index}] has an invalid or duplicated work_item_id`);
      }
      dispositionItems.add(entry.work_item_id);
      if (!Array.isArray(entry.reasons) || entry.reasons.some((reason) => typeof reason !== "string")) {
        errors.push(`${key}[${index}].reasons must be an array of strings`);
      }
    }
  }
  if (Array.isArray(document?.scope?.selected_work_item_ids)) {
    const selected = new Set(document.scope.selected_work_item_ids);
    if (selected.size !== dispositionItems.size || [...selected].some((workItemId) => !dispositionItems.has(workItemId))) {
      errors.push("Every selected Work Item must have exactly one disposition");
    }
  }
  if (isObject(document?.summary)) {
    const expected = {
      selected: dispositionItems.size,
      dispatchable: scheduledItems.size,
      active: document.active?.length ?? 0,
      sequential: document.sequential?.length ?? 0,
      blocked: document.blocked?.length ?? 0,
      waves: document.waves?.length ?? 0
    };
    for (const [key, value] of Object.entries(expected)) {
      if (document.summary[key] !== value) errors.push(`summary.${key} must equal ${value}`);
    }
  }
  if (
    document?.execution_policy?.parallel_by_default_when_safe !== true ||
    document?.execution_policy?.replan_after_join !== true ||
    document?.execution_policy?.task_creation_performed !== false ||
    document?.execution_policy?.claim_performed !== false ||
    document?.execution_policy?.external_action_performed !== false
  ) {
    errors.push("execution_policy must record that no task, claim, or external action was performed");
  }
  return { valid: errors.length === 0, errors };
}

export async function buildParallelPlan(target, options = {}) {
  const context = await loadProjectContext(target);
  const resourceRegistry = await readResourceRegistry(target);
  const allItems = await listWorkItemDocuments(target);
  const itemsById = new Map(allItems.map((item) => [item.id, item]));
  const terminal = (item) => lifecycleProjection(context.workflow, item).terminal;
  const parentId = options.parentWorkItemId ?? null;
  if (parentId) await readWorkItem(target, parentId);
  const selectedIds = parentId
    ? descendantsOf(parentId, itemsById)
    : new Set(allItems.filter((item) => !terminal(item)).map((item) => item.id));
  const selectedItems = allItems.filter((item) => selectedIds.has(item.id) && !terminal(item));
  const selectedById = new Map(selectedItems.map((item) => [item.id, item]));
  const maxWorkers = options.maxWorkers ?? null;
  if (!(maxWorkers === null || (Number.isInteger(maxWorkers) && maxWorkers > 0))) {
    throw new Error("maxWorkers must be null or a positive integer");
  }

  const readinessById = new Map();
  for (const item of selectedItems) readinessById.set(item.id, await evaluateParallelReadiness(target, item.id));

  const conflicts = [];
  for (let leftIndex = 0; leftIndex < selectedItems.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < selectedItems.length; rightIndex += 1) {
      const left = selectedItems[leftIndex];
      const right = selectedItems[rightIndex];
      const matches = overlapDetails(left, right);
      if (matches.length === 0) continue;
      conflicts.push({
        kind: "affected-path",
        left_work_item_id: left.id,
        right_work_item_id: right.id,
        paths: matches,
        resolution: overlapIsBidirectionallyResolved(left, right) ? "explicit-bidirectional" : "separate-waves"
      });
    }
  }
  const capacities = new Map(
    (resourceRegistry.resources ?? []).filter((entry) => entry.active !== false).map((entry) => [entry.id, entry.capacity])
  );
  for (let leftIndex = 0; leftIndex < selectedItems.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < selectedItems.length; rightIndex += 1) {
      const left = selectedItems[leftIndex];
      const right = selectedItems[rightIndex];
      const leftResources = new Map(activeExecutionRequirements(left).resources.map((entry) => [entry.resource_id, entry.units]));
      for (const requirement of activeExecutionRequirements(right).resources) {
        if (!leftResources.has(requirement.resource_id)) continue;
        const capacity = capacities.get(requirement.resource_id);
        if (capacity && leftResources.get(requirement.resource_id) + requirement.units <= capacity) continue;
        conflicts.push({
          kind: "shared-resource-capacity",
          left_work_item_id: left.id,
          right_work_item_id: right.id,
          resource_id: requirement.resource_id,
          capacity: capacity ?? null,
          resolution: "separate-waves"
        });
      }
    }
  }

  const active = [];
  const sequential = [];
  const blocked = [];
  const candidates = new Map();
  for (const item of selectedItems) {
    const readiness = readinessById.get(item.id);
    if (item.claim?.status === "active") {
      active.push(activeDisposition(item, readiness));
      continue;
    }
    if (item.parallel_mode === "blocked") {
      blocked.push(disposition(item, readiness, ["requested_mode_blocked"], "blocked"));
      continue;
    }
    if (item.parallel_mode === "sequential") {
      sequential.push(disposition(item, readiness, ["requested_mode_sequential"], "sequential"));
      continue;
    }
    const hardFailures = readiness.checks
      .filter((check) => !check.pass && HARD_BLOCKING_CHECKS.has(check.id))
      .map((check) => check.id);
    if (hardFailures.length > 0) {
      blocked.push(disposition(item, readiness, hardFailures, "blocked"));
      continue;
    }
    const preparationFailures = readiness.checks
      .filter((check) => !check.pass && !["dependencies_resolved", "overlap_resolved"].includes(check.id))
      .map((check) => check.id);
    if (preparationFailures.length > 0) {
      sequential.push(disposition(item, readiness, preparationFailures, "sequential"));
      continue;
    }
    const dependencyReasons = [];
    for (const dependencyId of item.dependencies ?? []) {
      const dependency = itemsById.get(dependencyId);
      if (!dependency) dependencyReasons.push(`dependency_missing:${dependencyId}`);
      else if (terminal(dependency)) continue;
      else if (!selectedById.has(dependencyId)) dependencyReasons.push(`dependency_outside_scope:${dependencyId}`);
      else if (dependency.claim?.status === "active") dependencyReasons.push(`dependency_active:${dependencyId}`);
    }
    const ancestorIds = ancestorsOf(item, itemsById);
    const unresolvedExternalOverlaps = readiness.overlaps.filter((overlap) => {
      if (selectedById.has(overlap.work_item_id)) return false;
      const other = itemsById.get(overlap.work_item_id);
      if (ancestorIds.has(overlap.work_item_id) && other?.claim?.status !== "active") return false;
      return !other || !overlapIsBidirectionallyResolved(item, other);
    });
    dependencyReasons.push(...unresolvedExternalOverlaps.map((overlap) => `overlap_outside_scope:${overlap.work_item_id}`));
    if (dependencyReasons.length > 0) {
      blocked.push(disposition(item, readiness, dependencyReasons, "blocked"));
      continue;
    }
    candidates.set(item.id, item);
  }

  const notDispatchable = new Set([...active, ...sequential, ...blocked].map((entry) => entry.work_item_id));
  let propagatedDependencyBlock = true;
  while (propagatedDependencyBlock) {
    propagatedDependencyBlock = false;
    for (const [itemId, item] of [...candidates].sort(([left], [right]) => left.localeCompare(right))) {
      const unavailable = (item.dependencies ?? []).filter((dependencyId) => notDispatchable.has(dependencyId));
      if (unavailable.length === 0) continue;
      const readiness = readinessById.get(itemId);
      blocked.push(
        disposition(item, readiness, unavailable.map((dependencyId) => `dependency_not_dispatchable:${dependencyId}`), "blocked")
      );
      candidates.delete(itemId);
      notDispatchable.add(itemId);
      propagatedDependencyBlock = true;
    }
  }

  const conflictKeys = new Set(
    conflicts
      .filter((conflict) => conflict.resolution === "separate-waves")
      .map((conflict) => [conflict.left_work_item_id, conflict.right_work_item_id].sort().join("|"))
  );
  function fitsResourceCapacity(chosen, candidate) {
    const used = new Map();
    for (const item of [...chosen, candidate]) {
      for (const requirement of activeExecutionRequirements(item).resources) {
        used.set(requirement.resource_id, (used.get(requirement.resource_id) ?? 0) + requirement.units);
      }
    }
    return [...used].every(([resourceId, units]) => units <= (capacities.get(resourceId) ?? 0));
  }
  const scheduled = new Set();
  const pending = new Map([...candidates].sort(([left], [right]) => left.localeCompare(right)));
  const waves = [];
  while (pending.size > 0) {
    const dependencyReady = [...pending.values()].filter((item) =>
      (item.dependencies ?? []).every((dependencyId) => {
        const dependency = itemsById.get(dependencyId);
        return Boolean(dependency && terminal(dependency)) || scheduled.has(dependencyId);
      })
    );
    if (dependencyReady.length === 0) {
      for (const item of pending.values()) {
        blocked.push(disposition(item, readinessById.get(item.id), ["dependency_schedule_deadlock"], "blocked"));
      }
      pending.clear();
      break;
    }
    const chosen = [];
    for (const item of dependencyReady.sort((left, right) => left.id.localeCompare(right.id))) {
      if (maxWorkers !== null && chosen.length >= maxWorkers) break;
      const conflictsWithWave = chosen.some((other) => conflictKeys.has([item.id, other.id].sort().join("|")));
      if (!conflictsWithWave && fitsResourceCapacity(chosen, item)) chosen.push(item);
    }
    if (chosen.length === 0) chosen.push(dependencyReady.sort((left, right) => left.id.localeCompare(right.id))[0]);
    const order = waves.length + 1;
    const dispatch = chosen.map((item) => dispatchManifest(context, item, readinessById.get(item.id), resourceRegistry));
    waves.push({
      id: `wave-${String(order).padStart(3, "0")}`,
      order,
      dispatch,
      join_gate: {
        integration_owner_agent_ids: uniqueStrings(dispatch.map((entry) => entry.integration_owner_agent_id)).sort(),
        required_evidence: ["exact_candidate_revision", "verification_results", "unresolved_items"],
        rule: "Join every dispatched Work Item through its Integration Owner before dispatching dependent work or advancing the lifecycle."
      }
    });
    for (const item of chosen) {
      scheduled.add(item.id);
      pending.delete(item.id);
    }
  }

  active.sort((left, right) => left.work_item_id.localeCompare(right.work_item_id));
  sequential.sort((left, right) => left.work_item_id.localeCompare(right.work_item_id));
  blocked.sort((left, right) => left.work_item_id.localeCompare(right.work_item_id));
  const sourceFingerprint = await parallelPlanSourceFingerprint(target);
  const dispatchableCount = waves.reduce((count, wave) => count + wave.dispatch.length, 0);
  const plan = {
    schema_version: PARALLEL_PLAN_SCHEMA,
    generated_at: new Date().toISOString(),
    source_fingerprint: sourceFingerprint,
    scope: {
      mode: parentId ? "parent-descendants" : "all-active",
      parent_work_item_id: parentId,
      selected_work_item_ids: selectedItems.map((item) => item.id)
    },
    max_workers: maxWorkers,
    summary: {
      selected: selectedItems.length,
      dispatchable: dispatchableCount,
      active: active.length,
      sequential: sequential.length,
      blocked: blocked.length,
      waves: waves.length
    },
    waves,
    active,
    sequential,
    blocked,
    conflicts,
    execution_policy: {
      parallel_by_default_when_safe: true,
      runtime_capacity_limit: maxWorkers,
      fallback: "Execute each wave sequentially when concurrent task dispatch is unavailable.",
      replan_after_join: true,
      task_creation_performed: false,
      claim_performed: false,
      external_action_performed: false
    }
  };
  const validation = validateParallelPlan(plan);
  if (!validation.valid) throw new Error(`Generated parallel plan is invalid: ${validation.errors.join("; ")}`);
  return plan;
}

export async function writeParallelPlan(target, plan) {
  const validation = validateParallelPlan(plan);
  if (!validation.valid) throw new Error(`Invalid parallel plan: ${validation.errors.join("; ")}`);
  const outputPath = path.join(target, PARALLEL_PLAN_RELATIVE_PATH);
  await atomicWrite(outputPath, formatJson(plan));
  return outputPath;
}

export async function inspectParallelPlan(target) {
  const outputPath = path.join(target, PARALLEL_PLAN_RELATIVE_PATH);
  if (!(await pathExists(outputPath))) {
    return {
      installed: false,
      path: PARALLEL_PLAN_RELATIVE_PATH,
      valid: true,
      fresh: null,
      errors: [],
      plan: null,
      current_source_fingerprint: null
    };
  }
  let plan;
  try {
    plan = await readJson(outputPath);
  } catch (error) {
    return {
      installed: true,
      path: PARALLEL_PLAN_RELATIVE_PATH,
      valid: false,
      fresh: false,
      errors: [error.message],
      plan: null,
      current_source_fingerprint: null
    };
  }
  const validation = validateParallelPlan(plan);
  if (!validation.valid) {
    return {
      installed: true,
      path: PARALLEL_PLAN_RELATIVE_PATH,
      valid: false,
      fresh: false,
      errors: validation.errors,
      plan,
      current_source_fingerprint: null
    };
  }
  let currentSourceFingerprint;
  try {
    currentSourceFingerprint = await parallelPlanSourceFingerprint(target);
  } catch (error) {
    return {
      installed: true,
      path: PARALLEL_PLAN_RELATIVE_PATH,
      valid: false,
      fresh: false,
      errors: [`Cannot evaluate parallel plan freshness: ${error.message}`],
      plan,
      current_source_fingerprint: null
    };
  }
  if (currentSourceFingerprint === plan.source_fingerprint) {
    try {
      const expected = await buildParallelPlan(target, {
        parentWorkItemId: plan.scope.parent_work_item_id ?? undefined,
        maxWorkers: plan.max_workers
      });
      const normalizedExpected = { ...expected, generated_at: plan.generated_at };
      if (JSON.stringify(normalizedExpected) !== JSON.stringify(plan)) {
        return {
          installed: true,
          path: PARALLEL_PLAN_RELATIVE_PATH,
          valid: false,
          fresh: false,
          errors: ["Generated parallel plan does not match the deterministic projection of current canonical state"],
          plan,
          current_source_fingerprint: currentSourceFingerprint
        };
      }
    } catch (error) {
      return {
        installed: true,
        path: PARALLEL_PLAN_RELATIVE_PATH,
        valid: false,
        fresh: false,
        errors: [`Cannot rebuild the deterministic parallel plan: ${error.message}`],
        plan,
        current_source_fingerprint: currentSourceFingerprint
      };
    }
  }
  return {
    installed: true,
    path: PARALLEL_PLAN_RELATIVE_PATH,
    valid: true,
    fresh: currentSourceFingerprint === plan.source_fingerprint,
    errors: [],
    plan,
    current_source_fingerprint: currentSourceFingerprint
  };
}

export async function parallelExecutionForWorkItem(target, workItemId) {
  const inspection = await inspectParallelPlan(target);
  const base = {
    plan_installed: inspection.installed,
    plan_path: inspection.path,
    plan_valid: inspection.valid,
    plan_fresh: inspection.fresh,
    disposition: null,
    wave_id: null,
    wave_order: null,
    integration_owner_agent_id: null,
    task_creation_performed: false,
    claim_performed: false,
    external_action_performed: false
  };
  if (!inspection.valid || !inspection.plan) return base;
  for (const wave of inspection.plan.waves) {
    const entry = wave.dispatch.find((candidate) => candidate.work_item_id === workItemId);
    if (entry) {
      return {
        ...base,
        disposition: "dispatchable",
        wave_id: wave.id,
        wave_order: wave.order,
        integration_owner_agent_id: entry.integration_owner_agent_id
      };
    }
  }
  for (const key of ["active", "sequential", "blocked"]) {
    const entry = inspection.plan[key].find((candidate) => candidate.work_item_id === workItemId);
    if (entry) {
      return {
        ...base,
        disposition: key,
        integration_owner_agent_id: entry.integration_owner_agent_id ?? null
      };
    }
  }
  return base;
}
