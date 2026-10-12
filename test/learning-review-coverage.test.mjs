import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { learningReviewDigest, recordLearningReview, queryLearningReviews, summarizeLearningReviews, validateLearningReview } from "../src/learning-review.mjs";
import { emptyLearningIndex, syncLearningMetadata, revalidateLearningEntry } from "../src/learning.mjs";
import { compactStatus } from "../src/status.mjs";
import { sha256 } from "../src/files.mjs";

const revision = "a".repeat(40);
const cli = fileURLToPath(new URL("../bin/temple.mjs", import.meta.url));
const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
const runAsync = args => new Promise(resolve => {
  const child = spawn(process.execPath, [cli, ...args]);
  let stdout = "", stderr = "";
  child.stdout.on("data", data => { stdout += data; });
  child.stderr.on("data", data => { stderr += data; });
  child.on("close", status => resolve({ status, stdout, stderr }));
});
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "temple-review-coverage-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  async function put(name, data) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), typeof data === "string" ? data : JSON.stringify(data));
  }
  const item = { schema_version: "temple.work-item/v1", id: "WI-0001", state: "done", scope: ["bounded"], acceptance_criteria: ["passes"], unresolved: [], tested_revision: revision, evidence: ["docs/result.md"], gate_evidence: {} };
  await put(".ai-org/work-items/WI-0001.json", item);
  await put(".ai-org/core/workflow.json", {
    schema_version: "temple.workflow/v2", states: ["intake", "spec", "design", "build", "test", "eval", "independent_qa", "release_gate", "blocked", "done", "concluded", "cancelled"].map(id => ({ id })),
    terminal_states: ["done", "concluded", "cancelled"]
  });
  await put(".ai-org/project/agents.json", { agents: [{ id: "agent-reviewer", active: true }] });
  await put(".ai-org/learning/index.json", emptyLearningIndex());
  await put("docs/result.md", "Observed result\n");
  await put("docs/review.md", "Reviewed this outcome; no recurring lesson.\n");
  const options = { workItemId: item.id, revision, result: "no-new-lesson", actor: "agent-reviewer", evidence: "docs/review.md", learningIds: [] };
  return { root, put, item, options, query: () => queryLearningReviews(root, { workItemId: item.id }) };
}

test("explicit review, idempotent retry, and stale evidence preserve history and existing state", async t => {
  const f = await fixture(t);
  const before = await fs.readFile(path.join(f.root, ".ai-org/work-items/WI-0001.json"));
  const index = await fs.readFile(path.join(f.root, ".ai-org/learning/index.json"));
  assert.equal((await f.query()).items[0].status, "not-reviewed");
  const first = await recordLearningReview(f.root, f.options);
  assert.equal(first.idempotent, false);
  assert.equal((await f.query()).items[0].status, "no-new-lesson");
  assert.equal((await recordLearningReview(f.root, f.options)).idempotent, true);
  await f.put("docs/result.md", "Updated observation\n");
  assert.equal((await f.query()).items[0].status, "review-required");
  const second = await recordLearningReview(f.root, f.options);
  assert.notEqual(first.path, second.path);
  assert.equal((await f.query()).items[0].status, "no-new-lesson");
  assert.deepEqual(await fs.readFile(path.join(f.root, ".ai-org/work-items/WI-0001.json")), before);
  assert.deepEqual(await fs.readFile(path.join(f.root, ".ai-org/learning/index.json")), index);
});

test("compact review counts preserve unknown and errors without returning item bodies", async t => {
  const f = await fixture(t);
  await f.put(".ai-org/work-items/WI-0002.json", { ...f.item, id: "WI-0002", tested_revision: "short" });
  const full = await queryLearningReviews(f.root);
  const short = await queryLearningReviews(f.root, { compact: true });
  assert.deepEqual(short.counts, full.counts);
  assert.equal(short.total, 2);
  assert.equal(short.counts.unknown, 1);
  assert.equal(Object.hasOwn(short, "items"), false);
  assert.equal(short.mutation_performed, false);
  const output = run(["learning", "review-status", f.root, "--compact", "--json"]);
  assert.equal(output.status, 0, output.stderr);
  assert.deepEqual(JSON.parse(output.stdout), short);
  assert.notEqual(run(["learning", "review-status", f.root, "--limit", "1", "--json"]).status, 0);
  const reviews = { recorded: 1, counts: { unknown: 1 }, errors: ["missing source"] };
  assert.deepEqual(compactStatus({ work_items: { total: 0, items: [], by_state: {} }, learning: { reviews }, attention: [] }).learning.reviews, reviews);
  await f.put(".ai-org/learning/reviews/unexpected", "not a directory");
  assert.equal((await queryLearningReviews(f.root, { compact: true })).errors.length, 1);
});

test("explicit supersession preserves v1 bytes and uses chain order with idempotent retries", async t => {
  const f = await fixture(t);
  const first = await recordLearningReview(f.root, f.options);
  const original = await fs.readFile(path.join(f.root, first.path));
  await f.put("docs/review-2.md", "Fresh explicit review after a metadata correction\n");
  const next = { ...f.options, evidence: "docs/review-2.md", supersedes: learningReviewDigest(first.record), reason: "Reviewed changed linked metadata" };
  const second = await recordLearningReview(f.root, next);
  assert.equal(second.record.schema_version, "temple.learning-review/v2");
  assert.equal(validateLearningReview(second.record).valid, true);
  assert.equal((await recordLearningReview(f.root, next)).idempotent, true);
  assert.equal((await f.query()).items[0].review_digest, learningReviewDigest(second.record));
  assert.deepEqual(await fs.readFile(path.join(f.root, first.path)), original);
  await f.put("docs/review-3.md", "Third considered review\n");
  await assert.rejects(recordLearningReview(f.root, { ...next, evidence: "docs/review-3.md" }), /Stale supersession/);
  const third = await recordLearningReview(f.root, { ...next, evidence: "docs/review-3.md", supersedes: learningReviewDigest(second.record) });
  assert.equal((await f.query()).items[0].review_digest, learningReviewDigest(third.record));
  await assert.rejects(recordLearningReview(f.root, next), /Stale supersession/);
  assert.equal((await f.query()).items[0].record_count, 3);
  assert.equal((await recordLearningReview(f.root, { ...f.options, evidence: "docs/review-3.md" })).path, third.path);
});

test("supersession rejects wrong source, malformed provenance, reused notes and broken history", async t => {
  const f = await fixture(t);
  const first = await recordLearningReview(f.root, f.options);
  const next = { ...f.options, supersedes: learningReviewDigest(first.record), reason: "Explicit review" };
  await assert.rejects(recordLearningReview(f.root, next), /new review note/);
  await assert.rejects(recordLearningReview(f.root, { ...next, reason: " " }), /reason/);
  await assert.rejects(recordLearningReview(f.root, { ...next, supersedes: "short" }), /digest/);
  await assert.rejects(recordLearningReview(f.root, { ...f.options, reason: "without predecessor" }), /requires/);
  await f.put("docs/review-2.md", "New considered review\n");
  await f.put("docs/result.md", "Changed outcome\n");
  await assert.rejects(recordLearningReview(f.root, { ...next, evidence: "docs/review-2.md" }), /Stale/);
  await f.put("docs/result.md", "Observed result\n");
  const second = await recordLearningReview(f.root, { ...next, evidence: "docs/review-2.md" });
  const fork = { ...second.record, reason: "Competing fork" };
  await f.put(`${path.dirname(second.path)}/${fork.outcome_digest}.${learningReviewDigest(fork)}.json`, fork);
  assert.match((await f.query()).items[0].reason, /forked/);
  await fs.unlink(path.join(f.root, `${path.dirname(second.path)}/${fork.outcome_digest}.${learningReviewDigest(fork)}.json`));
  await fs.unlink(path.join(f.root, first.path));
  assert.match((await f.query()).items[0].reason, /Broken/);
  await assert.rejects(recordLearningReview(f.root, f.options), /Broken/);
});

test("concurrent explicit CLI supersession records one successor", async t => {
  const f = await fixture(t);
  const first = await recordLearningReview(f.root, f.options);
  await f.put("docs/review-2.md", "Actual fresh review note\n");
  const args = ["learning", "record-review", f.root, "--work-item", f.item.id, "--revision", revision, "--result", "no-new-lesson", "--actor", "agent-reviewer", "--evidence", "docs/review-2.md", "--supersedes", learningReviewDigest(first.record), "--reason", "Explicitly reconsidered", "--json"];
  const responses = await Promise.all([runAsync(args), runAsync(args)]);
  for (const r of responses) assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(responses.map(r => JSON.parse(r.stdout).idempotent).sort(), [false, true]);
  assert.equal((await f.query()).items[0].record_count, 2);
});

test("actual CLI retains every Lesson ID for initial capture and successor without changing single-ID operations", async t => {
  const f = await fixture(t);
  for (const title of ["First bounded finding", "Second bounded finding"]) {
    const created = run(["learning", "add-lesson", f.root, "--title", title, "--summary", "Retained evidence", "--confidence", "low"]);
    assert.equal(created.status, 0, created.stderr);
  }
  const singular = run(["learning", "revalidate", f.root, "--learning-id", "LESSON-0001", "--result", "confirmed", "--json"]);
  assert.equal(singular.status, 0, singular.stderr);
  assert.equal(JSON.parse(singular.stdout).id, "LESSON-0001");
  const synced = run(["learning", "sync-metadata", f.root, "--learning-id", "LESSON-0001", "--json"]);
  assert.equal(synced.status, 0, synced.stderr);
  for (const [action, flags] of [["sync-metadata", []], ["revalidate", ["--result", "confirmed"]]]) {
    const duplicateScalar = run(["learning", action, f.root, "--learning-id", "LESSON-0001", "--learning-id", "LESSON-0002", ...flags, "--json"]);
    assert.notEqual(duplicateScalar.status, 0);
    assert.match(duplicateScalar.stderr, /exactly one/);
  }
  const args = ["learning", "record-review", f.root, "--work-item", f.item.id, "--revision", revision, "--result", "linked-lessons", "--actor", "agent-reviewer", "--evidence", "docs/review.md", "--json"];
  const ids = ["--learning-id", "LESSON-0002", "--learning-id", "LESSON-0001"];
  const duplicate = run([...args, "--learning-id", "LESSON-0001", "--learning-id", "LESSON-0001"]);
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /unique Lesson IDs/);
  const first = run([...args, ...ids]);
  assert.equal(first.status, 0, first.stderr);
  const original = JSON.parse(first.stdout);
  assert.deepEqual(original.record.lessons.map(l => l.id), ["LESSON-0001", "LESSON-0002"]);
  const retry = run([...args, ...ids]);
  assert.equal(retry.status, 0, retry.stderr);
  assert.equal(JSON.parse(retry.stdout).idempotent, true);
  await f.put("docs/multi-refresh.md", "Reconsidered both bounded findings\n");
  const nextArgs = args.map(a => a === "docs/review.md" ? "docs/multi-refresh.md" : a);
  const next = run([...nextArgs, ...ids, "--supersedes", learningReviewDigest(original.record), "--reason", "Reviewed both linked Lessons again"]);
  assert.equal(next.status, 0, next.stderr);
  assert.deepEqual(JSON.parse(next.stdout).record.lessons.map(l => l.id), ["LESSON-0001", "LESSON-0002"]);
  const queried = run(["learning", "review-status", f.root, "--work-item", f.item.id, "--json"]);
  assert.equal(queried.status, 0, queried.stderr);
  assert.deepEqual(JSON.parse(queried.stdout).items[0].lesson_ids, ["LESSON-0001", "LESSON-0002"]);
  assert.equal((await f.query()).items[0].record_count, 2);
});

test("metadata sync repairs only current headers and makes linked review refresh explicit", async t => {
  const f = await fixture(t);
  const added = run(["learning", "add-lesson", f.root, "--title", "Bounded learning", "--summary", "A retained observation", "--confidence", "low"]);
  assert.equal(added.status, 0, added.stderr);
  const entryPath = ".ai-org/learning/lessons/LESSON-0001.md";
  await revalidateLearningEntry(f.root, { learningId: "LESSON-0001", result: "confirmed", actor: "agent-reviewer" });
  const indexBefore = await fs.readFile(path.join(f.root, ".ai-org/learning/index.json"));
  const entry = JSON.parse(indexBefore).entries[0];
  const correct = await fs.readFile(path.join(f.root, entryPath), "utf8");
  assert.ok(correct.includes("- Status: `validated`"));
  assert.ok(correct.includes(`- Last validated: \`${entry.last_validated_at}\``));
  const old = correct.replace("- Status: `validated`", "- Status: `candidate`").replace(`- Last validated: \`${entry.last_validated_at}\``, "- Last validated: not yet");
  await f.put(entryPath, old);
  const options = { ...f.options, result: "linked-lessons", learningIds: ["LESSON-0001"] };
  const first = await recordLearningReview(f.root, options);
  const preview = run(["learning", "sync-metadata", f.root, "--learning-id", "LESSON-0001", "--dry-run", "--json"]);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).mutation_performed, false);
  assert.equal(await fs.readFile(path.join(f.root, entryPath), "utf8"), old);
  const applied = await syncLearningMetadata(f.root, { learningId: "LESSON-0001" });
  assert.equal(applied.mutation_performed, true);
  assert.equal(await fs.readFile(path.join(f.root, entryPath), "utf8"), correct);
  assert.deepEqual(await fs.readFile(path.join(f.root, ".ai-org/learning/index.json")), indexBefore);
  assert.equal((await syncLearningMetadata(f.root, { learningId: "LESSON-0001" })).changed, false);
  assert.equal((await f.query()).items[0].status, "review-required");
  await f.put("docs/review-2.md", "Reviewed header correction, unchanged bounded conclusion\n");
  await recordLearningReview(f.root, { ...options, evidence: "docs/review-2.md", supersedes: learningReviewDigest(first.record), reason: "Header corrected from existing index" });
  assert.equal((await f.query()).items[0].status, "linked-lessons");
  assert.deepEqual(await fs.readFile(path.join(f.root, ".ai-org/learning/index.json")), indexBefore);
});

test("metadata sync preserves CRLF/history and rejects ambiguous headers and symlinks", async t => {
  const f = await fixture(t);
  const added = run(["learning", "add-lesson", f.root, "--title", "Bounded learning", "--summary", "A retained observation", "--confidence", "low"]);
  assert.equal(added.status, 0, added.stderr);
  const ref = ".ai-org/learning/lessons/LESSON-0001.md";
  const text = (await fs.readFile(path.join(f.root, ref), "utf8")).replaceAll("\n", "\r\n");
  await f.put(ref, text.replace("- Status: `candidate`", "- Status: `deprecated`"));
  await syncLearningMetadata(f.root, { learningId: "LESSON-0001" });
  assert.equal(await fs.readFile(path.join(f.root, ref), "utf8"), text);
  const invalid = text.replace("- Status:", "- Status: `candidate`\r\n- Status:");
  await f.put(ref, invalid);
  await assert.rejects(syncLearningMetadata(f.root, { learningId: "LESSON-0001" }), /exactly one/);
  assert.equal(await fs.readFile(path.join(f.root, ref), "utf8"), invalid);
  await f.put("docs/outside.md", text);
  await fs.unlink(path.join(f.root, ref));
  await fs.symlink(path.join(f.root, "docs/outside.md"), path.join(f.root, ref));
  await assert.rejects(syncLearningMetadata(f.root, { learningId: "LESSON-0001" }), /Symlink/);
});

test("revision, activity, missing evidence and conflicts fail without replacing a review", async t => {
  const f = await fixture(t);
  await assert.rejects(recordLearningReview(f.root, { ...f.options, revision: "b".repeat(40) }), /revision/i);
  await recordLearningReview(f.root, f.options);
  await f.put("docs/review.md", "Different judgment\n");
  assert.equal((await f.query()).items[0].status, "review-required");
  await assert.rejects(recordLearningReview(f.root, f.options), /conflict/i);
  await fs.unlink(path.join(f.root, "docs/result.md"));
  assert.equal((await f.query()).items[0].status, "unknown");
  await f.put(".ai-org/work-items/WI-0001.json", { ...f.item, state: "build" });
  assert.equal((await f.query()).items[0].status, "not-eligible");
  await assert.rejects(recordLearningReview(f.root, f.options), /terminal/i);
});

test("Lesson linkage uses the existing index without promoting or changing its entries", async t => {
  const f = await fixture(t);
  const added = run(["learning", "add-lesson", f.root, "--title", "Bounded observation", "--summary", "One reviewed case", "--confidence", "low"]);
  assert.equal(added.status, 0, added.stderr);
  const indexPath = path.join(f.root, ".ai-org/learning/index.json");
  const before = await fs.readFile(indexPath);
  const options = { ...f.options, result: "linked-lessons", learningIds: ["LESSON-0001"] };
  const result = await recordLearningReview(f.root, options);
  assert.equal(validateLearningReview(result.record).valid, true);
  assert.deepEqual((await f.query()).items[0].lesson_ids, ["LESSON-0001"]);
  assert.equal((await f.query()).items[0].status, "linked-lessons");
  assert.deepEqual(await fs.readFile(indexPath), before);
  const document = JSON.parse(before);
  document.entries[0].status = "deprecated";
  await f.put(".ai-org/learning/index.json", document);
  assert.equal((await f.query()).items[0].status, "review-required");
  await f.put(".ai-org/learning/index.json", { schema_version: "ai-org.learning-index/v2", entries: [] });
  assert.equal((await f.query()).items[0].status, "unknown");
});

test("invalid judgments, unknown actors and unlinked IDs never create review storage", async t => {
  const f = await fixture(t);
  for (const override of [{ result: "pass" }, { result: "linked-lessons" }, { actor: "agent-absent" }, { learningIds: ["LESSON-0001"] }, { evidence: "../outside.md" }, { evidence: "/tmp/outside.md" }, { evidence: "docs/../review.md" }]) {
    await assert.rejects(recordLearningReview(f.root, { ...f.options, ...override }));
  }
  await assert.rejects(fs.stat(path.join(f.root, ".ai-org/learning/reviews")), { code: "ENOENT" });
});

test("administrative timestamps do not stale a review; exact revisions, scope and gates do", async t => {
  const f = await fixture(t);
  await recordLearningReview(f.root, f.options);
  await f.put(".ai-org/work-items/WI-0001.json", { ...f.item, updated_at: new Date().toISOString(), assigned_agent_id: "different" });
  assert.equal((await f.query()).items[0].status, "no-new-lesson");
  for (const extra of [{ tested_revision: "b".repeat(40) }, { scope: ["different"] }, { gate_evidence: { test: ["docs/review.md"] } }, { unresolved: ["remaining issue"] }, { state: "concluded", lifecycle_outcome: "inconclusive" }]) {
    await f.put(".ai-org/work-items/WI-0001.json", { ...f.item, ...extra });
    assert.equal((await f.query()).items[0].status, "review-required");
  }
  await f.put(".ai-org/work-items/WI-0001.json", { ...f.item, tested_revision: null });
  assert.equal((await f.query()).items[0].status, "unknown");
});

test("malformed storage, missing items, and symlinks remain visible as unknown/errors", async t => {
  const f = await fixture(t);
  const saved = await recordLearningReview(f.root, f.options);
  await f.put(saved.path, "{broken");
  assert.equal((await f.query()).items[0].status, "unknown");
  assert.ok((await summarizeLearningReviews(f.root)).errors.length);
  await f.put(saved.path, saved.record);
  await fs.unlink(path.join(f.root, ".ai-org/work-items/WI-0001.json"));
  assert.ok((await summarizeLearningReviews(f.root)).errors.length);
  await f.put(".ai-org/work-items/WI-0001.json", f.item);
  await fs.unlink(path.join(f.root, "docs/result.md"));
  await fs.symlink(path.join(f.root, "docs/review.md"), path.join(f.root, "docs/result.md"));
  assert.equal((await f.query()).items[0].status, "unknown");
  await assert.rejects(recordLearningReview(f.root, f.options), /Symlink/);
});

test("symlinked review parents cannot redirect reads or writes", async t => {
  const f = await fixture(t);
  const elsewhere = await fs.mkdtemp(path.join(os.tmpdir(), "temple-review-outside-"));
  t.after(() => fs.rm(elsewhere, { recursive: true, force: true }));
  await fs.symlink(elsewhere, path.join(f.root, ".ai-org/learning/reviews"));
  await assert.rejects(recordLearningReview(f.root, f.options), /Symlink/);
  assert.equal((await f.query()).items[0].status, "unknown");
  assert.ok((await summarizeLearningReviews(f.root)).errors.length);
  assert.deepEqual(await fs.readdir(elsewhere), []);
});

test("single-item queries ignore unrelated broken data and all-item queries preserve unknown", async t => {
  const f = await fixture(t);
  await f.put(".ai-org/work-items/WI-0002.json", "{broken");
  assert.equal((await f.query()).items.length, 1);
  const result = await queryLearningReviews(f.root);
  assert.equal(result.counts["not-reviewed"], 1);
  assert.equal(result.counts.unknown, 1);
  assert.equal(result.mutation_performed, false);
  assert.equal(result.model_calls_performed, 0);
  await assert.rejects(fs.stat(path.join(f.root, ".ai-org/learning/reviews")), { code: "ENOENT" });
});

test("CLI serializes concurrent retries and exposes compact statuses", async t => {
  const f = await fixture(t);
  const args = [cli, "learning", "record-review", f.root, "--work-item", f.item.id, "--revision", revision, "--result", "no-new-lesson", "--actor", "agent-reviewer", "--evidence", "docs/review.md", "--json"];
  const invoke = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args); let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject); child.on("close", code => resolve({ code, stdout, stderr }));
  });
  const outputs = await Promise.all([invoke(), invoke()]);
  for (const out of outputs) assert.equal(out.code, 0, out.stderr);
  assert.deepEqual(outputs.map(o => JSON.parse(o.stdout).idempotent).sort(), [false, true]);
  assert.equal((await f.query()).items[0].record_count, 1);
  const status = run(["learning", "review-status", f.root, "--work-item", f.item.id]);
  assert.equal(status.status, 0, status.stderr); assert.match(status.stdout, /WI-0001\s+no-new-lesson/);
  const entries = await fs.readdir(path.join(f.root, ".ai-org/learning/reviews/WI-0001"));
  assert.equal(entries.length, 1);
});

test("normalized Evidence IDs track just their record and never fetch external references", async t => {
  const f = await fixture(t);
  const id = "EVID-20260909T000000Z-ABCDEF12";
  const entry = {
    id, work_item_id: f.item.id, kind: "test", title: "Observed test", outcome: "passed",
    scope_revision: revision, recorded_at: "2026-09-09T00:00:00Z", observed_at: "2026-09-09T00:00:00Z",
    recorded_by: "agent-reviewer", summary: "first", adapter: { id: "fixture", version: "1" },
    external_action_performed: false, artifacts: [{ path: "docs/result.md", sha256: sha256("Observed result\n") }], details: {},
    expires_at: null, invalidated_at: null, invalidated_by: null, invalidation_reason: null
  };
  const registry = { schema_version: "temple.evidence/v1", entries: [entry] };
  await f.put(".ai-org/project/evidence.json", registry);
  await f.put(".ai-org/work-items/WI-0001.json", { ...f.item, evidence: [id, "https://example.invalid/never-fetch", revision] });
  await recordLearningReview(f.root, f.options);
  await f.put(".ai-org/project/evidence.json", { ...registry, entries: [entry, { id: "unrelated" }] });
  assert.equal((await f.query()).items[0].status, "no-new-lesson");
  await f.put("docs/result.md", "Changed attachment without updated registry\n");
  assert.equal((await f.query()).items[0].status, "unknown");
  await assert.rejects(recordLearningReview(f.root, f.options), /digest mismatch/);
  await f.put("docs/result.md", "Observed result\n");
  await f.put(".ai-org/project/evidence.json", { ...registry, entries: [{ ...entry, summary: "changed" }] });
  assert.equal((await f.query()).items[0].status, "review-required");
  await f.put(".ai-org/project/evidence.json", { ...registry, entries: [{ id }] });
  assert.equal((await f.query()).items[0].status, "unknown");
});

test("fresh installation, Doctor and status expose review storage without changing the Learning index", async t => {
  const f = await fixture(t);
  const target = path.join(f.root, "installed");
  const config = path.join(f.root, "init.json");
  await f.put("init.json", {
    schema_version: "temple.init/v1", project: { id: "review-fixture", name: "Review fixture" }, naming_mode: "manual",
    agents: [
      { display_name: "Coordinator", positions: ["engineering_manager", "release_manager", "observer"] },
      { display_name: "Planner", positions: ["product_manager", "ux_designer", "ui_designer"] },
      { display_name: "Architect", positions: ["tech_lead"] },
      { display_name: "Builder", positions: ["developer"] },
      { display_name: "Reviewer", positions: ["quality_evaluator", "independent_qa"] }
    ]
  });
  const initialized = run(["init", target, "--config", config]);
  assert.equal(initialized.status, 0, initialized.stderr);
  const doctor = () => run(["doctor", target, "--json"]);
  assert.equal(doctor().status, 0);
  await f.put("installed/.ai-org/work-items/WI-0001.json", f.item);
  await f.put("installed/docs/result.md", "Outcome\n");
  await f.put("installed/docs/review.md", "Reviewed\n");
  const saved = await recordLearningReview(target, { ...f.options, actor: "agent-reviewer" });
  const status = run(["status", target, "--json"]);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).learning.reviews.counts["no-new-lesson"], 1);
  const healthy = JSON.parse(doctor().stdout);
  assert.equal(healthy.checks.find(c => c.id === "engineering_learning").status, "pass");
  await f.put(`installed/${saved.path}`, "broken");
  const broken = JSON.parse(doctor().stdout);
  assert.equal(broken.checks.find(c => c.id === "engineering_learning").status, "fail");
});

test("malformed consumed source fields fail before capture and every query shortcut", async t => {
  const overrides = [
    { schema_version: "temple.work-item/INVALID" }, { state: "made-up" }, { state: ["done"] },
    { lifecycle_outcome: "made-up" }, { lifecycle_outcome: null },
    { unresolved: null }, { evidence: null }, { gate_evidence: null }, { gate_evidence: { test: null } },
    { scope: 42 }, { acceptance_criteria: null }, { tested_revision: [revision] },
    { developer_candidate_revision: [revision] }, { tested_revision: "" }
  ];
  for (const [index, extra] of overrides.entries()) {
    const f = await fixture(t);
    await f.put(".ai-org/work-items/WI-0001.json", { ...f.item, ...extra });
    assert.equal((await f.query()).items[0].status, "unknown", `before review: ${index}`);
    await assert.rejects(recordLearningReview(f.root, f.options), /Invalid/, `capture: ${index}`);
    await assert.rejects(fs.stat(path.join(f.root, ".ai-org/learning/reviews")), { code: "ENOENT" });
    await f.put(".ai-org/work-items/WI-0001.json", f.item);
    const saved = await recordLearningReview(f.root, f.options);
    const bytes = await fs.readFile(path.join(f.root, saved.path));
    await f.put(".ai-org/work-items/WI-0001.json", { ...f.item, ...extra });
    assert.equal((await f.query()).items[0].status, "unknown", `after review: ${index}`);
    await assert.rejects(recordLearningReview(f.root, f.options), /Invalid/);
    assert.deepEqual(await fs.readFile(path.join(f.root, saved.path)), bytes);
  }
});

test("absent optional legacy fields remain supported without treating null arrays as absence", async t => {
  const f = await fixture(t);
  const legacy = { ...f.item };
  delete legacy.unresolved; delete legacy.gate_evidence;
  await f.put(".ai-org/work-items/WI-0001.json", legacy);
  await recordLearningReview(f.root, f.options);
  assert.equal((await f.query()).items[0].status, "no-new-lesson");
  await f.put(".ai-org/core/workflow.json", { schema_version: "broken", states: [], terminal_states: [] });
  assert.equal((await f.query()).items[0].status, "unknown");
  await assert.rejects(recordLearningReview(f.root, f.options), /workflow/);
});
