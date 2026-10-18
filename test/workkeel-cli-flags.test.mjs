import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readNativeTask } from "../src/workkeel-tasks.mjs";

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
