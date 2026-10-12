import assert from "node:assert/strict";
import { TEMPLATE_VERSION } from "../src/constants.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin/temple.mjs");

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

async function fixture(context) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-phase2c-test-"));
  const target = path.join(temporaryRoot, "extension-product");
  const configPath = path.join(temporaryRoot, "init.json");
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  await fs.writeFile(configPath, `${JSON.stringify({
    schema_version: "temple.init/v1",
    project: { id: "extension-product", name: "Extension Product" },
    naming_mode: "manual",
    agents: [
      { display_name: "Fixture Rowan", positions: ["engineering_manager", "release_manager", "observer"] },
      { display_name: "Fixture Linden", positions: ["product_manager", "ux_designer", "ui_designer"] },
      { display_name: "Fixture Ellis", positions: ["tech_lead"] },
      { display_name: "Fixture Devon", positions: ["developer"] },
      { display_name: "Fixture Hollis", positions: ["quality_evaluator", "independent_qa"] }
    ]
  }, null, 2)}\n`);
  const initialized = run(["init", target, "--config", configPath]);
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
  return { target };
}

test("Pack v2 installs references, scripts, and assets with provenance and compatibility", async (context) => {
  const { target } = await fixture(context);
  const manifest = JSON.parse(await fs.readFile(path.join(root, "packs/build-quality/manifest.json"), "utf8"));
  assert.equal(manifest.schema_version, "temple.pack/v2");
  assert.ok(manifest.references.length > 0);
  assert.ok(manifest.scripts.length > 0);
  assert.ok(manifest.assets.length > 0);
  assert.equal(manifest.provenance.license, "MIT");
  assert.equal(manifest.compatibility.temple.min, "0.1.0-alpha.19");
  assert.deepEqual(manifest.dependencies.packs, []);

  const dryRun = run(["pack", "install", target, "--pack", "build-quality", "--dry-run"]);
  assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
  assert.match(dryRun.stdout, /copy-pack-file: 5/);
  const installed = run(["pack", "install", target, "--pack", "build-quality"]);
  assert.equal(installed.status, 0, installed.stderr || installed.stdout);
  for (const relativePath of [...manifest.references, ...manifest.scripts, ...manifest.assets]) {
    await fs.access(path.join(target, relativePath));
  }
  const lock = JSON.parse(await fs.readFile(path.join(target, "temple.lock"), "utf8"));
  const pack = lock.optional_packs.find((entry) => entry.id === "build-quality");
  assert.equal(pack.manifest_schema, "temple.pack/v2");
  assert.deepEqual(pack.provenance, manifest.provenance);
  assert.deepEqual(pack.compatibility, manifest.compatibility);
  assert.deepEqual(pack.dependencies, manifest.dependencies);

  const script = path.join(target, manifest.scripts[0]);
  const example = path.join(target, manifest.assets[0]);
  const validated = spawnSync(process.execPath, [script, example], { encoding: "utf8" });
  assert.equal(validated.status, 0, validated.stderr || validated.stdout);
  assert.match(validated.stdout, /valid test observation/);
});

test("runtime JSON Schema validation reports exact document and instance paths", async (context) => {
  const { target } = await fixture(context);
  const valid = run(["schema", "validate", target, "--json"]);
  assert.equal(valid.status, 0, valid.stderr || valid.stdout);
  const report = JSON.parse(valid.stdout);
  assert.equal(report.schema_version, "temple.schema-validation/v1");
  assert.equal(report.valid, true);
  assert.ok(report.documents_checked >= 10);

  const evidencePath = path.join(target, ".ai-org/project/evidence.json");
  const evidence = JSON.parse(await fs.readFile(evidencePath, "utf8"));
  evidence.unexpected = true;
  await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  const invalid = run(["schema", "validate", target, "--json"]);
  assert.equal(invalid.status, 1, invalid.stderr || invalid.stdout);
  const invalidReport = JSON.parse(invalid.stdout);
  assert.equal(invalidReport.valid, false);
  assert.ok(invalidReport.errors.some((entry) => entry.document === ".ai-org/project/evidence.json" && entry.instance_path === ""));
});

test("runtime schema validates the complete High-Assurance policy contract", async (context) => {
  const { target } = await fixture(context);
  const policyPath = path.join(target, ".ai-org/core/high-assurance.json");
  const policy = JSON.parse(await fs.readFile(policyPath, "utf8"));
  delete policy.human_accountability.minimum_active_principals;
  await fs.writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`);

  const invalid = run(["schema", "validate", target, "--json"]);
  assert.equal(invalid.status, 1, invalid.stderr || invalid.stdout);
  const report = JSON.parse(invalid.stdout);
  assert.ok(report.errors.some((entry) => entry.document === ".ai-org/core/high-assurance.json" && entry.instance_path === "/human_accountability"));
});

test("migration registry distinguishes fresh baselines from pending upgrade migrations", async (context) => {
  const { target } = await fixture(context);
  const current = run(["migration", "plan", target, "--json"]);
  assert.equal(current.status, 0, current.stderr || current.stdout);
  assert.deepEqual(JSON.parse(current.stdout).pending, []);

  const lockPath = path.join(target, "temple.lock");
  const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  lock.template.version = "0.1.0-alpha.18";
  lock.migrations.applied = lock.migrations.applied.filter((entry) => entry.id !== "MIG-0019-PHASE2C");
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  const pending = run(["migration", "plan", target, "--json"]);
  assert.equal(pending.status, 0, pending.stderr || pending.stdout);
  assert.deepEqual(JSON.parse(pending.stdout).pending.map((entry) => entry.id), ["MIG-0019-PHASE2C"]);

  const upgraded = run(["upgrade", target]);
  assert.equal(upgraded.status, 0, upgraded.stderr || upgraded.stdout);
  const upgradedLock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  assert.equal(upgradedLock.template.version, TEMPLATE_VERSION);
  assert.ok(upgradedLock.migrations.applied.some((entry) => entry.id === "MIG-0019-PHASE2C"));
});

test("retrieval inspection remains read-only when a legacy project has no config yet", async (context) => {
  const { target } = await fixture(context);
  const configPath = path.join(target, ".ai-org/project/retrieval.json");
  await fs.rm(configPath);

  const shown = run(["retrieval", "show", target, "--json"]);
  assert.equal(shown.status, 0, shown.stderr || shown.stdout);
  assert.equal(JSON.parse(shown.stdout).selected_provider, "repository-deterministic");
  await assert.rejects(fs.access(configPath));

  const status = run(["status", target, "--json", "--no-write"]);
  assert.equal(status.status, 0, status.stderr || status.stdout);
  assert.equal(JSON.parse(status.stdout).context_routing.provider_id, "repository-deterministic");
  await assert.rejects(fs.access(configPath));
});
