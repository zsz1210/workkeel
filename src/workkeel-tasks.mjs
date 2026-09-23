import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { durableAtomicCreate, durableAtomicWrite, formatJson, sha256 } from "./files.mjs";
import { withProjectMutationLock } from "./project.mjs";
import { readTaskContractInput, readTaskFile, validateTaskContract } from "./task-contract.mjs";
import { assertActor, assertApprover, readTaskProject, safeDirectory, existsEntry } from "./workkeel-project.mjs";

const exec = promisify(execFile);
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const TERMINAL = new Set(["done", "cancelled"]);
const fileRef = id => {
  if (typeof id !== "string" || !ID.test(id)) throw new Error("Invalid task ID");
  return `.ai-org/work-items/${id}.json`;
};
const sameActor = (a, b) => a?.agent_id === b?.agent_id && a?.principal_id === b?.principal_id;
const digest = value => sha256(formatJson(value));
const bodyHash = item => digest(Object.fromEntries(Object.entries(item).filter(([key]) => key !== "history")));
const under = (file, root) => root === "." || file === root || file.startsWith(`${root}/`);
function assertKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw new Error("Unknown request fields are not permitted");
}
function assertText(value) { if (typeof value !== "string" || !value.trim() || value.length > 8000) throw new Error("A bounded nonempty summary is required"); }

async function git(target, args) {
  try { return (await exec("git", ["-C", target, ...args], { maxBuffer: 4 * 1024 * 1024 })).stdout; }
  catch { throw new Error("Git candidate check failed; use a local repository and exact commit"); }
}
async function exactRevision(target, revision) {
  if (!SHA.test(revision ?? "")) throw new Error("A full immutable commit revision is required");
  if ((await git(target, ["rev-parse", "--verify", `${revision}^{commit}`])).trim() !== revision) throw new Error("Candidate must identify the commit itself");
}
async function evidence(target, refs) {
  if (!Array.isArray(refs) || !refs.length || refs.some(x => typeof x !== "string") || new Set(refs).size !== refs.length) throw new Error("Distinct repository evidence paths are required");
  const files = [];
  for (const ref of refs) {
    const input = await readTaskFile(target, ref);
    if (!input.content.trim()) throw new Error("Evidence files must not be empty");
    files.push({ path: ref, sha256: input.digest });
  }
  return files;
}
async function assertPins(target, pins) {
  for (const pin of pins) if ((await readTaskFile(target, pin.path)).digest !== pin.sha256) throw new Error("Referenced approval, policy or evidence changed; preserve this attempt and obtain fresh authorization");
}
function assertRecord(item, id) {
  if (item?.schema_version !== "workkeel.work-item/v1" || item.id !== id || item.contract?.id !== id ||
      !Number.isSafeInteger(item.version) || item.version < 1 || !Array.isArray(item.history) || item.history.length !== item.version ||
      digest(item.contract) !== item.contract_sha256 || !validateTaskContract(item.contract).valid ||
      !["intake", "build", "test", "release_gate", "done", "cancelled"].includes(item.state)) throw new Error("Invalid canonical task record");
  let previous = null;
  for (const [index, event] of item.history.entries()) {
    const { hash, ...body } = event;
    if (event.sequence !== index + 1 || event.previous_hash !== previous || hash !== digest(body)) throw new Error("Task operation history integrity failure");
    previous = hash;
  }
  if (item.history.at(-1).record_sha256 !== bodyHash(item)) throw new Error("Task state differs from its recorded operation");
}
export async function readNativeTask(target, id) {
  const input = await readTaskContractInput(target, fileRef(id));
  assertRecord(input.document, id);
  return input.document;
}
export async function listTaskItems(target) {
  await readTaskProject(target);
  if (!await existsEntry(target, ".ai-org/work-items")) return [];
  const dir = await safeDirectory(target, ".ai-org/work-items");
  const items = [];
  for (const entry of (await fs.readdir(dir)).sort()) {
    if (!entry.endsWith(".json")) throw new Error("Unexpected file in task store");
    const id = entry.slice(0, -5);
    const { document: item } = await readTaskContractInput(target, fileRef(id));
    if (item.schema_version === "temple.work-item/v1") {
      if (item.id !== id) throw new Error("Legacy task ID differs from its filename");
      const project = await readTaskProject(target);
      const pin = project.legacy_manifest?.find(p => p.path === fileRef(id));
      if (!pin) throw new Error("Unregistered legacy record in task-first store");
      await assertPins(target, [pin]);
      items.push({ id, state: item.state, title: item.title, mode: "legacy-read-only" });
    } else {
      assertRecord(item, id);
      items.push({ id, state: item.state, title: item.contract.goal, mode: "task-first", version: item.version,
        actor: item.claim?.actor ?? null, candidate_revision: item.delivery?.revision ?? null });
    }
  }
  return items;
}

function assertContractPolicy(contract, policy) {
  const valid = validateTaskContract(contract);
  if (!valid.contract_complete) throw new Error(`Incomplete task contract: ${[...valid.errors, ...valid.incomplete_fields].join("; ")}`);
  assertActor(policy, contract.actor);
  if (!policy.approvers.includes(contract.authorization.approved_by)) throw new Error("Task approval must name a registered approving Principal");
  if (!["low", "standard"].includes(contract.verification.risk_tier) || contract.environment.data.classification === "sensitive") throw new Error("High-risk or sensitive work requires the established assurance workflow; task-first v1 cannot downgrade it");
  if (!["distinct-agent", "distinct-principal"].includes(contract.verification.separation) ||
      policy.review_separation === "distinct-principal" && contract.verification.separation !== "distinct-principal") throw new Error("Task review must meet the project separation policy");
}
async function dependencies(target, item, seen = new Set()) {
  if (seen.has(item.id)) throw new Error("Cyclic dependency history");
  const branch = new Set([...seen, item.id]);
  const pins = [];
  for (const id of item.contract.dependencies) {
    const dependency = await readNativeTask(target, id);
    if (dependency.state !== "done" || !dependency.delivery || dependency.review?.judgment !== "pass" ||
        dependency.closeout?.revision !== dependency.delivery.revision) throw new Error("Dependencies must be accepted native tasks; legacy terminal labels are not new grants");
    await assertPins(target, [...dependency.authority_pins, ...dependency.delivery.evidence, ...dependency.review.evidence, ...dependency.closeout.evidence]);
    await dependencies(target, dependency, branch);
    if (item.base_revision) await git(target, ["merge-base", "--is-ancestor", dependency.delivery.revision, item.base_revision]);
    pins.push({ id, version: dependency.version, revision: dependency.delivery.revision, record_sha256: bodyHash(dependency) });
  }
  if (item.dependency_pins && digest(pins) !== digest(item.dependency_pins)) throw new Error("Accepted dependency snapshot changed");
  return pins;
}
async function context(target, item, project) {
  if (item.policy_sha256 !== digest(project.policy)) throw new Error("Task policy changed after approval");
  assertContractPolicy(item.contract, project.policy);
  await assertPins(target, item.authority_pins);
  await safeDirectory(target, item.contract.environment.cwd);
}
function append(item, action, request) {
  item.version += 1;
  const event = { sequence: item.version, action, operation_id: request.operation_id,
    request_sha256: digest({ action, request }), actor: request.actor, at: new Date().toISOString(),
    state: item.state, revision: item.delivery?.revision ?? null,
    previous_hash: item.history.at(-1)?.hash ?? null, record_sha256: bodyHash(item) };
  item.history.push({ ...event, hash: digest(event) });
}
function assertRequest(request, fields) {
  assertKeys(request, ["operation_id", "expected_version", "actor", ...fields]);
  if (typeof request.operation_id !== "string" || !ID.test(request.operation_id) || !Number.isSafeInteger(request.expected_version) || request.expected_version < 0) throw new Error("Operation ID and expected version are required");
}
function replay(item, action, request) {
  const previous = item.history.find(e => e.operation_id === request.operation_id);
  if (!previous) return false;
  if (previous.request_sha256 !== digest({ action, request })) throw new Error("Operation ID was already used with different input");
  return true;
}
function result(item, replayed = false) {
  return { schema_version: "workkeel.operation-result/v1", id: item.id, version: item.version,
    state: item.state, claim: item.claim, candidate_revision: item.delivery?.revision ?? null,
    replayed, mutation_status: replayed ? "already-applied" : "applied", execution_authorized: false,
    boundary_enforcement: "host-responsibility", external_release: "not-performed" };
}

export async function createNativeTask(targetInput, contract, request) {
  const target = await fs.realpath(targetInput);
  assertRequest(request, []);
  if (request.expected_version !== 0) throw new Error("Task creation expects version zero");
  const ref = fileRef(contract?.id);
  return withProjectMutationLock(target, async () => {
    const project = await readTaskProject(target);
    assertApprover(project.policy, request.actor);
    if (await existsEntry(target, ref)) {
      const existing = await readNativeTask(target, contract.id);
      if (digest(existing.contract) !== digest(contract) || !replay(existing, "create", request)) throw new Error("Task ID already exists");
      return result(existing, true);
    }
    assertContractPolicy(contract, project.policy);
    if (contract.authorization.approved_by !== request.actor.principal_id || contract.state !== "intake" || contract.legacy !== null ||
        contract.handoff !== null || contract.acceptance.evidence.length || contract.verification.implementer !== null ||
        contract.verification.reviewer !== null || contract.verification.candidate_revision !== null) throw new Error("New task must start at intake without fabricated progress or legacy grants");
    // Existing-only immutable dependencies make cycles impossible in supported writes.
    for (const id of contract.dependencies) await readNativeTask(target, id);
    const authorityRefs = [...new Set([contract.authorization.approval_ref, ...contract.environment.data.policy_refs, ...contract.skills])];
    const item = { schema_version: "workkeel.work-item/v1", id: contract.id, version: 0, state: "intake",
      contract: structuredClone(contract), contract_sha256: digest(contract), policy_sha256: digest(project.policy),
      authority_pins: await evidence(target, authorityRefs), claim: null, base_revision: null,
      dependency_pins: null, delivery: null, review: null, closeout: null, attempts: [], history: [] };
    await context(target, item, project);
    append(item, "create", request);
    if (Buffer.byteLength(formatJson(item)) > 1024 * 1024) throw new Error("New task exceeds the bounded record size");
    await safeDirectory(target, ".ai-org/work-items", { create: true });
    await durableAtomicCreate(path.join(target, ref), formatJson(item));
    return result(item);
  });
}

async function administrativeFile(target, item, file, action, request) {
  if (file === fileRef(item.id)) return true;
  if (!file.startsWith(`.ai-org/artifacts/${item.id}/`) || !/\.(?:md|txt|log|json)$/.test(file)) return false;
  const refs = [...(item.delivery?.evidence ?? []), ...(item.review?.evidence ?? []), ...(item.closeout?.evidence ?? [])].map(p => p.path);
  if (refs.includes(file) || request?.evidence?.includes(file)) return true;
  if (!file.endsWith(".json")) return false;
  let document;
  try { document = (await readTaskContractInput(target, file)).document; } catch { return false; }
  return (request && digest(document) === digest(request)) || item.history.some(event =>
    event.request_sha256 === digest({ action: event.action, request: document }));
}
async function assertCandidate(target, item, revision, { handoff = false, action = null, request = null } = {}) {
  await exactRevision(target, revision);
  await git(target, ["merge-base", "--is-ancestor", item.base_revision, revision]);
  if (handoff && (await git(target, ["rev-parse", "HEAD"])).trim() !== revision) throw new Error("Handoff candidate must be the current commit");
  const changed = (await git(target, ["diff", "--no-renames", "--name-only", "-z", item.base_revision, revision, "--"])).split("\0").filter(Boolean);
  for (const file of changed) if (!item.contract.environment.write_paths.some(root => under(file, root)) &&
    !await administrativeFile(target, item, file, action, request)) throw new Error("Candidate changes paths outside approved write roots");
  const drift = [...(await git(target, ["diff", "--no-renames", "--name-only", "-z", revision, "--"])).split("\0"),
    ...(await git(target, ["ls-files", "--others", "--exclude-standard", "-z"])).split("\0")].filter(Boolean);
  for (const file of new Set(drift)) {
    if (!await administrativeFile(target, item, file, action, request)) throw new Error("Candidate verification requires a clean product tree, including untracked files");
    // Only the task's canonical state may change if it existed in the candidate.
    // New exact report/request files are administrative; existing artifacts are
    // still immutable candidate inputs, regardless of extension or directory.
    if (file !== fileRef(item.id) && (await git(target, ["ls-tree", "--name-only", revision, "--", file])).trim()) throw new Error("A tracked candidate artifact changed after verification");
  }
}
async function assertDelivery(target, item, action, request) {
  if (!item.delivery) throw new Error("No delivered candidate");
  await assertCandidate(target, item, item.delivery.revision, { action, request });
  await assertPins(target, item.delivery.evidence);
  await dependencies(target, item);
}

const FIELDS = {
  claim: ["base_revision"], release: ["claim_id", "summary"],
  handoff: ["claim_id", "revision", "summary", "evidence", "unresolved"],
  review: ["revision", "judgment", "summary", "evidence"],
  rework: ["summary"], close: ["revision", "summary", "rollback", "evidence"], cancel: ["summary", "evidence"]
};
export async function mutateNativeTask(targetInput, id, action, request) {
  if (!Object.hasOwn(FIELDS, action)) throw new Error("Unknown task operation");
  assertRequest(request, FIELDS[action]);
  const target = await fs.realpath(targetInput);
  return withProjectMutationLock(target, async () => {
    const project = await readTaskProject(target);
    const item = await readNativeTask(target, id);
    assertActor(project.policy, request.actor);
    if (replay(item, action, request)) return result(item, true);
    if (item.version !== request.expected_version) throw new Error("Stale expected version; inspect current task before retrying");
    if (TERMINAL.has(item.state)) throw new Error("Terminal tasks cannot be reopened");
    // Cancellation remains possible after authority expiry; it cannot grant work.
    if (action !== "cancel") await context(target, item, project);
    if (action === "claim") {
      if (item.state !== "intake" || item.claim) throw new Error("Task already claimed or not available for implementation");
      if (!sameActor(item.contract.actor, request.actor)) throw new Error("Only the approved task Agent may claim");
      await exactRevision(target, request.base_revision);
      if ((await git(target, ["rev-parse", "HEAD"])).trim() !== request.base_revision) throw new Error("Claim base must equal current HEAD");
      const pins = await dependencies(target, { ...item, base_revision: request.base_revision });
      for (const active of await listTaskItems(target)) if (active.id !== id && active.mode === "task-first" && active.state === "build") {
        const other = await readNativeTask(target, active.id);
        if (item.contract.environment.write_paths.some(a => other.contract.environment.write_paths.some(b => under(a,b) || under(b,a)))) throw new Error("An active task holds overlapping write roots");
      }
      item.claim = { id: `claim-${crypto.randomUUID()}`, actor: request.actor, at: new Date().toISOString() };
      item.base_revision = request.base_revision; item.dependency_pins = pins; item.state = "build";
    } else if (["handoff", "release"].includes(action)) {
      if (item.state !== "build" || !item.claim || item.claim.id !== request.claim_id || !sameActor(item.claim.actor, request.actor)) throw new Error("Operation requires the current matching implementation claim");
      assertText(request.summary);
      if (action === "release") {
        item.attempts.push({ kind: "released", claim: item.claim, base_revision: item.base_revision, summary: request.summary });
        item.claim = null; item.state = "intake"; item.dependency_pins = null;
      } else {
        if (!Array.isArray(request.unresolved) || request.unresolved.length) throw new Error("Resolve outstanding issues before delivery");
        if (item.attempts.some(a => a.kind === "rejected" && a.delivery.revision === request.revision)) throw new Error("Rework requires a fresh candidate, not the rejected revision");
        await assertCandidate(target, item, request.revision, { handoff: true, action, request });
        await dependencies(target, item);
        item.delivery = { revision: request.revision, summary: request.summary, implementer: request.actor,
          claim_id: item.claim.id, evidence: await evidence(target, request.evidence) };
        item.claim = null; item.state = "test";
      }
    } else if (action === "review") {
      if (item.state !== "test" || item.review) throw new Error("Task is not awaiting a review");
      if (!["pass", "fail"].includes(request.judgment)) throw new Error("Review requires pass or fail");
      const implementer = item.delivery.implementer;
      if (request.actor.agent_id === implementer.agent_id || item.contract.verification.separation === "distinct-principal" &&
          request.actor.principal_id === implementer.principal_id) throw new Error("Reviewer identity does not meet separation policy");
      if (request.revision !== item.delivery.revision) throw new Error("Review must match the exact delivered candidate");
      await assertDelivery(target, item, action, request); assertText(request.summary);
      item.review = { actor: request.actor, revision: request.revision, judgment: request.judgment,
        summary: request.summary, evidence: await evidence(target, request.evidence) };
      if (request.judgment === "pass") item.state = "release_gate";
    } else if (action === "rework") {
      assertApprover(project.policy, request.actor); assertText(request.summary);
      if (item.state !== "test" || item.review?.judgment !== "fail") throw new Error("Rework requires a failed review and preserves the same approved contract");
      item.attempts.push({ kind: "rejected", base_revision: item.base_revision, delivery: item.delivery, review: item.review, summary: request.summary });
      item.delivery = null; item.review = null; item.claim = null; item.state = "intake"; item.dependency_pins = null;
    } else if (action === "close") {
      assertApprover(project.policy, request.actor);
      if (item.state !== "release_gate" || item.review?.judgment !== "pass" || request.revision !== item.delivery.revision) throw new Error("Close requires the independently accepted exact candidate");
      await assertDelivery(target, item, action, request); await assertPins(target, item.review.evidence);
      assertText(request.summary); assertText(request.rollback);
      item.closeout = { actor: request.actor, revision: request.revision, summary: request.summary,
        rollback: request.rollback, evidence: await evidence(target, request.evidence), external_release: "not-performed" };
      item.state = "done";
    } else {
      assertApprover(project.policy, request.actor); assertText(request.summary);
      item.closeout = { actor: request.actor, summary: request.summary, evidence: await evidence(target, request.evidence), external_release: "not-performed" };
      item.claim = null; item.state = "cancelled";
    }
    append(item, action, request);
    const content = formatJson(item);
    if (Buffer.byteLength(content) > 1024 * 1024) throw new Error("Task history exceeds the bounded record size; preserve it and create a successor task");
    await safeDirectory(target, ".ai-org/work-items");
    await durableAtomicWrite(path.join(target, fileRef(id)), content);
    return result(item);
  });
}

export async function diagnoseTaskProject(target) {
  const errors = [];
  let items = [];
  try {
    const project = await readTaskProject(target);
    if (project.legacy_manifest) await assertPins(target, project.legacy_manifest);
    items = await listTaskItems(target);
    for (const summary of items.filter(i => i.mode === "task-first")) {
      const item = await readNativeTask(target, summary.id);
      try {
        await assertPins(target, item.authority_pins);
        // Expiry does not invalidate a completed historical acceptance.
        if (!TERMINAL.has(item.state)) await context(target, item, project);
        if (item.delivery) await assertPins(target, item.delivery.evidence);
        if (item.review) await assertPins(target, item.review.evidence);
        if (item.closeout) await assertPins(target, item.closeout.evidence);
      } catch (e) { errors.push({ id: item.id, message: e.message }); }
    }
  } catch (e) { errors.push({ message: e.message }); }
  return { schema_version: "workkeel.diagnostics/v1", valid: errors.length === 0, errors, tasks: items,
    authority: "observation-only", mutation_status: "no-write", execution_authorized: false, boundary_enforcement: "host-responsibility" };
}
