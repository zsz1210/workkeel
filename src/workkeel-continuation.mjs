import fs from "node:fs/promises";
import path from "node:path";
import { readNativeTask, assertTaskExecutionContext, mutateNativeTask } from "./workkeel-tasks.mjs";
import { safeDirectory } from "./workkeel-project.mjs";
import { durableAtomicCreate, formatJson } from "./files.mjs";
import { executionDigest, exactKeys, EXECUTION_ID } from "./workkeel-execution-policy.mjs";
import { captureContinuationState } from "./workkeel-continuation-state.mjs";
import { executeWorkflow, planWorkflow, readWorkflowRun, readExecutionRecord, lockWorkflowDirectory } from "./workkeel-workflows.mjs";

const refFor = id => {
  if (!EXECUTION_ID.test(id ?? "") || ["constructor", "prototype"].includes(id)) throw Error("Invalid continuation run ID");
  return `.ai-org/execution/${id}`;
};
async function absent(target, ref) {
  try { await fs.lstat(path.join(target, ref)); return false; } catch (error) { if (error.code === "ENOENT") return true; throw error; }
}
const wrap = value => formatJson({ value, sha256: executionDigest(value) });
function checkRequest(request, executing) {
  exactKeys(request, ["source_run_id", "actor", "workflow_ref", "policy_ref", "run_id"], executing ? ["expected_plan", "material_refs"] : ["material_refs"]);
  refFor(request.source_run_id); refFor(request.run_id);
  if (request.source_run_id === request.run_id) throw Error("Continuation needs a distinct successor run");
  if (executing && typeof request.expected_plan !== "string") throw Error("Continuation needs the inspected expected plan");
}

async function inspect(target, request, { locked = false, intent = null } = {}) {
  const ref = refFor(request.source_run_id);
  const original = await readWorkflowRun(target, request.source_run_id);
  if (!intent && !await absent(target, refFor(request.run_id))) throw Error("Successor run already exists");
  const item = await readNativeTask(target, original.request.task_id);
  if (!item.claim) throw Error("Continuation requires a current implementation claim");
  await assertTaskExecutionContext(target, item.id, { actor: request.actor, claim_id: item.claim.id, contract_sha256: original.identity.pins.contract });
  if (!intent && item.claim.id !== original.request.claim_id) throw Error("Original implementation claim changed");
  if (!locked && !await absent(target, `${ref}/runner.lock`)) throw Error("Original runner cleanup is unconfirmed");
  if (!await absent(target, `${ref}/cancel.json`)) throw Error("Explicitly cancelled workflows cannot continue");
  if (!["blocked", "cancelled"].includes(original.status.state)) throw Error("Source run is not a stopped interrupted run");
  const settlement = await readExecutionRecord(target, `${ref}/settlement.json`);
  if (settlement.run_id !== request.source_run_id || settlement.cleanup !== "confirmed" || !settlement.partial ||
      executionDigest(settlement.pins) !== executionDigest(original.identity.pins)) throw Error("Confirmed cleanup and partial-source receipt required");
  const inventory = await readExecutionRecord(target, `${ref}/operations-index.json`);
  const names = (await fs.readdir(await safeDirectory(target, `${ref}/operations`))).sort();
  if (!Array.isArray(inventory) || new Set(inventory).size !== inventory.length ||
      executionDigest(names) !== executionDigest(inventory.map(id => `${id}.json`).sort()) || settlement.operations.length !== inventory.length) throw Error("Operation inventory changed");
  const operations = [];
  for (const id of inventory) {
    if (!EXECUTION_ID.test(id)) throw Error("Invalid operation ID");
    const op = await readExecutionRecord(target, `${ref}/operations/${id}.json`);
    if (op.id !== id || op.run_id !== request.source_run_id || !op.result ||
        settlement.operations.find(p => p.id === id)?.sha256 !== executionDigest(op) ||
        !["completed", "interrupted"].includes(op.result.status)) throw Error("Uncertain or changed prior operation");
    operations.push({ id, status: op.result.status, conversation_id: op.result.conversation_id });
  }
  if (!operations.some(op => op.status === "interrupted")) throw Error("No confirmed interrupted operation");
  const partial = await captureContinuationState(target, item.contract.environment.write_paths);
  if (executionDigest(partial) !== executionDigest(settlement.partial)) throw Error("Partial source or HEAD changed since interruption");
  // This checks current contract policy pins and source refs, without launching a provider.
  const next = await planWorkflow(target, { task_id: item.id, actor: request.actor, claim_id: item.claim.id,
    workflow_ref: request.workflow_ref, policy_ref: request.policy_ref, ...(request.material_refs ? { material_refs: request.material_refs } : {}) });
  const body = { schema_version: "workkeel.continuation-plan/v1", task_id: item.id,
    source_run_id: request.source_run_id, run_id: request.run_id, original_claim_id: original.request.claim_id,
    actor: request.actor, workflow_ref: request.workflow_ref, policy_ref: request.policy_ref,
    ...(request.material_refs ? { material_refs: request.material_refs } : {}),
    settlement_sha256: executionDigest(settlement), pins: next.pins, partial, operations };
  return { ...body, sha256: executionDigest(body), execution_authorized: false, next_action: "continue-confirmed-interruption" };
}

export async function planContinuation(target, request) {
  checkRequest(request, false);
  const ref = `${refFor(request.source_run_id)}/successor.json`;
  if (!await absent(target, ref)) {
    const prior = await readExecutionRecord(target, ref);
    return { schema_version: "workkeel.continuation-plan/v1", next_action: "inspect-existing-successor", run_id: prior.request.run_id, execution_authorized: false };
  }
  return inspect(target, request);
}

/** Public, read-only projection. No prompt, source contents or conversation IDs. */
export async function readContinuationView(target, id) {
  try {
    const original = await readWorkflowRun(target, id);
    const plan = await planContinuation(target, { source_run_id: id, run_id: `preview-${executionDigest(id).slice(0,24)}`,
      actor: original.request.actor, workflow_ref: original.request.workflow_ref, policy_ref: original.request.policy_ref });
    return { source_run_id: id, status: plan.next_action === "inspect-existing-successor" ? "successor-recorded" : "confirmed-interruption",
      execution_authorized: false, next_action: plan.next_action === "inspect-existing-successor" ? "Inspect the recorded successor; do not create another continuation." :
        "Prepare current takeover material and inspect a continuation plan before dispatch." };
  } catch (error) {
    const reasons = [[/claim|authorization|policy|expired|authority/i,"authority-or-claim-changed"],
      [/cleanup|runner|lock/i,"cleanup-unconfirmed"],[/cancelled/i,"cancelled"],
      [/Partial source|HEAD|source refs/i,"source-changed"],[/operation|inventory/i,"operation-unconfirmed"]];
    return { source_run_id: id, status: "unavailable", execution_authorized: false,
      reason: reasons.find(([pattern])=>pattern.test(error.message))?.[1] ?? "evidence-unavailable",
      next_action: "Inspect continuation evidence locally; this view does not authorize execution." };
  }
}

/** One durable successor, normal release/claim, fresh execution guards, never replay the old operation. */
export async function continueWorkflow(target, request, options = {}) {
  checkRequest(request, true);
  const ref = refFor(request.source_run_id), dir = await safeDirectory(target, ref);
  const unlock = await lockWorkflowDirectory(dir);
  try {
    let intent;
    if (!await absent(target, `${ref}/successor.json`)) {
      intent = await readExecutionRecord(target, `${ref}/successor.json`);
      if (executionDigest(intent.request) !== executionDigest(request)) throw Error("An existing continuation is bound to another request");
      if (!await absent(target, `${refFor(request.run_id)}/run.json`)) {
        // This is inspection, not an automatic retry of a partially completed successor.
        return { ...(await readWorkflowRun(target, request.run_id)), continuation_replayed: true };
      }
    }
    if (!intent) {
      const plan = await inspect(target, request, { locked: true });
      if (plan.sha256 !== request.expected_plan) throw Error("Stale continuation plan");
      const item = await readNativeTask(target, plan.task_id);
      const suffix = executionDigest({ source: request.source_run_id, successor: request.run_id }).slice(0, 24);
      intent = { request, plan_sha256: plan.sha256, task_id: item.id,
        release: { operation_id: `continue-release-${suffix}`, expected_version: item.version, actor: request.actor,
          claim_id: item.claim.id, summary: `Confirmed interruption ${request.source_run_id}; successor ${request.run_id}` },
        claim: { operation_id: `continue-claim-${suffix}`, expected_version: item.version + 1, actor: request.actor,
          base_revision: plan.partial.revision } };
      await durableAtomicCreate(path.join(dir, "successor.json"), wrap(intent));
    }
    if (intent.plan_sha256 !== request.expected_plan) throw Error("Stale continuation intent");
    // Lifecycle operations are idempotent for these exact requests. Interrupted
    // initialization is explicit and cannot be rebound to a different successor.
    await mutateNativeTask(target, intent.task_id, "release", intent.release);
    const claimed = await mutateNativeTask(target, intent.task_id, "claim", intent.claim);
    const refreshed = await inspect(target, request, { locked: true, intent });
    if (refreshed.sha256 !== request.expected_plan) throw Error("Continuation changed before dispatch");
    const run = { run_id: request.run_id, task_id: intent.task_id, actor: request.actor, claim_id: claimed.claim.id,
      workflow_ref: request.workflow_ref, policy_ref: request.policy_ref, ...(request.material_refs ? { material_refs: request.material_refs } : {}) };
    return await executeWorkflow(target, run, options);
  } finally { await unlock(); }
}
