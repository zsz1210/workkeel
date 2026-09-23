import fs from "node:fs/promises";
import { readTaskContractInput } from "./task-contract.mjs";
import { safeDirectory, existsEntry } from "./workkeel-project.mjs";
import { readNativeTask } from "./workkeel-tasks.mjs";
import { executionDigest, exactKeys, EXECUTION_ID, validateRuntimeResult } from "./workkeel-execution-policy.mjs";

const keys = ["input_tokens", "output_tokens", "cost_usd"];
const unknownUsage = () => Object.fromEntries(keys.map(key => [key, null]));
const finite = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
const timestamp = value => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;

/** Only bounded, non-content observations enter the private execution journal. */
export function validateExecutionObservation(value) {
  exactKeys(value, ["runtime_model", "observed_model", "usage"]);
  validateRuntimeResult({ ...value, status: "completed", conversation_id: null, output: "", outcome: "done" });
  return structuredClone(value);
}

function sum(values, token = false) {
  const total = values.reduce((a, b) => a + b, 0);
  return finite(total) && (!token || Number.isSafeInteger(total)) ? total : null;
}
export function summarizeMeasurements(operations, { observed = true } = {}) {
  const usage = {};
  for (const key of keys) {
    const seen = operations.map(op => op.usage[key]).filter(finite);
    const complete = observed && operations.every(op => op.result_recorded && finite(op.usage[key]));
    const subtotal = observed && (seen.length || !operations.length) ? sum(seen, key !== "cost_usd") : null;
    usage[key] = { total: complete ? subtotal : null, known_subtotal: subtotal,
      observed_operations: seen.length, complete_operations: operations.filter(op => op.result_recorded && finite(op.usage[key])).length,
      total_operations: operations.length, complete: complete && subtotal !== null };
  }
  const measured = operations.map(op => op.adapter_elapsed_ms).filter(finite);
  return { usage, timing: { adapter_work_ms: observed && measured.length === operations.length ? sum(measured) : null,
    known_adapter_work_ms: measured.length || observed && !operations.length ? sum(measured) : null,
    measured_operations: measured.length, total_operations: operations.length,
    meaning: "Sum of measured adapter calls, including setup/tools/cleanup; parallel calls overlap. Not model compute time or run wall time." } };
}

export function projectOperationMeasurement(record) {
  if (record.result) validateRuntimeResult(record.result);
  const observation = record.measurement?.observation ? validateExecutionObservation(record.measurement.observation) : null;
  // Final operation-scoped result supersedes progress, including explicit unknown.
  const usage = record.result?.usage ?? observation?.usage ?? unknownUsage();
  return { operation_id: record.id, node: record.node, visit: record.visit, attempt: record.attempt,
    requested_model: record.requested_model ?? null, runtime_model: record.result?.runtime_model ?? observation?.runtime_model ?? null,
    observed_model: record.result?.observed_model ?? observation?.observed_model ?? null,
    model_id: record.model_id, selection_reason: record.selection_reason,
    state: record.result?.status ?? (record.measurement?.ended_at ? "unresolved" : "unconfirmed"),
    result_recorded: Boolean(record.result), usage: { ...usage },
    usage_source: record.result ? "operation-result" : observation ? "partial-operation-snapshot" : "unavailable",
    dispatched_at: timestamp(record.dispatched_at), completed_at: timestamp(record.completed_at),
    last_observed_at: timestamp(record.measurement?.observed_at), ended_at: timestamp(record.measurement?.ended_at),
    adapter_elapsed_ms: finite(record.measurement?.adapter_elapsed_ms) ? record.measurement.adapter_elapsed_ms : null,
    observed_elapsed_ms: finite(record.measurement?.observed_elapsed_ms) ? record.measurement.observed_elapsed_ms : null };
}

async function record(target, ref) {
  const { document } = await readTaskContractInput(target, ref);
  exactKeys(document, ["value", "sha256"]);
  if (executionDigest(document.value) !== document.sha256) throw new Error("Execution measurement record integrity failure");
  return document.value;
}
const validId = id => EXECUTION_ID.test(id ?? "") && !["constructor", "prototype"].includes(id);

/** No engine import, provider contact, lifecycle mutation or automatic repair. */
export async function readWorkflowMeasurements(target, id, { now = new Date() } = {}) {
  if (!validId(id)) throw new Error("Invalid workflow run ID");
  const ref = `.ai-org/execution/${id}`;
  const run = await record(target, `${ref}/run.json`);
  if (run.run_id !== id || run.request?.run_id !== id) throw new Error("Measurement run identity mismatch");
  const status = await record(target, `${ref}/status.json`).catch(error => { if (error.code === "ENOENT") return { state: "created" }; throw error; });
  const inventory = await record(target, `${ref}/operations-index.json`);
  if (!Array.isArray(inventory) || inventory.some(id => typeof id !== "string" || !/^[a-z][a-z0-9-]{0,99}$/.test(id)) || new Set(inventory).size !== inventory.length) throw new Error("Invalid measurement inventory");
  const directory = await safeDirectory(target, `${ref}/operations`);
  const names = (await fs.readdir(directory)).sort();
  if (JSON.stringify(names) !== JSON.stringify(inventory.map(id => `${id}.json`).sort())) throw new Error("Incomplete measurement journal; retry after writes settle or inspect recovery evidence");
  const operations = [];
  for (const operationId of inventory) {
    const op = await record(target, `${ref}/operations/${operationId}.json`);
    if (op.id !== operationId || op.run_id !== id || executionDigest(op.pins) !== executionDigest(run.identity.pins)) throw new Error("Measurement operation binding mismatch");
    operations.push(projectOperationMeasurement(op));
  }
  const refreshed = await record(target, `${ref}/operations-index.json`);
  const latestStatus = await record(target, `${ref}/status.json`).catch(error => { if (error.code === "ENOENT") return { state: "created" }; throw error; });
  if (executionDigest(inventory) !== executionDigest(refreshed) || executionDigest(status) !== executionDigest(latestStatus)) throw new Error("Measurement snapshot changed; retry the read");
  const end = ["completed", "cancelled", "rejected"].includes(status.state) ? timestamp(status.at) : now.toISOString();
  const span = timestamp(run.created_at) && end ? Date.parse(end) - Date.parse(run.created_at) : null;
  return { schema_version: "workkeel.workflow-measurements/v1", authority: "observation-only", mutation_status: "no-write",
    run_id: id, task_id: run.request.task_id, runner_state: status.state, read_at: now.toISOString(),
    created_at: timestamp(run.created_at), wall_elapsed_ms: finite(span) ? span : null,
    wall_time_basis: "Since run creation, including waits and downtime; terminal runs stop at status timestamp. Not active execution time.",
    progress: { recorded_attempts: operations.length, completed_attempts: operations.filter(op => op.state === "completed").length,
      unresolved_attempts: operations.filter(op => !op.result_recorded).length, percent: null },
    ...summarizeMeasurements(operations), operations, task_acceptance: "not-performed" };
}

export async function readTaskMeasurements(target, id) {
  const task = await readNativeTask(target, id);
  const runs = [];
  if (await existsEntry(target, ".ai-org/execution")) {
    const directory = await safeDirectory(target, ".ai-org/execution");
    for (const entry of (await fs.readdir(directory)).sort()) {
      if ([".gitignore", "claims"].includes(entry)) continue;
      if (!validId(entry)) throw new Error("Unexpected execution entry; task measurements are incomplete");
      // Validate paths and identities even while selecting relevant runs. Never
      // silently skip a corrupt or initializing run and report a complete total.
      const run = await record(target, `.ai-org/execution/${entry}/run.json`);
      if (run.run_id !== entry || run.request?.run_id !== entry) throw new Error("Measurement run identity mismatch");
      if (run.request.task_id === id) runs.push(await readWorkflowMeasurements(target, entry));
    }
  }
  const operations = runs.flatMap(run => run.operations);
  return { schema_version: "workkeel.task-measurements/v1", authority: "observation-only", mutation_status: "no-write",
    task_id: id, task_state: task.state, read_at: new Date().toISOString(),
    coverage: runs.length ? "recorded-workflow-runs-only" : "unobserved",
    ...summarizeMeasurements(operations, { observed: runs.length > 0 }), runs,
    limitations: ["No observation of arbitrary native-host sessions or other Codex app tasks.",
      "Unknown is null, never an inferred zero. Live snapshots are point-in-time observations, not transactional across runs.",
      "Partial snapshots are not final totals. No token-to-subscription-quota or dollar conversion.",
      "Measurements do not accept tasks or establish model quality."] };
}
