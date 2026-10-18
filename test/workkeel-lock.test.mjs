import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { projectMutationLockPath, withProjectMutationLock } from "../src/workkeel-lock.mjs";
import { withProjectMutationLock as withTempleMutationLock } from "../src/project.mjs";
import { initializeTaskProject, previewLegacyMigration } from "../src/workkeel-project.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
const developer = { agent_id: "builder", principal_id: "owner" };
const reviewer = { agent_id: "reviewer", principal_id: "review-owner" };
const policy = () => ({ schema_version: "workkeel.task-policy/v1", principals: ["owner", "review-owner"], agents: [developer, reviewer], approvers: ["owner"], review_separation: "distinct-agent" });
function git(root, ...args) { return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
async function write(root, ref, data) {
  await fs.mkdir(path.dirname(path.join(root, ref)), { recursive: true });
  await fs.writeFile(path.join(root, ref), typeof data === "string" ? data : JSON.stringify(data));
}
async function repository(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-lock-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  git(root, "init", "-q"); git(root, "config", "user.name", "Fixture"); git(root, "config", "user.email", "fixture@example.invalid");
  await write(root, "README.md", "fixture\n"); git(root, "add", "."); git(root, "commit", "-qm", "base");
  return root;
}
async function pendingJournal(root, kind, journal) {
  const directory = path.join(git(root, "rev-parse", "--absolute-git-dir"), "temple", kind, sha(await fs.realpath(root)).slice(0, 20));
  await write(directory, "pending.json", journal);
  return path.join(directory, "pending.json");
}

test("the lock keeps the released file name so an older CLI and this version exclude each other", async t => {
  const root = await repository(t);
  const released = path.join(os.tmpdir(), `temple-mutation-${sha(path.resolve(root)).slice(0, 20)}.lock`);
  assert.equal(projectMutationLockPath(root), released);
  // An older CLI holding the released lock must block this version.
  await fs.writeFile(released, JSON.stringify({ pid: 1, created_at: new Date().toISOString() }));
  t.after(() => fs.rm(released, { force: true }));
  let entered = false;
  await assert.rejects(withProjectMutationLock(root, async () => { entered = true; }), /mutation is still active/);
  assert.equal(entered, false);
});

test("native and Temple writers share one lock", async t => {
  const root = await repository(t);
  await withProjectMutationLock(root, async () => {
    await assert.rejects(withTempleMutationLock(root, async () => {}), /mutation is still active/);
  });
  await withTempleMutationLock(root, async () => {
    await assert.rejects(withProjectMutationLock(root, async () => {}), /mutation is still active/);
  });
  await fs.access(projectMutationLockPath(root)).then(() => assert.fail("lock left behind"), error => assert.equal(error.code, "ENOENT"));
});

test("native mutations still refuse pending Lean delivery and reconciliation recovery", async t => {
  const root = await repository(t);
  const lean = await pendingJournal(root, "lean-delivery", { operation_key: "WI-0001/op-1", request: { position: "developer" } });
  await assert.rejects(withProjectMutationLock(root, async () => assert.fail("entered")),
    error => error.code === "PENDING_RECOVERY" && error.mutationStatus === "pending_recovery" && /WI-0001\/op-1.*finish/.test(error.message));
  // Temple's wrapper keeps its own checks, including its error type.
  await assert.rejects(withTempleMutationLock(root, async () => assert.fail("entered")), { code: "PENDING_RECOVERY" });
  assert.equal(await withProjectMutationLock(root, async () => "skipped", { legacyRecoveryCheck: false }), "skipped");
  await fs.rm(lean);
  await pendingJournal(root, "reconciliation", { transaction_id: "tx-1" });
  await assert.rejects(withProjectMutationLock(root, async () => assert.fail("entered")), { code: "RECONCILIATION_PENDING_RECOVERY", message: /tx-1/ });
});

test("an existing journal with null, falsy or invalid content still blocks mutation", async t => {
  const root = await repository(t);
  for (const [kind, code] of [["lean-delivery", "PENDING_RECOVERY"], ["reconciliation", "RECONCILIATION_PENDING_RECOVERY"]]) {
    for (const content of ["null", "false", "0", '""', "[]"]) {
      const file = await pendingJournal(root, kind, content);
      await assert.rejects(withProjectMutationLock(root, async () => assert.fail("entered")), { code }, `${kind} ${content}`);
      await fs.rm(file);
    }
    const file = await pendingJournal(root, kind, "{not json");
    await assert.rejects(withProjectMutationLock(root, async () => assert.fail("entered")), SyntaxError, `${kind} invalid JSON`);
    await fs.rm(file);
  }
  assert.equal(await withProjectMutationLock(root, async () => "clear"), "clear");
});

test("migration apply refuses to pin history while a legacy recovery is pending", async t => {
  const root = await repository(t);
  await write(root, "temple.lock", { schema_version: "temple.lock/v1" });
  await write(root, ".ai-org/project/collaboration.json", { schema_version: "temple.collaboration/v2", profile: "solo", actor_policy: { ordinary_development: "attributed" } });
  for (const name of ["policies.json", "workflow.json", "collaboration-profiles.json", "high-assurance.json"]) {
    await write(root, `.ai-org/core/${name}`, await fs.readFile(new URL(`../project-overlay/.ai-org/core/${name}`, import.meta.url), "utf8"));
  }
  await write(root, ".ai-org/events/events.jsonl", "{\"event\":\"old\"}\n");
  // An interrupted Lean finish already wrote the terminal state before its events.
  await write(root, ".ai-org/work-items/WI-0001.json", { schema_version: "temple.work-item/v1", id: "WI-0001", title: "Interrupted", state: "done", workflow_profile: "standard", claim: null });
  const preview = await previewLegacyMigration(root, policy());
  for (const [kind, journal, code] of [
    ["lean-delivery", { operation_key: "WI-0001/finish-1", request: { position: "developer" } }, "PENDING_RECOVERY"],
    ["reconciliation", { transaction_id: "tx-2" }, "RECONCILIATION_PENDING_RECOVERY"]
  ]) {
    const file = await pendingJournal(root, kind, journal);
    await assert.rejects(initializeTaskProject(root, policy(), { migrationFingerprint: preview.fingerprint }), { code });
    await assert.rejects(fs.access(path.join(root, "workkeel.lock")), { code: "ENOENT" });
    await fs.rm(file);
  }
  await initializeTaskProject(root, policy(), { migrationFingerprint: preview.fingerprint });
  await fs.access(path.join(root, "workkeel.lock"));
});
