import assert from "node:assert/strict";
import test from "node:test";
import { projectOperationMeasurement, summarizeMeasurements, validateExecutionObservation } from "../src/workkeel-measurements.mjs";

const usage = (input = 10, output = 4) => ({ input_tokens: input, output_tokens: output, cost_usd: null });
const result = { status: "completed", conversation_id: "thread", output: "private output", outcome: "done", observed_model: null, runtime_model: "confirmed", usage: usage() };
const record = extra => ({ id: "work-0-0", node: "work", visit: 0, attempt: 0, requested_model: "selected", result,
  measurement: { adapter_elapsed_ms: 20, observation: { runtime_model: "confirmed", observed_model: null, usage: usage(2, 1) } }, ...extra });

test("final operation data supersedes cumulative progress and excludes private content", () => {
  const op = projectOperationMeasurement(record());
  assert.deepEqual(op.usage, usage());
  assert.equal(op.requested_model, "selected"); assert.equal(op.runtime_model, "confirmed"); assert.equal(op.observed_model, null);
  assert.equal(JSON.stringify(op).includes("private output"), false);
  const summary = summarizeMeasurements([op]);
  assert.equal(summary.usage.input_tokens.total, 10); assert.equal(summary.usage.cost_usd.total, null);
  assert.equal(summary.timing.adapter_work_ms, 20);
});

test("partial interrupted observations are known subtotals, never final totals", () => {
  const op = projectOperationMeasurement(record({ result: null }));
  const summary = summarizeMeasurements([op]);
  assert.equal(summary.usage.input_tokens.known_subtotal, 2);
  assert.equal(summary.usage.input_tokens.total, null); assert.equal(summary.usage.input_tokens.complete, false);
});

test('completed native binding remains a subtotal when other task work is unobserved',()=>{
  const op={...projectOperationMeasurement(record()),coverage_complete:false};
  const summary=summarizeMeasurements([op]);
  assert.equal(summary.usage.input_tokens.known_subtotal,10);
  assert.equal(summary.usage.input_tokens.total,null);
  assert.equal(summary.usage.input_tokens.complete,false);
  assert.equal(summary.timing.known_adapter_work_ms,20);
  assert.equal(summary.timing.adapter_work_ms,null);
});

test("unknown final result is not filled with stale progress and old timing is unknown", () => {
  const op = projectOperationMeasurement(record({ result: { ...result, usage: usage(null, null) }, measurement: undefined }));
  assert.equal(op.adapter_elapsed_ms, null);
  assert.equal(summarizeMeasurements([op]).timing.adapter_work_ms, null);
  const missing = projectOperationMeasurement(record({ result: { ...result, usage: usage(null, null) } }));
  assert.equal(missing.usage.input_tokens, null);
  const finalUnknown = projectOperationMeasurement(record({ result: { ...result, runtime_model: null, observed_model: null } }));
  assert.equal(finalUnknown.runtime_model, null);
  assert.equal(finalUnknown.observed_model, null);
});

test("parallel attempt work sums but is not wall time; partial coverage and unobserved native work stay explicit", () => {
  const ops = [projectOperationMeasurement(record()), projectOperationMeasurement(record({ result: { ...result, usage: usage(null, 3) } }))];
  const totals = summarizeMeasurements(ops);
  assert.equal(totals.timing.adapter_work_ms, 40);
  assert.equal(totals.usage.input_tokens.total, null); assert.equal(totals.usage.input_tokens.known_subtotal, 10);
  assert.equal(totals.usage.output_tokens.total, 7);
  assert.equal(summarizeMeasurements([], { observed: false }).usage.input_tokens.total, null);
  assert.equal(summarizeMeasurements([], { observed: false }).timing.adapter_work_ms, null);
  assert.equal(summarizeMeasurements([]).usage.input_tokens.total, 0);
});

test("unsafe numbers and extra content are rejected; sum overflow cannot become exact tokens", () => {
  const observed = { runtime_model: "fixed", observed_model: null, usage: usage() };
  for (const invalid of [{ ...observed, prompt: "secret" }, { ...observed, usage: usage(-1) }, { ...observed, usage: usage(1.2) }]) assert.throws(() => validateExecutionObservation(invalid));
  const op = projectOperationMeasurement(record({ result: { ...result, usage: usage(Number.MAX_SAFE_INTEGER) } }));
  assert.equal(summarizeMeasurements([op, op]).usage.input_tokens.total, null);
  assert.equal(summarizeMeasurements([op, op]).usage.input_tokens.complete, false);
});
