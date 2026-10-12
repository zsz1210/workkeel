import fs from "node:fs/promises";
import path from "node:path";
import { durableAtomicWrite, formatJson, sha256 } from "./files.mjs";
import { isWorkItemId } from "./ids.mjs";

const OPERATION = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const revision = value => typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
const timestamp = value => typeof value === "string" && Number.isFinite(Date.parse(value));
const text = value => typeof value === "string" && value.trim().length > 0;
export function finishObservationPath(item, operation) {
  if (!isWorkItemId(item) || typeof operation !== "string" || !OPERATION.test(operation)) throw new Error("Invalid portable finish identity");
  return `.ai-org/artifacts/${item}/diagnostics-${operation}.json`;
}

async function regularPath(target, relative, directory = false) {
  let current = target;
  const parts = relative.split("/");
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    const stat = await fs.lstat(current).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (!stat) return null;
    if (stat.isSymbolicLink() || (index < parts.length - 1 || directory ? !stat.isDirectory() : !stat.isFile())) {
      throw new Error(`Unsafe portable finish path: ${relative}`);
    }
    if (!directory && index === parts.length - 1 && stat.size > 16 * 1024 * 1024) throw new Error("Portable finish input exceeds limit");
  }
  return current;
}

export async function writePortableFinishDiagnostics(target, record) {
  const request = record.journal.request;
  const relative = finishObservationPath(request.work_item_id, request.operation_id);
  const receiptWrite = record.journal.writes.at(-1);
  const expectedReceipt = `.ai-org/artifacts/${request.work_item_id}/finish-${request.operation_id}.json`;
  if (receiptWrite.path !== expectedReceipt) throw new Error("Portable finish receipt path mismatch");
  const receiptFile = await regularPath(target, expectedReceipt);
  if (!receiptFile || sha256(await fs.readFile(receiptFile)) !== receiptWrite.after_sha256) throw new Error("Portable finish receipt binding mismatch");
  // The receipt's directory already exists; never create through a caller's link.
  await regularPath(target, path.posix.dirname(relative), true);
  await regularPath(target, relative);
  const observation = {
    schema_version: "temple.finish-observation/v1", authority: "observation-only",
    work_item_id: request.work_item_id, operation_id: request.operation_id,
    candidate_revision: request.candidate_revision, request_digest: record.journal.request_digest,
    plan_digest: record.journal.result.plan_digest, receipt_sha256: receiptWrite.after_sha256,
    status: record.status, observed_at: new Date().toISOString(),
    errors: record.diagnostics?.errors ?? [],
    recovery_authority: "origin-checkout-journal-required"
  };
  await durableAtomicWrite(path.join(target, relative), formatJson(observation));
}

// Observations are not journals. Missing/invalid records cannot manufacture a
// successful replay; they provide a portable reason to consult the original owner.
export async function portableFinishAttention(target, localRecords, settlingOperation = null) {
  const root = await regularPath(target, ".ai-org/artifacts", true);
  if (!root) return [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  const attention = [];
  for (const entry of entries.filter(entry => isWorkItemId(entry.name))) {
    const relativeRoot = `.ai-org/artifacts/${entry.name}`;
    const directory = await regularPath(target, relativeRoot, true);
    if (!directory) continue;
    for (const name of await fs.readdir(directory)) {
      if (!name.startsWith("finish-") || !name.endsWith(".json")) continue;
      const receiptPath = `${relativeRoot}/${name}`;
      const receiptFile = await regularPath(target, receiptPath);
      const receiptBytes = await fs.readFile(receiptFile);
      const receipt = JSON.parse(receiptBytes);
      if (receipt.schema_version !== "temple.lean-finish-receipt/v1") continue;
      const request = receipt.request;
      const expected = finishObservationPath(entry.name, request?.operation_id);
      if (!["temple.lean-finish-request/v1", "temple.workflow-finish-request/v1"].includes(request.schema_version) ||
        !revision(request.candidate_revision) || !digest(receipt.request_digest) || !digest(receipt.result?.plan_digest) ||
        !timestamp(receipt.applied_at) || ![request.agent_id, request.principal_id, request.claim_id, request.position].every(text) ||
        ![request.completed, request.evidence, request.unresolved].every(values => Array.isArray(values) && values.every(text)) ||
        receipt.result?.work_item_id !== request.work_item_id || receipt.result?.operation_id !== request.operation_id ||
        receipt.result?.receipt !== receiptPath) throw new Error("Invalid portable finish receipt fields");
      // A recovered pre-observation receipt can acquire an observation. Do not
      // retroactively require one for untouched historical receipts.
      if (!receipt.diagnostics_observation && !await regularPath(target, expected)) continue;
      const key = `${entry.name}/${request.operation_id}`;
      if (key === settlingOperation) continue;
      if (request.work_item_id !== entry.name || name !== `finish-${request.operation_id}.json` || (receipt.diagnostics_observation && receipt.diagnostics_observation !== expected) ||
        receipt.request_digest !== sha256(formatJson(request)) || receipt.result?.candidate_revision !== request.candidate_revision) throw new Error("Invalid portable finish receipt");
      const filename = await regularPath(target, expected);
      const observed = filename ? JSON.parse(await fs.readFile(filename, "utf8")) : null;
      if (observed && (observed.schema_version !== "temple.finish-observation/v1" || observed.authority !== "observation-only" ||
        observed.work_item_id !== entry.name || observed.operation_id !== request.operation_id ||
        observed.candidate_revision !== request.candidate_revision || observed.request_digest !== receipt.request_digest ||
        observed.plan_digest !== receipt.result.plan_digest || observed.receipt_sha256 !== sha256(receiptBytes) ||
        observed.recovery_authority !== "origin-checkout-journal-required" ||
        !["pending", "failed", "passed"].includes(observed.status) || !Array.isArray(observed.errors) ||
        !observed.errors.every(error => typeof error === "string") || !timestamp(observed.observed_at) ||
        (observed.status === "passed" && observed.errors.length))) throw new Error("Invalid portable finish observation binding");
      const local = localRecords.find(record => record.operation_key === key);
      if (local && observed?.status === local.status) continue;
      if (!local && observed?.status === "passed") continue;
      attention.push({ type: "lean_finish_diagnostics", work_item_id: entry.name, operation_id: request.operation_id,
        status: local ? "conflicting" : observed?.status ?? "unknown", source: "portable-observation",
        local_journal_available: Boolean(local), observation_ref: expected,
        message: `${key}: completion diagnostics ${local ? "observations disagree" : observed?.status ?? "are unavailable"}; lifecycle is applied, recovery is not established`,
        next_action: "Inspect the committed receipt and observation. Ask the original completion owner to recover the identical request in its origin checkout and commit the resulting observation; a fresh clone has no replay authority. Do not delete or hand-edit diagnostic records." });
    }
  }
  return attention;
}
