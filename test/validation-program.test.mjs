import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  buildCrossRepositoryUsageReportFromBaselines,
  normalizeValidationUsage,
  resolveValidationProgram,
  runValidationProgram,
  validateValidationProgramManifest,
  VALIDATION_PROGRAM_STATE_SCHEMA
} from "../src/validation-program.mjs";

function limits(overrides = {}) {
  return {
    max_turns: 10,
    max_launch_attempts: 10,
    max_retries: 0,
    max_concurrency: 2,
    per_turn_warning_tokens: 40000,
    per_turn_hard_tokens: 60000,
    aggregate_warning_tokens: 300000,
    aggregate_hard_tokens: 400000,
    per_turn_warning_ms: 600000,
    per_turn_hard_ms: 900000,
    program_warning_ms: 10800000,
    program_hard_ms: 14400000,
    per_repository_warning_bytes: 26214400,
    per_repository_hard_bytes: 52428800,
    aggregate_warning_bytes: 104857600,
    aggregate_hard_bytes: 209715200,
    ...overrides
  };
}

function turn(id, projectId = "coordinator", overrides = {}) {
  return {
    id,
    project_id: projectId,
    work_item_id: "WI-0001",
    position_id: "developer",
    requested_model: "gpt-5.6-luna",
    requested_reasoning_effort: "max",
    sandbox_mode: "workspace-write",
    approval_policy: "never",
    network_access: false,
    instruction_path: ".ai-org/artifacts/WI-0001/instructions.md",
    allowed_paths: ["src", "test"],
    ...overrides
  };
}

function manifestFixture(overrides = {}) {
  return {
    schema_version: "temple.validation-program/v1",
    id: "bounded-test",
    coordinator_project_id: "coordinator",
    authority: {
      network_access: false,
      external_writes: false,
      external_spend_yen: 0,
      api_key_use: false,
      usage_reset: false,
      deployment: false,
      publication: false,
      fallback_allowed: false
    },
    limits: limits(),
    participants: [
      {
        id: "coordinator",
        path: ".",
        expected_project_id: "coordinator",
        allowed_paths: ["src", "test"]
      }
    ],
    waves: [{ id: "wave-1", order: 1, turns: [turn("turn-1")] }],
    ...overrides
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("manifest validation requires zero retry, bounded waves, safe local paths, and 5.6 models", () => {
  assert.equal(validateValidationProgramManifest(manifestFixture()).valid, true);

  const cases = [
    ["retry", (document) => { document.limits.max_retries = 1; }, "max_retries"],
    ["turn count", (document) => { document.limits.max_turns = 0; }, "max_turns"],
    ["attempt count", (document) => { document.limits.max_launch_attempts = 0; }, "max_launch_attempts"],
    ["concurrency", (document) => {
      document.limits.max_concurrency = 1;
      document.participants.push({ id: "other", path: "../other", expected_project_id: "other", allowed_paths: ["src"] });
      document.waves[0].turns.push(turn("turn-2", "other", { allowed_paths: ["src"] }));
    }, "max_concurrency"],
    ["same repository twice", (document) => { document.waves[0].turns.push(turn("turn-2")); }, "duplicate coordinator"],
    ["escaped instruction", (document) => { document.waves[0].turns[0].instruction_path = "../secret.txt"; }, "instruction_path"],
    ["escaped allowlist", (document) => { document.waves[0].turns[0].allowed_paths = ["../secret"]; }, "unsafe path"],
    ["network", (document) => { document.waves[0].turns[0].network_access = true; }, "network_access"],
    ["approval", (document) => { document.waves[0].turns[0].approval_policy = "on-request"; }, "approval_policy"],
    ["model", (document) => { document.waves[0].turns[0].requested_model = "gpt-5.5"; }, "gpt-5.6"],
    ["Luna effort", (document) => { document.waves[0].turns[0].requested_reasoning_effort = "ultra"; }, "not supported by gpt-5.6-luna"],
    ["fallback", (document) => { document.authority.fallback_allowed = true; }, "fallback_allowed"],
    ["spend", (document) => { document.authority.external_spend_yen = 1; }, "external_spend_yen"]
  ];
  for (const [name, mutate, expected] of cases) {
    const document = clone(manifestFixture());
    mutate(document);
    const result = validateValidationProgramManifest(document);
    assert.equal(result.valid, false, name);
    assert.ok(result.errors.join("\n").includes(expected), name);
  }
});

test("program resolution verifies project identity and rejects repository or instruction escapes", async (testContext) => {
  const allowedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-validation-resolve-"));
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-validation-outside-"));
  testContext.after(() => fs.rm(allowedRoot, { recursive: true, force: true }));
  testContext.after(() => fs.rm(outsideRoot, { recursive: true, force: true }));
  const coordinator = path.join(allowedRoot, "coordinator");
  const instruction = path.join(coordinator, ".ai-org/artifacts/WI-0001/instructions.md");
  await fs.mkdir(path.dirname(instruction), { recursive: true });
  await fs.mkdir(path.join(coordinator, ".ai-org/project"), { recursive: true });
  const initialized = spawnSync("git", ["-C", coordinator, "init", "-b", "main"], { encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  await fs.writeFile(path.join(coordinator, ".ai-org/project/project.json"), JSON.stringify({ id: "coordinator", name: "Coordinator" }));
  await fs.writeFile(instruction, "Bounded fixture.\n");
  await fs.writeFile(path.join(coordinator, ".ai-org/project/validation-program.json"), JSON.stringify(manifestFixture()));

  const resolved = await resolveValidationProgram(coordinator, {
    manifestPath: ".ai-org/project/validation-program.json",
    allowedRoot
  });
  assert.equal(resolved.participants[0].project.id, "coordinator");
  assert.equal(resolved.participants[0].instructions.get("turn-1"), await fs.realpath(instruction));
  assert.equal(
    resolved.participants[0].resolved_usage_state_directory,
    path.join(await fs.realpath(path.join(coordinator, ".git")), "temple", "control-plane")
  );

  const worktreeTelemetry = manifestFixture({
    participants: [{
      id: "coordinator",
      path: ".",
      expected_project_id: "coordinator",
      allowed_paths: ["src", "test"],
      usage_state_directory: ".ai-org/runtime/control-plane"
    }]
  });
  await fs.writeFile(path.join(coordinator, ".ai-org/project/validation-program.json"), JSON.stringify(worktreeTelemetry));
  await assert.rejects(
    () => resolveValidationProgram(coordinator, { manifestPath: ".ai-org/project/validation-program.json", allowedRoot }),
    /participant coordinator usage state directory is invalid: Control-plane telemetry cannot be stored in the version-controlled worktree/
  );

  await fs.mkdir(path.join(outsideRoot, ".ai-org/project"), { recursive: true });
  await fs.writeFile(path.join(outsideRoot, ".ai-org/project/project.json"), JSON.stringify({ id: "outside", name: "Outside" }));
  await fs.symlink(outsideRoot, path.join(allowedRoot, "escaped"));
  const escaped = manifestFixture({
    participants: [{ id: "outside", path: "../escaped", expected_project_id: "outside", allowed_paths: ["src"] }],
    waves: [{ id: "wave-1", order: 1, turns: [turn("turn-1", "outside", { allowed_paths: ["src"] })] }]
  });
  await fs.writeFile(path.join(coordinator, ".ai-org/project/validation-program.json"), JSON.stringify(escaped));
  await assert.rejects(
    () => resolveValidationProgram(coordinator, { manifestPath: ".ai-org/project/validation-program.json", allowedRoot }),
    /escapes the allowed root/
  );
});

async function runtimeFixture(testContext, manifest, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "temple-validation-runner-"));
  testContext.after(() => fs.rm(root, { recursive: true, force: true }));
  const participants = manifest.participants.map((participant) => {
    const participantRoot = path.join(root, participant.id);
    return {
      ...participant,
      root: participantRoot,
      project: { id: participant.expected_project_id, name: participant.id },
      instructions: new Map(manifest.waves.flatMap((wave) =>
        wave.turns
          .filter((candidate) => candidate.project_id === participant.id)
          .map((candidate) => [candidate.id, path.join(participantRoot, candidate.instruction_path)])
      ))
    };
  });
  await Promise.all(participants.map((participant) => fs.mkdir(participant.root, { recursive: true })));
  return {
    root,
    resolved: {
      manifest,
      manifest_path: path.join(root, "manifest.json"),
      manifest_digest: "a".repeat(64),
      coordinator_root: root,
      allowed_root: root,
      participants
    },
    statePath: path.join(root, ".ai-org/runtime/validation-program/state.json"),
    eventsPath: path.join(root, ".ai-org/runtime/validation-program/events.jsonl"),
    ...options
  };
}

function stagedInspector(stagesByProject) {
  const calls = new Map();
  return async (root, options = {}) => {
    const projectId = path.basename(root);
    const stages = stagesByProject[projectId];
    const index = calls.get(projectId) ?? 0;
    calls.set(projectId, index + 1);
    const stage = stages[Math.min(index, stages.length - 1)];
    return {
      revision: stage.revision,
      dirty: stage.dirty ?? false,
      dirty_paths: stage.dirty_paths ?? [],
      changed_paths: options.baseRevision ? stage.changed_paths ?? [] : []
    };
  };
}

test("runner starts at most the declared concurrent wave and completes each turn once", async (testContext) => {
  const document = manifestFixture({
    participants: [
      { id: "coordinator", path: ".", expected_project_id: "coordinator", allowed_paths: ["src", "test"] },
      { id: "other", path: "../other", expected_project_id: "other", allowed_paths: ["src", "test"] }
    ],
    waves: [{ id: "wave-1", order: 1, turns: [turn("turn-1"), turn("turn-2", "other")] }]
  });
  const fixture = await runtimeFixture(testContext, document);
  let active = 0;
  let maximum = 0;
  const launches = [];
  const result = await runValidationProgram({
    ...fixture,
    inspectRepository: stagedInspector({
      coordinator: [
        { revision: "a".repeat(40) },
        { revision: "a".repeat(40) },
        { revision: "b".repeat(40), changed_paths: ["src/one.mjs"] }
      ],
      other: [
        { revision: "c".repeat(40) },
        { revision: "c".repeat(40) },
        { revision: "d".repeat(40), changed_paths: ["test/two.test.mjs"] }
      ]
    }),
    measureDisk: async () => 100,
    launchTurn: async ({ turn: selected, onUsage }) => {
      launches.push(selected.id);
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      await onUsage({ total_tokens: 100 });
      active -= 1;
      return { status: "completed" };
    }
  });
  assert.equal(result.state.status, "completed");
  assert.equal(result.state.counters.turns_completed, 2);
  assert.equal(result.state.counters.launch_attempts, 2);
  assert.equal(result.state.counters.aggregate_tokens, 200);
  assert.equal(maximum, 2);
  assert.deepEqual(launches.sort(), ["turn-1", "turn-2"]);
  const resumed = await runValidationProgram({ ...fixture, launchTurn: async () => assert.fail("completed turns must not relaunch") });
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.state.status, "completed");
});

async function stoppedRun(testContext, limitOverrides, behavior, after = {}) {
  const document = manifestFixture({ limits: limits(limitOverrides) });
  const fixture = await runtimeFixture(testContext, document);
  let measureCalls = 0;
  return runValidationProgram({
    ...fixture,
    inspectRepository: stagedInspector({
      coordinator: [
        { revision: "a".repeat(40) },
        { revision: "a".repeat(40) },
        { revision: "b".repeat(40), changed_paths: after.changed_paths ?? ["src/change.mjs"] }
      ]
    }),
    measureDisk: async () => {
      measureCalls += 1;
      return measureCalls === 1 ? 100 : 100 + (after.disk_delta ?? 0);
    },
    launchTurn: behavior
  });
}

test("runner isolates a per-turn non-cached Token limit and records interrupted filesystem state", async (testContext) => {
  let launches = 0;
  const result = await stoppedRun(testContext, { per_turn_warning_tokens: 4, per_turn_hard_tokens: 5 }, async ({ onUsage }) => {
    launches += 1;
    const decision = await onUsage({
      input_tokens: 10,
      cached_input_tokens: 6,
      output_tokens: 1,
      reasoning_output_tokens: 1,
      total_tokens: 11
    });
    assert.equal(decision.interrupt, true);
    throw Object.assign(new Error("per-turn-token-hard-limit"), { code: "per-turn-token-hard-limit" });
  }, { changed_paths: ["src/change.mjs"], disk_delta: 6 });
  assert.equal(result.state.status, "completed");
  assert.equal(result.state.stop, null);
  assert.equal(result.state.turns["turn-1"].stop_code, "per-turn-token-hard-limit");
  assert.equal(result.state.turns["turn-1"].budget_tokens, 5);
  assert.equal(result.state.turns["turn-1"].total_tokens, 11);
  assert.deepEqual(result.state.turns["turn-1"].changed_paths, ["src/change.mjs"]);
  assert.equal(result.state.turns["turn-1"].disk_delta_bytes, 6);
  assert.equal(result.state.counters.aggregate_budget_tokens, 5);
  assert.equal(result.state.counters.aggregate_tokens, 11);
  assert.equal(result.state.counters.launch_attempts, 1);
  assert.equal(launches, 1);
  const events = (await fs.readFile(result.eventsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  const usageEvent = events.find((event) => event.type === "turn-usage");
  assert.equal(usageEvent.input_tokens, 10);
  assert.equal(usageEvent.cached_input_tokens, 6);
  assert.equal(usageEvent.output_tokens, 1);
  assert.equal(usageEvent.reasoning_output_tokens, 1);
  assert.equal(usageEvent.budget_tokens, 5);
  const stoppedEvent = events.find((event) => event.type === "turn-stopped");
  assert.deepEqual(stoppedEvent.changed_paths, ["src/change.mjs"]);
  assert.equal(stoppedEvent.disk_delta_bytes, 6);
});

test("detailed Token accounting uses non-cached input plus output as the operational budget", () => {
  assert.deepEqual(normalizeValidationUsage({
    input_tokens: 104426,
    cached_input_tokens: 75008,
    output_tokens: 2220,
    reasoning_output_tokens: 1017,
    total_tokens: 106646
  }), {
    input_tokens: 104426,
    cached_input_tokens: 75008,
    output_tokens: 2220,
    reasoning_output_tokens: 1017,
    total_tokens: 106646,
    budget_tokens: 31638,
    budget_basis: "noncached-input-plus-output"
  });
  assert.equal(normalizeValidationUsage({ total_tokens: 25 }).budget_tokens, 25);
  assert.throws(() => normalizeValidationUsage({
    input_tokens: 5,
    cached_input_tokens: 6,
    output_tokens: 1,
    reasoning_output_tokens: 0,
    total_tokens: 6
  }), /must not exceed/);
});

test("a candidate-local Token stop does not prevent a later independent wave", async (testContext) => {
  const document = manifestFixture({
    participants: [
      { id: "coordinator", path: ".", expected_project_id: "coordinator", allowed_paths: ["src", "test"] },
      { id: "other", path: "../other", expected_project_id: "other", allowed_paths: ["src", "test"] }
    ],
    limits: limits({ per_turn_warning_tokens: 4, per_turn_hard_tokens: 5 }),
    waves: [
      { id: "wave-1", order: 1, turns: [turn("turn-1")] },
      { id: "wave-2", order: 2, turns: [turn("turn-2", "other")] }
    ]
  });
  const fixture = await runtimeFixture(testContext, document);
  const launches = [];
  const result = await runValidationProgram({
    ...fixture,
    inspectRepository: stagedInspector({
      coordinator: [
        { revision: "a".repeat(40) },
        { revision: "a".repeat(40) },
        { revision: "a".repeat(40), changed_paths: [] }
      ],
      other: [
        { revision: "b".repeat(40) },
        { revision: "b".repeat(40) },
        { revision: "c".repeat(40), changed_paths: ["src/two.mjs"] }
      ]
    }),
    measureDisk: async () => 100,
    launchTurn: async ({ turn: selected, onUsage }) => {
      launches.push(selected.id);
      if (selected.id === "turn-1") {
        await onUsage({ total_tokens: 5 });
        throw Object.assign(new Error("per-turn-token-hard-limit"), { code: "per-turn-token-hard-limit" });
      }
      await onUsage({ total_tokens: 2 });
      return { status: "completed" };
    }
  });
  assert.deepEqual(launches, ["turn-1", "turn-2"]);
  assert.equal(result.state.status, "completed");
  assert.equal(result.state.turns["turn-1"].status, "stopped");
  assert.equal(result.state.turns["turn-2"].status, "completed");
  assert.equal(result.state.counters.turns_completed, 1);
  assert.equal(result.state.counters.launch_attempts, 2);
  assert.ok(result.state.warnings.some((entry) => entry.code === "candidate-local-stop"));
});

test("runner interrupts at the aggregate Token hard limit", async (testContext) => {
  const result = await stoppedRun(testContext, {
    per_turn_warning_tokens: 90,
    per_turn_hard_tokens: 100,
    aggregate_warning_tokens: 9,
    aggregate_hard_tokens: 10
  }, async ({ onUsage }) => {
    assert.equal((await onUsage({ total_tokens: 10 })).reason, "aggregate-token-hard-limit");
    return { status: "completed" };
  });
  assert.equal(result.state.stop.code, "aggregate-token-hard-limit");
  assert.equal(result.state.counters.aggregate_tokens, 10);
});

test("runner isolates a turn at its wall-clock hard limit", async (testContext) => {
  const result = await stoppedRun(testContext, {
    per_turn_warning_ms: 5,
    per_turn_hard_ms: 20,
    program_warning_ms: 30000,
    program_hard_ms: 60000
  }, async ({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(Object.assign(new Error("interrupted"), { code: signal.reason?.code ?? signal.reason?.message })), { once: true });
  }));
  assert.equal(result.state.status, "completed");
  assert.equal(result.state.stop, null);
  assert.equal(result.state.turns["turn-1"].stop_code, "per-turn-time-hard-limit");
  assert.equal(result.state.counters.launch_attempts, 1);
});

test("runner interrupts a turn at the program wall-clock hard limit", async (testContext) => {
  const result = await stoppedRun(testContext, {
    per_turn_warning_ms: 30000,
    per_turn_hard_ms: 60000,
    program_warning_ms: 5,
    program_hard_ms: 20
  }, async ({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(Object.assign(new Error("interrupted"), { code: signal.reason?.code ?? signal.reason?.message })), { once: true });
  }));
  assert.equal(result.state.status, "stopped");
  assert.equal(result.state.stop.code, "program-time-hard-limit");
});

test("runner stops on per-repository disk growth and path allowlist violations", async (testContext) => {
  const disk = await stoppedRun(testContext, {
    per_repository_warning_bytes: 5,
    per_repository_hard_bytes: 10,
    aggregate_warning_bytes: 100,
    aggregate_hard_bytes: 200
  }, async () => ({ status: "completed" }), { disk_delta: 10 });
  assert.equal(disk.state.stop.code, "per-repository-disk-hard-limit");

  const paths = await stoppedRun(testContext, {}, async () => ({ status: "completed" }), {
    changed_paths: ["private/secret.txt"]
  });
  assert.equal(paths.state.stop.code, "path-allowlist-violation");
  assert.match(paths.state.stop.message, /private\/secret\.txt/);
});

test("runner stops a concurrent wave at the aggregate disk hard limit", async (testContext) => {
  const document = manifestFixture({
    limits: limits({
      per_repository_warning_bytes: 90,
      per_repository_hard_bytes: 100,
      aggregate_warning_bytes: 9,
      aggregate_hard_bytes: 10
    }),
    participants: [
      { id: "coordinator", path: ".", expected_project_id: "coordinator", allowed_paths: ["src", "test"] },
      { id: "other", path: "../other", expected_project_id: "other", allowed_paths: ["src", "test"] }
    ],
    waves: [{ id: "wave-1", order: 1, turns: [turn("turn-1"), turn("turn-2", "other")] }]
  });
  const fixture = await runtimeFixture(testContext, document);
  const measurements = new Map();
  const result = await runValidationProgram({
    ...fixture,
    inspectRepository: stagedInspector({
      coordinator: [
        { revision: "a".repeat(40) },
        { revision: "a".repeat(40) },
        { revision: "b".repeat(40), changed_paths: ["src/one.mjs"] }
      ],
      other: [
        { revision: "c".repeat(40) },
        { revision: "c".repeat(40) },
        { revision: "d".repeat(40), changed_paths: ["src/two.mjs"] }
      ]
    }),
    measureDisk: async (root) => {
      const count = measurements.get(root) ?? 0;
      measurements.set(root, count + 1);
      return count === 0 ? 100 : 106;
    },
    launchTurn: async () => ({ status: "completed" })
  });
  assert.equal(result.state.status, "stopped");
  assert.equal(result.state.stop.code, "aggregate-disk-hard-limit");
  assert.equal(result.state.counters.aggregate_disk_delta_bytes, 12);
});

test("runner fails closed on dirty start and an ambiguous persisted attempt", async (testContext) => {
  const document = manifestFixture();
  const dirtyFixture = await runtimeFixture(testContext, document);
  let launches = 0;
  const dirty = await runValidationProgram({
    ...dirtyFixture,
    inspectRepository: async () => ({
      revision: "a".repeat(40),
      dirty: true,
      dirty_paths: ["src/dirty.mjs"],
      changed_paths: ["src/dirty.mjs"]
    }),
    measureDisk: async () => 0,
    launchTurn: async () => { launches += 1; }
  });
  assert.equal(dirty.state.stop.code, "dirty-participant-start");
  assert.equal(launches, 0);

  const ambiguousFixture = await runtimeFixture(testContext, document);
  const timestamp = new Date().toISOString();
  const state = {
    schema_version: VALIDATION_PROGRAM_STATE_SCHEMA,
    program_id: document.id,
    manifest_digest: ambiguousFixture.resolved.manifest_digest,
    status: "running",
    started_at: timestamp,
    updated_at: timestamp,
    completed_at: null,
    counters: {
      turns_started: 1,
      turns_completed: 0,
      launch_attempts: 1,
      aggregate_tokens: 0,
      program_elapsed_ms: 0,
      aggregate_disk_delta_bytes: 0
    },
    repository_baselines: {},
    waves: { "wave-1": { status: "running", completed_at: null } },
    turns: {
      "turn-1": {
        status: "running",
        attempts: 1,
        started_at: timestamp,
        completed_at: null,
        duration_ms: null,
        total_tokens: 0,
        before_revision: "a".repeat(40),
        after_revision: null,
        changed_paths: [],
        disk_delta_bytes: 0,
        result: null,
        stop_code: null
      }
    },
    warnings: [],
    stop: null
  };
  await fs.mkdir(path.dirname(ambiguousFixture.statePath), { recursive: true });
  await fs.writeFile(ambiguousFixture.statePath, JSON.stringify(state));
  const ambiguous = await runValidationProgram({
    ...ambiguousFixture,
    launchTurn: async () => assert.fail("ambiguous attempt must not relaunch")
  });
  assert.equal(ambiguous.state.stop.code, "ambiguous-running-attempt");
  assert.equal(ambiguous.state.counters.launch_attempts, 1);
});

function baseline(projectId, workItems) {
  return {
    schema_version: "temple.usage-baseline/v1",
    generated_at: "2026-08-31T00:00:00.000Z",
    project: { id: projectId, name: projectId },
    baseline_status: "observed",
    source: {
      longitudinal_coverage: {
        detailed_token_observation_coverage: {
          qualified_completed_work_item_ids: workItems.map((entry) => entry.id)
        }
      }
    },
    driver_groups: workItems.map((entry, index) => ({
      dimensions: {
        project_id: projectId,
        work_item_id: entry.id,
        task_id: `task-${index + 1}`,
        position_id: entry.position,
        lifecycle_stage: entry.stage,
        model: "gpt-5.6-luna"
      },
      observations: 1,
      tokens: {
        input_tokens: 100,
        cached_input_tokens: 20,
        output_tokens: 30,
        reasoning_output_tokens: 10,
        total_tokens: 150
      }
    }))
  };
}

test("cross-repository report qualifies ten distinct completed Work Items across two shapes", () => {
  const participants = [
    {
      project_id: "coordinator",
      revision: "a".repeat(40),
      baseline: baseline("coordinator", [
        { id: "WI-0001", position: "product_manager", stage: "spec" },
        { id: "WI-0002", position: "developer", stage: "build" }
      ])
    },
    {
      project_id: "catalog",
      revision: "b".repeat(40),
      baseline: baseline("catalog", [
        { id: "WI-0001", position: "tech_lead", stage: "design" },
        { id: "WI-0002", position: "developer", stage: "build" }
      ])
    },
    {
      project_id: "orders",
      revision: "c".repeat(40),
      baseline: baseline("orders", [
        { id: "WI-0001", position: "product_manager", stage: "spec" },
        { id: "WI-0002", position: "developer", stage: "build" },
        { id: "WI-0003", position: "developer", stage: "build" },
        { id: "WI-0004", position: "developer", stage: "build" }
      ])
    },
    {
      project_id: "notifications",
      revision: "d".repeat(40),
      baseline: baseline("notifications", [
        { id: "WI-0001", position: "developer", stage: "build" },
        { id: "WI-0002", position: "independent_qa", stage: "independent_qa" }
      ])
    }
  ];
  const report = buildCrossRepositoryUsageReportFromBaselines(participants, {
    programId: "commerce-rehearsal",
    manifestDigest: "e".repeat(64),
    coordinatorProjectId: "coordinator",
    now: new Date("2026-08-31T01:00:00.000Z")
  });
  assert.equal(report.status, "qualified-observation");
  assert.equal(report.qualification.qualified_completed_work_items, 10);
  assert.ok(report.qualification.qualified_task_shapes >= 2);
  assert.equal(report.totals.total_tokens, 1500);
  assert.deepEqual(report.claims, {
    savings_claim_allowed: false,
    cost_claim_allowed: false,
    model_quality_claim_allowed: false,
    routing_claim_allowed: false,
    enterprise_readiness_claim_allowed: false,
    automatic_routing: false
  });
  assert.equal(report.authority.lifecycle_authority, "participant-repositories");
});

test("cross-repository report keeps unknown totals unknown and rejects conflicting identities", () => {
  const document = baseline("one", [{ id: "WI-0001", position: "developer", stage: "build" }]);
  document.driver_groups[0].tokens.cached_input_tokens = null;
  document.driver_groups.push({
    ...clone(document.driver_groups[0]),
    dimensions: { ...document.driver_groups[0].dimensions, task_id: "task-conflict" }
  });
  const report = buildCrossRepositoryUsageReportFromBaselines([
    { project_id: "one", revision: "a".repeat(40), baseline: document }
  ], { requiredWorkItems: 1 });
  assert.equal(report.status, "not-qualified");
  assert.equal(report.totals.cached_input_tokens, null);
  assert.match(report.issues.join("\n"), /exactly one task\/model\/shape identity/);
});
