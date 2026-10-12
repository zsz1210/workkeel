import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { renderControlPlaneDashboard } from "../src/control-plane-dashboard.mjs";
import {
  managementConsoleSnapshot,
  startManagementConsoleServer
} from "../src/management-console-server.mjs";
import { inspectLocalObserverService } from "../src/local-observer-service.mjs";
import { acquireControlPlaneLease } from "../src/telemetry.mjs";
import { startUsageCollector } from "../src/usage-collector.mjs";

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
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-optional-console-test-"));
  const target = path.join(temporaryRoot, "optional-product");
  const configPath = path.join(temporaryRoot, "init.json");
  const stateDirectory = path.join(temporaryRoot, "runtime-state");
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }));
  await writeJson(configPath, {
    schema_version: "temple.init/v1",
    project: { id: "optional-product", name: "Optional Product" },
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
  return { target, stateDirectory };
}

async function fileSize(targetPath) {
  try {
    return (await fs.stat(targetPath)).size;
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
}

async function* refreshEvents(body) {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of body) {
    pending += decoder.decode(chunk, { stream: true });
    let boundary;
    while ((boundary = pending.indexOf("\n\n")) !== -1) {
      const frame = pending.slice(0, boundary);
      pending = pending.slice(boundary + 2);
      if (!/^event: temple\.refresh$/m.test(frame)) continue;
      const data = /^data: (.+)$/m.exec(frame);
      assert.ok(data, "refresh includes its revision data");
      yield JSON.parse(data[1]);
    }
  }
  throw new Error("Console event stream ended before the expected refresh");
}

async function establishRefreshDelivery(target, events, signal) {
  // fs.watch returning is not a native readiness barrier on macOS. Establish
  // a real round trip before the acceptance writes; do not retry those writes.
  const stop = new AbortController();
  const setupSignal = AbortSignal.any([signal, stop.signal]);
  const probe = path.join(target, ".ai-org/project/.console-watch-readiness");
  const writer = (async () => {
    let revision = 0;
    while (true) {
      setupSignal.throwIfAborted();
      await fs.writeFile(probe, String(++revision), { signal: setupSignal });
      await delay(25, undefined, { signal: setupSignal });
    }
  })();
  try {
    return await Promise.race([events.next(), writer]);
  } finally {
    stop.abort();
    await writer.catch((error) => {
      if (error.name !== "AbortError") throw error;
    });
  }
}

test("the Management Console has a truthful local read-only presentation mode", () => {
  const local = renderControlPlaneDashboard("Optional Product", { viewMode: "management-read-only" });
  assert.match(local, /Local · Read only/);
  assert.match(local, /Read-only local view/);
  assert.doesNotMatch(local, /<div class="nav-group local-tools">/);
  assert.doesNotMatch(local, /id="view-inbox"/);
  assert.doesNotMatch(local, /id="view-agent-commands"/);

  const privateView = renderControlPlaneDashboard("Optional Product", { viewMode: "private-read-only" });
  assert.match(privateView, /Private network · Read only/);
  assert.match(privateView, /Read-only private view/);
});

test("Temple Core initialization installs neither optional runtime", async (context) => {
  const state = await fixture(context);
  const status = await inspectLocalObserverService(state.target);
  assert.equal(status.service_status, "not-installed");
  assert.equal(status.running, false);
  assert.equal(status.observation_mode, "off");
  await assert.rejects(() => fs.access(status.state_directory), /ENOENT/);
});

test("the optional Console is read-only, does not own the writer lease, and does not grow telemetry", async (context) => {
  const state = await fixture(context);
  const journalPath = path.join(state.stateDirectory, "journal", "events.jsonl");
  const before = await fileSize(journalPath);
  const consoleServer = await startManagementConsoleServer(state.target, {
    stateDirectory: state.stateDirectory,
    port: 0,
    snapshotMaxAgeMs: 0
  });
  context.after(() => consoleServer.close());
  assert.equal(consoleServer.writer_lease_acquired, false);
  assert.equal(consoleServer.provider_started, false);
  assert.equal(consoleServer.repository_polling_started, false);

  const competingWriter = await acquireControlPlaneLease(state.stateDirectory);
  await competingWriter.release();

  const health = await fetch(`${consoleServer.url}/healthz`).then((response) => response.json());
  assert.equal(health.read_only, true);
  assert.equal(health.writer_lease_acquired, false);
  assert.equal(health.provider_started, false);
  const html = await fetch(consoleServer.url).then((response) => response.text());
  assert.match(html, /Local · Read only/);
  assert.doesNotMatch(html, /id="view-inbox"/);
  const snapshotResponse = await fetch(`${consoleServer.url}/api/v1/snapshot`);
  assert.equal(snapshotResponse.status, 200);
  const snapshot = await snapshotResponse.json();
  assert.equal(snapshot.management_console.optional, true);
  assert.equal(snapshot.management_console.read_only, true);
  assert.equal(snapshot.authority.mutations_available, false);
  assert.equal(Object.hasOwn(snapshot, "inbox"), false);
  const rejected = await fetch(`${consoleServer.url}/api/v1/inbox/agent-command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
  assert.equal(rejected.status, 405);
  await fetch(`${consoleServer.url}/api/v1/snapshot`);
  assert.equal(await fileSize(journalPath), before);
});

test("the optional Console emits a bounded refresh signal after canonical state changes", async (context) => {
  const state = await fixture(context);
  const consoleServer = await startManagementConsoleServer(state.target, {
    stateDirectory: state.stateDirectory,
    port: 0
  });
  context.after(() => consoleServer.close());

  const controller = new AbortController();
  // One unchanged deadline covers startup synchronization, connection, both
  // actual mutations, snapshot reads and failure cleanup. No assertion retries.
  const timeout = setTimeout(() => controller.abort(new Error("Console refresh signal timed out")), 30000);
  let refreshes;
  try {
    const events = await fetch(`${consoleServer.url}/api/v1/events`, { signal: controller.signal });
    assert.equal(events.status, 200);
    refreshes = refreshEvents(events.body);
    let { value: previous } = await establishRefreshDelivery(state.target, refreshes, controller.signal);

    const projectPath = path.join(state.target, ".ai-org/project/project.json");
    const project = JSON.parse(await fs.readFile(projectPath, "utf8"));
    const readSnapshot = async () => {
      const response = await fetch(`${consoleServer.url}/api/v1/snapshot`, { signal: controller.signal });
      assert.equal(response.status, 200);
      return response.json();
    };
    assert.equal((await readSnapshot()).project.name, project.name);
    for (const suffix of ["first refresh", "second refresh"]) {
      const name = `${project.name} ${suffix}`;
      await writeJson(projectPath, { ...project, name });
      const { value: current } = await refreshes.next();
      assert.ok(current.revision > previous.revision, "a subsequent refresh revision reaches the subscriber");
      assert.equal((await readSnapshot()).project.name, name, "the refresh invalidates the cached snapshot");
      previous = current;
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
    await refreshes?.return().catch((error) => {
      if (error.name !== "AbortError" && error !== controller.signal.reason) throw error;
    });
    await consoleServer.close();
  }
});

test("the on-demand Collector writes retained telemetry without HTTP and can coexist with the Console", async (context) => {
  const state = await fixture(context);
  const providerLifecycle = [];
  const startProvider = async (_target, journal, registry, options) => {
    const providerId = options.providerId ?? "codex-local";
    return {
      providerId,
      async start() {
        providerLifecycle.push("start");
        registry.update(providerId, { status: "ready", degraded_reason: null });
        await journal.append({
          id: "usage-fixture-1",
          source: "urn:temple:provider:codex-app-server:fixture",
          type: "org.temple.codex.usage.updated.v1",
          time: "2026-09-02T04:00:00.000Z",
          data: {
            project_id: "optional-product",
            work_item_id: "WI-0001",
            task_id: "task-0001",
            position_id: "developer",
            input_tokens: 100,
            output_tokens: 20,
            total_tokens: 120
          }
        });
      },
      async stop() {
        providerLifecycle.push("stop");
        registry.update(providerId, { status: "disabled", degraded_reason: "stopped" });
      }
    };
  };
  const collector = await startUsageCollector(state.target, {
    stateDirectory: state.stateDirectory,
    observationMode: "on-demand",
    startProvider
  });
  context.after(() => collector.close());
  assert.equal(collector.http_listener_started, false);
  assert.equal(collector.console_started, false);
  assert.equal(collector.writer_lease_acquired, true);
  assert.deepEqual(providerLifecycle, ["start"]);
  await assert.rejects(() => acquireControlPlaneLease(state.stateDirectory), /already running/);
  const running = await inspectLocalObserverService(state.target, { stateDirectory: state.stateDirectory });
  assert.equal(running.observation_mode, "on-demand");
  assert.equal(running.running, true);
  assert.equal(running.loopback_url, null);

  const consoleServer = await startManagementConsoleServer(state.target, {
    stateDirectory: state.stateDirectory,
    port: 0,
    snapshotMaxAgeMs: 0
  });
  const snapshot = await fetch(`${consoleServer.url}/api/v1/snapshot`).then((response) => response.json());
  assert.equal(snapshot.management_console.read_only, true);
  assert.equal(snapshot.journal.retained_events, 1);
  await consoleServer.close();

  await collector.close();
  assert.deepEqual(providerLifecycle, ["start", "stop"]);
  const stopped = await inspectLocalObserverService(state.target, { stateDirectory: state.stateDirectory });
  assert.equal(stopped.observation_mode, "off");
  assert.equal(stopped.running, false);
  const retained = await fs.readFile(path.join(state.stateDirectory, "journal", "events.jsonl"), "utf8");
  assert.match(retained, /usage-fixture-1/);
});

test("the Console snapshot removes local mutation and telemetry path details", () => {
  const safe = managementConsoleSnapshot({
    authority: { canonical: ".ai-org/" },
    usage: { source: { state_directory: "/private/runtime", capture_health: { provider_status: "disabled" } } },
    daemon: { pid: 123 },
    inbox: { runtime_permissions: [] },
    recent_events: [{ data: { secret: "redacted" } }]
  });
  assert.equal(safe.authority.viewer, "local-read-only");
  assert.equal(safe.authority.mutations_available, false);
  assert.equal(safe.management_console.optional, true);
  assert.equal(safe.management_console.usage_collection_active, false);
  assert.equal(Object.hasOwn(safe, "daemon"), false);
  assert.equal(Object.hasOwn(safe, "inbox"), false);
  assert.equal(Object.hasOwn(safe, "recent_events"), false);
  assert.equal(Object.hasOwn(safe.usage.source, "state_directory"), false);
});

test("the Console snapshot omits duplicate evidence and Provider task history", () => {
  const retainedProviderHistory = "provider-history".repeat(65536);
  const snapshot = {
    authority: { canonical: ".ai-org/" },
    observer: {
      schema_version: "temple.observer/v1",
      project: { id: "compact-product", name: "Compact Product" },
      organization: { profile: "solo", agents: [] },
      execution_routing: {
        schema_version: "temple.execution-policy/v1",
        source: "project",
        selection_mode: "advisory",
        automatic_execution: false,
        provider_contact: false,
        profiles: 4,
        mapped_profiles: 3,
        capabilities: 5,
        resource_measures: 10,
        fallback_profile_id: "standard"
      },
      evidence: { total: 1, items: [{ body: retainedProviderHistory }] },
      work: { total: 1, items: [{ id: "WI-0001" }] },
      timeline: [{ name: "duplicate-canonical-event" }]
    },
    live_observer: {
      work: {
        total: 1,
        categories: { active: 1 },
        items: [{
          id: "WI-0001",
          title: "Compact the viewer projection",
          state: "build",
          owner_position: "developer",
          tasks: [{
            id: "task-0001",
            position_id: "developer",
            registered_status: "active",
            items: [{ body: retainedProviderHistory }],
            usage: { total: { total_tokens: 42 } }
          }]
        }]
      },
      tasks: {
        total: 1,
        live: 1,
        history_only: 0,
        registered_only: 0,
        items: [{ id: "task-0001", items: [{ body: retainedProviderHistory }] }]
      },
      timeline: [{ name: "current-event" }],
      attention: []
    },
    usage: {
      source: { state_directory: "/private/runtime", observations: 1 },
      totals: { total_tokens: 42 },
      driver_groups: []
    },
    conditions: { summary: { firing: 0 }, conditions: [] },
    providers: { providers: [] },
    journal: { retained_events: 1 }
  };
  const safe = managementConsoleSnapshot(snapshot);

  assert.deepEqual(safe.observer.organization, snapshot.observer.organization);
  assert.deepEqual(safe.observer.execution_routing, snapshot.observer.execution_routing);
  assert.equal(Object.hasOwn(safe.observer, "evidence"), false);
  assert.equal(Object.hasOwn(safe.observer, "work"), false);
  assert.equal(Object.hasOwn(safe.live_observer.tasks, "items"), false);
  assert.equal(Object.hasOwn(safe.live_observer.work.items[0].tasks[0], "items"), false);
  assert.equal(safe.live_observer.work.items[0].tasks[0].usage.total.total_tokens, 42);
  assert.equal(safe.usage.totals.total_tokens, 42);
  assert.ok(JSON.stringify(safe).length < JSON.stringify(snapshot).length / 10);
});
