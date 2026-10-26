import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { initializeTaskProject } from "../src/workkeel-project.mjs";
import { createNativeTask, mutateNativeTask } from "../src/workkeel-tasks.mjs";
import { readStatsReport, readMultiSourceStatsReport, readSourceList, formatStatsReport, strictFailure } from "../src/workkeel-stats-report.mjs";
import { backupEntryRule, backupRule, legacyStatsTask } from "../src/workkeel-stats-legacy.mjs";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "../bin/workkeel.mjs");
const builder = { agent_id: "builder", principal_id: "owner" };
const reviewer = { agent_id: "reviewer", principal_id: "owner" };
const policy = { schema_version: "workkeel.task-policy/v1", principals: ["owner"], agents: [builder, reviewer],
  approvers: ["owner"], review_separation: "distinct-agent" };
let operation = 0;
const request = (version, actor, extra = {}) => ({ expected_version: version, operation_id: `op-${++operation}`, actor, ...extra });
const contract = (id, write) => ({ schema_version: "workkeel.task-contract/v2", id, goal: `Fixture ${id}`, state: "intake",
  scope: { include: ["fixture change"], exclude: [] }, actor: builder, dependencies: [],
  acceptance: { criteria: ["The change is reviewed"], evidence: [] }, handoff: null,
  verification: { risk_tier: "standard", separation: "distinct-agent", implementer: null, reviewer: null, candidate_revision: null },
  environment: { cwd: ".", read_paths: ["."], write_paths: [write], tools: ["node"], resources: [],
    network: { mode: "none", hosts: [] }, external_actions: [], data: { classification: "internal", model_access: "none", policy_refs: ["docs/approval.md"] } },
  authorization: { approved_by: "owner", approval_ref: "docs/approval.md", operations: ["read", "write", "execute"], expires_at: null }, skills: [],
  execution: { runtime: { kind: "host-owned", adapter_id: null, required_features: [] }, model_connection: { kind: "native" } } });
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
// Plain `git status` refreshes the index; the comparison itself must not write.
const gitStatus = root => execFileSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
async function write(root, ref, data) { await fs.mkdir(path.dirname(path.join(root, ref)), { recursive: true }); await fs.writeFile(path.join(root, ref), data); }
const digest = value => createHash("sha256").update(`${JSON.stringify(value, null, 2)}\n`).digest("hex");
const hex = c => c.repeat(40);

/** A current-format project with one reviewed task. */
async function currentProject(parent, name) {
  const root = path.join(parent, name);
  await fs.mkdir(root);
  git(root, "init", "-q"); git(root, "config", "user.name", "Fixture"); git(root, "config", "user.email", "fixture@example.invalid");
  await write(root, "docs/approval.md", "Approved synthetic fixture work.\n");
  await initializeTaskProject(root, policy);
  git(root, "add", "."); git(root, "commit", "-qm", "base");
  const id = "WK-now";
  let version = (await createNativeTask(root, contract(id, "src"), request(0, builder))).version;
  const claim = await mutateNativeTask(root, id, "claim", request(version, builder, { base_revision: git(root, "rev-parse", "HEAD") }));
  await write(root, "src/file.mjs", "export const value = 1;\n"); git(root, "add", "src"); git(root, "commit", "-qm", "change");
  const revision = git(root, "rev-parse", "HEAD"), delivered = `.ai-org/artifacts/${id}/developer.md`;
  await write(root, delivered, `Verified ${revision}.\n`);
  version = (await mutateNativeTask(root, id, "handoff", request(claim.version, builder, { claim_id: claim.claim.id, revision, summary: "Delivered", evidence: [delivered], unresolved: [] }))).version;
  await mutateNativeTask(root, id, "review", request(version, reviewer, { revision, judgment: "pass", summary: "Reviewed", evidence: [delivered] }));
  return root;
}

/** A 0.1.0-beta.1 task record with a valid hash chain, as that release wrote it. */
function legacyRecord(id, start, { extraAction = null, mutate = null } = {}) {
  const t = minutes => new Date(start + minutes * 60000).toISOString();
  const evidence = name => [{ path: `.ai-org/artifacts/${id}/${name}.md`, sha256: "e".repeat(64) }];
  const first = { revision: hex("a"), summary: "Round 1", implementer: builder, claim_id: "claim-1", evidence: evidence("developer-1") };
  const second = { revision: hex("b"), summary: "Round 2", implementer: builder, claim_id: "claim-2", evidence: evidence("developer-2") };
  const failed = { actor: reviewer, revision: hex("a"), judgment: "fail", summary: "Missing test", evidence: evidence("review-1") };
  const passed = { actor: reviewer, revision: hex("b"), judgment: "pass", summary: "All pass", evidence: evidence("review-2") };
  const legacyContract = { ...contract(id, "src"), schema_version: "workkeel.task-contract/v1", legacy: null };
  const steps = [["create", builder, "intake", null], ["claim", builder, "build", null], ["handoff", builder, "test", hex("a"), { summary: "Round 1" }],
    ["review", reviewer, "test", hex("a"), { summary: "Missing test", judgment: "fail" }], ["rework", builder, "intake", null, { summary: "[tests] Add the regression test" }],
    ["claim", builder, "build", null], ["handoff", builder, "test", hex("b"), { summary: "Round 2" }],
    ["review", reviewer, "release_gate", hex("b"), { summary: "All pass", judgment: "pass" }]];
  if (extraAction) steps.push([extraAction, reviewer, "release_gate", null]);
  const item = { schema_version: "workkeel.work-item/v1", id, version: steps.length, state: "release_gate", contract: legacyContract,
    contract_sha256: null, policy_sha256: "0".repeat(64), authority_pins: [{ path: "docs/approval.md", sha256: "d".repeat(64) }], claim: null, base_revision: hex("c"), dependency_pins: [],
    delivery: second, review: passed, closeout: null,
    attempts: [{ kind: "rejected", base_revision: hex("c"), delivery: first, review: failed, summary: "[tests] Add the regression test" }] };
  // A change made before hashing keeps the digests valid, so only the format check can refuse it.
  mutate?.(item);
  item.contract_sha256 = digest(item.contract);
  const record = digest(item), history = [];
  let previous = null;
  for (const [index, [action, actor, state, revision, extra = {}]] of steps.entries()) {
    const body = { sequence: index + 1, action, operation_id: `op-${id}-${index}`, request_sha256: "1".repeat(64), actor, at: t(index * 5),
      state, revision, previous_hash: previous, record_sha256: index === steps.length - 1 ? record : "2".repeat(64), ...extra };
    previous = digest(body); history.push({ ...body, hash: previous });
  }
  return { ...item, history };
}
async function legacyProject(parent, name, records, { version = "0.1.0-beta.1" } = {}) {
  const root = path.join(parent, name);
  await fs.mkdir(root, { recursive: true });
  git(root, "init", "-q");
  await write(root, "workkeel.lock", JSON.stringify({ schema_version: "workkeel.project/v1", cli: { package_name: "@zsz1210/workkeel", version }, policy, legacy_manifest: null }, null, 2) + "\n");
  for (const [file, record] of Object.entries(records)) await write(root, `.ai-org/work-items/${file}`, typeof record === "string" ? record : JSON.stringify(record, null, 2) + "\n");
  return root;
}
async function snapshot(root) {
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true }), result = {};
  for (const entry of entries) {
    const file = path.join(entry.parentPath, entry.name), info = await fs.lstat(file);
    result[path.relative(root, file)] = entry.isFile() ? `${info.mtimeMs}:${digest(await fs.readFile(file, "utf8"))}` : `${info.mtimeMs}`;
  }
  return result;
}
const embedded = markdown => JSON.parse(markdown.split("```json\n")[1].split("\n```")[0]);

test("backup rule matches backup directories and explicit backup suffixes only", () => {
  for (const name of ["backup", "Backups"]) assert.equal(backupRule(name), "backup-directory", name);
  for (const name of ["repo.bak", "repo.BAK-2026", "x.bak.1", "x.json.bak", "repo.backup", "repo.backup_old", "a.backup.b", "x.json~"]) assert.equal(backupRule(name), "backup-suffix", name);
  for (const name of ["repo", "WK-backup-check", "repo-backup", "backup_2026", "mybackup", "bakery", "rollback"]) assert.equal(backupRule(name), null, name);
  // A <task-id>.json file is a task record, whatever its ID says.
  for (const name of ["WK-backup-check.json", "RN-1.bak.json", "backup.json"]) assert.equal(backupEntryRule(name), null, name);
  assert.equal(backupEntryRule("RN-1.json.bak"), "backup-suffix"); assert.equal(backupEntryRule("backup"), "backup-directory");
});

test("legacy records are read for stats only when every part is understood", () => {
  const start = Date.parse("2026-10-20T00:00:00Z");
  const item = legacyStatsTask(legacyRecord("RN-1", start), "RN-1");
  assert.equal(item.contract.verification.risk_tier, "standard"); assert.equal(item.history.length, 8);
  assert.throws(() => legacyStatsTask(legacyRecord("RN-2", start, { extraAction: "approve" }), "RN-2"), /\/history\/8\/action must be equal to one of the allowed values/);
  const broken = legacyRecord("RN-3", start); broken.history[2].summary = "Edited later";
  assert.throws(() => legacyStatsTask(broken, "RN-3"), /integrity failure/);
  // Unknown fields and values fail at every level, even with valid digests.
  for (const [mutate, message] of [
    [item => { item.future_field = 1; }, /\/ must NOT have additional properties \(future_field\)/],
    [item => { item.contract.future_field = 1; }, /\/contract must NOT have additional properties \(future_field\)/],
    [item => { item.contract.state = "shipped"; }, /\/contract\/state must be equal to one of the allowed values/],
    [item => { item.contract.verification.future_field = 1; }, /\/contract\/verification must NOT have additional properties/],
    [item => { item.delivery.future_field = 1; }, /\/delivery/],
    [item => { item.review.judgment = "maybe"; }, /\/review/],
    [item => { item.attempts[0].future_field = 1; }, /\/attempts\/0/],
    [item => { item.attempts[0].kind = "abandoned"; }, /\/attempts\/0/],
    [item => { item.authority_pins[0].note = "x"; }, /\/authority_pins\/0 must NOT have additional properties/]
  ]) assert.throws(() => legacyStatsTask(legacyRecord("RN-4", start, { mutate }), "RN-4"), message);
});

test("stats --report merges current and legacy projects with one period and keeps each source", async t => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-multi-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const current = await currentProject(parent, "current");
  const start = Date.now() - 2 * 86400000;
  const good = legacyRecord("RN-1", start);
  const broken = legacyRecord("RN-3", start); broken.history[2].summary = "Edited later";
  const nested = legacyRecord("RN-5", start, { mutate: item => { item.contract.future_field = 1; } });
  const legacy = await legacyProject(parent, "legacy", { "RN-1.json": good, "RN-1.json.bak": JSON.stringify(good), "RN-2.json": legacyRecord("RN-2", start, { extraAction: "approve" }),
    "RN-3.json": broken, "RN-5.json": nested, "WK-backup-check.json": legacyRecord("WK-backup-check", start), "backup/RN-1.json": good });
  // Backups inside a current-format task store are skipped too.
  const copy = await fs.readFile(path.join(current, ".ai-org/work-items/WK-now.json"), "utf8");
  await write(current, ".ai-org/work-items/WK-now.json.bak-2026", copy); await write(current, ".ai-org/work-items/backup/WK-now.json", copy);
  const backupCopy = await legacyProject(parent, "legacy.bak-2026", { "RN-1.json": good });
  const backupDir = await legacyProject(parent, "backups/legacy", { "RN-1.json": good });
  const roots = [current, legacy, backupCopy, backupDir, legacy];
  const status = [current, legacy].map(gitStatus), before = await snapshot(parent);
  const settings = { cutoff: new Date(Date.now() + 60000).toISOString(), timezone: "Asia/Tokyo" };

  const report = await readMultiSourceStatsReport(roots, settings);
  assert.equal(report.schema_version, "workkeel.stats-multi-report/v1"); assert.equal(report.mutation_status, "no-write");
  assert.deepEqual(report.excluded_sources, [{ root: backupCopy, rule: "backup-suffix" }, { root: backupDir, rule: "backup-directory" }, { root: legacy, rule: "duplicate" }]);
  assert.deepEqual(report.sources.map(s => [s.format, s.status]), [["current", "ok"], ["legacy-0.1.0-beta.1", "partial"]]);
  const legacySource = report.sources[1];
  assert.deepEqual(legacySource.coverage.excluded, [{ path: ".ai-org/work-items/RN-1.json.bak", rule: "backup-suffix" }, { path: ".ai-org/work-items/backup", rule: "backup-directory" }]);
  assert.deepEqual(report.sources[0].coverage.excluded, [{ path: ".ai-org/work-items/WK-now.json.bak-2026", rule: "backup-suffix" }, { path: ".ai-org/work-items/backup", rule: "backup-directory" }]);
  assert.deepEqual(legacySource.coverage.errors.map(e => e.task_id), ["RN-2", "RN-3", "RN-5"]);
  assert.match(legacySource.coverage.errors[0].message, /action/); assert.match(legacySource.coverage.errors[1].message, /integrity/);
  assert.match(legacySource.coverage.errors[2].message, /\/contract must NOT have additional properties \(future_field\)/);
  assert.equal(legacySource.by_risk.standard.tasks, 2); assert.equal(legacySource.by_risk.standard.first_review_passed, 0);
  assert.equal(legacySource.by_risk.standard.rework.recorded_total_rounds, 2);

  // Merged numbers add both sources; unreadable legacy records stay errors, not zero tasks.
  assert.deepEqual(report.tasks.map(task => [path.basename(task.root), task.task_id]), [["current", "WK-now"], ["legacy", "RN-1"], ["legacy", "WK-backup-check"]]);
  assert.equal(report.by_risk.standard.tasks, 3); assert.equal(report.by_risk.standard.entered_first_review, 3);
  assert.equal(report.by_risk.standard.first_pass_rate, 1 / 3);
  assert.equal(report.coverage.errors.length, 3); assert.ok(report.coverage.errors.every(e => e.root === legacy));
  assert.equal(report.coverage.complete, false);
  assert.deepEqual(report.coverage.sources, { requested: 5, read: 2, ok: 1, partial: 1, failed: 0, excluded: 3 });
  // Two legacy tasks share the "[tests]" rework reason, so they form one candidate.
  assert.equal(report.stop_reason, "complete"); assert.equal(strictFailure(report), true);
  assert.deepEqual(report.suggestions.map(s => [s.category, s.task_ids]), [["tests", ["RN-1", "WK-backup-check"]]]);
  assert.deepEqual(embedded(formatStatsReport(report)), report);
  assert.match(formatStatsReport(report), /## Sources[\s\S]*legacy-0\.1\.0-beta\.1 \| partial/);

  // Each source fingerprint equals the single-source report of that root.
  const single = await readStatsReport(current, settings);
  assert.equal(report.sources[0].fingerprint, single.input.fingerprint);
  assert.deepEqual(single.input.excluded, report.sources[0].coverage.excluded); assert.equal(single.coverage.tasks, 1);
  // Only the report skips backups; status still refuses an unexpected task store entry.
  const listed = spawnSync(process.execPath, [cli, "status", current], { encoding: "utf8" });
  assert.equal(listed.status, 1); assert.match(listed.stderr, /Unexpected file in task store/);
  assert.equal((await readMultiSourceStatsReport(roots, { ...settings, previous: report.input.fingerprint })).stop_reason, "unchanged");

  // A legacy project read alone names its format; the read never writes.
  const alone = await readStatsReport(legacy, settings);
  assert.equal(alone.input.format, "legacy-0.1.0-beta.1"); assert.deepEqual(alone.tasks.map(task => task.task_id), ["RN-1", "WK-backup-check"]);
  assert.deepEqual(await snapshot(parent), before);
  assert.deepEqual([current, legacy].map(gitStatus), status);
});

test("a failed source marks source-error, and --strict gives schedulers a nonzero exit", async t => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-multi-error-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const current = await currentProject(parent, "current");
  const start = Date.now() - 86400000, broken = legacyRecord("RN-3", start); broken.history[0].at = "not a time";
  const unreadable = await legacyProject(parent, "unreadable", { "RN-3.json": broken });
  const unknownPin = await legacyProject(parent, "unknown-pin", { "RN-1.json": legacyRecord("RN-1", start) }, { version: "0.0.9" });
  const missing = path.join(parent, "missing");
  const cutoff = new Date(Date.now() + 60000).toISOString();
  const report = await readMultiSourceStatsReport([current, unreadable, unknownPin, missing], { cutoff, timezone: "UTC" });
  assert.equal(report.stop_reason, "source-error");
  assert.deepEqual(report.sources.map(s => s.status), ["ok", "failed", "failed", "failed"]);
  assert.match(report.sources[2].coverage.errors[0].message, /not 0\.1\.0-beta\.1/);
  assert.match(report.sources[3].coverage.errors[0].message, /not a readable directory/);
  for (const s of report.sources.slice(1)) assert.equal(s.by_risk.standard.tasks, null, "a failed source is unknown, not zero");
  assert.equal(report.by_risk.standard.tasks, 1); assert.equal(report.by_risk.standard.rework.total_rounds, null);
  assert.equal(report.by_risk.standard.rework.coverage, "partial");

  const list = path.join(parent, "projects.txt");
  await fs.writeFile(list, "# weekly sources\ncurrent\n\nunreadable\n");
  assert.deepEqual(await readSourceList(list), [current, unreadable]);
  const run = (...args) => spawnSync(process.execPath, [cli, "stats", "--report", "--json", "--cutoff", cutoff, "--timezone", "UTC", ...args], { encoding: "utf8" });
  const lenient = run("--projects-file", list);
  assert.equal(lenient.status, 0); assert.equal(JSON.parse(lenient.stdout).stop_reason, "source-error");
  const strict = run("--projects-file", list, "--strict");
  assert.equal(strict.status, 3); assert.equal(JSON.parse(strict.stdout).coverage.sources.failed, 1);
  assert.equal(run("--project", current, "--strict").status, 0);
  assert.equal(run("--project", current, "--project", unreadable).status, 0);
  const mixed = spawnSync(process.execPath, [cli, "stats", current, "--report", "--project", current, "--cutoff", cutoff, "--timezone", "UTC"], { encoding: "utf8" });
  assert.equal(mixed.status, 1); assert.match(mixed.stderr, /not as a positional target/);

  // Lifecycle and status commands still refuse the legacy pin.
  const legacy = await legacyProject(parent, "legacy", { "RN-1.json": legacyRecord("RN-1", start) });
  for (const args of [["status", legacy], ["task", "claim", legacy, "--id", "RN-1", "--actor", "builder"]]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
    assert.equal(result.status, 1); assert.match(result.stderr, /Task-first project pin is unsupported/);
  }
});

test("single-source report keeps its output and exit code", async t => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-single-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  // An unknown project schema is the source error a 1.x CLI reported for old projects.
  const current = await currentProject(parent, "current"), unknown = path.join(parent, "unknown");
  await write(unknown, "workkeel.lock", JSON.stringify({ schema_version: "workkeel.project/v9", cli: { package_name: "@zsz1210/workkeel", version: "1.0.2" }, policy }));
  git(unknown, "init", "-q");
  const cutoff = new Date(Date.now() + 60000).toISOString();
  const report = await readStatsReport(current, { cutoff, timezone: "UTC" });
  assert.equal(report.schema_version, "workkeel.stats-report/v1");
  assert.deepEqual(Object.keys(report), ["schema_version", "authority", "mutation_status", "model_called", "rules_version", "rules", "period", "input",
    "by_risk", "tasks", "reasons", "suggestions", "coverage", "stop_reason", "next_steps", "limitations"]);
  assert.deepEqual(Object.keys(report.input), ["fingerprint", "sources"]);
  assert.equal(Object.hasOwn(report.tasks[0], "root"), false);
  const run = (...args) => spawnSync(process.execPath, [cli, "stats", ...args, "--report", "--json", "--cutoff", cutoff, "--timezone", "UTC"], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(run(current).stdout), report);
  // A source error still exits 0 without --strict, as before.
  const failed = run(unknown);
  assert.equal(failed.status, 0); assert.equal(JSON.parse(failed.stdout).stop_reason, "source-error");
  assert.match(JSON.parse(failed.stdout).coverage.errors[0].message, /pin is unsupported/);
  assert.equal(run(unknown, "--strict").status, 3);
});
