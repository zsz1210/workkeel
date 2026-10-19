import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createHash } from "node:crypto";
import { initializeTaskProject } from "../src/workkeel-project.mjs";
import { createNativeTask, mutateNativeTask, readNativeTask, diagnoseTaskProject, listTaskItems, evidenceStatus } from "../src/workkeel-tasks.mjs";

const cli = fileURLToPath(new URL("../bin/workkeel.mjs", import.meta.url));
const developer = { agent_id: "builder", principal_id: "owner" };
const reviewer = { agent_id: "reviewer", principal_id: "review-owner" };
const policy = () => ({ schema_version: "workkeel.task-policy/v1", principals: ["owner", "review-owner"], agents: [developer, reviewer], approvers: ["owner"], review_separation: "distinct-agent" });
const request = (version, actor = developer, extra = {}) => ({ expected_version: version, operation_id: `op-${version}-${actor.agent_id}`, actor, ...extra });
function contract(id = "WK-one") {
  return { schema_version: "workkeel.task-contract/v2", id, goal: "Correct a total", state: "intake",
    scope: { include: ["total calculation"], exclude: ["publication"] }, actor: developer, dependencies: [],
    acceptance: { criteria: ["The total is correct"], evidence: [] }, handoff: null,
    verification: { risk_tier: "standard", separation: "distinct-agent", implementer: null, reviewer: null, candidate_revision: null },
    environment: { cwd: ".", read_paths: ["src"], write_paths: ["src"], tools: ["node"], resources: [],
      network: { mode: "none", hosts: [] }, external_actions: [], data: { classification: "internal", model_access: "none", policy_refs: ["docs/approval.md"] } },
    authorization: { approved_by: "owner", approval_ref: "docs/approval.md", operations: ["read", "write", "execute"], expires_at: null }, skills: [],
    execution: { runtime: { kind: "host-owned", adapter_id: null, required_features: [] }, model_connection: { kind: "native" } } };
}
function git(root, ...args) { return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
async function write(root, ref, data) { await fs.mkdir(path.dirname(path.join(root, ref)), { recursive: true }); await fs.writeFile(path.join(root, ref), typeof data === "string" ? data : JSON.stringify(data)); }
async function fixture(t, { init = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  git(root, "init", "-q"); git(root, "config", "user.name", "Fixture"); git(root, "config", "user.email", "fixture@example.invalid");
  await write(root, "docs/approval.md", "Approved total repair and internal local test data.\n");
  await write(root, "src/cart.mjs", "export const total = 1;\n");
  await write(root, "policy.json", policy());
  if (init) await initializeTaskProject(root, policy());
  git(root, "add", "."); git(root, "commit", "-qm", "base");
  return root;
}
async function deliver(root, id = "WK-one") {
  await createNativeTask(root, contract(id), request(0));
  const claimed = await mutateNativeTask(root, id, "claim", request(1, developer, { base_revision: git(root, "rev-parse", "HEAD") }));
  await write(root, "src/cart.mjs", "export const total = 2;\n"); git(root, "add", "src"); git(root, "commit", "-qm", "repair");
  const revision = git(root, "rev-parse", "HEAD");
  const ref = `.ai-org/artifacts/${id}/developer.md`; await write(root, ref, `Verified ${revision}.\n`);
  await mutateNativeTask(root, id, "handoff", request(2, developer, { claim_id: claimed.claim.id, revision, summary: "Total corrected and tested", evidence: [ref], unresolved: [] }));
  return { revision, ref };
}

test("task-first init, doctor, exact delivery, distinct review and close need no Positions", async t => {
  const root = await fixture(t);
  assert.equal((await diagnoseTaskProject(root)).valid, true);
  await assert.rejects(fs.stat(path.join(root, ".ai-org/core/positions.json")), { code: "ENOENT" });
  const { revision } = await deliver(root);
  const ref = ".ai-org/artifacts/WK-one/review.md"; await write(root, ref, `Independent fixture review of ${revision}.\n`);
  const reviewRequest = request(3, reviewer, { revision, judgment: "pass", summary: "Requirements met", evidence: [ref] });
  assert.equal((await mutateNativeTask(root, "WK-one", "review", reviewRequest)).state, "release_gate");
  const closed = await mutateNativeTask(root, "WK-one", "close", request(4, developer, { revision, summary: "Accepted", rollback: "Revert repair through reviewed change", evidence: [ref] }));
  assert.equal(closed.state, "done"); assert.equal(closed.external_release, "not-performed");
  assert.equal((await mutateNativeTask(root, "WK-one", "review", reviewRequest)).replayed, true);
  const item = await readNativeTask(root, "WK-one");
  assert.equal(item.history.length, 5); assert.equal(item.contract.state, "intake");
  assert.equal(item.contract.verification.reviewer, null); assert.equal(item.review.actor.agent_id, "reviewer");
  assert.equal((await diagnoseTaskProject(root)).valid, true);
  const status = spawnSync(process.execPath, [cli, "status", root], { encoding: "utf8" });
  assert.equal(status.status, 0, status.stderr); assert.equal(JSON.parse(status.stdout).tasks[0].state, "done");
});

test("identity, immutable input, stale claims, duplicate requests and self-review fail closed", async t => {
  const root = await fixture(t);
  const initial = request(0);
  await createNativeTask(root, contract(), initial);
  assert.equal((await createNativeTask(root, contract(), initial)).replayed, true);
  await assert.rejects(createNativeTask(root, { ...contract(), goal: "Other scope" }, initial), /already exists/);
  await assert.rejects(mutateNativeTask(root, "WK-one", "claim", request(1, reviewer, { base_revision: git(root, "rev-parse", "HEAD") })), /approved task Agent/);
  await assert.rejects(mutateNativeTask(root, "WK-one", "claim", request(0, developer, { operation_id: "stale-claim" })), /Stale/);
  const claim = await mutateNativeTask(root, "WK-one", "claim", request(1, developer, { base_revision: git(root, "rev-parse", "HEAD") }));
  await assert.rejects(mutateNativeTask(root, "WK-one", "release", request(2, developer, { claim_id: "stale", summary: "Release" })), /matching.*claim/);
  await assert.rejects(mutateNativeTask(root, "WK-one", "claim", request(1, developer, { base_revision: "a".repeat(40) })), /different input/);
  const ref = ".ai-org/artifacts/WK-one/test.md"; await write(root, ref, "Test evidence");
  const revision = git(root, "rev-parse", "HEAD");
  await mutateNativeTask(root, "WK-one", "handoff", request(2, developer, { claim_id: claim.claim.id, revision, summary: "No product change required", evidence: [ref], unresolved: [] }));
  await assert.rejects(mutateNativeTask(root, "WK-one", "review", request(3, developer, { revision, judgment: "pass", summary: "Self", evidence: [ref] })), /separation/);
  await assert.rejects(mutateNativeTask(root, "WK-one", "review", request(3, reviewer, { revision: "a".repeat(40), judgment: "pass", summary: "Wrong", evidence: [ref] })), /exact delivered/);
  assert.equal((await readNativeTask(root, "WK-one")).version, 3);
});

test("contract authority, unknown fields, high risk, paths and evidence are bounded", async t => {
  const root = await fixture(t);
  for (const change of [
    d => { d.verification.separation = "none"; },
    d => { d.environment.data.classification = "sensitive"; }, d => { d.authorization.approved_by = "review-owner"; },
    d => { d.environment.cwd = ".."; }, d => { d.authorization.approval_ref = "../secret"; },
    d => { d.actor.principal_id = "unregistered"; }, d => { d.capabilities = ["coding"]; },
    d => { d.authorization.expires_at = "2000-01-01T00:00:00Z"; }
  ]) { const doc = structuredClone(contract()); change(doc); await assert.rejects(createNativeTask(root, doc, request(0))); }
  // High work may be approved by its creator's Principal, even with several Principals; that Principal later closes it.
  const high = contract(); high.id = "WK-high"; high.verification.risk_tier = "high";
  assert.equal((await createNativeTask(root, high, request(0))).state, "intake");
  await fs.symlink("docs/approval.md", path.join(root, "link.md"));
  const linked = contract(); linked.authorization.approval_ref = "link.md";
  await assert.rejects(createNativeTask(root, linked, request(0)), /symlink/);
  await fs.unlink(path.join(root, "link.md"));
  const approvedAt = git(root, "rev-parse", "HEAD");
  await createNativeTask(root, contract(), request(0));
  assert.deepEqual((await readNativeTask(root, "WK-one")).approval, { approved_by: "owner", approved_at_revision: approvedAt });
  // Approval is the approving Principal plus a commit: editing the file afterwards
  // keeps the task usable, and the approved text stays in Git.
  await write(root, "docs/approval.md", "Changed authorization");
  assert.equal((await diagnoseTaskProject(root)).valid, true);
  await mutateNativeTask(root, "WK-one", "claim", request(1, developer, { base_revision: git(root, "rev-parse", "HEAD") }));
  assert.match(git(root, "show", `${approvedAt}:docs/approval.md`), /Approved total repair/);
  // A deleted decision source is still reported: its requirements cannot be read.
  await fs.rm(path.join(root, "docs/approval.md"));
  assert.equal((await diagnoseTaskProject(root)).valid, false);
});

test("candidate guards cover outside roots, untracked product, evidence paths and unresolved work", async t => {
  const root = await fixture(t);
  await createNativeTask(root, contract(), request(0));
  const claimed = await mutateNativeTask(root, "WK-one", "claim", request(1, developer, { base_revision: git(root, "rev-parse", "HEAD") }));
  const ref = ".ai-org/artifacts/WK-one/evidence.md"; await write(root, ref, "Evidence");
  const handoff = extra => request(2, developer, { claim_id: claimed.claim.id, revision: git(root, "rev-parse", "HEAD"), summary: "Repair", evidence: [ref], unresolved: [], ...extra });
  // Drift is checked only inside the write roots.
  await write(root, "src/untracked.mjs", "Hidden code");
  await assert.rejects(mutateNativeTask(root, "WK-one", "handoff", handoff()), /clean tree inside the approved write roots/);
  await fs.unlink(path.join(root, "src/untracked.mjs"));
  await write(root, "outside.txt", "Out of scope"); git(root, "add", "outside.txt"); git(root, "commit", "-qm", "outside");
  await assert.rejects(mutateNativeTask(root, "WK-one", "handoff", handoff()), /outside approved/);
  git(root, "reset", "-q", "--hard", "HEAD^");
  // Standard work needs evidence committed in the candidate or kept under .ai-org/.
  await assert.rejects(mutateNativeTask(root, "WK-one", "handoff", handoff({ evidence: [] })), /needs evidence/);
  await assert.rejects(mutateNativeTask(root, "WK-one", "handoff", handoff({ evidence: ["missing.md"] })), /ENOENT|no such file/);
  await write(root, "notes.txt", "Untracked notes outside the write roots");
  await assert.rejects(mutateNativeTask(root, "WK-one", "handoff", handoff({ unresolved: [""] })), /bounded list/);
  assert.equal((await readNativeTask(root, "WK-one")).state, "build");
  // Untracked files outside the write roots, an abbreviated commit ID and open issues are accepted.
  const short = git(root, "rev-parse", "--short=8", "HEAD");
  await mutateNativeTask(root, "WK-one", "handoff", handoff({ revision: short, evidence: [ref, "src/cart.mjs", "notes.txt"], unresolved: ["Flaky timer test"] }));
  const delivered = await readNativeTask(root, "WK-one");
  assert.equal(delivered.delivery.revision, git(root, "rev-parse", "HEAD"));
  assert.deepEqual(delivered.delivery.evidence, [{ path: ref, source: "workspace" }, { path: "src/cart.mjs", source: "candidate" }, { path: "notes.txt", source: "workspace" }]);
  assert.deepEqual(delivered.delivery.unresolved, ["Flaky timer test"]);
  // Editing evidence after delivery does not invalidate the task; Git keeps committed evidence.
  await write(root, ref, "Changed after delivery");
  assert.equal((await diagnoseTaskProject(root)).valid, true);
  await mutateNativeTask(root, "WK-one", "review", request(3, reviewer, { revision: short, judgment: "pass", summary: "Open issue judged acceptable", evidence: [] }));
  assert.equal((await readNativeTask(root, "WK-one")).review.revision, delivered.delivery.revision);
  // A pre-change {path, sha256} entry reads as a working file; its digest is not compared.
  assert.equal(await evidenceStatus(root, delivered.delivery.revision, { path: ref, sha256: "0".repeat(64) }), "present");
  assert.equal(await evidenceStatus(root, delivered.delivery.revision, { path: ".ai-org/missing.md", sha256: "0".repeat(64) }), "unavailable");
});

test("review and close reject an abbreviation that names more than one commit", async t => {
  const root = await fixture(t);
  await createNativeTask(root, contract(), request(0));
  const base = git(root, "rev-parse", "HEAD");
  const claimed = await mutateNativeTask(root, "WK-one", "claim", request(1, developer, { base_revision: base }));
  await write(root, "src/cart.mjs", "export const total = 2;\n"); git(root, "add", "src"); git(root, "commit", "-qm", "repair");
  // Sibling commits of one tree until two share a four-digit prefix; deliver one of them.
  const tree = git(root, "rev-parse", "HEAD^{tree}"), seen = new Map();
  let pair = null;
  for (let n = 0; !pair && n < 5000; n++) {
    const commit = execFileSync("git", ["-C", root, "commit-tree", tree, "-p", base, "-m", `candidate ${n}`], { encoding: "utf8" }).trim();
    const prefix = commit.slice(0, 4);
    if (seen.has(prefix)) pair = [seen.get(prefix), commit]; else seen.set(prefix, commit);
  }
  assert.ok(pair, "found two commits sharing a prefix");
  git(root, "reset", "-q", "--hard", pair[0]);
  const ref = ".ai-org/artifacts/WK-one/developer.md"; await write(root, ref, "Verified.\n");
  await mutateNativeTask(root, "WK-one", "handoff", request(2, developer, { claim_id: claimed.claim.id, revision: pair[0], summary: "Repair", evidence: [ref], unresolved: [] }));
  const ambiguous = pair[0].slice(0, 4);
  await assert.rejects(mutateNativeTask(root, "WK-one", "review", request(3, reviewer, { revision: ambiguous, judgment: "pass", summary: "Ambiguous", evidence: [] })), /exactly one commit/);
  const unique = pair[0].slice(0, 12);
  await mutateNativeTask(root, "WK-one", "review", request(3, reviewer, { operation_id: "unique-review", revision: unique, judgment: "pass", summary: "Reviewed", evidence: [] }));
  await assert.rejects(mutateNativeTask(root, "WK-one", "close", request(4, developer, { revision: ambiguous, summary: "Accept", rollback: "Revert", evidence: [] })), /independently accepted/);
  assert.equal((await mutateNativeTask(root, "WK-one", "close", request(4, developer, { operation_id: "unique-close", revision: unique, summary: "Accept", rollback: "Revert", evidence: [] }))).state, "done");
});

test("dependencies and overlapping active claims prevent premature or competing work", async t => {
  const root = await fixture(t);
  const child = contract("WK-child"); child.dependencies = ["WK-one"];
  await assert.rejects(createNativeTask(root, child, request(0)));
  await createNativeTask(root, contract(), request(0)); await createNativeTask(root, child, request(0));
  const base = git(root, "rev-parse", "HEAD");
  await assert.rejects(mutateNativeTask(root, "WK-child", "claim", request(1, developer, { base_revision: base })), /accepted native/);
  await mutateNativeTask(root, "WK-one", "claim", request(1, developer, { base_revision: base }));
  await createNativeTask(root, contract("WK-other"), request(0));
  await assert.rejects(mutateNativeTask(root, "WK-other", "claim", request(1, developer, { base_revision: base })), /overlapping/);
});

test("failed review preserves its attempt, requires fresh candidate and invalidates old review", async t => {
  const root = await fixture(t); const { revision, ref } = await deliver(root);
  await mutateNativeTask(root, "WK-one", "review", request(3, reviewer, { revision, judgment: "fail", summary: "Boundary defect", evidence: [ref] }));
  await assert.rejects(mutateNativeTask(root, "WK-one", "close", request(4, developer, { revision, summary: "Cannot close", rollback: "Revert", evidence: [ref] })), /independently accepted/);
  await mutateNativeTask(root, "WK-one", "rework", request(4, developer, { summary: "Repair same scope" }));
  const claim = await mutateNativeTask(root, "WK-one", "claim", request(5, developer, { base_revision: revision }));
  await assert.rejects(mutateNativeTask(root, "WK-one", "handoff", request(6, developer, { claim_id: claim.claim.id, revision, summary: "Retry old", evidence: [ref], unresolved: [] })), /new commit/);
  const item = await readNativeTask(root, "WK-one"); assert.equal(item.review, null); assert.equal(item.attempts[0].review.judgment, "fail");
});

test('evidence-only rework is a new commit reviewed again by a distinct Agent',async t=>{
  const root=await fixture(t),{revision,ref}=await deliver(root);
  const failed=request(3,reviewer,{revision,judgment:'fail',summary:'Evidence omits a known counter',evidence:[ref]});
  await mutateNativeTask(root,'WK-one','review',failed);
  await assert.rejects(mutateNativeTask(root,'WK-one','rework',request(4,reviewer,{mode:'evidence-only',summary:'No authority'})),/approving Principal/);
  await assert.rejects(mutateNativeTask(root,'WK-one','rework',request(4,developer,{mode:'anything',summary:'Unknown mode'})),/rework mode/);
  await mutateNativeTask(root,'WK-one','rework',request(4,developer,{mode:'evidence-only',summary:'Correct the evidence only'}));
  const claim=await mutateNativeTask(root,'WK-one','claim',request(5,developer,{base_revision:revision}));
  const corrected='.ai-org/artifacts/WK-one/corrected.md';await write(root,corrected,'Corrected counter, original failure retained.');
  const handoff=rev=>request(6,developer,{claim_id:claim.claim.id,revision:rev,summary:'Corrected evidence',evidence:[corrected],unresolved:[]});
  const before=await fs.readFile(root+'/.ai-org/work-items/WK-one.json');
  await assert.rejects(mutateNativeTask(root,'WK-one','handoff',handoff(revision)),/new commit/);
  assert.deepEqual(await fs.readFile(root+'/.ai-org/work-items/WK-one.json'),before);
  // Rewriting the rejected evidence no longer blocks anything.
  await write(root,ref,'Rewritten rejected evidence');
  git(root,'add','-f',corrected);git(root,'commit','-qm','corrected evidence');
  const next=git(root,'rev-parse','HEAD');
  await mutateNativeTask(root,'WK-one','handoff',handoff(next));
  assert.equal((await mutateNativeTask(root,'WK-one','review',failed)).replayed,true);
  assert.equal((await readNativeTask(root,'WK-one')).review,null);
  await assert.rejects(mutateNativeTask(root,'WK-one','review',request(3,reviewer,{operation_id:'stale-new-review',revision:next,judgment:'pass',summary:'Stale',evidence:[corrected]})),/Stale/);
  await assert.rejects(mutateNativeTask(root,'WK-one','review',request(7,developer,{revision:next,judgment:'pass',summary:'Self',evidence:[corrected]})),/separation/);
  await assert.rejects(mutateNativeTask(root,'WK-one','review',request(7,reviewer,{revision,judgment:'pass',summary:'Old candidate',evidence:[corrected]})),/exact delivered/);
  await mutateNativeTask(root,'WK-one','review',request(7,reviewer,{revision:next,judgment:'pass',summary:'Correction independently checked',evidence:[corrected]}));
  await mutateNativeTask(root,'WK-one','close',request(8,developer,{revision:next,summary:'Evidence accepted',rollback:'Preserve all versions',evidence:[corrected]}));
  const item=await readNativeTask(root,'WK-one');assert.equal(item.state,'done');assert.equal(item.attempts[0].review.judgment,'fail');
  assert.equal(item.attempts[0].rework_mode,'evidence-only');assert.equal(item.delivery.evidence_rework,undefined);
  assert.deepEqual(item.delivery.evidence,[{path:corrected,source:'candidate'}]);
  // Closed tasks are not re-verified: evidence edits after acceptance keep Doctor green.
  await write(root,corrected,'Tampered after acceptance');await fs.rm(root+'/'+ref);
  assert.equal((await diagnoseTaskProject(root)).valid,true);
});

test("initialization preserves existing files and removed legacy commands are rejected", async t => {
  const root = await fixture(t);
  const before = await fs.readFile(path.join(root, "workkeel.lock"));
  await assert.rejects(initializeTaskProject(root, policy()), /never overwrites/);
  assert.deepEqual(await fs.readFile(path.join(root, "workkeel.lock")), before);
  for (const args of [["legacy", "status", root], ["migration", "preview", root, "--policy", "policy.json"]]) {
    const removed = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
    assert.notEqual(removed.status, 0, args.join(" "));
  }
  const launcher = spawnSync(process.execPath, [path.join(root, "workkeelw.mjs"), "doctor", root], { encoding: "utf8", env: { ...process.env, WORKKEEL_CLI_PATH: cli } });
  assert.equal(launcher.status, 0, launcher.stderr); assert.equal(JSON.parse(launcher.stdout).valid, true);
  const unknown = spawnSync(process.execPath, [cli, "status", root, "--id", "WK-one"], { encoding: "utf8" });
  assert.notEqual(unknown.status, 0);
  await fs.mkdir(path.join(root, "nested"));
  await assert.rejects(initializeTaskProject(path.join(root, "nested"), policy()), /repository root/);
});

test("CLI init/create/claim and concurrent retries share the canonical task path", async t => {
  const root = await fixture(t, { init: false });
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  const init = run(["init", root, "--policy", "policy.json"]); assert.equal(init.status, 0, init.stderr);
  await write(root, "task-contract.json", contract()); git(root, "add", "."); git(root, "commit", "-qm", "task policy");
  const ref = ".ai-org/artifacts/WK-one/request.json";
  await write(root, ref, request(0));
  const created = run(["task", "create", root, "--source", "task-contract.json", "--request", ref]); assert.equal(created.status, 0, created.stderr);
  const claimRequest = request(1, developer, { base_revision: git(root, "rev-parse", "HEAD") });
  await write(root, ref, claimRequest);
  const claimed = run(["task", "claim", root, "--id", "WK-one", "--request", ref]); assert.equal(claimed.status, 0, claimed.stderr);
  const release = request(2, developer, { claim_id: JSON.parse(claimed.stdout).claim.id, summary: "Release for another session" });
  const outcomes = await Promise.all([mutateNativeTask(root, "WK-one", "release", release), mutateNativeTask(root, "WK-one", "release", release)]);
  assert.equal(outcomes.filter(x => x.replayed).length, 1); assert.equal((await readNativeTask(root, "WK-one")).version, 3);
  const recordPath = path.join(root, ".ai-org/work-items/WK-one.json"); const record = JSON.parse(await fs.readFile(recordPath, "utf8"));
  record.state = "done"; await fs.writeFile(recordPath, JSON.stringify(record));
  await assert.rejects(readNativeTask(root, "WK-one"), /recorded operation/);
});

test("product drift and unintegrated dependencies cannot pass acceptance; administrative drift and old evidence do not block", async t => {
  const root = await fixture(t);
  const helper = ".ai-org/artifacts/WK-one/helper.mjs";
  await write(root, helper, "export const value = 1;\n"); git(root, "add", helper); git(root, "commit", "-qm", "baseline helper");
  const { revision, ref } = await deliver(root);
  const report = ".ai-org/artifacts/WK-one/review.md"; await write(root, report, "Distinct reviewer report");
  await mutateNativeTask(root, "WK-one", "review", request(3, reviewer, { revision, judgment: "pass", summary: "Reviewed", evidence: [report] }));
  // `.ai-org/` is administrative: its drift never blocks, while product drift in the write roots does.
  await write(root, helper, "export const value = 999;\n");
  await write(root, "src/cart.mjs", "export const total = 3;\n");
  await assert.rejects(mutateNativeTask(root, "WK-one", "close", request(4, developer, { revision, summary: "Accept", rollback: "Revert", evidence: [report] })), /clean tree/);
  git(root, "checkout", "-q", "--", "src/cart.mjs");
  await mutateNativeTask(root, "WK-one", "close", request(4, developer, { revision, summary: "Accept", rollback: "Revert", evidence: [report] }));
  git(root, "checkout", "-q", "--", helper);
  const child = contract("WK-child"); child.dependencies = ["WK-one"];
  await createNativeTask(root, child, request(0));
  // An accepted dependency's evidence is not re-verified.
  await write(root, ref, "Changed dependency evidence");
  const previous = git(root, "rev-parse", `${revision}^`); git(root, "checkout", "--detach", previous);
  await assert.rejects(mutateNativeTask(root, "WK-child", "claim", request(1, developer, { base_revision: previous })), /Git candidate check/);
});

test("existing .ai-org state is never converted at initialization", async t => {
  const root = await fixture(t, { init: false });
  await write(root, ".ai-org/work-items/WI-0001.json", { id: "WI-0001", state: "done" });
  await assert.rejects(initializeTaskProject(root, policy()), /archived or removed/);
  await assert.rejects(fs.stat(path.join(root, "workkeel.lock")), { code: "ENOENT" });
});
