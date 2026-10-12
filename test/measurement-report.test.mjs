import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { runMeasurement } from "../src/verification.mjs";
import { measurementReport } from "../src/measurement-report.mjs";

async function fixture(t, script = "console.log('measured')") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "temple-report-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, ".ai-org/work-items"), { recursive: true });
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src/product.txt"), "candidate\n");
  await fs.writeFile(path.join(root, ".ai-org/work-items/WI-0001.json"), JSON.stringify({ id: "WI-0001", state: "build" }));
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  git("init", "-q"); git("add", "."); git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "candidate");
  const revision = git("rev-parse", "HEAD");
  const plan = { schema_version: "temple.measurement-plan/v1", check_policy: "trusted-local",
    command: { executable: process.execPath, args: ["-e", script], cwd: "." },
    inputs: { files: [], directories: ["src"], tests: [], fixtures: [], dependencies: [] },
    toolchain: { identity: "test-toolchain", files: [] }, environment: { identity: "test-host", names: [] },
    timeout_ms: 3000, output_limit_bytes: 16384, outputs: [] };
  return { root, git, plan, options: { workItemId: "WI-0001", revision } };
}

test("report exports measured evidence without rerun, overwrites, acceptance or invented usage", async t => {
  const { root, plan, options } = await fixture(t);
  const first = await runMeasurement(root, plan);
  assert.equal(first.successful, true);
  const before = await fs.readFile(path.join(root, first.result_ref));
  const report = await measurementReport(root, plan, options);
  assert.equal(report.applicable, true); assert.equal(report.execution_started, false);
  assert.equal(report.acceptance_granted, false); assert.equal(report.token_usage, null); assert.equal(report.cost, null);
  assert.equal(report.observation.tests, null); assert.equal(report.observation.artifact_integrity, "verified");
  assert.equal(report.observation.monotonic_elapsed_ms, first.result.monotonic_elapsed_ms);
  assert.equal(report.mutation_status, "not-performed");
  const saved = await measurementReport(root, plan, { ...options, output: "measurement.md" });
  assert.equal(saved.evidence_ref, ".ai-org/artifacts/WI-0001/measurement.md");
  assert.equal(await fs.readFile(path.join(root, saved.evidence_ref), "utf8"), report.markdown);
  assert.equal((await measurementReport(root, plan, { ...options, output: "measurement.md" })).mutation_status, "unchanged");
  await fs.writeFile(path.join(root, saved.evidence_ref), "prior judgment");
  await assert.rejects(measurementReport(root, plan, { ...options, output: "measurement.md" }), /different contents/);
  assert.deepEqual(await fs.readFile(path.join(root, first.result_ref)), before);
  assert.equal((await fs.readdir(path.join(root, ".ai-org/artifacts/measurements"))).length, 1);
});

test("missing and latest failed evidence cannot become an earlier pass", async t => {
  const { root, plan, options } = await fixture(t);
  assert.equal((await measurementReport(root, plan, options)).reason, "no-prior-attempt");
  await runMeasurement(root, plan);
  await runMeasurement(root, plan, { reuse: false, hooks: { started() { throw Error("injected failure"); } } });
  const result = await measurementReport(root, plan, { ...options, output: "failed.md" });
  assert.equal(result.applicable, false); assert.equal(result.reason, "prior-attempt-unsuccessful");
  assert.equal(result.observation.successful, false); assert.equal(result.observation.artifact_integrity, "not-established");
  assert.equal(result.acceptance_granted, false);
});

test("candidate mismatch remains a failure even when the changed input has a successful measurement", async t => {
  const { root, git, plan, options } = await fixture(t);
  git("update-index", "--assume-unchanged", "src/product.txt");
  await fs.writeFile(path.join(root, "src/product.txt"), "modified\n");
  assert.equal((await runMeasurement(root, plan)).successful, true);
  const result = await measurementReport(root, plan, options);
  assert.equal(result.cache_status, "hit"); assert.equal(result.applicable, false);
  assert.deepEqual(result.candidate_binding.mismatches, ["src/product.txt"]);
});

test("directory deletions, executable mode drift and stale artifacts cannot qualify", async t => {
  const { root, git, plan, options } = await fixture(t);
  await fs.writeFile(path.join(root, "src/extra.txt"), "extra"); git("add", ".");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "extra");
  options.revision = git("rev-parse", "HEAD");
  await fs.unlink(path.join(root, "src/extra.txt"));
  await fs.chmod(path.join(root, "src/product.txt"), 0o755);
  const measured = await runMeasurement(root, plan);
  const report = await measurementReport(root, plan, options);
  assert.deepEqual(report.candidate_binding.mismatches, ["src/extra.txt", "src/product.txt"]);
  await fs.writeFile(path.join(root, measured.result.artifacts[0].path), "tampered");
  const corrupted = await measurementReport(root, plan, options);
  assert.equal(corrupted.applicable, false); assert.equal(corrupted.reason, "artifact-integrity-mismatch");
  assert.equal(corrupted.observation, null);
});

test("unsafe output, symlinked parents and non-exact candidates fail without escaping", async t => {
  const { root, plan, options } = await fixture(t);
  for (const output of ["../escape.md", "/tmp/escape.md", "evidence.json"]) await assert.rejects(measurementReport(root, plan, { ...options, output }), { code: "INVALID_INPUT" });
  await assert.rejects(measurementReport(root, plan, { ...options, revision: "HEAD" }), { code: "INVALID_INPUT" });
  await assert.rejects(measurementReport(root, plan, { ...options, workItemId: "../other" }), { code: "INVALID_INPUT" });
  await runMeasurement(root, plan);
  await fs.symlink(path.join(root, "src"), path.join(root, ".ai-org/artifacts/WI-0001"));
  await assert.rejects(measurementReport(root, plan, { ...options, output: "escape.md" }), { code: "INVALID_INPUT" });
  await assert.rejects(fs.stat(path.join(root, "src/escape.md")), { code: "ENOENT" });
});

test("real CLI report returns failure for missing evidence and success after measurement", async t => {
  const { root, plan, options } = await fixture(t);
  await fs.writeFile(path.join(root, "plan.json"), JSON.stringify(plan));
  const cli = new URL("../bin/temple.mjs", import.meta.url).pathname;
  const args = [cli, "measurement", "report", root, "--config", path.join(root, "plan.json"), "--work-item", options.workItemId, "--revision", options.revision, "--json"];
  let result = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(result.status, 1, result.stderr); assert.equal(JSON.parse(result.stdout).applicable, false);
  await runMeasurement(root, plan);
  result = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).execution_started, false);
});
