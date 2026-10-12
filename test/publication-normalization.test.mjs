import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { formatJson } from "../src/files.mjs";
import { executeInit, planInit } from "../src/install.mjs";
import { validateInitConfig } from "../src/model.mjs";
import {
  applyPublicationNormalization,
  buildPublicationNormalizationPlan
} from "../src/publication-normalization.mjs";
import { claimWorkItem, createWorkItem } from "../src/work-items.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repositoryRoot, "bin/temple.mjs");
const revision = "a".repeat(40);
const digest = "b".repeat(64);
const timestamp = "2026-09-04T00:00:00.000Z";
const fixtureHome = ["", "Users", "maintainer"].join("/");
const fixtureOtherHome = ["", "home", "other"].join("/");
const fixtureWindowsHome = ["C:", "Users", "maintainer"].join("\\");
const fixturePrivateIp = ["192", "168", "7", "9"].join(".");
const fixtureTailnetHost = ["mac", "tailnet", "ts", "net"].join(".");

function configDocument(projectId) {
  return {
    schema_version: "temple.init/v1",
    project: { id: projectId, name: "Publication Normalization Fixture" },
    naming_mode: "manual",
    agents: [
      { display_name: "Rowan", positions: ["engineering_manager", "release_manager", "observer"] },
      { display_name: "Linden", positions: ["product_manager", "ux_designer", "ui_designer"] },
      { display_name: "Ellis", positions: ["tech_lead"] },
      { display_name: "Devon", positions: ["developer"] },
      { display_name: "Hollis", positions: ["quality_evaluator", "independent_qa"] }
    ]
  };
}

async function writeJson(target, relativePath, document) {
  await fs.writeFile(path.join(target, relativePath), formatJson(document));
}

async function fixture(context, projectId = "publication-normalization") {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-publication-normalization-"));
  const target = path.join(temporaryRoot, "project");
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  await executeInit(await planInit(target, await validateInitConfig(configDocument(projectId))));
  const created = await createWorkItem(target, {
    title: "Govern publication normalization",
    scope: ["Normalize terminal canonical paths"],
    acceptance: ["Preserve active execution state"],
    affectedPaths: [".ai-org/work-items", ".ai-org/project"],
    specificationMode: "gate-evidence",
    uiDeliveryMode: "not-applicable",
    workflowProfile: "standard",
    riskTier: "standard",
    scopeClass: "ordinary",
    escalationTriggers: ["schema-or-data-migration"]
  });
  const claimed = await claimWorkItem(target, {
    workItemId: created.item.id,
    agentId: created.item.assigned_agent_id,
    principalId: "human",
    baseRevision: revision,
    branch: "codex/publication-normalization"
  });

  const workItemPath = `.ai-org/work-items/${created.item.id}.json`;
  const workItem = JSON.parse(await fs.readFile(path.join(target, workItemPath), "utf8"));
  workItem.scope.push(`Inspect ${fixtureHome}/legacy-project without changing it`);
  workItem.claims.unshift({
    id: "claim-released-fixture",
    status: "released",
    principal_id: "human",
    agent_id: workItem.assigned_agent_id,
    base_revision: revision,
    branch: "codex/released",
    worktree: `${fixtureHome}/.codex/worktrees/released/project`,
    claimed_at: timestamp,
    released_at: timestamp,
    release_reason: "completed"
  });
  await writeJson(target, workItemPath, workItem);

  const workers = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/runtime-workers.json"), "utf8"));
  workers.workers.push({
    id: "worker-fixture",
    runtime_kind: "internal-subagent",
    status: "completed",
    work_item_id: created.item.id,
    position_id: "developer",
    agent_id: workItem.assigned_agent_id,
    principal_id: "human",
    claim_id: "claim-released-fixture",
    base_revision: revision,
    branch: "codex/released",
    worktree: "/tmp/temple-fixture/worker",
    plan_fingerprint: digest,
    plan_digest: digest,
    preparation_fingerprint: digest,
    wave_id: "wave-001",
    runtime_id: "/root/fixture",
    task_id: null,
    resource_reservation_ids: [],
    current_revision: revision,
    evidence: [],
    reserved_at: timestamp,
    attached_at: timestamp,
    completed_at: timestamp,
    updated_at: timestamp
  });
  await writeJson(target, ".ai-org/project/runtime-workers.json", workers);

  const tasks = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/tasks.json"), "utf8"));
  tasks.tasks.push({
    id: "task-0001",
    work_item_id: created.item.id,
    position_id: "developer",
    agent_id: workItem.assigned_agent_id,
    suggested_title: "Fixture task",
    status: "completed",
    worktree: `${fixtureWindowsHome}\\project`
  });
  await writeJson(target, ".ai-org/project/tasks.json", tasks);

  const evidence = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/evidence.json"), "utf8"));
  evidence.entries.push({
    id: "EVID-20260904T000000Z-ABCDEF12",
    work_item_id: created.item.id,
    recorded_at: timestamp,
    recorded_by: workItem.assigned_agent_id,
    expires_at: null,
    invalidated_at: null,
    invalidated_by: null,
    invalidation_reason: null,
    external_action_performed: false,
    kind: "runtime",
    title: "Local fixture",
    outcome: "pass",
    scope_revision: revision,
    observed_at: timestamp,
    summary: "Fixture evidence",
    adapter: { id: "fixture", version: "1" },
    artifacts: [{ path: `${fixtureHome}/evidence/result.json`, sha256: digest }],
    details: {
      environment: `Run from ${fixtureHome}/project through ${fixturePrivateIp} and ${fixtureTailnetHost}`,
      command: [`inspect ${fixtureOtherHome}/project`],
      cidr: "Allow 10.0.0.0/8"
    }
  });
  await writeJson(target, ".ai-org/project/evidence.json", evidence);

  return {
    target,
    workItemId: created.item.id,
    actor: claimed.item.claim.agent_id,
    paths: { workItem: workItemPath }
  };
}

test("normalization plan is deterministic and never retains matched values", async (context) => {
  const state = await fixture(context, "normalization-plan");
  const first = await buildPublicationNormalizationPlan(state.target);
  const second = await buildPublicationNormalizationPlan(state.target);

  assert.deepEqual(second, first);
  assert.equal(first.status, "changes-pending");
  assert.equal(first.summary.changed_files, 4);
  assert.deepEqual(first.summary.changes, {
    "maintainer-home-path-posix": 3,
    "private-ipv4": 1,
    "private-tailnet-hostname": 1,
    "released-claim-worktree": 1,
    "terminal-task-worktree": 1,
    "terminal-worker-worktree": 1
  });
  const serialized = JSON.stringify(first);
  for (const prohibited of [fixtureHome, fixturePrivateIp, fixtureTailnetHost, "/tmp/temple-fixture"]) {
    assert.equal(serialized.includes(prohibited), false);
  }
});

test("normalization apply is confirmed, stale-safe, authorized, schema-valid, and idempotent", async (context) => {
  const state = await fixture(context, "normalization-apply");
  const initial = await buildPublicationNormalizationPlan(state.target);
  await assert.rejects(
    () => applyPublicationNormalization(state.target, { workItemId: state.workItemId, expectedPlan: initial.plan_digest, actor: state.actor }),
    /explicit normalization confirmation/
  );
  await assert.rejects(
    () => applyPublicationNormalization(state.target, { workItemId: state.workItemId, expectedPlan: initial.plan_digest, actor: "unrelated-agent", confirmNormalization: true }),
    /not authorized/
  );

  const taskPath = path.join(state.target, ".ai-org/project/tasks.json");
  const originalTasks = await fs.readFile(taskPath, "utf8");
  const tasks = JSON.parse(originalTasks);
  tasks.tasks[0].notes = "unrelated drift";
  await fs.writeFile(taskPath, formatJson(tasks));
  await assert.rejects(
    () => applyPublicationNormalization(state.target, { workItemId: state.workItemId, expectedPlan: initial.plan_digest, actor: state.actor, confirmNormalization: true }),
    /plan is stale/
  );
  await fs.writeFile(taskPath, originalTasks);

  const evidenceBefore = JSON.parse(await fs.readFile(path.join(state.target, ".ai-org/project/evidence.json"), "utf8"));
  const result = await applyPublicationNormalization(state.target, {
    workItemId: state.workItemId,
    expectedPlan: initial.plan_digest,
    actor: state.actor,
    confirmNormalization: true
  });
  assert.equal(result.applied, true);
  assert.equal(result.event_recorded, true);

  const workItem = JSON.parse(await fs.readFile(path.join(state.target, state.paths.workItem), "utf8"));
  assert.equal(workItem.claim.status, "active");
  assert.equal(workItem.claim.worktree, null);
  assert.match(workItem.scope.at(-1), /<LOCAL_HOME>\/legacy-project/);
  assert.equal(workItem.claims.find((entry) => entry.id === "claim-released-fixture").worktree, null);
  const workers = JSON.parse(await fs.readFile(path.join(state.target, ".ai-org/project/runtime-workers.json"), "utf8"));
  assert.equal(workers.workers[0].worktree, null);
  const normalizedTasks = JSON.parse(await fs.readFile(taskPath, "utf8"));
  assert.equal(normalizedTasks.tasks[0].worktree, null);

  const evidenceAfter = JSON.parse(await fs.readFile(path.join(state.target, ".ai-org/project/evidence.json"), "utf8"));
  assert.equal(evidenceAfter.entries[0].id, evidenceBefore.entries[0].id);
  assert.deepEqual(evidenceAfter.entries[0].artifacts, evidenceBefore.entries[0].artifacts);
  assert.equal(evidenceAfter.entries[0].scope_revision, evidenceBefore.entries[0].scope_revision);
  assert.match(evidenceAfter.entries[0].details.environment, /<LOCAL_HOME>\/project/);
  assert.match(evidenceAfter.entries[0].details.environment, /<PRIVATE_IPV4>/);
  assert.match(evidenceAfter.entries[0].details.environment, /<PRIVATE_TAILNET_HOST>/);
  assert.equal(evidenceAfter.entries[0].details.cidr, "Allow 10.0.0.0/8");

  const after = await buildPublicationNormalizationPlan(state.target);
  assert.equal(after.status, "no-changes");
  assert.equal(after.summary.change_count, 0);
  const noOp = await applyPublicationNormalization(state.target, {
    workItemId: state.workItemId,
    expectedPlan: after.plan_digest,
    actor: state.actor,
    confirmNormalization: true
  });
  assert.equal(noOp.applied, false);
  assert.equal(noOp.event_recorded, false);
});

test("normalization refuses active coordinates and rolls back a failed write", async (context) => {
  const state = await fixture(context, "normalization-safety");
  const taskPath = path.join(state.target, ".ai-org/project/tasks.json");
  const tasks = JSON.parse(await fs.readFile(taskPath, "utf8"));
  tasks.tasks.push({
    id: "task-0002",
    work_item_id: state.workItemId,
    position_id: "developer",
    agent_id: state.actor,
    suggested_title: "Active fixture task",
    status: "active",
    worktree: `${fixtureHome}/active`
  });
  await fs.writeFile(taskPath, formatJson(tasks));
  const blocked = await buildPublicationNormalizationPlan(state.target);
  assert.equal(blocked.status, "blocked-active-coordinates");
  await assert.rejects(
    () => applyPublicationNormalization(state.target, { workItemId: state.workItemId, expectedPlan: blocked.plan_digest, actor: state.actor, confirmNormalization: true }),
    /active execution coordinates/
  );

  tasks.tasks.pop();
  await fs.writeFile(taskPath, formatJson(tasks));
  const plan = await buildPublicationNormalizationPlan(state.target);
  const before = new Map();
  for (const entry of plan.files) before.set(entry.path, await fs.readFile(path.join(state.target, entry.path), "utf8"));
  await assert.rejects(
    () => applyPublicationNormalization(state.target, {
      workItemId: state.workItemId,
      expectedPlan: plan.plan_digest,
      actor: state.actor,
      confirmNormalization: true,
      simulateFailureAfterWrites: 2
    }),
    /Simulated publication normalization failure/
  );
  for (const [relativePath, content] of before) {
    assert.equal(await fs.readFile(path.join(state.target, relativePath), "utf8"), content);
  }
});

test("publication normalization CLI previews without mutation", async (context) => {
  const state = await fixture(context, "normalization-cli");
  const before = await fs.readFile(path.join(state.target, state.paths.workItem), "utf8");
  const result = spawnSync(process.execPath, [cli, "publication", "normalize-plan", state.target, "--json"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.authority.canonical_state_changed, false);
  assert.equal(await fs.readFile(path.join(state.target, state.paths.workItem), "utf8"), before);

  const applied = spawnSync(process.execPath, [
    cli,
    "publication",
    "normalize-apply",
    state.target,
    "--work-item",
    state.workItemId,
    "--expected-plan",
    plan.plan_digest,
    "--confirm-normalization",
    "--actor",
    state.actor,
    "--json"
  ], { encoding: "utf8" });
  assert.equal(applied.status, 0, applied.stderr || applied.stdout);
  assert.equal(JSON.parse(applied.stdout).applied, true);

  const unknown = spawnSync(process.execPath, [cli, "publication", "normalize-unknown", state.target], { encoding: "utf8" });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unknown publication action/);
});
