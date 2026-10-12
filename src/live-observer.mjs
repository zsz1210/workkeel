import path from "node:path";
import { pathExists, readJson } from "./files.mjs";
import { classifyCodexTasks } from "./codex-app-server-provider.mjs";

export const LIVE_OBSERVER_SCHEMA = "temple.live-observer/v1";

function providerForTask(providers, task) {
  if (!task.thread_id) return null;
  return providers.find((provider) => provider.kind === "codex-app-server") ?? null;
}

function latestBy(records, predicate) {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (predicate(records[index])) return records[index];
  }
  return null;
}

function freshness(observedAt, now = Date.now()) {
  const milliseconds = observedAt ? Math.max(0, now - Date.parse(observedAt)) : null;
  return {
    observed_at: observedAt ?? null,
    age_ms: Number.isFinite(milliseconds) ? milliseconds : null,
    quality: milliseconds === null ? "unknown" : milliseconds <= 10000 ? "fresh" : milliseconds <= 300000 ? "aging" : "stale"
  };
}

function itemReducer(records) {
  const items = new Map();
  for (const record of records) {
    const id = record.data?.provider_item_id;
    if (!id) continue;
    const current = items.get(id);
    const terminal = record.data?.terminal === true || record.type.endsWith("item.completed.v1");
    if (current?.terminal && !terminal) continue;
    items.set(id, {
      id,
      type: record.data?.item_type ?? "unknown",
      status: record.data?.item_status ?? record.data?.lifecycle ?? "unknown",
      terminal,
      observed_at: record.templeobservedat,
      cursor: record.templecursor
    });
  }
  return [...items.values()];
}

function uniqueAttention(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = JSON.stringify([
      item.type ?? null,
      item.work_item_id ?? null,
      item.worker_id ?? null,
      item.evidence_id ?? null,
      item.learning_id ?? null,
      item.message ?? null
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function taskProjection(task, records, providers, now, liveResumableIds) {
  const taskRecords = records.filter((record) =>
    record.data?.task_id === task.id || (task.thread_id && record.data?.provider_thread_id === task.thread_id)
  );
  const provider = providerForTask(providers, task);
  const liveEligible = liveResumableIds.has(task.id);
  const liveRecords = liveEligible
    ? taskRecords.filter((record) => record.data?.reconciled !== true)
    : [];
  const historyRecords = liveEligible
    ? taskRecords.filter((record) => record.data?.reconciled === true)
    : taskRecords;
  const liveVisible = provider?.status === "ready" && liveRecords.length > 0;
  const historyVisible = !liveVisible && historyRecords.length > 0;
  const projectionRecords = liveVisible ? liveRecords : historyVisible ? historyRecords : [];
  const last = projectionRecords.at(-1) ?? null;
  const statusRecord = latestBy(projectionRecords, (record) =>
    record.type.includes("thread.status") || record.type.includes("turn.completed") || record.type.includes("turn.started")
  );
  const planRecord = latestBy(projectionRecords, (record) => record.type.includes("plan.updated"));
  const diffRecord = latestBy(projectionRecords, (record) => record.type.includes("diff.updated"));
  const usageRecord = latestBy(projectionRecords, (record) => record.type.includes("usage.updated"));
  const failureRecord = latestBy(liveRecords, (record) =>
    record.type.includes("failure.observed") || ["failed", "interrupted"].includes(record.data?.status)
  );
  const visibility = liveVisible
    ? "live"
    : historyVisible
      ? "history-only"
      : provider?.status === "ready" ? "registered-only" : "unknown";
  const runtimeProvenance = liveVisible ? "observed" : historyVisible ? "historical" : "unavailable";
  const capabilityQuality = liveVisible
    ? provider?.capabilities?.live_events ?? "unknown"
    : historyVisible ? provider?.capabilities?.history_snapshot ?? "unknown" : "unknown";
  return {
    id: task.id,
    work_item_id: task.work_item_id,
    position_id: task.position_id,
    agent_id: task.agent_id,
    registered_status: task.status,
    provider_thread_id: task.thread_id,
    provider_id: provider?.id ?? null,
    execution_origin: task.execution_origin ?? "unknown",
    registered_provider_id: task.provider_id ?? null,
    requested_model: task.requested_model ?? null,
    effective_model: task.effective_model ?? null,
    requested_reasoning_effort: task.requested_reasoning_effort ?? null,
    observed_thread_reasoning_effort: task.observed_thread_reasoning_effort ?? null,
    effective_turn_reasoning_effort: task.effective_turn_reasoning_effort ?? null,
    reasoning_effort: task.reasoning_effort ?? null,
    reasoning_effort_source: task.reasoning_effort_source ?? "unknown",
    service_tier: task.service_tier ?? null,
    launch_revision: task.launch_revision ?? null,
    current_revision: task.current_revision ?? null,
    claim_base_revision: task.base_revision ?? null,
    visibility,
    observed_status: liveVisible || historyVisible ? statusRecord?.data?.status ?? "unknown" : "unknown",
    exact_revision: task.current_revision ?? task.launch_revision ?? task.base_revision ?? null,
    provenance: {
      registration: "canonical",
      runtime: runtimeProvenance,
      source: provider?.id ?? "task-registry",
      capability_quality: capabilityQuality
    },
    freshness: freshness(last?.templeobservedat, now),
    plan: planRecord ? {
      steps: planRecord.data?.plan ?? [],
      observed_at: planRecord.templeobservedat,
      provenance: runtimeProvenance
    } : null,
    diff: diffRecord ? {
      ...diffRecord.data?.diff_summary,
      observed_at: diffRecord.templeobservedat,
      provenance: runtimeProvenance
    } : null,
    usage: usageRecord ? {
      ...usageRecord.data?.usage,
      observed_at: usageRecord.templeobservedat,
      provenance: runtimeProvenance
    } : null,
    items: itemReducer(taskRecords),
    attention: failureRecord ? {
      type: "runtime-failure",
      blocked: true,
      status: failureRecord.data?.status ?? "failed",
      observed_at: failureRecord.templeobservedat,
      message: `${task.id} reported ${failureRecord.data?.status ?? "a provider failure"}; canonical Work Item state was not changed.`
    } : null
  };
}

export async function buildLiveObserverProjection(target, observer, journal, registry, options = {}) {
  const taskPath = path.join(target, ".ai-org/project/tasks.json");
  const taskDocument = (await pathExists(taskPath))
    ? await readJson(taskPath)
    : { schema_version: "temple.tasks/v1", tasks: [] };
  const providers = registry.list();
  const replay = journal.readAfter(0);
  const records = replay.records;
  const now = options.now ? Date.parse(options.now) : Date.now();
  const taskTopology = classifyCodexTasks(taskDocument.tasks ?? [], { workItems: observer.work.items });
  const liveResumableIds = new Set(taskTopology.live_resumable.map((task) => task.id));
  const tasks = (taskDocument.tasks ?? []).map((task) => taskProjection(task, records, providers, now, liveResumableIds));
  const workItems = observer.work.items.map((item) => {
    const itemTasks = tasks.filter((task) => task.work_item_id === item.id);
    return {
      ...item,
      exact_revision: item.current_revision?.revision ?? item.current_revision?.reference ?? null,
      provenance: {
        lifecycle: "canonical",
        runtime: itemTasks.some((task) => task.visibility === "live")
          ? "observed"
          : itemTasks.some((task) => task.visibility === "history-only") ? "historical" : "unavailable"
      },
      freshness: itemTasks.length
        ? itemTasks.map((task) => task.freshness).sort((left, right) => (left.age_ms ?? Infinity) - (right.age_ms ?? Infinity))[0]
        : freshness(null, now),
      tasks: itemTasks,
      live_attention: itemTasks.flatMap((task) => task.attention ? [task.attention] : [])
    };
  });
  const liveAttention = tasks.flatMap((task) => task.attention ? [{ ...task.attention, work_item_id: task.work_item_id, task_id: task.id }] : []);
  const attention = uniqueAttention([...(observer.attention ?? []), ...liveAttention]);
  const liveTimeline = records.filter((record) => record.data?.canonical !== true).slice(-200).reverse().map((record) => ({
    timestamp: record.time,
    observed_at: record.templeobservedat,
    cursor: record.templecursor,
    type: "telemetry",
    name: record.type,
    work_item_id: record.data?.work_item_id ?? null,
    task_id: record.data?.task_id ?? null,
    provider: record.source,
    provenance: record.data?.reconciled === true ? "historical" : "observed",
    exact_revision: record.data?.scope_revision ?? null
  }));
  const combinedTimeline = [
    ...observer.timeline.map((entry) => ({ ...entry, provenance: "canonical", observed_at: entry.timestamp, cursor: null })),
    ...liveTimeline
  ].sort((left, right) => String(right.timestamp ?? right.observed_at).localeCompare(String(left.timestamp ?? left.observed_at))).slice(0, 200);
  return {
    schema_version: LIVE_OBSERVER_SCHEMA,
    generated_at: new Date(now).toISOString(),
    project: observer.project,
    work: {
      ...observer.work,
      items: workItems,
      live: workItems.filter((item) => item.tasks.some((task) => task.visibility === "live")).length,
      history_only: workItems.filter((item) => !item.tasks.some((task) => task.visibility === "live") && item.tasks.some((task) => task.visibility === "history-only")).length,
      registered_only: workItems.filter((item) => item.tasks.length > 0 && item.tasks.every((task) => task.visibility === "registered-only")).length,
      unknown: workItems.filter((item) => item.tasks.some((task) => task.visibility === "unknown")).length
    },
    tasks: {
      total: tasks.length,
      live: tasks.filter((task) => task.visibility === "live").length,
      history_only: tasks.filter((task) => task.visibility === "history-only").length,
      registered_only: tasks.filter((task) => task.visibility === "registered-only").length,
      unknown: tasks.filter((task) => task.visibility === "unknown").length,
      items: tasks
    },
    providers,
    attention,
    timeline: combinedTimeline,
    privacy: {
      raw_prompts_retained: false,
      reasoning_retained: false,
      command_output_retained: false,
      raw_tool_payloads_retained: false,
      raw_diffs_retained: false
    },
    canonical_state_changed: false,
    external_action_performed: false
  };
}
