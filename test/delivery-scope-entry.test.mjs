import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fixture, cli, itemState, canonicalBytes } from "./helpers/lean-delivery-fixture.mjs";
import { openDelivery, checkDelivery, inspectDelivery } from "../src/daily-delivery.mjs";
import { digest, readSession, saveSession } from "../src/delivery-ledger.mjs";

const scopeError = /declared affected product scope outside \.ai-org; use the ordinary Work Item lifecycle/;
async function setup(t, { version = 2, workflowProfile = "lean", affectedPaths } = {}) {
  const f = await fixture({ workflowProfile, affectedPaths }); t.after(f.cleanup);
  const integrationPath = path.join(f.target, ".ai-org/project/repository-integration.json");
  const integration = JSON.parse(await fs.readFile(integrationPath));
  await fs.writeFile(integrationPath, JSON.stringify({ ...integration, status: "confirmed", source: "human-confirmed", summary: "Local entry fixture", change_isolation: "not-required", review_gate: "not-required", recorded_at: "2026-09-01T00:00:00.000Z", recorded_by: "human" }));
  const plan = { schema_version: `temple.delivery-plan/v${version}`, ...(version === 2 ? { execution_mode: "autonomous", check_policy: "trusted-local" } : {}),
    authorization_ref: "docs/brief.md", tests: ["app.test.mjs"], test_timeout_ms: 3000,
    budget: { elapsed_limit_ms: 120000, max_repairs: 1, verification_reserve_ms: 10000, repair_reserve_ms: 10000, cleanup_reserve_ms: 5000, token_limit: null, token_reserve: 0 } };
  const requestRef = "docs/scope-plan.json";
  await fs.writeFile(path.join(f.target, requestRef), JSON.stringify(plan));
  cli(["work-item", "release", f.target, "--work-item", f.item.id, "--agent-id", f.request.agentId, "--principal-id", "human", "--reason", "Entry must create its own claim"]);
  return { ...f, plan, options: { workItemId: f.item.id, agentId: f.request.agentId, principalId: "human", requestRef } };
}

for (const [version, workflowProfile, affectedPaths] of [
  [1, "lean", [".ai-org/artifacts"]],
  [2, "lean", [".ai-org/artifacts", ".ai-org/project"]],
  [2, "standard", [".ai-org/artifacts"]],
  [2, "standard", [".ai-org"]]
]) test(`installed v${version} ${workflowProfile} entry rejects ${affectedPaths.join(",")} without canonical writes`, async t => {
  const f = await setup(t, { version, workflowProfile, affectedPaths }), before = await canonicalBytes(f);
  const result = cli(["delivery", "open", f.target, "--work-item", f.item.id, "--agent-id", f.request.agentId, "--principal-id", "human", "--request", f.options.requestRef, "--json"], { allowFailure: true });
  assert.notEqual(result.status, 0); assert.match(result.stdout + result.stderr, scopeError);
  const rejection = JSON.parse(result.stdout);
  assert.equal(rejection.code, "GUARD_REJECTED"); assert.equal(rejection.mutation_status, "not_started");
  assert.equal((await itemState(f)).claim.status, "released");
  await assert.rejects(readSession(f.target, f.item.id), { code: "ENOENT" });
  assert.deepEqual(await canonicalBytes(f), before);
});

test("old artifact-only sessions reject re-entry and checks while preserving readable history", async t => {
  const f = await setup(t, { affectedPaths: [".ai-org/artifacts"] });
  cli(["work-item", "claim", f.target, "--work-item", f.item.id, "--agent-id", f.request.agentId, "--principal-id", "human", "--base-revision", f.request.revision, "--branch", "main"]);
  // Seed an old-version session through the ledger writer; production history is never edited.
  await saveSession(f.target, { schema_version: "temple.daily-delivery/v1", work_item_id: f.item.id,
    opened_at_ms: Date.now(), completed_at_ms: null, plan_ref: f.options.requestRef,
    plan_source_sha256: digest(await fs.readFile(path.join(f.target, f.options.requestRef))), plan: f.plan,
    scope_digest: "retained-legacy-scope", repairs: 0, events: [{ sequence: 1, at_ms: Date.now(), kind: "opened", phase: "build", actor: f.request.agentId }],
    pending: null, pause: null, last_check: null, coverage: null });
  await fs.writeFile(path.join(f.target, "app.test.mjs"), "import fs from 'node:fs';fs.writeFileSync('must-not-run','unexpected');\n");
  const before = await canonicalBytes(f);
  await assert.rejects(openDelivery(f.target, f.options), scopeError);
  await assert.rejects(checkDelivery(f.target, f.options), scopeError);
  const report = await inspectDelivery(f.target, { ...f.options, report: true });
  assert.equal(report.session_completed, false); assert.equal(report.checks.length, 0);
  assert.equal(report.model_calls_performed_by_report, 0);
  assert.equal((await itemState(f)).claim.status, "active");
  await assert.rejects(fs.access(path.join(f.target, "must-not-run")), { code: "ENOENT" });
  assert.deepEqual(await canonicalBytes(f), before);
});

for (const affectedPaths of [["app.mjs", ".ai-org/artifacts"], ["docs"], [".ai-org-tools"]])
  test(`entry still admits declared product scope ${affectedPaths.join(",")}`, async t => {
    const f = await setup(t, { affectedPaths });
    const result = await openDelivery(f.target, f.options);
    assert.equal(result.next.action, "implement-and-check");
    assert.equal((await itemState(f)).claim.status, "active");
    assert.equal((await readSession(f.target, f.item.id)).events.filter(e => e.kind === "entered").length, 1);
  });
