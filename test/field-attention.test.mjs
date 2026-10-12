import assert from "node:assert/strict";
import test from "node:test";
import { deriveDeliveryAttention } from "../src/delivery-attention.mjs";

const revision = "a".repeat(40);
const item = { id: "WI-0001", state: "independent_qa", workflow_profile: "standard", owner_position: "independent_qa", assigned_agent_id: "reviewer",
  developer_candidate_revision: revision, claim: { id: "claim", status: "active", agent_id: "reviewer", principal_id: "person" }, unresolved: [] };
const worker = { id: "worker", work_item_id: item.id, position_id: "independent_qa", agent_id: "reviewer", claim_id: "claim",
  runtime_kind: "internal-subagent", runtime_id: "actual-runtime", task_id: null, status: "active", attached_at: "2026-09-16T00:00:00Z", completed_at: null };
const handoff = { from_position: "independent_qa", to_position: "release_manager", actor: "reviewer", input_revision: revision,
  artifact: ".ai-org/artifacts/WI-0001/review.md", created_at: "2026-09-16T01:00:00Z" };

test("V08: completed review awaiting a real device is explicit and is not running QA", () => {
  const result = deriveDeliveryAttention({ ...item, handoffs: [handoff] }, { workers: [{ ...worker, status: "completed", completed_at: "2026-09-16T01:00:00Z" }],
    evidence: [{ id: "measurement", work_item_id: item.id, scope_revision: revision, kind: "test", outcome: "passed", invalidated_at: null }],
    missingConditions: [{ kind: "environment", description: "Physical device unavailable", owner: "device-operator", next_action: "Run the recorded scenario on the named physical device." }] });
  assert.equal(result.state, "awaiting-environment");
  assert.equal(result.execution_state, "not-running");
  assert.equal(result.review_state, "completed");
  assert.equal(result.acceptance_state, "not-complete");
  assert.equal(result.evidence_state, "recorded-measurement");
  assert.equal(result.missing_conditions[0].owner, "device-operator");
  assert.match(result.next_action, /physical device/);
});

test("V08/V12: QA is running only with an attached active runtime matching the actual current claim", () => {
  assert.equal(deriveDeliveryAttention(item, { workers: [worker] }).review_state, "running");
  for (const change of [{ runtime_id: null }, { attached_at: null }, { status: "reserved" }, { status: "waiting" }, { completed_at: "completed" }, { claim_id: "old-claim" }, { agent_id: "another-agent" }, { position_id: "developer" }]) {
    const result = deriveDeliveryAttention(item, { workers: [{ ...worker, ...change }] });
    assert.equal(result.review_state, "not-running", JSON.stringify(change));
    assert.equal(result.state, "awaiting-owner");
    assert.equal(result.owner.agent_id, "reviewer");
  }
  assert.equal(deriveDeliveryAttention({ ...item, claim: null }, { workers: [worker] }).execution_state, "not-running");
});

test("V08/V12: completed review, decision waiting and organizational acceptance remain separate", () => {
  assert.equal(deriveDeliveryAttention({ ...item, handoffs: [handoff] }).state, "review-completed");
  assert.equal(deriveDeliveryAttention({ ...item, handoffs: [{ ...handoff, input_revision: "b".repeat(40) }] }).review_state, "not-running");
  const decision = deriveDeliveryAttention({ ...item, handoffs: [handoff], unresolved: ["Owner must select recovery disposition"] });
  assert.equal(decision.state, "awaiting-decision");
  assert.equal(decision.review_state, "completed");
  assert.equal(deriveDeliveryAttention({ ...item, state: "done", release_gate_result: "go" }).state, "acceptance-complete");
  assert.equal(deriveDeliveryAttention({ ...item, merged: true }).acceptance_state, "not-complete");
  assert.equal(deriveDeliveryAttention({ ...item, state: "done" }).acceptance_state, "not-complete");
  assert.equal(deriveDeliveryAttention({ ...item, state: "done", workflow_profile: "lean", gate_evidence: { lean_closeout: ["closeout.md"] } }).acceptance_state, "complete");
});

test("V08/V11: current evidence debt blocks readiness; historical debt remains visible without rewriting acceptance", () => {
  const debt = { evidence_id: "old", work_item_id: item.id, scope_revision: "b".repeat(40), status: "historical-evidence-debt", next_action: "Fetch the original commit." };
  const accepted = deriveDeliveryAttention({ ...item, state: "done", release_gate_result: "go" }, { durability: { items: [debt] } });
  assert.equal(accepted.state, "acceptance-complete");
  assert.equal(accepted.historical_evidence_debt.length, 1);
  const historical = deriveDeliveryAttention({ ...item, state: "concluded" }, { durability: { items: [debt] } });
  assert.equal(historical.state, "historical-evidence-debt");
  const current = deriveDeliveryAttention(item, { durability: { items: [{ ...debt, scope_revision: revision }] } });
  assert.equal(current.state, "awaiting-evidence");
  assert.equal(current.missing_conditions[0].kind, "evidence");
});

test("V15: human and Agent measurements project the same acceptance boundary and the projection cannot mutate source", () => {
  const source = structuredClone(item);
  for (const recordedBy of ["human-contributor", "ordinary-agent", "governed-agent"]) {
    const result = deriveDeliveryAttention(source, { evidence: [{ id: recordedBy, recorded_by: recordedBy, kind: "test", outcome: "passed", work_item_id: item.id, scope_revision: revision }] });
    assert.equal(result.evidence_state, "recorded-measurement");
    assert.equal(result.acceptance_state, "not-complete");
    assert.equal(result.mutation_performed, false);
  }
  assert.deepEqual(source, item);
});

test("V08: structured conditions take precedence over legacy descriptions and expired claims are not current measurements", () => {
  const result = deriveDeliveryAttention({ ...item, unresolved: ["Device unavailable"],
    missing_conditions: [{ kind: "environment", description: "Device unavailable", next_action: "Use the named device." }] }, {
    now: "2026-09-16T00:00:00Z", evidence: [{ id: "expired", kind: "test", work_item_id: item.id, scope_revision: revision, expires_at: "2026-09-15T00:00:00Z" }] });
  assert.equal(result.missing_conditions.length, 1);
  assert.equal(result.missing_conditions[0].kind, "environment");
  assert.equal(result.evidence_state, "no-current-measurement");
  assert.equal(deriveDeliveryAttention(item, { evidence: [{ kind: "unverified-claim", scope_revision: revision, work_item_id: item.id }] }).evidence_state, "no-current-measurement");
});
