import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { fixture, cli, git, itemState } from "./helpers/lean-delivery-fixture.mjs";
import { openDelivery, checkDelivery, finishDelivery, inspectDelivery } from "../src/daily-delivery.mjs";
import { readSession, validatePlan } from "../src/delivery-ledger.mjs";
import { runLocalChecks } from "../src/delivery-check.mjs";

export const autonomousPlan = () => ({ schema_version: "temple.delivery-plan/v2", execution_mode: "autonomous", check_policy: "trusted-local",
  authorization_ref: "docs/brief.md", tests: ["app.test.mjs"], test_timeout_ms: 10000,
  budget: { elapsed_limit_ms: 300000, max_repairs: 2, verification_reserve_ms: 30000, repair_reserve_ms: 30000, cleanup_reserve_ms: 10000, token_limit: null, token_reserve: 0 } });
async function setup(t, workflowProfile = "standard") {
  const f = await fixture({ workflowProfile }); t.after(f.cleanup);
  const integrationPath = path.join(f.target, ".ai-org/project/repository-integration.json");
  const integration = JSON.parse(await fs.readFile(integrationPath));
  await fs.writeFile(integrationPath, JSON.stringify({ ...integration, status: "confirmed", source: "human-confirmed", summary: "Local fixture", change_isolation: "not-required", review_gate: "not-required", recorded_at: "2026-09-01T00:00:00Z", recorded_by: "human" }));
  await fs.writeFile(path.join(f.target, "docs/plan.json"), JSON.stringify(autonomousPlan()));
  await fs.writeFile(path.join(f.target, "docs/review.md"), "# Synthetic test judgment\nThe local parser meets the named decimal/rejection acceptance; no external action.\n");
  const assignments = JSON.parse(await fs.readFile(path.join(f.target, ".ai-org/project/assignments.json"))).assignments;
  f.releaser = assignments.find(a => a.position_id === "release_manager").agent_id;
  f.options = { workItemId: f.item.id, agentId: f.request.agentId, principalId: "human", requestRef: "docs/plan.json" };
  const stages = {
    build: { position: "developer", completed: ["Parser implemented and checked"], evidence: ["docs/developer-test.md"], satisfied: {} },
    test: { position: "quality_evaluator", judgment: "pass", satisfied: workflowProfile === "lean" ? { test_evidence: ["docs/review.md"], lean_closeout: ["docs/review.md"] } : { test_evidence: ["docs/review.md"] } },
    eval: { position: "quality_evaluator", judgment: "pass", satisfied: { evaluation_report: ["docs/review.md"] } },
    independent_qa: { position: "independent_qa", judgment: "pass", satisfied: { independent_qa_pass: ["docs/review.md"] } },
    release_gate: { position: "release_manager", judgment: "pass", approval: "docs/brief.md", rollback: ["Discard isolated fixture"], satisfied: { accepted_scope: ["docs/brief.md"], independent_qa_report: ["docs/review.md"] } }
  };
  for (const [stage, body] of Object.entries(stages)) await fs.writeFile(path.join(f.target, `docs/${stage}.json`), JSON.stringify({ ...body, stage, operation_id: `${stage}-one`, revision: f.request.revision }));
  return f;
}
const request = (f, stage, actor) => ({ ...f.options, agentId: actor, requestRef: `docs/${stage}.json` });
async function build(f) {
  await openDelivery(f.target, f.options);
  assert.equal((await checkDelivery(f.target, f.options)).check.accepted, true);
  return finishDelivery(f.target, request(f, "build", f.request.agentId));
}
test("one autonomous entry preserves all Standard gates and carries an unchanged review check across eligible responsibilities", async t => {
  const f = await setup(t);
  assert.equal((await build(f)).lifecycle_state, "test");
  for (const stage of ["test", "eval", "independent_qa", "release_gate"]) {
    const actor = stage === "release_gate" ? f.releaser : f.qualityAgent;
    await openDelivery(f.target, { ...f.options, agentId: actor });
    if (["test", "release_gate"].includes(stage)) assert.equal((await checkDelivery(f.target, request(f, stage, actor))).check.accepted, true);
    const result = await finishDelivery(f.target, request(f, stage, actor));
    assert.equal(result.finish.success, true, JSON.stringify(result.finish));
  }
  const item = await itemState(f);
  assert.equal(item.state, "done"); assert.equal(item.workflow_profile, "standard"); assert.equal(item.external_release_status, "not_performed");
  assert.equal(item.handoffs.length, 1);
  for (const gate of ["test_evidence", "evaluation_report", "independent_qa_pass", "independent_qa_report", "required_human_approval"]) assert.ok(item.gate_evidence[gate].length);
  const report = await inspectDelivery(f.target, { ...f.options, report: true });
  assert.equal(report.checks.length, 3); assert.equal(report.model_calls_performed_by_report, 0);
});
test("new plan completes Lean without changing legacy plan eligibility", async t => {
  const f = await setup(t, "lean"); await build(f);
  await openDelivery(f.target, { ...f.options, agentId: f.qualityAgent });
  await checkDelivery(f.target, request(f, "test", f.qualityAgent));
  assert.equal((await finishDelivery(f.target, request(f, "test", f.qualityAgent))).lifecycle_state, "done");
  const other = await setup(t);
  const plan = autonomousPlan(); delete plan.execution_mode; delete plan.check_policy; plan.schema_version = "temple.delivery-plan/v1";
  await fs.writeFile(path.join(other.target, "docs/plan.json"), JSON.stringify(plan));
  await assert.rejects(openDelivery(other.target, other.options), /low-risk bounded Lean/);
});
test("missing gates and early QA evidence are rejected before pending or lifecycle writes", async t => {
  const f = await setup(t); await build(f);
  await openDelivery(f.target, { ...f.options, agentId: f.qualityAgent });
  const p = path.join(f.target, "docs/test.json"), body = JSON.parse(await fs.readFile(p));
  await fs.writeFile(p, JSON.stringify({ ...body, satisfied: {} }));
  await checkDelivery(f.target, request(f, "test", f.qualityAgent));
  await assert.rejects(finishDelivery(f.target, request(f, "test", f.qualityAgent)), /missing gate evidence/);
  assert.equal((await readSession(f.target, f.item.id)).pending, null);
  await fs.writeFile(p, JSON.stringify({ ...body, satisfied: { ...body.satisfied, independent_qa_pass: ["docs/review.md"] } }));
  await checkDelivery(f.target, request(f, "test", f.qualityAgent));
  await assert.rejects(finishDelivery(f.target, request(f, "test", f.qualityAgent)), /prefill another stage/);
  assert.equal((await itemState(f)).state, "test");
});
test("review identity, explicit stage, evidence drift and exact candidate remain enforced", async t => {
  const f = await setup(t); await build(f);
  await assert.rejects(openDelivery(f.target, f.options), /eligible|distinct/);
  await openDelivery(f.target, { ...f.options, agentId: f.qualityAgent });
  await checkDelivery(f.target, request(f, "test", f.qualityAgent));
  await assert.rejects(finishDelivery(f.target, request(f, "eval", f.qualityAgent)), /stage must match/);
  await finishDelivery(f.target, request(f, "test", f.qualityAgent));
  await fs.appendFile(path.join(f.target, "docs/review.md"), "Changed judgment\n");
  await openDelivery(f.target, { ...f.options, agentId: f.qualityAgent });
  await assert.rejects(finishDelivery(f.target, request(f, "eval", f.qualityAgent)), /exact-current-candidate/);
});
test("autonomous completion resumes its exact journal after an interrupted canonical write", async t => {
  const f = await setup(t); await openDelivery(f.target, f.options); await checkDelivery(f.target, f.options);
  await assert.rejects(finishDelivery(f.target, request(f, "build", f.request.agentId), { checkpoint: async p => { if (p === "write-2") throw Error("injected interruption"); } }), /injected interruption/);
  assert.equal((await inspectDelivery(f.target, f.options)).next.action, "recover-finish");
  const result = await finishDelivery(f.target, request(f, "build", f.request.agentId));
  assert.equal(result.finish.success, true); assert.equal((await itemState(f)).handoffs.length, 1);
});
test("autonomous plans require explicit policy and complete reserves", () => {
  const p = autonomousPlan(); delete p.check_policy; assert.throws(() => validatePlan(p), /check policy/);
  const q = autonomousPlan(); q.budget.elapsed_limit_ms = 65000; assert.throws(() => validatePlan(q), /buffers/);
});
test("confined checks enforce write, network, fork and environment boundaries in a real process", { skip: process.platform !== "darwin" }, async t => {
  const f = await setup(t);
  const sentinel = path.join(f.temporary, "outside.txt"); await fs.writeFile(sentinel, "preserved");
  const server = net.createServer(socket => socket.end()); await new Promise(r => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise(r => server.close(r)));
  const testBody = `import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import net from 'node:net';import {spawnSync} from 'node:child_process';
test('boundaries', async()=>{
 assert.throws(()=>fs.writeFileSync(${JSON.stringify(sentinel)},'wrong'));
 assert.throws(()=>fs.readFileSync(${JSON.stringify(sentinel)}));
 assert.throws(()=>fs.writeFileSync('app.mjs','wrong'));
 assert.equal(process.env.TEMPLE_TEST_PRIVATE, undefined);
 assert.ok(spawnSync(process.execPath,['-e','process.exit(0)']).error);
 await new Promise((resolve,reject)=>{const s=net.connect(${server.address().port},'127.0.0.1');s.on('connect',()=>{s.destroy();reject(Error('network escaped'))});s.on('error',resolve)});
 fs.writeFileSync(process.env.TMPDIR+'/owned','ok');fs.unlinkSync(process.env.TMPDIR+'/owned');
});`;
  await fs.writeFile(path.join(f.target, "app.test.mjs"), testBody);
  process.env.TEMPLE_TEST_PRIVATE = "test-only-sentinel"; t.after(() => delete process.env.TEMPLE_TEST_PRIVATE);
  const result = await runLocalChecks(f.target, f.item.id, { ...autonomousPlan(), check_policy: "confined-node" });
  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.equal(await fs.readFile(sentinel, "utf8"), "preserved");
  assert.equal(result.execution_boundary.network, "denied"); assert.equal(result.execution_boundary.parent_agent_confined, false);
});

test("synthetic High-Assurance uses the common entry but still rejects missing normalized evidence and rollback", async t => {
  const f = await setup(t);
  cli(["work-item", "release", f.target, "--work-item", f.item.id, "--agent-id", f.request.agentId, "--reason", "Fixture switches to separate synthetic assurance item"]);
  for (const id of ["principal-builder", "principal-reviewer"]) cli(["collaboration", "add-principal", f.target, "--principal-id", id, "--name", `Synthetic ${id}`]);
  const agents = JSON.parse(await fs.readFile(path.join(f.target, ".ai-org/project/agents.json"))).agents;
  for (const a of agents) cli(["collaboration", "sponsor", f.target, "--agent-id", a.id, "--principal-id", a.id === f.qualityAgent ? "principal-reviewer" : "principal-builder"]);
  cli(["collaboration", "set-profile", f.target, "--profile", "high-assurance"]);
  const memberships = JSON.parse(await fs.readFile(path.join(f.target, ".ai-org/project/collaboration.json"))).memberships;
  for (const membership of memberships) cli(["collaboration", "qualify-membership", f.target, "--agent-id", membership.agent_id,
    "--position", membership.position_id, "--status", "active", "--risk-tier", "high", "--evidence", "docs/brief.md"]);
  cli(["collaboration", "bind-identity", f.target, "--principal-id", "principal-builder", "--verification-class", "external-evidence",
    "--provider-id", "synthetic-test-only", "--provider-subject", "principal-builder", "--evidence-ref", "docs/brief.md"]);
  // Synthetic prerequisite data inside this disposable fixture only. This does
  // not record or claim real multi-human qualification of Temple itself.
  cli(["collaboration", "record-validation", f.target, "--validation-level", "real_collaborative", "--status", "passed", "--revision", f.request.revision,
    "--evidence", "docs/brief.md", "--participant-principal", "principal-builder", "--participant-principal", "principal-reviewer", "--environment", "synthetic-one", "--environment", "synthetic-two"]);
  f.item = JSON.parse(cli(["work-item", "create", f.target, "--title", "Synthetic controlled parser", "--scope", "Local fixture", "--acceptance", "Parser and assurance evidence", "--affected-path", "app.mjs", "--affected-path", "app.test.mjs", "--workflow-profile", "high-assurance", "--risk-tier", "high", "--scope-class", "bounded", "--ui-mode", "not-applicable", "--json"]).stdout).item;
  const invoke = (...args) => cli([...args.slice(0, 2), f.target, ...args.slice(2)]);
  const evid = (...args) => { const result = invoke("evidence", ...args, "--work-item", f.item.id); const match = result.stdout.match(/Recorded (EVID-[A-Z0-9-]+):/); assert.ok(match, result.stdout); return match[1]; };
  const risk = evid("risk", "--summary", "Synthetic local controls", "--severity", "high", "--risk-status", "mitigated", "--mitigation", "Discard fixture", "--revision", f.request.revision);
  for (const [stage, gates] of [["spec", { work_order: "docs/brief.md" }], ["design", { approved_scope: "docs/brief.md", acceptance_criteria: "docs/brief.md" }], ["build", { technical_design: "docs/brief.md", risk_review: "docs/brief.md", assurance_risk_review: risk }]]) cli(["transition", f.target, "--work-item", f.item.id, "--to", stage, ...Object.entries(gates).flatMap(([k,v]) => ["--satisfy", `${k}=${v}`])]);
  const candidate = evid("git", "--revision", f.request.revision, "--title", "Exact synthetic candidate");
  await fs.writeFile(path.join(f.target, "docs/observation.json"), JSON.stringify({ schema_version: "temple.test-observation/v1", revision: f.request.revision, command: ["node", "--test", "app.test.mjs"], result: "pass", exit_code: 0, started_at: "2026-09-01T00:00:00Z", completed_at: "2026-09-01T00:00:01Z", artifact_refs: [] }));
  const tested = evid("test", "--observation", "docs/observation.json", "--actor", f.qualityAgent);
  const rollback = evid("rollback", "--summary", "Discard fixture", "--procedure", "docs/brief.md", "--rollback-status", "planned", "--revision", f.request.revision);
  await fs.writeFile(path.join(f.target, "docs/approval.json"), JSON.stringify({ schema_version: "temple.approval/v1", work_item_id: f.item.id, decision: "go", scope_revision: f.request.revision, approved_at: "2026-09-01T00:00:02Z", approvals: [{ principal_id: "principal-reviewer", approved_at: "2026-09-01T00:00:02Z" }], external_action_authorized: false }));
  const changes = { build: { satisfied: { exact_candidate_revision: [candidate] } }, test: { satisfied: { test_evidence: [tested], normalized_test_evidence: [tested] } }, independent_qa: { satisfied: { independent_qa_pass: [tested], normalized_independent_qa_evidence: [tested] } }, release_gate: { approval: "docs/approval.json", rollback: [rollback], satisfied: { accepted_scope: ["docs/brief.md"], independent_qa_report: [tested] } } };
  for (const [stage, change] of Object.entries(changes)) { const p = path.join(f.target, `docs/${stage}.json`); await fs.writeFile(p, JSON.stringify({ ...JSON.parse(await fs.readFile(p)), ...change })); }
  for (const stage of ["build", "test", "eval", "independent_qa", "release_gate"]) {
    const agent = stage === "build" ? f.request.agentId : stage === "release_gate" ? f.releaser : f.qualityAgent;
    const principal = agent === f.qualityAgent ? "principal-reviewer" : "principal-builder";
    invoke("collaboration", "bind-identity", "--principal-id", principal, "--verification-class", "external-evidence", "--provider-id", "synthetic-test-only", "--provider-subject", principal, "--evidence-ref", "docs/brief.md");
    f.options = { ...f.options, workItemId: f.item.id, agentId: agent, principalId: principal };
    await openDelivery(f.target, f.options);
    const req = { ...f.options, requestRef: `docs/${stage}.json` }, p = path.join(f.target, req.requestRef), original = await fs.readFile(p);
    if (["build", "release_gate"].includes(stage)) {
      const bad = JSON.parse(original); if (stage === "build") bad.satisfied = {}; else bad.rollback = ["docs/brief.md"];
      await fs.writeFile(p, JSON.stringify(bad)); await checkDelivery(f.target, req);
      await assert.rejects(finishDelivery(f.target, req), stage === "build" ? /exact_candidate_revision/ : /normalized rollback/);
      assert.equal((await readSession(f.target, f.item.id)).pending, null);
      await fs.writeFile(p, original);
    }
    if (["build", "test", "release_gate"].includes(stage)) assert.equal((await checkDelivery(f.target, req)).check.accepted, true);
    const finished = await finishDelivery(f.target, req);
    assert.equal(finished.finish.success, true, JSON.stringify({ stage, finish: finished.finish }));
  }
  const completed = await itemState(f); assert.equal(completed.state, "done"); assert.equal(completed.workflow_profile, "high-assurance"); assert.equal(completed.risk_tier, "high");
});
