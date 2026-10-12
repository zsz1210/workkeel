import path from "node:path";
import { spawnSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { pathExists, readJson } from "./files.mjs";
import { uniqueStrings } from "./project.mjs";

export const HIGH_ASSURANCE_PROFILE = "high-assurance";
export const HIGH_ASSURANCE_POLICY_RELATIVE_PATH = ".ai-org/core/high-assurance.json";
export const ASSURANCE_RISK_TIERS = ["low", "standard", "high", "critical"];
const RISK_TIER_RANK = new Map(ASSURANCE_RISK_TIERS.map((value, index) => [value, index]));
const EVIDENCE_SEVERITY_RANK = new Map(["low", "medium", "high", "critical"].map((value, index) => [value, index]));
const SHA = /^[0-9a-f]{40}$/;

export function riskEvidenceCoversTier(riskTier, evidenceSeverity) {
  const required = RISK_TIER_RANK.get(riskTier);
  const observed = EVIDENCE_SEVERITY_RANK.get(evidenceSeverity);
  return required !== undefined && observed !== undefined && observed >= required;
}

function resolveGitRevision(target, revision) {
  const requested = String(revision ?? "").trim();
  if (!requested) throw new Error("A Git revision is required");
  const result = spawnSync("git", ["-C", target, "rev-parse", "--verify", "--end-of-options", `${requested}^{commit}`], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Git revision cannot be resolved to a commit: ${requested}`);
  const resolved = result.stdout.trim().toLowerCase();
  if (!SHA.test(resolved)) throw new Error(`Git returned an invalid commit for ${requested}`);
  return resolved;
}

function readEvidenceRegistry(target) {
  return readJson(path.join(target, ".ai-org/project/evidence.json"));
}

function activePrincipals(document) {
  return (document?.principals ?? []).filter((entry) => (entry.status ?? (entry.active === false ? "inactive" : "active")) === "active");
}

function activeAgents(document) {
  return (document?.agents ?? []).filter((entry) => entry.active !== false);
}

function activeAssignments(document) {
  return new Map(
    (document?.assignments ?? [])
      .filter((entry) => entry.active !== false)
      .map((entry) => [entry.position_id, entry.agent_id])
  );
}

export function validateHighAssuranceProfilePrerequisites(collaboration, agentsDocument, assignmentsDocument) {
  const errors = [];
  const principals = activePrincipals(collaboration);
  const principalIds = new Set(principals.map((entry) => entry.id));
  const agents = activeAgents(agentsDocument);
  const sponsorByAgent = new Map(
    (collaboration?.sponsorships ?? [])
      .filter((entry) => (entry.status ?? (entry.active === false ? "inactive" : "active")) === "active" && principalIds.has(entry.principal_id))
      .map((entry) => [entry.agent_id, entry.principal_id])
  );
  const assignments = activeAssignments(assignmentsDocument);

  if (principals.length < 2) errors.push("High-Assurance requires at least two active Human Principals");
  const unsponsored = agents.filter((entry) => !sponsorByAgent.has(entry.id)).map((entry) => entry.id);
  if (unsponsored.length > 0) errors.push(`High-Assurance requires every active Agent Identity to have a Human Principal sponsor: ${unsponsored.join(", ")}`);

  const developer = assignments.get("developer");
  const independentQa = assignments.get("independent_qa");
  const releaseManager = assignments.get("release_manager");
  if (!developer || !independentQa || !releaseManager) {
    errors.push("High-Assurance requires active Developer, Independent QA, and Release Manager assignments");
  } else {
    if (developer === independentQa) errors.push("High-Assurance requires Developer and Independent QA separation");
    if (developer === releaseManager) errors.push("High-Assurance requires Developer and Release Manager separation");
  }
  return { valid: errors.length === 0, errors };
}

export async function readHighAssurancePolicy(target) {
  const policy = await readJson(path.join(target, HIGH_ASSURANCE_POLICY_RELATIVE_PATH));
  if (policy?.schema_version !== "temple.high-assurance/v1" || policy.profile !== HIGH_ASSURANCE_PROFILE) {
    throw new Error("Invalid High-Assurance policy");
  }
  return policy;
}

export function assuranceForRisk(policy, riskTier) {
  const normalized = String(riskTier ?? "standard").trim();
  if (!ASSURANCE_RISK_TIERS.includes(normalized) || !policy?.risk_tiers?.[normalized]) {
    throw new Error(`--risk-tier must be ${ASSURANCE_RISK_TIERS.join(", ")}`);
  }
  const tier = policy.risk_tiers[normalized];
  return {
    profile: HIGH_ASSURANCE_PROFILE,
    policy_schema: policy.schema_version,
    artifact_depth: tier.artifact_depth,
    minimum_approvals: tier.minimum_approvals,
    rollback_status: tier.rollback_status,
    external_action_performed: false
  };
}

export function validateWorkItemAssurance(policy, item) {
  const hasRiskTier = Object.hasOwn(item ?? {}, "risk_tier");
  const hasAssurance = Object.hasOwn(item ?? {}, "assurance");
  const workflowProfile = item?.workflow_profile ?? item?.assurance?.profile ?? null;
  if (workflowProfile !== HIGH_ASSURANCE_PROFILE) {
    return hasAssurance
      ? { valid: false, errors: ["assurance is valid only for a high-assurance workflow profile"] }
      : { valid: true, errors: [] };
  }
  if (!hasRiskTier || !hasAssurance) return { valid: false, errors: ["risk_tier and assurance must be recorded together"] };
  let expected;
  try {
    expected = assuranceForRisk(policy, item.risk_tier);
  } catch (error) {
    return { valid: false, errors: [error.message] };
  }
  const errors = [];
  for (const [key, value] of Object.entries(expected)) {
    if (item.assurance?.[key] !== value) errors.push(`assurance.${key} must be derived from ${item.risk_tier} risk`);
  }
  if (Object.keys(item.assurance ?? {}).some((key) => !Object.hasOwn(expected, key))) {
    errors.push("assurance contains unsupported fields");
  }
  return { valid: errors.length === 0, errors };
}

export function assertHighAssuranceUiMode(policy, riskTier, uiMode) {
  const allowed = policy.risk_tiers[riskTier]?.allowed_ui_modes ?? [];
  if (uiMode !== null && uiMode !== undefined && !allowed.includes(uiMode)) {
    throw new Error(`High-Assurance ${riskTier} risk does not permit ${uiMode}; use ${allowed.join(", ")}`);
  }
}

function currentEvidence(entry) {
  return !entry.invalidated_at && (!entry.expires_at || Date.parse(entry.expires_at) > Date.now());
}

export function actualDeveloper(context, item, collaboration, { allowLegacy = false } = {}) {
  const handoffs = (item.handoffs ?? []).filter(entry => entry.from_position === "developer");
  const candidate = item.developer_candidate_revision;
  const handoff = handoffs.findLast(entry => !candidate || entry.input_revision === candidate);
  if (handoffs.length && !handoff) throw new Error("Developer handoff does not match the actual candidate revision");
  const agentId = handoff?.actor ?? (allowLegacy ? context.assignments.get("developer") : null);
  if (!agentId || !context.agents.has(agentId)) throw new Error("The candidate needs an actual Developer handoff; a default assignment is not authorship evidence");
  const sponsors = (collaboration.sponsorships ?? []).filter(entry => entry.agent_id === agentId &&
    (entry.status ?? (entry.active === false ? "inactive" : "active")) === "active");
  if (sponsors.length > 1) throw new Error("Developer sponsorship is ambiguous");
  return { agent_id: agentId, principal_id: handoff?.principal_id ?? sponsors[0]?.principal_id ?? null,
    source: handoff ? "candidate-handoff" : "legacy-default" };
}

export async function assertActualReviewer(target, context, item, entries, positionId) {
  const { agentIsEligible } = await import("./collaboration.mjs");
  const collaboration = await readJson(path.join(target, ".ai-org/project/collaboration.json"));
  const developer = actualDeveloper(context, item, collaboration);
  for (const entry of entries) {
    const reviewer = context.agents.get(entry.recorded_by);
    if (!reviewer || reviewer.active === false || !agentIsEligible(collaboration, reviewer.id, positionId)) {
      throw new Error(`${entry.id} must be recorded by an eligible ${positionId} Agent Identity`);
    }
    if (reviewer.id === developer.agent_id) throw new Error("Independent QA must differ from the actual Developer Agent Identity");
  }
}

function expectedScopeRevision(target, item) {
  const candidate = item.developer_candidate_revision ?? item.base_revision;
  if (!candidate) return null;
  return resolveGitRevision(target, candidate);
}

function evidenceEntriesForRequirement(registry, item, references, contract) {
  const allowedKinds = new Set(contract.evidence_kinds ?? [contract.evidence_kind]);
  const allowedOutcomes = new Set(contract.accepted_outcomes ?? []);
  const ids = uniqueStrings(references);
  return ids.map((reference) => {
    const entry = registry.entries.find((candidate) => candidate.id === reference);
    if (!entry) throw new Error(`${contract.requirement} must reference normalized Evidence IDs; not found: ${reference}`);
    if (entry.work_item_id !== item.id) throw new Error(`${reference} belongs to ${entry.work_item_id}, not ${item.id}`);
    if (!currentEvidence(entry)) throw new Error(`${reference} is expired or invalidated`);
    if (!allowedKinds.has(entry.kind)) throw new Error(`${reference} must be ${[...allowedKinds].join(" or ")} evidence`);
    if (!allowedOutcomes.has(entry.outcome)) throw new Error(`${reference} outcome ${entry.outcome} does not satisfy ${contract.requirement}`);
    return entry;
  });
}

export async function assertHighAssuranceTransition(target, context, item, toState, gateEvidence) {
  if (item.assurance?.profile !== HIGH_ASSURANCE_PROFILE) return;
  const policy = await readHighAssurancePolicy(target);
  const assuranceValidation = validateWorkItemAssurance(policy, item);
  if (!assuranceValidation.valid) throw new Error(`${item.id} has an invalid High-Assurance risk contract: ${assuranceValidation.errors.join("; ")}`);
  const contract = policy.transition_requirements?.[`${item.state}->${toState}`];
  if (!contract) return;
  const references = gateEvidence[contract.requirement] ?? [];
  if (references.length === 0) {
    throw new Error(`Transition ${item.state} -> ${toState} is missing gate evidence: ${contract.requirement}. Use --satisfy requirement=EVID-ID.`);
  }
  const registry = await readEvidenceRegistry(target);
  const entries = evidenceEntriesForRequirement(registry, item, references, contract);
  const scopeRevision = expectedScopeRevision(target, item);
  if (scopeRevision && entries.some((entry) => entry.scope_revision !== scopeRevision)) {
    throw new Error(`${contract.requirement} must match exact scope revision ${scopeRevision}`);
  }
  if (contract.evidence_kind === "risk") {
    if (entries.some((entry) => !riskEvidenceCoversTier(item.risk_tier, entry.details?.severity))) {
      throw new Error(`${contract.requirement} severity must cover ${item.risk_tier} risk`);
    }
  }
  if (contract.required_position) {
    await assertActualReviewer(target, context, item, entries, contract.required_position);
  }
}

export async function exactHandoffRevision(target, item, revision) {
  return resolveGitRevision(target, revision);
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

async function validateApprovalRecord(target, approvalPath) {
  if (!isSafeRepositoryPath(approvalPath)) throw new Error("--approval must be a safe repository-relative JSON path");
  if (!(await pathExists(path.join(target, approvalPath)))) throw new Error(`Approval record is missing: ${approvalPath}`);
  const [record, schema] = await Promise.all([
    readJson(path.join(target, approvalPath)),
    readJson(path.join(target, ".ai-org/core/schemas/approval.schema.json"))
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(record)) {
    throw new Error(`Invalid High-Assurance approval record: ${validate.errors.map((entry) => `${entry.instancePath || "/"} ${entry.message}`).join("; ")}`);
  }
  return record;
}

async function assertNormalizedCloseEvidence(target, registry, item, gateEvidence, expectedRevision, context) {
  for (const [requirement, kinds, requiredPosition] of [
    ["test_evidence", ["test"], null],
    ["independent_qa_report", ["test", "runtime"], "independent_qa"]
  ]) {
    const references = uniqueStrings(gateEvidence[requirement]);
    if (references.length === 0) throw new Error(`High-Assurance close requires ${requirement}`);
    for (const reference of references) {
      const entry = registry.entries.find((candidate) => candidate.id === reference);
      if (!entry || entry.work_item_id !== item.id || !kinds.includes(entry.kind) || entry.outcome !== "pass" || !currentEvidence(entry)) {
        throw new Error(`${requirement} must contain current passing normalized ${kinds.join("/")} Evidence IDs`);
      }
      if (entry.scope_revision !== expectedRevision) throw new Error(`${reference} does not match tested revision ${expectedRevision}`);
      if (requiredPosition) await assertActualReviewer(target, context, item, [entry], requiredPosition);
    }
  }
}

export async function assertHighAssuranceCloseout(target, context, item, options, gateEvidence) {
  if (item.assurance?.profile !== HIGH_ASSURANCE_PROFILE) return { testedRevision: options.testedRevision, approval: null };
  const collaboration = await readJson(path.join(target, ".ai-org/project/collaboration.json"));
  const policy = await readHighAssurancePolicy(target);
  const assuranceValidation = validateWorkItemAssurance(policy, item);
  if (!assuranceValidation.valid) throw new Error(`${item.id} has an invalid High-Assurance risk contract: ${assuranceValidation.errors.join("; ")}`);
  const tier = policy.risk_tiers[item.risk_tier];
  if (!tier) throw new Error(`${item.id} has unsupported High-Assurance risk tier ${item.risk_tier}`);
  const testedRevision = resolveGitRevision(target, options.testedRevision);
  if (item.developer_candidate_revision !== testedRevision) {
    throw new Error(`Tested revision ${testedRevision} does not match developer candidate ${item.developer_candidate_revision ?? "missing"}`);
  }

  const registry = await readEvidenceRegistry(target);
  await assertNormalizedCloseEvidence(target, registry, item, gateEvidence, testedRevision, context);
  const rollbackEntries = uniqueStrings(options.rollback).map((reference) => registry.entries.find((entry) => entry.id === reference));
  if (rollbackEntries.some((entry) => !entry || entry.work_item_id !== item.id || entry.kind !== "rollback" || !currentEvidence(entry))) {
    throw new Error("High-Assurance --rollback values must be current normalized rollback Evidence IDs for this Work Item");
  }
  const acceptableRollback = tier.rollback_status === "verified" ? ["verified"] : ["planned", "verified"];
  if (rollbackEntries.length === 0 || rollbackEntries.some((entry) => !acceptableRollback.includes(entry.outcome))) {
    throw new Error(`High-Assurance ${item.risk_tier} risk requires ${tier.rollback_status} rollback evidence`);
  }
  if (rollbackEntries.some((entry) => entry.scope_revision && entry.scope_revision !== testedRevision)) {
    throw new Error("Rollback evidence does not match the tested revision");
  }

  const approval = await validateApprovalRecord(target, options.approval);
  if (approval.work_item_id !== item.id || approval.decision !== options.decision || approval.scope_revision !== testedRevision) {
    throw new Error("High-Assurance approval does not match the Work Item, decision, and exact tested revision");
  }
  const activePrincipalIds = new Set(activePrincipals(collaboration).map((entry) => entry.id));
  const approvalPrincipals = uniqueStrings(approval.approvals.map((entry) => entry.principal_id));
  if (approvalPrincipals.length !== approval.approvals.length || approvalPrincipals.some((id) => !activePrincipalIds.has(id))) {
    throw new Error("High-Assurance approval contains duplicate or inactive Human Principals");
  }
  if (approvalPrincipals.length < tier.minimum_approvals) {
    throw new Error(`High-Assurance ${item.risk_tier} risk requires ${tier.minimum_approvals} distinct Human Principal approvals`);
  }
  const developerSponsor = actualDeveloper(context, item, collaboration).principal_id;
  if (!developerSponsor || !activePrincipalIds.has(developerSponsor)) throw new Error("High-Assurance approval requires the actual Developer's active Human Principal provenance");
  if (approvalPrincipals.every((id) => id === developerSponsor)) {
    throw new Error("High-Assurance approval requires a Human Principal independent of the Developer sponsor");
  }
  return { testedRevision, approval };
}
