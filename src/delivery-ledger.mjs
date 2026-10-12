import fs from "node:fs/promises";
import path from "node:path";
import { atomicWrite, formatJson, sha256 } from "./files.mjs";
import { isWorkItemId } from "./ids.mjs";
import { validateMeasurementPlan } from "./verification.mjs";

export const digest = value => sha256(JSON.stringify(value));
export const ensure = (ok, message) => { if (!ok) throw new Error(message); };
export const textValue = v => typeof v === "string" && v.trim().length > 0;
export const integer = v => Number.isSafeInteger(v) && v >= 0;
export const recordPath = id => { ensure(isWorkItemId(id), "Invalid Work Item ID"); return `.ai-org/artifacts/${id}/daily-delivery.json`; };
export function relativePath(p) {
  return textValue(p) && !path.isAbsolute(p) && !/[\\\0]/.test(p) && !p.split("/").some(s => ["", ".", ".."].includes(s));
}
export async function safeFile(root, relative, create = false) {
  ensure(relativePath(relative), "Expected a repository-relative file");
  let current = await fs.realpath(root);
  const parts = relative.split("/");
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const stat = await fs.lstat(current).catch(e => { if (e.code === "ENOENT") return null; throw e; });
    ensure(!stat?.isSymbolicLink(), "Delivery paths must not contain symlinks");
    if (i < parts.length - 1) {
      if (!stat && create) await fs.mkdir(current);
      else if (!stat) throw Object.assign(new Error("Delivery parent directory unavailable"), { code: "ENOENT" });
      else ensure(stat.isDirectory(), "Delivery parent is not a directory");
    } else if (stat) ensure(stat.isFile(), "Delivery path is not a regular file");
  }
  return current;
}
export async function readSource(root, relative) {
  const file = await safeFile(root, relative), stat = await fs.stat(file);
  ensure(stat.size <= 8 * 1024 * 1024, "Delivery source too large");
  const body = await fs.readFile(file, "utf8");
  return { path: relative, sha256: sha256(body), body };
}
export async function readSession(root, id) {
  const source = await readSource(root, recordPath(id));
  const { checksum, ...session } = JSON.parse(source.body);
  ensure(checksum === digest(session) && session.schema_version === "temple.daily-delivery/v1" && session.work_item_id === id && Array.isArray(session.events), "Invalid delivery record; preserve and reconcile it");
  return session;
}
export async function saveSession(root, session) {
  ensure(session.events.length <= 2000, "Delivery event limit reached");
  const body = formatJson({ ...session, checksum: digest(session) });
  ensure(Buffer.byteLength(body) <= 2 * 1024 * 1024, "Delivery record limit reached");
  await atomicWrite(await safeFile(root, recordPath(session.work_item_id), true), body);
}
export function event(session, kind, detail = {}, now = Date.now()) {
  session.events.push({ sequence: session.events.length + 1, at_ms: now, kind, ...detail });
}
export function validatePlan(plan) {
  ensure(["temple.delivery-plan/v1", "temple.delivery-plan/v2"].includes(plan?.schema_version) && relativePath(plan.authorization_ref), "Plan requires explicit repository authorization_ref");
  if (plan.schema_version === "temple.delivery-plan/v2") {
    ensure(plan.execution_mode === "autonomous" && ["trusted-local", "confined-node"].includes(plan.check_policy), "Autonomous plan requires explicit execution mode and check policy");
  } else ensure(plan.execution_mode === undefined && plan.check_policy === undefined, "Legacy plan cannot select new execution policies");
  const b = plan.budget;
  ensure(b && integer(b.elapsed_limit_ms) && b.elapsed_limit_ms > 0 && integer(b.max_repairs) && b.max_repairs <= 10, "Invalid time/repair budget");
  for (const name of ["verification", "repair", "cleanup"]) ensure(integer(b[`${name}_reserve_ms`]) && b[`${name}_reserve_ms`] > 0, `Missing ${name} time reserve`);
  ensure(b.elapsed_limit_ms > b.verification_reserve_ms + b.repair_reserve_ms + b.cleanup_reserve_ms, "Total time must include downstream buffers");
  ensure(b.token_limit === null || integer(b.token_limit) && b.token_limit > 0, "Token limit must be explicit positive integer or null");
  ensure(integer(b.token_reserve) && (b.token_limit === null ? b.token_reserve === 0 : b.token_reserve > 0 && b.token_limit > b.token_reserve), "Invalid downstream token reserve");
  if (plan.measurement_plan !== undefined) {
    ensure(plan.schema_version === "temple.delivery-plan/v2", "Reusable measurements require a v2 delivery plan");
    validateMeasurementPlan(plan.measurement_plan);
    ensure(plan.check_policy === plan.measurement_plan.check_policy && plan.test_timeout_ms === plan.measurement_plan.timeout_ms, "Delivery and measurement policies/timeouts must agree");
    ensure(plan.tests === undefined, "Select measurement_plan or legacy tests, not both");
  } else ensure(Array.isArray(plan.tests) && plan.tests.length > 0 && plan.tests.length <= 100 && new Set(plan.tests).size === plan.tests.length && plan.tests.every(p => relativePath(p) && !p.startsWith("-") && p.endsWith(".test.mjs")), "Select explicit repository Node test files");
  ensure(integer(plan.test_timeout_ms) && plan.test_timeout_ms >= 100 && plan.test_timeout_ms <= 300000 && plan.test_timeout_ms < b.elapsed_limit_ms - b.cleanup_reserve_ms, "Invalid bounded test timeout");
  return plan;
}
export function usageSummary(session) {
  const calls = session.events.filter(e => e.kind === "usage");
  const known = calls.filter(e => e.receipt.usage !== null);
  const phases = {};
  let total = 0;
  for (const e of calls) {
    const r = e.receipt, p = phases[r.phase] ??= { calls: 0, known_tokens: 0, unknown_calls: 0, provider_elapsed_ms: 0, outcomes: {} };
    p.calls++; p.provider_elapsed_ms += r.elapsed_ms;
    const outcome = p.outcomes[r.outcome] ??= { calls: 0, known_tokens: 0, unknown_calls: 0 };
    outcome.calls++;
    if (!r.usage) p.unknown_calls++;
    else { const n = r.usage.input_tokens - r.usage.cached_input_tokens + r.usage.output_tokens; p.known_tokens += n; total += n; }
    if (!r.usage) outcome.unknown_calls++;
    else outcome.known_tokens += r.usage.input_tokens - r.usage.cached_input_tokens + r.usage.output_tokens;
  }
  return { observed_calls: calls.length, known_calls: known.length, unknown_calls: calls.length - known.length,
    known_operational_tokens: total, complete_task_coverage: session.coverage?.complete === true && calls.length > 0 && known.length === calls.length,
    total_operational_tokens: session.coverage?.complete === true && calls.length > 0 && known.length === calls.length ? total : null,
    coverage: session.coverage ?? { complete: false, reason: "Host/provider observations are unavailable or partial" }, phases };
}
export function admission(session, phase, now = Date.now()) {
  const b = session.plan.budget, elapsed = Math.max(0, now - session.opened_at_ms), remaining = b.elapsed_limit_ms - elapsed;
  const anotherRepair = session.repairs < b.max_repairs;
  const reserve = b.cleanup_reserve_ms + (phase === "repair" ? b.verification_reserve_ms : phase === "build" ? b.verification_reserve_ms + (anotherRepair ? b.repair_reserve_ms : 0) : anotherRepair ? b.repair_reserve_ms + b.verification_reserve_ms : 0);
  const reasons = [];
  if (remaining <= reserve) reasons.push("insufficient-downstream-time-reserve");
  if (session.repairs > b.max_repairs) reasons.push("repair-limit");
  const usage = usageSummary(session);
  if (b.token_limit !== null) {
    if (!usage.complete_task_coverage) reasons.push("task-token-coverage-unknown");
    else if (b.token_limit - usage.known_operational_tokens <= b.token_reserve) reasons.push("insufficient-downstream-token-reserve");
  }
  return { allowed: reasons.length === 0, reasons, remaining_ms: Math.max(0, remaining), downstream_reserve_ms: reserve,
    remaining_tokens: b.token_limit === null || !usage.complete_task_coverage ? null : b.token_limit - usage.known_operational_tokens,
    enforcement: "coordinator-admission-only; host model turns require host enforcement" };
}
export function validateReceipt(receipt, id) {
  ensure(receipt?.schema_version === "temple.delivery-usage/v1" && receipt.work_item_id === id && textValue(receipt.call_id) && receipt.call_id.length <= 200 && textValue(receipt.provider_id), "Invalid task-scoped usage receipt");
  ensure(["preparation", "coordination", "build", "check", "verification", "repair", "closeout"].includes(receipt.phase), "Invalid usage phase");
  ensure(["completed", "failed", "interrupted"].includes(receipt.outcome) && integer(receipt.elapsed_ms), "Invalid usage outcome/time");
  ensure(receipt.usage === null || ["input_tokens", "cached_input_tokens", "output_tokens"].every(k => integer(receipt.usage?.[k])) && receipt.usage.cached_input_tokens <= receipt.usage.input_tokens, "Invalid exact usage counters");
}
export function deliveryReport(session, item, now = Date.now()) {
  const end = session.completed_at_ms ?? now, pauses = [...session.events.filter(e => e.kind === "resumed").map(e => e.pause_ms)];
  if (session.pause) pauses.push(Math.max(0, end - session.pause.at_ms));
  const local = session.events.filter(e => ["checked", "finished", "reworked"].includes(e.kind)).reduce((n, e) => n + (e.elapsed_ms ?? 0), 0);
  const elapsed = Math.max(0, end - session.opened_at_ms), paused = pauses.reduce((a, b) => a + b, 0);
  return { schema_version: "temple.delivery-report/v1", work_item_id: item.id, lifecycle_state: item.state,
    session_completed: session.completed_at_ms !== null, lifecycle_is_authority: true,
    usage: usageSummary(session), time: { task_created_at: item.created_at, task_elapsed_ms: Math.max(0, end - Date.parse(item.created_at)), observed_since: new Date(session.opened_at_ms).toISOString(), elapsed_ms: elapsed,
      before_open_unmeasured_ms: Math.max(0, session.opened_at_ms - Date.parse(item.created_at)), explicit_pause_ms: paused,
      measured_local_operations_ms: local, other_elapsed_ms: Math.max(0, elapsed - paused - local), other_elapsed_classification: "model, coordination, idle or unrecorded waiting; not all active work" },
    repairs: session.repairs, pauses: session.events.filter(e => e.kind === "paused"),
    checks: session.events.filter(e => e.kind === "checked").map(e => ({ sequence: e.sequence, revision: e.revision, accepted: e.result.accepted, elapsed_ms: e.elapsed_ms,
      cache_status: ["hit", "miss"].includes(e.result.cache_status) ? e.result.cache_status : null,
      cache_reason: textValue(e.result.cache_reason) ? e.result.cache_reason.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 240) : null,
      execution_started: typeof e.result.execution_started === "boolean" ? e.result.execution_started : null,
      measurement_ref: relativePath(e.result.measurement_ref) && e.result.measurement_ref.length <= 512 ? e.result.measurement_ref : null })),
    capacity: admission(session, item.state === "build" ? "build" : "verification", end), pending: session.pending,
    model_calls_performed_by_report: 0, monetary_cost: null, observations_are_acceptance: false };
}
