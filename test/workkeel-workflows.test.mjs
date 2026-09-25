import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { initializeTaskProject } from "../src/workkeel-project.mjs";
import { createNativeTask, mutateNativeTask, readNativeTask } from "../src/workkeel-tasks.mjs";
import { executeWorkflow, readWorkflowRun, cancelWorkflow, planWorkflow } from "../src/workkeel-workflows.mjs";
import { selectNodeModel, validateExecutionPolicy, executionDigest } from "../src/workkeel-execution-policy.mjs";
import { validateWorkflow } from "../src/workkeel-workflow-schema.mjs";
import { readTaskMeasurements, readWorkflowMeasurements } from "../src/workkeel-measurements.mjs";
import { prepareTaskMaterial, summarizeChecks } from "../src/workkeel-material.mjs";
import { planContinuation, continueWorkflow } from "../src/workkeel-continuation.mjs";
import { captureContinuationState } from "../src/workkeel-continuation-state.mjs";

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
async function fixture(t, definition = graph(), executionPolicy = policy(), expiresAt = null) {
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
    authorization: { approved_by: "owner", approval_ref: "docs/approval.md", operations: ["read", "write", "execute"], expires_at: expiresAt }, skills: [],
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

test("prepared material validates all six work types, selection and source freshness before dispatch", async t => {
  const { root, request } = await fixture(t);
  for (const file of ['code','findings','diff','checkpoint','counterevidence']) await fs.writeFile(path.join(root, `src/${file}.txt`), file);
  git(root, 'add', 'src'); git(root, 'commit', '-qm', 'Pin material source');
  const contract = (await readNativeTask(root, request.task_id)).contract;
  const make = kind => ({kind, instruction:'Perform the named bounded work.', write_paths:['review','rereview','reconsideration'].includes(kind)?[]:['src'],
    materials:[{path:'src/code.txt',use:'required',purpose:'source'}, ...['findings','diff','checkpoint','counterevidence'].map(p=>({path:`src/${p}.txt`,use:'required',purpose:p})),
      {path:'src/absent.txt',use:'reference',purpose:'unused template',kinds:['repair']}],
    ...(['review','rereview','reconsideration'].includes(kind)?{candidate_revision:git(root,'rev-parse','HEAD')}:{}),
    ...(kind==='reconsideration'?{prior_revision:git(root,'rev-parse','HEAD')}:{})});
  for (const kind of ['initial','repair','takeover','review','rereview','reconsideration']) {
    const req=make(kind); if(kind==='repair')req.materials.pop();
    const packet=await prepareTaskMaterial(root,contract,req);
    assert.equal(packet.authority,'navigation-only'); assert.ok(packet.sources.some(x=>x.path==='docs/approval.md'));
    assert.ok(!packet.sources.some(x=>x.path==='src/absent.txt'));
  }
  await assert.rejects(prepareTaskMaterial(root,contract,{...make('reconsideration'),prior_revision:'0'.repeat(40)}),/unchanged/);
  await assert.rejects(prepareTaskMaterial(root,contract,{...make('repair'),materials:[]}),/findings/);
  await assert.rejects(prepareTaskMaterial(root,contract,{...make('initial'),write_paths:['.']}),/scope/);
  const packet=await prepareTaskMaterial(root,contract,make('initial'));
  await fs.writeFile(path.join(root,'docs/material.json'),JSON.stringify(packet));
  let calls=0;
  await executeWorkflow(root,{...request,material_refs:{work:'docs/material.json'}},{adapters:[adapter(async ({input})=>{
    calls++; assert.equal(input.instruction,packet.prompt); return result();
  })]});
  assert.equal(calls,1);
  await fs.writeFile(path.join(root,'src/code.txt'),'changed');
  await assert.rejects(executeWorkflow(root,{...request,material_refs:{work:'docs/material.json'}},{adapters:[adapter(()=>{calls++;return result();})]}),/material changed/i);
  await assert.rejects(prepareTaskMaterial(root,contract,make('review')),/pinned candidate/);
  assert.equal(calls,1);
});

test("exact failure summaries retain all test IDs without upgrading acceptance", () => {
  const summary=summarizeChecks([{id:'a',status:'fail',message:'not implemented'},{id:'b',status:'fail',message:'not implemented'},
    {id:'c',status:'fail',message:'different'},{id:'d',status:'pass',message:'not implemented'}]);
  assert.equal(summary.groups.length,3);assert.deepEqual(summary.groups[0].test_ids,['a','b']);assert.equal(summary.total,4);
  assert.equal(summary.acceptance,'not-established');
});

const continuationRequest = request => ({source_run_id:request.run_id,run_id:'successor',actor,workflow_ref:request.workflow_ref,policy_ref:request.policy_ref});
test("confirmed interrupted continuation creates one fresh claim and never replays the old operation", async t => {
  const {root,request}=await fixture(t);let calls=0;
  const host=adapter(async()=>{calls++;await fs.writeFile(path.join(root,'src/result.txt'),calls===1?'partial':'complete');
    return result(calls===1?{status:'interrupted',outcome:'attention'}:{});});
  await assert.rejects(executeWorkflow(root,request,{adapters:[host]}),/did not complete/);
  const old=await fs.readFile(path.join(root,'.ai-org/execution/run-one/operations/work-0-0.json'),'utf8');
  const req=continuationRequest(request),plan=await planContinuation(root,req);
  const next={...req,expected_plan:plan.sha256};
  const run=await continueWorkflow(root,next,{adapters:[host]});
  assert.equal(run.status.state,'completed');assert.notEqual(run.request.claim_id,request.claim_id);
  assert.equal((await continueWorkflow(root,next,{adapters:[host]})).continuation_replayed,true);
  assert.equal((await planContinuation(root,req)).next_action,'inspect-existing-successor');
  assert.equal(calls,2);assert.equal(await fs.readFile(path.join(root,'.ai-org/execution/run-one/operations/work-0-0.json'),'utf8'),old);
});

test("continuation rejects drift, old receipt replacement, unknown results, cancellation and active locks", async t => {
  for(const mode of ['drift','unknown','cancel','lock','receipt','expired']) await t.test(mode,async t=>{
    const {root,request}=await fixture(t);let calls=0;
    const host=adapter(async()=>{calls++;if(mode==='unknown')throw Error('lost');return result({status:'interrupted',outcome:'attention'});});
    await assert.rejects(executeWorkflow(root,request,{adapters:[host]}),mode==='unknown'?/lost/:/did not complete/);
    const ref=path.join(root,'.ai-org/execution/run-one');
    if(mode==='drift'){
      const old=await fs.readFile(ref+'/settlement.json','utf8');
      await fs.writeFile(path.join(root,'src/drift.txt'),'changed');
      await assert.rejects(executeWorkflow(root,request,{adapters:[host]}));
      assert.equal(await fs.readFile(ref+'/settlement.json','utf8'),old);
    }
    if(mode==='cancel')await cancelWorkflow(root,request.run_id,actor);
    if(mode==='lock')await fs.writeFile(ref+'/runner.lock','active');
    if(mode==='receipt')await fs.unlink(ref+'/settlement.json');
    if(mode==='expired')await fs.writeFile(path.join(root,'docs/approval.md'),'changed authority');
    await assert.rejects(planContinuation(root,continuationRequest(request)));
    assert.equal(calls,1);
  });
});

test("continuation snapshot bounds flat trees and rejects symlinks", async t=>{
  const {root}=await fixture(t);
  await fs.symlink('missing',path.join(root,'src/link'));
  await assert.rejects(captureContinuationState(root,['src']),/Unsafe/);
  await fs.unlink(path.join(root,'src/link'));
  await Promise.all(Array.from({length:512},(_,i)=>fs.writeFile(path.join(root,`src/${i}`),'x')));
  await assert.rejects(captureContinuationState(root,['src']),/512/);
});

test("continuation finishes exact initialization interrupted between release and claim", async t=>{
  const {root,request}=await fixture(t),host=adapter(async()=>result({status:'interrupted',outcome:'attention'}));
  await assert.rejects(executeWorkflow(root,request,{adapters:[host]}));
  const req=continuationRequest(request),plan=await planContinuation(root,req),next={...req,expected_plan:plan.sha256};
  const item=await readNativeTask(root,request.task_id),suffix=executionDigest({source:request.run_id,successor:req.run_id}).slice(0,24);
  const intent={request:next,plan_sha256:plan.sha256,task_id:item.id,
    release:{operation_id:`continue-release-${suffix}`,expected_version:item.version,actor,claim_id:item.claim.id,summary:`Confirmed interruption ${request.run_id}; successor ${req.run_id}`},
    claim:{operation_id:`continue-claim-${suffix}`,expected_version:item.version+1,actor,base_revision:plan.partial.revision}};
  await fs.writeFile(path.join(root,'.ai-org/execution/run-one/successor.json'),JSON.stringify({value:intent,sha256:executionDigest(intent)}));
  await mutateNativeTask(root,item.id,'release',intent.release);
  assert.equal((await readNativeTask(root,item.id)).claim,null);
  let calls=0;const finished=await continueWorkflow(root,next,{adapters:[adapter(async()=>{calls++;return result();})]});
  assert.equal(finished.status.state,'completed');assert.equal(calls,1);
});

test("expired approval and stale planned source block continuation without provider calls",async t=>{
  const now=Date.now(),{root,request}=await fixture(t,graph(),policy(),new Date(now+60000).toISOString());
  await assert.rejects(executeWorkflow(root,request,{adapters:[adapter(async()=>result({status:'interrupted',outcome:'attention'}))]}));
  const req=continuationRequest(request),plan=await planContinuation(root,req);let calls=0;
  await fs.writeFile(path.join(root,'src/new.txt'),'drift after preview');
  await assert.rejects(continueWorkflow(root,{...req,expected_plan:plan.sha256},{adapters:[adapter(async()=>{calls++;return result();})]}),/changed/);
  await fs.unlink(path.join(root,'src/new.txt'));
  t.mock.timers.enable({apis:['Date'],now:now+120000});
  await assert.rejects(planContinuation(root,req),/expired/i);assert.equal(calls,0);
});

test("prepared CLI is read-only and its packet runs through the ordinary workflow entry",async t=>{
  const {root,request}=await fixture(t);
  const material={kind:'initial',instruction:'Write the fixture output',write_paths:['src'],materials:[]};
  await fs.writeFile(path.join(root,'docs/request.json'),JSON.stringify(material));
  const before=git(root,'status','--porcelain');
  const cli=new URL('../bin/workkeel.mjs',import.meta.url).pathname;
  const packet=JSON.parse(execFileSync(process.execPath,[cli,'context','prepare',root,'--id',request.task_id,'--request','docs/request.json'],{encoding:'utf8'}));
  assert.equal(git(root,'status','--porcelain'),before);assert.equal(packet.request.kind,'initial');
  await fs.writeFile(path.join(root,'docs/material.json'),JSON.stringify(packet));
  const planRequest={...request,material_refs:{work:'docs/material.json'}};delete planRequest.run_id;
  await fs.writeFile(path.join(root,'docs/plan.json'),JSON.stringify(planRequest));
  const plan=JSON.parse(execFileSync(process.execPath,[cli,'workflow','plan',root,'--request','docs/plan.json'],{encoding:'utf8'}));
  assert.equal(plan.provider_contact,false);assert.ok(plan.pins.materials.work);
});

test("task measurements persist live snapshots and failure timing without granting replay", async t => {
  const { root, request } = await fixture(t);
  assert.equal((await readTaskMeasurements(root, request.task_id)).coverage, "unobserved");
  let live;
  const host = adapter(async ({ observe }) => {
    const snapshot = { runtime_model: "fixture-confirmed", observed_model: null, usage: { input_tokens: 25, output_tokens: 6, cost_usd: null } };
    await observe(snapshot); await observe(snapshot);
    live = await readTaskMeasurements(root, request.task_id);
    throw new Error("Disconnected after token observation");
  });
  await assert.rejects(executeWorkflow(root, request, { adapters: [host] }), /Disconnected/);
  assert.equal(live.usage.input_tokens.known_subtotal, 25); assert.equal(live.usage.input_tokens.total, null);
  const metrics = await readTaskMeasurements(root, request.task_id);
  assert.equal(metrics.runs[0].runner_state, "blocked"); assert.equal(metrics.runs[0].operations[0].state, "unresolved");
  assert.equal(metrics.runs[0].operations[0].runtime_model, "fixture-confirmed");
  assert.ok(metrics.timing.adapter_work_ms > 0); assert.equal(metrics.usage.output_tokens.known_subtotal, 6);
  assert.equal(metrics.usage.output_tokens.total, null);
  await assert.rejects(executeWorkflow(root, request, { adapters: [host] }), /Uncertain/);
  assert.deepEqual((await readTaskMeasurements(root, request.task_id)).usage, metrics.usage);
});

test("task metrics CLI is read-only, replay-safe and omits result content", async t => {
  const { root, request } = await fixture(t);
  const host = adapter(async () => result({ runtime_model: "fixture-confirmed", usage: { input_tokens: 30, output_tokens: 5, cost_usd: null } }));
  await executeWorkflow(root, request, { adapters: [host] });
  const first = await readWorkflowMeasurements(root, request.run_id);
  await executeWorkflow(root, request, { adapters: [host] });
  const second = await readWorkflowMeasurements(root, request.run_id);
  assert.deepEqual(first.usage, second.usage); assert.equal(first.wall_elapsed_ms, second.wall_elapsed_ms);
  const before = git(root, "status", "--porcelain");
  const cli = new URL("../bin/workkeel.mjs", import.meta.url).pathname;
  const task = JSON.parse(execFileSync(process.execPath, [cli, "task", "metrics", root, "--id", request.task_id], { encoding: "utf8" }));
  assert.equal(task.usage.input_tokens.total, 30); assert.equal(task.usage.cost_usd.total, null);
  assert.equal(task.task_state, "build"); assert.equal(task.mutation_status, "no-write");
  assert.equal(JSON.stringify(task).includes("fixture completed"), false);
  assert.equal(git(root, "status", "--porcelain"), before);
  const workflow = JSON.parse(execFileSync(process.execPath, [cli, "workflow", "metrics", root, "--id", request.run_id], { encoding: "utf8" }));
  assert.equal(workflow.usage.output_tokens.total, 5);
  await fs.unlink(path.join(root, ".ai-org/execution/run-one/operations/work-0-0.json"));
  await assert.rejects(readTaskMeasurements(root, request.task_id), /Incomplete measurement/);
});

test("retries preserve each operation and missing resume usage makes totals incomplete", async t => {
  const { root, request } = await fixture(t, graph([{ id: "work", kind: "runtime", input: "work", retry: true }]));
  let count = 0;
  await executeWorkflow(root, request, { adapters: [adapter(async () => ++count === 1 ?
    result({ status: "failed", outcome: "retry", usage: { input_tokens: 10, output_tokens: 2, cost_usd: null } }) : result())] });
  const metrics = await readTaskMeasurements(root, request.task_id);
  assert.equal(metrics.runs[0].operations.length, 2); assert.equal(metrics.usage.input_tokens.total, null);
  assert.equal(metrics.usage.input_tokens.known_subtotal, 10); assert.equal(metrics.timing.measured_operations, 2);
});

test("aggregate usage status agrees with persisted measurements at numeric boundaries", async t => {
  const maximum = Number.MAX_SAFE_INTEGER;
  const definition = graph(["first", "second"].map(id => ({ id, kind: "runtime", input: id })),
    [{ from: "start", to: "first" }, { from: "first", to: "second" }, { from: "second", to: "end" }]);
  for (const { name, first, second, expected } of [
    { name: "unsafe input", first: { input_tokens: maximum, output_tokens: 2, cost_usd: 0.1 },
      second: { input_tokens: 1, output_tokens: 3, cost_usd: 0.2 },
      expected: { input_tokens: null, output_tokens: 5, cost_usd: 0.1 + 0.2 } },
    { name: "unsafe output and nonfinite cost", first: { input_tokens: 1, output_tokens: maximum, cost_usd: 1e308 },
      second: { input_tokens: 2, output_tokens: 1, cost_usd: 1e308 },
      expected: { input_tokens: 3, output_tokens: null, cost_usd: null } },
    { name: "exact safe boundary and fractional cost", first: { input_tokens: maximum - 1, output_tokens: maximum, cost_usd: 0.25 },
      second: { input_tokens: 1, output_tokens: 0, cost_usd: 0.125 },
      expected: { input_tokens: maximum, output_tokens: maximum, cost_usd: 0.375 } },
    { name: "unknown usage", first: { input_tokens: 1, output_tokens: 0, cost_usd: null },
      second: { input_tokens: null, output_tokens: 2, cost_usd: 0.25 },
      expected: { input_tokens: null, output_tokens: 2, cost_usd: null } }
  ]) {
    await t.test(name, async t => {
      const { root, request } = await fixture(t, definition);
      let calls = 0;
      const host = adapter(async () => result({ usage: ++calls === 1 ? first : second }));
      const run = await executeWorkflow(root, request, { adapters: [host] });
      assert.equal(run.status.state, "completed"); assert.equal(run.status.dispatches, 2);
      assert.deepEqual(run.status.usage, expected);
      const metrics = await readWorkflowMeasurements(root, request.run_id);
      for (const [key, value] of Object.entries(expected)) {
        assert.equal(metrics.usage[key].total, value);
        assert.equal(metrics.usage[key].complete, value !== null);
      }
      assert.deepEqual((await readWorkflowRun(root, request.run_id)).status.usage, expected);
      assert.deepEqual((await executeWorkflow(root, request, { adapters: [host] })).status.usage, expected);
      assert.equal(calls, 2);
    });
  }
});

test("confirmed empty dispatch usage remains zero in status and measurements", async t => {
  const definition = graph([{ id: "confirm", kind: "approval", input: "Confirm" }],
    [{ from: "start", to: "confirm" }, { from: "confirm", to: "end" }]);
  const { root, request } = await fixture(t, definition);
  const host = adapter(async () => { throw new Error("Approval-only workflow must not dispatch"); });
  const paused = await executeWorkflow(root, request, { adapters: [host] });
  const entry = paused.status.interrupts[0];
  const completed = await executeWorkflow(root, request, { adapters: [host], approvals: { [entry.id]: approval(entry.value.token) } });
  const zero = { input_tokens: 0, output_tokens: 0, cost_usd: 0 };
  assert.equal(completed.status.state, "completed"); assert.equal(completed.status.dispatches, 0);
  assert.deepEqual(completed.status.usage, zero);
  const metrics = await readWorkflowMeasurements(root, request.run_id);
  for (const key of Object.keys(zero)) {
    assert.equal(metrics.usage[key].total, 0);
    assert.equal(metrics.usage[key].complete, true);
  }
  assert.deepEqual((await readWorkflowRun(root, request.run_id)).status.usage, zero);
});

test("task totals include multiple runs without claiming visibility into native sessions", async t => {
  const { root, request } = await fixture(t);
  const host = adapter(async () => result({ usage: { input_tokens: 10, output_tokens: 3, cost_usd: null } }));
  await executeWorkflow(root, request, { adapters: [host] });
  await mutateNativeTask(root, request.task_id, "release", { operation_id: "release", expected_version: 2, actor, claim_id: request.claim_id, summary: "Continue in a new authorized execution run" });
  const next = await mutateNativeTask(root, request.task_id, "claim", { operation_id: "claim-next", expected_version: 3, actor, base_revision: git(root, "rev-parse", "HEAD") });
  await executeWorkflow(root, { ...request, run_id: "run-two", claim_id: next.claim.id }, { adapters: [host] });
  const metrics = await readTaskMeasurements(root, request.task_id);
  assert.equal(metrics.runs.length, 2); assert.equal(metrics.usage.input_tokens.total, 20);
  assert.equal(metrics.coverage, "recorded-workflow-runs-only");
  const file = path.join(root, ".ai-org/execution/run-two/operations/work-0-0.json");
  const before = JSON.parse(await fs.readFile(file, "utf8")); before.value.result.usage.input_tokens = 999;
  await fs.writeFile(file, JSON.stringify(before));
  await assert.rejects(readTaskMeasurements(root, request.task_id), /integrity/);
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
