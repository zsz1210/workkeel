import path from "node:path";
import { atomicWrite, formatJson, pathExists, readJson } from "./files.mjs";
import { listWorkItemDocuments } from "./work-items.mjs";
import { readRuntimeWorkerRegistry } from "./workers.mjs";
import { isLegacyConcludedItem } from "./workflow.mjs";

export const CONTROL_PLANE_CONDITIONS_SCHEMA = "temple.control-plane-conditions/v1";

function stem(value) {
  return String(value ?? "").split("*")[0].replace(/\/+$/, "");
}

function pathsOverlap(left, right) {
  const a = stem(left);
  const b = stem(right);
  return Boolean(a && b && (a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)));
}

function resolutionNames(item, otherId) {
  return (item.overlap_resolution ?? []).some((entry) =>
    String(entry).split(/[^A-Za-z0-9-]+/).includes(otherId)
  );
}

function conflicts(left, right) {
  const affectedPaths = (left.affected_paths ?? []).flatMap((a) =>
    (right.affected_paths ?? []).filter((b) => pathsOverlap(a, b)).map((b) => `${a} ↔ ${b}`)
  );
  const sharedContracts = (left.shared_contract_refs ?? []).filter((entry) =>
    (right.shared_contract_refs ?? []).includes(entry)
  );
  const leftResources = (left.stage_requirements?.resources ?? []).map((entry) => entry.resource_id ?? entry);
  const rightResources = (right.stage_requirements?.resources ?? []).map((entry) => entry.resource_id ?? entry);
  const sharedResources = leftResources.filter((entry) => rightResources.includes(entry));
  if (resolutionNames(left, right.id) && resolutionNames(right, left.id)) return [];
  return [...affectedPaths, ...sharedContracts.map((entry) => `contract:${entry}`), ...sharedResources.map((entry) => `resource:${entry}`)];
}

function condition(input) {
  return {
    id: `${input.type}:${input.entity}`,
    type: input.type,
    entity: input.entity,
    work_item_id: input.workItemId ?? null,
    status: input.status,
    reason: input.reason,
    message: input.message.slice(0, 500),
    severity: input.severity,
    suggested_action: input.suggestedAction,
    recovery_href: input.workItemId ? `#work-item-${input.workItemId}` : "#providers",
    owner_position: input.ownerPosition ?? "engineering_manager",
    source_capability: input.sourceCapability ?? "repository:history_snapshot:supported",
    observed_revision: input.observedRevision ?? null
  };
}

function maxTimestamp(values) {
  const valid = values.map((value) => Date.parse(value)).filter(Number.isFinite);
  return valid.length ? Math.max(...valid) : null;
}

function providerForTask(providers, task) {
  if (!task.thread_id) return providers.find((provider) => provider.id === "repository") ?? null;
  return providers.find((provider) => provider.kind === "codex-app-server") ?? null;
}

function activityFor(records, task, worker) {
  return maxTimestamp([
    task?.updated_at,
    worker?.updated_at,
    worker?.heartbeat_at,
    worker?.started_at,
    ...records.filter((record) =>
      (task && record.data?.task_id === task.id) ||
      (worker && record.data?.runtime_worker_id === worker.id) ||
      (task?.thread_id && record.data?.provider_thread_id === task.thread_id)
    ).map((record) => record.templeobservedat)
  ]);
}

function rawConditions({ observer, workItems, tasks, workers, providers, records, config, now }) {
  const output = [];
  const itemsById = new Map(workItems.map((item) => [item.id, item]));
  const currentItemsById = new Map(workItems.map((item) => [item.id, item]));
  const workersById = new Map(workers.map((worker) => [worker.id, worker]));

  const activeTasks = tasks.filter((task) => task.status === "active");
  const activeWorkers = workers.filter((worker) => worker.status === "active");
  const stallSubjects = [
    ...activeTasks.map((task) => ({ entity: task.id, task, worker: task.worker_id ? workersById.get(task.worker_id) : null })),
    ...activeWorkers.filter((worker) => !activeTasks.some((task) => task.worker_id === worker.id)).map((worker) => ({ entity: worker.id, task: null, worker }))
  ];
  for (const subject of stallSubjects) {
    const provider = providerForTask(providers, subject.task ?? {});
    const workItemId = subject.task?.work_item_id ?? subject.worker?.work_item_id;
    const lastActivity = activityFor(records, subject.task, subject.worker);
    const age = lastActivity === null ? null : now - lastActivity;
    const observable = provider?.status === "ready" && (
      subject.task?.thread_id ? provider.capabilities?.live_events === "supported" : true
    );
    output.push(condition({
      type: "stalled-work",
      entity: subject.entity,
      workItemId,
      status: observable ? (age !== null && age > config.alerts.stalled_after_ms ? "true" : "false") : "unknown",
      reason: !observable ? "provider-unavailable" : age === null ? "activity-time-unavailable" : age > config.alerts.stalled_after_ms ? "grace-period-exceeded" : "activity-within-grace-period",
      message: !observable
        ? `${subject.entity} cannot be evaluated while its live provider is unavailable.`
        : age === null
          ? `${subject.entity} has no reliable activity timestamp.`
          : `${subject.entity} was last observed ${Math.max(0, age)} ms ago.`,
      severity: "warning",
      suggestedAction: !observable ? "Restore the provider or use the static Observer fallback." : `Inspect ${subject.entity} and recover or reassign the work.`,
      ownerPosition: subject.task?.position_id ?? subject.worker?.position_id,
      sourceCapability: provider ? `${provider.id}:live_events:${provider.capabilities?.live_events ?? "unknown"}` : "provider:live_events:unknown",
      observedRevision: subject.task?.current_revision ?? subject.task?.base_revision ?? null
    }));
  }
  if (stallSubjects.length === 0) output.push(condition({
    type: "stalled-work", entity: "project", status: "false", reason: "no-active-runtime", message: "No active runtime requires stall evaluation.", severity: "info", suggestedAction: "No action required."
  }));

  const activeThreadStates = new Map();
  for (const record of records) {
    const threadId = record.data?.provider_thread_id;
    if (threadId && record.data?.status) activeThreadStates.set(threadId, record.data.status);
  }
  const orphanCandidates = [];
  for (const [threadId, status] of activeThreadStates) {
    if (status === "active" && !tasks.some((task) => task.thread_id === threadId)) orphanCandidates.push({ entity: threadId, workItemId: null, reason: "unregistered-provider-thread" });
  }
  for (const task of activeTasks) {
    const item = itemsById.get(task.work_item_id);
    if (!item || item.claim?.status !== "active") orphanCandidates.push({ entity: task.id, workItemId: task.work_item_id, reason: !item ? "missing-work-item" : "inactive-claim" });
  }
  if (orphanCandidates.length) {
    for (const orphan of orphanCandidates) output.push(condition({
      type: "orphaned-work", entity: orphan.entity, workItemId: orphan.workItemId, status: "true", reason: orphan.reason,
      message: `${orphan.entity} has active runtime work without a valid active Work Item correlation and claim.`, severity: "error",
      suggestedAction: "Register the task against a valid claimed Work Item or stop the runtime."
    }));
  } else output.push(condition({
    type: "orphaned-work", entity: "project", status: "false", reason: "all-active-work-correlated", message: "All observed active work has valid correlation.", severity: "info", suggestedAction: "No action required."
  }));

  const activeItems = workItems.filter((item) => item.claim?.status === "active");
  let conflictCount = 0;
  for (let leftIndex = 0; leftIndex < activeItems.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < activeItems.length; rightIndex += 1) {
      const left = activeItems[leftIndex];
      const right = activeItems[rightIndex];
      const overlap = conflicts(left, right);
      if (!overlap.length) continue;
      conflictCount += 1;
      output.push(condition({
        type: "scope-conflict", entity: `${left.id}+${right.id}`, workItemId: left.id, status: "true", reason: "unresolved-overlap",
        message: `${left.id} and ${right.id} overlap: ${overlap.slice(0, 5).join(", ")}.`, severity: "error",
        suggestedAction: "Split ownership, serialize the work, or record a bidirectional overlap resolution.", observedRevision: left.claim?.base_revision ?? null
      }));
    }
  }
  if (!conflictCount) output.push(condition({
    type: "scope-conflict", entity: "project", status: "false", reason: "no-unresolved-overlap", message: "No unresolved active-claim overlap was found.", severity: "info", suggestedAction: "No action required."
  }));

  const stale = observer.evidence.items.filter((entry) =>
    entry.stale && !["done", "concluded", "cancelled"].includes(currentItemsById.get(entry.work_item_id)?.state) &&
    !isLegacyConcludedItem(currentItemsById.get(entry.work_item_id))
  );
  if (stale.length) {
    for (const entry of stale) output.push(condition({
      type: "stale-evidence", entity: entry.id, workItemId: entry.work_item_id, status: "true", reason: "revision-mismatch",
      message: `${entry.id} targets ${entry.scope_revision} while current scope is ${entry.current_scope_revision ?? "unknown"}.`, severity: "warning",
      suggestedAction: "Re-run verification at the exact candidate revision or explicitly invalidate the stale evidence.", observedRevision: entry.current_scope_revision
    }));
  } else output.push(condition({
    type: "stale-evidence", entity: "project", status: "false", reason: "evidence-current", message: "No revision-stale evidence was found.", severity: "info", suggestedAction: "No action required."
  }));

  const latestUsage = new Map();
  for (const record of records) {
    if (record.data?.task_id && record.data?.usage?.total) latestUsage.set(record.data.task_id, record);
  }
  if (config.alerts.token_budget === null) output.push(condition({
    type: "usage-anomaly", entity: "project", status: "unknown", reason: "token-budget-not-configured", message: "Token anomaly evaluation is unavailable until an explicit token budget is configured.", severity: "info", suggestedAction: "Set alerts.token_budget to enable token anomaly detection.", sourceCapability: "codex-local:token_usage:unknown"
  }));
  else if (latestUsage.size === 0) output.push(condition({
    type: "usage-anomaly", entity: "project", status: providers.some((provider) => provider.capabilities?.token_usage === "supported" && provider.status === "ready") ? "false" : "unknown",
    reason: "usage-not-observed", message: "No token-usage observation is available.", severity: "warning", suggestedAction: "Attach a token-usage-capable provider or inspect its health.", sourceCapability: "codex-local:token_usage:unknown"
  }));
  else for (const [taskId, record] of latestUsage) {
    const total = record.data.usage.total.total_tokens;
    if (!Number.isFinite(total)) {
      output.push(condition({
        type: "usage-anomaly", entity: taskId, workItemId: record.data.work_item_id, status: "unknown",
        reason: "usage-total-unavailable", message: `${taskId} reported usage without a numeric total.`, severity: "warning",
        suggestedAction: "Inspect provider telemetry; do not infer zero usage.",
        sourceCapability: "codex-local:token_usage:partial", observedRevision: record.data.scope_revision
      }));
      continue;
    }
    output.push(condition({
      type: "usage-anomaly", entity: taskId, workItemId: record.data.work_item_id, status: total > config.alerts.token_budget ? "true" : "false",
      reason: total > config.alerts.token_budget ? "token-budget-exceeded" : "within-token-budget",
      message: `${taskId} observed ${total} total tokens against a ${config.alerts.token_budget} token budget.`, severity: "warning",
      suggestedAction: total > config.alerts.token_budget ? "Review scope, context size, and task decomposition." : "No action required.",
      sourceCapability: "codex-local:token_usage:supported", observedRevision: record.data.scope_revision
    }));
  }
  return output;
}

function applyLifecycle(raw, previous, now, config) {
  const changed = previous?.status !== raw.status;
  let firstObserved = previous?.first_observed_at ?? now;
  let lifecycle;
  let resolvedAt = previous?.resolved_at ?? null;
  if (raw.status === "unknown") lifecycle = "suppressed";
  else if (raw.status === "false") {
    lifecycle = "resolved";
    if (previous?.status === "true") resolvedAt = now;
  } else {
    if (previous?.status !== "true") firstObserved = now;
    const withinCooldown = previous?.resolved_at && Date.parse(now) - Date.parse(previous.resolved_at) < config.alerts.cooldown_ms;
    if (withinCooldown) lifecycle = "suppressed";
    else if (Date.parse(now) - Date.parse(firstObserved) >= config.alerts.pending_for_ms) lifecycle = "firing";
    else lifecycle = "pending";
    if (!withinCooldown) resolvedAt = null;
  }
  if (previous?.status === raw.status && previous?.lifecycle === "firing" && raw.status === "true") lifecycle = "firing";
  return {
    ...raw,
    lifecycle,
    first_observed_at: firstObserved,
    last_observed_at: now,
    last_transition_at: changed || previous?.lifecycle !== lifecycle ? now : previous.last_transition_at,
    resolved_at: resolvedAt
  };
}

export async function buildConditionProjection(target, observer, journal, registry, config, options = {}) {
  const stateDirectory = options.stateDirectory;
  const conditionPath = stateDirectory ? path.join(stateDirectory, "conditions.json") : null;
  const previousDocument = conditionPath && await pathExists(conditionPath)
    ? await readJson(conditionPath)
    : { schema_version: CONTROL_PLANE_CONDITIONS_SCHEMA, conditions: [] };
  const [workItems, tasksDocument, workersDocument] = await Promise.all([
    listWorkItemDocuments(target),
    readJson(path.join(target, ".ai-org/project/tasks.json")),
    readRuntimeWorkerRegistry(target)
  ]);
  const records = journal.readAfter(0).records;
  const now = options.now ?? new Date().toISOString();
  const previous = new Map((previousDocument.conditions ?? []).map((entry) => [entry.id, entry]));
  const evaluations = rawConditions({
    observer,
    workItems,
    tasks: tasksDocument.tasks ?? [],
    workers: workersDocument.workers ?? [],
    providers: registry.list(),
    records,
    config,
    now: Date.parse(now)
  });
  const evaluationIds = new Set(evaluations.map((entry) => entry.id));
  for (const prior of previous.values()) {
    if (evaluationIds.has(prior.id) || prior.entity === "project") continue;
    evaluations.push({
      ...prior,
      status: "false",
      reason: "condition-cleared",
      message: `${prior.id} is no longer present in the current projection.`,
      severity: "info",
      suggested_action: "No action required; retain this recovery record through its cooldown."
    });
  }
  const conditions = evaluations.map((entry) => applyLifecycle(entry, previous.get(entry.id), now, config));
  const document = {
    schema_version: CONTROL_PLANE_CONDITIONS_SCHEMA,
    generated_at: now,
    conditions,
    summary: {
      firing: conditions.filter((entry) => entry.lifecycle === "firing").length,
      pending: conditions.filter((entry) => entry.lifecycle === "pending").length,
      suppressed: conditions.filter((entry) => entry.lifecycle === "suppressed").length,
      resolved: conditions.filter((entry) => entry.lifecycle === "resolved").length,
      unknown: conditions.filter((entry) => entry.status === "unknown").length
    },
    canonical_state_changed: false,
    external_action_performed: false
  };
  if (conditionPath && options.persist !== false) await atomicWrite(conditionPath, formatJson(document));
  return document;
}
