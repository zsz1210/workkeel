import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { withProjectMutationLock } from "../src/project.mjs";
import { deliverLeanWorkItem } from "../src/lean-delivery.mjs";
import { fixture, cli, git, deliveryArgs, itemState, canonicalBytes } from "./helpers/lean-delivery-fixture.mjs";

async function setup(t) { const f = await fixture(); t.after(f.cleanup); return f; }
const contextArgs = f => ["context", "resolve", f.target, "--work-item", f.item.id, "--position", "developer", "--compact", "--no-write", "--json"];
const readEntry = f => JSON.parse(cli(contextArgs(f)).stdout);

test("compact entry preserves scope and warnings, identifies responsibility and never mutates state", async t => {
  const f = await setup(t);
  const before = await canonicalBytes(f);
  const full = JSON.parse(cli(contextArgs(f).filter(x => x !== "--compact")).stdout);
  const entry = readEntry(f);
  assert.equal(full.schema_version, "temple.context-capsule/v2");
  assert.equal(entry.schema_version, "temple.context-entry/v1");
  assert.equal(entry.authority, "navigation-only");
  assert.equal(entry.mutation_performed, false);
  assert.deepEqual(entry.work_item.scope, full.work_item.scope);
  assert.deepEqual(entry.work_item.acceptance_criteria, full.work_item.acceptance_criteria);
  assert.deepEqual(entry.warnings, full.warnings);
  assert.equal(entry.responsibility.recorded_agent.id, f.request.agentId);
  assert.equal(entry.responsibility.claim.id, f.request.claimId);
  assert.equal(entry.next_step.candidate_operation, "work-item deliver");
  assert.equal(entry.next_step.authorization_granted, false);
  assert.equal(entry.next_step.workflow_edge.to, "test");
  assert.equal(entry.candidate.developer_revision, null);
  assert.equal(entry.source_manifest.source_bodies_retained, false);
  assert.ok(entry.source_manifest.authority_snapshot.paths.includes("AGENTS.md"));
  assert.ok(entry.source_manifest.authority_snapshot.paths.includes(".ai-org/project/usage-policy.json"));
  assert.match(entry.read_policy, /CLI freshness inputs, not a blanket reading checklist/);
  assert.match(entry.read_policy, /current scope, acceptance, candidate evidence and applicable instructions/);
  assert.match(entry.read_policy, /Explicit native\/project, bootstrap, recovery and required selected\/unselected reading obligations still apply/);
  assert.match(entry.read_policy, /resolve missing or unclear authority/);
  assert.match(entry.read_policy, /Hashes do not prove reading/);
  assert.match(entry.read_policy, /Recheck changed authority groups/);
  assert.deepEqual(await canonicalBytes(f), before);
  assert.equal(readEntry(f).source_manifest.selection_digest, entry.source_manifest.selection_digest);
});

test("compact entry exposes changed authority hashes and unreadable sources without blessing them", async t => {
  const f = await setup(t);
  const first = readEntry(f);
  await fs.appendFile(path.join(f.target, "AGENTS.md"), "\nProject-owned added authority.\n");
  const second = readEntry(f);
  assert.notEqual(second.source_manifest.selection_digest, first.source_manifest.selection_digest);
  assert.notEqual(second.source_manifest.authority_snapshot.digest, first.source_manifest.authority_snapshot.digest);
  await fs.rename(path.join(f.target, "TEMPLE.md"), path.join(f.target, "TEMPLE.missing.md"));
  const before = await canonicalBytes(f);
  const missing = readEntry(f);
  assert.ok(missing.warnings.some(warning => warning.includes("TEMPLE.md") && warning.includes("missing")));
  assert.equal(missing.next_step.authorization_granted, false);
  assert.deepEqual(await canonicalBytes(f), before);
});

test("compact entry distinguishes route selection, current owner, delivered candidate and terminal work", async t => {
  const f = await setup(t);
  const alternate = JSON.parse(cli([...contextArgs(f), "--purpose", "integration", "--stage", "test"]).stdout);
  assert.equal(alternate.route.stage, "test");
  assert.equal(alternate.next_step.workflow_edge.from, "build");
  cli(deliveryArgs(f));
  const delivered = readEntry(f);
  assert.equal(delivered.candidate.developer_revision, f.request.revision);
  assert.equal(delivered.candidate.handoff.revision, f.request.revision);
  assert.equal(delivered.responsibility.owner_position, "quality_evaluator");
  assert.equal(delivered.next_step.candidate_operation, null);
  const args = contextArgs(f).map(value => value === "developer" ? "quality_evaluator" : value);
  assert.equal(JSON.parse(cli(args).stdout).next_step.candidate_operation, "work-item claim");
  cli(["work-item", "claim", f.target, "--work-item", f.item.id, "--agent-id", f.qualityAgent, "--principal-id", "human", "--base-revision", f.request.revision, "--branch", "main"]);
  cli(["transition", f.target, "--work-item", f.item.id, "--to", "done", "--satisfy", "test_evidence=docs/developer-test.md", "--satisfy", "lean_closeout=docs/developer-test.md"]);
  const terminal = readEntry(f);
  assert.equal(terminal.work_item.terminal, true);
  assert.equal(terminal.next_step.candidate_operation, null);
  assert.equal(terminal.next_step.workflow_edge, null);
});

test("typed input failures reject unsupported or duplicate flags before any mutation", async t => {
  const f = await setup(t);
  const before = await canonicalBytes(f);
  const cases = [
    [...deliveryArgs(f), "--actor", "someone"],
    [...deliveryArgs(f), "--operation-id", "duplicate"],
    [...deliveryArgs(f), "--made-up"],
    [...deliveryArgs(f), "--expected-plan", "not-a-digest"],
    contextArgs(f).filter(x => x !== "--no-write"),
    [...contextArgs(f), "--force"],
    [...contextArgs(f), "--work-item", f.item.id]
  ];
  for (const args of cases) {
    const failure = cli(args, { allowFailure: true });
    assert.equal(failure.status, 1, args.join(" "));
    const result = JSON.parse(failure.stdout);
    assert.equal(result.code, "INVALID_INPUT");
    assert.equal(result.mutation_status, "not_started");
    assert.equal(result.automatic_retry, false);
    assert.deepEqual(await canonicalBytes(f), before);
  }
  const wrongClaim = { ...f, request: { ...f.request, claimId: "not-owner" } };
  assert.equal(JSON.parse(cli(deliveryArgs(wrongClaim), { allowFailure: true }).stdout).code, "GUARD_REJECTED");
  const preview = JSON.parse(cli(deliveryArgs(f, ["--dry-run"])).stdout);
  await fs.appendFile(path.join(f.target, "docs/developer-test.md"), "\nEvidence changed\n");
  const stale = JSON.parse(cli(deliveryArgs(f, ["--expected-plan", preview.plan_digest]), { allowFailure: true }).stdout);
  assert.equal(stale.code, "STALE_PREVIEW");
  assert.equal(stale.mutation_status, "not_started");
});

test("pending delivery is visible in compact entry and uncertain execution is not reported as no-write", async t => {
  const f = await setup(t);
  await assert.rejects(withProjectMutationLock(f.target, () => deliverLeanWorkItem(f.target, f.request, {
    checkpoint(point) { if (point === "write-2") throw new Error("injected failure"); }
  })), error => error.code === "EXECUTION_UNCERTAIN" && error.mutationStatus === "pending_recovery");
  const paused = await canonicalBytes(f);
  const entry = readEntry(f);
  assert.equal(entry.next_step.pending_operation, `${f.item.id}/${f.request.operationId}`);
  assert.equal(entry.next_step.candidate_operation, null);
  const other = { ...f, request: { ...f.request, operationId: "unrelated" } };
  const denied = JSON.parse(cli(deliveryArgs(other), { allowFailure: true }).stdout);
  assert.equal(denied.code, "PENDING_RECOVERY");
  assert.equal(denied.mutation_status, "pending_recovery");
  assert.deepEqual(await canonicalBytes(f), paused);
  assert.equal(JSON.parse(cli(deliveryArgs(f)).stdout).status, "resumed");
});

test("composed delivery preserves reviewer identity and requires fresh candidate and evidence after rework", async t => {
  const f = await setup(t);
  cli(deliveryArgs(f));
  assert.equal((await itemState(f)).handoffs[0].actor, f.request.agentId);
  await fs.writeFile(path.join(f.target, "docs/findings.md"), "The reviewed candidate needs a same-scope correction.\n");
  cli(["work-item", "claim", f.target, "--work-item", f.item.id, "--agent-id", f.qualityAgent, "--principal-id", "human", "--base-revision", f.request.revision, "--branch", "main"]);
  cli(["work-item", "rework", f.target, "--work-item", f.item.id, "--same-scope", "--input-revision", f.request.revision, "--reason", "Correct approved behavior", "--evidence", "docs/findings.md"]);
  const claimed = JSON.parse(cli(["work-item", "claim", f.target, "--work-item", f.item.id, "--agent-id", f.request.agentId, "--principal-id", "human", "--base-revision", f.request.revision, "--branch", "main", "--json"]).stdout);
  f.request = { ...f.request, operationId: "corrected-attempt", claimId: claimed.item.claim.id };
  assert.match(cli(deliveryArgs(f), { allowFailure: true }).stderr, /rejected rework candidate/);
  await fs.appendFile(path.join(f.target, "app.mjs"), "\n// Same-scope corrected candidate fixture\n");
  git(f.target, ["add", "app.mjs"]); git(f.target, ["commit", "-m", "Correct fixture candidate"]);
  f.request.revision = git(f.target, ["rev-parse", "HEAD"]);
  assert.match(cli(deliveryArgs(f), { allowFailure: true }).stderr, /Retired rework evidence/);
  await fs.writeFile(path.join(f.target, "docs/attempt-2.md"), "Fresh attempt-specific developer evidence.\n");
  f.request.evidence = ["docs/attempt-2.md"];
  cli(deliveryArgs(f));
  const item = await itemState(f);
  assert.equal(item.state, "test");
  assert.equal(item.rework_history.length, 1);
  assert.equal(item.handoffs.at(-1).actor, f.request.agentId);
  assert.equal(item.developer_candidate_revision, f.request.revision);
  assert.deepEqual(item.gate_evidence.developer_evidence, ["docs/attempt-2.md"]);
  cli(["doctor", f.target]);
});
