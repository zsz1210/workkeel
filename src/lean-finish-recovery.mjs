import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { sha256, formatJson, durableAtomicCreate } from "./files.mjs";
import { readLeanFinishDiagnostics, readPendingLeanDelivery, writeLeanFinishDiagnostics, validateLeanRecoveryArtifact } from "./lean-delivery-state.mjs";
import { validateLeanCompletionReceipt, requireProductScope, assertWorkingProduct } from "./lean-delivery.mjs";
import { loadProjectContext } from "./project.mjs";
import { resolveProjectActor } from "./actor-resolution.mjs";
import { runDoctor, compactDoctor } from "./doctor.mjs";
import { buildStatus, compactStatus, writeStatus } from "./status.mjs";
import { inspectParallelPlan, buildParallelPlan, writeParallelPlan } from "./orchestration.mjs";

const digest = bytes => bytes === null ? null : sha256(bytes);
const EVENTS = ".ai-org/events/events.jsonl";
const COLLABORATION = ".ai-org/project/collaboration.json";

async function bytes(target, relative, optional = false) {
  if (typeof relative !== "string" || !relative || relative === "." || path.isAbsolute(relative) ||
      path.win32.isAbsolute(relative) || relative.includes("\\") || relative.includes("\0") ||
      relative.startsWith("../") || path.posix.normalize(relative) !== relative) throw new Error("Unsafe recovery path");
  let current = target;
  for (const [index, part] of relative.split("/").entries()) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch(error => { if (optional && error.code === "ENOENT") return null; throw error; });
    if (!stat) return null;
    if (stat.isSymbolicLink() || (index < relative.split("/").length - 1 ? !stat.isDirectory() : !stat.isFile())) throw new Error(`Recovery requires regular files: ${relative}`);
  }
  return fs.readFile(current);
}

function git(target, args) {
  const result = spawnSync("git", ["-C", target, ...args], { encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
  if (result.status !== 0) throw new Error("Recovery Git ancestry or scope check failed");
  return result.stdout;
}

function compatibleSoloMigration(current, originalHash) {
  const before = structuredClone(current);
  if (before.profile !== "solo" || JSON.stringify(before.actor_policy) !== '{"ordinary_development":"attributed"}') return false;
  delete before.actor_policy;
  // The original snapshot contains a hash, not policy content. Prove the exact
  // original bytes using known JSON encodings; do not infer compatibility from mode alone.
  return [formatJson(before), JSON.stringify(before), JSON.stringify(before, null, 2)].some(value => sha256(value) === originalHash);
}

function compatibleUnrelatedRuntime(target, input, current, request) {
  const field = { ".ai-org/project/runtime-workers.json": "workers", ".ai-org/project/resources.json": "reservations" }[input.path];
  if (!field || !current || !input.sha256) return false;
  // Never guess the prior registry. The candidate Git blob must prove the exact
  // original snapshot, including changes that may have been uncommitted then.
  let original;
  try { original = git(target, ["show", `${request.candidate_revision}:${input.path}`]); } catch { return false; }
  if (sha256(original) !== input.sha256) return false;
  const project = body => {
    const registry = JSON.parse(body);
    if (!Array.isArray(registry[field])) throw new Error("Invalid recovery runtime registry");
    return { ...registry, [field]: registry[field].filter(entry => entry.work_item_id === request.work_item_id) };
  };
  // Global definitions/schema and this item's entries stay exact. Only entries
  // belonging to other items may differ; current Doctor still validates them.
  return formatJson(project(original)) === formatJson(project(current));
}

/** Read-only, narrow reconciliation of an applied Developer handoff. Never acceptance. */
export async function previewLeanFinishRecovery(target, options) {
  target = await fs.realpath(target);
  if (await readPendingLeanDelivery(target)) throw new Error("Partial lifecycle journal requires original finish recovery");
  const key = `${options.workItemId}/${options.operationId}`;
  const record = (await readLeanFinishDiagnostics(target)).find(entry => entry.operation_key === key);
  if (!record || record.status !== "failed" || record.recovery) throw new Error("Recovery requires an unreconciled failed finish");
  const journal = record.journal, request = journal.request;
  if (request.position !== "developer" || request.workflow_stage || request.mechanical_contract) throw new Error("Recovery supports ordinary Developer Lean handoffs only");
  if (options.agentId !== request.agent_id || options.principalId !== request.principal_id) throw new Error("Recovery actor must match the original responsible actor");
  await validateLeanCompletionReceipt(target, journal);
  const planDigest = sha256(formatJson({ request, inputs: journal.inputs,
    output_paths: journal.writes.map(write => write.path), affected_paths: journal.affected_paths }));
  if (planDigest !== journal.plan_digest || planDigest !== journal.result.plan_digest) throw new Error("Recovery journal plan digest mismatch");
  const itemPath = `.ai-org/work-items/${request.work_item_id}.json`;
  const item = JSON.parse(await bytes(target, itemPath));
  if (item.state !== "test" || item.owner_position !== "quality_evaluator" || item.claim?.status === "active" ||
      item.workflow_profile !== "lean" || item.risk_tier !== "low" || item.ui_delivery_mode !== "not-applicable" ||
      item.unresolved?.length || item.developer_candidate_revision !== request.candidate_revision) throw new Error("Recovery requires the unchanged unclaimed low-risk Lean Test handoff");
  if (item.specification_mode !== "gate-evidence" || [...request.evidence, ...Object.values(item.gate_evidence ?? {}).flat()].some(ref => ref.startsWith("EVID-"))) throw new Error("Indexed or normalized evidence requires separate recovery qualification");
  const collaboration = JSON.parse(await bytes(target, COLLABORATION));
  if (collaboration.profile !== "solo") throw new Error("Recovery is limited to Solo responsibility");
  await resolveProjectActor(target, await loadProjectContext(target), { collaboration, item: { ...item, claim: null },
    positionId: "developer", workflowProfile: "lean", agentId: options.agentId, principalId: options.principalId });
  const workers = JSON.parse(await bytes(target, ".ai-org/project/runtime-workers.json"));
  const resources = JSON.parse(await bytes(target, ".ai-org/project/resources.json"));
  if (workers.workers.some(worker => worker.work_item_id === item.id && !["completed", "failed", "cancelled"].includes(worker.status)) ||
      resources.reservations.some(reservation => reservation.work_item_id === item.id && reservation.status === "active")) throw new Error("Active workers or resources prevent diagnostic recovery");
  const head = git(target, ["rev-parse", "HEAD"]).trim();
  git(target, ["merge-base", "--is-ancestor", request.candidate_revision, head]);
  const paths = requireProductScope(journal.affected_paths);
  for (const p of paths) if (p.startsWith("../") || path.isAbsolute(p) || p.includes("\\") || p.includes("\0") || path.posix.normalize(p) !== p || p === ".") throw new Error("Unsafe recovery product scope");
  const scope = paths.map(p => `:(literal)${p}`);
  if (git(target, ["diff", "--name-only", request.candidate_revision, head, "--", ...scope]) ||
      git(target, ["status", "--porcelain=v1", "--untracked-files=all", "--", ...scope])) throw new Error("Product scope changed; recovery cannot accept or rebase a new product candidate");
  await assertWorkingProduct(target, request.candidate_revision, paths);
  if (!options.approvalRef || !options.approvalRef.startsWith(`.ai-org/artifacts/${item.id}/`)) throw new Error("Recovery requires a Work Item approval artifact");
  const approval = await bytes(target, options.approvalRef);
  if (!approval.toString().trim()) throw new Error("Recovery approval artifact is empty");
  const snapshot = [], changes = [];
  const writes = new Map(journal.writes.map(write => [write.path, write]));
  // All prior lifecycle outputs must be identical; only appended events may differ.
  for (const write of journal.writes) {
    const current = await bytes(target, write.path);
    if (write.path === EVENTS) {
      const original = Buffer.from(write.content);
      if (!current.subarray(0, original.length).equals(original)) throw new Error("Recovery event history is not append-only");
      for (const line of current.subarray(original.length).toString().split("\n").filter(Boolean)) {
        if (typeof JSON.parse(line).event_type !== "string") throw new Error("Malformed appended event");
      }
    } else if (digest(current) !== write.after_sha256) throw new Error(`Recovery lifecycle output changed: ${write.path}`);
    snapshot.push({ path: write.path, sha256: digest(current) });
  }
  const evidence = new Set(request.evidence.filter(ref => !ref.startsWith("EVID-")));
  const protectedEvidence = new Set(Object.entries(item.gate_evidence ?? {})
    .filter(([gate]) => !["developer_evidence", "developer_handoff"].includes(gate)).flatMap(([, refs]) => refs));
  for (const input of journal.inputs) {
    if (writes.has(input.path)) continue;
    const current = await bytes(target, input.path, input.sha256 === null), hash = digest(current);
    snapshot.push({ path: input.path, sha256: hash });
    if (hash === input.sha256) continue;
    const compatiblePolicy = input.path === COLLABORATION && compatibleSoloMigration(collaboration, input.sha256);
    const unrelatedRuntime = compatibleUnrelatedRuntime(target, input, current, request);
    const amendedEvidence = evidence.has(input.path) && !protectedEvidence.has(input.path) &&
      (input.path.startsWith(`.ai-org/artifacts/${item.id}/`) || input.path.startsWith("docs/"));
    if (!compatiblePolicy && !unrelatedRuntime && (!amendedEvidence || current === null)) throw new Error(`Incompatible recovery input: ${input.path}`);
    changes.push({ path: input.path, before_sha256: input.sha256, after_sha256: hash,
      classification: compatiblePolicy ? "explicit-compatible-solo-policy" : unrelatedRuntime ? "proven-unrelated-runtime-change" : "amended-developer-evidence-not-acceptance" });
  }
  const eventInput = journal.writes.find(write => write.path === EVENTS);
  const eventHash = snapshot.find(input => input.path === EVENTS).sha256;
  if (eventHash !== eventInput.after_sha256) changes.push({ path: EVENTS, before_sha256: eventInput.after_sha256, after_sha256: eventHash, classification: "appended-events" });
  const preview = { schema_version: "temple.lean-finish-recovery-preview/v1", operation_key: key,
    authority_granted: false, acceptance_granted: false, mutation_performed: false,
    candidate_revision: request.candidate_revision, current_revision: head, agent_id: options.agentId, principal_id: options.principalId,
    approval_ref: options.approvalRef, approval_sha256: digest(approval), original_record_sha256: sha256(formatJson(record)),
    recovery_ref: `.ai-org/artifacts/${item.id}/finish-recovery-${request.operation_id}.json`,
    changes, snapshot, next_action: "Apply only the explicitly approved fingerprint; a distinct Verifier must still verify the candidate." };
  return { ...preview, fingerprint: sha256(formatJson(preview)) };
}

/** Caller holds the project lock. Separate immutable artifact precedes local bookkeeping. */
export async function recoverLeanFinish(target, options, hooks = {}) {
  const preview = await previewLeanFinishRecovery(target, options);
  if (options.dryRun) return preview;
  if (!options.expectedPlan || options.expectedPlan !== preview.fingerprint) throw new Error("Stale or missing recovery fingerprint; preview again");
  const original = (await readLeanFinishDiagnostics(target)).find(record => record.operation_key === preview.operation_key);
  const existing = await bytes(target, preview.recovery_ref, true);
  let recovery;
  if (existing) {
    recovery = JSON.parse(existing);
    if (recovery.schema_version !== "temple.lean-finish-recovery/v1" || recovery.preview?.fingerprint !== preview.fingerprint ||
        formatJson(recovery.preview) !== formatJson(preview)) throw new Error("Existing recovery artifact conflicts with this preview");
    validateLeanRecoveryArtifact(recovery, original);
  }
  const plan = await inspectParallelPlan(target);
  if (!plan.valid) throw new Error(plan.errors.join("; "));
  if (plan.installed && !plan.fresh) await writeParallelPlan(target, await buildParallelPlan(target, {
    parentWorkItemId: plan.plan.scope.parent_work_item_id ?? undefined, maxWorkers: plan.plan.max_workers }));
  const status = await buildStatus(target, { settlingLeanFinish: preview.operation_key });
  await writeStatus(target, status);
  const doctor = compactDoctor(await runDoctor(target, { settlingLeanFinish: preview.operation_key }));
  if (!doctor.healthy || doctor.summary.fail || doctor.summary.warn) throw new Error("Recovery diagnostics are not clean; no recovery was settled");
  const diagnostics = { status: "passed", historical: false,
    status_rebuild: { status: "passed", result: compactStatus(status, options.workItemId) }, doctor, errors: [] };
  await hooks.checkpoint?.("after-diagnostics");
  const fresh = await previewLeanFinishRecovery(target, options);
  if (fresh.fingerprint !== preview.fingerprint) throw new Error("Recovery inputs changed during diagnostics");
  if (!recovery) {
    recovery = { schema_version: "temple.lean-finish-recovery/v1", recorded_at: new Date().toISOString(), preview,
      diagnostics: { status: "passed", doctor: { healthy: doctor.healthy, summary: doctor.summary, checks: doctor.checks }, errors: [] },
      original_status: original.status, original_diagnostics_sha256: sha256(formatJson(original.diagnostics)),
      acceptance_granted: false, authority_granted: false };
    validateLeanRecoveryArtifact(recovery, original);
    await durableAtomicCreate(path.join(target, preview.recovery_ref), formatJson(recovery));
  }
  await hooks.checkpoint?.("after-artifact");
  // The immutable artifact and its previous result must match even after a crash.
  if (sha256(await bytes(target, preview.recovery_ref)) !== sha256(formatJson(recovery))) throw new Error("Recovery artifact changed before settlement");
  if ((await previewLeanFinishRecovery(target, options)).fingerprint !== preview.fingerprint) throw new Error("Recovery inputs changed before settlement");
  await writeLeanFinishDiagnostics(target, { ...original, status: "passed", diagnostics,
    recovery: { ref: preview.recovery_ref, sha256: sha256(formatJson(recovery)),
      original_status: original.status, original_diagnostics: original.diagnostics } });
  return { status: "reconciled", mutation_performed: true, authority_granted: false, acceptance_granted: false,
    candidate_revision: preview.candidate_revision, recovery_ref: preview.recovery_ref,
    diagnostics, next_action: "Claim Test as a distinct Verifier and independently verify the unchanged Developer candidate." };
}
