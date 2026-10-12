import assert from "node:assert/strict";
import { TEMPLATE_VERSION } from "../src/constants.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ingestControlPlaneFixture,
  inspectControlPlane,
  rebuildControlPlane,
  startControlPlaneServer
} from "../src/control-plane-server.mjs";
import {
  acquireControlPlaneLease,
  openTelemetryJournal,
  resolveControlPlaneStateDirectory
} from "../src/telemetry.mjs";
import { defaultControlPlaneConfig, validateControlPlaneConfig } from "../src/control-plane-config.mjs";
import {
  agentModelStatus,
  createRefreshCoordinator,
  normalizeDashboardAttention,
  renderControlPlaneDashboard
} from "../src/control-plane-dashboard.mjs";

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
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-control-plane-test-"));
  const target = path.join(temporaryRoot, "control-product");
  const configPath = path.join(temporaryRoot, "init.json");
  const stateDirectory = path.join(temporaryRoot, "runtime-state");
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  await writeJson(configPath, {
    schema_version: "temple.init/v1",
    project: { id: "control-product", name: "Control Product" },
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
  return { temporaryRoot, target, stateDirectory };
}

function event(id, data = {}) {
  return {
    id,
    source: "urn:temple:provider:fixture:test",
    type: "org.temple.fixture.updated.v1",
    subject: "project/control-product/work-item/WI-0001",
    time: "2026-08-30T00:00:00.000Z",
    data
  };
}

test("Team model status keeps active, observed, requested, and unknown evidence distinct", () => {
  const snapshot = {
    live_observer: {
      work: {
        items: [
          {
            id: "WI-1000",
            tasks: [{
              id: "task-history",
              agent_id: "agent-rikku",
              visibility: "history-only",
              observed_status: "completed",
              requested_model: "gpt-5.6-terra",
              reasoning_effort: "high",
              freshness: { observed_at: "2026-08-30T10:00:00.000Z" }
            }]
          },
          {
            id: "WI-1001",
            tasks: [{
              id: "task-live",
              agent_id: "agent-rikku",
              visibility: "live",
              observed_status: "in-progress",
              requested_model: "gpt-5.6-terra",
              effective_model: "gpt-5.6-sol",
              requested_reasoning_effort: "max",
              observed_thread_reasoning_effort: "xhigh",
              effective_turn_reasoning_effort: null,
              reasoning_effort: "xhigh",
              reasoning_effort_source: "provider-thread",
              freshness: { observed_at: "2026-08-31T10:00:00.000Z" }
            }]
          },
          {
            id: "WI-1002",
            tasks: [{
              id: "task-requested",
              agent_id: "agent-yuna",
              visibility: "registered-only",
              observed_status: "unknown",
              requested_model: "gpt-5.6-luna",
              requested_reasoning_effort: "max",
              reasoning_effort: "max"
            }]
          },
          {
            id: "WI-1003",
            tasks: [{
              id: "task-unknown",
              agent_id: "agent-lulu",
              visibility: "history-only",
              observed_status: "completed"
            }]
          }
        ]
      }
    },
    usage: {
      driver_groups: [{
        dimensions: { task_id: "task-history", model: "gpt-5.6-luna", reasoning_effort: "max" },
        last_observed_at: "2026-08-30T10:00:00.000Z"
      }]
    }
  };

  assert.deepEqual(agentModelStatus(snapshot, "agent-rikku"), {
    state: "active",
    label: "Active model",
    model: "gpt-5.6-sol",
    requested_model: "gpt-5.6-terra",
    model_version: null,
    requested_reasoning_effort: "max",
    observed_thread_reasoning_effort: "xhigh",
    effective_turn_reasoning_effort: null,
    reasoning_effort: "xhigh",
    reasoning_effort_source: "provider-thread",
    work_item_id: "WI-1001",
    task_id: "task-live",
    observed_at: "2026-08-31T10:00:00.000Z"
  });
  assert.equal(agentModelStatus(snapshot, "agent-yuna").state, "requested");
  assert.equal(agentModelStatus(snapshot, "agent-yuna").label, "Requested model");
  assert.deepEqual(agentModelStatus(snapshot, "agent-lulu"), {
    state: "unknown",
    label: "No model observation",
    model: null,
    requested_model: null,
    model_version: null,
    requested_reasoning_effort: null,
    observed_thread_reasoning_effort: null,
    effective_turn_reasoning_effort: null,
    reasoning_effort: null,
    reasoning_effort_source: "unknown",
    work_item_id: null,
    task_id: null,
    observed_at: null
  });

  snapshot.live_observer.work.items[1].tasks[0].visibility = "history-only";
  assert.equal(agentModelStatus(snapshot, "agent-rikku").state, "observed");
  assert.equal(agentModelStatus(snapshot, "agent-rikku").label, "Last observed");
});

test("Dashboard refresh coordination coalesces replay bursts without concurrent snapshot loads", async () => {
  let calls = 0;
  let active = 0;
  let maximumActive = 0;
  const releases = [];
  const scheduled = [];
  const coordinator = createRefreshCoordinator(async () => {
    calls += 1;
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => releases.push(resolve));
    active -= 1;
  }, (callback) => scheduled.push(callback));

  const initial = coordinator.load();
  for (let index = 0; index < 2_000; index += 1) coordinator.scheduleLoad();
  assert.equal(calls, 1);
  assert.equal(maximumActive, 1);
  assert.equal(scheduled.length, 0);

  releases.shift()();
  while (calls < 2) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.equal(maximumActive, 1);
  releases.shift()();
  await initial;
  assert.equal(active, 0);

  let idleCalls = 0;
  const idleScheduled = [];
  const idleCoordinator = createRefreshCoordinator(async () => {
    idleCalls += 1;
  }, (callback) => idleScheduled.push(callback));
  for (let index = 0; index < 2_000; index += 1) idleCoordinator.scheduleLoad();
  assert.equal(idleScheduled.length, 1);
  idleScheduled.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(idleCalls, 1);
});

test("Dashboard attention groups firing stale evidence ahead of release bookkeeping", () => {
  const attention = normalizeDashboardAttention({
    observerAttention: [{ type: "approval_pending", work_item_id: "WI-0099", message: "Release decision" }],
    conditions: [
      ...Array.from({ length: 10 }, (_, index) => ({
        type: "stale-evidence",
        lifecycle: "firing",
        status: "true",
        work_item_id: `WI-${String(index + 1).padStart(4, "0")}`
      })),
      {
        type: "provider-offline",
        lifecycle: "firing",
        status: "true",
        message: "Provider needs recovery",
        suggested_action: "Review provider"
      }
    ],
    inbox: { runtime_permissions: [{ request_id: "request-1" }] }
  });

  assert.deepEqual(attention.map((item) => item.type), ["runtime_permission", "stale_evidence", "provider-offline"]);
  assert.equal(attention[1].count, 10);
  assert.equal(attention[1].label, "10 verification records need refreshing");
  assert.equal(attention[1].jump_view, "system");
  assert.match(attention[1].message, /no longer prove the current revision/);
});

test("telemetry journal redacts secrets, deduplicates stable identities, retains cursors, and excludes a second writer", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-journal-test-"));
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const lease = await acquireControlPlaneLease(temporaryRoot);
  await assert.rejects(() => acquireControlPlaneLease(temporaryRoot), /already running/);
  const journal = await openTelemetryJournal(temporaryRoot, {
    maxEvents: 2,
    privacy: { max_data_bytes: 4096, redact_keys: ["token", "password"] }
  });
  const first = await journal.append(event("event-1", {
    authorization: "Bearer live-secret-value",
    nested: { password: "do-not-store", message: "safe" }
  }));
  assert.equal(first.duplicate, false);
  assert.equal(first.record.data.authorization, "[REDACTED]");
  assert.equal(first.record.data.nested.password, "[REDACTED]");
  assert.equal(first.record.data.nested.message, "safe");
  const duplicate = await journal.append(event("event-1", {
    authorization: "Bearer another-value",
    nested: { password: "different", message: "safe" }
  }));
  assert.equal(duplicate.duplicate, true);
  await assert.rejects(() => journal.append(event("event-1", { status: "different" })), /identity collision/);
  await journal.append(event("event-2", { status: "active" }));
  await journal.append(event("event-3", { status: "completed" }));
  assert.deepEqual(journal.snapshot(), {
    schema_version: "temple.control-plane-checkpoint/v1",
    first_cursor: 2,
    last_cursor: 3,
    retained_events: 2
  });
  assert.equal(journal.readAfter(0).reset_required, true);
  assert.deepEqual(journal.readAfter(2).records.map((record) => record.id), ["event-3"]);
  await journal.close();
  await lease.release();
});

test("telemetry journal serializes concurrent appends, duplicate identities, failures, and close", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-journal-concurrency-test-"));
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const journal = await openTelemetryJournal(temporaryRoot, { maxEvents: 1000 });
  const observedCursors = [];
  journal.subscribe((record) => observedCursors.push(record.templecursor));

  const burst = await Promise.all(Array.from({ length: 64 }, (_, index) =>
    journal.append(event(`burst-${String(index + 1).padStart(3, "0")}`, { index }))
  ));
  assert.deepEqual(burst.map((result) => result.record.templecursor),
    Array.from({ length: 64 }, (_, index) => index + 1));

  const duplicateEvent = event("burst-duplicate", { status: "same" });
  const duplicateResults = await Promise.all([
    journal.append(duplicateEvent),
    journal.append(duplicateEvent)
  ]);
  assert.deepEqual(duplicateResults.map((result) => result.duplicate), [false, true]);
  assert.equal(duplicateResults[0].record.templecursor, 65);
  assert.equal(duplicateResults[1].record.templecursor, 65);

  await assert.rejects(
    () => journal.append(event("burst-duplicate", { status: "different" })),
    /identity collision/
  );
  const acceptedBeforeClose = journal.append(event("accepted-before-close", { status: "completed" }));
  const closing = journal.close();
  assert.equal((await acceptedBeforeClose).record.templecursor, 66);
  await closing;
  await assert.rejects(() => journal.append(event("after-close")), /closed telemetry journal/);

  assert.deepEqual(observedCursors, Array.from({ length: 66 }, (_, index) => index + 1));
  const reopened = await openTelemetryJournal(temporaryRoot, { readOnly: true });
  assert.deepEqual(reopened.snapshot(), {
    schema_version: "temple.control-plane-checkpoint/v1",
    first_cursor: 1,
    last_cursor: 66,
    retained_events: 66
  });
  assert.deepEqual(reopened.readAfter(0).records.map((record) => record.templecursor),
    Array.from({ length: 66 }, (_, index) => index + 1));
  await reopened.close();
});

test("linked worktrees resolve one generated control-plane state directory", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-worktree-state-test-"));
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const repository = path.join(temporaryRoot, "repository");
  const linked = path.join(temporaryRoot, "linked");
  await fs.mkdir(repository);
  assert.equal(git(repository, ["init", "-q"]).status, 0);
  assert.equal(git(repository, ["config", "user.email", "temple-tests@example.invalid"]).status, 0);
  assert.equal(git(repository, ["config", "user.name", "Temple Tests"]).status, 0);
  await fs.writeFile(path.join(repository, "README.md"), "fixture\n");
  assert.equal(git(repository, ["add", "."]).status, 0);
  assert.equal(git(repository, ["commit", "-qm", "initial"]).status, 0);
  assert.equal(git(repository, ["worktree", "add", "-q", "-b", "linked-test", linked]).status, 0);
  assert.equal(resolveControlPlaneStateDirectory(repository), resolveControlPlaneStateDirectory(linked));
  assert.match(resolveControlPlaneStateDirectory(repository), /\.git\/temple\/control-plane$/);
});

test("init installs the safe control-plane config and fixture ingestion is replay-safe", async (context) => {
  const { temporaryRoot, target, stateDirectory } = await fixture(context);
  const config = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/control-plane.json"), "utf8"));
  assert.equal(config.schema_version, "temple.control-plane-config/v1");
  assert.equal(config.server.host, "127.0.0.1");
  assert.equal(config.privacy.capture_raw_payloads, false);
  assert.equal(config.alerts.stalled_after_ms, 300000);
  const lock = JSON.parse(await fs.readFile(path.join(target, "temple.lock"), "utf8"));
  assert.equal(lock.capabilities.local_telemetry_journal, true);
  assert.equal(lock.capabilities.control_plane_http_sse, true);
  assert.equal(lock.capabilities.live_observer, true);
  assert.equal(lock.capabilities.codex_app_server_adapter, true);
  assert.equal(lock.capabilities.control_plane_conditions, true);
  assert.equal(lock.capabilities.human_inbox, true);
  assert.equal(lock.capabilities.inbox_command_gateway, true);
  assert.equal(lock.capabilities.github_pr_checks_provider, true);
  assert.equal(lock.capabilities.github_evidence_capture, true);

  const fixturePath = path.join(temporaryRoot, "provider-fixture.json");
  await writeJson(fixturePath, {
    schema_version: "temple.provider-fixture/v1",
    provider_id: "fixture-alpha",
    observed_at: "2026-08-30T00:00:01.000Z",
    events: [event("fixture-event", { status: "active", token: "never-store" })]
  });
  const first = await ingestControlPlaneFixture(target, fixturePath, { stateDirectory });
  const second = await ingestControlPlaneFixture(target, fixturePath, { stateDirectory });
  assert.equal(first.result.appended, 1);
  assert.equal(second.result.duplicates, 1);
  const snapshot = (await inspectControlPlane(target, { stateDirectory })).snapshot;
  assert.equal(snapshot.authority.telemetry_satisfies_gates, false);
  assert.ok(snapshot.providers.providers.some((provider) => provider.id === "fixture-alpha"));
  assert.equal(snapshot.recent_events.find((entry) => entry.id === "fixture-event").data.token, "[REDACTED]");
});

test("upgrade seeds missing project-owned control-plane configuration without managing later changes", async (context) => {
  const { target } = await fixture(context);
  const configPath = path.join(target, ".ai-org/project/control-plane.json");
  const lockPath = path.join(target, "temple.lock");
  const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  lock.template.version = "0.1.0-alpha.19";
  for (const capability of [
    "control_plane_config",
    "telemetry_event_envelope",
    "local_telemetry_journal",
    "provider_capability_contract",
    "repository_telemetry_provider",
    "fixture_telemetry_provider",
    "control_plane_http_sse"
  ]) delete lock.capabilities[capability];
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  await fs.rm(configPath);
  const upgraded = run(["upgrade", target]);
  assert.equal(upgraded.status, 0, upgraded.stderr || upgraded.stdout);
  const upgradedLock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  assert.equal(upgradedLock.template.version, TEMPLATE_VERSION);
  assert.equal(upgradedLock.capabilities.local_telemetry_journal, true);
  assert.equal(upgradedLock.capabilities.live_observer, true);
  assert.ok(!upgradedLock.managed_files.some((entry) => entry.path === ".ai-org/project/control-plane.json"));
  const projectConfig = JSON.parse(await fs.readFile(configPath, "utf8"));
  projectConfig.retention.max_events = 250;
  await fs.writeFile(configPath, `${JSON.stringify(projectConfig, null, 4)}\n`);
  const before = await fs.readFile(configPath, "utf8");
  const current = run(["upgrade", target]);
  assert.equal(current.status, 0, current.stderr || current.stdout);
  assert.equal(await fs.readFile(configPath, "utf8"), before);
});

test("HTTP snapshot and SSE replay expose local events while arbitrary mutation stays unavailable", async (context) => {
  const { target, stateDirectory } = await fixture(context);
  const controlPlane = await startControlPlaneServer(target, {
    stateDirectory,
    port: 0,
    repositoryIntervalMs: 50
  });
  context.after(() => controlPlane.close());
  const initialResponse = await fetch(`${controlPlane.url}/api/v1/snapshot`);
  assert.equal(initialResponse.status, 200);
  const initial = await initialResponse.json();
  assert.equal(initial.schema_version, "temple.control-plane-snapshot/v1");
  assert.equal(initial.usage.schema_version, "temple.usage-baseline/v1");
  assert.equal(initial.usage.baseline_status, "insufficient-data");
  assert.equal(initial.usage.totals.total_tokens, null);
  assert.equal(initial.usage.source.capture_health.status, "not-capturing");
  assert.equal(initial.usage.source.capture_health.observations, 0);
  assert.equal(initial.usage.source.longitudinal_coverage.qualification.status, "not-qualified");
  assert.equal(initial.usage.canonical_state_changed, false);
  const cursor = initial.journal.last_cursor;
  const appended = await controlPlane.journal.append(event("sse-event", { status: "active" }));
  assert.equal(appended.record.templecursor, cursor + 1);
  await controlPlane.journal.append({
    id: "usage-observation",
    source: "urn:temple:provider:codex-local",
    type: "org.temple.codex.usage.updated.v1",
    subject: "project/control-product/task/task-unregistered",
    time: "2026-08-30T00:00:02.000Z",
    data: {
      raw_prompt: "must-not-enter-the-usage-projection",
      attribution: {
        project_id: "control-product",
        work_item_id: "WI-unregistered",
        position_id: "developer",
        lifecycle_stage: "build",
        task_id: "task-unregistered",
        attempt_id: "attempt-1",
        provider_id: "codex-local",
        model: "fixture-model",
        model_version: "fixture-model-1",
        reasoning_effort: "medium",
        service_tier: "fixture",
        context_capsule_digest: "sha256:fixture-context",
        capability_set_digest: "sha256:fixture-capabilities",
        outcome: "observed"
      },
      usage: {
        last: {
          input_tokens: 100,
          cached_input_tokens: 25,
          output_tokens: 40,
          reasoning_output_tokens: 10,
          total_tokens: 175
        }
      }
    }
  });
  const observedUsage = (await (await fetch(`${controlPlane.url}/api/v1/snapshot`)).json()).usage;
  assert.equal(observedUsage.baseline_status, "observed");
  assert.equal(observedUsage.totals.total_tokens, 175);
  assert.equal(observedUsage.source.capture_health.status, "historical-only");
  assert.equal(observedUsage.source.capture_health.last_observed_at, observedUsage.driver_groups[0].last_observed_at);
  assert.equal(observedUsage.driver_groups[0].dimensions.model, "fixture-model");
  assert.equal(observedUsage.source.longitudinal_coverage.detailed_token_observation_coverage.uncorrelated_observations, 1);
  assert.doesNotMatch(JSON.stringify(observedUsage), /must-not-enter-the-usage-projection/);

  const controller = new AbortController();
  const response = await fetch(`${controlPlane.url}/api/v1/events?after=${cursor}`, { signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + 2000;
  while (!text.includes("sse-event") && Date.now() < deadline) {
    const next = await Promise.race([
      reader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("SSE replay timed out")), 500))
    ]);
    if (next.done) break;
    text += decoder.decode(next.value, { stream: true });
  }
  controller.abort();
  await reader.cancel().catch(() => {});
  assert.match(text, new RegExp(`id: ${cursor + 1}`));
  assert.equal((text.match(/sse-event/g) ?? []).length, 1);

  const mutation = await fetch(`${controlPlane.url}/api/v1/snapshot`, { method: "POST" });
  assert.equal(mutation.status, 405);
  assert.equal((await mutation.json()).error, "Phase 3C accepts mutations only through bounded Human Inbox routes");
  await controlPlane.close();
});

test("HTTP becomes available before a slow Codex history reconciliation completes", async (context) => {
  const { temporaryRoot, target, stateDirectory } = await fixture(context);
  const created = run([
    "work-item", "create", target,
    "--title", "Slow provider fixture",
    "--scope", "Prove HTTP-first startup",
    "--acceptance", "Health remains responsive",
    "--affected-path", "src/control-plane",
    "--ui-mode", "not-applicable",
    "--json"
  ]);
  assert.equal(created.status, 0, created.stderr || created.stdout);
  const workItemId = JSON.parse(created.stdout).item.id;
  const registered = run([
    "task", "register", target,
    "--work-item", workItemId,
    "--position", "developer",
    "--thread-id", "thread-slow-001",
    "--revision", "a".repeat(40),
    "--json"
  ]);
  assert.equal(registered.status, 0, registered.stderr || registered.stdout);
  const fakeServer = path.join(temporaryRoot, "slow-app-server.mjs");
  await fs.writeFile(fakeServer, `
    import readline from "node:readline";
    const input=readline.createInterface({input:process.stdin});
    const send=(value)=>process.stdout.write(JSON.stringify(value)+"\\n");
    input.on("line",line=>{const message=JSON.parse(line);if(message.method==="initialize")send({jsonrpc:"2.0",id:message.id,result:{serverInfo:{version:"slow-fixture"}}});});
  `);
  const startedAt = Date.now();
  const controlPlane = await startControlPlaneServer(target, {
    stateDirectory,
    port: 0,
    repositoryIntervalMs: 50,
    enableCodex: true,
    codexCommand: process.execPath,
    codexCommandArgs: [fakeServer],
    resumeCodexThreads: false
  });
  context.after(() => controlPlane.close());
  assert.ok(Date.now() - startedAt < 1000, "server startup waited for Codex history reconciliation");
  assert.ok(controlPlane.codexStartup instanceof Promise);
  const health = await fetch(`${controlPlane.url}/healthz`);
  const snapshot = await fetch(`${controlPlane.url}/api/v1/snapshot`);
  assert.equal(health.status, 200);
  assert.equal(snapshot.status, 200);
  assert.equal((await snapshot.json()).schema_version, "temple.control-plane-snapshot/v1");
  await controlPlane.close();
});

test("Codex history bounds are validated and Temple Workspace exposes terminal work", () => {
  const config = defaultControlPlaneConfig();
  config.providers.push({
    id: "codex-local",
    kind: "codex-app-server",
    enabled: true,
    options: {
      resume_threads: false,
      history_turn_limit: 20,
      history_item_limit: 200
    }
  });
  assert.deepEqual(validateControlPlaneConfig(config), { valid: true, errors: [] });
  config.providers[1].options.history_item_limit = 1001;
  config.providers[1].options.unknown_option = true;
  const invalid = validateControlPlaneConfig(config);
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join("\n"), /history_item_limit/);
  assert.match(invalid.errors.join("\n"), /unsupported fields/);
  const html = renderControlPlaneDashboard("Fixture Project");
  const scripts = [...html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(scripts.length >= 2);
  for (const script of scripts) assert.doesNotThrow(() => new Function(script));
  assert.match(html, /Terminal/);
  assert.match(html, /History only/);
  assert.match(html, /badge\.terminal/);
  assert.match(html, /badge\.history-only/);
  assert.match(html, /data-nav-target="now"/);
  assert.match(html, /data-nav-target="organization"/);
  assert.match(html, /data-nav-target="execution"/);
  assert.match(html, /data-nav-target="usage"/);
  assert.match(html, /data-nav-target="system"/);
  assert.match(html, /data-nav-target="history"/);
  assert.match(html, /Temple Workspace/);
  assert.match(html, /Who is responsible, and with what authority\?/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /Responsibilities/);
  assert.match(html, /People &amp; Agents/);
  assert.match(html, /Authority/);
  assert.match(html, /Active model/);
  assert.match(html, /Last observed/);
  assert.match(html, /Requested model/);
  assert.match(html, /No model observation/);
  assert.match(html, /No task-level model evidence is available/);
  assert.match(html, /Requested turn ·/);
  assert.match(html, /Thread reported ·/);
  assert.match(html, /Effective turn ·/);
  assert.match(html, /organizationMode="responsibilities"/);
  assert.match(html, /Product & Experience/);
  assert.match(html, /Engineering Delivery/);
  assert.match(html, /Assurance & Release/);
  assert.match(html, /Additional responsibilities/);
  assert.match(html, /Eligible pool/);
  assert.doesNotMatch(html, /Owns business authority and approval boundaries/);
  assert.match(html, /Independent delivery check/);
  assert.match(html, /What is being delivered\?/);
  assert.match(html, /Search by Work Item or title/);
  assert.match(html, /Observed execution map/);
  assert.match(html, /data-icon="overview"/);
  assert.match(html, /data-icon="team"/);
  assert.doesNotMatch(html, /<span class="nav-icon">0[1-6]<\/span>/);
  assert.match(html, /routeToView=\{overview:"now",team:"organization",work:"execution"/);
  assert.match(html, /temple-workspace-theme/);
  assert.match(html, /dataset\.theme="dark"/);
  assert.match(html, /@container workspace/);
  assert.match(html, /max-width:1199px/);
  assert.match(html, /\.nav-item \.nav-count\{position:absolute;top:4px;right:3px/);
  assert.match(html, /max-width:759px/);
  assert.match(html, /renderOrganization\(snapshot\)/);
  assert.match(html, /filter\(hasLiveExecution\)/);
  assert.match(html, /No claimed or currently observed execution/);
  assert.match(html, /work-row-button/);
  assert.match(html, /work-detail/);
  assert.match(html, /Waiting for release decision/);
  assert.match(html, /Release review/);
  assert.match(html, /effectiveWorkState\(item\)==="release_gate"\?"Release review":workStageLabel\(effectiveWorkState\(item\)\)/);
  assert.match(html, /verification record/);
  assert.match(html, /Token anomaly monitoring is not configured/);
  assert.match(html, /scrollTo\(0,0\)/);
  assert.match(html, /workTableStatusBadge/);
  assert.match(html, /@container workspace \(max-width:1279px\)/);
  assert.match(html, /#view-now \.metrics\.compact\{margin-bottom:24px\}/);
  assert.match(html, /#view-now #now-summary\+#attention\{margin-top:18px\}/);
  assert.match(html, /#view-now \.attention-more\{grid-column:1\/-1/);
  assert.match(html, /Technical details/);
  assert.match(html, /Effective workspace configuration/);
  assert.match(html, /Execution routing/);
  assert.match(html, /Per-step capability and execution policy/);
  assert.match(html, /human or coordinator applies/);
  assert.match(html, /Resolution is read only and does not contact a Provider/);
  assert.match(html, /Model calibration/);
  assert.match(html, /data-system-mode="configuration"/);
  assert.match(html, /This measures captured project work, not your whole account/);
  assert.match(html, /The capture status below explains whether new work can be observed now/);
  assert.match(html, /Historical data only/);
  assert.match(html, /Ready for the next registered task/);
  assert.match(html, /Token capture is off/);
  assert.match(html, /Completed work/);
  assert.match(html, /Eligible live tasks/);
  assert.doesNotMatch(html, /Scenario: worker running|WI-0077 design preview/);
  assert.match(html, /Last updated /);
  assert.match(html, /Updates delayed/);
  assert.doesNotMatch(html, /Snapshot current|Queued and waiting|Live updates/);
  assert.doesNotMatch(html, /id="dashboard-alert"|id="generated"/);
  assert.match(html, /governanceDecisions/);
  assert.match(html, /No detailed Token observations yet/);
  assert.match(html, /formatUsageNumber/);
  assert.match(html, /Token totals include/);
  assert.match(html, /Historical coverage is partial/);
  assert.match(html, /automatic model switching remain unavailable/);
  assert.match(html, /createRefreshCoordinator/);
  assert.match(html, /events\.onmessage=scheduleLoad/);
  assert.doesNotMatch(html, /events\.onmessage=load/);
});

test("rebuild preserves the previous journal and reconstructs canonical repository events", async (context) => {
  const { target, stateDirectory } = await fixture(context);
  const created = run([
    "work-item", "create", target,
    "--title", "Rebuild telemetry",
    "--scope", "Create one canonical event",
    "--acceptance", "Event is recoverable",
    "--affected-path", "src/control-plane",
    "--ui-mode", "not-applicable"
  ]);
  assert.equal(created.status, 0, created.stderr || created.stdout);
  const fixturePath = path.join(path.dirname(stateDirectory), "one-event.json");
  await writeJson(fixturePath, {
    schema_version: "temple.provider-fixture/v1",
    provider_id: "fixture-rebuild",
    events: [
      event("transient-only", { status: "active" }),
      {
        id: "provider-usage-only",
        source: "urn:temple:provider:fixture:rebuild",
        type: "org.temple.codex.usage.updated.v1",
        subject: "project/control-product/work-item/WI-0001",
        time: "2026-08-30T00:00:00.000Z",
        data: {
          project_id: "control-product",
          work_item_id: "WI-0001",
          task_id: "task-provider-only",
          scope_revision: "provider-only-revision",
          attribution: {
            project_id: "control-product",
            work_item_id: "WI-0001",
            position_id: "developer",
            lifecycle_stage: "build",
            task_id: "task-provider-only",
            attempt_id: "turn-provider-only",
            provider_id: "fixture-rebuild",
            model: "gpt-5.6-luna",
            model_version: null,
            reasoning_effort: "max",
            service_tier: null,
            context_capsule_digest: null,
            capability_set_digest: null,
            outcome: "completed"
          },
          usage: {
            total: { input_tokens: 90, cached_input_tokens: 10, output_tokens: 20, reasoning_output_tokens: 5, total_tokens: 125 },
            last: { input_tokens: 90, cached_input_tokens: 10, output_tokens: 20, reasoning_output_tokens: 5, total_tokens: 125 },
            model_context_window: 10000
          }
        }
      }
    ]
  });
  await ingestControlPlaneFixture(target, fixturePath, { stateDirectory });
  const rebuilt = await rebuildControlPlane(target, { stateDirectory });
  assert.ok(rebuilt.archivePath);
  assert.equal(await fs.readFile(rebuilt.archivePath, "utf8").then((value) => value.includes("transient-only")), true);
  assert.ok(rebuilt.repository.source_events >= 1);
  assert.ok(rebuilt.snapshot.recent_events.some((entry) => entry.source.startsWith("urn:temple:repository:")));
  assert.ok(!rebuilt.snapshot.recent_events.some((entry) => entry.id === "transient-only"));
  assert.ok(!rebuilt.snapshot.recent_events.some((entry) => entry.id === "provider-usage-only"));
  assert.equal(rebuilt.snapshot.usage.totals.total_tokens, 125);
  assert.equal(rebuilt.snapshot.usage.source.history.archived_observations_included, 1);
  assert.equal(rebuilt.snapshot.usage.source.history.archive_mutation_performed, false);
});
