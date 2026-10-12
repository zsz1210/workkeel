import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { finishLeanWorkItem } from "../src/lean-finish.mjs";
import { recoverLeanFinish, previewLeanFinishRecovery } from "../src/lean-finish-recovery.mjs";
import { readLeanFinishDiagnostics, leanFinishAttention, leanDeliveryStateDirectory } from "../src/lean-delivery-state.mjs";
import { formatJson, sha256 } from "../src/files.mjs";
import { withProjectMutationLock } from "../src/project.mjs";
import { cachedFixture, cli, git, canonicalBytes, itemState } from "./helpers/lean-delivery-fixture.mjs";

async function setup(t, { legacy = false, failAt = "before-doctor", beforeFinish, affectedPaths } = {}) {
  const f = await cachedFixture(affectedPaths ? { affectedPaths } : undefined); t.after(f.cleanup);
  const file = path.join(f.target, ".ai-org/project/repository-integration.json");
  const integration = JSON.parse(await fs.readFile(file));
  await fs.writeFile(file, formatJson({ ...integration, status: "confirmed", source: "human-confirmed", summary: "Fixture only",
    change_isolation: "not-required", review_gate: "not-required", recorded_at: "2026-09-01T00:00:00.000Z", recorded_by: "human" }));
  const policyFile = path.join(f.target, ".ai-org/project/collaboration.json");
  if (legacy) { const policy = JSON.parse(await fs.readFile(policyFile)); delete policy.actor_policy; await fs.writeFile(policyFile, formatJson(policy)); }
  f.request.position = "developer";
  await beforeFinish?.(f);
  const result = await finishLeanWorkItem(f.target, f.request, { checkpoint: point => { if (point === failAt) throw new Error("injected diagnostic failure"); } });
  assert.equal(result.status, "diagnostics_failed");
  f.original = (await readLeanFinishDiagnostics(f.target))[0];
  if (legacy) { const policy = JSON.parse(await fs.readFile(policyFile)); policy.actor_policy = { ordinary_development: "attributed" }; await fs.writeFile(policyFile, formatJson(policy)); }
  const dir = path.join(f.target, `.ai-org/artifacts/${f.item.id}`);
  await fs.mkdir(dir, { recursive: true });
  f.approvalRef = `.ai-org/artifacts/${f.item.id}/recovery-approval.md`;
  await fs.writeFile(path.join(f.target, f.approvalRef), "# Fixture authorization\nApproved compatible diagnostic recovery; no acceptance or release.\n");
  f.recovery = { workItemId: f.item.id, operationId: f.request.operationId, agentId: f.request.agentId,
    principalId: "human", approvalRef: f.approvalRef };
  return f;
}
const apply = (f, options, hooks) => withProjectMutationLock(f.target, () => recoverLeanFinish(f.target, { ...f.recovery, ...options }, hooks));

for (const flag of ["--assume-unchanged", "--skip-worktree"]) {
  test(`Recovery directly checks changed/missing bytes under ${flag}, but accepts unchanged flagged files`, async t => {
    const f = await setup(t), file = path.join(f.target, "app.mjs"), original = await fs.readFile(file);
    git(f.target, ["update-index", flag, "app.mjs"]);
    const preview = await previewLeanFinishRecovery(f.target, f.recovery);
    const before = await canonicalBytes(f);
    for (const change of [() => fs.writeFile(file, Buffer.from([0, 255, 1])), () => fs.unlink(file)]) {
      await change();
      await assert.rejects(previewLeanFinishRecovery(f.target, f.recovery), /Product scope changed/);
      await assert.rejects(apply(f, { expectedPlan: preview.fingerprint }), /Product scope changed/);
      assert.deepEqual(await canonicalBytes(f), before);
      assert.equal((await readLeanFinishDiagnostics(f.target))[0].status, "failed");
      await fs.writeFile(file, original);
    }
    await assert.rejects(apply(f, { expectedPlan: preview.fingerprint }, { checkpoint: async point => {
      if (point === "after-diagnostics") await fs.appendFile(file, "// hidden mid-check change\n");
    } }), /Product scope changed/);
    assert.equal((await readLeanFinishDiagnostics(f.target))[0].status, "failed");
    await fs.writeFile(file, original);
    assert.equal((await apply(f, { expectedPlan: preview.fingerprint })).status, "reconciled");
    assert.match(git(f.target, ["ls-files", "-v", "app.mjs"]), flag === "--assume-unchanged" ? /^h / : /^S /);
  });
}

test("Recovery directly checks literal directory inventory, binary bytes, modes and unsafe links", async t => {
  const dir = "product [literal]", relative = `${dir}/binary\tname\n.bin`;
  const f = await setup(t, { affectedPaths: [dir], beforeFinish: async f => {
    await fs.mkdir(path.join(f.target, dir));
    await fs.writeFile(path.join(f.target, relative), Buffer.from([0, 255, 128, 10]));
    git(f.target, ["add", dir]); git(f.target, ["commit", "-m", "Binary product scope"]);
    f.request.revision = git(f.target, ["rev-parse", "HEAD"]);
  } });
  const file = path.join(f.target, relative), original = await fs.readFile(file);
  git(f.target, ["update-index", "--assume-unchanged", relative]);
  const preview = await previewLeanFinishRecovery(f.target, f.recovery);
  await fs.chmod(file, 0o755);
  await assert.rejects(previewLeanFinishRecovery(f.target, f.recovery), /Product scope changed/);
  await fs.chmod(file, 0o644);
  await fs.appendFile(path.join(f.target, ".git/info/exclude"), "\nhidden.tmp\n");
  await fs.writeFile(path.join(f.target, dir, "hidden.tmp"), "ignored product addition");
  assert.equal(git(f.target, ["status", "--porcelain", "--", dir]), "");
  await assert.rejects(previewLeanFinishRecovery(f.target, f.recovery), /Product scope changed/);
  await fs.unlink(path.join(f.target, dir, "hidden.tmp"));
  await fs.unlink(file); await fs.symlink(path.join(f.target, "app.mjs"), file);
  await assert.rejects(previewLeanFinishRecovery(f.target, f.recovery), /Unsafe product scope/);
  await fs.unlink(file); await fs.writeFile(file, original);
  const moved = path.join(f.temporary, "outside-product");
  await fs.rename(path.join(f.target, dir), moved);
  await fs.symlink(moved, path.join(f.target, dir));
  await assert.rejects(previewLeanFinishRecovery(f.target, f.recovery), /Unsafe product scope|Product scope changed/);
  await fs.unlink(path.join(f.target, dir)); await fs.rename(moved, path.join(f.target, dir));
  assert.equal((await apply(f, { expectedPlan: preview.fingerprint })).status, "reconciled");
});

test("Explicit recovery handles administrative HEAD, amended evidence and compatible Solo migration without replaying lifecycle", async t => {
  const f = await setup(t, { legacy: true });
  await fs.appendFile(path.join(f.target, "docs/developer-test.md"), "\nAdministrative follow-up, not new acceptance.\n");
  await fs.appendFile(path.join(f.target, ".ai-org/events/events.jsonl"), '{"event_type":"fixture_policy_confirmation"}\n');
  git(f.target, ["add", "."]); git(f.target, ["commit", "-m", "Retain administration"]);
  const before = await canonicalBytes(f), item = await itemState(f);
  const preview = await apply(f, { dryRun: true });
  assert.deepEqual(await canonicalBytes(f), before);
  assert.notEqual(preview.current_revision, preview.candidate_revision);
  assert.deepEqual(preview.changes.map(c => c.classification).sort(), ["amended-developer-evidence-not-acceptance", "appended-events", "explicit-compatible-solo-policy"].sort());
  const result = await apply(f, { expectedPlan: preview.fingerprint });
  assert.equal(result.status, "reconciled"); assert.equal(result.acceptance_granted, false);
  assert.deepEqual(await itemState(f), item);
  const after = await canonicalBytes(f);
  const observationPath = `.ai-org/artifacts/${f.item.id}/diagnostics-${f.request.operationId}.json`;
  for (const [name, body] of Object.entries(before)) if (!name.startsWith(".ai-org/views/") && name !== observationPath) assert.equal(after[name], body, name);
  const beforeObservation = JSON.parse(before[observationPath]), afterObservation = JSON.parse(after[observationPath]);
  assert.equal(beforeObservation.status, "failed");
  assert.equal(afterObservation.status, "passed");
  assert.deepEqual(afterObservation.errors, []);
  for (const key of Object.keys(beforeObservation).filter(key => !["status", "errors", "observed_at"].includes(key))) {
    assert.deepEqual(afterObservation[key], beforeObservation[key], key);
  }
  const record = (await readLeanFinishDiagnostics(f.target))[0];
  assert.deepEqual(record.journal, f.original.journal);
  const retained = JSON.parse(await fs.readFile(path.join(f.target, result.recovery_ref)));
  assert.deepEqual(record.recovery.original_diagnostics, f.original.diagnostics);
  assert.equal(retained.original_diagnostics_sha256, sha256(formatJson(f.original.diagnostics)));
  assert.equal(JSON.stringify(retained).includes(f.target), false);
  assert.equal((await leanFinishAttention(f.target)).length, 0);
  const replay = await finishLeanWorkItem(f.target, f.request);
  assert.equal(replay.diagnostics.historical, true); assert.equal(replay.next_stage_ready, false);
});

test("Recovery CLI requires explicit fingerprint and rejects unknown options", async t => {
  const f = await setup(t);
  const args = ["work-item", "finish-recover", f.target, "--work-item", f.item.id, "--operation-id", f.request.operationId,
    "--agent-id", f.request.agentId, "--principal-id", "human", "--approval-ref", f.approvalRef, "--json"];
  assert.notEqual(cli(args, { allowFailure: true }).status, 0);
  assert.notEqual(cli([...args, "--skip-checks"], { allowFailure: true }).status, 0);
  const preview = JSON.parse(cli([...args, "--dry-run"]).stdout);
  const applied = JSON.parse(cli([...args, "--expected-plan", preview.fingerprint]).stdout);
  assert.equal(applied.status, "reconciled");
});

test("Recovery rejects stale approval and input mutation during diagnostics", async t => {
  const f = await setup(t);
  let preview = await previewLeanFinishRecovery(f.target, f.recovery);
  await fs.appendFile(path.join(f.target, f.approvalRef), "New choice\n");
  await assert.rejects(apply(f, { expectedPlan: preview.fingerprint }), /fingerprint/);
  preview = await previewLeanFinishRecovery(f.target, f.recovery);
  await assert.rejects(apply(f, { expectedPlan: preview.fingerprint }, { checkpoint: async point => {
    if (point === "after-diagnostics") await fs.appendFile(path.join(f.target, "docs/developer-test.md"), "Changed mid-check\n");
  } }), /inputs changed/);
  assert.equal((await readLeanFinishDiagnostics(f.target))[0].status, "failed");
});

test("Recovery rejects product drift, policy weakening and edited lifecycle outputs without writes", async t => {
  const f = await setup(t, { legacy: true });
  for (const relative of ["app.mjs", ".ai-org/core/policies.json", `.ai-org/work-items/${f.item.id}.json`,
    f.original.journal.result.handoff, f.original.journal.result.receipt, ".ai-org/project/agents.json"]) {
    const file = path.join(f.target, relative), before = await fs.readFile(file);
    await fs.appendFile(file, "\n");
    const changed = await canonicalBytes(f);
    await assert.rejects(previewLeanFinishRecovery(f.target, f.recovery));
    assert.deepEqual(await canonicalBytes(f), changed);
    await fs.writeFile(file, before);
  }
  const policy = path.join(f.target, ".ai-org/project/collaboration.json"), before = await fs.readFile(policy);
  const altered = JSON.parse(before); altered.memberships[0].status = "revoked";
  await fs.writeFile(policy, formatJson(altered));
  await assert.rejects(previewLeanFinishRecovery(f.target, f.recovery));
  await fs.writeFile(policy, before);
  const event = path.join(f.target, ".ai-org/events/events.jsonl"), events = await fs.readFile(event);
  await fs.writeFile(event, Buffer.concat([Buffer.from("\n"), events]));
  await assert.rejects(previewLeanFinishRecovery(f.target, f.recovery), /append-only/);
  await fs.writeFile(event, events);
  await fs.appendFile(path.join(f.target, "app.mjs"), "// Changed product\n");
  git(f.target, ["add", "app.mjs"]); git(f.target, ["commit", "-m", "Different product"]);
  await assert.rejects(previewLeanFinishRecovery(f.target, f.recovery), /Product scope changed/);
});

test("Recovery checks actor, approval regularity and resource ownership", async t => {
  const f = await setup(t);
  await assert.rejects(previewLeanFinishRecovery(f.target, { ...f.recovery, agentId: f.qualityAgent }), /original responsible/);
  await assert.rejects(previewLeanFinishRecovery(f.target, { ...f.recovery, approvalRef: "../outside" }), /approval artifact/);
  const approval = path.join(f.target, f.approvalRef); await fs.unlink(approval); await fs.symlink(path.join(f.target, "docs/brief.md"), approval);
  await assert.rejects(previewLeanFinishRecovery(f.target, f.recovery), /regular files/);
  await fs.unlink(approval); await fs.writeFile(approval, "Approval\n");
  const file = path.join(f.target, ".ai-org/project/runtime-workers.json");
  const workers = JSON.parse(await fs.readFile(file)); workers.workers.push({ work_item_id: f.item.id, status: "active" });
  await fs.writeFile(file, formatJson(workers));
  await assert.rejects(previewLeanFinishRecovery(f.target, f.recovery), /Active workers/);
});

test("Recovery resumes an interrupted artifact write and detects later artifact tampering", async t => {
  const f = await setup(t), preview = await previewLeanFinishRecovery(f.target, f.recovery);
  await assert.rejects(apply(f, { expectedPlan: preview.fingerprint }, { checkpoint: point => { if (point === "after-artifact") throw new Error("injected artifact crash"); } }), /artifact crash/);
  assert.equal((await readLeanFinishDiagnostics(f.target))[0].status, "failed");
  const result = await apply(f, { expectedPlan: preview.fingerprint });
  assert.equal(result.status, "reconciled");
  await fs.appendFile(path.join(f.target, result.recovery_ref), "\n");
  assert.equal((await leanFinishAttention(f.target))[0].status, "invalid");
});

test("Recovery refuses remaining warnings rather than treating correction as acceptance", async t => {
  const f = await setup(t);
  // A warning source outside the bound snapshot must still be checked by Doctor.
  await fs.writeFile(path.join(f.target, ".ai-org/views/parallel-plan.json"), "{invalid");
  const preview = await previewLeanFinishRecovery(f.target, f.recovery);
  await assert.rejects(apply(f, { expectedPlan: preview.fingerprint }));
  assert.equal((await readLeanFinishDiagnostics(f.target))[0].status, "failed");
});

test("Recovery rejects partial journals, terminal states, normalized evidence and expired actors", async t => {
  const f = await setup(t);
  const itemFile = path.join(f.target, `.ai-org/work-items/${f.item.id}.json`), original = await fs.readFile(itemFile);
  const item = JSON.parse(original);
  for (const altered of [{ ...item, state: "done" }, { ...item, gate_evidence: { ...item.gate_evidence, test_evidence: ["EVID-0001"] } }]) {
    await fs.writeFile(itemFile, formatJson(altered));
    await assert.rejects(previewLeanFinishRecovery(f.target, f.recovery));
  }
  await fs.writeFile(itemFile, original);
  const actorFile = path.join(f.target, ".ai-org/project/collaboration.json"), actorBytes = await fs.readFile(actorFile);
  const actors = JSON.parse(actorBytes);
  for (const membership of actors.memberships.filter(m => m.agent_id === f.request.agentId)) membership.qualification.expires_at = "2000-01-01T00:00:00.000Z";
  await fs.writeFile(actorFile, formatJson(actors));
  await assert.rejects(previewLeanFinishRecovery(f.target, f.recovery));
  await fs.writeFile(actorFile, actorBytes);
  const { leanDeliveryStateDirectory } = await import("../src/lean-delivery-state.mjs");
  const directory = await leanDeliveryStateDirectory(f.target);
  await fs.writeFile(path.join(directory, "pending.json"), formatJson(f.original.journal));
  await assert.rejects(previewLeanFinishRecovery(f.target, f.recovery), /Partial lifecycle/);
});

test("Recovery refuses a conflicting persisted artifact and unrelated failed diagnostics", async t => {
  const f = await setup(t), preview = await previewLeanFinishRecovery(f.target, f.recovery);
  await fs.writeFile(path.join(f.target, preview.recovery_ref), "{}\n");
  const before = await canonicalBytes(f);
  await assert.rejects(apply(f, { expectedPlan: preview.fingerprint }), /artifact conflicts/);
  assert.deepEqual(await canonicalBytes(f), before);
  await fs.unlink(path.join(f.target, preview.recovery_ref));
  const { leanDeliveryStateDirectory } = await import("../src/lean-delivery-state.mjs");
  const directory = await leanDeliveryStateDirectory(f.target);
  await fs.writeFile(path.join(directory, "finish-unrelated.json"), "{}\n");
  await assert.rejects(previewLeanFinishRecovery(f.target, f.recovery), /Invalid Lean finish/);
});

test("Recovery binds scope and all inputs to the original canonical plan digest", async t => {
  const f = await setup(t), directory = await leanDeliveryStateDirectory(f.target);
  const filename = path.join(directory, `finish-${f.original.operation_key.replace("/", "-")}.json`);
  const receipt = await fs.readFile(path.join(f.target, f.original.journal.result.receipt));
  await fs.appendFile(path.join(f.target, "app.mjs"), "// Changed product\n");
  for (const mutate of [
    journal => { journal.affected_paths = ["app.test.mjs"]; },
    journal => { journal.inputs.pop(); },
    journal => { journal.inputs[0].sha256 = "0".repeat(64); },
    journal => { journal.affected_paths = ["app.test.mjs"]; journal.plan_digest = sha256(formatJson({ request: journal.request, inputs: journal.inputs, output_paths: journal.writes.map(w => w.path), affected_paths: journal.affected_paths })); }
  ]) {
    const changed = structuredClone(f.original); mutate(changed.journal);
    await fs.writeFile(filename, formatJson(changed));
    await assert.rejects(previewLeanFinishRecovery(f.target, f.recovery), /plan digest/);
    assert.deepEqual(await fs.readFile(path.join(f.target, f.original.journal.result.receipt)), receipt);
  }
});

test("Crash resume rejects failed or malformed persisted diagnostics and altered original bindings", async t => {
  const f = await setup(t), preview = await previewLeanFinishRecovery(f.target, f.recovery);
  await assert.rejects(apply(f, { expectedPlan: preview.fingerprint }, { checkpoint: point => { if (point === "after-artifact") throw new Error("crash"); } }), /crash/);
  const filename = path.join(f.target, preview.recovery_ref), original = JSON.parse(await fs.readFile(filename));
  for (const mutate of [
    r => { r.diagnostics = { status: "failed", doctor: { healthy: false }, errors: ["tampered"] }; },
    r => { delete r.diagnostics.doctor.summary; },
    r => { r.diagnostics.doctor.summary.warn = 1; },
    r => { r.diagnostics.doctor.checks.push({ status: "fail" }); },
    r => { r.original_diagnostics_sha256 = "0".repeat(64); },
    r => { r.original_status = "passed"; },
    r => { r.acceptance_granted = true; },
    r => { r.recorded_at = "invalid"; }
  ]) {
    const changed = structuredClone(original); mutate(changed);
    await fs.writeFile(filename, formatJson(changed));
    const before = await canonicalBytes(f);
    await assert.rejects(apply(f, { expectedPlan: preview.fingerprint }), /recovery artifact/);
    assert.deepEqual(await canonicalBytes(f), before);
    assert.equal((await readLeanFinishDiagnostics(f.target))[0].status, "failed");
  }
  await fs.writeFile(filename, formatJson(original));
  await apply(f, { expectedPlan: preview.fingerprint });
  // Even updating the local artifact hash cannot hide an inconsistent outcome.
  const directory = await leanDeliveryStateDirectory(f.target);
  const recordPath = path.join(directory, `finish-${f.original.operation_key.replace("/", "-")}.json`);
  const record = JSON.parse(await fs.readFile(recordPath));
  original.diagnostics.status = "failed";
  const changed = formatJson(original); await fs.writeFile(filename, changed);
  record.recovery.sha256 = sha256(changed); await fs.writeFile(recordPath, formatJson(record));
  assert.equal((await leanFinishAttention(f.target))[0].status, "invalid");
});

test("Recovery permits only Git-proven unrelated runtime drift, not target or global definition drift", async t => {
  const f = await setup(t);
  for (const [relative, field] of [[".ai-org/project/runtime-workers.json", "workers"], [".ai-org/project/resources.json", "reservations"]]) {
    const filename = path.join(f.target, relative), original = await fs.readFile(filename), body = JSON.parse(original);
    assert.equal(sha256(git(f.target, ["show", `${f.request.revision}:${relative}`]) + "\n"), sha256(original));
    body[field].push({ work_item_id: "WI-9999", status: "completed", id: "unrelated-fixture" });
    await fs.writeFile(filename, formatJson(body));
    const preview = await previewLeanFinishRecovery(f.target, f.recovery);
    assert.equal(preview.changes.find(c => c.path === relative).classification, "proven-unrelated-runtime-change");
    body[field][body[field].length - 1].work_item_id = f.item.id;
    await fs.writeFile(filename, formatJson(body));
    await assert.rejects(previewLeanFinishRecovery(f.target, f.recovery), /Incompatible recovery input/);
    body[field] = JSON.parse(original)[field]; body.schema_version = "changed";
    await fs.writeFile(filename, formatJson(body));
    await assert.rejects(previewLeanFinishRecovery(f.target, f.recovery));
    await fs.writeFile(filename, original);
  }
});

test("Recovery cannot guess original runtime bytes that were not committed in the candidate", async t => {
  const relative = ".ai-org/project/runtime-workers.json";
  const f = await setup(t, { beforeFinish: f => fs.appendFile(path.join(f.target, relative), "\n") });
  // Both versions parse to the same empty registry, but the bound original bytes
  // differ from the candidate blob. No semantic reconstruction is permitted.
  await fs.appendFile(path.join(f.target, relative), "\n");
  await assert.rejects(previewLeanFinishRecovery(f.target, f.recovery), /Incompatible recovery input/);
});
