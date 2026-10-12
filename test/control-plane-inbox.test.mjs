import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildHumanInbox,
  createHumanInboxGateway,
  readInboxSubmissions
} from "../src/control-plane-inbox.mjs";
import { defaultControlPlaneConfig } from "../src/control-plane-config.mjs";
import {
  agentCommandTargetFingerprint,
  reconcileAgentCommandDraft,
  renderControlPlaneDashboard
} from "../src/control-plane-dashboard.mjs";
import { startControlPlaneServer } from "../src/control-plane-server.mjs";

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

async function removeTemporaryTree(targetPath) {
  await fs.rm(targetPath, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100
  });
}

test("Temple Workspace command drafts survive unrelated refreshes and invalidate changed targets", () => {
  const firstTarget = {
    task_id: "task-0001",
    work_item_id: "WI-0001",
    task_status: "active",
    work_item_state: "build",
    provider_thread_id: "thread-1",
    active_turn_id: "turn-1",
    operations: ["steer", "interrupt"]
  };
  const draft = {
    targetTaskId: firstTarget.task_id,
    operation: "steer",
    instruction: "Keep this bounded instruction",
    selectionStart: 5,
    selectionEnd: 12,
    focusedControl: "instruction",
    confirmed: true,
    targetFingerprint: agentCommandTargetFingerprint(firstTarget)
  };
  assert.deepEqual(reconcileAgentCommandDraft(draft, [firstTarget]), {
    ...draft,
    staleReason: null
  });

  const changed = reconcileAgentCommandDraft(draft, [{ ...firstTarget, active_turn_id: "turn-2" }]);
  assert.equal(changed.instruction, draft.instruction);
  assert.equal(changed.selectionStart, 5);
  assert.equal(changed.selectionEnd, 12);
  assert.equal(changed.focusedControl, "instruction");
  assert.equal(changed.confirmed, false);
  assert.match(changed.staleReason, /active turn changed|active turn/i);

  const replacement = reconcileAgentCommandDraft(draft, [{ ...firstTarget, task_id: "task-0002" }]);
  assert.equal(replacement.targetTaskId, "task-0002");
  assert.equal(replacement.instruction, draft.instruction);
  assert.equal(replacement.confirmed, false);
  assert.match(replacement.staleReason, /no longer eligible/i);

  const dashboard = renderControlPlaneDashboard("Dashboard fixture", { inboxEnabled: true, sessionSecret: "fixture-secret" });
  assert.match(dashboard, /Skip to Temple Workspace content/);
  assert.match(dashboard, /What needs your attention now\?/);
  assert.match(dashboard, /Updates delayed/);
  assert.match(dashboard, /Finished Work Items/);
  assert.match(dashboard, /What did the organization consume\?/);
  assert.match(dashboard, /Models represented: no observed model evidence/);
});

async function fixture(context) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-inbox-test-"));
  const target = path.join(temporaryRoot, "inbox-product");
  const configPath = path.join(temporaryRoot, "init.json");
  const stateDirectory = path.join(temporaryRoot, "state");
  context.after(() => removeTemporaryTree(temporaryRoot));
  await writeJson(configPath, {
    schema_version: "temple.init/v1",
    project: { id: "inbox-product", name: "Inbox Product" },
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
  const created = run([
    "work-item", "create", target,
    "--title", "Bounded Inbox decision",
    "--scope", "Keep each authority class separate",
    "--acceptance", "One submission creates at most one canonical mutation",
    "--affected-path", "src/inbox",
    "--base-revision", "HEAD",
    "--ui-mode", "not-applicable",
    "--json"
  ]);
  assert.equal(created.status, 0, created.stderr || created.stdout);
  const workItemId = JSON.parse(created.stdout).item.id;
  return {
    temporaryRoot,
    target,
    stateDirectory,
    workItemId,
    itemPath: path.join(target, ".ai-org/work-items", `${workItemId}.json`),
    revision: git(target, ["rev-parse", "HEAD"]).stdout.trim()
  };
}

function fakeProvider(requests) {
  const pending = new Map(requests.map((request) => [request.request_id, { ...request }]));
  const answers = [];
  return {
    answers,
    pendingRequests() {
      return [...pending.values()].filter((request) => request.answerable !== false).map((request) => structuredClone(request));
    },
    answerRuntimeRequest(requestId, action) {
      const request = pending.get(String(requestId));
      if (!request || request.answerable === false) throw new Error("Runtime request is no longer live or answerable");
      answers.push({ request_id: String(requestId), action: structuredClone(action) });
      request.answerable = false;
      pending.delete(String(requestId));
      return {
        request_id: String(requestId),
        method: request.request_method,
        request_class: request.request_class,
        answered: true
      };
    }
  };
}

function fakeAgentCommandProvider(target, outcomes = []) {
  const calls = [];
  let outcomeIndex = 0;
  return {
    calls,
    agentCommandStatus() {
      return "ready";
    },
    async agentCommandTargets() {
      return [structuredClone(target)];
    },
    async prepareAgentCommand(command) {
      if (
        command.task_id !== target.task_id ||
        command.work_item_id !== target.work_item_id ||
        command.expected_task_status !== target.task_status ||
        command.expected_work_item_state !== target.work_item_state ||
        command.expected_provider_thread_id !== target.provider_thread_id ||
        (command.expected_active_turn_id ?? null) !== target.active_turn_id ||
        !target.operations.includes(command.operation)
      ) {
        const error = new Error("Registered task or active turn changed before dispatch");
        error.statusCode = 409;
        error.reasonCode = "stale-target-state";
        throw error;
      }
      return structuredClone(target);
    },
    async dispatchAgentCommand(command) {
      calls.push(structuredClone(command));
      return structuredClone(outcomes[outcomeIndex++] ?? {
        status: "turn-started",
        transport_status: "provider-accepted",
        execution_status: "turn-started",
        provider_turn_id: "turn-created-1",
        provider_method: "turn/start",
        rejection_code: null,
        automatic_retry: false
      });
    }
  };
}

test("Human Inbox keeps runtime permission and business-fact authority separate and idempotent", async (context) => {
  const { target, stateDirectory, workItemId, itemPath, revision } = await fixture(context);
  const provider = fakeProvider([
    {
      request_id: "runtime-1",
      request_method: "item/commandExecution/requestApproval",
      request_class: "runtime-permission",
      observed_at: "2026-08-30T01:00:00.000Z",
      answerable: true,
      available_decisions: ["accept", "decline"],
      reason: "Run the bounded verification",
      command_present: true,
      work_item_id: workItemId,
      task_id: "task-runtime"
    },
    {
      request_id: "business-1",
      request_method: "item/tool/requestUserInput",
      request_class: "business-fact",
      observed_at: "2026-08-30T01:01:00.000Z",
      answerable: true,
      work_item_id: workItemId,
      task_id: "task-business",
      questions: [
        { id: "region", question: "Which region?", is_secret: false, options: [] },
        { id: "credential", question: "Temporary credential?", is_secret: true, options: [] }
      ]
    }
  ]);
  const gateway = createHumanInboxGateway({
    target,
    stateDirectory,
    codexProvider: provider,
    privacy: defaultControlPlaneConfig().privacy
  });

  const runtimePayload = {
    idempotency_key: "runtime-command-0001",
    request_id: "runtime-1",
    expected_method: "item/commandExecution/requestApproval",
    expected_observed_at: "2026-08-30T01:00:00.000Z",
    decision: "accept"
  };
  const runtime = await gateway.submit("runtime-permission", runtimePayload);
  assert.equal(runtime.request_class, "runtime-permission");
  assert.equal(runtime.canonical_state_changed, false);
  assert.equal(provider.answers.length, 1);
  const replay = await gateway.submit("runtime-permission", runtimePayload);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(provider.answers.length, 1);
  await assert.rejects(
    () => gateway.submit("runtime-permission", { ...runtimePayload, decision: "decline" }),
    /different request/
  );
  await assert.rejects(
    () => gateway.submit("business-fact", {
      idempotency_key: "wrong-class-0001",
      request_id: "runtime-1",
      expected_method: runtimePayload.expected_method,
      expected_observed_at: runtimePayload.expected_observed_at,
      answers: {}
    }),
    /no longer live|business-fact/
  );

  const before = JSON.parse(await fs.readFile(itemPath, "utf8"));
  const businessPayload = {
    idempotency_key: "business-command-0001",
    request_id: "business-1",
    expected_method: "item/tool/requestUserInput",
    expected_observed_at: "2026-08-30T01:01:00.000Z",
    answers: {
      region: ["Japan"],
      credential: ["do-not-persist-this-secret"]
    }
  };
  const business = await gateway.submit("business-fact", businessPayload);
  assert.equal(business.status, "proposed");
  assert.equal(provider.answers.length, 2);
  const afterProposal = JSON.parse(await fs.readFile(itemPath, "utf8"));
  assert.deepEqual(afterProposal.scope, before.scope);
  assert.deepEqual(afterProposal.context_refs, before.context_refs);
  const submissions = await readInboxSubmissions(stateDirectory);
  const proposal = submissions.entries.find((entry) => entry.id === business.submission_id);
  assert.deepEqual(proposal.answers.region, ["Japan"]);
  assert.deepEqual(proposal.answers.credential, ["[SECRET ANSWER OMITTED]"]);
  assert.doesNotMatch(JSON.stringify(submissions), /do-not-persist-this-secret/);

  await assert.rejects(
    () => gateway.submit("business-incorporation", {
      idempotency_key: "incorporate-wrong-0001",
      submission_id: business.submission_id,
      work_item_id: workItemId,
      actor: "human",
      expected_state: before.state,
      expected_revision: "f".repeat(40)
    }),
    /state or exact revision changed/
  );
  const incorporationPayload = {
    idempotency_key: "incorporate-command-0001",
    submission_id: business.submission_id,
    work_item_id: workItemId,
    actor: "human",
    expected_state: before.state,
    expected_revision: revision
  };
  const incorporated = await gateway.submit("business-incorporation", incorporationPayload);
  assert.equal(incorporated.canonical_state_changed, true);
  const incorporatedReplay = await gateway.submit("business-incorporation", incorporationPayload);
  assert.equal(incorporatedReplay.idempotent_replay, true);
  const finalItem = JSON.parse(await fs.readFile(itemPath, "utf8"));
  assert.deepEqual(finalItem.scope, before.scope);
  assert.equal(finalItem.context_refs.includes(incorporated.context_ref), true);
  assert.equal(finalItem.context_refs.includes(incorporated.artifact), false);
  const contextMap = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/context-map.json"), "utf8"));
  const route = contextMap.routes.find((entry) => entry.id === incorporated.context_ref);
  assert.deepEqual(route.paths, [incorporated.artifact]);
  assert.deepEqual(route.work_items, [workItemId]);
  assert.match(await fs.readFile(path.join(target, incorporated.artifact), "utf8"), /does not independently change scope/);
  assert.doesNotMatch(await fs.readFile(path.join(target, incorporated.artifact), "utf8"), /do-not-persist-this-secret/);
  const events = await fs.readFile(path.join(target, ".ai-org/events/events.jsonl"), "utf8");
  assert.equal((events.match(/business_fact_incorporated/g) ?? []).length, 1);
  const doctor = run(["doctor", target, "--json"]);
  assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
  assert.equal(JSON.parse(doctor.stdout).summary.fail, 0);
});

test("Agent command gateway is opt-in, idempotent, privacy-bounded, and preserves truthful delivery states", async (context) => {
  const { target, stateDirectory, workItemId } = await fixture(context);
  const commandTarget = {
    task_id: "task-command-1",
    work_item_id: workItemId,
    work_item_title: "Bounded Inbox decision",
    position_id: "developer",
    agent_id: "agent-fixture-devon",
    provider_thread_id: "thread-command-1",
    task_status: "active",
    work_item_state: "intake",
    active_turn_id: null,
    operations: ["new-turn"],
    available: true,
    unavailable_reason: null
  };
  const provider = fakeAgentCommandProvider(commandTarget, [
    {
      status: "turn-started",
      transport_status: "provider-accepted",
      execution_status: "turn-started",
      provider_turn_id: "turn-created-1",
      provider_method: "turn/start",
      rejection_code: null,
      automatic_retry: false
    },
    {
      status: "provider-rejected",
      transport_status: "provider-rejected",
      execution_status: "not-started",
      provider_turn_id: null,
      provider_method: "turn/start",
      rejection_code: "provider-json-rpc-error",
      automatic_retry: false
    },
    {
      status: "delivery-unknown",
      transport_status: "delivery-unknown",
      execution_status: "unknown",
      provider_turn_id: null,
      provider_method: "turn/start",
      rejection_code: "provider-acknowledgement-unavailable",
      automatic_retry: false
    }
  ]);
  const disabled = createHumanInboxGateway({
    target,
    stateDirectory,
    codexProvider: provider,
    privacy: defaultControlPlaneConfig().privacy,
    agentCommands: defaultControlPlaneConfig().agent_commands
  });
  const syntheticSecret = `sk-${"ABCDEFGHIJKLMNOPQRSTUVWX"}`;
  const instruction = `Review the safe change using ${syntheticSecret} and report only the result.`;
  const base = {
    task_id: commandTarget.task_id,
    work_item_id: commandTarget.work_item_id,
    operation: "new-turn",
    instruction,
    expected_task_status: commandTarget.task_status,
    expected_work_item_state: commandTarget.work_item_state,
    expected_provider_thread_id: commandTarget.provider_thread_id,
    expected_active_turn_id: null,
    confirmed: true
  };
  await assert.rejects(
    () => disabled.submit("agent-command", { ...base, idempotency_key: "agent-disabled-0001" }),
    /disabled by project configuration/
  );
  assert.equal(provider.calls.length, 0);

  const gateway = createHumanInboxGateway({
    target,
    stateDirectory,
    codexProvider: provider,
    privacy: defaultControlPlaneConfig().privacy,
    agentCommands: { enabled: true, max_instruction_chars: 200 }
  });
  await assert.rejects(
    () => gateway.submit("agent-command", { ...base, idempotency_key: "agent-confirm-0001", confirmed: false }),
    /explicit preview confirmation/
  );
  await assert.rejects(
    () => gateway.submit("agent-command", { ...base, idempotency_key: "agent-field-0001", model: "forbidden" }),
    /unsupported fields: model/
  );
  const acceptedPayload = { ...base, idempotency_key: "agent-command-0001" };
  const accepted = await gateway.submit("agent-command", acceptedPayload);
  assert.equal(accepted.status, "turn-started");
  assert.equal(accepted.provider_turn_id, "turn-created-1");
  assert.equal(accepted.automatic_retry, false);
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].instruction, instruction);
  const replay = await gateway.submit("agent-command", acceptedPayload);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.status, "turn-started");
  assert.equal(provider.calls.length, 1);

  const rejected = await gateway.submit("agent-command", {
    ...base,
    idempotency_key: "agent-command-0002",
    instruction: "A second bounded instruction"
  });
  assert.equal(rejected.status, "provider-rejected");
  const unknown = await gateway.submit("agent-command", {
    ...base,
    idempotency_key: "agent-command-0003",
    instruction: "A third bounded instruction"
  });
  assert.equal(unknown.status, "delivery-unknown");
  assert.equal(unknown.automatic_retry, false);
  assert.equal((await gateway.submit("agent-command", {
    ...base,
    idempotency_key: "agent-command-0003",
    instruction: "A third bounded instruction"
  })).idempotent_replay, true);
  assert.equal(provider.calls.length, 3);

  const storedText = await fs.readFile(path.join(stateDirectory, "inbox", "commands.json"), "utf8");
  assert.equal(storedText.includes(syntheticSecret), false);
  assert.equal(storedText.includes(instruction), false);
  const stored = JSON.parse(storedText).entries.find((entry) => entry.idempotency_key === acceptedPayload.idempotency_key);
  assert.equal(stored.instruction_summary, `Instruction content omitted · ${instruction.length} characters`);
  assert.equal(stored.instruction_length, instruction.length);
  assert.equal(stored.instruction_content_retained, false);
  for (const forbidden of ["instruction", "instruction_preview", "instruction_sha256", "preview_truncated", "request_digest"]) {
    assert.equal(Object.hasOwn(stored, forbidden), false, `${forbidden} must not be retained`);
  }
  assert.equal(stored.automatic_retry, false);
  const inbox = await buildHumanInbox(target, stateDirectory, provider, {
    agentCommands: { enabled: true, max_instruction_chars: 200 }
  });
  assert.equal(inbox.agent_commands.available, true);
  assert.equal(inbox.agent_commands.eligible_targets.length, 1);
  assert.deepEqual(
    new Set(inbox.agent_commands.recent_commands.map((entry) => entry.status)),
    new Set(["delivery-unknown", "provider-rejected", "turn-started"])
  );
  assert.equal(JSON.stringify(inbox).includes(syntheticSecret), false);

  const terminalInbox = await buildHumanInbox(target, stateDirectory, provider, {
    agentCommands: { enabled: true, max_instruction_chars: 200 },
    journal: {
      readAfter() {
        return {
          records: [{
            type: "org.temple.codex.turn.completed.v1",
            templeobservedat: "2026-08-30T12:00:00.000Z",
            data: {
              provider_thread_id: commandTarget.provider_thread_id,
              provider_turn_id: accepted.provider_turn_id,
              status: "completed"
            }
          }]
        };
      }
    }
  });
  const completed = terminalInbox.agent_commands.recent_commands.find(
    (entry) => entry.idempotency_key === acceptedPayload.idempotency_key
  );
  assert.equal(completed.status, "completed");
  assert.equal(completed.transport_status, "provider-accepted");
  assert.equal(completed.execution_status, "completed");
  assert.equal(completed.updated_at, "2026-08-30T12:00:00.000Z");
});

test("Agent command durable state keeps only non-content metadata across adversarial instruction lengths", async (context) => {
  const { target, stateDirectory, workItemId } = await fixture(context);
  const commandTarget = {
    task_id: "task-command-privacy",
    work_item_id: workItemId,
    work_item_title: "Bounded Inbox decision",
    position_id: "developer",
    agent_id: "agent-fixture-devon",
    provider_thread_id: "thread-command-privacy",
    task_status: "active",
    work_item_state: "intake",
    active_turn_id: null,
    operations: ["new-turn"],
    available: true,
    unavailable_reason: null
  };
  const provider = fakeAgentCommandProvider(commandTarget);
  const gateway = createHumanInboxGateway({
    target,
    stateDirectory,
    codexProvider: provider,
    privacy: defaultControlPlaneConfig().privacy,
    agentCommands: { enabled: true, max_instruction_chars: 4000 }
  });
  const syntheticSecret = `sk-${"ABCDEFGHIJKLMNOPQRSTUVWX"}`;
  const instructions = [
    "§",
    "Q7?",
    "B".repeat(240),
    "L".repeat(241),
    "M".repeat(4000),
    `Use ${syntheticSecret} exactly once`
  ];
  const payloadFor = (instruction, index) => ({
    idempotency_key: `agent-privacy-${String(index).padStart(4, "0")}`,
    task_id: commandTarget.task_id,
    work_item_id: commandTarget.work_item_id,
    operation: "new-turn",
    instruction,
    expected_task_status: commandTarget.task_status,
    expected_work_item_state: commandTarget.work_item_state,
    expected_provider_thread_id: commandTarget.provider_thread_id,
    expected_active_turn_id: null,
    confirmed: true
  });

  for (const [index, instruction] of instructions.entries()) {
    const result = await gateway.submit("agent-command", payloadFor(instruction, index));
    assert.equal(result.status, "turn-started");
  }
  assert.deepEqual(provider.calls.map((call) => call.instruction), instructions);
  assert.equal(provider.calls.length, instructions.length);

  const replayPayload = payloadFor(instructions[1], 1);
  assert.equal((await gateway.submit("agent-command", replayPayload)).idempotent_replay, true);
  assert.equal(provider.calls.length, instructions.length);
  await assert.rejects(
    () => gateway.submit("agent-command", { ...replayPayload, instruction: "R8!" }),
    /different request/
  );
  assert.equal(provider.calls.length, instructions.length);
  await assert.rejects(
    () => gateway.submit("agent-command", payloadFor("X".repeat(4001), 9999)),
    /exceeds 4000 characters/
  );
  assert.equal(provider.calls.length, instructions.length);

  const commandsPath = path.join(stateDirectory, "inbox", "commands.json");
  const legacy = JSON.parse(await fs.readFile(commandsPath, "utf8"));
  legacy.entries[0] = {
    ...legacy.entries[0],
    instruction: instructions[0],
    instruction_preview: instructions[0],
    instruction_sha256: crypto.createHash("sha256").update(instructions[0]).digest("hex"),
    preview_truncated: false,
    request_digest: crypto.createHash("sha256").update(JSON.stringify(replayPayload)).digest("hex")
  };
  await fs.writeFile(commandsPath, `${JSON.stringify(legacy, null, 2)}\n`);

  const inbox = await buildHumanInbox(target, stateDirectory, provider, {
    agentCommands: { enabled: true, max_instruction_chars: 4000 }
  });
  const storedText = await fs.readFile(commandsPath, "utf8");
  const stored = JSON.parse(storedText);
  assert.equal(stored.entries.length, instructions.length);
  for (const [index, record] of stored.entries.entries()) {
    const instruction = instructions[index];
    assert.equal(record.instruction_summary, `Instruction content omitted · ${instruction.length} character${instruction.length === 1 ? "" : "s"}`);
    assert.equal(record.instruction_length, instruction.length);
    assert.equal(record.instruction_content_retained, false);
    for (const forbidden of ["instruction", "instruction_preview", "instruction_sha256", "preview_truncated", "request_digest"]) {
      assert.equal(Object.hasOwn(record, forbidden), false, `${forbidden} must not be retained`);
    }
    assert.equal(Object.values(record).some((value) => value === instruction), false);
    assert.equal(storedText.includes(crypto.createHash("sha256").update(instruction).digest("hex")), false);
    if (instruction.length > 3) assert.equal(storedText.includes(instruction), false);
  }
  const publicText = JSON.stringify(inbox.agent_commands.recent_commands);
  assert.equal(publicText.includes(syntheticSecret), false);
  assert.equal(inbox.agent_commands.recent_commands.every((record) =>
    record.instruction_content_retained === false &&
    !Object.hasOwn(record, "instruction_preview") &&
    !Object.hasOwn(record, "instruction_sha256")
  ), true);
  const auditText = await fs.readFile(path.join(stateDirectory, "inbox", "audit.jsonl"), "utf8");
  assert.equal(auditText.includes(syntheticSecret), false);
});

test("governance approval enforces current state, exact revision, active principals, and High-Assurance independence", async (context) => {
  const { target, stateDirectory, workItemId, itemPath, revision } = await fixture(context);
  for (const [principalId, name] of [["principal-owner", "Morgan Hale"], ["principal-reviewer", "Casey Quinn"]]) {
    const added = run(["collaboration", "add-principal", target, "--principal-id", principalId, "--name", name]);
    assert.equal(added.status, 0, added.stderr || added.stdout);
  }
  const agents = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/agents.json"), "utf8")).agents;
  const assignments = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/assignments.json"), "utf8")).assignments;
  const developerId = assignments.find((entry) => entry.position_id === "developer").agent_id;
  for (const agent of agents) {
    const principalId = agent.id === developerId ? "principal-owner" : "principal-reviewer";
    const sponsored = run(["collaboration", "sponsor", target, "--principal-id", principalId, "--agent-id", agent.id]);
    assert.equal(sponsored.status, 0, sponsored.stderr || sponsored.stdout);
  }
  const profile = run(["collaboration", "set-profile", target, "--profile", "high-assurance"]);
  assert.equal(profile.status, 0, profile.stderr || profile.stdout);
  const item = JSON.parse(await fs.readFile(itemPath, "utf8"));
  item.state = "release_gate";
  item.owner_position = "release_manager";
  item.tested_revision = revision;
  item.risk_tier = "high";
  item.assurance = {
    profile: "high-assurance",
    policy_schema: "temple.high-assurance/v1",
    artifact_depth: "controlled",
    minimum_approvals: 1,
    rollback_status: "planned",
    external_action_performed: false
  };
  await writeJson(itemPath, item);
  const gateway = createHumanInboxGateway({
    target,
    stateDirectory,
    codexProvider: null,
    privacy: defaultControlPlaneConfig().privacy
  });
  const inbox = await buildHumanInbox(target, stateDirectory, null);
  const candidate = inbox.governance_approvals.find((entry) => entry.work_item_id === workItemId);
  assert.equal(candidate.exact_revision, revision);
  assert.equal(candidate.action_available, true);

  const base = {
    work_item_id: workItemId,
    decision: "go",
    expected_state: "release_gate",
    expected_revision: revision,
    scope_revision: revision
  };
  await assert.rejects(
    () => gateway.submit("governance-approval", {
      ...base,
      idempotency_key: "governance-owner-0001",
      principal_ids: ["principal-owner"]
    }),
    /independent of the Developer sponsor/
  );
  await assert.rejects(
    () => gateway.submit("governance-approval", {
      ...base,
      idempotency_key: "governance-unknown-0001",
      principal_ids: ["principal-missing"]
    }),
    /unknown, or inactive Human Principal/
  );
  await assert.rejects(
    () => gateway.submit("governance-approval", {
      ...base,
      idempotency_key: "governance-revision-0001",
      expected_revision: "a".repeat(40),
      principal_ids: ["principal-reviewer"]
    }),
    /exact candidate revision/
  );
  await assert.rejects(
    () => gateway.submit("governance-approval", {
      ...base,
      idempotency_key: "governance-state-0001",
      expected_state: "test",
      principal_ids: ["principal-reviewer"]
    }),
    /current release_gate state/
  );

  const approvedPayload = {
    ...base,
    idempotency_key: "governance-command-0001",
    principal_ids: ["principal-reviewer"]
  };
  const approved = await gateway.submit("governance-approval", approvedPayload);
  assert.equal(approved.canonical_state_changed, true);
  assert.equal(approved.scope_revision, revision);
  assert.equal((await gateway.submit("governance-approval", approvedPayload)).idempotent_replay, true);
  const approval = JSON.parse(await fs.readFile(path.join(target, approved.approval_ref), "utf8"));
  assert.deepEqual(approval.approvals.map((entry) => entry.principal_id), ["principal-reviewer"]);
  assert.equal(JSON.parse(await fs.readFile(itemPath, "utf8")).state, "release_gate");
  const events = await fs.readFile(path.join(target, ".ai-org/events/events.jsonl"), "utf8");
  assert.equal((events.match(/governance_approval_recorded/g) ?? []).length, 1);
});

test("loopback command gateway rejects cross-origin, unauthenticated, and arbitrary mutations", async (context) => {
  const { target, stateDirectory } = await fixture(context);
  const controlPlane = await startControlPlaneServer(target, {
    stateDirectory,
    port: 0,
    repositoryIntervalMs: 50
  });
  context.after(() => controlPlane.close());
  const snapshotResponse = await fetch(`${controlPlane.url}/api/v1/snapshot`);
  const snapshotText = await snapshotResponse.text();
  assert.equal(snapshotResponse.status, 200);
  assert.doesNotMatch(snapshotText, new RegExp(controlPlane.sessionSecret));
  assert.doesNotMatch(snapshotText, /GH_TOKEN|authorization/i);
  assert.equal(JSON.parse(snapshotText).inbox.agent_commands.enabled, false);
  assert.equal(JSON.parse(snapshotText).inbox.agent_commands.availability_reason, "disabled-by-configuration");
  const dashboard = await (await fetch(controlPlane.url)).text();
  assert.match(dashboard, /Local and opt-in/);
  assert.match(dashboard, /id="view-commands-title"[^>]*>Agent Commands/);
  assert.match(dashboard, /Delivery is unknown/);
  assert.match(dashboard, /I reviewed the exact target, operation, and local preview/);
  assert.match(dashboard, /History retains only a non-content summary and instruction length/);
  assert.match(dashboard, /Retained summary/);
  assert.doesNotMatch(dashboard, /Retained preview|instruction_sha256|bounded redacted preview/);

  const body = {
    idempotency_key: "server-command-0001",
    request_id: "missing",
    expected_method: "item/commandExecution/requestApproval",
    expected_observed_at: "2026-08-30T00:00:00.000Z",
    decision: "decline"
  };
  const unauthenticated = await fetch(`${controlPlane.url}/api/v1/inbox/runtime-permission`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: controlPlane.url, "x-idempotency-key": body.idempotency_key },
    body: JSON.stringify(body)
  });
  assert.equal(unauthenticated.status, 403);
  const crossOrigin = await fetch(`${controlPlane.url}/api/v1/inbox/runtime-permission`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://attacker.invalid",
      "x-temple-session": controlPlane.sessionSecret,
      "x-idempotency-key": body.idempotency_key
    },
    body: JSON.stringify(body)
  });
  assert.equal(crossOrigin.status, 403);
  const agentBody = { idempotency_key: "agent-server-command-0001" };
  const crossOriginAgent = await fetch(`${controlPlane.url}/api/v1/inbox/agent-command`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://attacker.invalid",
      "x-temple-session": controlPlane.sessionSecret,
      "x-idempotency-key": agentBody.idempotency_key
    },
    body: JSON.stringify(agentBody)
  });
  assert.equal(crossOriginAgent.status, 403);
  const disabledAgent = await fetch(`${controlPlane.url}/api/v1/inbox/agent-command`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: controlPlane.url,
      "x-temple-session": controlPlane.sessionSecret,
      "x-idempotency-key": agentBody.idempotency_key
    },
    body: JSON.stringify(agentBody)
  });
  assert.equal(disabledAgent.status, 403);
  assert.match((await disabledAgent.json()).error, /disabled by project configuration/);
  const stale = await fetch(`${controlPlane.url}/api/v1/inbox/runtime-permission`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: controlPlane.url,
      "x-temple-session": controlPlane.sessionSecret,
      "x-idempotency-key": body.idempotency_key
    },
    body: JSON.stringify(body)
  });
  assert.equal(stale.status, 409);
  assert.match((await stale.json()).error, /no longer live or answerable/);
  const arbitrary = await fetch(`${controlPlane.url}/api/v1/files`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
  assert.equal(arbitrary.status, 405);
  assert.match((await arbitrary.json()).error, /bounded Human Inbox routes/);
  await controlPlane.close();
});
