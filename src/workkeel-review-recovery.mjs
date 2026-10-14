import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { durableAtomicCreate, formatJson } from "./files.mjs";
import { withProjectMutationLock } from "./project.mjs";
import { readTaskFile } from "./task-contract.mjs";
import { safeDirectory, existsEntry } from "./workkeel-project.mjs";
import { exactKeys, executionDigest } from "./workkeel-execution-policy.mjs";
import { assertReviewRecoveryContext, readNativeTask } from "./workkeel-tasks.mjs";
import { inspectHostBinding, openTaskHostBindings } from "./workkeel-host-usage.mjs";
import { readDispatchTicket } from "./workkeel-dispatch.mjs";
import { assertTrustedRoleHost, runRolePreflight } from "./workkeel-role-preflight.mjs";

// An interrupted independent review may be retried on the same task and exact
// delivered candidate. Each attempt is an immutable, review-only record; none
// revives the implementation claim, authors a verdict or accepts the task.
const ROOT = ".ai-org/review-recovery";
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const SHA = /^[a-f0-9]{64}$/;
const REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
export const MAX_REVIEW_RECOVERY_ATTEMPTS = 3;
const STOPPED_BINDING = new Set(["interrupted", "stopped", "cancelled", "error"]);
const UNKNOWN_USAGE = Object.freeze({ input_tokens: null, output_tokens: null });
const fail = message => { throw new Error(`Review recovery: ${message}`); };
const sameActor = (a, b) => a?.agent_id === b?.agent_id && a?.principal_id === b?.principal_id;
const unexpired = expires => expires === null || Date.parse(expires) > Date.now();
const attemptName = n => `attempt-${String(n).padStart(3, "0")}.json`;
const resultName = n => `attempt-${String(n).padStart(3, "0")}-result.json`;
const chainRef = item => `${ROOT}/${item.id}/${item.delivery.claim_id}`;
function strict(value, required, optional = []) {
  try { exactKeys(value, required, optional); } catch { fail("missing or unknown fields"); }
}
function id(value, name) { if (typeof value !== "string" || !ID.test(value)) fail(`invalid ${name}`); }
function actor(value, name) { strict(value, ["agent_id", "principal_id"]); id(value.agent_id, name); id(value.principal_id, name); }

function validateRequest(request) {
  strict(request, ["schema_version", "operation_id", "task_id", "expected_version", "expected_chain_sha256", "revision",
    "actor", "reviewer", "predecessor", "policy_ref", "model", "source"]);
  if (request.schema_version !== "workkeel.review-recovery-request/v1") fail("unsupported request schema");
  id(request.operation_id, "operation ID"); id(request.task_id, "task ID");
  if (!Number.isSafeInteger(request.expected_version) || request.expected_version < 1) fail("expected task version is required");
  if (request.expected_chain_sha256 !== null && !SHA.test(request.expected_chain_sha256 ?? "")) fail("expected chain digest must be null or a SHA-256");
  if (!REVISION.test(request.revision ?? "")) fail("a full candidate revision is required");
  actor(request.actor, "approving actor"); actor(request.reviewer, "reviewer");
  strict(request.predecessor, ["kind", "id", "sha256"]);
  if (!["host-binding", "review-attempt"].includes(request.predecessor.kind)) fail("unknown predecessor kind");
  id(request.predecessor.id, "predecessor ID");
  if (!SHA.test(request.predecessor.sha256 ?? "")) fail("predecessor digest is required");
  if (typeof request.policy_ref !== "string" || !request.policy_ref || request.policy_ref.length > 1024) fail("invalid policy reference");
  strict(request.model, ["provider", "model", "reasoning"]);
  for (const key of ["provider", "model"]) if (typeof request.model[key] !== "string" || !request.model[key]) fail("explicit model is required");
  if (request.model.reasoning !== null && typeof request.model.reasoning !== "string") fail("invalid reasoning");
  strict(request.source, ["thread_id", "turn_id"]); id(request.source.thread_id, "source thread"); id(request.source.turn_id, "source turn");
}

async function readEnvelope(target, ref) {
  const file = await readTaskFile(target, ref);
  let envelope;
  try { envelope = JSON.parse(file.content); } catch { fail("record is not JSON"); }
  strict(envelope, ["value", "sha256"]);
  if (executionDigest(envelope.value) !== envelope.sha256) fail("record integrity failure");
  return { value: envelope.value, sha256: file.digest };
}

/** Validated chain for the current delivery; empty when none was recorded. Read-only. */
export async function readReviewRecoveryChain(target, item) {
  if (!item.delivery || !await existsEntry(target, `${ROOT}/${item.id}/${item.delivery.claim_id}`)) return { attempts: [], head: null, sha256: null };
  const ref = chainRef(item), dir = await safeDirectory(target, ref);
  const names = (await fs.readdir(dir)).filter(name => !/^\.temple-durable-[A-Za-z0-9-]+$/.test(name));
  const attempts = [];
  for (let n = 1; names.includes(attemptName(n)); n++) {
    if (n > MAX_REVIEW_RECOVERY_ATTEMPTS) fail("chain exceeds the attempt bound");
    const attempt = await readEnvelope(target, `${ref}/${attemptName(n)}`), value = attempt.value, previous = attempts.at(-1) ?? null;
    if (value?.schema_version !== "workkeel.review-attempt/v1" || value.sequence !== n || value.task_id !== item.id ||
        value.delivery_claim_id !== item.delivery.claim_id || value.revision !== item.delivery.revision ||
        value.contract_sha256 !== item.contract_sha256 || value.previous_attempt_sha256 !== (previous?.sha256 ?? null)) fail("attempt does not belong to this delivery chain");
    const p = value.predecessor;
    if (previous ? p?.kind !== "review-attempt" || p.id !== previous.value.attempt_id || p.sha256 !== previous.sha256 ||
        p.result_sha256 !== (previous.result?.sha256 ?? null) : p?.kind !== "host-binding" || !ID.test(p.id ?? "") ||
        (await readTaskFile(target, `.ai-org/host-usage/${p.id}/binding.json`)).digest !== p.sha256) fail("predecessor evidence changed after recovery");
    let result = null;
    if (names.includes(resultName(n))) {
      result = await readEnvelope(target, `${ref}/${resultName(n)}`);
      if (result.value?.schema_version !== "workkeel.review-attempt-result/v1" || result.value.attempt_id !== value.attempt_id ||
          result.value.attempt_sha256 !== attempt.sha256) fail("attempt result does not match its attempt");
    }
    attempts.push({ ...attempt, result });
  }
  if (names.length !== attempts.length + attempts.filter(a => a.result).length) fail("unexpected file in recovery chain");
  const sha256 = attempts.length ? executionDigest(attempts.map(a => [a.sha256, a.result?.sha256 ?? null])) : null;
  return { attempts, head: attempts.at(-1) ?? null, sha256 };
}

/** Observation for composing the next explicit request. Grants nothing. */
export async function readReviewRecovery(targetInput, taskId) {
  id(taskId, "task ID");
  const target = await fs.realpath(targetInput), item = await readNativeTask(target, taskId), chain = await readReviewRecoveryChain(target, item);
  return { schema_version: "workkeel.review-recovery/v1", authority: "observation-only", mutation_status: "no-write", execution_authorized: false,
    task_id: item.id, task_version: item.version, state: item.state, candidate_revision: item.delivery?.revision ?? null, chain_sha256: chain.sha256,
    attempts: chain.attempts.map(a => ({ attempt_id: a.value.attempt_id, sequence: a.value.sequence, sha256: a.sha256, reviewer: a.value.reviewer,
      source: a.value.source, status: a.result?.value.status ?? "unrecorded", usage: a.result?.value.usage ?? UNKNOWN_USAGE,
      duration_ms: a.result?.value.duration_ms ?? null })), acceptance: "not-performed" };
}

async function prepare(target, request, host, { preflight }) {
  const item = await assertReviewRecoveryContext(target, request.task_id, { approver: request.actor, reviewer: request.reviewer,
    revision: request.revision, expected_version: request.expected_version });
  if (sameActor(request.reviewer, request.actor)) fail("the approving actor cannot also be the reviewer");
  if (!unexpired(item.contract.authorization.expires_at)) fail("task authorization expired; obtain fresh authority");
  const chain = await readReviewRecoveryChain(target, item);
  if (chain.sha256 !== request.expected_chain_sha256) fail("stale recovery chain; inspect the current chain before retrying");
  if (chain.attempts.length >= MAX_REVIEW_RECOVERY_ATTEMPTS) fail("attempt bound reached; preserve the evidence and obtain a new decision");
  let predecessor, sources;
  if (!chain.head) {
    if (request.predecessor.kind !== "host-binding") fail("the first retry must name the interrupted review binding");
    const { binding, file_sha256 } = await inspectHostBinding(target, request.predecessor.id);
    if (file_sha256 !== request.predecessor.sha256) fail("predecessor binding differs from the request");
    if (binding.task_id !== item.id || binding.claim_id !== item.delivery.claim_id || binding.contract_sha256 !== item.contract_sha256 ||
        binding.dispatch?.activity_kind !== "review") fail("predecessor is not the dispatched review of this delivery");
    if (!binding.collection_closed || !STOPPED_BINDING.has(binding.status)) fail("predecessor collection is active or completed; it must be closed as stopped");
    predecessor = { kind: "host-binding", id: binding.binding_id, sha256: file_sha256, result_sha256: null, status: binding.status,
      usage: structuredClone(binding.usage), source: { thread_id: binding.source.thread_id, turn_id: binding.source.turn_id },
      dispatch_execution_id: binding.dispatch.execution_id };
    sources = [predecessor.source];
  } else {
    const head = chain.head;
    if (request.predecessor.kind !== "review-attempt" || request.predecessor.id !== head.value.attempt_id || request.predecessor.sha256 !== head.sha256) fail("predecessor must be the current chain head");
    if (head.result?.value.status === "completed") fail("the latest attempt completed; its reviewer authors the ordinary review");
    predecessor = { kind: "review-attempt", id: head.value.attempt_id, sha256: head.sha256, result_sha256: head.result?.sha256 ?? null,
      status: head.result?.value.status ?? "unrecorded", usage: structuredClone(head.result?.value.usage ?? UNKNOWN_USAGE),
      source: structuredClone(head.value.source), dispatch_execution_id: head.value.dispatch_execution_id };
    sources = [chain.attempts[0].value.predecessor.source, ...chain.attempts.map(a => a.value.source)];
  }
  if (sources.some(source => source.thread_id === request.source.thread_id || source.turn_id === request.source.turn_id)) fail("a fresh source thread and turn are required");
  if ((await openTaskHostBindings(target, item.id)).length) fail("another usage collection for this task is still open");
  const ticket = await readDispatchTicket(target, predecessor.dispatch_execution_id);
  if (ticket.task_id !== item.id || ticket.claim_id !== item.delivery.claim_id || ticket.node.activity_kind !== "review") fail("predecessor ticket is not this delivery's review");
  if (ticket.policy_ref !== request.policy_ref) fail("policy reference differs from the approved review dispatch");
  const selected = { provider: ticket.selected.provider, model: ticket.selected.model, reasoning: ticket.selected.reasoning };
  if (executionDigest(selected) !== executionDigest(request.model)) fail("model differs from the approved review selection; fallback is not permitted");
  if (!ticket.selected.data_classes.includes(item.contract.environment.data.classification) ||
      item.contract.environment.data.model_access !== "approved-connection") fail("model data scope is not approved");
  const receipt = preflight ? await runRolePreflight({ host, context: { approved_tools: item.contract.environment.tools },
    role: { schema_version: "workkeel.role-contract/v1", role: "review", product_access: "read", tests: "role", edit_tools: [],
      model: { provider: selected.provider, model: selected.model, effort: selected.reasoning }, usage: { fields: ["input_tokens", "output_tokens"] } } }) : null;
  return { item, chain, predecessor, ticket, selected, receipt };
}

function response(attempt, result, { replayed, chainSha256 }) {
  const status = result?.value.status ?? "in-progress";
  return { schema_version: "workkeel.review-recovery-result/v1", replayed, mutation_status: replayed ? "already-applied" : "applied",
    task_id: attempt.value.task_id, candidate_revision: attempt.value.revision, attempt_id: attempt.value.attempt_id,
    sequence: attempt.value.sequence, attempt_sha256: attempt.sha256, chain_sha256: chainSha256, reviewer: attempt.value.reviewer,
    status, usage: result?.value.usage ?? UNKNOWN_USAGE, duration_ms: result?.value.duration_ms ?? null,
    acceptance: "not-performed", execution_authorized: false, implementation_authority: false,
    next_action: status === "completed" ? "The named reviewer records the ordinary review with review_attempt_id; this result is not a verdict." :
      "Preserve this attempt. A further retry needs a new explicit request naming this attempt as predecessor." };
}
async function replay(target, request, requestSha) {
  const item = await readNativeTask(target, request.task_id), chain = await readReviewRecoveryChain(target, item);
  const prior = chain.attempts.find(a => a.value.operation_id === request.operation_id);
  if (!prior) return null;
  if (prior.value.request_sha256 !== requestSha) fail("operation ID was already used with different input");
  return response(prior, prior.result, { replayed: true, chainSha256: chain.sha256 });
}
function launchResult(raw, failed, selected) {
  const interrupted = error => ({ status: "interrupted", error, usage: { ...UNKNOWN_USAGE }, runtime_model: null, reasoning: null, output: null });
  if (failed) return interrupted("launch-unconfirmed");
  try {
    strict(raw, ["status", "usage", "runtime_model", "reasoning", "output"]); strict(raw.usage, ["input_tokens", "output_tokens"]);
    if (!["completed", "failed", "interrupted"].includes(raw.status) || typeof raw.output !== "string" || Buffer.byteLength(raw.output) > 65536 ||
        Object.values(raw.usage).some(v => v !== null && (!Number.isSafeInteger(v) || v < 0)) ||
        [raw.runtime_model, raw.reasoning].some(v => v !== null && (typeof v !== "string" || v.length > 200))) fail("invalid host result");
  } catch { return interrupted("invalid-host-result"); }
  const mismatch = raw.runtime_model !== selected.model || raw.reasoning !== selected.reasoning;
  return { status: raw.status === "completed" && mismatch ? "failed" : raw.status, error: mismatch ? "model-mismatch" : null,
    usage: { ...raw.usage }, runtime_model: raw.runtime_model, reasoning: raw.reasoning, output: raw.output };
}
async function confirmStopped(host, item, predecessor) {
  let observed;
  try { observed = await host.runtimeState(Object.freeze({ task_id: item.id, predecessor: Object.freeze({ kind: predecessor.kind, id: predecessor.id, source: Object.freeze({ ...predecessor.source }) }) })); }
  catch { fail("predecessor runtime state is unknown"); }
  if (!observed || typeof observed !== "object" || Object.keys(observed).join() !== "state" || observed.state !== "stopped") fail(`predecessor runtime is ${observed?.state === "active" ? "active" : "unknown"}; it must be confirmed stopped`);
}
async function writeResult(target, item, attempt, value) {
  const result = { schema_version: "workkeel.review-attempt-result/v1", attempt_id: attempt.value.attempt_id, attempt_sha256: attempt.sha256,
    ...value, recorded_at: new Date().toISOString(), acceptance: "not-performed" };
  const dir = await safeDirectory(target, chainRef(item));
  await durableAtomicCreate(path.join(dir, resultName(attempt.value.sequence)), formatJson({ value: result, sha256: executionDigest(result) }));
  return readReviewRecoveryChain(target, item);
}

/**
 * Explicit, approved retry of an interrupted independent review. Trusted host
 * code must prove the predecessor stopped and enforce read-only product access.
 * Host probes are awaited outside the project lock; everything they could have
 * outlived is rechecked under the lock, which is held through launch invocation
 * but never while the model runs.
 */
export async function recoverInterruptedReview(targetInput, request, { host } = {}) {
  validateRequest(request);
  assertTrustedRoleHost(host, ["runtimeState", "launch"]);
  const target = await fs.realpath(targetInput), requestSha = executionDigest(request);
  const prior = await replay(target, request, requestSha);
  if (prior) return prior;
  const probed = await prepare(target, request, host, { preflight: true }), receipt = probed.receipt;
  await confirmStopped(host, probed.item, probed.predecessor);
  const reserved = await withProjectMutationLock(target, async () => {
    const again = await replay(target, request, requestSha);
    if (again) return { replayed: again };
    // Revalidate after the awaited probes: expiry, cancellation, pin or evidence
    // drift and a concurrent retry each win over this request.
    const { item, chain, predecessor, selected } = await prepare(target, request, host, { preflight: false });
    if (executionDigest(item) !== executionDigest(probed.item) || predecessor.id !== probed.predecessor.id ||
        predecessor.sha256 !== probed.predecessor.sha256) fail("task or predecessor changed during host probes");
    const sequence = chain.attempts.length + 1;
    const value = { schema_version: "workkeel.review-attempt/v1", attempt_id: `review-attempt-${randomUUID()}`, sequence,
      operation_id: request.operation_id, request_sha256: requestSha, task_id: item.id, task_version: item.version,
      task_record_sha256: executionDigest(item), contract_sha256: item.contract_sha256, policy_sha256: item.policy_sha256,
      delivery_claim_id: item.delivery.claim_id, revision: item.delivery.revision, delivery_evidence: structuredClone(item.delivery.evidence),
      implementer: structuredClone(item.delivery.implementer), approved_by: structuredClone(request.actor), reviewer: structuredClone(request.reviewer),
      approval_ref: item.contract.authorization.approval_ref, authorization_expires_at: item.contract.authorization.expires_at,
      predecessor, predecessor_runtime: "confirmed-stopped", previous_attempt_sha256: chain.head?.sha256 ?? null,
      dispatch_execution_id: predecessor.dispatch_execution_id, policy_ref: request.policy_ref, selected,
      source: structuredClone(request.source), preflight: { host_id: receipt.host_id, probed_host: receipt.probed_host,
        probe_sha256: receipt.probe_sha256, checked_at: receipt.checked_at, product_access: "read", tests: "role" },
      created_at: new Date().toISOString(), authority: "review-only", implementation_authority: false, acceptance: "not-performed" };
    const root = await safeDirectory(target, ROOT, { create: true });
    if (!await existsEntry(target, `${ROOT}/.gitignore`)) await durableAtomicCreate(path.join(root, ".gitignore"), "*\n");
    if ((await readTaskFile(target, `${ROOT}/.gitignore`)).content !== "*\n") fail("store ignore policy changed");
    const dir = await safeDirectory(target, chainRef(item), { create: true });
    // Exclusive creation: a racing writer of the same sequence cannot replace it.
    await durableAtomicCreate(path.join(dir, attemptName(sequence)), formatJson({ value, sha256: executionDigest(value) }));
    const created = (await readReviewRecoveryChain(target, item)).head;
    if (created?.value.attempt_id !== value.attempt_id) fail("attempt reservation was not retained");
    // Final launch boundary, the last await before invocation. Task mutations
    // need this lock, but pinned files and the clock can still move; an
    // unlaunched attempt records that it was not launched.
    let blocked = null;
    try {
      await assertReviewRecoveryContext(target, item.id, { approver: request.actor, reviewer: request.reviewer,
        revision: request.revision, expected_version: item.version });
    } catch (error) { blocked = { error: "authority-changed-before-launch", message: `task authority, candidate or evidence changed before launch (${error.message})` }; }
    if (!blocked && !unexpired(item.contract.authorization.expires_at)) blocked = { error: "authorization-expired-before-launch", message: "task authorization expired before launch" };
    if (blocked) {
      await writeResult(target, item, created, { status: "not-launched", error: blocked.error,
        usage: { input_tokens: 0, output_tokens: 0 }, runtime_model: null, reasoning: null, output: null, duration_ms: 0, duration_basis: "not launched" });
      fail(`${blocked.message}; the reserved attempt was not launched`);
    }
    const spec = Object.freeze({ task_id: item.id, revision: created.value.revision, attempt_id: created.value.attempt_id,
      reviewer: Object.freeze({ ...created.value.reviewer }), model: Object.freeze({ ...selected }), source: Object.freeze({ ...created.value.source }),
      product_access: "read", tests: "role", contract: structuredClone(item.contract), evidence: structuredClone(created.value.delivery_evidence) });
    // Invoked, not awaited: the lock is released before the model runs.
    const started = performance.now();
    const launching = (async () => host.launch(spec))().then(raw => ({ raw, failed: false }), () => ({ raw: undefined, failed: true }));
    return { attempt: created, item, selected, launching, started };
  });
  if (reserved.replayed) return reserved.replayed;
  const { attempt, item, selected, launching, started } = reserved;
  const { raw, failed } = await launching;
  const duration_ms = Math.max(0, Math.round(performance.now() - started));
  const outcome = launchResult(raw, failed, selected);
  return withProjectMutationLock(target, async () => {
    const current = await readNativeTask(target, item.id), chain = await readReviewRecoveryChain(target, current);
    // Only the current attempt of the unchanged, still-unreviewed delivery may
    // record its own result, exactly once; cancellation or supersession wins.
    if (chain.head?.sha256 !== attempt.sha256 || chain.head.result) fail("attempt is no longer current; the late result was not recorded");
    if (current.state !== "test" || current.review || current.version !== attempt.value.task_version ||
        executionDigest(current) !== attempt.value.task_record_sha256) fail("task changed during the attempt; the late result was not recorded");
    const after = await writeResult(target, current, attempt, { ...outcome, duration_ms,
      duration_basis: "monotonic launch interval measured by the recovery API" });
    return response(after.head, after.head.result, { replayed: false, chainSha256: after.sha256 });
  });
}
