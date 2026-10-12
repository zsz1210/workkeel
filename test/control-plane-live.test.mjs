import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildCodexRuntimeRequestResponse,
  classifyCodexAttachFailure,
  classifyCodexProviderRejection,
  classifyCodexTasks,
  codexProviderOwnedWirePolicy,
  normalizeCodexMessage,
  normalizeCodexThreadSnapshot,
  startCodexAppServerProvider,
  summarizeUnifiedDiff
} from "../src/codex-app-server-provider.mjs";
import {
  createProviderRegistry,
  repositoryProviderContract
} from "../src/control-plane-providers.mjs";
import { codexAppServerProviderContract } from "../src/codex-app-server-provider.mjs";
import { buildObserverProjection } from "../src/observer.mjs";
import { buildLiveObserverProjection } from "../src/live-observer.mjs";
import { buildConditionProjection } from "../src/control-plane-conditions.mjs";
import { defaultControlPlaneConfig } from "../src/control-plane-config.mjs";
import { openTelemetryJournal } from "../src/telemetry.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin/temple.mjs");

const INSPECTED_APP_SERVER_V2_CONTRACT = Object.freeze({
  source: "codex-cli 0.151.0-alpha.7.2 generated schema observed 2026-08-31",
  threadStartParamsSha256: "792e2f32e37cece971bd616664ea2053741acbed4e9c92e9d1766427718f2ecd",
  threadStartResponseSha256: "c8fb6bcd1e4fb5ead6b487f0f35a90d8f13c9272edd4285914012dda403a77d2",
  modelReroutedNotificationSha256: "37cd3c1b3a3560b85b01d4061a07d830fc9ed93b80e4663f975f9197cdb501ef",
  threadSandboxModes: Object.freeze(["read-only", "workspace-write", "danger-full-access"]),
  approvalPolicies: Object.freeze(["untrusted", "on-request", "never"]),
  turnSandboxPolicyTypes: Object.freeze(["dangerFullAccess", "readOnly", "externalSandbox", "workspaceWrite"])
});

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

test("Provider-owned wire policy matches the inspected App Server v2 contract", () => {
  const readOnly = codexProviderOwnedWirePolicy({
    approvalPolicy: "onRequest",
    sandboxMode: "readOnly",
    networkAccess: true,
    cwd: "/tmp/example"
  });
  assert.equal(readOnly.approvalPolicy, "on-request");
  assert.equal(readOnly.threadSandboxMode, "read-only");
  assert.deepEqual(readOnly.turnSandboxPolicy, { type: "readOnly", networkAccess: false });

  const workspaceWrite = codexProviderOwnedWirePolicy({
    approvalPolicy: "unlessTrusted",
    sandboxMode: "workspaceWrite",
    networkAccess: false,
    cwd: "/tmp/example"
  });
  assert.equal(workspaceWrite.approvalPolicy, "untrusted");
  assert.equal(workspaceWrite.threadSandboxMode, "workspace-write");
  assert.deepEqual(workspaceWrite.turnSandboxPolicy, {
    type: "workspaceWrite",
    writableRoots: ["/tmp/example"],
    networkAccess: false
  });

  for (const wireValue of [readOnly.threadSandboxMode, workspaceWrite.threadSandboxMode]) {
    assert.ok(INSPECTED_APP_SERVER_V2_CONTRACT.threadSandboxModes.includes(wireValue));
  }
  for (const wireValue of [readOnly.approvalPolicy, workspaceWrite.approvalPolicy, "never"]) {
    assert.ok(INSPECTED_APP_SERVER_V2_CONTRACT.approvalPolicies.includes(wireValue));
  }
  for (const policy of [readOnly.turnSandboxPolicy, workspaceWrite.turnSandboxPolicy]) {
    assert.ok(INSPECTED_APP_SERVER_V2_CONTRACT.turnSandboxPolicyTypes.includes(policy.type));
  }
  assert.throws(
    () => codexProviderOwnedWirePolicy({ approvalPolicy: "onFailure", sandboxMode: "readOnly", cwd: "/tmp/example" }),
    (error) => error.reasonCode === "launch-request-invalid"
  );
  assert.throws(
    () => codexProviderOwnedWirePolicy({ approvalPolicy: "never", sandboxMode: "read-only", cwd: "/tmp/example" }),
    (error) => error.reasonCode === "launch-request-invalid"
  );
  assert.deepEqual(classifyCodexProviderRejection({ rpcCode: -32602, providerReason: "must not escape" }), {
    providerRpcCode: -32602,
    rejectionCategory: "invalid-request"
  });
  assert.deepEqual(classifyCodexProviderRejection({ rpcCode: -32601 }), {
    providerRpcCode: -32601,
    rejectionCategory: "method-unsupported"
  });
  assert.deepEqual(classifyCodexProviderRejection({ rpcCode: -32000 }), {
    providerRpcCode: -32000,
    rejectionCategory: "provider-rejected"
  });
  assert.deepEqual(classifyCodexProviderRejection(new Error("transport secret must not affect classification")), {
    providerRpcCode: null,
    rejectionCategory: "transport-unavailable"
  });
});

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}

async function fixture(context) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-live-test-"));
  const target = path.join(temporaryRoot, "live-product");
  const configPath = path.join(temporaryRoot, "init.json");
  const stateDirectory = path.join(temporaryRoot, "state");
  const cleanupSteps = [];
  const cleanup = {
    add(step) {
      cleanupSteps.push(step);
    }
  };
  context.after(async () => {
    let cleanupError = null;
    for (const step of cleanupSteps.reverse()) {
      try {
        await step();
      } catch (error) {
        cleanupError ??= error;
      }
    }
    try {
      await fs.rm(temporaryRoot, { recursive: true, force: true });
    } catch (error) {
      cleanupError ??= error;
    }
    if (cleanupError) throw cleanupError;
  });
  await writeJson(configPath, {
    schema_version: "temple.init/v1",
    project: { id: "live-product", name: "Live Product" },
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
  const created = run([
    "work-item", "create", target,
    "--title", "Observe live implementation",
    "--scope", "Expose bounded runtime state",
    "--acceptance", "Terminal observations win",
    "--affected-path", "src/live",
    "--ui-mode", "not-applicable",
    "--json"
  ]);
  assert.equal(created.status, 0, created.stderr || created.stdout);
  const workItemId = JSON.parse(created.stdout).item.id;
  const registered = run([
    "task", "register", target,
    "--work-item", workItemId,
    "--position", "product_manager",
    "--thread-id", "thread-live-001",
    "--host-id", "local",
    "--revision", "0123456789abcdef0123456789abcdef01234567",
    "--json"
  ]);
  assert.equal(registered.status, 0, registered.stderr || registered.stdout);
  return { temporaryRoot, target, stateDirectory, workItemId, task: JSON.parse(registered.stdout), cleanup };
}

function claimFixtureWorkItem(target, workItemId, revision = "a".repeat(40)) {
  const configured = run([
    "work-item", "configure", target,
    "--work-item", workItemId,
    "--base-revision", revision,
    "--parallel-mode", "sequential",
    "--integration-owner", "agent-fixture-rowan",
    "--agent-id", "agent-fixture-rowan",
    "--json"
  ]);
  assert.equal(configured.status, 0, configured.stderr || configured.stdout);
  const claimed = run([
    "work-item", "claim", target,
    "--work-item", workItemId,
    "--agent-id", "agent-fixture-rowan",
    "--principal-id", "human",
    "--base-revision", revision,
    "--branch", "main",
    "--worktree", target,
    "--json"
  ]);
  assert.equal(claimed.status, 0, claimed.stderr || claimed.stdout);
}

function waitForJournalRecord(journal, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe = () => {};
    const finish = (error, record = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      if (error) reject(error);
      else resolve(record);
    };
    const timer = setTimeout(
      () => finish(new Error(`Timed out after ${timeoutMs}ms waiting for the durable telemetry record`)),
      timeoutMs
    );
    unsubscribe = journal.subscribe((record) => {
      if (predicate(record)) finish(null, record);
    });
    const retained = journal.readAfter(0).records.find(predicate);
    if (retained) finish(null, retained);
  });
}

test("Codex normalization retains bounded summaries and excludes raw prompts, commands, diffs, and tool payloads", () => {
  const tasks = [{ id: "task-0001", work_item_id: "WI-0001", thread_id: "thread-1", current_revision: "a".repeat(40) }];
  const plan = normalizeCodexMessage("project", tasks, {
    method: "turn/plan/updated",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      explanation: "private prompt fragment",
      plan: [{ step: "Implement the safe projection", status: "inProgress" }]
    }
  }, { observedAt: "2026-08-30T00:00:00.000Z" });
  assert.deepEqual(plan.data.plan, [{ step: "Implement the safe projection", status: "inProgress" }]);
  assert.equal(plan.data.explanation_retained, false);
  assert.doesNotMatch(JSON.stringify(plan), /private prompt fragment/);

  const diff = normalizeCodexMessage("project", tasks, {
    method: "turn/diff/updated",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      diff: "--- a/src/a.mjs\n+++ b/src/a.mjs\n@@ -1 +1,2 @@\n-secret-value\n+safe\n+line"
    }
  }, { observedAt: "2026-08-30T00:00:01.000Z" });
  assert.deepEqual(diff.data.diff_summary, {
    files: ["src/a.mjs"], file_count: 1, additions: 2, deletions: 1, hunks: 1, raw_diff_retained: false
  });
  assert.doesNotMatch(JSON.stringify(diff), /secret-value/);
  assert.deepEqual(summarizeUnifiedDiff("+++ b/a\n+x"), {
    files: ["a"], file_count: 1, additions: 1, deletions: 0, hunks: 0, raw_diff_retained: false
  });

  const request = normalizeCodexMessage("project", tasks, {
    id: "approval-1",
    method: "item/commandExecution/requestApproval",
    params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", command: "print-super-secret", reason: "network access" }
  }, { observedAt: "2026-08-30T00:00:02.000Z" });
  assert.equal(request.data.request_class, "runtime-permission");
  assert.equal(request.data.command_present, true);
  assert.equal(request.data.raw_request_retained, false);
  assert.doesNotMatch(JSON.stringify(request), /print-super-secret/);
});

test("Codex runtime-request responses match the pinned App Server response shapes", () => {
  assert.deepEqual(
    buildCodexRuntimeRequestResponse(
      "item/commandExecution/requestApproval",
      { availableDecisions: ["accept", "acceptForSession", "decline"] },
      { decision: "acceptForSession" }
    ),
    { decision: "acceptForSession" }
  );
  assert.deepEqual(
    buildCodexRuntimeRequestResponse(
      "item/permissions/requestApproval",
      { permissions: { network: { enabled: true } } },
      { decision: "accept" }
    ),
    { permissions: { network: { enabled: true } }, scope: "turn" }
  );
  assert.deepEqual(
    buildCodexRuntimeRequestResponse(
      "item/permissions/requestApproval",
      { permissions: { network: { enabled: true } } },
      { decision: "decline" }
    ),
    { permissions: {}, scope: "turn" }
  );
  assert.deepEqual(
    buildCodexRuntimeRequestResponse(
      "item/tool/requestUserInput",
      { questions: [{ id: "region" }] },
      { answers: { region: ["Japan"] } }
    ),
    { answers: { region: { answers: ["Japan"] } } }
  );
  assert.throws(
    () => buildCodexRuntimeRequestResponse(
      "item/tool/requestUserInput",
      { questions: [{ id: "region" }] },
      { answers: {} }
    ),
    /answer every current question/
  );
});

test("Codex snapshot reconciliation retains a bounded window and deduplicates equivalent observations", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-reconciliation-test-"));
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const tasks = [{
    id: "task-0001",
    work_item_id: "WI-0001",
    thread_id: "thread-1",
    current_revision: "a".repeat(40),
    created_at: "2026-08-29T23:59:00.000Z"
  }];
  const thread = {
    id: "thread-1",
    status: { type: "idle" },
    turns: Array.from({ length: 4 }, (_, turnIndex) => ({
      id: `turn-${turnIndex + 1}`,
      status: "completed",
      items: Array.from({ length: 4 }, (_, itemIndex) => ({
        id: `item-${turnIndex + 1}-${itemIndex + 1}`,
        type: "agentMessage"
      }))
    }))
  };
  const events = normalizeCodexThreadSnapshot("project", tasks, thread, {
    observedAt: "2026-08-30T00:00:00.000Z",
    historyTurnLimit: 2,
    historyItemLimit: 3
  });
  assert.equal(events.length, 6);
  assert.deepEqual(
    [...new Set(events.map((entry) => entry.data.provider_turn_id).filter(Boolean))],
    ["turn-3", "turn-4"]
  );
  assert.deepEqual(
    events.map((entry) => entry.data.provider_item_id).filter(Boolean),
    ["item-4-2", "item-4-3", "item-4-4"]
  );
  assert.deepEqual(events[0].data.reconciliation_window, {
    turn_limit: 2,
    item_limit: 3,
    available_turns: 4,
    retained_turns: 2,
    available_items: 16,
    retained_items: 3,
    truncated: true
  });
  assert.deepEqual(events[0].data.reconciliation_bounds, { turn_limit: 2, item_limit: 3 });
  assert.ok(events.slice(1).every((entry) => entry.data.reconciliation_window === undefined));
  assert.ok(events.every((entry) => entry.data.reconciliation_bounds.turn_limit === 2));
  assert.doesNotMatch(JSON.stringify(events), /item-1-|item-2-|item-3-/);

  const repeated = normalizeCodexThreadSnapshot("project", tasks, thread, {
    observedAt: "2026-08-30T00:30:00.000Z",
    historyTurnLimit: 2,
    historyItemLimit: 3
  });
  assert.deepEqual(repeated.map((entry) => entry.id), events.map((entry) => entry.id));
  assert.deepEqual(repeated.map((entry) => entry.time), events.map((entry) => entry.time));

  const journal = await openTelemetryJournal(temporaryRoot, {
    maxEvents: 100,
    privacy: defaultControlPlaneConfig().privacy
  });
  context.after(() => journal.close());
  for (const entry of events) assert.equal((await journal.append(entry)).duplicate, false);
  for (const entry of repeated) assert.equal((await journal.append(entry)).duplicate, true);
  assert.equal(journal.snapshot().retained_events, events.length);

  const expandedThread = {
    ...thread,
    turns: [...thread.turns, { id: "turn-5", status: "completed", items: [] }]
  };
  const expanded = normalizeCodexThreadSnapshot("project", tasks, expandedThread, {
    observedAt: "2026-08-30T00:45:00.000Z",
    historyTurnLimit: 2,
    historyItemLimit: 3
  });
  assert.notEqual(expanded[0].id, events[0].id, "the changing snapshot summary must remain observable");
  const retainedTurn = events.find((entry) => entry.data.provider_turn_id === "turn-4" && !entry.data.provider_item_id);
  const expandedRetainedTurn = expanded.find((entry) => entry.data.provider_turn_id === "turn-4" && !entry.data.provider_item_id);
  assert.equal(expandedRetainedTurn.id, retainedTurn.id, "an unchanged historical turn must retain its identity");
});

test("repository observer classifies completed and cancelled work as terminal", async (context) => {
  const { target, workItemId } = await fixture(context);
  const firstPath = path.join(target, `.ai-org/work-items/${workItemId}.json`);
  const first = JSON.parse(await fs.readFile(firstPath, "utf8"));
  first.state = "done";
  first.evidence = ["docs/fixture-evidence.md"];
  await writeJson(firstPath, first);
  const created = run([
    "work-item", "create", target,
    "--title", "Cancelled fixture",
    "--scope", "Exercise terminal categorization",
    "--acceptance", "Cancellation is terminal",
    "--affected-path", "src/cancelled",
    "--ui-mode", "not-applicable",
    "--json"
  ]);
  assert.equal(created.status, 0, created.stderr || created.stdout);
  const cancelledId = JSON.parse(created.stdout).item.id;
  const cancelledPath = path.join(target, `.ai-org/work-items/${cancelledId}.json`);
  const cancelled = JSON.parse(await fs.readFile(cancelledPath, "utf8"));
  cancelled.state = "cancelled";
  await writeJson(cancelledPath, cancelled);

  const observer = await buildObserverProjection(target);
  assert.equal(observer.work.categories.terminal, 2);
  assert.equal(observer.work.categories.queued, 0);
  assert.ok(observer.work.items.every((entry) => entry.category === "terminal"));
  assert.equal(observer.work.items.find((entry) => entry.id === workItemId).artifact_ref_count, 1);
  assert.equal(observer.work.items.find((entry) => entry.id === workItemId).evidence_count, 0);
});

test("repository observer projects canonical organization independently of live execution", async (context) => {
  const { target } = await fixture(context);
  const observer = await buildObserverProjection(target);
  const organization = observer.organization;

  assert.equal(organization.schema_version, "temple.organization-view/v1");
  assert.equal(organization.profile, "solo");
  assert.equal(organization.coordination_backend, "repository");
  assert.equal(observer.execution_routing.selection_mode, "advisory");
  assert.equal(observer.execution_routing.profiles, 4);
  assert.equal(observer.execution_routing.mapped_profiles, 0);
  assert.equal(observer.execution_routing.automatic_execution, false);
  assert.equal(observer.execution_routing.provider_contact, false);
  assert.deepEqual(organization.counts, {
    accountable_people: 1,
    active_agents: 5,
    positions: 10,
    assigned_positions: 10,
    active_memberships: 10,
    provisional_memberships: 0,
    active_authority_grants: 0,
    qualification_attention: 0
  });
  assert.deepEqual(
    organization.agents.map((agent) => agent.display_name),
    ["Fixture Rowan", "Fixture Linden", "Fixture Ellis", "Fixture Devon", "Fixture Hollis"]
  );
  assert.deepEqual(
    organization.positions.map((position) => position.id),
    ["engineering_manager", "product_manager", "ux_designer", "ui_designer", "tech_lead", "developer", "quality_evaluator", "independent_qa", "release_manager", "observer"]
  );
  assert.equal(organization.positions.find((position) => position.id === "developer").assignment.agent_display_name, "Fixture Devon");
  assert.deepEqual(organization.positions.find((position) => position.id === "developer").memberships[0].disciplines, ["general-development"]);
  assert.ok(organization.safeguards.every((safeguard) => safeguard.status === "pass"));
  assert.deepEqual(organization.principals, []);
  assert.deepEqual(organization.sponsorships, []);
  assert.equal(organization.validation.real_collaborative.status, "not_run");

  const assignmentsPath = path.join(target, ".ai-org/project/assignments.json");
  const assignments = JSON.parse(await fs.readFile(assignmentsPath, "utf8"));
  const developerAgentId = assignments.assignments.find((assignment) => assignment.position_id === "developer").agent_id;
  assignments.assignments.find((assignment) => assignment.position_id === "independent_qa").agent_id = developerAgentId;
  await writeJson(assignmentsPath, assignments);
  const unsafe = await buildObserverProjection(target);
  assert.equal(
    unsafe.organization.safeguards.find((safeguard) => safeguard.id === "developer-independent-qa-separation").status,
    "fail"
  );
});

test("live projection forwards current attention and does not replay canonical repository events as fresh timeline rows", async (context) => {
  const { target, stateDirectory, workItemId, cleanup } = await fixture(context);
  const journal = await openTelemetryJournal(stateDirectory, {
    maxEvents: 100,
    privacy: defaultControlPlaneConfig().privacy
  });
  cleanup.add(() => journal.close());
  await journal.append({
    id: "canonical-replay-1",
    source: "urn:temple:repository:live-product",
    type: "org.temple.repository.work.item.created.v1",
    subject: `project/live-product/work-item/${workItemId}`,
    time: "2026-08-30T00:00:00.000Z",
    data: {
      canonical: true,
      event_type: "work_item_created",
      work_item_id: workItemId
    }
  });
  const observer = await buildObserverProjection(target);
  observer.attention.push({
    type: "approval_pending",
    work_item_id: workItemId,
    message: `${workItemId} needs a current decision`
  });
  const live = await buildLiveObserverProjection(
    target,
    observer,
    journal,
    createProviderRegistry([repositoryProviderContract()]),
    { now: "2026-08-30T00:01:00.000Z" }
  );
  assert.ok(live.attention.some((entry) => entry.type === "approval_pending" && entry.work_item_id === workItemId));
  assert.equal(
    live.timeline.some((entry) => entry.name === "org.temple.repository.work.item.created.v1"),
    false,
    "repository telemetry must not duplicate the canonical occurrence"
  );
  assert.ok(live.timeline.some((entry) => entry.provenance === "canonical" && entry.work_item_id === workItemId));
  assert.deepEqual(
    [...live.timeline].sort((left, right) => String(right.timestamp ?? right.observed_at).localeCompare(String(left.timestamp ?? left.observed_at))),
    live.timeline
  );
});

test("condition engine alerts on nonterminal stale evidence but keeps terminal evidence as history", async (context) => {
  const { target, stateDirectory, workItemId, cleanup } = await fixture(context);
  const itemPath = path.join(target, `.ai-org/work-items/${workItemId}.json`);
  const item = JSON.parse(await fs.readFile(itemPath, "utf8"));
  item.state = "done";
  await writeJson(itemPath, item);

  const observer = await buildObserverProjection(target);
  observer.evidence.items = [{
    id: "EVID-HISTORICAL",
    work_item_id: workItemId,
    stale: true,
    scope_revision: "a".repeat(40),
    current_scope_revision: "b".repeat(40)
  }];
  const journal = await openTelemetryJournal(stateDirectory, {
    maxEvents: 100,
    privacy: defaultControlPlaneConfig().privacy
  });
  cleanup.add(() => journal.close());
  const registry = createProviderRegistry([repositoryProviderContract()]);
  const terminal = await buildConditionProjection(target, observer, journal, registry, defaultControlPlaneConfig(), {
    stateDirectory,
    persist: false,
    now: "2026-08-30T00:00:04.000Z"
  });
  const terminalStale = terminal.conditions.filter((entry) => entry.type === "stale-evidence");
  assert.deepEqual(terminalStale.map((entry) => [entry.entity, entry.status]), [["project", "false"]]);

  item.state = "build";
  await writeJson(itemPath, item);
  const nonterminal = await buildConditionProjection(target, observer, journal, registry, defaultControlPlaneConfig(), {
    stateDirectory,
    persist: false,
    now: "2026-08-30T00:00:05.000Z"
  });
  assert.ok(nonterminal.conditions.some((entry) =>
    entry.type === "stale-evidence" && entry.entity === "EVID-HISTORICAL" && entry.status === "true"
  ));
});

test("live projection labels unobserved tasks honestly and terminal item state wins over later transient deltas", async (context) => {
  const { target, stateDirectory, task, cleanup } = await fixture(context);
  const journal = await openTelemetryJournal(stateDirectory, {
    maxEvents: 100,
    privacy: defaultControlPlaneConfig().privacy
  });
  cleanup.add(() => journal.close());
  const registry = createProviderRegistry([
    repositoryProviderContract(),
    codexAppServerProviderContract({ status: "ready" })
  ]);
  const completed = normalizeCodexMessage("live-product", [task], {
    method: "item/completed",
    params: {
      threadId: task.thread_id,
      turnId: "turn-1",
      item: { id: "item-1", type: "commandExecution", status: "completed", command: "never-store" },
      completedAtMs: Date.parse("2026-08-30T00:00:02.000Z")
    }
  }, { observedAt: "2026-08-30T00:00:02.000Z" });
  const started = normalizeCodexMessage("live-product", [task], {
    method: "item/started",
    params: {
      threadId: task.thread_id,
      turnId: "turn-1",
      item: { id: "item-1", type: "commandExecution", status: "inProgress", command: "never-store" },
      startedAtMs: Date.parse("2026-08-30T00:00:01.000Z")
    }
  }, { observedAt: "2026-08-30T00:00:03.000Z" });
  await journal.append(completed);
  await journal.append(started);
  const observer = await buildObserverProjection(target);
  const live = await buildLiveObserverProjection(target, observer, journal, registry, { now: "2026-08-30T00:00:04.000Z" });
  assert.equal(live.tasks.items[0].visibility, "live");
  assert.equal(live.tasks.items[0].items[0].terminal, true);
  assert.equal(live.tasks.items[0].items[0].status, "completed");
  assert.equal(live.privacy.raw_diffs_retained, false);

  registry.update("codex-local", { status: "offline", degraded_reason: "fixture disconnect" });
  const disconnected = await buildLiveObserverProjection(target, observer, journal, registry, { now: "2026-08-30T00:00:05.000Z" });
  assert.equal(disconnected.tasks.items[0].visibility, "unknown");
  assert.equal(disconnected.tasks.items[0].observed_status, "unknown");
});

test("condition engine keeps provider outages unknown and detects scope conflict, orphaning, and explicit usage budgets", async (context) => {
  const { target, stateDirectory, workItemId, task, cleanup } = await fixture(context);
  const second = run([
    "work-item", "create", target,
    "--title", "Conflicting implementation",
    "--scope", "Touch the same boundary",
    "--acceptance", "Conflict is visible",
    "--affected-path", "src/live/child",
    "--ui-mode", "not-applicable",
    "--json"
  ]);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  const secondId = JSON.parse(second.stdout).item.id;
  for (const id of [workItemId, secondId]) {
    const itemPath = path.join(target, `.ai-org/work-items/${id}.json`);
    const item = JSON.parse(await fs.readFile(itemPath, "utf8"));
    item.claim = { id: `claim-${id}`, status: "active", agent_id: item.assigned_agent_id, principal_id: "human", base_revision: "b".repeat(40) };
    item.claims = [item.claim];
    await writeJson(itemPath, item);
  }
  const journal = await openTelemetryJournal(stateDirectory, {
    maxEvents: 100,
    privacy: defaultControlPlaneConfig().privacy
  });
  cleanup.add(() => journal.close());
  await journal.append(normalizeCodexMessage("live-product", [task], {
    method: "thread/tokenUsage/updated",
    params: {
      threadId: task.thread_id,
      turnId: "turn-1",
      tokenUsage: {
        total: { inputTokens: 900, cachedInputTokens: 0, outputTokens: 200, reasoningOutputTokens: 0, totalTokens: 1100 },
        last: { inputTokens: 900, cachedInputTokens: 0, outputTokens: 200, reasoningOutputTokens: 0, totalTokens: 1100 },
        modelContextWindow: 10000
      }
    }
  }, { observedAt: "2026-08-30T00:00:00.000Z" }));
  const registry = createProviderRegistry([
    repositoryProviderContract(),
    codexAppServerProviderContract({ status: "offline", degradedReason: "fixture disconnect" })
  ]);
  const observer = await buildObserverProjection(target);
  const claimedWork = observer.work.items.find((item) => item.id === workItemId);
  assert.equal(claimedWork.assigned_agent_id, "agent-fixture-rowan");
  assert.equal(claimedWork.active_claim_agent_id, "agent-fixture-rowan");
  const config = defaultControlPlaneConfig();
  config.alerts.pending_for_ms = 0;
  config.alerts.token_budget = 1000;
  const conditions = await buildConditionProjection(target, observer, journal, registry, config, {
    stateDirectory,
    now: "2026-08-30T00:10:00.000Z"
  });
  assert.equal(conditions.conditions.find((entry) => entry.id === `stalled-work:${task.id}`).status, "unknown");
  assert.ok(conditions.conditions.some((entry) => entry.type === "scope-conflict" && entry.status === "true"));
  assert.ok(conditions.conditions.some((entry) => entry.type === "usage-anomaly" && entry.status === "true"));
  assert.ok(conditions.conditions.some((entry) => entry.type === "orphaned-work"));
  assert.equal(conditions.summary.firing >= 2, true);

  const secondPath = path.join(target, `.ai-org/work-items/${secondId}.json`);
  const secondItem = JSON.parse(await fs.readFile(secondPath, "utf8"));
  const activeClaim = secondItem.claim;
  secondItem.claim = null;
  await writeJson(secondPath, secondItem);
  const recovered = await buildConditionProjection(target, observer, journal, registry, config, {
    stateDirectory,
    now: "2026-08-30T00:10:01.000Z"
  });
  const recoveredConflict = recovered.conditions.find((entry) => entry.type === "scope-conflict" && entry.entity !== "project");
  assert.equal(recoveredConflict.status, "false");
  assert.equal(recoveredConflict.lifecycle, "resolved");

  secondItem.claim = activeClaim;
  await writeJson(secondPath, secondItem);
  const cooled = await buildConditionProjection(target, observer, journal, registry, config, {
    stateDirectory,
    now: "2026-08-30T00:10:02.000Z"
  });
  const suppressedConflict = cooled.conditions.find((entry) => entry.id === recoveredConflict.id);
  assert.equal(suppressedConflict.status, "true");
  assert.equal(suppressedConflict.lifecycle, "suppressed");
});

test("Codex App Server provider handshakes, reconciles registered threads, and retains live requests only in memory", async (context) => {
  const { temporaryRoot, target, stateDirectory, cleanup } = await fixture(context);
  const fakeServer = path.join(temporaryRoot, "fake-app-server.mjs");
  await fs.writeFile(fakeServer, `
    import readline from "node:readline";
    const input=readline.createInterface({input:process.stdin});
    const send=(value)=>process.stdout.write(JSON.stringify(value)+"\\n");
    const thread={id:"thread-live-001",status:{type:"idle"},turns:[{id:"turn-old",status:"completed",items:[{id:"item-old",type:"agentMessage"}]}]};
    input.on("line",line=>{const message=JSON.parse(line);if(message.method==="initialize")send({jsonrpc:"2.0",id:message.id,result:{serverInfo:{version:"fixture-1"}}});else if(message.method==="thread/read")send({jsonrpc:"2.0",id:message.id,result:{thread}});else if(message.method==="thread/resume"){send({jsonrpc:"2.0",id:message.id,result:{thread}});send({jsonrpc:"2.0",method:"turn/plan/updated",params:{threadId:thread.id,turnId:"turn-live",plan:[{step:"Live safe step",status:"inProgress"}],explanation:"do-not-store-explanation"}});send({jsonrpc:"2.0",method:"turn/diff/updated",params:{threadId:thread.id,turnId:"turn-live",diff:"+++ b/src/live.mjs\\n+do-not-store-diff"}});send({jsonrpc:"2.0",id:"approval-live",method:"item/commandExecution/requestApproval",params:{threadId:thread.id,turnId:"turn-live",itemId:"item-live",command:"do-not-store-command",reason:"fixture"}})}});
  `);
  const journal = await openTelemetryJournal(stateDirectory, {
    maxEvents: 100,
    privacy: defaultControlPlaneConfig().privacy
  });
  cleanup.add(() => journal.close());
  const registry = createProviderRegistry([repositoryProviderContract()]);
  const provider = await startCodexAppServerProvider(target, journal, registry, {
    command: process.execPath,
    commandArgs: [fakeServer],
    reconnectMs: 60000
  });
  await provider.start();
  cleanup.add(() => provider.stop());
  await Promise.all([
    waitForJournalRecord(
      journal,
      (record) => record.type === "org.temple.codex.plan.updated.v1"
        && record.data?.provider_thread_id === "thread-live-001"
        && record.data?.provider_turn_id === "turn-live"
    ),
    waitForJournalRecord(
      journal,
      (record) => record.type === "org.temple.codex.diff.updated.v1"
        && record.data?.provider_thread_id === "thread-live-001"
        && record.data?.provider_turn_id === "turn-live"
    )
  ]);
  assert.equal(registry.get("codex-local").status, "ready");
  assert.equal(registry.get("codex-local").protocol.detected_cli_version, "fixture-1");
  assert.equal(provider.pendingRequests()[0].request_id, "approval-live");
  const durable = JSON.stringify(journal.readAfter(0).records);
  assert.match(durable, /Live safe step/);
  assert.match(durable, /src\/live\.mjs/);
  assert.doesNotMatch(durable, /do-not-store-(?:explanation|diff|command)/);
  assert.ok(journal.readAfter(0).records.some((record) => record.data?.reconciled));
  await provider.stop();
});

test("Codex App Server provider-owned launch registers before generation and correlates usage", async (context) => {
  const { temporaryRoot, target, stateDirectory, workItemId, cleanup } = await fixture(context);
  const claimRevision = "a".repeat(40);
  const launchRevision = "b".repeat(40);
  claimFixtureWorkItem(target, workItemId, claimRevision);
  const callsPath = path.join(temporaryRoot, "provider-owned-calls.jsonl");
  const taskRegistryPath = path.join(target, ".ai-org/project/tasks.json");
  const fakeServer = path.join(temporaryRoot, "fake-provider-owned-app-server.mjs");
  await fs.writeFile(fakeServer, `
    import fs from "node:fs";
    import readline from "node:readline";
    const input=readline.createInterface({input:process.stdin});
    const send=(value)=>process.stdout.write(JSON.stringify(value)+"\\n");
    const existing={id:"thread-live-001",status:{type:"idle"},turns:[]};
    const created={id:"thread-provider-owned-001",sessionId:"thread-provider-owned-001",status:{type:"idle"},ephemeral:false,modelProvider:"openai",model:"nested-model-must-not-be-used"};
    const threadSandboxModes=${JSON.stringify(INSPECTED_APP_SERVER_V2_CONTRACT.threadSandboxModes)};
    const approvalPolicies=${JSON.stringify(INSPECTED_APP_SERVER_V2_CONTRACT.approvalPolicies)};
    input.on("line",line=>{
      const message=JSON.parse(line);
      let registeredBeforeTurn=null;
      if(message.method==="turn/start"){
        const tasks=JSON.parse(fs.readFileSync(${JSON.stringify(taskRegistryPath)},"utf8")).tasks;
        registeredBeforeTurn=tasks.some(task=>task.thread_id===created.id&&task.execution_origin==="temple-provider-owned");
      }
      fs.appendFileSync(${JSON.stringify(callsPath)},JSON.stringify({method:message.method,threadId:message.params?.threadId??null,registeredBeforeTurn,params:message.params??null})+"\\n");
      if(message.method==="initialize")send({jsonrpc:"2.0",id:message.id,result:{serverInfo:{version:"fixture-provider-owned"}}});
      else if(message.method==="thread/read")send({jsonrpc:"2.0",id:message.id,result:{thread:existing}});
      else if(message.method==="thread/start"){
        if(!threadSandboxModes.includes(message.params?.sandbox)||!approvalPolicies.includes(message.params?.approvalPolicy)){
          send({jsonrpc:"2.0",id:message.id,error:{code:-32602,message:"wire contract rejected thread/start"}});
        }else{
          send({jsonrpc:"2.0",method:"thread/started",params:{thread:created}});
          send({jsonrpc:"2.0",id:message.id,result:{thread:created,model:"gpt-5.6-terra",modelProvider:"openai",reasoningEffort:"xhigh",serviceTier:"priority",instructionSources:[]}});
        }
      }else if(message.method==="turn/start"){
        const turn={id:"turn-provider-owned-001",status:"inProgress",items:[]};
        send({jsonrpc:"2.0",id:message.id,result:{turn}});
        setImmediate(()=>{
          send({jsonrpc:"2.0",method:"turn/started",params:{threadId:created.id,turn}});
          send({jsonrpc:"2.0",method:"model/rerouted",params:{threadId:created.id,turnId:turn.id,fromModel:"gpt-5.6-terra",toModel:"gpt-5.6-sol",reason:"highRiskCyberActivity",rawResponse:"secret-reroute-payload-must-not-be-retained"}});
          send({jsonrpc:"2.0",method:"thread/tokenUsage/updated",params:{threadId:created.id,turnId:turn.id,tokenUsage:{total:{inputTokens:90,cachedInputTokens:10,outputTokens:20,reasoningOutputTokens:5,totalTokens:125},last:{inputTokens:90,cachedInputTokens:10,outputTokens:20,reasoningOutputTokens:5,totalTokens:125},modelContextWindow:10000}}});
        });
      }
    });
  `);
  const journal = await openTelemetryJournal(stateDirectory, {
    maxEvents: 100,
    privacy: defaultControlPlaneConfig().privacy
  });
  cleanup.add(() => journal.close());
  const registry = createProviderRegistry([repositoryProviderContract()]);
  const provider = await startCodexAppServerProvider(target, journal, registry, {
    command: process.execPath,
    commandArgs: [fakeServer],
    resumeThreads: false,
    reconnectMs: 60000
  });
  await provider.start();
  cleanup.add(() => provider.stop());
  const instruction = "Implement the bounded fixture without retaining secret-provider-launch-marker";
  const usageRecorded = waitForJournalRecord(
    journal,
    (record) => record.type === "org.temple.codex.usage.updated.v1" && record.data?.work_item_id === workItemId
  );
  const launched = await provider.launchProviderOwnedTask({
    workItemId,
    positionId: "engineering_manager",
    actor: "agent-fixture-rowan",
    instruction,
    requestedModel: "gpt-5.6-luna",
    reasoningEffort: "max",
    launchRevision,
    approvalPolicy: "never",
    sandboxMode: "workspaceWrite",
    networkAccess: false
  });
  assert.equal(launched.status, "turn-started");
  assert.equal(launched.provider_thread_id, "thread-provider-owned-001");
  assert.equal(launched.provider_turn_id, "turn-provider-owned-001");
  assert.equal(launched.requested_model, "gpt-5.6-luna");
  assert.equal(launched.effective_model, "gpt-5.6-terra");
  assert.equal(launched.requested_reasoning_effort, "max");
  assert.equal(launched.observed_thread_reasoning_effort, "xhigh");
  assert.equal(launched.effective_turn_reasoning_effort, null);
  assert.equal(launched.reasoning_effort, "xhigh");
  assert.equal(launched.reasoning_effort_source, "provider-thread");
  assert.equal(launched.service_tier, "priority");
  assert.equal(launched.instruction_length, instruction.length);
  assert.equal(launched.instruction_retained, false);
  assert.equal(launched.automatic_retry, false);
  const usage = await usageRecorded;

  await assert.rejects(
    () => provider.launchProviderOwnedTask({
      workItemId,
      positionId: "engineering_manager",
      actor: "agent-fixture-rowan",
      instruction: "This invalid policy must not reach the Provider",
      requestedModel: "gpt-5.6-luna",
      reasoningEffort: "low",
      launchRevision,
      approvalPolicy: "onFailure",
      sandboxMode: "readOnly",
      networkAccess: false
    }),
    (error) => error.reasonCode === "launch-request-invalid"
  );
  await provider.stop();

  const calls = (await fs.readFile(callsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  const threadStartIndex = calls.findIndex((entry) => entry.method === "thread/start");
  const turnStartIndex = calls.findIndex((entry) => entry.method === "turn/start");
  assert.ok(threadStartIndex >= 0 && turnStartIndex > threadStartIndex);
  assert.equal(calls[turnStartIndex].registeredBeforeTurn, true);
  assert.equal(calls.filter((entry) => entry.method === "thread/resume" && entry.threadId === "thread-provider-owned-001").length, 0);
  assert.equal(Object.hasOwn(calls[threadStartIndex].params, "ephemeral"), false);
  assert.equal(calls[threadStartIndex].params.serviceName, "temple-control-plane");
  assert.equal(calls[threadStartIndex].params.model, "gpt-5.6-luna");
  assert.equal(calls[threadStartIndex].params.approvalPolicy, "never");
  assert.equal(calls[threadStartIndex].params.sandbox, "workspace-write");
  assert.equal(calls[turnStartIndex].params.model, "gpt-5.6-luna");
  assert.equal(calls[turnStartIndex].params.approvalPolicy, "never");
  assert.equal(calls[turnStartIndex].params.sandboxPolicy.type, "workspaceWrite");
  assert.equal(calls[turnStartIndex].params.sandboxPolicy.networkAccess, false);

  assert.equal(calls.filter((entry) => entry.method === "thread/start").length, 1);

  const taskRegistry = JSON.parse(await fs.readFile(taskRegistryPath, "utf8"));
  const task = taskRegistry.tasks.find((entry) => entry.thread_id === "thread-provider-owned-001");
  assert.ok(task);
  assert.equal(task.execution_origin, "temple-provider-owned");
  assert.equal(task.provider_id, "codex-local");
  assert.equal(task.requested_model, "gpt-5.6-luna");
  assert.equal(task.effective_model, "gpt-5.6-sol");
  assert.equal(task.requested_reasoning_effort, "max");
  assert.equal(task.observed_thread_reasoning_effort, "xhigh");
  assert.equal(task.effective_turn_reasoning_effort, null);
  assert.equal(task.reasoning_effort, "xhigh");
  assert.equal(task.reasoning_effort_source, "provider-thread");
  assert.equal(task.service_tier, "priority");
  assert.equal(task.base_revision, claimRevision);
  assert.equal(task.launch_revision, launchRevision);
  assert.equal(task.current_revision, launchRevision);
  const attachment = provider.attachmentOutcomes().find((entry) => entry.task_id === task.id);
  assert.equal(attachment.attach_outcome, "live-attached");
  assert.equal(attachment.live_resume, "not-required");

  const records = journal.readAfter(0).records;
  const reroute = records.find((record) =>
    record.type === "org.temple.codex.model.rerouted.v1" && record.data?.task_id === task.id
  );
  assert.ok(reroute);
  assert.equal(reroute.data.provider_thread_id, "thread-provider-owned-001");
  assert.equal(reroute.data.provider_turn_id, "turn-provider-owned-001");
  assert.equal(reroute.data.work_item_id, workItemId);
  assert.equal(reroute.data.from_model, "gpt-5.6-terra");
  assert.equal(reroute.data.to_model, "gpt-5.6-sol");
  assert.equal(reroute.data.reason, "highRiskCyberActivity");
  assert.equal(reroute.data.correlation, "registered");
  assert.equal(usage.data.task_id, task.id);
  assert.ok(records.indexOf(reroute) < records.indexOf(usage));
  assert.equal(usage.data.work_item_id, workItemId);
  assert.equal(usage.data.position_id, "engineering_manager");
  assert.equal(usage.data.scope_revision, launchRevision);
  assert.equal(usage.data.attribution.model, "gpt-5.6-sol");
  assert.equal(usage.data.attribution.model_source, "canonical-effective");
  assert.equal(usage.data.attribution.requested_reasoning_effort, "max");
  assert.equal(usage.data.attribution.observed_thread_reasoning_effort, "xhigh");
  assert.equal(usage.data.attribution.effective_turn_reasoning_effort, null);
  assert.equal(usage.data.attribution.reasoning_effort, "xhigh");
  assert.equal(usage.data.attribution.reasoning_effort_source, "provider-thread");
  assert.equal(usage.data.attribution.service_tier, "priority");

  const observer = await buildObserverProjection(target);
  const live = await buildLiveObserverProjection(target, observer, journal, registry, {
    now: "2026-08-31T00:00:10.000Z"
  });
  const projected = live.tasks.items.find((entry) => entry.id === task.id);
  assert.equal(projected.execution_origin, "temple-provider-owned");
  assert.equal(projected.requested_model, "gpt-5.6-luna");
  assert.equal(projected.effective_model, "gpt-5.6-sol");
  assert.equal(projected.requested_reasoning_effort, "max");
  assert.equal(projected.observed_thread_reasoning_effort, "xhigh");
  assert.equal(projected.effective_turn_reasoning_effort, null);
  assert.equal(projected.reasoning_effort_source, "provider-thread");
  assert.equal(projected.launch_revision, launchRevision);
  assert.equal(projected.claim_base_revision, claimRevision);

  const retained = [
    await fs.readFile(taskRegistryPath, "utf8"),
    await fs.readFile(path.join(target, ".ai-org/events/events.jsonl"), "utf8"),
    JSON.stringify(journal.readAfter(0).records),
    JSON.stringify(registry.document())
  ].join("\n");
  assert.doesNotMatch(retained, /secret-provider-launch-marker/);
  assert.doesNotMatch(retained, /secret-reroute-payload-must-not-be-retained/);
  assert.doesNotMatch(retained, /nested-model-must-not-be-used/);
});

test("Codex App Server keeps an uncorrelated model reroute observable without mutating a registered task", async (context) => {
  const { temporaryRoot, target, stateDirectory, cleanup } = await fixture(context);
  const taskRegistryPath = path.join(target, ".ai-org/project/tasks.json");
  const before = JSON.parse(await fs.readFile(taskRegistryPath, "utf8"));
  const fakeServer = path.join(temporaryRoot, "fake-uncorrelated-reroute-app-server.mjs");
  await fs.writeFile(fakeServer, `
    import readline from "node:readline";
    const input=readline.createInterface({input:process.stdin});
    const send=(value)=>process.stdout.write(JSON.stringify(value)+"\\n");
    const thread={id:"thread-live-001",status:{type:"idle"},turns:[]};
    input.on("line",line=>{
      const message=JSON.parse(line);
      if(message.method==="initialize")send({jsonrpc:"2.0",id:message.id,result:{serverInfo:{version:"fixture-uncorrelated-reroute"}}});
      else if(message.method==="thread/read"){
        send({jsonrpc:"2.0",id:message.id,result:{thread}});
        send({jsonrpc:"2.0",method:"model/rerouted",params:{threadId:"thread-unregistered",turnId:"turn-unregistered",fromModel:"gpt-5.6-terra",toModel:"gpt-5.6-sol",reason:"highRiskCyberActivity",rawResponse:"secret-uncorrelated-reroute-payload"}});
      }
    });
  `);
  const journal = await openTelemetryJournal(stateDirectory, {
    maxEvents: 100,
    privacy: defaultControlPlaneConfig().privacy
  });
  cleanup.add(() => journal.close());
  const registry = createProviderRegistry([repositoryProviderContract()]);
  const provider = await startCodexAppServerProvider(target, journal, registry, {
    command: process.execPath,
    commandArgs: [fakeServer],
    resumeThreads: false,
    reconnectMs: 60000
  });
  await provider.start();
  cleanup.add(() => provider.stop());
  await new Promise((resolve) => setTimeout(resolve, 40));

  const after = JSON.parse(await fs.readFile(taskRegistryPath, "utf8"));
  assert.deepEqual(after, before);
  const reroute = journal.readAfter(0).records.find((record) =>
    record.type === "org.temple.codex.model.rerouted.v1"
  );
  assert.ok(reroute);
  assert.equal(reroute.data.provider_thread_id, "thread-unregistered");
  assert.equal(reroute.data.provider_turn_id, "turn-unregistered");
  assert.equal(reroute.data.task_id, null);
  assert.equal(reroute.data.work_item_id, null);
  assert.equal(reroute.data.correlation, "unregistered");
  assert.equal(reroute.data.from_model, "gpt-5.6-terra");
  assert.equal(reroute.data.to_model, "gpt-5.6-sol");
  assert.equal(reroute.data.reason, "highRiskCyberActivity");
  assert.equal(registry.get("codex-local").status, "ready");
  assert.doesNotMatch(JSON.stringify(journal.readAfter(0).records), /secret-uncorrelated-reroute-payload/);
});

test("Codex App Server provider-owned thread rejection retains only bounded protocol metadata", async (context) => {
  const { temporaryRoot, target, stateDirectory, workItemId, cleanup } = await fixture(context);
  const claimRevision = "1".repeat(40);
  claimFixtureWorkItem(target, workItemId, claimRevision);
  const callsPath = path.join(temporaryRoot, "thread-rejection-calls.jsonl");
  const fakeServer = path.join(temporaryRoot, "fake-thread-rejection-app-server.mjs");
  await fs.writeFile(fakeServer, `
    import fs from "node:fs";
    import readline from "node:readline";
    const input=readline.createInterface({input:process.stdin});
    const send=(value)=>process.stdout.write(JSON.stringify(value)+"\\n");
    const existing={id:"thread-live-001",status:{type:"idle"},turns:[]};
    input.on("line",line=>{
      const message=JSON.parse(line);
      fs.appendFileSync(${JSON.stringify(callsPath)},JSON.stringify({method:message.method,params:message.params??null})+"\\n");
      if(message.method==="initialize")send({jsonrpc:"2.0",id:message.id,result:{serverInfo:{version:"fixture-thread-rejection"}}});
      else if(message.method==="thread/read")send({jsonrpc:"2.0",id:message.id,result:{thread:existing}});
      else if(message.method==="thread/start")send({jsonrpc:"2.0",id:message.id,error:{code:-32602,message:"secret-thread-rejection-marker"}});
    });
  `);
  const journal = await openTelemetryJournal(stateDirectory, {
    maxEvents: 100,
    privacy: defaultControlPlaneConfig().privacy
  });
  cleanup.add(() => journal.close());
  const registry = createProviderRegistry([repositoryProviderContract()]);
  const provider = await startCodexAppServerProvider(target, journal, registry, {
    command: process.execPath,
    commandArgs: [fakeServer],
    resumeThreads: false,
    reconnectMs: 60000
  });
  await provider.start();
  cleanup.add(() => provider.stop());

  await assert.rejects(
    () => provider.launchProviderOwnedTask({
      workItemId,
      positionId: "engineering_manager",
      actor: "agent-fixture-rowan",
      instruction: "secret-thread-rejection-marker must not be retained",
      requestedModel: "gpt-5.6-luna",
      reasoningEffort: "low",
      launchRevision: "2".repeat(40),
      approvalPolicy: "never",
      sandboxMode: "readOnly",
      networkAccess: false
    }),
    (error) => {
      assert.equal(error.name, "CodexProviderOwnedLaunchError");
      assert.equal(error.reasonCode, "thread-start-rejected");
      assert.equal(error.providerRpcCode, -32602);
      assert.equal(error.rejectionCategory, "invalid-request");
      assert.equal(error.providerThreadId, null);
      assert.equal(error.turnStarted, false);
      assert.equal(error.automaticRetry, false);
      assert.equal(error.instructionRetained, false);
      assert.doesNotMatch(error.message, /secret-thread-rejection-marker/);
      assert.doesNotMatch(JSON.stringify(error), /secret-thread-rejection-marker/);
      return true;
    }
  );

  const calls = (await fs.readFile(callsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  const threadStart = calls.find((entry) => entry.method === "thread/start");
  assert.ok(threadStart);
  assert.equal(threadStart.params.sandbox, "read-only");
  assert.equal(threadStart.params.approvalPolicy, "never");
  assert.equal(calls.filter((entry) => entry.method === "thread/start").length, 1);
  assert.equal(calls.filter((entry) => entry.method === "turn/start").length, 0);
  const retained = [
    await fs.readFile(path.join(target, ".ai-org/project/tasks.json"), "utf8"),
    await fs.readFile(path.join(target, ".ai-org/events/events.jsonl"), "utf8"),
    JSON.stringify(journal.readAfter(0).records),
    JSON.stringify(registry.document())
  ].join("\n");
  assert.doesNotMatch(retained, /secret-thread-rejection-marker/);
});

test("Codex App Server provider-owned launch never starts a turn after canonical registration failure", async (context) => {
  const { temporaryRoot, target, stateDirectory, workItemId, cleanup } = await fixture(context);
  const claimRevision = "c".repeat(40);
  claimFixtureWorkItem(target, workItemId, claimRevision);
  const callsPath = path.join(temporaryRoot, "registration-failure-calls.jsonl");
  const fakeServer = path.join(temporaryRoot, "fake-registration-failure-app-server.mjs");
  await fs.writeFile(fakeServer, `
    import fs from "node:fs";
    import readline from "node:readline";
    const input=readline.createInterface({input:process.stdin});
    const send=(value)=>process.stdout.write(JSON.stringify(value)+"\\n");
    const existing={id:"thread-live-001",status:{type:"idle"},turns:[]};
    input.on("line",line=>{
      const message=JSON.parse(line);
      fs.appendFileSync(${JSON.stringify(callsPath)},JSON.stringify({method:message.method,params:message.params??null})+"\\n");
      if(message.method==="initialize")send({jsonrpc:"2.0",id:message.id,result:{serverInfo:{version:"fixture-registration-failure"}}});
      else if(message.method==="thread/read")send({jsonrpc:"2.0",id:message.id,result:{thread:existing}});
      else if(message.method==="thread/start")send({jsonrpc:"2.0",id:message.id,result:{thread:{id:"thread-orphaned-safe",ephemeral:false}}});
      else if(message.method==="turn/start")send({jsonrpc:"2.0",id:message.id,result:{turn:{id:"turn-must-not-start",status:"inProgress",items:[]}}});
    });
  `);
  const journal = await openTelemetryJournal(stateDirectory, {
    maxEvents: 100,
    privacy: defaultControlPlaneConfig().privacy
  });
  cleanup.add(() => journal.close());
  const registry = createProviderRegistry([repositoryProviderContract()]);
  const provider = await startCodexAppServerProvider(target, journal, registry, {
    command: process.execPath,
    commandArgs: [fakeServer],
    resumeThreads: false,
    reconnectMs: 60000,
    taskRegistrar: async () => {
      throw new Error("registration failed secret-registration-failure-marker");
    }
  });
  await provider.start();
  cleanup.add(() => provider.stop());
  await assert.rejects(
    () => provider.launchProviderOwnedTask({
      workItemId,
      positionId: "engineering_manager",
      actor: "agent-fixture-rowan",
      instruction: "secret-registration-failure-marker must never reach generation",
      requestedModel: "gpt-5.6-luna",
      reasoningEffort: "low",
      launchRevision: "d".repeat(40),
      approvalPolicy: "never",
      sandboxMode: "readOnly",
      networkAccess: false
    }),
    (error) => {
      assert.equal(error.name, "CodexProviderOwnedLaunchError");
      assert.equal(error.reasonCode, "task-registration-failed");
      assert.equal(error.providerThreadId, "thread-orphaned-safe");
      assert.equal(error.turnStarted, false);
      assert.equal(error.automaticRetry, false);
      assert.equal(error.instructionRetained, false);
      assert.doesNotMatch(error.message, /secret-registration-failure-marker/);
      return true;
    }
  );
  const calls = (await fs.readFile(callsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(calls.filter((entry) => entry.method === "thread/start").length, 1);
  assert.equal(calls.find((entry) => entry.method === "thread/start").params.sandbox, "read-only");
  assert.equal(calls.find((entry) => entry.method === "thread/start").params.approvalPolicy, "never");
  assert.equal(calls.filter((entry) => entry.method === "turn/start").length, 0);
  const retained = [
    await fs.readFile(path.join(target, ".ai-org/project/tasks.json"), "utf8"),
    await fs.readFile(path.join(target, ".ai-org/events/events.jsonl"), "utf8"),
    JSON.stringify(journal.readAfter(0).records),
    JSON.stringify(registry.document()),
    JSON.stringify(provider.attachmentOutcomes())
  ].join("\n");
  assert.doesNotMatch(retained, /secret-registration-failure-marker/);
});

test("Codex App Server provider-owned launch records attention without retry after turn rejection", async (context) => {
  const { temporaryRoot, target, stateDirectory, workItemId, cleanup } = await fixture(context);
  const claimRevision = "e".repeat(40);
  claimFixtureWorkItem(target, workItemId, claimRevision);
  const callsPath = path.join(temporaryRoot, "turn-rejection-calls.jsonl");
  const taskRegistryPath = path.join(target, ".ai-org/project/tasks.json");
  const fakeServer = path.join(temporaryRoot, "fake-turn-rejection-app-server.mjs");
  await fs.writeFile(fakeServer, `
    import fs from "node:fs";
    import readline from "node:readline";
    const input=readline.createInterface({input:process.stdin});
    const send=(value)=>process.stdout.write(JSON.stringify(value)+"\\n");
    const existing={id:"thread-live-001",status:{type:"idle"},turns:[]};
    const created={id:"thread-provider-rejected",sessionId:"thread-provider-rejected",ephemeral:false,status:{type:"idle"},model:"nested-model-must-not-be-used"};
    input.on("line",line=>{
      const message=JSON.parse(line);
      fs.appendFileSync(${JSON.stringify(callsPath)},JSON.stringify({method:message.method,params:message.params??null})+"\\n");
      if(message.method==="initialize")send({jsonrpc:"2.0",id:message.id,result:{serverInfo:{version:"fixture-turn-rejection"}}});
      else if(message.method==="thread/read")send({jsonrpc:"2.0",id:message.id,result:{thread:existing}});
      else if(message.method==="thread/start"){send({jsonrpc:"2.0",method:"thread/started",params:{thread:created}});send({jsonrpc:"2.0",id:message.id,result:{thread:created}})}
      else if(message.method==="turn/start")send({jsonrpc:"2.0",id:message.id,error:{code:-32602,message:"secret-turn-rejection-marker"}});
    });
  `);
  const journal = await openTelemetryJournal(stateDirectory, {
    maxEvents: 100,
    privacy: defaultControlPlaneConfig().privacy
  });
  cleanup.add(() => journal.close());
  const registry = createProviderRegistry([repositoryProviderContract()]);
  const provider = await startCodexAppServerProvider(target, journal, registry, {
    command: process.execPath,
    commandArgs: [fakeServer],
    resumeThreads: false,
    reconnectMs: 60000
  });
  await provider.start();
  cleanup.add(() => provider.stop());
  const result = await provider.launchProviderOwnedTask({
    workItemId,
    positionId: "engineering_manager",
    actor: "agent-fixture-rowan",
    instruction: "secret-turn-rejection-marker must not be retained",
    requestedModel: "gpt-5.6-luna",
    reasoningEffort: "low",
    launchRevision: "f".repeat(40),
    approvalPolicy: "never",
    sandboxMode: "readOnly",
    networkAccess: false
  });
  assert.equal(result.status, "provider-rejected");
  assert.equal(result.execution_status, "not-started");
  assert.equal(result.rejection_code, "turn-start-rejected");
  assert.equal(result.provider_rpc_code, -32602);
  assert.equal(result.rejection_category, "invalid-request");
  assert.equal(result.automatic_retry, false);
  assert.equal(result.instruction_retained, false);
  const calls = (await fs.readFile(callsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(calls.filter((entry) => entry.method === "turn/start").length, 1);
  const taskRegistry = JSON.parse(await fs.readFile(taskRegistryPath, "utf8"));
  const task = taskRegistry.tasks.find((entry) => entry.thread_id === "thread-provider-rejected");
  assert.equal(task.status, "attention");
  assert.equal(task.requested_model, "gpt-5.6-luna");
  assert.equal(task.effective_model, null);
  assert.equal(task.requested_reasoning_effort, "low");
  assert.equal(task.observed_thread_reasoning_effort, null);
  assert.equal(task.effective_turn_reasoning_effort, null);
  assert.equal(task.reasoning_effort, "low");
  assert.equal(task.reasoning_effort_source, "canonical-requested");
  assert.equal(task.service_tier, null);
  assert.match(task.notes, /automatic retry disabled/);
  const retained = [
    await fs.readFile(taskRegistryPath, "utf8"),
    await fs.readFile(path.join(target, ".ai-org/events/events.jsonl"), "utf8"),
    JSON.stringify(journal.readAfter(0).records),
    JSON.stringify(registry.document()),
    JSON.stringify(result)
  ].join("\n");
  assert.doesNotMatch(retained, /secret-turn-rejection-marker/);
});

test("Codex App Server Agent commands enforce registered state, exact active turns, and no retry after unknown delivery", async (context) => {
  const { temporaryRoot, target, stateDirectory, workItemId, cleanup } = await fixture(context);
  const callsPath = path.join(temporaryRoot, "agent-command-calls.jsonl");
  const fakeServer = path.join(temporaryRoot, "fake-agent-command-app-server.mjs");
  await fs.writeFile(fakeServer, `
    import fs from "node:fs";
    import readline from "node:readline";
    const input=readline.createInterface({input:process.stdin});
    const send=(value)=>process.stdout.write(JSON.stringify(value)+"\\n");
    const thread={id:"thread-live-001",status:{type:"idle"},turns:[]};
    input.on("line",line=>{const message=JSON.parse(line);fs.appendFileSync(${JSON.stringify(callsPath)},JSON.stringify(message)+"\\n");if(message.method==="initialize")send({jsonrpc:"2.0",id:message.id,result:{serverInfo:{version:"fixture-agent-command"}}});else if(message.method==="thread/read")send({jsonrpc:"2.0",id:message.id,result:{thread}});else if(message.method==="thread/resume")send({jsonrpc:"2.0",id:message.id,result:{thread}});else if(message.method==="turn/start"){const turn={id:"turn-created-1",status:"inProgress",items:[]};thread.status={type:"active"};thread.turns=[turn];send({jsonrpc:"2.0",id:message.id,result:{turn}});send({jsonrpc:"2.0",method:"turn/started",params:{threadId:thread.id,turn}})}else if(message.method==="turn/steer"){const text=message.params.input?.[0]?.text||"";if(text.includes("reject"))send({jsonrpc:"2.0",id:message.id,error:{code:-32602,message:"fixture rejection secret-marker"}});else if(text.includes("timeout")){}else send({jsonrpc:"2.0",id:message.id,result:{turnId:"turn-created-1"}})}else if(message.method==="turn/interrupt"){send({jsonrpc:"2.0",id:message.id,result:{}});const turn={id:"turn-created-1",status:"interrupted",items:[]};thread.status={type:"idle"};thread.turns=[turn];send({jsonrpc:"2.0",method:"turn/completed",params:{threadId:thread.id,turn}})}});
  `);
  const journal = await openTelemetryJournal(stateDirectory, {
    maxEvents: 100,
    privacy: defaultControlPlaneConfig().privacy
  });
  cleanup.add(() => journal.close());
  const registry = createProviderRegistry([repositoryProviderContract()]);
  const provider = await startCodexAppServerProvider(target, journal, registry, {
    command: process.execPath,
    commandArgs: [fakeServer],
    commandTimeoutMs: 30,
    reconnectMs: 60000
  });
  await provider.start();
  cleanup.add(() => provider.stop());
  const idle = (await provider.agentCommandTargets())[0];
  assert.equal(idle.available, true);
  assert.deepEqual(idle.operations, ["new-turn"]);
  assert.equal(idle.active_turn_id, null);
  const base = {
    idempotency_key: "provider-command-0001",
    task_id: idle.task_id,
    work_item_id: workItemId,
    expected_task_status: idle.task_status,
    expected_work_item_state: idle.work_item_state,
    expected_provider_thread_id: idle.provider_thread_id,
    expected_active_turn_id: null
  };
  const started = await provider.dispatchAgentCommand({
    ...base,
    operation: "new-turn",
    instruction: "Start the deterministic fixture turn"
  });
  assert.equal(started.status, "turn-started");
  assert.equal(started.provider_turn_id, "turn-created-1");
  const active = (await provider.agentCommandTargets())[0];
  assert.deepEqual(active.operations, ["steer", "interrupt"]);
  assert.equal(active.active_turn_id, "turn-created-1");
  await assert.rejects(
    () => provider.dispatchAgentCommand({
      ...base,
      operation: "steer",
      instruction: "This must stop before dispatch",
      expected_active_turn_id: "turn-stale"
    }),
    /Active turn changed before dispatch/
  );
  await assert.rejects(
    () => provider.dispatchAgentCommand({
      ...base,
      task_id: "task-unregistered",
      operation: "steer",
      instruction: "This target is not registered",
      expected_active_turn_id: "turn-created-1"
    }),
    /not currently eligible/
  );
  const rejected = await provider.dispatchAgentCommand({
    ...base,
    idempotency_key: "provider-command-0002",
    operation: "steer",
    instruction: "reject this deterministic fixture",
    expected_active_turn_id: "turn-created-1"
  });
  assert.equal(rejected.status, "provider-rejected");
  assert.equal(rejected.automatic_retry, false);
  assert.doesNotMatch(JSON.stringify(rejected), /secret-marker/);
  const unknown = await provider.dispatchAgentCommand({
    ...base,
    idempotency_key: "provider-command-0003",
    operation: "steer",
    instruction: "timeout after the provider boundary",
    expected_active_turn_id: "turn-created-1"
  });
  assert.equal(unknown.status, "delivery-unknown");
  assert.equal(unknown.automatic_retry, false);
  const interrupted = await provider.dispatchAgentCommand({
    ...base,
    idempotency_key: "provider-command-0004",
    operation: "interrupt",
    instruction: "",
    expected_active_turn_id: "turn-created-1"
  });
  assert.equal(interrupted.status, "provider-accepted");
  await waitForJournalRecord(
    journal,
    (record) => record.type === "org.temple.codex.turn.completed.v1"
      && record.data.status === "interrupted"
  );
  assert.deepEqual((await provider.agentCommandTargets())[0].operations, ["new-turn"]);
  assert.ok(journal.readAfter(0).records.some((record) =>
    record.type === "org.temple.codex.turn.completed.v1" && record.data.status === "interrupted"
  ));

  const taskPath = path.join(target, ".ai-org/project/tasks.json");
  const taskRegistry = JSON.parse(await fs.readFile(taskPath, "utf8"));
  taskRegistry.tasks[0].host_id = "remote-host";
  await writeJson(taskPath, taskRegistry);
  assert.equal((await provider.agentCommandTargets())[0].unavailable_reason, "target-host-not-local");
  taskRegistry.tasks[0].host_id = "local";
  taskRegistry.tasks[0].status = "completed";
  await writeJson(taskPath, taskRegistry);
  assert.equal((await provider.agentCommandTargets())[0].unavailable_reason, "task-not-live");
  taskRegistry.tasks[0].status = "active";
  await writeJson(taskPath, taskRegistry);
  const itemPath = path.join(target, ".ai-org/work-items", `${workItemId}.json`);
  const item = JSON.parse(await fs.readFile(itemPath, "utf8"));
  item.state = "cancelled";
  await writeJson(itemPath, item);
  assert.equal((await provider.agentCommandTargets())[0].unavailable_reason, "work-item-terminal");

  const calls = (await fs.readFile(callsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  const turnStarts = calls.filter((entry) => entry.method === "turn/start");
  const turnSteers = calls.filter((entry) => entry.method === "turn/steer");
  assert.equal(turnStarts.length, 1);
  assert.equal(turnSteers.length, 2);
  assert.deepEqual(Object.keys(turnStarts[0].params).sort(), ["clientUserMessageId", "input", "threadId", "turnTrigger"]);
  assert.equal(turnStarts[0].params.input[0].text, "Start the deterministic fixture turn");
  assert.deepEqual(Object.keys(turnSteers[0].params).sort(), ["clientUserMessageId", "expectedTurnId", "input", "threadId"]);
  assert.equal(calls.filter((entry) => entry.method === "turn/interrupt").length, 1);
});

test("Codex App Server provider reconciles terminal task history without attempting a live resume", async (context) => {
  const { temporaryRoot, target, stateDirectory, workItemId, task, cleanup } = await fixture(context);
  const cancelled = run([
    "transition", target,
    "--work-item", workItemId,
    "--to", "cancelled",
    "--satisfy", "cancellation_reason=fixture cancellation",
    "--actor", "human",
    "--json"
  ]);
  assert.equal(cancelled.status, 0, cancelled.stderr || cancelled.stdout);

  const callsPath = path.join(temporaryRoot, "app-server-calls.log");
  const fakeServer = path.join(temporaryRoot, "fake-terminal-app-server.mjs");
  await fs.writeFile(fakeServer, `
    import fs from "node:fs";
    import readline from "node:readline";
    const input=readline.createInterface({input:process.stdin});
    const send=(value)=>process.stdout.write(JSON.stringify(value)+"\\n");
    const thread={id:"thread-live-001",status:{type:"idle"},turns:[{id:"turn-old",status:"completed",items:[]}]};
    input.on("line",line=>{const message=JSON.parse(line);fs.appendFileSync(${JSON.stringify(callsPath)},message.method+"\\n");if(message.method==="initialize")send({jsonrpc:"2.0",id:message.id,result:{serverInfo:{version:"fixture-terminal"}}});else if(message.method==="thread/read")send({jsonrpc:"2.0",id:message.id,result:{thread}});else if(message.method==="thread/resume")send({jsonrpc:"2.0",id:message.id,error:{code:-32600,message:"terminal task must not be resumed"}})});
  `);
  const journal = await openTelemetryJournal(stateDirectory, {
    maxEvents: 100,
    privacy: defaultControlPlaneConfig().privacy
  });
  cleanup.add(() => journal.close());
  const registry = createProviderRegistry([repositoryProviderContract()]);
  const provider = await startCodexAppServerProvider(target, journal, registry, {
    command: process.execPath,
    commandArgs: [fakeServer],
    reconnectMs: 60000
  });
  await provider.start();
  cleanup.add(() => provider.stop());

  assert.deepEqual(
    Object.fromEntries(Object.entries(provider.taskTopology).map(([key, value]) => [key, value.length])),
    { registered: 1, history_reconcilable: 1, live_resumable: 0, terminal: 1, non_live: 0 }
  );
  assert.deepEqual(classifyCodexTasks([task], { workItems: [{ id: workItemId, state: "cancelled" }] }).live_resumable, []);
  assert.equal(registry.get("codex-local").status, "ready");
  const calls = (await fs.readFile(callsPath, "utf8")).trim().split("\n");
  assert.deepEqual(calls, ["initialize", "initialized", "thread/read"]);
  assert.ok(journal.readAfter(0).records.some((record) => record.data?.reconciled));
  const observer = await buildObserverProjection(target);
  const live = await buildLiveObserverProjection(target, observer, journal, registry, {
    now: "2026-08-30T00:00:10.000Z"
  });
  const projectedTask = live.tasks.items.find((entry) => entry.id === task.id);
  assert.equal(projectedTask.visibility, "history-only");
  assert.equal(projectedTask.provenance.runtime, "historical");
  assert.equal(projectedTask.provenance.capability_quality, "supported");
  assert.equal(projectedTask.attention, null);
  assert.equal(live.tasks.live, 0);
  assert.equal(live.tasks.history_only, 1);
  assert.ok(live.timeline.some((entry) => entry.provenance === "historical"));
  await provider.stop();
});

test("unsupported history read does not block a supported live resume", async (context) => {
  const { temporaryRoot, target, stateDirectory, cleanup } = await fixture(context);
  const callsPath = path.join(temporaryRoot, "unsupported-read-calls.log");
  const fakeServer = path.join(temporaryRoot, "fake-unsupported-read-app-server.mjs");
  await fs.writeFile(fakeServer, `
    import fs from "node:fs";
    import readline from "node:readline";
    const input=readline.createInterface({input:process.stdin});
    const send=(value)=>process.stdout.write(JSON.stringify(value)+"\\n");
    const thread={id:"thread-live-001",status:{type:"active"},turns:[]};
    input.on("line",line=>{const message=JSON.parse(line);fs.appendFileSync(${JSON.stringify(callsPath)},message.method+"\\n");if(message.method==="initialize")send({jsonrpc:"2.0",id:message.id,result:{serverInfo:{version:"fixture-read-boundary"}}});else if(message.method==="thread/read")send({jsonrpc:"2.0",id:message.id,error:{code:-32601,message:"Method not found"}});else if(message.method==="thread/resume")send({jsonrpc:"2.0",id:message.id,result:{thread}})});
  `);
  const journal = await openTelemetryJournal(stateDirectory, {
    maxEvents: 100,
    privacy: defaultControlPlaneConfig().privacy
  });
  cleanup.add(() => journal.close());
  const registry = createProviderRegistry([repositoryProviderContract()]);
  const provider = await startCodexAppServerProvider(target, journal, registry, {
    command: process.execPath,
    commandArgs: [fakeServer],
    reconnectMs: 60000
  });
  await provider.start();
  cleanup.add(() => provider.stop());

  const calls = (await fs.readFile(callsPath, "utf8")).trim().split("\n");
  assert.deepEqual(calls, ["initialize", "initialized", "thread/read", "thread/resume"]);
  assert.deepEqual(provider.attachmentOutcomes()[0], {
    task_id: "task-0001",
    work_item_id: "WI-0001",
    provider_thread_id: "thread-live-001",
    history_read: "failed",
    live_resume: "succeeded",
    attach_outcome: "live-attached",
    reason_code: "thread-read-unsupported",
    retry_suppressed: true
  });
  assert.equal(registry.get("codex-local").status, "degraded");
  assert.equal(registry.get("codex-local").degraded_reason, "thread-read-unsupported");
  assert.equal(registry.get("codex-local").attachment.outcomes["live-attached"], 1);
  assert.equal(registry.get("codex-local").attachment.retry_suppressed_tasks, 1);
});

test("host-owned unresumable tasks degrade once without resume retry churn", async (context) => {
  const { temporaryRoot, target, stateDirectory, cleanup } = await fixture(context);
  assert.deepEqual(
    classifyCodexAttachFailure({ rpcCode: -32602, providerReason: "invalid params secret-marker" }),
    { reason_code: "thread-resume-invalid", retryable: false, provider_wide: false }
  );
  const callsPath = path.join(temporaryRoot, "host-owned-calls.log");
  const fakeServer = path.join(temporaryRoot, "fake-host-owned-app-server.mjs");
  await fs.writeFile(fakeServer, `
    import fs from "node:fs";
    import readline from "node:readline";
    const input=readline.createInterface({input:process.stdin});
    const send=(value)=>process.stdout.write(JSON.stringify(value)+"\\n");
    const thread={id:"thread-live-001",status:{type:"idle"},turns:[]};
    input.on("line",line=>{const message=JSON.parse(line);fs.appendFileSync(${JSON.stringify(callsPath)},message.method+"\\n");if(message.method==="initialize")send({jsonrpc:"2.0",id:message.id,result:{serverInfo:{version:"fixture-host-boundary"}}});else if(message.method==="thread/read")send({jsonrpc:"2.0",id:message.id,result:{thread}});else if(message.method==="thread/resume")send({jsonrpc:"2.0",id:message.id,error:{code:-32004,message:"thread not found in Desktop session store secret-marker"}})});
  `);
  const journal = await openTelemetryJournal(stateDirectory, {
    maxEvents: 100,
    privacy: defaultControlPlaneConfig().privacy
  });
  cleanup.add(() => journal.close());
  const registry = createProviderRegistry([repositoryProviderContract()]);
  const provider = await startCodexAppServerProvider(target, journal, registry, {
    command: process.execPath,
    commandArgs: [fakeServer],
    reconnectMs: 60000
  });
  await provider.start();
  cleanup.add(() => provider.stop());
  assert.equal(provider.attachmentOutcomes()[0].reason_code, "thread-not-in-app-server-store");
  assert.equal(provider.attachmentOutcomes()[0].retry_suppressed, true);
  await provider.reconnect();

  const calls = (await fs.readFile(callsPath, "utf8")).trim().split("\n");
  assert.equal(calls.filter((method) => method === "thread/read").length, 2);
  assert.equal(calls.filter((method) => method === "thread/resume").length, 1);
  assert.equal(provider.attachmentOutcomes()[0].history_read, "succeeded");
  assert.equal(provider.attachmentOutcomes()[0].live_resume, "suppressed");
  assert.equal(provider.attachmentOutcomes()[0].attach_outcome, "degraded");
  assert.equal(registry.get("codex-local").degraded_reason, "thread-not-in-app-server-store");
  assert.equal(registry.get("codex-local").attachment.outcomes.degraded, 1);
  assert.equal(registry.get("codex-local").attachment.retry_suppressed_tasks, 1);
  await provider.start();
  const callsAfterRepeatedStart = (await fs.readFile(callsPath, "utf8")).trim().split("\n");
  assert.deepEqual(callsAfterRepeatedStart, calls);
  assert.doesNotMatch(JSON.stringify(journal.readAfter(0).records), /secret-marker/);
  assert.doesNotMatch(JSON.stringify(registry.get("codex-local")), /secret-marker/);
});
