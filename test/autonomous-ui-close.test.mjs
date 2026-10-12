import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fixture, cli, itemState, canonicalBytes } from "./helpers/lean-delivery-fixture.mjs";
import { openDelivery, checkDelivery, finishDelivery, inspectDelivery } from "../src/daily-delivery.mjs";
import { readSession } from "../src/delivery-ledger.mjs";
import { prepareWorkflowStage } from "../src/workflow-completion.mjs";

async function setup(t, mode = "code-first") {
  const f = await fixture({ workflowProfile: "standard" }); t.after(f.cleanup);
  cli(["work-item", "release", f.target, "--work-item", f.item.id, "--agent-id", f.request.agentId, "--reason", "Separate synthetic UI item"]);
  const integrationPath = path.join(f.target, ".ai-org/project/repository-integration.json");
  const integration = JSON.parse(await fs.readFile(integrationPath));
  await fs.writeFile(integrationPath, JSON.stringify({ ...integration, status: "confirmed", source: "human-confirmed", summary: "Isolated UI workflow fixture", change_isolation: "not-required", review_gate: "not-required", recorded_at: "2026-09-01T00:00:00Z", recorded_by: "human" }));
  const body = "# Synthetic UI contract\nProtocol fixture only; not a real visual acceptance claim.\n";
  await fs.writeFile(path.join(f.target, "docs/ui.md"), body);
  await fs.writeFile(path.join(f.target, "docs/review.md"), "# Synthetic distinct review\nIsolated UI workflow fixture judgment.\n");
  await fs.writeFile(path.join(f.target, ".ai-org/project/spec-index.json"), JSON.stringify({ schema_version: "temple.spec-index/v1", adoption_profile: "hybrid", delivery_method: "contract-guided-iterative", entries: [{
    id: "UI-0001", kind: "ui_contract", title: "Synthetic UI contract", authority: "temple_native", revision: "ui-1", owner_position: "ui_designer",
    status: "approved", approved_by: "human", approved_at: "2026-09-01T00:00:00Z", approval_ref: "docs/brief.md", source_refs: [], related_work_items: [], updated_at: "2026-09-01T00:00:00Z",
    source: { kind: "repository", location: "docs/ui.md", system: "git", content_sha256: createHash("sha256").update(body).digest("hex") }
  }] }));
  f.item = JSON.parse(cli(["work-item", "create", f.target, "--title", "Synthetic UI delivery", "--scope", "Isolated UI protocol", "--acceptance", "Selected UI gates and native close", "--affected-path", "app.mjs", "--affected-path", "app.test.mjs", "--workflow-profile", "standard", "--risk-tier", "standard", "--scope-class", "bounded", "--ui-mode", mode,
    ...(mode === "not-applicable" ? [] : ["--ui-ref", "UI-0001@ui-1"]), "--json"]).stdout).item;
  f.uiPolicy = JSON.parse(await fs.readFile(path.join(f.target, ".ai-org/core/ui-design.json")));
  const selected = f.uiPolicy.delivery_modes.find(m => m.id === mode);
  for (const [stage, gates] of [["spec", ["work_order"]], ["design", ["approved_scope", "acceptance_criteria"]], ["build", ["technical_design", "risk_review", ...selected.prebuild_evidence]]]) {
    cli(["transition", f.target, "--work-item", f.item.id, "--to", stage, ...gates.flatMap(k => ["--satisfy", `${k}=docs/ui.md`])]);
  }
  const assignments = JSON.parse(await fs.readFile(path.join(f.target, ".ai-org/project/assignments.json"))).assignments;
  f.releaser = assignments.find(a => a.position_id === "release_manager").agent_id;
  f.options = { workItemId: f.item.id, agentId: f.request.agentId, principalId: "human", requestRef: "docs/plan.json" };
  await fs.writeFile(path.join(f.target, "docs/plan.json"), JSON.stringify({ schema_version: "temple.delivery-plan/v2", execution_mode: "autonomous", check_policy: "trusted-local", authorization_ref: "docs/brief.md", tests: ["app.test.mjs"], test_timeout_ms: 10000,
    budget: { elapsed_limit_ms: 600000, max_repairs: 2, verification_reserve_ms: 30000, repair_reserve_ms: 30000, cleanup_reserve_ms: 10000, token_limit: null, token_reserve: 0 } }));
  f.stages = {
    build: { position: "developer", completed: ["Prepared synthetic UI fixture"], evidence: ["docs/developer-test.md"], satisfied: {} },
    test: { position: "quality_evaluator", judgment: "pass", satisfied: { test_evidence: ["docs/review.md"] } },
    eval: { position: "quality_evaluator", judgment: "pass", satisfied: { evaluation_report: ["docs/review.md"] } },
    independent_qa: { position: "independent_qa", judgment: "pass", satisfied: { independent_qa_pass: ["docs/review.md"] } },
    release_gate: { position: "release_manager", judgment: "pass", approval: "docs/brief.md", rollback: ["Discard isolated fixture"], satisfied: { accepted_scope: ["docs/brief.md"], independent_qa_report: ["docs/review.md"], ...Object.fromEntries(selected.minimum_evidence.map(k => [k, ["docs/review.md"]])) } }
  };
  for (const stage of Object.keys(f.stages)) await writeRequest(f, stage, f.stages[stage]);
  return f;
}
async function writeRequest(f, stage, body) {
  await fs.writeFile(path.join(f.target, `docs/${stage}.json`), JSON.stringify({ ...body, stage, operation_id: `${stage}-ui`, revision: f.request.revision }));
}
const options = (f, stage) => ({ ...f.options, agentId: stage === "build" ? f.request.agentId : stage === "release_gate" ? f.releaser : f.qualityAgent, requestRef: `docs/${stage}.json` });
async function readyForClose(f) {
  for (const stage of ["build", "test", "eval", "independent_qa"]) {
    const o = options(f, stage); await openDelivery(f.target, { ...o, requestRef: "docs/plan.json" });
    if (["build", "test"].includes(stage)) assert.equal((await checkDelivery(f.target, o)).check.accepted, true);
    assert.equal((await finishDelivery(f.target, o)).finish.success, true);
  }
  await openDelivery(f.target, { ...options(f, "release_gate"), requestRef: "docs/plan.json" });
}

for (const mode of ["code-first", "preview-first", "design-led"]) {
  test(`${mode} closes through installed common entry with its selected UI evidence`, async t => {
    const f = await setup(t, mode); await readyForClose(f);
    assert.equal((await checkDelivery(f.target, options(f, "release_gate"))).check.accepted, true);
    const result = cli(["delivery", "finish", f.target, "--work-item", f.item.id, "--agent-id", f.releaser, "--principal-id", "human", "--request", "docs/release_gate.json", "--json"]);
    assert.equal(JSON.parse(result.stdout).finish.success, true);
    const item = await itemState(f), report = await inspectDelivery(f.target, { ...f.options, report: true });
    assert.equal(item.state, "done"); assert.equal(item.ui_delivery_mode, mode); assert.equal(item.claim.status, "released");
    assert.equal(item.tested_revision, f.request.revision); assert.equal(item.external_release_status, "not_performed");
    assert.deepEqual(item.gate_evidence.runtime_visual_review, ["docs/review.md"]);
    assert.equal(report.session_completed, true); assert.equal(report.pending, null);
  });
}

test("missing UI evidence, nonexistent files and foreign-mode keys reject before canonical writes", async t => {
  const f = await setup(t); await readyForClose(f);
  const original = f.stages.release_gate;
  for (const [change, message] of [
    [{ runtime_visual_review: undefined }, /Close requires UI evidence.*runtime_visual_review/],
    [{ runtime_visual_review: ["docs/missing-ui.md"] }, /missing-ui\.md/],
    [{ preview_artifact: ["docs/review.md"] }, /prefill another stage/]
  ]) {
    const body = structuredClone(original); Object.assign(body.satisfied, change); await writeRequest(f, "release_gate", body);
    assert.equal((await checkDelivery(f.target, options(f, "release_gate"))).check.accepted, true);
    const before = await canonicalBytes(f);
    const result = cli(["delivery", "finish", f.target, "--work-item", f.item.id, "--agent-id", f.releaser, "--principal-id", "human", "--request", "docs/release_gate.json", "--json"], { allowFailure: true });
    assert.notEqual(result.status, 0); const error = JSON.parse(result.stdout);
    assert.match(error.message, message); assert.equal(error.mutation_status, "not_started");
    assert.deepEqual(await canonicalBytes(f), before); assert.equal((await readSession(f.target, f.item.id)).pending, null);
  }
});

test("UI evidence remains disallowed in earlier stages and non-UI close", async t => {
  const f = await setup(t); await openDelivery(f.target, f.options);
  await writeRequest(f, "build", { ...f.stages.build, satisfied: { runtime_visual_review: ["docs/review.md"] } });
  await checkDelivery(f.target, options(f, "build")); const before = await canonicalBytes(f);
  await assert.rejects(finishDelivery(f.target, options(f, "build")), /prefill another stage/);
  assert.deepEqual(await canonicalBytes(f), before);
  const other = await setup(t, "not-applicable"); await readyForClose(other);
  await writeRequest(other, "release_gate", { ...other.stages.release_gate, satisfied: { ...other.stages.release_gate.satisfied, runtime_visual_review: ["docs/review.md"] } });
  await checkDelivery(other.target, options(other, "release_gate")); const nonUiBefore = await canonicalBytes(other);
  await assert.rejects(finishDelivery(other.target, options(other, "release_gate")), /prefill another stage/);
  assert.deepEqual(await canonicalBytes(other), nonUiBefore);
});

test("read-only close preparation follows custom selected-mode requirements and rejects undefined modes", async t => {
  const f = await setup(t); await readyForClose(f);
  // Isolated policy variation tests preparation only, not managed-policy migration.
  const policy = structuredClone(f.uiPolicy);
  policy.delivery_modes.find(m => m.id === "code-first").minimum_evidence.push("contrast_review");
  policy.delivery_modes.find(m => m.id === "design-led").minimum_evidence.push("brand_review");
  const policyPath = path.join(f.target, ".ai-org/core/ui-design.json"); await fs.writeFile(policyPath, JSON.stringify(policy));
  const item = await itemState(f);
  const request = { ...f.stages.release_gate, work_item_id: f.item.id, workflow_stage: "release_gate", claim_id: item.claim.id,
    agent_id: f.releaser, principal_id: "human", candidate_revision: f.request.revision };
  let before = await canonicalBytes(f);
  await assert.rejects(prepareWorkflowStage(f.target, request), /contrast_review/);
  request.satisfied.contrast_review = ["docs/review.md"];
  assert.equal((await prepareWorkflowStage(f.target, request)).prepared.item.state, "done");
  request.satisfied.brand_review = ["docs/review.md"];
  await assert.rejects(prepareWorkflowStage(f.target, request), /prefill another stage/);
  assert.deepEqual(await canonicalBytes(f), before);
  policy.delivery_modes = policy.delivery_modes.filter(m => m.id !== "code-first"); await fs.writeFile(policyPath, JSON.stringify(policy));
  before = await canonicalBytes(f);
  await assert.rejects(prepareWorkflowStage(f.target, request), /UI delivery mode is not defined/);
  assert.deepEqual(await canonicalBytes(f), before);
});
