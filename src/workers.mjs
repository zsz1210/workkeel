import fs from "node:fs/promises";
import path from "node:path";
import { atomicCreate, atomicWrite, formatJson, pathExists, readJson, sha256 } from "./files.mjs";
import { runtimeWorkerId } from "./ids.mjs";
import {
  dispatchPreparationFingerprint,
  inspectParallelPlan,
  validateParallelPlan
} from "./orchestration.mjs";
import { appendEvent, loadProjectContext, uniqueStrings } from "./project.mjs";
import { readResourceRegistry, releaseWorkerResources, reserveResources } from "./resources.mjs";
import {
  claimWorkItem,
  evaluateParallelReadiness,
  readWorkItem,
  releaseWorkItemClaim
} from "./work-items.mjs";

export const RUNTIME_WORKER_REGISTRY_RELATIVE_PATH = ".ai-org/project/runtime-workers.json";
export const RUNTIME_WORKER_REGISTRY_SCHEMA = "temple.runtime-workers/v1";
export const RUNTIME_WORKER_KINDS = ["internal-subagent", "user-task"];
export const RUNTIME_WORKER_STATUSES = ["reserved", "active", "waiting", "attention", "completed", "failed", "cancelled"];
const TERMINAL_WORKER_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function emptyRuntimeWorkerRegistry() {
  return { schema_version: RUNTIME_WORKER_REGISTRY_SCHEMA, workers: [] };
}

export function validateRuntimeWorkerRegistry(document) {
  const errors = [];
  if (document?.schema_version !== RUNTIME_WORKER_REGISTRY_SCHEMA) errors.push(`schema_version must be ${RUNTIME_WORKER_REGISTRY_SCHEMA}`);
  if (!Array.isArray(document?.workers)) return { valid: false, errors: [...errors, "workers must be an array"] };
  const ids = new Set();
  const runtimeIds = new Set();
  const taskIds = new Set();
  for (const [index, worker] of document.workers.entries()) {
    const label = `workers[${index}]`;
    if (typeof worker?.id !== "string" || !worker.id.startsWith("worker-") || ids.has(worker.id)) errors.push(`${label}.id is invalid or duplicated`);
    ids.add(worker?.id);
    if (!RUNTIME_WORKER_KINDS.includes(worker?.runtime_kind)) errors.push(`${label}.runtime_kind is invalid`);
    if (!RUNTIME_WORKER_STATUSES.includes(worker?.status)) errors.push(`${label}.status is invalid`);
    for (const field of ["work_item_id", "position_id", "agent_id", "principal_id", "claim_id", "base_revision", "branch"]) {
      if (typeof worker?.[field] !== "string" || !worker[field]) errors.push(`${label}.${field} is required`);
    }
    for (const field of ["plan_fingerprint", "plan_digest", "preparation_fingerprint"]) {
      if (!/^[a-f0-9]{64}$/.test(worker?.[field] ?? "")) errors.push(`${label}.${field} must be a SHA-256 digest`);
    }
    if (!/^wave-[0-9]{3}$/.test(worker?.wave_id ?? "")) errors.push(`${label}.wave_id is invalid`);
    if (!(worker?.worktree === null || typeof worker?.worktree === "string")) errors.push(`${label}.worktree must be null or a string`);
    if (!(worker?.runtime_id === null || typeof worker?.runtime_id === "string")) errors.push(`${label}.runtime_id must be null or a string`);
    if (!(worker?.task_id === null || typeof worker?.task_id === "string")) errors.push(`${label}.task_id must be null or a string`);
    if (worker?.runtime_id && runtimeIds.has(worker.runtime_id)) errors.push(`${label}.runtime_id is duplicated`);
    if (worker?.task_id && taskIds.has(worker.task_id)) errors.push(`${label}.task_id is duplicated`);
    if (worker?.runtime_id) runtimeIds.add(worker.runtime_id);
    if (worker?.task_id) taskIds.add(worker.task_id);
    if (worker?.runtime_kind === "internal-subagent" && worker?.task_id !== null) errors.push(`${label} internal subagent cannot reference a Codex task`);
    if (worker?.runtime_kind === "user-task" && worker?.runtime_id !== null) errors.push(`${label} user task cannot use an internal runtime ID`);
    if (
      !Array.isArray(worker?.resource_reservation_ids) ||
      worker.resource_reservation_ids.some((value) => typeof value !== "string" || !value) ||
      new Set(worker.resource_reservation_ids).size !== worker.resource_reservation_ids.length
    ) errors.push(`${label}.resource_reservation_ids must contain unique strings`);
    if (
      !Array.isArray(worker?.evidence) ||
      worker.evidence.some((value) => typeof value !== "string" || !value) ||
      new Set(worker.evidence).size !== worker.evidence.length
    ) errors.push(`${label}.evidence must contain unique strings`);
    if (!(worker?.current_revision === null || typeof worker?.current_revision === "string")) {
      errors.push(`${label}.current_revision must be null or a string`);
    }
    for (const field of ["reserved_at", "updated_at"]) {
      if (typeof worker?.[field] !== "string" || Number.isNaN(Date.parse(worker[field]))) errors.push(`${label}.${field} must be an ISO date`);
    }
    for (const field of ["attached_at", "completed_at"]) {
      if (!(worker?.[field] === null || (typeof worker?.[field] === "string" && !Number.isNaN(Date.parse(worker[field]))))) {
        errors.push(`${label}.${field} must be null or an ISO date`);
      }
    }
    if (worker?.status === "reserved" && (worker.runtime_id !== null || worker.task_id !== null || worker.attached_at !== null)) {
      errors.push(`${label} reserved worker cannot already be attached`);
    }
    if (["active", "waiting", "attention"].includes(worker?.status)) {
      const correlated = worker.runtime_kind === "internal-subagent" ? Boolean(worker.runtime_id) : Boolean(worker.task_id);
      if (!correlated || !worker.attached_at) errors.push(`${label} active worker requires its declared runtime correlation`);
    }
    if (TERMINAL_WORKER_STATUSES.has(worker?.status) && !worker?.completed_at) errors.push(`${label} terminal worker requires completed_at`);
    if (!TERMINAL_WORKER_STATUSES.has(worker?.status) && worker?.completed_at !== null) errors.push(`${label} non-terminal worker cannot have completed_at`);
  }
  return { valid: errors.length === 0, errors: uniqueStrings(errors) };
}

export async function ensureRuntimeWorkerRegistry(target) {
  const registryPath = path.join(target, RUNTIME_WORKER_REGISTRY_RELATIVE_PATH);
  if (await pathExists(registryPath)) return { path: registryPath, created: false, afterHash: null };
  const content = formatJson(emptyRuntimeWorkerRegistry());
  try {
    await atomicCreate(registryPath, content);
    return { path: registryPath, created: true, afterHash: sha256(content) };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return { path: registryPath, created: false, afterHash: null };
  }
}

export async function readRuntimeWorkerRegistry(target) {
  const registryPath = path.join(target, RUNTIME_WORKER_REGISTRY_RELATIVE_PATH);
  if (!(await pathExists(registryPath))) throw new Error(`${RUNTIME_WORKER_REGISTRY_RELATIVE_PATH} is missing; run temple upgrade`);
  const document = await readJson(registryPath);
  const validation = validateRuntimeWorkerRegistry(document);
  if (!validation.valid) throw new Error(`Invalid runtime worker registry:\n- ${validation.errors.join("\n- ")}`);
  return document;
}

async function writeRuntimeWorkerRegistry(target, document) {
  const validation = validateRuntimeWorkerRegistry(document);
  if (!validation.valid) throw new Error(`Invalid runtime worker registry:\n- ${validation.errors.join("\n- ")}`);
  await atomicWrite(path.join(target, RUNTIME_WORKER_REGISTRY_RELATIVE_PATH), formatJson(document));
}

async function snapshotFiles(paths) {
  const snapshots = [];
  for (const filePath of paths) snapshots.push({ path: filePath, before: (await pathExists(filePath)) ? await fs.readFile(filePath) : null });
  return snapshots;
}

async function restoreSnapshots(snapshots) {
  for (const snapshot of [...snapshots].reverse()) {
    if (snapshot.before === null) await fs.unlink(snapshot.path).catch((error) => { if (error.code !== "ENOENT") throw error; });
    else await atomicWrite(snapshot.path, snapshot.before);
  }
}

function firstWaveEntry(plan, workItemId) {
  return plan?.waves?.[0]?.dispatch?.find((entry) => entry.work_item_id === workItemId) ?? null;
}

export async function prepareWorkerDispatch(target, options, dependencies = {}) {
  const runtimeKind = String(options.runtimeKind ?? "").trim();
  if (!RUNTIME_WORKER_KINDS.includes(runtimeKind)) {
    throw new Error(`--runtime-kind must be ${RUNTIME_WORKER_KINDS.join(" or ")}`);
  }
  const inspection = await inspectParallelPlan(target);
  if (!inspection.installed) throw new Error("A stored parallel plan is required before preparing a worker");
  const plan = inspection.plan;
  const structuralValidation = validateParallelPlan(plan);
  if (!structuralValidation.valid) {
    throw new Error(`Parallel plan is invalid: ${structuralValidation.errors.join("; ")}`);
  }
  const planDigest = sha256(JSON.stringify(plan));
  const existingRegistry = await readRuntimeWorkerRegistry(target);
  const continuingVerifiedWave = existingRegistry.workers.some(
    (worker) =>
      worker.plan_fingerprint === plan.source_fingerprint &&
      worker.plan_digest === planDigest &&
      worker.wave_id === plan.waves[0]?.id
  );
  if (!(inspection.valid && inspection.fresh) && !continuingVerifiedWave) {
    throw new Error("Parallel plan is stale; rebuild it before preparing a worker");
  }
  const entry = firstWaveEntry(plan, options.workItemId);
  if (!entry) throw new Error(`${options.workItemId ?? "Work Item"} is not dispatchable in the first safe wave`);
  if (existingRegistry.workers.some((worker) => worker.work_item_id === entry.work_item_id && !TERMINAL_WORKER_STATUSES.has(worker.status))) {
    throw new Error(`${entry.work_item_id} already has a non-terminal runtime worker`);
  }
  if (options.agentId !== entry.agent_id) throw new Error(`${entry.work_item_id} must be prepared for planned Agent ${entry.agent_id}`);
  if (String(options.baseRevision ?? "").trim() !== entry.base_revision) {
    throw new Error(`${entry.work_item_id} must use planned base revision ${entry.base_revision}`);
  }
  const [item, readiness, context, resourceRegistry] = await Promise.all([
    readWorkItem(target, entry.work_item_id),
    evaluateParallelReadiness(target, entry.work_item_id),
    loadProjectContext(target),
    readResourceRegistry(target)
  ]);
  const currentPreparationFingerprint = dispatchPreparationFingerprint(item, readiness, context, resourceRegistry);
  if (currentPreparationFingerprint !== entry.preparation_fingerprint) {
    throw new Error("Parallel plan is stale for this Work Item; rebuild it before preparing a worker");
  }
  if (!readiness.ready) {
    throw new Error(
      `${entry.work_item_id} is no longer dispatch-ready: ${readiness.checks
        .filter((check) => !check.pass)
        .map((check) => check.id)
        .join(", ")}`
    );
  }

  const workerId = runtimeWorkerId();
  const timestamp = new Date().toISOString();
  const paths = [
    path.join(target, `.ai-org/work-items/${entry.work_item_id}.json`),
    path.join(target, ".ai-org/events/events.jsonl"),
    path.join(target, RUNTIME_WORKER_REGISTRY_RELATIVE_PATH),
    path.join(target, ".ai-org/project/resources.json")
  ];
  const snapshots = await snapshotFiles(paths);
  try {
    const claimed = await claimWorkItem(target, {
      workItemId: entry.work_item_id,
      agentId: options.agentId,
      principalId: options.principalId,
      baseRevision: options.baseRevision,
      branch: options.branch,
      worktree: options.worktree
    });
    const reservations = await reserveResources(target, {
      workerId,
      workItemId: entry.work_item_id,
      requirements: entry.active_requirements?.resources ?? [],
      timestamp
    });
    const registry = await readRuntimeWorkerRegistry(target);
    const worker = {
      id: workerId,
      runtime_kind: runtimeKind,
      status: "reserved",
      work_item_id: entry.work_item_id,
      position_id: entry.position_id,
      agent_id: entry.agent_id,
      principal_id: claimed.item.claim.principal_id,
      claim_id: claimed.item.claim.id,
      base_revision: claimed.item.claim.base_revision,
      branch: claimed.item.claim.branch,
      worktree: claimed.item.claim.worktree,
      plan_fingerprint: plan.source_fingerprint,
      plan_digest: planDigest,
      preparation_fingerprint: entry.preparation_fingerprint,
      wave_id: plan.waves[0].id,
      runtime_id: null,
      task_id: null,
      resource_reservation_ids: reservations.map((reservation) => reservation.id),
      current_revision: null,
      evidence: [],
      reserved_at: timestamp,
      attached_at: null,
      completed_at: null,
      updated_at: timestamp
    };
    const persistWorkerRegistry = dependencies.persistWorkerRegistry ?? writeRuntimeWorkerRegistry;
    await persistWorkerRegistry(target, { ...registry, workers: [...registry.workers, worker] });
    await appendEvent(target, {
      timestamp,
      event_type: "runtime_worker_reserved",
      actor: worker.principal_id,
      work_item_id: worker.work_item_id,
      worker_id: worker.id,
      runtime_kind: runtimeKind,
      claim_id: worker.claim_id,
      refs: [RUNTIME_WORKER_REGISTRY_RELATIVE_PATH, ".ai-org/project/resources.json"]
    });
    return {
      worker,
      claim: claimed.item.claim,
      resource_reservations: reservations,
      instruction: "Create the runtime worker only after this preparation succeeds."
    };
  } catch (error) {
    await restoreSnapshots(snapshots);
    throw error;
  }
}

function workerIndex(registry, workerId) {
  const index = registry.workers.findIndex((worker) => worker.id === workerId);
  if (index < 0) throw new Error(`Runtime worker not found: ${workerId ?? "missing"}`);
  return index;
}

export async function attachInternalWorker(target, options) {
  const registry = await readRuntimeWorkerRegistry(target);
  const index = workerIndex(registry, options.workerId);
  const current = registry.workers[index];
  if (current.runtime_kind !== "internal-subagent") throw new Error(`${current.id} is reserved for a user-owned Codex task`);
  if (current.status !== "reserved") throw new Error(`${current.id} is ${current.status}, not reserved`);
  const runtimeId = String(options.runtimeId ?? "").trim();
  if (!runtimeId) throw new Error("--runtime-id is required");
  if (registry.workers.some((worker) => worker.runtime_id === runtimeId)) throw new Error(`Runtime ID is already attached: ${runtimeId}`);
  const timestamp = new Date().toISOString();
  const worker = { ...current, status: "active", runtime_id: runtimeId, attached_at: timestamp, updated_at: timestamp };
  registry.workers[index] = worker;
  await writeRuntimeWorkerRegistry(target, registry);
  await appendEvent(target, {
    timestamp,
    event_type: "runtime_worker_attached",
    actor: worker.agent_id,
    work_item_id: worker.work_item_id,
    worker_id: worker.id,
    runtime_kind: worker.runtime_kind,
    runtime_id: runtimeId,
    refs: [RUNTIME_WORKER_REGISTRY_RELATIVE_PATH]
  });
  return worker;
}

export async function validateUserTaskReservation(target, workerId, expected = {}) {
  const registry = await readRuntimeWorkerRegistry(target);
  const worker = registry.workers[workerIndex(registry, workerId)];
  if (worker.runtime_kind !== "user-task") throw new Error(`${worker.id} is an internal subagent reservation, not a user task`);
  if (worker.status !== "reserved") throw new Error(`${worker.id} is ${worker.status}, not reserved`);
  for (const [field, value] of Object.entries(expected)) {
    if (value !== undefined && worker[field] !== value) throw new Error(`${worker.id} ${field} does not match ${value}`);
  }
  return worker;
}

export async function attachUserTaskWorker(target, workerId, task) {
  const registry = await readRuntimeWorkerRegistry(target);
  const index = workerIndex(registry, workerId);
  const current = registry.workers[index];
  await validateUserTaskReservation(target, workerId, {
    work_item_id: task.work_item_id,
    position_id: task.position_id,
    agent_id: task.agent_id,
    claim_id: task.claim_id
  });
  const timestamp = new Date().toISOString();
  const worker = { ...current, status: "active", task_id: task.id, attached_at: timestamp, updated_at: timestamp };
  registry.workers[index] = worker;
  await writeRuntimeWorkerRegistry(target, registry);
  await appendEvent(target, {
    timestamp,
    event_type: "runtime_worker_attached",
    actor: task.registered_by,
    work_item_id: worker.work_item_id,
    worker_id: worker.id,
    runtime_kind: worker.runtime_kind,
    task_id: task.id,
    refs: [RUNTIME_WORKER_REGISTRY_RELATIVE_PATH, ".ai-org/project/tasks.json"]
  });
  return worker;
}

export async function updateRuntimeWorker(target, options) {
  const registry = await readRuntimeWorkerRegistry(target);
  const index = workerIndex(registry, options.workerId);
  const current = registry.workers[index];
  const status = options.status ?? current.status;
  if (!RUNTIME_WORKER_STATUSES.includes(status)) throw new Error(`Invalid runtime worker status: ${status}`);
  if (TERMINAL_WORKER_STATUSES.has(current.status) && status !== current.status) {
    throw new Error(`${current.id} is terminal at ${current.status}`);
  }
  if (status === "active" && current.status === "reserved" && !current.runtime_id && !current.task_id) {
    throw new Error(`${current.id} must attach to its declared runtime kind before becoming active`);
  }
  const timestamp = new Date().toISOString();
  const worker = {
    ...current,
    status,
    current_revision: options.revision ?? current.current_revision,
    evidence: uniqueStrings([...(current.evidence ?? []), ...(options.evidence ?? [])]),
    updated_at: timestamp,
    completed_at: TERMINAL_WORKER_STATUSES.has(status) ? current.completed_at ?? timestamp : current.completed_at
  };
  registry.workers[index] = worker;
  await writeRuntimeWorkerRegistry(target, registry);
  if (TERMINAL_WORKER_STATUSES.has(status)) {
    await releaseWorkerResources(target, worker.id, `worker_${status}`);
    if (status === "cancelled" && current.status === "reserved") {
      const item = await readWorkItem(target, worker.work_item_id);
      if (item.claim?.status === "active" && item.claim.id === worker.claim_id) {
        await releaseWorkItemClaim(target, {
          workItemId: worker.work_item_id,
          agentId: worker.agent_id,
          principalId: worker.principal_id,
          reason: "worker_cancelled_before_attachment"
        });
      }
    }
  }
  await appendEvent(target, {
    timestamp,
    event_type: "runtime_worker_status_changed",
    actor: options.actor ?? worker.agent_id,
    work_item_id: worker.work_item_id,
    worker_id: worker.id,
    from_status: current.status,
    to_status: status,
    revision: worker.current_revision,
    refs: [RUNTIME_WORKER_REGISTRY_RELATIVE_PATH, ...(options.evidence ?? [])]
  });
  return worker;
}

export async function syncUserTaskWorker(target, workerId, taskStatus, revision = null) {
  const statusByTask = { active: "active", waiting: "waiting", attention: "attention", completed: "completed", archived: "completed" };
  return updateRuntimeWorker(target, { workerId, status: statusByTask[taskStatus] ?? "active", revision });
}

export async function listRuntimeWorkers(target) {
  return (await readRuntimeWorkerRegistry(target)).workers;
}
