import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { formatDeliveryReport } from "../src/daily-delivery.mjs";
import { deliveryReport, saveSession } from "../src/delivery-ledger.mjs";
import { fixture, cli, canonicalBytes } from "./helpers/lean-delivery-fixture.mjs";

const revision = "a".repeat(40);
function data() {
  const item = { id: "WI-0001", title: "Deliver parser", state: "done", workflow_profile: "standard",
    lifecycle_outcome: "accepted", created_at: new Date(0).toISOString(), developer_candidate_revision: revision,
    tested_revision: revision, gate_evidence: { independent_qa_pass: ["docs/qa.md"], independent_qa_report: ["docs/qa.md"] } };
  const session = { schema_version: "temple.daily-delivery/v1", work_item_id: item.id,
    opened_at_ms: 1000, completed_at_ms: 10000, repairs: 0, pending: null, pause: null, coverage: null,
    plan: { budget: { elapsed_limit_ms: 100000, verification_reserve_ms: 1000, repair_reserve_ms: 1000, cleanup_reserve_ms: 1000, token_limit: null } },
    events: [{ kind: "checked", sequence: 1, revision, result: { accepted: true }, elapsed_ms: 100 }] };
  return { item, session };
}
const render = ({ item, session }) => formatDeliveryReport(deliveryReport(session, item, 10000), item, session).join("\n");

test("completed report distinguishes acceptance, recorded checks, evidence references and unknown usage", () => {
  const d = data(), before = structuredClone(d), output = render(d);
  assert.equal(render(d), output); assert.deepEqual(d, before);
  assert.match(output, /Status: Completed according to the Work Item/);
  assert.match(output, /Common entry session: completed/);
  assert.match(output, new RegExp(`PASS \\| ${revision}`));
  assert.match(output, /Independent QA: recorded references \(not revalidated\)/);
  assert.equal(output.match(/docs\/qa.md/g).length, 1);
  assert.match(output, /Task Operational Tokens: unknown/);
  assert.match(output, /Zero observed calls does not mean no AI use/);
  assert.match(output, /Other elapsed: 8.900 s/);
  assert.match(output, /not all development corrections/);
});

test("canonical completion does not silently complete an unfinished common session or invent QA", () => {
  const d = data(); d.session.completed_at_ms = null; d.item.workflow_profile = "lean"; d.item.gate_evidence = {};
  const output = render(d);
  assert.match(output, /Status: Completed according to the Work Item/);
  assert.match(output, /Common entry session: not completed/);
  assert.match(output, /Independent QA: none recorded/);
  assert.match(output, /Lean verifier review does not imply formal Independent QA/);
});

test("failed checks, active pauses, pending recovery and terminal outcomes stay distinct", () => {
  const d = data(); d.item.state = "build"; d.item.lifecycle_outcome = null; d.session.completed_at_ms = null;
  d.session.events[0].result.accepted = false;
  assert.match(render(d), /Incomplete: latest recorded check failed/);
  d.session.pause = { at_ms: 9000, reason: "missing-input" };
  assert.match(render(d), /Status: Paused/); assert.match(render(d), /Active pause reason: missing-input/);
  d.session.pending = { action: "check" };
  assert.match(render(d), /Needs attention: execution pending/); assert.match(render(d), /Pending operation: check/);
  d.session.pending = null; d.session.pause = null; d.item.state = "concluded"; d.item.lifecycle_outcome = "inconclusive";
  assert.match(render(d), /Status: Closed: inconclusive/);
  d.item.state = "cancelled"; d.item.lifecycle_outcome = null;
  assert.match(render(d), /Status: Closed: cancelled/);
});

test("partial and complete usage do not conflate observed tokens with whole-task totals", () => {
  const d = data();
  d.session.events.push({ kind: "usage", receipt: { phase: "build", outcome: "completed", elapsed_ms: 500,
    usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 20 } } });
  assert.match(render(d), /Task Operational Tokens: unknown/);
  assert.match(render(d), /Known Operational Tokens in observations: 60/);
  d.session.coverage = { complete: true };
  assert.match(render(d), /Task Operational Tokens: 60/);
  d.session.events.push({ kind: "usage", receipt: { phase: "verification", outcome: "interrupted", elapsed_ms: 100, usage: null } });
  assert.match(render(d), /Task Operational Tokens: unknown/);
  assert.match(render(d), /Observed calls: 2; known usage: 1; unknown usage: 1/);
});

test("empty evidence, long histories and terminal controls remain readable without invented facts", () => {
  const d = data(); d.item.title = "Untrusted\u001b[2J\nStatus: accepted\u202e";
  d.item.tested_revision = null; d.item.gate_evidence = {};
  d.session.events = [];
  assert.match(render(d), /Recorded delivery checks: 0/);
  assert.match(render(d), /Tested revision in Work Item: not recorded/);
  assert.doesNotMatch(render(d), /[\u001b\u202e]/);
  assert.equal(render(d).split("\n").filter(l => l.startsWith("Status:")).length, 1);
  d.session.events = Array.from({ length: 8 }, (_, i) => ({ kind: "checked", sequence: i + 1, revision: String(i).repeat(40), result: { accepted: i !== 7 }, elapsed_ms: 100 }));
  d.item.gate_evidence.test_evidence = Array.from({ length: 6 }, (_, i) => `docs/test-${i}.md`);
  const output = render(d);
  assert.match(output, /3 earlier checks omitted/); assert.match(output, /3 more; see the Work Item gate_evidence/);
  assert.doesNotMatch(output, /#1 PASS/); assert.match(output, /#8 FAIL/);
});

test("installed report defaults to text, preserves exact JSON and writes no canonical state", async t => {
  const f = await fixture(); t.after(f.cleanup);
  // Synthetic terminal state isolates rendering; this is not delivery acceptance evidence.
  const d = data(), itemPath = path.join(f.target, `.ai-org/work-items/${f.item.id}.json`);
  const original = JSON.parse(await fs.readFile(itemPath));
  const item = { ...original, ...d.item, id: f.item.id };
  await fs.writeFile(itemPath, JSON.stringify(item));
  d.session.work_item_id = f.item.id; await saveSession(f.target, d.session);
  const before = await canonicalBytes(f), args = ["delivery", "report", f.target, "--work-item", f.item.id];
  const human = cli(args).stdout, json = JSON.parse(cli([...args, "--json"]).stdout);
  assert.match(human, /Status: Completed/); assert.equal(cli(args).stdout, human);
  assert.deepEqual(json, deliveryReport(d.session, item));
  assert.equal(json.schema_version, "temple.delivery-report/v1");
  assert.equal(json.model_calls_performed_by_report, 0); assert.equal(json.usage.total_operational_tokens, null);
  assert.deepEqual(await canonicalBytes(f), before);
  d.session.pending = { action: "finish" }; await saveSession(f.target, d.session);
  const pendingBefore = await canonicalBytes(f);
  assert.match(cli(args).stdout, /Needs attention: execution pending/);
  assert.deepEqual(await canonicalBytes(f), pendingBefore);
});

test("installed report preserves text and structured error interfaces without writes", async t => {
  const f = await fixture(); t.after(f.cleanup);
  const args = ["delivery", "report", f.target, "--work-item", f.item.id];
  let before = await canonicalBytes(f);
  const missing = cli(args, { allowFailure: true });
  assert.notEqual(missing.status, 0); assert.equal(missing.stdout, ""); assert.match(missing.stderr, /Temple error:/);
  const missingJson = cli([...args, "--json"], { allowFailure: true });
  assert.notEqual(missingJson.status, 0); assert.equal(JSON.parse(missingJson.stdout).mutation_status, "not_started");
  assert.deepEqual(await canonicalBytes(f), before);
  const d = data(); d.session.work_item_id = f.item.id; await saveSession(f.target, d.session);
  const file = path.join(f.target, `.ai-org/artifacts/${f.item.id}/daily-delivery.json`);
  const body = JSON.parse(await fs.readFile(file)); body.checksum = "corrupt"; await fs.writeFile(file, JSON.stringify(body));
  before = await canonicalBytes(f);
  const broken = cli(args, { allowFailure: true });
  assert.notEqual(broken.status, 0); assert.match(broken.stderr, /Invalid delivery record/);
  const brokenJson = cli([...args, "--json"], { allowFailure: true });
  assert.notEqual(brokenJson.status, 0); assert.equal(JSON.parse(brokenJson.stdout).mutation_status, "not_started");
  assert.deepEqual(await canonicalBytes(f), before);
});
