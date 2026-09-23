import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { durableAtomicCreate, durableAtomicWrite, formatJson } from "./files.mjs";
import { readTaskContractInput, readTaskFile } from "./task-contract.mjs";
import { safeDirectory, assertActor, readTaskProject } from "./workkeel-project.mjs";
import { assertTaskExecutionContext } from "./workkeel-tasks.mjs";
import { executionDigest, exactKeys, EXECUTION_ID, validateExecutionPolicy, selectNodeModel, validateRuntimeAdapter, validateRuntimeResult } from "./workkeel-execution-policy.mjs";
import { validateWorkflow } from "./workkeel-workflow-schema.mjs";

const runRef = id => {
  if (!EXECUTION_ID.test(id ?? "") || ["constructor", "prototype"].includes(id)) throw new Error("Invalid workflow run ID");
  return `.ai-org/execution/${id}`;
};
const envelope = value => formatJson({ value, sha256: executionDigest(value) });
const sameActor = (one, two) => one.agent_id === two.agent_id && one.principal_id === two.principal_id;
async function boundedCompatibility(adapter, context, signal) {
  signal?.throwIfAborted();
  let timer, abort;
  try {
    await Promise.race([adapter.assertCompatible({ ...context, signal }), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Runtime compatibility check timed out")), 5000);
      abort = () => reject(new Error("Workflow cancelled during compatibility check"));
      signal?.addEventListener("abort", abort, { once: true });
    })]);
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}
async function readRecord(target, relative) {
  const { document } = await readTaskContractInput(target, relative);
  exactKeys(document, ["value", "sha256"]);
  if (executionDigest(document.value) !== document.sha256) throw new Error("Execution record integrity failure");
  return document.value;
}
async function optionalRecord(target, relative) {
  try { return await readRecord(target, relative); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
async function lockRun(directory) {
  const file = path.join(directory, "runner.lock");
  const token = crypto.randomUUID();
  // A crashed runner leaves a diagnostic lock. Explicit recovery checks its
  // original local process; expiry alone must never allow a second dispatcher.
  try { await durableAtomicCreate(file, formatJson({ pid: process.pid, host: os.hostname(), token })); }
  catch (error) { if (error.code === "EEXIST") throw new Error("Workflow is locked; stop/reconcile its runner before explicit lock recovery"); throw error; }
  return async () => {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Runner lock changed");
    const current = JSON.parse(await fs.readFile(file, "utf8"));
    if (current.token !== token) throw new Error("Runner lock ownership changed");
    await fs.unlink(file);
  };
}
async function loadInputs(target, request) {
  const task = await assertTaskExecutionContext(target, request.task_id, request);
  const { contract } = task;
  if (contract.execution.runtime.kind !== "adapter") throw new Error("Automatic workflows require an approved adapter runtime");
  if (![request.workflow_ref, request.policy_ref].every(ref => contract.environment.data.policy_refs.includes(ref))) throw new Error("Workflow and execution policy must be pinned task policy references");
  const workflow = await readTaskContractInput(target, request.workflow_ref);
  const policy = await readTaskContractInput(target, request.policy_ref);
  validateExecutionPolicy(policy.document); validateWorkflow(workflow.document, policy.document);
  const under = (file, root) => root === "." || file === root || file.startsWith(`${root}/`);
  const nodeContracts = {}, canonicalRoots = {};
  for (const node of workflow.document.nodes) {
    const roots = node.write_paths ?? contract.environment.write_paths;
    if (roots.some(ref => !contract.environment.write_paths.some(root => under(ref, root)))) throw new Error("Node write paths cannot widen the task contract");
    nodeContracts[node.id] = { ...contract, environment: { ...contract.environment, write_paths: roots } };
    canonicalRoots[node.id] = await Promise.all(roots.map(async root => {
      const resolved = await safeDirectory(target, root);
      const stat = await fs.stat(resolved);
      return { path: resolved, identity: `${stat.dev}:${stat.ino}` };
    }));
  }
  if (policy.document.limits.parallelism > 1) {
    const edges = workflow.document.edges;
    const reach = (id, seen = new Set()) => {
      if (seen.has(id)) return seen;
      seen.add(id);
      for (const edge of edges.filter(e => e.from === id || Array.isArray(e.from) && e.from.includes(id))) reach(edge.to, seen);
      return seen;
    };
    for (const parent of ["start", ...workflow.document.nodes.map(n => n.id)]) {
      const branches = edges.filter(e => e.from === parent && e.outcome === undefined).map(e => reach(e.to));
      for (let a = 0; a < branches.length; a++) for (let b = a + 1; b < branches.length; b++) {
        const left = [...branches[a]].filter(id => !branches[b].has(id) && nodeContracts[id]);
        const right = [...branches[b]].filter(id => !branches[a].has(id) && nodeContracts[id]);
        for (const x of left) for (const y of right) if (canonicalRoots[x].some(one =>
          canonicalRoots[y].some(two => one.identity === two.identity || under(one.path, two.path) || under(two.path, one.path)))) throw new Error("Parallel branches have overlapping write roots; narrow node roots or serialize execution");
      }
    }
  }
  const model = contract.execution.model_connection;
  if (model.kind === "policy" ? model.policy_ref !== request.policy_ref :
    policy.document.models.some(entry => executionDigest(entry.connection) !== executionDigest(model))) throw new Error("Model policy differs from the approved contract connection");
  const selections = {}, fallbacks = {};
  for (const node of workflow.document.nodes.filter(n => n.kind === "runtime")) {
    const select = explicit => selectNodeModel(policy.document, { node: node.id, explicit, dataClass: contract.environment.data.classification,
      modelAccess: contract.environment.data.model_access, network: contract.environment.network });
    selections[node.id] = select(node.model ?? null);
    const fallback = policy.document.fallbacks?.find(entry => entry.node === node.id);
    if (fallback) {
      if (fallback.models[0] !== selections[node.id].id) throw new Error("Fallback sequence must start with the selected model");
      fallbacks[node.id] = fallback.models.slice(1).map(id => ({ ...select(id), reason: "approved-fallback-before-dispatch" }));
    }
  }
  return { task, nodeContracts, definition: workflow.document, policy: policy.document, selections, fallbacks,
    pins: { contract: task.contract_sha256, workflow: workflow.digest, policy: policy.digest } };
}

export async function planWorkflow(target, request, adapters = []) {
  exactKeys(request, ["task_id", "actor", "claim_id", "workflow_ref", "policy_ref"]);
  const input = await loadInputs(target, request);
  const adapter = adapters.find(a => a.id === input.task.contract.execution.runtime.adapter_id);
  if (adapter) {
    validateRuntimeAdapter(adapter);
    for (const selection of [...Object.values(input.selections), ...Object.values(input.fallbacks).flat()]) await boundedCompatibility(adapter, { target, contract: input.task.contract, policy: input.policy, selection });
  }
  return { schema_version: "workkeel.workflow-plan/v1", pins: input.pins, selections: input.selections, fallbacks: input.fallbacks,
    runtime: input.task.contract.execution.runtime, adapter_available: Boolean(adapter),
    execution_authorized: false, provider_contact: false, limits: input.policy.limits };
}

export async function readWorkflowRun(target, id) {
  const ref = runRef(id);
  const run = await readRecord(target, `${ref}/run.json`);
  const status = await optionalRecord(target, `${ref}/status.json`);
  return { ...run, status: status ?? { state: "created" }, task_acceptance: "not-performed" };
}

export async function cancelWorkflow(target, id, actor) {
  const ref = runRef(id);
  const run = await readRecord(target, `${ref}/run.json`);
  const project = await readTaskProject(target); assertActor(project.policy, actor);
  if (!sameActor(actor, run.request.actor) && !project.policy.approvers.includes(actor.principal_id)) throw new Error("Cancellation requires the run owner or approving Principal");
  const directory = await safeDirectory(target, ref);
  if (!await optionalRecord(target, `${ref}/cancel.json`)) await durableAtomicCreate(path.join(directory, "cancel.json"), envelope({ actor, at: new Date().toISOString() }));
  return { run_id: id, cancellation: "requested", external_effects: "not-yet-confirmed" };
}

export async function recoverWorkflowLock(target, id, actor) {
  const ref = runRef(id); const run = await readRecord(target, `${ref}/run.json`);
  await assertTaskExecutionContext(target, run.request.task_id, { ...run.request, actor });
  const directory = await safeDirectory(target, ref);
  const input = await readTaskContractInput(target, `${ref}/runner.lock`);
  const owner = input.document;
  if (owner.host !== os.hostname() || !Number.isSafeInteger(owner.pid) || owner.pid < 1) throw new Error("Only a provably stopped local runner can be recovered");
  try { process.kill(owner.pid, 0); throw new Error("Runner process still exists; recovery refused"); }
  catch (error) { if (error.code !== "ESRCH") throw error; }
  if ((await readTaskFile(target, `${ref}/runner.lock`)).digest !== input.digest) throw new Error("Runner lock changed during recovery");
  await fs.unlink(path.join(directory, "runner.lock"));
  return { run_id: id, lock_recovered: true, dispatch_performed: false };
}

/** Run a real LangGraph with trusted runtime adapters. No dynamic executable imports from JSON. */
export async function executeWorkflow(targetInput, request, { adapters = [], signal: externalSignal, approvals = {}, reconciliations = [] } = {}) {
  exactKeys(request, ["run_id", "task_id", "actor", "claim_id", "workflow_ref", "policy_ref"]);
  const target = await fs.realpath(targetInput);
  const ref = runRef(request.run_id);
  const input = await loadInputs(target, request);
  const adapter = validateRuntimeAdapter(adapters.find(a => a.id === input.task.contract.execution.runtime.adapter_id));
  externalSignal?.throwIfAborted();
  for (const name of ["LANGSMITH_TRACING", "LANGCHAIN_TRACING", "LANGCHAIN_TRACING_V2"]) {
    if (process.env[name] && !["false", "0"].includes(process.env[name].toLowerCase())) throw new Error("External graph tracing is not approved; disable tracing in this runner environment");
  }
  let engine, Saver;
  try { engine = await import("@langchain/langgraph"); ({ WorkkeelCheckpointSaver: Saver } = await import("./workkeel-checkpoints.mjs")); }
  catch (error) { if (error.code === "ERR_MODULE_NOT_FOUND") throw new Error("Workflow engine unavailable; install Workkeel with optional dependencies enabled"); throw error; }
  const directory = await safeDirectory(target, ref, { create: true });
  await fs.chmod(directory, 0o700);
  const ignoreRef = ".ai-org/execution/.gitignore";
  try { await durableAtomicCreate(path.join(target, ignoreRef), "*\n"); }
  catch (error) { if (error.code !== "EEXIST") throw error; if ((await readTaskFile(target, ignoreRef)).content !== "*\n") throw new Error("Runtime state ignore policy changed; inspect before execution"); }
  const claimsDirectory = await safeDirectory(target, ".ai-org/execution/claims", { create: true });
  const binding = { task_id: request.task_id, claim_id: request.claim_id, run_id: request.run_id };
  const bindingName = `${executionDigest({ task_id: request.task_id, claim_id: request.claim_id })}.json`;
  let existingBinding = false;
  try { await durableAtomicCreate(path.join(claimsDirectory, bindingName), envelope(binding)); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    existingBinding = true;
    if (executionDigest(await readRecord(target, `.ai-org/execution/claims/${bindingName}`)) !== executionDigest(binding)) throw new Error("Task claim is already bound to another workflow run; resume its existing run");
  }
  const unlock = await lockRun(directory);
  let saver, timer;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  externalSignal?.addEventListener("abort", cancel, { once: true });
  if (externalSignal?.aborted) cancel();
  const active = new Map();
  const pendingNodes = new Set();
  let run, writeStatus, validationOnly = false, runtimeUnsettled = false;
  try {
    run = await optionalRecord(target, `${ref}/run.json`);
    if (!run && existingBinding) throw new Error("Bound workflow run record is missing; inspect interrupted initialization before recovery");
    const identity = { request, pins: input.pins, selections: input.selections, fallbacks: input.fallbacks };
    if (Buffer.byteLength(formatJson(identity)) > 524288) throw new Error("Expanded workflow identity exceeds 512 KiB");
    if (run && executionDigest(run.identity) !== executionDigest(identity)) throw new Error("Resume requires the same task, claim, workflow, policy and pinned models");
    const fresh = !run;
    if (fresh) {
      run = { schema_version: "workkeel.workflow-run/v1", run_id: request.run_id, request, identity, checkpoint_generation: crypto.randomUUID(), created_at: new Date().toISOString() };
      await durableAtomicCreate(path.join(directory, "run.json"), envelope(run));
    }
    const previousStatus = await optionalRecord(target, `${ref}/status.json`);
    if (["completed", "cancelled", "rejected"].includes(previousStatus?.state)) return readWorkflowRun(target, request.run_id);
    writeStatus = value => durableAtomicWrite(path.join(directory, "status.json"), envelope({ ...value, at: new Date().toISOString() }));
    const operationsDir = await safeDirectory(target, `${ref}/operations`, { create: true });
    const operations = new Map();
    const inventoryPath = path.join(directory, "operations-index.json");
    if (fresh) await durableAtomicCreate(inventoryPath, envelope([]));
    const inventory = await readRecord(target, `${ref}/operations-index.json`);
    if (!Array.isArray(inventory) || new Set(inventory).size !== inventory.length) throw new Error("Invalid operation journal inventory");
    for (const name of await fs.readdir(operationsDir)) {
      if (!/^[a-z][a-z0-9-]*\.json$/.test(name)) throw new Error("Unexpected operation journal entry");
      const record = await readRecord(target, `${ref}/operations/${name}`);
      if (`${record.id}.json` !== name || record.run_id !== request.run_id || executionDigest(record.pins) !== executionDigest(input.pins)) throw new Error("Operation journal does not match this run");
      operations.set(record.id, record);
    }
    if (inventory.length !== operations.size || inventory.some(id => !operations.has(id))) throw new Error("Missing or unexpected operation journal entry; automatic replay is prohibited");
    let journalWrite = Promise.resolve();
    const createIntent = record => {
      journalWrite = journalWrite.then(async () => {
        // Inventory is durable before dispatch; an interrupted creation leaves
        // an explicit gap requiring recovery, never an invisible side effect.
        await durableAtomicWrite(inventoryPath, envelope([...operations.keys()]));
        await durableAtomicCreate(path.join(operationsDir, `${record.id}.json`), envelope(record));
      });
      return journalWrite;
    };
    for (const decision of reconciliations) {
      exactKeys(decision, ["operation_id", "result", "evidence_ref"]);
      const record = operations.get(decision.operation_id);
      if (!record || record.result) throw new Error("Reconciliation requires an unresolved dispatch intent");
      validateRuntimeResult(decision.result);
      const evidence = await readTaskFile(target, decision.evidence_ref);
      if (!evidence.content.trim()) throw new Error("Reconciliation requires nonempty host evidence");
      const updated = { ...record, result: decision.result, reconciliation: { actor: request.actor, evidence_ref: decision.evidence_ref, sha256: evidence.digest } };
      await durableAtomicWrite(path.join(operationsDir, `${record.id}.json`), envelope(updated)); operations.set(record.id, updated);
    }
    if ([...operations.values()].some(op => !op.result)) throw new Error("Uncertain prior dispatch requires host evidence and explicit reconciliation; it will not be replayed");
    const database = path.join(directory, "checkpoints.sqlite");
    if (fresh) { const handle = await fs.open(database, "wx", 0o600); await handle.close(); }
    const databaseStat = await fs.lstat(database);
    if (!databaseStat.isFile() || databaseStat.isSymbolicLink()) throw new Error("Unsafe checkpoint database");
    saver = new Saver(database, { generation: run.checkpoint_generation, initialize: fresh });
    const { Annotation, StateGraph, START, END, interrupt, Command } = engine;
    const merge = (left, right) => ({ ...left, ...right });
    const State = Annotation.Root({ results: Annotation({ reducer: merge, default: () => ({}) }), visits: Annotation({ reducer: merge, default: () => ({}) }) });
    const builder = new StateGraph(State);
    const stopIfNeeded = async () => {
      await assertTaskExecutionContext(target, request.task_id, { ...request, contract_sha256: input.pins.contract });
      if (Date.now() - Date.parse(run.created_at) >= input.policy.limits.timeout_ms) controller.abort();
      if (await optionalRecord(target, `${ref}/cancel.json`)) controller.abort();
      if (controller.signal.aborted) throw new Error("Workflow cancelled or time limit reached");
    };
    timer = setInterval(() => {
      stopIfNeeded().catch(() => controller.abort());
    }, 200);
    timer.unref();
    for (const selection of [...Object.values(input.selections), ...Object.values(input.fallbacks).flat()]) {
      await stopIfNeeded();
      await boundedCompatibility(adapter, { target, contract: input.task.contract, policy: input.policy, selection }, controller.signal);
    }
    for (const node of input.definition.nodes) builder.addNode(node.id, state => {
      const running = (async () => {
      await stopIfNeeded();
      const visit = Object.hasOwn(state.visits, node.id) ? state.visits[node.id] : 0;
      if (node.kind === "approval") {
        const token = executionDigest({ run: request.run_id, node: node.id, visit, pins: input.pins });
        const decision = interrupt({ node: node.id, prompt: node.input, token });
        exactKeys(decision, ["token", "approved", "actor", "evidence_ref", "evidence_sha256"]);
        if (decision.token !== token || decision.approved !== true) throw new Error("Approval rejected or not bound to this exact workflow step");
        return { visits: { [node.id]: visit + 1 } };
      }
      let selection = input.selections[node.id];
      let result, conversationId = null, fallbackIndex = 0, runtimeModel = null, observedModel = null;
      for (let attempt = 0; attempt < input.policy.limits.attempts_per_node; attempt++) {
        await stopIfNeeded();
        const id = `${node.id}-${visit}-${attempt}`;
        const nodeInput = { instruction: node.input, previous_results: state.results };
        if (Buffer.byteLength(formatJson(nodeInput)) > 262144) throw new Error("Node input exceeds 256 KiB; reduce retained outputs");
        const inputHash = executionDigest(nodeInput);
        const previous = operations.get(id);
        if (previous) {
          if (previous.input_sha256 !== inputHash || previous.model_fingerprint !== selection.fingerprint || !previous.result) throw new Error("Operation replay is uncertain or mismatched");
          result = previous.result;
        } else {
          if (operations.size >= input.policy.limits.steps) throw new Error("Workflow dispatch limit reached");
          const record = { id, run_id: request.run_id, node: node.id, visit, attempt, pins: input.pins,
            model_fingerprint: selection.fingerprint, requested_model: selection.connection.model ?? null,
            model_id: selection.id, selection_reason: selection.reason,
            input_sha256: inputHash, dispatched_at: new Date().toISOString(), result: null };
          operations.set(id, record);
          await createIntent(record);
          const handle = { operation_id: `${request.run_id}:${id}`, conversation_id: conversationId };
          active.set(id, handle);
          const onAbort = () => { Promise.resolve(adapter.cancel(handle)).catch(() => {}); };
          controller.signal.addEventListener("abort", onAbort, { once: true });
          try {
            const context = { target, contract: input.nodeContracts[node.id], policy: input.policy, selection, input: nodeInput,
              operation_id: handle.operation_id, run_id: request.run_id, conversation_id: conversationId, signal: controller.signal };
            context.toolView = async viewRequest => {
              await stopIfNeeded();
              const { workflowToolView } = await import("./workkeel-headroom.mjs");
              return workflowToolView(context, viewRequest);
            };
            result = validateRuntimeResult(await (conversationId ? adapter.resume(context) : adapter.start(context)));
            const updated = { ...record, result, completed_at: new Date().toISOString() };
            await durableAtomicWrite(path.join(operationsDir, `${id}.json`), envelope(updated)); operations.set(id, updated);
          } catch (error) {
            if (error?.runtimeUnsettled === true) runtimeUnsettled = true;
            throw error;
          } finally { active.delete(id); controller.signal.removeEventListener("abort", onAbort); }
        }
        if (conversationId && result.conversation_id !== conversationId) throw new Error("Runtime changed the pinned conversation on resume");
        if (runtimeModel && result.runtime_model && runtimeModel !== result.runtime_model || observedModel && result.observed_model && observedModel !== result.observed_model) throw new Error("Runtime changed the pinned conversation model");
        if (selection.connection.kind === "codex-subscription" && result.runtime_model && result.runtime_model !== selection.connection.model) throw new Error("Runtime-confirmed model differs from selected subscription model");
        runtimeModel ??= result.runtime_model ?? null;
        observedModel ??= result.observed_model;
        if (result.status === "completed") break;
        if (result.status === "not-started" && conversationId === null && input.fallbacks[node.id]?.[fallbackIndex]) {
          selection = input.fallbacks[node.id][fallbackIndex++];
          runtimeModel = null; observedModel = null;
          continue;
        }
        if (!(node.retry && result.status === "failed" && result.outcome === "retry" && result.conversation_id)) throw new Error("Runtime did not complete; no automatic restart or fallback");
        conversationId = result.conversation_id;
      }
      if (result.status !== "completed") throw new Error("Node attempt limit reached");
      return { results: { [node.id]: result }, visits: { [node.id]: visit + 1 } };
      })();
      pendingNodes.add(running);
      running.then(() => pendingNodes.delete(running), () => pendingNodes.delete(running));
      return running;
    });
    const endpoint = id => id === "start" ? START : id === "end" ? END : id;
    const conditional = new Map();
    for (const edge of input.definition.edges) {
      if (edge.outcome === undefined) builder.addEdge(Array.isArray(edge.from) ? edge.from.map(endpoint) : endpoint(edge.from), endpoint(edge.to));
      else { const routes = conditional.get(edge.from) ?? {}; routes[edge.outcome] = endpoint(edge.to); conditional.set(edge.from, routes); }
    }
    for (const [id, routes] of conditional) builder.addConditionalEdges(id, state => {
      const outcome = state.results[id]?.outcome;
      if (!Object.hasOwn(routes, outcome)) throw new Error("Runtime outcome has no approved graph edge");
      return outcome;
    }, routes);
    const graph = builder.compile({ checkpointer: saver });
    const config = { configurable: { thread_id: request.run_id }, recursionLimit: input.policy.limits.steps + input.definition.nodes.length + 2,
      maxConcurrency: input.policy.limits.parallelism, durability: "sync", signal: controller.signal };
    const checkpoint = await saver.getTuple(config);
    const before = checkpoint ? await graph.getState(config) : null;
    const pending = before?.tasks?.flatMap(task => task.interrupts ?? []) ?? [];
    validationOnly = true;
    for (const id of Object.keys(approvals)) if (!pending.some(entry => entry.id === id)) throw new Error("Approval does not match a pending interrupt");
    if (Object.keys(approvals).length && !pending.length) throw new Error("No pending approval");
    const approved = {}, project = await readTaskProject(target);
    let rejected = false;
    for (const [id, decision] of Object.entries(approvals)) {
      exactKeys(decision, ["token", "approved", "actor", "evidence_ref"]);
      if (decision.token !== pending.find(entry => entry.id === id).value.token || typeof decision.approved !== "boolean") throw new Error("Approval token or decision does not match the pending interrupt");
      assertActor(project.policy, decision.actor);
      if (!project.policy.approvers.includes(decision.actor.principal_id)) throw new Error("Approval requires a registered approving Principal");
      const evidence = await readTaskFile(target, decision.evidence_ref);
      if (!evidence.content.trim()) throw new Error("Approval requires nonempty decision evidence");
      approved[id] = { ...decision, evidence_sha256: evidence.digest };
      rejected ||= !decision.approved;
    }
    validationOnly = false;
    if (Object.keys(approved).length) await durableAtomicCreate(path.join(directory, `approval-${crypto.randomUUID()}.json`), envelope({ decisions: approved, at: new Date().toISOString() }));
    if (rejected) {
      await writeStatus({ state: "rejected", dispatches: operations.size, task_acceptance: "not-performed" });
      return readWorkflowRun(target, request.run_id);
    }
    if (pending.length && !Object.keys(approvals).length) {
      await writeStatus({ state: "awaiting-approval", interrupts: pending, dispatches: operations.size });
      return readWorkflowRun(target, request.run_id);
    }
    await stopIfNeeded();
    await writeStatus({ state: "running" });
    await graph.invoke(Object.keys(approved).length ? new Command({ resume: approved }) : checkpoint ? null : {}, config);
    const snapshot = await graph.getState(config);
    const interrupts = snapshot.tasks.flatMap(task => task.interrupts ?? []);
    await writeStatus({ state: interrupts.length ? "awaiting-approval" : snapshot.next.length ? "paused" : "completed",
      interrupts, completed_nodes: Object.keys(snapshot.values.results), dispatches: operations.size,
      usage: { input_tokens: sumUsage(operations, "input_tokens"), output_tokens: sumUsage(operations, "output_tokens"), cost_usd: sumUsage(operations, "cost_usd") } });
    return readWorkflowRun(target, request.run_id);
  } catch (error) {
    if (writeStatus && !validationOnly) await writeStatus({ state: controller.signal.aborted ? "cancelled" : "blocked", reason: "Execution stopped; inspect operation journal and host evidence before continuation", external_effects: "check-operation-journal" });
    // Provider exceptions may contain credentials or prompt data. Do not persist
    // raw exception text. The caller retains its local diagnostic exception.
    throw error;
  } finally {
    clearInterval(timer); externalSignal?.removeEventListener("abort", cancel);
    controller.abort();
    let quiescenceTimer;
    const settled = await Promise.race([
      (async () => {
        const cancellations = await Promise.allSettled([...active.values()].map(handle => adapter.cancel(handle)));
        if (cancellations.some(value => value.status === "rejected" && value.reason?.runtimeUnsettled === true)) runtimeUnsettled = true;
        await Promise.allSettled([...pendingNodes]);
        return true;
      })(),
      new Promise(resolve => { quiescenceTimer = setTimeout(() => resolve(false), 5000); })
    ]);
    clearTimeout(quiescenceTimer);
    if (!settled || runtimeUnsettled) {
      // A host that ignores cancellation may still produce side effects. Keep
      // its lock until the owning process has stopped and evidence is reconciled.
      if (writeStatus) await writeStatus({ state: "blocked", reason: "Runner did not quiesce; diagnostic lock retained", external_effects: "uncertain" });
      if (settled) saver?.close();
      throw new Error("Runtime cancellation did not quiesce; runner lock retained");
    }
    saver?.close(); await unlock();
  }
}
function sumUsage(operations, key) {
  const values = [...operations.values()].map(op => op.result?.usage[key]);
  return values.some(value => value === null || value === undefined) ? null : values.reduce((sum, value) => sum + value, 0);
}
