import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readNativeTask } from "../src/workkeel-tasks.mjs";
import { runLifecycleFromFlags, runCreateFromFlags, lifecycleRequestFromFlags } from "../src/workkeel-cli-flags.mjs";

const cli = fileURLToPath(new URL("../bin/workkeel.mjs", import.meta.url));
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function workkeel(root, ...args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stdout}${result.stderr}`);
  return JSON.parse(result.stdout);
}
async function repository(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-flags-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  git(root, "init", "-q"); git(root, "config", "user.name", "Fixture"); git(root, "config", "user.email", "fixture@example.invalid");
  await fs.mkdir(path.join(root, "docs")); await fs.writeFile(path.join(root, "docs/guide.md"), "# Guide\n");
  return root;
}
const jsonFiles = async root => (await fs.readdir(root, { recursive: true }))
  .filter(name => name.endsWith(".json") && !name.startsWith(".git/") && !name.startsWith(".ai-org/")).sort();

test("a solo owner completes a low task using only flags, without writing JSON", async t => {
  const root = await repository(t);
  const init = workkeel(root, "init", "--solo");
  assert.deepEqual(init.suggested_gitignore, [".workkeel/"]);
  await fs.writeFile(path.join(root, ".gitignore"), ".workkeel/\n");
  git(root, "add", "-A"); git(root, "commit", "-qm", "base");
  const created = workkeel(root, "task", "new", "--goal", "Clarify the guide", "--acceptance", "The guide names its audience", "--write", "docs", "--actor", "builder");
  assert.equal(created.id, "WK-0001"); assert.equal(created.state, "intake");
  const contract = (await readNativeTask(root, "WK-0001")).contract;
  assert.equal(contract.verification.risk_tier, "low"); assert.equal(contract.authorization.approval_ref, null);
  assert.deepEqual(contract.environment.write_paths, ["docs"]); assert.deepEqual(contract.actor, { agent_id: "builder", principal_id: "owner" });
  assert.equal(workkeel(root, "task", "claim", "--id", "WK-0001", "--actor", "builder").state, "build");
  await fs.appendFile(path.join(root, "docs/guide.md"), "Audience: maintainers.\n"); git(root, "commit", "-qam", "guide");
  await fs.mkdir(path.join(root, ".ai-org/artifacts/WK-0001"), { recursive: true });
  await fs.writeFile(path.join(root, ".ai-org/artifacts/WK-0001/check.md"), `Read the guide at ${git(root, "rev-parse", "HEAD")}\n`);
  assert.equal(workkeel(root, "task", "handoff", "--id", "WK-0001", "--actor", "builder", "--summary", "Guide updated",
    "--evidence", ".ai-org/artifacts/WK-0001/check.md").state, "test");
  await fs.writeFile(path.join(root, ".ai-org/artifacts/WK-0001/review.md"), "The audience line is present.\n");
  const self = spawnSync(process.execPath, [cli, "task", "review", "--id", "WK-0001", "--actor", "builder", "--judgment", "pass",
    "--summary", "Self review", "--evidence", ".ai-org/artifacts/WK-0001/review.md"], { cwd: root, encoding: "utf8" });
  assert.notEqual(self.status, 0); assert.match(self.stdout + self.stderr, /separation/);
  assert.equal(workkeel(root, "task", "review", "--id", "WK-0001", "--actor", "reviewer", "--judgment", "pass",
    "--summary", "Meets the criterion", "--evidence", ".ai-org/artifacts/WK-0001/review.md").state, "release_gate");
  assert.equal(workkeel(root, "task", "close", "--id", "WK-0001", "--actor", "builder", "--summary", "Accepted",
    "--rollback", "Revert the guide commit", "--evidence", ".ai-org/artifacts/WK-0001/review.md").state, "done");
  assert.equal(workkeel(root, "doctor").valid, true);
  assert.deepEqual(await jsonFiles(root), [], "no hand-written JSON request or contract files");
});

test("abbreviated --revision values resolve to the full commit; low work needs no evidence", async t => {
  const root = await repository(t);
  workkeel(root, "init", "--solo");
  await fs.writeFile(path.join(root, ".gitignore"), ".workkeel/\n");
  git(root, "add", "-A"); git(root, "commit", "-qm", "base");
  workkeel(root, "task", "new", "--goal", "Tidy the guide", "--acceptance", "The guide is tidy", "--write", "docs", "--actor", "builder");
  workkeel(root, "task", "claim", "--id", "WK-0001", "--actor", "builder");
  await fs.appendFile(path.join(root, "docs/guide.md"), "Tidied.\n"); git(root, "commit", "-qam", "tidy");
  const full = git(root, "rev-parse", "HEAD"), short = full.slice(0, 9);
  const bad = spawnSync(process.execPath, [cli, "task", "handoff", "--id", "WK-0001", "--actor", "builder", "--summary", "Tidied", "--revision", "ffff0000"], { cwd: root, encoding: "utf8" });
  assert.notEqual(bad.status, 0); assert.match(bad.stdout + bad.stderr, /does not name exactly one commit/);
  assert.equal(workkeel(root, "task", "handoff", "--id", "WK-0001", "--actor", "builder", "--summary", "Tidied", "--revision", short).candidate_revision, full);
  assert.equal(workkeel(root, "task", "review", "--id", "WK-0001", "--actor", "reviewer", "--judgment", "pass", "--summary", "Tidy", "--revision", short).state, "release_gate");
  const item = await readNativeTask(root, "WK-0001");
  assert.equal(item.review.revision, full); assert.deepEqual(item.delivery.evidence, []); assert.deepEqual(item.review.evidence, []);
});

test("the local default actor, derived operation IDs and repeated-flag rejection", async t => {
  const root = await repository(t);
  workkeel(root, "init", "--solo", "--principal", "maria");
  await fs.writeFile(path.join(root, ".gitignore"), ".workkeel/\n");
  git(root, "add", "-A"); git(root, "commit", "-qm", "base");
  const missing = spawnSync(process.execPath, [cli, "task", "new", "--goal", "G", "--acceptance", "A"], { cwd: root, encoding: "utf8" });
  assert.notEqual(missing.status, 0); assert.match(missing.stdout + missing.stderr, /--actor/);
  await fs.mkdir(path.join(root, ".workkeel")); await fs.writeFile(path.join(root, ".workkeel/local.json"), JSON.stringify({ agent_id: "builder" }));
  assert.equal(workkeel(root, "task", "new", "--goal", "Fix a total", "--acceptance", "Total is right").id, "WK-0001");
  const item = await readNativeTask(root, "WK-0001");
  assert.equal(item.contract.verification.risk_tier, "standard", "code-wide write paths default to standard");
  assert.match(item.history[0].operation_id, /^cli-create-[a-f0-9]{24}$/);
  const twice = spawnSync(process.execPath, [cli, "task", "claim", "--id", "WK-0001", "--id", "WK-0002"], { cwd: root, encoding: "utf8" });
  assert.notEqual(twice.status, 0); assert.match(twice.stdout + twice.stderr, /repeated/);
  assert.equal(workkeel(root, "policy", "show").principals[0], "maria");
});

test("the short help lists only the everyday commands", async t => {
  const help = spawnSync(process.execPath, [cli, "help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  t.assert.snapshot(help.stdout);
  assert.ok(help.stdout.split("\n").length <= 16);
  const advanced = spawnSync(process.execPath, [cli, "help", "advanced"], { encoding: "utf8" }).stdout;
  assert.match(advanced, /workkeel task create \[target\] --source contract\.json --request request\.json/);
  assert.match(advanced, /policy update/);
});

const fails = (root, ...args) => {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
  assert.notEqual(result.status, 0, args.join(" "));
  return result.stdout + result.stderr;
};
async function solo(t, principal = "owner") {
  const root = await repository(t);
  workkeel(root, "init", "--solo", "--principal", principal);
  await fs.writeFile(path.join(root, ".gitignore"), ".workkeel/\n");
  git(root, "add", "-A"); git(root, "commit", "-qm", "base");
  return root;
}

test("retrying a flag command after it succeeded replays it instead of failing", async t => {
  const root = await solo(t);
  const args = ["task", "new", "--goal", "Clarify the guide", "--acceptance", "Audience named", "--write", "docs", "--actor", "builder"];
  assert.equal(workkeel(root, ...args).id, "WK-0001");
  const again = workkeel(root, ...args);
  assert.equal(again.id, "WK-0001"); assert.equal(again.replayed, true);
  const claim = ["task", "claim", "--id", "WK-0001", "--actor", "builder"];
  assert.equal(workkeel(root, ...claim).replayed, false);
  assert.equal(workkeel(root, ...claim).replayed, true);
  await fs.appendFile(path.join(root, "docs/guide.md"), "Audience: maintainers.\n"); git(root, "commit", "-qam", "guide");
  await fs.mkdir(path.join(root, ".ai-org/artifacts/WK-0001"), { recursive: true });
  await fs.writeFile(path.join(root, ".ai-org/artifacts/WK-0001/check.md"), "Checked\n");
  const handoff = ["task", "handoff", "--id", "WK-0001", "--actor", "builder", "--summary", "Done", "--evidence", ".ai-org/artifacts/WK-0001/check.md"];
  assert.equal(workkeel(root, ...handoff).state, "test");
  const retried = workkeel(root, ...handoff);
  assert.equal(retried.replayed, true); assert.equal(retried.version, 3);
  const item = await readNativeTask(root, "WK-0001");
  assert.ok(item.history.every(event => event.operation_id.length <= 96));
  // A different command is a new operation, not a replay of the earlier one.
  assert.match(fails(root, "task", "claim", "--id", "WK-0001", "--actor", "builder", "--base", git(root, "rev-parse", "HEAD")), /already claimed|not available/);
});

test("long task IDs keep a bounded operation ID", async t => {
  const root = await solo(t);
  const id = "W" + "k".repeat(95);
  const created = workkeel(root, "task", "new", "--id", id, "--goal", "Long ID", "--acceptance", "Created", "--write", "docs", "--actor", "builder");
  assert.equal(created.id, id);
  assert.ok((await readNativeTask(root, id)).history[0].operation_id.length <= 96);
});

test("critical work needs an approval record before it can start or escalate", async t => {
  const root = await solo(t);
  assert.match(fails(root, "task", "new", "--goal", "Ship", "--acceptance", "Shipped", "--risk", "critical", "--actor", "builder"), /approval_ref/);
  await fs.writeFile(path.join(root, "docs/approval.md"), "Approved critical deploy.\n"); git(root, "add", "docs"); git(root, "commit", "-qm", "approval");
  assert.equal(workkeel(root, "task", "new", "--goal", "Ship", "--acceptance", "Shipped", "--risk", "critical", "--approval", "docs/approval.md", "--actor", "builder").state, "intake");

  const escalating = await solo(t);
  const policy = workkeel(escalating, "policy", "show");
  await fs.mkdir(path.join(escalating, ".workkeel")); await fs.writeFile(path.join(escalating, ".workkeel/policy.json"), JSON.stringify({ ...policy, risk_paths: { critical: ["deploy/**"] } }));
  assert.equal(workkeel(escalating, "policy", "update", "--policy", ".workkeel/policy.json", "--actor", "builder").updated, true);
  git(escalating, "commit", "-qam", "policy");
  workkeel(escalating, "task", "new", "--goal", "Tidy", "--acceptance", "Tidy", "--actor", "builder");
  workkeel(escalating, "task", "claim", "--id", "WK-0001", "--actor", "builder");
  await fs.mkdir(path.join(escalating, "deploy")); await fs.writeFile(path.join(escalating, "deploy/run.sh"), "echo v2\n");
  git(escalating, "add", "deploy"); git(escalating, "commit", "-qm", "deploy");
  await fs.mkdir(path.join(escalating, ".ai-org/artifacts/WK-0001"), { recursive: true });
  await fs.writeFile(path.join(escalating, ".ai-org/artifacts/WK-0001/check.md"), "Checked\n");
  assert.match(fails(escalating, "task", "handoff", "--id", "WK-0001", "--actor", "builder", "--summary", "Done", "--rollback", "Revert",
    "--evidence", ".ai-org/artifacts/WK-0001/check.md"), /approval_ref/);
  assert.equal((await readNativeTask(escalating, "WK-0001")).state, "build");
});

test("policy update needs an approving Principal, is idempotent and stops tasks approved under the old policy", async t => {
  const root = await solo(t);
  workkeel(root, "task", "new", "--goal", "Tidy", "--acceptance", "Tidy", "--write", "docs", "--actor", "builder");
  const team = { schema_version: "workkeel.task-policy/v1", principals: ["owner", "helper"],
    agents: [{ agent_id: "builder", principal_id: "owner" }, { agent_id: "reviewer", principal_id: "owner" }, { agent_id: "assistant", principal_id: "helper" }],
    approvers: ["owner"], review_separation: "distinct-agent" };
  await fs.mkdir(path.join(root, ".workkeel")); await fs.writeFile(path.join(root, ".workkeel/team.json"), JSON.stringify(team));
  assert.equal(workkeel(root, "policy", "update", "--policy", ".workkeel/team.json", "--actor", "builder").updated, true);
  assert.equal(workkeel(root, "policy", "update", "--policy", ".workkeel/team.json", "--actor", "builder").updated, false);
  assert.deepEqual(workkeel(root, "policy", "show").principals, ["owner", "helper"]);
  assert.match(fails(root, "policy", "update", "--policy", ".workkeel/team.json", "--actor", "assistant"), /approving Principal/);
  assert.match(fails(root, "task", "claim", "--id", "WK-0001", "--actor", "builder"), /policy changed/);
});

test("a created task's command keeps replaying after the task moves on", async t => {
  const root = await solo(t);
  const args = ["task", "new", "--goal", "Clarify the guide", "--acceptance", "Audience named", "--write", "docs", "--actor", "builder"];
  assert.equal(workkeel(root, ...args).id, "WK-0001");
  workkeel(root, "task", "claim", "--id", "WK-0001", "--actor", "builder");
  const again = workkeel(root, ...args);
  assert.equal(again.id, "WK-0001"); assert.equal(again.replayed, true);
  assert.deepEqual((await fs.readdir(path.join(root, ".ai-org/work-items"))).sort(), ["WK-0001.json"]);
});

test("a different failed command never disturbs the replay of an earlier successful one", async t => {
  const root = await solo(t);
  workkeel(root, "task", "new", "--goal", "Tidy", "--acceptance", "Tidy", "--write", "docs", "--actor", "builder");
  const claimA = ["task", "claim", "--id", "WK-0001", "--actor", "builder"];
  assert.equal(workkeel(root, ...claimA).replayed, false);
  fails(root, "task", "claim", "--id", "WK-0001", "--actor", "builder", "--base", git(root, "rev-parse", "HEAD"));
  assert.equal(workkeel(root, ...claimA).replayed, true);
  // Identical commands in separate processes both succeed with one task between them.
  const racing = ["task", "new", "--goal", "Race", "--acceptance", "One task", "--write", "docs", "--actor", "builder"];
  const results = await Promise.all([0, 1].map(() => new Promise(resolve => {
    const child = spawn(process.execPath, [cli, ...racing], { cwd: root });
    let out = "", err = ""; child.stdout.on("data", chunk => { out += chunk; }); child.stderr.on("data", chunk => { err += chunk; });
    child.on("close", code => resolve({ code, out, err }));
  })));
  for (const result of results) assert.equal(result.code, 0, result.out + result.err);
  assert.equal(new Set(results.map(result => JSON.parse(result.out).id)).size, 1);
  assert.equal((await fs.readdir(path.join(root, ".ai-org/work-items"))).length, 2);
});

test("the order of repeated set-like flags does not create a second task", async t => {
  const root = await solo(t);
  await fs.mkdir(path.join(root, "src")); await fs.writeFile(path.join(root, "src/a.mjs"), "export {};\n");
  const first = workkeel(root, "task", "new", "--goal", "Two roots", "--acceptance", "Done", "--write", "docs", "--write", "src", "--actor", "builder");
  const swapped = workkeel(root, "task", "new", "--goal", "Two roots", "--acceptance", "Done", "--write", "src", "--write", "docs", "--actor", "builder");
  assert.equal(swapped.id, first.id); assert.equal(swapped.replayed, true);
  // Ordered criteria stay distinct commands.
  const reordered = workkeel(root, "task", "new", "--goal", "Ordered", "--acceptance", "First", "--acceptance", "Second", "--write", "docs", "--actor", "builder");
  const other = workkeel(root, "task", "new", "--goal", "Ordered", "--acceptance", "Second", "--acceptance", "First", "--write", "docs", "--actor", "builder");
  assert.notEqual(other.id, reordered.id);
});

const claimOptions = { "--id": "WK-0001", "--actor": "builder" };
const barrier = count => { let arrived = 0, open; const ready = new Promise(resolve => { open = resolve; });
  return async () => { arrived += 1; if (arrived === count) open(); await ready; }; };

test("a command that read a stale task snapshot still replays the claim that succeeded", async t => {
  const root = await solo(t);
  workkeel(root, "task", "new", "--goal", "Tidy", "--acceptance", "Tidy", "--write", "docs", "--actor", "builder");
  workkeel(root, "task", "claim", "--id", "WK-0001", "--actor", "builder");
  // A reads v2 and pauses; meanwhile the task is released (v3) and claimed again by the same command (v4).
  const result = await runLifecycleFromFlags(root, "WK-0001", "claim", claimOptions, { afterSnapshot: async item => {
    assert.equal(item.version, 2);
    workkeel(root, "task", "release", "--id", "WK-0001", "--actor", "builder", "--summary", "Pause");
    workkeel(root, "task", "claim", "--id", "WK-0001", "--actor", "builder");
  } });
  assert.equal(result.state, "build");
  const after = workkeel(root, "task", "claim", "--id", "WK-0001", "--actor", "builder");
  assert.equal(after.replayed, true); assert.equal(after.version, 4);
  const item = await readNativeTask(root, "WK-0001");
  assert.deepEqual(item.history.map(event => event.action), ["create", "claim", "release", "claim"]);

  // A snapshot taken before the first claim resends that claim instead of creating a failing one.
  const fresh = await solo(t);
  workkeel(fresh, "task", "new", "--goal", "Tidy", "--acceptance", "Tidy", "--write", "docs", "--actor", "builder");
  const replayed = await runLifecycleFromFlags(fresh, "WK-0001", "claim", claimOptions, { afterSnapshot: async () => {
    workkeel(fresh, "task", "claim", "--id", "WK-0001", "--actor", "builder");
  } });
  assert.equal(replayed.replayed, true);
  assert.equal(workkeel(fresh, "task", "claim", "--id", "WK-0001", "--actor", "builder").replayed, true);
  assert.equal((await readNativeTask(fresh, "WK-0001")).history.length, 2);
});

test("identical commands forced to overlap both succeed with exactly one operation", async t => {
  const root = await solo(t);
  const createOptions = { "--goal": "Race", "--acceptance": ["One task"], "--write": ["docs"], "--actor": "builder" };
  const createGate = barrier(2);
  const created = await Promise.all([0, 1].map(() => runCreateFromFlags(root, createOptions, { beforeMutation: createGate })));
  assert.deepEqual(created.map(result => result.id), ["WK-0001", "WK-0001"]);
  assert.deepEqual(created.map(result => result.replayed).sort(), [false, true]);
  assert.equal((await readNativeTask(root, "WK-0001")).history.length, 1);
  // A second claim attempt after a release: both contenders adopt one new attempt.
  workkeel(root, "task", "claim", "--id", "WK-0001", "--actor", "builder");
  workkeel(root, "task", "release", "--id", "WK-0001", "--actor", "builder", "--summary", "Pause");
  const claimGate = barrier(2);
  const claimed = await Promise.all([0, 1].map(() => runLifecycleFromFlags(root, "WK-0001", "claim", claimOptions, { beforeMutation: claimGate })));
  assert.deepEqual(claimed.map(result => result.replayed).sort(), [false, true]);
  const item = await readNativeTask(root, "WK-0001");
  assert.deepEqual(item.history.map(event => event.action), ["create", "claim", "release", "claim"]);
  assert.notEqual(item.history[1].operation_id, item.history[3].operation_id);
});

test("a retried command stops instead of moving to a new candidate or claim", async t => {
  const root = await solo(t);
  workkeel(root, "task", "new", "--goal", "Tidy", "--acceptance", "Tidy", "--write", "docs", "--actor", "builder");
  workkeel(root, "task", "claim", "--id", "WK-0001", "--actor", "builder");
  const deliver = async (line, note) => {
    await fs.appendFile(path.join(root, "docs/guide.md"), line); git(root, "commit", "-qam", note);
    const ref = `.ai-org/artifacts/WK-0001/${note}.md`;
    await fs.mkdir(path.join(root, ".ai-org/artifacts/WK-0001"), { recursive: true }); await fs.writeFile(path.join(root, ref), `${note}\n`);
    workkeel(root, "task", "handoff", "--id", "WK-0001", "--actor", "builder", "--summary", note, "--evidence", ref);
    git(root, "add", ".ai-org"); git(root, "commit", "-qm", `record ${note}`);
    return (await readNativeTask(root, "WK-0001")).delivery.revision;
  };
  const candidateA = await deliver("A\n", "candidate-a");
  await fs.writeFile(path.join(root, ".ai-org/artifacts/WK-0001/review.md"), "Pass\n");
  // While this pass review of A waits, A is failed, reworked, reclaimed and B is handed off.
  const review = runLifecycleFromFlags(root, "WK-0001", "review", { "--id": "WK-0001", "--actor": "reviewer", "--judgment": "pass",
    "--summary": "Meets the criterion", "--evidence": [".ai-org/artifacts/WK-0001/review.md"] }, { beforeMutation: async request => {
    if (request.revision !== candidateA) return;
    await fs.writeFile(path.join(root, ".ai-org/artifacts/WK-0001/fail.md"), "Fail\n");
    // The waiting pass report is untracked product drift for other operations; set it aside meanwhile.
    await fs.rename(path.join(root, ".ai-org/artifacts/WK-0001/review.md"), path.join(root, ".git/review.md.hold"));
    workkeel(root, "task", "review", "--id", "WK-0001", "--actor", "reviewer", "--judgment", "fail", "--summary", "Missing", "--evidence", ".ai-org/artifacts/WK-0001/fail.md");
    workkeel(root, "task", "rework", "--id", "WK-0001", "--actor", "builder", "--summary", "Fix it");
    git(root, "add", ".ai-org"); git(root, "commit", "-qm", "record failed review");
    workkeel(root, "task", "claim", "--id", "WK-0001", "--actor", "builder");
    await deliver("B\n", "candidate-b");
    await fs.rename(path.join(root, ".git/review.md.hold"), path.join(root, ".ai-org/artifacts/WK-0001/review.md"));
  } });
  await assert.rejects(review, /first targeted revision/);
  const afterReview = await readNativeTask(root, "WK-0001");
  assert.equal(afterReview.state, "test"); assert.equal(afterReview.review, null); assert.notEqual(afterReview.delivery.revision, candidateA);

  const releasing = await solo(t);
  workkeel(releasing, "task", "new", "--goal", "Tidy", "--acceptance", "Tidy", "--write", "docs", "--actor", "builder");
  const firstClaim = workkeel(releasing, "task", "claim", "--id", "WK-0001", "--actor", "builder").claim.id;
  const release = runLifecycleFromFlags(releasing, "WK-0001", "release", { "--id": "WK-0001", "--actor": "builder", "--summary": "Stop" }, {
    beforeMutation: async request => {
      if (request.claim_id !== firstClaim) return;
      workkeel(releasing, "task", "release", "--id", "WK-0001", "--actor", "builder", "--summary", "Pause");
      workkeel(releasing, "task", "claim", "--id", "WK-0001", "--actor", "builder", "--base", git(releasing, "rev-parse", "HEAD"));
    } });
  await assert.rejects(release, /first targeted claim_id/);
  const afterRelease = await readNativeTask(releasing, "WK-0001");
  assert.equal(afterRelease.state, "build"); assert.notEqual(afterRelease.claim.id, firstClaim);
});

// Target binding matrix: every state-changing command x every way its target can change.
const ID = "WK-0001", B = "builder", R = "reviewer";
const head = root => git(root, "rev-parse", "HEAD");
async function record(root, ref, text) {
  await fs.mkdir(path.join(root, path.dirname(ref)), { recursive: true }); await fs.writeFile(path.join(root, ref), text);
}
const commitRecords = (root, note) => { git(root, "add", ".ai-org"); git(root, "commit", "-qm", note); };
async function deliver(root, note) {
  await fs.appendFile(path.join(root, "docs/guide.md"), `${note}\n`); git(root, "commit", "-qam", note);
  const ref = `.ai-org/artifacts/${ID}/${note}.md`; await record(root, ref, `${note}\n`);
  workkeel(root, "task", "handoff", "--id", ID, "--actor", B, "--summary", note, "--evidence", ref); commitRecords(root, `record ${note}`);
}
async function judge(root, judgment, note) {
  const ref = `.ai-org/artifacts/${ID}/${note}.md`; await record(root, ref, `${note}\n`);
  workkeel(root, "task", "review", "--id", ID, "--actor", R, "--judgment", judgment, "--summary", note, "--evidence", ref); commitRecords(root, `record ${note}`);
}
const states = {
  claimed: async root => { workkeel(root, "task", "new", "--goal", "Tidy", "--acceptance", "Tidy", "--write", "docs", "--actor", B); workkeel(root, "task", "claim", "--id", ID, "--actor", B); },
  delivered: async root => { await states.claimed(root); await deliver(root, "candidate-a"); },
  failed: async root => { await states.delivered(root); await judge(root, "fail", "fail-a"); }
};
const retargets = {
  // Another flow releases and claims again, so the claim changes.
  newClaim: async root => { workkeel(root, "task", "release", "--id", ID, "--actor", B, "--summary", "Pause");
    workkeel(root, "task", "claim", "--id", ID, "--actor", B, "--base", head(root)); },
  // The delivered candidate A fails, is reworked and replaced by B.
  newCandidate: async root => { await judge(root, "fail", "fail-a"); workkeel(root, "task", "rework", "--id", ID, "--actor", B, "--summary", "Fix A");
    workkeel(root, "task", "claim", "--id", ID, "--actor", B, "--base", head(root)); await deliver(root, "candidate-b"); },
  // From failed A: another rework, B delivered and failed too.
  newFailedCandidate: async root => { workkeel(root, "task", "rework", "--id", ID, "--actor", B, "--summary", "Other rework");
    workkeel(root, "task", "claim", "--id", ID, "--actor", B, "--base", head(root)); await deliver(root, "candidate-b"); await judge(root, "fail", "fail-b"); },
  // A fails; B is delivered and passes, reaching the release gate.
  newPassedCandidate: async root => { await retargets.newCandidate(root); await judge(root, "pass", "pass-b"); },
  // Only the commit moves: same claim, new HEAD.
  newCommit: async root => { await fs.appendFile(path.join(root, "docs/guide.md"), "More\n"); git(root, "commit", "-qam", "more"); }
};
const commands = {
  release: { "--id": ID, "--actor": B, "--summary": "Stop" },
  handoff: { "--id": ID, "--actor": B, "--summary": "Done", "--evidence": [`.ai-org/artifacts/${ID}/done.md`] },
  review: { "--id": ID, "--actor": R, "--judgment": "pass", "--summary": "Looks right", "--evidence": [`.ai-org/artifacts/${ID}/ok.md`] },
  rework: { "--id": ID, "--actor": B, "--summary": "Address the failure" },
  close: { "--id": ID, "--actor": B, "--summary": "Accepted", "--rollback": "Revert", "--evidence": [`.ai-org/artifacts/${ID}/ok.md`] }
};
// A leftover attempt from before binding existed: same command, aimed at the new target, never sent.
async function leaveRetargetedAttempt(root, action, first, { legacy }) {
  const base = path.join(root, ".git/workkeel/cli-operations", ID);
  for (const dir of await fs.readdir(base)) {
    const saved = await readSaved(path.join(base, dir, "1.json"));
    if (saved?.request.operation_id !== first.operation_id) continue;
    const item = await readNativeTask(root, ID), request = { ...saved.request, operation_id: `${saved.request.operation_id}-old`, expected_version: item.version };
    if ("claim_id" in request) request.claim_id = item.claim?.id;
    if ("revision" in request) request.revision = action === "handoff" ? head(root) : item.delivery.revision;
    const value = { key: saved.key, request };
    if (!legacy) value.target = action === "rework" ? { revision: item.delivery.revision } : Object.fromEntries(Object.entries(request).filter(([k]) => ["claim_id", "revision"].includes(k)));
    await fs.writeFile(path.join(base, dir, "2.json"), JSON.stringify(value));
    return;
  }
  throw new Error("first attempt not found");
}
const readSaved = async file => JSON.parse(await fs.readFile(file, "utf8"));
async function stripTarget(root, first) {
  const base = path.join(root, ".git/workkeel/cli-operations", ID);
  for (const dir of await fs.readdir(base)) {
    const file = path.join(base, dir, "1.json"), saved = await readSaved(file);
    if (saved.request.operation_id !== first.operation_id) continue;
    delete saved.target; await fs.writeFile(file, JSON.stringify(saved)); return;
  }
  throw new Error("first attempt not found");
}
const matrix = [
  ["release", "claimed", "newClaim", "new"], ["release", "claimed", "newClaim", "pending"], ["release", "claimed", "newClaim", "legacy"],
  ["handoff", "claimed", "newClaim", "new"], ["handoff", "claimed", "newClaim", "pending"], ["handoff", "claimed", "newClaim", "legacy"],
  ["review", "delivered", "newCandidate", "new"], ["review", "delivered", "newCandidate", "pending"], ["review", "delivered", "newCandidate", "legacy"],
  ["rework", "failed", "newFailedCandidate", "new"], ["rework", "failed", "newFailedCandidate", "pending"], ["rework", "failed", "newFailedCandidate", "legacy"],
  ["close", "delivered", "newPassedCandidate", "pending"], ["close", "delivered", "newPassedCandidate", "legacy"],
  ["close", "delivered", "newPassedCandidate", "new"],
  ["handoff", "claimed", "newCommit", "pending"], ["handoff", "claimed", "newCommit", "new"],
  ["release", "claimed", "newClaim", "legacy-first"], ["review", "delivered", "newCandidate", "legacy-first"],
  ["rework", "failed", "newFailedCandidate", "legacy-first"]
];
for (const [action, state, retarget, kind] of matrix) {
  test(`target binding: ${action} stops when its target changes (${retarget}, ${kind} attempt)`, async t => {
    const root = await solo(t);
    await states[state](root);
    if (action === "handoff") { await fs.appendFile(path.join(root, "docs/guide.md"), "Work\n"); git(root, "commit", "-qam", "work");
      if (retarget === "newCommit") await record(root, `.ai-org/artifacts/${ID}/done.md`, "Done\n"); }
    const before = await readNativeTask(root, ID);
    let run;
    if (kind === "new") {
      let moved = false;
      run = runLifecycleFromFlags(root, ID, action, commands[action], { beforeMutation: async () => { if (!moved) { moved = true; await retargets[retarget](root); } } });
    } else if (kind === "legacy-first") {
      // The very first attempt was saved before targets were recorded.
      const first = await lifecycleRequestFromFlags(root, ID, action, commands[action]);
      await stripTarget(root, first);
      await retargets[retarget](root);
      run = runLifecycleFromFlags(root, ID, action, commands[action]);
    } else {
      const first = await lifecycleRequestFromFlags(root, ID, action, commands[action]);
      await retargets[retarget](root);
      await leaveRetargetedAttempt(root, action, first, { legacy: kind === "legacy" });
      run = runLifecycleFromFlags(root, ID, action, commands[action]);
    }
    const revisionOnly = retarget === "newCommit";
    await assert.rejects(run, (kind === "legacy" || kind === "legacy-first") && action === "rework" ? /no recorded target/
      : revisionOnly ? /current commit|first targeted/ : /first targeted/);
    const after = await readNativeTask(root, ID);
    if (!revisionOnly) assert.ok(after.version > before.version, "the target really changed");
    else assert.equal(after.state, "build", "the new commit was never handed off");
    assert.ok(!after.history.some(event => event.operation_id.startsWith(`cli-${action}-`) && event.summary === commands[action]["--summary"]),
      `${action} was never applied to the new target`);
  });
}

test("target binding: claim, cancel and create bind only the task", async t => {
  const root = await solo(t);
  await states.claimed(root);
  workkeel(root, "task", "release", "--id", ID, "--actor", B, "--summary", "Pause");
  // The same claim command later makes a fresh claim; its base revision is deliberately not bound.
  assert.equal(workkeel(root, "task", "claim", "--id", ID, "--actor", B).replayed, false);
  await record(root, `.ai-org/artifacts/${ID}/cancel.md`, "No longer needed\n");
  const cancel = ["task", "cancel", "--id", ID, "--actor", B, "--summary", "Stop", "--evidence", `.ai-org/artifacts/${ID}/cancel.md`];
  assert.equal(workkeel(root, ...cancel).state, "cancelled"); assert.equal(workkeel(root, ...cancel).replayed, true);
});

test("an attempt another process saved first is adopted only if it aims at the same target", async t => {
  const root = await solo(t);
  await states.delivered(root);
  const candidateA = (await readNativeTask(root, ID)).delivery.revision;
  const review = runLifecycleFromFlags(root, ID, "review", commands.review, { beforeSave: async (dir, number, key) => {
    // Between this command's check and its save, the task moves to B and another
    // process saves this same command's attempt aimed at B.
    await retargets.newCandidate(root);
    const item = await readNativeTask(root, ID);
    await record(root, `.ai-org/artifacts/${ID}/ok.md`, "Pass\n");
    const request = { operation_id: "cli-review-other-process", expected_version: item.version, actor: { agent_id: R, principal_id: "owner" },
      revision: item.delivery.revision, judgment: "pass", summary: "Looks right", evidence: [`.ai-org/artifacts/${ID}/ok.md`] };
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${number}.json`), JSON.stringify({ key, request, target: { revision: item.delivery.revision } }));
  } });
  await assert.rejects(review, /first targeted revision/);
  const item = await readNativeTask(root, ID);
  assert.notEqual(item.delivery.revision, candidateA); assert.equal(item.review, null, "the pass for A never lands on B");
});

test("rework honours an explicit --revision only when it names the failed candidate", async t => {
  const root = await solo(t);
  await states.failed(root);
  const failed = (await readNativeTask(root, ID)).delivery.revision;
  assert.match(fails(root, "task", "rework", "--id", ID, "--actor", B, "--summary", "Fix", "--revision", "0".repeat(40)), /current revision/);
  // An empty value is refused like any mismatch, never treated as absent.
  assert.match(fails(root, "task", "rework", "--id", ID, "--actor", B, "--summary", "Fix", "--revision="), /must not be empty/);
  assert.match(fails(root, "task", "rework", "--id", ID, "--actor", B, "--summary", "Fix", "--revision="), /must not be empty/);
  assert.equal(workkeel(root, "task", "rework", "--id", ID, "--actor", B, "--summary", "Fix", "--revision", failed).state, "intake");
});

test("a request left pending for an old candidate is never resent to a newer one", async t => {
  const root = await solo(t);
  await states.failed(root);
  const candidateA = (await readNativeTask(root, ID)).delivery.revision, version = (await readNativeTask(root, ID)).version;
  const options = { "--id": ID, "--actor": B, "--summary": "Address A", "--revision": candidateA };
  // A request for a version the task has not reached is refused, and nothing is saved.
  await assert.rejects(lifecycleRequestFromFlags(root, ID, "rework", { ...options, "--expect": String(version + 4) }), /does not match the task's current version/);
  // An older CLI could still have left this pending request for candidate A behind.
  const first = await lifecycleRequestFromFlags(root, ID, "rework", options);
  await retargets.newFailedCandidate(root);
  const item = await readNativeTask(root, ID);
  const base = path.join(root, ".git/workkeel/cli-operations", ID);
  for (const dir of await fs.readdir(base)) {
    const file = path.join(base, dir, "1.json"), saved = await readSaved(file).catch(() => null);
    if (saved?.request.operation_id !== first.operation_id) continue;
    saved.request.expected_version = item.version; await fs.writeFile(file, JSON.stringify(saved));
  }
  await assert.rejects(runLifecycleFromFlags(root, ID, "rework", options), /current revision/);
  const after = await readNativeTask(root, ID);
  assert.notEqual(after.delivery.revision, candidateA); assert.equal(after.state, "test", "B was not archived by A's rework");
});
