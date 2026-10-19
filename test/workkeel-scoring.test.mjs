import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { initializeTaskProject } from "../src/workkeel-project.mjs";
import { createNativeTask, mutateNativeTask, readNativeTask } from "../src/workkeel-tasks.mjs";
import { readScoreStats, taskScoreRecord, validateReviewScore } from "../src/workkeel-scoring.mjs";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "../bin/workkeel.mjs");
const builder = { agent_id: "builder", principal_id: "owner" };
const reviewer = { agent_id: "reviewer", principal_id: "owner" };
const policy = { schema_version: "workkeel.task-policy/v1", principals: ["owner"], agents: [builder, reviewer],
  approvers: ["owner"], review_separation: "distinct-agent" };
let operation = 0;
const request = (version, actor, extra = {}) => ({ expected_version: version, operation_id: `op-${++operation}`, actor, ...extra });
const contract = (id, tier, write) => ({ schema_version: "workkeel.task-contract/v2", id, goal: `Scoring fixture ${id}`, state: "intake",
  scope: { include: ["fixture change"], exclude: [] }, actor: builder, dependencies: [],
  acceptance: { criteria: ["The change is reviewed"], evidence: [] }, handoff: null,
  verification: { risk_tier: tier, separation: "distinct-agent", implementer: null, reviewer: null, candidate_revision: null },
  environment: { cwd: ".", read_paths: ["."], write_paths: [write], tools: ["node"], resources: [],
    network: { mode: "none", hosts: [] }, external_actions: [], data: { classification: "internal", model_access: "none", policy_refs: ["docs/approval.md"] } },
  authorization: { approved_by: "owner", approval_ref: "docs/approval.md", operations: ["read", "write", "execute"], expires_at: null }, skills: [],
  execution: { runtime: { kind: "host-owned", adapter_id: null, required_features: [] }, model_connection: { kind: "native" } } });
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
async function write(root, ref, data) { await fs.mkdir(path.dirname(path.join(root, ref)), { recursive: true }); await fs.writeFile(path.join(root, ref), data); }
const codeScore = (scores, extra = {}) => ({ model: "builder-model", reasoning_effort: "high",
  external_score: { reviewer_model: "reviewer-model", rubric: "code", scores }, ...extra });

test("a review score is a code or non-code rubric with 1-5 integers", () => {
  const score = validateReviewScore(codeScore({ requirements: 5, correctness: 4, tests: 3, maintainability: 4 }));
  assert.deepEqual(score.external_score, { reviewer_model: "reviewer-model", rubric: "code",
    scores: { requirements: 5, correctness: 4, tests: 3, maintainability: 4 }, total: 16, max: 20 });
  assert.equal(Object.hasOwn(score, 'self_eval'), false);
  assert.deepEqual(validateReviewScore({ external_score: { rubric: "non-code", scores: { requirements: 3 } } }).external_score.max, 5);
  for (const [bad, message] of [
    [codeScore({ requirements: 5, correctness: 4, tests: 3 }), /missing field maintainability/],
    [codeScore({ requirements: 6, correctness: 4, tests: 3, maintainability: 4 }), /1 to 5/],
    [{ external_score: { rubric: "non-code", scores: { requirements: 3, tests: 2 } } }, /unknown field tests/],
    [{ external_score: { rubric: "visual", scores: {} } }, /rubric must be/],
    [{ external_score: { rubric: "non-code", scores: { requirements: 3 }, total: 4 } }, /sum/],
    [{ external_score: { rubric: "non-code", scores: { requirements: 3 } }, findings: [{ level: "P0", note: "x" }] }, /P1-P3/],
    [{ external_score: { rubric: "non-code", scores: { requirements: 3 } }, self_eval: { enabled: true } }, /unknown field self_eval/]
  ]) assert.throws(() => validateReviewScore(bad), message);
});

test("historical self_eval is ignored without rewriting evidence or relaxing validation", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-scoring-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const ref = "review.json", revision = "a".repeat(40);
  const score = codeScore({ requirements: 5, correctness: 4, tests: 3, maintainability: 4 }, { self_eval: { enabled: true } });
  const content = JSON.stringify({ schema_version: "workkeel.review-report/v1", task_id: "WK-old", revision, reviewer, judgment: "pass", score });
  await write(root, ref, content);
  const errors = [], item = { id: "WK-old", contract: { verification: { risk_tier: "standard" } }, attempts: [], review: { revision, actor: reviewer, judgment: "pass", evidence: [{ path: ref }] } };
  const record = await taskScoreRecord(root, item, errors);
  assert.equal(record.external_score.total, 16);assert.equal(Object.hasOwn(record, "self_eval"), false);
  assert.deepEqual(errors, []);assert.equal(await fs.readFile(path.join(root, ref), "utf8"), content);
  assert.throws(() => validateReviewScore(score), /unknown field self_eval/);
});

test("stats report scores and rework reasons by risk tier without writing", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-scoring-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  git(root, "init", "-q"); git(root, "config", "user.name", "Fixture"); git(root, "config", "user.email", "fixture@example.invalid");
  await write(root, "docs/approval.md", "Approved synthetic fixture work.\n"); await write(root, "src/cart.mjs", "export const total = 1;\n");
  await initializeTaskProject(root, policy);
  git(root, "add", "."); git(root, "commit", "-qm", "base");

  let version = 0;
  const id = "WK-scored", step = async (action, actor, extra) => (version = (await mutateNativeTask(root, id, action, request(version, actor, extra))).version);
  const deliver = async round => {
    const claim = await mutateNativeTask(root, id, "claim", request(version, builder, { base_revision: git(root, "rev-parse", "HEAD") }));
    version = claim.version;
    await write(root, "src/cart.mjs", `export const total = ${round + 1};\n`); git(root, "add", "src/cart.mjs"); git(root, "commit", "-qm", `round ${round}`);
    const revision = git(root, "rev-parse", "HEAD"), ref = `.ai-org/artifacts/${id}/developer-${round}.md`;
    await write(root, ref, `Verified ${revision}.\n`);
    await step("handoff", builder, { claim_id: claim.claim.id, revision, summary: "Delivered", evidence: [ref], unresolved: [] });
    return revision;
  };
  const review = async (revision, round, judgment, score) => {
    const ref = `.ai-org/artifacts/${id}/review-${round}.json`;
    await write(root, ref, JSON.stringify({ schema_version: "workkeel.review-report/v1", task_id: id, stage: "review", revision,
      reviewer, judgment, summary: "Independent review", score }));
    await step("review", reviewer, { revision, judgment, summary: "Reviewed", evidence: [ref] });
  };
  ({ version } = await createNativeTask(root, contract(id, "standard", "src"), request(0, builder)));
  await review(await deliver(1), 1, "fail", codeScore({ requirements: 2, correctness: 2, tests: 3, maintainability: 4 }, {
    findings: [{ level: "P1", note: "Total ignores discounts" }, { level: "P3", note: "Naming nit" }] }));
  await step("rework", builder, { summary: "Fix the discount total" });
  await review(await deliver(2), 2, "fail", { ...codeScore({ requirements: 4, correctness: 3, tests: 3, maintainability: 4 }), total: 14 });
  await step("rework", builder, { summary: "Add the missing rounding test" });
  await review(await deliver(3), 3, "pass", codeScore({ requirements: 5, correctness: 5, tests: 4, maintainability: 4 }));
  // A second, unscored low-risk task with a malformed score in its report.
  const other = "WK-other";
  await createNativeTask(root, contract(other, "low", "docs"), request(0, builder));
  const claim = await mutateNativeTask(root, other, "claim", request(1, builder, { base_revision: git(root, "rev-parse", "HEAD") }));
  await write(root, "docs/guide.md", "Guide\n"); git(root, "add", "docs/guide.md"); git(root, "commit", "-qm", "docs");
  const docRevision = git(root, "rev-parse", "HEAD");
  await mutateNativeTask(root, other, "handoff", request(2, builder, { claim_id: claim.claim.id, revision: docRevision, summary: "Docs", evidence: [], unresolved: [] }));
  await write(root, `.ai-org/artifacts/${other}/review.json`, JSON.stringify({ schema_version: "workkeel.review-report/v1", task_id: other, stage: "review",
    revision: docRevision, reviewer, judgment: "pass", summary: "Fine", score: { external_score: { rubric: "code", scores: { requirements: 5 } } } }));
  await mutateNativeTask(root, other, "review", request(3, reviewer, { revision: docRevision, judgment: "pass", summary: "Fine", evidence: [`.ai-org/artifacts/${other}/review.json`] }));

  const before = git(root, "status", "--porcelain");
  const stats = await readScoreStats(root);
  assert.equal(git(root, "status", "--porcelain"), before);
  const record = stats.records.find(r => r.task_id === id);
  assert.deepEqual(Object.keys(record), ["task_id", "risk", "model", "reasoning_effort", "external_score", "rework"]);
  assert.equal(record.risk, "standard"); assert.equal(record.model, "builder-model");
  assert.deepEqual(record.external_score, { reviewer_model: "reviewer-model", rubric: "code",
    scores: { requirements: 5, correctness: 5, tests: 4, maintainability: 4 }, total: 18, max: 20, review_round: 3 });
  // P3 findings are not rework reasons; a failed review without findings falls back to the rework summary.
  assert.deepEqual(record.rework, { rounds: 2, reasons: [{ round: 1, level: "P1", note: "Total ignores discounts" },
    { round: 2, level: null, note: "Add the missing rounding test" }] });
  assert.deepEqual(stats.by_risk.standard.scores.code, { tasks: 1, max: 20, average_total: 18,
    average_by_criterion: { requirements: 5, correctness: 5, tests: 4, maintainability: 4 } });
  assert.deepEqual(stats.by_risk.standard.rework, { total_rounds: 2, average_rounds: 2, max_rounds: 2, tasks_reworked: 1,
    reasons_by_level: { P1: 1, P2: 0, unclassified: 1 } });
  assert.equal(stats.records.find(r => r.task_id === other).external_score, null);
  assert.deepEqual(stats.by_risk.low.scores, {});
  assert.match(stats.errors.find(e => e.task_id === other).message, /missing field correctness/);

  const output = JSON.parse(execFileSync(process.execPath, [cli, "stats", root], { encoding: "utf8" }));
  assert.equal(output.schema_version, "workkeel.stats/v1"); assert.equal(output.mutation_status, "no-write");
  assert.deepEqual(output.by_risk, stats.by_risk);
});

test("review evidence committed in the candidate is read from that revision, not the working tree", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-scoring-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  git(root, "init", "-q"); git(root, "config", "user.name", "Fixture"); git(root, "config", "user.email", "fixture@example.invalid");
  await write(root, "docs/approval.md", "Approved synthetic fixture work.\n");
  await initializeTaskProject(root, policy);
  git(root, "add", "."); git(root, "commit", "-qm", "base");
  const id = "WK-committed", ref = "docs/review.json";
  const report = revision => JSON.stringify({ schema_version: "workkeel.review-report/v1", task_id: id, stage: "review", revision,
    reviewer, judgment: "pass", summary: "Reviewed", score: { external_score: { rubric: "non-code", scores: { requirements: 4 } } } });
  await createNativeTask(root, contract(id, "low", "docs"), request(0, builder));
  const claim = await mutateNativeTask(root, id, "claim", request(1, builder, { base_revision: git(root, "rev-parse", "HEAD") }));
  // The candidate commits a report that cannot name itself; a matching copy exists only in the working tree.
  await write(root, ref, report("0".repeat(40))); git(root, "add", ref); git(root, "commit", "-qm", "report");
  const revision = git(root, "rev-parse", "HEAD");
  await mutateNativeTask(root, id, "handoff", request(2, builder, { claim_id: claim.claim.id, revision, summary: "Docs", evidence: [], unresolved: [] }));
  await mutateNativeTask(root, id, "review", request(3, reviewer, { revision, judgment: "pass", summary: "Fine", evidence: [ref] }));
  assert.deepEqual((await readNativeTask(root, id)).review.evidence, [{ path: ref, source: "candidate" }]);
  await write(root, ref, report(revision));

  const stats = await readScoreStats(root);
  assert.equal(stats.records.find(r => r.task_id === id).external_score, null);
  assert.match(stats.errors[0].message, /source differs/);
});

test("a score counts only from the actual reviewer, and conflicting reviewer scores stay unknown", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-scoring-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  git(root, "init", "-q"); git(root, "config", "user.name", "Fixture"); git(root, "config", "user.email", "fixture@example.invalid");
  await write(root, "docs/approval.md", "Approved synthetic fixture work.\n");
  await initializeTaskProject(root, policy);
  git(root, "add", "."); git(root, "commit", "-qm", "base");
  const report = (id, revision, by, value) => JSON.stringify({ schema_version: "workkeel.review-report/v1", task_id: id, stage: "review", revision,
    reviewer: by, judgment: "pass", summary: "Reviewed", score: { external_score: { rubric: "non-code", scores: { requirements: value } } } });
  const reviewed = async (id, reports) => {
    await createNativeTask(root, contract(id, "low", "docs"), request(0, builder));
    const claim = await mutateNativeTask(root, id, "claim", request(1, builder, { base_revision: git(root, "rev-parse", "HEAD") }));
    await write(root, `docs/${id}.md`, "Doc\n"); git(root, "add", "docs"); git(root, "commit", "-qm", id);
    const revision = git(root, "rev-parse", "HEAD");
    await mutateNativeTask(root, id, "handoff", request(2, builder, { claim_id: claim.claim.id, revision, summary: "Docs", evidence: [], unresolved: [] }));
    const refs = [];
    for (const [n, [by, value]] of reports.entries()) { const ref = `.ai-org/artifacts/${id}/report-${n}.json`; await write(root, ref, report(id, revision, by, value)); refs.push(ref); }
    await mutateNativeTask(root, id, "review", request(3, reviewer, { revision, judgment: "pass", summary: "Fine", evidence: refs }));
  };
  await reviewed("WK-self", [[builder, 5], [reviewer, 2]]);
  await reviewed("WK-conflict", [[reviewer, 5], [reviewer, 2]]);
  const stats = await readScoreStats(root);
  assert.equal(stats.records.find(r => r.task_id === "WK-self").external_score.total, 2);
  assert.equal(stats.records.find(r => r.task_id === "WK-conflict").external_score, null);
  assert.match(stats.errors.find(e => e.task_id === "WK-conflict").message, /Conflicting/);
});

test("stats --report turns repeated reasons, low scores and missing scores into evidence-backed suggestions", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-scoring-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  git(root, "init", "-q"); git(root, "config", "user.name", "Fixture"); git(root, "config", "user.email", "fixture@example.invalid");
  await write(root, "docs/approval.md", "Approved synthetic fixture work.\n");
  await initializeTaskProject(root, policy);
  git(root, "add", "."); git(root, "commit", "-qm", "base");
  // Each review is [judgment, score or undefined]; a failed review is followed by rework.
  const run = async (id, reviews) => {
    let version = (await createNativeTask(root, contract(id, "standard", `src/${id}`), request(0, builder))).version;
    for (const [round, [judgment, score]] of reviews.entries()) {
      const claim = await mutateNativeTask(root, id, "claim", request(version, builder, { base_revision: git(root, "rev-parse", "HEAD") }));
      await write(root, `src/${id}/file.mjs`, `export const round = ${round};\n`); git(root, "add", "src"); git(root, "commit", "-qm", `${id} ${round}`);
      const revision = git(root, "rev-parse", "HEAD"), ref = `.ai-org/artifacts/${id}/review-${round}.json`, delivered = `.ai-org/artifacts/${id}/developer-${round}.md`;
      await write(root, delivered, `Verified ${revision}.\n`);
      version = (await mutateNativeTask(root, id, "handoff", request(claim.version, builder, { claim_id: claim.claim.id, revision, summary: "Delivered", evidence: [delivered], unresolved: [] }))).version;
      await write(root, ref, JSON.stringify({ schema_version: "workkeel.review-report/v1", task_id: id, stage: "review", revision, reviewer, judgment, summary: "Review", score }));
      version = (await mutateNativeTask(root, id, "review", request(version, reviewer, { revision, judgment, summary: "Reviewed", evidence: [ref] }))).version;
      if (judgment === "fail") version = (await mutateNativeTask(root, id, "rework", request(version, builder, { summary: "Rework" }))).version;
    }
  };
  const missingTest = codeScore({ requirements: 4, correctness: 4, tests: 1, maintainability: 4 }, { findings: [{ level: "P1", note: "Missing regression test." }] });
  await run("WK-a", [["fail", missingTest], ["pass", codeScore({ requirements: 5, correctness: 5, tests: 4, maintainability: 4 })]]);
  await run("WK-b", [["fail", { ...missingTest, findings: [{ level: "P1", note: "missing regression TEST" }] }], ["pass", undefined]]);
  await run("WK-c", [["pass", codeScore({ requirements: 2, correctness: 4, tests: 4, maintainability: 4 })]]);

  const { readStatsReport, formatStatsReport, REPORT_RULES_VERSION } = await import("../src/workkeel-stats-report.mjs");
  const before = git(root, "status", "--porcelain");
  const cutoff = new Date(Date.now() + 60000).toISOString(), settings = { cutoff, timezone: "Asia/Tokyo" };
  const report = await readStatsReport(root, settings);
  assert.equal(git(root, "status", "--porcelain"), before);
  assert.equal(report.rules_version, REPORT_RULES_VERSION); assert.equal(report.model_called, false); assert.equal(report.stop_reason, "complete");
  assert.deepEqual(report.input.sources.map(s => s.task_id), ["WK-a", "WK-b", "WK-c"]);
  assert.match(report.input.fingerprint, /^[0-9a-f]{64}$/);
  const bySignal = Object.groupBy(report.suggestions, s => s.signal);
  assert.deepEqual(bySignal["repeated-rework-reason"].map(s => s.task_ids), [["WK-a", "WK-b"]]);
  assert.deepEqual(bySignal["repeated-rework-reason"][0].evidence.map(e => e.round), [1, 1]);
  assert.equal(report.tasks.find(t => t.task_id === "WK-b").last_review.score, null);
  assert.equal(report.tasks.find(t => t.task_id === "WK-b").first_review.score.external_score.scores.tests, 1);
  assert.ok(report.coverage.missing.some(e => e.task_id === "WK-b"));
  assert.ok(report.next_steps.some(step => step.includes("one L2 proposal")));
  assert.doesNotMatch(formatStatsReport(report), /learning capture|skill-lifecycle candidate/);
  assert.equal(report.by_risk.standard.first_pass_rate, 1 / 3);
  assert.equal(report.by_risk.standard.rework.recorded_total_rounds, 2);
  assert.equal(report.by_risk.standard.rework.total_rounds, null, "missing checks cannot become zero");
  assert.deepEqual(JSON.parse(formatStatsReport(report).split("```json\n")[1].split("\n```")[0]), report);

  // The same input is not reported twice; a period with no activity says so and stops.
  assert.equal((await readStatsReport(root, { ...settings, previous: report.input.fingerprint })).stop_reason, "unchanged");
  const later = await readStatsReport(root, { cutoff: new Date(Date.now() + 8 * 86400000).toISOString(), timezone: "UTC" });
  assert.equal(later.stop_reason, "no-input"); assert.deepEqual(later.suggestions, []);
  assert.match(formatStatsReport(later), /No new input/);
  await assert.rejects(readStatsReport(root, { days: 0 }), /--days/);
  await assert.rejects(readStatsReport(root), /--cutoff/);

  // A reviewed task without a score block is missing data, and the fingerprint moves.
  await run("WK-d", [["pass", undefined]]);
  const next = await readStatsReport(root, { ...settings, previous: report.input.fingerprint });
  assert.notEqual(next.input.fingerprint, report.input.fingerprint); assert.equal(next.stop_reason, "complete");
  assert.ok(next.coverage.missing.some(s => s.task_id === "WK-d" && s.message.includes("no usable")));

  const unchanged = git(root, "status", "--porcelain");
  const markdown = execFileSync(process.execPath, [cli, "stats", root, "--report", "--cutoff", cutoff, "--timezone", "Asia/Tokyo"], { encoding: "utf8" });
  assert.match(markdown, /^# Workkeel stats report/); assert.match(markdown, /repeated-rework-reason/); assert.match(markdown, /one L2 proposal/);
  const json = JSON.parse(execFileSync(process.execPath, [cli, "stats", root, "--report", "--json", "--days", "7", "--previous", next.input.fingerprint, "--cutoff", cutoff, "--timezone", "Asia/Tokyo"], { encoding: "utf8" }));
  assert.equal(json.schema_version, "workkeel.stats-report/v1"); assert.equal(json.stop_reason, "unchanged");
  assert.equal(git(root, "status", "--porcelain"), unchanged);
});

test('weekly boundaries use events, pending reviews, global rounds and deduplicated check/review repairs', async t => {
  const { executionDigest } = await import('../src/workkeel-execution-policy.mjs');
  const { readStatsReport } = await import('../src/workkeel-stats-report.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workkeel-weekly-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  git(root, 'init', '-q'); await write(root, 'docs/approval.md', 'Synthetic approval.\n'); await initializeTaskProject(root, policy);
  const start = Date.parse('2026-10-12T00:00:00Z'), end = start + 7 * 86400000, time = delta => new Date(start + delta).toISOString();
  const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40);
  const event = (action, delta, state, revision = null, judgment) => ({ action, at: time(delta), state, revision, actor: action === 'review' ? reviewer : builder, ...(judgment ? { judgment } : {}) });
  // Synthetic historical records exercise the verified native reader and hash
  // chain; no real task or retained maintainer state is used.
  const historical = async (id, events, extra = {}) => {
    await createNativeTask(root, contract(id, 'standard', 'src'), request(0, builder));
    const item = await readNativeTask(root, id);
    Object.assign(item, extra, { version: events.length, state: events.at(-1).state });
    const body = Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'history'));
    let previous = null;
    item.history = events.map((e, n) => {
      const bodyEvent = { ...e, sequence: n + 1, operation_id: `synthetic-${n}`, request_sha256: 'a'.repeat(64), record_sha256: executionDigest(body), previous_hash: previous };
      previous = executionDigest(bodyEvent); return { ...bodyEvent, hash: previous };
    });
    await write(root, `.ai-org/work-items/${id}.json`, JSON.stringify(item));
  };
  const reviewed = async (id, candidate, judgment, n, findings = []) => {
    const ref = `.ai-org/artifacts/${id}/score-${n}.json`;
    await write(root, ref, JSON.stringify({ schema_version: 'workkeel.review-report/v1', task_id: id, revision: candidate, judgment, reviewer,
      score: codeScore({ requirements: n, correctness: 4, tests: 4, maintainability: 4 }, { findings }) }));
    return { revision: candidate, judgment, actor: reviewer, evidence: [{ path: ref, source: 'private' }] };
  };
  const old = await reviewed('WK-bound', A, 'fail', 1), current = await reviewed('WK-bound', B, 'fail', 2), future = await reviewed('WK-bound', C, 'pass', 5);
  await historical('WK-bound', [event('create', -4 * 86400000, 'intake'), event('handoff', -3 * 86400000, 'test', A), event('review', -3 * 86400000 + 1, 'test', A, 'fail'),
    { ...event('rework', -2 * 86400000, 'intake'), summary: '[evidence] Missing proof' }, event('handoff', 0, 'test', B), event('review', 1, 'test', B, 'fail'),
    { ...event('rework', 2, 'intake'), summary: '[evidence] Missing proof' }, event('handoff', 8 * 86400000, 'test', C), event('review', 8 * 86400000 + 1, 'release_gate', C, 'pass')],
    { attempts: [{ kind: 'rejected', review: old, summary: '[evidence] Missing proof' }, { kind: 'rejected', review: current, summary: '[evidence] Missing proof' }], review: future });
  await historical('WK-pending', [event('create', -100, 'intake'), event('handoff', 100, 'test', A)]);
  await historical('WK-never', [event('create', 0, 'intake')]);
  await historical('WK-cutoff', [event('create', end - start, 'intake')]);
  const failed = await reviewed('WK-fix', B, 'fail', 2, [{ level: 'P1', note: '[evidence] Missing proof' }, { level: 'P2', note: '[evidence] Second finding, same round' }]);
  await historical('WK-fix', [event('create', -100, 'intake'), event('claim', 10, 'build'), event('handoff', 40, 'test', B), event('review', 50, 'test', B, 'fail'),
    { ...event('rework', 60, 'build'), summary: '[evidence] Missing proof' }], { attempts: [{ kind: 'rejected', review: failed, summary: '[evidence] Missing proof' }] });
  const operation = (id, phase, cycle, candidate, delta, checks) => ({ id, at: time(delta), input: { task_id: 'WK-fix', phase, cycle, candidate }, status: 'completed', result: { checks, usage: { input_tokens: 20, output_tokens: 5, cost_usd: 0 } } });
  const goal = { id: 'synthetic-checks', operations: [operation('verify-a', 'verification', 0, A, 20, [{ id: 'one', status: 'fail' }, { id: 'two', status: 'fail' }]),
    operation('repair-a', 'repair', 1, A, 30), operation('verify-b', 'verification', 1, B, 40, [{ id: 'one', status: 'pass' }, { id: 'two', status: 'pass' }]), operation('repair-b', 'repair', 2, B, 70)] };
  await write(root, '.ai-org/goals/synthetic-checks/state.json', JSON.stringify({ value: goal, sha256: executionDigest(goal) }));
  const settings = { cutoff: new Date(end).toISOString(), timezone: 'Asia/Tokyo' }, report = await readStatsReport(root, settings);
  assert.deepEqual(report.tasks.map(t => t.task_id), ['WK-bound', 'WK-fix', 'WK-never', 'WK-pending']);
  const bound = report.tasks.find(t => t.task_id === 'WK-bound');
  assert.equal(bound.state, 'intake', 'future updates do not replace cutoff state');
  assert.equal(bound.first_review.score.external_score.total, 13); assert.equal(bound.last_review.score.external_score.total, 14);
  assert.equal(bound.last_review.candidate, B); assert.deepEqual(bound.last_review.reviewer, reviewer);
  assert.equal(bound.rework.iterations[0].round, 2, 'global round does not reset at the weekly boundary');
  const fix = report.tasks.find(t => t.task_id === 'WK-fix');
  assert.equal(fix.rework.rounds, 2); assert.deepEqual(fix.rework.iterations.map(r => r.kind), ['check-repair', 'review-repair']);
  assert.equal(report.by_risk.standard.rework.recorded_total_rounds, 3, 'several findings and checks do not multiply repair rounds');
  assert.deepEqual(report.by_risk.standard.pending_first_review, ['WK-pending']);
  assert.deepEqual(report.by_risk.standard.not_yet_reviewed, ['WK-never']);
  assert.equal(report.by_risk.standard.entered_first_review, 2); assert.equal(report.by_risk.standard.first_pass_rate, 0);
  assert.equal(report.suggestions[0].category, 'evidence');
  assert.equal(report.tasks.find(t => t.task_id === 'WK-fix').tokens.optimization_target, false);
  assert.notEqual((await readStatsReport(root, { ...settings, timezone: 'UTC' })).input.fingerprint, report.input.fingerprint);
  await assert.rejects(readStatsReport(root, { ...settings, cutoff: '2026-10-19' }), /offset/);
  await assert.rejects(readStatsReport(root, { ...settings, timezone: 'bad-zone' }), /timezone/);
});

test('empty, no-candidate and bounded partial weekly reports all emit and stop without writes', async t => {
  const { executionDigest } = await import('../src/workkeel-execution-policy.mjs');
  const { readStatsReport, formatStatsReport } = await import('../src/workkeel-stats-report.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workkeel-weekly-empty-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  git(root, 'init', '-q'); await write(root, 'docs/approval.md', 'Synthetic approval.\n'); await initializeTaskProject(root, policy);
  const settings = { cutoff: new Date(Date.now() + 60000).toISOString(), timezone: 'UTC' };
  const empty = await readStatsReport(root, settings); assert.equal(empty.stop_reason, 'no-input'); assert.equal(empty.model_called, false);
  await createNativeTask(root, contract('WK-seed', 'standard', 'src'), request(0, builder));
  const only = await readStatsReport(root, settings); assert.equal(only.stop_reason, 'no-candidate');
  assert.equal(only.by_risk.standard.first_pass_rate, null); assert.equal(only.by_risk.standard.rework.total_rounds, null);
  const seed = await readNativeTask(root, 'WK-seed');
  for(let i=0;i<35;i++){
    const item=structuredClone(seed);item.id=item.contract.id=`WK-extra-${i}`;item.contract_sha256=executionDigest(item.contract);
    const e=item.history[0];e.record_sha256=executionDigest(Object.fromEntries(Object.entries(item).filter(([k])=>k!=='history')));
    const {hash,...body}=e;item.history[0]={...body,hash:executionDigest(body)};
    await write(root,`.ai-org/work-items/${item.id}.json`,JSON.stringify(item));
  }
  const ref=path.join(root,'.ai-org/work-items/WK-seed.json'),before=await fs.readFile(ref,'utf8');
  const partial=await readStatsReport(root,settings);assert.equal(partial.stop_reason,'operation-limit');
  assert.ok(partial.coverage.errors.some(e=>e.message.includes('operation-limit')));
  assert.deepEqual(JSON.parse(formatStatsReport(partial).split('```json\n')[1].split('\n```')[0]),partial);
  assert.equal(await fs.readFile(ref,'utf8'),before);
  await assert.rejects(fs.access(path.join(root,'.ai-org/loop/run.json')),{code:'ENOENT'});
});

test('rework categories preserve explicit source labels and leave unclassified prose unknown',async()=>{
  const {projectReworkIterations,REWORK_CATEGORIES}=await import('../src/workkeel-scoring.mjs');
  const events=REWORK_CATEGORIES.map((category,i)=>({action:'rework',at:new Date(i*1000).toISOString(),summary:category==='unknown'?'Unclassified observation':`[${category}] Synthetic reason`}));
  const rounds=projectReworkIterations('WK-synthetic',events,[],[]);
  assert.deepEqual(rounds.map(r=>r.reasons[0].category),REWORK_CATEGORIES);
  assert.deepEqual(rounds.map(r=>r.round),[1,2,3,4,5,6,7]);
});
