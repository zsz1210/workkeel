import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { withProjectMutationLock } from "../src/project.mjs";
import { finishLeanWorkItem } from "../src/lean-finish.mjs";
import { inspectParallelPlan } from "../src/orchestration.mjs";
import { readPendingLeanDelivery, readLeanFinishDiagnostics, leanDeliveryStateDirectory } from "../src/lean-delivery-state.mjs";
import { cachedFixture as fixture, cli, git, deliveryArgs, itemState, canonicalBytes } from "./helpers/lean-delivery-fixture.mjs";

async function setup(t, verifier = false, options) {
  const f = await fixture(options); t.after(f.cleanup);
  // Synthetic fixtures may author policy/evidence; production uses governed records.
  const integrationPath = path.join(f.target, ".ai-org/project/repository-integration.json");
  const integration = JSON.parse(await fs.readFile(integrationPath));
  await fs.writeFile(integrationPath, JSON.stringify({ ...integration, status: "confirmed", source: "human-confirmed", summary: "Local fixture only", change_isolation: "not-required", review_gate: "not-required", recorded_at: "2026-09-01T00:00:00.000Z", recorded_by: "human" }));
  f.request.position = "developer";
  if (verifier) {
    cli(deliveryArgs(f));
    const claim = JSON.parse(cli(["work-item", "claim", f.target, "--work-item", f.item.id, "--agent-id", f.qualityAgent, "--principal-id", "human", "--base-revision", f.request.revision, "--branch", "main", "--json"]).stdout).item.claim;
    await fs.writeFile(path.join(f.target, "docs/verification.md"), "# Verifier evidence\nParser acceptance checked against exact candidate; all criteria pass.\n");
    await fs.writeFile(path.join(f.target, "docs/closeout.md"), "# Lean closeout\nAccepted local scope. No unresolved criteria, external action or formal Independent QA claimed.\n");
    f.request = { ...f.request, position: "quality_evaluator", operationId: "parser-acceptance", claimId: claim.id, agentId: f.qualityAgent, completed: [], evidence: [], judgment: "pass", testEvidence: ["docs/verification.md"], leanCloseout: ["docs/closeout.md"] };
  }
  return f;
}

function args(f, extra = []) {
  const r = f.request;
  const out = deliveryArgs(f); out[1] = "finish";
  out.push("--position", r.position);
  if (r.judgment !== undefined) out.push("--judgment", r.judgment);
  for (const ref of r.testEvidence ?? []) out.push("--test-evidence", ref);
  for (const ref of r.leanCloseout ?? []) out.push("--lean-closeout", ref);
  return [...out, ...extra];
}
const apply = (f, hooks) => withProjectMutationLock(f.target, () => finishLeanWorkItem(f.target, f.request, hooks), { leanDeliveryOperation: `${f.item.id}/${f.request.operationId}` });
const interrupt = point => ({ checkpoint: current => { if (current === point) throw new Error(`injected ${point}`); } });
async function lifecycleBytes(f) { return Object.fromEntries(Object.entries(await canonicalBytes(f)).filter(([name]) => !name.startsWith(".ai-org/views/") && !/^\.ai-org\/artifacts\/WI-[^/]+\/diagnostics-[^/]+\.json$/.test(name))); }
async function events(f) { return (await fs.readFile(path.join(f.target, ".ai-org/events/events.jsonl"), "utf8")).trim().split("\n").map(JSON.parse); }
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== "object") return typeof value === "string" ? value.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, "TIMESTAMP") : value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalize(entry)]));
}

for (const verifier of [false, true]) test(`Lean finish ${verifier ? "Verifier" : "Developer"} matches individual operations and has read-only preview/replay`, async t => {
  const f = await setup(t, verifier);
  const baseline = { ...f, target: path.join(f.temporary, "baseline") };
  await fs.cp(f.target, baseline.target, { recursive: true });
  const before = await canonicalBytes(f);
  const preview = JSON.parse(cli(args(f, ["--dry-run"])).stdout);
  assert.equal(preview.status, "ready"); assert.equal(preview.diagnostics.status, "not_run");
  assert.deepEqual(await canonicalBytes(f), before);
  const result = JSON.parse(cli(args(f, ["--expected-plan", preview.mutation.plan_digest])).stdout);
  assert.equal(result.success, true); assert.equal(result.mutation.status, "applied");
  assert.equal(result.next_stage_ready, true); assert.equal(result.authority_granted, false);
  assert.equal(result.mutation.testing_performed, false); assert.equal(result.diagnostics.doctor.validation_scope, "full");
  assert.equal(result.diagnostics.status_rebuild.result.projection_scope, "full");
  if (verifier) {
    cli(["work-item", "release", baseline.target, "--work-item", f.item.id, "--agent-id", f.request.agentId, "--principal-id", "human"]);
    cli(["transition", baseline.target, "--work-item", f.item.id, "--actor", f.request.agentId, "--to", "done", "--satisfy", "test_evidence=docs/verification.md", "--satisfy", "lean_closeout=docs/closeout.md"]);
  } else cli(deliveryArgs(baseline));
  assert.deepEqual(normalize(await itemState(f)), normalize(await itemState(baseline)));
  assert.deepEqual(normalize(await events(f)), normalize(await events(baseline)));
  assert.equal((await itemState(f)).state, verifier ? "done" : "test");
  const after = await canonicalBytes(f);
  const retry = JSON.parse(cli(args(f)).stdout);
  assert.equal(retry.status, "already_applied"); assert.equal(retry.diagnostics.historical, true);
  assert.equal(retry.next_stage_ready, false); assert.match(retry.next_action, /Historical completion/);
  assert.deepEqual(await canonicalBytes(f), after);
});

test("Developer finishes a candidate committed after claiming its base", async t => {
  const f = await setup(t);
  await fs.appendFile(path.join(f.target, "app.mjs"), "\n// Accepted product change\n");
  git(f.target, ["add", "app.mjs"]); git(f.target, ["commit", "-m", "Implement after claim"]);
  f.request.revision = git(f.target, ["rev-parse", "HEAD"]);
  assert.notEqual((await itemState(f)).claim.base_revision, f.request.revision);
  assert.equal(JSON.parse(cli(args(f)).stdout).success, true);
});

for (const verifier of [false, true]) for (const flag of ["--assume-unchanged", "--skip-worktree"]) {
  test(`Finish ${verifier ? "Verifier" : "Developer"} rejects hidden product drift under ${flag}`, async t => {
    const f = await setup(t, verifier), file = path.join(f.target, "app.mjs"), original = await fs.readFile(file);
    const preview = JSON.parse(cli(args(f, ["--dry-run"])).stdout);
    const before = await canonicalBytes(f);
    // Visible edits must still fail through the original guard.
    await fs.appendFile(file, "// visible change\n");
    assert.match(cli(args(f), { allowFailure: true }).stderr, /uncommitted changes/);
    await fs.writeFile(file, original);
    git(f.target, ["update-index", flag, "app.mjs"]);
    assert.equal(JSON.parse(cli(args(f, ["--dry-run"])).stdout).status, "ready");
    for (const change of [() => fs.writeFile(file, Buffer.from([0, 255, 1])), () => fs.unlink(file)]) {
      await change();
      assert.equal(git(f.target, ["status", "--porcelain", "--", "app.mjs"]), "");
      for (const extra of [["--dry-run"], ["--expected-plan", preview.mutation.plan_digest]]) {
        const result = cli(args(f, extra), { allowFailure: true });
        assert.notEqual(result.status, 0); assert.match(result.stderr, /Product scope changed/);
        assert.deepEqual(await canonicalBytes(f), before);
      }
      assert.equal(await readPendingLeanDelivery(f.target), null);
      assert.equal((await readLeanFinishDiagnostics(f.target)).length, 0);
      await fs.writeFile(file, original);
    }
    const result = JSON.parse(cli(args(f, ["--expected-plan", preview.mutation.plan_digest])).stdout);
    assert.equal(result.success, true);
    assert.equal((await itemState(f)).state, verifier ? "done" : "test");
    assert.match(git(f.target, ["ls-files", "-v", "app.mjs"]), flag === "--assume-unchanged" ? /^h / : /^S /);
  });
}

for (const verifier of [false, true]) test(`Finish ${verifier ? "Verifier" : "Developer"} retains interrupted journal on hidden drift`, async t => {
  const f = await setup(t, verifier), file = path.join(f.target, "app.mjs"), original = await fs.readFile(file);
  git(f.target, ["update-index", "--skip-worktree", "app.mjs"]);
  await assert.rejects(apply(f, interrupt("journal")), /injected/);
  const pending = await readPendingLeanDelivery(f.target), before = await canonicalBytes(f);
  await fs.appendFile(file, "// hidden after interruption\n");
  await assert.rejects(apply(f), /Product scope changed/);
  assert.deepEqual(await readPendingLeanDelivery(f.target), pending);
  assert.deepEqual(await canonicalBytes(f), before);
  await fs.writeFile(file, original);
  assert.equal((await apply(f)).success, true);
  assert.equal((await itemState(f)).state, verifier ? "done" : "test");
});

for (const verifier of [false, true]) test(`Finish ${verifier ? "Verifier" : "Developer"} does not settle diagnostics after hidden drift`, async t => {
  const f = await setup(t, verifier), file = path.join(f.target, "app.mjs"), original = await fs.readFile(file);
  git(f.target, ["update-index", "--assume-unchanged", "app.mjs"]);
  await assert.rejects(apply(f, { checkpoint: async point => {
    if (point === "after-doctor") await fs.appendFile(file, "// hidden during diagnostics\n");
  } }), /Product scope changed/);
  // Lifecycle was already applied before diagnostics; never pretend it rolled back.
  assert.equal((await itemState(f)).state, verifier ? "done" : "test");
  assert.equal((await readLeanFinishDiagnostics(f.target))[0].status, "pending");
  await fs.writeFile(file, original);
  assert.equal((await apply(f)).success, true);
});

test("Direct deliver also rejects hidden product drift without canonical writes", async t => {
  const f = await setup(t), file = path.join(f.target, "app.mjs"), original = await fs.readFile(file);
  git(f.target, ["update-index", "--skip-worktree", "app.mjs"]);
  const before = await canonicalBytes(f);
  await fs.appendFile(file, "// hidden direct-delivery change\n");
  const result = cli(deliveryArgs(f), { allowFailure: true });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /Product scope changed/);
  assert.deepEqual(await canonicalBytes(f), before);
  await fs.writeFile(file, original);
  assert.equal(cli(deliveryArgs(f)).status, 0);
});

test("Finish uses literal directory scope and rejects ignored inventory additions", async t => {
  const dir = "product [literal]", file = `${dir}/binary\tname\n.bin`;
  const f = await setup(t, false, { affectedPaths: [dir] });
  await fs.mkdir(path.join(f.target, dir));
  await fs.writeFile(path.join(f.target, file), Buffer.from([0, 255, 10]));
  git(f.target, ["add", "--", dir]); git(f.target, ["commit", "-m", "Literal scoped binary"]);
  f.request.revision = git(f.target, ["rev-parse", "HEAD"]);
  const before = await canonicalBytes(f);
  await fs.appendFile(path.join(f.target, ".git/info/exclude"), "\nhidden.tmp\n");
  await fs.writeFile(path.join(f.target, dir, "hidden.tmp"), "ignored extra product\n");
  assert.equal(git(f.target, ["--literal-pathspecs", "status", "--porcelain", "--", dir]), "");
  assert.match(cli(args(f), { allowFailure: true }).stderr, /Product scope changed/);
  assert.deepEqual(await canonicalBytes(f), before);
  await fs.unlink(path.join(f.target, dir, "hidden.tmp"));
  assert.equal(JSON.parse(cli(args(f)).stdout).success, true);
});

test("Finish rejects invalid flags and missing or mismatched Verifier acceptance facts without writes", async t => {
  const f = await setup(t, true); const original = structuredClone(f.request); const before = await canonicalBytes(f);
  for (const [key, value] of [["position", "independent_qa"], ["judgment", "fail"], ["judgment", undefined], ["testEvidence", []], ["leanCloseout", []], ["claimId", "stale"], ["agentId", "agent-builder"], ["principalId", "stranger"], ["testEvidence", ["docs/missing.md"]], ["unresolved", ["Open criterion"]]]) {
    f.request = { ...original, [key]: value };
    assert.notEqual(cli(args(f), { allowFailure: true }).status, 0, key);
    assert.deepEqual(await canonicalBytes(f), before, key);
  }
  f.request = original;
  for (const extra of [["--position", "quality_evaluator"], ["--unknown"], ["--completed", "Wrong stage field"]]) assert.notEqual(cli(args(f, extra), { allowFailure: true }).status, 0);
  assert.deepEqual(await canonicalBytes(f), before);
});

test("Verifier rejects same Developer Identity, candidate drift, ineligible profile and active workers", async t => {
  const f = await setup(t, true); const file = path.join(f.target, `.ai-org/work-items/${f.item.id}.json`); const original = await itemState(f);
  for (const altered of [
    { ...original, handoffs: original.handoffs.map(entry => ({ ...entry, actor: f.request.agentId })) },
    { ...original, developer_candidate_revision: "0".repeat(40) },
    { ...original, claim: { ...original.claim, base_revision: "invalid" } },
    { ...original, workflow_profile: "standard" }, { ...original, risk_tier: "high" },
    { ...original, ui_delivery_mode: "code-first" }, { ...original, unresolved: ["Unresolved criterion"] }
  ]) {
    await fs.writeFile(file, JSON.stringify(altered)); const before = await canonicalBytes(f);
    assert.notEqual(cli(args(f), { allowFailure: true }).status, 0); assert.deepEqual(await canonicalBytes(f), before);
  }
  await fs.writeFile(file, JSON.stringify(original));
  const workerFile = path.join(f.target, ".ai-org/project/runtime-workers.json"); const workers = JSON.parse(await fs.readFile(workerFile));
  workers.workers.push({ work_item_id: f.item.id, status: "active" }); await fs.writeFile(workerFile, JSON.stringify(workers));
  assert.match(cli(args(f), { allowFailure: true }).stderr, /runtime worker/);
});

for (const verifier of [false, true]) for (const point of ["journal", "write-1", "write-2", "write-3", ...(verifier ? [] : ["write-4"]), "diagnostics-pending"]) {
  test(`Finish ${verifier ? "Verifier" : "Developer"} resumes ${point} without repeating lifecycle events`, async t => {
    const f = await setup(t, verifier);
    await assert.rejects(apply(f, interrupt(point)), /injected/);
    assert.ok(await readPendingLeanDelivery(f.target));
    assert.match(cli(["work-item", "release", f.target, "--work-item", f.item.id], { allowFailure: true }).stderr, /recovery is pending/);
    const repaired = JSON.parse(cli(args(f)).stdout);
    assert.equal(repaired.success, true); assert.equal(repaired.mutation.status, "resumed");
    assert.equal(await readPendingLeanDelivery(f.target), null);
    const recorded = await events(f);
    assert.equal(recorded.filter(entry => entry.event_type === "handoff_created").length, 1);
    assert.equal(recorded.filter(entry => entry.event_type === "work_item_closed").length, verifier ? 1 : 0);
    const before = await canonicalBytes(f); cli(args(f)); assert.deepEqual(await canonicalBytes(f), before);
  });
}

for (const point of ["before-plan-refresh", "after-plan-refresh", "before-status", "after-status", "before-doctor", "after-doctor"]) test(`Terminal diagnostics failure at ${point} remains visible and repairs only diagnostics`, async t => {
  const f = await setup(t, true);
  const failed = await apply(f, interrupt(point));
  assert.equal(failed.status, "diagnostics_failed"); assert.equal(failed.success, false); assert.equal((await itemState(f)).state, "done");
  assert.equal(failed.next_stage_ready, false); assert.equal(failed.recovery.mode, "diagnostics-only");
  assert.match(failed.next_action, /before claiming or changing the next stage/);
  const before = await lifecycleBytes(f);
  const status = JSON.parse(cli(["status", f.target, "--compact", "--json", "--no-write", "--work-item", f.item.id]).stdout);
  assert.ok(status.attention.some(entry => entry.type === "lean_finish_diagnostics" && entry.work_item_id === f.item.id));
  const doctor = JSON.parse(cli(["doctor", f.target, "--compact", "--json"], { allowFailure: true }).stdout);
  assert.ok(doctor.checks.some(entry => entry.id === "lean_finish_diagnostics" && entry.status === "fail"));
  const repaired = JSON.parse(cli(args(f)).stdout);
  assert.equal(repaired.success, true); assert.equal(repaired.mutation.status, "already_applied"); assert.equal(repaired.diagnostics.historical, false);
  assert.deepEqual(await lifecycleBytes(f), before);
});

test("Finish refreshes an existing plan preserving scope and ceiling, without dispatch or new lifecycle events", async t => {
  const f = await setup(t);
  cli(["parallel", "plan", f.target, "--parent", f.item.id, "--max-workers", "2", "--json"]);
  assert.equal((await inspectParallelPlan(f.target)).fresh, true);
  const result = JSON.parse(cli(args(f)).stdout);
  assert.equal(result.success, true); assert.equal(result.diagnostics.parallel_plan.refreshed, true);
  const inspected = await inspectParallelPlan(f.target);
  assert.equal(inspected.fresh, true);
  assert.equal(inspected.plan.scope.parent_work_item_id, f.item.id); assert.equal(inspected.plan.max_workers, 2);
  const records = await events(f);
  assert.equal(records.filter(e => e.event_type === "handoff_created").length, 1);
  assert.equal(records.filter(e => e.event_type === "worker_prepared").length, 0);
  const before = await canonicalBytes(f); cli(args(f)); assert.deepEqual(await canonicalBytes(f), before);
});

test("Finish preserves an invalid optional plan and text output directs recovery instead of next-stage claim", async t => {
  const f = await setup(t);
  const file = path.join(f.target, ".ai-org/views/parallel-plan.json");
  await fs.writeFile(file, "{invalid");
  const command = args(f).filter(v => v !== "--json");
  const failed = cli(command, { allowFailure: true });
  assert.equal(failed.status, 1); assert.match(failed.stdout, /before claiming or changing the next stage/);
  assert.doesNotMatch(failed.stdout, /assigned Quality Evaluator must claim Test/);
  assert.equal(await fs.readFile(file, "utf8"), "{invalid");
  assert.equal((await itemState(f)).state, "test");
});

for (const point of ["before-diagnostics-result", "diagnostics-result"]) test(`Finish recovers diagnostic persistence interruption at ${point}`, async t => {
  const f = await setup(t, true); await assert.rejects(apply(f, interrupt(point)), /injected/);
  const before = await lifecycleBytes(f);
  const result = JSON.parse(cli(args(f)).stdout); assert.equal(result.success, true);
  assert.equal(result.diagnostics.historical, point === "diagnostics-result"); assert.deepEqual(await lifecycleBytes(f), before);
});

test("Diagnostic repair rejects changed evidence, authority, request, resulting state, scope and candidate", async t => {
  const f = await setup(t, true); await apply(f, interrupt("before-doctor"));
  for (const relative of ["docs/verification.md", ".ai-org/core/policies.json", ".ai-org/project/usage-policy.json", ".ai-org/project/repository-integration.json", ".agents/skills/temple-work/SKILL.md", `.ai-org/work-items/${f.item.id}.json`, ".ai-org/project/agents.json", ".ai-org/project/collaboration.json"]) {
    const filename = path.join(f.target, relative); const original = await fs.readFile(filename); await fs.appendFile(filename, "\n");
    const before = await lifecycleBytes(f);
    assert.notEqual(cli(args(f), { allowFailure: true }).status, 0, relative); assert.deepEqual(await lifecycleBytes(f), before);
    await fs.writeFile(filename, original);
  }
  const originalRequest = structuredClone(f.request); f.request.leanCloseout = ["docs/brief.md"];
  assert.notEqual(cli(args(f), { allowFailure: true }).status, 0); f.request = originalRequest;
  await fs.appendFile(path.join(f.target, "app.mjs"), "\n// dirty\n"); assert.match(cli(args(f), { allowFailure: true }).stderr, /uncommitted/);
  git(f.target, ["add", "app.mjs"]); git(f.target, ["commit", "-m", "Advance candidate"]);
  const before = await lifecycleBytes(f);
  assert.match(cli(args(f), { allowFailure: true }).stderr, /Product scope changed/);
  assert.deepEqual(await lifecycleBytes(f), before);
});

test("Journal recovery rejects authority and canonical output drift before missing writes", async t => {
  const f = await setup(t, true); await assert.rejects(apply(f, interrupt("write-1")), /injected/);
  for (const relative of [".ai-org/project/usage-policy.json", ".ai-org/events/events.jsonl", `.ai-org/work-items/${f.item.id}.json`]) {
    const file = path.join(f.target, relative); const original = await fs.readFile(file); await fs.appendFile(file, "\n"); const before = await lifecycleBytes(f);
    assert.notEqual(cli(args(f), { allowFailure: true }).status, 0); assert.deepEqual(await lifecycleBytes(f), before); await fs.writeFile(file, original);
  }
  assert.equal(JSON.parse(cli(args(f)).stdout).success, true);
});

test("Malformed passed diagnostics cannot produce historical success and unrelated attention is preserved", async t => {
  const f = await setup(t, true); cli(args(f));
  const directory = await leanDeliveryStateDirectory(f.target);
  const recordFile = path.join(directory, `finish-${f.item.id}-${f.request.operationId}.json`);
  const original = JSON.parse(await fs.readFile(recordFile));
  for (const change of [record => delete record.diagnostics, record => record.diagnostics.status = "failed", record => record.journal.request_digest = "bad", record => record.journal.result.resulting_state = "build"]) {
    const record = structuredClone(original); change(record); await fs.writeFile(recordFile, JSON.stringify(record));
    const before = await lifecycleBytes(f); assert.notEqual(cli(args(f), { allowFailure: true }).status, 0); assert.deepEqual(await lifecycleBytes(f), before);
  }
  await fs.writeFile(recordFile, JSON.stringify(original));
  const malformed = path.join(directory, "finish-broken.json"); await fs.writeFile(malformed, "{}");
  const status = JSON.parse(cli(["status", f.target, "--compact", "--json", "--no-write"]).stdout);
  assert.ok(status.attention.some(entry => entry.status === "invalid"));
  const doctor = JSON.parse(cli(["doctor", f.target, "--compact", "--json"], { allowFailure: true }).stdout);
  assert.ok(doctor.checks.some(entry => entry.id === "lean_finish_diagnostics"));
  assert.notEqual(cli(args(f), { allowFailure: true }).status, 0);
});

test("Full Doctor warning fails completion even though lifecycle was applied", async t => {
  const f = await fixture(); t.after(f.cleanup); f.request.position = "developer";
  const result = cli(args(f), { allowFailure: true }); assert.equal(result.status, 1);
  const completion = JSON.parse(result.stdout); assert.equal(completion.mutation.status, "applied"); assert.equal(completion.success, false);
  assert.ok(completion.diagnostics.doctor.checks.some(entry => entry.id === "repository_integration"));
  assert.equal((await readLeanFinishDiagnostics(f.target))[0].status, "failed");
});

for (const phase of ["journal", "before-doctor"]) test(`Finish rechecks qualification expiry during ${phase} recovery`, async t => {
  const f = await setup(t, true);
  const file = path.join(f.target, ".ai-org/project/collaboration.json"); const collaboration = JSON.parse(await fs.readFile(file));
  for (const membership of collaboration.memberships.filter(entry => entry.agent_id === f.request.agentId && entry.position_id === "quality_evaluator")) membership.qualification = { ...membership.qualification, expires_at: "2099-01-01T00:00:00.000Z" };
  await fs.writeFile(file, JSON.stringify(collaboration));
  if (phase === "journal") await assert.rejects(apply(f, interrupt(phase)), /injected/); else await apply(f, interrupt(phase));
  const before = await lifecycleBytes(f); const originalNow = Date.now;
  Date.now = () => Date.parse("2100-01-01T00:00:00.000Z");
  try { await assert.rejects(apply(f), /no longer eligible|No eligible selected Agent/); } finally { Date.now = originalNow; }
  assert.deepEqual(await lifecycleBytes(f), before);
});

test("Finish diagnostic repair rechecks normalized evidence expiry despite unchanged bytes", async t => {
  const f = await setup(t, true);
  cli(["evidence", "git", f.target, "--work-item", f.item.id, "--revision", f.request.revision]);
  const file = path.join(f.target, ".ai-org/project/evidence.json"); const registry = JSON.parse(await fs.readFile(file)); const entry = registry.entries.at(-1);
  entry.expires_at = "2099-01-01T00:00:00.000Z"; await fs.writeFile(file, JSON.stringify(registry)); f.request.testEvidence = [entry.id];
  await apply(f, interrupt("before-doctor")); const before = await lifecycleBytes(f); const originalNow = Date.now;
  Date.now = () => Date.parse("2100-01-01T00:00:00.000Z");
  try { await assert.rejects(apply(f), /not current/); } finally { Date.now = originalNow; }
  assert.deepEqual(await lifecycleBytes(f), before);
});

test("Settling one operation never hides another operation's failed diagnostics", async t => {
  const f = await setup(t);
  const first = await apply(f, interrupt("before-doctor")); assert.equal(first.success, false);
  const claim = JSON.parse(cli(["work-item", "claim", f.target, "--work-item", f.item.id, "--agent-id", f.qualityAgent, "--principal-id", "human", "--base-revision", f.request.revision, "--branch", "main", "--json"]).stdout).item.claim;
  f.request = { ...f.request, operationId: "second-stage", position: "quality_evaluator", claimId: claim.id, agentId: f.qualityAgent, completed: [], evidence: [], judgment: "pass", testEvidence: ["docs/developer-test.md"], leanCloseout: ["docs/brief.md"] };
  const second = JSON.parse(cli(args(f), { allowFailure: true }).stdout);
  assert.equal(second.success, false); assert.equal(second.status, "diagnostics_failed");
  assert.ok(second.diagnostics.doctor.checks.some(entry => entry.id === "lean_finish_diagnostics" && entry.message.includes("parser-delivery")));
});
