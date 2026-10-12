import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertFreshReworkGates, assertReworkScope, prebuildRequirements, prepareRework } from "../src/work-item-rework.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roles = [
  ["Rowan", ["engineering_manager", "release_manager", "observer"]],
  ["Linden", ["product_manager", "ux_designer", "ui_designer"]],
  ["Ellis", ["tech_lead"]], ["Devon", ["developer"]],
  ["Hollis", ["quality_evaluator", "independent_qa"]]
];
const prebuild = ["work_order", "approved_scope", "acceptance_criteria", "technical_design", "risk_review"];
function run(args) { return spawnSync(process.execPath, [path.join(root, "bin/temple.mjs"), ...args], { encoding: "utf8" }); }
function ok(args) { const result = run(args); assert.equal(result.status, 0, result.stderr || result.stdout); return result.stdout; }
function git(target, args) { const result = spawnSync("git", ["-C", target, ...args], { encoding: "utf8" }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); }
function commit(target) { git(target, ["add", "."]); git(target, ["-c", "user.name=Temple Tests", "-c", "user.email=temple-tests@example.invalid", "commit", "-qm", "Candidate"]); return git(target, ["rev-parse", "HEAD"]); }
async function readItem(target, id) { return JSON.parse(await fs.readFile(path.join(target, ".ai-org/work-items", `${id}.json`), "utf8")); }
async function snapshot(target, id) {
  const files = [`.ai-org/work-items/${id}.json`, ".ai-org/events/events.jsonl"];
  const artifacts = `.ai-org/artifacts/${id}`;
  for (const file of await fs.readdir(path.join(target, artifacts))) files.push(`${artifacts}/${file}`);
  return Promise.all(files.sort().map(async file => [file, await fs.readFile(path.join(target, file), "utf8")]));
}
async function fixture(t, profile = "standard", reviewState = "test") {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "temple-rework-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const target = path.join(temporary, "product");
  const config = path.join(temporary, "init.json");
  await fs.writeFile(config, JSON.stringify({ schema_version: "temple.init/v1", project: { id: "rework", name: "Rework fixture" }, naming_mode: "manual", agents: roles.map(([name, positions]) => ({ display_name: name, positions })) }));
  ok(["init", target, "--config", config]);
  await fs.mkdir(path.join(target, "docs"));
  for (const name of ["scope", "old", "findings", "new", "later"]) await fs.writeFile(path.join(target, `docs/${name}.md`), `${name} evidence\n`);
  git(target, ["init", "-q"]);
  const revision = commit(target);
  const assignments = JSON.parse(await fs.readFile(path.join(target, ".ai-org/project/assignments.json"), "utf8")).assignments;
  const agent = position => assignments.find(entry => entry.position_id === position).agent_id;
  const bind = principal => ok(["collaboration", "bind-identity", target, "--principal-id", principal, "--verification-class", "external-evidence", "--provider-id", "fixture", "--provider-subject", principal, "--evidence-ref", "docs/findings.md"]);
  if (profile === "high-assurance") {
    for (const principal of ["principal-owner", "principal-reviewer"]) ok(["collaboration", "add-principal", target, "--principal-id", principal, "--name", principal]);
    for (const position of ["engineering_manager", "product_manager", "tech_lead", "developer", "quality_evaluator"]) {
      ok(["collaboration", "sponsor", target, "--agent-id", agent(position), "--principal-id", position === "quality_evaluator" ? "principal-reviewer" : "principal-owner"]);
    }
    ok(["collaboration", "set-profile", target, "--profile", "high-assurance"]);
    bind("principal-owner");
  }
  const { item } = JSON.parse(ok(["work-item", "create", target, "--title", "Repair bounded feature", "--scope", "Same feature", "--acceptance", "Verified behavior", "--affected-path", "docs", "--ui-mode", "not-applicable", "--workflow-profile", profile, "--risk-tier", "low", "--scope-class", "bounded", "--profile-rationale", "Reversible bounded fixture", "--base-revision", revision, "--json"]));
  const id = item.id;
  const move = (to, gates = [], ref = "docs/old.md") => ok(["transition", target, "--work-item", id, "--to", to, ...gates.flatMap(gate => ["--satisfy", `${gate}=${ref}`])]);
  if (profile === "lean") move("build", [...prebuild, "profile_eligibility"], "docs/scope.md");
  else {
    move("spec", ["work_order"], "docs/scope.md"); move("design", ["approved_scope", "acceptance_criteria"], "docs/scope.md");
    if (profile === "high-assurance") {
      const risk = /Recorded (EVID-[A-Z0-9-]+):/.exec(ok(["evidence", "risk", target, "--work-item", id, "--summary", "Bounded repair", "--severity", "low", "--risk-status", "mitigated", "--mitigation", "Revert", "--revision", revision]))[1];
      ok(["transition", target, "--work-item", id, "--to", "build", "--satisfy", "technical_design=docs/scope.md", "--satisfy", "risk_review=docs/scope.md", "--satisfy", `assurance_risk_review=${risk}`]);
    } else move("build", ["technical_design", "risk_review"], "docs/scope.md");
  }
  const claim = position => {
    if (profile === "high-assurance") bind(position === "developer" ? "principal-owner" : "principal-reviewer");
    return ok(["work-item", "claim", target, "--work-item", id, "--agent-id", agent(position), "--base-revision", revision, "--branch", "fixture"]);
  };
  const handoffArgs = (sha, ref = "docs/new.md") => ["handoff", target, "--work-item", id, "--to", "quality_evaluator", "--input-revision", sha, "--completed", "Corrected approved behavior", "--evidence", ref];
  claim("developer");
  ok(handoffArgs(revision, "docs/old.md"));
  if (profile === "high-assurance") {
    const candidate = /Recorded (EVID-[A-Z0-9-]+):/.exec(ok(["evidence", "git", target, "--work-item", id, "--revision", revision]))[1];
    move("test", ["exact_candidate_revision"], candidate);
  } else move("test");
  if (["eval", "independent_qa"].includes(reviewState)) move("eval", ["test_evidence"]);
  if (reviewState === "independent_qa") move("independent_qa", ["evaluation_report"]);
  claim(reviewState === "independent_qa" ? "independent_qa" : "quality_evaluator");
  const reworkArgs = sha => ["work-item", "rework", target, "--work-item", id, "--same-scope", "--input-revision", sha, "--reason", "Acceptance behavior needs correction", "--evidence", "docs/findings.md", "--json"];
  return { target, id, revision, move, claim, agent, handoffArgs, reworkArgs };
}

test("CLI review rework preserves scope, archives attempts and releases claims across supported review stages", async t => {
  for (const [profile, stage] of [["lean", "test"], ["standard", "test"], ["standard", "eval"], ["standard", "independent_qa"]]) await t.test(`${profile}/${stage}`, async t => {
    const f = await fixture(t, profile, stage);
    const before = await readItem(f.target, f.id);
    const result = JSON.parse(ok(f.reworkArgs(f.revision)));
    assert.equal(result.item.id, f.id);
    assert.equal(result.item.state, "build");
    assert.equal(result.item.assigned_agent_id, f.agent("developer"));
    assert.equal(result.item.claim.status, "released");
    assert.equal(result.item.claim.release_reason, "review_rework");
    assert.equal(result.item.developer_candidate_revision, undefined);
    assert.deepEqual(result.item.scope, before.scope);
    assert.deepEqual(result.item.acceptance_criteria, before.acceptance_criteria);
    assert.deepEqual(result.item.handoffs, before.handoffs);
    assert.equal(result.entry.rejected_revision, f.revision);
    assert.equal(result.entry.from_state, stage);
    assert.deepEqual(result.entry.retired_gate_evidence.developer_evidence, ["docs/old.md"]);
    assert.equal(result.item.gate_evidence.test_evidence, undefined);
    assert.equal(result.item.gate_evidence.approved_scope[0], "docs/scope.md");
    ok(["doctor", f.target]);
    const rejected = run(f.reworkArgs(f.revision));
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /only from Test/);
  });
});

test("a corrected candidate follows normal gates; retired evidence and rejected revisions cannot be reused", async t => {
  const f = await fixture(t, "standard", "independent_qa");
  ok(f.reworkArgs(f.revision));
  const before = await snapshot(f.target, f.id);
  for (const args of [f.handoffArgs(f.revision), ["transition", f.target, "--work-item", f.id, "--to", "test", "--satisfy", "developer_handoff=docs/new.md", "--satisfy", "developer_evidence=docs/new.md"]]) assert.notEqual(run(args).status, 0);
  assert.deepEqual(await snapshot(f.target, f.id), before);
  f.claim("developer");
  const claimed = await snapshot(f.target, f.id);
  assert.match(run(f.handoffArgs(f.revision)).stderr, /rejected rework candidate/);
  assert.deepEqual(await snapshot(f.target, f.id), claimed);
  const corrected = commit(f.target);
  for (const ref of ["docs/old.md", "docs/./old.md", "docs/findings.md"]) {
    assert.match(run(f.handoffArgs(corrected, ref)).stderr, /Retired rework evidence/);
    assert.deepEqual(await snapshot(f.target, f.id), claimed);
  }
  ok(f.handoffArgs(corrected));
  f.move("test");
  assert.match(run(["transition", f.target, "--work-item", f.id, "--to", "eval", "--satisfy", "test_evidence=docs/old.md"]).stderr, /Retired rework evidence/);
  f.move("eval", ["test_evidence"], "docs/new.md");
  f.move("independent_qa", ["evaluation_report"], "docs/new.md");
  f.claim("independent_qa");
  const second = JSON.parse(ok(f.reworkArgs(corrected)));
  assert.equal(second.entry.sequence, 2);
  assert.equal(second.item.rework_history[0].rejected_revision, f.revision);
  f.claim("developer");
  assert.match(run(f.handoffArgs(f.revision, "docs/later.md")).stderr, /rejected rework candidate/);
  assert.match(run(f.handoffArgs(corrected, "docs/later.md")).stderr, /rejected rework candidate/);
  const third = commit(f.target);
  ok(f.handoffArgs(third, "docs/later.md"));
  f.move("test"); f.move("eval", ["test_evidence"], "docs/later.md");
  f.move("independent_qa", ["evaluation_report"], "docs/later.md");
  f.move("release_gate", ["independent_qa_pass"], "docs/later.md");
  assert.match(run(f.reworkArgs(third)).stderr, /Release Gate/);
  const close = sha => ["close", f.target, "--work-item", f.id, "--decision", "go", "--tested-revision", sha, "--rollback", "Revert corrected candidate", "--approval", "not-required", "--satisfy", "accepted_scope=docs/scope.md", "--satisfy", "independent_qa_report=docs/later.md"];
  assert.match(run(close(f.revision)).stderr, /current Developer candidate/);
  ok(close(third));
  assert.equal((await readItem(f.target, f.id)).state, "done");
  assert.match(run(f.reworkArgs(third)).stderr, /closed work/);
});

test("invalid CLI requests fail before Work Item, event or artifact mutation", async t => {
  const f = await fixture(t);
  const before = await snapshot(f.target, f.id);
  const requests = [
    f.reworkArgs(f.revision).filter(arg => arg !== "--same-scope"),
    f.reworkArgs("HEAD"), f.reworkArgs("f".repeat(40)),
    [...f.reworkArgs(f.revision), "--actor", f.agent("developer")],
    [...f.reworkArgs(f.revision), "--scope", "Expanded scope"],
    [...f.reworkArgs(f.revision), "--evidence", "../outside.md"],
    [...f.reworkArgs(f.revision), "--evidence", "docs/missing.md"],
    [...f.reworkArgs(f.revision), "--evidence", "Looks good"]
  ];
  for (const args of requests) {
    assert.notEqual(run(args).status, 0, args.join(" "));
    assert.deepEqual(await snapshot(f.target, f.id), before);
  }
  const itemPath = path.join(f.target, `.ai-org/work-items/${f.id}.json`);
  const original = await fs.readFile(itemPath, "utf8");
  const legacy = JSON.parse(original);
  delete legacy.handoffs.at(-1).actor;
  await fs.writeFile(itemPath, JSON.stringify(legacy));
  const legacyBefore = await snapshot(f.target, f.id);
  assert.match(run(f.reworkArgs(f.revision)).stderr, /recorded Developer handoff author/);
  assert.deepEqual(await snapshot(f.target, f.id), legacyBefore);
  await fs.writeFile(itemPath, original);
  ok(["work-item", "release", f.target, "--work-item", f.id]);
  assert.match(run(f.reworkArgs(f.revision)).stderr, /active reviewer claim/);
});

test("audit persistence failure restores exact Work Item bytes and permits one later successful rework", async t => {
  const f = await fixture(t, "standard", "independent_qa");
  const before = await snapshot(f.target, f.id);
  const itemPath = path.join(f.target, `.ai-org/work-items/${f.id}.json`);
  const originalItem = await fs.readFile(itemPath, "utf8");
  const eventPath = path.join(f.target, ".ai-org/events/events.jsonl");
  const savedPath = `${eventPath}.fixture-saved`;
  await fs.rename(eventPath, savedPath);
  await fs.mkdir(eventPath);
  const result = run(f.reworkArgs(f.revision));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /EISDIR/);
  assert.equal(await fs.readFile(itemPath, "utf8"), originalItem);
  await fs.rmdir(eventPath);
  await fs.rename(savedPath, eventPath);
  assert.deepEqual(await snapshot(f.target, f.id), before);
  const applied = JSON.parse(ok(f.reworkArgs(f.revision)));
  assert.equal(applied.entry.sequence, 1);
  const events = (await fs.readFile(eventPath, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(events.filter(event => event.event_type === "work_item_reworked").length, 1);
});

test("High-Assurance rework retains risk authority and requires fresh exact-candidate evidence", async t => {
  const f = await fixture(t, "high-assurance");
  const before = await readItem(f.target, f.id);
  const reworked = JSON.parse(ok(f.reworkArgs(f.revision)));
  assert.deepEqual(reworked.item.assurance, before.assurance);
  assert.deepEqual(reworked.item.gate_evidence.assurance_risk_review, before.gate_evidence.assurance_risk_review);
  assert.equal(reworked.item.gate_evidence.exact_candidate_revision, undefined);
  f.claim("developer");
  const corrected = commit(f.target);
  ok(f.handoffArgs(corrected));
  const args = ["transition", f.target, "--work-item", f.id, "--to", "test"];
  assert.match(run(args).stderr, /exact_candidate_revision/);
  assert.match(run([...args, "--satisfy", `exact_candidate_revision=${before.gate_evidence.exact_candidate_revision[0]}`]).stderr, /Retired rework evidence/);
  const evidence = /Recorded (EVID-[A-Z0-9-]+):/.exec(ok(["evidence", "git", f.target, "--work-item", f.id, "--revision", corrected]))[1];
  ok([...args, "--satisfy", `exact_candidate_revision=${evidence}`]);
});

test("Collaborative rework requires the sponsored reviewer's externally verified local binding", async t => {
  const f = await fixture(t);
  ok(["work-item", "release", f.target, "--work-item", f.id]);
  for (const id of ["principal-owner", "principal-reviewer"]) ok(["collaboration", "add-principal", f.target, "--principal-id", id, "--name", id]);
  for (const position of ["engineering_manager", "product_manager", "tech_lead", "developer", "quality_evaluator"]) {
    ok(["collaboration", "sponsor", f.target, "--agent-id", f.agent(position), "--principal-id", position === "quality_evaluator" ? "principal-reviewer" : "principal-owner"]);
  }
  ok(["collaboration", "set-profile", f.target, "--profile", "collaborative"]);
  const bind = principal => ok(["collaboration", "bind-identity", f.target, "--principal-id", principal, "--verification-class", "external-evidence", "--provider-id", "fixture", "--provider-subject", principal, "--evidence-ref", "docs/findings.md"]);
  bind("principal-reviewer");
  f.claim("quality_evaluator");
  bind("principal-owner");
  const before = await snapshot(f.target, f.id);
  assert.match(run(f.reworkArgs(f.revision)).stderr, /bound to principal-owner, not principal-reviewer/);
  assert.deepEqual(await snapshot(f.target, f.id), before);
  bind("principal-reviewer");
  ok(f.reworkArgs(f.revision));
});

test("runtime reservations block rework rather than silently cancelling workers", async t => {
  const f = await fixture(t);
  const registryPath = path.join(f.target, ".ai-org/project/resources.json");
  const registry = JSON.parse(await fs.readFile(registryPath, "utf8"));
  registry.resources.push({ id: "fixture", display_name: "Fixture", kind: "port", capacity: 1, description: "Fixture reservation", active: true });
  registry.reservations.push({ id: "reservation-fixture", resource_id: "fixture", worker_id: "worker-fixture", work_item_id: f.id, units: 1, status: "active", reserved_at: new Date().toISOString(), released_at: null });
  await fs.writeFile(registryPath, JSON.stringify(registry));
  const before = await snapshot(f.target, f.id);
  assert.match(run(f.reworkArgs(f.revision)).stderr, /active runtime workers and resource reservations/);
  assert.deepEqual(await snapshot(f.target, f.id), before);
  assert.equal(JSON.parse(await fs.readFile(registryPath, "utf8")).reservations.at(-1).status, "active");
});

test("a prepared runtime worker without resource requirements still blocks rework", async t => {
  const f = await fixture(t);
  ok(["work-item", "release", f.target, "--work-item", f.id]);
  ok(["work-item", "configure", f.target, "--work-item", f.id, "--integration-owner", f.agent("engineering_manager")]);
  ok(["work-item", "configure", f.target, "--work-item", f.id, "--parallel-mode", "parallel"]);
  ok(["parallel", "plan", f.target]);
  ok(["parallel", "prepare", f.target, "--work-item", f.id, "--agent-id", f.agent("quality_evaluator"), "--base-revision", f.revision, "--branch", "fixture", "--runtime-kind", "internal-subagent"]);
  const before = await snapshot(f.target, f.id);
  const registryPath = path.join(f.target, ".ai-org/project/runtime-workers.json");
  const workers = await fs.readFile(registryPath, "utf8");
  assert.match(run(f.reworkArgs(f.revision)).stderr, /active runtime workers and resource reservations/);
  assert.deepEqual(await snapshot(f.target, f.id), before);
  assert.equal(await fs.readFile(registryPath, "utf8"), workers);
});

test("history clears all candidate projections and detects scope, risk and authority drift", () => {
  const item = { id: "WI-0001", state: "independent_qa", scope: ["one feature"], risk_tier: "standard", claim: { id: "claim-1", agent_id: "reviewer" }, gate_evidence: { approved_scope: ["scope.md"], independent_qa_pass: ["old.md"] }, developer_candidate_revision: "a".repeat(40), tested_revision: "a".repeat(40), independent_qa_revision: "a".repeat(40), closeout_revision: "a".repeat(40), qa_evidence_revision: "a".repeat(40), dispatch_revision: "a".repeat(40), release_record: { tested_revision: "a".repeat(40) }, approval_record: "approval.json" };
  const prepared = prepareRework(item, { actor: "reviewer", reason: ["repair"], findings: ["findings.md"], revision: "a".repeat(40), retainedRequirements: ["approved_scope"], timestamp: new Date().toISOString() });
  assertReworkScope(prepared.item);
  for (const field of ["tested_revision", "independent_qa_revision", "qa_evidence_revision", "dispatch_revision", "closeout_revision", "release_record", "approval_record"]) assert.equal(prepared.item[field], undefined);
  assert.equal(prepared.entry.retired_candidate_fields.approval_record, "approval.json");
  for (const change of [{ scope: ["two features"] }, { risk_tier: "low" }, { ui_delivery_mode: "code-first" }, { spec_refs: [{ id: "other", revision: "v2" }] }]) assert.throws(() => assertReworkScope({ ...prepared.item, ...change }), /boundary changed/);
});

test("normalized rework evidence must match the new candidate, even when never used in a gate", async t => {
  const f = await fixture(t);
  const result = JSON.parse(ok(f.reworkArgs(f.revision)));
  const registryPath = path.join(f.target, ".ai-org/project/evidence.json");
  const registry = JSON.parse(await fs.readFile(registryPath, "utf8"));
  registry.entries.push({ id: "EVID-FIXTURE", scope_revision: f.revision });
  await fs.writeFile(registryPath, JSON.stringify(registry));
  const item = { ...result.item, developer_candidate_revision: "b".repeat(40) };
  await assert.rejects(assertFreshReworkGates(f.target, item, { test_evidence: ["EVID-FIXTURE"] }), /match the new Developer candidate/);
  registry.entries[registry.entries.length - 1].scope_revision = item.developer_candidate_revision;
  await fs.writeFile(registryPath, JSON.stringify(registry));
  await assertFreshReworkGates(f.target, item, { test_evidence: ["EVID-FIXTURE"] });
});

test("custom prebuild paths retain their gates and ambiguous or cross-boundary gates fail closed", async () => {
  const workflow = JSON.parse(await fs.readFile(path.join(root, "project-overlay/.ai-org/core/workflow.json"), "utf8"));
  const item = { state: "test", workflow_profile: "standard" };
  assert.deepEqual(prebuildRequirements(workflow, item), prebuild);
  workflow.profiles.find(profile => profile.id === "standard").transitions[2].requires.push("custom_design_review");
  assert.ok(prebuildRequirements(workflow, item).includes("custom_design_review"));
  workflow.profiles.find(profile => profile.id === "standard").transitions[3].requires.push("custom_design_review");
  assert.throws(() => prebuildRequirements(workflow, item), /both before and after Build/);
});
