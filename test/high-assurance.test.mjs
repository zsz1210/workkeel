import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { riskEvidenceCoversTier } from "../src/assurance.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin/temple.mjs");

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

function git(target, args) {
  return spawnSync("git", ["-C", target, ...args], { encoding: "utf8" });
}

async function fixture(context) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-assurance-test-"));
  const target = path.join(temporaryRoot, "assurance-product");
  const configPath = path.join(temporaryRoot, "init.json");
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  await fs.writeFile(configPath, `${JSON.stringify({
    schema_version: "temple.init/v1",
    project: { id: "assurance-product", name: "Assurance Product" },
    naming_mode: "manual",
    agents: [
      { display_name: "Fixture Rowan", positions: ["engineering_manager", "release_manager", "observer"] },
      { display_name: "Fixture Linden", positions: ["product_manager", "ux_designer", "ui_designer"] },
      { display_name: "Fixture Ellis", positions: ["tech_lead"] },
      { display_name: "Fixture Devon", positions: ["developer"] },
      { display_name: "Fixture Hollis", positions: ["quality_evaluator", "independent_qa"] }
    ]
  }, null, 2)}\n`);
  assert.equal(run(["init", target, "--config", configPath]).status, 0);
  for (const relativePath of [
    "docs/design.md",
    "docs/eval.md",
    "docs/risk.md",
    "docs/spec.md",
    "docs/work-order.md"
  ]) {
    const absolutePath = path.join(target, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, `Fixture evidence for ${relativePath}\n`);
  }
  assert.equal(git(target, ["init", "-q"]).status, 0);
  assert.equal(git(target, ["config", "user.email", "temple-tests@example.invalid"]).status, 0);
  assert.equal(git(target, ["config", "user.name", "Temple Tests"]).status, 0);
  assert.equal(git(target, ["add", "."]).status, 0);
  assert.equal(git(target, ["commit", "-qm", "initial state"]).status, 0);
  return { target };
}

function evidenceId(output) {
  const id = /Recorded (EVID-[A-Z0-9-]+):/.exec(output)?.[1];
  assert.ok(id, output);
  return id;
}

test("High-Assurance maps standard risk to medium normalized evidence explicitly", () => {
  assert.equal(riskEvidenceCoversTier("low", "low"), true);
  assert.equal(riskEvidenceCoversTier("standard", "low"), false);
  assert.equal(riskEvidenceCoversTier("standard", "medium"), true);
  assert.equal(riskEvidenceCoversTier("high", "medium"), false);
  assert.equal(riskEvidenceCoversTier("critical", "critical"), true);
  assert.equal(riskEvidenceCoversTier("standard", "unknown"), false);
});

async function enableHighAssurance(target) {
  for (const [id, name] of [["principal-owner", "Morgan Hale"], ["principal-reviewer", "Casey Quinn"]]) {
    const added = run(["collaboration", "add-principal", target, "--principal-id", id, "--name", name]);
    assert.equal(added.status, 0, added.stderr || added.stdout);
  }
  const agents = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/agents.json"), "utf8")).agents;
  const memberships = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/collaboration.json"), "utf8")).memberships;
  for (const membership of memberships) {
    const qualified = run(["collaboration", "qualify-membership", target, "--agent-id", membership.agent_id,
      "--position", membership.position_id, "--status", "active", "--risk-tier", "high", "--evidence", "docs/risk.md"]);
    assert.equal(qualified.status, 0, qualified.stderr || qualified.stdout);
  }
  for (const [index, agent] of agents.entries()) {
    const sponsored = run(["collaboration", "sponsor", target, "--principal-id", index === agents.length - 1 ? "principal-reviewer" : "principal-owner", "--agent-id", agent.id]);
    assert.equal(sponsored.status, 0, sponsored.stderr || sponsored.stdout);
  }
  const enabled = run(["collaboration", "set-profile", target, "--profile", "high-assurance"]);
  assert.equal(enabled.status, 0, enabled.stderr || enabled.stdout);
  bind(target, "principal-owner");
}

function bind(target, principal) {
  const result = run(["collaboration", "bind-identity", target, "--principal-id", principal,
    "--verification-class", "external-evidence", "--provider-id", "synthetic-fixture",
    "--provider-subject", principal, "--evidence-ref", "docs/risk.md"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("High-Assurance is selectable only after its human-accountability prerequisites", async (context) => {
  const { target } = await fixture(context);
  const rejected = run(["collaboration", "set-profile", target, "--profile", "high-assurance"]);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /at least two active Human Principals/);
  await enableHighAssurance(target);
  const shown = JSON.parse(run(["collaboration", "show", target, "--json"]).stdout);
  assert.equal(shown.profile, "high-assurance");
  assert.equal(run(["doctor", target]).status, 0);
});

test("High-Assurance scales UI, evidence, rollback, and approval gates by risk", async (context) => {
  const { target } = await fixture(context);
  await enableHighAssurance(target);
  const rejectedUi = run([
    "work-item", "create", target,
    "--title", "Sensitive migration",
    "--risk-tier", "high",
    "--ui-mode", "code-first"
  ]);
  assert.equal(rejectedUi.status, 1);
  assert.match(rejectedUi.stderr, /High-Assurance high risk does not permit code-first/);

  const created = run([
    "work-item", "create", target,
    "--title", "Sensitive migration",
    "--scope", "Migrate one bounded record",
    "--acceptance", "Exact-revision test and Independent QA pass",
    "--affected-path", "src/migration",
    "--base-revision", "HEAD",
    "--risk-tier", "high",
    "--ui-mode", "not-applicable"
  ]);
  assert.equal(created.status, 0, created.stderr || created.stdout);
  const workItemId = /Created (WI-[A-Z0-9-]+):/.exec(created.stdout)?.[1];
  assert.ok(workItemId);
  const itemPath = path.join(target, `.ai-org/work-items/${workItemId}.json`);
  const item = JSON.parse(await fs.readFile(itemPath, "utf8"));
  assert.equal(item.risk_tier, "high");
  assert.equal(item.assurance.artifact_depth, "controlled");

  const changedProfile = run(["collaboration", "set-profile", target, "--profile", "solo"]);
  assert.equal(changedProfile.status, 0, changedProfile.stderr || changedProfile.stdout);

  assert.equal(run(["transition", target, "--work-item", workItemId, "--to", "spec", "--satisfy", "work_order=docs/work-order.md"]).status, 0);
  assert.equal(run(["transition", target, "--work-item", workItemId, "--to", "design", "--satisfy", "approved_scope=docs/spec.md", "--satisfy", "acceptance_criteria=docs/spec.md"]).status, 0);
  const missingRisk = run(["transition", target, "--work-item", workItemId, "--to", "build", "--satisfy", "technical_design=docs/design.md", "--satisfy", "risk_review=docs/risk.md"]);
  assert.equal(missingRisk.status, 1);
  assert.match(missingRisk.stderr, /assurance_risk_review/);

  const risk = run(["evidence", "risk", target, "--work-item", workItemId, "--summary", "Migration rollback is bounded", "--severity", "high", "--risk-status", "mitigated", "--mitigation", "Restore the original record", "--revision", "HEAD"]);
  assert.equal(risk.status, 0, risk.stderr || risk.stdout);
  const riskId = evidenceId(risk.stdout);
  const toBuild = run(["transition", target, "--work-item", workItemId, "--to", "build", "--satisfy", "technical_design=docs/design.md", "--satisfy", "risk_review=docs/risk.md", "--satisfy", `assurance_risk_review=${riskId}`]);
  assert.equal(toBuild.status, 0, toBuild.stderr || toBuild.stdout);

  const revision = run(["evidence", "git", target, "--work-item", workItemId, "--revision", "HEAD", "--title", "Developer candidate"]);
  assert.equal(revision.status, 0, revision.stderr || revision.stdout);
  const revisionId = evidenceId(revision.stdout);
  const handoff = run(["handoff", target, "--work-item", workItemId, "--to", "quality_evaluator", "--input-revision", "HEAD", "--completed", "Bounded migration implementation", "--evidence", revisionId]);
  assert.equal(handoff.status, 0, handoff.stderr || handoff.stdout);
  const handedOff = JSON.parse(await fs.readFile(itemPath, "utf8"));
  assert.equal(handedOff.handoffs.at(-1).input_revision, git(target, ["rev-parse", "HEAD"]).stdout.trim());
  assert.equal(handedOff.developer_candidate_revision, handedOff.handoffs.at(-1).input_revision);
  const toTest = run(["transition", target, "--work-item", workItemId, "--to", "test", "--satisfy", `exact_candidate_revision=${revisionId}`]);
  assert.equal(toTest.status, 0, toTest.stderr || toTest.stdout);

  const testObservationPath = ".ai-org/artifacts/high-assurance-test.json";
  bind(target, "principal-reviewer");
  await fs.mkdir(path.dirname(path.join(target, testObservationPath)), { recursive: true });
  await fs.writeFile(path.join(target, testObservationPath), `${JSON.stringify({ schema_version: "temple.test-observation/v1", revision: "HEAD", command: ["npm", "test"], result: "pass", exit_code: 0, started_at: "2026-08-30T00:00:00.000Z", completed_at: "2026-08-30T00:01:00.000Z", artifact_refs: [] }, null, 2)}\n`);
  const testEvidence = run(["evidence", "test", target, "--work-item", workItemId, "--observation", testObservationPath, "--actor", "agent-fixture-hollis"]);
  assert.equal(testEvidence.status, 0, testEvidence.stderr || testEvidence.stdout);
  const testId = evidenceId(testEvidence.stdout);
  const toEval = run(["transition", target, "--work-item", workItemId, "--to", "eval", "--satisfy", `test_evidence=${testId}`, "--satisfy", `normalized_test_evidence=${testId}`]);
  assert.equal(toEval.status, 0, toEval.stderr || toEval.stdout);
  assert.equal(run(["transition", target, "--work-item", workItemId, "--to", "independent_qa", "--satisfy", "evaluation_report=docs/eval.md"]).status, 0);

  const runtimeObservationPath = ".ai-org/artifacts/high-assurance-runtime.json";
  await fs.writeFile(path.join(target, runtimeObservationPath), `${JSON.stringify({ schema_version: "temple.runtime-observation/v1", revision: "HEAD", environment: "isolated local runtime", scenario: "migrate and restore one record", result: "pass", provenance: "live", observed_at: "2026-08-30T00:02:00.000Z", artifact_refs: [] }, null, 2)}\n`);
  const qaEvidence = run(["evidence", "runtime", target, "--work-item", workItemId, "--observation", runtimeObservationPath, "--actor", "agent-fixture-hollis"]);
  assert.equal(qaEvidence.status, 0, qaEvidence.stderr || qaEvidence.stdout);
  const qaId = evidenceId(qaEvidence.stdout);
  const toRelease = run(["transition", target, "--work-item", workItemId, "--to", "release_gate", "--satisfy", `independent_qa_pass=${qaId}`, "--satisfy", `normalized_independent_qa_evidence=${qaId}`]);
  assert.equal(toRelease.status, 0, toRelease.stderr || toRelease.stdout);

  const rollbackPath = ".ai-org/artifacts/rollback.md";
  await fs.writeFile(path.join(target, rollbackPath), "# Rollback\n\nRestore the original record and verify its checksum.\n");
  const rollback = run(["evidence", "rollback", target, "--work-item", workItemId, "--summary", "Restore original record", "--procedure", rollbackPath, "--rollback-status", "planned", "--revision", "HEAD"]);
  assert.equal(rollback.status, 0, rollback.stderr || rollback.stdout);
  const rollbackId = evidenceId(rollback.stdout);
  const exactRevision = git(target, ["rev-parse", "HEAD"]).stdout.trim();
  const approvalPath = ".ai-org/artifacts/high-assurance-approval.json";
  await fs.writeFile(path.join(target, approvalPath), `${JSON.stringify({ schema_version: "temple.approval/v1", work_item_id: workItemId, decision: "go", scope_revision: exactRevision, approved_at: "2026-08-30T00:03:00.000Z", approvals: [{ principal_id: "principal-reviewer", approved_at: "2026-08-30T00:03:00.000Z" }], external_action_authorized: false }, null, 2)}\n`);
  bind(target, "principal-owner");
  const closed = run(["close", target, "--work-item", workItemId, "--decision", "go", "--tested-revision", "HEAD", "--approval", approvalPath, "--rollback", rollbackId, "--satisfy", "accepted_scope=docs/spec.md", "--satisfy", `test_evidence=${testId}`, "--satisfy", "evaluation_report=docs/eval.md", "--satisfy", `independent_qa_report=${qaId}`]);
  assert.equal(closed.status, 0, closed.stderr || closed.stdout);
  assert.equal(JSON.parse(await fs.readFile(itemPath, "utf8")).state, "done");
});

test("doctor rejects drift in a Work Item's derived assurance contract", async (context) => {
  const { target } = await fixture(context);
  await enableHighAssurance(target);
  const created = run([
    "work-item", "create", target,
    "--title", "Controlled change",
    "--risk-tier", "high",
    "--ui-mode", "not-applicable"
  ]);
  assert.equal(created.status, 0, created.stderr || created.stdout);
  const workItemId = /Created (WI-[A-Z0-9-]+):/.exec(created.stdout)?.[1];
  const itemPath = path.join(target, `.ai-org/work-items/${workItemId}.json`);
  const item = JSON.parse(await fs.readFile(itemPath, "utf8"));
  item.assurance.minimum_approvals = 99;
  await fs.writeFile(itemPath, `${JSON.stringify(item, null, 2)}\n`);

  const doctor = run(["doctor", target]);
  assert.equal(doctor.status, 1);
  assert.match(doctor.stdout, /Invalid work item files/);
});
