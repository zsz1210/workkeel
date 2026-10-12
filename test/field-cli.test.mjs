import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cli, fixture, git } from "./helpers/lean-delivery-fixture.mjs";
import { privateViewerSnapshot } from "../src/control-plane-server.mjs";
import { inspectParallelPlan } from "../src/orchestration.mjs";

test("V09/V13 public measurement JSON runs verbatim with its declared executable lookup environment", async t => {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "temple-field-doc-plan-"));
  t.after(() => fs.rm(target, { recursive: true, force: true }));
  const document = await fs.readFile(new URL("../docs/operations/collaborative-delivery.md", import.meta.url), "utf8");
  const plans = [...document.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1]));
  const plan = plans.find(value => value.schema_version === "temple.measurement-plan/v1");
  assert.ok(plan, "The public guide must retain an executable measurement example");
  await fs.mkdir(path.join(target, "src")); await fs.mkdir(path.join(target, "test"));
  await fs.writeFile(path.join(target, "src/parser.mjs"), "export const parse = value => Number(value);\n");
  await fs.writeFile(path.join(target, "test/parser.test.mjs"), 'import assert from "node:assert/strict"; import {parse} from "../src/parser.mjs"; assert.equal(parse("42"),42);\n');
  await fs.writeFile(path.join(target, "package-lock.json"), "{}\n");
  const config = path.join(target, "plan.json"); await fs.writeFile(config, JSON.stringify(plan));
  const measured = JSON.parse(cli(["measurement", "run", target, "--config", config, "--json"]).stdout);
  assert.equal(measured.successful, true);
  assert.equal(measured.execution_started, true);
  assert.equal(measured.acceptance_granted, false);
  const missingLookup = structuredClone(plan); missingLookup.environment.names = [];
  await fs.writeFile(config, JSON.stringify(missingLookup));
  const rejected = cli(["measurement", "run", target, "--config", config, "--json"], { allowFailure: true });
  assert.equal(rejected.status, 1);
  const result = JSON.parse(rejected.stdout);
  assert.equal(result.execution_started, false);
  assert.equal(result.reason, "MEASUREMENT_TOOL_UNAVAILABLE");
});

test("V06/V07/V09 CLI reports reusable checks, actual execution and failures without stranded required status", async t => {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "temple-field-cli-"));
  t.after(() => fs.rm(target, { recursive: true, force: true }));
  await fs.writeFile(path.join(target, "input.txt"), "one");
  await fs.writeFile(path.join(target, "check.mjs"), 'import fs from "node:fs"; const n=fs.existsSync("count.txt")?Number(fs.readFileSync("count.txt")):0; fs.writeFileSync("count.txt",String(n+1));\n');
  const plan = { schema_version: "temple.measurement-plan/v1", check_policy: "trusted-local",
    command: { executable: process.execPath, args: ["check.mjs"], cwd: "." },
    inputs: { files: ["input.txt"], directories: [], tests: ["check.mjs"], fixtures: [], dependencies: [] },
    toolchain: { identity: process.version, files: [] }, environment: { identity: "synthetic-fixture", names: [] },
    timeout_ms: 3000, output_limit_bytes: 32768, outputs: ["count.txt"] };
  const config = path.join(target, "measurement.json"); await fs.writeFile(config, JSON.stringify(plan));
  const run = extra => cli(["measurement", "run", target, "--config", config, "--json", ...extra], { allowFailure: true });
  const rejected = run(["--dry-run"]);
  assert.equal(rejected.status, 1); assert.equal(JSON.parse(rejected.stdout).mutation_status, "not_started");
  assert.equal(await fs.stat(path.join(target, "count.txt")).catch(() => null), null);
  const first = run([]); assert.equal(first.status, 0, first.stdout || first.stderr);
  assert.equal(JSON.parse(first.stdout).execution_started, true);
  const reused = run([]); assert.equal(reused.status, 0, reused.stdout || reused.stderr);
  const result = JSON.parse(reused.stdout);
  assert.equal(result.cache_status, "hit"); assert.equal(result.execution_started, false); assert.equal(result.acceptance_granted, false);
  assert.equal(await fs.readFile(path.join(target, "count.txt"), "utf8"), "1");
  await fs.writeFile(path.join(target, "input.txt"), "two");
  const changed = run([]); assert.equal(changed.status, 0, changed.stdout || changed.stderr);
  assert.equal(JSON.parse(changed.stdout).cache_status, "miss");
  assert.equal(await fs.readFile(path.join(target, "count.txt"), "utf8"), "2");
  await fs.writeFile(path.join(target, "check.mjs"), "process.exit(7);\n");
  const failed = run([]); assert.equal(failed.status, 1);
  assert.equal(JSON.parse(failed.stdout).successful, false);
});

test("V08 diagnostic detail preserves private-view Principal and condition redaction", () => {
  const item = { id: "WI-0001", delivery_attention: { state: "awaiting-environment",
    owner: { position_id: "independent_qa", agent_id: "agent-review", principal_id: "principal-private", source: "active-claim" },
    missing_conditions: [{ kind: "environment", description: "private device condition", owner: { principal_id: "principal-private" } }], next_action: "private action" } };
  const snapshot = { observer: { work: { items: [item] } }, live_observer: { work: { items: [item] } } };
  const result = privateViewerSnapshot(snapshot, { login: "viewer" });
  const bytes = JSON.stringify(result);
  assert.ok(!bytes.includes("principal-private")); assert.ok(!bytes.includes("private device condition"));
  assert.equal(result.live_observer.work.items[0].delivery_attention.state, "awaiting-environment");
  assert.equal(snapshot.observer.work.items[0].delivery_attention.owner.principal_id, "principal-private");
});

for (const failView of [false, true]) test(`V10/V12 public reconciliation CLI rebuilds views and preserves canonical recovery facts (view failure=${failView})`, async t => {
  const f = await fixture({ workflowProfile: "standard" }); t.after(f.cleanup);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "temple-field-reconcile-cli-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const resourcesPath = path.join(f.target, ".ai-org/project/resources.json");
  git(f.target, ["add", "."]); git(f.target, ["commit", "--allow-empty", "-qm", "CLI reconciliation base"]);
  const baseRevision = git(f.target, ["rev-parse", "HEAD"]);
  const resources = JSON.parse(await fs.readFile(resourcesPath));
  resources.resources.push({ id: "fixture-device", display_name: "Fixture device", capacity: 1, description: "CLI test", active: true });
  await fs.writeFile(resourcesPath, JSON.stringify(resources));
  git(f.target, ["add", "."]); git(f.target, ["commit", "-qm", "Incoming fixture resource"]);
  const incomingRevision = git(f.target, ["rev-parse", "HEAD"]);
  git(f.target, ["checkout", "--detach", baseRevision]);
  cli(["parallel", "plan", f.target, "--max-workers", "2"]);
  const config = path.join(temporary, "request.json");
  await fs.writeFile(config, JSON.stringify({ baseRevision, incomingRevision, paths: [".ai-org/project/resources.json", ".ai-org/views/parallel-plan.json"] }));
  const preview = JSON.parse(cli(["reconcile", "preview", f.target, "--config", config, "--json"]).stdout);
  await fs.writeFile(config, JSON.stringify(preview));
  const statusPath = path.join(f.target, ".ai-org/views/status.md");
  if (failView) { await fs.rm(statusPath, { force: true }); await fs.mkdir(statusPath); }
  const applied = cli(["reconcile", "apply", f.target, "--config", config, "--fingerprint", preview.fingerprint, "--json"], { allowFailure: true });
  assert.equal(applied.status, failView ? 1 : 0, applied.stderr || applied.stdout);
  const result = JSON.parse(applied.stdout);
  assert.equal(result.mutation_status, "applied");
  assert.equal(result.mutation_performed, true);
  assert.equal(result.acceptance_granted, false);
  assert.ok(JSON.parse(await fs.readFile(resourcesPath)).resources.some(entry => entry.id === "fixture-device"));
  if (failView) {
    assert.equal(result.code, "RECONCILIATION_VIEWS_FAILED");
    assert.equal(result.views_rebuilt, false);
    assert.match(result.next_action, /reconcile refresh-views/);
    const canonical = await fs.readFile(resourcesPath);
    await fs.rmdir(statusPath);
    const refreshed = JSON.parse(cli(["reconcile", "refresh-views", f.target, "--json"]).stdout);
    assert.equal(refreshed.canonical_mutation_performed, false);
    assert.equal(refreshed.mutation_status, "unchanged");
    assert.equal(refreshed.views_rebuilt, true);
    assert.deepEqual(await fs.readFile(resourcesPath), canonical);
  } else assert.equal(result.views_rebuilt, true);
  const plan = await inspectParallelPlan(f.target);
  assert.equal(plan.valid, true, plan.errors.join(";"));
  assert.equal(plan.fresh, true);
  assert.equal(plan.plan.max_workers, 2);
  assert.equal(plan.plan.scope.parent_work_item_id, null);
  assert.ok((await fs.readFile(statusPath, "utf8")).includes(f.item.id));
});
