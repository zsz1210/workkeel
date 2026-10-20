import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { projectMutationLockPath, withProjectMutationLock } from "../src/workkeel-lock.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
function git(root, ...args) { return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
async function repository(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-lock-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  git(root, "init", "-q");
  return root;
}

test("one Workkeel mutation runs per project and the lock is released afterwards", async t => {
  const root = await repository(t);
  const lockPath = projectMutationLockPath(root);
  assert.equal(lockPath, path.join(os.tmpdir(), `workkeel-mutation-${sha(path.resolve(root)).slice(0, 20)}.lock`));
  await withProjectMutationLock(root, async () => {
    await assert.rejects(withProjectMutationLock(root, async () => {}), /Another Workkeel mutation is still active/);
  });
  await assert.rejects(fs.access(lockPath), { code: "ENOENT" });
  await assert.rejects(withProjectMutationLock(root, async () => { throw new Error("operation failed"); }), /operation failed/);
  await assert.rejects(fs.access(lockPath), { code: "ENOENT" });
});

test("a stale lock expires while a fresh lock blocks", async t => {
  const root = await repository(t);
  const lockPath = projectMutationLockPath(root);
  t.after(() => fs.rm(lockPath, { force: true }));
  await fs.writeFile(lockPath, JSON.stringify({ pid: 1, created_at: new Date().toISOString() }));
  let entered = false;
  await assert.rejects(withProjectMutationLock(root, async () => { entered = true; }), /still active/);
  assert.equal(entered, false);
  const old = new Date(Date.now() - 600_000);
  await fs.utimes(lockPath, old, old);
  assert.equal(await withProjectMutationLock(root, async () => "entered"), "entered");
});
