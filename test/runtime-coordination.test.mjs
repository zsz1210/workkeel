import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PACKAGE_NAME, TEMPLATE_VERSION } from "../src/constants.mjs";
import { prepareWorkerDispatch } from "../src/workers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin/temple.mjs");

function run(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", ...options });
}

function initConfig() {
  return {
    schema_version: "temple.init/v1",
    project: { id: "runtime-product", name: "Runtime Product" },
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

function withoutExplicitCli(extra = {}) {
  const environment = { ...process.env, ...extra };
  delete environment.TEMPLE_CLI_PATH;
  return environment;
}

async function selfHostLauncherFixture(context, { cliVersion = TEMPLATE_VERSION, writeLocalCli = true } = {}) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-self-host-launcher-test-"));
  const target = path.join(temporaryRoot, "toolkit-worktree");
  const competingBin = path.join(temporaryRoot, "competing-bin");
  const wrapper = path.join(target, "templew.mjs");
  const localCli = path.join(target, "bin", "temple.mjs");
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));

  await fs.mkdir(path.dirname(localCli), { recursive: true });
  await fs.mkdir(path.join(target, "project-overlay"), { recursive: true });
  await fs.mkdir(competingBin, { recursive: true });
  await fs.copyFile(path.join(root, "project-overlay", "templew.mjs"), wrapper);
  await fs.writeFile(
    path.join(target, "temple.lock"),
    `${JSON.stringify(
      {
        template: {
          version: TEMPLATE_VERSION,
          bootstrap: {
            schema_version: "temple.cli-bootstrap/v1",
            version: TEMPLATE_VERSION,
            package_spec: `${PACKAGE_NAME}@${TEMPLATE_VERSION}`,
            repository_spec: null
          }
        },
        installation: {
          mode: "toolkit-self-host",
          source_overlay: "project-overlay"
        }
      },
      null,
      2
    )}\n`
  );
  if (writeLocalCli) {
    await fs.writeFile(
      localCli,
      [
        `const version = ${JSON.stringify(cliVersion)};`,
        "if (process.argv[2] === '--version') console.log(version);",
        "else console.log(JSON.stringify({ source: 'worktree-local', arguments: process.argv.slice(2) }));",
        ""
      ].join("\n")
    );
  }

  const competingRunner = path.join(competingBin, process.platform === "win32" ? "npm.cmd" : "npm");
  if (process.platform === "win32") {
    await fs.writeFile(competingRunner, "@echo {\"source\":\"same-version-competing-package\"}\r\n");
  } else {
    await fs.writeFile(
      competingRunner,
      "#!/bin/sh\nprintf '%s\\n' '{\"source\":\"same-version-competing-package\"}'\n"
    );
    await fs.chmod(competingRunner, 0o755);
  }

  return {
    temporaryRoot,
    target,
    wrapper,
    localCli,
    environment: withoutExplicitCli({ PATH: `${competingBin}${path.delimiter}${process.env.PATH ?? ""}` })
  };
}

async function fixture(context) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-runtime-test-"));
  const target = path.join(temporaryRoot, "runtime-product");
  const configPath = path.join(temporaryRoot, "init.json");
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  await fs.writeFile(configPath, `${JSON.stringify(initConfig(), null, 2)}\n`);
  const initialized = run(["init", target, "--config", configPath]);
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
  for (const relativePath of [
    ".ai-org/artifacts/handoff.md",
    ".ai-org/evidence/build.json",
    ".ai-org/evidence/internal.json",
    "docs/design.md",
    "docs/developer-evidence.md",
    "docs/handoff.md",
    "docs/spec.md",
    "docs/work-order.md"
  ]) {
    const absolutePath = path.join(target, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, `Fixture evidence for ${relativePath}\n`);
  }
  return { temporaryRoot, target };
}

function createdId(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const id = /Created (WI-[A-Z0-9-]+):/.exec(result.stdout)?.[1];
  assert.ok(id, result.stdout);
  return id;
}

function createItem(target, title, affectedPath, extra = []) {
  return createdId(
    run([
      "work-item",
      "create",
      target,
      "--title",
      title,
      "--scope",
      title,
      "--acceptance",
      `${title} is independently verified`,
      "--affected-path",
      affectedPath,
      "--base-revision",
      "base-123",
      "--integration-owner",
      "agent-fixture-rowan",
      "--ui-mode",
      "not-applicable",
      ...extra
    ])
  );
}

function transitionToBuild(target, workItemId) {
  const transitions = [
    ["spec", ["work_order=docs/work-order.md"]],
    ["design", ["approved_scope=docs/spec.md", "acceptance_criteria=docs/spec.md"]],
    ["build", ["technical_design=docs/design.md", "risk_review=docs/design.md"]]
  ];
  for (const [state, evidence] of transitions) {
    const args = ["transition", target, "--work-item", workItemId, "--to", state];
    for (const entry of evidence) args.push("--satisfy", entry);
    const result = run(args);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
}

test("init installs a repository-visible version-pinned Temple launcher", async (context) => {
  const { temporaryRoot, target } = await fixture(context);
  const wrapper = path.join(target, "templew.mjs");
  await fs.access(wrapper);
  const lock = JSON.parse(await fs.readFile(path.join(target, "temple.lock"), "utf8"));
  assert.equal(lock.template.bootstrap.schema_version, "temple.cli-bootstrap/v1");
  assert.equal(lock.template.bootstrap.version, lock.template.version);
  assert.equal(lock.template.bootstrap.package_spec, `${PACKAGE_NAME}@${TEMPLATE_VERSION}`);
  assert.notEqual(lock.installation.mode, "toolkit-self-host");
  assert.ok(lock.managed_files.some((entry) => entry.path === "templew.mjs"));

  const info = spawnSync(process.execPath, [wrapper, "--bootstrap-info"], { encoding: "utf8" });
  assert.equal(info.status, 0, info.stderr || info.stdout);
  assert.equal(JSON.parse(info.stdout).version, lock.template.version);

  const doctor = spawnSync(process.execPath, [wrapper, "doctor", target, "--json"], {
    encoding: "utf8",
    env: { ...process.env, TEMPLE_CLI_PATH: cli }
  });
  assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
  assert.equal(JSON.parse(doctor.stdout).summary.fail, 0);

  const incompatibleCli = path.join(temporaryRoot, "incompatible.mjs");
  await fs.writeFile(incompatibleCli, "if (process.argv.includes('--version')) console.log('9.9.9');\n");
  const mismatch = spawnSync(process.execPath, [wrapper, "doctor", target], {
    encoding: "utf8",
    env: { ...process.env, TEMPLE_CLI_PATH: incompatibleCli }
  });
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stderr, /does not match pinned version/);
});

test("toolkit self-host launcher executes its own worktree CLI without an override", async (context) => {
  const fixture = await selfHostLauncherFixture(context);
  const result = spawnSync(process.execPath, [fixture.wrapper, "doctor", fixture.target, "--json"], {
    encoding: "utf8",
    env: fixture.environment
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), {
    source: "worktree-local",
    arguments: ["doctor", fixture.target, "--json"]
  });
});

test("toolkit self-host launcher forwards repeated stop signals until child cleanup completes", async (context) => {
  if (process.platform === "win32") {
    context.skip("POSIX signal delivery is required");
    return;
  }
  const fixture = await selfHostLauncherFixture(context);
  const marker = path.join(fixture.temporaryRoot, "clean-shutdown.txt");
  await fs.writeFile(
    fixture.localCli,
    [
      `import fs from ${JSON.stringify("node:fs")};`,
      `const version = ${JSON.stringify(TEMPLATE_VERSION)};`,
      "if (process.argv[2] === '--version') console.log(version);",
      "else {",
      "  let stopping = false;",
      "  const timer = setInterval(() => {}, 1000);",
      "  const stop = () => {",
      "    if (stopping) return;",
      "    stopping = true;",
      "    setTimeout(() => {",
      "      clearInterval(timer);",
      "      fs.writeFileSync(process.env.TEMPLE_SIGNAL_MARKER, 'cleanup-complete\\n');",
      "      process.exitCode = 0;",
      "    }, 75);",
      "  };",
      "  process.on('SIGINT', stop);",
      "  process.on('SIGTERM', stop);",
      "  console.log('ready');",
      "}",
      ""
    ].join("\n")
  );

  const launched = spawn(process.execPath, [fixture.wrapper, "serve", fixture.target], {
    env: { ...fixture.environment, TEMPLE_SIGNAL_MARKER: marker },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  launched.stdout.setEncoding("utf8");
  launched.stderr.setEncoding("utf8");
  launched.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  launched.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`launcher did not become ready: ${stdout}${stderr}`)), 2000);
    const inspect = () => {
      if (!stdout.includes("ready")) return;
      clearTimeout(timeout);
      launched.stdout.off("data", inspect);
      resolve();
    };
    launched.stdout.on("data", inspect);
    inspect();
  });

  launched.kill("SIGINT");
  launched.kill("SIGTERM");
  const result = await new Promise((resolve, reject) => {
    launched.once("error", reject);
    launched.once("exit", (status, signal) => resolve({ status, signal }));
  });
  assert.deepEqual(result, { status: 0, signal: null }, stderr || stdout);
  assert.equal(await fs.readFile(marker, "utf8"), "cleanup-complete\n");
});

test("toolkit self-host launcher refuses a missing repository-local CLI", async (context) => {
  const fixture = await selfHostLauncherFixture(context, { writeLocalCli: false });
  const result = spawnSync(process.execPath, [fixture.wrapper, "doctor", fixture.target], {
    encoding: "utf8",
    env: fixture.environment
  });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /cannot resolve repository-local CLI/);
  assert.doesNotMatch(result.stdout, /same-version-competing-package/);
});

test("toolkit self-host launcher refuses a version-mismatched repository-local CLI", async (context) => {
  const fixture = await selfHostLauncherFixture(context, { cliVersion: "9.9.9" });
  const result = spawnSync(process.execPath, [fixture.wrapper, "doctor", fixture.target], {
    encoding: "utf8",
    env: fixture.environment
  });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /repository-local CLI version 9\.9\.9 does not match pinned version/);
  assert.doesNotMatch(result.stdout, /same-version-competing-package/);
});

test("toolkit self-host launcher refuses a repository-local CLI symlink that escapes the worktree", async (context) => {
  if (process.platform === "win32") {
    context.skip("Windows symlink creation may require privileges");
    return;
  }
  const fixture = await selfHostLauncherFixture(context);
  const outsideCli = path.join(fixture.temporaryRoot, "outside-temple.mjs");
  await fs.rename(fixture.localCli, outsideCli);
  await fs.symlink(outsideCli, fixture.localCli);

  const result = spawnSync(process.execPath, [fixture.wrapper, "doctor", fixture.target], {
    encoding: "utf8",
    env: fixture.environment
  });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /Repository-local CLI resolves outside the toolkit worktree/);
  assert.doesNotMatch(result.stdout, /same-version-competing-package/);
});

test("upgrade adds the runtime coordination contract without adopting project-owned state", async (context) => {
  const { target } = await fixture(context);
  const lockPath = path.join(target, "temple.lock");
  const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  const newlyManaged = [
    "templew.mjs",
    ".ai-org/core/schemas/resource-registry.schema.json",
    ".ai-org/core/schemas/runtime-worker-registry.schema.json"
  ];
  lock.template.version = "0.1.0-alpha.16";
  delete lock.template.bootstrap;
  for (const capability of [
    "version_pinned_cli_bootstrap",
    "atomic_worker_preparation",
    "runtime_worker_registry",
    "stage_execution_requirements",
    "shared_resource_coordination"
  ]) delete lock.capabilities[capability];
  lock.managed_files = lock.managed_files.filter((entry) => !newlyManaged.includes(entry.path));
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  for (const relativePath of newlyManaged) await fs.rm(path.join(target, relativePath));
  await fs.rm(path.join(target, ".ai-org/project/resources.json"));
  await fs.rm(path.join(target, ".ai-org/project/runtime-workers.json"));

  const upgraded = run(["upgrade", target]);
  assert.equal(upgraded.status, 0, upgraded.stderr || upgraded.stdout);
  const upgradedLock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  assert.equal(upgradedLock.template.version, TEMPLATE_VERSION);
  assert.equal(upgradedLock.template.bootstrap.version, TEMPLATE_VERSION);
  assert.equal(upgradedLock.capabilities.atomic_worker_preparation, true);
  assert.ok(upgradedLock.managed_files.some((entry) => entry.path === "templew.mjs"));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/resources.json"), "utf8")), {
    schema_version: "temple.resources/v1",
    resources: [],
    reservations: []
  });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/runtime-workers.json"), "utf8")), {
    schema_version: "temple.runtime-workers/v1",
    workers: []
  });
  assert.ok(!upgradedLock.managed_files.some((entry) => entry.path === ".ai-org/project/resources.json"));
  assert.ok(!upgradedLock.managed_files.some((entry) => entry.path === ".ai-org/project/runtime-workers.json"));
});

test("stage-specific Disciplines replace a legacy build requirement at later lifecycle stages", async (context) => {
  const { target } = await fixture(context);
  const workItemId = createItem(target, "Stage-specific delivery", "src/stages", [
    "--stage-discipline",
    "build=general-development",
    "--stage-discipline",
    "test=quality",
    "--stage-discipline",
    "independent_qa=quality"
  ]);
  transitionToBuild(target, workItemId);
  // The legacy fallback applies to every stage without an override. Introduce
  // the old Build requirement at Build, not as an Intake manager qualification.
  const legacy = run(["work-item", "configure", target, "--work-item", workItemId, "--discipline", "general-development"]);
  assert.equal(legacy.status, 0, legacy.stderr || legacy.stdout);

  const buildReadiness = JSON.parse(
    run(["parallel", "check", target, "--work-item", workItemId, "--json"]).stdout
  );
  assert.equal(buildReadiness.active_requirements.stage, "build");
  assert.deepEqual(buildReadiness.active_requirements.disciplines, ["general-development"]);
  assert.equal(buildReadiness.checks.find((entry) => entry.id === "agent_membership_eligible").pass, true);

  const toTest = run([
    "transition",
    target,
    "--work-item",
    workItemId,
    "--to",
    "test",
    "--satisfy",
    "developer_handoff=.ai-org/artifacts/handoff.md",
    "--satisfy",
    "developer_evidence=.ai-org/evidence/build.json"
  ]);
  assert.equal(toTest.status, 0, toTest.stderr || toTest.stdout);
  const testReadiness = JSON.parse(
    run(["parallel", "check", target, "--work-item", workItemId, "--json"]).stdout
  );
  assert.equal(testReadiness.active_requirements.stage, "test");
  assert.deepEqual(testReadiness.active_requirements.disciplines, ["quality"]);
  assert.equal(testReadiness.checks.find((entry) => entry.id === "agent_membership_eligible").pass, true);

  const cleared = run([
    "work-item",
    "configure",
    target,
    "--work-item",
    workItemId,
    "--clear-stage-requirement",
    "test"
  ]);
  assert.equal(cleared.status, 0, cleared.stderr || cleared.stdout);
  const fallbackReadiness = JSON.parse(
    run(["parallel", "check", target, "--work-item", workItemId, "--json"]).stdout
  );
  assert.deepEqual(fallbackReadiness.active_requirements.disciplines, ["general-development"]);
});

test("released Developer claims do not shadow the Independent QA assignment", async (context) => {
  const { target } = await fixture(context);
  const workItemId = createItem(target, "Released claim handoff", "src/released-claim", [
    "--stage-discipline",
    "build=general-development",
    "--stage-discipline",
    "test=quality"
  ]);
  transitionToBuild(target, workItemId);

  const claimed = run([
    "work-item",
    "claim",
    target,
    "--work-item",
    workItemId,
    "--agent-id",
    "agent-fixture-devon",
    "--principal-id",
    "human",
    "--base-revision",
    "candidate-123",
    "--branch",
    "fixture/released-claim"
  ]);
  assert.equal(claimed.status, 0, claimed.stderr || claimed.stdout);

  const toTest = run([
    "transition",
    target,
    "--work-item",
    workItemId,
    "--to",
    "test",
    "--satisfy",
    "developer_handoff=docs/handoff.md",
    "--satisfy",
    "developer_evidence=docs/developer-evidence.md"
  ]);
  assert.equal(toTest.status, 0, toTest.stderr || toTest.stdout);

  const readiness = JSON.parse(run(["parallel", "check", target, "--work-item", workItemId, "--json"]).stdout);
  assert.equal(readiness.agent_id, "agent-fixture-hollis");
  assert.equal(readiness.checks.find((entry) => entry.id === "agent_membership_eligible").pass, true);
});

test("shared verification capacity separates otherwise independent work into safe waves", async (context) => {
  const { target } = await fixture(context);
  const resource = run([
    "resource",
    "define",
    target,
    "--resource-id",
    "ios-simulator",
    "--name",
    "iOS Simulator",
    "--capacity",
    "1",
    "--description",
    "Shared local verification runtime"
  ]);
  assert.equal(resource.status, 0, resource.stderr || resource.stdout);
  const parent = createItem(target, "Runtime parent", "docs/runtime", []);
  const first = createItem(target, "First simulator verification", "src/first", [
    "--parent",
    parent,
    "--stage-resource",
    "build=ios-simulator"
  ]);
  const second = createItem(target, "Second simulator verification", "src/second", [
    "--parent",
    parent,
    "--stage-resource",
    "build=ios-simulator"
  ]);
  transitionToBuild(target, first);
  transitionToBuild(target, second);

  const planned = run(["parallel", "plan", target, "--parent", parent, "--json"]);
  assert.equal(planned.status, 0, planned.stderr || planned.stdout);
  const plan = JSON.parse(planned.stdout);
  assert.deepEqual(plan.waves.map((wave) => wave.dispatch.map((entry) => entry.work_item_id)), [[first], [second]]);
  assert.deepEqual(plan.waves[0].dispatch[0].active_requirements.resources, [
    { resource_id: "ios-simulator", units: 1 }
  ]);
  assert.ok(plan.conflicts.some((entry) => entry.kind === "shared-resource-capacity"));
});

test("parallel prepare records claim, worker, and resources before internal runtime attachment", async (context) => {
  const { target } = await fixture(context);
  assert.equal(
    run([
      "resource",
      "define",
      target,
      "--resource-id",
      "ios-simulator",
      "--name",
      "iOS Simulator",
      "--capacity",
      "1"
    ]).status,
    0
  );
  const workItemId = createItem(target, "Prepared internal work", "src/internal", [
    "--stage-resource",
    "build=ios-simulator"
  ]);
  transitionToBuild(target, workItemId);
  assert.equal(run(["parallel", "plan", target, "--json"]).status, 0);

  const preparedResult = run([
    "parallel",
    "prepare",
    target,
    "--work-item",
    workItemId,
    "--agent-id",
    "agent-fixture-devon",
    "--principal-id",
    "human",
    "--base-revision",
    "base-123",
    "--branch",
    "phase2/internal",
    "--runtime-kind",
    "internal-subagent",
    "--json"
  ]);
  assert.equal(preparedResult.status, 0, preparedResult.stderr || preparedResult.stdout);
  const prepared = JSON.parse(preparedResult.stdout);
  assert.equal(prepared.worker.status, "reserved");
  assert.equal(prepared.worker.runtime_kind, "internal-subagent");
  assert.equal(prepared.claim.status, "active");
  assert.equal(prepared.instruction, "Create the runtime worker only after this preparation succeeds.");

  const changedRequirements = run([
    "work-item",
    "configure",
    target,
    "--work-item",
    workItemId,
    "--stage-discipline",
    "build=backend"
  ]);
  assert.equal(changedRequirements.status, 1);
  assert.match(changedRequirements.stderr, /cannot change while .* is claimed/i);

  const item = JSON.parse(await fs.readFile(path.join(target, `.ai-org/work-items/${workItemId}.json`), "utf8"));
  assert.equal(item.claim.id, prepared.claim.id);
  const workers = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/runtime-workers.json"), "utf8"));
  assert.equal(workers.workers[0].id, prepared.worker.id);
  const resources = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/resources.json"), "utf8"));
  assert.equal(resources.reservations[0].worker_id, prepared.worker.id);
  const tasks = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/tasks.json"), "utf8"));
  assert.deepEqual(tasks.tasks, []);

  const attached = run([
    "worker",
    "attach",
    target,
    "--worker-id",
    prepared.worker.id,
    "--runtime-id",
    "subagent-runtime-001",
    "--json"
  ]);
  assert.equal(attached.status, 0, attached.stderr || attached.stdout);
  assert.equal(JSON.parse(attached.stdout).status, "active");

  const completed = run([
    "worker",
    "update",
    target,
    "--worker-id",
    prepared.worker.id,
    "--status",
    "completed",
    "--revision",
    "candidate-456",
    "--evidence",
    ".ai-org/evidence/internal.json",
    "--json"
  ]);
  assert.equal(completed.status, 0, completed.stderr || completed.stdout);
  const resourcesAfter = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/resources.json"), "utf8"));
  assert.equal(resourcesAfter.reservations[0].status, "released");
  const itemAfter = JSON.parse(await fs.readFile(path.join(target, `.ai-org/work-items/${workItemId}.json`), "utf8"));
  assert.equal(itemAfter.claim.status, "active", "worker completion does not forge a lifecycle handoff");
});

test("every member of one verified wave can be prepared after earlier members change runtime state", async (context) => {
  const { target } = await fixture(context);
  const first = createItem(target, "Parallel first", "src/parallel-first");
  const second = createItem(target, "Parallel second", "src/parallel-second");
  transitionToBuild(target, first);
  transitionToBuild(target, second);

  const planned = run(["parallel", "plan", target, "--json"]);
  assert.equal(planned.status, 0, planned.stderr || planned.stdout);
  const plan = JSON.parse(planned.stdout);
  assert.deepEqual(plan.waves[0].dispatch.map((entry) => entry.work_item_id), [first, second]);
  assert.ok(plan.waves[0].dispatch.every((entry) => /^[a-f0-9]{64}$/.test(entry.preparation_fingerprint)));

  const prepare = (workItemId, branch) =>
    run([
      "parallel",
      "prepare",
      target,
      "--work-item",
      workItemId,
      "--agent-id",
      "agent-fixture-devon",
      "--principal-id",
      "human",
      "--base-revision",
      "base-123",
      "--branch",
      branch,
      "--runtime-kind",
      "internal-subagent",
      "--json"
    ]);

  const firstPrepared = prepare(first, "phase2/parallel-first");
  assert.equal(firstPrepared.status, 0, firstPrepared.stderr || firstPrepared.stdout);
  const secondPrepared = prepare(second, "phase2/parallel-second");
  assert.equal(secondPrepared.status, 0, secondPrepared.stderr || secondPrepared.stdout);

  const workers = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/runtime-workers.json"), "utf8"));
  assert.deepEqual(workers.workers.map((worker) => worker.work_item_id).sort(), [first, second].sort());
  assert.equal(new Set(workers.workers.map((worker) => worker.plan_digest)).size, 1);
});

test("user-owned Codex tasks correlate to reservations without classifying internal subagents as tasks", async (context) => {
  const { target } = await fixture(context);
  const workItemId = createItem(target, "Prepared user task", "src/user-task");
  transitionToBuild(target, workItemId);
  assert.equal(run(["parallel", "plan", target, "--json"]).status, 0);
  const preparedResult = run([
    "parallel",
    "prepare",
    target,
    "--work-item",
    workItemId,
    "--agent-id",
    "agent-fixture-devon",
    "--principal-id",
    "human",
    "--base-revision",
    "base-123",
    "--branch",
    "phase2/user-task",
    "--runtime-kind",
    "user-task",
    "--json"
  ]);
  assert.equal(preparedResult.status, 0, preparedResult.stderr || preparedResult.stdout);
  const worker = JSON.parse(preparedResult.stdout).worker;

  const registered = run([
    "task",
    "register",
    target,
    "--work-item",
    workItemId,
    "--position",
    "developer",
    "--thread-id",
    "user-owned-thread-001",
    "--worker-id",
    worker.id,
    "--json"
  ]);
  assert.equal(registered.status, 0, registered.stderr || registered.stdout);
  const task = JSON.parse(registered.stdout);
  assert.equal(task.worker_id, worker.id);
  const registry = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/runtime-workers.json"), "utf8"));
  assert.equal(registry.workers[0].task_id, task.id);
  assert.equal(registry.workers[0].status, "active");
  assert.equal(registry.workers[0].runtime_id, null);
  const doctor = run(["doctor", target, "--json"]);
  assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
  assert.equal(JSON.parse(doctor.stdout).summary.fail, 0);
});

test("stale plans cannot prepare workers and leave canonical execution state untouched", async (context) => {
  const { target } = await fixture(context);
  const workItemId = createItem(target, "Stale preparation", "src/stale-prepare");
  transitionToBuild(target, workItemId);
  assert.equal(run(["parallel", "plan", target, "--json"]).status, 0);
  assert.equal(
    run(["work-item", "configure", target, "--work-item", workItemId, "--parallel-mode", "pending"]).status,
    0
  );
  const itemBefore = await fs.readFile(path.join(target, `.ai-org/work-items/${workItemId}.json`), "utf8");
  const eventsBefore = await fs.readFile(path.join(target, ".ai-org/events/events.jsonl"), "utf8");
  const prepared = run([
    "parallel",
    "prepare",
    target,
    "--work-item",
    workItemId,
    "--agent-id",
    "agent-fixture-devon",
    "--principal-id",
    "human",
    "--base-revision",
    "base-123",
    "--branch",
    "phase2/stale",
    "--runtime-kind",
    "internal-subagent"
  ]);
  assert.equal(prepared.status, 1);
  assert.match(prepared.stderr, /parallel plan is stale/i);
  assert.equal(await fs.readFile(path.join(target, `.ai-org/work-items/${workItemId}.json`), "utf8"), itemBefore);
  assert.equal(await fs.readFile(path.join(target, ".ai-org/events/events.jsonl"), "utf8"), eventsBefore);
  const workers = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/runtime-workers.json"), "utf8"));
  assert.deepEqual(workers.workers, []);
});

test("a failure after claim creation restores every preparation file", async (context) => {
  const { target } = await fixture(context);
  const workItemId = createItem(target, "Rollback preparation", "src/rollback-prepare");
  transitionToBuild(target, workItemId);
  assert.equal(run(["parallel", "plan", target, "--json"]).status, 0);

  const workerPath = path.join(target, ".ai-org/project/runtime-workers.json");
  const paths = [
    path.join(target, `.ai-org/work-items/${workItemId}.json`),
    path.join(target, ".ai-org/events/events.jsonl"),
    path.join(target, ".ai-org/project/resources.json"),
    workerPath
  ];
  const before = new Map(await Promise.all(paths.map(async (filePath) => [filePath, await fs.readFile(filePath, "utf8")])));

  await assert.rejects(
    prepareWorkerDispatch(
      target,
      {
        workItemId,
        agentId: "agent-fixture-devon",
        principalId: "human",
        baseRevision: "base-123",
        branch: "phase2/rollback",
        runtimeKind: "internal-subagent"
      },
      {
        persistWorkerRegistry: async () => {
          throw new Error("injected worker registry failure");
        }
      }
    ),
    /injected worker registry failure/
  );
  for (const filePath of paths) assert.equal(await fs.readFile(filePath, "utf8"), before.get(filePath));
});
