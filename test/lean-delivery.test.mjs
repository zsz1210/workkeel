import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { withProjectMutationLock } from "../src/project.mjs";
import { deliverLeanWorkItem } from "../src/lean-delivery.mjs";
import { readPendingLeanDelivery, leanDeliveryStateDirectory } from "../src/lean-delivery-state.mjs";
import { fixture, cli, git, deliveryArgs, itemState, canonicalBytes } from "./helpers/lean-delivery-fixture.mjs";

async function setup(t) { const f = await fixture(); t.after(f.cleanup); return f; }
const apply = (f, hooks) => withProjectMutationLock(f.target, () => deliverLeanWorkItem(f.target, f.request, hooks), { leanDeliveryOperation: `${f.item.id}/${f.request.operationId}` });

test("Lean delivery preview is read-only, applies one responsibility change, and retries without writes", async (t) => {
  const f = await setup(t);
  const before = await canonicalBytes(f);
  const first = JSON.parse(cli(deliveryArgs(f, ["--dry-run"])).stdout);
  const second = JSON.parse(cli(deliveryArgs(f, ["--dry-run"])).stdout);
  assert.equal(first.plan_digest, second.plan_digest);
  assert.deepEqual(await canonicalBytes(f), before);
  assert.equal(await readPendingLeanDelivery(f.target), null);
  const result = JSON.parse(cli(deliveryArgs(f, ["--expected-plan", first.plan_digest])).stdout);
  assert.equal(result.status, "applied");
  assert.equal(result.testing_performed, false);
  const item = await itemState(f);
  assert.equal(item.state, "test");
  assert.equal(item.owner_position, "quality_evaluator");
  assert.equal(item.assigned_agent_id, f.qualityAgent);
  assert.equal(item.claim.status, "released");
  assert.equal(item.handoffs.length, 1);
  assert.equal(item.developer_candidate_revision, f.request.revision);
  const events = (await fs.readFile(path.join(f.target, ".ai-org/events/events.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(events.slice(-3).map((event) => event.event_type), ["handoff_created", "work_item_claim_released", "work_item_transitioned"]);
  const after = await canonicalBytes(f);
  assert.equal(JSON.parse(cli(deliveryArgs(f)).stdout).status, "already_applied");
  assert.deepEqual(await canonicalBytes(f), after);
  f.request.completed = ["Different facts"];
  assert.match(cli(deliveryArgs(f), { allowFailure: true }).stderr, /conflicts/);
  assert.deepEqual(await canonicalBytes(f), after);
});

test("Lean delivery completed retry remains historical after Test ownership advances", async (t) => {
  const f = await setup(t);
  cli(deliveryArgs(f));
  cli(["work-item", "claim", f.target, "--work-item", f.item.id, "--agent-id", f.qualityAgent, "--principal-id", "human", "--base-revision", f.request.revision, "--branch", "main"]);
  git(f.target, ["add", "."]); git(f.target, ["commit", "-m", "Record Test ownership"]);
  const before = await canonicalBytes(f);
  const retry = JSON.parse(cli(deliveryArgs(f)).stdout);
  assert.equal(retry.status, "already_applied");
  assert.deepEqual(await canonicalBytes(f), before);
  assert.equal((await itemState(f)).claim.agent_id, f.qualityAgent);
});

test("Lean delivery rejects wrong claim, actor, Principal, and evidence with no canonical change", async (t) => {
  const f = await setup(t);
  const before = await canonicalBytes(f);
  for (const [field, value] of [["claimId", "stale"], ["agentId", f.qualityAgent], ["principalId", "stranger"], ["evidence", ["docs/missing.md"]], ["evidence", ["../outside.md"]]]) {
    const request = { ...f.request, [field]: value };
    await assert.rejects(withProjectMutationLock(f.target, () => deliverLeanWorkItem(f.target, request)));
    assert.deepEqual(await canonicalBytes(f), before);
    assert.equal(await readPendingLeanDelivery(f.target), null);
  }
});

test("Lean delivery rejects stale evidence and policy previews", async (t) => {
  const f = await setup(t);
  const preview = JSON.parse(cli(deliveryArgs(f, ["--dry-run"])).stdout);
  await fs.appendFile(path.join(f.target, "docs/developer-test.md"), "\nChanged evidence\n");
  const before = await canonicalBytes(f);
  assert.match(cli(deliveryArgs(f, ["--expected-plan", preview.plan_digest]), { allowFailure: true }).stderr, /Stale/);
  assert.deepEqual(await canonicalBytes(f), before);
  const next = JSON.parse(cli(deliveryArgs(f, ["--dry-run"])).stdout);
  await fs.appendFile(path.join(f.target, ".ai-org/core/policies.json"), "\n");
  assert.match(cli(deliveryArgs(f, ["--expected-plan", next.plan_digest]), { allowFailure: true }).stderr, /Stale/);
});

test("Lean delivery requires the exact clean candidate and regular evidence files", async (t) => {
  const f = await setup(t);
  await fs.appendFile(path.join(f.target, "app.mjs"), "\n// Changed\n");
  assert.match(cli(deliveryArgs(f), { allowFailure: true }).stderr, /uncommitted/);
  git(f.target, ["add", "app.mjs"]); git(f.target, ["commit", "-m", "Change candidate"]);
  const before = await canonicalBytes(f);
  assert.match(cli(deliveryArgs(f), { allowFailure: true }).stderr, /Product scope changed/);
  assert.deepEqual(await canonicalBytes(f), before);
  f.request.revision = git(f.target, ["rev-parse", "HEAD"]);
  await fs.symlink(path.join(f.temporary, "init.json"), path.join(f.target, "docs/linked.md"));
  f.request.evidence = ["docs/linked.md"];
  assert.match(cli(deliveryArgs(f), { allowFailure: true }).stderr, /regular repository files/);
});

test("Lean delivery keeps Standard and interface work on their existing paths", async (t) => {
  const f = await setup(t);
  // Synthetic adversarial fixture; product mutations use CLI in real operation.
  const file = path.join(f.target, `.ai-org/work-items/${f.item.id}.json`);
  const original = await itemState(f);
  for (const altered of [{ ...original, workflow_profile: "standard" }, { ...original, ui_delivery_mode: "code-first" }, { ...original, risk_tier: "high" }, { ...original, profile_assessment: { ...original.profile_assessment, escalation_triggers: ["cross-repo-contract"] } }]) {
    await fs.writeFile(file, JSON.stringify(altered));
    const before = await canonicalBytes(f);
    assert.notEqual(cli(deliveryArgs(f), { allowFailure: true }).status, 0);
    assert.deepEqual(await canonicalBytes(f), before);
  }
});

for (const point of ["journal", "write-1", "write-2", "write-3", "write-4"]) {
  test(`Lean delivery resumes interruption at ${point} without duplicate events`, async (t) => {
    const f = await setup(t);
    await assert.rejects(apply(f, { checkpoint: (current) => { if (current === point) throw new Error("injected interruption"); } }), /injected/);
    assert.ok(await readPendingLeanDelivery(f.target));
    const paused = await canonicalBytes(f);
    const denied = cli(["work-item", "release", f.target, "--work-item", f.item.id], { allowFailure: true });
    assert.match(denied.stderr, /recovery is pending/);
    assert.deepEqual(await canonicalBytes(f), paused);
    const result = JSON.parse(cli(deliveryArgs(f)).stdout);
    assert.equal(result.status, "resumed");
    assert.equal(await readPendingLeanDelivery(f.target), null);
    assert.equal((await itemState(f)).state, "test");
    const events = (await fs.readFile(path.join(f.target, ".ai-org/events/events.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(events.filter((entry) => entry.event_type === "handoff_created").length, 1);
    assert.equal(events.filter((entry) => entry.event_type === "work_item_claim_released").length, 1);
    const after = await canonicalBytes(f);
    assert.equal(JSON.parse(cli(deliveryArgs(f)).stdout).status, "already_applied");
    assert.deepEqual(await canonicalBytes(f), after);
  });
}

test("Lean delivery preserves a pending journal when its evidence or output drifts", async (t) => {
  const f = await setup(t);
  await assert.rejects(apply(f, { checkpoint: (point) => { if (point === "journal") throw new Error("interrupted"); } }));
  await fs.appendFile(path.join(f.target, "docs/developer-test.md"), "\nChanged after journal\n");
  const before = await canonicalBytes(f);
  assert.match(cli(deliveryArgs(f), { allowFailure: true }).stderr, /input changed/);
  assert.deepEqual(await canonicalBytes(f), before);
  assert.ok(await readPendingLeanDelivery(f.target));
  const other = { ...f, request: { ...f.request, operationId: "other" } };
  assert.match(cli(deliveryArgs(other), { allowFailure: true }).stderr, /recovery is pending/);
});

test("Lean delivery refuses a linked journal directory", async (t) => {
  const f = await setup(t);
  const directory = await leanDeliveryStateDirectory(f.target, true);
  await fs.mkdir(path.dirname(directory), { recursive: true });
  await fs.symlink(f.temporary, directory);
  const before = await canonicalBytes(f);
  assert.match(cli(deliveryArgs(f), { allowFailure: true }).stderr, /Unsafe Lean delivery state/);
  assert.deepEqual(await canonicalBytes(f), before);
});

test("Lean delivery refuses active workers and resumes only unchanged canonical outputs", async (t) => {
  const f = await setup(t);
  const workersPath = path.join(f.target, ".ai-org/project/runtime-workers.json");
  const original = await fs.readFile(workersPath, "utf8");
  const workers = JSON.parse(original);
  workers.workers.push({ work_item_id: f.item.id, status: "active" });
  await fs.writeFile(workersPath, JSON.stringify(workers));
  assert.match(cli(deliveryArgs(f), { allowFailure: true }).stderr, /runtime worker/);
  await fs.writeFile(workersPath, original);
  await assert.rejects(apply(f, { checkpoint: (point) => { if (point === "write-2") throw new Error("interrupted"); } }));
  await fs.appendFile(path.join(f.target, ".ai-org/events/events.jsonl"), '{"event_type":"outside-writer"}\n');
  const before = await canonicalBytes(f);
  assert.match(cli(deliveryArgs(f), { allowFailure: true }).stderr, /output changed unexpectedly/);
  assert.deepEqual(await canonicalBytes(f), before);
  assert.ok(await readPendingLeanDelivery(f.target));
});

test("Lean delivery rechecks normalized evidence expiry during pending recovery", async (t) => {
  const f = await setup(t);
  cli(["evidence", "git", f.target, "--work-item", f.item.id, "--revision", f.request.revision]);
  const registryPath = path.join(f.target, ".ai-org/project/evidence.json");
  const registry = JSON.parse(await fs.readFile(registryPath));
  const entry = registry.entries.at(-1);
  entry.expires_at = "2099-01-01T00:00:00.000Z";
  await fs.writeFile(registryPath, JSON.stringify(registry));
  f.request.evidence = [entry.id];
  await assert.rejects(apply(f, { checkpoint: (point) => { if (point === "journal") throw new Error("interrupted"); } }), /interrupted/);
  const before = await canonicalBytes(f);
  const originalNow = Date.now;
  Date.now = () => Date.parse("2100-01-01T00:00:00.000Z");
  try { await assert.rejects(apply(f), /not current/); } finally { Date.now = originalNow; }
  assert.deepEqual(await canonicalBytes(f), before);
  assert.ok(await readPendingLeanDelivery(f.target));
});

test("Lean delivery rechecks Developer qualification expiry during pending recovery", async (t) => {
  const f = await setup(t);
  const collaborationPath = path.join(f.target, ".ai-org/project/collaboration.json");
  const collaboration = JSON.parse(await fs.readFile(collaborationPath));
  for (const membership of collaboration.memberships.filter((entry) => entry.agent_id === f.request.agentId && entry.position_id === "developer")) {
    membership.qualification = { ...membership.qualification, expires_at: "2099-01-01T00:00:00.000Z" };
  }
  await fs.writeFile(collaborationPath, JSON.stringify(collaboration));
  await assert.rejects(apply(f, { checkpoint: (point) => { if (point === "journal") throw new Error("interrupted"); } }), /interrupted/);
  const before = await canonicalBytes(f);
  const originalNow = Date.now;
  Date.now = () => Date.parse("2100-01-01T00:00:00.000Z");
  try { await assert.rejects(apply(f), /no longer eligible|No eligible selected Agent/); } finally { Date.now = originalNow; }
  assert.deepEqual(await canonicalBytes(f), before);
  assert.ok(await readPendingLeanDelivery(f.target));
});
