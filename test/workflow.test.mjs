import assert from "node:assert/strict";
import { PACKAGE_NAME, TEMPLATE_VERSION } from "../src/constants.mjs";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  shortTaskGoal,
  suggestedTaskTitle,
  TASK_GOAL_MAX_CODE_POINTS,
  TASK_TITLE_MAX_CODE_POINTS
} from "../src/project.mjs";
import { executeUpgrade, planUpgrade } from "../src/upgrade.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin/temple.mjs");

function configDocument() {
  return {
    schema_version: "temple.init/v1",
    project: { id: "workflow-product", name: "Workflow Product" },
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
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-workflow-test-"));
  const target = path.join(temporaryRoot, "workflow-product");
  const configPath = path.join(temporaryRoot, "init.json");
  await fs.writeFile(configPath, `${JSON.stringify(configDocument(), null, 2)}\n`);
  const initialized = run(["init", target, "--config", configPath]);
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
  const fixtureArtifacts = [
    "docs/brief.md",
    "docs/design.md",
    "docs/developer-test.md",
    "docs/eval.md",
    "docs/handoff.md",
    "docs/qa.md",
    "docs/spec.md",
    "docs/test.md",
    "docs/ui-brief.md",
    "docs/ui-preview.png",
    "docs/ui-review.md",
    "docs/ui-runtime.md",
    "docs/ui-states.md",
    "docs/work-order.md",
    "artifacts/closeout.md",
    "artifacts/developer-test.md",
    "artifacts/evaluation.md",
    "artifacts/handoff.md",
    "artifacts/qa.md",
    "artifacts/test.md"
  ];
  for (const relativePath of fixtureArtifacts) {
    const absolutePath = path.join(target, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, `Fixture evidence for ${relativePath}\n`);
  }
  return { temporaryRoot, target, configPath };
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

function runAsync(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args]);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

async function readJson(targetPath) {
  return JSON.parse(await fs.readFile(targetPath, "utf8"));
}

test("Codex task goals are normalized and bounded by Unicode code points", () => {
  assert.equal(shortTaskGoal("  Ship\ncheckout · now  "), "Ship checkout - now");
  const bounded = shortTaskGoal("界".repeat(60));
  assert.equal(Array.from(bounded).length, TASK_GOAL_MAX_CODE_POINTS);
  assert.equal(bounded, `${"界".repeat(TASK_GOAL_MAX_CODE_POINTS - 1)}…`);
  assert.throws(() => shortTaskGoal("\n\t"), /non-empty Work Item goal/);

  const context = {
    positions: new Map([["engineering_manager", { display_name: "Engineering Manager" }]]),
    assignments: new Map([["engineering_manager", "agent-mog"]]),
    agents: new Map([["agent-mog", { display_name: "Mog" }]])
  };
  const title = suggestedTaskTitle(
    context,
    "WI-0086",
    "engineering_manager",
    "Prepare the first public Alpha release candidate"
  );
  assert.equal(Array.from(title).length, TASK_TITLE_MAX_CODE_POINTS);
  assert.match(title, /^WI-0086 · .+… · Engineering Manager \(Mog\)$/);
});

test("work item lifecycle, handoff, task registry, close, and observer status work together", async (context) => {
  const { temporaryRoot, target, configPath } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  for (const args of [["init", "-q"], ["add", "."], ["-c", "user.name=Temple Tests", "-c", "user.email=temple-tests@example.invalid", "commit", "-qm", "Initial candidate"]]) {
    const result = spawnSync("git", ["-C", target, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const candidateRevision = spawnSync("git", ["-C", target, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();

  const created = run([
    "work-item",
    "create",
    target,
    "--title",
    "Prove the lifecycle",
    "--scope",
    "Local fixture only",
    "--acceptance",
    "Every gate is evidence-backed",
    "--ui-mode",
    "not-applicable"
  ]);
  assert.equal(created.status, 0, created.stderr || created.stdout);
  assert.match(created.stdout, /WI-0001 · Prove the… · Engineering Manager \(Fixture Rowan\)/);

  const transitions = [
    ["spec", ["work_order=docs/work-order.md"]],
    ["design", ["approved_scope=docs/spec.md", "acceptance_criteria=docs/spec.md"]],
    ["build", ["technical_design=docs/design.md", "risk_review=docs/design.md"]]
  ];
  for (const [state, requirements] of transitions) {
    const args = ["transition", target, "--work-item", "WI-0001", "--to", state];
    for (const requirement of requirements) args.push("--satisfy", requirement);
    const transitioned = run(args);
    assert.equal(transitioned.status, 0, transitioned.stderr || transitioned.stdout);
  }

  const registered = run([
    "task",
    "register",
    target,
    "--work-item",
    "WI-0001",
    "--position",
    "developer",
    "--thread-id",
    "thread-fixture-developer",
    "--host-id",
    "local",
    "--provider-id",
    "codex-local",
    "--requested-model",
    "model-beta",
    "--reasoning-effort",
    "low",
    "--service-tier",
    "priority",
    "--launch-revision",
    "design-revision",
    "--revision",
    "design-revision"
  ]);
  assert.equal(registered.status, 0, registered.stderr || registered.stdout);
  assert.match(registered.stdout, /WI-0001 · Prove the lifecycle · Developer \(Fixture Devon\)/);

  const handoff = run([
    "handoff",
    target,
    "--work-item",
    "WI-0001",
    "--to",
    "quality_evaluator",
    "--input-revision",
    "HEAD",
    "--completed",
    "Implemented accepted scope",
    "--evidence",
    "artifacts/developer-test.md"
  ]);
  assert.equal(handoff.status, 0, handoff.stderr || handoff.stdout);
  const candidateStatus = run(["status", target, "--json", "--no-write"]);
  assert.equal(candidateStatus.status, 0, candidateStatus.stderr || candidateStatus.stdout);
  assert.equal(JSON.parse(candidateStatus.stdout).work_items.items[0].latest_revision, candidateRevision);

  const laterTransitions = [
    ["test", []],
    ["eval", ["test_evidence=artifacts/test.md"]],
    ["independent_qa", ["evaluation_report=artifacts/evaluation.md"]],
    ["release_gate", ["independent_qa_pass=artifacts/qa.md"]]
  ];
  for (const [state, requirements] of laterTransitions) {
    const args = ["transition", target, "--work-item", "WI-0001", "--to", state];
    for (const requirement of requirements) args.push("--satisfy", requirement);
    const transitioned = run(args);
    assert.equal(transitioned.status, 0, transitioned.stderr || transitioned.stdout);
  }

  const closed = run([
    "close",
    target,
    "--work-item",
    "WI-0001",
    "--decision",
    "go",
    "--tested-revision",
    candidateRevision,
    "--approval",
    "not-required",
    "--rollback",
    "git revert the closeout commit",
    "--satisfy",
    "accepted_scope=docs/spec.md",
    "--satisfy",
    "independent_qa_report=artifacts/qa.md"
  ]);
  assert.equal(closed.status, 0, closed.stderr || closed.stdout);
  assert.match(closed.stdout, /External release: not performed/);

  const completed = run([
    "task",
    "update",
    target,
    "--task-id",
    "task-0001",
    "--status",
    "completed",
    "--revision",
    candidateRevision,
    "--effective-model",
    "model-beta-v2"
  ]);
  assert.equal(completed.status, 0, completed.stderr || completed.stdout);

  const taskList = run(["task", "list", target, "--json"]);
  assert.equal(taskList.status, 0, taskList.stderr || taskList.stdout);
  assert.equal(JSON.parse(taskList.stdout)[0].archive_ready, true);

  const item = await readJson(path.join(target, ".ai-org/work-items/WI-0001.json"));
  assert.equal(item.state, "done");
  assert.equal(item.release_gate_result, "go");
  assert.equal(item.lifecycle_outcome, "accepted");
  assert.equal(item.developer_candidate_revision, candidateRevision);
  assert.ok(item.evidence.includes(".ai-org/artifacts/WI-0001/release-record.md"));
  const releaseRecord = await fs.readFile(path.join(target, ".ai-org/artifacts/WI-0001/release-record.md"), "utf8");
  assert.match(releaseRecord, /accepted_scope:/);
  assert.match(releaseRecord, /required_human_approval:/);
  assert.doesNotMatch(releaseRecord, /\bTemple\b/);

  const registry = await readJson(path.join(target, ".ai-org/project/tasks.json"));
  assert.equal(registry.tasks[0].registered_by, "agent-fixture-rowan");
  assert.equal(registry.tasks[0].last_updated_by, "agent-fixture-devon");
  assert.equal(registry.tasks[0].execution_origin, "codex-host-owned");
  assert.equal(registry.tasks[0].provider_id, "codex-local");
  assert.equal(registry.tasks[0].requested_model, "model-beta");
  assert.equal(registry.tasks[0].effective_model, "model-beta-v2");
  assert.equal(registry.tasks[0].requested_reasoning_effort, null);
  assert.equal(registry.tasks[0].observed_thread_reasoning_effort, null);
  assert.equal(registry.tasks[0].effective_turn_reasoning_effort, null);
  assert.equal(registry.tasks[0].reasoning_effort, "low");
  assert.equal(registry.tasks[0].reasoning_effort_source, "unknown");
  assert.equal(registry.tasks[0].service_tier, "priority");
  assert.equal(registry.tasks[0].launch_revision, "design-revision");
  assert.equal(registry.tasks[0].current_revision, candidateRevision);
  assert.equal(registry.tasks[0].base_revision, null);

  const status = run(["status", target, "--json", "--no-write"]);
  assert.equal(status.status, 0, status.stderr || status.stdout);
  const statusDocument = JSON.parse(status.stdout);
  assert.equal(statusDocument.work_items.by_state.done, 1);
  assert.equal(statusDocument.tasks.archive_ready, 1);
  assert.ok(statusDocument.attention.some((signal) => signal.type === "archive_ready"));

  const doctor = run(["doctor", target, "--json"]);
  assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
  assert.equal(JSON.parse(doctor.stdout).summary.fail, 0);

  const reinit = run(["init", target, "--config", configPath]);
  assert.equal(reinit.status, 0, reinit.stderr || reinit.stdout);
  assert.equal((await readJson(path.join(target, ".ai-org/project/tasks.json"))).tasks.length, 1);
});

test("Lean workflow stays bounded, escalates deterministically, and closes without a release gate", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));

  const created = run([
    "work-item", "create", target,
    "--title", "Make one bounded change",
    "--scope", "One local module",
    "--acceptance", "The focused test passes",
    "--workflow-profile", "lean",
    "--risk-tier", "low",
    "--scope-class", "bounded",
    "--profile-rationale", "Local reversible change with one acceptance check",
    "--ui-mode", "not-applicable",
    "--json"
  ]);
  assert.equal(created.status, 0, created.stderr || created.stdout);
  const lean = JSON.parse(created.stdout).item;
  assert.equal(lean.workflow_profile, "lean");
  assert.equal(lean.next_position, "developer");
  assert.equal(lean.profile_assessment.escalated, false);

  const incomplete = run(["transition", target, "--work-item", lean.id, "--to", "build"]);
  assert.equal(incomplete.status, 1);
  assert.match(incomplete.stderr, /work_order, approved_scope, acceptance_criteria, technical_design, risk_review, profile_eligibility/);

  const build = run([
    "transition", target, "--work-item", lean.id, "--to", "build",
    "--satisfy", "work_order=docs/brief.md",
    "--satisfy", "approved_scope=docs/brief.md",
    "--satisfy", "acceptance_criteria=docs/brief.md",
    "--satisfy", "technical_design=docs/brief.md",
    "--satisfy", "risk_review=docs/brief.md",
    "--satisfy", "profile_eligibility=docs/brief.md"
  ]);
  assert.equal(build.status, 0, build.stderr || build.stdout);
  assert.equal(run([
    "transition", target, "--work-item", lean.id, "--to", "test",
    "--satisfy", "developer_handoff=artifacts/handoff.md",
    "--satisfy", "developer_evidence=artifacts/test.md"
  ]).status, 0);
  assert.equal(run([
    "transition", target, "--work-item", lean.id, "--to", "done",
    "--satisfy", "test_evidence=artifacts/test.md",
    "--satisfy", "lean_closeout=artifacts/closeout.md"
  ]).status, 0);
  const closed = await readJson(path.join(target, `.ai-org/work-items/${lean.id}.json`));
  assert.equal(closed.state, "done");
  assert.equal(closed.lifecycle_outcome, "accepted");
  assert.equal(closed.external_release_status, "not_performed");

  const escalated = run([
    "work-item", "create", target,
    "--title", "Coordinate a cross-system change",
    "--workflow-profile", "lean",
    "--risk-tier", "low",
    "--scope-class", "cross-system",
    "--profile-rationale", "Assessment should raise the profile",
    "--ui-mode", "not-applicable",
    "--json"
  ]);
  assert.equal(escalated.status, 0, escalated.stderr || escalated.stdout);
  const standard = JSON.parse(escalated.stdout).item;
  assert.equal(standard.workflow_profile, "standard");
  assert.equal(standard.profile_assessment.requested_profile, "lean");
  assert.equal(standard.profile_assessment.escalated, true);
  assert.equal(standard.next_position, "product_manager");

  const unsafeLean = run([
    "work-item", "create", target,
    "--title", "Touch a security boundary",
    "--workflow-profile", "lean",
    "--risk-tier", "low",
    "--scope-class", "bounded",
    "--escalation-trigger", "security-boundary",
    "--profile-rationale", "Assessment must fail closed",
    "--ui-mode", "not-applicable"
  ]);
  assert.equal(unsafeLean.status, 1);
  assert.match(unsafeLean.stderr, /requires High-Assurance collaboration prerequisites/);
});

test("legacy release-gate no-go records migrate to a terminal conclusion without hiding active blockers", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  for (const title of ["Finished experiment", "Active blocker"]) {
    const created = run(["work-item", "create", target, "--title", title, "--ui-mode", "not-applicable"]);
    assert.equal(created.status, 0, created.stderr || created.stdout);
  }
  const finishedPath = path.join(target, ".ai-org/work-items/WI-0001.json");
  const finished = await readJson(finishedPath);
  finished.state = "blocked";
  finished.previous_state = "release_gate";
  finished.release_gate_result = "no-go";
  finished.next_position = null;
  finished.unresolved = ["Evaluator result was unavailable"];
  finished.gate_evidence.rollback_plan = [".ai-org/artifacts/WI-0001/release-record.md"];
  await fs.writeFile(finishedPath, `${JSON.stringify(finished, null, 2)}\n`);
  const blockerPath = path.join(target, ".ai-org/work-items/WI-0002.json");
  const blocker = await readJson(blockerPath);
  blocker.state = "blocked";
  blocker.previous_state = "build";
  blocker.next_position = null;
  await fs.writeFile(blockerPath, `${JSON.stringify(blocker, null, 2)}\n`);

  const preview = run(["work-item", "migrate-outcomes", target, "--dry-run", "--json"]);
  assert.equal(preview.status, 0, preview.stderr || preview.stdout);
  assert.deepEqual(JSON.parse(preview.stdout).candidates.map((entry) => entry.work_item_id), ["WI-0001"]);

  const migrated = run([
    "work-item", "migrate-outcomes", target,
    "--work-item", "WI-0001",
    "--outcome", "inconclusive",
    "--reason", "No matched-quality score was frozen",
    "--json"
  ]);
  assert.equal(migrated.status, 0, migrated.stderr || migrated.stdout);
  const concluded = await readJson(finishedPath);
  assert.equal(concluded.state, "concluded");
  assert.equal(concluded.lifecycle_outcome, "inconclusive");
  assert.deepEqual(concluded.closeout_reasons, ["No matched-quality score was frozen", "Evaluator result was unavailable"]);
  assert.equal((await readJson(blockerPath)).state, "blocked");

  const observer = JSON.parse(run(["observe", target, "--json"]).stdout);
  assert.equal(observer.work.categories.terminal, 1);
  assert.equal(observer.work.categories.blocked, 1);
});

test("task title refresh is explicit, idempotent, and preserves canonical task metadata", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));

  const created = run([
    "work-item",
    "create",
    target,
    "--title",
    "  Reconcile\nlegacy · task titles  ",
    "--scope",
    "Repository suggestion only",
    "--acceptance",
    "Task identity is preserved"
  ]);
  assert.equal(created.status, 0, created.stderr || created.stdout);

  const registered = run([
    "task",
    "register",
    target,
    "--work-item",
    "WI-0001",
    "--position",
    "developer",
    "--thread-id",
    "thread-legacy-title",
    "--host-id",
    "local",
    "--requested-model",
    "model-beta",
    "--reasoning-effort",
    "low",
    "--revision",
    "revision-123",
    "--notes",
    "preserve this note"
  ]);
  assert.equal(registered.status, 0, registered.stderr || registered.stdout);

  const registryPath = path.join(target, ".ai-org/project/tasks.json");
  const legacyRegistry = await readJson(registryPath);
  legacyRegistry.tasks[0].suggested_title = "WI-0001 · Developer · Fixture Devon";
  await fs.writeFile(registryPath, `${JSON.stringify(legacyRegistry, null, 2)}\n`);
  const before = structuredClone(legacyRegistry.tasks[0]);

  const refreshed = run(["task", "refresh-titles", target, "--task-id", "task-0001", "--json"]);
  assert.equal(refreshed.status, 0, refreshed.stderr || refreshed.stdout);
  const result = JSON.parse(refreshed.stdout);
  assert.equal(result.updated_count, 1);
  assert.equal(result.unchanged_count, 0);
  assert.equal(result.external_action_performed, false);
  assert.equal(
    result.updated[0].after,
    "WI-0001 · Reconcile legacy - … · Developer (Fixture Devon)"
  );
  assert.equal(Array.from(result.updated[0].after).length, TASK_TITLE_MAX_CODE_POINTS);

  const after = (await readJson(registryPath)).tasks[0];
  assert.deepEqual(
    { ...after, suggested_title: before.suggested_title },
    before,
    "refresh must change only the repository-stored title suggestion"
  );

  const repeated = run(["task", "refresh-titles", target, "--task-id", "task-0001", "--json"]);
  assert.equal(repeated.status, 0, repeated.stderr || repeated.stdout);
  assert.deepEqual(JSON.parse(repeated.stdout), {
    updated_count: 0,
    unchanged_count: 1,
    updated: [],
    external_action_performed: false
  });

  const events = (await fs.readFile(path.join(target, ".ai-org/events/events.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(events.filter((event) => event.event_type === "task_titles_refreshed").length, 1);
});

test("unresolved items can be listed, resolved, merged, and deduplicated safely", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));

  const created = run([
    "work-item",
    "create",
    target,
    "--title",
    "Manage unresolved items",
    "--unresolved",
    "Simulator coverage is pending",
    "--unresolved",
    "API contract needs review"
  ]);
  assert.equal(created.status, 0, created.stderr || created.stdout);

  const listed = run(["work-item", "unresolved", target, "--work-item", "WI-0001", "--json"]);
  assert.equal(listed.status, 0, listed.stderr || listed.stdout);
  assert.deepEqual(JSON.parse(listed.stdout), {
    work_item_id: "WI-0001",
    unresolved: ["Simulator coverage is pending", "API contract needs review"]
  });

  const updated = run([
    "work-item",
    "unresolved",
    target,
    "--work-item",
    "WI-0001",
    "--resolve",
    "API contract needs review",
    "--merge",
    "Device coverage is pending",
    "--merge",
    " Device coverage is pending "
  ]);
  assert.equal(updated.status, 0, updated.stderr || updated.stdout);
  assert.match(updated.stdout, /Resolved: API contract needs review/);
  assert.match(updated.stdout, /Merged: Device coverage is pending/);
  const itemPath = path.join(target, ".ai-org/work-items/WI-0001.json");
  const item = await readJson(itemPath);
  assert.deepEqual(item.unresolved, ["Simulator coverage is pending", "Device coverage is pending"]);

  const beforeRejectedResolution = await fs.readFile(itemPath, "utf8");
  const rejected = run([
    "work-item",
    "unresolved",
    target,
    "--work-item",
    "WI-0001",
    "--resolve",
    "Unknown issue"
  ]);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Unresolved item not found on WI-0001: Unknown issue/);
  assert.equal(await fs.readFile(itemPath, "utf8"), beforeRejectedResolution);

  const idempotent = run([
    "work-item",
    "unresolved",
    target,
    "--work-item",
    "WI-0001",
    "--merge",
    "Device coverage is pending"
  ]);
  assert.equal(idempotent.status, 0, idempotent.stderr || idempotent.stdout);
  assert.match(idempotent.stdout, /Merged: none/);
  assert.match(idempotent.stdout, /Changed: no/);

  const overlapping = run([
    "work-item",
    "unresolved",
    target,
    "--work-item",
    "WI-0001",
    "--resolve",
    "Device coverage is pending",
    "--merge",
    "Device coverage is pending"
  ]);
  assert.equal(overlapping.status, 1);
  assert.match(overlapping.stderr, /Cannot resolve and merge the same unresolved item/);
  assert.equal(await fs.readFile(itemPath, "utf8"), beforeRejectedResolution);

  const events = (await fs.readFile(path.join(target, ".ai-org/events/events.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(events.at(-1).event_type, "work_item_unresolved_updated");
  assert.deepEqual(events.at(-1).resolved, ["API contract needs review"]);
  assert.deepEqual(events.at(-1).merged, ["Device coverage is pending"]);

  await fs.writeFile(itemPath, `${JSON.stringify({ ...item, unresolved: "not-an-array" }, null, 2)}\n`);
  const malformedDoctor = run(["doctor", target]);
  assert.equal(malformedDoctor.status, 1);
  assert.match(malformedDoctor.stdout, /Invalid work item files: WI-0001.json/);
  const malformedList = run(["work-item", "unresolved", target, "--work-item", "WI-0001"]);
  assert.equal(malformedList.status, 1);
  assert.match(malformedList.stderr, /invalid unresolved items; expected an array of strings/);

  await fs.writeFile(itemPath, `${JSON.stringify({ ...item, unresolved: ["valid", { invalid: true }] }, null, 2)}\n`);
  const malformedElementDoctor = run(["doctor", target]);
  assert.equal(malformedElementDoctor.status, 1);
  assert.match(malformedElementDoctor.stdout, /Invalid work item files: WI-0001.json/);
  const malformedElementList = run(["work-item", "unresolved", target, "--work-item", "WI-0001"]);
  assert.equal(malformedElementList.status, 1);
  assert.match(malformedElementList.stderr, /invalid unresolved items; expected an array of strings/);
});

test("transition refuses missing named gate evidence without changing state", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  assert.equal(run(["work-item", "create", target, "--title", "Guard the gate"]).status, 0);

  const rejected = run(["transition", target, "--work-item", "WI-0001", "--to", "spec"]);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /missing gate evidence: work_order/);
  assert.equal((await readJson(path.join(target, ".ai-org/work-items/WI-0001.json"))).state, "intake");
});

test("transition rejects invalid repository artifacts without changing canonical state", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  assert.equal(run(["work-item", "create", target, "--title", "Validate local artifacts"]).status, 0);

  const itemPath = path.join(target, ".ai-org/work-items/WI-0001.json");
  const eventsPath = path.join(target, ".ai-org/events/events.jsonl");
  await fs.symlink(path.join(target, "docs/work-order.md"), path.join(target, "docs/work-order-link.md"));

  for (const [reference, message] of [
    ["docs/missing.md", /Gate evidence artifact is missing/],
    ["../outside.md", /Gate evidence artifact path is unsafe/],
    ["docs/", /Gate evidence artifact is not a regular file/],
    ["docs/work-order-link.md", /must not be a symbolic link/]
  ]) {
    const beforeItem = await fs.readFile(itemPath, "utf8");
    const beforeEvents = await fs.readFile(eventsPath, "utf8");
    const rejected = run([
      "transition",
      target,
      "--work-item",
      "WI-0001",
      "--to",
      "spec",
      "--satisfy",
      `work_order=${reference}`
    ]);
    assert.equal(rejected.status, 1, rejected.stderr || rejected.stdout);
    assert.match(rejected.stderr, message);
    assert.equal(await fs.readFile(itemPath, "utf8"), beforeItem);
    assert.equal(await fs.readFile(eventsPath, "utf8"), beforeEvents);
  }

  const gitRevision = "1fd6136b7a483eac7d984701cb7097d623b916d5";
  const accepted = run([
    "transition",
    target,
    "--work-item",
    "WI-0001",
    "--to",
    "spec",
    "--satisfy",
    `work_order=${gitRevision}`
  ]);
  assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
  assert.deepEqual((await readJson(itemPath)).gate_evidence.work_order, [gitRevision]);
});

test("close rejects a missing repository artifact without writing closeout state", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  assert.equal(
    run(["work-item", "create", target, "--title", "Guard closeout evidence", "--ui-mode", "not-applicable"]).status,
    0
  );
  const itemPath = path.join(target, ".ai-org/work-items/WI-0001.json");
  const eventsPath = path.join(target, ".ai-org/events/events.jsonl");
  const item = await readJson(itemPath);
  item.state = "release_gate";
  item.owner_position = "release_manager";
  item.assigned_agent_id = "agent-fixture-rowan";
  await fs.writeFile(itemPath, `${JSON.stringify(item, null, 2)}\n`);
  const beforeItem = await fs.readFile(itemPath, "utf8");
  const beforeEvents = await fs.readFile(eventsPath, "utf8");

  const rejected = run([
    "close",
    target,
    "--work-item",
    "WI-0001",
    "--decision",
    "go",
    "--tested-revision",
    "candidate-1",
    "--approval",
    "not-required",
    "--rollback",
    "git revert candidate-1",
    "--satisfy",
    "accepted_scope=docs/missing-closeout.md",
    "--satisfy",
    "test_evidence=docs/test.md",
    "--satisfy",
    "evaluation_report=docs/eval.md",
    "--satisfy",
    "independent_qa_report=docs/qa.md"
  ]);
  assert.equal(rejected.status, 1, rejected.stderr || rejected.stdout);
  assert.match(rejected.stderr, /Gate evidence artifact is missing: docs\/missing-closeout\.md/);
  assert.equal(await fs.readFile(itemPath, "utf8"), beforeItem);
  assert.equal(await fs.readFile(eventsPath, "utf8"), beforeEvents);
  await assert.rejects(fs.access(path.join(target, ".ai-org/artifacts/WI-0001/release-record.md")));
});

test("transition validates normalized gate evidence before mutating canonical state", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const created = run([
    "work-item",
    "create",
    target,
    "--title",
    "Guard normalized gate evidence",
    "--ui-mode",
    "not-applicable"
  ]);
  assert.equal(created.status, 0, created.stderr || created.stdout);

  const itemPath = path.join(target, ".ai-org/work-items/WI-0001.json");
  const eventsPath = path.join(target, ".ai-org/events/events.jsonl");
  const item = await readJson(itemPath);
  await fs.writeFile(
    itemPath,
    `${JSON.stringify(
      {
        ...item,
        state: "independent_qa",
        owner_position: "independent_qa",
        assigned_agent_id: "agent-fixture-hollis",
        developer_candidate_revision: "fixture-candidate",
        handoffs: [{ from_position: "developer", to_position: "quality_evaluator", actor: "agent-fixture-devon", principal_id: "human", input_revision: "fixture-candidate" }]
      },
      null,
      2
    )}\n`
  );

  const passId = "EVID-20260830T000000Z-11111111";
  const otherId = "EVID-20260830T000001Z-22222222";
  const failedId = "EVID-20260830T000002Z-33333333";
  const expiredId = "EVID-20260830T000003Z-44444444";
  const invalidatedId = "EVID-20260830T000004Z-55555555";
  const evidencePath = path.join(target, ".ai-org/project/evidence.json");
  const evidence = await readJson(evidencePath);
  evidence.entries.push(
    { id: passId, work_item_id: "WI-0001", kind: "test", outcome: "pass", expires_at: null, invalidated_at: null },
    { id: otherId, work_item_id: "WI-0002", kind: "test", outcome: "pass", expires_at: null, invalidated_at: null },
    { id: failedId, work_item_id: "WI-0001", kind: "test", outcome: "fail", expires_at: null, invalidated_at: null },
    { id: expiredId, work_item_id: "WI-0001", kind: "runtime", outcome: "pass", expires_at: "2020-01-01T00:00:00.000Z", invalidated_at: null },
    { id: invalidatedId, work_item_id: "WI-0001", kind: "runtime", outcome: "pass", expires_at: null, invalidated_at: "2026-08-30T00:00:00.000Z" }
  );
  for (const entry of evidence.entries) entry.recorded_by = "agent-fixture-hollis";
  await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

  for (const [reference, message] of [
    ["EVID-20260830T000000Z-PLACEHOLDER", /not present in the normalized registry/],
    ["EVID-20260830T000005Z-66666666", /not present in the normalized registry/],
    [otherId, /belongs to WI-0002, not WI-0001/],
    [failedId, /outcome fail does not satisfy independent_qa_pass/],
    [expiredId, /is expired/],
    [invalidatedId, /is invalidated/]
  ]) {
    const beforeItem = await fs.readFile(itemPath, "utf8");
    const beforeEvents = await fs.readFile(eventsPath, "utf8");
    const rejected = run([
      "transition",
      target,
      "--work-item",
      "WI-0001",
      "--to",
      "release_gate",
      "--satisfy",
      `independent_qa_pass=${reference}`
    ]);
    assert.equal(rejected.status, 1, rejected.stderr || rejected.stdout);
    assert.match(rejected.stderr, message);
    assert.equal(await fs.readFile(itemPath, "utf8"), beforeItem);
    assert.equal(await fs.readFile(eventsPath, "utf8"), beforeEvents);
  }

  const accepted = run([
    "transition",
    target,
    "--work-item",
    "WI-0001",
    "--to",
    "release_gate",
    "--satisfy",
    `independent_qa_pass=${passId}`
  ]);
  assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
  const transitioned = await readJson(itemPath);
  assert.equal(transitioned.state, "release_gate");
  assert.deepEqual(transitioned.gate_evidence.independent_qa_pass, [passId]);
});

test("legacy Build work remains configurable when UI mode did not exist", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  assert.equal(run(["work-item", "create", target, "--title", "Legacy build record"]).status, 0);
  const itemPath = path.join(target, ".ai-org/work-items/WI-0001.json");
  const legacy = await readJson(itemPath);
  delete legacy.ui_delivery_mode;
  legacy.state = "build";
  legacy.owner_position = "developer";
  legacy.assigned_agent_id = "agent-fixture-devon";
  await fs.writeFile(itemPath, `${JSON.stringify(legacy, null, 2)}\n`);

  const configured = run([
    "work-item",
    "configure",
    target,
    "--work-item",
    "WI-0001",
    "--base-revision",
    "legacy-base"
  ]);
  assert.equal(configured.status, 0, configured.stderr || configured.stdout);
  const configuredItem = await readJson(itemPath);
  assert.equal(Object.hasOwn(configuredItem, "ui_delivery_mode"), false);

  const claimed = run([
    "work-item",
    "claim",
    target,
    "--work-item",
    "WI-0001",
    "--agent-id",
    "agent-fixture-devon",
    "--principal-id",
    "human",
    "--base-revision",
    "legacy-base",
    "--branch",
    "legacy/build"
  ]);
  assert.equal(claimed.status, 0, claimed.stderr || claimed.stdout);
});

test("lifecycle mutations reject an invalid specification authority registry", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const specIndexPath = path.join(target, ".ai-org/project/spec-index.json");
  const invalidIndex = {
    schema_version: "temple.spec-index/v1",
    adoption_profile: "hybrid",
    delivery_method: "contract-guided-iterative",
    entries: [
      {
        id: "SPEC-INVALID",
        kind: "feature_spec",
        title: "Invalid authority",
        authority: "made_up_authority",
        status: "approved",
        revision: "rev-1",
        source: {
          kind: "repository",
          location: "../outside.md",
          system: "git",
          content_sha256: "a".repeat(64)
        },
        owner_position: "unknown_position",
        approved_by: "agent-self",
        approved_at: "not-a-date",
        approval_ref: "self",
        source_refs: [],
        related_work_items: [],
        updated_at: "2026-08-29T00:00:00.000Z"
      }
    ]
  };
  await fs.writeFile(specIndexPath, `${JSON.stringify(invalidIndex, null, 2)}\n`);

  const created = run([
    "work-item",
    "create",
    target,
    "--title",
    "Must not trust invalid authority",
    "--spec-mode",
    "indexed",
    "--spec-ref",
    "SPEC-INVALID@rev-1",
    "--ui-mode",
    "not-applicable"
  ]);
  assert.equal(created.status, 1);
  assert.match(created.stderr, /Invalid specification index/);
  assert.deepEqual((await fs.readdir(path.join(target, ".ai-org/work-items"))).filter((entry) => entry.endsWith(".json")), []);

  const status = JSON.parse(run(["status", target, "--json", "--no-write"]).stdout);
  assert.ok(status.attention.some((entry) => entry.type === "invalid_specification_index"));
  assert.equal(run(["doctor", target]).status, 1);
});

test("go closeout rechecks specification revisions while no-go remains available", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const source = "# Approved bounded scope\n";
  await fs.mkdir(path.join(target, "docs"), { recursive: true });
  await fs.writeFile(path.join(target, "docs/spec.md"), source);
  const specIndexPath = path.join(target, ".ai-org/project/spec-index.json");
  const specIndex = {
    schema_version: "temple.spec-index/v1",
    adoption_profile: "temple-native",
    delivery_method: "contract-guided-iterative",
    entries: [
      {
        id: "SPEC-CLOSE",
        kind: "feature_spec",
        title: "Closeout contract",
        authority: "temple_native",
        status: "approved",
        revision: "rev-1",
        source: {
          kind: "repository",
          location: "docs/spec.md",
          system: "git",
          content_sha256: crypto.createHash("sha256").update(source).digest("hex")
        },
        owner_position: "product_manager",
        approved_by: "human-product-owner",
        approved_at: "2026-08-29T00:00:00.000Z",
        approval_ref: "docs/spec.md",
        source_refs: [],
        related_work_items: [],
        updated_at: "2026-08-29T00:00:00.000Z"
      }
    ]
  };
  await fs.writeFile(specIndexPath, `${JSON.stringify(specIndex, null, 2)}\n`);
  assert.equal(
    run([
      "work-item",
      "create",
      target,
      "--title",
      "Recheck before close",
      "--spec-ref",
      "SPEC-CLOSE@rev-1",
      "--ui-mode",
      "not-applicable"
    ]).status,
    0
  );
  const itemPath = path.join(target, ".ai-org/work-items/WI-0001.json");
  const item = await readJson(itemPath);
  item.state = "release_gate";
  item.owner_position = "release_manager";
  item.assigned_agent_id = "agent-fixture-rowan";
  await fs.writeFile(itemPath, `${JSON.stringify(item, null, 2)}\n`);
  specIndex.entries[0].revision = "rev-2";
  await fs.writeFile(specIndexPath, `${JSON.stringify(specIndex, null, 2)}\n`);

  const evidenceArgs = [
    "--tested-revision",
    "candidate-1",
    "--approval",
    "not-required",
    "--rollback",
    "git revert candidate-1",
    "--satisfy",
    "accepted_scope=docs/spec.md",
    "--satisfy",
    "test_evidence=docs/test.md",
    "--satisfy",
    "evaluation_report=docs/eval.md",
    "--satisfy",
    "independent_qa_report=docs/qa.md"
  ];
  const staleGo = run(["close", target, "--work-item", "WI-0001", "--decision", "go", ...evidenceArgs]);
  assert.equal(staleGo.status, 1);
  assert.match(staleGo.stderr, /requires current specification revisions/);

  const noGo = run([
    "close",
    target,
    "--work-item",
    "WI-0001",
    "--decision",
    "no-go",
    "--reason",
    "Specification revision changed",
    ...evidenceArgs
  ]);
  assert.equal(noGo.status, 0, noGo.stderr || noGo.stdout);
  const concluded = await readJson(itemPath);
  assert.equal(concluded.state, "concluded");
  assert.equal(concluded.lifecycle_outcome, "no-go");
  assert.deepEqual(concluded.closeout_reasons, ["Specification revision changed"]);
});

test("go closeout enforces the selected UI mode evidence contract", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  assert.equal(
    run(["work-item", "create", target, "--title", "Verify UI evidence", "--ui-mode", "code-first"]).status,
    0
  );
  const itemPath = path.join(target, ".ai-org/work-items/WI-0001.json");
  const item = await readJson(itemPath);
  item.state = "release_gate";
  item.owner_position = "release_manager";
  item.assigned_agent_id = "agent-fixture-rowan";
  await fs.writeFile(itemPath, `${JSON.stringify(item, null, 2)}\n`);
  const baseArgs = [
    "close",
    target,
    "--work-item",
    "WI-0001",
    "--decision",
    "go",
    "--tested-revision",
    "candidate-ui",
    "--approval",
    "not-required",
    "--rollback",
    "git revert candidate-ui",
    "--satisfy",
    "accepted_scope=docs/spec.md",
    "--satisfy",
    "test_evidence=docs/test.md",
    "--satisfy",
    "evaluation_report=docs/eval.md",
    "--satisfy",
    "independent_qa_report=docs/qa.md"
  ];
  const missingUiEvidence = run(baseArgs);
  assert.equal(missingUiEvidence.status, 1);
  assert.match(missingUiEvidence.stderr, /Close requires UI evidence for code-first/);

  const closed = run([
    ...baseArgs,
    "--satisfy",
    "ui_brief=docs/ui-brief.md",
    "--satisfy",
    "required_state_coverage=docs/ui-states.md",
    "--satisfy",
    "runtime_visual_review=docs/ui-runtime.md"
  ]);
  assert.equal(closed.status, 0, closed.stderr || closed.stdout);
  assert.equal((await readJson(itemPath)).state, "done");
});

test("versioned product, UX, UI, and API references stay observable and stale revisions stop delivery", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));

  const sourcePaths = ["docs/spec.md", "docs/ux.md", "docs/ui.md", "docs/api.yaml", "docs/requirements.md"];
  await fs.mkdir(path.join(target, "docs"), { recursive: true });
  for (const sourcePath of sourcePaths) await fs.writeFile(path.join(target, sourcePath), `# ${sourcePath}\n`);
  const approved = {
    status: "approved",
    approved_by: "human-product-owner",
    approved_at: "2026-08-29T00:00:00.000Z",
    approval_ref: "docs/approval-record.md",
    source_refs: [],
    related_work_items: [],
    updated_at: "2026-08-29T00:00:00.000Z"
  };
  const specIndexPath = path.join(target, ".ai-org/project/spec-index.json");
  const specIndex = {
    schema_version: "temple.spec-index/v1",
    adoption_profile: "hybrid",
    delivery_method: "contract-guided-iterative",
    entries: [
      {
        ...approved,
        id: "SPEC-0001",
        kind: "feature_spec",
        title: "Checkout slice",
        authority: "temple_native",
        revision: "spec-1",
        source: {
          kind: "repository",
          location: sourcePaths[0],
          system: "git",
          content_sha256: crypto.createHash("sha256").update(`# ${sourcePaths[0]}\n`).digest("hex")
        },
        owner_position: "product_manager"
      },
      {
        ...approved,
        id: "UX-0001",
        kind: "ux_flow",
        title: "Checkout journey",
        authority: "temple_native",
        revision: "ux-1",
        source: {
          kind: "repository",
          location: sourcePaths[1],
          system: "git",
          content_sha256: crypto.createHash("sha256").update(`# ${sourcePaths[1]}\n`).digest("hex")
        },
        owner_position: "ux_designer"
      },
      {
        ...approved,
        id: "UI-0001",
        kind: "ui_contract",
        title: "Checkout interaction contract",
        authority: "temple_native",
        revision: "ui-1",
        source: {
          kind: "repository",
          location: sourcePaths[2],
          system: "git",
          content_sha256: crypto.createHash("sha256").update(`# ${sourcePaths[2]}\n`).digest("hex")
        },
        owner_position: "ui_designer"
      },
      {
        ...approved,
        id: "API-0001",
        kind: "api_contract",
        title: "Checkout API",
        authority: "temple_native",
        revision: "api-1",
        source: {
          kind: "repository",
          location: sourcePaths[3],
          system: "git",
          content_sha256: crypto.createHash("sha256").update(`# ${sourcePaths[3]}\n`).digest("hex")
        },
        owner_position: "tech_lead"
      },
      {
        ...approved,
        id: "REQ-0001",
        kind: "product_requirements",
        title: "Checkout requirements",
        authority: "temple_native",
        revision: "req-1",
        source: {
          kind: "repository",
          location: sourcePaths[4],
          system: "git",
          content_sha256: crypto.createHash("sha256").update(`# ${sourcePaths[4]}\n`).digest("hex")
        },
        owner_position: "product_manager"
      }
    ]
  };
  await fs.writeFile(specIndexPath, `${JSON.stringify(specIndex, null, 2)}\n`);

  const created = run([
    "work-item",
    "create",
    target,
    "--title",
    "Deliver one checkout slice",
    "--spec-ref",
    "SPEC-0001@spec-1",
    "--spec-ref",
    "REQ-0001@req-1",
    "--ux-ref",
    "UX-0001@ux-1",
    "--ui-ref",
    "UI-0001@ui-1",
    "--contract-ref",
    "API-0001@api-1",
    "--ui-mode",
    "preview-first"
  ]);
  assert.equal(created.status, 0, created.stderr || created.stdout);

  assert.equal(
    run(["transition", target, "--work-item", "WI-0001", "--to", "spec", "--satisfy", "work_order=docs/work-order.md"]).status,
    0
  );
  const designed = run([
    "transition",
    target,
    "--work-item",
    "WI-0001",
    "--to",
    "design",
    "--satisfy",
    "approved_scope=docs/spec.md",
    "--satisfy",
    "acceptance_criteria=docs/spec.md"
  ]);
  assert.equal(designed.status, 0, designed.stderr || designed.stdout);

  const status = JSON.parse(run(["status", target, "--json", "--no-write"]).stdout);
  assert.equal(status.work_items.items[0].ui_delivery_mode, "preview-first");
  assert.equal(status.work_items.items[0].specification_reference_count, 5);
  assert.equal(status.work_items.items[0].stale_specification_count, 0);
  const capsule = JSON.parse(
    run(["context", "resolve", target, "--work-item", "WI-0001", "--position", "tech_lead", "--no-write", "--json"]).stdout
  );
  assert.deepEqual(capsule.specifications.map((entry) => entry.id), ["SPEC-0001", "REQ-0001", "UX-0001", "UI-0001", "API-0001"]);

  specIndex.entries[0].revision = "spec-2";
  await fs.writeFile(specIndexPath, `${JSON.stringify(specIndex, null, 2)}\n`);
  const doctor = run(["doctor", target, "--json"]);
  assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
  assert.equal(
    JSON.parse(doctor.stdout).checks.find((check) => check.id === "specification_reference_staleness").status,
    "warn"
  );
  const staleStatus = JSON.parse(run(["status", target, "--json", "--no-write"]).stdout);
  assert.ok(staleStatus.attention.some((entry) => entry.type === "stale_specification_reference"));

  const blocked = run([
    "transition",
    target,
    "--work-item",
    "WI-0001",
    "--to",
    "build",
    "--satisfy",
    "technical_design=docs/design.md",
    "--satisfy",
    "risk_review=docs/design.md"
  ]);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /requires current specification revisions/);

  const repinned = run(["work-item", "configure", target, "--work-item", "WI-0001", "--spec-ref", "SPEC-0001@spec-2"]);
  assert.equal(repinned.status, 0, repinned.stderr || repinned.stdout);
  const repinnedItem = await readJson(path.join(target, ".ai-org/work-items/WI-0001.json"));
  assert.deepEqual(repinnedItem.spec_refs, [
    { id: "SPEC-0001", revision: "spec-2" },
    { id: "REQ-0001", revision: "req-1" }
  ]);
  const missingUiEvidence = run([
    "transition",
    target,
    "--work-item",
    "WI-0001",
    "--to",
    "build",
    "--satisfy",
    "technical_design=docs/design.md",
    "--satisfy",
    "risk_review=docs/design.md"
  ]);
  assert.equal(missingUiEvidence.status, 1);
  assert.match(missingUiEvidence.stderr, /requires UI evidence for preview-first/);

  const built = run([
    "transition",
    target,
    "--work-item",
    "WI-0001",
    "--to",
    "build",
    "--satisfy",
    "technical_design=docs/design.md",
    "--satisfy",
    "risk_review=docs/design.md",
    "--satisfy",
    "ui_brief=docs/ui-brief.md",
    "--satisfy",
    "preview_artifact=docs/ui-preview.png",
    "--satisfy",
    "review_record=docs/ui-review.md"
  ]);
  assert.equal(built.status, 0, built.stderr || built.stdout);

  await fs.writeFile(path.join(target, sourcePaths[3]), "changed without an indexed revision\n");
  const driftedSource = run([
    "transition",
    target,
    "--work-item",
    "WI-0001",
    "--to",
    "test",
    "--satisfy",
    "developer_handoff=docs/handoff.md",
    "--satisfy",
    "developer_evidence=docs/developer-test.md"
  ]);
  assert.equal(driftedSource.status, 1);
  assert.match(driftedSource.stderr, /content does not match source\.content_sha256/);
  const driftedStatus = JSON.parse(run(["status", target, "--json", "--no-write"]).stdout);
  assert.ok(driftedStatus.attention.some((entry) => entry.type === "invalid_specification_source"));
  await fs.writeFile(path.join(target, sourcePaths[3]), `# ${sourcePaths[3]}\n`);

  specIndex.entries.find((entry) => entry.id === "API-0001").status = "draft";
  await fs.writeFile(specIndexPath, `${JSON.stringify(specIndex, null, 2)}\n`);
  const approvalRevoked = run([
    "transition",
    target,
    "--work-item",
    "WI-0001",
    "--to",
    "test",
    "--satisfy",
    "developer_handoff=docs/handoff.md",
    "--satisfy",
    "developer_evidence=docs/developer-test.md"
  ]);
  assert.equal(approvalRevoked.status, 1);
  assert.match(approvalRevoked.stderr, /requires approved referenced contracts: API-0001/);
  const unapprovedStatus = JSON.parse(run(["status", target, "--json", "--no-write"]).stdout);
  assert.ok(unapprovedStatus.attention.some((entry) => entry.type === "unapproved_specification_reference"));
  specIndex.entries.find((entry) => entry.id === "API-0001").status = "approved";
  await fs.writeFile(specIndexPath, `${JSON.stringify(specIndex, null, 2)}\n`);

  const staleRepin = run([
    "work-item",
    "configure",
    target,
    "--work-item",
    "WI-0001",
    "--spec-ref",
    "SPEC-0001@spec-1"
  ]);
  assert.equal(staleRepin.status, 1);
  assert.match(staleRepin.stderr, /requires current specification revisions/);

  const specificationDowngrade = run([
    "work-item",
    "configure",
    target,
    "--work-item",
    "WI-0001",
    "--replace-spec-refs",
    "--spec-mode",
    "gate-evidence"
  ]);
  assert.equal(specificationDowngrade.status, 1);
  assert.match(specificationDowngrade.stderr, /Specification mode cannot change after entering build/);

  const uiDowngrade = run([
    "work-item",
    "configure",
    target,
    "--work-item",
    "WI-0001",
    "--replace-ui-refs",
    "--ui-mode",
    "not-applicable"
  ]);
  assert.equal(uiDowngrade.status, 1);
  assert.match(uiDowngrade.stderr, /UI delivery mode cannot change after entering build/);

  const governancePreserved = await readJson(path.join(target, ".ai-org/work-items/WI-0001.json"));
  assert.equal(governancePreserved.specification_mode, "indexed");
  assert.deepEqual(governancePreserved.spec_refs, [
    { id: "SPEC-0001", revision: "spec-2" },
    { id: "REQ-0001", revision: "req-1" }
  ]);
  assert.equal(governancePreserved.ui_delivery_mode, "preview-first");
  assert.deepEqual(governancePreserved.ui_refs, [{ id: "UI-0001", revision: "ui-1" }]);

  const contradictory = run([
    "work-item",
    "create",
    target,
    "--title",
    "Reject contradictory UI scope",
    "--ui-mode",
    "not-applicable",
    "--ui-ref",
    "UI-0001@ui-1"
  ]);
  assert.equal(contradictory.status, 1);
  assert.match(contradictory.stderr, /not-applicable cannot have ui_refs/);

  const missingMode = run([
    "work-item",
    "create",
    target,
    "--title",
    "Reject an unclassified interface",
    "--ui-ref",
    "UI-0001@ui-1"
  ]);
  assert.equal(missingMode.status, 1);
  assert.match(missingMode.stderr, /require an explicit UI delivery mode/);

  const noInterface = run([
    "work-item",
    "create",
    target,
    "--title",
    "Change a backend-only rule",
    "--contract-ref",
    "API-0001@api-1",
    "--ui-mode",
    "not-applicable"
  ]);
  assert.equal(noInterface.status, 0, noInterface.stderr || noInterface.stdout);
  const noInterfaceItem = await readJson(path.join(target, ".ai-org/work-items/WI-0002.json"));
  assert.equal(noInterfaceItem.ui_delivery_mode, "not-applicable");
  assert.deepEqual(noInterfaceItem.ui_refs, []);

  const codeFirst = run([
    "work-item",
    "create",
    target,
    "--title",
    "Prototype an inexpensive interface",
    "--ui-mode",
    "code-first"
  ]);
  assert.equal(codeFirst.status, 0, codeFirst.stderr || codeFirst.stdout);
  const codeFirstItem = await readJson(path.join(target, ".ai-org/work-items/WI-0003.json"));
  assert.equal(codeFirstItem.ui_delivery_mode, "code-first");
  assert.deepEqual(codeFirstItem.ui_refs, []);
});

test("upgrade migrates legacy identity and safely removes obsolete managed skills", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  assert.equal(run(["work-item", "create", target, "--title", "Preserve me"]).status, 0);

  const installedTemple = path.join(target, "TEMPLE.md");
  const oldContent = "# Simulated alpha.3 managed contract\n";
  await fs.writeFile(installedTemple, oldContent);
  const obsoleteSkills = [
    ".agents/skills/temple-grill/SKILL.md",
    ".agents/skills/temple-grill-with-docs/SKILL.md",
    ".agents/skills/evidence-backed-decision-interview/SKILL.md"
  ];
  for (const relativePath of obsoleteSkills) {
    const absolutePath = path.join(target, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, `legacy managed skill: ${relativePath}\n`);
  }
  const lockPath = path.join(target, "temple.lock");
  const lock = await readJson(lockPath);
  lock.template.name = "@zsz1210/ai-development-org-template";
  lock.template.version = "0.1.0-alpha.3";
  lock.template.repository = "zsz1210/ai-development-org-template";
  lock.managed_files.find((entry) => entry.path === "TEMPLE.md").sha256 = crypto.createHash("sha256").update(oldContent).digest("hex");
  for (const relativePath of obsoleteSkills) {
    const content = await fs.readFile(path.join(target, relativePath));
    lock.managed_files.push({ path: relativePath, sha256: crypto.createHash("sha256").update(content).digest("hex") });
  }
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  const dryRun = run(["upgrade", target, "--dry-run"]);
  assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
  assert.ok(dryRun.stdout.includes(`- version: 0.1.0-alpha.3 -> ${TEMPLATE_VERSION}\n`));
  assert.match(dryRun.stdout, /remove-managed: 3/);
  assert.equal(await fs.readFile(installedTemple, "utf8"), oldContent);
  await fs.access(path.join(target, obsoleteSkills[0]));

  const upgraded = run(["upgrade", target]);
  assert.equal(upgraded.status, 0, upgraded.stderr || upgraded.stdout);
  const upgradedLock = await fs.readFile(lockPath, "utf8");
  assert.equal(JSON.parse(upgradedLock).template.name, PACKAGE_NAME);
  assert.equal(JSON.parse(upgradedLock).template.version, TEMPLATE_VERSION);
  assert.equal(JSON.parse(upgradedLock).capabilities.group_parallel_planning, true);
  assert.equal(JSON.parse(upgradedLock).capabilities.parallel_plan_freshness, true);
  assert.ok(
    JSON.parse(upgradedLock).managed_files.some(
      (entry) => entry.path === ".ai-org/core/schemas/parallel-plan.schema.json"
    )
  );
  assert.match(await fs.readFile(installedTemple, "utf8"), /Project AI development organization operating contract/);
  assert.equal((await readJson(path.join(target, ".ai-org/work-items/WI-0001.json"))).title, "Preserve me");
  for (const relativePath of obsoleteSkills) {
    await assert.rejects(() => fs.access(path.join(target, relativePath)));
  }
  await fs.access(path.join(target, ".agents/skills/domain-modeling/SKILL.md"));

  const repeated = run(["upgrade", target]);
  assert.equal(repeated.status, 0, repeated.stderr || repeated.stdout);
  assert.match(repeated.stdout, /skip-current-lock/);
  assert.equal(await fs.readFile(lockPath, "utf8"), upgradedLock);
});

test("upgrade stops before overwriting a changed managed file", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const managedPath = path.join(target, "TEMPLE.md");
  await fs.appendFile(managedPath, "project mutation\n");
  const before = await fs.readFile(managedPath, "utf8");

  const upgraded = run(["upgrade", target]);
  assert.equal(upgraded.status, 1);
  assert.match(upgraded.stdout, /managed file changed/);
  assert.equal(await fs.readFile(managedPath, "utf8"), before);
});

test("upgrade refuses to adopt an identical destination missing from managed_files", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const relativePath = ".agents/skills/domain-modeling/SKILL.md";
  const installedPath = path.join(target, relativePath);
  const installedContent = await fs.readFile(installedPath, "utf8");
  const lockPath = path.join(target, "temple.lock");
  const lock = await readJson(lockPath);
  lock.managed_files = lock.managed_files.filter((entry) => entry.path !== relativePath);
  const editedLock = `${JSON.stringify(lock, null, 2)}\n`;
  await fs.writeFile(lockPath, editedLock);

  const upgraded = run(["upgrade", target]);
  assert.equal(upgraded.status, 1);
  assert.match(upgraded.stdout, /untracked file blocks new managed path/);
  assert.equal(await fs.readFile(installedPath, "utf8"), installedContent);
  assert.equal(await fs.readFile(lockPath, "utf8"), editedLock);
});

test("upgrade rolls back earlier updates when a later managed file changes", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const lockPath = path.join(target, "temple.lock");
  const lock = await readJson(lockPath);
  lock.template.version = "0.1.0-alpha.8";
  const candidatePaths = [".agents/skills/domain-modeling/SKILL.md", "TEMPLE.md"];
  const oldContents = new Map();
  for (const relativePath of candidatePaths) {
    const content = `old managed content for ${relativePath}\n`;
    oldContents.set(relativePath, content);
    await fs.writeFile(path.join(target, relativePath), content);
    lock.managed_files.find((entry) => entry.path === relativePath).sha256 = crypto
      .createHash("sha256")
      .update(content)
      .digest("hex");
  }
  const lockBefore = `${JSON.stringify(lock, null, 2)}\n`;
  await fs.writeFile(lockPath, lockBefore);
  const plan = await planUpgrade(target);
  const updates = plan.actions.filter((action) => action.type === "update-managed");
  assert.equal(updates.length, 2);
  const first = updates[0].path;
  const second = updates[1].path;
  await fs.writeFile(path.join(target, second), "late external managed edit\n");

  await assert.rejects(() => executeUpgrade(plan), /changed before update/);
  assert.equal(await fs.readFile(path.join(target, first), "utf8"), oldContents.get(first));
  assert.equal(await fs.readFile(path.join(target, second), "utf8"), "late external managed edit\n");
  assert.equal(await fs.readFile(lockPath, "utf8"), lockBefore);
});

test("upgrade rollback removes newly seeded specification and tracker state after a later migration race", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const specIndexPath = path.join(target, ".ai-org/project/spec-index.json");
  const trackerConfigPath = path.join(target, ".ai-org/project/tracker.json");
  await fs.rm(specIndexPath);
  await fs.rm(trackerConfigPath);
  const assignmentsPath = path.join(target, ".ai-org/project/assignments.json");
  const assignments = await readJson(assignmentsPath);
  assignments.assignments = assignments.assignments.filter((entry) => entry.position_id !== "ui_designer");
  await fs.writeFile(assignmentsPath, `${JSON.stringify(assignments, null, 2)}\n`);
  const lockPath = path.join(target, "temple.lock");
  const lock = await readJson(lockPath);
  lock.template.version = "0.1.0-alpha.13";
  delete lock.capabilities.product_specifications;
  const lockBefore = `${JSON.stringify(lock, null, 2)}\n`;
  await fs.writeFile(lockPath, lockBefore);
  const plan = await planUpgrade(target);
  assert.ok(plan.assignmentMigration);
  assert.ok(plan.actions.some((action) => action.type === "create-spec-index"));
  assert.ok(plan.actions.some((action) => action.type === "create-tracker-config"));
  const racedAssignments = `${await fs.readFile(assignmentsPath, "utf8")}\n`;
  await fs.writeFile(assignmentsPath, racedAssignments);

  await assert.rejects(() => executeUpgrade(plan), /assignments\.json changed after upgrade planning/);
  await assert.rejects(() => fs.access(specIndexPath));
  await assert.rejects(() => fs.access(trackerConfigPath));
  assert.equal(await fs.readFile(assignmentsPath, "utf8"), racedAssignments);
  assert.equal(await fs.readFile(lockPath, "utf8"), lockBefore);
});

test("upgrade rejects a managed path that escapes the project", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const outsidePath = path.join(temporaryRoot, "outside.txt");
  await fs.writeFile(outsidePath, "preserve me\n");

  const lockPath = path.join(target, "temple.lock");
  const lock = await readJson(lockPath);
  lock.managed_files.push({
    path: ".agents/skills/../../../outside.txt",
    sha256: crypto.createHash("sha256").update("preserve me\n").digest("hex")
  });
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  const upgraded = run(["upgrade", target]);
  assert.equal(upgraded.status, 1);
  assert.match(upgraded.stdout, /invalid managed path in temple\.lock/);
  assert.equal(await fs.readFile(outsidePath, "utf8"), "preserve me\n");
});

test("parallel canonical mutations are serialized without losing task records", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  assert.equal(run(["work-item", "create", target, "--title", "Concurrent registry"]).status, 0);

  const registrations = await Promise.all([
    runAsync([
      "task",
      "register",
      target,
      "--work-item",
      "WI-0001",
      "--position",
      "developer",
      "--thread-id",
      "parallel-developer"
    ]),
    runAsync([
      "task",
      "register",
      target,
      "--work-item",
      "WI-0001",
      "--position",
      "independent_qa",
      "--thread-id",
      "parallel-qa"
    ])
  ]);
  for (const registration of registrations) {
    assert.equal(registration.status, 0, registration.stderr || registration.stdout);
  }
  const registry = await readJson(path.join(target, ".ai-org/project/tasks.json"));
  assert.equal(registry.tasks.length, 2);
  assert.deepEqual(new Set(registry.tasks.map((task) => task.thread_id)), new Set(["parallel-developer", "parallel-qa"]));
});

test("collaborative profile supports principals, pooled membership, readiness, and explicit claims", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  assert.equal(spawnSync("git", ["-C", target, "init", "-q"], { encoding: "utf8" }).status, 0);

  const addPrincipal = run([
    "collaboration",
    "add-principal",
    target,
    "--principal-id",
    "principal-alice",
    "--name",
    "Alice Morgan"
  ]);
  assert.equal(addPrincipal.status, 0, addPrincipal.stderr || addPrincipal.stdout);
  assert.equal(
    run(["collaboration", "add-agent", target, "--agent-id", "agent-taylor", "--name", "Taylor Brooks"]).status,
    0
  );
  assert.equal(
    run([
      "collaboration",
      "sponsor",
      target,
      "--principal-id",
      "principal-alice",
      "--agent-id",
      "agent-taylor"
    ]).status,
    0
  );
  assert.equal(
    run([
      "collaboration",
      "add-membership",
      target,
      "--agent-id",
      "agent-taylor",
      "--position",
      "developer",
      "--discipline",
      "backend"
    ]).status,
    0
  );
  const provisional = await readJson(path.join(target, ".ai-org/project/collaboration.json"));
  assert.equal(
    provisional.memberships.find((entry) => entry.agent_id === "agent-taylor" && entry.position_id === "developer").status,
    "provisional"
  );
  const qualified = run([
    "collaboration",
    "qualify-membership",
    target,
    "--agent-id",
    "agent-taylor",
    "--position",
    "developer",
    "--status",
    "active",
    "--evidence",
    "docs/taylor-backend-qualification.md",
    "--risk-tier",
    "standard"
  ]);
  assert.equal(qualified.status, 0, qualified.stderr || qualified.stdout);
  assert.equal(run(["collaboration", "add-principal", target, "--principal-id", "principal-owner", "--name", "Project owner"]).status, 0);
  for (const agent of ["agent-fixture-rowan", "agent-fixture-linden", "agent-fixture-ellis"]) {
    const sponsored = run(["collaboration", "sponsor", target, "--principal-id", "principal-owner", "--agent-id", agent]);
    assert.equal(sponsored.status, 0, sponsored.stderr || sponsored.stdout);
  }
  assert.equal(run(["collaboration", "set-profile", target, "--profile", "collaborative"]).status, 0);

  const created = run([
    "work-item",
    "create",
    target,
    "--title",
    "Coordinate a bounded company change",
    "--principal-id",
    "principal-owner",
    "--scope",
    "One repository-owned module",
    "--acceptance",
    "Independent evidence identifies the exact revision",
    "--affected-path",
    "src/company",
    "--base-revision",
    "abc123",
    "--integration-owner",
    "agent-taylor",
    "--ui-mode",
    "not-applicable"
  ]);
  assert.equal(created.status, 0, created.stderr || created.stdout);
  const workItemId = /Created (WI-[0-9]{8}-[A-F0-9]{10}):/.exec(created.stdout)?.[1];
  assert.ok(workItemId, created.stdout);

  const transitions = [
    ["spec", ["work_order=docs/work-order.md"]],
    ["design", ["approved_scope=docs/spec.md", "acceptance_criteria=docs/spec.md"]],
    ["build", ["technical_design=docs/design.md", "risk_review=docs/design.md"]]
  ];
  for (const [state, requirements] of transitions) {
    const args = ["transition", target, "--work-item", workItemId, "--to", state, "--principal-id", "principal-owner"];
    for (const requirement of requirements) args.push("--satisfy", requirement);
    const transitioned = run(args);
    assert.equal(transitioned.status, 0, transitioned.stderr || transitioned.stdout);
  }

  // The existing project owners perform planning; Alice is qualified only for
  // Developer and takes over at Build without impersonating those owners.
  const bound = run(["collaboration", "bind-identity", target, "--principal-id", "principal-alice",
    "--verification-class", "external-evidence", "--provider-id", "fixture",
    "--provider-subject", "alice-immutable-subject", "--evidence-ref", "fixture:verified-principal-alice"]);
  assert.equal(bound.status, 0, bound.stderr || bound.stdout);
  const configured = run([
    "work-item",
    "configure",
    target,
    "--work-item",
    workItemId,
    "--agent-id",
    "agent-taylor",
    "--discipline",
    "backend",
    "--parallel-mode",
    "parallel"
  ]);
  assert.equal(configured.status, 0, configured.stderr || configured.stdout);
  assert.match(configured.stdout, /Parallel ready: yes/);

  const claimed = run([
    "work-item",
    "claim",
    target,
    "--work-item",
    workItemId,
    "--agent-id",
    "agent-taylor",
    "--principal-id",
    "principal-alice",
    "--base-revision",
    "abc123",
    "--branch",
    "alice/company-change",
    "--worktree",
    "/tmp/company-change"
  ]);
  assert.equal(claimed.status, 0, claimed.stderr || claimed.stdout);
  assert.match(claimed.stdout, /Principal: principal-alice/);

  const activePlan = run(["parallel", "plan", target, "--no-write", "--json"]);
  assert.equal(activePlan.status, 0, activePlan.stderr || activePlan.stdout);
  assert.deepEqual(JSON.parse(activePlan.stdout).active.map((entry) => entry.work_item_id), [workItemId]);
  assert.equal(JSON.parse(activePlan.stdout).summary.dispatchable, 0);

  const readiness = run(["parallel", "check", target, "--work-item", workItemId, "--agent-id", "agent-taylor", "--json"]);
  assert.equal(readiness.status, 0, readiness.stderr || readiness.stdout);
  assert.equal(JSON.parse(readiness.stdout).ready, true);

  const task = run([
    "task",
    "register",
    target,
    "--work-item",
    workItemId,
    "--position",
    "developer",
    "--thread-id",
    "thread-collaborative-taylor"
  ]);
  assert.equal(task.status, 0, task.stderr || task.stdout);
  assert.match(task.stdout, /Taylor Brooks/);
  const taskRegistry = await readJson(path.join(target, ".ai-org/project/tasks.json"));
  assert.equal(taskRegistry.tasks[0].principal_id, "principal-alice");
  assert.equal(taskRegistry.tasks[0].branch, "alice/company-change");

  const activeStatus = JSON.parse(run(["status", target, "--json", "--no-write"]).stdout);
  assert.equal(activeStatus.collaboration.profile, "collaborative");
  assert.equal(activeStatus.collaboration.active_claims, 1);
  assert.equal(activeStatus.collaboration.validation.real_collaborative.status, "not_run");
  const collaborationState = await readJson(path.join(target, ".ai-org/project/collaboration.json"));
  assert.equal(
    collaborationState.validation.real_collaborative.plan,
    ".ai-org/templates/collaborative-large-scale-test-plan.md"
  );
  await fs.access(path.join(target, collaborationState.validation.real_collaborative.plan));

  const released = run([
    "work-item",
    "release",
    target,
    "--work-item",
    workItemId,
    "--agent-id",
    "agent-taylor",
    "--principal-id",
    "principal-alice",
    "--reason",
    "handoff"
  ]);
  assert.equal(released.status, 0, released.stderr || released.stdout);
  assert.equal(JSON.parse(run(["status", target, "--json", "--no-write"]).stdout).collaboration.active_claims, 0);

  const doctor = run(["doctor", target, "--json"]);
  assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
  const doctorDocument = JSON.parse(doctor.stdout);
  assert.equal(doctorDocument.summary.fail, 0);
  assert.ok(doctorDocument.checks.some((check) => check.id === "collaboration_validation" && check.status === "warn"));
});

test("upgrade preserves collaboration v1 bytes until explicit migration", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const collaborationPath = path.join(target, ".ai-org/project/collaboration.json");
  const current = await readJson(collaborationPath);
  const legacy = {
    schema_version: "temple.collaboration/v1",
    profile: current.profile,
    coordination_backend: current.coordination_backend,
    principals: [],
    sponsorships: [],
    memberships: current.memberships.map((entry) => ({
      position_id: entry.position_id,
      agent_id: entry.agent_id,
      disciplines: entry.disciplines,
      default: entry.default,
      active: entry.active
    })),
    large_scale_validation: {
      status: "not_run",
      plan: ".ai-org/templates/collaborative-large-scale-test-plan.md"
    }
  };
  const legacyBytes = `${JSON.stringify(legacy, null, 2)}\n`;
  await fs.writeFile(collaborationPath, legacyBytes);
  const upgraded = run(["upgrade", target]);
  assert.equal(upgraded.status, 0, upgraded.stderr || upgraded.stdout);
  assert.equal(await fs.readFile(collaborationPath, "utf8"), legacyBytes);

  const preview = run(["collaboration", "migrate", target, "--dry-run", "--json"]);
  assert.equal(preview.status, 0, preview.stderr || preview.stdout);
  assert.equal(JSON.parse(preview.stdout).changed, true);
  assert.equal(await fs.readFile(collaborationPath, "utf8"), legacyBytes);
  const migrated = run(["collaboration", "migrate", target, "--json"]);
  assert.equal(migrated.status, 0, migrated.stderr || migrated.stdout);
  assert.equal((await readJson(collaborationPath)).schema_version, "temple.collaboration/v2");
});

test("parallel readiness detects unresolved affected-path overlap", async (context) => {
  const { temporaryRoot, target } = await fixture();
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  for (const title of ["First overlapping change", "Second overlapping change"]) {
    const created = run([
      "work-item",
      "create",
      target,
      "--title",
      title,
      "--scope",
      "One shared module",
      "--acceptance",
      "The module passes tests",
      "--affected-path",
      "src/shared",
      "--base-revision",
      "abc123",
      "--integration-owner",
      "agent-fixture-rowan"
    ]);
    assert.equal(created.status, 0, created.stderr || created.stdout);
  }
  assert.equal(
    run(["work-item", "configure", target, "--work-item", "WI-0001", "--depends-on", "WI-0002"]).status,
    0
  );
  const cycle = run([
    "work-item",
    "configure",
    target,
    "--work-item",
    "WI-0002",
    "--depends-on",
    "WI-0001"
  ]);
  assert.equal(cycle.status, 1);
  assert.match(cycle.stderr, /Dependency cycle detected/);
  const readiness = run(["parallel", "check", target, "--work-item", "WI-0002", "--json"]);
  assert.equal(readiness.status, 2, readiness.stderr || readiness.stdout);
  const result = JSON.parse(readiness.stdout);
  assert.equal(result.ready, false);
  assert.equal(result.recommended_mode, "sequential");
  assert.deepEqual(result.overlaps.map((entry) => entry.work_item_id), ["WI-0001"]);
});
