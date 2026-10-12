import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { fixture, cli, git, itemState } from "./helpers/lean-delivery-fixture.mjs";
import { setupContributor, sponsorAgent, addPrincipal, setCollaborationProfile } from "../src/collaboration.mjs";
import { actualDeveloper, assertActualReviewer, assertHighAssuranceCloseout, assuranceForRisk, readHighAssurancePolicy } from "../src/assurance.mjs";
import { loadProjectContext } from "../src/project.mjs";

async function member(f) {
  cli(["work-item", "release", f.target, "--work-item", f.item.id]);
  await addPrincipal(f.target, { principalId: "principal-original", displayName: "Original contributor" });
  const context = await loadProjectContext(f.target);
  for (const agent of context.agents.keys()) await sponsorAgent(f.target, { principalId: "principal-original", agentId: agent });
  await setupContributor(f.target, { authorized: true, principalId: "principal-second", displayName: "Second contributor",
    deliveryAgent: { id: "agent-second-builder", displayName: "Builder", positions: ["developer"] },
    reviewAgent: { id: "agent-second-reviewer", displayName: "Verifier", positions: ["quality_evaluator", "independent_qa", "release_manager"] },
    evidenceRefs: ["docs/brief.md"] });
  await setCollaborationProfile(f.target, "collaborative");
}

test("V01/V13/V15 named new-clone contributor completes candidate lifecycle without Temple login", async t => {
  const f = await fixture({ workflowProfile: "standard" }); t.after(f.cleanup);
  await member(f);
  const start = performance.now();
  const command = (name, args = []) => cli([name, f.target, "--work-item", f.item.id, ...args]);
  const claim = agent => cli(["work-item", "claim", f.target, "--work-item", f.item.id, "--agent-id", agent,
    "--principal-id", "principal-second", "--base-revision", f.request.revision, "--branch", "member-work", "--json"]);
  const claimed = JSON.parse(claim("agent-second-builder").stdout).item;
  assert.equal(claimed.claim.actor_provenance.verification_class, "attributed");
  const firstClaim = performance.now() - start;
  const app = path.join(f.target, "app.mjs");
  const original = await fs.readFile(app, "utf8");
  const modified = original.replace("return Number(value);", "const parsed = Number(value); return parsed;");
  assert.notEqual(modified, original);
  await fs.writeFile(app, modified);
  const firstEdit = performance.now() - start;
  const measured = spawnSync(process.execPath, ["--test", "app.test.mjs"], { cwd: f.target, encoding: "utf8" });
  assert.equal(measured.status, 0, measured.stderr || measured.stdout);
  const firstOutput = performance.now() - start;
  await fs.writeFile(path.join(f.target, "docs/developer-test.md"), `Synthetic new-member product observation\nExit: ${measured.status}\n${measured.stdout}`);
  git(f.target, ["add", "."]); git(f.target, ["commit", "-m", "Member candidate with actual parser measurement"]);
  f.request.revision = git(f.target, ["rev-parse", "HEAD"]);
  const blocked = cli(["work-item", "claim", f.target, "--work-item", f.item.id, "--agent-id", "agent-builder",
    "--base-revision", f.request.revision, "--branch", "other", "--json"], { allowFailure: true });
  assert.equal(blocked.status, 1);
  const report = JSON.parse(cli(["context", "resolve", f.target, "--work-item", f.item.id, "--no-write", "--json"]).stdout);
  assert.equal(report.agent.id, "agent-second-builder");
  const compact = JSON.parse(cli(["context", "resolve", f.target, "--work-item", f.item.id,
    "--agent-id", "agent-second-builder", "--principal-id", "principal-second", "--compact", "--no-write", "--json"]).stdout);
  assert.equal(compact.responsibility.selected_actor.agent_id, "agent-second-builder");
  assert.equal(compact.responsibility.selected_actor.principal_id, "principal-second");
  assert.equal(compact.mutation_performed, false);
  command("handoff", ["--to", "quality_evaluator", "--input-revision", f.request.revision, "--completed", "Verified existing parser candidate", "--evidence", "docs/developer-test.md"]);
  command("transition", ["--to", "test"]);
  claim("agent-second-reviewer");
  command("transition", ["--to", "eval", "--satisfy", "test_evidence=docs/developer-test.md"]);
  command("transition", ["--to", "independent_qa", "--satisfy", "evaluation_report=docs/brief.md"]);
  command("transition", ["--to", "release_gate", "--satisfy", "independent_qa_pass=docs/developer-test.md"]);
  claim("agent-second-reviewer");
  command("close", ["--decision", "go", "--tested-revision", f.request.revision, "--approval", "not-required",
    "--rollback", "Revert the candidate", "--satisfy", "accepted_scope=docs/brief.md", "--satisfy", "test_evidence=docs/developer-test.md",
    "--satisfy", "evaluation_report=docs/brief.md", "--satisfy", "independent_qa_report=docs/developer-test.md"]);
  const item = await itemState(f);
  assert.equal(item.state, "done");
  assert.equal(item.handoffs.find(entry => entry.from_position === "developer").actor, "agent-second-builder");
  assert.equal(item.handoffs.find(entry => entry.from_position === "developer").principal_id, "principal-second");
  assert.equal(item.claim.agent_id, "agent-second-reviewer");
  t.diagnostic(JSON.stringify({ first_claim_ms: Math.round(firstClaim), first_product_edit_ms: Math.round(firstEdit),
    first_verifiable_output_ms: Math.round(firstOutput), lifecycle_ms: Math.round(performance.now() - start),
    extra_login: 0, human_interventions: 0, token_usage: "not observed", evidence_layer: "synthetic contributor with actual local product edit and measurement" }));
});

test("V02/V16 assurance follows actual Developer and qualified non-default QA, with independent human approval", async t => {
  const f = await fixture({ workflowProfile: "standard" }); t.after(f.cleanup); await member(f);
  const context = await loadProjectContext(f.target);
  const collaboration = JSON.parse(await fs.readFile(path.join(f.target, ".ai-org/project/collaboration.json")));
  const policy = await readHighAssurancePolicy(f.target);
  const item = { ...f.item, state: "release_gate", workflow_profile: "high-assurance", risk_tier: "standard",
    assurance: assuranceForRisk(policy, "standard"), developer_candidate_revision: f.request.revision,
    handoffs: [{ from_position: "developer", actor: "agent-second-builder", principal_id: "principal-second", input_revision: f.request.revision }] };
  assert.equal(actualDeveloper(context, item, collaboration).agent_id, "agent-second-builder");
  await assertActualReviewer(f.target, context, item, [{ id: "qa", recorded_by: "agent-second-reviewer" }], "independent_qa");
  await assert.rejects(assertActualReviewer(f.target, context, item, [{ id: "qa", recorded_by: "agent-second-builder" }], "independent_qa"));
  assert.throws(() => actualDeveloper(context, { ...item, handoffs: [] }, collaboration), /actual Developer handoff/);
  const common = { work_item_id: item.id, scope_revision: f.request.revision, invalidated_at: null, expires_at: null };
  await fs.writeFile(path.join(f.target, ".ai-org/project/evidence.json"), JSON.stringify({ entries: [
    { ...common, id: "test", kind: "test", outcome: "pass", recorded_by: "agent-second-builder" },
    { ...common, id: "qa", kind: "test", outcome: "pass", recorded_by: "agent-second-reviewer" },
    { ...common, id: "rollback", kind: "rollback", outcome: "planned" }] }));
  const approvalPath = "docs/approval.json";
  const approval = principal => ({ schema_version: "temple.approval/v1", work_item_id: item.id, decision: "go", scope_revision: f.request.revision,
    approved_at: "2026-09-16T00:00:00.000Z", approvals: [{ principal_id: principal, approved_at: "2026-09-16T00:00:00.000Z" }], external_action_authorized: false });
  const options = { testedRevision: f.request.revision, approval: approvalPath, decision: "go", rollback: ["rollback"] };
  const gates = { test_evidence: ["test"], independent_qa_report: ["qa"] };
  await fs.writeFile(path.join(f.target, approvalPath), JSON.stringify(approval("principal-second")));
  await assert.rejects(assertHighAssuranceCloseout(f.target, context, item, options, gates), /independent of the Developer sponsor/);
  await fs.writeFile(path.join(f.target, approvalPath), JSON.stringify(approval("principal-original")));
  assert.equal((await assertHighAssuranceCloseout(f.target, context, item, options, gates)).testedRevision, f.request.revision);
});

test("V05 ordinary task defaults follow workflow even in a strict collaboration profile", async t => {
  const f = await fixture({ workflowProfile: "standard" }); t.after(f.cleanup); await member(f);
  await setCollaborationProfile(f.target, "high-assurance");
  cli(["collaboration", "bind-identity", f.target, "--principal-id", "principal-original", "--verification-class", "external-evidence",
    "--provider-id", "fixture", "--provider-subject", "original", "--evidence-ref", "docs/brief.md"]);
  const create = extra => JSON.parse(cli(["work-item", "create", f.target, "--title", "Visual copy", "--ui-mode", "code-first", ...extra, "--json"]).stdout).item;
  assert.equal(create([]).workflow_profile, "standard");
  const deployed = JSON.parse(cli(["work-item", "create", f.target, "--title", "Deploy service", "--ui-mode", "not-applicable", "--escalation-trigger", "deployment", "--json"]).stdout).item;
  assert.equal(deployed.workflow_profile, "high-assurance");
});
