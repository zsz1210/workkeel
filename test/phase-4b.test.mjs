import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  evaluatePolicy,
  scorePolicyEvaluation,
  validateAdversarialScenarioCatalog
} from "../src/policy-evaluation.mjs";
import { classifyCodexTasks, normalizeCodexMessage } from "../src/codex-app-server-provider.mjs";
import {
  buildMatchedModelAdvisory,
  buildUsageBaselineFromRecords,
  buildUsagePreflightFromRecords,
  evaluateMatchedModelEvaluation,
  probeCodexAccountUsage,
  readUsageTelemetryHistory,
  validateMatchedModelEvaluation
} from "../src/usage-attribution.mjs";
import { defaultControlPlaneConfig } from "../src/control-plane-config.mjs";
import { openTelemetryJournal } from "../src/telemetry.mjs";
import { defaultUsagePolicy, validateUsagePolicy } from "../src/usage-policy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin/temple.mjs");
const fixtureRoot = path.join(root, "test/fixtures/phase-4b");

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

async function fixture(context) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-phase-4b-test-"));
  const target = path.join(temporaryRoot, "policy-product");
  const configPath = path.join(temporaryRoot, "init.json");
  const stateDirectory = path.join(temporaryRoot, "telemetry");
  context.after(() => removeTemporaryTree(temporaryRoot));
  await writeJson(configPath, {
    schema_version: "temple.init/v1",
    project: { id: "policy-product", name: "Policy Product" },
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
  const evaluationDirectory = path.join(target, ".ai-org/artifacts/policy-evaluation");
  await fs.mkdir(evaluationDirectory, { recursive: true });
  for (const profile of ["solo", "collaborative", "high-assurance"]) {
    await fs.copyFile(path.join(fixtureRoot, `${profile}.json`), path.join(evaluationDirectory, `${profile}.json`));
  }
  return { target, stateDirectory };
}

function matchedUsagePolicy(options = {}) {
  const policy = defaultUsagePolicy({
    profileMappings: [
      { id: "mechanical-fast", provider_id: "codex-local", model: "gpt-5.6-luna", reasoning_effort: "medium" },
      { id: "lightweight-quality", provider_id: "codex-local", model: "gpt-5.6-luna", reasoning_effort: "max" },
      { id: "standard", provider_id: "codex-local", model: "gpt-5.6-terra", reasoning_effort: "medium" },
      { id: "critical-planning", provider_id: "codex-local", model: "gpt-5.6-sol", reasoning_effort: "xhigh" }
    ]
  });
  policy.calibration.state = "calibrating";
  policy.calibration.recommendation_mode = options.mode ?? "advisory";
  policy.calibration.statistical_qualification = {
    status: "satisfied",
    method: "paired-sign-test-v1",
    minimum_effect: 0.1,
    alpha: 0.05,
    power: 0.8,
    pilot_variance: 100
  };
  policy.calibration.matched_evaluation.sources = options.sources ?? [];
  return policy;
}

function matchedEvaluationDocument(options = {}) {
  const caseIds = Array.from({ length: 6 }, (_, index) => `case-${index + 1}`);
  const makeCases = (profile) => caseIds.map((caseId, index) => ({
    case_id: caseId,
    input_digest: `sha256:${(index + 1).toString(16).padStart(64, "0")}`,
    source_revision: "matched-source-revision",
    quality_score: profile === "standard" ? 0.92 : 0.9,
    quality_evidence_refs: [`.ai-org/evidence/${profile}-${caseId}.json`],
    total_tokens: profile === "standard" ? 100 + index : 70 + index,
    latency_ms: profile === "standard" ? 1000 + index : 800 + index,
    rework_count: 0,
    human_intervention_count: 0
  }));
  const document = {
    schema_version: "temple.matched-model-evaluation/v1",
    evaluation_id: options.evaluationId ?? "matched-model-fixture",
    project_id: options.projectId ?? "policy-product",
    observed_at: "2026-08-31T00:00:00.000Z",
    expires_at: "2026-12-01T00:00:00.000Z",
    task_shape: {
      position_id: "developer",
      lifecycle_stage: "build",
      task_kind: "implementation",
      risk_class: "standard",
      context_profile_digest: `sha256:${"a".repeat(64)}`
    },
    rubric: {
      id: "repository-quality-v1",
      revision: "quality-1",
      required_case_ids: caseIds,
      minimum_score: 0.8
    },
    decision_contract: {
      method: "paired-sign-test-v1",
      minimum_effect: 0.1,
      alpha: 0.05,
      power: 0.8,
      pilot_variance: 100
    },
    baseline_profile_id: "standard",
    candidates: [
      {
        profile_id: "standard",
        provider_id: "codex-local",
        requested_model: "gpt-5.6-terra",
        effective_model: "gpt-5.6-terra",
        requested_reasoning_effort: "medium",
        effective_reasoning_effort: "medium",
        cases: makeCases("standard")
      },
      {
        profile_id: "lightweight-quality",
        provider_id: "codex-local",
        requested_model: "gpt-5.6-luna",
        effective_model: "gpt-5.6-luna",
        requested_reasoning_effort: "max",
        effective_reasoning_effort: "max",
        cases: makeCases("lightweight-quality")
      }
    ],
    privacy: {
      raw_prompts_retained: false,
      responses_retained: false,
      hidden_reasoning_retained: false,
      credentials_retained: false,
      raw_provider_payloads_retained: false
    }
  };
  return document;
}

test("the adversarial catalog covers the seven Phase 4B failure classes", async () => {
  const catalog = JSON.parse(await fs.readFile(path.join(root, "project-overlay/.ai-org/core/adversarial-scenarios.json"), "utf8"));
  assert.deepEqual(validateAdversarialScenarioCatalog(catalog), { valid: true, errors: [] });
  assert.deepEqual(catalog.scenarios.map((scenario) => scenario.id), [
    "false-completion",
    "wrong-revision",
    "self-approval",
    "unauthorized-external-action",
    "stale-scope",
    "context-loss",
    "noisy-notification"
  ]);
});

test("Solo, Collaborative, and High-Assurance observations produce read-only passing scorecards", async (context) => {
  const { target } = await fixture(context);
  for (const profile of ["solo", "collaborative", "high-assurance"]) {
    const relative = `.ai-org/artifacts/policy-evaluation/${profile}.json`;
    const result = run(["evaluation", "run", target, "--fixture", relative, "--no-write", "--json"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "passed");
    assert.equal(report.summary.scenarios, 7);
    assert.equal(report.summary.failed, 0);
    assert.equal(report.summary.incomplete, 0);
    assert.ok(Object.values(report.dimensions).every((dimension) => dimension.rate === 1));
    assert.equal(report.authority.lifecycle_gates_changed, false);
    assert.equal(report.external_action_performed, false);
  }
  await assert.rejects(() => fs.access(path.join(target, ".ai-org/views/policy-evaluation.json")));
  const written = run([
    "evaluation", "run", target,
    "--fixture", ".ai-org/artifacts/policy-evaluation/solo.json",
    "--json"
  ]);
  assert.equal(written.status, 0, written.stderr || written.stdout);
  assert.equal(JSON.parse(await fs.readFile(path.join(target, ".ai-org/views/policy-evaluation.json"), "utf8")).status, "passed");
  const schemas = run(["schema", "validate", target, "--json"]);
  assert.equal(schemas.status, 0, schemas.stderr || schemas.stdout);
});

test("escaped, missing, and undeclared-side-effect scenarios fail closed", async (context) => {
  const { target } = await fixture(context);
  const catalog = JSON.parse(await fs.readFile(path.join(target, ".ai-org/core/adversarial-scenarios.json"), "utf8"));
  const solo = JSON.parse(await fs.readFile(path.join(fixtureRoot, "solo.json"), "utf8"));
  const escaped = structuredClone(solo);
  escaped.run_id = "escaped-policy-case";
  escaped.results[0].outcome = "escaped";
  escaped.results[0].checks.gate_integrity = false;
  escaped.results[0].side_effects.push("external-deployment");
  const escapedPath = path.join(target, ".ai-org/artifacts/policy-evaluation/escaped.json");
  await writeJson(escapedPath, escaped);
  const escapedRun = run(["evaluation", "run", target, "--fixture", ".ai-org/artifacts/policy-evaluation/escaped.json", "--no-write", "--json"]);
  assert.equal(escapedRun.status, 1);
  const escapedReport = JSON.parse(escapedRun.stdout);
  assert.equal(escapedReport.status, "failed");
  assert.match(escapedReport.cases[0].violations.join("\n"), /undeclared side effect/);
  assert.equal(escapedReport.summary.outcomes.escaped, 1);

  const missing = structuredClone(solo);
  missing.run_id = "missing-policy-case";
  missing.results = missing.results.slice(1);
  const incomplete = scorePolicyEvaluation(catalog, missing);
  assert.equal(incomplete.status, "incomplete");
  assert.equal(incomplete.summary.incomplete, 1);

  const unknown = structuredClone(solo);
  unknown.run_id = "unknown-policy-case";
  unknown.results[0].outcome = "unknown";
  const unknownReport = scorePolicyEvaluation(catalog, unknown);
  assert.equal(unknownReport.status, "incomplete");
});

test("provider usage carries proven dimensions and leaves unavailable routing data unknown", () => {
  const tasks = [{
    id: "task-0001",
    work_item_id: "WI-0001",
    position_id: "developer",
    agent_id: "agent-devon",
    thread_id: "thread-1",
    current_revision: "a".repeat(40)
  }];
  const workItems = [{ id: "WI-0001", state: "build" }];
  const event = normalizeCodexMessage("policy-product", tasks, {
    method: "thread/tokenUsage/updated",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      model: "model-alpha",
      modelVersion: "2026-08-30",
      effectiveTurnReasoningEffort: "medium",
      serviceTier: "priority",
      tokenUsage: {
        total: { inputTokens: 90, cachedInputTokens: 10, outputTokens: 20, reasoningOutputTokens: 5, totalTokens: 125 },
        last: { inputTokens: 90, cachedInputTokens: 10, outputTokens: 20, reasoningOutputTokens: 5, totalTokens: 125 },
        modelContextWindow: 10000
      }
    }
  }, { observedAt: "2026-08-30T00:00:00.000Z", workItems, providerId: "codex-local" });
  assert.equal(event.data.attribution.work_item_id, "WI-0001");
  assert.equal(event.data.attribution.position_id, "developer");
  assert.equal(event.data.attribution.lifecycle_stage, "build");
  assert.equal(event.data.attribution.attempt_id, "turn-1");
  assert.equal(event.data.attribution.model, "model-alpha");
  assert.equal(event.data.attribution.requested_reasoning_effort, null);
  assert.equal(event.data.attribution.observed_thread_reasoning_effort, null);
  assert.equal(event.data.attribution.effective_turn_reasoning_effort, "medium");
  assert.equal(event.data.attribution.reasoning_effort, "medium");
  assert.equal(event.data.attribution.reasoning_effort_source, "provider-turn");
  assert.equal(event.data.attribution.source, "provider-reported");
  assert.equal(event.data.attribution.quality, "partial");
  assert.deepEqual(event.data.attribution.missing_dimensions, ["context_capsule_digest", "capability_set_digest"]);
  assert.equal(event.data.usage.monetary_cost, null);
  assert.doesNotMatch(JSON.stringify(event), /prompt|hidden reasoning|source code/i);
});

test("provider-owned usage qualifies against launch revision without conflating the later candidate", () => {
  const launchRevision = "a".repeat(40);
  const candidateRevision = "b".repeat(40);
  const task = {
    id: "task-0001",
    work_item_id: "WI-0001",
    position_id: "developer",
    agent_id: "agent-devon",
    status: "completed",
    thread_id: "thread-provider-owned",
    execution_origin: "temple-provider-owned",
    provider_id: "codex-local",
    requested_model: "model-beta",
    effective_model: "model-beta",
    reasoning_effort: "low",
    launch_revision: launchRevision,
    current_revision: candidateRevision
  };
  const workItems = [{ id: "WI-0001", state: "done" }];
  const event = normalizeCodexMessage("policy-product", [task], {
    method: "thread/tokenUsage/updated",
    params: {
      threadId: task.thread_id,
      turnId: "turn-1",
      tokenUsage: {
        total: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 1, totalTokens: 13 },
        last: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 1, totalTokens: 13 }
      }
    }
  }, { observedAt: "2026-08-31T00:00:00.000Z", workItems, providerId: "codex-local" });
  assert.equal(event.data.scope_revision, launchRevision);
  assert.equal(event.data.attribution.model, "model-beta");
  assert.equal(event.data.attribution.model_source, "canonical-effective");
  const coverage = buildUsageBaselineFromRecords(
    { id: "policy-product", name: "Policy Product" },
    [event],
    { workItems, tasks: [task], longitudinalWorkItemsRequired: 1 }
  ).source.longitudinal_coverage;
  assert.equal(coverage.detailed_token_observation_coverage.stale_observations, 0);
  assert.equal(coverage.detailed_token_observation_coverage.qualified_completed_work_items, 1);
  assert.equal(coverage.qualification.completed_coverage_threshold_met, true);
  assert.equal(coverage.qualification.varied_task_shapes, "insufficient");
  assert.equal(coverage.qualification.savings_claim_allowed, false);
});

test("usage preflight distinguishes live task telemetry from account-wide unallocated availability", async () => {
  const tasks = [
    { id: "task-setup", status: "setup", thread_id: "thread-setup" },
    { id: "task-active", work_item_id: "WI-0001", status: "active", thread_id: "thread-active" },
    { id: "task-waiting", status: "waiting", thread_id: "thread-waiting" },
    { id: "task-attention", status: "attention", thread_id: "thread-attention" },
    { id: "task-completed", status: "completed", thread_id: "thread-completed" },
    { id: "task-archived", status: "archived", thread_id: "thread-archived" }
  ];
  const topology = classifyCodexTasks(tasks);
  assert.deepEqual(
    Object.fromEntries(Object.entries(topology).map(([key, value]) => [key, value.length])),
    { registered: 6, history_reconcilable: 5, live_resumable: 3, terminal: 2, non_live: 1 }
  );

  const rpcCalls = [];
  const accountProbe = await probeCodexAccountUsage("/tmp/unused", {
    connectionFactory: async () => ({
      async request(method) {
        rpcCalls.push(method);
        if (method === "initialize") return { serverInfo: { version: "fixture-usage" } };
        return {
          summary: { lifetimeTokens: 987654321, currentStreakDays: null },
          dailyUsageBuckets: [{ startDate: "2026-08-30", tokens: 4567890 }]
        };
      },
      notify(method) { rpcCalls.push(method); },
      async close() { rpcCalls.push("close"); }
    })
  });
  assert.deepEqual(rpcCalls, ["initialize", "initialized", "account/usage/read", "close"]);
  assert.equal(accountProbe.availability, "available");
  assert.equal(accountProbe.scope, "account-wide");
  assert.equal(accountProbe.allocation, "unallocated");
  assert.deepEqual(accountProbe.summary_fields, ["currentStreakDays", "lifetimeTokens"]);
  assert.deepEqual(accountProbe.non_null_summary_fields, ["lifetimeTokens"]);
  assert.equal(accountProbe.daily_bucket_count, 1);
  assert.equal(accountProbe.raw_values_retained, false);
  assert.doesNotMatch(JSON.stringify(accountProbe), /987654321|4567890/);

  const providers = [{
    id: "codex-local",
    kind: "codex-app-server",
    status: "ready",
    capabilities: { token_usage: "supported" },
    protocol: { detected_cli_version: "fixture-usage" }
  }];
  const awaiting = buildUsagePreflightFromRecords(
    { id: "policy-product", name: "Policy Product" },
    tasks,
    [],
    providers,
    accountProbe
  );
  assert.equal(awaiting.detailed_thread_usage.status, "capturing");
  assert.equal(awaiting.detailed_thread_usage.evidence_status, "none");
  assert.equal(awaiting.capture_health.live_resumable_tasks, 3);
  assert.equal(awaiting.baseline_qualification.status, "not-qualified");
  assert.equal(awaiting.baseline_qualification.account_usage_can_qualify, false);
  assert.equal(awaiting.routing.automatic_routing, false);
  assert.equal(awaiting.external_read_performed, true);
  assert.equal(awaiting.external_action_performed, false);

  const terminalOnly = buildUsagePreflightFromRecords(
    { id: "policy-product", name: "Policy Product" },
    tasks.filter((task) => task.status === "completed" || task.status === "archived"),
    [],
    [{ ...providers[0], status: "disabled" }],
    null
  );
  assert.equal(terminalOnly.detailed_thread_usage.status, "not-capturing");
  assert.equal(terminalOnly.capture_health.reason, "provider-disabled");
  assert.equal(terminalOnly.task_topology.terminal, 2);
  assert.equal(terminalOnly.task_topology.terminal_tasks_are_live_resumable, false);

  const usageEvent = normalizeCodexMessage("policy-product", [{
    id: "task-active",
    work_item_id: "WI-0001",
    position_id: "developer",
    agent_id: "agent-devon",
    status: "active",
    thread_id: "thread-active"
  }], {
    method: "thread/tokenUsage/updated",
    params: {
      threadId: "thread-active",
      turnId: "turn-1",
      tokenUsage: {
        total: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 1, totalTokens: 13 },
        last: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 1, totalTokens: 13 },
        modelContextWindow: 10000
      }
    }
  }, { observedAt: "2026-08-30T00:00:00.000Z" });
  const observed = buildUsagePreflightFromRecords(
    { id: "policy-product", name: "Policy Product" },
    tasks,
    [usageEvent],
    providers,
    accountProbe
  );
  assert.equal(observed.detailed_thread_usage.status, "capturing");
  assert.equal(observed.detailed_thread_usage.evidence_status, "observed");
  assert.equal(observed.capture_health.last_observed_at, "2026-08-30T00:00:00.000Z");
  assert.equal(observed.detailed_thread_usage.correlated_observations, 1);
  assert.equal(observed.baseline_qualification.status, "not-qualified");
  assert.equal(observed.baseline_qualification.savings_claim_allowed, false);
});

test("usage preflight leaves Independent QA Work Item mismatches and unregistered tasks uncorrelated", () => {
  const project = { id: "policy-product", name: "Policy Product" };
  const workItems = [
    { id: "WI-0016", state: "done" },
    { id: "WI-0017", state: "done" }
  ];
  const tasks = [{
    id: "task-independent-qa",
    work_item_id: "WI-0016",
    position_id: "independent_qa",
    status: "completed",
    thread_id: "thread-independent-qa",
    current_revision: "candidate-revision"
  }];
  const usageRecord = (id, taskId, workItemId, cursor) => ({
    specversion: "1.0",
    id,
    source: "urn:temple:provider:codex-app-server:local",
    type: "org.temple.codex.usage.updated.v1",
    subject: `project/policy-product/work-item/${workItemId}`,
    time: `2026-08-30T00:00:0${cursor}.000Z`,
    data: {
      project_id: "policy-product",
      work_item_id: workItemId,
      task_id: taskId,
      scope_revision: "candidate-revision",
      attribution: {
        project_id: "policy-product",
        work_item_id: workItemId,
        task_id: taskId,
        position_id: "independent_qa",
        lifecycle_stage: "independent_qa",
        model: "model-qa"
      },
      usage: {
        last: {
          input_tokens: 10,
          cached_input_tokens: 0,
          output_tokens: 2,
          reasoning_output_tokens: 1,
          total_tokens: 13
        }
      }
    },
    templecursor: cursor,
    templeobservedat: `2026-08-30T00:00:0${cursor}.000Z`
  });
  const mismatched = usageRecord("usage-mismatched-work-item", "task-independent-qa", "WI-0017", 1);
  const unregistered = usageRecord("usage-unregistered-task", "task-not-registered", "WI-0016", 2);

  const preflight = buildUsagePreflightFromRecords(
    project,
    tasks,
    [mismatched, unregistered],
    [{ id: "codex-local", kind: "codex-app-server", status: "ready", capabilities: { token_usage: "supported" } }],
    null,
    { workItems }
  );

  assert.equal(preflight.detailed_thread_usage.status, "ready-no-live-task");
  assert.equal(preflight.detailed_thread_usage.evidence_status, "observed");
  assert.equal(preflight.detailed_thread_usage.observations, 2);
  assert.equal(preflight.detailed_thread_usage.correlated_observations, 0);
  assert.equal(preflight.detailed_thread_usage.uncorrelated_observations, 2);
  assert.equal(preflight.baseline_qualification.status, "not-qualified");
  assert.equal(preflight.baseline_qualification.qualified_completed_work_items, 0);
  assert.equal(preflight.baseline_qualification.savings_claim_allowed, false);
  assert.equal(preflight.routing.recommendation_status, "not-qualified");
  assert.equal(preflight.routing.recommendation.routing_authority, false);
  assert.equal(preflight.routing.recommendation.automatic_routing, false);
  assert.equal(preflight.routing.recommendation.model_switch_performed, false);
  assert.equal(preflight.routing.recommendation.budget_can_skip_gates, false);
  assert.equal(preflight.routing.recommendation.release_authority_granted, false);
  assert.equal(preflight.routing.automatic_routing, false);
  assert.equal(preflight.routing.model_switch_performed, false);
  assert.equal(preflight.routing.budget_can_skip_gates, false);

  const baseline = buildUsageBaselineFromRecords(project, [mismatched, unregistered], { workItems, tasks });
  const coverage = baseline.source.longitudinal_coverage;
  assert.equal(baseline.source.capture_health.status, "historical-only");
  assert.equal(baseline.source.capture_health.captured_completed_work_items, 0);
  assert.equal(coverage.detailed_token_observation_coverage.correlated_observations, 0);
  assert.equal(coverage.detailed_token_observation_coverage.uncorrelated_observations, 2);
  assert.equal(coverage.qualification.status, "not-qualified");
  assert.equal(coverage.qualification.savings_claim_allowed, false);
  assert.equal(coverage.qualification.cost_claim_allowed, false);
  assert.equal(coverage.qualification.model_quality_claim_allowed, false);
  assert.equal(coverage.qualification.routing_claim_allowed, false);
});

test("Codex account usage probe fails closed without retaining provider error details", async () => {
  const report = await probeCodexAccountUsage("/tmp/unused", {
    connectionFactory: async () => ({
      async request(method) {
        if (method === "initialize") return { serverInfo: { version: "fixture-usage" } };
        throw new Error("account/usage/read failed with secret-marker");
      },
      notify() {},
      async close() {}
    })
  });
  assert.equal(report.availability, "unavailable");
  assert.equal(report.reason, "account-usage-read-failed");
  assert.equal(report.raw_values_retained, false);
  assert.doesNotMatch(JSON.stringify(report), /secret-marker/);
});

test("usage report exposes deterministic longitudinal task and token-field coverage", () => {
  const project = { id: "policy-product", name: "Policy Product" };
  const workItems = [
    { id: "WI-0003", state: "build" },
    { id: "WI-0001", state: "done" },
    { id: "WI-0002", state: "done" }
  ];
  const historicalTask = {
    id: "task-history",
    work_item_id: "WI-0001",
    status: "completed",
    thread_id: "thread-history"
  };
  const liveTask = {
    id: "task-live",
    work_item_id: "WI-0003",
    status: "active",
    thread_id: "thread-live"
  };
  const noTasks = buildUsageBaselineFromRecords(project, [], { workItems, tasks: [] });
  const noTaskCoverage = noTasks.source.longitudinal_coverage;
  assert.equal(noTaskCoverage.canonical_work_items.completed, 2);
  assert.equal(noTaskCoverage.registered_task_coverage.registered_tasks, 0);
  assert.equal(noTaskCoverage.registered_task_coverage.completed_work_item_coverage_ratio, 0);
  assert.equal(noTaskCoverage.task_eligibility.live_resumable, 0);
  assert.equal(noTaskCoverage.detailed_token_observation_coverage.observations, 0);
  assert.equal(noTaskCoverage.detailed_token_observation_coverage.token_fields.total_tokens.support_status, "unknown");

  const historicalOnly = buildUsageBaselineFromRecords(project, [], { workItems, tasks: [historicalTask] });
  const historicalCoverage = historicalOnly.source.longitudinal_coverage;
  assert.equal(historicalCoverage.registered_task_coverage.completed_work_items_with_registered_task, 1);
  assert.equal(historicalCoverage.task_eligibility.live_resumable, 0);
  assert.equal(historicalCoverage.task_eligibility.history_reconcilable, 1);
  assert.equal(historicalCoverage.task_eligibility.historical_only, 1);

  const awaiting = buildUsageBaselineFromRecords(project, [], { workItems, tasks: [historicalTask, liveTask] });
  const awaitingCoverage = awaiting.source.longitudinal_coverage;
  assert.equal(awaitingCoverage.task_eligibility.live_resumable, 1);
  assert.equal(awaitingCoverage.detailed_token_observation_coverage.correlated_observations, 0);
  assert.equal(awaiting.totals.total_tokens, null);

  const partialUsage = {
    specversion: "1.0",
    id: "usage-partial",
    source: "urn:temple:provider:codex-app-server:local",
    type: "org.temple.codex.usage.updated.v1",
    subject: "project/policy-product/work-item/WI-0003",
    time: "2026-08-30T00:00:00.000Z",
    data: {
      project_id: "policy-product",
      work_item_id: "WI-0003",
      attribution: {
        project_id: "policy-product",
        work_item_id: "WI-0003",
        task_id: "task-live"
      },
      usage: {
        last: {
          input_tokens: 12,
          cached_input_tokens: null,
          output_tokens: null,
          reasoning_output_tokens: null,
          total_tokens: null
        },
        monetary_cost: null,
        price_source: null
      }
    },
    templecursor: 1,
    templeobservedat: "2026-08-30T00:00:00.000Z"
  };
  const observed = buildUsageBaselineFromRecords(project, [partialUsage], {
    workItems,
    tasks: [historicalTask, liveTask]
  });
  const observedCoverage = observed.source.longitudinal_coverage;
  assert.equal(observedCoverage.detailed_token_observation_coverage.correlated_observations, 1);
  assert.deepEqual(observedCoverage.detailed_token_observation_coverage.correlated_work_item_ids, ["WI-0003"]);
  assert.equal(observedCoverage.detailed_token_observation_coverage.token_fields.input_tokens.support_status, "observed");
  assert.equal(observedCoverage.detailed_token_observation_coverage.token_fields.input_tokens.correlated_work_items_with_value, 1);
  assert.equal(observedCoverage.detailed_token_observation_coverage.token_fields.total_tokens.support_status, "unknown");
  assert.equal(observed.totals.input_tokens, 12);
  assert.equal(observed.totals.total_tokens, null);
  assert.equal(observedCoverage.qualification.remaining_correlated_work_items, 9);
  assert.equal(observedCoverage.qualification.remaining_correlated_completed_work_items, 10);
  assert.equal(observedCoverage.qualification.varied_task_shapes, "insufficient");
  assert.equal(observedCoverage.qualification.longitudinal_comparison, "insufficient");
  assert.equal(observedCoverage.qualification.savings_claim_allowed, false);
  assert.equal(observedCoverage.qualification.cost_claim_allowed, false);
  assert.equal(observedCoverage.qualification.model_quality_claim_allowed, false);
  assert.equal(observedCoverage.qualification.routing_claim_allowed, false);

  const secondPartialUsage = structuredClone(partialUsage);
  secondPartialUsage.id = "usage-partial-2";
  secondPartialUsage.templecursor = 2;
  secondPartialUsage.templeobservedat = "2026-08-30T00:00:01.000Z";
  secondPartialUsage.data.usage.last.input_tokens = null;
  secondPartialUsage.data.usage.last.total_tokens = 7;
  const partiallySupported = buildUsageBaselineFromRecords(project, [partialUsage, secondPartialUsage], {
    workItems,
    tasks: [historicalTask, liveTask]
  });
  const partiallySupportedFields = partiallySupported.source.longitudinal_coverage.detailed_token_observation_coverage.token_fields;
  assert.equal(partiallySupportedFields.input_tokens.support_status, "partial");
  assert.equal(partiallySupportedFields.total_tokens.support_status, "partial");
  assert.equal(partiallySupported.totals.input_tokens, null);
  assert.equal(partiallySupported.totals.total_tokens, null);

  const reordered = buildUsageBaselineFromRecords(project, [secondPartialUsage, partialUsage], {
    workItems: [...workItems].reverse(),
    tasks: [liveTask, historicalTask]
  });
  assert.deepEqual(reordered.source.longitudinal_coverage, partiallySupported.source.longitudinal_coverage);
});

test("observation mode reports post-start Work Item gaps without fabricating backfill", () => {
  const project = { id: "policy-product", name: "Policy Product" };
  const workItems = [
    { id: "WI-0001", state: "done", updated_at: "2026-09-02T00:10:00.000Z" },
    { id: "WI-0002", state: "done", updated_at: "2026-09-02T00:20:00.000Z" },
    { id: "WI-0003", state: "done", updated_at: "2026-08-31T23:59:59.000Z" },
    { id: "WI-0004", state: "build", updated_at: "2026-09-02T00:30:00.000Z" }
  ];
  const tasks = [{
    id: "task-captured",
    work_item_id: "WI-0001",
    status: "completed",
    thread_id: "thread-captured"
  }];
  const usage = {
    specversion: "1.0",
    id: "usage-captured",
    source: "urn:temple:provider:codex-app-server:local",
    type: "org.temple.codex.usage.updated.v1",
    subject: "project/policy-product/work-item/WI-0001",
    time: "2026-09-02T00:11:00.000Z",
    data: {
      project_id: "policy-product",
      work_item_id: "WI-0001",
      attribution: {
        project_id: "policy-product",
        work_item_id: "WI-0001",
        task_id: "task-captured"
      },
      usage: {
        last: {
          input_tokens: 10,
          cached_input_tokens: 2,
          output_tokens: 3,
          reasoning_output_tokens: 1,
          total_tokens: 16
        },
        monetary_cost: null,
        price_source: null
      }
    },
    templecursor: 1,
    templeobservedat: "2026-09-02T00:11:00.000Z"
  };
  const providers = [{
    id: "codex-local",
    kind: "codex-app-server",
    status: "ready",
    capabilities: { token_usage: "supported" }
  }];
  const managed = buildUsageBaselineFromRecords(project, [usage], {
    workItems,
    tasks,
    providers,
    observationContext: {
      mode: "managed-local",
      started_at: "2026-09-02T00:00:00.000Z",
      continuous_expected: true,
      service_status: "running"
    }
  });
  const capture = managed.source.capture_health;
  assert.equal(capture.observation_mode, "managed-local");
  assert.equal(capture.service_status, "running");
  assert.equal(capture.continuous_observation_expected, true);
  assert.deepEqual(capture.capture_gap, {
    status: "unobserved-completed-work",
    completed_since_observation_started: 2,
    captured_completed_since_observation_started: 1,
    uncaptured_completed_since_observation_started: 1,
    uncaptured_work_item_ids: ["WI-0002"],
    work_item_backfill_supported: false,
    account_usage_allocation: "unallocated"
  });

  const off = buildUsageBaselineFromRecords(project, [usage], {
    workItems,
    tasks,
    providers: [],
    observationContext: {
      mode: "off",
      started_at: null,
      continuous_expected: false,
      service_status: "not-installed"
    }
  });
  assert.equal(off.source.capture_health.observation_mode, "off");
  assert.equal(off.source.capture_health.status, "historical-only");
  assert.equal(off.source.capture_health.capture_gap.status, "not-applicable");
  assert.equal(off.totals.total_tokens, 16);
});

test("ten completed revision-current Work Items qualify one deterministic read-only recommendation", () => {
  const project = { id: "policy-product", name: "Policy Product" };
  const workItems = Array.from({ length: 10 }, (_, index) => ({
    id: `WI-${String(index + 1).padStart(4, "0")}`,
    state: "done"
  }));
  const tasks = workItems.map((item, index) => ({
    id: `task-${String(index + 1).padStart(4, "0")}`,
    work_item_id: item.id,
    position_id: index < 8 ? "developer" : "independent_qa",
    status: "completed",
    thread_id: `thread-${index + 1}`,
    current_revision: `revision-${index + 1}`
  }));
  const records = tasks.map((task, index) => {
    const developer = index < 8;
    const model = developer ? (index < 4 ? "model-alpha" : "model-beta") : "model-qa";
    const totalTokens = developer ? (model === "model-alpha" ? 100 : 200) : 150;
    return {
      specversion: "1.0",
      id: `usage-qualified-${index + 1}`,
      source: "urn:temple:provider:codex-app-server:local",
      type: "org.temple.codex.usage.updated.v1",
      subject: `project/policy-product/work-item/${task.work_item_id}`,
      time: `2026-08-30T00:00:${String(index).padStart(2, "0")}.000Z`,
      data: {
        project_id: "policy-product",
        work_item_id: task.work_item_id,
        task_id: task.id,
        scope_revision: task.current_revision,
        attribution: {
          project_id: "policy-product",
          work_item_id: task.work_item_id,
          task_id: task.id,
          position_id: task.position_id,
          lifecycle_stage: developer ? "build" : "independent_qa",
          model,
          outcome: "in-progress"
        },
        usage: {
          last: {
            input_tokens: totalTokens - 10,
            cached_input_tokens: 0,
            output_tokens: 10,
            reasoning_output_tokens: 0,
            total_tokens: totalTokens
          }
        }
      },
      templecursor: index + 1,
      templeobservedat: `2026-08-30T00:00:${String(index).padStart(2, "0")}.000Z`
    };
  });
  const stale = structuredClone(records[0]);
  stale.id = "usage-stale";
  stale.templecursor = 11;
  stale.data.scope_revision = "outdated-revision";
  const mismatched = structuredClone(records[1]);
  mismatched.id = "usage-mismatched";
  mismatched.templecursor = 12;
  mismatched.data.task_id = "task-9999";
  mismatched.data.attribution.task_id = "task-9999";
  const wrongPosition = structuredClone(records[2]);
  wrongPosition.id = "usage-wrong-position";
  wrongPosition.templecursor = 13;
  wrongPosition.data.attribution.position_id = "tech_lead";

  const report = buildUsageBaselineFromRecords(project, [...records, stale, mismatched, wrongPosition], {
    workItems,
    tasks,
    budgetCanSkipGates: true
  });
  const coverage = report.source.longitudinal_coverage;
  assert.equal(coverage.qualification.status, "qualified");
  assert.equal(coverage.detailed_token_observation_coverage.qualified_completed_work_items, 10);
  assert.equal(coverage.detailed_token_observation_coverage.stale_observations, 1);
  assert.equal(coverage.detailed_token_observation_coverage.uncorrelated_observations, 1);
  assert.equal(coverage.detailed_token_observation_coverage.incomplete_qualification_observations, 1);
  assert.deepEqual(coverage.detailed_token_observation_coverage.qualified_task_shape_ids, [
    "developer:build",
    "independent_qa:independent_qa"
  ]);
  assert.equal(coverage.recommendation.status, "available");
  assert.equal(coverage.recommendation.task_shape, "developer:build");
  assert.equal(coverage.recommendation.recommended_model, "model-alpha");
  assert.deepEqual(coverage.recommendation.compared_models, ["model-alpha", "model-beta"]);
  assert.equal(coverage.recommendation.confidence, "low");
  assert.equal(coverage.recommendation.evidence_basis, "accepted-closeout-token-observation-only");
  assert.equal(coverage.recommendation.matched_evaluation, false);
  assert.equal(coverage.recommendation.routing_authority, false);
  assert.equal(coverage.recommendation.automatic_routing, false);
  assert.equal(coverage.recommendation.model_switch_performed, false);
  assert.equal(coverage.recommendation.budget_can_skip_gates, false);
  assert.equal(coverage.recommendation.context_required, true);
  assert.equal(coverage.recommendation.developer_evidence_required, true);
  assert.equal(coverage.recommendation.independent_qa_required, true);
  assert.equal(coverage.recommendation.approval_mode, "exceptions-only");
  assert.equal(coverage.recommendation.routine_human_approval_required, false);
  assert.equal(coverage.recommendation.routing_change_requires_approval, true);
  assert.equal(coverage.recommendation.human_approval_required, false);
  assert.equal(coverage.recommendation.release_authority_granted, false);
  assert.equal(coverage.calibration.diagnostic_observation_threshold_met, true);
  assert.equal(coverage.calibration.statistical_qualification_status, "unconfigured");
  assert.equal(coverage.calibration.automatic_routing_eligible, false);
  assert.ok(coverage.calibration.promotion_blockers.includes("exact-task-shape-evidence-missing"));
  assert.ok(coverage.calibration.promotion_blockers.includes("matched-quality-evaluation-missing"));
  assert.ok(coverage.calibration.promotion_blockers.includes("statistical-qualification-unconfigured"));
  assert.equal(coverage.qualification.routing_claim_allowed, false);
  assert.equal(coverage.qualification.model_quality_claim_allowed, false);
  assert.equal(coverage.qualification.observation_threshold_purpose, "diagnostic-only");
  assert.equal(report.policy.data_scope.raw_observations, "project-local");
  assert.equal(report.policy.autonomy.routine_decision, "automatic");
  assert.equal(report.routing.recommendation_status, "available");
  assert.equal(report.routing.recommendation_mode, "shadow");
  assert.equal(report.routing.routine_human_approval_required, false);
  assert.equal(report.routing.automatic_routing, false);
  assert.equal(report.routing.budget_can_skip_gates, false);
  assert.equal(report.source.capture_health.status, "historical-only");
  assert.equal(report.source.capture_health.last_observed_at, "2026-08-30T00:00:09.000Z");

  for (const collaborationProfile of ["solo", "collaborative", "high-assurance"]) {
    const adversarial = buildUsageBaselineFromRecords(project, records, {
      workItems,
      tasks,
      collaborationProfile,
      budgetCanSkipGates: true,
      skipContext: true,
      skipDeveloperEvidence: true,
      skipIndependentQa: true,
      skipHumanApproval: true,
      grantReleaseAuthority: true
    });
    assert.deepEqual(
      {
        automatic_routing: adversarial.source.longitudinal_coverage.recommendation.automatic_routing,
        budget_can_skip_gates: adversarial.source.longitudinal_coverage.recommendation.budget_can_skip_gates,
        context_required: adversarial.source.longitudinal_coverage.recommendation.context_required,
        developer_evidence_required: adversarial.source.longitudinal_coverage.recommendation.developer_evidence_required,
        independent_qa_required: adversarial.source.longitudinal_coverage.recommendation.independent_qa_required,
        human_approval_required: adversarial.source.longitudinal_coverage.recommendation.human_approval_required,
        release_authority_granted: adversarial.source.longitudinal_coverage.recommendation.release_authority_granted
      },
      {
        automatic_routing: false,
        budget_can_skip_gates: false,
        context_required: true,
        developer_evidence_required: true,
        independent_qa_required: true,
        human_approval_required: false,
        release_authority_granted: false
      },
      `${collaborationProfile} recommendation authority must fail closed`
    );
  }

  const preflight = buildUsagePreflightFromRecords(
    project,
    tasks,
    records,
    [{ id: "codex-local", kind: "codex-app-server", status: "ready", capabilities: { token_usage: "supported" } }],
    null,
    { workItems }
  );
  assert.equal(preflight.baseline_qualification.status, "qualified");
  assert.equal(preflight.routing.recommendation_status, "available");
  assert.equal(preflight.routing.recommendation.recommended_model, "model-alpha");
  assert.equal(preflight.routing.recommendation_mode, "shadow");
  assert.equal(preflight.routing.routine_human_approval_required, false);
  assert.equal(preflight.policy.calibration.statistical_qualification_status, "unconfigured");
  assert.equal(preflight.routing.automatic_routing, false);
  assert.equal(preflight.routing.budget_can_skip_gates, false);
});

test("matched evaluation qualifies an advisory only after quality and paired resource evidence", () => {
  const project = { id: "policy-product", name: "Policy Product" };
  const policy = matchedUsagePolicy();
  const document = matchedEvaluationDocument();
  assert.deepEqual(validateUsagePolicy(policy), { valid: true, errors: [] });
  assert.deepEqual(validateMatchedModelEvaluation(document), { valid: true, errors: [] });

  const result = evaluateMatchedModelEvaluation(project, document, policy, {
    source: ".ai-org/evaluations/model/matched.json",
    now: new Date("2026-09-01T00:00:00.000Z")
  });
  assert.equal(result.status, "available");
  assert.equal(result.recommended_profile_id, "lightweight-quality");
  assert.equal(result.baseline_profile_id, "standard");
  assert.equal(result.confidence, "project-qualified");
  assert.equal(result.matched_evaluation, true);
  assert.equal(result.candidates.find((candidate) => candidate.profile_id === "lightweight-quality").sign_test_p_value, 0.03125);
  assert.equal(result.candidates.find((candidate) => candidate.profile_id === "lightweight-quality").qualified, true);
  assert.equal(result.routing_authority, false);
  assert.equal(result.automatic_routing, false);
  assert.equal(result.model_switch_performed, false);
  assert.equal(result.provider_call_performed, false);

  const sources = [{ source: ".ai-org/evaluations/model/matched.json", document, error: null }];
  const advisory = buildMatchedModelAdvisory(project, sources, policy, { now: new Date("2026-09-01T00:00:00.000Z") });
  assert.equal(advisory.status, "available");
  assert.equal(advisory.recommendations.length, 1);
  const baseline = buildUsageBaselineFromRecords(project, [], {
    usagePolicy: policy,
    matchedEvaluationSources: sources,
    now: new Date("2026-09-01T00:00:00.000Z")
  });
  assert.equal(baseline.baseline_status, "insufficient-data");
  assert.equal(baseline.routing.recommendation_status, "available");
  assert.equal(baseline.routing.recommendation_source, "matched-evaluation");
  assert.equal(baseline.routing.matched_advisory.recommendations[0].recommended_profile_id, "lightweight-quality");
  assert.equal(baseline.source.longitudinal_coverage.calibration.matched_evaluation_available, true);
  assert.equal(baseline.routing.execution_status, "not-implemented");
  assert.equal(baseline.routing.automatic_routing, false);

  const preflight = buildUsagePreflightFromRecords(project, [], [], [], null, {
    usagePolicy: policy,
    matchedEvaluationSources: sources,
    now: new Date("2026-09-01T00:00:00.000Z")
  });
  assert.equal(preflight.routing.recommendation_source, "matched-evaluation");
  assert.match(preflight.recommended_next_action, /no model switch/i);
  assert.equal(preflight.routing.automatic_routing, false);
});

test("matched evaluation rejects quality loss, drift, stale evidence, and unavailable advisory mode", () => {
  const project = { id: "policy-product", name: "Policy Product" };
  const policy = matchedUsagePolicy();

  const qualityFailure = matchedEvaluationDocument({ evaluationId: "quality-failure" });
  qualityFailure.candidates[1].cases[0].quality_score = 0.2;
  const rejectedQuality = evaluateMatchedModelEvaluation(project, qualityFailure, policy, { now: new Date("2026-09-01T00:00:00.000Z") });
  assert.equal(rejectedQuality.status, "not-qualified");
  assert.equal(rejectedQuality.recommended_profile_id, null);
  assert.ok(rejectedQuality.candidates.find((candidate) => candidate.profile_id === "lightweight-quality").rejection_reasons.includes("quality-gate-failed"));

  const provenanceDrift = matchedEvaluationDocument({ evaluationId: "provenance-drift" });
  provenanceDrift.candidates[1].cases[0].input_digest = `sha256:${"b".repeat(64)}`;
  const rejectedDrift = evaluateMatchedModelEvaluation(project, provenanceDrift, policy, { now: new Date("2026-09-01T00:00:00.000Z") });
  assert.equal(rejectedDrift.status, "invalid");
  assert.equal(rejectedDrift.reason, "candidate-case-provenance-mismatch");

  const stale = evaluateMatchedModelEvaluation(project, matchedEvaluationDocument({ evaluationId: "stale" }), policy, {
    now: new Date("2027-01-01T00:00:00.000Z")
  });
  assert.equal(stale.status, "stale");
  assert.equal(stale.recommended_profile_id, null);

  const shadowPolicy = matchedUsagePolicy({ mode: "shadow" });
  const shadow = evaluateMatchedModelEvaluation(project, matchedEvaluationDocument({ evaluationId: "shadow-only" }), shadowPolicy, {
    now: new Date("2026-09-01T00:00:00.000Z")
  });
  assert.equal(shadow.status, "qualified-shadow");
  assert.equal(shadow.recommended_profile_id, "lightweight-quality");
  assert.equal(shadow.routing_authority, false);

  const contractMismatch = matchedUsagePolicy();
  contractMismatch.calibration.statistical_qualification.minimum_effect = 0.2;
  const rejectedContract = evaluateMatchedModelEvaluation(project, matchedEvaluationDocument({ evaluationId: "contract-mismatch" }), contractMismatch, {
    now: new Date("2026-09-01T00:00:00.000Z")
  });
  assert.equal(rejectedContract.status, "not-qualified");
  assert.equal(rejectedContract.reason, "statistical-contract-mismatch");

  const privacyEscape = matchedEvaluationDocument({ evaluationId: "privacy-escape" });
  privacyEscape.raw_prompt = "must-not-be-accepted";
  const privacyValidation = validateMatchedModelEvaluation(privacyEscape);
  assert.equal(privacyValidation.valid, false);
  assert.ok(privacyValidation.errors.includes("evaluation.raw_prompt is not allowed"));
});

test("usage evaluate previews configured repository evidence without writes or provider calls", async (context) => {
  const { target } = await fixture(context);
  const relative = ".ai-org/evaluations/model/matched.json";
  const policy = matchedUsagePolicy({ sources: [relative] });
  const policyPath = path.join(target, ".ai-org/project/usage-policy.json");
  const evaluationPath = path.join(target, relative);
  await writeJson(policyPath, policy);
  await writeJson(evaluationPath, matchedEvaluationDocument());
  const policyBefore = await fs.readFile(policyPath, "utf8");

  const schemas = run(["schema", "validate", target, "--json"]);
  assert.equal(schemas.status, 0, schemas.stderr || schemas.stdout);
  const schemaReport = JSON.parse(schemas.stdout);
  assert.ok(schemaReport.checked.some((entry) => entry.document === relative && entry.valid));

  const preview = run(["usage", "evaluate", target, "--fixture", relative, "--no-write", "--json"]);
  assert.equal(preview.status, 0, preview.stderr || preview.stdout);
  const previewReport = JSON.parse(preview.stdout);
  assert.equal(previewReport.status, "available");
  assert.equal(previewReport.recommended_profile_id, "lightweight-quality");
  assert.equal(previewReport.provider_call_performed, false);
  assert.equal(previewReport.model_switch_performed, false);
  assert.equal(await fs.readFile(policyPath, "utf8"), policyBefore);
  await assert.rejects(() => fs.access(path.join(target, ".ai-org/views/usage-baseline.json")));

  const report = run(["usage", "report", target, "--no-write", "--json"]);
  assert.equal(report.status, 0, report.stderr || report.stdout);
  const usage = JSON.parse(report.stdout);
  assert.equal(usage.routing.matched_advisory.status, "available");
  assert.equal(usage.routing.recommendation_source, "matched-evaluation");
  assert.equal(usage.routing.automatic_routing, false);
  assert.equal(await fs.readFile(policyPath, "utf8"), policyBefore);

  const escaped = run(["usage", "evaluate", target, "--fixture", "../outside.json", "--no-write", "--json"]);
  assert.equal(escaped.status, 1);
  const escapedReport = JSON.parse(escaped.stdout);
  assert.equal(escapedReport.status, "invalid");
  assert.equal(escapedReport.reason, "unsafe-evaluation-source");
});

test("usage baseline sums provider deltas, preserves unknowns, and never invents cost or routing", async (context) => {
  const { target, stateDirectory } = await fixture(context);
  const base = {
    work_item_id: "WI-0001",
    position_id: "developer",
    lifecycle_stage: "build",
    task_id: "task-0001",
    attempt_id: "turn-1",
    provider_id: "codex-local",
    model: "model-alpha",
    model_version: null,
    reasoning_effort: "medium",
    service_tier: null,
    context_capsule_digest: null,
    capability_set_digest: null,
    outcome: "in-progress"
  };
  const makeEvent = (id, cursor, total, delta) => ({
    specversion: "1.0",
    id,
    source: "urn:temple:provider:codex-app-server:local",
    type: "org.temple.codex.usage.updated.v1",
    subject: "project/policy-product/work-item/WI-0001",
    time: `2026-08-30T00:00:0${cursor}.000Z`,
    data: {
      project_id: "policy-product",
      work_item_id: "WI-0001",
      attribution: { project_id: "policy-product", ...base },
      usage: {
        total: { input_tokens: total, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: total },
        last: { input_tokens: delta, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: delta },
        monetary_cost: null,
        price_source: null
      }
    },
    templecursor: cursor,
    templeobservedat: `2026-08-30T00:00:0${cursor}.000Z`
  });
  const records = [makeEvent("usage-1", 1, 100, 100), makeEvent("usage-2", 2, 180, 80)];
  const report = buildUsageBaselineFromRecords({ id: "policy-product", name: "Policy Product" }, records);
  assert.equal(report.totals.total_tokens, 180);
  assert.equal(report.driver_groups[0].tokens.total_tokens, 180);
  assert.equal(report.unknown_dimensions.model_version, 2);
  assert.equal(report.unknown_dimensions.task_shape_id, 2);
  assert.equal(report.totals.monetary_cost, null);
  assert.equal(report.totals.cost_status, "unknown");
  assert.equal(report.policy.seed_policy.mapping_status, "provider-mapping-required");
  assert.equal(report.policy.cost.status, "unknown");
  assert.equal(report.policy.cost.token_limits_are_financial_limits, false);
  assert.equal(report.routing.approval_mode, "exceptions-only");
  assert.equal(report.routing.routine_human_approval_required, false);
  assert.equal(report.routing.automatic_routing, false);
  assert.equal(report.routing.budget_can_skip_gates, false);

  const noObservations = buildUsageBaselineFromRecords({ id: "policy-product", name: "Policy Product" }, []);
  assert.equal(noObservations.baseline_status, "insufficient-data");
  assert.equal(noObservations.source.capture_health.status, "not-capturing");
  assert.equal(noObservations.totals.total_tokens, null);
  assert.equal(noObservations.totals.input_tokens, null);
  assert.equal(noObservations.totals.cached_input_ratio, null);

  const journal = await openTelemetryJournal(stateDirectory, {
    maxEvents: 100,
    privacy: defaultControlPlaneConfig().privacy
  });
  for (const record of records) {
    const { templecursor, templeobservedat, ...event } = record;
    await journal.append(event, { observedAt: templeobservedat });
  }
  await journal.close();
  const readOnly = run(["usage", "report", target, "--state-dir", stateDirectory, "--no-write", "--json"]);
  assert.equal(readOnly.status, 0, readOnly.stderr || readOnly.stdout);
  const readOnlyReport = JSON.parse(readOnly.stdout);
  assert.equal(readOnlyReport.totals.total_tokens, 180);
  assert.equal(readOnlyReport.source.longitudinal_coverage.detailed_token_observation_coverage.observations, 2);
  assert.equal(readOnlyReport.source.longitudinal_coverage.detailed_token_observation_coverage.correlated_observations, 0);
  await assert.rejects(() => fs.access(path.join(target, ".ai-org/views/usage-baseline.json")));
  const humanReadable = run(["usage", "report", target, "--state-dir", stateDirectory, "--no-write"]);
  assert.equal(humanReadable.status, 0, humanReadable.stderr || humanReadable.stdout);
  assert.match(humanReadable.stdout, /Completed Work Items with registered tasks: 0\/0/);
  assert.match(humanReadable.stdout, /Correlated Work Items: 0\/10; remaining: 10/);
  const written = run(["usage", "report", target, "--state-dir", stateDirectory, "--json"]);
  assert.equal(written.status, 0, written.stderr || written.stdout);
  assert.equal(JSON.parse(await fs.readFile(path.join(target, ".ai-org/views/usage-baseline.json"), "utf8")).totals.total_tokens, 180);

  const preflight = run(["usage", "preflight", target, "--state-dir", stateDirectory, "--json"]);
  assert.equal(preflight.status, 0, preflight.stderr || preflight.stdout);
  const preflightReport = JSON.parse(preflight.stdout);
  assert.equal(preflightReport.detailed_thread_usage.status, "historical-only");
  assert.equal(preflightReport.detailed_thread_usage.evidence_status, "observed");
  assert.equal(preflightReport.provider.status, "unobserved");
  assert.equal(preflightReport.account_usage.availability, "not-probed");
  assert.equal(preflightReport.baseline_qualification.status, "not-qualified");
  assert.equal(preflightReport.canonical_state_changed, false);
});

test("usage history restores strict archive projections, ignores archive cursor order, and deduplicates Provider identities", async (context) => {
  const stateDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "temple-usage-history-test-"));
  context.after(() => removeTemporaryTree(stateDirectory));
  const archiveDirectory = path.join(stateDirectory, "archive");
  await fs.mkdir(archiveDirectory, { recursive: true });
  const makeUsage = (id, cursor, total, observedAt, extraData = {}) => ({
    specversion: "1.0",
    id,
    source: "urn:temple:provider:codex-app-server:history-test",
    type: "org.temple.codex.usage.updated.v1",
    subject: "project/policy-product/work-item/WI-0056",
    time: "2026-08-31T07:44:46.273Z",
    templeobservedat: observedAt,
    templecursor: cursor,
    data: {
      project_id: "policy-product",
      work_item_id: "WI-0056",
      task_id: "task-0005",
      scope_revision: "candidate",
      attribution: {
        project_id: "policy-product",
        work_item_id: "WI-0056",
        position_id: "developer",
        lifecycle_stage: "build",
        task_id: "task-0005",
        attempt_id: "turn-1",
        provider_id: "codex-local",
        model: "gpt-5.6-luna",
        model_version: null,
        reasoning_effort: "max",
        service_tier: null,
        context_capsule_digest: null,
        capability_set_digest: null,
        outcome: "in-progress"
      },
      usage: {
        total: { input_tokens: total, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: total },
        last: { input_tokens: total, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: total },
        model_context_window: 258400
      },
      ...extraData
    }
  });
  const active = makeUsage("usage-active", 9, 40, "2026-08-31T07:44:46.273Z");
  const duplicate = makeUsage("usage-active", 3, 40, "2026-08-31T07:45:00.000Z");
  const archivedOnly = makeUsage("usage-archived", 3, 60, "2026-08-31T07:46:00.000Z", {
    raw_prompt: "must-not-enter-the-projection",
    tool_payload: { secret: "must-not-enter-the-projection" }
  });
  await fs.writeFile(
    path.join(archiveDirectory, "events-2026-08-31T07-45-54-118Z.jsonl"),
    `${JSON.stringify(duplicate)}\n${JSON.stringify(archivedOnly)}\n`
  );

  const history = await readUsageTelemetryHistory(stateDirectory, [active], { projectId: "policy-product" });
  assert.equal(history.history.status, "complete");
  assert.equal(history.history.active_observations_read, 1);
  assert.equal(history.history.archived_observations_read, 2);
  assert.equal(history.history.archived_observations_included, 1);
  assert.equal(history.history.duplicates_removed, 1);
  assert.equal(history.records.length, 2);
  assert.doesNotMatch(JSON.stringify(history), /must-not-enter-the-projection|raw_prompt|tool_payload/);
  const baseline = buildUsageBaselineFromRecords({ id: "policy-product", name: "Policy Product" }, history.records, {
    history: history.history,
    activeJournal: history.activeJournal
  });
  assert.equal(baseline.totals.total_tokens, 100);
  assert.equal(baseline.source.history.archived_observations_included, 1);
  assert.equal(baseline.source.first_cursor, 9);
  assert.equal(baseline.source.last_cursor, 9);
});

test("usage history quarantines identity conflicts and isolates unsafe, malformed, and oversized archives", async (context) => {
  const stateDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "temple-usage-history-failure-test-"));
  context.after(() => removeTemporaryTree(stateDirectory));
  const archiveDirectory = path.join(stateDirectory, "archive");
  await fs.mkdir(archiveDirectory, { recursive: true });
  const makeUsage = (id, cursor, total) => ({
    specversion: "1.0",
    id,
    source: "urn:temple:provider:codex-app-server:history-test",
    type: "org.temple.codex.usage.updated.v1",
    subject: "project/policy-product/work-item/WI-0056",
    time: "2026-08-31T07:44:46.273Z",
    templeobservedat: "2026-08-31T07:44:46.273Z",
    templecursor: cursor,
    data: {
      project_id: "policy-product",
      work_item_id: "WI-0056",
      task_id: "task-0005",
      scope_revision: "candidate",
      attribution: { project_id: "policy-product", work_item_id: "WI-0056", task_id: "task-0005", model: "gpt-5.6-luna" },
      usage: { last: { total_tokens: total } }
    }
  });
  const activeConflict = makeUsage("usage-conflict", 1, 10);
  await fs.writeFile(
    path.join(archiveDirectory, "events-2026-08-31T07-40-00-000Z.jsonl"),
    `${JSON.stringify(makeUsage("usage-safe", 1, 5))}\n${JSON.stringify(makeUsage("usage-conflict", 1, 11))}\n`
  );
  await fs.writeFile(
    path.join(archiveDirectory, "events-2026-08-31T07-41-00-000Z.jsonl"),
    "{\"type\":\"org.temple.codex.usage.updated.v1\",not-json}\n"
  );
  await fs.writeFile(
    path.join(archiveDirectory, "events-2026-08-31T07-42-00-000Z.jsonl"),
    `${"x".repeat(5000)}\n`
  );
  await fs.symlink(
    path.join(archiveDirectory, "events-2026-08-31T07-40-00-000Z.jsonl"),
    path.join(archiveDirectory, "events-2026-08-31T07-43-00-000Z.jsonl")
  );

  const history = await readUsageTelemetryHistory(stateDirectory, [activeConflict], {
    projectId: "policy-product",
    maxArchiveBytes: 3000
  });
  assert.equal(history.history.status, "partial");
  assert.equal(history.history.conflicting_identities, 1);
  assert.equal(history.history.archive_files.skipped, 3);
  assert.deepEqual(history.records.map((record) => record.id), ["usage-safe"]);
  assert.equal(buildUsageBaselineFromRecords({ id: "policy-product", name: "Policy Product" }, history.records).totals.total_tokens, 5);
  assert.ok(history.history.warnings.some((warning) => warning.code === "invalid-usage-json"));
  assert.ok(history.history.warnings.some((warning) => warning.code === "archive-file-too-large"));
  assert.ok(history.history.warnings.some((warning) => warning.code === "unsafe-archive-file-type"));
  assert.doesNotMatch(JSON.stringify(history.history), /not-json|\/tmp\//);
});
