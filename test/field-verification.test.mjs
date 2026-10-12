import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { validateMeasurementPlan, fingerprintMeasurement, inspectMeasurement, runMeasurement, measurementCapabilities } from "../src/verification.mjs";
import { runLocalChecks } from "../src/delivery-check.mjs";
import { validatePlan, deliveryReport } from "../src/delivery-ledger.mjs";

async function fixture(t, script = "console.log('measured')") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "temple-measurement-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [name, body] of Object.entries({ "src/app.txt": "product", "tests/check.txt": "tests", "fixtures/example.txt": "fixture", "deps.lock": "dependency", "admin.md": "administration" })) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), body);
  }
  const plan = { schema_version: "temple.measurement-plan/v1", check_policy: "trusted-local", command: { executable: process.execPath, args: ["-e", script], cwd: "." },
    inputs: { files: [], directories: ["src"], tests: ["tests"], fixtures: ["fixtures"], dependencies: ["deps.lock"] },
    toolchain: { identity: "fixture-toolchain-v1", files: [] }, environment: { identity: "fixture-environment-v1", names: [] }, timeout_ms: 3000, output_limit_bytes: 16384, outputs: [] };
  return { root, plan };
}
const write = (root, name, body) => fs.writeFile(path.join(root, name), body);

test("V06 measurement reuse survives administrative changes and returns intact immutable evidence without QA acceptance", async t => {
  const { root, plan } = await fixture(t);
  const first = await runMeasurement(root, plan);
  assert.equal(first.result.successful, true, JSON.stringify(first));
  assert.equal(first.cache_status, "miss"); assert.equal(first.execution_started, true);
  const original = await fs.readFile(path.join(root, first.result_ref));
  await write(root, "admin.md", "changed administration");
  const second = await runMeasurement(root, plan);
  assert.equal(second.cache_status, "hit", JSON.stringify(second)); assert.equal(second.execution_started, false); assert.equal(second.result_ref, first.result_ref);
  assert.equal(second.status, "completed"); assert.equal(second.successful, true);
  assert.equal(second.acceptance_granted, false); assert.equal(second.independent_review_required, true);
  assert.deepEqual(await fs.readFile(path.join(root, first.result_ref)), original);
  assert.equal((await fs.readdir(path.join(root, ".ai-org/artifacts/measurements"))).length, 1);
});

test("V07 complete input inventory invalidates additions, deletion, modes, dependencies, tests and fixtures", async t => {
  const { root, plan } = await fixture(t);
  assert.equal((await runMeasurement(root, plan)).successful, true);
  for (const file of ["src/app.txt", "tests/check.txt", "fixtures/example.txt", "deps.lock"]) {
    const previous = await fs.readFile(path.join(root, file)); await write(root, file, "changed");
    assert.equal((await inspectMeasurement(root, plan)).reason, "fingerprint-changed", file); await write(root, file, previous);
  }
  await write(root, "src/addition.txt", "added"); assert.equal((await inspectMeasurement(root, plan)).reason, "fingerprint-changed"); await fs.unlink(path.join(root, "src/addition.txt"));
  await fs.mkdir(path.join(root, "src/empty")); assert.equal((await inspectMeasurement(root, plan)).reason, "fingerprint-changed"); await fs.rmdir(path.join(root, "src/empty"));
  const mode = (await fs.stat(path.join(root, "src/app.txt"))).mode & 0o777;
  await fs.chmod(path.join(root, "src/app.txt"), mode ^ 0o100); assert.equal((await inspectMeasurement(root, plan)).reason, "fingerprint-changed"); await fs.chmod(path.join(root, "src/app.txt"), mode);
  await fs.unlink(path.join(root, "src/app.txt")); assert.equal((await inspectMeasurement(root, plan)).reason, "fingerprint-changed");
});

test("V07 command, toolchain and environment identity are measured; undeclared ambient values are excluded", async t => {
  const { root, plan } = await fixture(t, "if(process.env.UNDECLARED)process.exit(1); console.log(typeof process.env.PRIVATE)");
  plan.environment.names = ["PRIVATE"];
  const env = { PRIVATE: "private-value-never-persist", UNDECLARED: "must-not-inherit" };
  const first = await runMeasurement(root, plan, { env }); assert.equal(first.successful, true);
  assert.equal(JSON.stringify(first).includes(env.PRIVATE), false);
  assert.equal((await inspectMeasurement(root, plan, { env: { PRIVATE: "changed" } })).reason, "fingerprint-changed");
  assert.equal((await inspectMeasurement(root, plan, { env: {} })).reason, "MEASUREMENT_ENVIRONMENT_UNKNOWN");
  for (const change of [p => p.command.args.push("extra"), p => p.toolchain.identity += "-new", p => p.environment.identity += "-new", p => p.output_limit_bytes++, p => p.timeout_ms++]) {
    const changed = structuredClone(plan); change(changed); assert.equal((await inspectMeasurement(root, changed, { env })).reason, "fingerprint-changed");
  }
});

test("V06 artifact loss or tampering invalidates a prior pass", async t => {
  const { root, plan } = await fixture(t), first = await runMeasurement(root, plan);
  const artifact = first.result.artifacts.find(a => a.kind === "stdout");
  await write(root, artifact.path, "tampered"); assert.equal((await inspectMeasurement(root, plan)).reason, "artifact-integrity-mismatch");
  await fs.unlink(path.join(root, artifact.path)); assert.equal((await inspectMeasurement(root, plan)).cache_status, "miss");
  const next = await runMeasurement(root, plan); assert.equal(next.successful, true); assert.notEqual(next.result_ref, first.result_ref);
  assert.equal((await fs.readdir(path.join(root, ".ai-org/artifacts/measurements"))).length, 2);
});

test("newest failed attempt cannot be hidden by an older successful matching attempt", async t => {
  const { root, plan } = await fixture(t), first = await runMeasurement(root, plan);
  const failed = await runMeasurement(root, plan, { reuse: false, hooks: { started() { throw Error("injected setup failure"); } } });
  assert.equal(failed.successful, false); assert.equal(failed.execution_started, false);
  assert.equal((await inspectMeasurement(root, plan)).reason, "prior-attempt-unsuccessful");
  assert.equal(JSON.parse(await fs.readFile(path.join(root, first.result_ref))).successful, true);
});

test("retired, incomplete and malformed records are conservative misses", async t => {
  const { root, plan } = await fixture(t), first = await runMeasurement(root, plan), directory = path.dirname(path.join(root, first.result_ref));
  await fs.writeFile(path.join(directory, "retired.json"), JSON.stringify({ reason: "retired by reviewer" }));
  assert.equal((await inspectMeasurement(root, plan)).reason, "attempt-retired"); await fs.unlink(path.join(directory, "retired.json"));
  await fs.unlink(path.join(root, first.result_ref)); assert.equal((await inspectMeasurement(root, plan)).reason, "attempt-incomplete");
  await fs.writeFile(path.join(root, first.result_ref), "{}"); assert.equal((await inspectMeasurement(root, plan)).reason, "invalid-result-record");
  const repaired = await runMeasurement(root, plan); assert.equal(repaired.successful, true);
  assert.equal((await inspectMeasurement(root, plan)).cache_status, "hit", "a new complete attempt can supersede an older invalid attempt without overwriting it");
});

test("V09 trusted-local executes a real non-Node argv tool without interpreting shell metacharacters", { skip: process.platform === "win32" }, async t => {
  const { root, plan } = await fixture(t);
  plan.command = { executable: "/usr/bin/printf", args: ["%s", "$(touch unrequested); 'literal'"], cwd: "." };
  const measured = await runMeasurement(root, plan);
  assert.equal(measured.successful, true, JSON.stringify(measured)); assert.equal(measured.result.stdout, "$(touch unrequested); 'literal'");
  await assert.rejects(fs.stat(path.join(root, "unrequested")), { code: "ENOENT" });
  assert.equal(measured.result.execution_boundary.parent_agent_confined, false);
});

test("declared build outputs are retained as immutable digest-checked artifacts", async t => {
  const { root, plan } = await fixture(t, "const fs=require('node:fs');fs.mkdirSync('build',{recursive:true});fs.writeFileSync('build/report.txt','actual output')");
  plan.outputs = ["build/report.txt"];
  const result = await runMeasurement(root, plan); assert.equal(result.successful, true, JSON.stringify(result));
  const artifact = result.result.artifacts.find(a => a.kind === "output"); assert.equal(artifact.source, "build/report.txt");
  assert.equal(await fs.readFile(path.join(root, artifact.path), "utf8"), "actual output");
  await fs.unlink(path.join(root, "build/report.txt"));
  assert.equal((await inspectMeasurement(root, plan)).cache_status, "hit", "archived bytes remain retrievable after workspace output deletion");
});

test("unrelated ignored-file mutation and input mutation cannot pass", async t => {
  for (const script of ["require('node:fs').writeFileSync('ignored.txt','changed')", "require('node:fs').writeFileSync('src/app.txt','changed')"]) {
    const { root, plan } = await fixture(t, script); await write(root, ".gitignore", "ignored.txt\n");
    const result = await runMeasurement(root, plan); assert.equal(result.successful, false); assert.equal(result.result.workspace_changes.length, 1);
  }
});

test("ordinary workspace symlinks are recorded without following them or weakening selected input checks", async t => {
  const { root, plan } = await fixture(t);
  await fs.symlink("src/app.txt", path.join(root, "ordinary-link"));
  assert.equal((await runMeasurement(root, plan)).successful, true);
  plan.inputs.files.push("ordinary-link");
  assert.equal((await fingerprintMeasurement(root, plan)).reason, "MEASUREMENT_UNSAFE_PATH");
});

test("input drift in a started hook blocks command execution", async t => {
  const { root, plan } = await fixture(t, "require('node:fs').writeFileSync('should-not-run','wrong')");
  const result = await runMeasurement(root, plan, { hooks: { started: () => write(root, "src/app.txt", "changed") } });
  assert.equal(result.successful, false); assert.equal(result.execution_started, false);
  await assert.rejects(fs.stat(path.join(root, "should-not-run")), { code: "ENOENT" });
});

test("V09 supervision enforces timeout and output bounds and confirms owned process exit", async t => {
  for (const [script, change, field] of [["setInterval(()=>{},10)", p => p.timeout_ms = 200, "timed_out"], ["console.log('x'.repeat(100000))", p => p.output_limit_bytes = 256, "instrument_error"], ["process.stdout.write(Buffer.alloc(1000,255))", p => p.output_limit_bytes = 256, "instrument_error"]]) {
    const { root, plan } = await fixture(t, script); change(plan);
    const result = await runMeasurement(root, plan); assert.equal(result.successful, false); assert.ok(result.result[field]);
    assert.equal(result.result.process_exit_confirmed, true); assert.equal(result.result.temporary_removed, true);
    assert.ok(Buffer.byteLength(result.result.stdout) + Buffer.byteLength(result.result.stderr) <= plan.output_limit_bytes);
  }
});

test("V09 surviving owned descendants cause failure and are terminated", async t => {
  const script = "const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(c.pid);c.unref()";
  const { root, plan } = await fixture(t, script), result = await runMeasurement(root, plan);
  assert.equal(result.successful, false); assert.equal(result.result.surviving_descendants, true);
  assert.equal(result.result.process_exit_confirmed, true); const pid = Number(result.result.stdout.trim());
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("unsafe or missing input declarations fail before spawn with actionable diagnostics", async t => {
  const { root, plan } = await fixture(t);
  for (const change of [p => delete p.inputs.dependencies, p => p.inputs.files.push("../escape"), p => p.command.cwd = "../escape", p => p.outputs.push("src/out"), p => p.toolchain.identity = "", p => p.environment.names.push("TMPDIR")]) {
    const invalid = structuredClone(plan); change(invalid);
    assert.throws(() => validateMeasurementPlan(invalid), e => e.code === "MEASUREMENT_PLAN_INVALID" && e.mutation_status === "not-performed" && !!e.next_action);
  }
  plan.inputs.files = ["absent.txt"];
  assert.equal((await runMeasurement(root, plan)).execution_started, false);
  plan.inputs.files = [];
  await fs.symlink(os.tmpdir(), path.join(root, "src/escape"));
  assert.equal((await fingerprintMeasurement(root, plan)).reason, "MEASUREMENT_UNSAFE_PATH");
});

test("V09 capabilities retain Windows execution limits and confined-node never falls back", async t => {
  const windows = measurementCapabilities({ platform: "win32" });
  assert.equal(windows.adapters["trusted-local"].supported, false); assert.equal(windows.execution_performed, false);
  assert.equal(windows.adapters["confined-node"].supported, false);
  const { plan } = await fixture(t); plan.check_policy = "confined-node";
  assert.throws(() => validateMeasurementPlan(plan), /no fallback/);
});

test("real macOS confined-node measurement reports only the supported test command", { skip: process.platform !== "darwin" }, async t => {
  const { root, plan } = await fixture(t);
  await write(root, "tests/app.test.mjs", "import test from 'node:test';test('actual confined test',()=>{});\n");
  plan.check_policy = "confined-node"; plan.inputs.tests = ["tests/app.test.mjs"];
  plan.command.args = ["--test", "--test-isolation=none", "--test-reporter=tap", `--test-timeout=${plan.timeout_ms}`, ...plan.inputs.tests];
  const result = await runMeasurement(root, plan);
  assert.equal(result.successful, true, JSON.stringify(result)); assert.equal(result.result.tests, 1);
  assert.equal(result.result.execution_boundary.adapter, "macos-sandbox-exec");
});

test("v2 delivery plan accepts a portable measurement and keeps legacy compatibility explicit", async t => {
  const { root, plan } = await fixture(t);
  const delivery = { schema_version: "temple.delivery-plan/v2", execution_mode: "autonomous", check_policy: "trusted-local", authorization_ref: "admin.md", measurement_plan: plan, test_timeout_ms: plan.timeout_ms,
    budget: { elapsed_limit_ms: 30000, max_repairs: 1, verification_reserve_ms: 4000, repair_reserve_ms: 4000, cleanup_reserve_ms: 1000, token_limit: null, token_reserve: 0 } };
  assert.equal(validatePlan(delivery), delivery);
  assert.throws(() => validatePlan({ ...delivery, tests: ["app.test.mjs"] }), /not both/);
  assert.throws(() => validatePlan({ ...delivery, test_timeout_ms: 200 }), /must agree/);
  execFileSync("git", ["init", "-q"], { cwd: root });
  const first = await runLocalChecks(root, "WI-0001", delivery); assert.equal(first.accepted, true, JSON.stringify(first));
  const second = await runLocalChecks(root, "WI-0001", delivery); assert.equal(second.cache_status, "hit"); assert.equal(second.acceptance_granted, false); assert.equal(second.execution_started, false);
  const session = { plan: delivery, opened_at_ms: 0, completed_at_ms: 10, repairs: 0, pending: null, events: [
    { sequence: 1, kind: "checked", revision: "candidate", elapsed_ms: 3, result: first },
    { sequence: 2, kind: "checked", revision: "candidate", elapsed_ms: 1, result: second },
    { sequence: 3, kind: "checked", revision: "legacy", elapsed_ms: 2, result: { accepted: true } },
    { sequence: 4, kind: "checked", revision: "invalid", elapsed_ms: 0, result: { accepted: false, cache_status: "invented", cache_reason: "x".repeat(500), execution_started: "true", measurement_ref: "../unsafe" } }
  ] };
  const report = deliveryReport(session, { id: "WI-0001", state: "test", created_at: new Date(0).toISOString() }, 10);
  assert.equal(report.checks[0].cache_status, "miss"); assert.equal(report.checks[0].execution_started, true); assert.equal(report.checks[0].measurement_ref, first.measurement_ref);
  assert.equal(report.checks[1].cache_status, "hit"); assert.equal(report.checks[1].execution_started, false); assert.equal(report.checks[1].cache_reason, "compatible-successful-measurement");
  assert.deepEqual(report.checks[2], { sequence: 3, revision: "legacy", accepted: true, elapsed_ms: 2, cache_status: null, cache_reason: null, execution_started: null, measurement_ref: null });
  assert.equal(report.checks[3].cache_status, null); assert.equal(report.checks[3].cache_reason.length, 240); assert.equal(report.checks[3].execution_started, null); assert.equal(report.checks[3].measurement_ref, null);
});

test("read-only inspection never claims a command ran during lookup even when its recorded failed attempt did run", async t => {
  const { root, plan } = await fixture(t, "process.exit(1)");
  const run = await runMeasurement(root, plan);
  assert.equal(run.execution_started, true); assert.equal(run.successful, false);
  const inspected = await inspectMeasurement(root, plan);
  assert.equal(inspected.execution_started, false); assert.equal(inspected.result.execution_started, true);
  assert.equal(inspected.reason, "prior-attempt-unsuccessful"); assert.equal(inspected.mutation_status, "not-performed");
});

test("OS command-spawn failure remains an instrument failure without fabricated execution", async t => {
  const { root, plan } = await fixture(t);
  await write(root, "broken-tool", "#!/definitely/unavailable/interpreter\n");
  await fs.chmod(path.join(root, "broken-tool"), 0o755);
  plan.command = { executable: "./broken-tool", args: [], cwd: "." };
  const result = await runMeasurement(root, plan);
  assert.equal(result.execution_started, false); assert.equal(result.status, "instrument-failure");
  assert.equal(result.result.instrument_error, "command-spawn-ENOENT"); assert.equal(result.successful, false);
});
