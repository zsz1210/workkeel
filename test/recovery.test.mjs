import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CLI_BOOTSTRAP_SCHEMA, SUPPORTED_NODE_RANGE, validateCliBootstrapMetadata } from "../src/bootstrap.mjs";
import { TEMPLATE_VERSION } from "../src/constants.mjs";
import { runDoctor } from "../src/doctor.mjs";
import { formatJson, sha256 } from "../src/files.mjs";
import { executeInit, planInit } from "../src/install.mjs";
import { validateInitConfig } from "../src/model.mjs";
import {
  applyBackupRetention,
  applyRestore,
  createBackup,
  inspectBackup,
  inspectBackupSet,
  planBackupRetention,
  planRestore,
  recoverRestore,
  resolveRecoveryStateDirectory
} from "../src/recovery.mjs";
import { buildStatus, writeStatus } from "../src/status.mjs";
import { executeUpgrade, planUpgrade } from "../src/upgrade.mjs";

function configDocument(projectId = "recovery-fixture") {
  return {
    schema_version: "temple.init/v1",
    project: { id: projectId, name: "Recovery Fixture" },
    naming_mode: "ai-suggested",
    agents: [
      { display_name: "Rowan", positions: ["engineering_manager", "release_manager", "observer"] },
      { display_name: "Linden", positions: ["product_manager", "ux_designer", "ui_designer"] },
      { display_name: "Ellis", positions: ["tech_lead"] },
      { display_name: "Devon", positions: ["developer"] },
      { display_name: "Hollis", positions: ["quality_evaluator", "independent_qa"] }
    ]
  };
}

async function fixture(projectId) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-recovery-test-"));
  const target = path.join(temporaryRoot, "project");
  const backup = path.join(temporaryRoot, "backup");
  const plan = await planInit(target, await validateInitConfig(configDocument(projectId)));
  assert.deepEqual(plan.conflicts, []);
  await executeInit(plan);
  return { temporaryRoot, target, backup };
}

async function createNamedBackup(target, backupRoot, name, createdAt) {
  const output = path.join(backupRoot, name);
  await createBackup(target, output);
  const manifestPath = path.join(output, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.created_at = createdAt;
  await fs.writeFile(manifestPath, formatJson(manifest));
  return output;
}

async function setInstalledVersion(target, version) {
  const lockPath = path.join(target, "temple.lock");
  const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  lock.template.version = version;
  lock.template.bootstrap.version = version;
  lock.template.bootstrap.package_spec = `@zsz1210/temple-ai-dev-org@${version}`;
  await fs.writeFile(lockPath, formatJson(lock));
}

test("CLI bootstrap metadata validation is total and fail-closed", () => {
  for (const document of [undefined, null, [], true, "unpinned-package"]) {
    assert.deepEqual(validateCliBootstrapMetadata(document), {
      valid: false,
      errors: ["bootstrap metadata must be an object"]
    });
  }

  const valid = {
    schema_version: CLI_BOOTSTRAP_SCHEMA,
    version: TEMPLATE_VERSION,
    node: SUPPORTED_NODE_RANGE,
    launcher: "templew.mjs",
    package_spec: `@zsz1210/temple-ai-dev-org@${TEMPLATE_VERSION}`,
    repository_spec: null,
    source_revision: null,
    source_clean: false,
    invocation: "node ./templew.mjs <command> ."
  };
  assert.deepEqual(validateCliBootstrapMetadata(valid), { valid: true, errors: [] });

  const malformed = validateCliBootstrapMetadata({
    ...valid,
    repository_spec: { unpinned: true },
    source_revision: ["unpinned"]
  });
  assert.equal(malformed.valid, false);
  assert.deepEqual(malformed.errors, [
    "bootstrap repository_spec must be null or an exact Git revision",
    "bootstrap source_revision must be null or a Git commit"
  ]);
});

test("backup includes only project-owned Temple state and verifies every payload", async (context) => {
  const state = await fixture("backup-boundary");
  context.after(() => fs.rm(state.temporaryRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(state.target, ".agents/skills/custom-review"), { recursive: true });
  await fs.writeFile(path.join(state.target, ".agents/skills/custom-review/SKILL.md"), "# Custom review\n");
  await fs.mkdir(path.join(state.target, ".ai-org/views"), { recursive: true });
  await fs.writeFile(path.join(state.target, ".ai-org/views/status.md"), "generated\n");
  await fs.mkdir(path.join(state.target, "src"), { recursive: true });
  await fs.writeFile(path.join(state.target, "src/app.mjs"), "export default true;\n");

  const targetAlias = path.join(state.temporaryRoot, "target-alias");
  await fs.symlink(state.target, targetAlias, "dir");
  await assert.rejects(
    () => createBackup(state.target, path.join(targetAlias, "nested-backup")),
    /outside the project worktree/
  );

  const created = await createBackup(state.target, state.backup);
  const inspected = await inspectBackup(state.backup);
  const paths = inspected.manifest.files.map((entry) => entry.path);
  assert.equal(created.content_digest, inspected.content_digest);
  assert.ok(paths.includes("temple.lock"));
  assert.ok(paths.includes("AGENTS.md"));
  assert.ok(paths.includes(".ai-org/project/project.json"));
  assert.ok(paths.includes(".agents/skills/custom-review/SKILL.md"));
  assert.ok(!paths.includes(".ai-org/views/status.md"));
  assert.ok(!paths.includes("src/app.mjs"));
  assert.ok(!paths.includes(".agents/skills/temple-work/SKILL.md"));

  const firstPayload = path.join(state.backup, "files", paths[0]);
  await fs.appendFile(firstPayload, "tampered");
  await assert.rejects(() => inspectBackup(state.backup), /size mismatch|checksum mismatch/);
});

test("inspection rejects structural, path, payload-set, link, and bound tampering", async (context) => {
  const state = await fixture("backup-adversarial");
  context.after(() => fs.rm(state.temporaryRoot, { recursive: true, force: true }));
  await createBackup(state.target, state.backup);
  let sequence = 0;
  async function cloneBackup() {
    sequence += 1;
    const clone = path.join(state.temporaryRoot, `backup-case-${sequence}`);
    await fs.cp(state.backup, clone, { recursive: true });
    return clone;
  }
  async function editManifest(backup, edit) {
    const manifestPath = path.join(backup, "manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    edit(manifest);
    await fs.writeFile(manifestPath, formatJson(manifest));
  }

  const unsupported = await cloneBackup();
  await editManifest(unsupported, (manifest) => { manifest.schema_version = "temple.backup-manifest/v999"; });
  await assert.rejects(() => inspectBackup(unsupported), /Unsupported backup manifest schema/);

  const traversal = await cloneBackup();
  await editManifest(traversal, (manifest) => { manifest.files[0].path = "../escape"; });
  await assert.rejects(() => inspectBackup(traversal), /Unsafe backup path/);

  const duplicate = await cloneBackup();
  await editManifest(duplicate, (manifest) => {
    manifest.files.splice(1, 0, { ...manifest.files[0] });
    manifest.content_digest = sha256(JSON.stringify(manifest.files));
  });
  await assert.rejects(() => inspectBackup(duplicate), /duplicate paths/);

  const unordered = await cloneBackup();
  await editManifest(unordered, (manifest) => {
    manifest.files.reverse();
    manifest.content_digest = sha256(JSON.stringify(manifest.files));
  });
  await assert.rejects(() => inspectBackup(unordered), /not sorted/);

  const missing = await cloneBackup();
  const missingManifest = JSON.parse(await fs.readFile(path.join(missing, "manifest.json"), "utf8"));
  await fs.unlink(path.join(missing, "files", missingManifest.files[0].path));
  await assert.rejects(() => inspectBackup(missing), /do not exactly match/);

  const extra = await cloneBackup();
  await fs.writeFile(path.join(extra, "files/extra.txt"), "extra\n");
  await assert.rejects(() => inspectBackup(extra), /do not exactly match/);

  const linked = await cloneBackup();
  const linkedManifest = JSON.parse(await fs.readFile(path.join(linked, "manifest.json"), "utf8"));
  const linkedPath = path.join(linked, "files", linkedManifest.files[0].path);
  await fs.unlink(linkedPath);
  await fs.symlink(path.join(state.target, "temple.lock"), linkedPath);
  await assert.rejects(() => inspectBackup(linked), /Symbolic links are not allowed/);

  if (process.platform !== "win32") {
    const special = await cloneBackup();
    const specialManifest = JSON.parse(await fs.readFile(path.join(special, "manifest.json"), "utf8"));
    const specialPath = path.join(special, "files", specialManifest.files[0].path);
    await fs.unlink(specialPath);
    const fifo = spawnSync("mkfifo", [specialPath], { encoding: "utf8" });
    assert.equal(fifo.status, 0, fifo.stderr);
    await assert.rejects(() => inspectBackup(special), /Special files are not allowed/);
  }

  const oversized = await cloneBackup();
  await editManifest(oversized, (manifest) => {
    manifest.files[0].size = 256 * 1024 * 1024 + 1;
    manifest.content_digest = sha256(JSON.stringify(manifest.files));
  });
  await assert.rejects(() => inspectBackup(oversized), /Invalid or oversized backup entry/);

  const rootExtra = await cloneBackup();
  await fs.writeFile(path.join(rootExtra, "notes.txt"), "not part of the format\n");
  await assert.rejects(() => inspectBackup(rootExtra), /must contain only/);
});

test("backup-set retention is deterministic and preserves minimum, explicit, and foreign backups", async (context) => {
  const state = await fixture("retention-project");
  context.after(() => fs.rm(state.temporaryRoot, { recursive: true, force: true }));
  const backupRoot = path.join(state.temporaryRoot, "backup-set");
  await fs.mkdir(backupRoot);
  await createNamedBackup(state.target, backupRoot, "backup-oldest", "2026-08-01T00:00:00.000Z");
  await createNamedBackup(state.target, backupRoot, "backup-middle", "2026-08-02T00:00:00.000Z");
  await createNamedBackup(state.target, backupRoot, "backup-newer", "2026-08-03T00:00:00.000Z");
  await createNamedBackup(state.target, backupRoot, "backup-newest", "2026-08-04T00:00:00.000Z");

  const foreignTarget = path.join(state.temporaryRoot, "foreign-project");
  const foreignInit = await planInit(foreignTarget, await validateInitConfig(configDocument("foreign-project")));
  await executeInit(foreignInit);
  await createNamedBackup(foreignTarget, backupRoot, "backup-foreign", "2026-08-05T00:00:00.000Z");

  const firstInspection = await inspectBackupSet(backupRoot, { projectRoot: state.target });
  const secondInspection = await inspectBackupSet(backupRoot, { projectRoot: state.target });
  assert.deepEqual(secondInspection, firstInspection);
  assert.deepEqual(firstInspection.backups.map((entry) => entry.name), [
    "backup-foreign",
    "backup-middle",
    "backup-newer",
    "backup-newest",
    "backup-oldest"
  ]);

  const options = { minimumToKeep: 2, preserveBackupNames: ["backup-oldest"] };
  const firstPlan = await planBackupRetention(state.target, backupRoot, options);
  const secondPlan = await planBackupRetention(state.target, backupRoot, options);
  assert.deepEqual(secondPlan, firstPlan);
  assert.equal(firstPlan.delete_count, 1);
  assert.deepEqual(
    firstPlan.decisions.filter((entry) => entry.action === "delete").map((entry) => entry.name),
    ["backup-middle"]
  );
  assert.equal(firstPlan.decisions.find((entry) => entry.name === "backup-oldest").reason, "explicit-preserve");
  assert.equal(firstPlan.decisions.find((entry) => entry.name === "backup-foreign").reason, "different-project");
});

test("backup retention requires consent and a fresh digest before deletion", async (context) => {
  const state = await fixture("retention-stale");
  context.after(() => fs.rm(state.temporaryRoot, { recursive: true, force: true }));
  const backupRoot = path.join(state.temporaryRoot, "backup-set");
  await fs.mkdir(backupRoot);
  await createNamedBackup(state.target, backupRoot, "backup-one", "2026-08-01T00:00:00.000Z");
  await createNamedBackup(state.target, backupRoot, "backup-two", "2026-08-02T00:00:00.000Z");
  const options = { minimumToKeep: 1 };
  const preview = await planBackupRetention(state.target, backupRoot, options);

  await assert.rejects(
    () => applyBackupRetention(state.target, backupRoot, options),
    /digest returned by retention preview/
  );
  await assert.rejects(
    () => applyBackupRetention(state.target, backupRoot, { ...options, expectedPlan: preview.plan_digest }),
    /explicit delete consent/
  );

  await createNamedBackup(state.target, backupRoot, "backup-three", "2026-08-03T00:00:00.000Z");
  await assert.rejects(
    () => applyBackupRetention(state.target, backupRoot, {
      ...options,
      expectedPlan: preview.plan_digest,
      confirmDelete: true
    }),
    /preview is stale/
  );

  const fresh = await planBackupRetention(state.target, backupRoot, options);
  const applied = await applyBackupRetention(state.target, backupRoot, {
    ...options,
    expectedPlan: fresh.plan_digest,
    confirmDelete: true
  });
  assert.deepEqual(applied.deleted, ["backup-one", "backup-two"]);
  assert.deepEqual((await fs.readdir(backupRoot)).sort(), ["backup-three"]);
});

test("backup-set operations refuse traversal, links, non-directories, and nested project roots", async (context) => {
  const state = await fixture("retention-safety");
  context.after(() => fs.rm(state.temporaryRoot, { recursive: true, force: true }));
  const backupRoot = path.join(state.temporaryRoot, "backup-set");
  await fs.mkdir(backupRoot);
  await createNamedBackup(state.target, backupRoot, "backup-valid", "2026-08-01T00:00:00.000Z");

  await assert.rejects(
    () => planBackupRetention(state.target, backupRoot, { minimumToKeep: 1, preserveBackupNames: ["../outside"] }),
    /Unsafe backup-set entry name/
  );
  await assert.rejects(
    () => planBackupRetention(state.target, backupRoot, { minimumToKeep: 1, preserveBackupNames: "backup-valid" }),
    /must be an array/
  );
  await assert.rejects(
    () => inspectBackupSet(state.temporaryRoot, { projectRoot: state.target }),
    /must not contain one another/
  );

  const rootAlias = path.join(state.temporaryRoot, "backup-root-alias");
  await fs.symlink(backupRoot, rootAlias, "dir");
  await assert.rejects(() => inspectBackupSet(rootAlias), /existing real directory/);

  const linkedEntry = path.join(backupRoot, "backup-linked");
  await fs.symlink(path.join(backupRoot, "backup-valid"), linkedEntry, "dir");
  await assert.rejects(() => inspectBackupSet(backupRoot), /real backup directories/);
  await fs.unlink(linkedEntry);

  await fs.writeFile(path.join(backupRoot, "backup-file"), "not a backup\n");
  await assert.rejects(() => inspectBackupSet(backupRoot), /real backup directories/);
});

test("backup retention reports partial deletion and forces a new preview", async (context) => {
  const state = await fixture("retention-partial");
  context.after(() => fs.rm(state.temporaryRoot, { recursive: true, force: true }));
  const backupRoot = path.join(state.temporaryRoot, "backup-set");
  await fs.mkdir(backupRoot);
  await createNamedBackup(state.target, backupRoot, "backup-one", "2026-08-01T00:00:00.000Z");
  await createNamedBackup(state.target, backupRoot, "backup-two", "2026-08-02T00:00:00.000Z");
  await createNamedBackup(state.target, backupRoot, "backup-three", "2026-08-03T00:00:00.000Z");
  const options = { minimumToKeep: 1 };
  const preview = await planBackupRetention(state.target, backupRoot, options);

  await assert.rejects(
    () => applyBackupRetention(state.target, backupRoot, {
      ...options,
      expectedPlan: preview.plan_digest,
      confirmDelete: true,
      simulateFailureAfterDeletes: 1
    }),
    (error) => {
      assert.equal(error.code, "TEMPLE_BACKUP_RETENTION_PARTIAL_FAILURE");
      assert.deepEqual(error.deleted, ["backup-one"]);
      assert.deepEqual(error.remaining, ["backup-two"]);
      return true;
    }
  );
  assert.equal(await fs.stat(path.join(backupRoot, "backup-two")).then(() => true), true);
  await assert.rejects(
    () => applyBackupRetention(state.target, backupRoot, {
      ...options,
      expectedPlan: preview.plan_digest,
      confirmDelete: true
    }),
    /preview is stale/
  );
});

test("restore preview is stale-safe, requires replacement consent, and preserves target-only files", async (context) => {
  const state = await fixture("restore-contract");
  context.after(() => fs.rm(state.temporaryRoot, { recursive: true, force: true }));
  const projectPath = path.join(state.target, ".ai-org/project/project.json");
  const original = await fs.readFile(projectPath, "utf8");
  await createBackup(state.target, state.backup);
  await fs.writeFile(projectPath, original.replace("Recovery Fixture", "Changed once"));
  const extraPath = path.join(state.target, ".ai-org/learning/after-backup.md");
  await fs.writeFile(extraPath, "preserve me\n");

  const stalePlan = await planRestore(state.target, state.backup);
  assert.ok(stalePlan.actions.some((entry) => entry.path === ".ai-org/project/project.json" && entry.action === "replace"));
  assert.ok(stalePlan.extras.includes(".ai-org/learning/after-backup.md"));
  await fs.writeFile(projectPath, original.replace("Recovery Fixture", "Changed twice"));
  await assert.rejects(
    () => applyRestore(state.target, state.backup, { expectedPlan: stalePlan.plan_digest, allowReplace: true }),
    /preview is stale/
  );

  const freshPlan = await planRestore(state.target, state.backup);
  await assert.rejects(
    () => applyRestore(state.target, state.backup, { expectedPlan: freshPlan.plan_digest }),
    /pass --allow-replace/
  );
  const result = await applyRestore(state.target, state.backup, {
    expectedPlan: freshPlan.plan_digest,
    allowReplace: true
  });
  assert.equal(result.status, "completed");
  assert.equal(await fs.readFile(projectPath, "utf8"), original);
  assert.equal(await fs.readFile(extraPath, "utf8"), "preserve me\n");
  assert.equal((await recoverRestore(state.target)).status, "clean");
});

test("an interrupted restore rolls back from its external ledger", async (context) => {
  const state = await fixture("restore-recovery");
  context.after(() => fs.rm(state.temporaryRoot, { recursive: true, force: true }));
  const agentsPath = path.join(state.target, ".ai-org/project/agents.json");
  await createBackup(state.target, state.backup);
  const changed = `${await fs.readFile(agentsPath, "utf8")}\n`;
  await fs.writeFile(agentsPath, changed);
  const preview = await planRestore(state.target, state.backup);

  await assert.rejects(
    () =>
      applyRestore(state.target, state.backup, {
        expectedPlan: preview.plan_digest,
        allowReplace: true,
        simulateCrashAfterWrites: 1
      }),
    /Simulated restore interruption/
  );
  assert.ok(await fs.stat(path.join(resolveRecoveryStateDirectory(state.target), "active.json")));
  const recovered = await recoverRestore(state.target);
  assert.equal(recovered.status, "rolled_back");
  assert.equal(await fs.readFile(agentsPath, "utf8"), changed);
});

test("an ordinary mid-write failure rolls back immediately", async (context) => {
  const state = await fixture("restore-immediate-rollback");
  context.after(() => fs.rm(state.temporaryRoot, { recursive: true, force: true }));
  const agentsPath = path.join(state.target, ".ai-org/project/agents.json");
  await createBackup(state.target, state.backup);
  const changed = `${await fs.readFile(agentsPath, "utf8")}\n`;
  await fs.writeFile(agentsPath, changed);
  const preview = await planRestore(state.target, state.backup);

  await assert.rejects(
    () =>
      applyRestore(state.target, state.backup, {
        expectedPlan: preview.plan_digest,
        allowReplace: true,
        simulateFailureAfterWrites: 1
      }),
    /Simulated ordinary restore failure/
  );
  assert.equal(await fs.readFile(agentsPath, "utf8"), changed);
  assert.equal((await recoverRestore(state.target)).status, "clean");
});

test("recovery finalizes a durably completed restore instead of rolling it back", async (context) => {
  const state = await fixture("restore-commit-boundary");
  context.after(() => fs.rm(state.temporaryRoot, { recursive: true, force: true }));
  const agentsPath = path.join(state.target, ".ai-org/project/agents.json");
  const backupContent = await fs.readFile(agentsPath, "utf8");
  await createBackup(state.target, state.backup);
  await fs.appendFile(agentsPath, "\n");
  const preview = await planRestore(state.target, state.backup);

  await assert.rejects(
    () =>
      applyRestore(state.target, state.backup, {
        expectedPlan: preview.plan_digest,
        allowReplace: true,
        simulateCrashAfterCommit: true
      }),
    /after commit/
  );
  assert.equal(await fs.readFile(agentsPath, "utf8"), backupContent);
  const recovered = await recoverRestore(state.target);
  assert.equal(recovered.status, "completed");
  assert.equal(await fs.readFile(agentsPath, "utf8"), backupContent);
});

test("recovery refuses to overwrite a human change made after interruption", async (context) => {
  const state = await fixture("restore-human-change");
  context.after(() => fs.rm(state.temporaryRoot, { recursive: true, force: true }));
  const agentsPath = path.join(state.target, ".ai-org/project/agents.json");
  await createBackup(state.target, state.backup);
  await fs.appendFile(agentsPath, "\n");
  const preview = await planRestore(state.target, state.backup);
  await assert.rejects(
    () =>
      applyRestore(state.target, state.backup, {
        expectedPlan: preview.plan_digest,
        allowReplace: true,
        simulateCrashAfterWrites: 1
      }),
    /Simulated restore interruption/
  );
  await fs.writeFile(agentsPath, "human edit after interruption\n");
  await assert.rejects(() => recoverRestore(state.target), /preserve newer changes/);
  assert.equal(await fs.readFile(agentsPath, "utf8"), "human edit after interruption\n");
});

test("restore refuses project identity mismatches and backups from newer Temple versions", async (context) => {
  const source = await fixture("source-project");
  const target = await fixture("target-project");
  context.after(() => Promise.all([
    fs.rm(source.temporaryRoot, { recursive: true, force: true }),
    fs.rm(target.temporaryRoot, { recursive: true, force: true })
  ]));
  await createBackup(source.target, source.backup);
  const mismatch = await planRestore(target.target, source.backup);
  assert.ok(mismatch.conflicts.some((entry) => entry.includes("does not match")));

  const manifestPath = path.join(source.backup, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.temple.version = "99.0.0";
  const backupLockPath = path.join(source.backup, "files/temple.lock");
  const backupLock = JSON.parse(await fs.readFile(backupLockPath, "utf8"));
  backupLock.template.version = "99.0.0";
  const backupLockContent = formatJson(backupLock);
  await fs.writeFile(backupLockPath, backupLockContent);
  const lockEntry = manifest.files.find((entry) => entry.path === "temple.lock");
  lockEntry.size = Buffer.byteLength(backupLockContent);
  lockEntry.sha256 = sha256(backupLockContent);
  manifest.content_digest = sha256(JSON.stringify(manifest.files));
  await fs.writeFile(manifestPath, formatJson(manifest));
  const newer = await planRestore(source.target, source.backup);
  assert.ok(newer.conflicts.some((entry) => entry.includes("newer than this CLI")));
});

test("same-version backup restores into a separately initialized checkout and generated views rebuild", async (context) => {
  const source = await fixture("clean-restore");
  const target = await fixture("clean-restore");
  context.after(() => Promise.all([
    fs.rm(source.temporaryRoot, { recursive: true, force: true }),
    fs.rm(target.temporaryRoot, { recursive: true, force: true })
  ]));
  const sourceArtifact = path.join(source.target, ".ai-org/artifacts/data-bearing.md");
  await fs.mkdir(path.dirname(sourceArtifact), { recursive: true });
  await fs.writeFile(sourceArtifact, "data-bearing fixture\n");
  await createBackup(source.target, source.backup);

  const preview = await planRestore(target.target, source.backup);
  assert.deepEqual(preview.conflicts, []);
  const restored = await applyRestore(target.target, source.backup, {
    expectedPlan: preview.plan_digest,
    allowReplace: true
  });
  assert.equal(restored.upgrade_required, false);
  const inspected = await inspectBackup(source.backup);
  for (const entry of inspected.manifest.files) {
    assert.equal(sha256(await fs.readFile(path.join(target.target, entry.path))), entry.sha256);
  }
  await writeStatus(target.target, await buildStatus(target.target));
  const doctor = await runDoctor(target.target);
  assert.equal(doctor.healthy, true, JSON.stringify(doctor.checks.filter((check) => check.status !== "pass"), null, 2));
});

test("an internally consistent older backup restores with an upgrade-required result", async (context) => {
  const state = await fixture("older-restore");
  context.after(() => fs.rm(state.temporaryRoot, { recursive: true, force: true }));
  await createBackup(state.target, state.backup);
  const olderVersion = "0.1.0-alpha.23";
  const backupLockPath = path.join(state.backup, "files/temple.lock");
  const targetLockPath = path.join(state.target, "temple.lock");
  const olderLock = JSON.parse(await fs.readFile(backupLockPath, "utf8"));
  olderLock.template.version = olderVersion;
  delete olderLock.template.bootstrap;
  const olderLockContent = formatJson(olderLock);
  await fs.writeFile(backupLockPath, olderLockContent);
  await fs.writeFile(targetLockPath, olderLockContent);

  const manifestPath = path.join(state.backup, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.temple.version = olderVersion;
  const lockEntry = manifest.files.find((entry) => entry.path === "temple.lock");
  lockEntry.size = Buffer.byteLength(olderLockContent);
  lockEntry.sha256 = sha256(olderLockContent);
  manifest.content_digest = sha256(JSON.stringify(manifest.files));
  await fs.writeFile(manifestPath, formatJson(manifest));
  await fs.appendFile(path.join(state.target, ".ai-org/project/agents.json"), "\n");

  const preview = await planRestore(state.target, state.backup);
  assert.deepEqual(preview.conflicts, []);
  assert.equal(preview.compatibility.upgrade_required, true);
  const restored = await applyRestore(state.target, state.backup, {
    expectedPlan: preview.plan_digest,
    allowReplace: true
  });
  assert.equal(restored.upgrade_required, true);

  const preUpgradeDoctor = await runDoctor(state.target);
  assert.equal(preUpgradeDoctor.healthy, false);
  const preUpgradeBootstrap = preUpgradeDoctor.checks.find((check) => check.id === "cli_bootstrap");
  assert.equal(preUpgradeBootstrap?.status, "fail");
  assert.match(preUpgradeBootstrap?.message ?? "", /bootstrap metadata must be an object/);

  const upgrade = await planUpgrade(state.target);
  assert.deepEqual(upgrade.conflicts, []);
  const upgradedLock = await executeUpgrade(upgrade);
  assert.equal(upgradedLock.template.version, TEMPLATE_VERSION);
  assert.equal(upgradedLock.template.bootstrap.schema_version, "temple.cli-bootstrap/v1");
  assert.equal(upgradedLock.template.bootstrap.version, TEMPLATE_VERSION);
  const upgradedDoctor = await runDoctor(state.target);
  assert.equal(
    upgradedDoctor.healthy,
    true,
    JSON.stringify(upgradedDoctor.checks.filter((check) => check.status !== "pass"), null, 2)
  );
  assert.equal(upgradedDoctor.checks.find((check) => check.id === "cli_bootstrap")?.status, "pass");
});

test("post-upgrade rollback and interruption rehearsals touch only disposable project copies", async (context) => {
  const state = await fixture("disposable-rehearsal");
  context.after(() => fs.rm(state.temporaryRoot, { recursive: true, force: true }));
  const primaryArtifact = path.join(state.target, ".ai-org/artifacts/data-bearing.md");
  await fs.mkdir(path.dirname(primaryArtifact), { recursive: true });
  await fs.writeFile(primaryArtifact, "primary project remains untouched\n");
  const primaryLock = await fs.readFile(path.join(state.target, "temple.lock"), "utf8");
  const primaryArtifactContent = await fs.readFile(primaryArtifact, "utf8");

  const olderVersion = "0.1.0-alpha.23";
  const preUpgradeCopy = path.join(state.temporaryRoot, "pre-upgrade-copy");
  const upgradedCopy = path.join(state.temporaryRoot, "upgraded-copy");
  const rollbackCopy = path.join(state.temporaryRoot, "rollback-copy");
  const interruptedCopy = path.join(state.temporaryRoot, "interrupted-copy");
  await Promise.all([
    fs.cp(state.target, preUpgradeCopy, { recursive: true }),
    fs.cp(state.target, upgradedCopy, { recursive: true }),
    fs.cp(state.target, rollbackCopy, { recursive: true }),
    fs.cp(state.target, interruptedCopy, { recursive: true })
  ]);
  await Promise.all([
    setInstalledVersion(preUpgradeCopy, olderVersion),
    setInstalledVersion(upgradedCopy, olderVersion),
    setInstalledVersion(rollbackCopy, olderVersion),
    setInstalledVersion(interruptedCopy, olderVersion)
  ]);

  const preUpgradeBackup = path.join(state.temporaryRoot, "pre-upgrade-backup");
  await createBackup(preUpgradeCopy, preUpgradeBackup);
  const upgrade = await planUpgrade(upgradedCopy);
  assert.deepEqual(upgrade.conflicts, []);
  assert.equal((await executeUpgrade(upgrade)).template.version, TEMPLATE_VERSION);

  await fs.writeFile(path.join(rollbackCopy, ".ai-org/artifacts/data-bearing.md"), "changed after upgrade\n");
  const rollbackPreview = await planRestore(rollbackCopy, preUpgradeBackup);
  assert.deepEqual(rollbackPreview.conflicts, []);
  await applyRestore(rollbackCopy, preUpgradeBackup, {
    expectedPlan: rollbackPreview.plan_digest,
    allowReplace: true
  });
  assert.equal(
    await fs.readFile(path.join(rollbackCopy, ".ai-org/artifacts/data-bearing.md"), "utf8"),
    primaryArtifactContent
  );

  const interruptedPath = path.join(interruptedCopy, ".ai-org/project/agents.json");
  const interruptedBefore = `${await fs.readFile(interruptedPath, "utf8")}\n`;
  await fs.writeFile(interruptedPath, interruptedBefore);
  const interruptionPreview = await planRestore(interruptedCopy, preUpgradeBackup);
  await assert.rejects(
    () => applyRestore(interruptedCopy, preUpgradeBackup, {
      expectedPlan: interruptionPreview.plan_digest,
      allowReplace: true,
      simulateCrashAfterWrites: 1
    }),
    /Simulated restore interruption/
  );
  assert.equal((await recoverRestore(interruptedCopy)).status, "rolled_back");
  assert.equal(await fs.readFile(interruptedPath, "utf8"), interruptedBefore);

  assert.equal(await fs.readFile(path.join(state.target, "temple.lock"), "utf8"), primaryLock);
  assert.equal(await fs.readFile(primaryArtifact, "utf8"), primaryArtifactContent);
});
