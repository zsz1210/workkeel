import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { initializeTaskProject } from "../src/workkeel-project.mjs";
import { createNativeTask, mutateNativeTask, readNativeTask } from "../src/workkeel-tasks.mjs";
import { DEFAULT_SELF_EVAL, readScoreStats, validateReviewScore } from "../src/workkeel-scoring.mjs";

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
  assert.deepEqual(score.self_eval, DEFAULT_SELF_EVAL);
  assert.deepEqual(validateReviewScore({ external_score: { rubric: "non-code", scores: { requirements: 3 } } }).external_score.max, 5);
  for (const [bad, message] of [
    [codeScore({ requirements: 5, correctness: 4, tests: 3 }), /missing field maintainability/],
    [codeScore({ requirements: 6, correctness: 4, tests: 3, maintainability: 4 }), /1 to 5/],
    [{ external_score: { rubric: "non-code", scores: { requirements: 3, tests: 2 } } }, /unknown field tests/],
    [{ external_score: { rubric: "visual", scores: {} } }, /rubric must be/],
    [{ external_score: { rubric: "non-code", scores: { requirements: 3 }, total: 4 } }, /sum/],
    [{ external_score: { rubric: "non-code", scores: { requirements: 3 } }, findings: [{ level: "P0", note: "x" }] }, /P1-P3/],
    [{ external_score: { rubric: "non-code", scores: { requirements: 3 } }, self_eval: { enabled: true } }, /missing field/]
  ]) assert.throws(() => validateReviewScore(bad), message);
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
  assert.deepEqual(Object.keys(record), ["task_id", "risk", "model", "reasoning_effort", "self_eval", "external_score", "rework"]);
  assert.equal(record.risk, "standard"); assert.equal(record.model, "builder-model"); assert.equal(record.self_eval.enabled, false);
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
  assert.deepEqual(stats.errors, []);
});
