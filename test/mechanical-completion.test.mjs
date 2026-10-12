import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { sha256 } from "../src/files.mjs";
import { finishLeanWorkItem } from "../src/lean-finish.mjs";
import { verifyMechanicalCompletion } from "../src/mechanical-completion.mjs";
import { withProjectMutationLock } from "../src/project.mjs";
import { cachedFixture as fixture, cli, git, itemState, canonicalBytes } from "./helpers/lean-delivery-fixture.mjs";

async function setup(t, editContract = c => c, note = "docs/notes/reading.txt") {
  const f = await fixture(); t.after(f.cleanup);
  const write = async (p, value) => { await fs.mkdir(path.dirname(path.join(f.target, p)), { recursive: true }); await fs.writeFile(path.join(f.target, p), typeof value === "string" ? value : JSON.stringify(value)); };
  f.write = write; f.note = note; f.contractRef = `.ai-org/artifacts/${f.item.id}/mechanical-contract.json`;
  f.policyRef = ".ai-org/project/mechanical-policy.json";
  await write(note, "A smal note.\n");
  await write(f.policyRef, { schema_version: "temple.mechanical-policy/v1", enabled: true, approved_by: "human", non_normative_files: [note] });
  f.contract = editContract({ schema_version: "temple.mechanical-contract/v1", work_item_id: f.item.id, approved_by: "human", file: note, before_sha256: sha256("A smal note.\n"), old_text: "smal", new_text: "small" });
  await write(f.contractRef, f.contract);
  // Synthetic fixtures author policy/scope. Real users must approve these inputs.
  const state = await itemState(f);
  state.affected_paths = [note]; state.gate_evidence.approved_scope = [f.contractRef]; state.gate_evidence.acceptance_criteria = [f.contractRef];
  await write(`.ai-org/work-items/${f.item.id}.json`, state);
  const integration = JSON.parse(await fs.readFile(path.join(f.target, ".ai-org/project/repository-integration.json")));
  await write(".ai-org/project/repository-integration.json", { ...integration, status: "confirmed", source: "human-confirmed", summary: "Synthetic local fixture", change_isolation: "not-required", review_gate: "not-required", recorded_at: "2026-09-01T00:00:00.000Z", recorded_by: "human" });
  git(f.target, ["add", "."]); git(f.target, ["commit", "-m", "Preapprove mechanical change"]);
  f.base = git(f.target, ["rev-parse", "HEAD"]); state.claim.base_revision = f.base;
  await write(`.ai-org/work-items/${f.item.id}.json`, state);
  await write(note, "A small note.\n"); git(f.target, ["add", note]); git(f.target, ["commit", "-m", "Apply exact replacement"]);
  f.request = { ...f.request, position: "developer", completed: [], evidence: [], revision: git(f.target, ["rev-parse", "HEAD"]), mechanicalContract: f.contractRef };
  return f;
}
const args = f => ["work-item", "finish", f.target, "--work-item", f.item.id, "--position", "developer", "--operation-id", f.request.operationId,
  "--claim-id", f.request.claimId, "--agent-id", f.request.agentId, "--principal-id", "human", "--revision", f.request.revision,
  "--mechanical-contract", f.contractRef, "--json"];
const apply = (f, hooks) => withProjectMutationLock(f.target, () => finishLeanWorkItem(f.target, f.request, hooks), { leanDeliveryOperation: `${f.item.id}/${f.request.operationId}` });
async function rejectsWithoutWrites(f) {
  const before = await canonicalBytes(f);
  const result = cli(args(f), { allowFailure: true });
  assert.notEqual(result.status, 0, result.stdout); assert.deepEqual(await canonicalBytes(f), before);
}

test("exact mechanical finish previews, completes without Verifier identity, and replays historically", async t => {
  const f = await setup(t), before = await canonicalBytes(f);
  const preview = JSON.parse(cli([...args(f), "--dry-run"]).stdout);
  assert.deepEqual(await canonicalBytes(f), before); assert.equal(preview.mutation.completion_kind, "mechanical");
  assert.equal(preview.mutation.mechanical_check.independent_qa, false);
  const result = JSON.parse(cli([...args(f), "--expected-plan", preview.mutation.plan_digest]).stdout);
  assert.equal(result.success, true, JSON.stringify(result));
  const state = await itemState(f); assert.equal(state.state, "done"); assert.equal((state.handoffs ?? []).length, 0);
  assert.equal(state.claim.status, "released"); assert.match(state.closeout_reasons[0], /mechanical/);
  assert.equal(state.gate_evidence.independent_qa_pass, undefined);
  const after = await canonicalBytes(f), replay = JSON.parse(cli(args(f)).stdout);
  assert.equal(replay.diagnostics.historical, true); assert.deepEqual(await canonicalBytes(f), after);
});

test("missing, changed and malformed opt-in never authorize mechanical completion", async t => {
  const f = await setup(t), policy = await fs.readFile(path.join(f.target, f.policyRef));
  for (const value of ["{}", JSON.stringify({ schema_version: "temple.mechanical-policy/v1", enabled: false }), "not-json"]) {
    await f.write(f.policyRef, value); await rejectsWithoutWrites(f);
  }
  await fs.unlink(path.join(f.target, f.policyRef)); await rejectsWithoutWrites(f);
  await fs.writeFile(path.join(f.target, f.policyRef), policy);
  const contract = await fs.readFile(path.join(f.target, f.contractRef));
  await f.write(f.contractRef, { ...f.contract, new_text: "different" }); await rejectsWithoutWrites(f);
  await fs.writeFile(path.join(f.target, f.contractRef), contract);
  const original = await itemState(f);
  for (const delta of [{ workflow_profile: "standard" }, { risk_tier: "standard" }, { unresolved: ["unknown"] },
    { dependencies: ["WI-0002"] }, { ui_delivery_mode: "code-first" }, { affected_paths: [f.note, "app.mjs"] },
    { gate_evidence: { ...original.gate_evidence, approved_scope: [] } }, { claim: { ...original.claim, agent_id: f.qualityAgent } }]) {
    await f.write(`.ai-org/work-items/${f.item.id}.json`, { ...original, ...delta }); await rejectsWithoutWrites(f);
  }
});

test("invalid precommitted contracts and non-note paths reject", async t => {
  for (const change of [c => ({ ...c, unexpected: true }), c => ({ ...c, approved_by: "agent-builder" }),
    c => ({ ...c, work_item_id: "WI-9999" }), c => ({ ...c, before_sha256: "0".repeat(64) }),
    c => ({ ...c, old_text: "absent" }), c => ({ ...c, new_text: "line\nbreak" }), c => ({ ...c, new_text: "smal" })]) {
    const f = await setup(t, change); await rejectsWithoutWrites(f);
  }
  for (const note of ["docs/notes/readme.md", "docs/notes/AGENTS.txt", "docs/spec.txt"]) {
    const f = await setup(t, c => c, note); await rejectsWithoutWrites(f);
  }
});

test("extra committed or dirty product changes, wrong replacement, and executable note reject", async t => {
  for (const mode of ["extra", "dirty", "wrong", "executable", "untracked"]) {
    const f = await setup(t);
    if (mode === "executable") { await fs.chmod(path.join(f.target, f.note), 0o755); git(f.target, ["add", f.note]); }
    else if (mode === "untracked") await f.write("extra.txt", "extra");
    else { await f.write(mode === "wrong" ? f.note : "app.mjs", "Unexpected\n"); if (mode !== "dirty") git(f.target, ["add", mode === "wrong" ? f.note : "app.mjs"]); }
    if (["extra", "wrong", "executable"].includes(mode)) { git(f.target, ["commit", "-m", "Unapproved modification"]); f.request.revision = git(f.target, ["rev-parse", "HEAD"]); }
    await rejectsWithoutWrites(f);
  }
});

test("managed, authority-indexed and non-Solo files retain ordinary verification", async t => {
  const f = await setup(t);
  const lock = JSON.parse(await fs.readFile(path.join(f.target, "temple.lock")));
  const verify = async () => verifyMechanicalCompletion(f.target, await itemState(f), {
    claim_id: f.request.claimId, agent_id: f.request.agentId, principal_id: "human", position: "developer",
    candidate_revision: f.request.revision, mechanical_contract: f.contractRef
  });
  // Assert the ownership guard itself, not a later dirty-lock or Doctor rejection.
  assert.ok(Array.isArray(lock.managed_files));
  await f.write("temple.lock", { ...lock, managed_files: [...lock.managed_files, { path: f.note, sha256: sha256("A small note.\n") }] });
  await assert.rejects(verify, /managed content excluded/); await rejectsWithoutWrites(f);
  for (const managed_files of [undefined, {}, [null], [{ path: f.note }]]) {
    await f.write("temple.lock", { ...lock, managed_files });
    await assert.rejects(verify, /valid managed-file inventory required/); await rejectsWithoutWrites(f);
  }
  await f.write("temple.lock", lock);
  const indexRef = ".ai-org/project/spec-index.json", index = JSON.parse(await fs.readFile(path.join(f.target, indexRef)));
  await f.write(indexRef, { ...index, entries: [{ source: { location: f.note } }] }); await rejectsWithoutWrites(f);
  await f.write(indexRef, index);
  const ref = ".ai-org/project/collaboration.json", collab = JSON.parse(await fs.readFile(path.join(f.target, ref)));
  await f.write(ref, { ...collab, profile: "collaborative" }); await rejectsWithoutWrites(f);
});

for (const point of ["journal", "write-1", "write-2", "write-3", "diagnostics-pending"]) test(`mechanical completion recovers identical transaction at ${point}`, async t => {
  const f = await setup(t);
  await assert.rejects(apply(f, { checkpoint: current => { if (current === point) throw Error("injected failure"); } }));
  const result = await apply(f); assert.equal(result.success, true); assert.equal((await itemState(f)).state, "done");
});

test("changed approval or product blocks pending mechanical recovery", async t => {
  for (const ref of ["policy", "product", "unrelated", "mode"]) {
    const f = await setup(t);
    await assert.rejects(apply(f, { checkpoint: current => { if (current === "journal") throw Error("injected failure"); } }));
    if (ref === "mode") await fs.chmod(path.join(f.target, f.policyRef), 0o755);
    else await f.write(ref === "unrelated" ? "extra.txt" : ref === "policy" ? f.policyRef : f.note, "changed");
    const before = await canonicalBytes(f); await assert.rejects(apply(f)); assert.deepEqual(await canonicalBytes(f), before);
  }
});

test("invalid UTF-8 original blob cannot be approved using replacement-decoded bytes", async t => {
  const f = await setup(t);
  // Rebuild a synthetic baseline containing raw invalid bytes and a malicious
  // digest over their decoded replacement; the original blob must still reject.
  await fs.writeFile(path.join(f.target, f.note), Buffer.from([0xff, ...Buffer.from(" smal\n")]));
  await f.write(f.contractRef, { ...f.contract, before_sha256: sha256("\ufffd smal\n") });
  git(f.target, ["add", "."]); git(f.target, ["commit", "-m", "Invalid raw text baseline"]);
  const original = await itemState(f); original.claim.base_revision = git(f.target, ["rev-parse", "HEAD"]);
  await f.write(`.ai-org/work-items/${f.item.id}.json`, original);
  await f.write(f.note, "\ufffd small\n"); git(f.target, ["add", f.note]); git(f.target, ["commit", "-m", "Decoded replacement candidate"]);
  f.request.revision = git(f.target, ["rev-parse", "HEAD"]);
  await rejectsWithoutWrites(f);
});

test("generic transition and Verifier options cannot select mechanical completion", async t => {
  const f = await setup(t), before = await canonicalBytes(f);
  assert.notEqual(cli(["transition", f.target, "--work-item", f.item.id, "--to", "done", "--satisfy", `mechanical_contract=${f.contractRef}`], { allowFailure: true }).status, 0);
  for (const extra of [["--completed", "self-certified"], ["--judgment", "pass"], ["--unknown-option"]]) assert.notEqual(cli([...args(f), ...extra], { allowFailure: true }).status, 0);
  assert.deepEqual(await canonicalBytes(f), before);
});

test("stale preview, extra acceptance and linked inputs reject without writes", async t => {
  const f = await setup(t), before = await canonicalBytes(f);
  assert.notEqual(cli([...args(f), "--expected-plan", "0".repeat(64)], { allowFailure: true }).status, 0);
  assert.deepEqual(await canonicalBytes(f), before);
  const original = await itemState(f);
  await f.write(`.ai-org/work-items/${f.item.id}.json`, { ...original, gate_evidence: { ...original.gate_evidence, acceptance_criteria: [f.contractRef, "docs/brief.md"] } });
  await rejectsWithoutWrites(f); await f.write(`.ai-org/work-items/${f.item.id}.json`, original);
  const note = path.join(f.target, f.note), backup = path.join(f.temporary, "note-backup.txt");
  await fs.rename(note, backup); await fs.symlink(backup, note); await rejectsWithoutWrites(f);
  await fs.unlink(note); await fs.link(backup, note); await rejectsWithoutWrites(f);
});
