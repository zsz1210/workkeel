import assert from "node:assert/strict";
import { TEMPLATE_VERSION } from "../src/constants.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeDashboardAttention } from "../src/control-plane-dashboard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin/temple.mjs");

test("Dashboard Now preserves read-only Skill Proposal evidence and authority attention", () => {
  const proposalAttention = {
    type: "skill_proposal_pending",
    learning_id: "PRACTICE-0001",
    proposal_id: "SKILL-PROPOSAL-0001",
    evidence_refs: [".ai-org/learning/practices/PRACTICE-0001.md"],
    authority: "Guidance only; no lifecycle or external-write authority.",
    message: "SKILL-PROPOSAL-0001 awaits a Human Principal decision. Authority: Guidance only; no lifecycle or external-write authority.",
    suggested_action: "Approve, reject, or defer through the local CLI",
    jump_view: "system"
  };
  const attention = normalizeDashboardAttention({ observerAttention: [proposalAttention] });
  assert.deepEqual(attention, [{ ...proposalAttention, source: "work" }]);
  assert.doesNotMatch(JSON.stringify(attention), /endpoint|mutation|remote write/i);
});

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

function git(target, args) {
  return spawnSync("git", ["-C", target, ...args], { encoding: "utf8" });
}

async function writeJson(target, relativePath, value) {
  const absolute = path.join(target, relativePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`);
}

async function fixture(context) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-evidence-test-"));
  const target = path.join(temporaryRoot, "evidence-product");
  const configPath = path.join(temporaryRoot, "init.json");
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  await writeJson(temporaryRoot, "init.json", {
    schema_version: "temple.init/v1",
    project: { id: "evidence-product", name: "Evidence Product" },
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
  return { target, temporaryRoot };
}

function createWorkItem(target, title = "Evidence work") {
  const created = run([
    "work-item", "create", target,
    "--title", title,
    "--scope", "Capture trustworthy evidence",
    "--acceptance", "Observer reports evidence state",
    "--affected-path", "src/evidence",
    "--base-revision", "HEAD",
    "--integration-owner", "agent-fixture-rowan",
    "--ui-mode", "not-applicable"
  ]);
  assert.equal(created.status, 0, created.stderr || created.stdout);
  const id = /Created (WI-[A-Z0-9-]+):/.exec(created.stdout)?.[1];
  assert.ok(id, created.stdout);
  return id;
}

test("init owns an empty evidence registry and exact Git evidence resolves to a commit", async (context) => {
  const { target } = await fixture(context);
  const workItemId = createWorkItem(target);
  const lock = JSON.parse(await fs.readFile(path.join(target, "temple.lock"), "utf8"));
  assert.equal(lock.capabilities.normalized_evidence_registry, true);
  assert.equal(lock.capabilities.observer_projection, true);
  assert.ok(!lock.managed_files.some((entry) => entry.path === ".ai-org/project/evidence.json"));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/evidence.json"), "utf8")), {
    schema_version: "temple.evidence/v1",
    entries: []
  });

  const recorded = run([
    "evidence", "git", target,
    "--work-item", workItemId,
    "--revision", "HEAD",
    "--title", "Candidate revision",
    "--actor", "agent-fixture-devon"
  ]);
  assert.equal(recorded.status, 0, recorded.stderr || recorded.stdout);
  const registry = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/evidence.json"), "utf8"));
  assert.equal(registry.entries.length, 1);
  assert.equal(registry.entries[0].kind, "git-revision");
  assert.match(registry.entries[0].scope_revision, /^[0-9a-f]{40}$/);
  assert.equal(registry.entries[0].adapter.id, "git-local");
  assert.equal(registry.entries[0].external_action_performed, false);
  assert.equal(registry.entries[0].details.working_tree_dirty, true);
  assert.equal(registry.entries[0].details.dirty_scope, "outside-affected-scope");
  assert.deepEqual(registry.entries[0].details.affected_paths_dirty, []);

  await fs.mkdir(path.join(target, "src/evidence"), { recursive: true });
  await fs.writeFile(path.join(target, "src/evidence/candidate.mjs"), "export const candidate = true;\n");

  const rejected = run(["evidence", "git", target, "--work-item", workItemId, "--revision", "HEAD"]);
  assert.equal(rejected.status, 1, rejected.stdout);
  assert.match(rejected.stderr, /declared affected paths are uncommitted.*src\/evidence\/candidate\.mjs/);

  assert.equal(git(target, ["add", "src/evidence/candidate.mjs"]).status, 0);
  assert.equal(git(target, ["commit", "-qm", "commit exact candidate"]).status, 0);
  const accepted = run(["evidence", "git", target, "--work-item", workItemId, "--revision", "HEAD"]);
  assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
  const updatedRegistry = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/evidence.json"), "utf8"));
  assert.equal(updatedRegistry.entries.at(-1).details.dirty_scope, "outside-affected-scope");
  assert.deepEqual(updatedRegistry.entries.at(-1).details.affected_paths_dirty, []);
});

test("Doctor requires non-ancestral evidence revisions to use deterministic preservation tags", async (context) => {
  const { target, temporaryRoot } = await fixture(context);
  const workItemId = createWorkItem(target);
  const tree = git(target, ["rev-parse", "HEAD^{tree}"]).stdout.trim();
  const candidate = git(target, ["commit-tree", tree, "-p", "HEAD", "-m", "detached evidence candidate"]).stdout.trim();
  assert.match(candidate, /^[0-9a-f]{40}$/);

  const unrecorded = run(["evidence", "preserve", target, "--work-item", workItemId, "--revision", candidate]);
  assert.equal(unrecorded.status, 1, unrecorded.stdout);
  assert.match(unrecorded.stderr, /has no recorded evidence bound/);

  const recorded = run(["evidence", "git", target, "--work-item", workItemId, "--revision", candidate]);
  assert.equal(recorded.status, 0, recorded.stderr || recorded.stdout);
  const unpreservedDoctor = run(["doctor", target, "--json"]);
  assert.equal(unpreservedDoctor.status, 1, unpreservedDoctor.stderr || unpreservedDoctor.stdout);
  assert.match(
    JSON.parse(unpreservedDoctor.stdout).checks.find((entry) => entry.id === "evidence_registry").message,
    new RegExp(`not durable.*refs/tags/temple/evidence/${candidate}`)
  );

  const preserved = run(["evidence", "preserve", target, "--work-item", workItemId, "--revision", candidate]);
  assert.equal(preserved.status, 0, preserved.stderr || preserved.stdout);
  assert.match(preserved.stdout, /Created local evidence tag/);
  assert.match(preserved.stdout, /External action: not performed/);
  assert.equal(git(target, ["rev-parse", `refs/tags/temple/evidence/${candidate}^{commit}`]).stdout.trim(), candidate);

  const repeated = run(["evidence", "preserve", target, "--work-item", workItemId, "--revision", candidate]);
  assert.equal(repeated.status, 0, repeated.stderr || repeated.stdout);
  assert.match(repeated.stdout, /Retained local evidence tag/);
  const preservedDoctor = run(["doctor", target, "--json"]);
  assert.equal(preservedDoctor.status, 0, preservedDoctor.stderr || preservedDoctor.stdout);

  assert.equal(git(target, ["add", "."]).status, 0);
  assert.equal(git(target, ["commit", "-qm", "record preserved evidence"]).status, 0);
  const freshClone = path.join(temporaryRoot, "fresh-clone");
  const cloned = spawnSync("git", ["clone", "--no-local", "-q", target, freshClone], { encoding: "utf8" });
  assert.equal(cloned.status, 0, cloned.stderr || cloned.stdout);
  assert.equal(git(freshClone, ["rev-parse", candidate]).stdout.trim(), candidate);
  const freshDoctor = run(["doctor", freshClone, "--json"]);
  assert.equal(freshDoctor.status, 0, freshDoctor.stderr || freshDoctor.stdout);

  const conflictTree = git(target, ["rev-parse", "HEAD^{tree}"]).stdout.trim();
  const conflictingCandidate = git(
    target,
    ["commit-tree", conflictTree, "-p", "HEAD", "-m", "conflicting evidence candidate"]
  ).stdout.trim();
  const conflictRecorded = run([
    "evidence", "git", target, "--work-item", workItemId, "--revision", conflictingCandidate
  ]);
  assert.equal(conflictRecorded.status, 0, conflictRecorded.stderr || conflictRecorded.stdout);
  assert.equal(git(target, ["tag", `temple/evidence/${conflictingCandidate}`, "HEAD"]).status, 0);
  const conflict = run([
    "evidence", "preserve", target, "--work-item", workItemId, "--revision", conflictingCandidate
  ]);
  assert.equal(conflict.status, 1, conflict.stdout);
  assert.match(conflict.stderr, /targets .* not/);
});

test("upgrade seeds a missing evidence registry without adopting project evidence", async (context) => {
  const { target } = await fixture(context);
  const registryPath = path.join(target, ".ai-org/project/evidence.json");
  const lockPath = path.join(target, "temple.lock");
  const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  lock.template.version = "0.1.0-alpha.17";
  for (const capability of ["normalized_evidence_registry", "local_evidence_adapters", "observer_projection", "read_only_overview"]) {
    delete lock.capabilities[capability];
  }
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  await fs.rm(registryPath);
  const upgraded = run(["upgrade", target]);
  assert.equal(upgraded.status, 0, upgraded.stderr || upgraded.stdout);
  assert.deepEqual(JSON.parse(await fs.readFile(registryPath, "utf8")), {
    schema_version: "temple.evidence/v1",
    entries: []
  });
  const upgradedLock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  assert.equal(upgradedLock.template.version, TEMPLATE_VERSION);
  assert.ok(!upgradedLock.managed_files.some((entry) => entry.path === ".ai-org/project/evidence.json"));

  const custom = { schema_version: "temple.evidence/v1", entries: [] };
  await fs.writeFile(registryPath, `${JSON.stringify(custom, null, 4)}\n`);
  const before = await fs.readFile(registryPath, "utf8");
  const current = run(["upgrade", target]);
  assert.equal(current.status, 0, current.stderr || current.stdout);
  assert.equal(await fs.readFile(registryPath, "utf8"), before);
});

test("test and runtime observations are content-addressed and never auto-satisfy a gate", async (context) => {
  const { target } = await fixture(context);
  const workItemId = createWorkItem(target);
  const testPath = ".ai-org/artifacts/test-observation.json";
  const runtimePath = ".ai-org/artifacts/runtime-observation.json";
  const artifactPath = ".ai-org/artifacts/test-output.txt";
  await fs.mkdir(path.dirname(path.join(target, artifactPath)), { recursive: true });
  await fs.writeFile(path.join(target, artifactPath), "89 tests passed\n");
  await writeJson(target, testPath, {
    schema_version: "temple.test-observation/v1",
    revision: "HEAD",
    command: ["npm", "test"],
    result: "pass",
    exit_code: 0,
    started_at: "2026-08-30T00:00:00.000Z",
    completed_at: "2026-08-30T00:01:00.000Z",
    artifact_refs: [artifactPath]
  });
  await writeJson(target, runtimePath, {
    schema_version: "temple.runtime-observation/v1",
    revision: "HEAD",
    environment: "iOS Simulator",
    scenario: "Cold launch",
    result: "pass",
    provenance: "simulator",
    observed_at: "2026-08-30T00:02:00.000Z",
    artifact_refs: []
  });

  for (const [kind, observation] of [["test", testPath], ["runtime", runtimePath]]) {
    const result = run(["evidence", kind, target, "--work-item", workItemId, "--observation", observation, "--actor", "agent-fixture-hollis"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const evidenceId = /Recorded (EVID-[A-Z0-9-]+):/.exec(result.stdout)?.[1];
    assert.ok(evidenceId, result.stdout);
    assert.match(result.stdout, new RegExp(`Reusable gate reference \\(copy exactly\\): ${evidenceId}`));
    assert.match(result.stdout, /Lifecycle gate satisfied: no/);
  }
  const registry = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/evidence.json"), "utf8"));
  assert.deepEqual(registry.entries.map((entry) => entry.kind), ["test", "runtime"]);
  assert.ok(registry.entries.every((entry) => entry.artifacts.every((artifact) => /^[0-9a-f]{64}$/.test(artifact.sha256))));
  const item = JSON.parse(await fs.readFile(path.join(target, `.ai-org/work-items/${workItemId}.json`), "utf8"));
  assert.deepEqual(item.gate_evidence, {});
  assert.deepEqual(item.evidence, []);
});

test("malformed observation guidance points to the installed JSON template without recording evidence", async (context) => {
  const { target } = await fixture(context);
  const workItemId = createWorkItem(target);
  const reportPath = ".ai-org/artifacts/test-report.md";
  await fs.mkdir(path.dirname(path.join(target, reportPath)), { recursive: true });
  await fs.writeFile(path.join(target, reportPath), "# Tests\n\nAll tests passed.\n");

  const result = run([
    "evidence", "test", target,
    "--work-item", workItemId,
    "--observation", reportPath,
    "--actor", "agent-fixture-hollis"
  ]);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /Test observation must be valid JSON/);
  assert.match(result.stderr, /\.ai-org\/templates\/test-observation\.json/);

  const registry = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/evidence.json"), "utf8"));
  assert.deepEqual(registry.entries, []);
});

test("unverified claims, high risks, and failed observations become Observer attention", async (context) => {
  const { target } = await fixture(context);
  const workItemId = createWorkItem(target);
  await writeJson(target, ".ai-org/artifacts/failing-test.json", {
    schema_version: "temple.test-observation/v1",
    revision: "HEAD",
    command: ["npm", "test"],
    result: "fail",
    exit_code: 1,
    started_at: "2026-08-30T00:00:00.000Z",
    completed_at: "2026-08-30T00:01:00.000Z",
    artifact_refs: []
  });
  const commands = [
    ["evidence", "unverified", target, "--work-item", workItemId, "--summary", "Looks correct", "--reason", "No simulator available", "--expected-verification", "Run on simulator", "--actor", "agent-fixture-devon"],
    ["evidence", "risk", target, "--work-item", workItemId, "--summary", "Migration may lose data", "--severity", "high", "--risk-status", "open", "--mitigation", "Restore from backup", "--actor", "agent-fixture-ellis"],
    ["evidence", "test", target, "--work-item", workItemId, "--observation", ".ai-org/artifacts/failing-test.json", "--actor", "agent-fixture-hollis"]
  ];
  for (const command of commands) {
    const result = run(command);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }

  const observed = run(["observe", target, "--json", "--no-write"]);
  assert.equal(observed.status, 0, observed.stderr || observed.stdout);
  const overview = JSON.parse(observed.stdout);
  assert.equal(overview.schema_version, "temple.observer/v1");
  assert.equal(overview.external_action_performed, false);
  assert.ok(overview.attention.some((entry) => entry.type === "unverified_claim"));
  assert.ok(overview.attention.some((entry) => entry.type === "open_high_risk"));
  assert.ok(overview.attention.some((entry) => entry.type === "failed_evidence"));
});

test("Observer marks revision-bound evidence stale when a moving Work Item ref advances", async (context) => {
  const { target } = await fixture(context);
  const workItemId = createWorkItem(target);
  const recorded = run(["evidence", "git", target, "--work-item", workItemId, "--revision", "HEAD", "--title", "Initial candidate"]);
  assert.equal(recorded.status, 0, recorded.stderr || recorded.stdout);
  await fs.writeFile(path.join(target, "change.txt"), "new revision\n");
  assert.equal(git(target, ["add", "change.txt"]).status, 0);
  assert.equal(git(target, ["commit", "-qm", "advance candidate"]).status, 0);

  const overview = JSON.parse(run(["observe", target, "--json", "--no-write"]).stdout);
  assert.equal(overview.evidence.stale, 1);
  assert.ok(overview.attention.some((entry) => entry.type === "stale_evidence" && entry.work_item_id === workItemId));
});

test("Observer uses the tested revision for terminal work while keeping older evidence as non-actionable history", async (context) => {
  const { target } = await fixture(context);
  const workItemId = createWorkItem(target);
  const recorded = run(["evidence", "git", target, "--work-item", workItemId, "--revision", "HEAD", "--title", "Earlier candidate"]);
  assert.equal(recorded.status, 0, recorded.stderr || recorded.stdout);
  const registry = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/evidence.json"), "utf8"));
  const earlierRevision = registry.entries[0].scope_revision;

  await fs.writeFile(path.join(target, "tested-change.txt"), "tested revision\n");
  assert.equal(git(target, ["add", "tested-change.txt"]).status, 0);
  assert.equal(git(target, ["commit", "-qm", "tested candidate"]).status, 0);
  const testedRevision = git(target, ["rev-parse", "HEAD"]).stdout.trim();
  const itemPath = path.join(target, `.ai-org/work-items/${workItemId}.json`);
  const item = JSON.parse(await fs.readFile(itemPath, "utf8"));
  item.state = "done";
  item.developer_candidate_revision = earlierRevision;
  item.tested_revision = testedRevision;
  await writeJson(target, `.ai-org/work-items/${workItemId}.json`, item);

  const overview = JSON.parse(run(["observe", target, "--json", "--no-write"]).stdout);
  const observedWork = overview.work.items.find((entry) => entry.id === workItemId);
  assert.equal(observedWork.current_revision.reference, testedRevision);
  assert.equal(observedWork.current_revision.revision, testedRevision);
  assert.equal(overview.evidence.stale, 1, "historical revision drift remains available for audit and metrics");
  assert.equal(
    overview.attention.some((entry) => entry.type === "stale_evidence" && entry.work_item_id === workItemId),
    false,
    "terminal history must not be presented as current operational attention"
  );
});

test("terminal failed evidence remains auditable without becoming current attention", async (context) => {
  const { target } = await fixture(context);
  const workItemId = createWorkItem(target);
  await writeJson(target, ".ai-org/artifacts/terminal-failing-test.json", {
    schema_version: "temple.test-observation/v1",
    revision: "HEAD",
    command: ["npm", "test"],
    result: "fail",
    exit_code: 1,
    started_at: "2026-08-30T00:00:00.000Z",
    completed_at: "2026-08-30T00:01:00.000Z",
    artifact_refs: []
  });
  const recorded = run(["evidence", "test", target, "--work-item", workItemId, "--observation", ".ai-org/artifacts/terminal-failing-test.json", "--actor", "agent-fixture-hollis"]);
  assert.equal(recorded.status, 0, recorded.stderr || recorded.stdout);
  const itemPath = path.join(target, `.ai-org/work-items/${workItemId}.json`);
  const item = JSON.parse(await fs.readFile(itemPath, "utf8"));
  item.state = "done";
  await writeJson(target, `.ai-org/work-items/${workItemId}.json`, item);

  const overview = JSON.parse(run(["observe", target, "--json", "--no-write"]).stdout);
  assert.equal(overview.evidence.failed, 1);
  assert.equal(
    overview.attention.some((entry) => entry.type === "failed_evidence" && entry.work_item_id === workItemId),
    false
  );
});

test("local overview writes generated static files only when requested", async (context) => {
  const { target } = await fixture(context);
  const workItemId = createWorkItem(target);
  const noWrite = run(["observe", target, "--json", "--no-write"]);
  assert.equal(noWrite.status, 0, noWrite.stderr || noWrite.stdout);
  await assert.rejects(() => fs.access(path.join(target, ".ai-org/views/observer.json")));
  await assert.rejects(() => fs.access(path.join(target, ".ai-org/views/overview.html")));

  const written = run(["observe", target]);
  assert.equal(written.status, 0, written.stderr || written.stdout);
  const html = await fs.readFile(path.join(target, ".ai-org/views/overview.html"), "utf8");
  assert.match(html, /Evidence Product/);
  assert.match(html, new RegExp(workItemId));
  assert.match(html, /Read-only Observer overview/);
  assert.doesNotMatch(html, /<button|<form/i);
  const projection = JSON.parse(await fs.readFile(path.join(target, ".ai-org/views/observer.json"), "utf8"));
  assert.equal(projection.work.total, 1);
});

test("doctor detects drift in an evidence artifact", async (context) => {
  const { target } = await fixture(context);
  const workItemId = createWorkItem(target);
  const artifactPath = ".ai-org/artifacts/runtime-proof.txt";
  await fs.mkdir(path.dirname(path.join(target, artifactPath)), { recursive: true });
  await fs.writeFile(path.join(target, artifactPath), "original\n");
  await writeJson(target, ".ai-org/artifacts/runtime.json", {
    schema_version: "temple.runtime-observation/v1",
    revision: "HEAD",
    environment: "local",
    scenario: "health check",
    result: "pass",
    provenance: "live",
    observed_at: "2026-08-30T00:02:00.000Z",
    artifact_refs: [artifactPath]
  });
  const recorded = run(["evidence", "runtime", target, "--work-item", workItemId, "--observation", ".ai-org/artifacts/runtime.json"]);
  assert.equal(recorded.status, 0, recorded.stderr || recorded.stdout);
  await fs.writeFile(path.join(target, artifactPath), "changed\n");
  const doctor = run(["doctor", target, "--json"]);
  assert.equal(doctor.status, 1, doctor.stderr || doctor.stdout);
  const check = JSON.parse(doctor.stdout).checks.find((entry) => entry.id === "evidence_registry");
  assert.equal(check.status, "fail");
  assert.match(check.message, /digest mismatch/);
});

test("explicit invalidation retains audit history while removing unusable evidence from health", async (context) => {
  const { target } = await fixture(context);
  const workItemId = createWorkItem(target);
  const artifactPath = ".ai-org/artifacts/invalidation-proof.txt";
  const observationPath = ".ai-org/artifacts/invalidation-test.json";
  await fs.mkdir(path.dirname(path.join(target, artifactPath)), { recursive: true });
  await fs.writeFile(path.join(target, artifactPath), "original\n");
  await writeJson(target, observationPath, {
    schema_version: "temple.test-observation/v1",
    revision: "HEAD",
    command: ["npm", "test"],
    result: "pass",
    exit_code: 0,
    started_at: "2026-08-30T00:00:00.000Z",
    completed_at: "2026-08-30T00:01:00.000Z",
    artifact_refs: [artifactPath]
  });
  const recorded = run([
    "evidence", "test", target,
    "--work-item", workItemId,
    "--observation", observationPath,
    "--actor", "agent-fixture-devon"
  ]);
  assert.equal(recorded.status, 0, recorded.stderr || recorded.stdout);
  const evidenceId = /Recorded (EVID-[A-Z0-9-]+):/.exec(recorded.stdout)?.[1];
  assert.ok(evidenceId, recorded.stdout);

  const replacementRecorded = run([
    "evidence", "git", target,
    "--work-item", workItemId,
    "--revision", "HEAD",
    "--actor", "agent-fixture-hollis"
  ]);
  assert.equal(replacementRecorded.status, 0, replacementRecorded.stderr || replacementRecorded.stdout);
  const replacementId = /Recorded (EVID-[A-Z0-9-]+):/.exec(replacementRecorded.stdout)?.[1];
  assert.ok(replacementId, replacementRecorded.stdout);

  await fs.writeFile(path.join(target, artifactPath), "changed\n");
  const driftedDoctor = run(["doctor", target, "--json"]);
  assert.equal(driftedDoctor.status, 1, driftedDoctor.stderr || driftedDoctor.stdout);
  assert.match(
    JSON.parse(driftedDoctor.stdout).checks.find((entry) => entry.id === "evidence_registry").message,
    new RegExp(evidenceId)
  );

  const invalidated = run([
    "evidence", "invalidate", target,
    "--evidence-id", evidenceId,
    "--replacement-evidence-id", replacementId,
    "--reason", "The retained artifact drifted after the observation and is superseded by exact Git evidence.",
    "--actor", "agent-fixture-hollis"
  ]);
  assert.equal(invalidated.status, 0, invalidated.stderr || invalidated.stdout);
  assert.match(invalidated.stdout, /Evidence deleted: no/);

  const registry = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/evidence.json"), "utf8"));
  const retained = registry.entries.find((entry) => entry.id === evidenceId);
  assert.ok(retained.invalidated_at);
  assert.equal(retained.invalidated_by, "agent-fixture-hollis");
  assert.match(retained.invalidation_reason, /retained artifact drifted/);
  assert.equal(retained.details.invalidation.replacement_evidence_id, replacementId);
  assert.ok(retained.artifacts.some((artifact) => artifact.path === artifactPath));

  const observer = run(["observe", target, "--json", "--no-write"]);
  assert.equal(observer.status, 0, observer.stderr || observer.stdout);
  assert.ok(JSON.parse(observer.stdout).attention.some((entry) => entry.type === "invalidated_evidence" && entry.evidence_id === evidenceId));
  const repairedDoctor = run(["doctor", target, "--json"]);
  assert.equal(repairedDoctor.status, 0, repairedDoctor.stderr || repairedDoctor.stdout);

  const repeated = run([
    "evidence", "invalidate", target,
    "--evidence-id", evidenceId,
    "--reason", "Attempt to rewrite invalidation history"
  ]);
  assert.equal(repeated.status, 1, repeated.stdout);
  assert.match(repeated.stderr, /already invalidated/);
});

test("evidence invalidation rolls the registry back when audit append fails", async (context) => {
  const { target } = await fixture(context);
  const workItemId = createWorkItem(target);
  const recorded = run(["evidence", "git", target, "--work-item", workItemId, "--revision", "HEAD"]);
  assert.equal(recorded.status, 0, recorded.stderr || recorded.stdout);
  const evidenceId = /Recorded (EVID-[A-Z0-9-]+):/.exec(recorded.stdout)?.[1];
  assert.ok(evidenceId, recorded.stdout);
  const registryPath = path.join(target, ".ai-org/project/evidence.json");
  const before = await fs.readFile(registryPath, "utf8");
  const eventPath = path.join(target, ".ai-org/events/events.jsonl");
  const eventContent = await fs.readFile(eventPath);
  await fs.rm(eventPath);
  await fs.mkdir(eventPath);

  const failed = run([
    "evidence", "invalidate", target,
    "--evidence-id", evidenceId,
    "--reason", "The audit append must fail"
  ]);
  assert.equal(failed.status, 1, failed.stdout);
  assert.equal(await fs.readFile(registryPath, "utf8"), before);

  await fs.rm(eventPath, { recursive: true });
  await fs.writeFile(eventPath, eventContent);
});

test("doctor validates tracked evidence artifacts at their recorded revision", async (context) => {
  const { target } = await fixture(context);
  const artifactPath = "README.md";
  await fs.writeFile(path.join(target, artifactPath), "historical README\n");
  assert.equal(git(target, ["add", artifactPath]).status, 0);
  assert.equal(git(target, ["commit", "-qm", "add historical artifact"]).status, 0);
  const evidenceRevision = git(target, ["rev-parse", "HEAD"]).stdout.trim();
  const workItemId = createWorkItem(target);
  const observationPath = ".ai-org/artifacts/historical-test.json";
  await writeJson(target, observationPath, {
    schema_version: "temple.test-observation/v1",
    revision: evidenceRevision,
    command: ["npm", "test"],
    result: "pass",
    exit_code: 0,
    started_at: "2026-08-30T00:00:00.000Z",
    completed_at: "2026-08-30T00:01:00.000Z",
    artifact_refs: [artifactPath]
  });
  const recorded = run([
    "evidence", "test", target,
    "--work-item", workItemId,
    "--observation", observationPath,
    "--actor", "agent-fixture-hollis"
  ]);
  assert.equal(recorded.status, 0, recorded.stderr || recorded.stdout);

  await fs.writeFile(path.join(target, artifactPath), "current README\n");
  assert.equal(git(target, ["add", artifactPath]).status, 0);
  assert.equal(git(target, ["commit", "-qm", "advance tracked artifact"]).status, 0);

  const currentDoctor = run(["doctor", target, "--json"]);
  assert.equal(currentDoctor.status, 0, currentDoctor.stderr || currentDoctor.stdout);

  const registryPath = path.join(target, ".ai-org/project/evidence.json");
  const registry = JSON.parse(await fs.readFile(registryPath, "utf8"));
  const trackedArtifact = registry.entries[0].artifacts.find((artifact) => artifact.path === artifactPath);
  const historicalDigest = trackedArtifact.sha256;
  trackedArtifact.sha256 = "0".repeat(64);
  await fs.writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
  const wrongDigestDoctor = run(["doctor", target, "--json"]);
  assert.equal(wrongDigestDoctor.status, 1, wrongDigestDoctor.stderr || wrongDigestDoctor.stdout);
  assert.match(
    JSON.parse(wrongDigestDoctor.stdout).checks.find((entry) => entry.id === "evidence_registry").message,
    /digest mismatch.*recorded revision/
  );

  trackedArtifact.sha256 = historicalDigest;
  registry.entries[0].scope_revision = "f".repeat(40);
  await fs.writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
  const unavailableRevisionDoctor = run(["doctor", target, "--json"]);
  assert.equal(unavailableRevisionDoctor.status, 1, unavailableRevisionDoctor.stderr || unavailableRevisionDoctor.stdout);
  assert.match(
    JSON.parse(unavailableRevisionDoctor.stdout).checks.find((entry) => entry.id === "evidence_registry").message,
    /recorded revision .* is unavailable/
  );
});
