import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { inspectDeliverySummary } from "../src/daily-delivery.mjs";
import { saveSession, deliveryReport } from "../src/delivery-ledger.mjs";
import { startManagementConsoleServer } from "../src/management-console-server.mjs";
import { startControlPlaneServer } from "../src/control-plane-server.mjs";
import { fixture, canonicalBytes } from "./helpers/lean-delivery-fixture.mjs";

const revision = "a".repeat(40);
// Deliberately synthetic, assembled like the existing private-viewer fixtures.
const privateHost = ["fixture-mini", "tailnet-fixture", "ts", "net"].join(".");
async function seed(f) {
  const itemPath = path.join(f.target, `.ai-org/work-items/${f.item.id}.json`);
  const item = { ...JSON.parse(await fs.readFile(itemPath)), state: "done", lifecycle_outcome: "accepted",
    developer_candidate_revision: revision, tested_revision: revision,
    gate_evidence: { test_evidence: Array.from({ length: 8 }, (_, i) => `docs/test-${i}.md`),
      independent_qa_pass: ["docs/qa.md"], independent_qa_report: ["docs/qa.md"] } };
  await fs.writeFile(itemPath, JSON.stringify(item)); // Synthetic state, not acceptance evidence.
  const session = { schema_version: "temple.daily-delivery/v1", work_item_id: item.id,
    opened_at_ms: Date.now() - 10000, completed_at_ms: Date.now(), repairs: 1, pause: null, pending: null,
    coverage: { complete: false, private_extra: "PRIVATE-COVERAGE" },
    plan: { budget: { elapsed_limit_ms: 100000, max_repairs: 2, verification_reserve_ms: 1000,
      repair_reserve_ms: 1000, cleanup_reserve_ms: 1000, token_limit: null } },
    events: Array.from({ length: 8 }, (_, i) => ({ kind: "checked", sequence: i + 1,
      revision, result: { accepted: true, private_extra: "PRIVATE-CHECK" }, elapsed_ms: 100 })) };
  await saveSession(f.target, session);
  return { itemPath, item, session };
}

test("summary reuses report counters with bounded evidence/checks and no raw records or writes", async t => {
  const f = await fixture(); t.after(f.cleanup);
  const { item, session } = await seed(f), before = await canonicalBytes(f);
  const summary = await inspectDeliverySummary(f.target, item.id), report = deliveryReport(session, item);
  assert.equal(summary.availability, "available");
  assert.equal(summary.canonical.lifecycle_state, "done");
  assert.equal(summary.session_completed, true);
  assert.deepEqual(summary.time, report.time);
  assert.equal(summary.checks.total, 8); assert.equal(summary.checks.items.length, 5);
  assert.equal(summary.checks.items[0].sequence, 4);
  assert.equal(summary.evidence.test.total, 8); assert.equal(summary.evidence.test.refs.length, 3);
  assert.deepEqual(summary.evidence.independent_qa, { total: 1, refs: ["docs/qa.md"] });
  assert.equal(summary.usage.total_operational_tokens, null);
  assert.equal(summary.model_calls_performed, 0);
  assert.doesNotMatch(JSON.stringify(summary), /PRIVATE-|"coverage":|"plan":|"result":/);
  assert.deepEqual(await canonicalBytes(f), before);
});

test("Done remains distinct from incomplete, paused and pending sessions; partial usage stays unknown", async t => {
  const f = await fixture(); t.after(f.cleanup);
  const { session } = await seed(f); session.completed_at_ms = null;
  session.events.push({ kind: "usage", receipt: { phase: "build", outcome: "completed", elapsed_ms: 500,
    private_extra: "PRIVATE-RECEIPT", usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 20 } } });
  const read = async () => { await saveSession(f.target, session); return inspectDeliverySummary(f.target, f.item.id); };
  let summary = await read();
  assert.equal(summary.canonical.lifecycle_state, "done"); assert.equal(summary.session_completed, false);
  assert.equal(summary.usage.known_operational_tokens, 60); assert.equal(summary.usage.total_operational_tokens, null);
  session.coverage.complete = true; summary = await read(); assert.equal(summary.usage.total_operational_tokens, 60);
  session.events.push({ kind: "usage", receipt: { phase: "build", outcome: "interrupted", usage: null } });
  session.pause = { at_ms: Date.now(), reason: "missing-input", private_extra: "PRIVATE-PAUSE" };
  session.events.push({ kind: "paused", private_extra: "PRIVATE-PAUSE-EVENT" });
  summary = await read(); assert.equal(summary.status_label, "Paused"); assert.equal(summary.pause_count, 1);
  assert.equal(summary.usage.total_operational_tokens, null); assert.equal(summary.usage.unknown_calls, 1);
  session.pending = { action: "check", request: { secret: "PRIVATE-PENDING" } };
  summary = await read(); assert.match(summary.status_label, /execution pending/);
  assert.equal(summary.pending_action, "check"); assert.equal(summary.active_pause_reason, "missing-input");
  assert.doesNotMatch(JSON.stringify(summary), /PRIVATE-/);
});

test("missing, corrupt, symlink and missing-item inputs are distinct, bounded and read-only", async t => {
  const f = await fixture(); t.after(f.cleanup);
  assert.equal((await inspectDeliverySummary(f.target, f.item.id)).availability, "session-missing");
  assert.equal((await inspectDeliverySummary(f.target, "WI-9999")).availability, "work-item-missing");
  await assert.rejects(inspectDeliverySummary(f.target, "../../secret"), /Invalid Work Item/);
  const { session, item, itemPath } = await seed(f);
  item.state = "build"; item.lifecycle_outcome = null; item.tested_revision = null;
  item.gate_evidence = { test_evidence: ["<script>\u001b\u202e" + "x".repeat(5000)] };
  await fs.writeFile(itemPath, JSON.stringify(item));
  session.events.at(-1).result.accepted = false; await saveSession(f.target, session);
  const summary = await inspectDeliverySummary(f.target, item.id);
  assert.match(summary.status_label, /check failed/);
  assert.equal(summary.canonical.tested_revision, "not recorded");
  assert.equal(summary.evidence.test.refs[0].length, 1000);
  assert.doesNotMatch(summary.evidence.test.refs[0], /[\u001b\u202e]/);
  const sessionPath = path.join(f.target, `.ai-org/artifacts/${item.id}/daily-delivery.json`);
  await fs.writeFile(sessionPath, '{"checksum":"broken"}');
  let before = await canonicalBytes(f);
  assert.equal((await inspectDeliverySummary(f.target, item.id)).availability, "unavailable");
  assert.deepEqual(await canonicalBytes(f), before);
  await fs.unlink(sessionPath); await fs.symlink(itemPath, sessionPath);
  assert.equal((await inspectDeliverySummary(f.target, item.id)).availability, "unavailable");
  assert.equal((await fs.lstat(sessionPath)).isSymbolicLink(), true);
  await fs.unlink(itemPath); await fs.symlink(path.join(f.target, "docs/brief.md"), itemPath);
  assert.equal((await inspectDeliverySummary(f.target, item.id)).availability, "unavailable");
});

function request(server, route, headers) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: "127.0.0.1", port: server.port, path: route, headers }, res => {
      let body = ""; res.on("data", chunk => body += chunk); res.on("end", () => resolve({ status: res.statusCode, body }));
    }); req.on("error", reject);
  });
}

for (const [label, start] of [["optional Console", startManagementConsoleServer], ["combined dashboard", startControlPlaneServer]]) {
  test(`${label} exposes only a local GET projection and preserves canonical bytes`, async t => {
    const f = await fixture(); t.after(f.cleanup); await seed(f);
    const server = await start(f.target, { port: 0, stateDirectory: path.join(f.temporary, "state"),
      privateViewerHost: privateHost, repositoryIntervalMs: 60000 });
    try {
      const before = await canonicalBytes(f), route = `/api/v1/work-items/${f.item.id}/delivery`;
      const response = await fetch(server.url + route);
      assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
      const summary = await response.json(); assert.equal(summary.availability, "available");
      assert.equal((await fetch(server.url + route, { method: "POST" })).status, 405);
      const privateResult = await request(server, route, { host: privateHost, "tailscale-user-login": "owner@example.test" });
      assert.equal(privateResult.status, 403); assert.doesNotMatch(privateResult.body, /docs\/|canonical|PRIVATE/);
      assert.equal((await request(server, route, { host: "untrusted.example.test" })).status, 403);
      assert.equal((await fetch(server.url + "/api/v1/work-items/WI-9999/delivery")).status, 404);
      assert.equal((await fetch(server.url + "/api/v1/work-items/%2e%2e%2fsecret/delivery")).status, 404);
      const collaborativeId = "WI-20260909-ABCDEF0123";
      assert.equal((await fetch(server.url + `/api/v1/work-items/${collaborativeId}/delivery`)).status, 404);
      const missing = await fetch(server.url + `/api/v1/work-items/${collaborativeId}/delivery`).then(r => r.json());
      assert.equal(missing.availability, "work-item-missing", "collaborative IDs use the same guarded route");
      assert.deepEqual(await canonicalBytes(f), before);
    } finally { await server.close(); }
  });
}
