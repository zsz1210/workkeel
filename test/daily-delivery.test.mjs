import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fixture, cli, git, itemState, canonicalBytes } from "./helpers/lean-delivery-fixture.mjs";
import { openDelivery, checkDelivery, finishDelivery, inspectDelivery, reworkDelivery, observeDelivery, pauseDelivery, resumeDelivery } from "../src/daily-delivery.mjs";
import { readSession, saveSession, validatePlan, admission, usageSummary, readSource } from "../src/delivery-ledger.mjs";
import { runLocalChecks } from "../src/delivery-check.mjs";

const plan = () => ({ schema_version: "temple.delivery-plan/v1", authorization_ref: "docs/brief.md", tests: ["app.test.mjs"], test_timeout_ms: 3000,
  budget: { elapsed_limit_ms: 120000, max_repairs: 2, verification_reserve_ms: 10000, repair_reserve_ms: 10000, cleanup_reserve_ms: 5000, token_limit: null, token_reserve: 0 } });
async function setup(t) {
  const f = await fixture(); t.after(f.cleanup);
  const integrationPath = path.join(f.target, ".ai-org/project/repository-integration.json");
  const integration = JSON.parse(await fs.readFile(integrationPath));
  await fs.writeFile(integrationPath, JSON.stringify({ ...integration, status: "confirmed", source: "human-confirmed", summary: "Local fixture only", change_isolation: "not-required", review_gate: "not-required", recorded_at: "2026-09-01T00:00:00.000Z", recorded_by: "human" }));
  await fs.writeFile(path.join(f.target, "docs/daily-plan.json"), JSON.stringify(plan()));
  const options = { workItemId: f.item.id, agentId: f.request.agentId, principalId: "human", requestRef: "docs/daily-plan.json" };
  return { ...f, options };
}
async function request(f, actor, suffix = "first") {
  const directory = `.ai-org/artifacts/${f.item.id}`; await fs.mkdir(path.join(f.target, directory), { recursive: true });
  const position = actor === f.request.agentId ? "developer" : "quality_evaluator";
  const body = { operation_id: `${position}-${suffix}`, position, revision: git(f.target, ["rev-parse", "HEAD"]),
    ...(position === "developer" ? { completed: ["Implemented and tested approved parser"], evidence: ["docs/developer-test.md"] } : { judgment: "pass", test_evidence: ["docs/verification.md"], lean_closeout: ["docs/verification.md"] }) };
  const relative = `${directory}/${position}-${suffix}.json`; await fs.writeFile(path.join(f.target, relative), JSON.stringify(body));
  return { workItemId: f.item.id, agentId: actor, principalId: "human", requestRef: relative };
}
test("installed CLI completes the daily path with a distinct verifier and read-only report", async t => {
  const f = await setup(t), base = [f.target, "--work-item", f.item.id, "--agent-id", f.request.agentId, "--principal-id", "human"];
  const opened = JSON.parse(cli(["delivery", "open", ...base, "--request", "docs/daily-plan.json", "--json"]).stdout);
  assert.equal(opened.next.action, "implement-and-check"); assert.equal(opened.authority_granted, false);
  const r = await request(f, f.request.agentId);
  assert.equal(JSON.parse(cli(["delivery", "check", ...base, "--json"]).stdout).check.accepted, true);
  const done = JSON.parse(cli(["delivery", "finish", ...base, "--request", r.requestRef, "--json"]).stdout);
  assert.equal(done.lifecycle_state, "test");
  await assert.rejects(openDelivery(f.target, { ...f.options, requestRef: undefined }), /eligible|distinct/i);
  await fs.writeFile(path.join(f.target, "docs/verification.md"), "# Actual independent fixture verification\nParser behavior and cleanup pass. Approved scope complete.\n");
  await openDelivery(f.target, { ...f.options, agentId: f.qualityAgent });
  const vr = await request(f, f.qualityAgent); assert.equal((await checkDelivery(f.target, vr)).check.accepted, true);
  assert.equal((await finishDelivery(f.target, vr)).lifecycle_state, "done");
  assert.equal((await itemState(f)).state, "done");
  const before = await canonicalBytes(f);
  const report = JSON.parse(cli(["delivery", "report", f.target, "--work-item", f.item.id, "--json"]).stdout);
  assert.equal(report.lifecycle_state, "done"); assert.equal(report.usage.total_operational_tokens, null);
  assert.equal(report.model_calls_performed_by_report, 0); assert.deepEqual(await canonicalBytes(f), before);
});
test("failed checks preserve residue and route repair without granting acceptance", async t => {
  const f = await setup(t); await openDelivery(f.target, f.options);
  await fs.writeFile(path.join(f.target, "app.test.mjs"), "import fs from 'node:fs';import os from 'node:os';import path from 'node:path';fs.writeFileSync(path.join(os.tmpdir(),'left'),'left');\n");
  const r = await checkDelivery(f.target, f.options);
  assert.equal(r.check.exit_code, 0); assert.equal(r.check.accepted, false); assert.equal(r.next.action, "repair-and-check");
  assert.deepEqual(r.check.residue, [{ path: "left", type: "file" }]); assert.equal(r.check.temporary_removed, true);
  assert.equal((await itemState(f)).state, "build");
});
test("exact candidate checks reject later edits and scope changes", async t => {
  const f = await setup(t); await openDelivery(f.target, f.options); const r = await request(f, f.request.agentId);
  await checkDelivery(f.target, f.options); await fs.appendFile(path.join(f.target, "app.mjs"), "// later edit\n");
  await assert.rejects(finishDelivery(f.target, r), /exact-current-candidate/);
  assert.equal((await inspectDelivery(f.target, f.options)).next.action, "check-current-candidate");
  await fs.appendFile(path.join(f.target, "docs/brief.md"), "Changed authority\n");
  await assert.rejects(checkDelivery(f.target, f.options), /authority\/scope changed/);
});
test("same-scope reviewer rework and a fresh attempt retain the first rejection", async t => {
  const f = await setup(t); await openDelivery(f.target, f.options); const first = await request(f, f.request.agentId);
  await checkDelivery(f.target, first); await finishDelivery(f.target, first);
  const verifier = { ...f.options, agentId: f.qualityAgent }; await openDelivery(f.target, verifier);
  await fs.writeFile(path.join(f.target, "docs/findings.md"), "# Review\nAdd the missing accepted edge case.\n");
  await fs.writeFile(path.join(f.target, "docs/rework.json"), JSON.stringify({ revision: f.request.revision, reason: ["Missing edge case"], evidence: ["docs/findings.md"] }));
  await fs.writeFile(path.join(f.target, "docs/invalid-rework.json"), JSON.stringify({ revision: "invalid", reason: ["Missing edge case"], evidence: ["docs/findings.md"] }));
  await assert.rejects(reworkDelivery(f.target, { ...verifier, requestRef: "docs/invalid-rework.json" }), /exact current/);
  assert.equal((await readSession(f.target, f.item.id)).pending, null);
  const result = await reworkDelivery(f.target, { ...verifier, requestRef: "docs/rework.json" });
  assert.equal(result.lifecycle_state, "build"); assert.equal((await readSession(f.target, f.item.id)).repairs, 1);
  await openDelivery(f.target, f.options);
  assert.equal((await itemState(f)).claim.agent_id, f.request.agentId);
  assert.equal((await readSession(f.target, f.item.id)).events.filter(e => e.kind === "reworked").length, 1);
});
test("finish diagnostic failure recovers only the identical request", async t => {
  const f = await setup(t); await openDelivery(f.target, f.options); const r = await request(f, f.request.agentId);
  await checkDelivery(f.target, f.options);
  const failed = await finishDelivery(f.target, r, { checkpoint: async point => { if (point === "before-doctor") throw Error("injected diagnostics"); } });
  assert.equal(failed.finish.success, false); assert.equal(failed.next.action, "recover-finish");
  await assert.rejects(openDelivery(f.target, f.options), /pending/i);
  const original = await fs.readFile(path.join(f.target, r.requestRef));
  await fs.writeFile(path.join(f.target, r.requestRef), JSON.stringify({ ...JSON.parse(original), completed: ["Changed facts"] }));
  await assert.rejects(finishDelivery(f.target, r), /identical pending/);
  await fs.writeFile(path.join(f.target, r.requestRef), original);
  const recovered = await finishDelivery(f.target, r); assert.equal(recovered.finish.success, true);
  assert.equal((await finishDelivery(f.target, r)).already_recorded, true);
  assert.equal((await itemState(f)).handoffs.length, 1);
});
test("timed-out real subprocess exits and cleans only its owned temporary area", async t => {
  const f = await setup(t);
  await fs.writeFile(path.join(f.target, "app.test.mjs"), "import test from 'node:test';test('hang',async()=>{await new Promise(()=>setInterval(()=>{},1000))});\n");
  const result = await runLocalChecks(f.target, f.item.id, { ...plan(), test_timeout_ms: 300 });
  assert.equal(result.accepted, false); assert.equal(result.timed_out, true);
  assert.equal(result.process_exit_confirmed, true); assert.equal(result.temporary_removed, true);
  assert.equal((await fs.readdir(f.target)).some(p => p.startsWith(".temple-check-")), false);
});
test("coordinator death terminates its check group and retains a non-replayable pending record", async t => {
  const f = await setup(t); await openDelivery(f.target, f.options);
  await fs.writeFile(path.join(f.target, "app.test.mjs"), "import test from 'node:test';test('hang',async()=>{await new Promise(()=>setInterval(()=>{},1000))});\n");
  const child = spawn(process.execPath, [fileURLToPath(new URL("../bin/temple.mjs", import.meta.url)), "delivery", "check", f.target, "--work-item", f.item.id, "--agent-id", f.request.agentId, "--principal-id", "human", "--json"], { stdio: "ignore" });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  let session;
  for (let i = 0; i < 200; i++) { session = await readSession(f.target, f.item.id); if (session.pending?.process_group_id) break; await new Promise(r => setTimeout(r, 20)); }
  const group = session.pending?.process_group_id; assert.ok(group);
  const exited = new Promise(r => child.once("exit", r)); child.kill("SIGKILL"); await exited;
  const alive = () => { try { process.kill(-group, 0); return true; } catch (e) { return e.code !== "ESRCH"; } };
  for (let i = 0; i < 200 && alive(); i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(alive(), false);
  assert.equal((await inspectDelivery(f.target, f.options)).next.action, "reconcile");
  await assert.rejects(checkDelivery(f.target, f.options), /pending/);
});
test("pending checks never replay and changed candidates cannot hide pause or exhausted repair capacity", async t => {
  const f = await setup(t); await openDelivery(f.target, f.options);
  await fs.writeFile(path.join(f.target, "app.test.mjs"), "import test from 'node:test';test('failure',()=>{throw Error('defect')});\n");
  await checkDelivery(f.target, f.options);
  let session = await readSession(f.target, f.item.id); session.repairs = session.plan.budget.max_repairs; await saveSession(f.target, session);
  await fs.appendFile(path.join(f.target, "app.mjs"), "// changed\n");
  assert.equal((await inspectDelivery(f.target, f.options)).next.action, "resolve-capacity");
  await assert.rejects(checkDelivery(f.target, f.options), /Repair limit/);
  session.pending = { action: "check", revision: f.request.revision }; await saveSession(f.target, session);
  await assert.rejects(checkDelivery(f.target, f.options), /pending/);
  assert.equal((await inspectDelivery(f.target, f.options)).next.action, "reconcile");
});
test("path and actor guards fail before writing canonical state", async t => {
  const f = await setup(t); const before = await canonicalBytes(f);
  await assert.rejects(openDelivery(f.target, { ...f.options, agentId: "missing-agent" }), /eligible/);
  assert.deepEqual(await canonicalBytes(f), before);
  await fs.symlink(path.join(f.target, "docs/brief.md"), path.join(f.target, "docs/link.md"));
  await assert.rejects(readSource(f.target, "docs/link.md"), /symlinks/);
  await assert.rejects(readSource(f.target, "../outside"), /repository-relative/);
});
test("known prelaunch path rejection settles and can resume after resolution", async t => {
  const f = await setup(t); await openDelivery(f.target, f.options);
  await fs.rename(path.join(f.target, "app.test.mjs"), path.join(f.target, "actual.test.mjs"));
  await fs.symlink("actual.test.mjs", path.join(f.target, "app.test.mjs"));
  const rejected = await checkDelivery(f.target, f.options);
  assert.equal(rejected.check.execution_started, false); assert.equal(rejected.check.process_exit_confirmed, true);
  assert.equal((await readSession(f.target, f.item.id)).pending, null);
  await fs.unlink(path.join(f.target, "app.test.mjs")); await fs.rename(path.join(f.target, "actual.test.mjs"), path.join(f.target, "app.test.mjs"));
  await resumeDelivery(f.target, { ...f.options, requestRef: "docs/brief.md" });
  assert.equal((await checkDelivery(f.target, f.options)).check.accepted, true);
});
test("complete provider attestation distinguishes known zero, missing counters and partial coverage", async t => {
  const f = await setup(t); await openDelivery(f.target, f.options);
  const receipt = { schema_version: "temple.delivery-usage/v1", work_item_id: f.item.id, provider_id: "fixture", call_id: "attested-1", phase: "preparation", outcome: "completed", elapsed_ms: 10, usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 20 }, coverage: { complete: true, from_work_item_creation: true, call_ids: ["attested-1"] } };
  const file = path.join(f.target, "docs/attested.json"), o = { ...f.options, requestRef: "docs/attested.json" };
  await fs.writeFile(file, JSON.stringify(receipt));
  assert.equal((await observeDelivery(f.target, o)).usage.total_operational_tokens, 60);
  receipt.call_id = "unknown-2"; receipt.usage = null; receipt.coverage.call_ids.push(receipt.call_id);
  await fs.writeFile(file, JSON.stringify(receipt));
  const result = await observeDelivery(f.target, o); assert.equal(result.usage.total_operational_tokens, null); assert.equal(result.usage.known_operational_tokens, 60);
});
test("ignored selected tests cannot evade the exact candidate snapshot", async t => {
  const f = await setup(t);
  await fs.writeFile(path.join(f.target, ".gitignore"), "ignored.test.mjs\n");
  await fs.copyFile(path.join(f.target, "app.test.mjs"), path.join(f.target, "ignored.test.mjs"));
  const result = await runLocalChecks(f.target, f.item.id, { ...plan(), tests: ["ignored.test.mjs"] });
  assert.equal(result.accepted, false); assert.match(result.instrument_error, /Git-visible/);
  assert.equal(result.temporary_removed, true);
});
test("first verification admission preserves repair plus revalidation and cleanup", () => {
  const session = { plan: plan(), repairs: 0, opened_at_ms: 0, events: [] };
  const result = admission(session, "verification", 96000);
  assert.equal(result.downstream_reserve_ms, 25000); assert.equal(result.allowed, false);
  session.repairs = session.plan.budget.max_repairs;
  assert.equal(admission(session, "verification", 96000).downstream_reserve_ms, 5000);
});
test("usage retains failed calls, deduplicates and reports unknown coverage", async t => {
  const f = await setup(t); await openDelivery(f.target, f.options);
  const receipt = { schema_version: "temple.delivery-usage/v1", work_item_id: f.item.id, provider_id: "fixture-provider", call_id: "turn-1", phase: "build", outcome: "failed", elapsed_ms: 1234, usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 20 } };
  await fs.writeFile(path.join(f.target, "docs/usage.json"), JSON.stringify(receipt)); const o = { ...f.options, requestRef: "docs/usage.json" };
  const report = await observeDelivery(f.target, o); assert.equal(report.usage.known_operational_tokens, 60); assert.equal(report.usage.total_operational_tokens, null);
  assert.equal((await observeDelivery(f.target, o)).usage.observed_calls, 1);
  receipt.usage.output_tokens++; await fs.writeFile(path.join(f.target, "docs/usage.json"), JSON.stringify(receipt));
  await assert.rejects(observeDelivery(f.target, o), /Conflicting usage/);
});
test("budget reserves and explicit pause resolution cannot be silently waived", async t => {
  const p = plan(); assert.throws(() => validatePlan({ ...p, budget: { ...p.budget, elapsed_limit_ms: 20000 } }), /buffers/);
  assert.throws(() => validatePlan({ ...p, tests: ["../bad.test.mjs"] }), /explicit/);
  const f = await setup(t); await openDelivery(f.target, f.options);
  await fs.writeFile(path.join(f.target, "docs/pause.json"), JSON.stringify({ reason: "external-dependency", detail: "Fixture dependency unavailable" }));
  await pauseDelivery(f.target, { ...f.options, requestRef: "docs/pause.json" });
  await assert.rejects(checkDelivery(f.target, f.options), /paused/);
  await resumeDelivery(f.target, { ...f.options, requestRef: "docs/brief.md" });
  const s = await readSession(f.target, f.item.id); assert.equal(s.events.filter(e => e.kind === "resumed").length, 1);
  s.opened_at_ms = Date.now() - s.plan.budget.elapsed_limit_ms; await saveSession(f.target, s);
  assert.equal(admission(s, "build").allowed, false); await assert.rejects(checkDelivery(f.target, f.options), /admission blocked/);
  s.plan.budget.token_limit = 10000; s.plan.budget.token_reserve = 1000;
  assert.ok(admission(s, "build").reasons.includes("task-token-coverage-unknown")); assert.equal(usageSummary(s).total_operational_tokens, null);
});
