import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { initializeTaskProject, previewLegacyMigration } from "../src/workkeel-project.mjs";
import { createNativeTask, mutateNativeTask, readNativeTask, diagnoseTaskProject, listTaskItems } from "../src/workkeel-tasks.mjs";

const cli = fileURLToPath(new URL("../bin/workkeel.mjs", import.meta.url));
const legacyCli = fileURLToPath(new URL("../bin/temple.mjs", import.meta.url));
const developer = { agent_id: "builder", principal_id: "owner" };
const reviewer = { agent_id: "reviewer", principal_id: "review-owner" };
const policy = () => ({ schema_version: "workkeel.task-policy/v1", principals: ["owner", "review-owner"], agents: [developer, reviewer], approvers: ["owner"], review_separation: "distinct-agent" });
const request = (version, actor = developer, extra = {}) => ({ expected_version: version, operation_id: `op-${version}-${actor.agent_id}`, actor, ...extra });
function contract(id = "WK-one") {
  return { schema_version: "workkeel.task-contract/v1", id, goal: "Correct a total", state: "intake",
    scope: { include: ["total calculation"], exclude: ["publication"] }, actor: developer, dependencies: [],
    acceptance: { criteria: ["The total is correct"], evidence: [] }, handoff: null,
    verification: { risk_tier: "standard", separation: "distinct-agent", implementer: null, reviewer: null, candidate_revision: null },
    environment: { cwd: ".", read_paths: ["src"], write_paths: ["src"], tools: ["node"], resources: [],
      network: { mode: "none", hosts: [] }, external_actions: [], data: { classification: "internal", model_access: "none", policy_refs: ["docs/approval.md"] } },
    authorization: { approved_by: "owner", approval_ref: "docs/approval.md", operations: ["read", "write", "execute"], expires_at: null }, skills: [],
    execution: { runtime: { kind: "host-owned", adapter_id: null, required_features: [] }, model_connection: { kind: "native" } }, legacy: null };
}
function git(root, ...args) { return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
async function write(root, ref, data) { await fs.mkdir(path.dirname(path.join(root, ref)), { recursive: true }); await fs.writeFile(path.join(root, ref), typeof data === "string" ? data : JSON.stringify(data)); }
async function fixture(t, { init = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  git(root, "init", "-q"); git(root, "config", "user.name", "Fixture"); git(root, "config", "user.email", "fixture@example.invalid");
  await write(root, "docs/approval.md", "Approved total repair and internal local test data.\n");
  await write(root, "src/cart.mjs", "export const total = 1;\n");
  await write(root, "policy.json", policy());
  if (init) await initializeTaskProject(root, policy());
  git(root, "add", "."); git(root, "commit", "-qm", "base");
  return root;
}
async function deliver(root, id = "WK-one") {
  await createNativeTask(root, contract(id), request(0));
  const claimed = await mutateNativeTask(root, id, "claim", request(1, developer, { base_revision: git(root, "rev-parse", "HEAD") }));
  await write(root, "src/cart.mjs", "export const total = 2;\n"); git(root, "add", "src"); git(root, "commit", "-qm", "repair");
  const revision = git(root, "rev-parse", "HEAD");
  const ref = `.ai-org/artifacts/${id}/developer.md`; await write(root, ref, `Verified ${revision}.\n`);
  await mutateNativeTask(root, id, "handoff", request(2, developer, { claim_id: claimed.claim.id, revision, summary: "Total corrected and tested", evidence: [ref], unresolved: [] }));
  return { revision, ref };
}

test("task-first init, doctor, exact delivery, distinct review and close need no Positions", async t => {
  const root = await fixture(t);
  assert.equal((await diagnoseTaskProject(root)).valid, true);
  await assert.rejects(fs.stat(path.join(root, ".ai-org/core/positions.json")), { code: "ENOENT" });
  const { revision } = await deliver(root);
  const ref = ".ai-org/artifacts/WK-one/review.md"; await write(root, ref, `Independent fixture review of ${revision}.\n`);
  const reviewRequest = request(3, reviewer, { revision, judgment: "pass", summary: "Requirements met", evidence: [ref] });
  assert.equal((await mutateNativeTask(root, "WK-one", "review", reviewRequest)).state, "release_gate");
  const closed = await mutateNativeTask(root, "WK-one", "close", request(4, developer, { revision, summary: "Accepted", rollback: "Revert repair through reviewed change", evidence: [ref] }));
  assert.equal(closed.state, "done"); assert.equal(closed.external_release, "not-performed");
  assert.equal((await mutateNativeTask(root, "WK-one", "review", reviewRequest)).replayed, true);
  const item = await readNativeTask(root, "WK-one");
  assert.equal(item.history.length, 5); assert.equal(item.contract.state, "intake");
  assert.equal(item.contract.verification.reviewer, null); assert.equal(item.review.actor.agent_id, "reviewer");
  assert.equal((await diagnoseTaskProject(root)).valid, true);
  const status = spawnSync(process.execPath, [cli, "status", root], { encoding: "utf8" });
  assert.equal(status.status, 0, status.stderr); assert.equal(JSON.parse(status.stdout).tasks[0].state, "done");
});

test("identity, immutable input, stale claims, duplicate requests and self-review fail closed", async t => {
  const root = await fixture(t);
  const initial = request(0);
  await createNativeTask(root, contract(), initial);
  assert.equal((await createNativeTask(root, contract(), initial)).replayed, true);
  await assert.rejects(createNativeTask(root, { ...contract(), goal: "Other scope" }, initial), /already exists/);
  await assert.rejects(mutateNativeTask(root, "WK-one", "claim", request(1, reviewer, { base_revision: git(root, "rev-parse", "HEAD") })), /approved task Agent/);
  await assert.rejects(mutateNativeTask(root, "WK-one", "claim", request(0, developer, { operation_id: "stale-claim" })), /Stale/);
  const claim = await mutateNativeTask(root, "WK-one", "claim", request(1, developer, { base_revision: git(root, "rev-parse", "HEAD") }));
  await assert.rejects(mutateNativeTask(root, "WK-one", "release", request(2, developer, { claim_id: "stale", summary: "Release" })), /matching.*claim/);
  await assert.rejects(mutateNativeTask(root, "WK-one", "claim", request(1, developer, { base_revision: "a".repeat(40) })), /different input/);
  const ref = ".ai-org/artifacts/WK-one/test.md"; await write(root, ref, "Test evidence");
  const revision = git(root, "rev-parse", "HEAD");
  await mutateNativeTask(root, "WK-one", "handoff", request(2, developer, { claim_id: claim.claim.id, revision, summary: "No product change required", evidence: [ref], unresolved: [] }));
  await assert.rejects(mutateNativeTask(root, "WK-one", "review", request(3, developer, { revision, judgment: "pass", summary: "Self", evidence: [ref] })), /separation/);
  await assert.rejects(mutateNativeTask(root, "WK-one", "review", request(3, reviewer, { revision: "a".repeat(40), judgment: "pass", summary: "Wrong", evidence: [ref] })), /exact delivered/);
  assert.equal((await readNativeTask(root, "WK-one")).version, 3);
});

test("contract authority, unknown fields, high risk, paths and evidence are bounded", async t => {
  const root = await fixture(t);
  for (const change of [
    d => { d.verification.separation = "none"; }, d => { d.verification.risk_tier = "high"; },
    d => { d.environment.data.classification = "sensitive"; }, d => { d.authorization.approved_by = "review-owner"; },
    d => { d.environment.cwd = ".."; }, d => { d.authorization.approval_ref = "../secret"; },
    d => { d.actor.principal_id = "unregistered"; }, d => { d.capabilities = ["coding"]; },
    d => { d.authorization.expires_at = "2000-01-01T00:00:00Z"; }
  ]) { const doc = structuredClone(contract()); change(doc); await assert.rejects(createNativeTask(root, doc, request(0))); }
  await assert.rejects(createNativeTask(root, contract(), { ...request(0), hidden: true }), /Unknown/);
  await fs.symlink("docs/approval.md", path.join(root, "link.md"));
  const linked = contract(); linked.authorization.approval_ref = "link.md";
  await assert.rejects(createNativeTask(root, linked, request(0)), /symlink/);
  await fs.unlink(path.join(root, "link.md"));
  await createNativeTask(root, contract(), request(0));
  await write(root, "docs/approval.md", "Changed authorization");
  await assert.rejects(mutateNativeTask(root, "WK-one", "claim", request(1, developer, { base_revision: git(root, "rev-parse", "HEAD") })), /changed/);
  assert.equal((await diagnoseTaskProject(root)).valid, false);
});

test("candidate guards cover outside roots, untracked product, evidence tampering and unresolved work", async t => {
  const root = await fixture(t);
  await createNativeTask(root, contract(), request(0));
  const claimed = await mutateNativeTask(root, "WK-one", "claim", request(1, developer, { base_revision: git(root, "rev-parse", "HEAD") }));
  const ref = ".ai-org/artifacts/WK-one/evidence.md"; await write(root, ref, "Evidence");
  const handoff = extra => request(2, developer, { claim_id: claimed.claim.id, revision: git(root, "rev-parse", "HEAD"), summary: "Repair", evidence: [ref], unresolved: [], ...extra });
  await assert.rejects(mutateNativeTask(root, "WK-one", "handoff", handoff({ unresolved: ["test failed"] })), /outstanding/);
  await write(root, "untracked.mjs", "Hidden code");
  await assert.rejects(mutateNativeTask(root, "WK-one", "handoff", handoff()), /clean product/);
  await fs.unlink(path.join(root, "untracked.mjs"));
  await write(root, "outside.txt", "Out of scope"); git(root, "add", "outside.txt"); git(root, "commit", "-qm", "outside");
  await assert.rejects(mutateNativeTask(root, "WK-one", "handoff", handoff()), /outside approved/);
  assert.equal((await readNativeTask(root, "WK-one")).state, "build");
  const second = await fixture(t); const delivery = await deliver(second);
  await write(second, delivery.ref, "Changed after delivery");
  await assert.rejects(mutateNativeTask(second, "WK-one", "review", request(3, reviewer, { revision: delivery.revision, judgment: "pass", summary: "Review", evidence: [delivery.ref] })), /changed/);
});

test("dependencies and overlapping active claims prevent premature or competing work", async t => {
  const root = await fixture(t);
  const child = contract("WK-child"); child.dependencies = ["WK-one"];
  await assert.rejects(createNativeTask(root, child, request(0)));
  await createNativeTask(root, contract(), request(0)); await createNativeTask(root, child, request(0));
  const base = git(root, "rev-parse", "HEAD");
  await assert.rejects(mutateNativeTask(root, "WK-child", "claim", request(1, developer, { base_revision: base })), /accepted native/);
  await mutateNativeTask(root, "WK-one", "claim", request(1, developer, { base_revision: base }));
  await createNativeTask(root, contract("WK-other"), request(0));
  await assert.rejects(mutateNativeTask(root, "WK-other", "claim", request(1, developer, { base_revision: base })), /overlapping/);
});

test("failed review preserves its attempt, requires fresh candidate and invalidates old review", async t => {
  const root = await fixture(t); const { revision, ref } = await deliver(root);
  await mutateNativeTask(root, "WK-one", "review", request(3, reviewer, { revision, judgment: "fail", summary: "Boundary defect", evidence: [ref] }));
  await assert.rejects(mutateNativeTask(root, "WK-one", "close", request(4, developer, { revision, summary: "Cannot close", rollback: "Revert", evidence: [ref] })), /independently accepted/);
  await mutateNativeTask(root, "WK-one", "rework", request(4, developer, { summary: "Repair same scope" }));
  const claim = await mutateNativeTask(root, "WK-one", "claim", request(5, developer, { base_revision: revision }));
  await assert.rejects(mutateNativeTask(root, "WK-one", "handoff", request(6, developer, { claim_id: claim.claim.id, revision, summary: "Retry old", evidence: [ref], unresolved: [] })), /fresh candidate/);
  const item = await readNativeTask(root, "WK-one"); assert.equal(item.review, null); assert.equal(item.attempts[0].review.judgment, "fail");
});

test("initialization and mode routing preserve existing files and reject legacy writers", async t => {
  const root = await fixture(t);
  const before = await fs.readFile(path.join(root, "workkeel.lock"));
  await assert.rejects(initializeTaskProject(root, policy()), /never overwrites/);
  assert.deepEqual(await fs.readFile(path.join(root, "workkeel.lock")), before);
  const legacy = spawnSync(process.execPath, [legacyCli, "status", root], { encoding: "utf8" });
  assert.notEqual(legacy.status, 0); assert.match(legacy.stderr, /task-first/);
  const launcher = spawnSync(process.execPath, [path.join(root, "workkeelw.mjs"), "doctor", root], { encoding: "utf8", env: { ...process.env, WORKKEEL_CLI_PATH: cli } });
  assert.equal(launcher.status, 0, launcher.stderr); assert.equal(JSON.parse(launcher.stdout).valid, true);
  const unknown = spawnSync(process.execPath, [cli, "status", root, "--id", "WK-one"], { encoding: "utf8" });
  assert.notEqual(unknown.status, 0);
  await fs.mkdir(path.join(root, "nested"));
  await assert.rejects(initializeTaskProject(path.join(root, "nested"), policy()), /repository root/);
});

test("explicit legacy migration retains bytes, binds preview and rejects active/team history", async t => {
  const root = await fixture(t, { init: false });
  await write(root, "temple.lock", { schema_version: "temple.lock/v1" });
  await write(root, ".ai-org/project/collaboration.json", { schema_version: "temple.collaboration/v2", profile: "solo", actor_policy: { ordinary_development: "attributed" } });
  for (const name of ["policies.json", "workflow.json", "collaboration-profiles.json", "high-assurance.json"]) {
    await write(root, `.ai-org/core/${name}`, await fs.readFile(new URL(`../project-overlay/.ai-org/core/${name}`, import.meta.url), "utf8"));
  }
  await write(root, ".ai-org/events/events.jsonl", "{\"event\":\"old\"}\n");
  const ref = ".ai-org/work-items/WI-0001.json";
  const old = { schema_version: "temple.work-item/v1", id: "WI-0001", title: "Historical", state: "done", workflow_profile: "standard", claim: null };
  await write(root, ref, old); const before = await fs.readFile(path.join(root, ref));
  await assert.rejects(initializeTaskProject(root, policy()), /preview/);
  const preview = await previewLegacyMigration(root, policy());
  const workflowPath = path.join(root, ".ai-org/core/workflow.json");
  const originalWorkflow = await fs.readFile(workflowPath, "utf8");
  await fs.writeFile(workflowPath, JSON.stringify({ ...JSON.parse(originalWorkflow), default_profile: "high-assurance" }));
  await assert.rejects(previewLegacyMigration(root, policy()), /Customized/);
  await fs.writeFile(workflowPath, originalWorkflow);
  await write(root, ".ai-org/project/collaboration.json", { schema_version: "temple.collaboration/v2", profile: "collaborative" });
  await assert.rejects(previewLegacyMigration(root, policy()), /Team/);
  await write(root, ".ai-org/project/collaboration.json", { schema_version: "temple.collaboration/v2", profile: "solo", actor_policy: { ordinary_development: "attributed" } });
  await assert.rejects(initializeTaskProject(root, policy(), { migrationFingerprint: "wrong" }), /Stale/);
  await write(root, ref, { ...old, state: "build" }); await assert.rejects(previewLegacyMigration(root, policy()), /terminal/);
  await write(root, ref, before.toString());
  await initializeTaskProject(root, policy(), { migrationFingerprint: preview.fingerprint });
  assert.deepEqual(await fs.readFile(path.join(root, ref)), before);
  assert.equal((await listTaskItems(root))[0].mode, "legacy-read-only");
  assert.equal((await diagnoseTaskProject(root)).valid, true);
});

test("CLI init/create/claim and concurrent retries share the canonical task path", async t => {
  const root = await fixture(t, { init: false });
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  const init = run(["init", root, "--policy", "policy.json"]); assert.equal(init.status, 0, init.stderr);
  await write(root, "task-contract.json", contract()); git(root, "add", "."); git(root, "commit", "-qm", "task policy");
  const ref = ".ai-org/artifacts/WK-one/request.json";
  await write(root, ref, request(0));
  const created = run(["task", "create", root, "--source", "task-contract.json", "--request", ref]); assert.equal(created.status, 0, created.stderr);
  const claimRequest = request(1, developer, { base_revision: git(root, "rev-parse", "HEAD") });
  await write(root, ref, claimRequest);
  const claimed = run(["task", "claim", root, "--id", "WK-one", "--request", ref]); assert.equal(claimed.status, 0, claimed.stderr);
  const release = request(2, developer, { claim_id: JSON.parse(claimed.stdout).claim.id, summary: "Release for another session" });
  const outcomes = await Promise.all([mutateNativeTask(root, "WK-one", "release", release), mutateNativeTask(root, "WK-one", "release", release)]);
  assert.equal(outcomes.filter(x => x.replayed).length, 1); assert.equal((await readNativeTask(root, "WK-one")).version, 3);
  const recordPath = path.join(root, ".ai-org/work-items/WK-one.json"); const record = JSON.parse(await fs.readFile(recordPath, "utf8"));
  record.state = "done"; await fs.writeFile(recordPath, JSON.stringify(record));
  await assert.rejects(readNativeTask(root, "WK-one"), /recorded operation/);
});

test("artifact code, stale dependency evidence and unintegrated dependencies cannot pass acceptance", async t => {
  const root = await fixture(t);
  const helper = ".ai-org/artifacts/WK-one/helper.mjs";
  await write(root, helper, "export const value = 1;\n"); git(root, "add", helper); git(root, "commit", "-qm", "baseline helper");
  const { revision, ref } = await deliver(root);
  const report = ".ai-org/artifacts/WK-one/review.md"; await write(root, report, "Distinct reviewer report");
  await mutateNativeTask(root, "WK-one", "review", request(3, reviewer, { revision, judgment: "pass", summary: "Reviewed", evidence: [report] }));
  await write(root, helper, "export const value = 999;\n");
  await assert.rejects(mutateNativeTask(root, "WK-one", "close", request(4, developer, { revision, summary: "Accept", rollback: "Revert", evidence: [report] })), /clean product/);
  await write(root, helper, "export const value = 1;\n");
  await mutateNativeTask(root, "WK-one", "close", request(4, developer, { revision, summary: "Accept", rollback: "Revert", evidence: [report] }));
  const child = contract("WK-child"); child.dependencies = ["WK-one"];
  await createNativeTask(root, child, request(0));
  await write(root, ref, "Changed dependency evidence");
  await assert.rejects(mutateNativeTask(root, "WK-child", "claim", request(1, developer, { base_revision: revision })), /changed/);
  await write(root, ref, `Verified ${revision}.\n`);
  const previous = git(root, "rev-parse", `${revision}^`); git(root, "checkout", "--detach", previous);
  await assert.rejects(mutateNativeTask(root, "WK-child", "claim", request(1, developer, { base_revision: previous })), /Git candidate check/);
});
