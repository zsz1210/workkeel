import fs from "node:fs/promises";
import path from "node:path";
import { OperationError } from "./operation-errors.mjs";
import { verifyMechanicalCompletion } from "./mechanical-completion.mjs";
import {
  DISCIPLINES,
  agentIsEligible,
  readCollaborationState,
  sponsoredPrincipal
} from "./collaboration.mjs";
import { resolveProjectActor, actorResolutionError } from "./actor-resolution.mjs";
import { atomicWrite, formatJson, pathExists, readJson } from "./files.mjs";
import { claimId, collaborativeWorkItemId, isWorkItemId } from "./ids.mjs";
import {
  appendEvent,
  assignedAgentId,
  loadProjectContext,
  nextPositionForState,
  positionName,
  suggestedTaskTitle,
  uniqueStrings
} from "./project.mjs";
import {
  evaluateWorkItemSpecRefs,
  readSpecIndex,
  validateRepositorySpecSources,
  validateSpecIndex
} from "./specifications.mjs";
import { readResourceRegistry, resourceAvailability } from "./resources.mjs";
import { REVIEW_STATES, prebuildRequirements, prepareRework, assertReworkScope, assertFreshReworkCandidate, assertFreshReworkGates } from "./work-item-rework.mjs";
import {
  HIGH_ASSURANCE_PROFILE,
  assertHighAssuranceCloseout,
  assertHighAssuranceTransition,
  assertHighAssuranceUiMode,
  assertActualReviewer,
  assuranceForRisk,
  exactHandoffRevision,
  readHighAssurancePolicy
} from "./assurance.mjs";
import {
  LIFECYCLE_OUTCOMES,
  assessWorkflowProfile,
  assertProfileChangeAllowed,
  isLegacyConcludedItem,
  lifecycleProjection,
  transitionFor,
  workflowProfileForItem
} from "./workflow.mjs";

const UI_DELIVERY_MODES = ["not-applicable", "code-first", "preview-first", "design-led"];
const SPECIFICATION_MODES = ["gate-evidence", "indexed"];
const TRACKER_VISIBILITIES = ["internal", "team-visible"];

async function operationActor(target, context, item, options = {}) {
  return resolveProjectActor(target, context, {
    item, positionId: item.owner_position, actor: options.actor,
    agentId: options.agentId ?? (options.actor === undefined && item.claim?.status === "released" &&
      item.claim.position_id === item.owner_position && item.assigned_agent_id === item.claim.agent_id ? item.claim.agent_id : undefined),
    principalId: options.principalId,
    requiredDisciplines: activeExecutionRequirements(item).disciplines
  });
}

function normalizeResourceRequirements(values = []) {
  const byId = new Map();
  for (const value of values) {
    const resourceId = String(value?.resource_id ?? "").trim();
    const units = Number(value?.units ?? 1);
    if (!resourceId) throw new Error("Stage resource ID is required");
    if (!Number.isInteger(units) || units < 1 || units > 100) throw new Error(`Stage resource ${resourceId} units must be from 1 to 100`);
    if (byId.has(resourceId)) throw new Error(`Duplicate stage resource: ${resourceId}`);
    byId.set(resourceId, { resource_id: resourceId, units });
  }
  return [...byId.values()].sort((left, right) => left.resource_id.localeCompare(right.resource_id));
}

function normalizedStageRequirements(document = {}) {
  const output = {};
  for (const [stage, requirement] of Object.entries(document ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    output[stage] = {
      disciplines: uniqueStrings(requirement?.disciplines),
      resources: normalizeResourceRequirements(requirement?.resources)
    };
  }
  return output;
}

async function validateStageRequirements(target, context, document) {
  const normalized = normalizedStageRequirements(document);
  const resourceRegistry = await readResourceRegistry(target);
  const resourceIds = new Set((resourceRegistry.resources ?? []).filter((entry) => entry.active !== false).map((entry) => entry.id));
  for (const [stage, requirement] of Object.entries(normalized)) {
    if (!context.states.has(stage)) throw new Error(`Unknown lifecycle stage in execution requirements: ${stage}`);
    const unsupported = requirement.disciplines.filter((value) => !DISCIPLINES.includes(value));
    if (unsupported.length > 0) throw new Error(`Unsupported disciplines for ${stage}: ${unsupported.join(", ")}`);
    const missingResources = requirement.resources.filter((entry) => !resourceIds.has(entry.resource_id));
    if (missingResources.length > 0) {
      throw new Error(`Undefined shared resources for ${stage}: ${missingResources.map((entry) => entry.resource_id).join(", ")}`);
    }
  }
  return normalized;
}

function mergeStageRequirements(existing, changes) {
  if (changes === undefined) return normalizedStageRequirements(existing);
  const output = normalizedStageRequirements(existing);
  for (const [stage, change] of Object.entries(changes)) {
    if (change === null) {
      delete output[stage];
      continue;
    }
    output[stage] = {
      disciplines:
        change.disciplines === undefined ? output[stage]?.disciplines ?? [] : uniqueStrings(change.disciplines),
      resources:
        change.resources === undefined ? output[stage]?.resources ?? [] : normalizeResourceRequirements(change.resources)
    };
  }
  return output;
}

export function activeExecutionRequirements(item, stage = item.state) {
  const stageRequirement = item.stage_requirements?.[stage];
  return {
    stage,
    disciplines: stageRequirement ? uniqueStrings(stageRequirement.disciplines) : uniqueStrings(item.required_disciplines),
    resources: stageRequirement ? normalizeResourceRequirements(stageRequirement.resources) : []
  };
}

function workItemPath(target, workItemId) {
  if (!isWorkItemId(workItemId)) {
    throw new Error(`Invalid work item ID: ${workItemId ?? "missing"}`);
  }
  return path.join(target, ".ai-org/work-items", `${workItemId}.json`);
}

function isSafeRepositoryPath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !path.isAbsolute(value) &&
    !path.win32.isAbsolute(value) &&
    !value.includes("\\") &&
    path.posix.normalize(value) === value &&
    value !== ".." &&
    !value.startsWith("../")
  );
}

export async function readWorkItem(target, workItemId) {
  const itemPath = workItemPath(target, workItemId);
  if (!(await pathExists(itemPath))) throw new Error(`Work item not found: ${workItemId}`);
  return readJson(itemPath);
}

function unresolvedItems(item) {
  if (
    item.unresolved !== undefined &&
    (!Array.isArray(item.unresolved) || item.unresolved.some((value) => typeof value !== "string"))
  ) {
    throw new Error(`Work item ${item.id} has invalid unresolved items; expected an array of strings`);
  }
  return uniqueStrings(item.unresolved);
}

export async function listUnresolvedItems(target, workItemId) {
  const item = await readWorkItem(target, workItemId);
  return {
    work_item_id: item.id,
    unresolved: unresolvedItems(item)
  };
}

async function writeWorkItem(target, item) {
  await atomicWrite(workItemPath(target, item.id), formatJson(item));
}

export async function listWorkItemDocuments(target) {
  const directory = path.join(target, ".ai-org/work-items");
  if (!(await pathExists(directory))) return [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const items = [];
  for (const entry of entries.filter((candidate) => candidate.isFile() && candidate.name.endsWith(".json"))) {
    items.push(await readJson(path.join(directory, entry.name)));
  }
  return items.sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

export async function updateUnresolvedItems(target, options) {
  const context = await loadProjectContext(target);
  const item = await readWorkItem(target, options.workItemId);
  const resolutions = uniqueStrings(options.resolve);
  const additions = uniqueStrings(options.merge);
  if (options.conditionKind && !["environment", "decision", "evidence", "owner"].includes(options.conditionKind)) {
    throw actorResolutionError("INVALID_INPUT", "Unsupported condition kind", "Use environment, decision, evidence or owner.");
  }
  if (resolutions.length === 0 && additions.length === 0) {
    throw new Error("Provide at least one --resolve or --merge value");
  }
  const overlap = resolutions.filter((resolution) => additions.includes(resolution));
  if (overlap.length > 0) {
    throw new Error(`Cannot resolve and merge the same unresolved item: ${overlap.join(", ")}`);
  }

  const existing = unresolvedItems(item);
  const missing = resolutions.filter((resolution) => !existing.includes(resolution));
  if (missing.length > 0) {
    throw new Error(`Unresolved item not found on ${item.id}: ${missing.join(", ")}`);
  }

  const actor = (await operationActor(target, context, item, options)).agent_id;
  const resolved = new Set(resolutions);
  const remaining = existing.filter((entry) => !resolved.has(entry));
  const merged = additions.filter((addition) => !remaining.includes(addition));
  const unresolved = uniqueStrings([...remaining, ...merged]);
  const original = Array.isArray(item.unresolved) ? item.unresolved : [];
  const changed = JSON.stringify(original) !== JSON.stringify(unresolved);
  const deduplicatedCount = Math.max(0, original.length - existing.length);

  if (!changed) {
    return {
      item: { ...item, unresolved },
      resolved: resolutions,
      merged,
      deduplicated_count: deduplicatedCount,
      changed: false
    };
  }

  const timestamp = new Date().toISOString();
  const updated = {
    ...item,
    updated_at: timestamp,
    unresolved,
    ...(item.missing_conditions || options.conditionKind ? { missing_conditions: [
      ...(item.missing_conditions ?? []).filter(entry => !resolved.has(entry.description) && !merged.includes(entry.description)),
      ...(options.conditionKind ? merged.map(description => ({ kind: options.conditionKind, description,
        owner: { position_id: item.owner_position, agent_id: actor },
        next_action: options.conditionKind === "environment" ? "Provide the recorded environment and collect the missing observation." : "Resolve the recorded condition before continuing acceptance." })) : [])
    ] } : {})
  };
  await writeWorkItem(target, updated);
  await appendEvent(target, {
    timestamp,
    event_type: "work_item_unresolved_updated",
    actor,
    work_item_id: item.id,
    resolved: resolutions,
    merged,
    deduplicated_count: deduplicatedCount,
    refs: [`.ai-org/work-items/${item.id}.json`]
  });

  return {
    item: updated,
    resolved: resolutions,
    merged,
    deduplicated_count: deduplicatedCount,
    changed: true
  };
}

async function nextWorkItemId(target) {
  const directory = path.join(target, ".ai-org/work-items");
  await fs.mkdir(directory, { recursive: true });
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const numbers = entries
    .filter((entry) => entry.isFile())
    .map((entry) => /^WI-([0-9]+)\.json$/.exec(entry.name)?.[1])
    .filter(Boolean)
    .map(Number);
  const next = (numbers.length ? Math.max(...numbers) : 0) + 1;
  return `WI-${String(next).padStart(4, "0")}`;
}

async function newWorkItemId(target, profile) {
  if (!["collaborative", HIGH_ASSURANCE_PROFILE].includes(profile)) return nextWorkItemId(target);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = collaborativeWorkItemId();
    if (!(await pathExists(workItemPath(target, candidate)))) return candidate;
  }
  throw new Error("Could not allocate a collision-resistant work item ID");
}

function normalizedEvidence(item, additions) {
  return uniqueStrings([...(item.evidence ?? []), ...(additions ?? [])]);
}

function mergeGateEvidence(item, additions) {
  const output = { ...(item.gate_evidence ?? {}) };
  for (const [requirement, references] of Object.entries(additions ?? {})) {
    output[requirement] = uniqueStrings([...(output[requirement] ?? []), ...references]);
  }
  return output;
}

function normalizeDocumentReferences(values) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => {
    if (!value || typeof value !== "object") {
      return value;
    }
    return { id: String(value.id ?? "").trim(), revision: String(value.revision ?? "").trim() };
  });
}

function mergeDocumentReferences(existing, updates, replace = false) {
  const normalizedExisting = normalizeDocumentReferences(existing);
  const normalizedUpdates = normalizeDocumentReferences(updates);
  if (replace) return normalizedUpdates;
  if (updates === undefined) return normalizedExisting;
  const merged = [...normalizedExisting];
  for (const update of normalizedUpdates) {
    const existingIndex = merged.findIndex((reference) => reference?.id === update?.id);
    if (existingIndex === -1) merged.push(update);
    else merged[existingIndex] = update;
  }
  return merged;
}

function sameReferenceIds(left, right) {
  const ids = (values) => (values ?? []).map((reference) => reference?.id).sort();
  return JSON.stringify(ids(left)) === JSON.stringify(ids(right));
}

function assertGovernanceChangeAllowed(item, next) {
  const specificationLocked = ["design", "build", "test", "eval", "independent_qa", "release_gate", "done"].includes(
    item.state
  );
  if (specificationLocked) {
    if (Object.hasOwn(item, "specification_mode") && next.specificationMode !== item.specification_mode) {
      throw new Error(`Specification mode cannot change after entering ${item.state}; replan before changing governance`);
    }
    if (!sameReferenceIds(item.spec_refs ?? [], next.specRefs)) {
      throw new Error(`Specification reference IDs cannot change after entering ${item.state}; only revision repinning is allowed`);
    }
  }

  const interfaceContractsLocked = ["build", "test", "eval", "independent_qa", "release_gate", "done"].includes(item.state);
  if (interfaceContractsLocked) {
    if (Object.hasOwn(item, "ui_delivery_mode") && next.uiDeliveryMode !== item.ui_delivery_mode) {
      throw new Error(`UI delivery mode cannot change after entering ${item.state}; replan before changing interface scope`);
    }
    for (const [label, current, updated] of [
      ["UX", item.ux_refs ?? [], next.uxRefs],
      ["UI", item.ui_refs ?? [], next.uiRefs],
      ["contract", item.contract_refs ?? [], next.contractRefs]
    ]) {
      if (!sameReferenceIds(current, updated)) {
        throw new Error(`${label} reference IDs cannot change after entering ${item.state}; only revision repinning is allowed`);
      }
    }
  }
}

async function evaluateSpecificationReferences(target, item) {
  const index = await readSpecIndex(target);
  const projectContext = await loadProjectContext(target);
  const indexValidation = validateSpecIndex(index, new Set(projectContext.positions.keys()));
  if (!indexValidation.valid) throw new Error(`Invalid specification index: ${indexValidation.errors.join("; ")}`);
  const referencedIds = ["spec_refs", "ux_refs", "ui_refs", "contract_refs"].flatMap((field) =>
    (item[field] ?? []).map((reference) => reference?.id).filter(Boolean)
  );
  const sourceValidation = await validateRepositorySpecSources(target, index, referencedIds);
  if (!sourceValidation.valid) {
    throw new Error(`Invalid repository specification sources: ${sourceValidation.errors.join("; ")}`);
  }
  const evaluation = evaluateWorkItemSpecRefs(item, index);
  if (!evaluation.valid) throw new Error(`Invalid specification references: ${evaluation.errors.join("; ")}`);
  return { index, evaluation };
}

function assertUiDeliveryMode(mode, uiRefs) {
  if (mode !== null && mode !== undefined && !UI_DELIVERY_MODES.includes(mode)) {
    throw new Error(`UI delivery mode must be one of: ${UI_DELIVERY_MODES.join(", ")}`);
  }
  if (mode === "not-applicable" && (uiRefs ?? []).length > 0) {
    throw new Error("UI delivery mode not-applicable cannot have ui_refs");
  }
  if ((mode === null || mode === undefined) && (uiRefs ?? []).length > 0) {
    throw new Error("UI specification references require an explicit UI delivery mode");
  }
  if (["preview-first", "design-led"].includes(mode) && (uiRefs ?? []).length === 0) {
    throw new Error(`UI delivery mode ${mode} requires at least one ui_ref`);
  }
}

function assertSpecificationMode(mode, specRefs, requireReady = false) {
  if (mode === undefined || mode === null) return;
  if (!SPECIFICATION_MODES.includes(mode)) {
    throw new Error(`Specification mode must be one of: ${SPECIFICATION_MODES.join(", ")}`);
  }
  if (mode === "gate-evidence" && (specRefs ?? []).length > 0) {
    throw new Error("Specification mode gate-evidence cannot have spec_refs");
  }
  if (requireReady && mode === "indexed" && (specRefs ?? []).length === 0) {
    throw new Error("Specification mode indexed requires at least one spec_ref before Design");
  }
}

async function assertUiEvidence(target, item, gateEvidence, stage) {
  const mode = item.ui_delivery_mode;
  if (mode === null || mode === undefined || mode === "not-applicable") return;
  const policy = await readJson(path.join(target, ".ai-org/core/ui-design.json"));
  const contract = (policy.delivery_modes ?? []).find((entry) => entry.id === mode);
  if (!contract) throw new Error(`UI delivery mode is not defined by policy: ${mode}`);
  const requirements = stage === "prebuild" ? contract.prebuild_evidence ?? [] : contract.minimum_evidence ?? [];
  const missing = requirements.filter((requirement) => !(gateEvidence[requirement]?.length > 0));
  if (missing.length > 0) {
    throw new Error(`${stage === "prebuild" ? "Build" : "Close"} requires UI evidence for ${mode}: ${missing.join(", ")}`);
  }
}

async function assertCurrentSpecificationReferences(target, item, action) {
  const { index, evaluation } = await evaluateSpecificationReferences(target, item);
  if (evaluation.stale_count > 0) {
    throw new Error(`${action} requires current specification revisions: ${evaluation.warnings.join("; ")}`);
  }
  return { index, evaluation };
}

function assertApprovedSpecificationReferences(evaluation, fields, action) {
  const unapproved = evaluation.resolved_refs.filter(
    (reference) => fields.includes(reference.field) && !reference.approved
  );
  if (unapproved.length > 0) {
    throw new Error(`${action} requires approved referenced contracts: ${unapproved.map((entry) => entry.id).join(", ")}`);
  }
}

function assertApprovalsForState(evaluation, state, action) {
  if (["design", "build", "test", "eval", "independent_qa", "release_gate", "done"].includes(state)) {
    assertApprovedSpecificationReferences(evaluation, ["spec_refs"], action);
  }
  if (["build", "test", "eval", "independent_qa", "release_gate", "done"].includes(state)) {
    assertApprovedSpecificationReferences(evaluation, ["ux_refs", "ui_refs", "contract_refs"], action);
  }
}

export async function createWorkItem(target, options) {
  const context = await loadProjectContext(target);
  const collaboration = await readCollaborationState(target);
  const title = String(options.title ?? "").trim();
  if (!title) throw new Error("--title is required");

  const affectedPaths = uniqueStrings(options.affectedPaths);
  const unsafePaths = affectedPaths.filter((value) => !isSafeRepositoryPath(value));
  if (unsafePaths.length > 0) throw new Error(`Unsafe affected path: ${unsafePaths.join(", ")}`);
  const contextRefs = uniqueStrings(options.contextRefs);
  const contextMap = await readJson(path.join(target, ".ai-org/project/context-map.json"));
  const routeIds = new Set((contextMap.routes ?? []).map((route) => route.id));
  const missingContextRefs = contextRefs.filter((value) => !routeIds.has(value));
  if (missingContextRefs.length > 0) {
    throw Object.assign(new OperationError("INVALID_INPUT", `Unknown context route: ${missingContextRefs.join(", ")}`), {
      responsible_actor: "requesting-contributor",
      next_action: "--context-ref takes a route ID from .ai-org/project/context-map.json, not a file path. Use --affected-path for changed files; omit --context-ref when no explicit route applies.",
      details: { missing_context_refs: missingContextRefs, available_context_refs: [...routeIds] }
    });
  }

  const parentWorkItemId = String(options.parentWorkItemId ?? "").trim() || null;
  const dependencies = uniqueStrings(options.dependencies);
  for (const reference of [parentWorkItemId, ...dependencies].filter(Boolean)) await readWorkItem(target, reference);
  const trackerVisibility = options.trackerVisibility ?? (parentWorkItemId ? "internal" : "team-visible");
  if (!TRACKER_VISIBILITIES.includes(trackerVisibility)) {
    throw new Error(`Tracker visibility must be one of: ${TRACKER_VISIBILITIES.join(", ")}`);
  }
  const requiredDisciplines = uniqueStrings(options.requiredDisciplines);
  const unsupportedDisciplines = requiredDisciplines.filter((value) => !DISCIPLINES.includes(value));
  if (unsupportedDisciplines.length > 0) {
    throw new Error(`Unsupported disciplines: ${unsupportedDisciplines.join(", ")}`);
  }
  const stageRequirements = await validateStageRequirements(target, context, options.stageRequirements ?? {});
  const parallelMode = options.parallelMode ?? "pending";
  if (!["pending", "parallel", "sequential", "blocked"].includes(parallelMode)) {
    throw new Error("--parallel-mode must be pending, parallel, sequential, or blocked");
  }
  const contractStatus = options.contractStatus ?? "not_required";
  if (!["not_required", "draft", "stable"].includes(contractStatus)) {
    throw new Error("--contract-status must be not_required, draft, or stable");
  }
  const integrationOwner = String(options.integrationOwnerAgentId ?? "").trim() || null;
  if (integrationOwner && !context.agents.has(integrationOwner)) throw new Error(`Unknown integration owner: ${integrationOwner}`);
  const specRefs = normalizeDocumentReferences(options.specRefs);
  const uxRefs = normalizeDocumentReferences(options.uxRefs);
  const uiRefs = normalizeDocumentReferences(options.uiRefs);
  const contractRefs = normalizeDocumentReferences(options.contractRefs);
  const specificationMode = options.specificationMode ?? (specRefs.length > 0 ? "indexed" : "gate-evidence");
  assertSpecificationMode(specificationMode, specRefs);
  const uiDeliveryMode = options.uiDeliveryMode === undefined ? null : options.uiDeliveryMode;
  assertUiDeliveryMode(uiDeliveryMode, uiRefs);
  const requestedProfile = options.workflowProfile ?? context.workflow.default_profile ?? "standard";
  if (requestedProfile === "lean" && (!options.riskTier || !options.scopeClass || !String(options.profileRationale ?? "").trim())) {
    throw new Error("Lean creation requires --risk-tier, --scope-class, and --profile-rationale");
  }
  const profileAssessment = assessWorkflowProfile(context.workflow, {
    requestedProfile,
    riskTier: options.riskTier,
    scopeClass: options.scopeClass,
    escalationTriggers: options.escalationTriggers,
    rationale: options.profileRationale,
    evidenceRefs: options.profileEvidence,
    collaborationProfile: collaboration.profile
  });
  let riskTier = profileAssessment.risk_tier;
  let assurance = null;
  if (profileAssessment.effective_profile === HIGH_ASSURANCE_PROFILE) {
    const policy = await readHighAssurancePolicy(target);
    assurance = assuranceForRisk(policy, riskTier);
    assertHighAssuranceUiMode(policy, riskTier, uiDeliveryMode);
  }

  const workItemId = await newWorkItemId(target, collaboration.profile);
  const state = context.workflow.initial_state;
  const ownerPosition = context.states.get(state)?.owner_position;
  if (!ownerPosition) throw new Error(`Workflow initial state ${state} has no owner Position`);
  // Creation records intended work under the project's actor policy. It grants
  // no execution eligibility for the declared task risk or implementation skills;
  // claims and lifecycle operations check the actual item's current requirements.
  if (options.proposal && (!options.agentId || !options.principalId)) {
    throw new Error("Contributor proposals require your own explicit --agent-id and --principal-id");
  }
  let selected;
  try {
    selected = await operationActor(target, context, { owner_position: options.proposal ? options.proposalPosition ?? "developer" : ownerPosition }, options);
  } catch (error) {
    if (!options.proposal && error.code === "TEMPLE_ACTOR_INELIGIBLE") error.next_action = "To submit an unclaimed intake request as a contributor, use work-item propose with your own --position, --agent-id and --principal-id. An eligible intake owner still controls approval and assignment.";
    throw error;
  }
  const assignedAgentIdValue = options.proposal ? context.assignments.get(ownerPosition) ?? null : selected.agent_id;
  const actor = selected.agent_id;
  const timestamp = new Date().toISOString();
  const item = {
    schema_version: "temple.work-item/v1",
    id: workItemId,
    title,
    state,
    owner_position: ownerPosition,
    assigned_agent_id: assignedAgentIdValue,
    ...(options.proposal ? { proposed_by: { agent_id: selected.agent_id, principal_id: selected.principal_id,
      position_id: selected.position_id, actor_provenance: selected.provenance, proposed_at: timestamp } } : {}),
    created_at: timestamp,
    updated_at: timestamp,
    scope: uniqueStrings(options.scope),
    acceptance_criteria: uniqueStrings(options.acceptance),
    affected_paths: affectedPaths,
    context_refs: contextRefs,
    spec_refs: specRefs,
    ux_refs: uxRefs,
    ui_refs: uiRefs,
    contract_refs: contractRefs,
    specification_mode: specificationMode,
    ui_delivery_mode: uiDeliveryMode,
    workflow_profile: profileAssessment.effective_profile,
    risk_tier: riskTier,
    profile_assessment: {
      requested_profile: profileAssessment.requested_profile,
      effective_profile: profileAssessment.effective_profile,
      scope_class: profileAssessment.scope_class,
      escalation_triggers: profileAssessment.escalation_triggers,
      rationale: profileAssessment.rationale,
      evidence_refs: profileAssessment.evidence_refs,
      evaluated_at: profileAssessment.evaluated_at,
      escalated: profileAssessment.escalated
    },
    ...(assurance ? { assurance } : {}),
    parent_work_item_id: parentWorkItemId,
    tracker_visibility: trackerVisibility,
    tracker_refs: [],
    tracker_reconciliations: [],
    dependencies,
    required_disciplines: requiredDisciplines,
    stage_requirements: stageRequirements,
    base_revision: String(options.baseRevision ?? "").trim() || null,
    parallel_mode: parallelMode,
    integration_owner_agent_id: integrationOwner,
    planned_agent_id: null,
    shared_contract_refs: uniqueStrings(options.sharedContractRefs),
    contract_status: contractStatus,
    overlap_resolution: uniqueStrings(options.overlapResolution),
    claim: null,
    claims: [],
    gate_evidence: {},
    evidence: uniqueStrings(options.evidence),
    unresolved: uniqueStrings(options.unresolved),
    next_position: null
  };
  item.next_position = nextPositionForState(context, state, item);

  await evaluateSpecificationReferences(target, item);

  await writeWorkItem(target, item);
  await appendEvent(target, {
    timestamp,
    event_type: "work_item_created",
    actor,
    ...(options.proposal ? { principal_id: selected.principal_id, actor_provenance: selected.provenance, proposal: true } : {}),
    work_item_id: workItemId,
    state,
    refs: [`.ai-org/work-items/${workItemId}.json`]
  });

  return {
    item,
    suggested_title: suggestedTaskTitle(context, workItemId, ownerPosition, title)
  };
}

function overlapStem(value) {
  return String(value ?? "").split("*")[0].replace(/\/+$/, "");
}

function pathsOverlap(left, right) {
  const leftStem = overlapStem(left);
  const rightStem = overlapStem(right);
  if (!leftStem || !rightStem) return false;
  return leftStem === rightStem || leftStem.startsWith(`${rightStem}/`) || rightStem.startsWith(`${leftStem}/`);
}

function overlapResolutionNamesWorkItem(item, workItemId) {
  return (item.overlap_resolution ?? []).some((entry) =>
    String(entry)
      .split(/[^A-Za-z0-9-]+/)
      .includes(workItemId)
  );
}

function dependencyCycleFrom(itemId, itemsById, visiting = new Set(), visited = new Set()) {
  if (visiting.has(itemId)) return true;
  if (visited.has(itemId)) return false;
  visiting.add(itemId);
  for (const dependencyId of itemsById.get(itemId)?.dependencies ?? []) {
    if (itemsById.has(dependencyId) && dependencyCycleFrom(dependencyId, itemsById, visiting, visited)) return true;
  }
  visiting.delete(itemId);
  visited.add(itemId);
  return false;
}

export async function evaluateParallelReadiness(target, workItemId, options = {}) {
  const context = await loadProjectContext(target);
  const collaboration = await readCollaborationState(target);
  const item = await readWorkItem(target, workItemId);
  const allItems = await listWorkItemDocuments(target);
  const dependencyItems = new Map(allItems.map((candidate) => [candidate.id, candidate]));
  const overlaps = allItems
    .filter((candidate) => candidate.id !== item.id && !lifecycleProjection(context.workflow, candidate).terminal)
    .flatMap((candidate) => {
      const shared = (item.affected_paths ?? []).filter((left) =>
        (candidate.affected_paths ?? []).some((right) => pathsOverlap(left, right))
      );
      return shared.length ? [{ work_item_id: candidate.id, paths: shared }] : [];
    });
  const activeClaimAgentId = item.claim?.status === "active" ? item.claim.agent_id : null;
  const agentId = options.agentId ?? activeClaimAgentId ?? item.planned_agent_id ?? item.assigned_agent_id;
  const activeRequirements = activeExecutionRequirements(item);
  const resourceState = await resourceAvailability(target, activeRequirements.resources);
  const { evaluation: specificationEvaluation } = await evaluateSpecificationReferences(target, item);
  const specificationModeValid =
    item.specification_mode === undefined ||
    (SPECIFICATION_MODES.includes(item.specification_mode) &&
      !(item.specification_mode === "gate-evidence" && (item.spec_refs ?? []).length > 0) &&
      !(item.specification_mode === "indexed" && (item.spec_refs ?? []).length === 0));
  const checks = [
    { id: "scope_defined", pass: (item.scope ?? []).length > 0 },
    { id: "acceptance_defined", pass: (item.acceptance_criteria ?? []).length > 0 },
    { id: "owner_assigned", pass: Boolean(agentId) },
    { id: "base_revision_recorded", pass: Boolean(item.base_revision) },
    { id: "affected_paths_declared", pass: (item.affected_paths ?? []).length > 0 },
    {
      id: "dependencies_resolved",
      pass: (item.dependencies ?? []).every((id) => {
        const dependency = dependencyItems.get(id);
        return Boolean(dependency && lifecycleProjection(context.workflow, dependency).terminal);
      })
    },
    { id: "dependency_graph_acyclic", pass: !dependencyCycleFrom(item.id, dependencyItems) },
    {
      id: "shared_contract_stable",
      pass: item.contract_status === "not_required" || item.contract_status === "stable"
    },
    {
      id: "overlap_resolved",
      pass: overlaps.every((overlap) => overlapResolutionNamesWorkItem(item, overlap.work_item_id))
    },
    { id: "integration_owner_assigned", pass: Boolean(item.integration_owner_agent_id) },
    { id: "unresolved_items_cleared", pass: (item.unresolved ?? []).length === 0 },
    {
      id: "specification_references_current",
      pass: specificationEvaluation.valid && specificationEvaluation.stale_count === 0
    },
    { id: "specification_contract_ready", pass: specificationModeValid },
    {
      id: "specification_references_approved",
      pass: specificationEvaluation.valid && specificationEvaluation.unapproved_count === 0
    },
    {
      id: "agent_membership_eligible",
      pass: Boolean(agentId) && agentIsEligible(collaboration, agentId, item.owner_position, activeRequirements.disciplines)
    },
    { id: "shared_resources_defined", pass: resourceState.defined },
    { id: "shared_resources_available", pass: resourceState.available }
  ];
  const blocked = checks.some(
    (check) =>
      !check.pass &&
      [
        "dependencies_resolved",
        "dependency_graph_acyclic",
        "shared_contract_stable",
        "unresolved_items_cleared",
        "specification_contract_ready",
        "specification_references_current",
        "specification_references_approved",
        "shared_resources_defined",
        "shared_resources_available"
      ].includes(check.id)
  );
  const ready = checks.every((check) => check.pass);
  return {
    schema_version: "temple.parallel-readiness/v1",
    work_item_id: item.id,
    requested_mode: item.parallel_mode ?? "pending",
    ready,
    recommended_mode: ready ? "parallel" : blocked ? "blocked" : "sequential",
    agent_id: agentId ?? null,
    checks,
    overlaps,
    active_requirements: activeRequirements,
    shared_resources: resourceState,
    specification_references: specificationEvaluation
  };
}

export async function configureWorkItem(target, options) {
  const context = await loadProjectContext(target);
  const collaboration = await readCollaborationState(target);
  const item = await readWorkItem(target, options.workItemId);
  const dependencies = options.dependencies === undefined ? item.dependencies ?? [] : uniqueStrings(options.dependencies);
  const parent = options.parentWorkItemId === undefined ? item.parent_work_item_id ?? null : String(options.parentWorkItemId).trim() || null;
  for (const reference of [parent, ...dependencies].filter(Boolean)) {
    if (reference === item.id) throw new Error(`${item.id} cannot depend on itself`);
    await readWorkItem(target, reference);
  }
  const disciplines =
    options.requiredDisciplines === undefined ? item.required_disciplines ?? [] : uniqueStrings(options.requiredDisciplines);
  const unsupported = disciplines.filter((value) => !DISCIPLINES.includes(value));
  if (unsupported.length > 0) throw new Error(`Unsupported disciplines: ${unsupported.join(", ")}`);
  const stageRequirements = await validateStageRequirements(
    target,
    context,
    mergeStageRequirements(item.stage_requirements ?? {}, options.stageRequirements)
  );
  if (item.claim?.status === "active") {
    const current = activeExecutionRequirements(item);
    const proposed = activeExecutionRequirements({ ...item, required_disciplines: disciplines, stage_requirements: stageRequirements });
    if (JSON.stringify(current) !== JSON.stringify(proposed)) {
      throw new Error(`Active execution requirements cannot change while ${item.id} is claimed`);
    }
  }
  const parallelMode = options.parallelMode ?? item.parallel_mode ?? "pending";
  if (!["pending", "parallel", "sequential", "blocked"].includes(parallelMode)) throw new Error("Invalid parallel mode");
  const contractStatus = options.contractStatus ?? item.contract_status ?? "not_required";
  if (!["not_required", "draft", "stable"].includes(contractStatus)) throw new Error("Invalid contract status");
  const integrationOwner =
    options.integrationOwnerAgentId === undefined
      ? item.integration_owner_agent_id ?? null
      : String(options.integrationOwnerAgentId).trim() || null;
  if (integrationOwner && !context.agents.has(integrationOwner)) throw new Error(`Unknown integration owner: ${integrationOwner}`);
  const plannedAgent =
    options.agentId === undefined ? item.planned_agent_id ?? null : String(options.agentId).trim() || null;
  if (plannedAgent && !context.agents.has(plannedAgent)) throw new Error(`Unknown planned Agent Identity: ${plannedAgent}`);
  const specRefs = mergeDocumentReferences(item.spec_refs ?? [], options.specRefs, options.replaceSpecRefs === true);
  const uxRefs = mergeDocumentReferences(item.ux_refs ?? [], options.uxRefs, options.replaceUxRefs === true);
  const uiRefs = mergeDocumentReferences(item.ui_refs ?? [], options.uiRefs, options.replaceUiRefs === true);
  const contractRefs = mergeDocumentReferences(
    item.contract_refs ?? [],
    options.contractRefs,
    options.replaceContractRefs === true
  );
  const specificationMode =
    options.specificationMode ??
    (options.specRefs !== undefined && specRefs.length > 0 ? "indexed" : item.specification_mode ?? "gate-evidence");
  assertSpecificationMode(specificationMode, specRefs);
  const uiDeliveryMode =
    options.uiDeliveryMode === undefined
      ? Object.hasOwn(item, "ui_delivery_mode")
        ? item.ui_delivery_mode
        : undefined
      : options.uiDeliveryMode;
  assertUiDeliveryMode(uiDeliveryMode, uiRefs);
  assertGovernanceChangeAllowed(item, {
    specificationMode,
    specRefs,
    uxRefs,
    uiRefs,
    contractRefs,
    uiDeliveryMode
  });
  const timestamp = new Date().toISOString();
  const profileInputProvided = [
    options.workflowProfile,
    options.riskTier,
    options.scopeClass,
    options.profileRationale,
    options.escalationTriggers,
    options.profileEvidence
  ].some((value) => value !== undefined);
  let profileAssessment = item.profile_assessment ?? null;
  let workflowProfile = workflowProfileForItem(context.workflow, item);
  let riskTier = item.risk_tier ?? (workflowProfile === "lean" ? "low" : "standard");
  let assurance = item.assurance;
  if (profileInputProvided) {
    const assessed = assessWorkflowProfile(context.workflow, {
      requestedProfile: options.workflowProfile ?? workflowProfile,
      riskTier: options.riskTier ?? riskTier,
      scopeClass: options.scopeClass ?? profileAssessment?.scope_class,
      escalationTriggers: options.escalationTriggers ?? profileAssessment?.escalation_triggers,
      rationale: options.profileRationale ?? profileAssessment?.rationale,
      evidenceRefs: options.profileEvidence ?? profileAssessment?.evidence_refs,
      collaborationProfile: collaboration.profile,
      evaluatedAt: timestamp
    });
    assertProfileChangeAllowed(context.workflow, item, assessed);
    workflowProfile = assessed.effective_profile;
    riskTier = assessed.risk_tier;
    profileAssessment = {
      requested_profile: assessed.requested_profile,
      effective_profile: assessed.effective_profile,
      scope_class: assessed.scope_class,
      escalation_triggers: assessed.escalation_triggers,
      rationale: assessed.rationale,
      evidence_refs: assessed.evidence_refs,
      evaluated_at: assessed.evaluated_at,
      escalated: assessed.escalated
    };
    if (workflowProfile === HIGH_ASSURANCE_PROFILE) {
      const policy = await readHighAssurancePolicy(target);
      assurance = assuranceForRisk(policy, riskTier);
      assertHighAssuranceUiMode(policy, riskTier, uiDeliveryMode);
    }
  }
  const updated = {
    ...item,
    updated_at: timestamp,
    parent_work_item_id: parent,
    dependencies,
    required_disciplines: disciplines,
    stage_requirements: stageRequirements,
    base_revision: options.baseRevision === undefined ? item.base_revision ?? null : String(options.baseRevision).trim() || null,
    parallel_mode: parallelMode,
    integration_owner_agent_id: integrationOwner,
    planned_agent_id: plannedAgent,
    shared_contract_refs:
      options.sharedContractRefs === undefined ? item.shared_contract_refs ?? [] : uniqueStrings(options.sharedContractRefs),
    contract_status: contractStatus,
    overlap_resolution:
      options.overlapResolution === undefined ? item.overlap_resolution ?? [] : uniqueStrings(options.overlapResolution),
    spec_refs: specRefs,
    ux_refs: uxRefs,
    ui_refs: uiRefs,
    contract_refs: contractRefs,
    specification_mode: specificationMode,
    workflow_profile: workflowProfile,
    risk_tier: riskTier,
    ...(profileAssessment ? { profile_assessment: profileAssessment } : {}),
    ...(assurance ? { assurance } : {}),
    ...(uiDeliveryMode === undefined ? {} : { ui_delivery_mode: uiDeliveryMode })
  };
  updated.next_position = nextPositionForState(context, item.state, updated);
  const specificationState = await evaluateSpecificationReferences(target, updated);
  if (!["intake", "spec", "blocked", "cancelled"].includes(item.state)) {
    if (specificationState.evaluation.stale_count > 0) {
      throw new Error(
        `Configuring ${item.id} requires current specification revisions: ${specificationState.evaluation.warnings.join("; ")}`
      );
    }
    assertApprovalsForState(specificationState.evaluation, item.state, `Configuring ${item.id}`);
  }
  const dependencyItems = new Map((await listWorkItemDocuments(target)).map((candidate) => [candidate.id, candidate]));
  dependencyItems.set(item.id, updated);
  if (dependencyCycleFrom(item.id, dependencyItems)) throw new Error(`Dependency cycle detected from ${item.id}`);
  await writeWorkItem(target, updated);
  let readiness;
  try {
    readiness = await evaluateParallelReadiness(target, item.id);
    if (parallelMode === "parallel" && !readiness.ready) {
      throw new Error(
        `Parallel mode rejected; failed checks: ${readiness.checks.filter((check) => !check.pass).map((check) => check.id).join(", ")}`
      );
    }
  } catch (error) {
    await writeWorkItem(target, item);
    throw error;
  }
  await appendEvent(target, {
    timestamp,
    event_type: "work_item_coordination_configured",
    actor: options.actor ?? item.assigned_agent_id ?? "human",
    work_item_id: item.id,
    parallel_mode: parallelMode,
    refs: [`.ai-org/work-items/${item.id}.json`]
  });
  return { item: updated, readiness };
}

export async function claimWorkItem(target, options) {
  const context = await loadProjectContext(target);
  const collaboration = await readCollaborationState(target);
  const item = await readWorkItem(target, options.workItemId);
  const agentId = String(options.agentId ?? "").trim();
  if (!context.agents.has(agentId)) throw actorResolutionError("TEMPLE_ACTOR_UNKNOWN", `Unknown Agent Identity: ${agentId || "missing"}`,
    "Run collaboration readiness for the intended Principal and select an existing stable Agent ID.");
  if (item.planned_agent_id && item.planned_agent_id !== agentId) {
    throw actorResolutionError("TEMPLE_ACTOR_PLAN_MISMATCH", `${item.id} is planned for ${item.planned_agent_id}, not ${agentId}`,
      "Use the eligible planned Agent, or update the authorized assignment before claiming.", { responsible_actor: item.planned_agent_id });
  }
  const activeRequirements = activeExecutionRequirements(item);
  if (!agentIsEligible(collaboration, agentId, item.owner_position, activeRequirements.disciplines)) {
    throw actorResolutionError("TEMPLE_ACTOR_INELIGIBLE", `${agentId} is not eligible for ${item.owner_position} with disciplines ${activeRequirements.disciplines.join(", ") || "none"}`,
      "Inspect contributor readiness and select a current qualified membership for this Position and scope.");
  }
  if (item.claim?.status === "active") throw actorResolutionError("TEMPLE_ACTOR_CLAIM_CONFLICT", `${item.id} is already claimed by ${item.claim.agent_id}`,
    "Continue the existing claim as its recorded owner, or complete an authorized handoff before claiming.", { responsible_actor: item.claim.agent_id, claim_id: item.claim.id });
  if (item.owner_position === "independent_qa" &&
      (item.handoffs ?? []).findLast(entry => entry.from_position === "developer")?.actor === agentId) {
    throw new Error("Independent QA must differ from the actual Developer Agent Identity");
  }
  if (!["intake", "spec"].includes(item.state)) {
    assertSpecificationMode(item.specification_mode, item.spec_refs ?? [], true);
    if (["build", "test", "eval", "independent_qa", "release_gate", "done"].includes(item.state)) {
      if (Object.hasOwn(item, "ui_delivery_mode") && (item.ui_delivery_mode === null || item.ui_delivery_mode === undefined)) {
        throw new Error("An explicit UI delivery mode is required before claiming Build or later work");
      }
      assertUiDeliveryMode(item.ui_delivery_mode, item.ui_refs ?? []);
    }
    const specificationState = await assertCurrentSpecificationReferences(target, item, `Claiming ${item.id}`);
    assertApprovalsForState(specificationState.evaluation, item.state, `Claiming ${item.id}`);
  }
  const selected = await operationActor(target, context, item, options);
  const principalId = selected.principal_id;
  const baseRevision = String(options.baseRevision ?? item.base_revision ?? "").trim();
  const branch = String(options.branch ?? "").trim();
  if (!baseRevision) throw new Error("--base-revision is required");
  if (!branch) throw new Error("--branch is required");
  const readiness = await evaluateParallelReadiness(target, item.id, { agentId });
  if ((item.parallel_mode ?? "pending") === "parallel" && !readiness.ready) {
    throw new Error(`Cannot claim parallel work; failed checks: ${readiness.checks.filter((check) => !check.pass).map((check) => check.id).join(", ")}`);
  }
  const timestamp = new Date().toISOString();
  const claim = {
    id: claimId(),
    status: "active",
    principal_id: principalId,
    agent_id: agentId,
    actor_provenance: selected.provenance,
    position_id: item.owner_position,
    base_revision: baseRevision,
    branch,
    worktree: String(options.worktree ?? "").trim() || null,
    claimed_at: timestamp,
    released_at: null
  };
  const priorClaims = (item.claims ?? []).filter((entry) => entry.id !== item.claim?.id);
  if (item.claim) priorClaims.push(item.claim);
  const updated = {
    ...item,
    assigned_agent_id: agentId,
    base_revision: baseRevision,
    claim,
    claims: [...priorClaims, claim],
    updated_at: timestamp
  };
  await writeWorkItem(target, updated);
  await appendEvent(target, {
    timestamp,
    event_type: "work_item_claimed",
    actor: principalId,
    agent_id: agentId,
    work_item_id: item.id,
    claim_id: claim.id,
    base_revision: baseRevision,
    branch,
    refs: [`.ai-org/work-items/${item.id}.json`]
  });
  return { item: updated, readiness };
}

export async function prepareClaimRelease(target, options, preparedItem = null) {
  const context = await loadProjectContext(target);
  const item = preparedItem ?? await readWorkItem(target, options.workItemId);
  if (item.claim?.status !== "active") throw new Error(`${item.id} has no active claim`);
  if (options.agentId && options.agentId !== item.claim.agent_id) throw new Error(`Claim belongs to ${item.claim.agent_id}`);
  if (options.principalId && options.principalId !== item.claim.principal_id) throw new Error(`Claim belongs to ${item.claim.principal_id}`);
  const timestamp = new Date().toISOString();
  const claim = { ...item.claim, status: "released", released_at: timestamp, release_reason: options.reason ?? "completed" };
  const updated = {
    ...item,
    assigned_agent_id: item.claim.agent_id,
    claim,
    claims: [...(item.claims ?? []).filter((entry) => entry.id !== claim.id), claim],
    updated_at: timestamp
  };
  const event = {
    timestamp,
    event_type: "work_item_claim_released",
    actor: item.claim.principal_id,
    agent_id: item.claim.agent_id,
    work_item_id: item.id,
    claim_id: item.claim.id,
    refs: [`.ai-org/work-items/${item.id}.json`]
  };
  return { item: updated, events: [event] };
}

export async function releaseWorkItemClaim(target, options) {
  const prepared = await prepareClaimRelease(target, options);
  await writeWorkItem(target, prepared.item);
  for (const event of prepared.events) await appendEvent(target, event);
  return prepared.item;
}

function parseTransition(context, item, toState) {
  const transition = transitionFor(context.workflow, item, toState);
  if (transition) return transition;
  throw new Error(`Illegal work item transition: ${item.state} -> ${toState}`);
}

function normalizeSatisfiedRequirements(satisfied = {}) {
  const output = {};
  for (const [requirement, references] of Object.entries(satisfied)) {
    output[requirement] = uniqueStrings(Array.isArray(references) ? references : [references]);
  }
  return output;
}

const REPOSITORY_ARTIFACT_EXTENSIONS = new Set([
  ".cjs",
  ".html",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".jsonl",
  ".jsx",
  ".log",
  ".md",
  ".mjs",
  ".pdf",
  ".png",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml"
]);

function looksLikeRepositoryArtifactReference(reference) {
  const value = String(reference ?? "").trim();
  if (!value || value.startsWith("EVID-") || value.startsWith("git:")) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false;
  return value.includes("/") || value.includes("\\") || REPOSITORY_ARTIFACT_EXTENSIONS.has(path.extname(value).toLowerCase());
}

async function assertRepositoryGateEvidencePaths(target, gateEvidence, preparedArtifacts = new Map()) {
  const references = uniqueStrings(Object.values(gateEvidence).flat()).filter(looksLikeRepositoryArtifactReference);
  if (references.length === 0) return;

  const realTarget = await fs.realpath(target);
  for (const reference of references) {
    if (!isSafeRepositoryPath(reference)) {
      throw new Error(`Gate evidence artifact path is unsafe: ${reference}`);
    }
    if (preparedArtifacts.has(reference)) continue;
    const artifactPath = path.resolve(target, reference);
    let stats;
    try {
      stats = await fs.lstat(artifactPath);
    } catch (error) {
      if (error?.code === "ENOENT") throw new Error(`Gate evidence artifact is missing: ${reference}`);
      throw error;
    }
    if (stats.isSymbolicLink()) throw new Error(`Gate evidence artifact must not be a symbolic link: ${reference}`);
    if (!stats.isFile()) throw new Error(`Gate evidence artifact is not a regular file: ${reference}`);

    const realArtifactPath = await fs.realpath(artifactPath);
    const relativeRealPath = path.relative(realTarget, realArtifactPath);
    if (relativeRealPath === ".." || relativeRealPath.startsWith(`..${path.sep}`) || path.isAbsolute(relativeRealPath)) {
      throw new Error(`Gate evidence artifact resolves outside the repository: ${reference}`);
    }
  }
}

async function assertNormalizedGateEvidence(target, item, gateEvidence) {
  const normalizedReferences = Object.entries(gateEvidence).flatMap(([requirement, references]) =>
    (references ?? [])
      .filter((reference) => String(reference).startsWith("EVID-"))
      .map((reference) => ({ requirement, reference }))
  );
  if (normalizedReferences.length === 0) return;

  const registry = await readJson(path.join(target, ".ai-org/project/evidence.json"));
  if (!Array.isArray(registry?.entries)) throw new Error("Normalized evidence registry is invalid");
  const byId = new Map(registry.entries.map((entry) => [entry.id, entry]));
  const now = Date.now();
  for (const { requirement, reference } of normalizedReferences) {
    const entry = byId.get(reference);
    if (!entry) throw new Error(`Gate evidence reference is not present in the normalized registry: ${reference}`);
    if (entry.work_item_id !== item.id) {
      throw new Error(`Gate evidence ${reference} belongs to ${entry.work_item_id}, not ${item.id}`);
    }
    if (entry.invalidated_at) throw new Error(`Gate evidence ${reference} is invalidated`);
    if (entry.expires_at && Date.parse(entry.expires_at) <= now) throw new Error(`Gate evidence ${reference} is expired`);
    if (["independent_qa_pass", "independent_qa_report"].includes(requirement)) {
      await assertActualReviewer(target, await loadProjectContext(target), item, [entry], "independent_qa");
      if (!new Set(["test", "runtime"]).has(entry.kind)) {
        throw new Error(`Gate evidence ${reference} must be test or runtime evidence for independent_qa_pass`);
      }
      if (entry.outcome !== "pass") {
        throw new Error(`Gate evidence ${reference} outcome ${entry.outcome} does not satisfy independent_qa_pass`);
      }
    }
  }
}

export async function prepareWorkItemRework(target, options) {
  const context = await loadProjectContext(target);
  const item = await readWorkItem(target, options.workItemId);
  if (!REVIEW_STATES.has(item.state)) throw new Error("Rework is available only from Test, Eval or Independent QA; closed work and Release Gate cannot be reopened");
  if (options.sameScope !== true) throw new Error("--same-scope is required; new scope needs separately approved work");
  assertReworkScope(item);
  const reason = uniqueStrings(options.reason);
  const findings = uniqueStrings(options.evidence);
  if (!reason.length || !findings.length) throw new Error("Rework requires --reason and --evidence findings");
  if (findings.some(ref => !looksLikeRepositoryArtifactReference(ref))) throw new Error("Rework findings must be repository artifact paths");
  await assertRepositoryGateEvidencePaths(target, { findings });
  if (item.claim?.status !== "active") throw new Error("Rework requires an active reviewer claim");
  const actor = options.actor ?? item.claim.agent_id;
  const collaboration = await readCollaborationState(target);
  if (!["quality_evaluator", "independent_qa"].includes(item.owner_position) ||
      context.states.get(item.state)?.owner_position !== item.owner_position ||
      actor !== item.claim.agent_id || !agentIsEligible(collaboration, actor, item.owner_position, activeExecutionRequirements(item).disciplines)) {
    throw new Error("Rework requires the active eligible review claimant");
  }
  const sponsor = sponsoredPrincipal(collaboration, actor);
  if (["collaborative", HIGH_ASSURANCE_PROFILE].includes(collaboration.profile)) {
    if (!sponsor || sponsor !== item.claim.principal_id) throw new Error("Rework reviewer claim has no matching Human Principal sponsor");
    await operationActor(target, context, item, { ...options, agentId: actor, principalId: sponsor });
  }
  const developerHandoff = (item.handoffs ?? []).findLast(entry => entry.from_position === "developer");
  if (!developerHandoff?.actor) throw new Error("Rework requires a recorded Developer handoff author; a legacy assignment is not proof of who delivered the candidate");
  if (actor === developerHandoff.actor) throw new Error("The Developer cannot return their own candidate as its reviewer");
  const revision = String(options.inputRevision ?? "").trim();
  if (!/^[a-f0-9]{40}$/.test(revision) || revision !== item.developer_candidate_revision || revision !== developerHandoff?.input_revision) {
    throw new Error("--input-revision must be the exact current Developer handoff SHA; legacy symbolic revisions require reconciliation");
  }
  await exactHandoffRevision(target, item, revision);
  const { listRuntimeWorkers } = await import("./workers.mjs");
  const workers = await listRuntimeWorkers(target);
  const resources = await readResourceRegistry(target);
  if (workers.some(worker => worker.work_item_id === item.id && !["completed", "failed", "cancelled"].includes(worker.status)) ||
      resources.reservations.some(reservation => reservation.work_item_id === item.id && reservation.status === "active")) {
    throw new Error("Finish the Work Item's active runtime workers and resource reservations before rework");
  }
  assertSpecificationMode(item.specification_mode, item.spec_refs ?? [], true);
  assertUiDeliveryMode(item.ui_delivery_mode, item.ui_refs ?? []);
  const specs = await assertCurrentSpecificationReferences(target, item, "Review rework");
  assertApprovalsForState(specs.evaluation, "build", "Review rework");
  const uiPolicy = await readJson(path.join(target, ".ai-org/core/ui-design.json"));
  const extra = (uiPolicy.delivery_modes ?? []).find(mode => mode.id === item.ui_delivery_mode)?.prebuild_evidence ?? [];
  const assurancePolicy = await readHighAssurancePolicy(target);
  const riskRequirement = assurancePolicy.transition_requirements["design->build"]?.requirement;
  const retainedRequirements = prebuildRequirements(context.workflow, item, [...extra, ...(item.assurance?.profile === HIGH_ASSURANCE_PROFILE && riskRequirement ? [riskRequirement] : [])]);
  const prepared = prepareRework(item, { actor, reason, findings, revision, retainedRequirements, timestamp: new Date().toISOString() });
  const missing = retainedRequirements.filter(key => !prepared.item.gate_evidence[key]?.length);
  if (missing.length) throw new Error(`Rework requires existing prebuild evidence: ${missing.join(", ")}`);
  await assertRepositoryGateEvidencePaths(target, prepared.item.gate_evidence);
  await assertNormalizedGateEvidence(target, prepared.item, prepared.item.gate_evidence);
  await assertUiEvidence(target, prepared.item, prepared.item.gate_evidence, "prebuild");
  await assertHighAssuranceTransition(target, context, { ...prepared.item, state: "design" }, "build", prepared.item.gate_evidence);
  prepared.item.assigned_agent_id = developerHandoff.actor;
  prepared.item.next_position = nextPositionForState(context, "build", prepared.item);
  if (context.states.get("build")?.owner_position !== "developer") throw new Error("Rework requires a Developer-owned Build state");
  return { prepared, item, actor, revision, reason, findings };
}

export async function reworkWorkItem(target, options) {
  const { prepared, item, actor, revision, reason, findings } = await prepareWorkItemRework(target, options);
  const originalBytes = await fs.readFile(workItemPath(target, item.id), "utf8");
  await writeWorkItem(target, prepared.item);
  try {
    await appendEvent(target, {
      timestamp: prepared.entry.returned_at, event_type: "work_item_reworked", actor,
      work_item_id: item.id, from_state: item.state, to_state: "build",
      rejected_revision: revision, rework_sequence: prepared.entry.sequence,
      claim_id: item.claim.id, reason, refs: [`.ai-org/work-items/${item.id}.json`, ...findings]
    });
  } catch (error) {
    // The CLI holds the mutation lock through both writes and this compensation.
    // A crash or a second I/O failure is not covered by an in-process rollback.
    try { await atomicWrite(workItemPath(target, item.id), originalBytes); }
    catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Rework audit and rollback both failed; preserve the Work Item and event stream for explicit recovery");
    }
    throw error;
  }
  return prepared;
}

export async function prepareWorkItemTransition(target, options, preparedItem = null, preparedArtifacts = new Map()) {
  const context = await loadProjectContext(target);
  const item = preparedItem ?? await readWorkItem(target, options.workItemId);
  const toState = String(options.toState ?? "").trim();
  if (!context.states.has(toState)) throw new Error(`Unknown workflow state: ${toState || "missing"}`);
  // Only the recoverable finish path supplies this request. Independently
  // revalidate the exact contract; a generic transition gains no shortcut.
  const mechanical = options.mechanicalRequest && toState === "done"
    ? await verifyMechanicalCompletion(target, item, options.mechanicalRequest) : null;
  const transition = mechanical ? { from: "build", to: "done", requires: ["mechanical_contract"] } : parseTransition(context, item, toState);
  if (["design", "build", "test", "eval", "independent_qa", "release_gate", "done"].includes(toState)) {
    assertSpecificationMode(item.specification_mode, item.spec_refs ?? [], true);
  }
  if (["build", "test", "eval", "independent_qa", "release_gate", "done"].includes(toState)) {
    if (Object.hasOwn(item, "ui_delivery_mode") && (item.ui_delivery_mode === null || item.ui_delivery_mode === undefined)) {
      throw new Error("An explicit UI delivery mode is required before Build; use not-applicable when there is no interface change");
    }
    assertUiDeliveryMode(item.ui_delivery_mode, item.ui_refs ?? []);
  }
  let specificationState = null;
  if (!["intake", "spec", "blocked", "cancelled"].includes(toState)) {
    specificationState = await assertCurrentSpecificationReferences(target, item, `Transition ${item.state} -> ${toState}`);
  }
  if (specificationState && ["design", "build", "test", "eval", "independent_qa", "release_gate", "done"].includes(toState)) {
    assertApprovedSpecificationReferences(
      specificationState.evaluation,
      ["spec_refs"],
      `Transition ${item.state} -> ${toState}`
    );
  }
  if (specificationState && ["build", "test", "eval", "independent_qa", "release_gate", "done"].includes(toState)) {
    assertApprovedSpecificationReferences(
      specificationState.evaluation,
      ["ux_refs", "ui_refs", "contract_refs"],
      `Transition ${item.state} -> ${toState}`
    );
  }
  const actor = (await operationActor(target, context, item, options)).agent_id;
  const additions = normalizeSatisfiedRequirements(options.satisfied);
  const mergedGates = mergeGateEvidence(item, additions);
  await assertFreshReworkGates(target, item, mergedGates);
  if (item.rework_history?.length && REVIEW_STATES.has(toState) && !item.developer_candidate_revision) {
    throw new Error("Rework requires a new Developer handoff before review");
  }
  await assertNormalizedGateEvidence(target, item, mergedGates);
  await assertRepositoryGateEvidencePaths(target, mergedGates, preparedArtifacts);
  if (toState === "build") await assertUiEvidence(target, item, mergedGates, "prebuild");
  await assertHighAssuranceTransition(target, context, item, toState, mergedGates);
  const missing = (transition.requires ?? []).filter((requirement) => !(mergedGates[requirement]?.length > 0));
  if (missing.length > 0) {
    throw new Error(
      `Transition ${item.state} -> ${toState} is missing gate evidence: ${missing.join(", ")}. Use --satisfy requirement=reference.`
    );
  }

  const timestamp = new Date().toISOString();
  const ownerPosition = context.states.get(toState).owner_position;
  const previousState = toState === "blocked" ? item.state : item.previous_state;
  const ownerChanged = ownerPosition !== item.owner_position;
  const releasedClaim =
    ownerChanged && item.claim?.status === "active"
      ? {
          ...item.claim,
          status: "released",
          released_at: timestamp,
          release_reason: "position_transition"
        }
      : item.claim ?? null;
  const updated = {
    ...item,
    state: toState,
    owner_position: ownerPosition,
    assigned_agent_id: ownerChanged ? assignedAgentId(context, ownerPosition) : actor,
    planned_agent_id: ownerChanged ? null : item.planned_agent_id ?? null,
    claim: releasedClaim,
    claims:
      ownerChanged && item.claim?.status === "active"
        ? [...(item.claims ?? []).filter((entry) => entry.id !== releasedClaim.id), releasedClaim]
        : item.claims ?? [],
    updated_at: timestamp,
    gate_evidence: mergedGates,
    evidence: normalizedEvidence(item, [
      ...uniqueStrings(options.evidence),
      ...Object.values(additions).flat()
    ]),
    next_position: null
  };
  updated.next_position = nextPositionForState(context, toState, updated);
  if (toState === "done" && workflowProfileForItem(context.workflow, item) === "lean") {
    updated.lifecycle_outcome = "accepted";
    updated.closeout_reasons = [];
    if (mechanical) updated.closeout_reasons = ["mechanical: exact preapproved text replacement; not Independent QA"];
    updated.external_release_status = "not_performed";
  }
  if (previousState) updated.previous_state = previousState;
  if (item.state === "blocked" && toState === item.previous_state) delete updated.previous_state;

  const events = [{
    timestamp,
    event_type: "work_item_transitioned",
    actor,
    work_item_id: item.id,
    from_state: item.state,
    to_state: toState,
    satisfied_requirements: transition.requires ?? [],
    refs: uniqueStrings([...Object.values(additions).flat(), ...(options.evidence ?? [])])
  }];
  if (toState === "done") {
    events.push({
      timestamp,
      event_type: "work_item_closed",
      actor,
      position: item.owner_position,
      work_item_id: item.id,
      from_state: item.state,
      to_state: "done",
      result: updated.lifecycle_outcome ?? "accepted",
      next_owner_position: "engineering_manager",
      refs: [`.ai-org/work-items/${item.id}.json`, ...Object.values(additions).flat()]
    });
  }

  return {
    item: updated,
    events,
    suggested_title: suggestedTaskTitle(context, item.id, ownerPosition, item.title)
  };
}

export async function transitionWorkItem(target, options) {
  const { events, ...result } = await prepareWorkItemTransition(target, options);
  await writeWorkItem(target, result.item);
  for (const event of events) await appendEvent(target, event);
  return result;
}

function handoffSequence(entries) {
  const numbers = entries
    .map((entry) => /^handoff-([0-9]+)-/.exec(entry.name)?.[1])
    .filter(Boolean)
    .map(Number);
  return (numbers.length ? Math.max(...numbers) : 0) + 1;
}

function markdownList(values, emptyValue = "None recorded.") {
  const items = uniqueStrings(values);
  return items.length ? items.map((value) => `- ${value}`).join("\n") : emptyValue;
}

export async function prepareHandoff(target, options) {
  const context = await loadProjectContext(target);
  const item = await readWorkItem(target, options.workItemId);
  const toPosition = String(options.toPosition ?? "").trim();
  if (!context.positions.has(toPosition)) throw new Error(`Unknown Position: ${toPosition || "missing"}`);
  if (item.next_position && item.next_position !== toPosition) {
    throw new Error(`Handoff for ${item.id} must go to next Position ${item.next_position}, not ${toPosition}`);
  }
  const requestedInputRevision = String(options.inputRevision ?? "").trim();
  if (!requestedInputRevision) throw new Error("--input-revision is required");
  const inputRevision = await exactHandoffRevision(target, item, requestedInputRevision);
  const completed = uniqueStrings(options.completed);
  const evidence = uniqueStrings(options.evidence);
  if (completed.length === 0) throw new Error("At least one --completed value is required");
  if (evidence.length === 0) throw new Error("At least one --evidence value is required");

  const selected = await operationActor(target, context, item, options);
  const actor = selected.agent_id;
  if (item.rework_history?.length) {
    assertReworkScope(item);
    if (item.owner_position === "developer") {
      if (item.claim?.status !== "active" || item.claim.agent_id !== actor) throw new Error("Rework requires a new active Developer claim");
      if (item.rework_history.some(entry => entry.reviewer_agent_id === actor)) throw new Error("Rework Developer must differ from the reviewer's Agent Identity");
      assertFreshReworkCandidate(item, inputRevision);
      await assertFreshReworkGates(target, { ...item, developer_candidate_revision: inputRevision }, { developer_evidence: evidence });
      await assertRepositoryGateEvidencePaths(target, { developer_evidence: evidence });
    }
  }
  const artifactDirectory = path.join(target, ".ai-org/artifacts", item.id);
  const entries = await fs.readdir(artifactDirectory, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const sequence = handoffSequence(entries.filter((entry) => entry.isFile()));
  const relativePath = `.ai-org/artifacts/${item.id}/handoff-${String(sequence).padStart(3, "0")}-${item.owner_position}-to-${toPosition}.md`;
  const timestamp = new Date().toISOString();
  const unresolved = uniqueStrings(options.unresolved);
  const content = `# Handoff — ${item.id}\n\n- Created: \`${timestamp}\`\n- From Position: ${positionName(context, item.owner_position)} (\`${item.owner_position}\`)\n- To Position: ${positionName(context, toPosition)} (\`${toPosition}\`)\n- Input revision: \`${inputRevision}\`\n- Actor: \`${actor}\`\n\n## Completed\n\n${markdownList(completed)}\n\n## Evidence\n\n${markdownList(evidence)}\n\n## Unresolved\n\n${markdownList(unresolved)}\n\n## Next action\n\nContinue as ${positionName(context, toPosition)} using the canonical work item and exact input revision above.\n`;

  const gateAdditions = {};
  if (item.owner_position === "developer") {
    gateAdditions.developer_handoff = [relativePath];
    gateAdditions.developer_evidence = evidence;
  }
  const updated = {
    ...item,
    updated_at: timestamp,
    handoffs: [
      ...(item.handoffs ?? []),
      {
        from_position: item.owner_position,
        to_position: toPosition,
        actor,
        principal_id: selected.principal_id,
        actor_provenance: selected.provenance,
        input_revision: inputRevision,
        artifact: relativePath,
        created_at: timestamp
      }
    ],
    gate_evidence: mergeGateEvidence(item, gateAdditions),
    evidence: normalizedEvidence(item, [relativePath, ...evidence]),
    unresolved: uniqueStrings([...(item.unresolved ?? []), ...unresolved]),
    next_position: toPosition
  };
  if (item.owner_position === "developer") updated.developer_candidate_revision = inputRevision;
  const event = {
    timestamp,
    event_type: "handoff_created",
    actor,
    work_item_id: item.id,
    from_position: item.owner_position,
    to_position: toPosition,
    input_revision: inputRevision,
    refs: [relativePath, ...evidence]
  };

  return {
    item: updated,
    artifact: relativePath,
    content,
    events: [event],
    suggested_title: suggestedTaskTitle(context, item.id, toPosition, item.title)
  };
}

export async function createHandoff(target, options) {
  const { content, events, ...result } = await prepareHandoff(target, options);
  await atomicWrite(path.join(target, result.artifact), content);
  await writeWorkItem(target, result.item);
  for (const event of events) await appendEvent(target, event);
  return result;
}

function releaseRecordMarkdown(context, item, options, timestamp, actor, gateEvidence) {
  const evidence = uniqueStrings([...(item.evidence ?? []), ...(options.evidence ?? []), ...Object.values(gateEvidence).flat()]);
  const gateLines = Object.entries(gateEvidence)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([requirement, references]) => [`- ${requirement}:`, ...uniqueStrings(references).map((reference) => `  - ${reference}`)]);
  return `# Release gate and closeout record — ${item.id}\n\n- Decision time: \`${timestamp}\`\n- Release Manager: ${context.agents.get(actor)?.display_name ?? actor} (\`${actor}\`)\n- Decision: **${options.decision.toUpperCase()} for organizational closeout**\n- Tested revision: \`${options.testedRevision}\`\n- External release: **not performed by organizational closeout**\n- Approval record: \`${options.approval}\`\n\n## Gate evidence\n\n${gateLines.join("\n")}\n\n## Supporting evidence\n\n${markdownList(evidence)}\n\n## Rollback plan\n\n${markdownList(options.rollback)}\n\n## Residual risk or no-go reason\n\n${markdownList(options.reason)}\n\n## Disposition\n\n${
    options.decision === "go"
      ? `The accepted scope is closed as \`done\`. This record is not reusable as authorization for a production or external release.`
      : `The release gate is no-go. The approved attempt is closed as \`concluded\` with outcome \`${options.outcome ?? "no-go"}\`; no continuation is implied.`
  }\n`;
}

export async function prepareWorkItemClose(target, options) {
  const context = await loadProjectContext(target);
  const item = await readWorkItem(target, options.workItemId);
  if (item.state !== "release_gate") throw new Error(`temple close requires release_gate; ${item.id} is ${item.state}`);
  if (!["go", "no-go"].includes(options.decision)) throw new Error("--decision must be go or no-go");
  const lifecycleOutcome = options.decision === "go" ? "accepted" : options.outcome ?? "no-go";
  if (!LIFECYCLE_OUTCOMES.includes(lifecycleOutcome)) throw new Error(`--outcome must be one of: ${LIFECYCLE_OUTCOMES.join(", ")}`);
  if (options.decision === "go" && options.outcome !== undefined) throw new Error("--outcome is valid only with --decision no-go");
  if (options.decision === "no-go" && !["no-go", "inconclusive"].includes(lifecycleOutcome)) {
    throw new Error("A no-go close may use only --outcome no-go or inconclusive");
  }
  if (options.decision === "go") {
    assertSpecificationMode(item.specification_mode, item.spec_refs ?? [], true);
    if (Object.hasOwn(item, "ui_delivery_mode") && (item.ui_delivery_mode === null || item.ui_delivery_mode === undefined)) {
      throw new Error("An explicit UI delivery mode is required before go closeout");
    }
    assertUiDeliveryMode(item.ui_delivery_mode, item.ui_refs ?? []);
    const specificationState = await assertCurrentSpecificationReferences(target, item, `Close ${item.id}`);
    assertApprovedSpecificationReferences(
      specificationState.evaluation,
      ["spec_refs", "ux_refs", "ui_refs", "contract_refs"],
      `Close ${item.id}`
    );
  }
  if (!String(options.testedRevision ?? "").trim()) throw new Error("--tested-revision is required");
  if (!String(options.approval ?? "").trim()) throw new Error("--approval is required (use not-required only when policy permits)");
  if (uniqueStrings(options.rollback).length === 0) throw new Error("At least one --rollback value is required");
  if (options.decision === "no-go" && uniqueStrings(options.reason).length === 0) {
    throw new Error("A no-go close requires at least one --reason");
  }

  const actor = (await operationActor(target, context, item, options)).agent_id;
  const satisfied = normalizeSatisfiedRequirements(options.satisfied);
  const gateEvidence = mergeGateEvidence(item, satisfied);
  await assertFreshReworkGates(target, item, gateEvidence);
  if (item.rework_history?.length && options.decision === "go") {
    const tested = await exactHandoffRevision(target, item, options.testedRevision);
    if (tested !== item.developer_candidate_revision) throw new Error("Rework closeout must test the current Developer candidate");
    options = { ...options, testedRevision: tested };
  }
  await assertNormalizedGateEvidence(target, item, gateEvidence);
  await assertRepositoryGateEvidencePaths(target, gateEvidence);
  if (options.decision === "go") await assertUiEvidence(target, item, gateEvidence, "close");
  const required = (context.policies.release_gate?.requires ?? []).filter((requirement) => requirement !== "rollback_plan");
  const missing = required.filter((requirement) => !(gateEvidence[requirement]?.length > 0));
  if (missing.length > 0) {
    throw new Error(`Release gate is missing evidence: ${missing.join(", ")}. Use --satisfy requirement=reference.`);
  }

  const assuranceCloseout = await assertHighAssuranceCloseout(target, context, item, options, gateEvidence);
  const closeOptions = { ...options, outcome: lifecycleOutcome, testedRevision: assuranceCloseout.testedRevision };

  const timestamp = new Date().toISOString();
  const relativePath = `.ai-org/artifacts/${item.id}/release-record.md`;
  gateEvidence.rollback_plan = [relativePath];
  gateEvidence.required_human_approval = [options.approval];
  const content = releaseRecordMarkdown(context, item, closeOptions, timestamp, actor, gateEvidence);

  const destinationState = options.decision === "go" ? "done" : "concluded";
  const ownerPosition = context.states.get(destinationState).owner_position;
  const closeClaim =
    item.claim?.status === "active"
      ? {
          ...item.claim,
          status: "released",
          released_at: timestamp,
          release_reason: "work_item_closed"
        }
      : item.claim ?? null;
  const updated = {
    ...item,
    state: destinationState,
    owner_position: ownerPosition,
    assigned_agent_id: assignedAgentId(context, ownerPosition),
    planned_agent_id: null,
    claim: closeClaim,
    claims:
      item.claim?.status === "active"
        ? [...(item.claims ?? []).filter((entry) => entry.id !== closeClaim.id), closeClaim]
        : item.claims ?? [],
    updated_at: timestamp,
    tested_revision: closeOptions.testedRevision,
    release_gate_result: options.decision,
    lifecycle_outcome: lifecycleOutcome,
    closeout_reasons: uniqueStrings(options.reason),
    external_release_status: "not_performed",
    approval_record: options.approval,
    gate_evidence: gateEvidence,
    evidence: normalizedEvidence(item, [relativePath, ...(options.evidence ?? []), ...Object.values(satisfied).flat()]),
    unresolved: uniqueStrings(item.unresolved),
    next_position: null
  };
  delete updated.previous_state;
  const events = [{
    timestamp,
    event_type: "release_gate_completed",
    actor,
    position: "release_manager",
    work_item_id: item.id,
    from_state: "release_gate",
    to_state: destinationState,
    tested_revision: closeOptions.testedRevision,
    result: options.decision,
    approval_record: options.approval,
    external_release: false,
    refs: [relativePath]
  }, {
    timestamp,
    event_type: options.decision === "go" ? "work_item_closed" : "work_item_concluded",
    actor,
    position: "release_manager",
    work_item_id: item.id,
    from_state: "release_gate",
    to_state: destinationState,
    result: lifecycleOutcome,
    next_owner_position: "engineering_manager",
    refs: [`.ai-org/work-items/${item.id}.json`, relativePath]
  }];
  return { item: updated, artifact: relativePath, content, events };
}

export async function closeWorkItem(target, options) {
  const { content, events, ...result } = await prepareWorkItemClose(target, options);
  await atomicWrite(path.join(target, result.artifact), content);
  await writeWorkItem(target, result.item);
  for (const event of events) await appendEvent(target, event);
  return result;
}

export async function migrateLegacyOutcome(target, options) {
  const context = await loadProjectContext(target);
  const selected = options.workItemId
    ? [await readWorkItem(target, options.workItemId)]
    : await listWorkItemDocuments(target);
  const candidates = selected.filter(isLegacyConcludedItem);
  if (options.workItemId && candidates.length === 0) {
    throw new Error(`${options.workItemId} is not a structurally qualified legacy release-gate no-go item`);
  }
  const outcome = options.outcome ?? "no-go";
  if (!["no-go", "inconclusive"].includes(outcome)) throw new Error("--outcome must be no-go or inconclusive");
  const preview = candidates.map((item) => ({ work_item_id: item.id, from_state: item.state, to_state: "concluded", outcome }));
  if (options.dryRun) return { dry_run: true, changed: 0, candidates: preview };
  const timestamp = new Date().toISOString();
  for (const item of candidates) {
    const activeClaim = item.claim?.status === "active"
      ? { ...item.claim, status: "released", released_at: timestamp, release_reason: "legacy_outcome_migrated" }
      : item.claim ?? null;
    const updated = {
      ...item,
      state: "concluded",
      owner_position: context.states.get("concluded").owner_position,
      assigned_agent_id: assignedAgentId(context, context.states.get("concluded").owner_position),
      claim: activeClaim,
      claims: item.claim?.status === "active"
        ? [...(item.claims ?? []).filter((entry) => entry.id !== activeClaim.id), activeClaim]
        : item.claims ?? [],
      lifecycle_outcome: outcome,
      closeout_reasons: uniqueStrings([...(item.closeout_reasons ?? []), ...(options.reason ?? []), ...(item.unresolved ?? [])]),
      next_position: null,
      updated_at: timestamp
    };
    delete updated.previous_state;
    await writeWorkItem(target, updated);
    await appendEvent(target, {
      timestamp,
      event_type: "legacy_work_item_outcome_migrated",
      actor: options.actor ?? "human",
      work_item_id: item.id,
      from_state: "blocked",
      to_state: "concluded",
      result: outcome,
      refs: [`.ai-org/work-items/${item.id}.json`, ...(item.gate_evidence?.rollback_plan ?? [])]
    });
  }
  return { dry_run: false, changed: candidates.length, candidates: preview };
}
