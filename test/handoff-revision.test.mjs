import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { exactHandoffRevision } from "../src/assurance.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function run(args) {
  return spawnSync(process.execPath, [path.join(root, "bin/temple.mjs"), ...args], { encoding: "utf8" });
}
function ok(args) {
  const result = run(args);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}
function git(target, args) {
  const result = spawnSync("git", ["-C", target, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function commit(target, message) {
  git(target, ["add", "."]);
  git(target, ["-c", "user.name=Temple Tests", "-c", "user.email=temple-tests@example.invalid", "commit", "-qm", message]);
  return git(target, ["rev-parse", "HEAD"]);
}
async function fixture(context) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "temple-handoff-revision-"));
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const target = path.join(temporaryRoot, "product");
  const config = path.join(temporaryRoot, "init.json");
  await fs.writeFile(config, JSON.stringify({
    schema_version: "temple.init/v1",
    project: { id: "revision-product", name: "Revision Product" },
    naming_mode: "manual",
    agents: [
      { display_name: "Fixture Rowan", positions: ["engineering_manager", "release_manager", "observer"] },
      { display_name: "Fixture Linden", positions: ["product_manager", "ux_designer", "ui_designer"] },
      { display_name: "Fixture Ellis", positions: ["tech_lead"] },
      { display_name: "Fixture Devon", positions: ["developer"] },
      { display_name: "Fixture Hollis", positions: ["quality_evaluator", "independent_qa"] }
    ]
  }));
  ok(["init", target, "--config", config]);
  await fs.mkdir(path.join(target, "docs"), { recursive: true });
  await fs.writeFile(path.join(target, "docs/evidence.md"), "Bounded fixture scope, design, risk and Developer evidence.\n");
  return { target };
}
function createBuild(target, profile) {
  const { item } = JSON.parse(ok(["work-item", "create", target, "--title", `${profile} candidate`, "--scope", "Bounded fixture", "--acceptance", "Exact handoff", "--ui-mode", "not-applicable", "--workflow-profile", profile, "--risk-tier", "low", "--scope-class", "bounded", "--profile-rationale", "Reversible fixture with objective checks", "--json"]));
  const move = (to, requirements) => ok(["transition", target, "--work-item", item.id, "--to", to, ...requirements.flatMap(r => ["--satisfy", `${r}=docs/evidence.md`])]);
  if (profile === "lean") move("build", ["work_order", "approved_scope", "acceptance_criteria", "technical_design", "risk_review", "profile_eligibility"]);
  else {
    move("spec", ["work_order"]);
    move("design", ["approved_scope", "acceptance_criteria"]);
    move("build", ["technical_design", "risk_review"]);
  }
  return item.id;
}
function handoff(target, id, revision) {
  return run(["handoff", target, "--work-item", id, "--to", "quality_evaluator", "--input-revision", revision, "--completed", "Implemented bounded fixture", "--evidence", "docs/evidence.md"]);
}
async function snapshot(target, id) {
  let artifacts = [];
  const directory = path.join(target, ".ai-org/artifacts", id);
  try {
    artifacts = await Promise.all((await fs.readdir(directory)).sort().map(async f => [f, await fs.readFile(path.join(directory, f), "utf8")]));
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  return {
    item: await fs.readFile(path.join(target, ".ai-org/work-items", `${id}.json`), "utf8"),
    events: await fs.readFile(path.join(target, ".ai-org/events/events.jsonl"), "utf8"),
    artifacts
  };
}

test("new Lean and Standard handoffs pin accepted references across canonical outputs", async context => {
  for (const profile of ["lean", "standard"]) await context.test(profile, async context => {
    const { target } = await fixture(context);
    git(target, ["init", "-q"]);
    const candidate = commit(target, "Candidate");
    git(target, ["branch", "candidate-branch"]);
    git(target, ["tag", "candidate-tag"]);
    git(target, ["-c", "user.name=Temple Tests", "-c", "user.email=temple-tests@example.invalid", "tag", "-a", "annotated-candidate", "-m", "Candidate tag"]);
    const id = createBuild(target, profile);
    for (const ref of ["HEAD", "candidate-branch", "candidate-tag", "annotated-candidate", candidate.slice(0, 12), candidate]) {
      const result = handoff(target, id, ref);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const state = await snapshot(target, id);
      const item = JSON.parse(state.item);
      const entry = item.handoffs.at(-1);
      assert.equal(entry.input_revision, candidate);
      assert.equal(item.developer_candidate_revision, candidate);
      const artifact = await fs.readFile(path.join(target, entry.artifact), "utf8");
      assert.ok(artifact.includes(`- Input revision: \`${candidate}\``));
      const event = state.events.trim().split("\n").map(JSON.parse).filter(e => e.event_type === "handoff_created").at(-1);
      assert.equal(event.input_revision, candidate);
    }
    const before = await snapshot(target, id);
    await fs.writeFile(path.join(target, "later.txt"), "Later unrelated commit\n");
    const later = commit(target, "Advance HEAD");
    assert.notEqual(later, candidate);
    git(target, ["branch", "-f", "candidate-branch", later]);
    assert.deepEqual(await snapshot(target, id), before);
  });
});

test("invalid revisions fail before any handoff artifact, Work Item or event write", async context => {
  const { target } = await fixture(context);
  git(target, ["init", "-q"]);
  commit(target, "Candidate");
  const id = createBuild(target, "standard");
  assert.equal(handoff(target, id, "HEAD").status, 0);
  const before = await snapshot(target, id);
  const invalid = ["missing-ref", "HEAD^{tree}", "HEAD:docs/evidence.md", "--help", "--output=/tmp/temple-untrusted", "", " "];
  for (const ref of invalid) {
    const rejected = handoff(target, id, ref);
    assert.notEqual(rejected.status, 0, ref);
    assert.match(rejected.stderr, /revision|required/i);
    assert.deepEqual(await snapshot(target, id), before, ref);
  }
});

test("handoff rejects unborn and non-Git repositories without recording evidence", async context => {
  const { target } = await fixture(context);
  const id = createBuild(target, "lean");
  const before = await snapshot(target, id);
  for (const mode of ["non-Git", "unborn"]) {
    if (mode === "unborn") git(target, ["init", "-q"]);
    const rejected = handoff(target, id, "HEAD");
    assert.notEqual(rejected.status, 0, mode);
    assert.match(rejected.stderr, /cannot be resolved to a commit/);
    assert.deepEqual(await snapshot(target, id), before, mode);
  }
});

test("commit normalization is shared by legacy, Lean, Standard and High-Assurance items", async context => {
  const { target } = await fixture(context);
  git(target, ["init", "-q"]);
  const revision = commit(target, "Candidate");
  for (const item of [{}, { workflow_profile: "lean" }, { workflow_profile: "standard" }, { assurance: { profile: "high-assurance" } }]) {
    assert.equal(await exactHandoffRevision(target, item, "HEAD"), revision);
    await assert.rejects(exactHandoffRevision(target, item, "not-a-commit"), /cannot be resolved/);
  }
});
