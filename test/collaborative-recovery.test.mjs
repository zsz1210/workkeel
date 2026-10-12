import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { cachedFixture, cli, git, itemState } from "./helpers/lean-delivery-fixture.mjs";
import { finishLeanWorkItem } from "../src/lean-finish.mjs";
import { withProjectMutationLock } from "../src/project.mjs";
import { reconcileDocuments } from "../src/reconciliation.mjs";
import { finishObservationPath, portableFinishAttention } from "../src/portable-finish-diagnostics.mjs";
import { completionDoctorPassed } from "../src/completion-diagnostics.mjs";
import { formatJson, sha256 } from "../src/files.mjs";

const json = async (target, file) => JSON.parse(await fs.readFile(path.join(target, file), "utf8"));
const write = (target, file, value) => fs.writeFile(path.join(target, file), JSON.stringify(value, null, 2) + "\n");
const finish = (f, hooks) => withProjectMutationLock(f.target, () => finishLeanWorkItem(f.target, f.request, hooks), { leanDeliveryOperation: `${f.item.id}/${f.request.operationId}` });
async function fixture(t) {
  const f = await cachedFixture(); t.after(f.cleanup);
  f.agent = f.request.agentId;
  cli(["work-item", "release", f.target, "--work-item", f.item.id, "--agent-id", f.agent, "--principal-id", "human"]);
  const agents = await json(f.target, ".ai-org/project/agents.json");
  agents.agents.push({ id: "agent-contributor", display_name: "Builder", active: true, created_at: new Date().toISOString() });
  const c = await json(f.target, ".ai-org/project/collaboration.json");
  c.profile = "collaborative"; c.actor_policy = { ordinary_development: "attributed" };
  c.principals = ["principal-a", "principal-b"].map(id => ({ id, display_name: id === "principal-a" ? "Maintainer" : "Contributor", status: "active", active: true, provider_identities: [], created_at: null, updated_at: null }));
  c.sponsorships = agents.agents.map(agent => ({ agent_id: agent.id, principal_id: agent.id === "agent-contributor" ? "principal-b" : "principal-a", status: "active", active: true, created_at: null, ended_at: null }));
  c.memberships.push({ ...structuredClone(c.memberships.find(m => m.agent_id === f.agent && m.position_id === "developer")), agent_id: "agent-contributor", default: false });
  await write(f.target, ".ai-org/project/agents.json", agents);
  await write(f.target, ".ai-org/project/collaboration.json", c);
  const integration = await json(f.target, ".ai-org/project/repository-integration.json");
  await write(f.target, ".ai-org/project/repository-integration.json", { ...integration, status: "confirmed", source: "human-confirmed", summary: "Isolated local fixture", change_isolation: "not-required", review_gate: "not-required", recorded_at: new Date().toISOString(), recorded_by: "human" });
  git(f.target, ["add", "."]); git(f.target, ["commit", "-m", "Synthetic team fixture"]);
  f.request.revision = git(f.target, ["rev-parse", "HEAD"]);
  f.request.principalId = "principal-a"; f.request.position = "developer";
  f.request.claimId = JSON.parse(cli(["work-item", "claim", f.target, "--work-item", f.item.id, "--agent-id", f.agent, "--principal-id", "principal-a", "--base-revision", f.request.revision, "--branch", "main", "--json"]).stdout).item.claim.id;
  return f;
}

test("Maturity warning is visible without failing completion; unknown and mixed warnings still block", async t => {
  const f = await fixture(t);
  const result = await finish(f);
  assert.equal(result.success, true);
  assert.equal(result.diagnostics.doctor.summary.warn, 1);
  assert.equal(result.diagnostics.doctor.checks[0].code, "COLLABORATION_REAL_VALIDATION_NOT_PASSED");
  assert.equal((await finish(f)).diagnostics.historical, true);
  const unknown = structuredClone(result.diagnostics.doctor);
  delete unknown.checks[0].code;
  assert.equal(completionDoctorPassed(unknown), false);
  unknown.checks[0].status = "fail";
  assert.equal(completionDoctorPassed(unknown), false);
  const c = await json(f.target, ".ai-org/project/collaboration.json");
  delete c.actor_policy; await write(f.target, ".ai-org/project/collaboration.json", c);
  const doctor = JSON.parse(cli(["doctor", f.target, "--compact", "--json"]).stdout);
  assert.equal(doctor.checks.find(check => check.id === "collaboration_validation").code, undefined);
  assert.equal(completionDoctorPassed(doctor), false);
});

test("Fresh clone sees failed diagnostics and missing observations, has no replay authority, and consumes origin recovery", async t => {
  const f = await fixture(t);
  const failed = await finish(f, { checkpoint: point => { if (point === "before-doctor") throw new Error("synthetic diagnostic fault"); } });
  assert.equal(failed.status, "diagnostics_failed");
  git(f.target, ["add", "."]); git(f.target, ["commit", "-m", "Retain failed completion"]);
  const other = path.join(f.temporary, "fresh-clone");
  git(f.target, ["clone", "--no-local", f.target, other]);
  const status = JSON.parse(cli(["status", other, "--compact", "--json", "--no-write", "--work-item", f.item.id]).stdout);
  assert.equal(status.selected_work_item.delivery_attention.state, "awaiting-evidence");
  assert.ok(status.attention.some(a => a.source === "portable-observation" && a.status === "failed" && !a.local_journal_available));
  const context = JSON.parse(cli(["context", "resolve", other, "--work-item", f.item.id, "--position", "quality_evaluator", "--purpose", "recovery", "--compact", "--no-write", "--json"]).stdout);
  assert.equal(context.next_step.pending_operation, null);
  assert.equal(context.next_step.candidate_operation, null);
  assert.equal(context.next_step.completion_diagnostics[0].status, "failed");
  await assert.rejects(finish({ ...f, target: other }), /diagnostic binding/);
  const relative = finishObservationPath(f.item.id, f.request.operationId);
  const bytes = await fs.readFile(path.join(other, relative));
  await fs.unlink(path.join(other, relative));
  assert.match(cli(["doctor", other, "--compact"], { allowFailure: true }).stdout, /diagnostics are unavailable/);
  await fs.writeFile(path.join(other, relative), bytes);
  assert.equal((await finish(f)).success, true);
  git(f.target, ["add", "."]); git(f.target, ["commit", "-m", "Retain repaired diagnostics"]);
  git(other, ["pull", "--ff-only"]);
  assert.doesNotMatch(cli(["doctor", other, "--compact"]).stdout, /lean_finish_diagnostics/);
  const observed = JSON.parse(bytes); observed.receipt_sha256 = "0".repeat(64);
  await write(other, relative, observed);
  assert.match(cli(["doctor", other, "--compact"], { allowFailure: true }).stdout, /Invalid portable finish observation binding/);
  await fs.unlink(path.join(other, relative));
  const outside = path.join(f.temporary, "outside-observation.json");
  await fs.writeFile(outside, bytes);
  await fs.symlink(outside, path.join(other, relative));
  assert.match(cli(["doctor", other, "--compact"], { allowFailure: true }).stdout, /Unsafe portable finish path/);
  assert.deepEqual(await fs.readFile(outside), bytes);
});

test("Verifier can accept exact product through a committed handoff, but rejects source and authority drift", async t => {
  const f = await fixture(t); assert.equal((await finish(f)).success, true);
  git(f.target, ["add", "."]); git(f.target, ["commit", "-m", "Commit delivery records"]);
  const deliveryHead = git(f.target, ["rev-parse", "HEAD"]);
  f.request = { ...f.request, position: "quality_evaluator", operationId: "verify-delivery", agentId: f.qualityAgent, completed: [], evidence: [], judgment: "pass", testEvidence: ["docs/verification.md"], leanCloseout: ["docs/verification.md"] };
  f.request.claimId = JSON.parse(cli(["work-item", "claim", f.target, "--work-item", f.item.id, "--agent-id", f.qualityAgent, "--principal-id", "principal-a", "--base-revision", f.request.revision, "--branch", "main", "--json"]).stdout).item.claim.id;
  await fs.writeFile(path.join(f.target, "docs/verification.md"), "# Actual fixture review\nExact parser input/output and unchanged input verified.\n");
  const instructions = await fs.readFile(path.join(f.target, "TEMPLE.md"));
  await fs.appendFile(path.join(f.target, "TEMPLE.md"), "\nUncommitted instruction drift.\n");
  await assert.rejects(finish(f), /current HEAD/);
  await fs.writeFile(path.join(f.target, "TEMPLE.md"), instructions);
  const product = await fs.readFile(path.join(f.target, "app.mjs"));
  await fs.appendFile(path.join(f.target, "app.mjs"), "\n// Intermediate source drift\n");
  git(f.target, ["add", "app.mjs"]); git(f.target, ["commit", "-m", "Intermediate source change"]);
  await fs.writeFile(path.join(f.target, "app.mjs"), product);
  git(f.target, ["add", "app.mjs"]); git(f.target, ["commit", "-m", "Revert source change"]);
  await assert.rejects(finish(f), /current HEAD/);
  git(f.target, ["reset", "--mixed", deliveryHead]);
  for (const relative of ["unrelated.mjs", "package.json", "TEMPLE.md", ".ai-org/project/collaboration.json"]) {
    const filename = path.join(f.target, relative);
    const previous = await fs.readFile(filename).catch(() => null);
    await fs.appendFile(filename, "\n");
    git(f.target, ["add", relative]); git(f.target, ["commit", "-m", "Negative candidate drift"]);
    await assert.rejects(finish(f), /current HEAD/);
    // Isolated fixture only: preserve the uncommitted review claim while restoring the negative commit.
    git(f.target, ["reset", "--mixed", deliveryHead]);
    if (previous) await fs.writeFile(filename, previous); else await fs.unlink(filename);
  }
  // Committed handoff descendants must still inspect physical product bytes,
  // even when Git's index flags hide the change from status/diff.
  for (const flag of ["assume-unchanged", "skip-worktree"]) {
    git(f.target, ["update-index", `--${flag}`, "app.mjs"]);
    await fs.appendFile(path.join(f.target, "app.mjs"), "\n// Hidden physical drift\n");
    assert.equal(git(f.target, ["status", "--porcelain", "--", "app.mjs"]), "");
    const before = await fs.readFile(path.join(f.target, ".ai-org/work-items", `${f.item.id}.json`));
    await assert.rejects(finish(f), /actual bytes or mode differ/);
    assert.deepEqual(await fs.readFile(path.join(f.target, ".ai-org/work-items", `${f.item.id}.json`)), before);
    await fs.writeFile(path.join(f.target, "app.mjs"), product);
    git(f.target, ["update-index", `--no-${flag}`, "app.mjs"]);
  }
  assert.equal((await finish(f)).success, true);
  assert.equal((await itemState(f)).developer_candidate_revision, f.request.revision);
  assert.equal((await itemState(f)).state, "done");
});

test("Gate authority inside own artifacts remains immutable across handoff descendants", async t => {
  const f = await fixture(t);
  const relative = `.ai-org/artifacts/${f.item.id}/approved-scope.md`;
  const filename = path.join(f.target, relative);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const approved = "# Approved scope\nReject negative parser input.\n";
  await fs.writeFile(filename, approved);
  const existingOther = `.ai-org/artifacts/${f.item.id}/prior-note.md`;
  await fs.writeFile(path.join(f.target, existingOther), "# Existing note\n");
  const item = await itemState(f);
  item.gate_evidence.approved_scope = [relative];
  await write(f.target, `.ai-org/work-items/${f.item.id}.json`, item);
  // A shared reference is still authority even when it is Developer evidence.
  f.request.evidence = [...f.request.evidence, relative];
  git(f.target, ["add", "."]); git(f.target, ["commit", "-m", "Freeze scoped authority"]);
  f.request.revision = git(f.target, ["rev-parse", "HEAD"]);
  assert.equal((await finish(f)).success, true);
  git(f.target, ["add", "."]); git(f.target, ["commit", "-m", "Commit handoff administration"]);
  const deliveryHead = git(f.target, ["rev-parse", "HEAD"]);
  f.request = { ...f.request, position: "quality_evaluator", operationId: "verify-authority", agentId: f.qualityAgent,
    completed: [], evidence: [], judgment: "pass", testEvidence: ["docs/verification.md"], leanCloseout: ["docs/verification.md"] };
  f.request.claimId = JSON.parse(cli(["work-item", "claim", f.target, "--work-item", f.item.id, "--agent-id", f.qualityAgent,
    "--principal-id", "principal-a", "--base-revision", f.request.revision, "--branch", "main", "--json"]).stdout).item.claim.id;
  await fs.writeFile(path.join(f.target, "docs/verification.md"), "# Review\nOriginal approved parser scope verified.\n");
  const beforeItem = await fs.readFile(path.join(f.target, `.ai-org/work-items/${f.item.id}.json`));
  const beforeEvents = await fs.readFile(path.join(f.target, ".ai-org/events/events.jsonl"));
  const rejectsWithoutWrites = async () => {
    await assert.rejects(finish(f), /Product scope changed|current HEAD/);
    assert.deepEqual(await fs.readFile(path.join(f.target, `.ai-org/work-items/${f.item.id}.json`)), beforeItem);
    assert.deepEqual(await fs.readFile(path.join(f.target, ".ai-org/events/events.jsonl")), beforeEvents);
  };
  const unexpected = path.join(f.target, `.ai-org/artifacts/${f.item.id}/unreferenced.json`);
  await fs.writeFile(unexpected, "{}\n");
  await rejectsWithoutWrites();
  await fs.unlink(unexpected);
  await fs.appendFile(path.join(f.target, existingOther), "Unexpected update\n");
  await rejectsWithoutWrites();
  await fs.writeFile(path.join(f.target, existingOther), "# Existing note\n");
  for (const flag of [null, "assume-unchanged", "skip-worktree"]) {
    if (flag) git(f.target, ["update-index", `--${flag}`, relative]);
    await fs.writeFile(filename, "# Changed authority\nAccept negative parser input.\n");
    await rejectsWithoutWrites();
    await fs.writeFile(filename, approved);
    if (flag) git(f.target, ["update-index", `--no-${flag}`, relative]);
  }
  await fs.writeFile(filename, "# Committed authority drift\n");
  git(f.target, ["add", relative]); git(f.target, ["commit", "-m", "Change approval"]);
  await rejectsWithoutWrites();
  await fs.writeFile(filename, approved);
  git(f.target, ["add", relative]); git(f.target, ["commit", "-m", "Restore approval bytes"]);
  await rejectsWithoutWrites();
  git(f.target, ["reset", "--mixed", deliveryHead]);
  const reviewerEvidence = `.ai-org/artifacts/${f.item.id}/new-review.md`;
  await fs.writeFile(path.join(f.target, reviewerEvidence), "# Reviewer judgment\nOriginal scope holds.\n");
  f.request.testEvidence = [reviewerEvidence];
  f.request.leanCloseout = [reviewerEvidence];
  await fs.unlink(path.join(f.target, "docs/verification.md"));
  assert.equal((await finish(f)).success, true);
  assert.equal((await itemState(f)).state, "done");
});

test("Exact HEAD does not bypass physical gate authority for Developer or Verifier", async t => {
  for (const position of ["developer", "quality_evaluator"]) {
    const f = await fixture(t);
    if (position === "quality_evaluator") {
      assert.equal((await finish(f)).success, true);
      f.request = { ...f.request, position, operationId: "exact-head-review", agentId: f.qualityAgent,
        completed: [], evidence: [], judgment: "pass", testEvidence: ["docs/verification.md"], leanCloseout: ["docs/verification.md"] };
      f.request.claimId = JSON.parse(cli(["work-item", "claim", f.target, "--work-item", f.item.id, "--agent-id", f.qualityAgent,
        "--principal-id", "principal-a", "--base-revision", f.request.revision, "--branch", "main", "--json"]).stdout).item.claim.id;
      await fs.writeFile(path.join(f.target, "docs/verification.md"), "# Review\nApproved scope independently checked.\n");
    }
    const authority = "docs/brief.md", file = path.join(f.target, authority), original = await fs.readFile(file);
    const itemPath = path.join(f.target, `.ai-org/work-items/${f.item.id}.json`);
    const eventsPath = path.join(f.target, ".ai-org/events/events.jsonl");
    const beforeItem = await fs.readFile(itemPath), beforeEvents = await fs.readFile(eventsPath);
    for (const flag of [null, "assume-unchanged", "skip-worktree"]) {
      if (flag) git(f.target, ["update-index", `--${flag}`, authority]);
      await fs.appendFile(file, "\nChange the approved behavior.\n");
      assert.equal(git(f.target, ["rev-parse", "HEAD"]), f.request.revision);
      if (flag) assert.equal(git(f.target, ["status", "--porcelain", "--", authority]), "");
      await assert.rejects(finish(f), /Product scope changed/);
      assert.deepEqual(await fs.readFile(itemPath), beforeItem);
      assert.deepEqual(await fs.readFile(eventsPath), beforeEvents);
      await fs.writeFile(file, original);
      if (flag) git(f.target, ["update-index", `--no-${flag}`, authority]);
    }
    assert.equal((await finish(f)).success, true);
    assert.equal((await itemState(f)).state, position === "developer" ? "test" : "done");
  }
});

test("Contributor proposal preserves manager ownership, provenance, unique IDs and execution restrictions", async t => {
  const f = await fixture(t);
  const args = [f.target, "--title", "Proposed by contributor", "--agent-id", "agent-contributor", "--principal-id", "principal-b", "--ui-mode", "not-applicable", "--affected-path", "docs/new.md", "--json"];
  const other = path.join(f.temporary, "proposal-clone");
  git(f.target, ["clone", "--no-local", f.target, other]);
  const before = await fs.readFile(path.join(f.target, ".ai-org/events/events.jsonl"));
  for (const badArgs of [args.map(value => value === "principal-b" ? "principal-a" : value), [f.target, "--title", "No explicit identity", "--json"]]) {
    assert.notEqual(cli(["work-item", "propose", ...badArgs], { allowFailure: true }).status, 0);
    assert.deepEqual(await fs.readFile(path.join(f.target, ".ai-org/events/events.jsonl")), before);
  }
  const blocked = cli(["work-item", "create", ...args], { allowFailure: true });
  assert.notEqual(blocked.status, 0); assert.match(blocked.stderr + blocked.stdout, /propose/);
  const proposal = JSON.parse(cli(["work-item", "propose", ...args, "--position", "developer"]).stdout).item;
  const second = JSON.parse(cli(["work-item", "propose", ...args.map(value => value === f.target ? other : value), "--position", "developer"]).stdout).item;
  assert.notEqual(proposal.id, second.id); assert.equal(proposal.state, "intake");
  assert.equal(proposal.owner_position, "engineering_manager"); assert.equal(proposal.claim, null);
  assert.notEqual(proposal.assigned_agent_id, "agent-contributor");
  assert.equal(proposal.proposed_by.principal_id, "principal-b"); assert.deepEqual(proposal.gate_evidence, {});
  assert.notEqual(cli(["work-item", "claim", f.target, "--work-item", proposal.id, "--agent-id", "agent-contributor", "--principal-id", "principal-b", "--base-revision", f.request.revision], { allowFailure: true }).status, 0);
  assert.notEqual(cli(["work-item", "propose", ...args, "--position", "engineering_manager"], { allowFailure: true }).status, 0);
  assert.equal(cli(["doctor", f.target, "--compact"]).status, 0);
  const c = await json(f.target, ".ai-org/project/collaboration.json");
  Object.assign(c.memberships.find(m => m.agent_id === "agent-contributor"), { active: false, status: "revoked" });
  await write(f.target, ".ai-org/project/collaboration.json", c);
  const after = await fs.readFile(path.join(f.target, ".ai-org/events/events.jsonl"));
  assert.notEqual(cli(["work-item", "propose", ...args], { allowFailure: true }).status, 0);
  assert.deepEqual(await fs.readFile(path.join(f.target, ".ai-org/events/events.jsonl")), after);
});

test("Competing claim preview names both owners and never selects a winner", () => {
  const base = { id: "WI-0001", state: "build", claim: null };
  const a = { ...base, claim: { id: "claim-a", status: "active", agent_id: "agent-a", principal_id: "principal-a", branch: "a" } };
  const b = { ...base, claim: { id: "claim-b", status: "active", agent_id: "agent-b", principal_id: "principal-b", branch: "b" } };
  const result = reconcileDocuments(base, a, b);
  assert.equal(result.valid, false);
  assert.equal(result.conflicts[0].condition, "competing-active-claims");
  assert.deepEqual(result.conflicts[0].responsible_actors.map(actor => actor.principal_id), ["principal-a", "principal-b"]);
  assert.match(result.conflicts[0].next_action, /release or hand off/);
});

test("Portable observations reject missing or wrongly typed identities and bindings even with matching hashes", async t => {
  for (const operation of [undefined, null, 42, {}, [], "", "../escape"]) {
    assert.throws(() => finishObservationPath("WI-0001", operation), /Invalid portable finish identity/);
  }
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "temple-portable-contract-"));
  t.after(() => fs.rm(target, { recursive: true, force: true }));
  const receiptPath = ".ai-org/artifacts/WI-0001/finish-attempt.json";
  const observationPath = finishObservationPath("WI-0001", "attempt");
  await fs.mkdir(path.dirname(path.join(target, receiptPath)), { recursive: true });
  const seed = {
    schema_version: "temple.lean-finish-receipt/v1", applied_at: new Date().toISOString(),
    diagnostics_observation: observationPath,
    request: { schema_version: "temple.lean-finish-request/v1", work_item_id: "WI-0001", operation_id: "attempt",
      candidate_revision: "a".repeat(40), agent_id: "agent-builder", principal_id: "human", claim_id: "claim-fixture",
      position: "developer", completed: ["Fixture"], evidence: ["docs/test.md"], unresolved: [] },
    result: { work_item_id: "WI-0001", operation_id: "attempt", candidate_revision: "a".repeat(40), plan_digest: "b".repeat(64), receipt: receiptPath }
  };
  async function retain(mutateReceipt = () => {}, mutateObservation = () => {}) {
    const receipt = structuredClone(seed); mutateReceipt(receipt);
    receipt.request_digest = sha256(formatJson(receipt.request));
    const bytes = formatJson(receipt);
    const observation = { schema_version: "temple.finish-observation/v1", authority: "observation-only",
      work_item_id: receipt.request.work_item_id, operation_id: receipt.request.operation_id,
      candidate_revision: receipt.request.candidate_revision, request_digest: receipt.request_digest,
      plan_digest: receipt.result.plan_digest, receipt_sha256: sha256(bytes), status: "passed",
      observed_at: new Date().toISOString(), errors: [], recovery_authority: "origin-checkout-journal-required" };
    mutateObservation(observation);
    await fs.writeFile(path.join(target, receiptPath), bytes);
    await write(target, observationPath, observation);
  }
  await retain(); assert.deepEqual(await portableFinishAttention(target, []), []);
  for (const [label, changeReceipt, changeObservation] of [
    ["missing operation", r => { delete r.request.operation_id; delete r.result.operation_id; }],
    ["numeric operation", r => { r.request.operation_id = r.result.operation_id = 42; }],
    ["missing candidate", r => { delete r.request.candidate_revision; delete r.result.candidate_revision; }],
    ["numeric candidate", r => { r.request.candidate_revision = r.result.candidate_revision = 42; }],
    ["missing plan", r => { delete r.result.plan_digest; }],
    ["invalid plan", r => { r.result.plan_digest = "short"; }],
    ["mismatched work item", r => { r.result.work_item_id = "WI-0002"; }],
    ["mismatched operation", r => { r.result.operation_id = "other"; }],
    ["wrong receipt path", r => { r.result.receipt = "../elsewhere"; }],
    ["missing actor", r => { delete r.request.agent_id; }],
    ["missing evidence", r => { delete r.request.evidence; }],
    ["numeric applied time", r => { r.applied_at = 42; }],
    ["missing recovery authority", undefined, o => { delete o.recovery_authority; }],
    ["numeric observation time", undefined, o => { o.observed_at = 42; }],
    ["failed errors on pass", undefined, o => { o.errors = ["failure"]; }]
  ]) {
    await retain(changeReceipt, changeObservation);
    await assert.rejects(portableFinishAttention(target, []), /Invalid portable finish/, label);
  }
});
