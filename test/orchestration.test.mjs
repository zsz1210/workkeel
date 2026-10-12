import assert from "node:assert/strict";
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

function initConfig() {
  return {
    schema_version: "temple.init/v1",
    project: { id: "parallel-product", name: "Parallel Product" },
    naming_mode: "manual",
    agents: [
      { display_name: "Fixture Rowan", positions: ["engineering_manager", "release_manager", "observer"] },
      { display_name: "Fixture Linden", positions: ["product_manager", "ux_designer", "ui_designer"] },
      { display_name: "Fixture Ellis", positions: ["tech_lead"] },
      { display_name: "Fixture Devon", positions: ["developer"] },
      { display_name: "Fixture Hollis", positions: ["quality_evaluator", "independent_qa"] }
    ]
  };
}

async function fixture(context) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-orchestration-test-"));
  const target = path.join(temporaryRoot, "parallel-product");
  const configPath = path.join(temporaryRoot, "init.json");
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  await fs.writeFile(configPath, `${JSON.stringify(initConfig(), null, 2)}\n`);
  const initialized = run(["init", target, "--config", configPath]);
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
  return target;
}

function createItem(target, options) {
  const args = [
    "work-item",
    "create",
    target,
    "--title",
    options.title,
    "--scope",
    options.scope ?? options.title,
    "--acceptance",
    options.acceptance ?? `${options.title} is independently verifiable`
  ];
  if (options.parent) args.push("--parent", options.parent);
  if (options.path) args.push("--affected-path", options.path);
  if (options.baseRevision !== false) args.push("--base-revision", options.baseRevision ?? "base-123");
  if (options.integrationOwner !== false) {
    args.push("--integration-owner", options.integrationOwner ?? "agent-fixture-rowan");
  }
  if (options.contractStatus) args.push("--contract-status", options.contractStatus);
  for (const dependency of options.dependencies ?? []) args.push("--depends-on", dependency);
  const created = run(args);
  assert.equal(created.status, 0, created.stderr || created.stdout);
  return /Created (WI-[A-Z0-9-]+):/.exec(created.stdout)?.[1];
}

test("parallel plan creates deterministic dependency-safe, conflict-safe, capacity-bounded waves", async (context) => {
  const target = await fixture(context);
  const parent = createItem(target, {
    title: "Parent outcome",
    path: "src",
    baseRevision: false,
    integrationOwner: false
  });
  const first = createItem(target, { title: "Independent first", parent, path: "src/first" });
  const second = createItem(target, { title: "Independent second", parent, path: "src/second" });
  const overlap = createItem(target, { title: "Overlapping follow-up", parent, path: "src/first/file.mjs" });
  const dependent = createItem(target, {
    title: "Dependent work",
    parent,
    path: "src/dependent",
    dependencies: [first]
  });
  const capacityDeferred = createItem(target, { title: "Capacity-deferred work", parent, path: "src/fifth" });

  const planned = run(["parallel", "plan", target, "--parent", parent, "--max-workers", "2", "--json"]);
  assert.equal(planned.status, 0, planned.stderr || planned.stdout);
  const plan = JSON.parse(planned.stdout);
  assert.equal(plan.schema_version, "temple.parallel-plan/v1");
  assert.deepEqual(
    plan.waves.map((wave) => wave.dispatch.map((entry) => entry.work_item_id)),
    [
      [first, second],
      [overlap, dependent],
      [capacityDeferred]
    ]
  );
  assert.equal(plan.summary.dispatchable, 5);
  assert.equal(plan.summary.blocked, 0);
  assert.equal(plan.max_workers, 2);
  assert.ok(
    plan.conflicts.some(
      (entry) =>
        entry.left_work_item_id === first &&
        entry.right_work_item_id === overlap &&
        entry.resolution === "separate-waves"
    )
  );
  assert.equal(plan.execution_policy.parallel_by_default_when_safe, true);
  assert.equal(plan.execution_policy.task_creation_performed, false);
  assert.ok(plan.waves.every((wave) => wave.join_gate.integration_owner_agent_ids.length === 1));
  assert.ok(plan.waves.flatMap((wave) => wave.dispatch).every((entry) => entry.task_creation_performed === false));
  assert.equal(
    plan.waves[0].dispatch[0].suggested_task_title,
    `${first} · Independe… · Engineering Manager (Fixture Rowan)`
  );

  const taskRegistry = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/tasks.json"), "utf8"));
  assert.deepEqual(taskRegistry.tasks, []);
  for (const workItemId of [first, second, overlap, dependent, capacityDeferred]) {
    const item = JSON.parse(await fs.readFile(path.join(target, `.ai-org/work-items/${workItemId}.json`), "utf8"));
    assert.equal(item.claim, null);
  }

  const status = JSON.parse(run(["status", target, "--json", "--no-write"]).stdout);
  assert.equal(status.orchestration.installed, true);
  assert.equal(status.orchestration.fresh, true);
  assert.deepEqual(status.orchestration.next_wave, [first, second]);

  const capsule = JSON.parse(
    run(["context", "resolve", target, "--work-item", first, "--no-write", "--json"]).stdout
  );
  assert.equal(capsule.parallel_execution.disposition, "dispatchable");
  assert.equal(capsule.parallel_execution.wave_id, "wave-001");
  assert.equal(capsule.parallel_execution.plan_fresh, true);

  const previewA = JSON.parse(
    run(["parallel", "plan", target, "--parent", parent, "--max-workers", "2", "--no-write", "--json"]).stdout
  );
  const previewB = JSON.parse(
    run(["parallel", "plan", target, "--parent", parent, "--max-workers", "2", "--no-write", "--json"]).stdout
  );
  assert.deepEqual(previewA.waves, previewB.waves);
  assert.deepEqual(previewA.conflicts, previewB.conflicts);
  assert.equal(previewA.source_fingerprint, previewB.source_fingerprint);
});

test("parallel plan distinguishes preparation work, hard blockers, and outside-scope dependencies", async (context) => {
  const target = await fixture(context);
  const outside = createItem(target, { title: "Outside active work", path: "src/outside" });
  const parent = createItem(target, { title: "Scoped parent", baseRevision: false, integrationOwner: false });
  const needsPreparation = createItem(target, {
    title: "Needs planning metadata",
    parent,
    path: null,
    baseRevision: false,
    integrationOwner: false
  });
  const draftContract = createItem(target, {
    title: "Draft shared contract",
    parent,
    path: "src/contract",
    contractStatus: "draft"
  });
  const outsideDependency = createItem(target, {
    title: "Depends outside selected parent",
    parent,
    path: "src/scoped",
    dependencies: [outside]
  });

  const planned = run(["parallel", "plan", target, "--parent", parent, "--no-write", "--json"]);
  assert.equal(planned.status, 0, planned.stderr || planned.stdout);
  const plan = JSON.parse(planned.stdout);
  assert.equal(plan.summary.dispatchable, 0);
  assert.deepEqual(plan.sequential.map((entry) => entry.work_item_id), [needsPreparation]);
  assert.ok(plan.sequential[0].reasons.includes("base_revision_recorded"));
  assert.ok(plan.sequential[0].reasons.includes("affected_paths_declared"));
  assert.ok(plan.sequential[0].reasons.includes("integration_owner_assigned"));
  assert.deepEqual(plan.blocked.map((entry) => entry.work_item_id), [draftContract, outsideDependency]);
  assert.ok(plan.blocked.find((entry) => entry.work_item_id === draftContract).reasons.includes("shared_contract_stable"));
  assert.ok(
    plan.blocked
      .find((entry) => entry.work_item_id === outsideDependency)
      .reasons.includes(`dependency_outside_scope:${outside}`)
  );
});

test("parallel readiness requires the exact conflicting Work Item ID and group planning requires both sides", async (context) => {
  const target = await fixture(context);
  const parent = createItem(target, { title: "Overlap parent", baseRevision: false, integrationOwner: false });
  const first = createItem(target, { title: "First overlap", parent, path: "src/shared" });
  const second = createItem(target, { title: "Second overlap", parent, path: "src/shared/file.mjs" });

  const irrelevant = run([
    "work-item",
    "configure",
    target,
    "--work-item",
    first,
    "--overlap-resolution",
    "A reviewer approved a general overlap policy"
  ]);
  assert.equal(irrelevant.status, 0, irrelevant.stderr || irrelevant.stdout);
  const unresolved = JSON.parse(run(["parallel", "check", target, "--work-item", first, "--json"]).stdout);
  assert.equal(unresolved.checks.find((check) => check.id === "overlap_resolved").pass, false);

  assert.equal(
    run([
      "work-item",
      "configure",
      target,
      "--work-item",
      first,
      "--overlap-resolution",
      `${second}: writes separate exports`
    ]).status,
    0
  );
  const oneSided = JSON.parse(
    run(["parallel", "plan", target, "--parent", parent, "--no-write", "--json"]).stdout
  );
  assert.deepEqual(oneSided.waves.map((wave) => wave.dispatch.map((entry) => entry.work_item_id)), [[first], [second]]);

  assert.equal(
    run([
      "work-item",
      "configure",
      target,
      "--work-item",
      second,
      "--overlap-resolution",
      `${first}: writes separate exports`
    ]).status,
    0
  );
  const twoSided = JSON.parse(
    run(["parallel", "plan", target, "--parent", parent, "--no-write", "--json"]).stdout
  );
  assert.deepEqual(twoSided.waves.map((wave) => wave.dispatch.map((entry) => entry.work_item_id)), [[first, second]]);
  assert.equal(twoSided.conflicts[0].resolution, "explicit-bidirectional");
});

test("canonical changes make a generated plan observably stale without mutating it", async (context) => {
  const target = await fixture(context);
  const parent = createItem(target, { title: "Staleness parent", baseRevision: false, integrationOwner: false });
  const child = createItem(target, { title: "Staleness child", parent, path: "src/stale" });
  const planned = run(["parallel", "plan", target, "--parent", parent, "--json"]);
  assert.equal(planned.status, 0, planned.stderr || planned.stdout);
  const storedPath = path.join(target, ".ai-org/views/parallel-plan.json");
  const storedBefore = await fs.readFile(storedPath, "utf8");

  const changed = run([
    "work-item",
    "configure",
    target,
    "--work-item",
    child,
    "--parallel-mode",
    "pending"
  ]);
  assert.equal(changed.status, 0, changed.stderr || changed.stdout);
  const status = JSON.parse(run(["status", target, "--json", "--no-write"]).stdout);
  assert.equal(status.orchestration.fresh, false);
  assert.ok(status.attention.some((entry) => entry.type === "stale_parallel_plan"));
  const doctor = JSON.parse(run(["doctor", target, "--json"]).stdout);
  assert.equal(doctor.checks.find((check) => check.id === "parallel_plan").status, "warn");
  assert.equal(await fs.readFile(storedPath, "utf8"), storedBefore);

  const capsule = JSON.parse(
    run(["context", "resolve", target, "--work-item", child, "--no-write", "--json"]).stdout
  );
  assert.equal(capsule.parallel_execution.plan_fresh, false);
  assert.ok(capsule.warnings.some((warning) => warning.includes("parallel plan is stale")));
});

test("a structurally valid but edited generated plan is rejected as a non-deterministic projection", async (context) => {
  const target = await fixture(context);
  const parent = createItem(target, { title: "Projection parent", baseRevision: false, integrationOwner: false });
  createItem(target, { title: "Projection first", parent, path: "src/projection-a" });
  createItem(target, { title: "Projection second", parent, path: "src/projection-b" });
  const planned = run(["parallel", "plan", target, "--parent", parent, "--json"]);
  assert.equal(planned.status, 0, planned.stderr || planned.stdout);

  const planPath = path.join(target, ".ai-org/views/parallel-plan.json");
  const plan = JSON.parse(await fs.readFile(planPath, "utf8"));
  plan.waves[0].dispatch.reverse();
  await fs.writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);

  const status = JSON.parse(run(["status", target, "--json", "--no-write"]).stdout);
  assert.equal(status.orchestration.valid, false);
  assert.ok(status.attention.some((entry) => entry.type === "invalid_parallel_plan"));
  const doctor = JSON.parse(run(["doctor", target, "--json"]).stdout);
  assert.equal(doctor.checks.find((check) => check.id === "parallel_plan").status, "warn");
  assert.match(
    doctor.checks.find((check) => check.id === "parallel_plan").message,
    /does not match the deterministic projection/
  );
});

test("parallel plan preview does not create its generated view", async (context) => {
  const target = await fixture(context);
  createItem(target, { title: "Preview-only item", path: "src/preview" });
  const preview = run(["parallel", "plan", target, "--no-write", "--json"]);
  assert.equal(preview.status, 0, preview.stderr || preview.stdout);
  await assert.rejects(() => fs.access(path.join(target, ".ai-org/views/parallel-plan.json")));
});
