import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repositoryRoot, "bin/temple.mjs");
const OBSERVED_AT = "2026-08-30T00:00:00.000Z";

function configDocument(projectId, projectName) {
  return {
    schema_version: "temple.init/v1",
    project: { id: projectId, name: projectName },
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

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

function git(target, args) {
  const result = spawnSync("git", ["-C", target, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_DATE: OBSERVED_AT, GIT_COMMITTER_DATE: OBSERVED_AT }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

async function initializedProject(temporaryRoot, projectId, projectName) {
  const target = path.join(temporaryRoot, projectId);
  const configPath = path.join(temporaryRoot, `${projectId}-init.json`);
  await fs.writeFile(configPath, `${JSON.stringify(configDocument(projectId, projectName), null, 2)}\n`);
  const result = run(["init", target, "--config", configPath]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return target;
}

async function fixture(context, projectId = "phase4-cli") {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-phase4-cli-test-"));
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const target = await initializedProject(temporaryRoot, projectId, "Phase 4 CLI");
  return { temporaryRoot, target };
}

async function setBackupTime(backup, createdAt) {
  const manifestPath = path.join(backup, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.created_at = createdAt;
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function contentDigest(target) {
  const hash = crypto.createHash("sha256");
  async function visit(current, relative = "") {
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const absolute = path.join(current, entry.name);
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const stat = await fs.lstat(absolute);
      hash.update(`${entry.isDirectory() ? "d" : entry.isSymbolicLink() ? "l" : "f"}:${childRelative}:${stat.mode}\0`);
      if (entry.isDirectory()) await visit(absolute, childRelative);
      else if (entry.isSymbolicLink()) hash.update(await fs.readlink(absolute));
      else hash.update(await fs.readFile(absolute));
    }
  }
  await visit(target);
  return hash.digest("hex");
}

test("backup-set CLI requires consent and a fresh digest while preserving repeated names", async (context) => {
  const { temporaryRoot, target } = await fixture(context, "retention-cli");
  const backupRoot = path.join(temporaryRoot, "backup-set");
  await fs.mkdir(backupRoot);
  for (const [index, name] of ["backup-a", "backup-b", "backup-c"].entries()) {
    const backup = path.join(backupRoot, name);
    const created = run(["backup", "create", target, "--output", backup, "--json"]);
    assert.equal(created.status, 0, created.stderr || created.stdout);
    await setBackupTime(backup, `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`);
  }

  const inspected = run(["backup", "set-inspect", target, "--root", backupRoot, "--json"]);
  assert.equal(inspected.status, 0, inspected.stderr || inspected.stdout);
  assert.equal(JSON.parse(inspected.stdout).backup_count, 3);

  const previewArgs = [
    "backup", "retention-preview", target,
    "--root", backupRoot,
    "--minimum-to-keep", "1",
    "--preserve", "backup-a",
    "--preserve", "backup-b",
    "--json"
  ];
  const preview = run(previewArgs);
  assert.equal(preview.status, 0, preview.stderr || preview.stdout);
  const plan = JSON.parse(preview.stdout);
  assert.deepEqual(plan.preserve_backup_names, ["backup-a", "backup-b"]);
  assert.equal(plan.delete_count, 0);

  const missingConsent = run([
    "backup", "retention-apply", target,
    "--root", backupRoot,
    "--minimum-to-keep", "1",
    "--preserve", "backup-a",
    "--preserve", "backup-b",
    "--expected-plan", plan.plan_digest,
    "--json"
  ]);
  assert.equal(missingConsent.status, 1);
  assert.match(missingConsent.stderr, /requires --confirm-delete/);

  const addedBackup = path.join(backupRoot, "backup-d");
  const created = run(["backup", "create", target, "--output", addedBackup, "--json"]);
  assert.equal(created.status, 0, created.stderr || created.stdout);
  await setBackupTime(addedBackup, "2026-08-04T00:00:00.000Z");
  const stale = run([
    "backup", "retention-apply", target,
    "--root", backupRoot,
    "--minimum-to-keep", "1",
    "--preserve", "backup-a",
    "--preserve", "backup-b",
    "--expected-plan", plan.plan_digest,
    "--confirm-delete",
    "--json"
  ]);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /preview is stale/);

  const freshPreview = run(previewArgs);
  assert.equal(freshPreview.status, 0, freshPreview.stderr || freshPreview.stdout);
  const freshPlan = JSON.parse(freshPreview.stdout);
  assert.equal(freshPlan.delete_count, 1);
  const applied = run([
    "backup", "retention-apply", target,
    "--root", backupRoot,
    "--minimum-to-keep", "1",
    "--preserve", "backup-a",
    "--preserve", "backup-b",
    "--expected-plan", freshPlan.plan_digest,
    "--confirm-delete",
    "--json"
  ]);
  assert.equal(applied.status, 0, applied.stderr || applied.stdout);
  assert.deepEqual(JSON.parse(applied.stdout).deleted, ["backup-c"]);

  const unbounded = run([
    "backup", "retention-preview", target,
    "--root", backupRoot,
    "--minimum-to-keep", "10001"
  ]);
  assert.equal(unbounded.status, 1);
  assert.match(unbounded.stderr, /integer from 1 to 10000/);
});

test("audit export CLI parses repeatable filters and refuses an existing output", async (context) => {
  const { temporaryRoot, target } = await fixture(context, "audit-cli");
  const eventPath = path.join(target, ".ai-org/events/events.jsonl");
  await fs.appendFile(eventPath, `${JSON.stringify({
    timestamp: "2026-08-30T00:00:00.000Z",
    event_type: "evidence_recorded",
    actor: "human",
    work_item_id: "WI-0001",
    result: "pass",
    refs: [".ai-org/project/evidence.json"]
  })}\n`);
  const auditPath = path.join(temporaryRoot, "audit.json");
  const exported = run([
    "audit", "export", target,
    "--output", auditPath,
    "--event-type", "work_item_created",
    "--event-type", "evidence_recorded",
    "--redact-key", "actor",
    "--redact-key", "work_item_id",
    "--max-events", "5",
    "--max-recovery-transactions", "2",
    "--max-event-bytes", "8192",
    "--json"
  ]);
  assert.equal(exported.status, 0, exported.stderr || exported.stdout);
  const result = JSON.parse(exported.stdout);
  const document = JSON.parse(await fs.readFile(auditPath, "utf8"));
  assert.equal(result.output, auditPath);
  assert.deepEqual(document.selection.event_types, ["evidence_recorded", "work_item_created"]);
  assert.equal(document.selection.max_events, 5);
  assert.equal(document.selection.max_recovery_transactions, 2);
  assert.ok(document.events.every((event) => event.actor === "[REDACTED]" && event.work_item_id === "[REDACTED]"));

  const overwrite = run(["audit", "export", target, "--output", auditPath, "--json"]);
  assert.equal(overwrite.status, 1);
  assert.match(overwrite.stderr, /EEXIST/);
  const unbounded = run(["audit", "export", target, "--output", path.join(temporaryRoot, "other.json"), "--max-events", "10001"]);
  assert.equal(unbounded.status, 1);
  assert.match(unbounded.stderr, /integer from 1 to 10000/);
});

test("federation and portfolio CLI remain coordinator-owned and participant-read-only", async (context) => {
  const { temporaryRoot, target: coordinator } = await fixture(context, "coordinator");
  const participant = await initializedProject(temporaryRoot, "participant", "Participant Project");
  git(participant, ["init", "-q"]);
  git(participant, ["config", "user.email", "phase4-cli@example.invalid"]);
  git(participant, ["config", "user.name", "Phase 4 CLI"]);
  git(participant, ["add", "."]);
  git(participant, ["commit", "-qm", "participant fixture"]);
  const revision = git(participant, ["rev-parse", "HEAD"]);
  const registryPath = path.join(coordinator, ".ai-org/project/federation.json");
  const registry = {
    schema_version: "temple.federation/v1",
    participants: [{
      id: "participant",
      path: "../participant",
      expected_project_id: "participant",
      expected_revision: revision,
      expected_revision_observed_at: new Date().toISOString()
    }],
    initiatives: [],
    dependencies: [],
    contracts: [],
    rollout_waves: [],
    updated_at: new Date().toISOString()
  };
  await fs.writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);

  const validated = run(["federation", "validate", coordinator, "--json"]);
  assert.equal(validated.status, 0, validated.stderr || validated.stdout);
  assert.deepEqual(JSON.parse(validated.stdout), { valid: true, errors: [] });

  const participantBefore = await contentDigest(participant);
  const portfolioPath = path.join(coordinator, ".ai-org/views/portfolio.json");
  const preview = run(["portfolio", "build", coordinator, "--allowed-root", temporaryRoot, "--no-write", "--json"]);
  assert.equal(preview.status, 0, preview.stderr || preview.stdout);
  assert.equal(JSON.parse(preview.stdout).summary.current, 1);
  await assert.rejects(() => fs.access(portfolioPath), /ENOENT/);
  assert.equal(await contentDigest(participant), participantBefore);

  const written = run(["portfolio", "build", coordinator, "--allowed-root", temporaryRoot]);
  assert.equal(written.status, 0, written.stderr || written.stdout);
  assert.match(written.stdout, /\.ai-org\/views\/portfolio\.json/);
  const portfolio = JSON.parse(await fs.readFile(portfolioPath, "utf8"));
  assert.equal(portfolio.participants[0].project.name, "Participant Project");
  assert.equal(await contentDigest(participant), participantBefore);
  await assert.rejects(() => fs.access(path.join(participant, ".ai-org/views/portfolio.json")), /ENOENT/);

  const validSchemas = run(["schema", "validate", coordinator, "--json"]);
  assert.equal(validSchemas.status, 0, validSchemas.stderr || validSchemas.stdout);
  assert.ok(
    JSON.parse(validSchemas.stdout).checked.some(
      (entry) => entry.document === ".ai-org/views/portfolio.json" && entry.valid
    )
  );

  portfolio.authority.lifecycle_mutations_performed = true;
  await fs.writeFile(portfolioPath, `${JSON.stringify(portfolio, null, 2)}\n`);
  const invalidPortfolio = run(["schema", "validate", coordinator, "--json"]);
  assert.equal(invalidPortfolio.status, 1);
  assert.ok(
    JSON.parse(invalidPortfolio.stdout).errors.some(
      (entry) =>
        entry.document === ".ai-org/views/portfolio.json" &&
        entry.instance_path === "/authority/lifecycle_mutations_performed"
    )
  );

  await fs.writeFile(registryPath, `${JSON.stringify({ ...registry, credentials: { token: "secret" } }, null, 2)}\n`);
  const invalid = run(["federation", "validate", coordinator, "--json"]);
  assert.equal(invalid.status, 1);
  assert.equal(JSON.parse(invalid.stdout).valid, false);
});
