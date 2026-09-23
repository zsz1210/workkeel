import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { testInventory, groupFor, fastFiles, dailyFiles, selectChangedTests, changedPaths, selectionOptions } from "../scripts/test-groups.mjs";

test("every discovered test belongs to exactly one group; new tests default to core", async () => {
  const inventory = await testInventory();
  assert.ok(inventory.length > 0);
  assert.equal(new Set(inventory).size, inventory.length);
  const combined = ["core", "optional", "experiments"].flatMap((group) => inventory.filter((file) => groupFor(file) === group));
  assert.deepEqual(combined.sort(), inventory);
  assert.equal(groupFor("test/new.test.mjs"), "core");
  for (const file of ["test/delivery-control-pair.test.mjs", "test/continuity-live-runner.test.mjs",
    "test/delivery-matrix-experiment.test.mjs", "test/recovery-matrix-fixtures.test.mjs"]) {
    assert.equal(groupFor(file), "experiments", file);
  }
  assert.ok(fastFiles.every((file) => inventory.includes(file)));
  assert.ok(dailyFiles.every((file) => inventory.includes(file)));
  assert.ok(fastFiles.every((file) => dailyFiles.includes(file)));
  assert.ok(["test/autonomous-delivery.test.mjs", "test/collaborative-recovery.test.mjs",
    "test/high-assurance.test.mjs", "test/recovery.test.mjs", "test/control-plane-live.test.mjs",
    "test/json-rpc-process-cleanup.test.mjs"].every((file) => dailyFiles.includes(file)));
  assert.ok(dailyFiles.every((file) => groupFor(file) !== "experiments"));
});

test("prose uses fast checks; changed tests include their entire group", async () => {
  const inventory = await testInventory();
  assert.deepEqual(selectChangedTests(["README.md", "docs/getting-started/testing.md"], inventory).files, [...fastFiles].sort());
  for (const file of ["test/context.test.mjs", "test/control-plane-live.test.mjs", "test/context-capsule-ablation.test.mjs"]) {
    const selection = selectChangedTests([file], inventory);
    assert.ok(inventory.filter((candidate) => groupFor(candidate) === groupFor(file)).every((candidate) => selection.files.includes(candidate)));
  }
});

test("unknown, shared, state, fixture and deleted test paths fail toward the full suite", async () => {
  const inventory = await testInventory();
  for (const paths of [[], ["src/evidence.mjs"], ["scripts/test-groups.mjs"], ["package.json"], [".ai-org/project/evidence.json"],
    ["test/fixtures/example.json"], ["test/deleted.test.mjs"], ["README.md", "unknown"], ["AGENTS.md"], ["docs/../src/a.md"]]) {
    assert.deepEqual(selectChangedTests(paths, inventory).files, inventory);
    assert.equal(selectChangedTests(paths, inventory).mode, "full");
  }
});

test("selection options reject typos, duplicate flags and missing base values", () => {
  assert.deepEqual(selectionOptions("changed", ["--base", "origin/main", "--list", "--verbose"]), { base: "origin/main", list: true, verbose: true });
  for (const args of [["--unknown"], ["--base"], ["--base", "--list"], ["--base", "HEAD", "--base", "main"], ["--list", "--list"]]) {
    assert.throws(() => selectionOptions("changed", args), /selection option/);
  }
  assert.throws(() => selectionOptions("full", ["--verbose", "--verbose"]), /selection option/);
  assert.throws(() => selectionOptions("core", ["--base", "HEAD"]));
});

test("compact reporter keeps full failed-test diagnostics", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "temple-compact-reporter-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const fixture = path.join(directory, "failure.test.mjs");
  await fs.writeFile(fixture, `import test from "node:test";\nimport assert from "node:assert/strict";\ntest("actionable sentinel",()=>assert.equal("actual","expected"));\n`);
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ["--test", "--test-reporter=dot", fixture], { encoding: "utf8", env });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Failed tests:/);
  assert.match(result.stdout, /actionable sentinel/);
  assert.match(result.stdout, /AssertionError/);
  assert.match(result.stdout, /actual/);
  assert.match(result.stdout, /expected/);
  assert.match(result.stdout, /failure\.test\.mjs/);
});

test("CLI does not silently narrow verification after an unrecognized option", () => {
  const changed = spawnSync(process.execPath, ["scripts/test-groups.mjs", "changed", "--base", "HEAD", "--typo", "--list"], { encoding: "utf8" });
  assert.equal(changed.status, 0, changed.stderr);
  const selection = JSON.parse(changed.stdout);
  assert.equal(selection.mode, "full");
  assert.match(selection.reason, /selection option/);
  const explicit = spawnSync(process.execPath, ["scripts/test-groups.mjs", "fast", "--typo", "--list"], { encoding: "utf8" });
  assert.equal(explicit.status, 1);
  assert.match(explicit.stderr, /selection option/);
});

test("comparison includes committed, staged, unstaged, untracked and both rename paths", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "temple-test-selection-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  git("init", "-q"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.invalid");
  for (const file of ["committed", "staged", "unstaged", "old name"]) await fs.writeFile(path.join(root, file), file);
  git("add", "."); git("commit", "-qm", "base"); const base = git("rev-parse", "HEAD");
  await fs.writeFile(path.join(root, "committed"), "new"); git("add", "."); git("commit", "-qm", "change");
  await fs.writeFile(path.join(root, "staged"), "new"); git("add", "staged");
  await fs.writeFile(path.join(root, "unstaged"), "new"); await fs.writeFile(path.join(root, "untracked"), "new");
  git("mv", "old name", "new name");
  assert.deepEqual(changedPaths(root, base).sort(), ["committed", "new name", "old name", "staged", "unstaged", "untracked"].sort());
  assert.throws(() => changedPaths(root, "missing-ref"));
  assert.throws(() => changedPaths(root));
});
