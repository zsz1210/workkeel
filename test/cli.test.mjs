import assert from "node:assert/strict";
import { TEMPLATE_VERSION } from "../src/constants.mjs";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { formatJson, sha256 } from "../src/files.mjs";
import { executeInit, planInit } from "../src/install.mjs";
import { validateInitConfig } from "../src/model.mjs";
import { ensureTaskRegistry } from "../src/project.mjs";
import { createShutdownSignalLatch } from "../src/cli.mjs";
import {
  defaultRepositoryIntegration,
  REPOSITORY_INTEGRATION_RELATIVE_PATH
} from "../src/repository-integration.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin/temple.mjs");

function configDocument(projectId = "sample-product", projectName = "Sample Product") {
  return {
    schema_version: "temple.init/v1",
    project: { id: projectId, name: projectName },
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

async function fixture() {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-test-"));
  const target = path.join(temporaryRoot, "sample-product");
  const configPath = path.join(temporaryRoot, "init.json");
  await fs.writeFile(configPath, `${JSON.stringify(configDocument(), null, 2)}\n`);
  return { temporaryRoot, target, configPath };
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

function runCli(cliPath, args) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8" });
}

async function selfHostFixture() {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-self-host-test-"));
  const toolkit = path.join(temporaryRoot, "toolkit");
  await fs.mkdir(toolkit, { recursive: true });
  for (const directory of ["bin", "src", "project-overlay", "packs"]) {
    await fs.cp(path.join(root, directory), path.join(toolkit, directory), { recursive: true });
  }
  await fs.cp(path.join(root, "package.json"), path.join(toolkit, "package.json"));
  // This fixture exercises legacy self-host initialization, independently of
  // the source checkout's native Workkeel operating contract.
  await fs.cp(path.join(root, "project-overlay/AGENTS.md"), path.join(toolkit, "AGENTS.md"));
  await fs.mkdir(path.join(toolkit, ".agents/skills"), { recursive: true });
  await fs.cp(
    path.join(root, ".agents/skills/temple-init"),
    path.join(toolkit, ".agents/skills/temple-init"),
    { recursive: true }
  );
  await fs.symlink(
    path.join(root, "node_modules"),
    path.join(toolkit, "node_modules"),
    process.platform === "win32" ? "junction" : "dir"
  );
  const configPath = path.join(temporaryRoot, "self-host-init.json");
  await fs.writeFile(configPath, `${JSON.stringify(configDocument("temple", "Temple"), null, 2)}\n`);
  return { temporaryRoot, toolkit, configPath, cli: path.join(toolkit, "bin/temple.mjs") };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

test("compact Doctor preserves every warning, failure and exit status while running full validation", async (context) => {
  const { temporaryRoot, target, configPath } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  assert.equal(run(["init", target, "--config", configPath]).status, 0);
  function compare() {
    const full = run(["doctor", target, "--json"]);
    const compact = run(["doctor", target, "--compact", "--json"]);
    const original = JSON.parse(full.stdout);
    const reduced = JSON.parse(compact.stdout);
    assert.equal(compact.status, full.status);
    assert.equal(reduced.schema_version, "temple.doctor-summary/v1");
    assert.equal(reduced.validation_scope, "full");
    assert.equal(reduced.healthy, original.healthy);
    assert.deepEqual(reduced.summary, original.summary);
    assert.deepEqual(reduced.checks, original.checks.filter((check) => check.status !== "pass"));
    assert.equal(reduced.omitted_passing_checks, original.summary.pass);
    const text = run(["doctor", target, "--compact"]);
    assert.equal(text.status, full.status);
    for (const check of reduced.checks) assert.ok(text.stdout.includes(check.message));
    assert.ok(!text.stdout.includes("[PASS]"));
    return reduced;
  }
  const warning = compare();
  assert.ok(warning.summary.warn > 0);
  assert.equal(warning.summary.fail, 0);
  const integrationPath = path.join(target, REPOSITORY_INTEGRATION_RELATIVE_PATH);
  const integration = JSON.parse(await fs.readFile(integrationPath, "utf8"));
  await fs.writeFile(integrationPath, formatJson({ ...integration, status: "confirmed", source: "user-confirmed", summary: "Fixture integration", integration_target: "main", change_isolation: "required", review_gate: "required" }));
  assert.equal(compare().summary.warn, 0);
  await fs.appendFile(path.join(target, ".agents/skills/temple-work/SKILL.md"), "\nUnexpected managed drift.\n");
  assert.ok(compare().summary.fail > 0);
  const missing = run(["doctor", path.join(temporaryRoot, "missing"), "--compact", "--json"]);
  assert.equal(missing.status, 1);
  assert.equal(JSON.parse(missing.stdout).healthy, false);
  assert.ok(JSON.parse(missing.stdout).checks.some((check) => check.status === "fail"));
});

test("compact Status preserves global attention and full selected row without changing view writes", async (context) => {
  const { temporaryRoot, target, configPath } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  assert.equal(run(["init", target, "--config", configPath]).status, 0);
  for (const title of ["Selected stage", "Other work"]) {
    const created = run(["work-item", "create", target, "--title", title]);
    assert.equal(created.status, 0, created.stderr);
  }
  const views = ["status.md", "capabilities.json"].map((name) => path.join(target, ".ai-org/views", name));
  const before = await Promise.all(views.map((file) => fs.readFile(file, "utf8")));
  const full = JSON.parse(run(["status", target, "--json", "--no-write"]).stdout);
  const selected = run(["status", target, "--compact", "--json", "--no-write", "--work-item", "WI-0001"]);
  assert.equal(selected.status, 0, selected.stderr);
  const reduced = JSON.parse(selected.stdout);
  assert.equal(reduced.schema_version, "temple.status-summary/v1");
  assert.equal(reduced.authority, "observation-only");
  assert.deepEqual(reduced.attention, full.attention);
  assert.ok(reduced.attention.length > 0);
  assert.deepEqual(reduced.selected_work_item, full.work_items.items.find((item) => item.id === "WI-0001"));
  assert.equal(reduced.work_items.total, 2);
  assert.deepEqual(reduced.work_items.by_state, full.work_items.by_state);
  assert.equal(reduced.work_items.items, undefined);
  const global = JSON.parse(run(["status", target, "--compact", "--json", "--no-write"]).stdout);
  assert.equal(global.selected_work_item, null);
  assert.deepEqual(global.attention, full.attention);
  assert.deepEqual(await Promise.all(views.map((file) => fs.readFile(file, "utf8"))), before);
  for (const options of [["--compact"], ["--work-item", "WI-0001"], ["--compact", "--json", "--work-item", "WI-9999"]]) {
    assert.equal(run(["status", target, ...options]).status, 1);
    assert.deepEqual(await Promise.all(views.map((file) => fs.readFile(file, "utf8"))), before);
  }
  await fs.writeFile(views[0], "Stale generated view\n");
  assert.equal(run(["status", target, "--compact", "--json", "--work-item", "WI-0001"]).status, 0);
  const written = await fs.readFile(views[0], "utf8");
  assert.ok(written.includes("Selected stage") && written.includes("Other work"));
  assert.match(written, /Independent QA/);
  assert.equal(JSON.parse(run(["status", target, "--json", "--no-write"]).stdout).schema_version, "temple.status/v9");
});

test("version is available without dependencies", () => {
  const result = run(["--version"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), TEMPLATE_VERSION);
});

test("close help names every Standard release-gate evidence key", () => {
  const result = run(["--help"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(
    result.stdout,
    /temple close .*--satisfy accepted_scope=ref --satisfy test_evidence=ref --satisfy evaluation_report=ref --satisfy independent_qa_report=ref/
  );
});

test("package-visible init example is valid and non-interactive failure points to it", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-init-example-"));
  const target = path.join(temporaryRoot, "sample-product");
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));

  const examplePath = path.join(root, "docs/getting-started/temple-init.example.json");
  const example = JSON.parse(await fs.readFile(examplePath, "utf8"));
  const validated = await validateInitConfig(example);
  assert.equal(validated.repository_integration.status, "unconfirmed");
  assert.equal(validated.repository_integration.source, "not-inspected");

  const dryRun = run(["init", target, "--config", examplePath, "--dry-run", "--json"]);
  assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
  assert.equal(JSON.parse(dryRun.stdout).plan.repository_integration, "unconfirmed");

  const missingConfig = run(["init", target]);
  assert.equal(missingConfig.status, 1, missingConfig.stdout);
  assert.match(missingConfig.stderr, /docs\/getting-started\/temple-init\.example\.json/);
  assert.match(missingConfig.stderr, /repository_integration is optional and defaults to unconfirmed/);
});

test("shutdown signal latch stays active through cleanup and accepts only the first signal", async () => {
  const signals = new EventEmitter();
  const shutdown = createShutdownSignalLatch(signals);

  assert.equal(signals.listenerCount("SIGINT"), 1);
  assert.equal(signals.listenerCount("SIGTERM"), 1);

  signals.emit("SIGINT");
  assert.deepEqual(await shutdown.wait, { signal: "SIGINT" });

  signals.emit("SIGTERM");
  signals.emit("SIGINT");
  assert.deepEqual(await shutdown.wait, { signal: "SIGINT" });
  assert.equal(signals.listenerCount("SIGINT"), 1);
  assert.equal(signals.listenerCount("SIGTERM"), 1);

  shutdown.dispose();
  shutdown.dispose();
  assert.equal(signals.listenerCount("SIGINT"), 0);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
});

test("backup and restore CLI require an inspected plan before replacement", async (context) => {
  const { temporaryRoot, target, configPath } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const backup = path.join(temporaryRoot, "project-backup");
  const initialized = run(["init", target, "--config", configPath]);
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);

  const created = run(["backup", "create", target, "--output", backup, "--json"]);
  assert.equal(created.status, 0, created.stderr || created.stdout);
  assert.equal(JSON.parse(created.stdout).valid, undefined);
  const inspected = run(["backup", "inspect", target, "--backup", backup, "--json"]);
  assert.equal(inspected.status, 0, inspected.stderr || inspected.stdout);
  assert.equal(JSON.parse(inspected.stdout).valid, true);

  const projectPath = path.join(target, ".ai-org/project/project.json");
  const original = await fs.readFile(projectPath, "utf8");
  await fs.writeFile(projectPath, original.replace("Sample Product", "Changed Product"));
  const preview = run(["restore", "preview", target, "--backup", backup, "--json"]);
  assert.equal(preview.status, 0, preview.stderr || preview.stdout);
  const plan = JSON.parse(preview.stdout);
  assert.equal(plan.canonical_state_changed, false);
  assert.ok(plan.actions.some((entry) => entry.action === "replace"));

  const withoutConsent = run([
    "restore",
    "apply",
    target,
    "--backup",
    backup,
    "--expected-plan",
    plan.plan_digest,
    "--json"
  ]);
  assert.equal(withoutConsent.status, 1, withoutConsent.stderr || withoutConsent.stdout);
  assert.match(withoutConsent.stderr, /--allow-replace/);

  const restored = run([
    "restore",
    "apply",
    target,
    "--backup",
    backup,
    "--expected-plan",
    plan.plan_digest,
    "--allow-replace",
    "--json"
  ]);
  assert.equal(restored.status, 0, restored.stderr || restored.stdout);
  assert.equal(JSON.parse(restored.stdout).status, "completed");
  assert.equal(await fs.readFile(projectPath, "utf8"), original);
});

test("dry-run writes nothing", async (context) => {
  const { temporaryRoot, target, configPath } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const result = run(["init", target, "--config", configPath, "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /TEMPLE_BOOTSTRAP_REQUIRED/);
  const jsonResult = run(["init", target, "--config", configPath, "--dry-run", "--json"]);
  assert.equal(jsonResult.status, 0, jsonResult.stderr || jsonResult.stdout);
  assert.deepEqual(
    {
      schema_version: JSON.parse(jsonResult.stdout).schema_version,
      status: JSON.parse(jsonResult.stdout).status,
      files_written: JSON.parse(jsonResult.stdout).files_written,
      bootstrap: JSON.parse(jsonResult.stdout).bootstrap
    },
    {
      schema_version: "temple.init-result/v1",
      status: "planned",
      files_written: false,
      bootstrap: null
    }
  );
  await assert.rejects(() => fs.access(path.join(target, "temple.lock")));
});

test("init writes a confirmed project-owned repository integration record", async (context) => {
  const { temporaryRoot, target, configPath } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const config = configDocument();
  config.repository_integration = {
    schema_version: "temple.repository-integration/v1",
    status: "confirmed",
    authority: "project",
    source: "repository-policy",
    policy_refs: ["CONTRIBUTING.md"],
    summary: "Use isolated changes and review before integration.",
    integration_target: "main",
    change_isolation: "required",
    review_gate: "required",
    recorded_at: "2026-09-02T00:00:00.000Z",
    recorded_by: "human"
  };
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const initialized = run(["init", target, "--config", configPath]);
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
  assert.match(initialized.stdout, /Repository integration: confirmed/);
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(target, REPOSITORY_INTEGRATION_RELATIVE_PATH), "utf8")),
    config.repository_integration
  );
  const doctor = JSON.parse(run(["doctor", target, "--json"]).stdout);
  assert.equal(doctor.checks.find((check) => check.id === "repository_integration").status, "pass");
});

test("toolkit self-host init requires explicit scope and adopts only the identical bootstrap Skill", async (context) => {
  const fixture = await selfHostFixture();
  context.after(() => fs.rm(fixture.temporaryRoot, { recursive: true, force: true }));

  const ordinaryInit = runCli(fixture.cli, ["init", fixture.toolkit, "--config", fixture.configPath, "--dry-run"]);
  assert.equal(ordinaryInit.status, 1, ordinaryInit.stderr || ordinaryInit.stdout);
  assert.match(ordinaryInit.stdout, /requires explicit --self-host initialization/);

  const unrelatedTarget = path.join(fixture.temporaryRoot, "ordinary-project");
  const misplacedSelfHost = runCli(fixture.cli, [
    "init",
    unrelatedTarget,
    "--config",
    fixture.configPath,
    "--self-host",
    "--dry-run"
  ]);
  assert.equal(misplacedSelfHost.status, 1, misplacedSelfHost.stderr || misplacedSelfHost.stdout);
  assert.match(misplacedSelfHost.stdout, /allowed only for the Temple toolkit repository itself/);
  await assert.rejects(() => fs.access(path.join(unrelatedTarget, "temple.lock")));

  const dryRun = runCli(fixture.cli, [
    "init",
    fixture.toolkit,
    "--config",
    fixture.configPath,
    "--self-host",
    "--integrate-agents",
    "--dry-run"
  ]);
  assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
  assert.match(dryRun.stdout, /adopt-identical: 1/);
  assert.match(dryRun.stdout, /Installation mode: toolkit-self-host/);
  await assert.rejects(() => fs.access(path.join(fixture.toolkit, "temple.lock")));

  const initialized = runCli(fixture.cli, [
    "init",
    fixture.toolkit,
    "--config",
    fixture.configPath,
    "--self-host",
    "--integrate-agents"
  ]);
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
  const lock = JSON.parse(await fs.readFile(path.join(fixture.toolkit, "temple.lock"), "utf8"));
  assert.equal(lock.installation.mode, "toolkit-self-host");
  assert.equal(lock.installation.source_overlay, "project-overlay");
  assert.deepEqual(lock.installation.adopted_managed_files, [".agents/skills/temple-init/SKILL.md"]);
  assert.equal(lock.capabilities.toolkit_self_hosting, true);

  const doctor = runCli(fixture.cli, ["doctor", fixture.toolkit, "--json"]);
  assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
  const doctorResult = JSON.parse(doctor.stdout);
  assert.equal(doctorResult.summary.fail, 0);
  assert.match(
    doctorResult.checks.find((check) => check.id === "installation_mode").message,
    /Toolkit self-host boundary is valid/
  );
});

test("exclusive task-registry creation journals the content Temple actually wrote", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const result = await ensureTaskRegistry(target);
  const expected = formatJson({ schema_version: "temple.tasks/v1", tasks: [] });
  assert.equal(result.created, true);
  assert.equal(result.afterHash, sha256(expected));
  assert.equal(await fs.readFile(result.path, "utf8"), expected);
});

test("init prints copyable direct commands that survive shell-sensitive paths", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-command-test-"));
  const target = path.join(temporaryRoot, "sample product's repo");
  const configPath = path.join(temporaryRoot, "init config.json");
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  await fs.writeFile(configPath, `${JSON.stringify(configDocument(), null, 2)}\n`);

  const initialized = run(["init", target, "--config", configPath]);
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
  const projectLauncher = path.join(target, "templew.mjs");
  const doctorCommand = [process.execPath, projectLauncher, "doctor", target].map(shellQuote).join(" ");
  const statusCommand = [process.execPath, projectLauncher, "status", target].map(shellQuote).join(" ");
  assert.match(initialized.stdout, new RegExp(`Doctor: ${doctorCommand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(initialized.stdout, new RegExp(`Status: ${statusCommand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(initialized.stdout, /TEMPLE_BOOTSTRAP_REQUIRED/);
  assert.match(initialized.stdout, /Recommended path: fresh-session/);
  assert.match(initialized.stdout, /Supported continuation: explicit-read/);
  assert.match(initialized.stdout, /Claude Code entrypoint: available \(installed\)/);
  assert.match(initialized.stdout, /does not perform or verify that observation/);
  assert.match(initialized.stdout, /does not prove instruction loading or comprehension/);

  const wrapperEnvironment = { ...process.env, TEMPLE_CLI_PATH: cli };
  const copiedDoctor = spawnSync("/bin/sh", ["-c", doctorCommand], {
    encoding: "utf8",
    env: wrapperEnvironment
  });
  assert.equal(copiedDoctor.status, 0, copiedDoctor.stderr || copiedDoctor.stdout);
  const copiedStatus = spawnSync("/bin/sh", ["-c", `${statusCommand} --json --no-write`], {
    encoding: "utf8",
    env: wrapperEnvironment
  });
  assert.equal(copiedStatus.status, 0, copiedStatus.stderr || copiedStatus.stdout);
  assert.equal(JSON.parse(copiedStatus.stdout).project.id, "sample-product");
});

test("init emits one machine-readable agent-led bootstrap contract without granting authority", async (context) => {
  const { temporaryRoot, target, configPath } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));

  const initialized = run(["init", target, "--config", configPath, "--json"]);
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
  const result = JSON.parse(initialized.stdout);
  assert.equal(result.schema_version, "temple.init-result/v1");
  assert.equal(result.status, "initialized");
  assert.equal(result.files_written, true);
  assert.equal(result.plan.agents_integration, "installed");
  assert.equal(result.plan.claude_integration, "installed");
  assert.equal(result.bootstrap.schema_version, "temple.bootstrap-required/v1");
  assert.equal(result.bootstrap.marker, "TEMPLE_BOOTSTRAP_REQUIRED");
  assert.equal(result.bootstrap.status, "required");
  assert.equal(result.bootstrap.claude_integration, "installed");
  assert.equal(result.bootstrap.provider_entrypoint.provider, "claude-code");
  assert.equal(result.bootstrap.provider_entrypoint.path, "CLAUDE.md");
  assert.equal(result.bootstrap.provider_entrypoint.status, "available");
  assert.equal(result.bootstrap.provider_entrypoint.integration, "installed");
  assert.equal(result.bootstrap.provider_entrypoint.compatibility_verified, true);
  assert.equal(result.bootstrap.provider_entrypoint.adapter_installed, true);
  assert.equal(result.bootstrap.provider_entrypoint.adapter_created_by_init, true);
  assert.equal(result.bootstrap.provider_entrypoint.session_loading_verified, false);
  assert.equal(result.bootstrap.provider_entrypoint.comprehension_verified, false);
  assert.equal(result.bootstrap.provider_entrypoint.pending_merge_source, null);
  assert.deepEqual(
    result.bootstrap.instruction_sources.map((source) => source.path),
    ["AGENTS.md", "TEMPLE.md", ".agents/skills/temple-work/SKILL.md"]
  );
  assert.equal(result.bootstrap.recommended_path.id, "fresh-session");
  assert.ok(result.bootstrap.recommended_path.actions.some((action) => /provider-owned context inspection/.test(action)));
  assert.equal(result.bootstrap.continuation_path.id, "explicit-read");
  assert.match(result.bootstrap.verification.status_command, /--no-write/);
  assert.match(result.bootstrap.verification.status_command, /--json/);
  assert.match(result.bootstrap.verification.context_command_template, /<WI-ID>/);
  assert.match(result.bootstrap.verification.context_command_template, /<position>/);
  assert.deepEqual(result.bootstrap.verification.required_report_fields, [
    "position",
    "agent_identity",
    "work_item_id",
    "next_canonical_action"
  ]);
  assert.deepEqual(result.bootstrap.authority, {
    verifies_instruction_loading: false,
    verifies_model_comprehension: false,
    records_acknowledgement_as_evidence: false,
    creates_work_item: false,
    creates_claim: false,
    transitions_lifecycle: false,
    closes_work_item: false,
    performs_external_action: false
  });

  const wrapperEnvironment = { ...process.env, TEMPLE_CLI_PATH: cli };
  const readOnlyStatus = spawnSync("/bin/sh", ["-c", result.bootstrap.verification.status_command], {
    encoding: "utf8",
    env: wrapperEnvironment
  });
  assert.equal(readOnlyStatus.status, 0, readOnlyStatus.stderr || readOnlyStatus.stdout);
  assert.equal(JSON.parse(readOnlyStatus.stdout).project.id, "sample-product");

  assert.equal(await fs.readFile(path.join(target, "CLAUDE.md"), "utf8"), "@AGENTS.md\n");
  const firstLock = JSON.parse(await fs.readFile(path.join(target, "temple.lock"), "utf8"));
  assert.equal(firstLock.integrations.claude_md, "installed");
  assert.equal(firstLock.managed_files.some((entry) => entry.path === "CLAUDE.md"), false);

  const reinitialized = run(["init", target, "--config", configPath, "--json"]);
  assert.equal(reinitialized.status, 0, reinitialized.stderr || reinitialized.stdout);
  const repeated = JSON.parse(reinitialized.stdout);
  assert.equal(repeated.plan.agents_integration, "present");
  assert.equal(repeated.plan.claude_integration, "present");
  assert.equal(repeated.bootstrap.provider_entrypoint.integration, "present");
  assert.equal(repeated.bootstrap.provider_entrypoint.adapter_created_by_init, false);
  assert.equal(repeated.bootstrap.status, "required");
  assert.equal(repeated.bootstrap.authority.records_acknowledgement_as_evidence, false);
  assert.equal(await fs.readFile(path.join(target, "CLAUDE.md"), "utf8"), "@AGENTS.md\n");
});

test("init, doctor, status, and idempotent re-init succeed", async (context) => {
  const { temporaryRoot, target, configPath } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));

  const initialized = run(["init", target, "--config", configPath]);
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
  const lock = JSON.parse(await fs.readFile(path.join(target, "temple.lock"), "utf8"));
  assert.equal(lock.project_id, "sample-product");
  assert.ok(lock.managed_files.length > 10);
  assert.equal(lock.boundaries.managed_files_authoritative, true);
  assert.equal(lock.boundaries.ownership_precedence, "exact managed_files entry, otherwise project-owned");
  assert.ok(!("managed" in lock.boundaries));
  assert.equal(lock.capabilities.engineering_learning, true);
  assert.equal(lock.capabilities.product_specifications, true);
  assert.equal(lock.capabilities.external_spec_sources, true);
  assert.equal(lock.capabilities.work_item_spec_refs, true);
  assert.equal(lock.capabilities.work_item_specification_modes, true);
  assert.equal(lock.capabilities.specification_source_integrity, true);
  assert.equal(lock.capabilities.ui_delivery_mode_overrides, true);
  assert.equal(lock.capabilities.ui_evidence_gates, true);
  assert.equal(lock.capabilities.iterative_delivery_contract, true);
  assert.equal(lock.capabilities.tracker_contract, true);
  assert.equal(lock.capabilities.tracker_field_ownership, true);
  assert.equal(lock.capabilities.work_item_tracker_links, true);
  assert.equal(lock.capabilities.tracker_observations, true);
  assert.equal(lock.capabilities.tracker_reconciliation, true);
  assert.equal(lock.capabilities.github_tracker_adapter, true);
  assert.equal(lock.capabilities.group_parallel_planning, true);
  assert.equal(lock.capabilities.parallel_dispatch_manifest, true);
  assert.equal(lock.capabilities.parallel_plan_freshness, true);
  assert.equal(lock.capabilities.parallel_join_gate, true);
  assert.equal(lock.capabilities.versioned_project_backup, true);
  assert.equal(lock.capabilities.backup_integrity_verification, true);
  assert.equal(lock.capabilities.restore_preview, true);
  assert.equal(lock.capabilities.transactional_restore_recovery, true);
  assert.equal(lock.capabilities.adversarial_policy_catalog, true);
  assert.equal(lock.capabilities.policy_evaluation_scorecard, true);
  assert.equal(lock.capabilities.usage_attribution, true);
  assert.equal(lock.capabilities.usage_baseline_report, true);
  assert.equal(lock.capabilities.usage_telemetry_preflight, true);
  assert.equal(lock.capabilities.codex_account_usage_probe, true);
  assert.equal(lock.capabilities.repository_integration_contract, true);
  assert.ok(
    lock.managed_files.some((entry) => entry.path === ".ai-org/core/schemas/parallel-plan.schema.json")
  );
  assert.ok(lock.managed_files.some((entry) => entry.path === ".ai-org/core/adversarial-scenarios.json"));
  assert.ok(!lock.managed_files.some((entry) => entry.path === ".ai-org/learning/index.json"));
  assert.ok(!lock.managed_files.some((entry) => entry.path === ".ai-org/project/spec-index.json"));
  assert.ok(!lock.managed_files.some((entry) => entry.path === ".ai-org/project/tracker.json"));
  assert.ok(!lock.managed_files.some((entry) => entry.path === REPOSITORY_INTEGRATION_RELATIVE_PATH));
  assert.ok(
    lock.managed_files.some((entry) => entry.path === ".ai-org/core/schemas/repository-integration.schema.json")
  );

  const agents = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/agents.json"), "utf8"));
  assert.equal(agents.agents.length, 5);
  assert.equal(agents.agents[0].display_name, "Fixture Rowan");
  const tasks = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/tasks.json"), "utf8"));
  assert.deepEqual(tasks.tasks, []);
  const learning = JSON.parse(await fs.readFile(path.join(target, ".ai-org/learning/index.json"), "utf8"));
  assert.deepEqual(learning.entries, []);
  const specIndexPath = path.join(target, ".ai-org/project/spec-index.json");
  const specIndex = JSON.parse(await fs.readFile(specIndexPath, "utf8"));
  assert.equal(specIndex.adoption_profile, "hybrid");
  assert.deepEqual(specIndex.entries, []);
  const repositoryIntegrationPath = path.join(target, REPOSITORY_INTEGRATION_RELATIVE_PATH);
  assert.deepEqual(
    JSON.parse(await fs.readFile(repositoryIntegrationPath, "utf8")),
    defaultRepositoryIntegration()
  );

  const capabilityViewPath = path.join(target, ".ai-org/views/capabilities.json");
  const capabilityViewBeforeReadOnlyChecks = await fs.readFile(capabilityViewPath);
  const doctor = run(["doctor", target, "--json"]);
  assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
  const doctorResult = JSON.parse(doctor.stdout);
  assert.equal(doctorResult.summary.fail, 0);
  assert.equal(doctorResult.checks.find((check) => check.id === "repository_integration").status, "warn");
  assert.deepEqual(await fs.readFile(capabilityViewPath), capabilityViewBeforeReadOnlyChecks);

  const readOnlyStatus = run(["status", target, "--json", "--no-write"]);
  assert.equal(readOnlyStatus.status, 0, readOnlyStatus.stderr || readOnlyStatus.stdout);
  assert.deepEqual(await fs.readFile(capabilityViewPath), capabilityViewBeforeReadOnlyChecks);

  const status = run(["status", target, "--json"]);
  assert.equal(status.status, 0, status.stderr);
  const statusResult = JSON.parse(status.stdout);
  assert.notDeepEqual(await fs.readFile(capabilityViewPath), capabilityViewBeforeReadOnlyChecks);
  assert.equal(statusResult.assignments.length, 10);
  assert.equal(statusResult.schema_version, "temple.status/v9");
  assert.equal(statusResult.learning.total, 0);
  assert.equal(statusResult.specifications.total_entries, 0);
  assert.equal(statusResult.tracker.profile, "repository-only");
  assert.equal(statusResult.repository_integration.status, "unconfirmed");
  assert.ok(statusResult.attention.some((entry) => entry.type === "repository_integration_unconfirmed"));
  const trackerConfig = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/tracker.json"), "utf8"));
  assert.equal(trackerConfig.profile, "repository-only");
  assert.deepEqual(trackerConfig.providers, []);
  const statusView = await fs.readFile(path.join(target, ".ai-org/views/status.md"), "utf8");
  assert.match(statusView, /^# Sample Product — AI development organization status/m);
  assert.match(statusView, /Independent QA/);
  assert.doesNotMatch(statusView, /Temple status/);
  assert.match(statusView, /Engineering learning: 0 Lessons, 0 Practices/);
  assert.match(statusView, /Repository integration: `unconfirmed`/);

  specIndex.adoption_profile = "temple-native";
  await fs.writeFile(specIndexPath, `${JSON.stringify(specIndex, null, 2)}\n`);
  const confirmedIntegration = `{
    "schema_version": "temple.repository-integration/v1",
    "status": "confirmed",
    "authority": "project",
    "source": "human-confirmed",
    "policy_refs": [],
    "summary": "Review before integration.",
    "integration_target": "main",
    "change_isolation": "required",
    "review_gate": "required",
    "recorded_at": "2026-09-02T00:00:00.000Z",
    "recorded_by": "human"
  }\n`;
  await fs.writeFile(repositoryIntegrationPath, confirmedIntegration);
  const secondInit = run(["init", target, "--config", configPath]);
  assert.equal(secondInit.status, 0, secondInit.stderr || secondInit.stdout);
  assert.match(secondInit.stdout, /skip-identical/);
  assert.deepEqual(JSON.parse(await fs.readFile(specIndexPath, "utf8")), specIndex);
  assert.equal(await fs.readFile(repositoryIntegrationPath, "utf8"), confirmedIntegration);
});

test("engineering learning is indexed, observable, project-owned, and consistency-checked", async (context) => {
  const { temporaryRoot, target, configPath } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  assert.equal(run(["init", target, "--config", configPath]).status, 0);

  const recordPath = path.join(target, ".ai-org/learning/lessons/LESSON-0001.md");
  const indexPath = path.join(target, ".ai-org/learning/index.json");
  const record = "# Runtime evidence\n\nEvidence must identify the tested revision.\n";
  const index = {
    schema_version: "ai-org.learning-index/v1",
    entries: [
      {
        id: "LESSON-0001",
        kind: "lesson",
        title: "Keep runtime evidence revision-specific",
        summary: "Runtime evidence is trustworthy only when its tested revision is recorded.",
        status: "candidate",
        confidence: "medium",
        tags: ["verification", "revision"],
        applies_to: ["release-gate", "independent-qa"],
        source_work_items: ["WI-0001"],
        path: ".ai-org/learning/lessons/LESSON-0001.md",
        updated_at: "2026-08-29",
        last_validated_at: null,
        promotion: { target: "none", status: "none", reference: null }
      }
    ]
  };
  await fs.mkdir(path.dirname(recordPath), { recursive: true });
  await fs.writeFile(recordPath, record);
  await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);

  const doctor = run(["doctor", target, "--json"]);
  assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
  const learningCheck = JSON.parse(doctor.stdout).checks.find((check) => check.id === "engineering_learning");
  assert.equal(learningCheck.status, "pass");
  assert.match(learningCheck.message, /1 Lessons and 0 Practices/);

  const status = run(["status", target, "--json", "--no-write"]);
  assert.equal(status.status, 0, status.stderr || status.stdout);
  assert.deepEqual(
    { total: JSON.parse(status.stdout).learning.total, candidates: JSON.parse(status.stdout).learning.candidates },
    { total: 1, candidates: 1 }
  );

  index.entries[0].status = "active";
  await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  const invalidState = run(["doctor", target]);
  assert.equal(invalidState.status, 1);
  assert.match(invalidState.stdout, /status is invalid for lesson/);
  index.entries[0].status = "candidate";
  await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);

  const reinitialized = run(["init", target, "--config", configPath]);
  assert.equal(reinitialized.status, 0, reinitialized.stderr || reinitialized.stdout);
  assert.deepEqual(JSON.parse(await fs.readFile(indexPath, "utf8")), index);
  assert.equal(await fs.readFile(recordPath, "utf8"), record);
  const lockPath = path.join(target, "temple.lock");
  const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  assert.ok(!lock.managed_files.some((entry) => entry.path === ".ai-org/learning/index.json"));

  lock.template.version = "0.1.0-alpha.10";
  delete lock.capabilities.engineering_learning;
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  const upgraded = run(["upgrade", target]);
  assert.equal(upgraded.status, 0, upgraded.stderr || upgraded.stdout);
  assert.deepEqual(JSON.parse(await fs.readFile(indexPath, "utf8")), index);
  assert.equal(await fs.readFile(recordPath, "utf8"), record);
  assert.ok(
    !JSON.parse(await fs.readFile(lockPath, "utf8")).managed_files.some(
      (entry) => entry.path === ".ai-org/learning/index.json"
    )
  );

  const orphanPath = path.join(target, ".ai-org/learning/practices/PRACTICE-0002.md");
  await fs.mkdir(path.dirname(orphanPath), { recursive: true });
  await fs.writeFile(orphanPath, "# Unindexed practice\n");
  const orphaned = run(["doctor", target]);
  assert.equal(orphaned.status, 1);
  assert.match(orphaned.stdout, /unindexed records: \.ai-org\/learning\/practices\/PRACTICE-0002\.md/);
  await fs.rm(orphanPath);

  await fs.rm(recordPath);
  const inconsistent = run(["doctor", target]);
  assert.equal(inconsistent.status, 1);
  assert.match(inconsistent.stdout, /missing records: \.ai-org\/learning\/lessons\/LESSON-0001\.md/);
});

test("upgrade adds a missing project-owned learning index without managing it", async (context) => {
  const { temporaryRoot, target, configPath } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  assert.equal(run(["init", target, "--config", configPath]).status, 0);

  const indexPath = path.join(target, ".ai-org/learning/index.json");
  const specIndexPath = path.join(target, ".ai-org/project/spec-index.json");
  const trackerConfigPath = path.join(target, ".ai-org/project/tracker.json");
  const repositoryIntegrationPath = path.join(target, REPOSITORY_INTEGRATION_RELATIVE_PATH);
  const lockPath = path.join(target, "temple.lock");
  await fs.rm(indexPath);
  await fs.rm(specIndexPath);
  await fs.rm(trackerConfigPath);
  await fs.rm(repositoryIntegrationPath);
  const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  lock.template.version = "0.1.0-alpha.10";
  delete lock.capabilities.engineering_learning;
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  const dryRun = run(["upgrade", target, "--dry-run"]);
  assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
  assert.match(dryRun.stdout, /create-learning-index: 1/);
  assert.match(dryRun.stdout, /create-spec-index: 1/);
  assert.match(dryRun.stdout, /create-tracker-config: 1/);
  const upgraded = run(["upgrade", target]);
  assert.equal(upgraded.status, 0, upgraded.stderr || upgraded.stdout);
  assert.deepEqual(JSON.parse(await fs.readFile(indexPath, "utf8")), {
    schema_version: "ai-org.learning-index/v2",
    entries: []
  });
  assert.deepEqual(JSON.parse(await fs.readFile(specIndexPath, "utf8")), {
    schema_version: "temple.spec-index/v1",
    adoption_profile: "hybrid",
    delivery_method: "contract-guided-iterative",
    entries: []
  });
  assert.equal(JSON.parse(await fs.readFile(trackerConfigPath, "utf8")).profile, "repository-only");
  assert.deepEqual(
    JSON.parse(await fs.readFile(repositoryIntegrationPath, "utf8")),
    defaultRepositoryIntegration()
  );
  const upgradedLock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  assert.equal(upgradedLock.template.version, TEMPLATE_VERSION);
  assert.equal(upgradedLock.capabilities.engineering_learning, true);
  assert.equal(upgradedLock.capabilities.group_parallel_planning, true);
  assert.equal(upgradedLock.capabilities.parallel_join_gate, true);
  assert.equal(upgradedLock.capabilities.policy_evaluation_scorecard, true);
  assert.equal(upgradedLock.capabilities.usage_baseline_report, true);
  assert.equal(upgradedLock.capabilities.usage_telemetry_preflight, true);
  assert.equal(upgradedLock.capabilities.codex_account_usage_probe, true);
  assert.equal(upgradedLock.capabilities.repository_integration_contract, true);
  assert.ok(!upgradedLock.managed_files.some((entry) => entry.path === ".ai-org/learning/index.json"));
  assert.ok(!upgradedLock.managed_files.some((entry) => entry.path === ".ai-org/project/spec-index.json"));
  assert.ok(!upgradedLock.managed_files.some((entry) => entry.path === ".ai-org/project/tracker.json"));
  assert.ok(!upgradedLock.managed_files.some((entry) => entry.path === REPOSITORY_INTEGRATION_RELATIVE_PATH));
});

test("upgrade preserves an existing project-owned specification index byte-for-byte", async (context) => {
  const { temporaryRoot, target, configPath } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  assert.equal(run(["init", target, "--config", configPath]).status, 0);
  const specIndexPath = path.join(target, ".ai-org/project/spec-index.json");
  const customIndex = `{
    "schema_version": "temple.spec-index/v1",
    "adoption_profile": "federated",
    "delivery_method": "contract-guided-iterative",
    "entries": []
  }\n`;
  await fs.writeFile(specIndexPath, customIndex);
  const lockPath = path.join(target, "temple.lock");
  const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  lock.template.version = "0.1.0-alpha.13";
  delete lock.capabilities.product_specifications;
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  const upgraded = run(["upgrade", target]);
  assert.equal(upgraded.status, 0, upgraded.stderr || upgraded.stdout);
  assert.equal(await fs.readFile(specIndexPath, "utf8"), customIndex);
  const upgradedLock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  assert.equal(upgradedLock.capabilities.product_specifications, true);
  assert.ok(!upgradedLock.managed_files.some((entry) => entry.path === ".ai-org/project/spec-index.json"));
});

test("upgrade preserves an existing project-owned tracker configuration byte-for-byte", async (context) => {
  const { temporaryRoot, target, configPath } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  assert.equal(run(["init", target, "--config", configPath]).status, 0);
  const trackerPath = path.join(target, ".ai-org/project/tracker.json");
  const customTracker = `{
    "schema_version": "temple.tracker/v1",
    "profile": "repository-only",
    "sync_granularity": "parent-only",
    "default_provider_id": null,
    "providers": [],
    "field_ownership": {
      "temple": ["lifecycle_state", "specification_refs", "interface_contracts", "gate_evidence", "claim", "tested_revision", "release_decision"],
      "external": ["priority", "iteration", "estimate", "due_date", "business_assignee", "labels"],
      "negotiated": ["title", "parent", "dependencies"]
    },
    "updated_at": null,
    "updated_by": null
  }\n`;
  await fs.writeFile(trackerPath, customTracker);
  const lockPath = path.join(target, "temple.lock");
  const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  lock.template.version = "0.1.0-alpha.14";
  delete lock.capabilities.tracker_contract;
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  const upgraded = run(["upgrade", target]);
  assert.equal(upgraded.status, 0, upgraded.stderr || upgraded.stdout);
  assert.equal(await fs.readFile(trackerPath, "utf8"), customTracker);
  const upgradedLock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  assert.equal(upgradedLock.capabilities.tracker_contract, true);
  assert.ok(!upgradedLock.managed_files.some((entry) => entry.path === ".ai-org/project/tracker.json"));
});

test("upgrade preserves an existing project-owned repository integration record byte-for-byte", async (context) => {
  const { temporaryRoot, target, configPath } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  assert.equal(run(["init", target, "--config", configPath]).status, 0);
  const integrationPath = path.join(target, REPOSITORY_INTEGRATION_RELATIVE_PATH);
  const customIntegration = `{
    "schema_version": "temple.repository-integration/v1",
    "status": "confirmed",
    "authority": "project",
    "source": "repository-policy",
    "policy_refs": ["CONTRIBUTING.md"],
    "summary": "Use the project's reviewed integration process.",
    "integration_target": "trunk",
    "change_isolation": "project-defined",
    "review_gate": "project-defined",
    "recorded_at": "2026-09-02T00:00:00.000Z",
    "recorded_by": "human"
  }\n\n`;
  await fs.writeFile(integrationPath, customIntegration);
  const lockPath = path.join(target, "temple.lock");
  const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  lock.template.version = "0.1.0-alpha.28";
  delete lock.capabilities.repository_integration_contract;
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  const upgraded = run(["upgrade", target]);
  assert.equal(upgraded.status, 0, upgraded.stderr || upgraded.stdout);
  assert.equal(await fs.readFile(integrationPath, "utf8"), customIntegration);
  const upgradedLock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  assert.equal(upgradedLock.capabilities.repository_integration_contract, true);
  assert.ok(!upgradedLock.managed_files.some((entry) => entry.path === REPOSITORY_INTEGRATION_RELATIVE_PATH));
});

test("upgrade assigns the new UI Designer Position to the existing UX Designer Identity", async (context) => {
  const { temporaryRoot, target, configPath } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  assert.equal(run(["init", target, "--config", configPath]).status, 0);

  const assignmentsPath = path.join(target, ".ai-org/project/assignments.json");
  const lockPath = path.join(target, "temple.lock");
  const positionsPath = path.join(target, ".ai-org/core/positions.json");
  const assignments = JSON.parse(await fs.readFile(assignmentsPath, "utf8"));
  const uxAssignment = assignments.assignments.find((assignment) => assignment.position_id === "ux_designer");
  assignments.assignments = assignments.assignments.filter((assignment) => assignment.position_id !== "ui_designer");
  await fs.writeFile(assignmentsPath, `${JSON.stringify(assignments, null, 2)}\n`);

  const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  lock.template.version = "0.1.0-alpha.10";
  delete lock.capabilities.ui_delivery_modes;
  const alpha11ManagedPaths = [
    ".ai-org/core/ui-design.json",
    ".ai-org/templates/ui-design-brief.md",
    ".codex/agents/ui-designer.toml"
  ];
  for (const relativePath of alpha11ManagedPaths) await fs.rm(path.join(target, relativePath));
  lock.managed_files = lock.managed_files.filter((entry) => !alpha11ManagedPaths.includes(entry.path));
  const positions = JSON.parse(await fs.readFile(positionsPath, "utf8"));
  positions.positions = positions.positions.filter((position) => position.id !== "ui_designer");
  const oldPositions = formatJson(positions);
  await fs.writeFile(positionsPath, oldPositions);
  lock.managed_files.find((entry) => entry.path === ".ai-org/core/positions.json").sha256 = sha256(oldPositions);
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  const dryRun = run(["upgrade", target, "--dry-run"]);
  assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
  assert.match(dryRun.stdout, /add-ui-assignment: 1/);
  assert.match(dryRun.stdout, /add-managed: 3/);
  assert.ok(!JSON.parse(await fs.readFile(assignmentsPath, "utf8")).assignments.some((entry) => entry.position_id === "ui_designer"));

  const upgraded = run(["upgrade", target]);
  assert.equal(upgraded.status, 0, upgraded.stderr || upgraded.stdout);
  const upgradedAssignments = JSON.parse(await fs.readFile(assignmentsPath, "utf8")).assignments;
  assert.equal(
    upgradedAssignments.find((assignment) => assignment.position_id === "ui_designer")?.agent_id,
    uxAssignment.agent_id
  );
  assert.equal(upgradedAssignments.filter((assignment) => assignment.position_id === "ui_designer").length, 1);
  for (const relativePath of alpha11ManagedPaths) await fs.access(path.join(target, relativePath));
  assert.equal(JSON.parse(await fs.readFile(lockPath, "utf8")).capabilities.ui_delivery_modes, true);
  assert.equal(run(["doctor", target]).status, 0);

  const customizedAssignments = JSON.parse(await fs.readFile(assignmentsPath, "utf8"));
  customizedAssignments.assignments.find((assignment) => assignment.position_id === "ui_designer").agent_id =
    "agent-fixture-ellis";
  await fs.writeFile(assignmentsPath, `${JSON.stringify(customizedAssignments, null, 2)}\n`);
  const customizedLock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  customizedLock.template.version = "0.1.0-alpha.10";
  await fs.writeFile(lockPath, `${JSON.stringify(customizedLock, null, 2)}\n`);
  const preserved = run(["upgrade", target]);
  assert.equal(preserved.status, 0, preserved.stderr || preserved.stdout);
  assert.equal(
    JSON.parse(await fs.readFile(assignmentsPath, "utf8")).assignments.find(
      (assignment) => assignment.position_id === "ui_designer"
    ).agent_id,
    "agent-fixture-ellis"
  );
});

test("upgrade refuses to guess a UI Designer owner from ambiguous UX assignments", async (context) => {
  const { temporaryRoot, target, configPath } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  assert.equal(run(["init", target, "--config", configPath]).status, 0);

  const assignmentsPath = path.join(target, ".ai-org/project/assignments.json");
  const lockPath = path.join(target, "temple.lock");
  const assignments = JSON.parse(await fs.readFile(assignmentsPath, "utf8"));
  assignments.assignments = assignments.assignments.filter((assignment) => assignment.position_id !== "ui_designer");
  assignments.assignments.push({ position_id: "ux_designer", agent_id: "agent-fixture-devon", active: true });
  const before = `${JSON.stringify(assignments, null, 2)}\n`;
  await fs.writeFile(assignmentsPath, before);
  const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  lock.template.version = "0.1.0-alpha.10";
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  const upgraded = run(["upgrade", target]);
  assert.equal(upgraded.status, 1);
  assert.match(upgraded.stdout, /Cannot infer UI Designer owner without exactly one active UX Designer assignment/);
  assert.equal(await fs.readFile(assignmentsPath, "utf8"), before);
});

test("init refuses to adopt an identical untracked managed destination", async (context) => {
  const { temporaryRoot, target, configPath } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const relativePath = ".agents/skills/domain-modeling/SKILL.md";
  const destinationPath = path.join(target, relativePath);
  const original = await fs.readFile(path.join(root, "project-overlay", relativePath), "utf8");
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.writeFile(destinationPath, original);

  const initialized = run(["init", target, "--config", configPath]);
  assert.equal(initialized.status, 1);
  assert.match(initialized.stdout, /untracked file blocks new managed path/);
  assert.equal(await fs.readFile(destinationPath, "utf8"), original);
  await assert.rejects(() => fs.access(path.join(target, "temple.lock")));
});

test("executeInit preserves a CLAUDE.md created after planning and rolls back earlier writes", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const plan = await planInit(target, configDocument());
  const destinationPath = path.join(target, "CLAUDE.md");
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(destinationPath, "project-owned Claude race winner\n");

  await assert.rejects(() => executeInit(plan), (error) => error.code === "EEXIST");
  assert.equal(await fs.readFile(destinationPath, "utf8"), "project-owned Claude race winner\n");
  await assert.rejects(() => fs.access(path.join(target, "AGENTS.md")));
  await assert.rejects(() => fs.access(path.join(target, "temple.lock")));
});

test("executeInit rolls back earlier files when a later path appears after planning", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const plan = await planInit(target, configDocument());
  const copyActions = plan.actions.filter((action) => action.type === "copy");
  const firstPath = path.join(target, copyActions[0].path);
  const racePath = path.join(target, copyActions.at(-1).path);
  await fs.mkdir(path.dirname(racePath), { recursive: true });
  await fs.writeFile(racePath, "late project-owned file\n");

  await assert.rejects(() => executeInit(plan), (error) => error.code === "EEXIST");
  await assert.rejects(() => fs.access(firstPath));
  assert.equal(await fs.readFile(racePath, "utf8"), "late project-owned file\n");
  await assert.rejects(() => fs.access(path.join(target, "temple.lock")));
});

test("a unique project Skill survives re-init and upgrade without entering the managed lock", async (context) => {
  const { temporaryRoot, target, configPath } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  assert.equal(run(["init", target, "--config", configPath]).status, 0);
  const relativePath = ".agents/skills/project-helper/SKILL.md";
  const skillPath = path.join(target, relativePath);
  const content = "---\nname: project-helper\ndescription: Project-owned fixture Skill.\n---\n\nPreserve this file.\n";
  await fs.mkdir(path.dirname(skillPath), { recursive: true });
  await fs.writeFile(skillPath, content);

  const reinitialized = run(["init", target, "--config", configPath]);
  assert.equal(reinitialized.status, 0, reinitialized.stderr || reinitialized.stdout);
  const lockPath = path.join(target, "temple.lock");
  const previousLock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  previousLock.template.version = "0.1.0-alpha.7";
  await fs.writeFile(lockPath, `${JSON.stringify(previousLock, null, 2)}\n`);
  const upgraded = run(["upgrade", target]);
  assert.equal(upgraded.status, 0, upgraded.stderr || upgraded.stdout);
  assert.equal(await fs.readFile(skillPath, "utf8"), content);
  const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  assert.ok(!lock.managed_files.some((entry) => entry.path === relativePath));
  assert.equal(run(["doctor", target]).status, 0);
});

test("existing AGENTS.md is preserved until explicit integration", async (context) => {
  const { temporaryRoot, target, configPath } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  await fs.cp(path.join(root, "examples/sample-project"), target, { recursive: true });
  const original = await fs.readFile(path.join(target, "AGENTS.md"), "utf8");

  const initialized = run(["init", target, "--config", configPath]);
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
  assert.equal(await fs.readFile(path.join(target, "AGENTS.md"), "utf8"), original);
  assert.match(initialized.stdout, /pending_merge/);
  assert.match(initialized.stdout, /\.ai-org\/project\/AGENTS\.temple\.md/);
  assert.match(initialized.stdout, /fresh session alone cannot activate an unmerged root instruction contract/);

  const integrated = run(["init", target, "--config", configPath, "--integrate-agents"]);
  assert.equal(integrated.status, 0, integrated.stderr || integrated.stdout);
  const updated = await fs.readFile(path.join(target, "AGENTS.md"), "utf8");
  assert.ok(updated.startsWith(original.trimEnd()));
  assert.match(updated, /temple:instructions:start/);
});

test("existing compatible CLAUDE.md is preserved as a project-owned adapter", async (context) => {
  const { temporaryRoot, target, configPath } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const original = "# Project instructions\n\n@./AGENTS.md\n\nKeep this project-owned note.\n";
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, "CLAUDE.md"), original);

  const initialized = run(["init", target, "--config", configPath, "--json"]);
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
  const result = JSON.parse(initialized.stdout);
  assert.equal(result.plan.claude_integration, "present");
  assert.equal(result.bootstrap.provider_entrypoint.status, "available");
  assert.equal(result.bootstrap.provider_entrypoint.compatibility_verified, true);
  assert.equal(result.bootstrap.provider_entrypoint.adapter_created_by_init, false);
  assert.equal(result.bootstrap.provider_entrypoint.session_loading_verified, false);
  assert.equal(await fs.readFile(path.join(target, "CLAUDE.md"), "utf8"), original);
  await assert.rejects(() => fs.access(path.join(target, ".ai-org/project/CLAUDE.temple.md")));

  const lock = JSON.parse(await fs.readFile(path.join(target, "temple.lock"), "utf8"));
  assert.equal(lock.integrations.claude_md, "present");
  assert.equal(lock.managed_files.some((entry) => entry.path === "CLAUDE.md"), false);
});

test("existing incompatible CLAUDE.md is preserved with an explicit pending merge", async (context) => {
  const { temporaryRoot, target, configPath } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const original = "# Project-owned Claude instructions\n\nDo not overwrite this file.\n";
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, "CLAUDE.md"), original);

  const initialized = run(["init", target, "--config", configPath, "--json"]);
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
  const result = JSON.parse(initialized.stdout);
  assert.equal(result.plan.claude_integration, "pending_merge");
  assert.equal(result.bootstrap.provider_entrypoint.status, "pending_merge");
  assert.equal(result.bootstrap.provider_entrypoint.compatibility_verified, false);
  assert.equal(result.bootstrap.provider_entrypoint.adapter_installed, false);
  assert.equal(result.bootstrap.provider_entrypoint.adapter_created_by_init, false);
  assert.equal(result.bootstrap.provider_entrypoint.pending_merge_source, ".ai-org/project/CLAUDE.temple.md");
  assert.equal(result.bootstrap.provider_entrypoint.session_loading_verified, false);
  assert.equal(result.bootstrap.provider_entrypoint.comprehension_verified, false);
  assert.ok(
    result.bootstrap.recommended_path.actions.some((action) =>
      /fresh session alone cannot activate an unmerged Claude Code entrypoint/.test(action)
    )
  );
  assert.deepEqual(
    result.bootstrap.instruction_sources.map((source) => source.path),
    ["AGENTS.md", "TEMPLE.md", ".agents/skills/temple-work/SKILL.md"]
  );
  assert.equal(await fs.readFile(path.join(target, "CLAUDE.md"), "utf8"), original);
  assert.equal(await fs.readFile(path.join(target, ".ai-org/project/CLAUDE.temple.md"), "utf8"), "@AGENTS.md\n");

  const customSnippet = "# Project review pending\n@AGENTS.md\n";
  await fs.writeFile(path.join(target, ".ai-org/project/CLAUDE.temple.md"), customSnippet);
  const repeated = run(["init", target, "--config", configPath]);
  assert.equal(repeated.status, 0, repeated.stderr || repeated.stdout);
  assert.match(repeated.stdout, /Existing \.ai-org\/project\/CLAUDE\.temple\.md differs; it will not be overwritten/);
  assert.match(repeated.stdout, /CLAUDE\.md integration: pending_merge/);
  assert.equal(await fs.readFile(path.join(target, "CLAUDE.md"), "utf8"), original);
  assert.equal(await fs.readFile(path.join(target, ".ai-org/project/CLAUDE.temple.md"), "utf8"), customSnippet);
});

test("dry-run and pre-write conflict do not create the Claude adapter", async (context) => {
  const { temporaryRoot, target, configPath } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));

  const dryRun = run(["init", target, "--config", configPath, "--dry-run", "--json"]);
  assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
  const planned = JSON.parse(dryRun.stdout);
  assert.equal(planned.status, "planned");
  assert.equal(planned.plan.claude_integration, "installed");
  assert.equal(planned.bootstrap, null);
  await assert.rejects(() => fs.access(path.join(target, "CLAUDE.md")));

  const blockingPath = path.join(target, ".ai-org/core/policies.json");
  await fs.mkdir(path.dirname(blockingPath), { recursive: true });
  await fs.writeFile(blockingPath, "project-owned blocker\n");
  const conflict = run(["init", target, "--config", configPath, "--json"]);
  assert.equal(conflict.status, 1, conflict.stderr || conflict.stdout);
  const stopped = JSON.parse(conflict.stdout);
  assert.equal(stopped.status, "conflict");
  assert.equal(stopped.plan.claude_integration, "installed");
  assert.equal(stopped.bootstrap, null);
  await assert.rejects(() => fs.access(path.join(target, "CLAUDE.md")));
  await assert.rejects(() => fs.access(path.join(target, ".ai-org/project/CLAUDE.temple.md")));
});

test("managed conflicts stop without overwriting", async (context) => {
  const { temporaryRoot, target, configPath } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  assert.equal(run(["init", target, "--config", configPath]).status, 0);
  const managedPath = path.join(target, ".ai-org/core/policies.json");
  await fs.appendFile(managedPath, "\nchanged by project\n");

  const reinit = run(["init", target, "--config", configPath]);
  assert.equal(reinit.status, 1);
  assert.match(reinit.stdout, /managed file has different content/);
  assert.doesNotMatch(reinit.stdout, /TEMPLE_BOOTSTRAP_REQUIRED/);

  const jsonReinit = run(["init", target, "--config", configPath, "--json"]);
  assert.equal(jsonReinit.status, 1, jsonReinit.stderr || jsonReinit.stdout);
  const conflict = JSON.parse(jsonReinit.stdout);
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.bootstrap, null);
  assert.match(await fs.readFile(managedPath, "utf8"), /changed by project/);

  const doctor = run(["doctor", target]);
  assert.equal(doctor.status, 1);
  assert.match(doctor.stdout, /\[FAIL\] managed_files/);
});

test("doctor rejects an invalid canonical work item", async (context) => {
  const { temporaryRoot, target, configPath } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  assert.equal(run(["init", target, "--config", configPath]).status, 0);
  await fs.writeFile(
    path.join(target, ".ai-org/work-items/WI-0001.json"),
    `${JSON.stringify({ schema_version: "temple.work-item/v1", id: "WI-0001", state: "made-up" })}\n`
  );

  const doctor = run(["doctor", target]);
  assert.equal(doctor.status, 1);
  assert.match(doctor.stdout, /\[FAIL\] work_items/);
});

test("the distributable project overlay contains no project identities", async () => {
  await assert.rejects(() => fs.access(path.join(root, "project-overlay/.ai-org/project/agents.json")));
  await assert.rejects(() => fs.access(path.join(root, "project-overlay/.ai-org/project/assignments.json")));
});
