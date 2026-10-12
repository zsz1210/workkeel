import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fixture, createFixturePool, itemState, git } from "./helpers/lean-delivery-fixture.mjs";

test("pooled fixtures share only unclaimed setup and isolate concurrent claims, objects and files", async t => {
  const pool = createFixturePool(); t.after(() => pool.cleanup());
  const fresh = await fixture(); t.after(fresh.cleanup);
  const [left, right] = await Promise.all([pool.fixture(), pool.fixture()]);
  t.after(left.cleanup); t.after(right.cleanup);
  assert.notEqual(left.target, right.target);
  assert.equal(left.setup[0].kind, "copied-initial-fixture");
  assert.equal(left.setup[0].source_target, right.setup[0].source_target);
  assert.ok(fresh.setup.every(step => step.kind !== "copied-initial-fixture"));
  const seed = left.setup[0].source_target;
  const sourceItem = JSON.parse(await fs.readFile(path.join(seed, ".ai-org/work-items/WI-0001.json")));
  assert.equal(sourceItem.state, "build");
  assert.equal(sourceItem.claim, null);
  assert.equal((sourceItem.claims ?? []).length, 0);
  assert.notEqual(left.request.claimId, right.request.claimId);
  for (const f of [left, right]) {
    assert.equal((await itemState(f)).claim.id, f.request.claimId);
    assert.equal((await itemState(f)).claim.status, "active");
    assert.equal(git(f.target, ["rev-parse", "HEAD"]), f.request.revision);
    assert.deepEqual((await itemState(f)).affected_paths, (await itemState(fresh)).affected_paths);
    await fs.access(path.join(f.temporary, "init.json"));
  }
  const names = ["app.mjs", ".ai-org/work-items/WI-0001.json", ".git/config"];
  const sourceBefore = await Promise.all(names.map(name => fs.readFile(path.join(seed, name))));
  const rightBefore = await Promise.all(names.map(name => fs.readFile(path.join(right.target, name))));
  for (const name of names) await fs.appendFile(path.join(left.target, name), "\nprivate mutation\n");
  left.item.title = "private object mutation";
  for (const [i, name] of names.entries()) {
    assert.deepEqual(await fs.readFile(path.join(seed, name)), sourceBefore[i]);
    assert.deepEqual(await fs.readFile(path.join(right.target, name)), rightBefore[i]);
  }
  const later = await pool.fixture(); t.after(later.cleanup);
  assert.notEqual(later.item.title, left.item.title);
  assert.equal((await itemState(later)).claim.status, "active");
  assert.notEqual(later.request.claimId, right.request.claimId);
  assert.deepEqual(await fs.readFile(path.join(later.target, "app.mjs")), sourceBefore[0]);
});

test("fixture pool keys retain workflow, affected paths and caller option snapshots", async t => {
  const pool = createFixturePool(); t.after(() => pool.cleanup());
  const options = { affectedPaths: ["app.mjs"] };
  const pending = pool.fixture(options);
  options.affectedPaths.push("caller-mutated.mjs");
  const a = await pending, b = await pool.fixture({ affectedPaths: ["docs/brief.md"] });
  const c = await pool.fixture({ workflowProfile: "standard", affectedPaths: ["app.mjs"] });
  for (const f of [a, b, c]) t.after(f.cleanup);
  assert.equal(new Set([a, b, c].map(f => f.setup[0].source_target)).size, 3);
  assert.deepEqual((await itemState(a)).affected_paths, ["app.mjs"]);
  assert.deepEqual((await itemState(b)).affected_paths, ["docs/brief.md"]);
  assert.equal((await itemState(c)).workflow_profile, "standard");
  assert.equal((await itemState(a)).workflow_profile, "lean");
});

test("failed fixture copy removes only its partial directory and leaves the seed usable", async t => {
  const pool = createFixturePool(); t.after(() => pool.cleanup());
  const initial = await pool.fixture(); t.after(initial.cleanup);
  const originalMkdtemp = fs.mkdtemp, originalCopy = fs.cp;
  const created = [];
  try {
    fs.mkdtemp = async (...args) => { const value = await originalMkdtemp(...args); created.push(value); return value; };
    fs.cp = async () => { throw new Error("injected copy failure"); };
    await assert.rejects(pool.fixture(), /injected copy failure/);
  } finally { fs.mkdtemp = originalMkdtemp; fs.cp = originalCopy; }
  assert.equal(created.length, 1);
  await assert.rejects(fs.stat(created[0]), { code: "ENOENT" });
  await fs.access(initial.target);
  const recovered = await pool.fixture(); t.after(recovered.cleanup);
  assert.equal(recovered.setup[0].source_target, initial.setup[0].source_target);
  assert.equal((await itemState(recovered)).claim.status, "active");
});

test("failed preparation cleans its directory and pool close waits for pending allocations", async t => {
  const pool = createFixturePool(); t.after(() => pool.cleanup());
  const originalMkdtemp = fs.mkdtemp, created = [];
  try {
    fs.mkdtemp = async (...args) => { const value = await originalMkdtemp(...args); created.push(value); return value; };
    await assert.rejects(pool.fixture({ workflowProfile: "invalid-profile" }));
    await assert.rejects(pool.fixture({ workflowProfile: "invalid-profile" }));
  } finally { fs.mkdtemp = originalMkdtemp; }
  assert.equal(created.length, 2, "explicit retry gets new setup instead of a poisoned rejected cache entry");
  for (const directory of created) await assert.rejects(fs.stat(directory), { code: "ENOENT" });
  const pending = pool.fixture();
  const closing = pool.cleanup();
  const f = await pending; t.after(f.cleanup);
  await closing;
  await assert.rejects(fs.stat(f.setup[0].source_target), { code: "ENOENT" });
  assert.equal((await itemState(f)).claim.status, "active");
  await assert.rejects(pool.fixture(), /closed/);
});
