import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readNativeTask } from "../src/workkeel-tasks.mjs";
import { defaultPolicy } from "../src/workkeel-project.mjs";
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
const fails = (root, ...args) => {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
  assert.notEqual(result.status, 0, args.join(" "));
  return result.stdout + result.stderr;
};
const jsonFiles = async root => (await fs.readdir(root, { recursive: true }))
  .filter(name => name.endsWith(".json") && !name.startsWith(".git/") && !name.startsWith(".ai-org/")).sort();

test("unborn HEAD is diagnosed by doctor and candidate operations without raw Git errors", async t => {
  const root = await repository(t), initialized = workkeel(root, "init");
  assert.deepEqual(initialized.commit, ["workkeel.lock", "workkeelw.mjs", "WORKKEEL.md"]);
  assert.match(initialized.next_action, /after task records are created/);
  const doctor = spawnSync(process.execPath, [cli, "doctor"], { cwd: root, encoding: "utf8" });
  assert.equal(doctor.status, 1);
  const diagnostic = JSON.parse(doctor.stdout);
  assert.equal(diagnostic.valid, false);
  assert.ok(diagnostic.errors.some(error => error.next_action === "git add -A && git commit -m baseline"));
  workkeel(root, "task", "new", "--goal", "Guide", "--acceptance", "Readable", "--write", "docs", "--actor", "builder");
  const record = path.join(root, ".ai-org/work-items/WK-0001.json"), before = await fs.readFile(record);
  for (const [action, flags] of [["claim", []], ["claim", ["--base", "a".repeat(40)]],
    ["handoff", ["--summary", "Done"]], ["handoff", ["--summary", "Done", "--revision", "abcd"]],
    ["review", ["--summary", "Reviewed", "--judgment", "pass"]], ["close", ["--summary", "Accept", "--rollback", "Revert"]]]) {
    const error = JSON.parse(fails(root, "task", action, "--id", "WK-0001", "--actor", "builder", ...flags));
    assert.equal(error.schema_version, "workkeel.operation-error/v1");
    assert.equal(error.message, "This repository has no commits. Make a baseline commit first (git add -A && git commit -m baseline), then retry.");
    assert.doesNotMatch(error.message, /fatal:|ambiguous argument|Command failed/);
  }
  assert.deepEqual(await fs.readFile(record), before);
});

for (const later of ["outside", "reverted-records"]) test(`CLI close explains unreviewed ${later} commits`, async t => {
  const root = await repository(t);
  workkeel(root, "init"); git(root, "add", "-A"); git(root, "commit", "-qm", "Baseline");
  workkeel(root, "task", "new", "--goal", "Guide", "--acceptance", "Readable", "--write", "docs", "--risk", "low", "--actor", "builder");
  workkeel(root, "task", "claim", "--id", "WK-0001", "--actor", "builder");
  await fs.appendFile(path.join(root, "docs/guide.md"), "Audience: readers\n");
  git(root, "add", "-A"); git(root, "commit", "-qm", "Guide candidate");
  const revision = git(root, "rev-parse", "HEAD");
  workkeel(root, "task", "handoff", "--id", "WK-0001", "--actor", "builder", "--summary", "Done");
  workkeel(root, "task", "review", "--id", "WK-0001", "--actor", "reviewer", "--judgment", "pass", "--summary", "Reviewed");
  let extra;
  if (later === "outside") {
    await fs.writeFile(path.join(root, "app.js"), "export const value = 1;\n");
    git(root, "add", "app.js"); git(root, "commit", "-qm", "Outside work"); extra = git(root, "rev-parse", "HEAD");
  } else {
    await fs.appendFile(path.join(root, "docs/guide.md"), "Extra\n");
    git(root, "commit", "-qam", "Extra work and review record"); extra = git(root, "rev-parse", "HEAD");
    git(root, "revert", "--no-edit", "HEAD");
    assert.equal((await readNativeTask(root, "WK-0001")).state, "build");
  }
  const record = path.join(root, ".ai-org/work-items/WK-0001.json"), before = await fs.readFile(record);
  const error = JSON.parse(fails(root, "task", "close", "--id", "WK-0001", "--actor", "builder", "--summary", "Accept", "--rollback", "Revert"));
  assert.match(error.message, /unreviewed commit\(s\) after reviewed candidate/);
  assert.ok(error.message.includes(revision)); assert.ok(error.message.includes(extra.slice(0, 12)));
  assert.ok(error.message.includes("(1) check out the reviewed revision"));
  assert.ok(error.message.includes("(2) cancel this task and start a new task"));
  if (later === "reverted-records") assert.match(error.message, /task record was also reverted/);
  assert.deepEqual(await fs.readFile(record), before);
});

test("CLI errors preserve their envelope and give command-appropriate recovery guidance", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-error-guidance-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const neutral = "Read the message, fix the cause, then rerun the command.";
  const lifecycle = "Inspect task state and operation history before retrying the same operation ID.";
  const init = JSON.parse(fails(root, "init", "."));
  assert.deepEqual(init, {
    schema_version: "workkeel.operation-error/v1",
    message: "Task-first coordination requires an initialized Git repository; run `git init` here or choose the repository root",
    mutation_status: "inspect-before-retry", next_action: neutral
  });
  for (const [args, next] of [
    [["task", "new", "--goal", "Clarify the guide", "--acceptance", "The guide is clear"], lifecycle],
    [["task", "claim", "--id", "WK-0001", "--request", "claim.json"], lifecycle],
    [["task", "--json", "claim", "--id", "WK-0001"], lifecycle],
    [["--json", "task", "--id", "WK-0001", "claim"], lifecycle],
    [["task", "--summary", "claim", "show", "--id", "WK-0001"], neutral],
    [["task", "--json", "claim", "--id"], neutral],
    [["task", "claim", "--id"], lifecycle],
    [["task", "show", "--id", "WK-0001"], neutral],
    [["task", "unknown"], neutral],
    [["doctor"], neutral]
  ]) assert.equal(JSON.parse(fails(root, ...args)).next_action, next, args.join(" "));
  assert.deepEqual(await fs.readdir(root), [], "failed setup and guidance leave the empty folder untouched");
});

test("goal serve signal handlers drain close and report shutdown failures", async t => {
  const root = await repository(t);
  workkeel(root, 'init');
  const moduleURL = new URL('../src/workkeel-cli.mjs', import.meta.url).href;
  for (const signal of ['SIGINT', 'SIGTERM']) for (const rejectClose of [false, true]) {
    const source = `
      import assert from 'node:assert/strict';
      import {registerHooks} from 'node:module';
      const entered=Promise.withResolvers(),drain=Promise.withResolvers();let aborted=false;
      globalThis.goalServiceFixture={serveNativeGoal:async(_target,_id,{signal})=>({close:()=>{aborted=signal.aborted;entered.resolve();return drain.promise;}})};
      const stub='data:text/javascript,'+encodeURIComponent('export const serveNativeGoal=globalThis.goalServiceFixture.serveNativeGoal;');
      registerHooks({resolve(specifier,context,next){return specifier==='./workkeel-goals.mjs'&&context.parentURL===${JSON.stringify(moduleURL)}?{url:stub,shortCircuit:true}:next(specifier,context);}});
      const {workkeelMain}=await import(${JSON.stringify(moduleURL)});
      assert.equal(await workkeelMain(['goal','serve',${JSON.stringify(root)},'--id','synthetic-goal']),0);
      const stop=process.listeners(${JSON.stringify(signal)}).at(-1);
      let settled=false;const closing=Promise.resolve(stop()).then(()=>{settled=true;});
      await entered.promise;assert.equal(aborted,true);
      await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);
      ${rejectClose ? "drain.reject(Error('Synthetic shutdown failure'));" : 'drain.resolve();'}
      await closing;
      process.removeAllListeners('SIGINT');process.removeAllListeners('SIGTERM');
    `;
    const result = spawnSync(process.execPath, ['--unhandled-rejections=strict', '--input-type=module', '-e', source], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    if (rejectClose) assert.deepEqual(JSON.parse(result.stderr), {error:'Synthetic shutdown failure'});
    else assert.equal(result.stderr, '');
  }
});

test("defaultPolicy defaults model families and validates overrides as identifiers", () => {
  assert.deepEqual(defaultPolicy().agents.map(agent => agent.model_family), ["claude", "codex"]);
  assert.deepEqual(defaultPolicy("maria", { builder: "family-a", reviewer: "family-b" }).agents, [
    { agent_id: "builder", principal_id: "maria", model_family: "family-a" },
    { agent_id: "reviewer", principal_id: "maria", model_family: "family-b" }
  ]);
  for (const role of ["builder", "reviewer"]) for (const invalid of ["bad/family", "two words", "", "x".repeat(97)]) {
    assert.throws(() => defaultPolicy("owner", { [role]: invalid }), /Invalid task policy/);
  }
});

test("init allows independent model family overrides and refuses to rewrite an initialized project", async t => {
  for (const overrides of [{ builder: "family-a" }, { reviewer: "family-b" }, { builder: "family-a", reviewer: "family-b" }]) {
    const root = await repository(t);
    workkeel(root, "init", ".", "--principal", "maria", ...Object.entries(overrides).flatMap(([role, family]) => [`--${role}`, family]));
    assert.deepEqual(workkeel(root, "policy", "show").agents, defaultPolicy("maria", overrides).agents);
    const lock = await fs.readFile(path.join(root, "workkeel.lock"));
    for (const args of [[], ["--builder", "replacement", "--reviewer", "replacement"]]) {
      assert.match(fails(root, "init", ...args), /never overwrites/);
      assert.deepEqual(await fs.readFile(path.join(root, "workkeel.lock")), lock);
    }
  }
});

test("init rejects invalid model families and model overrides alongside --policy", async t => {
  const root = await repository(t);
  for (const role of ["builder", "reviewer"]) {
    assert.match(fails(root, "init", `--${role}`, "bad/family"), /Invalid task policy/);
    assert.match(fails(root, "init", "--policy", "policy.json", `--${role}`, "family-a"), /not supported/);
    assert.match(fails(root, "init", `--${role}`, "family-a", `--${role}`, "family-b"), /repeated/);
  }
  await assert.rejects(fs.stat(path.join(root, "workkeel.lock")), { code: "ENOENT" });
});

test("plain init creates builder and reviewer, and a low task completes using only flags, without writing JSON", async t => {
  const root = await repository(t);
  const init = workkeel(root, "init");
  assert.deepEqual(init.suggested_gitignore, [".workkeel/"]);
  const policy = workkeel(root, "policy", "show");
  assert.deepEqual(policy.agents, [{ agent_id: "builder", principal_id: "owner", model_family: "claude" }, { agent_id: "reviewer", principal_id: "owner", model_family: "codex" }]);
  assert.deepEqual(policy.principals, ["owner"]); assert.deepEqual(policy.approvers, ["owner"]);
  for (const removed of ["--solo", "--team"]) assert.match(fails(root, "init", removed), /Unknown, repeated or incomplete Workkeel option/);
  assert.match(fails(root, "init", "--policy", "policy.json", "--principal", "maria"), /not supported/);
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
  workkeel(root, "init");
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

test("task close exits non-zero and lists commits made after the reviewed candidate", async t => {
  const root = await repository(t);
  workkeel(root, "init");
  await fs.writeFile(path.join(root, ".gitignore"), ".workkeel/\n");
  git(root, "add", "-A"); git(root, "commit", "-qm", "base");
  workkeel(root, "task", "new", "--goal", "Tidy the guide", "--acceptance", "The guide is tidy", "--write", "docs", "--actor", "builder");
  workkeel(root, "task", "claim", "--id", "WK-0001", "--actor", "builder");
  await fs.appendFile(path.join(root, "docs/guide.md"), "Tidied.\n"); git(root, "commit", "-qam", "tidy");
  const reviewed = git(root, "rev-parse", "HEAD");
  workkeel(root, "task", "handoff", "--id", "WK-0001", "--actor", "builder", "--summary", "Tidied");
  assert.equal(workkeel(root, "task", "review", "--id", "WK-0001", "--actor", "reviewer", "--judgment", "pass", "--summary", "Tidy").state, "release_gate");
  const later = [];
  for (const [file, subject] of [["docs/guide.md", "Retitle the guide"], ["NOTES.md", "Add release notes"]]) {
    await fs.appendFile(path.join(root, file), `${subject}\n`); git(root, "add", file); git(root, "commit", "-qm", subject);
    later.push(git(root, "rev-parse", "HEAD"));
  }
  const close = spawnSync(process.execPath, [cli, "task", "close", "--id", "WK-0001", "--actor", "builder", "--summary", "Accepted", "--rollback", "Revert the tidy commit"], { cwd: root, encoding: "utf8" });
  assert.notEqual(close.status, 0);
  const output = close.stdout + close.stderr;
  assert.ok(output.includes(reviewed));
  for (const revision of later) assert.ok(output.includes(revision.slice(0, 12)), revision);
  assert.match(output, /Retitle the guide/); assert.match(output, /Add release notes/);
  assert.ok(output.includes(`(1) check out the reviewed revision ${reviewed}, then close again`));
  assert.match(output, /\(2\) cancel this task and start a new task for the new commits/);
  assert.doesNotMatch(output, /rework/i);
  assert.equal((await readNativeTask(root, "WK-0001")).state, "release_gate");
});

test("the local default actor, derived operation IDs and repeated-flag rejection", async t => {
  const root = await repository(t);
  workkeel(root, "init", "--principal", "maria");
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
  // Optional subsystems stay out of the short help and are grouped in advanced help.
  const optional = ["monitor", "workspace", "workflow", "dispatch", "usage", "model-policy", "headroom", "learning", "skill-lifecycle", "goal", "autonomy", "retention"];
  const [core, extra] = advanced.split("Optional subsystems.");
  for (const command of optional) {
    assert.doesNotMatch(help.stdout, new RegExp(`workkeel ${command}\\b`));
    assert.doesNotMatch(core, new RegExp(`^workkeel ${command}\\b`, "m"));
    assert.match(extra, new RegExp(`^workkeel ${command}\\b`, "m"));
  }
});

async function initialized(t, principal = "owner") {
  const root = await repository(t);
  workkeel(root, "init", "--principal", principal);
  await fs.writeFile(path.join(root, ".gitignore"), ".workkeel/\n");
  git(root, "add", "-A"); git(root, "commit", "-qm", "base");
  return root;
}

test("retrying a flag command after it succeeded replays it instead of failing", async t => {
  const root = await initialized(t);
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
  const delivered = workkeel(root, ...handoff);
  assert.equal(delivered.state, "test");
  await fs.appendFile(path.join(root, "docs/guide.md"), "Later change.\n"); git(root, "commit", "-qam", "later");
  const retried = workkeel(root, ...handoff);
  assert.equal(retried.replayed, true); assert.equal(retried.version, 3);
  assert.deepEqual(retried, { ...delivered, replayed: true, mutation_status: "already-applied" });
  const item = await readNativeTask(root, "WK-0001");
  assert.ok(item.history.every(event => event.operation_id.length <= 96));
  // A different command is a new operation, not a replay of the earlier one.
  assert.match(fails(root, "task", "claim", "--id", "WK-0001", "--actor", "builder", "--base", git(root, "rev-parse", "HEAD")), /already claimed|not available/);
});

test("a rejected implicit handoff follows the repaired HEAD with a fresh operation ID", async t => {
  const root = await initialized(t);
  await states.claimed(root);
  await fs.writeFile(path.join(root, "outside.txt"), "Outside the approved roots.\n");
  git(root, "add", "outside.txt"); git(root, "commit", "-qm", "outside");
  const args = ["task", "handoff", "--id", ID, "--actor", B, "--summary", "Done"];
  const options = { "--id": ID, "--actor": B, "--summary": "Done" };
  assert.match(fails(root, ...args), /outside approved write roots/);
  const rejected = await lifecycleRequestFromFlags(root, ID, "handoff", options);
  assert.equal((await lifecycleRequestFromFlags(root, ID, "handoff", options)).operation_id, rejected.operation_id);
  // An explicit revision remains pinned even after the branch is repaired.
  assert.match(fails(root, ...args, "--revision", rejected.revision), /outside approved write roots/);
  git(root, "rm", "outside.txt");
  await fs.appendFile(path.join(root, "docs/guide.md"), "Tidied.\n"); git(root, "commit", "-qam", "repair");
  assert.match(fails(root, ...args, "--revision", rejected.revision), /current commit/);
  const result = workkeel(root, ...args);
  assert.equal(result.state, "test"); assert.equal(result.candidate_revision, head(root));
  const item = await readNativeTask(root, ID);
  assert.notEqual(item.history.at(-1).operation_id, rejected.operation_id);
  assert.equal(item.history.some(event => event.operation_id === rejected.operation_id), false);
  assert.equal(workkeel(root, ...args).replayed, true);
});

test("a rejected implicit claim refreshes its base when HEAD moves", async t => {
  const root = await initialized(t);
  await states.claimed(root);
  const id = workkeel(root, "task", "new", "--goal", "Another tidy", "--acceptance", "Tidy", "--write", "docs", "--actor", B).id;
  const args = ["task", "claim", "--id", id, "--actor", B];
  const options = { "--id": id, "--actor": B };
  assert.match(fails(root, ...args), /overlapping write roots/);
  const rejected = await lifecycleRequestFromFlags(root, id, "claim", options);
  assert.match(fails(root, ...args, "--base", rejected.base_revision), /overlapping write roots/);
  await retargets.newCommit(root);
  workkeel(root, "task", "release", "--id", ID, "--actor", B, "--summary", "Pause");
  assert.match(fails(root, ...args, "--base", rejected.base_revision), /current HEAD/);
  assert.equal(workkeel(root, ...args).state, "build");
  const item = await readNativeTask(root, id);
  assert.equal(item.base_revision, head(root));
  assert.notEqual(item.history.at(-1).operation_id, rejected.operation_id);
  await retargets.newCommit(root);
  assert.equal(workkeel(root, ...args).replayed, true, "a landed claim keeps its original base");
});

test("task claim --pre-claim adopts earlier commits only with an explicit --base", async t => {
  const root = await initialized(t), base = head(root);
  await fs.appendFile(path.join(root, "docs/guide.md"), "Early.\n"); git(root, "commit", "-qam", "early");
  workkeel(root, "task", "new", "--goal", "Tidy", "--acceptance", "Tidy", "--write", "docs", "--actor", B);
  assert.match(fails(root, "task", "claim", "--id", ID, "--actor", B, "--pre-claim"), /explicit --base/);
  assert.match(fails(root, "task", "release", "--id", ID, "--actor", B, "--summary", "x", "--pre-claim"), /only to task claim/);
  assert.match(fails(root, "task", "claim", "--id", ID, "--actor", B, "--base", base), /current HEAD.*--pre-claim/);
  assert.equal(workkeel(root, "task", "claim", "--id", ID, "--actor", B, "--base", base, "--pre-claim").state, "build");
  const item = await readNativeTask(root, ID);
  assert.equal(item.base_revision, base); assert.equal(item.pre_claim.commits[0].subject, "early");
});

for (const state of ["cancelled", "done"]) test(`task new refuses an identical ${state} task and explains how to file another`, async t => {
  const root = await initialized(t);
  const args = ["task", "new", "--goal", "Tidy", "--acceptance", "Tidy", "--write", "docs", "--actor", B];
  workkeel(root, ...args);
  if (state === "cancelled") workkeel(root, "task", "cancel", "--id", ID, "--actor", B, "--summary", "Stop");
  else {
    workkeel(root, "task", "claim", "--id", ID, "--actor", B);
    await deliver(root, "candidate"); await judge(root, "pass", "pass");
    workkeel(root, "task", "close", "--id", ID, "--actor", B, "--summary", "Accepted", "--rollback", "Revert");
  }
  const before = await readNativeTask(root, ID);
  assert.match(fails(root, ...args), new RegExp(`An identical task ${ID} already exists and is ${state};.*--id with an unused task ID`));
  assert.deepEqual(await readNativeTask(root, ID), before);
  assert.equal((await fs.readdir(path.join(root, ".ai-org/work-items"))).length, 1);
  const created = workkeel(root, ...args, "--id", "WK-0002");
  assert.equal(created.id, "WK-0002"); assert.equal(created.replayed, false);
  assert.equal(workkeel(root, ...args, "--id", "WK-0002").replayed, true);
});

test("long task IDs keep a bounded operation ID", async t => {
  const root = await initialized(t);
  const id = "W" + "k".repeat(95);
  const created = workkeel(root, "task", "new", "--id", id, "--goal", "Long ID", "--acceptance", "Created", "--write", "docs", "--actor", "builder");
  assert.equal(created.id, id);
  assert.ok((await readNativeTask(root, id)).history[0].operation_id.length <= 96);
});

test("critical work needs an approval record before it can start or escalate", async t => {
  const root = await initialized(t);
  assert.match(fails(root, "task", "new", "--goal", "Ship", "--acceptance", "Shipped", "--risk", "critical", "--actor", "builder"), /approval_ref/);
  await fs.writeFile(path.join(root, "docs/approval.md"), "Approved critical deploy.\n"); git(root, "add", "docs"); git(root, "commit", "-qm", "approval");
  assert.equal(workkeel(root, "task", "new", "--goal", "Ship", "--acceptance", "Shipped", "--risk", "critical", "--approval", "docs/approval.md", "--actor", "builder").state, "intake");

  const escalating = await initialized(t);
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
  const root = await initialized(t);
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
  const root = await initialized(t);
  const args = ["task", "new", "--goal", "Clarify the guide", "--acceptance", "Audience named", "--write", "docs", "--actor", "builder"];
  assert.equal(workkeel(root, ...args).id, "WK-0001");
  workkeel(root, "task", "claim", "--id", "WK-0001", "--actor", "builder");
  const again = workkeel(root, ...args);
  assert.equal(again.id, "WK-0001"); assert.equal(again.replayed, true);
  assert.deepEqual((await fs.readdir(path.join(root, ".ai-org/work-items"))).sort(), ["WK-0001.json"]);
});

test("a different failed command never disturbs the replay of an earlier successful one", async t => {
  const root = await initialized(t);
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
  const root = await initialized(t);
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
  const root = await initialized(t);
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
  const fresh = await initialized(t);
  workkeel(fresh, "task", "new", "--goal", "Tidy", "--acceptance", "Tidy", "--write", "docs", "--actor", "builder");
  const replayed = await runLifecycleFromFlags(fresh, "WK-0001", "claim", claimOptions, { afterSnapshot: async () => {
    workkeel(fresh, "task", "claim", "--id", "WK-0001", "--actor", "builder");
  } });
  assert.equal(replayed.replayed, true);
  assert.equal(workkeel(fresh, "task", "claim", "--id", "WK-0001", "--actor", "builder").replayed, true);
  assert.equal((await readNativeTask(fresh, "WK-0001")).history.length, 2);
});

test("identical commands forced to overlap both succeed with exactly one operation", async t => {
  const root = await initialized(t);
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
  const root = await initialized(t);
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

  const releasing = await initialized(t);
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
  ["handoff", "claimed", "newCommit", "new"],
  ["release", "claimed", "newClaim", "legacy-first"], ["review", "delivered", "newCandidate", "legacy-first"],
  ["rework", "failed", "newFailedCandidate", "legacy-first"]
];
for (const [action, state, retarget, kind] of matrix) {
  test(`target binding: ${action} stops when its target changes (${retarget}, ${kind} attempt)`, async t => {
    const root = await initialized(t);
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
  const root = await initialized(t);
  await states.claimed(root);
  workkeel(root, "task", "release", "--id", ID, "--actor", B, "--summary", "Pause");
  // The same claim command later makes a fresh claim; its base revision is deliberately not bound.
  assert.equal(workkeel(root, "task", "claim", "--id", ID, "--actor", B).replayed, false);
  await record(root, `.ai-org/artifacts/${ID}/cancel.md`, "No longer needed\n");
  const cancel = ["task", "cancel", "--id", ID, "--actor", B, "--summary", "Stop", "--evidence", `.ai-org/artifacts/${ID}/cancel.md`];
  assert.equal(workkeel(root, ...cancel).state, "cancelled"); assert.equal(workkeel(root, ...cancel).replayed, true);
});

test("an attempt another process saved first is adopted only if it aims at the same target", async t => {
  const root = await initialized(t);
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
  const root = await initialized(t);
  await states.failed(root);
  const failed = (await readNativeTask(root, ID)).delivery.revision;
  assert.match(fails(root, "task", "rework", "--id", ID, "--actor", B, "--summary", "Fix", "--revision", "0".repeat(40)), /current revision/);
  // An empty value is refused like any mismatch, never treated as absent.
  assert.match(fails(root, "task", "rework", "--id", ID, "--actor", B, "--summary", "Fix", "--revision="), /must not be empty/);
  assert.match(fails(root, "task", "rework", "--id", ID, "--actor", B, "--summary", "Fix", "--revision="), /must not be empty/);
  assert.equal(workkeel(root, "task", "rework", "--id", ID, "--actor", B, "--summary", "Fix", "--revision", failed).state, "intake");
});

test("a request left pending for an old candidate is never resent to a newer one", async t => {
  const root = await initialized(t);
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
