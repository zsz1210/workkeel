import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { initializeTaskProject } from "../src/workkeel-project.mjs";
import { createNativeTask, mutateNativeTask, readNativeTask, listTaskItems, diagnoseTaskProject } from "../src/workkeel-tasks.mjs";

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
async function fixture(t, policy = teamPolicy()) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-risk-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  git(root, "init", "-q"); git(root, "config", "user.name", "Fixture"); git(root, "config", "user.email", "fixture@example.invalid");
  for (const [ref, text] of [["docs/approval.md", "Approved synthetic fixture work.\n"], ["docs/guide.md", "Guide\n"],
    ["src/cart.mjs", "export const total = 1;\n"], ["src/auth/token.mjs", "export const ttl = 1;\n"], ["deploy/run.sh", "echo v1\n"]]) await write(root, ref, text);
  await initializeTaskProject(root, policy);
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
async function review(root, id, revision, actor, judgment = "pass") {
  const ref = `.ai-org/artifacts/${id}/review-${actor.agent_id}.md`;
  await write(root, ref, `Independent review of ${revision}.\n`);
  // A refused review leaves no stray report behind to dirty the next attempt.
  try { return await mutateNativeTask(root, id, "review", request(3, actor, { revision, judgment, summary: "Reviewed", evidence: [ref] })); }
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
  await assert.rejects(mutateNativeTask(root, "WK-high", "review", request(3, reviewer, { revision: high.revision, judgment: "pass", summary: "Reused", evidence: [high.ref] })), /own review report/);
  await review(root, "WK-high", high.revision, reviewer);
  const reviewRef = ".ai-org/artifacts/WK-high/review-reviewer.md";
  await assert.rejects(close(root, "WK-high", high.revision, builder, [reviewRef]), /approving Principal/);
  assert.equal((await close(root, "WK-high", high.revision, lead, [reviewRef])).state, "done");
  assert.equal((await listTaskItems(root)).find(i => i.id === "WK-high").risk_tier, "high");
});

test("solo high work is reviewed by another model family and closed by the owner", async t => {
  const root = await fixture(t, soloPolicy());
  const high = await deliver(root, "WK-solo", { tier: "high", write: ["src/auth"] }, "src/auth/token.mjs");
  await high.result;
  await review(root, "WK-solo", high.revision, sameOwnerReviewer);
  assert.equal((await close(root, "WK-solo", high.revision, builder, [".ai-org/artifacts/WK-solo/review-owner-codex.md"])).state, "done");
});

test("critical work requires a delivered rollback plan and a committed approval record", async t => {
  const root = await fixture(t);
  const missing = await deliver(root, "WK-critical", { tier: "critical", write: ["deploy"], approvedBy: "lead" }, "deploy/run.sh");
  await assert.rejects(missing.result, /bounded nonempty/);
  assert.equal((await readNativeTask(root, "WK-critical")).state, "build");
  const handoff = { ...missing.handoff, operation_id: "critical-handoff", rollback: "1. Revert the deploy commit.\n2. Re-run the previous deploy script." };
  assert.equal((await mutateNativeTask(root, "WK-critical", "handoff", handoff)).state, "test");
  await review(root, "WK-critical", missing.revision, reviewer);
  const evidence = [".ai-org/artifacts/WK-critical/review-reviewer.md"];
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
  assert.deepEqual(item.delivery.risk, { tier: "high", escalated_from: "low", paths: ["src/auth/token.mjs"] });
  assert.deepEqual(Object.fromEntries(Object.entries((await listTaskItems(root)).find(i => i.id === "WK-escalate")).filter(([k]) => k.startsWith("risk"))),
    { risk_tier: "high", risk_escalated: true });
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
