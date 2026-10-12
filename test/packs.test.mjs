import assert from "node:assert/strict";
import { TEMPLATE_VERSION } from "../src/constants.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  executePackInstall,
  executePackRemove,
  planPackInstall,
  planPackRemove
} from "../src/packs.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin/temple.mjs");

function configDocument() {
  return {
    schema_version: "temple.init/v1",
    project: { id: "pack-product", name: "Pack Product" },
    naming_mode: "ai-suggested",
    agents: [
      { display_name: "Fixture Rowan", positions: ["engineering_manager", "release_manager", "observer"] },
      { display_name: "Fixture Linden", positions: ["product_manager", "ux_designer", "ui_designer"] },
      { display_name: "Fixture Ellis", positions: ["tech_lead"] },
      { display_name: "Fixture Devon", positions: ["developer"] },
      { display_name: "Fixture Hollis", positions: ["quality_evaluator", "independent_qa"] }
    ]
  };
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

async function fixture() {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-pack-test-"));
  const target = path.join(temporaryRoot, "pack-product");
  const configPath = path.join(temporaryRoot, "init.json");
  await fs.writeFile(configPath, `${JSON.stringify(configDocument(), null, 2)}\n`);
  const initialized = run(["init", target, "--config", configPath]);
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
  return { temporaryRoot, target, configPath };
}

async function readJson(targetPath) {
  return JSON.parse(await fs.readFile(targetPath, "utf8"));
}

test("core init leaves optional development packs uninstalled", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));

  await assert.rejects(() => fs.access(path.join(target, ".agents/skills/tdd/SKILL.md")));
  await assert.rejects(() => fs.access(path.join(target, ".agents/skills/diagnosing-bugs/SKILL.md")));
  const lock = await readJson(path.join(target, "temple.lock"));
  assert.deepEqual(lock.optional_packs, []);

  const listed = run(["pack", "list", target, "--json"]);
  assert.equal(listed.status, 0, listed.stderr || listed.stdout);
  const packs = JSON.parse(listed.stdout);
  assert.equal(packs.length, 1);
  assert.equal(packs[0].id, "build-quality");
  assert.equal(packs[0].installed, false);
  assert.deepEqual(packs[0].skills, ["tdd", "diagnosing-bugs"]);
});

test("build-quality pack dry-run, install, re-init, and removal preserve checksum boundaries", async (context) => {
  const { temporaryRoot, target, configPath } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));

  const dryRun = run(["pack", "install", target, "--pack", "build-quality", "--dry-run"]);
  assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
  assert.match(dryRun.stdout, /copy-pack-file: 5/);
  await assert.rejects(() => fs.access(path.join(target, ".agents/skills/tdd/SKILL.md")));

  const installed = run(["pack", "install", target, "--pack", "build-quality"]);
  assert.equal(installed.status, 0, installed.stderr || installed.stdout);
  assert.match(installed.stdout, /Installed optional pack build-quality/);
  await fs.access(path.join(target, ".agents/skills/tdd/SKILL.md"));
  await fs.access(path.join(target, ".agents/skills/diagnosing-bugs/SKILL.md"));

  const installedLock = await readJson(path.join(target, "temple.lock"));
  assert.equal(installedLock.optional_packs[0].id, "build-quality");
  assert.equal(installedLock.optional_packs[0].version, "0.2.0-alpha.1");
  assert.ok(installedLock.managed_files.some((entry) => entry.path === ".agents/skills/tdd/SKILL.md"));

  const doctor = run(["doctor", target]);
  assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
  assert.match(doctor.stdout, /1 optional packs are valid/);
  assert.match(doctor.stdout, /6 core and 2 optional repository Skills/);
  const installedStatus = await fs.readFile(path.join(target, ".ai-org/views/status.md"), "utf8");
  assert.match(installedStatus, /Optional Skill packs: 1 installed/);
  assert.match(installedStatus, /build-quality.*tdd, diagnosing-bugs/);

  const reinit = run(["init", target, "--config", configPath]);
  assert.equal(reinit.status, 0, reinit.stderr || reinit.stdout);
  const reinitLock = await readJson(path.join(target, "temple.lock"));
  assert.equal(reinitLock.optional_packs[0].id, "build-quality");
  assert.ok(reinitLock.managed_files.some((entry) => entry.path === ".agents/skills/tdd/SKILL.md"));

  const repeated = run(["pack", "install", target, "--pack", "build-quality"]);
  assert.equal(repeated.status, 0, repeated.stderr || repeated.stdout);
  assert.match(repeated.stdout, /skip-installed-pack/);

  const tddPath = path.join(target, ".agents/skills/tdd/SKILL.md");
  const removalDryRun = run(["pack", "remove", target, "--pack", "build-quality", "--dry-run"]);
  assert.equal(removalDryRun.status, 0, removalDryRun.stderr || removalDryRun.stdout);
  assert.match(removalDryRun.stdout, /remove-pack-file: 5/);
  await fs.access(tddPath);

  const original = await fs.readFile(tddPath, "utf8");
  await fs.appendFile(tddPath, "project mutation\n");
  const blockedRemoval = run(["pack", "remove", target, "--pack", "build-quality"]);
  assert.equal(blockedRemoval.status, 1);
  assert.match(blockedRemoval.stdout, /installed pack file changed/);
  assert.match(await fs.readFile(tddPath, "utf8"), /project mutation/);

  await fs.writeFile(tddPath, original);
  const removed = run(["pack", "remove", target, "--pack", "build-quality"]);
  assert.equal(removed.status, 0, removed.stderr || removed.stdout);
  await assert.rejects(() => fs.access(tddPath));
  await assert.rejects(() => fs.access(path.join(target, ".agents/skills/diagnosing-bugs/SKILL.md")));
  assert.deepEqual((await readJson(path.join(target, "temple.lock"))).optional_packs, []);
  assert.equal(run(["doctor", target]).status, 0);
  assert.match(await fs.readFile(path.join(target, ".ai-org/views/status.md"), "utf8"), /No optional Skill packs installed/);
});

test("upgrade carries installed pack files and refreshes pack metadata", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  assert.equal(run(["pack", "install", target, "--pack", "build-quality"]).status, 0);

  const lockPath = path.join(target, "temple.lock");
  const lock = await readJson(lockPath);
  lock.template.version = "0.1.0-alpha.5";
  lock.optional_packs[0].version = "0.1.0-alpha.0";
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  const dryRun = run(["upgrade", target, "--dry-run"]);
  assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
  assert.match(dryRun.stdout, /update-pack-metadata: 1/);

  const upgraded = run(["upgrade", target]);
  assert.equal(upgraded.status, 0, upgraded.stderr || upgraded.stdout);
  const upgradedLock = await readJson(lockPath);
  assert.equal(upgradedLock.template.version, TEMPLATE_VERSION);
  assert.equal(upgradedLock.optional_packs[0].version, "0.2.0-alpha.1");
  await fs.access(path.join(target, ".agents/skills/tdd/SKILL.md"));
  assert.equal(run(["doctor", target]).status, 0);
});

test("pack install refuses a conflicting project file without partial writes", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const conflictPath = path.join(target, ".agents/skills/tdd/SKILL.md");
  await fs.mkdir(path.dirname(conflictPath), { recursive: true });
  await fs.writeFile(conflictPath, "project-owned test skill\n");

  const installed = run(["pack", "install", target, "--pack", "build-quality"]);
  assert.equal(installed.status, 1);
  assert.match(installed.stdout, /untracked file blocks optional pack/);
  assert.equal(await fs.readFile(conflictPath, "utf8"), "project-owned test skill\n");
  await assert.rejects(() => fs.access(path.join(target, ".agents/skills/diagnosing-bugs/SKILL.md")));
  assert.deepEqual((await readJson(path.join(target, "temple.lock"))).optional_packs, []);
});

test("pack install refuses to adopt an identical untracked project Skill", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const relativePath = ".agents/skills/tdd/SKILL.md";
  const conflictPath = path.join(target, relativePath);
  const sourcePath = path.join(root, "packs/build-quality", relativePath);
  const original = await fs.readFile(sourcePath, "utf8");
  await fs.mkdir(path.dirname(conflictPath), { recursive: true });
  await fs.writeFile(conflictPath, original);

  const installed = run(["pack", "install", target, "--pack", "build-quality"]);
  assert.equal(installed.status, 1);
  assert.match(installed.stdout, /untracked file blocks optional pack/);
  assert.equal(await fs.readFile(conflictPath, "utf8"), original);
  await assert.rejects(() => fs.access(path.join(target, ".agents/skills/diagnosing-bugs/SKILL.md")));
  const lock = await readJson(path.join(target, "temple.lock"));
  assert.deepEqual(lock.optional_packs, []);
  assert.ok(!lock.managed_files.some((entry) => entry.path === relativePath));
});

test("pack install rolls back earlier files when a later path appears after planning", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const lockPath = path.join(target, "temple.lock");
  const lockBefore = await fs.readFile(lockPath, "utf8");
  const plan = await planPackInstall(target, "build-quality");
  const copies = plan.actions.filter((action) => action.type === "copy-pack-file");
  const firstPath = path.join(target, copies[0].path);
  const racePath = path.join(target, copies.at(-1).path);
  await fs.mkdir(path.dirname(racePath), { recursive: true });
  await fs.writeFile(racePath, "late project pack collision\n");

  await assert.rejects(() => executePackInstall(plan), (error) => error.code === "EEXIST");
  await assert.rejects(() => fs.access(firstPath));
  assert.equal(await fs.readFile(racePath, "utf8"), "late project pack collision\n");
  assert.equal(await fs.readFile(lockPath, "utf8"), lockBefore);
});

test("pack removal rolls back earlier removals when a later file changes", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  assert.equal(run(["pack", "install", target, "--pack", "build-quality"]).status, 0);
  const lockPath = path.join(target, "temple.lock");
  const lockBefore = await fs.readFile(lockPath, "utf8");
  const plan = await planPackRemove(target, "build-quality");
  const removals = plan.actions.filter((action) => action.type === "remove-pack-file");
  const firstPath = path.join(target, removals[0].path);
  const secondPath = path.join(target, removals.at(-1).path);
  const firstBefore = await fs.readFile(firstPath, "utf8");
  await fs.appendFile(secondPath, "late external edit\n");

  await assert.rejects(() => executePackRemove(plan), /changed before removal/);
  assert.equal(await fs.readFile(firstPath, "utf8"), firstBefore);
  assert.match(await fs.readFile(secondPath, "utf8"), /late external edit/);
  assert.equal(await fs.readFile(lockPath, "utf8"), lockBefore);
});

test("pack removal never trusts lock paths outside the known manifest", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  assert.equal(run(["pack", "install", target, "--pack", "build-quality"]).status, 0);

  const outsidePath = path.join(temporaryRoot, "outside.txt");
  await fs.writeFile(outsidePath, "preserve me\n");
  const lockPath = path.join(target, "temple.lock");
  const lock = await readJson(lockPath);
  lock.optional_packs[0].managed_files = ["../../../outside.txt"];
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  const removed = run(["pack", "remove", target, "--pack", "build-quality"]);
  assert.equal(removed.status, 1);
  assert.match(removed.stdout, /metadata differs from the known manifest/);
  assert.equal(await fs.readFile(outsidePath, "utf8"), "preserve me\n");
  await fs.access(path.join(target, ".agents/skills/tdd/SKILL.md"));
});
