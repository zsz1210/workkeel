import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { durableAtomicWrite, durableAtomicCreate, formatJson, sha256 } from "./files.mjs";
import { isWorkItemId } from "./ids.mjs";
import { loadProjectContext, uniqueStrings } from "./project.mjs";
import { agentIsEligible, readCollaborationState, sponsoredPrincipal } from "./collaboration.mjs";
import { resolveProjectActor } from "./actor-resolution.mjs";
import { assessWorkflowProfile, workflowProfileForItem } from "./workflow.mjs";
import { resolveGitRevision, validateEvidenceArtifacts, validateEvidenceRegistry } from "./evidence.mjs";
import { activeExecutionRequirements, readWorkItem, prepareHandoff, prepareClaimRelease, prepareWorkItemTransition } from "./work-items.mjs";
import { leanDeliveryStateDirectory, readPendingLeanDelivery } from "./lean-delivery-state.mjs";
import { OperationError } from "./operation-errors.mjs";
import { verifyMechanicalCompletion } from "./mechanical-completion.mjs";
import { workflowRequest, prepareWorkflowStage } from "./workflow-completion.mjs";
import { finishObservationPath } from "./portable-finish-diagnostics.mjs";

const OPERATION = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const JOURNAL_SCHEMA = "temple.lean-delivery-journal/v1";
const RECEIPT_SCHEMA = "temple.lean-delivery-receipt/v1";
const EVENTS = ".ai-org/events/events.jsonl";

function safeRelative(value) {
  return typeof value === "string" && value.length > 0 && value !== "." && value !== ".." &&
    !path.isAbsolute(value) && !path.win32.isAbsolute(value) && !value.includes("\\") &&
    !value.includes("\0") && !value.startsWith("../") && path.posix.normalize(value) === value;
}

async function fileBytes(target, relative, allowMissing = false) {
  if (!safeRelative(relative)) throw new Error(`Unsafe Lean delivery path: ${relative}`);
  let current = target;
  const parts = relative.split("/");
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    let stat;
    try { stat = await fs.lstat(current); } catch (error) {
      if (allowMissing && error.code === "ENOENT") return null;
      if (error.code === "ENOENT") throw new Error(`Lean delivery input is missing: ${relative}`);
      throw error;
    }
    if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) {
      throw new Error(`Lean delivery requires regular repository files: ${relative}`);
    }
  }
  return fs.readFile(current);
}

const hashBytes = (bytes) => bytes === null ? null : sha256(bytes);

function normalizedRequest(target, options, finish = false) {
  if (!isWorkItemId(options.workItemId)) throw new OperationError("INVALID_INPUT", "Lean delivery requires a valid --work-item");
  if (!OPERATION.test(options.operationId ?? "")) throw new OperationError("INVALID_INPUT", "--operation-id must be 1-64 letters, digits, underscores, or hyphens");
  if (options.expectedPlan !== undefined && !/^[a-f0-9]{64}$/.test(options.expectedPlan)) throw new OperationError("INVALID_INPUT", "--expected-plan must be a SHA-256 digest");
  for (const key of ["claimId", "agentId", "principalId", "revision"]) {
    if (typeof options[key] !== "string" || !options[key].trim()) throw new OperationError("INVALID_INPUT", `Lean delivery requires ${key}`);
  }
  const request = {
    schema_version: "temple.lean-delivery-request/v1",
    operation_id: options.operationId,
    work_item_id: options.workItemId,
    claim_id: options.claimId.trim(),
    agent_id: options.agentId.trim(),
    principal_id: options.principalId.trim(),
    candidate_revision: resolveGitRevision(target, options.revision),
    completed: uniqueStrings(options.completed),
    evidence: uniqueStrings(options.evidence),
    unresolved: uniqueStrings(options.unresolved)
  };
  if (finish && options.workflowStage !== undefined) return workflowRequest(target, options, request);
  if (finish) {
    if (!["developer", "quality_evaluator"].includes(options.position)) throw new OperationError("INVALID_INPUT", "Lean finish requires --position developer or quality_evaluator");
    request.schema_version = "temple.lean-finish-request/v1";
    request.position = options.position;
    if (options.mechanicalContract !== undefined) {
      if (options.position !== "developer" || request.completed.length || request.evidence.length || request.unresolved.length) throw new OperationError("INVALID_INPUT", "Mechanical finish accepts the approved contract, not caller-authored completion or evidence");
      request.mechanical_contract = options.mechanicalContract;
      request.completed = ["Exact preapproved text replacement verified mechanically; no independent QA claimed."];
      request.evidence = [options.mechanicalContract];
    }
    if (options.position === "quality_evaluator") {
      request.judgment = options.judgment;
      request.test_evidence = uniqueStrings(options.testEvidence);
      request.lean_closeout = uniqueStrings(options.leanCloseout);
      if (request.judgment !== "pass" || !request.test_evidence.length || !request.lean_closeout.length || request.unresolved.length || request.completed.length || request.evidence.length) throw new OperationError("INVALID_INPUT", "Verifier finish requires --judgment pass, --test-evidence and --lean-closeout, without Developer fields or unresolved work");
      request.evidence = uniqueStrings([...request.test_evidence, ...request.lean_closeout]);
    } else if (options.judgment !== undefined || options.testEvidence?.length || options.leanCloseout?.length) throw new OperationError("INVALID_INPUT", "Developer finish does not accept Verifier judgment or gates");
  }
  if (request.position !== "quality_evaluator" && (!request.completed.length || !request.evidence.length)) throw new OperationError("INVALID_INPUT", "Lean delivery requires --completed and --evidence");
  return request;
}

function git(target, args) {
  const result = spawnSync("git", ["-C", target, ...args], { encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
  if (result.status !== 0) throw new Error(result.stderr.trim() || "Git inspection failed");
  return result.stdout;
}

export function requireProductScope(affectedPaths) {
  const productPaths = affectedPaths.filter((entry) => entry !== ".ai-org" && !entry.startsWith(".ai-org/"));
  if (!productPaths.length) throw new Error("Delivery requires a declared affected product scope outside .ai-org; use the ordinary Work Item lifecycle for organization-only work");
  return productPaths;
}

// Shared by ordinary completion and diagnostics-only recovery. Git status alone
// cannot detect working bytes hidden by assume-unchanged or skip-worktree.
export async function assertWorkingProduct(target, revision, paths) {
  if (!paths.length || paths.some(p => !safeRelative(p))) throw new Error("Unsafe product scope");
  const algorithm = git(target, ["rev-parse", "--show-object-format"]).trim();
  if (!["sha1", "sha256"].includes(algorithm)) throw new Error("Unsupported product Git object format");
  const expected = new Map();
  // NUL records preserve tabs/newlines; literal paths never act as Git patterns.
  for (const row of git(target, ["--literal-pathspecs", "ls-tree", "-r", "-z", "--full-tree", revision, "--", ...paths]).split("\0").filter(Boolean)) {
    const tab = row.indexOf("\t"), file = row.slice(tab + 1);
    if (!paths.some(p => file === p || file.startsWith(`${p}/`))) continue;
    const [mode, type, oid] = row.slice(0, tab).split(" ");
    if (tab < 0 || type !== "blob" || !["100644", "100755"].includes(mode)) throw new Error("Product scope requires regular Git files");
    expected.set(file, { mode, oid });
  }
  const seen = new Set(), visited = new Set();
  async function walk(file) {
    if (visited.has(file)) return;
    visited.add(file);
    let current = target, stat;
    const parts = file.split("/");
    for (const [index, part] of parts.entries()) {
      current = path.join(current, part);
      stat = await fs.lstat(current).catch(error => { if (error.code === "ENOENT") return null; throw error; });
      if (!stat) return;
      if (stat.isSymbolicLink() || (index < parts.length - 1 && !stat.isDirectory())) throw new Error("Unsafe product scope path");
    }
    if (stat.isDirectory()) {
      for (const name of await fs.readdir(current)) await walk(`${file}/${name}`);
      return;
    }
    const entry = expected.get(file);
    if (!stat.isFile() || !entry) throw new Error("Product scope changed: unexpected filesystem entry");
    const body = await fileBytes(target, file);
    const oid = createHash(algorithm).update(`blob ${body.length}\0`).update(body).digest("hex");
    const mode = stat.mode & 0o111 ? "100755" : "100644";
    if (oid !== entry.oid || mode !== entry.mode) throw new Error("Product scope changed: actual bytes or mode differ from candidate");
    seen.add(file);
  }
  for (const file of paths) await walk(file);
  if (seen.size !== expected.size) throw new Error("Product scope changed: candidate file is missing");
}

async function assertCandidate(target, request, affectedPaths, { recovery = false, evidenceReferences = [], gateEvidence = {} } = {}) {
  const productPaths = requireProductScope(affectedPaths);
  if (git(target, ["--literal-pathspecs", "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...productPaths])) {
    throw new Error("Lean delivery affected product scope has uncommitted changes");
  }
  await assertWorkingProduct(target, request.candidate_revision, productPaths);
  // Scope/approval inputs remain authority even inside this item's artifact
  // directory. Resolve normalized evidence too; directory ownership cannot turn
  // an authority input into mutable delivery administration.
  const protectedGates = Object.fromEntries(Object.entries(gateEvidence)
    .filter(([gate]) => !["developer_evidence", "developer_handoff", "test_evidence", "lean_closeout"].includes(gate)));
  const protectedEvidence = await currentEvidencePaths(target,
    { id: request.work_item_id, gate_evidence: protectedGates }, { ...request, evidence: [] });
  const committedAuthority = [...protectedEvidence].filter(ref =>
    git(target, ["--literal-pathspecs", "ls-tree", "--name-only", request.candidate_revision, "--", ref]).trim());
  // Index flags must not hide physical changes to the pre-candidate authority.
  if (committedAuthority.length) await assertWorkingProduct(target, request.candidate_revision, committedAuthority);
  if (resolveGitRevision(target, "HEAD") === request.candidate_revision) return;
  const reject = () => { throw new Error("Lean delivery candidate must match current HEAD unless only bounded delivery administration follows the exact candidate; preserve the original revision and inspect the intervening diff"); };
  if (request.workflow_stage || request.mechanical_contract || !(request.position === "quality_evaluator" || recovery)) reject();
  if (git(target, ["merge-base", request.candidate_revision, "HEAD"]).trim() !== request.candidate_revision) reject();
  if (git(target, ["--literal-pathspecs", "diff", "--name-only", "-z", request.candidate_revision, "HEAD", "--", ...productPaths])) reject();
  const itemRoot = `.ai-org/artifacts/${request.work_item_id}/`;
  const candidatePaths = new Set(git(target, ["--literal-pathspecs", "ls-tree", "-r", "--name-only", "-z", request.candidate_revision,
    "--", itemRoot]).split("\0").filter(Boolean));
  const declaredEvidence = await currentEvidencePaths(target,
    { id: request.work_item_id, gate_evidence: gateEvidence }, request);
  for (const ref of evidenceReferences.filter(safeRelative)) declaredEvidence.add(ref);
  const artifactAllowed = name => name.startsWith(itemRoot) && !candidatePaths.has(name) &&
    (declaredEvidence.has(name) || /^(finish(?:-recovery)?|diagnostics)-[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\.json$/.test(name.slice(itemRoot.length)));
  const evidence = new Set([...request.evidence, ...evidenceReferences].filter(ref => safeRelative(ref) &&
    /^(docs|evidence)\/.+\.md$/.test(ref) && !/(^|\/)(AGENTS|CLAUDE|TEMPLE)\.md$/.test(ref) &&
    !git(target, ["--literal-pathspecs", "ls-tree", "--name-only", request.candidate_revision, "--", ref]).trim()));
  const allowed = name => !protectedEvidence.has(name) &&
    !/(^|\/)(AGENTS|CLAUDE|TEMPLE)\.md$/.test(name) &&
    (name === `.ai-org/work-items/${request.work_item_id}.json` || name === EVENTS ||
      artifactAllowed(name) || name.startsWith(".ai-org/views/") || evidence.has(name));
  const changed = git(target, ["diff", "--no-renames", "--name-only", "-z", request.candidate_revision, "HEAD"]).split("\0").filter(Boolean);
  if (changed.some(name => !allowed(name))) reject();
  // A reverted source/policy commit is not an administration-only history. Check
  // every parent edge, including merges, instead of trusting only the net tree.
  const commits = git(target, ["rev-list", `${request.candidate_revision}..HEAD`]).trim().split("\n").filter(Boolean);
  for (const commit of commits) {
    const paths = git(target, ["diff-tree", "--root", "-m", "--no-commit-id", "--no-renames", "--name-only", "-r", "-z", commit]).split("\0").filter(Boolean);
    if (paths.some(name => !allowed(name))) reject();
  }
  const dirty = [git(target, ["diff", "--no-renames", "--name-only", "-z", "HEAD"]),
    git(target, ["ls-files", "--others", "--exclude-standard", "-z"])].flatMap(output => output.split("\0").filter(Boolean));
  if (dirty.some(name => !allowed(name))) reject();
}

async function inputSnapshot(target, item, request, mechanical = null) {
  const paths = new Set([
    "temple.lock", ".ai-org/project/project.json", ".ai-org/project/agents.json",
    ".ai-org/project/assignments.json", ".ai-org/project/collaboration.json",
    ".ai-org/project/spec-index.json", ".ai-org/project/evidence.json",
    ".ai-org/project/runtime-workers.json", ".ai-org/project/resources.json",
    ".ai-org/core/positions.json", ".ai-org/core/workflow.json", ".ai-org/core/policies.json",
    `.ai-org/work-items/${item.id}.json`, EVENTS
  ]);
  for (const relative of mechanical?.input_paths ?? []) paths.add(relative);
  if (request.position) for (const relative of ["AGENTS.md", "TEMPLE.md", ".agents/skills/temple-work/SKILL.md", ".agents/skills/temple-work/references/lean-delivery.md", ".agents/skills/temple-work/references/assurance-and-recovery.md", ".ai-org/core/high-assurance.json", ".ai-org/core/ui-design.json", ".ai-org/project/usage-policy.json", ".ai-org/project/repository-integration.json"]) paths.add(relative);
  for (const relative of await currentEvidencePaths(target, item, request)) paths.add(relative);
  const specs = JSON.parse(await fileBytes(target, ".ai-org/project/spec-index.json"));
  const ids = new Set([...(item.spec_refs ?? []), ...(item.ux_refs ?? []), ...(item.ui_refs ?? []), ...(item.contract_refs ?? [])].map((entry) => entry.id));
  for (const entry of specs.entries ?? []) {
    if (!ids.has(entry.id)) continue;
    if (entry.source?.kind === "repository") paths.add(entry.source.location);
    if (entry.approval_ref && safeRelative(entry.approval_ref)) paths.add(entry.approval_ref);
  }
  const inputs = [];
  for (const relative of [...paths].sort()) {
    const optional = relative.endsWith("runtime-workers.json") || relative.endsWith("resources.json");
    inputs.push({ path: relative, sha256: hashBytes(await fileBytes(target, relative, optional)) });
  }
  return inputs;
}

async function currentEvidencePaths(target, item, request) {
  const paths = new Set();
  const registry = JSON.parse(await fileBytes(target, ".ai-org/project/evidence.json"));
  const refs = uniqueStrings([...request.evidence, ...Object.values(item.gate_evidence ?? {}).flat()]);
  for (const reference of refs) {
    if (reference.startsWith("EVID-")) {
      const entry = registry.entries?.find((value) => value.id === reference);
      if (!entry || entry.work_item_id !== item.id || entry.invalidated_at || (entry.expires_at && Date.parse(entry.expires_at) <= Date.now())) {
        throw new Error(`Lean delivery evidence is unavailable or not current: ${reference}`);
      }
      const structure = validateEvidenceRegistry({ schema_version: registry.schema_version, entries: [entry] });
      if (!structure.valid) throw new Error(`Invalid Lean delivery evidence: ${structure.errors.join("; ")}`);
      if (request.evidence.includes(reference) && entry.scope_revision && entry.scope_revision !== request.candidate_revision) {
        throw new Error(`Lean delivery evidence revision does not match candidate: ${reference}`);
      }
      const validation = await validateEvidenceArtifacts(target, { entries: [entry] });
      if (!validation.valid) throw new Error(validation.errors.join("; "));
      for (const artifact of entry.artifacts ?? []) paths.add(artifact.path);
    } else if (safeRelative(reference) && !/^[a-z][a-z0-9+.-]*:/i.test(reference)) paths.add(reference);
    else throw new Error(`Lean delivery requires local or normalized evidence: ${reference}`);
  }
  return paths;
}

async function assertInputs(target, inputs, writes = []) {
  const outputs = new Map(writes.map((entry) => [entry.path, entry]));
  for (const input of inputs) {
    if (outputs.has(input.path)) continue;
    if (hashBytes(await fileBytes(target, input.path, input.sha256 === null)) !== input.sha256) {
      throw new Error(`Lean delivery input changed: ${input.path}`);
    }
  }
  for (const write of writes) {
    const actual = hashBytes(await fileBytes(target, write.path, true));
    if (actual !== write.before_sha256 && actual !== write.after_sha256) {
      throw new Error(`Lean delivery output changed unexpectedly: ${write.path}`);
    }
  }
}

async function prepareDelivery(target, request) {
  if (request.workflow_stage) return prepareAutonomousDelivery(target, request);
  const context = await loadProjectContext(target);
  const item = await readWorkItem(target, request.work_item_id);
  const position = request.position ?? "developer";
  const stage = position === "developer" ? "build" : "test";
  const finishing = Boolean(request.position);
  const accepting = position === "quality_evaluator";
  if (item.state !== stage || item.owner_position !== position || workflowProfileForItem(context.workflow, item) !== "lean") {
    throw new Error(`Lean completion requires a Lean Work Item at ${position} ${stage}`);
  }
  const assessment = assessWorkflowProfile(context.workflow, {
    requestedProfile: "lean", riskTier: item.risk_tier,
    scopeClass: item.profile_assessment?.scope_class,
    escalationTriggers: item.profile_assessment?.escalation_triggers,
    collaborationProfile: (await readCollaborationState(target)).profile
  });
  if (assessment.effective_profile !== "lean" || item.risk_tier !== "low" || item.profile_assessment?.scope_class !== "bounded" || item.ui_delivery_mode !== "not-applicable") {
    throw new Error("Lean delivery requires low-risk bounded work with no interface delivery");
  }
  if (item.claim?.status !== "active" || item.claim.id !== request.claim_id || item.claim.agent_id !== request.agent_id || item.claim.principal_id !== request.principal_id) {
    throw new Error("Lean delivery actor or active claim does not match request");
  }
  const collaboration = await readCollaborationState(target);
  if (!context.agents.has(request.agent_id) || context.agents.get(request.agent_id).active === false || !agentIsEligible(collaboration, request.agent_id, position, activeExecutionRequirements(item, stage).disciplines)) {
    throw new Error(`Lean completion Agent is not eligible for ${position}`);
  }
  await resolveProjectActor(target, context, { collaboration, item, positionId: position,
    agentId: request.agent_id, principalId: request.principal_id,
    requiredDisciplines: activeExecutionRequirements(item, stage).disciplines });
  const workers = await fileBytes(target, ".ai-org/project/runtime-workers.json", true);
  if (workers && (JSON.parse(workers).workers ?? []).some((worker) => worker.work_item_id === item.id && !["completed", "failed", "cancelled"].includes(worker.status))) {
    throw new Error("Complete the runtime worker before Lean delivery");
  }
  await assertCandidate(target, request, item.affected_paths ?? [], { evidenceReferences: item.evidence ?? [], gateEvidence: item.gate_evidence });
  if (accepting && resolveGitRevision(target, item.claim.base_revision) !== request.candidate_revision) throw new Error("Lean Verifier claim must pin the exact candidate");
  if (accepting) {
    const handoff = [...(item.handoffs ?? [])].reverse().find((entry) => entry.from_position === "developer");
    if (!handoff?.actor || handoff.actor === request.agent_id) throw new Error("Lean acceptance requires an Identity distinct from the Developer handoff author");
    if (resolveGitRevision(target, handoff.input_revision) !== request.candidate_revision || item.developer_candidate_revision !== request.candidate_revision) throw new Error("Lean acceptance candidate does not match the Developer handoff");
    if (item.unresolved?.length || handoff.unresolved?.length) throw new Error("Lean acceptance cannot close unresolved work");
  }
  const mechanical = request.mechanical_contract ? await verifyMechanicalCompletion(target, item, request) : null;
  const inputs = await inputSnapshot(target, item, request, mechanical);
  const handoff = accepting || mechanical ? null : await prepareHandoff(target, {
    workItemId: item.id, toPosition: "quality_evaluator", inputRevision: request.candidate_revision,
    completed: request.completed, evidence: request.evidence, unresolved: request.unresolved, actor: request.agent_id
  });
  const released = await prepareClaimRelease(target, {
    workItemId: item.id, agentId: request.agent_id, principalId: request.principal_id, reason: accepting ? "completed" : "developer_delivery"
  }, handoff?.item ?? item);
  const transition = await prepareWorkItemTransition(target, {
    workItemId: item.id, toState: accepting || mechanical ? "done" : "test", actor: request.agent_id,
    mechanicalRequest: mechanical ? request : undefined,
    satisfied: mechanical ? { mechanical_contract: request.evidence } : accepting ? { test_evidence: request.test_evidence, lean_closeout: request.lean_closeout } : { developer_handoff: [handoff.artifact], developer_evidence: request.evidence }
  }, handoff?.item ?? item, new Map(handoff ? [[handoff.artifact, handoff.content]] : []));
  // Validate transition while the originating actor still owns its active claim,
  // then retain the separately validated release fact in the final state.
  transition.item.claim = released.item.claim;
  transition.item.claims = released.item.claims;
  const receiptPath = `.ai-org/artifacts/${item.id}/${finishing ? "finish" : "delivery"}-${request.operation_id}.json`;
  const outputPaths = [...(handoff ? [handoff.artifact] : []), `.ai-org/work-items/${item.id}.json`, EVENTS, receiptPath];
  const requestDigest = sha256(formatJson(request));
  const planDigest = sha256(formatJson({ request, inputs, output_paths: outputPaths, affected_paths: item.affected_paths }));
  const result = {
    schema_version: finishing ? "temple.lean-finish-lifecycle/v1" : "temple.lean-delivery-result/v1", operation_id: request.operation_id,
    work_item_id: item.id, candidate_revision: request.candidate_revision,
    plan_digest: planDigest, handoff: handoff?.artifact ?? null, receipt: receiptPath,
    ...(mechanical ? { completion_kind: "mechanical", mechanical_check: mechanical } : {}),
    resulting_state: accepting || mechanical ? "done" : "test", next_action: mechanical ? "Exact-text mechanical completion recorded; not Independent QA or external release." : accepting ? "Lean acceptance is recorded; no external release is authorized." : "The assigned Quality Evaluator must claim Test and verify acceptance.",
    testing_performed: false, external_action_performed: false
  };
  const receipt = { schema_version: finishing ? "temple.lean-finish-receipt/v1" : RECEIPT_SCHEMA, request_digest: requestDigest, request, result, applied_at: transition.item.updated_at,
    ...(finishing ? { diagnostics_observation: finishObservationPath(item.id, request.operation_id) } : {}) };
  const beforeEvents = (await fileBytes(target, EVENTS)).toString("utf8");
  const events = [...(handoff?.events ?? []), ...released.events, ...transition.events];
  const contents = [...(handoff ? [handoff.content] : []), formatJson(transition.item), `${beforeEvents}${beforeEvents && !beforeEvents.endsWith("\n") ? "\n" : ""}${events.map((event) => JSON.stringify(event)).join("\n")}\n`, formatJson(receipt)];
  const writes = [];
  for (let index = 0; index < outputPaths.length; index++) {
    const before = await fileBytes(target, outputPaths[index], true);
    if (((handoff && index === 0) || index === outputPaths.length - 1) && before !== null) throw new Error(`Lean delivery output already exists: ${outputPaths[index]}`);
    writes.push({ path: outputPaths[index], before_sha256: hashBytes(before), after_sha256: sha256(contents[index]), content: contents[index] });
  }
  // Ensure all preparation reads still describe the original snapshot.
  await assertInputs(target, inputs);
  return { request, request_digest: requestDigest, plan_digest: planDigest, inputs, writes, result, affected_paths: item.affected_paths,
    ...(mechanical ? { mechanical_original: (await fileBytes(target, `.ai-org/work-items/${item.id}.json`)).toString("utf8") } : {}) };
}

async function prepareAutonomousDelivery(target, request) {
  const { item, prepared, artifact_kind, events } = await prepareWorkflowStage(target, request);
  const workers = await fileBytes(target, ".ai-org/project/runtime-workers.json", true);
  if (workers && JSON.parse(workers).workers.some(w => w.work_item_id === item.id && !["completed", "failed", "cancelled"].includes(w.status))) throw new Error("Complete runtime workers before autonomous completion");
  await assertCandidate(target, request, item.affected_paths ?? []);
  const inputs = await inputSnapshot(target, item, request);
  const receiptPath = `.ai-org/artifacts/${item.id}/finish-${request.operation_id}.json`;
  const outputPaths = [...(prepared.artifact ? [prepared.artifact] : []), `.ai-org/work-items/${item.id}.json`, EVENTS, receiptPath];
  const requestDigest = sha256(formatJson(request));
  const planDigest = sha256(formatJson({ request, inputs, output_paths: outputPaths, affected_paths: item.affected_paths }));
  const result = { schema_version: "temple.workflow-finish-lifecycle/v1", operation_id: request.operation_id, work_item_id: item.id,
    candidate_revision: request.candidate_revision, plan_digest: planDigest, handoff: artifact_kind === "handoff" ? prepared.artifact : null,
    artifact_kind, artifact: prepared.artifact ?? null, receipt: receiptPath, resulting_state: prepared.item.state,
    next_action: prepared.item.state === "done" ? "Organizational acceptance recorded; external actions remain separately authorized." : `Continue authorized work as ${prepared.item.owner_position}; do not request repeated routine approval.`,
    testing_performed: false, external_action_performed: false };
  const receipt = { schema_version: "temple.lean-finish-receipt/v1", request_digest: requestDigest, request, result, applied_at: prepared.item.updated_at,
    diagnostics_observation: finishObservationPath(item.id, request.operation_id) };
  const beforeEvents = (await fileBytes(target, EVENTS)).toString("utf8");
  const contents = [...(prepared.artifact ? [prepared.content] : []), formatJson(prepared.item), `${beforeEvents}${beforeEvents && !beforeEvents.endsWith("\n") ? "\n" : ""}${events.map(e => JSON.stringify(e)).join("\n")}\n`, formatJson(receipt)];
  const writes = [];
  for (let i = 0; i < outputPaths.length; i++) {
    const before = await fileBytes(target, outputPaths[i], true);
    if ((prepared.artifact && i === 0 || i === outputPaths.length - 1) && before !== null) throw new Error(`Completion output already exists: ${outputPaths[i]}`);
    writes.push({ path: outputPaths[i], before_sha256: hashBytes(before), after_sha256: sha256(contents[i]), content: contents[i] });
  }
  await assertInputs(target, inputs);
  return { request, request_digest: requestDigest, plan_digest: planDigest, inputs, writes, result, affected_paths: item.affected_paths };
}

function validateJournal(journal, target, request) {
  if (journal.schema_version !== JOURNAL_SCHEMA || journal.target !== target || journal.request_digest !== sha256(formatJson(request)) || journal.operation_key !== `${request.work_item_id}/${request.operation_id}`) {
    throw new Error("Lean delivery pending request conflicts with this operation");
  }
  const unified = Boolean(request.workflow_stage);
  const accepting = unified ? request.workflow_stage !== "build" : request.position === "quality_evaluator" || Boolean(request.mechanical_contract);
  const artifact = unified && request.workflow_stage === "release_gate" ? `.ai-org/artifacts/${request.work_item_id}/release-record.md` : null;
  const allowed = [...(accepting ? artifact ? [artifact] : [] : [journal.result?.handoff]), `.ai-org/work-items/${request.work_item_id}.json`, EVENTS, `.ai-org/artifacts/${request.work_item_id}/${request.position ? "finish" : "delivery"}-${request.operation_id}.json`];
  if ((!accepting && !new RegExp(`^\\.ai-org/artifacts/${request.work_item_id}/handoff-[0-9]+-developer-to-quality_evaluator\\.md$`).test(allowed[0] ?? "")) || !Array.isArray(journal.writes) || journal.writes.length !== allowed.length) throw new Error("Invalid Lean delivery journal outputs");
  for (let index = 0; index < allowed.length; index++) {
    const entry = journal.writes[index];
    if (entry.path !== allowed[index] || typeof entry.content !== "string" || sha256(entry.content) !== entry.after_sha256) throw new Error("Invalid Lean delivery journal digest or path");
  }
  if (!Array.isArray(journal.inputs) || !Array.isArray(journal.affected_paths)) throw new Error("Invalid Lean delivery journal inputs");
  if (request.mechanical_contract && (typeof journal.mechanical_original !== "string" ||
    sha256(journal.mechanical_original) !== journal.inputs.find(input => input.path === `.ai-org/work-items/${request.work_item_id}.json`)?.sha256)) {
    throw new Error("Mechanical recovery original Work Item is not bound to the input snapshot");
  }
}

export async function validateLeanCompletionReceipt(target, journal) {
  validateJournal(journal, target, journal.request);
  const write = journal.writes.at(-1);
  const receipt = JSON.parse(write.content);
  if (hashBytes(await fileBytes(target, write.path)) !== write.after_sha256 || receipt.request_digest !== journal.request_digest ||
    formatJson(receipt.request) !== formatJson(journal.request) || formatJson(receipt.result) !== formatJson(journal.result)) throw new Error("Lean finish diagnostic journal conflicts with canonical receipt");
}

export async function validateLeanCompletionSnapshot(target, journal, { applied = false } = {}) {
  validateJournal(journal, target, journal.request);
  const collaboration = await readCollaborationState(target);
  await resolveProjectActor(target, await loadProjectContext(target), { collaboration,
    positionId: journal.request.position ?? "developer", workflowProfile: "lean",
    agentId: journal.request.agent_id, principalId: journal.request.principal_id });
  // Time-dependent expiry must be checked again even when input bytes match.
  const resultingItem = JSON.parse(journal.writes.find((entry) => entry.path === `.ai-org/work-items/${journal.request.work_item_id}.json`).content);
  const position = journal.request.position ?? "developer";
  if (!agentIsEligible(collaboration, journal.request.agent_id, position, activeExecutionRequirements(resultingItem, journal.request.workflow_stage ?? (position === "developer" ? "build" : "test")).disciplines)) {
    throw new Error(`Lean completion Agent is no longer eligible for ${position}`);
  }
  await currentEvidencePaths(target, resultingItem, journal.request);
  await assertCandidate(target, journal.request, journal.affected_paths, { recovery: true, evidenceReferences: resultingItem.evidence ?? [], gateEvidence: resultingItem.gate_evidence });
  await assertInputs(target, journal.inputs, journal.writes);
  // Requalify filesystem modes, links and whole-worktree scope after interruption.
  // The original item is byte-bound above; current canonical state must separately
  // match the before/after journal snapshot, never an invented active claim.
  if (journal.request.mechanical_contract) await verifyMechanicalCompletion(target, JSON.parse(journal.mechanical_original), journal.request);
  if (applied) for (const write of journal.writes) {
    if (hashBytes(await fileBytes(target, write.path, true)) !== write.after_sha256) throw new Error(`Lean finish resulting state changed: ${write.path}`);
  }
}

async function applyJournal(target, directory, journal, { checkpoint, lifecycleApplied } = {}) {
  await validateLeanCompletionSnapshot(target, journal);
  for (let index = 0; index < journal.writes.length; index++) {
    const write = journal.writes[index];
    const actual = hashBytes(await fileBytes(target, write.path, true));
    if (actual === write.after_sha256) continue;
    if (actual !== write.before_sha256) throw new Error(`Lean delivery output changed: ${write.path}`);
    if (actual === null) await durableAtomicCreate(path.join(target, write.path), write.content);
    else await durableAtomicWrite(path.join(target, write.path), write.content);
    await checkpoint?.(`write-${index + 1}`);
  }
  await lifecycleApplied?.(journal);
  await fs.unlink(path.join(directory, "pending.json"));
}

// Call while holding the project mutation lock. Checkpoints are test-only injection,
// never CLI/environment options and never authority to bypass validation.
async function executeDelivery(target, options, hooks, state, finish) {
  target = await fs.realpath(target);
  const request = normalizedRequest(target, options, finish);
  const operationKey = `${request.work_item_id}/${request.operation_id}`;
  const pending = await readPendingLeanDelivery(target);
  if (pending) {
    state.phase = "pending_recovery";
    validateJournal(pending.journal, target, request);
    if (options.expectedPlan && options.expectedPlan !== pending.journal.plan_digest) throw new OperationError("STALE_PREVIEW", "Stale Lean delivery preview");
    if (options.dryRun) return { ...pending.journal.result, status: "recovery_required", dry_run: true };
    await applyJournal(target, pending.directory, pending.journal, hooks);
    return { ...pending.journal.result, status: "resumed", dry_run: false };
  }
  const receiptPath = `.ai-org/artifacts/${request.work_item_id}/${finish ? "finish" : "delivery"}-${request.operation_id}.json`;
  const existing = await fileBytes(target, receiptPath, true);
  if (existing) {
    const receipt = JSON.parse(existing);
    if (receipt.schema_version !== (finish ? "temple.lean-finish-receipt/v1" : RECEIPT_SCHEMA) || receipt.request_digest !== sha256(formatJson(request)) || receipt.request_digest !== sha256(formatJson(receipt.request))) throw new Error("Lean delivery operation ID conflicts with an existing receipt");
    if (options.expectedPlan && options.expectedPlan !== receipt.result?.plan_digest) throw new OperationError("STALE_PREVIEW", "Stale Lean delivery preview");
    return { ...receipt.result, status: "already_applied", dry_run: Boolean(options.dryRun) };
  }
  const plan = await prepareDelivery(target, request);
  if (options.expectedPlan && options.expectedPlan !== plan.plan_digest) throw new OperationError("STALE_PREVIEW", "Stale Lean delivery preview");
  if (options.dryRun) return { ...plan.result, status: "ready", dry_run: true };
  const directory = await leanDeliveryStateDirectory(target, true);
  const journal = { schema_version: JOURNAL_SCHEMA, target, operation_key: operationKey, ...plan };
  state.phase = "unknown";
  await fs.mkdir(directory, { recursive: true });
  await durableAtomicCreate(path.join(directory, "pending.json"), formatJson(journal));
  state.phase = "pending_recovery";
  await hooks.checkpoint?.("journal");
  await applyJournal(target, directory, journal, hooks);
  return { ...plan.result, status: "applied", dry_run: false };
}

export async function deliverLeanWorkItem(target, options, hooks = {}) {
  return executeLeanCompletion(target, options, hooks, false);
}

export async function executeLeanCompletion(target, options, hooks = {}, finish = true) {
  const state = { phase: "not_started" };
  try {
    return await executeDelivery(target, options, hooks, state, finish);
  } catch (error) {
    if (error instanceof OperationError) {
      error.mutationStatus = state.phase;
      throw error;
    }
    throw new OperationError(state.phase === "not_started" ? "GUARD_REJECTED" : "EXECUTION_UNCERTAIN", error.message, state.phase, error);
  }
}
