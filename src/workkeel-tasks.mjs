import {assertLoopAdmission} from './workkeel-loop-run.mjs';
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { durableAtomicCreate, durableAtomicWrite, formatJson, sha256 } from "./files.mjs";
import { withProjectMutationLock } from "./workkeel-lock.mjs";
import { warnUnknownFields } from "./workkeel-compat.mjs";
import { readTaskContractInput, readTaskFile, validateTaskContract } from "./task-contract.mjs";
import { assertActor, assertApprover, readTaskProject, safeDirectory, existsEntry, readNativeGit } from "./workkeel-project.mjs";
import {loadTaskRequirements, assertRequirementOutcomes} from './workkeel-requirements.mjs';
import { completeTaskContract } from "./workkeel-task-draft.mjs";
import { MAX_REWORKS, assertCriticalApprovalRecord, assertTaskRisk, candidateRisk, elevatedRisk, maxRisk, taskRisk } from "./workkeel-risk.mjs";

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
const effectiveRisk = taskRisk;
const under = (file, root) => root === "." || file === root || file.startsWith(`${root}/`);
/**
 * Unknown request fields are ignored with a compatibility warning: the copy holds
 * only known fields, so unknown values never reach validation, hashes or records.
 */
function knownFields(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A request object is required");
  warnUnknownFields(value, keys, "request");
  // Keep the input's key order: request hashes are taken over the JSON as given.
  return Object.fromEntries(Object.keys(value).filter(key => keys.includes(key)).map(key => [key, value[key]]));
}
function assertText(value) { if (typeof value !== "string" || !value.trim() || value.length > 8000) throw new Error("A bounded nonempty summary is required"); }

async function git(target, args) {
  try { return await readNativeGit(target, args); }
  catch (error) { throw new Error(`Git candidate check failed; use a local repository and exact commit: ${error.message}`); }
}
/** A full or abbreviated commit ID, resolved to the one full commit it names. */
async function exactRevision(target, revision) {
  if (typeof revision !== "string" || !/^[a-f0-9]{4,64}$/.test(revision)) throw new Error("A commit ID (full or abbreviated hexadecimal) is required");
  const full = (await git(target, ["rev-parse", "--verify", `${revision}^{commit}`])).trim();
  if (!SHA.test(full) || !full.startsWith(revision)) throw new Error("Candidate must identify the commit itself");
  return full;
}
/**
 * The delivered commit, named in full or by an abbreviation Git resolves to that
 * one commit; null for any other or ambiguous name.
 */
async function deliveredRevision(target, item, revision) {
  if (!item.delivery || typeof revision !== "string" || !item.delivery.revision.startsWith(revision)) return null;
  try { return await exactRevision(target, revision) === item.delivery.revision ? item.delivery.revision : null; } catch { return null; }
}
// `.ai-org/` holds the task store, reports and requests: administrative, never product.
const administrative = file => file === ".ai-org" || file.startsWith(".ai-org/");
/** HEAD, or null before the repository's first commit. */
async function headRevision(target) {
  try { return (await readNativeGit(target, ["rev-parse", "--verify", "HEAD^{commit}"])).trim(); } catch { return null; }
}
/**
 * Approval-time digests of the approval, policy and skill files. Lifecycle
 * operations and Doctor never recheck them; only the execution gate and optional
 * execution helpers (dispatch, goals, autonomy) compare them before running work.
 */
async function authoritySnapshot(target, refs) {
  const pins = [];
  for (const ref of refs) {
    const input = await readTaskFile(target, ref);
    if (!input.content.trim()) throw new Error("Approval and policy references must not be empty");
    pins.push({ path: ref, sha256: input.digest });
  }
  return pins;
}
/**
 * Evidence is a path committed in the candidate (Git keeps it immutable) or a
 * working file such as a `.ai-org/` report. Paths are recorded without digests;
 * callers that inspect content use the bytes read here.
 */
async function readEvidence(target, refs, revision, { required = false } = {}) {
  if (!Array.isArray(refs) || refs.length > 64 || refs.some(x => typeof x !== "string") || new Set(refs).size !== refs.length) throw new Error("Distinct repository evidence paths are required");
  if (required && !refs.length) throw new Error("Standard and higher risk work needs evidence: a path committed in the candidate or a report such as one under .ai-org/");
  const files = [];
  for (const ref of refs) {
    let content = null, source = "candidate";
    if (revision && (await git(target, ["ls-tree", revision, "--", `:(literal)${ref}`])).startsWith("100")) {
      try { content = new TextDecoder("utf-8", { fatal: true }).decode(await readNativeGit(target, ["cat-file", "blob", `${revision}:${ref}`], { encoding: "buffer" })); }
      catch { throw new Error(`Evidence must be UTF-8 text: ${JSON.stringify(ref)}`); }
    } else { content = (await readTaskFile(target, ref)).content; source = "workspace"; }
    if (!content.trim()) throw new Error("Evidence files must not be empty");
    files.push({ path: ref, source, content });
  }
  return files;
}
const refsOf = files => files.map(({ path, source }) => ({ path, source }));
/**
 * Observation of one recorded evidence path: "committed" in the given candidate,
 * "present" as a working file, or "unavailable". Content is never compared.
 */
export async function evidenceStatus(target, revision, entry) {
  if (entry?.source === "candidate") {
    try { return revision && (await readNativeGit(target, ["ls-tree", revision, "--", `:(literal)${entry.path}`])).startsWith("100") ? "committed" : "unavailable"; }
    catch { return "unavailable"; }
  }
  try { await readTaskFile(target, entry.path); return "present"; } catch { return "unavailable"; }
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
    if (Object.hasOwn(event, "summary")) assertText(event.summary);
    if (Object.hasOwn(event, "judgment") && (event.action !== "review" || !["pass", "fail"].includes(event.judgment))) throw new Error("Invalid recorded review judgment");
    previous = hash;
  }
  if (item.history.at(-1).record_sha256 !== bodyHash(item)) throw new Error("Task state differs from its recorded operation");
}
export async function readNativeTask(target, id) {
  const input = await readTaskContractInput(target, fileRef(id));
  assertRecord(input.document, id);
  return input.document;
}
/** Integrity check for an explicitly retained snapshot; never current authority. */
export function validateNativeTaskSnapshot(item, id) {
  assertRecord(item, id);
  return item;
}
export async function listTaskItems(target, { isolateErrors = false } = {}) {
  await readTaskProject(target);
  if (!await existsEntry(target, ".ai-org/work-items")) return [];
  const dir = await safeDirectory(target, ".ai-org/work-items");
  const items = [];
  for (const entry of (await fs.readdir(dir)).sort()) {
    if (!entry.endsWith(".json")) throw new Error("Unexpected file in task store");
    const id = entry.slice(0, -5);
    if (!ID.test(id)) throw new Error('Invalid task filename');
    try {
    const { document: item } = await readTaskContractInput(target, fileRef(id));
    assertRecord(item, id);
    items.push({ id, state: item.state, title: item.contract.goal, mode: "task-first", version: item.version,
      actor: item.claim?.actor ?? null, candidate_revision: item.delivery?.revision ?? null,
      risk_tier: effectiveRisk(item), risk_escalated: Boolean(item.delivery?.risk) });
    } catch (error) {
      if (!isolateErrors) throw error;
      items.push({id,title:id,mode:'unavailable',state:'unknown'});
    }
  }
  return items;
}

function assertContractPolicy(contract, policy) {
  const valid = validateTaskContract(contract);
  if (!valid.contract_complete) throw new Error(`Incomplete task contract: ${[...valid.errors, ...valid.incomplete_fields].join("; ")}`);
  assertActor(policy, contract.actor);
  if ((policy.requirements_refs ?? []).some(ref => !contract.environment.data.policy_refs.includes(ref))) throw Error('Required project decision source omitted from task');
  if (!policy.approvers.includes(contract.authorization.approved_by)) throw new Error("Task approval must name a registered approving Principal");
  assertTaskRisk(policy, contract);
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
        dependency.closeout?.revision !== dependency.delivery.revision) throw new Error("Dependencies must be accepted native tasks");
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
  await loadTaskRequirements(target, item.contract, {requiredRefs: project.policy.requirements_refs ?? []});
  await safeDirectory(target, item.contract.environment.cwd);
}

/**
 * Execution is allowed only under the current implementation claim. Unlike
 * lifecycle operations, launching work also requires the approval, policy and
 * Skill files to still match their approval-time snapshot, because hosts run them.
 */
export async function assertTaskExecutionContext(target, id, { actor, claim_id, contract_sha256 = null }) {
  await assertLoopAdmission(target);
  const project = await readTaskProject(target);
  const item = await readNativeTask(target, id);
  assertActor(project.policy, actor);
  if (item.state !== "build" || !item.claim || item.claim.id !== claim_id || !sameActor(item.claim.actor, actor)) throw new Error("Execution requires the current matching implementation claim");
  if (contract_sha256 !== null && contract_sha256 !== item.contract_sha256) throw new Error("Execution contract changed");
  await context(target, item, project);
  for (const pin of item.authority_pins) if ((await readTaskFile(target, pin.path)).digest !== pin.sha256)
    throw new Error("Referenced approval, policy or Skill file changed since approval; the lifecycle continues, but launching work needs a re-approved task");
  await dependencies(target, item);
  return item;
}
function append(item, action, request) {
  item.version += 1;
  const event = { sequence: item.version, action, operation_id: request.operation_id,
    request_sha256: digest({ action, request }), actor: request.actor, at: new Date().toISOString(),
    state: item.state, revision: item.delivery?.revision ?? null,
    previous_hash: item.history.at(-1)?.hash ?? null, record_sha256: bodyHash(item) };
  if (Object.hasOwn(request, "summary")) { assertText(request.summary); event.summary = request.summary; }
  if (action === "review") event.judgment = request.judgment;
  item.history.push({ ...event, hash: digest(event) });
}
/** The request's known fields, validated; use the returned copy, never the input. */
function assertRequest(input, fields) {
  const request = knownFields(input, ["operation_id", "expected_version", "actor", ...fields]);
  if (typeof request.operation_id !== "string" || !ID.test(request.operation_id) || !Number.isSafeInteger(request.expected_version) || request.expected_version < 0) throw new Error("Operation ID and expected version are required");
  return request;
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

export async function createNativeTask(targetInput, draft, request, { expectedPolicyDigest = null, expectedAuthorityPins = null } = {}) {
  await assertLoopAdmission(targetInput);
  const target = await fs.realpath(targetInput);
  request = assertRequest(request, []);
  if (request.expected_version !== 0) throw new Error("Task creation expects version zero");
  const ref = fileRef(draft?.id);
  return withProjectMutationLock(target, async () => {
    const project = await readTaskProject(target);
    assertApprover(project.policy, request.actor);
    // Short drafts get their recorded defaults; a full contract is kept as written.
    const contract = completeTaskContract(draft, project.policy, request.actor);
    if (expectedPolicyDigest !== null && digest(project.policy) !== expectedPolicyDigest) throw new Error('Intake policy changed; inspect a fresh preview');
    if (await existsEntry(target, ref)) {
      const existing = await readNativeTask(target, contract.id);
      if (expectedAuthorityPins !== null && digest(existing.authority_pins) !== digest(expectedAuthorityPins)) throw new Error('Existing task authority differs from the preview; inspect the original task');
      if (digest(existing.contract) !== digest(contract) || !replay(existing, "create", request)) throw new Error("Task ID already exists");
      return result(existing, true);
    }
    assertContractPolicy(contract, project.policy);
    // Elevated work may name another approving Principal, who must then close it; everything else is approved by its creator.
    const delegated = elevatedRisk(contract.verification.risk_tier);
    if (!delegated && contract.authorization.approved_by !== request.actor.principal_id || contract.state !== "intake" ||
        contract.handoff !== null || contract.acceptance.evidence.length || contract.verification.implementer !== null ||
        contract.verification.reviewer !== null || contract.verification.candidate_revision !== null) throw new Error("New task must start at intake without fabricated progress");
    // Existing-only immutable dependencies make cycles impossible in supported writes.
    for (const id of contract.dependencies) await readNativeTask(target, id);
    const authorityRefs = [...new Set([contract.authorization.approval_ref, ...contract.environment.data.policy_refs, ...contract.skills])].filter(ref => ref !== null);
    // Approval is the approving Principal plus the commit it was given at. Later
    // edits to the approval or policy files never invalidate the task; the files as
    // approved are `git show <approved_at_revision>:<path>` when committed.
    const item = { schema_version: "workkeel.work-item/v1", id: contract.id, version: 0, state: "intake",
      contract: structuredClone(contract), contract_sha256: digest(contract), policy_sha256: digest(project.policy),
      approval: { approved_by: contract.authorization.approved_by, approved_at_revision: await headRevision(target) },
      authority_pins: await authoritySnapshot(target, authorityRefs), claim: null, base_revision: null,
      dependency_pins: null, delivery: null, review: null, closeout: null, attempts: [], history: [] };
    if (expectedAuthorityPins !== null && digest(item.authority_pins) !== digest(expectedAuthorityPins)) throw new Error('Intake authority changed; inspect a fresh preview');
    await context(target, item, project);
    append(item, "create", request);
    if (Buffer.byteLength(formatJson(item)) > 1024 * 1024) throw new Error("New task exceeds the bounded record size");
    await safeDirectory(target, ".ai-org/work-items", { create: true });
    await durableAtomicCreate(path.join(target, ref), formatJson(item));
    return result(item);
  });
}

const CANDIDATE_MESSAGES = {
  'outside-write-scope': 'Candidate changes paths outside approved write roots',
  'product-drift': 'Candidate verification requires a clean tree inside the approved write roots, including untracked files'
};
/**
 * Committed product changes must stay inside the write roots. Drift is checked
 * only inside those roots; `.ai-org/` is always administrative.
 */
async function candidateFiles(target, item, revision, { handoff = false } = {}) {
  await git(target, ["merge-base", "--is-ancestor", item.base_revision, revision]);
  if (handoff && (await git(target, ["rev-parse", "HEAD"])).trim() !== revision) throw new Error("Handoff candidate must be the current commit");
  const roots = item.contract.environment.write_paths, inScope = file => roots.some(root => under(file, root));
  const issues = [], drifted = [];
  const { product } = await changedFiles(target, item.base_revision, revision);
  for (const file of product) if (!inScope(file))
    issues.push({path:file, code:'outside-write-scope', next_action:'Preserve the candidate; obtain approval for the actual scope before a new delivery.'});
  const drift = [...(await git(target, ["diff", "--no-renames", "--name-only", "-z", revision, "--"])).split("\0"),
    ...(await git(target, ["ls-files", "--others", "--exclude-standard", "-z"])).split("\0")].filter(Boolean);
  for (const file of new Set(drift)) {
    if (administrative(file)) drifted.push(file);
    else if (inScope(file)) issues.push({path:file, code:'product-drift',
      next_action:'Preserve the change; commit and verify a new candidate, or keep unrelated generated output outside the write roots.'});
  }
  return {issues, administrative: drifted};
}
/** Committed changes split into product files and administrative `.ai-org/` records. */
async function changedFiles(target, from, revision) {
  const product = [], records = [];
  for (const file of (await git(target, ["diff", "--no-renames", "--name-only", "-z", from, revision, "--"])).split("\0").filter(Boolean))
    (administrative(file) ? records : product).push(file);
  return { product, administrative: records };
}
/** Risk spans every change since the first claim that was never accepted, so a
 * rejected or released attempt cannot hide its paths behind a newer claim base. */
async function deliveryRisk(target, item, policy, revision) {
  const first = item.attempts[0]?.base_revision ?? item.base_revision;
  const from = first === item.base_revision ? first : (await git(target, ["merge-base", first, revision])).trim();
  const span = await changedFiles(target, from, revision);
  return { ...candidateRisk(policy, span.product, span.administrative), compared_from: from };
}
async function assertCandidate(target, item, revision, options = {}) {
  const {issues} = await candidateFiles(target,item,revision,options);
  if (issues.length) throw new Error(`${CANDIDATE_MESSAGES[issues[0].code]}: ${JSON.stringify(issues[0].path)}`);
}

/** Read-only file diagnostics, not a rehearsal of authority, review or acceptance. */
export async function inspectTaskCandidate(targetInput, id, input) {
  input=knownFields(input,['action','request']);
  if (!['handoff','review','close'].includes(input.action)) throw new Error('Candidate inspection action must be handoff, review or close');
  const request=assertRequest(input.request,FIELDS[input.action]);
  const target=await fs.realpath(targetInput),item=await readNativeTask(target,id);
  if (request.expected_version!==item.version) throw new Error('Stale expected version; inspect current task before retrying');
  if (!Array.isArray(request.evidence) || request.evidence.length>64 || request.evidence.some(ref=>typeof ref!=='string')) throw new Error('Bounded evidence paths are required');
  const revision=input.action==='handoff'?await exactRevision(target,request.revision):await deliveredRevision(target,item,request.revision);
  if (!revision) throw new Error('Candidate must match the delivered revision');
  const out=await candidateFiles(target,item,revision,{handoff:input.action==='handoff'});
  return {schema_version:'workkeel.candidate-files/v1',authority:'observation-only',mutation_status:'no-write',execution_authorized:false,
    task_id:id,task_version:item.version,action:input.action,candidate_revision:revision,candidate_files_passed:out.issues.length===0,
    issues:out.issues.slice(0,128),issue_count:out.issues.length,administrative_paths:out.administrative.slice(0,128),administrative_count:out.administrative.length,
    truncated:out.issues.length>128||out.administrative.length>128,lifecycle_validation:'not-performed',full_verification:'not-run',actual_review:'not-performed',
    limitations:['Only candidate files were inspected. This does not authorize or perform a lifecycle operation.',
      'The actual operation rechecks current authority, version, claim, dependencies, evidence and reviewer separation.',
      'Files may change after inspection; preserve the exact candidate and recheck at the operation.']};
}
async function assertDelivery(target, item) {
  if (!item.delivery) throw new Error("No delivered candidate");
  await assertCandidate(target, item, item.delivery.revision);
  await dependencies(target, item);
}
function assertSeparation(item, actor, policy) {
  const implementer = item.delivery.implementer;
  if (actor.agent_id === implementer.agent_id || item.contract.verification.separation === "distinct-principal" &&
      actor.principal_id === implementer.principal_id) throw new Error("Reviewer identity does not meet separation policy");
  if (!elevatedRisk(effectiveRisk(item))) return;
  const family = who => policy.agents.find(a => a.agent_id === who.agent_id)?.model_family;
  if (!family(actor) || !family(implementer) || family(actor) === family(implementer)) throw new Error("High-risk review requires a registered reviewer Agent from a different model family");
}

/** Read-only recheck for an approved review retry. It grants no claim, review or acceptance. */
export async function assertReviewRecoveryContext(target, id, { approver, reviewer, revision, expected_version }) {
  const project = await readTaskProject(target);
  const item = await readNativeTask(target, id);
  assertApprover(project.policy, approver); assertActor(project.policy, reviewer);
  if (item.version !== expected_version) throw new Error("Stale expected version; inspect current task before retrying");
  if (TERMINAL.has(item.state) || item.state === "release_gate") throw new Error("Accepted or terminal tasks cannot resume review");
  if (item.review) throw new Error(item.review.judgment === "fail" ? "An authored failing review uses ordinary rework" : "Task already has an authored review");
  if (item.state !== "test" || !item.delivery) throw new Error("Review recovery requires a delivered candidate awaiting review");
  if (revision !== item.delivery.revision) throw new Error("Review recovery must use the exact delivered candidate");
  assertSeparation(item, reviewer, project.policy);
  await context(target, item, project);
  await assertDelivery(target, item);
  return item;
}
/** Elevated review needs the reviewer's own record of this exact candidate,
 * not a renamed copy of anything the implementer delivered. */
function assertReviewReport(item, request, files) {
  const delivered = new Set([item.delivery, ...item.attempts.map(a => a.delivery)].flatMap(d => d?.evidence ?? []).map(p => p.path));
  for (const file of files) {
    // The candidate is the implementer's commit, so the report is a separate .ai-org/ record.
    if (!file.path.endsWith(".json") || file.source !== "workspace" || delivered.has(file.path)) continue;
    let report;
    try { report = JSON.parse(file.content); } catch { continue; }
    if (report?.schema_version === "workkeel.review-report/v1" && report.task_id === item.id &&
        report.stage === "review" && report.revision === request.revision && report.judgment === request.judgment &&
        sameActor(report.reviewer, request.actor) && typeof report.summary === "string" && report.summary.trim()) return;
  }
  throw new Error("High-risk review requires the reviewer's own workkeel.review-report/v1 evidence naming this task, candidate, reviewer and judgment");
}
/** High and critical work is reviewed by another model family, then confirmed by the approving Principal, however many Principals the project has. */
async function assertElevatedClose(target, item, policy, actor) {
  const tier = effectiveRisk(item);
  if (!elevatedRisk(tier)) return;
  if (actor.principal_id !== item.contract.authorization.approved_by) throw new Error("High-risk close must be performed by the task's approving Principal");
  if (tier !== "critical") return;
  if (!item.delivery.rollback) throw new Error("Critical close requires the rollback plan delivered at handoff");
  // Compare the candidate's own blob with the pinned approval; worktree state and
  // index flags such as skip-worktree cannot stand in for the committed record.
  const ref = item.contract.authorization.approval_ref, pin = item.authority_pins.find(p => p.path === ref);
  // Same strict UTF-8 and BOM rule as the pinned read, applied to the raw blob bytes.
  let blob = null;
  try { blob = new TextDecoder("utf-8", { fatal: true }).decode(await readNativeGit(target, ["cat-file", "blob", `${item.delivery.revision}:${ref}`], { encoding: "buffer" })); } catch {}
  if (blob === null || !pin || sha256(blob) !== pin.sha256) throw new Error("Critical close requires the approval record committed in the candidate with its approved content");
}
async function recoveryChain(target, item) {
  const { readReviewRecoveryChain } = await import("./workkeel-review-recovery.mjs");
  return readReviewRecoveryChain(target, item);
}

const FIELDS = {
  claim: ["base_revision"], release: ["claim_id", "summary"],
  handoff: ["claim_id", "revision", "summary", "evidence", "unresolved", "rollback"],
  review: ["revision", "judgment", "summary", "evidence", "review_attempt_id"],
  rework: ["summary", "mode"], close: ["revision", "summary", "rollback", "evidence"], cancel: ["summary", "evidence"]
};
export async function mutateNativeTask(targetInput, id, action, request) {
  if (action !== "cancel") await assertLoopAdmission(targetInput);
  if (!Object.hasOwn(FIELDS, action)) throw new Error("Unknown task operation");
  request = assertRequest(request, FIELDS[action]);
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
      const base = await exactRevision(target, request.base_revision);
      if ((await git(target, ["rev-parse", "HEAD"])).trim() !== base) throw new Error("Claim base must equal current HEAD");
      const pins = await dependencies(target, { ...item, base_revision: base });
      for (const active of await listTaskItems(target)) if (active.id !== id && active.mode === "task-first" && active.state === "build") {
        const other = await readNativeTask(target, active.id);
        if (item.contract.environment.write_paths.some(a => other.contract.environment.write_paths.some(b => under(a,b) || under(b,a)))) throw new Error("An active task holds overlapping write roots");
      }
      item.claim = { id: `claim-${crypto.randomUUID()}`, actor: request.actor, at: new Date().toISOString() };
      item.base_revision = base; item.dependency_pins = pins; item.state = "build";
    } else if (["handoff", "release"].includes(action)) {
      if (item.state !== "build" || !item.claim || item.claim.id !== request.claim_id || !sameActor(item.claim.actor, request.actor)) throw new Error("Operation requires the current matching implementation claim");
      assertText(request.summary);
      if (action === "release") {
        item.attempts.push({ kind: "released", claim: item.claim, base_revision: item.base_revision, summary: request.summary });
        item.claim = null; item.state = "intake"; item.dependency_pins = null;
      } else {
        if (!Array.isArray(request.unresolved) || request.unresolved.length > 32 ||
            request.unresolved.some(x => typeof x !== "string" || !x.trim() || x.length > 1000)) throw new Error("Unresolved issues must be a bounded list of nonempty notes");
        const revision = await exactRevision(target, request.revision);
        // Every rework, source or evidence-only, is a new commit.
        if (item.attempts.some(a => a.kind === "rejected" && a.delivery.revision === revision)) throw new Error("Rework requires a new commit, not the rejected revision");
        await assertCandidate(target, item, revision, { handoff: true });
        await dependencies(target, item);
        // Actually changed paths can raise, never lower, the approved tier.
        const declared = item.contract.verification.risk_tier, observed = await deliveryRisk(target, item, project.policy, revision);
        // A rejected attempt's tier persists even if its risky change was withdrawn.
        const prior = effectiveRisk(item), tier = maxRisk(declared, observed.tier, prior);
        if (tier === "critical" && request.unresolved.length) throw new Error("Critical work cannot be delivered with unresolved issues");
        await assertRequirementOutcomes(target, item, { ...request, revision }, 'delivery');
        const delivered = refsOf(await readEvidence(target, request.evidence, revision, { required: tier !== "low" }));
        // Escalating to critical needs the pinned approval record that close will compare.
        assertCriticalApprovalRecord(tier, item.contract);
        if (request.rollback !== undefined || tier === "critical") {
          try { assertText(request.rollback); }
          catch { throw new Error(`Critical handoff.rollback must state bounded nonempty rollback steps${tier === declared ? "" : ` (escalated from ${declared})`}`); }
        }
        item.delivery = { revision, summary: request.summary, implementer: request.actor,
          claim_id: item.claim.id, evidence: delivered, ...(request.unresolved.length ? { unresolved: [...request.unresolved] } : {}),
          ...(request.rollback !== undefined ? { rollback: request.rollback } : {}),
          ...(tier !== declared ? { risk: { tier, escalated_from: declared, paths: observed.paths, compared_from: observed.compared_from,
            basis: "All changes since the first unaccepted claim base; this can include other work merged meanwhile.",
            ...(maxRisk(observed.tier, prior) !== observed.tier ? { retained_from_attempts: prior } : {}) } } : {}) };
        item.claim = null; item.state = "test";
      }
    } else if (action === "review") {
      if (item.state !== "test" || item.review) throw new Error("Task is not awaiting a review");
      if (!["pass", "fail"].includes(request.judgment)) throw new Error("Review requires pass or fail");
      assertSeparation(item, request.actor, project.policy);
      const revision = await deliveredRevision(target, item, request.revision);
      if (!revision) throw new Error("Review must match the exact delivered candidate; an abbreviation must name exactly one commit");
      // After a recovery, only the current completed attempt's reviewer can author
      // the verdict; a predecessor's late result is never accepted.
      const chain = await recoveryChain(target, item), attempt = chain.head;
      if (attempt ? request.review_attempt_id !== attempt.value.attempt_id : request.review_attempt_id !== undefined) throw new Error("Review must name the current review recovery attempt, if any");
      if (attempt && (attempt.result?.value.status !== "completed" || !sameActor(attempt.value.reviewer, request.actor) ||
          attempt.value.revision !== revision)) throw new Error("Review recovery attempt is not completed by this reviewer for this candidate");
      await assertDelivery(target, item); assertText(request.summary);
      // A review's evidence may be its summary alone; the validated report is the same read.
      const reviewed = await readEvidence(target, request.evidence, revision);
      if (elevatedRisk(effectiveRisk(item))) assertReviewReport(item, { ...request, revision }, reviewed);
      if (request.judgment === 'pass') {
        // The reviewer decides on standard work; high and critical never pass with open issues.
        if (elevatedRisk(effectiveRisk(item)) && item.delivery.unresolved?.length) throw new Error("High-risk review cannot pass while the delivery lists unresolved issues");
        await assertRequirementOutcomes(target, item, {revision:item.delivery.revision,actor:item.delivery.implementer,evidence:item.delivery.evidence.map(p=>p.path)}, 'delivery');
        await assertRequirementOutcomes(target, item, { ...request, revision }, 'review');
      }
      item.review = { actor: request.actor, revision, judgment: request.judgment,
        summary: request.summary, evidence: refsOf(reviewed),
        // A recovered review names the attempt it completed and that attempt's commit.
        ...(attempt ? { attempt_id: attempt.value.attempt_id, attempt_revision: attempt.value.revision } : {}) };
      if (request.judgment === "pass") item.state = "release_gate";
    } else if (action === "rework") {
      assertApprover(project.policy, request.actor); assertText(request.summary);
      if (request.mode !== undefined && !["source", "evidence-only"].includes(request.mode)) throw new Error("Unknown rework mode");
      if (item.state !== "test" || item.review?.judgment !== "fail") throw new Error("Rework requires a failed review and preserves the same approved contract");
      const tier = effectiveRisk(item), rounds = item.attempts.filter(a => a.kind === "rejected").length;
      if (rounds >= MAX_REWORKS[tier]) throw new Error(`Rework limit reached for ${tier} risk (${MAX_REWORKS[tier]} rounds); stop and ask the human to re-scope, approve a new task or cancel`);
      item.attempts.push({ kind: "rejected", base_revision: item.base_revision, delivery: item.delivery, review: item.review, summary: request.summary,
        ...(request.mode ? { rework_mode: request.mode } : {}) });
      item.delivery = null; item.review = null; item.claim = null; item.state = "intake"; item.dependency_pins = null;
    } else if (action === "close") {
      assertApprover(project.policy, request.actor);
      const revision = await deliveredRevision(target, item, request.revision);
      if (item.state !== "release_gate" || item.review?.judgment !== "pass" || !revision) throw new Error("Close requires the independently accepted exact candidate");
      // The current recovery attempt must still be the completed one the review named, on the same commit.
      const attempt = (await recoveryChain(target, item)).head, reviewed = item.review;
      if ((attempt?.value.attempt_id ?? null) !== (reviewed.attempt_id ?? null) || attempt && (attempt.result?.value.status !== "completed" ||
          attempt.value.revision !== reviewed.attempt_revision || reviewed.attempt_revision !== revision)) throw new Error("Review recovery chain changed after the authored review");
      await assertDelivery(target, item);
      await assertElevatedClose(target, item, project.policy, request.actor);
      await assertRequirementOutcomes(target, item, {revision: item.delivery.revision, actor: item.delivery.implementer, evidence: item.delivery.evidence.map(p => p.path)}, 'delivery');
      await assertRequirementOutcomes(target, item, {revision: item.review.revision, actor: item.review.actor, judgment: item.review.judgment, evidence: item.review.evidence.map(p => p.path)}, 'review');
      assertText(request.summary); assertText(request.rollback);
      item.closeout = { actor: request.actor, revision, summary: request.summary,
        rollback: request.rollback, evidence: refsOf(await readEvidence(target, request.evidence, revision)), external_release: "not-performed" };
      item.state = "done";
    } else {
      assertApprover(project.policy, request.actor); assertText(request.summary);
      item.closeout = { actor: request.actor, summary: request.summary, evidence: refsOf(await readEvidence(target, request.evidence, item.delivery?.revision ?? null)), external_release: "not-performed" };
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
    items = await listTaskItems(target);
    for (const summary of items.filter(i => i.mode === "task-first")) {
      const item = await readNativeTask(target, summary.id);
      // Every record's structure was checked on read. Only active tasks are checked
      // against current policy and scope; edited approval or evidence files and
      // closed tasks are never re-verified.
      if (TERMINAL.has(item.state)) continue;
      try { await context(target, item, project); } catch (e) { errors.push({ id: item.id, message: e.message }); }
    }
  } catch (e) { errors.push({ message: e.message }); }
  return { schema_version: "workkeel.diagnostics/v1", valid: errors.length === 0, errors, tasks: items,
    authority: "observation-only", mutation_status: "no-write", execution_authorized: false, boundary_enforcement: "host-responsibility" };
}
