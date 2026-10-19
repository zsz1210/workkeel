import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { initializeTaskProject, soloPolicy } from "../src/workkeel-project.mjs";
import { cliCompatibility, drainCompatibilityWarnings } from "../src/workkeel-compat.mjs";
import { diagnoseTaskProject, mutateNativeTask, readNativeTask } from "../src/workkeel-tasks.mjs";
import { runCreateFromFlags } from "../src/workkeel-cli-flags.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceCli = path.join(repository, "bin", "workkeel.mjs");

async function fixture(t, lockVersion = "0.2.0") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-compat-"));
  t.after(() => fs.rm(root, { force: true, recursive: true }));
  execFileSync("git", ["-C", root, "init", "-q"]);
  await initializeTaskProject(root, soloPolicy());
  const lock = JSON.parse(await fs.readFile(path.join(root, "workkeel.lock"), "utf8"));
  lock.cli.version = lockVersion;
  await fs.writeFile(path.join(root, "workkeel.lock"), JSON.stringify(lock, null, 2) + "\n");
  for (const args of [["add", "."], ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "init"]])
    execFileSync("git", ["-C", root, ...args]);
  return root;
}
// A copy of this source tree that reports another version, standing in for a released CLI.
async function cliAt(t, version) {
  const copy = await fs.mkdtemp(path.join(os.tmpdir(), `workkeel-cli-${version}-`));
  t.after(() => fs.rm(copy, { force: true, recursive: true }));
  for (const dir of ["bin", "src"]) await fs.cp(path.join(repository, dir), path.join(copy, dir), { recursive: true });
  await fs.symlink(path.join(repository, "node_modules"), path.join(copy, "node_modules"));
  const file = path.join(copy, "src", "workkeel-version.mjs");
  await fs.writeFile(file, (await fs.readFile(file, "utf8")).replace(/TEMPLATE_VERSION = "[^"]+"/, `TEMPLATE_VERSION = "${version}"`));
  return path.join(copy, "bin", "workkeel.mjs");
}
const launch = (root, cli, ...args) => spawnSync(process.execPath, [path.join(root, "workkeelw.mjs"), ...args],
  { cwd: root, encoding: "utf8", env: { ...process.env, WORKKEEL_CLI_PATH: cli } });
const warnings = output => output.stderr.split("\n").filter(Boolean).map(line => JSON.parse(line)).filter(entry => entry.schema_version === "workkeel.warning/v1");
const lockOf = async root => JSON.parse(await fs.readFile(path.join(root, "workkeel.lock"), "utf8"));
const taskFiles = async root => fs.readdir(path.join(root, ".ai-org", "work-items")).catch(() => []);

test("compatibility needs the pinned major version and a CLI not older than the pin", () => {
  assert.equal(cliCompatibility("0.2.0", "0.2.3").status, "compatible");
  assert.equal(cliCompatibility("0.2.0", "0.3.1").status, "compatible");
  assert.equal(cliCompatibility("0.2.0-beta.0", "0.2.0").status, "compatible");
  const major = cliCompatibility("0.2.0", "1.0.0");
  assert.equal(major.status, "major-mismatch"); assert.match(major.next_action, /workkeel upgrade/);
  assert.equal(cliCompatibility("0.2.3", "0.2.0").status, "cli-older");
  assert.equal(cliCompatibility("1.0.0", "0.9.0").status, "cli-older");
  assert.equal(cliCompatibility("latest", "0.2.0").status, "invalid");
});

test("lock 0.2.0 runs on CLI 0.2.3 through the launcher override", async t => {
  const root = await fixture(t), cli = await cliAt(t, "0.2.3");
  const doctor = launch(root, cli, "doctor");
  assert.equal(doctor.status, 0, doctor.stderr); assert.equal(JSON.parse(doctor.stdout).valid, true);
  assert.deepEqual(warnings(doctor), []);
  const created = launch(root, cli, "task", "new", "--goal", "Compatible CLI writes", "--acceptance", "A task exists", "--actor", "builder");
  assert.equal(created.status, 0, created.stderr); assert.equal((await taskFiles(root)).length, 1);
});

test("CLI 1.0.0 warns on reads, blocks mutations and recovers after workkeel upgrade", async t => {
  const root = await fixture(t), cli = await cliAt(t, "1.0.0");
  const doctor = launch(root, cli, "doctor");
  assert.equal(doctor.status, 0, doctor.stderr); assert.equal(JSON.parse(doctor.stdout).valid, true);
  const [warning] = warnings(doctor);
  assert.equal(warning.code, "cli-major-mismatch"); assert.equal(warning.lock_version, "0.2.0"); assert.match(warning.next_action, /workkeel upgrade/);
  const blocked = launch(root, cli, "task", "new", "--goal", "Blocked write", "--acceptance", "Nothing is written", "--actor", "builder");
  assert.equal(blocked.status, 1); assert.match(blocked.stderr, /cannot change a project pinned to 0\.2\.0.*workkeel upgrade/);
  assert.deepEqual(await taskFiles(root), []);

  const upgraded = launch(root, cli, "upgrade", "--actor", "builder");
  assert.equal(upgraded.status, 0, upgraded.stderr); assert.deepEqual(warnings(upgraded), []);
  const result = JSON.parse(upgraded.stdout);
  assert.deepEqual([result.from, result.to, result.updated], ["0.2.0", "1.0.0", ["workkeel.lock"]]);
  assert.equal((await lockOf(root)).cli.version, "1.0.0");
  const after = launch(root, cli, "doctor");
  assert.equal(after.status, 0, after.stderr); assert.equal(JSON.parse(after.stdout).valid, true); assert.deepEqual(warnings(after), []);
  assert.equal(launch(root, cli, "task", "new", "--goal", "Now allowed", "--acceptance", "A task exists", "--actor", "builder").status, 0);
  assert.equal(JSON.parse(launch(root, cli, "upgrade", "--actor", "builder").stdout).mutation_status, "already-applied");
});

test("upgrade rewrites a stale launcher, needs an approver and never downgrades", async t => {
  const root = await fixture(t), cli = await cliAt(t, "0.2.3");
  await fs.writeFile(path.join(root, "workkeelw.mjs"), (await fs.readFile(path.join(root, "workkeelw.mjs"), "utf8")) + "// stale\n");
  const result = JSON.parse(launch(root, cli, "upgrade", "--actor", "builder").stdout);
  assert.deepEqual(result.updated, ["workkeelw.mjs", "workkeel.lock"]);
  assert.doesNotMatch(await fs.readFile(path.join(root, "workkeelw.mjs"), "utf8"), /stale|0\.2\.3/);
  // The source CLI (0.2.0-beta.0) is older than the 0.2.3 pin.
  const lock = await fs.readFile(path.join(root, "workkeel.lock"));
  const older = spawnSync(process.execPath, [sourceCli, "upgrade", root, "--actor", "builder"], { encoding: "utf8" });
  assert.equal(older.status, 1); assert.match(older.stderr, /never downgrades/);
  assert.deepEqual(await fs.readFile(path.join(root, "workkeel.lock")), lock);
  const unknown = launch(root, cli, "upgrade", "--actor", "nobody");
  assert.equal(unknown.status, 1); assert.match(unknown.stderr, /not registered/);
});

test("unknown lock and request fields only warn", async t => {
  const root = await fixture(t, "0.2.0-beta.0");
  const lock = await lockOf(root);
  await fs.writeFile(path.join(root, "workkeel.lock"), JSON.stringify({ ...lock, future_setting: true }, null, 2) + "\n");
  drainCompatibilityWarnings();
  assert.equal((await diagnoseTaskProject(root)).valid, true);
  assert.deepEqual(drainCompatibilityWarnings(), [{ code: "unknown-fields-ignored", context: "workkeel.lock", fields: ["future_setting"] }]);
  const doctor = spawnSync(process.execPath, [sourceCli, "doctor", root], { encoding: "utf8" });
  assert.equal(doctor.status, 0); assert.deepEqual(warnings(doctor).map(w => w.fields), [["future_setting"]]);

  await runCreateFromFlags(root, { "--goal": "Unknown fields", "--acceptance": ["Only a warning"], "--id": "WK-one", "--actor": "builder" });
  drainCompatibilityWarnings();
  const item = await readNativeTask(root, "WK-one");
  const claimed = await mutateNativeTask(root, "WK-one", "claim", { operation_id: "claim-one", expected_version: item.version,
    actor: { agent_id: "builder", principal_id: "owner" }, future_hint: "ignored",
    base_revision: execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() });
  assert.equal(claimed.state, "build");
  assert.deepEqual(drainCompatibilityWarnings().filter(w => w.context === "request"), [{ code: "unknown-fields-ignored", context: "request", fields: ["future_hint"] }]);
});
