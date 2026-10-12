import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { sha256, durableAtomicWrite, formatJson } from "./files.mjs";
import { OperationError } from "./operation-errors.mjs";
import { isWorkItemId } from "./ids.mjs";
import { completionDoctorPassed } from "./completion-diagnostics.mjs";
import { writePortableFinishDiagnostics, portableFinishAttention } from "./portable-finish-diagnostics.mjs";

function validOperation(value) {
  if (typeof value !== "string") return false;
  const parts = value.split("/");
  return parts.length === 2 && isWorkItemId(parts[0]) && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(parts[1]);
}

// Per-checkout recovery data, never lifecycle authority or distributed locking.
export async function leanDeliveryStateDirectory(target, required = false) {
  const git = spawnSync("git", ["-C", target, "rev-parse", "--absolute-git-dir"], { encoding: "utf8" });
  if (git.status !== 0) {
    if (required) throw new Error("Lean delivery requires a Git repository");
    return null;
  }
  const root = await fs.realpath(target);
  let directory = await fs.realpath(git.stdout.trim());
  for (const part of ["temple", "lean-delivery", sha256(root).slice(0, 20)]) {
    directory = path.join(directory, part);
    const stat = await fs.lstat(directory).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error("Unsafe Lean delivery state directory");
  }
  return directory;
}

export async function readPendingLeanDelivery(target) {
  const directory = await leanDeliveryStateDirectory(target);
  if (!directory) return null;
  const pendingPath = path.join(directory, "pending.json");
  try {
    const stat = await fs.lstat(pendingPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe Lean delivery journal");
    return { directory, journal: JSON.parse(await fs.readFile(pendingPath, "utf8")) };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function assertNoPendingLeanDelivery(target, allowedOperation = null) {
  const pending = await readPendingLeanDelivery(target);
  if (!pending) return;
  if (allowedOperation && pending.journal.operation_key === allowedOperation) return;
  throw new OperationError("PENDING_RECOVERY", `Lean delivery recovery is pending (${pending.journal.operation_key ?? "invalid journal"}); retry the identical work-item ${pending.journal.request?.position ? "finish" : "deliver"} request before other mutations`, "pending_recovery");
}

export function validateLeanRecoveryArtifact(recovery, original) {
  const preview = { ...recovery?.preview }; delete preview.fingerprint;
  const diagnostic = recovery?.diagnostics, doctor = diagnostic?.doctor;
  const expected = `.ai-org/artifacts/${original.journal.request.work_item_id}/finish-recovery-${original.journal.request.operation_id}.json`;
  if (recovery?.schema_version !== "temple.lean-finish-recovery/v1" || recovery.original_status !== "failed" || original.status !== "failed" ||
      typeof recovery.recorded_at !== "string" || !Number.isFinite(Date.parse(recovery.recorded_at)) ||
      recovery.acceptance_granted !== false || recovery.authority_granted !== false ||
      preview.schema_version !== "temple.lean-finish-recovery-preview/v1" || preview.authority_granted !== false ||
      preview.acceptance_granted !== false || preview.mutation_performed !== false ||
      preview.operation_key !== original.operation_key || preview.candidate_revision !== original.journal.request.candidate_revision ||
      preview.agent_id !== original.journal.request.agent_id || preview.principal_id !== original.journal.request.principal_id ||
      preview.recovery_ref !== expected || sha256(formatJson(preview)) !== recovery.preview.fingerprint ||
      sha256(formatJson(original)) !== preview.original_record_sha256 ||
      sha256(formatJson(original.diagnostics)) !== recovery.original_diagnostics_sha256 ||
      diagnostic?.status !== "passed" || !Array.isArray(diagnostic.errors) || diagnostic.errors.length ||
      doctor?.healthy !== true || !Number.isInteger(doctor.summary?.pass) || doctor.summary.pass < 1 ||
      doctor.summary.fail !== 0 || doctor.summary.warn !== 0 || !Array.isArray(doctor.checks) || doctor.checks.length) {
    throw new Error("Invalid Lean recovery artifact diagnostics or original binding");
  }
}

export async function readLeanFinishDiagnostics(target) {
  const directory = await leanDeliveryStateDirectory(target);
  if (!directory) return [];
  const root = await fs.realpath(target);
  const names = await fs.readdir(directory).catch(error => { if (error.code === "ENOENT") return []; throw error; });
  const records = [];
  for (const name of names.filter(name => name.startsWith("finish-") && name.endsWith(".json")).sort()) {
    const filename = path.join(directory, name);
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe Lean finish diagnostic record");
    const record = JSON.parse(await fs.readFile(filename, "utf8"));
    if (record.schema_version !== "temple.lean-finish-diagnostics/v1" || !["pending", "failed", "passed"].includes(record.status) ||
      !validOperation(record.operation_key) ||
      name !== `finish-${record.operation_key.replace("/", "-")}.json` || !record.journal || record.journal.operation_key !== record.operation_key) throw new Error("Invalid Lean finish diagnostic record");
    if (record.journal.target !== root || record.journal.request_digest !== sha256(formatJson(record.journal.request)) ||
      `${record.journal.request?.work_item_id}/${record.journal.request?.operation_id}` !== record.operation_key ||
      (record.status === "passed" && (record.diagnostics?.status !== "passed" || record.diagnostics.status_rebuild?.status !== "passed" || record.diagnostics.status_rebuild.result?.projection_scope !== "full" ||
        record.diagnostics.doctor?.schema_version !== "temple.doctor-summary/v1" || record.diagnostics.doctor.validation_scope !== "full" || record.diagnostics.doctor.healthy !== true ||
        !completionDoctorPassed(record.diagnostics.doctor) ||
        !Array.isArray(record.diagnostics.errors) || record.diagnostics.errors.length))) throw new Error("Invalid Lean finish diagnostic outcome or binding");
    if (record.recovery) {
      const expected = `.ai-org/artifacts/${record.journal.request.work_item_id}/finish-recovery-${record.journal.request.operation_id}.json`;
      if (record.status !== "passed" || record.recovery.ref !== expected) throw new Error("Invalid Lean recovery binding");
      let current = root;
      const parts = expected.split("/");
      for (const [index, part] of parts.entries()) {
        current = path.join(current, part);
        const stat = await fs.lstat(current);
        if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) throw new Error("Unsafe Lean recovery artifact");
      }
      const body = await fs.readFile(current);
      if (sha256(body) !== record.recovery.sha256) throw new Error("Lean recovery artifact digest mismatch");
      const recovery = JSON.parse(body);
      const original = { ...record, status: record.recovery.original_status, diagnostics: record.recovery.original_diagnostics }; delete original.recovery;
      validateLeanRecoveryArtifact(recovery, original);
    }
    records.push(record);
  }
  return records;
}

export async function writeLeanFinishDiagnostics(target, record) {
  if (!validOperation(record.operation_key)) throw new Error("Invalid Lean finish diagnostic operation");
  const directory = await leanDeliveryStateDirectory(target, true);
  await fs.mkdir(directory, { recursive: true });
  const filename = path.join(directory, `finish-${record.operation_key.replace("/", "-")}.json`);
  const existing = await fs.lstat(filename).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error("Unsafe Lean finish diagnostic record");
  await writePortableFinishDiagnostics(target, record);
  await durableAtomicWrite(filename, formatJson(record));
}

export async function leanFinishAttention(target, settlingOperation = null) {
  try {
    const records = await readLeanFinishDiagnostics(target);
    return [...records
      .filter(record => record.status !== "passed" && record.operation_key !== settlingOperation)
      .map(record => ({ type: "lean_finish_diagnostics", work_item_id: record.operation_key.split("/")[0], operation_id: record.operation_key.split("/")[1], status: record.status, source: "local-journal", local_journal_available: true, message: `${record.operation_key}: Lean completion diagnostics ${record.status}; lifecycle facts remain applied`, next_action: "Recover only the identical finish request in this checkout before further lifecycle work." })),
      ...await portableFinishAttention(target, records, settlingOperation)];
  } catch (error) {
    return [{ type: "lean_finish_diagnostics", status: "invalid", message: `Lean completion diagnostics cannot be inspected: ${error.message}` }];
  }
}
