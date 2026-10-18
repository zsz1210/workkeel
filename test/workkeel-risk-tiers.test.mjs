import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import { initializeTaskProject } from "../src/workkeel-project.mjs";
import { createNativeTask, mutateNativeTask, readNativeTask, listTaskItems, diagnoseTaskProject } from "../src/workkeel-tasks.mjs";
import { assessNativeTask } from "../src/workkeel-review-assessment.mjs";

const builder = { agent_id: "builder", principal_id: "owner" };
const reviewer = { agent_id: "reviewer", principal_id: "review-owner" };
const sameOwnerReviewer = { agent_id: "owner-codex", principal_id: "owner" };
const sameFamilyReviewer = { agent_id: "claude-reviewer", principal_id: "review-owner" };
const lead = { agent_id: "lead-agent", principal_id: "lead" };
const riskPaths = { low: ["src/**"], high: ["src/auth/**"], critical: ["deploy/**"] };
const teamPolicy = () => ({ schema_version: "workkeel.task-policy/v1", principals: ["owner", "review-owner", "lead"],
  agents: [{ ...builder, model_family: "claude" }, { ...reviewer, model_family: "codex" }, { ...sameOwnerReviewer, model_family: "codex" },
    { ...sameFamilyReviewer, model_family: "claude" }, { ...lead, model_family: "human" }],
  approvers: ["owner", "lead"], review_separation: "distinct-agent", risk_paths: riskPaths });
const soloPolicy = () => ({ schema_version: "workkeel.task-policy/v1", principals: ["owner"],
  agents: [{ ...builder, model_family: "claude" }, { ...sameOwnerReviewer, model_family: "codex" }],
  approvers: ["owner"], review_separation: "distinct-agent", risk_paths: riskPaths });

let operation = 0;
const request = (version, actor, extra = {}) => ({ expected_version: version, operation_id: `op-${++operation}`, actor, ...extra });
function contract(id, { tier, write = ["src"], approvedBy = "owner", classification = "internal" }) {
  return { schema_version: "workkeel.task-contract/v1", id, goal: `Risk fixture ${id}`, state: "intake",
    scope: { include: ["fixture change"], exclude: [] }, actor: builder, dependencies: [],
    acceptance: { criteria: ["The change is reviewed"], evidence: [] }, handoff: null,
    verification: { risk_tier: tier, separation: "distinct-agent", implementer: null, reviewer: null, candidate_revision: null },
    environment: { cwd: ".", read_paths: ["."], write_paths: write, tools: ["node"], resources: [],
      network: { mode: "none", hosts: [] }, external_actions: [], data: { classification, model_access: "none", policy_refs: ["docs/approval.md"] } },
    authorization: { approved_by: approvedBy, approval_ref: "docs/approval.md", operations: ["read", "write", "execute"], expires_at: null }, skills: [],
    execution: { runtime: { kind: "host-owned", adapter_id: null, required_features: [] }, model_connection: { kind: "native" } }, legacy: null };
}
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
async function write(root, ref, data) { await fs.mkdir(path.dirname(path.join(root, ref)), { recursive: true }); await fs.writeFile(path.join(root, ref), data); }
async function fixture(t, policy = teamPolicy(), setup = () => {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-risk-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  git(root, "init", "-q"); git(root, "config", "user.name", "Fixture"); git(root, "config", "user.email", "fixture@example.invalid");
  for (const [ref, text] of [["docs/approval.md", "Approved synthetic fixture work.\n"], ["docs/guide.md", "Guide\n"],
    ["src/cart.mjs", "export const total = 1;\n"], ["src/auth/token.mjs", "export const ttl = 1;\n"], ["deploy/run.sh", "echo v1\n"]]) await write(root, ref, text);
  await initializeTaskProject(root, policy);
  await setup(root);
  git(root, "add", "."); git(root, "commit", "-qm", "base");
  return root;
}
/** Create, claim, change one file and hand off; returns the delivered revision. */
async function deliver(root, id, options, file, extra = {}) {
  await createNativeTask(root, contract(id, options), request(0, builder));
  const claimed = await mutateNativeTask(root, id, "claim", request(1, builder, { base_revision: git(root, "rev-parse", "HEAD") }));
  await write(root, file, `changed ${id}\n`); git(root, "add", file); git(root, "commit", "-qm", `change ${id}`);
  const revision = git(root, "rev-parse", "HEAD"), ref = `.ai-org/artifacts/${id}/developer.md`;
  await write(root, ref, `Verified ${revision}.\n`);
  const handoff = request(2, builder, { claim_id: claimed.claim.id, revision, summary: "Change verified", evidence: [ref], unresolved: [], ...extra });
  return { revision, ref, handoff, result: mutateNativeTask(root, id, "handoff", handoff) };
}
const report = (id, revision, actor, judgment = "pass", extra = {}) => JSON.stringify({ schema_version: "workkeel.review-report/v1",
  task_id: id, stage: "review", revision, reviewer: actor, judgment, summary: "Independent review", ...extra });
async function review(root, id, revision, actor, { judgment = "pass", version = 3, content = report(id, revision, actor, judgment) } = {}) {
  const ref = `.ai-org/artifacts/${id}/review-${actor.agent_id}-${version}.json`;
  await write(root, ref, content);
  // A refused review leaves no stray report behind to dirty the next attempt.
  try { return await mutateNativeTask(root, id, "review", request(version, actor, { revision, judgment, summary: "Reviewed", evidence: [ref] })); }
  catch (error) { await fs.unlink(path.join(root, ref)); throw error; }
}
const close = (root, id, revision, actor, evidence) =>
  mutateNativeTask(root, id, "close", request(4, actor, { revision, summary: "Accepted", rollback: "Revert the candidate commit", evidence }));

test("low and standard tasks keep the existing distinct-agent lifecycle", async t => {
  const root = await fixture(t);
  const low = await deliver(root, "WK-low", { tier: "low", write: ["docs"] }, "docs/guide.md");
  await low.result;
  assert.equal((await review(root, "WK-low", low.revision, sameOwnerReviewer)).state, "release_gate");
  assert.equal((await close(root, "WK-low", low.revision, builder, [low.ref])).state, "done");
  git(root, "add", ".ai-org"); git(root, "commit", "-qm", "record WK-low");
  const standard = await deliver(root, "WK-standard", { tier: "standard", write: ["src/cart.mjs"] }, "src/cart.mjs");
  await standard.result;
  await assert.rejects(review(root, "WK-standard", standard.revision, builder), /separation/);
  assert.equal((await review(root, "WK-standard", standard.revision, sameFamilyReviewer)).state, "release_gate");
  assert.equal((await close(root, "WK-standard", standard.revision, builder, [standard.ref])).state, "done");
  assert.equal((await diagnoseTaskProject(root)).valid, true);
});

test("high team work needs an independent approver, another model family and a distinct reviewer Principal", async t => {
  const root = await fixture(t);
  await assert.rejects(createNativeTask(root, contract("WK-self", { tier: "high", write: ["src/auth"] }), request(0, builder)), /other than the implementer and the initiator/);
  await assert.rejects(createNativeTask(root, contract("WK-under", { tier: "standard", write: ["src/auth"], approvedBy: "lead" }), request(0, builder)), /below the high tier/);
  const high = await deliver(root, "WK-high", { tier: "high", write: ["src/auth"], approvedBy: "lead" }, "src/auth/token.mjs");
  await high.result;
  await assert.rejects(review(root, "WK-high", high.revision, sameOwnerReviewer), /Principal other than the implementer/);
  await assert.rejects(review(root, "WK-high", high.revision, sameFamilyReviewer), /different model family/);
  await assert.rejects(mutateNativeTask(root, "WK-high", "review", request(3, reviewer, { revision: high.revision, judgment: "pass", summary: "Reused", evidence: [high.ref] })), /review-report/);
  await review(root, "WK-high", high.revision, reviewer);
  const reviewRef = ".ai-org/artifacts/WK-high/review-reviewer-3.json";
  await assert.rejects(close(root, "WK-high", high.revision, builder, [reviewRef]), /approving Principal/);
  assert.equal((await close(root, "WK-high", high.revision, lead, [reviewRef])).state, "done");
  assert.equal((await listTaskItems(root)).find(i => i.id === "WK-high").risk_tier, "high");
});

test("solo high work is reviewed by another model family and closed by the owner", async t => {
  const root = await fixture(t, soloPolicy());
  const high = await deliver(root, "WK-solo", { tier: "high", write: ["src/auth"] }, "src/auth/token.mjs");
  await high.result;
  await review(root, "WK-solo", high.revision, sameOwnerReviewer);
  assert.equal((await close(root, "WK-solo", high.revision, builder, [".ai-org/artifacts/WK-solo/review-owner-codex-3.json"])).state, "done");
});

test("critical work requires a delivered rollback plan and a committed approval record", async t => {
  const root = await fixture(t);
  const missing = await deliver(root, "WK-critical", { tier: "critical", write: ["deploy"], approvedBy: "lead" }, "deploy/run.sh");
  await assert.rejects(missing.result, /critical handoff\.rollback/i);
  assert.equal((await readNativeTask(root, "WK-critical")).state, "build");
  const handoff = { ...missing.handoff, operation_id: "critical-handoff", rollback: "1. Revert the deploy commit.\n2. Re-run the previous deploy script." };
  assert.equal((await mutateNativeTask(root, "WK-critical", "handoff", handoff)).state, "test");
  await review(root, "WK-critical", missing.revision, reviewer);
  const evidence = [".ai-org/artifacts/WK-critical/review-reviewer-3.json"];
  await assert.rejects(close(root, "WK-critical", missing.revision, builder, evidence), /approving Principal/);
  assert.equal((await close(root, "WK-critical", missing.revision, lead, evidence)).state, "done");
});

test("sensitive data cannot be downgraded below high", async t => {
  const root = await fixture(t);
  for (const tier of ["low", "standard"]) await assert.rejects(
    createNativeTask(root, contract(`WK-sensitive-${tier}`, { tier, write: ["docs"], classification: "sensitive" }), request(0, builder)), /below the high tier/);
  await createNativeTask(root, contract("WK-sensitive", { tier: "high", write: ["docs"], classification: "sensitive", approvedBy: "lead" }), request(0, builder));
});

test("a low task whose candidate touches a high path is escalated at handoff", async t => {
  const root = await fixture(t);
  await assert.rejects(createNativeTask(root, contract("WK-cart", { tier: "low", write: ["deploy"] }), request(0, builder)), /below the critical tier/);
  const low = await deliver(root, "WK-escalate", { tier: "low", write: ["src"] }, "src/auth/token.mjs");
  await low.result;
  const item = await readNativeTask(root, "WK-escalate");
  assert.equal(item.contract.verification.risk_tier, "low");
  const { basis, ...risk } = item.delivery.risk;
  assert.deepEqual(risk, { tier: "high", escalated_from: "low", paths: ["src/auth/token.mjs"], compared_from: item.base_revision });
  assert.match(basis, /since the first unaccepted claim base.*other work merged/);
  assert.deepEqual(Object.fromEntries(Object.entries((await listTaskItems(root)).find(i => i.id === "WK-escalate")).filter(([k]) => k.startsWith("risk"))),
    { risk_tier: "high", risk_escalated: true });
  const assessment = await assessNativeTask(root, "WK-escalate");
  assert.equal(assessment.repository_observed.risk_tier, "high");
  assert.equal(assessment.repository_observed.declared_risk_tier, "low");
  assert.equal(assessment.current_review_floor.separation, "distinct-principal");
  assert.equal(assessment.current_review_floor.distinct_model_family_required, true);
  assert(assessment.reasons.some(r => r.code === "elevated-review-required"));
  await assert.rejects(review(root, "WK-escalate", low.revision, sameOwnerReviewer), /Principal other than the implementer/);
  await review(root, "WK-escalate", low.revision, reviewer);
  // The creator approved it as low work; high acceptance needs a fresh independent approval.
  await assert.rejects(close(root, "WK-escalate", low.revision, builder, [low.ref]), /other than the implementer and the initiator/);
});

test("risk path patterns are repository-relative, include dotfiles and cannot negate", async t => {
  for (const pattern of ["../x/**", "/abs/**", "!src/**", "src//x", "src\\x"]) {
    const policy = teamPolicy(); policy.risk_paths = { high: [pattern] };
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-risk-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    git(root, "init", "-q");
    await assert.rejects(initializeTaskProject(root, policy), /risk path pattern/);
  }
  const root = await fixture(t);
  const dot = await deliver(root, "WK-dot", { tier: "low", write: ["src"] }, "src/auth/.env");
  await dot.result;
  assert.equal((await readNativeTask(root, "WK-dot")).delivery.risk.tier, "high");
});

test("without risk_paths, code is at least standard and documentation may be low", async t => {
  const policy = teamPolicy(); delete policy.risk_paths;
  const root = await fixture(t, policy);
  await assert.rejects(createNativeTask(root, contract("WK-code-low", { tier: "low", write: ["src"] }), request(0, builder)), /below the standard tier/);
  await assert.rejects(createNativeTask(root, contract("WK-root-low", { tier: "low", write: ["."] }), request(0, builder)), /below the standard tier/);
  await createNativeTask(root, contract("WK-code", { tier: "standard", write: ["src"] }), request(0, builder));
  await createNativeTask(root, contract("WK-docs", { tier: "low", write: ["docs", "README.md"] }), request(0, builder));
});

test("rework and release keep the highest risk of every unaccepted change", async t => {
  const root = await fixture(t);
  const first = await deliver(root, "WK-rework", { tier: "low", write: ["src"] }, "src/auth/token.mjs");
  await first.result;
  await review(root, "WK-rework", first.revision, reviewer, { judgment: "fail" });
  await mutateNativeTask(root, "WK-rework", "rework", request(4, builder, { summary: "Retry" }));
  git(root, "add", ".ai-org"); git(root, "commit", "-qm", "record rejected attempt");
  const claimed = await mutateNativeTask(root, "WK-rework", "claim", request(5, builder, { base_revision: git(root, "rev-parse", "HEAD") }));
  await write(root, "src/cart.mjs", "export const total = 3;\n"); git(root, "add", "src"); git(root, "commit", "-qm", "low retry");
  const revision = git(root, "rev-parse", "HEAD"), ref = ".ai-org/artifacts/WK-rework/retry.md"; await write(root, ref, "Retry verified\n");
  await mutateNativeTask(root, "WK-rework", "handoff", request(6, builder, { claim_id: claimed.claim.id, revision, summary: "Retry", evidence: [ref], unresolved: [] }));
  assert.equal((await readNativeTask(root, "WK-rework")).delivery.risk.tier, "high");
  await assert.rejects(review(root, "WK-rework", revision, sameOwnerReviewer, { version: 7 }), /Principal other than the implementer/);

  const second = await fixture(t);
  await createNativeTask(second, contract("WK-release", { tier: "low", write: ["src"] }), request(0, builder));
  const held = await mutateNativeTask(second, "WK-release", "claim", request(1, builder, { base_revision: git(second, "rev-parse", "HEAD") }));
  await write(second, "src/auth/token.mjs", "export const ttl = 9;\n"); git(second, "add", "src"); git(second, "commit", "-qm", "high change");
  await mutateNativeTask(second, "WK-release", "release", request(2, builder, { claim_id: held.claim.id, summary: "Pause" }));
  const again = await mutateNativeTask(second, "WK-release", "claim", request(3, builder, { base_revision: git(second, "rev-parse", "HEAD") }));
  await write(second, "src/cart.mjs", "export const total = 4;\n"); git(second, "add", "src"); git(second, "commit", "-qm", "low change");
  const head = git(second, "rev-parse", "HEAD"), note = ".ai-org/artifacts/WK-release/dev.md"; await write(second, note, "Verified\n");
  await mutateNativeTask(second, "WK-release", "handoff", request(4, builder, { claim_id: again.claim.id, revision: head, summary: "Done", evidence: [note], unresolved: [] }));
  assert.deepEqual((await readNativeTask(second, "WK-release")).delivery.risk.paths, ["src/auth/token.mjs"]);
});

test("explicit risk_paths also cover committed administrative files", async t => {
  const policy = teamPolicy(); policy.risk_paths = { ...riskPaths, critical: [...riskPaths.critical, ".ai-org/artifacts/**"] };
  const root = await fixture(t, policy);
  await createNativeTask(root, contract("WK-admin", { tier: "low", write: [] }), request(0, builder));
  const claimed = await mutateNativeTask(root, "WK-admin", "claim", request(1, builder, { base_revision: git(root, "rev-parse", "HEAD") }));
  const ref = ".ai-org/artifacts/WK-admin/evidence.md"; await write(root, ref, "Committed evidence\n");
  git(root, "add", ref); git(root, "commit", "-qm", "evidence");
  const handoff = request(2, builder, { claim_id: claimed.claim.id, revision: git(root, "rev-parse", "HEAD"), summary: "Evidence", evidence: [ref], unresolved: [] });
  await assert.rejects(mutateNativeTask(root, "WK-admin", "handoff", handoff), /critical handoff\.rollback/i);
  await mutateNativeTask(root, "WK-admin", "handoff", { ...handoff, operation_id: "admin-rollback", rollback: "Revert the evidence commit" });
  assert.equal((await readNativeTask(root, "WK-admin")).delivery.risk.tier, "critical");
});

test("a high review report must be the reviewer's own record of this candidate", async t => {
  const root = await fixture(t);
  const high = await deliver(root, "WK-report", { tier: "high", write: ["src/auth"], approvedBy: "lead" }, "src/auth/token.mjs");
  await high.result;
  const copied = await fs.readFile(path.join(root, high.ref), "utf8");
  await assert.rejects(review(root, "WK-report", high.revision, reviewer, { content: copied }), /review-report/);
  for (const extra of [{ revision: "a".repeat(40) }, { reviewer: builder }, { stage: "delivery" }, { task_id: "WK-other" }, { judgment: "fail" }])
    await assert.rejects(review(root, "WK-report", high.revision, reviewer, { content: report("WK-report", high.revision, reviewer, "pass", extra) }), /review-report/);
  assert.equal((await review(root, "WK-report", high.revision, reviewer)).state, "release_gate");
});

test("critical close reads the approval blob committed in the candidate", async t => {
  const ignored = await fixture(t, teamPolicy(), root => write(root, ".gitignore", "approvals/\n"));
  await write(ignored, "approvals/deploy.md", "Approved deploy\n");
  const options = { tier: "critical", write: ["deploy"], approvedBy: "lead" };
  const uncommitted = contract("WK-uncommitted", options); uncommitted.authorization.approval_ref = "approvals/deploy.md";
  uncommitted.environment.data.policy_refs = ["approvals/deploy.md"];
  await createNativeTask(ignored, uncommitted, request(0, builder));
  const claimed = await mutateNativeTask(ignored, "WK-uncommitted", "claim", request(1, builder, { base_revision: git(ignored, "rev-parse", "HEAD") }));
  await write(ignored, "deploy/run.sh", "echo v2\n"); git(ignored, "add", "deploy"); git(ignored, "commit", "-qm", "deploy");
  const revision = git(ignored, "rev-parse", "HEAD"), ref = ".ai-org/artifacts/WK-uncommitted/dev.md"; await write(ignored, ref, "Verified\n");
  await mutateNativeTask(ignored, "WK-uncommitted", "handoff", request(2, builder, { claim_id: claimed.claim.id, revision, summary: "Deploy", evidence: [ref], unresolved: [], rollback: "Revert" }));
  await review(ignored, "WK-uncommitted", revision, reviewer);
  await assert.rejects(close(ignored, "WK-uncommitted", revision, lead, [".ai-org/artifacts/WK-uncommitted/review-reviewer-3.json"]), /approval record committed/);

  const hidden = await fixture(t);
  git(hidden, "update-index", "--skip-worktree", "docs/approval.md");
  await write(hidden, "docs/approval.md", "A different approval that was never committed\n");
  const critical = await deliver(hidden, "WK-hidden", options, "deploy/run.sh", { rollback: "Revert" });
  await critical.result;
  await review(hidden, "WK-hidden", critical.revision, reviewer);
  await assert.rejects(close(hidden, "WK-hidden", critical.revision, lead, [".ai-org/artifacts/WK-hidden/review-reviewer-3.json"]), /approval record committed/);
});

test("the validated review report is the exact evidence that gets pinned", async t => {
  const root = await fixture(t);
  const high = await deliver(root, "WK-swap", { tier: "high", write: ["src/auth"], approvedBy: "lead" }, "src/auth/token.mjs");
  await high.result;
  const ref = ".ai-org/artifacts/WK-swap/review-reviewer-3.json", absolute = path.join(await fs.realpath(root), ref);
  const valid = report("WK-swap", high.revision, reviewer), delivered = await fs.readFile(path.join(root, high.ref));
  await write(root, ref, valid);
  // Swap the report for delivered evidence as soon as it has been opened once.
  let opens = 0; const open = fs.open;
  t.mock.method(fs, "open", async (file, ...rest) => {
    if (file === absolute && ++opens === 2) await fs.writeFile(absolute, delivered);
    return open.call(fs, file, ...rest);
  });
  try { await mutateNativeTask(root, "WK-swap", "review", request(3, reviewer, { revision: high.revision, judgment: "pass", summary: "Reviewed", evidence: [ref] })); }
  catch { /* refusing the swapped file is also safe */ }
  t.mock.restoreAll();
  const pinned = (await readNativeTask(root, "WK-swap")).review?.evidence ?? [];
  assert.equal(pinned.length, 1);
  assert.equal(pinned[0].sha256, createHash("sha256").update(valid).digest("hex"));
});

test("a re-delivery after a critical escalation still needs a rollback", async t => {
  const policy = teamPolicy(); policy.risk_paths = { ...riskPaths, critical: [...riskPaths.critical, "src/infra/**"] };
  const root = await fixture(t, policy);
  const first = await deliver(root, "WK-withdrawn", { tier: "low", write: ["src"] }, "src/infra/net.mjs", { rollback: "Revert the infra commit" });
  await first.result;
  await review(root, "WK-withdrawn", first.revision, reviewer, { judgment: "fail" });
  await mutateNativeTask(root, "WK-withdrawn", "rework", request(4, builder, { summary: "Drop the infra change" }));
  git(root, "add", ".ai-org"); git(root, "commit", "-qm", "record rejected attempt");
  const claimed = await mutateNativeTask(root, "WK-withdrawn", "claim", request(5, builder, { base_revision: git(root, "rev-parse", "HEAD") }));
  git(root, "rm", "-q", "src/infra/net.mjs"); git(root, "commit", "-qm", "withdraw infra");
  const revision = git(root, "rev-parse", "HEAD"), ref = ".ai-org/artifacts/WK-withdrawn/retry.md"; await write(root, ref, "Retry\n");
  const handoff = request(6, builder, { claim_id: claimed.claim.id, revision, summary: "Retry", evidence: [ref], unresolved: [] });
  await assert.rejects(mutateNativeTask(root, "WK-withdrawn", "handoff", handoff), /critical handoff\.rollback/i);
  await mutateNativeTask(root, "WK-withdrawn", "handoff", { ...handoff, operation_id: "withdrawn-rollback", rollback: "Nothing left to revert" });
  const risk = (await readNativeTask(root, "WK-withdrawn")).delivery.risk;
  assert.equal(risk.tier, "critical"); assert.equal(risk.retained_from_attempts, "critical");
});

test("critical approval blobs compare exact bytes, not a lenient decoding", async t => {
  const replacement = Buffer.from("Approved � deploy\n"), invalid = Buffer.concat([Buffer.from("Approved "), Buffer.from([0xff]), Buffer.from(" deploy\n")]);
  const root = await fixture(t, teamPolicy(), dir => fs.writeFile(path.join(dir, "docs/approval.md"), invalid));
  git(root, "update-index", "--skip-worktree", "docs/approval.md");
  await fs.writeFile(path.join(root, "docs/approval.md"), replacement);
  const critical = await deliver(root, "WK-bytes", { tier: "critical", write: ["deploy"], approvedBy: "lead" }, "deploy/run.sh", { rollback: "Revert" });
  await critical.result;
  await review(root, "WK-bytes", critical.revision, reviewer);
  await assert.rejects(close(root, "WK-bytes", critical.revision, lead, [".ai-org/artifacts/WK-bytes/review-reviewer-3.json"]), /approval record committed/);
});
