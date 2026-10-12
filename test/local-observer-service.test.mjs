import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyLocalObserverService,
  inspectLocalObserverService,
  localObservationContext,
  planLocalObserverService,
  readLocalObserverManifest,
  removeLocalObserverService
} from "../src/local-observer-service.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin/temple.mjs");

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

function git(target, args) {
  return spawnSync("git", ["-C", target, ...args], { encoding: "utf8" });
}

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}

async function fixture(context) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-observer-service-test-"));
  const target = path.join(temporaryRoot, "managed-product");
  const configPath = path.join(temporaryRoot, "init.json");
  const stateDirectory = path.join(temporaryRoot, "runtime-state");
  const userHome = path.join(temporaryRoot, "operator-home");
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }));
  await writeJson(configPath, {
    schema_version: "temple.init/v1",
    project: { id: "managed-product", name: "Managed Product" },
    naming_mode: "manual",
    agents: [
      { display_name: "Fixture Rowan", positions: ["engineering_manager", "release_manager", "observer"] },
      { display_name: "Fixture Linden", positions: ["product_manager", "ux_designer", "ui_designer"] },
      { display_name: "Fixture Ellis", positions: ["tech_lead"] },
      { display_name: "Fixture Devon", positions: ["developer"] },
      { display_name: "Fixture Hollis", positions: ["quality_evaluator", "independent_qa"] }
    ]
  });
  const initialized = run(["init", target, "--config", configPath]);
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
  assert.equal(git(target, ["init", "-q"]).status, 0);
  assert.equal(git(target, ["config", "user.email", "temple-tests@example.invalid"]).status, 0);
  assert.equal(git(target, ["config", "user.name", "Temple Tests"]).status, 0);
  assert.equal(git(target, ["add", "."]).status, 0);
  assert.equal(git(target, ["commit", "-qm", "initial state"]).status, 0);
  return { target, stateDirectory, userHome };
}

function planOptions(fixtureState, overrides = {}) {
  return {
    stateDirectory: fixtureState.stateDirectory,
    platform: "darwin",
    userHome: fixtureState.userHome,
    nodeExecutable: "/opt/temple test/node",
    codexCommand: "/opt/temple test/codex",
    skipExecutableCheck: true,
    ...overrides
  };
}

test("managed Usage Collector plans are deterministic, clone-local, Console-free, and shell-free", async (context) => {
  const state = await fixture(context);
  const options = planOptions(state);
  const first = await planLocalObserverService(state.target, options);
  const second = await planLocalObserverService(state.target, options);
  assert.equal(first.plan_digest, second.plan_digest);
  assert.equal(first.status, "ready");
  assert.equal(first.service.program, "/opt/temple test/node");
  assert.deepEqual(first.service.arguments.slice(0, 2), ["/opt/temple test/node", path.join(state.target, "templew.mjs")]);
  assert.deepEqual(first.service.arguments.slice(2, 5), ["usage", "collect", state.target]);
  assert.ok(first.service.arguments.includes("managed-local"));
  assert.equal(first.service.console_started, false);
  assert.equal(first.service.http_listener_started, false);
  assert.equal(first.service.arguments.includes("control-plane"), false);
  assert.equal(first.service.arguments.includes("--host"), false);
  assert.equal(first.service.arguments.includes("--port"), false);
  assert.equal(first.service.arguments.includes("--lan-viewer-host"), false);
  assert.match(first.service.label, /^dev\.temple\.usage-collector\./);
  assert.doesNotMatch(first.plist, /<key>Program<\/key>|sh -c|bash -c/);
  assert.match(first.plist, /<key>ProgramArguments<\/key>/);
  assert.equal(git(state.target, ["status", "--porcelain"]).stdout, "");

  const unsupported = await planLocalObserverService(state.target, {
    ...options,
    platform: "linux"
  });
  assert.equal(unsupported.status, "unsupported-platform");
  assert.equal(unsupported.supported, false);
  await assert.rejects(() => fs.access(path.join(state.userHome, "Library", "LaunchAgents")));
});

test("apply, replacement, status, and removal require exact explicit authority", async (context) => {
  const state = await fixture(context);
  const options = planOptions(state);
  const plan = await planLocalObserverService(state.target, options);
  const installed = await applyLocalObserverService(state.target, {
    ...options,
    expectedPlan: plan.plan_digest,
    now: "2026-09-02T01:00:00.000Z"
  });
  assert.equal(installed.service_status, "installed");
  const manifest = await readLocalObserverManifest(state.stateDirectory);
  assert.equal(manifest.plan_digest, plan.plan_digest);
  assert.equal(manifest.activated, false);
  assert.deepEqual(manifest.privacy, {
    credentials_retained: false,
    prompts_retained: false,
    responses_retained: false,
    hidden_reasoning_retained: false
  });
  const repeated = await applyLocalObserverService(state.target, {
    ...options,
    expectedPlan: plan.plan_digest,
    now: "2026-09-02T02:00:00.000Z"
  });
  assert.equal(repeated.unchanged, true);
  assert.equal((await readLocalObserverManifest(state.stateDirectory)).applied_at, "2026-09-02T01:00:00.000Z");
  const status = await inspectLocalObserverService(state.target, { stateDirectory: state.stateDirectory });
  assert.equal(status.observation_mode, "managed-local");
  assert.equal(status.service_status, "installed");
  const projection = await localObservationContext(state.target, state.stateDirectory, {
    mode: "managed-local",
    startedAt: "2026-09-02T03:00:00.000Z",
    platform: "darwin"
  });
  assert.deepEqual(Object.keys(projection).sort(), [
    "continuous_expected",
    "mode",
    "platform",
    "service_status",
    "started_at"
  ]);
  assert.doesNotMatch(JSON.stringify(projection), /\/opt\/temple test|LaunchAgents|observer-service\.json/);

  const changed = planOptions(state, { codexCommand: "/opt/temple test/codex-v2" });
  const changedPlan = await planLocalObserverService(state.target, changed);
  await assert.rejects(
    () => applyLocalObserverService(state.target, { ...changed, expectedPlan: changedPlan.plan_digest }),
    /confirm-replace/
  );
  await assert.rejects(
    () => removeLocalObserverService(state.target, { stateDirectory: state.stateDirectory, expectedPlan: plan.plan_digest }),
    /confirm-delete/
  );
  const removed = await removeLocalObserverService(state.target, {
    stateDirectory: state.stateDirectory,
    expectedPlan: plan.plan_digest,
    confirmDelete: true
  });
  assert.equal(removed.retained_telemetry, true);
  await assert.rejects(() => fs.access(installed.plist_path));
  assert.equal(git(state.target, ["status", "--porcelain"]).stdout, "");
});

test("activation invokes exact launchctl arguments and rolls files back on failure", async (context) => {
  const state = await fixture(context);
  const options = planOptions(state);
  const plan = await planLocalObserverService(state.target, options);
  const calls = [];
  const runLaunchctl = async (args) => {
    calls.push(args);
    if (args[0] === "kickstart") throw new Error("fixture kickstart failure");
    return { stdout: "" };
  };
  await assert.rejects(
    () => applyLocalObserverService(state.target, {
      ...options,
      expectedPlan: plan.plan_digest,
      activate: true,
      uid: 501,
      runLaunchctl
    }),
    /rolled back.*fixture kickstart failure/
  );
  assert.deepEqual(calls[0], ["bootstrap", "gui/501", plan.service.plist_path]);
  assert.deepEqual(calls[1], ["kickstart", "-k", `gui/501/${plan.service.label}`]);
  await assert.rejects(() => fs.access(plan.service.plist_path));
  await assert.rejects(() => fs.access(plan.service.manifest_path));
});

test("an active managed service cannot be replaced without explicit activation authority", async (context) => {
  const state = await fixture(context);
  const options = planOptions(state);
  const plan = await planLocalObserverService(state.target, options);
  const calls = [];
  const runLaunchctl = async (args) => {
    calls.push(args);
    return { stdout: "" };
  };
  await applyLocalObserverService(state.target, {
    ...options,
    expectedPlan: plan.plan_digest,
    activate: true,
    uid: 501,
    runLaunchctl
  });
  const changed = planOptions(state, { codexCommand: "/opt/temple test/codex-v2" });
  const changedPlan = await planLocalObserverService(state.target, changed);
  await assert.rejects(
    () => applyLocalObserverService(state.target, {
      ...changed,
      expectedPlan: changedPlan.plan_digest,
      confirmReplace: true,
      uid: 501,
      runLaunchctl
    }),
    /active Usage Collector requires --activate/
  );
  await removeLocalObserverService(state.target, {
    stateDirectory: state.stateDirectory,
    expectedPlan: plan.plan_digest,
    confirmDelete: true,
    uid: 501,
    runLaunchctl
  });
  assert.ok(calls.some((args) => args[0] === "bootstrap"));
  assert.ok(calls.some((args) => args[0] === "bootout"));
});

test("the CLI completes the exact collector-only macOS service lifecycle", async (context) => {
  const state = await fixture(context);
  const common = [
    state.target,
    "--state-dir", state.stateDirectory,
    "--codex-command", process.execPath,
    "--json"
  ];
  const preview = run(["control-plane", "observer-plan", ...common]);
  if (process.platform !== "darwin") {
    assert.equal(preview.status, 1, preview.stderr || preview.stdout);
    const unsupported = JSON.parse(preview.stdout);
    assert.equal(unsupported.status, "unsupported-platform");
    assert.equal(unsupported.supported, false);
    assert.equal(unsupported.platform, process.platform);
    assert.equal(unsupported.observation_mode, "managed-local");
    await assert.rejects(() => fs.access(path.join(state.stateDirectory, "observer-service.json")));
    await assert.rejects(() => fs.access(path.join(state.userHome, "Library", "LaunchAgents")));
    return;
  }
  assert.equal(preview.status, 0, preview.stderr || preview.stdout);
  const plan = JSON.parse(preview.stdout);
  const applied = run(["control-plane", "observer-apply", ...common, "--expected-plan", plan.plan_digest]);
  assert.equal(applied.status, 0, applied.stderr || applied.stdout);
  assert.equal(JSON.parse(applied.stdout).activated, false);
  const status = run(["control-plane", "observer-status", state.target, "--state-dir", state.stateDirectory, "--json"]);
  assert.equal(status.status, 0, status.stderr || status.stdout);
  assert.equal(JSON.parse(status.stdout).observation_mode, "managed-local");
  const removed = run([
    "control-plane", "observer-remove", state.target,
    "--state-dir", state.stateDirectory,
    "--expected-plan", plan.plan_digest,
    "--confirm-delete",
    "--json"
  ]);
  assert.equal(removed.status, 0, removed.stderr || removed.stdout);
  assert.equal(JSON.parse(removed.stdout).retained_telemetry, true);
});
