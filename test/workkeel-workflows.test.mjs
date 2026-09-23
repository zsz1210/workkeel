import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { initializeTaskProject } from "../src/workkeel-project.mjs";
import { createNativeTask, mutateNativeTask, readNativeTask } from "../src/workkeel-tasks.mjs";
import { executeWorkflow, readWorkflowRun, cancelWorkflow, planWorkflow } from "../src/workkeel-workflows.mjs";
import { selectNodeModel, validateExecutionPolicy } from "../src/workkeel-execution-policy.mjs";
import { validateWorkflow } from "../src/workkeel-workflow-schema.mjs";

const actor = { agent_id: "builder", principal_id: "owner" };
const approval = token => ({ token, approved: true, actor, evidence_ref: "docs/approval.md" });
const policy = () => ({ schema_version: "workkeel.execution-policy/v1",
  models: [{ id: "native", connection: { kind: "native" }, data_classes: ["internal", "public"] }],
  default_model: "native", rules: [], headroom: { mode: "off" },
  limits: { steps: 20, attempts_per_node: 2, parallelism: 2, timeout_ms: 120000, max_cost_usd: null } });
const graph = (nodes = [{ id: "work", kind: "runtime", input: "Write the fixture output" }],
  edges = [{ from: "start", to: "work" }, { from: "work", to: "end" }]) => ({ schema_version: "workkeel.workflow/v1", nodes, edges });
const result = extra => ({ status: "completed", conversation_id: "fixture-thread", output: "fixture completed",
  outcome: "done", observed_model: null, usage: { input_tokens: null, output_tokens: null, cost_usd: null }, ...extra });
const adapter = fn => ({ id: "fixture", assertCompatible: async ({ policy }) => {
  if (policy.limits.max_cost_usd !== null) throw new Error("Fixture has no hard budget enforcement");
}, start: fn ?? (async () => result()), resume: fn ?? (async () => result()), cancel: async () => {} });
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
async function fixture(t, definition = graph(), executionPolicy = policy()) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-workflow-"));
  t.after(() => fs.rm(root, { force: true, recursive: true }));
  git(root, "init", "-q"); git(root, "config", "user.name", "Fixture"); git(root, "config", "user.email", "fixture@example.invalid");
  await initializeTaskProject(root, { schema_version: "workkeel.task-policy/v1", principals: ["owner"], agents: [actor], approvers: ["owner"], review_separation: "distinct-agent" });
  await fs.mkdir(path.join(root, "docs")); await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "docs/approval.md"), "Approved local offline fixture with immutable workflow and execution policy.");
  await fs.writeFile(path.join(root, "docs/workflow.json"), JSON.stringify(definition));
  await fs.writeFile(path.join(root, "docs/execution.json"), JSON.stringify(executionPolicy));
  const contract = { schema_version: "workkeel.task-contract/v1", id: "WK-workflow", goal: "Run approved offline workflow", state: "intake",
    scope: { include: ["fixture"], exclude: ["publication"] }, actor, dependencies: [],
    acceptance: { criteria: ["The fixture completes"], evidence: [] }, handoff: null,
    verification: { risk_tier: "standard", separation: "distinct-agent", implementer: null, reviewer: null, candidate_revision: null },
    environment: { cwd: ".", read_paths: ["src"], write_paths: ["src"], tools: ["node"], resources: [], network: { mode: "none", hosts: [] }, external_actions: [],
      data: { classification: "internal", model_access: "none", policy_refs: ["docs/approval.md", "docs/workflow.json", "docs/execution.json"] } },
    authorization: { approved_by: "owner", approval_ref: "docs/approval.md", operations: ["read", "write", "execute"], expires_at: null }, skills: [],
    execution: { runtime: { kind: "adapter", adapter_id: "fixture", required_features: [] }, model_connection: { kind: "policy", policy_ref: "docs/execution.json" } }, legacy: null };
  git(root, "add", "."); git(root, "commit", "-qm", "fixture");
  await createNativeTask(root, contract, { operation_id: "create", expected_version: 0, actor });
  const claim = await mutateNativeTask(root, contract.id, "claim", { operation_id: "claim", expected_version: 1, actor, base_revision: git(root, "rev-parse", "HEAD") });
  const request = { run_id: "run-one", task_id: contract.id, claim_id: claim.claim.id, actor, workflow_ref: "docs/workflow.json", policy_ref: "docs/execution.json" };
  return { root, request };
}

test("real registered execution persists and completed replay does not dispatch or accept task", async t => {
  const { root, request } = await fixture(t); let calls = 0;
  const host = adapter(async () => { calls++; await fs.writeFile(path.join(root, "src/result.txt"), "executed"); return result(); });
  const completed = await executeWorkflow(root, request, { adapters: [host] });
  assert.equal(completed.status.state, "completed"); assert.equal(completed.status.usage.cost_usd, null);
  assert.equal(await fs.readFile(path.join(root, "src/result.txt"), "utf8"), "executed");
  assert.equal((await executeWorkflow(root, request, { adapters: [host] })).status.state, "completed");
  assert.equal(calls, 1); assert.equal((await readNativeTask(root, request.task_id)).state, "build");
});

test("fan-out/join executes both branches and only then the join", async t => {
  const definition = graph(["left", "right", "join"].map(id => ({ id, kind: "runtime", input: id, write_paths: [] })),
    [{ from: "start", to: "left" }, { from: "start", to: "right" }, { from: ["left", "right"], to: "join" }, { from: "join", to: "end" }]);
  const { root, request } = await fixture(t, definition); const seen = [];
  const host = adapter(async ({ input }) => { seen.push(input.instruction); if (input.instruction === "join") assert.deepEqual(Object.keys(input.previous_results).sort(), ["left", "right"]); return result(); });
  assert.equal((await executeWorkflow(root, request, { adapters: [host] })).status.dispatches, 3);
  assert.equal(seen.at(-1), "join");
});

test("conditional loops and explicit continuation retries are bounded", async t => {
  const definition = graph([{ id: "work", kind: "runtime", input: "work", retry: true }],
    [{ from: "start", to: "work" }, { from: "work", to: "work", outcome: "again" }, { from: "work", to: "end", outcome: "done" }]);
  const p = policy(); p.limits.steps = 3;
  const { root, request } = await fixture(t, definition, p); let calls = 0;
  const host = adapter(async ctx => { calls++; if (calls === 1) return result({ status: "failed", outcome: "retry" });
    if (calls === 2) assert.equal(ctx.conversation_id, "fixture-thread"); return result({ outcome: "again" }); });
  await assert.rejects(executeWorkflow(root, request, { adapters: [host] }), /dispatch limit/); assert.equal(calls, 3);
});

test("approval pauses before actions and resumes only with the exact token", async t => {
  const definition = graph([{ id: "confirm", kind: "approval", input: "Approve local fixture" }, { id: "work", kind: "runtime", input: "work" }],
    [{ from: "start", to: "confirm" }, { from: "confirm", to: "work" }, { from: "work", to: "end" }]);
  const { root, request } = await fixture(t, definition); let calls = 0;
  const host = adapter(async () => { calls++; return result(); });
  const paused = await executeWorkflow(root, request, { adapters: [host] });
  assert.equal(paused.status.state, "awaiting-approval"); assert.equal(calls, 0);
  const entry = paused.status.interrupts[0];
  await assert.rejects(executeWorkflow(root, request, { adapters: [host], approvals: { wrong: { token: entry.value.token, approved: true } } }), /pending interrupt/);
  await assert.rejects(executeWorkflow(root, request, { adapters: [host], approvals: { [entry.id]: approval("wrong-token") } }), /token/);
  assert.equal((await readWorkflowRun(root, request.run_id)).status.state, "awaiting-approval");
  const completed = await executeWorkflow(root, request, { adapters: [host], approvals: { [entry.id]: approval(entry.value.token) } });
  assert.equal(completed.status.state, "completed"); assert.equal(calls, 1);
});

test("uncertain dispatch never repeats and explicit evidence reconciles it", async t => {
  const { root, request } = await fixture(t); let calls = 0;
  const host = adapter(async () => { calls++; throw new Error("Injected post-dispatch disconnect"); });
  await assert.rejects(executeWorkflow(root, request, { adapters: [host] }), /disconnect/);
  await assert.rejects(executeWorkflow(root, request, { adapters: [host] }), /Uncertain/); assert.equal(calls, 1);
  await fs.writeFile(path.join(root, "docs/reconciliation.md"), "Fixture host confirms the operation completed before disconnect.");
  const completed = await executeWorkflow(root, request, { adapters: [host], reconciliations: [{ operation_id: "work-0-0", result: result(), evidence_ref: "docs/reconciliation.md" }] });
  assert.equal(completed.status.state, "completed"); assert.equal(calls, 1);
});

test("stale policy, claim, missing adapter and cost enforcement reject before dispatch", async t => {
  const { root, request } = await fixture(t); let calls = 0;
  const host = adapter(async () => { calls++; return result(); });
  await assert.rejects(executeWorkflow(root, { ...request, claim_id: "stale" }, { adapters: [host] }), /matching/);
  await assert.rejects(executeWorkflow(root, request), /adapter/);
  await fs.writeFile(path.join(root, "docs/execution.json"), JSON.stringify({ ...policy(), default_model: "wrong" }));
  await assert.rejects(executeWorkflow(root, request, { adapters: [host] }), /changed/); assert.equal(calls, 0);
  const p = policy(); p.limits.max_cost_usd = 1; const other = await fixture(t, graph(), p);
  const { run_id, ...planRequest } = other.request;
  await assert.rejects(planWorkflow(other.root, planRequest, [host]), /budget/);
});

test("durable approval resumes in a separate process without repeating preceding work", async t => {
  const definition = graph([{ id: "first", kind: "runtime", input: "first" }, { id: "confirm", kind: "approval", input: "Approve continuation" }, { id: "last", kind: "runtime", input: "last" }],
    [{ from: "start", to: "first" }, { from: "first", to: "confirm" }, { from: "confirm", to: "last" }, { from: "last", to: "end" }]);
  const { root, request } = await fixture(t, definition);
  const paused = await executeWorkflow(root, request, { adapters: [adapter()] });
  const entry = paused.status.interrupts[0];
  const script = `import { executeWorkflow } from ${JSON.stringify(new URL("../src/workkeel-workflows.mjs", import.meta.url).href)};
    import fs from 'node:fs/promises';
    const [target, request, approvals] = JSON.parse(process.argv[1]);
    const step = async ({ input }) => { if(input.instruction !== 'last') throw Error('Repeated first node');
      await fs.writeFile(target+'/src/worker.txt', String(process.pid)); return ${JSON.stringify(result())}; };
    const run = await executeWorkflow(target, request, { approvals, adapters: [{ id:'fixture', assertCompatible:async()=>{}, start:step,resume:step,cancel:async()=>{} }] });
    process.stdout.write(JSON.stringify(run.status));`;
  const status = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script,
    JSON.stringify([root, request, { [entry.id]: approval(entry.value.token) }])], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  assert.equal(status.state, "completed"); assert.equal(status.dispatches, 2);
  assert.notEqual(Number(await fs.readFile(path.join(root, "src/worker.txt"), "utf8")), process.pid);
});

test("corrupt durable checkpoint and journal are rejected, not reset", async t => {
  const { DatabaseSync } = await import("node:sqlite");
  const definition = graph([{ id: "confirm", kind: "approval", input: "Confirm" }], [{ from: "start", to: "confirm" }, { from: "confirm", to: "end" }]);
  const { root, request } = await fixture(t, definition);
  await executeWorkflow(root, request, { adapters: [adapter()] });
  const database = new DatabaseSync(path.join(root, ".ai-org/execution/run-one/checkpoints.sqlite"));
  database.exec("UPDATE checkpoints SET data=x'00'"); database.close();
  await assert.rejects(executeWorkflow(root, request, { adapters: [adapter()] }), /integrity/);
  const other = await fixture(t); const host = adapter(async () => { throw new Error("disconnect"); });
  await assert.rejects(executeWorkflow(other.root, other.request, { adapters: [host] }));
  const file = path.join(other.root, ".ai-org/execution/run-one/operations/work-0-0.json");
  const corrupt = JSON.parse(await fs.readFile(file, "utf8")); corrupt.value.result = result();
  await fs.writeFile(file, JSON.stringify(corrupt));
  await assert.rejects(executeWorkflow(other.root, other.request, { adapters: [host] }), /integrity/);
});

test("same run cannot dispatch concurrently; cancellation aborts the active adapter", async t => {
  const { root, request } = await fixture(t); let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const host = adapter(async ({ signal }) => { entered(); await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true })); return result({ status: "interrupted" }); });
  const running = executeWorkflow(root, request, { adapters: [host] });
  await started;
  await assert.rejects(executeWorkflow(root, request, { adapters: [host] }), /locked/);
  await assert.rejects(executeWorkflow(root, { ...request, run_id: "run-two" }, { adapters: [host] }), /bound to another/);
  await cancelWorkflow(root, request.run_id, { principal_id: actor.principal_id, agent_id: actor.agent_id });
  await assert.rejects(running);
  assert.equal((await readWorkflowRun(root, request.run_id)).status.state, "cancelled");
});

test("model routing is explainable, pinned, data-aware and fails closed", () => {
  const p = policy(); p.models.push({ id: "small", connection: { kind: "gateway", provider: "litellm", base_url: "https://models.example/v1", model: "small-fixed", selection: "fixed", credential_env: "GATEWAY_KEY" }, data_classes: ["public"] });
  p.rules.push({ id: "mechanical", nodes: ["format"], model: "small" });
  const context = { node: "format", dataClass: "public", modelAccess: "approved-connection", network: { mode: "allowlist", hosts: ["models.example"] } };
  const chosen = selectNodeModel(p, context); assert.equal(chosen.reason, "rule:mechanical");
  assert.equal(selectNodeModel(p, { ...context, explicit: "native" }).reason, "explicit");
  assert.throws(() => selectNodeModel(p, { ...context, dataClass: "internal" }), /eligible/);
  assert.throws(() => selectNodeModel(p, { ...context, explicit: "native", pinned: chosen }), /Pinned/);
  assert.throws(() => selectNodeModel(p, { ...context, network: { mode: "none", hosts: [] } }), /boundary/);
  assert.throws(() => validateExecutionPolicy({ ...p, headroom: { mode: "lossy" } }), /Headroom/);
});

test("invalid topology rejects missing endpoints, mixed branches and unsafe joins", () => {
  for (const mutate of [d => { d.nodes.push(d.nodes[0]); }, d => { d.edges[1].to = "absent"; },
    d => { d.nodes.push({ id: "unreachable", kind: "runtime", input: "x" }); },
    d => { d.edges.push({ from: "work", to: "work", outcome: "loop" }); }]) {
    const d = graph(); mutate(d); assert.throws(() => validateWorkflow(d, policy()));
  }
});

test("implicit uneven convergence and overlapping routing rules fail before execution", () => {
  const definition = graph(["a", "b", "c", "join"].map(id => ({ id, kind: "runtime", input: id, write_paths: [] })),
    [{ from: "start", to: "a" }, { from: "start", to: "b" }, { from: "a", to: "join" }, { from: "b", to: "c" }, { from: "c", to: "join" }, { from: "join", to: "end" }]);
  assert.throws(() => validateWorkflow(definition, policy()), /explicit direct join/);
  const p = policy(); p.rules = [{ id: "one", nodes: ["work"], model: "native" }, { id: "two", nodes: ["work"], model: "native" }];
  assert.throws(() => validateExecutionPolicy(p), /overlap/);
});

test("rejection is attributed and terminal; unregistered approval does not poison resume", async t => {
  const definition = graph([{ id: "confirm", kind: "approval", input: "Confirm" }], [{ from: "start", to: "confirm" }, { from: "confirm", to: "end" }]);
  const { root, request } = await fixture(t, definition); const host = adapter();
  const paused = await executeWorkflow(root, request, { adapters: [host] }); const entry = paused.status.interrupts[0];
  await assert.rejects(executeWorkflow(root, request, { adapters: [host], approvals: { [entry.id]: { ...approval(entry.value.token), actor: { agent_id: "unknown", principal_id: "owner" } } } }));
  const rejected = await executeWorkflow(root, request, { adapters: [host], approvals: { [entry.id]: { ...approval(entry.value.token), approved: false } } });
  assert.equal(rejected.status.state, "rejected");
  assert.equal((await executeWorkflow(root, request, { adapters: [host] })).status.state, "rejected");
});

test("missing journal entries and checkpoint files cannot restart an existing run", async t => {
  const { root, request } = await fixture(t); let calls = 0;
  const host = adapter(async () => { calls++; throw new Error("post-effect disconnect"); });
  await assert.rejects(executeWorkflow(root, request, { adapters: [host] }));
  await fs.unlink(path.join(root, ".ai-org/execution/run-one/operations/work-0-0.json"));
  await assert.rejects(executeWorkflow(root, request, { adapters: [host] }), /Missing or unexpected operation/);
  assert.equal(calls, 1);
  const definition = graph([{ id: "confirm", kind: "approval", input: "Confirm" }], [{ from: "start", to: "confirm" }, { from: "confirm", to: "end" }]);
  const other = await fixture(t, definition);
  await executeWorkflow(other.root, other.request, { adapters: [adapter()] });
  await fs.unlink(path.join(other.root, ".ai-org/execution/run-one/checkpoints.sqlite"));
  await assert.rejects(executeWorkflow(other.root, other.request, { adapters: [adapter()] }), { code: "ENOENT" });
});

test("checkpoint row coordinates and deleted rows have integrity protection", async t => {
  const { DatabaseSync } = await import("node:sqlite");
  const definition = graph([{ id: "confirm", kind: "approval", input: "Confirm" }], [{ from: "start", to: "confirm" }, { from: "confirm", to: "end" }]);
  for (const sql of ["UPDATE checkpoints SET parent='wrong'", "UPDATE writes SET task='wrong'", "DELETE FROM writes"]) {
    const { root, request } = await fixture(t, definition);
    await executeWorkflow(root, request, { adapters: [adapter()] });
    const db = new DatabaseSync(path.join(root, ".ai-org/execution/run-one/checkpoints.sqlite")); db.exec(sql); db.close();
    await assert.rejects(executeWorkflow(root, request, { adapters: [adapter()] }), /integrity/);
  }
});

test("runtime and observed models cannot drift within a retried conversation", async t => {
  for (const changed of [{ observed_model: "other" }, { runtime_model: "other" }, { conversation_id: "other" }]) {
    const { root, request } = await fixture(t, graph([{ id: "work", kind: "runtime", input: "work", retry: true }]));
    let calls = 0;
    const host = adapter(async () => ++calls === 1 ? result({ status: "failed", outcome: "retry", observed_model: "backend", runtime_model: "fixed" }) : result({ observed_model: "backend", runtime_model: "fixed", ...changed }));
    await assert.rejects(executeWorkflow(root, request, { adapters: [host] }), /pinned conversation/);
    assert.equal(calls, 2);
  }
});

test("approved fallback only happens after confirmed zero dispatch and within attempt limits", async t => {
  const p = policy(); p.models.push({ id: "second", connection: { kind: "native" }, data_classes: ["internal"] });
  p.fallbacks = [{ node: "work", models: ["native", "second"] }];
  assert.throws(() => validateExecutionPolicy({ ...p, limits: { ...p.limits, attempts_per_node: 1 } }), /fallback sequence/);
  const { root, request } = await fixture(t, graph(), p); const selections = [];
  const host = adapter(async context => {
    selections.push(context.selection.id);
    return selections.length === 1 ? result({ status: "not-started", conversation_id: null, usage: { input_tokens: 0, output_tokens: 0, cost_usd: 0 } }) : result();
  });
  assert.equal((await executeWorkflow(root, request, { adapters: [host] })).status.state, "completed");
  assert.deepEqual(selections, ["native", "second"]);
});

test("cancellation waits for delayed node settlement before releasing the run lock", async t => {
  const { root, request } = await fixture(t); const controller = new AbortController();
  let enter, completed = false; const started = new Promise(resolve => { enter = resolve; });
  const host = adapter(async ({ signal }) => {
    enter(); await new Promise(resolve => signal.addEventListener("abort", () => setTimeout(resolve, 80), { once: true }));
    completed = true; return result({ status: "interrupted" });
  });
  const running = executeWorkflow(root, request, { adapters: [host], signal: controller.signal });
  await started; controller.abort();
  await assert.rejects(running); assert.equal(completed, true);
  await assert.rejects(fs.access(path.join(root, ".ai-org/execution/run-one/runner.lock")), { code: "ENOENT" });
});
test("an unconfirmed host cleanup retains the diagnostic lock even after its promise rejects", async t => {
  const { root, request } = await fixture(t);
  const host = adapter(async () => { const error = new Error("Host descendants may remain"); error.runtimeUnsettled = true; throw error; });
  await assert.rejects(executeWorkflow(root, request, { adapters: [host] }), /runner lock retained/);
  await fs.access(path.join(root, ".ai-org/execution/run-one/runner.lock"));
  const observed = await readWorkflowRun(root, request.run_id);
  assert.equal(observed.status.state, "blocked"); assert.equal(observed.status.external_effects, "uncertain");
});
