import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { atomicCreate, atomicWrite, formatJson, pathExists, readJson, sha256, rollbackFileChanges } from "./files.mjs";
import { validateDisplayName } from "./model.mjs";
import { appendEvent, uniqueStrings } from "./project.mjs";
import { HIGH_ASSURANCE_PROFILE, validateHighAssuranceProfilePrerequisites } from "./assurance.mjs";
import { actorResolutionError, effectiveActorPolicy, inspectProjectActor, formatAgentIdentity } from "./actor-resolution.mjs";

export const COLLABORATION_RELATIVE_PATH = ".ai-org/project/collaboration.json";
export const COLLABORATION_SCHEMA_V1 = "temple.collaboration/v1";
export const COLLABORATION_SCHEMA_V2 = "temple.collaboration/v2";
export const COLLABORATION_PROFILES = ["solo", "collaborative", HIGH_ASSURANCE_PROFILE];
export const PRINCIPAL_STATUSES = ["active", "suspended", "inactive"];
export const MEMBERSHIP_STATUSES = ["provisional", "active", "suspended", "expired", "revoked"];
export const AUTHORITY_GRANT_STATUSES = ["active", "suspended", "expired", "revoked"];
export const AUTHORITY_RISK_LEVELS = ["low", "standard", "high", "critical"];
export const HUMAN_AUTHORITIES = [
  "manage-identities",
  "manage-authority",
  "manage-recovery",
  "approve-critical-governance",
  "approve-high-risk-release"
];
export const VALIDATION_LEVELS = [
  "automated",
  "simulated_collaborative",
  "real_collaborative",
  "representative_pilot",
  "high_assurance_drill"
];
export const VALIDATION_STATUSES = ["not_run", "planned", "passed", "failed"];
export const DISCIPLINES = [
  "architecture",
  "backend",
  "database",
  "frontend",
  "full-stack",
  "general-development",
  "infrastructure",
  "mobile",
  "observability",
  "product",
  "quality",
  "release",
  "security",
  "ui",
  "ux"
];

const PRINCIPAL_ID = /^principal-[a-z0-9][a-z0-9-]*$/;
const AGENT_ID = /^agent-[a-z0-9][a-z0-9-]*$/;
const GRANT_ID = /^grant-[a-z0-9][a-z0-9-]*$/;
const DEFAULT_DISCIPLINES = {
  engineering_manager: ["architecture"],
  product_manager: ["product"],
  ux_designer: ["ux"],
  ui_designer: ["ui"],
  tech_lead: ["architecture"],
  developer: ["general-development"],
  quality_evaluator: ["quality"],
  independent_qa: ["quality"],
  release_manager: ["release"],
  observer: ["observability"]
};

function emptyValidationGate(plan = null) {
  return { status: "not_run", tested_revision: null, evidence: [], participants: [], environments: [], plan };
}

export function buildCollaborationState(assignmentsDocument) {
  const memberships = (assignmentsDocument.assignments ?? [])
    .filter((assignment) => assignment.active !== false)
    .map((assignment) => ({
      position_id: assignment.position_id,
      agent_id: assignment.agent_id,
      disciplines: DEFAULT_DISCIPLINES[assignment.position_id] ?? [],
      default: true,
      status: "active",
      active: true,
      qualification: {
        basis: "bootstrap-assignment",
        evidence_refs: [],
        risk_ceiling: "standard",
        qualified_at: null,
        review_after: null,
        expires_at: null
      }
    }))
    .sort((left, right) => left.position_id.localeCompare(right.position_id));
  return {
    schema_version: COLLABORATION_SCHEMA_V2,
    profile: "solo",
    actor_policy: { ordinary_development: "attributed" },
    coordination_backend: "repository",
    principals: [],
    sponsorships: [],
    memberships,
    authority_grants: [],
    bootstrap_owner: null,
    recovery: { status: "not_configured", trustee_principal_ids: [], threshold: 0, last_verified_at: null },
    validation: {
      automated: emptyValidationGate(),
      simulated_collaborative: emptyValidationGate(),
      real_collaborative: emptyValidationGate(".ai-org/templates/collaborative-large-scale-test-plan.md"),
      representative_pilot: emptyValidationGate(),
      high_assurance_drill: emptyValidationGate()
    }
  };
}

export async function ensureCollaborationState(target) {
  const documentPath = path.join(target, COLLABORATION_RELATIVE_PATH);
  if (await pathExists(documentPath)) return { path: documentPath, created: false, afterHash: null };
  const assignments = await readJson(path.join(target, ".ai-org/project/assignments.json"));
  const content = formatJson(buildCollaborationState(assignments));
  try {
    await atomicCreate(documentPath, content);
    return { path: documentPath, created: true, afterHash: sha256(content) };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return { path: documentPath, created: false, afterHash: null };
  }
}

export function synchronizeDefaultMembershipDocument(document, assignments) {
  const v2 = document.schema_version === COLLABORATION_SCHEMA_V2;
  const activeAssignments = (assignments.assignments ?? []).filter((assignment) => assignment.active !== false);
  const defaultKeys = new Set(activeAssignments.map((assignment) => `${assignment.position_id}:${assignment.agent_id}`));
  const nonDefaults = (document.memberships ?? []).filter(
    (membership) => membership.default !== true && !defaultKeys.has(`${membership.position_id}:${membership.agent_id}`)
  );
  const existingDefaults = new Map(
    (document.memberships ?? [])
      .filter((membership) => membership.default === true)
      .map((membership) => [membership.position_id, membership])
  );
  const defaults = activeAssignments
    .map((assignment) => ({
      position_id: assignment.position_id,
      agent_id: assignment.agent_id,
      disciplines:
        existingDefaults.get(assignment.position_id)?.disciplines ?? DEFAULT_DISCIPLINES[assignment.position_id] ?? [],
      default: true,
      ...(v2
        ? {
            status: "active",
            active: true,
            qualification: existingDefaults.get(assignment.position_id)?.qualification ?? {
              basis: "bootstrap-assignment",
              evidence_refs: [],
              risk_ceiling: "standard",
              qualified_at: null,
              review_after: null,
              expires_at: null
            }
          }
        : { active: true })
    }))
    .sort((left, right) => left.position_id.localeCompare(right.position_id));
  return { ...document, memberships: [...defaults, ...nonDefaults] };
}

export function principalStatus(principal) {
  return principal?.status ?? (principal?.active === false ? "inactive" : "active");
}

export function membershipStatus(membership) {
  return membership?.status ?? (membership?.active === false ? "revoked" : "active");
}

export function sponsorshipStatus(sponsorship) {
  return sponsorship?.status ?? (sponsorship?.active === false ? "inactive" : "active");
}

function legacyValidation(document) {
  const legacy = document.large_scale_validation ?? {
    status: "not_run",
    plan: ".ai-org/templates/collaborative-large-scale-test-plan.md"
  };
  const real = emptyValidationGate(legacy.plan);
  real.status = legacy.status ?? "not_run";
  real.tested_revision = legacy.tested_revision ?? null;
  real.evidence = legacy.evidence ?? [];
  return {
    automated: emptyValidationGate(),
    simulated_collaborative: emptyValidationGate(),
    real_collaborative: real,
    representative_pilot: emptyValidationGate(),
    high_assurance_drill: emptyValidationGate()
  };
}

export function normalizedCollaborationState(document) {
  if (document?.schema_version === COLLABORATION_SCHEMA_V2) return document;
  if (document?.schema_version !== COLLABORATION_SCHEMA_V1) return document;
  return {
    schema_version: COLLABORATION_SCHEMA_V2,
    profile: document.profile,
    ...(document.actor_policy !== undefined ? { actor_policy: document.actor_policy } : {}),
    coordination_backend: document.coordination_backend,
    principals: (document.principals ?? []).map((principal) => ({
      id: principal.id,
      display_name: principal.display_name,
      status: principalStatus(principal),
      active: principalStatus(principal) === "active",
      provider_identities: [],
      created_at: principal.created_at ?? null,
      updated_at: principal.created_at ?? null
    })),
    sponsorships: (document.sponsorships ?? []).map((entry) => ({
      principal_id: entry.principal_id,
      agent_id: entry.agent_id,
      status: sponsorshipStatus(entry),
      active: sponsorshipStatus(entry) === "active",
      created_at: entry.created_at ?? null,
      ended_at: entry.active === false ? entry.ended_at ?? null : null
    })),
    memberships: (document.memberships ?? []).map((entry) => ({
      position_id: entry.position_id,
      agent_id: entry.agent_id,
      disciplines: entry.disciplines ?? [],
      default: entry.default === true,
      status: entry.default === true && membershipStatus(entry) === "active" ? "active" : membershipStatus(entry) === "active" ? "provisional" : membershipStatus(entry),
      active: entry.default === true && membershipStatus(entry) === "active",
      qualification: {
        basis: entry.default === true ? "bootstrap-assignment" : "legacy-unverified",
        evidence_refs: [],
        risk_ceiling: entry.default === true ? "standard" : "low",
        qualified_at: null,
        review_after: null,
        expires_at: null
      }
    })),
    authority_grants: [],
    bootstrap_owner: null,
    recovery: { status: "not_configured", trustee_principal_ids: [], threshold: 0, last_verified_at: null },
    validation: legacyValidation(document)
  };
}

export function planCollaborationMigration(document) {
  if (document?.schema_version === COLLABORATION_SCHEMA_V2) {
    return { changed: false, from: COLLABORATION_SCHEMA_V2, to: COLLABORATION_SCHEMA_V2, document };
  }
  if (document?.schema_version !== COLLABORATION_SCHEMA_V1) throw new Error("Unsupported collaboration schema_version");
  return { changed: true, from: COLLABORATION_SCHEMA_V1, to: COLLABORATION_SCHEMA_V2, document: normalizedCollaborationState(document) };
}

export async function migrateCollaborationState(target, options = {}) {
  const document = await readCollaborationState(target);
  const plan = planCollaborationMigration(document);
  if (!plan.changed || options.dryRun) return plan;
  await writeCollaborationState(target, plan.document);
  await appendEvent(target, {
    timestamp: new Date().toISOString(),
    event_type: "collaboration_state_migrated",
    actor: options.actor ?? "human",
    from_schema: plan.from,
    to_schema: plan.to,
    refs: [COLLABORATION_RELATIVE_PATH]
  });
  return plan;
}

export async function readCollaborationState(target) {
  const documentPath = path.join(target, COLLABORATION_RELATIVE_PATH);
  if (!(await pathExists(documentPath))) {
    throw new Error(`${COLLABORATION_RELATIVE_PATH} is missing; run temple upgrade`);
  }
  return readJson(documentPath);
}

async function writeCollaborationState(target, document) {
  await atomicWrite(path.join(target, COLLABORATION_RELATIVE_PATH), formatJson(document));
}

export function validateCollaborationState(document, agentsDocument, assignmentsDocument, positionIds) {
  const errors = [];
  const warnings = [];
  const agentIds = new Set((agentsDocument?.agents ?? []).map((agent) => agent.id));
  const principalIds = new Set();
  const activeProviderSubjects = new Set();
  const v2 = document?.schema_version === COLLABORATION_SCHEMA_V2;
  if (![COLLABORATION_SCHEMA_V1, COLLABORATION_SCHEMA_V2].includes(document?.schema_version)) errors.push("invalid schema_version");
  if (!COLLABORATION_PROFILES.includes(document?.profile)) errors.push("unsupported collaboration profile");
  try { effectiveActorPolicy(document); } catch (error) { errors.push(error.message); }
  if (document?.actor_policy === undefined) warnings.push("Actor policy is absent; legacy verification requirements remain until an explicit policy transition.");
  if (document?.coordination_backend !== "repository") errors.push("coordination_backend must be repository");
  if (v2) {
    for (const level of VALIDATION_LEVELS) {
      const gate = document.validation?.[level];
      if (!gate || !VALIDATION_STATUSES.includes(gate.status)) {
        errors.push(`validation.${level} must have a supported status`);
        continue;
      }
      if (!Array.isArray(gate.evidence) || !Array.isArray(gate.participants) || !Array.isArray(gate.environments)) {
        errors.push(`validation.${level} evidence, participants, and environments must be arrays`);
      }
      if (gate.status === "passed" && (!gate.tested_revision || gate.evidence.length === 0)) {
        errors.push(`passed ${level} validation requires evidence and tested_revision`);
      }
      if (level === "real_collaborative" && gate.status === "passed") {
        if (new Set(gate.participants).size < 2 || new Set(gate.environments).size < 2) {
          errors.push("passed real_collaborative validation requires two distinct Principals and environments");
        }
      }
    }
  } else {
    const largeScale = document?.large_scale_validation;
    if (
      !largeScale ||
      !VALIDATION_STATUSES.includes(largeScale.status) ||
      typeof largeScale.plan !== "string" ||
      largeScale.plan.length === 0
    ) {
      errors.push("large_scale_validation must have a supported status and plan");
    }
    if (largeScale?.status === "passed" && (!(Array.isArray(largeScale.evidence) && largeScale.evidence.length > 0) || !largeScale.tested_revision)) {
      errors.push("passed large-scale validation requires evidence and tested_revision");
    }
  }

  for (const principal of document?.principals ?? []) {
    if (!PRINCIPAL_ID.test(principal.id ?? "") || principalIds.has(principal.id)) errors.push("invalid or duplicate principal ID");
    if (validateDisplayName(principal.display_name)) errors.push("invalid principal display name");
    if (v2 && !PRINCIPAL_STATUSES.includes(principal.status)) errors.push("principal status is invalid");
    if (v2 && !Array.isArray(principal.provider_identities)) errors.push("principal provider_identities must be an array");
    if (
      v2 &&
      (principal.provider_identities ?? []).some(
        (identity) =>
          !identity ||
          typeof identity.provider !== "string" ||
          !identity.provider.trim() ||
          typeof identity.subject !== "string" ||
          !identity.subject.trim() ||
          !["active", "inactive"].includes(identity.status)
      )
    ) {
      errors.push("principal provider identity is invalid");
    }
    if (v2) {
      for (const identity of (principal.provider_identities ?? []).filter((entry) => entry.status === "active")) {
        const key = `${identity.provider}:${identity.subject}`;
        if (activeProviderSubjects.has(key)) errors.push("active provider identity is linked to more than one Principal");
        activeProviderSubjects.add(key);
      }
    }
    principalIds.add(principal.id);
  }

  const sponsoredAgents = new Set();
  for (const sponsorship of document?.sponsorships ?? []) {
    if (!principalIds.has(sponsorship.principal_id) || !agentIds.has(sponsorship.agent_id)) {
      errors.push("sponsorship references an unknown principal or Agent Identity");
    }
    if (v2 && !["active", "inactive"].includes(sponsorship.status)) errors.push("sponsorship status is invalid");
    if (sponsorshipStatus(sponsorship) === "active") {
      if (sponsoredAgents.has(sponsorship.agent_id)) errors.push("an Agent Identity may have only one active sponsor");
      sponsoredAgents.add(sponsorship.agent_id);
    }
  }

  const memberships = document?.memberships ?? [];
  const membershipKeys = new Set();
  const defaultPositions = new Set();
  for (const membership of memberships) {
    const key = `${membership.position_id}:${membership.agent_id}`;
    if (!positionIds.has(membership.position_id) || !agentIds.has(membership.agent_id) || membershipKeys.has(key)) {
      errors.push("membership is invalid, duplicated, or references an unknown identity");
    }
    if (!Array.isArray(membership.disciplines) || membership.disciplines.some((value) => !DISCIPLINES.includes(value))) {
      errors.push("membership contains an unsupported discipline");
    }
    if (v2) {
      if (!MEMBERSHIP_STATUSES.includes(membership.status)) errors.push("membership status is invalid");
      if (!membership.qualification || !Array.isArray(membership.qualification.evidence_refs)) {
        errors.push("membership qualification is invalid");
      }
      if (!AUTHORITY_RISK_LEVELS.includes(membership.qualification?.risk_ceiling)) errors.push("membership risk ceiling is invalid");
    }
    if (membership.default) {
      if (defaultPositions.has(membership.position_id)) errors.push("a Position may have only one default membership");
      defaultPositions.add(membership.position_id);
    }
    membershipKeys.add(key);
  }

  for (const assignment of (assignmentsDocument?.assignments ?? []).filter((entry) => entry.active !== false)) {
    const matching = memberships.find(
      (membership) =>
        membershipStatus(membership) === "active" &&
        membership.default === true &&
        membership.position_id === assignment.position_id &&
        membership.agent_id === assignment.agent_id
    );
    if (!matching) errors.push(`default membership does not match assignment for ${assignment.position_id}`);
  }

  if (v2) {
    const activePrincipals = new Set(
      (document.principals ?? []).filter((entry) => principalStatus(entry) === "active").map((entry) => entry.id)
    );
    const grantIds = new Set();
    for (const grant of document.authority_grants ?? []) {
      if (!GRANT_ID.test(grant.id ?? "") || grantIds.has(grant.id)) errors.push("invalid or duplicate authority grant ID");
      if (!principalIds.has(grant.principal_id)) errors.push("authority grant references an unknown Principal");
      if (!HUMAN_AUTHORITIES.includes(grant.authority)) errors.push("authority grant names an unsupported authority");
      if (!AUTHORITY_GRANT_STATUSES.includes(grant.status)) errors.push("authority grant status is invalid");
      if (!AUTHORITY_RISK_LEVELS.includes(grant.risk_ceiling)) errors.push("authority grant risk ceiling is invalid");
      if (!Array.isArray(grant.approved_by) || grant.approved_by.some((id) => !principalIds.has(id))) {
        errors.push("authority grant approval provenance is invalid");
      }
      grantIds.add(grant.id);
    }
    const bootstrap = document.bootstrap_owner;
    if (bootstrap !== null) {
      if (!principalIds.has(bootstrap.principal_id) || !["active", "retired"].includes(bootstrap.status)) {
        errors.push("bootstrap_owner is invalid");
      }
      if (bootstrap.status === "active" && !activePrincipals.has(bootstrap.principal_id)) {
        errors.push("active bootstrap owner must be an active Principal");
      }
    }
    const recovery = document.recovery;
    if (!recovery || !["not_configured", "ready", "degraded"].includes(recovery.status)) {
      errors.push("recovery configuration is invalid");
    } else {
      const trustees = new Set(recovery.trustee_principal_ids ?? []);
      if (trustees.size !== (recovery.trustee_principal_ids ?? []).length || [...trustees].some((id) => !principalIds.has(id))) {
        errors.push("recovery trustees are invalid");
      }
      if (!Number.isInteger(recovery.threshold) || recovery.threshold < 0 || recovery.threshold > trustees.size) {
        errors.push("recovery threshold is invalid");
      }
      if (recovery.status === "ready" && (recovery.threshold < 1 || [...trustees].filter((id) => activePrincipals.has(id)).length < recovery.threshold)) {
        errors.push("ready recovery requires enough active trustees");
      }
    }
  }

  if (["collaborative", HIGH_ASSURANCE_PROFILE].includes(document?.profile)) {
    const activePrincipalIds = new Set(
      (document.principals ?? []).filter((entry) => principalStatus(entry) === "active").map((entry) => entry.id)
    );
    if (activePrincipalIds.size === 0) warnings.push("Collaborative profile has no active Human Principal");
    const unsponsored = [...agentIds].filter((agentId) => !sponsoredAgents.has(agentId));
    if (unsponsored.length > 0) warnings.push(`unsponsored Agent Identities: ${unsponsored.join(", ")}`);
    const realValidationStatus = v2 ? document.validation?.real_collaborative?.status : document.large_scale_validation?.status;
    if (realValidationStatus !== "passed") {
      warnings.push("real multi-human, multi-machine validation has not passed");
    }
  }
  if (document?.profile === HIGH_ASSURANCE_PROFILE) {
    errors.push(...validateHighAssuranceProfilePrerequisites(document, agentsDocument, assignmentsDocument).errors);
  }
  return { valid: errors.length === 0, errors: uniqueStrings(errors), warnings: uniqueStrings(warnings) };
}

export async function setCollaborationProfile(target, profile) {
  if (!COLLABORATION_PROFILES.includes(profile)) {
    throw new Error(`Unsupported profile ${profile}; use ${COLLABORATION_PROFILES.join(" or ")}`);
  }
  const document = await readCollaborationState(target);
  if (profile === HIGH_ASSURANCE_PROFILE) {
    const [agentsDocument, assignmentsDocument] = await Promise.all([
      readJson(path.join(target, ".ai-org/project/agents.json")),
      readJson(path.join(target, ".ai-org/project/assignments.json"))
    ]);
    const readiness = validateHighAssuranceProfilePrerequisites(document, agentsDocument, assignmentsDocument);
    if (!readiness.valid) throw new Error(readiness.errors.join("; "));
  }
  const updated = { ...document, profile };
  await writeCollaborationState(target, updated);
  await appendEvent(target, {
    timestamp: new Date().toISOString(),
    event_type: "collaboration_profile_changed",
    actor: "human",
    profile,
    refs: [COLLABORATION_RELATIVE_PATH]
  });
  return updated;
}

export async function addPrincipal(target, options) {
  const principalId = String(options.principalId ?? "").trim();
  const displayName = String(options.displayName ?? "").trim();
  if (!PRINCIPAL_ID.test(principalId)) throw new Error("--principal-id must match principal-<lowercase-slug>");
  const nameError = validateDisplayName(displayName);
  if (nameError) throw new Error(`Principal display name ${nameError}`);
  const document = await readCollaborationState(target);
  if ((document.principals ?? []).some((principal) => principal.id === principalId)) throw new Error(`Principal already exists: ${principalId}`);
  const timestamp = new Date().toISOString();
  const providerId = String(options.providerId ?? "").trim();
  const providerSubject = String(options.providerSubject ?? "").trim();
  const providerHandle = String(options.providerHandle ?? "").trim() || null;
  const evidenceRef = String(options.evidenceRef ?? "").trim() || null;
  if (Boolean(providerId) !== Boolean(providerSubject)) throw new Error("Provider identity requires both --provider-id and --provider-subject");
  if (providerId.length > 80 || providerSubject.length > 200 || (providerHandle?.length ?? 0) > 160 || (evidenceRef?.length ?? 0) > 500) {
    throw new Error("Provider identity value exceeds its supported length");
  }
  if (
    providerId &&
    (document.principals ?? []).some((principal) =>
      (principal.provider_identities ?? []).some(
        (identity) => identity.status === "active" && identity.provider === providerId && identity.subject === providerSubject
      )
    )
  ) {
    throw new Error("Provider identity is already linked to another Human Principal");
  }
  const principal =
    document.schema_version === COLLABORATION_SCHEMA_V2
      ? {
          id: principalId,
          display_name: displayName,
          status: "active",
          active: true,
          provider_identities: providerId
            ? [{ provider: providerId, subject: providerSubject, handle: providerHandle, status: "active", verified_at: null, evidence_ref: evidenceRef }]
            : [],
          created_at: timestamp,
          updated_at: timestamp
        }
      : { id: principalId, display_name: displayName, active: true, created_at: timestamp };
  const bootstrapOwner =
    document.schema_version === COLLABORATION_SCHEMA_V2 && document.bootstrap_owner === null && (document.principals ?? []).length === 0
      ? { principal_id: principalId, status: "active", granted_at: timestamp, retired_at: null }
      : document.bootstrap_owner;
  const updated = {
    ...document,
    principals: [...(document.principals ?? []), principal],
    ...(document.schema_version === COLLABORATION_SCHEMA_V2 ? { bootstrap_owner: bootstrapOwner } : {})
  };
  await writeCollaborationState(target, updated);
  await appendEvent(target, {
    timestamp: principal.created_at,
    event_type: "human_principal_added",
    actor: principalId,
    principal_id: principalId,
    refs: [COLLABORATION_RELATIVE_PATH]
  });
  return principal;
}

export async function sponsorAgent(target, options) {
  const document = await readCollaborationState(target);
  const agents = await readJson(path.join(target, ".ai-org/project/agents.json"));
  if (!(document.principals ?? []).some((principal) => principal.id === options.principalId && principalStatus(principal) === "active")) {
    throw new Error(`Unknown active principal: ${options.principalId ?? "missing"}`);
  }
  if (!(agents.agents ?? []).some((agent) => agent.id === options.agentId && agent.active !== false)) {
    throw new Error(`Unknown active Agent Identity: ${options.agentId ?? "missing"}`);
  }
  const timestamp = new Date().toISOString();
  const sponsorship =
    document.schema_version === COLLABORATION_SCHEMA_V2
      ? { principal_id: options.principalId, agent_id: options.agentId, status: "active", active: true, created_at: timestamp, ended_at: null }
      : { principal_id: options.principalId, agent_id: options.agentId, active: true };
  const prior =
    document.schema_version === COLLABORATION_SCHEMA_V2
      ? (document.sponsorships ?? []).map((entry) =>
          entry.agent_id === options.agentId && sponsorshipStatus(entry) === "active"
            ? { ...entry, status: "inactive", active: false, ended_at: timestamp }
            : entry
        )
      : (document.sponsorships ?? []).filter((entry) => entry.agent_id !== options.agentId);
  const updated = { ...document, sponsorships: [...prior, sponsorship] };
  await writeCollaborationState(target, updated);
  await appendEvent(target, {
    timestamp: new Date().toISOString(),
    event_type: "agent_sponsored",
    actor: options.principalId,
    principal_id: options.principalId,
    agent_id: options.agentId,
    refs: [COLLABORATION_RELATIVE_PATH]
  });
  return sponsorship;
}

export async function addAgentIdentity(target, options) {
  const agentId = String(options.agentId ?? "").trim();
  const displayName = String(options.displayName ?? "").trim();
  if (!AGENT_ID.test(agentId)) throw new Error("--agent-id must match agent-<lowercase-slug>");
  const nameError = validateDisplayName(displayName);
  if (nameError) throw new Error(`Agent display name ${nameError}`);
  const documentPath = path.join(target, ".ai-org/project/agents.json");
  const document = await readJson(documentPath);
  if ((document.agents ?? []).some((agent) => agent.id === agentId)) throw new Error(`Agent Identity already exists: ${agentId}`);
  const agent = { id: agentId, display_name: displayName, active: true, created_at: new Date().toISOString() };
  await atomicWrite(documentPath, formatJson({ ...document, agents: [...(document.agents ?? []), agent] }));
  await appendEvent(target, {
    timestamp: agent.created_at,
    event_type: "agent_identity_added",
    actor: "human",
    agent_id: agentId,
    refs: [".ai-org/project/agents.json"]
  });
  return agent;
}

export async function addMembership(target, options) {
  const document = await readCollaborationState(target);
  const [agents, positions] = await Promise.all([
    readJson(path.join(target, ".ai-org/project/agents.json")),
    readJson(path.join(target, ".ai-org/core/positions.json"))
  ]);
  if (!(agents.agents ?? []).some((agent) => agent.id === options.agentId && agent.active !== false)) {
    throw new Error(`Unknown active Agent Identity: ${options.agentId ?? "missing"}`);
  }
  if (!(positions.positions ?? []).some((position) => position.id === options.positionId)) {
    throw new Error(`Unknown Position: ${options.positionId ?? "missing"}`);
  }
  const disciplines = uniqueStrings(options.disciplines);
  const unsupported = disciplines.filter((value) => !DISCIPLINES.includes(value));
  if (unsupported.length > 0) throw new Error(`Unsupported disciplines: ${unsupported.join(", ")}`);
  const memberships = [...(document.memberships ?? [])];
  const index = memberships.findIndex(
    (membership) => membership.agent_id === options.agentId && membership.position_id === options.positionId
  );
  const membership =
    document.schema_version === COLLABORATION_SCHEMA_V2
      ? {
          position_id: options.positionId,
          agent_id: options.agentId,
          disciplines,
          default: index >= 0 ? memberships[index].default === true : false,
          status: index >= 0 && memberships[index].default === true ? "active" : "provisional",
          active: index >= 0 && memberships[index].default === true,
          qualification:
            index >= 0 && memberships[index].qualification
              ? memberships[index].qualification
              : {
                  basis: index >= 0 && memberships[index].default === true ? "bootstrap-assignment" : "pending-evidence",
                  evidence_refs: [],
                  risk_ceiling: index >= 0 && memberships[index].default === true ? "standard" : "low",
                  qualified_at: null,
                  review_after: null,
                  expires_at: null
                }
        }
      : {
          position_id: options.positionId,
          agent_id: options.agentId,
          disciplines,
          default: index >= 0 ? memberships[index].default === true : false,
          active: true
        };
  if (index >= 0) memberships[index] = membership;
  else memberships.push(membership);
  const updated = { ...document, memberships };
  await writeCollaborationState(target, updated);
  await appendEvent(target, {
    timestamp: new Date().toISOString(),
    event_type: "position_membership_changed",
    actor: "human",
    position: options.positionId,
    agent_id: options.agentId,
    disciplines,
    refs: [COLLABORATION_RELATIVE_PATH]
  });
  return membership;
}

function requireV2(document, action) {
  if (document.schema_version !== COLLABORATION_SCHEMA_V2) {
    throw new Error(`${action} requires collaboration v2; run temple collaboration migrate first`);
  }
}

function validDateOrNull(value) {
  return value === null || value === undefined || (typeof value === "string" && !Number.isNaN(Date.parse(value)));
}

function activePrincipalIds(document) {
  return new Set((document.principals ?? []).filter((entry) => principalStatus(entry) === "active").map((entry) => entry.id));
}

function activeAuthorityGrant(document, principalId, authority) {
  const now = Date.now();
  return (document.authority_grants ?? []).some(
    (entry) =>
      entry.principal_id === principalId &&
      entry.authority === authority &&
      entry.status === "active" &&
      (!entry.expires_at || Date.parse(entry.expires_at) > now)
  );
}

function assertGovernanceApprovals(document, approvedBy, authority = "manage-authority") {
  const approvals = uniqueStrings(approvedBy);
  const active = activePrincipalIds(document);
  if (approvals.some((id) => !active.has(id))) throw new Error("Governance approval references an inactive or unknown Principal");
  if (document.bootstrap_owner?.status === "active") {
    if (!approvals.includes(document.bootstrap_owner.principal_id)) throw new Error("Active Bootstrap Owner approval is required");
    return approvals;
  }
  if (approvals.length < 2 || approvals.filter((id) => activeAuthorityGrant(document, id, authority)).length < 2) {
    throw new Error(`Two distinct active ${authority} grant holders are required`);
  }
  return approvals;
}

export async function setPrincipalStatus(target, options) {
  const document = await readCollaborationState(target);
  requireV2(document, "Principal lifecycle");
  const status = String(options.status ?? "").trim();
  if (!PRINCIPAL_STATUSES.includes(status)) throw new Error(`--status must be ${PRINCIPAL_STATUSES.join(", ")}`);
  const index = (document.principals ?? []).findIndex((entry) => entry.id === options.principalId);
  if (index < 0) throw new Error(`Unknown Human Principal: ${options.principalId ?? "missing"}`);
  if (document.bootstrap_owner?.status === "active" && document.bootstrap_owner.principal_id === options.principalId && status !== "active") {
    throw new Error("Retire the Bootstrap Owner before suspending or deactivating that Principal");
  }
  const timestamp = new Date().toISOString();
  const principals = [...document.principals];
  principals[index] = { ...principals[index], status, active: status === "active", updated_at: timestamp };
  const active = new Set(principals.filter((entry) => principalStatus(entry) === "active").map((entry) => entry.id));
  const recovery = document.recovery;
  const activeTrustees = (recovery.trustee_principal_ids ?? []).filter((id) => active.has(id)).length;
  const updatedRecovery =
    recovery.status === "not_configured"
      ? recovery
      : { ...recovery, status: recovery.threshold > 0 && activeTrustees >= recovery.threshold ? "ready" : "degraded" };
  const updated = { ...document, principals, recovery: updatedRecovery };
  await writeCollaborationState(target, updated);
  await appendEvent(target, {
    timestamp,
    event_type: "human_principal_status_changed",
    actor: options.actor ?? "human",
    principal_id: options.principalId,
    status,
    refs: [COLLABORATION_RELATIVE_PATH]
  });
  return principals[index];
}

export async function setMembershipQualification(target, options) {
  const document = await readCollaborationState(target);
  requireV2(document, "Membership qualification");
  const status = String(options.status ?? "active").trim();
  if (!MEMBERSHIP_STATUSES.includes(status)) throw new Error(`--status must be ${MEMBERSHIP_STATUSES.join(", ")}`);
  const memberships = [...(document.memberships ?? [])];
  const index = memberships.findIndex((entry) => entry.agent_id === options.agentId && entry.position_id === options.positionId);
  if (index < 0) throw new Error("Unknown Position Membership");
  if (memberships[index].default === true && status !== "active") throw new Error("A default Assignment membership must remain active");
  const evidenceRefs = uniqueStrings(options.evidenceRefs);
  if (status === "active" && memberships[index].default !== true && evidenceRefs.length === 0) {
    throw new Error("Activating a non-default membership requires evidence");
  }
  const riskCeiling = String(options.riskCeiling ?? memberships[index].qualification?.risk_ceiling ?? "standard").trim();
  if (!AUTHORITY_RISK_LEVELS.includes(riskCeiling)) throw new Error(`--risk-tier must be ${AUTHORITY_RISK_LEVELS.join(", ")}`);
  const reviewAfter = String(options.reviewAfter ?? "").trim() || null;
  const expiresAt = String(options.expiresAt ?? "").trim() || null;
  if (!validDateOrNull(reviewAfter) || !validDateOrNull(expiresAt)) throw new Error("Membership review or expiry timestamp is invalid");
  const timestamp = new Date().toISOString();
  memberships[index] = {
    ...memberships[index],
    status,
    active: status === "active",
    qualification: {
      basis: status === "active" ? (memberships[index].default ? "bootstrap-assignment" : "evidence") : memberships[index].qualification?.basis ?? "pending-evidence",
      evidence_refs: evidenceRefs.length > 0 ? evidenceRefs : memberships[index].qualification?.evidence_refs ?? [],
      risk_ceiling: riskCeiling,
      qualified_at: status === "active" ? timestamp : memberships[index].qualification?.qualified_at ?? null,
      review_after: reviewAfter,
      expires_at: expiresAt
    }
  };
  const updated = { ...document, memberships };
  await writeCollaborationState(target, updated);
  await appendEvent(target, {
    timestamp,
    event_type: "position_membership_qualification_changed",
    actor: options.actor ?? "human",
    agent_id: options.agentId,
    position: options.positionId,
    status,
    refs: [COLLABORATION_RELATIVE_PATH, ...evidenceRefs]
  });
  return memberships[index];
}

export async function grantHumanAuthority(target, options) {
  const document = await readCollaborationState(target);
  requireV2(document, "Human Authority Grants");
  const grantId = String(options.grantId ?? "").trim();
  const principalId = String(options.principalId ?? "").trim();
  const authority = String(options.authority ?? "").trim();
  const riskCeiling = String(options.riskCeiling ?? "standard").trim();
  const scope = String(options.scope ?? "project").trim();
  if (!GRANT_ID.test(grantId)) throw new Error("--grant-id must match grant-<lowercase-slug>");
  if ((document.authority_grants ?? []).some((entry) => entry.id === grantId)) throw new Error(`Authority grant already exists: ${grantId}`);
  if (!activePrincipalIds(document).has(principalId)) throw new Error(`Unknown active Human Principal: ${principalId}`);
  if (!HUMAN_AUTHORITIES.includes(authority)) throw new Error(`--authority must be ${HUMAN_AUTHORITIES.join(", ")}`);
  if (!AUTHORITY_RISK_LEVELS.includes(riskCeiling)) throw new Error(`--risk-tier must be ${AUTHORITY_RISK_LEVELS.join(", ")}`);
  if (!scope || scope.length > 240) throw new Error("--scope is invalid");
  const approvedBy = assertGovernanceApprovals(document, options.approvedBy);
  const expiresAt = String(options.expiresAt ?? "").trim() || null;
  if (!validDateOrNull(expiresAt)) throw new Error("Authority grant expiry is invalid");
  const timestamp = new Date().toISOString();
  const grant = {
    id: grantId,
    principal_id: principalId,
    authority,
    scope,
    risk_ceiling: riskCeiling,
    status: "active",
    approved_by: approvedBy,
    granted_at: timestamp,
    expires_at: expiresAt,
    revoked_at: null
  };
  await writeCollaborationState(target, { ...document, authority_grants: [...(document.authority_grants ?? []), grant] });
  await appendEvent(target, {
    timestamp,
    event_type: "human_authority_granted",
    actor: options.actor ?? approvedBy[0] ?? "human",
    principal_id: principalId,
    grant_id: grantId,
    authority,
    refs: [COLLABORATION_RELATIVE_PATH]
  });
  return grant;
}

export async function revokeHumanAuthority(target, options) {
  const document = await readCollaborationState(target);
  requireV2(document, "Human Authority Grants");
  const index = (document.authority_grants ?? []).findIndex((entry) => entry.id === options.grantId);
  if (index < 0) throw new Error(`Unknown Human Authority Grant: ${options.grantId ?? "missing"}`);
  const approvedBy = assertGovernanceApprovals(document, options.approvedBy);
  const timestamp = new Date().toISOString();
  const grants = [...document.authority_grants];
  grants[index] = { ...grants[index], status: "revoked", revoked_at: timestamp, revoked_by: approvedBy };
  await writeCollaborationState(target, { ...document, authority_grants: grants });
  await appendEvent(target, {
    timestamp,
    event_type: "human_authority_revoked",
    actor: options.actor ?? approvedBy[0] ?? "human",
    grant_id: options.grantId,
    refs: [COLLABORATION_RELATIVE_PATH]
  });
  return grants[index];
}

export async function configureGovernanceRecovery(target, options) {
  const document = await readCollaborationState(target);
  requireV2(document, "Governance recovery");
  const approvedBy = assertGovernanceApprovals(document, options.approvedBy, "manage-recovery");
  const trustees = uniqueStrings(options.trusteePrincipalIds);
  const active = activePrincipalIds(document);
  if (trustees.length === 0 || trustees.some((id) => !active.has(id))) throw new Error("Recovery trustees must be distinct active Human Principals");
  const threshold = Number(options.threshold);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > trustees.length) throw new Error("Recovery threshold must be between one and the trustee count");
  const timestamp = new Date().toISOString();
  const recovery = { status: "ready", trustee_principal_ids: trustees, threshold, last_verified_at: timestamp, approved_by: approvedBy };
  await writeCollaborationState(target, { ...document, recovery });
  await appendEvent(target, {
    timestamp,
    event_type: "governance_recovery_configured",
    actor: options.actor ?? approvedBy[0] ?? "human",
    threshold,
    refs: [COLLABORATION_RELATIVE_PATH]
  });
  return recovery;
}

export async function establishBootstrapOwner(target, options) {
  const document = await readCollaborationState(target);
  requireV2(document, "Bootstrap establishment");
  if (document.bootstrap_owner !== null) throw new Error("Bootstrap Owner has already been established or retired");
  const principalId = String(options.principalId ?? "").trim();
  const active = activePrincipalIds(document);
  if (!active.has(principalId)) throw new Error(`Unknown active Human Principal: ${principalId || "missing"}`);
  const approvedBy = uniqueStrings(options.approvedBy);
  const minimum = active.size >= 2 ? 2 : 1;
  if (approvedBy.length < minimum || !approvedBy.includes(principalId) || approvedBy.some((id) => !active.has(id))) {
    throw new Error(`Bootstrap establishment requires the proposed owner and ${minimum === 2 ? "another distinct" : "the"} active Principal approval`);
  }
  const timestamp = new Date().toISOString();
  const bootstrapOwner = {
    principal_id: principalId,
    status: "active",
    granted_at: timestamp,
    retired_at: null,
    approved_by: approvedBy
  };
  await writeCollaborationState(target, { ...document, bootstrap_owner: bootstrapOwner });
  await appendEvent(target, {
    timestamp,
    event_type: "bootstrap_owner_established",
    actor: options.actor ?? approvedBy[0],
    principal_id: principalId,
    refs: [COLLABORATION_RELATIVE_PATH]
  });
  return bootstrapOwner;
}

export async function retireBootstrapOwner(target, options) {
  const document = await readCollaborationState(target);
  requireV2(document, "Bootstrap retirement");
  if (!document.bootstrap_owner || document.bootstrap_owner.status !== "active") throw new Error("No active Bootstrap Owner exists");
  const approvedBy = uniqueStrings(options.approvedBy);
  const active = activePrincipalIds(document);
  if (approvedBy.length < 2 || !approvedBy.includes(document.bootstrap_owner.principal_id) || approvedBy.some((id) => !active.has(id))) {
    throw new Error("Bootstrap retirement requires the Bootstrap Owner and another distinct active Principal");
  }
  const managers = [...active].filter((id) => activeAuthorityGrant(document, id, "manage-authority"));
  if (managers.length < 2) throw new Error("Bootstrap retirement requires two active manage-authority grant holders");
  if (document.recovery?.status !== "ready") throw new Error("Bootstrap retirement requires ready governance recovery");
  const timestamp = new Date().toISOString();
  const bootstrapOwner = { ...document.bootstrap_owner, status: "retired", retired_at: timestamp, approved_by: approvedBy };
  await writeCollaborationState(target, { ...document, bootstrap_owner: bootstrapOwner });
  await appendEvent(target, {
    timestamp,
    event_type: "bootstrap_owner_retired",
    actor: options.actor ?? document.bootstrap_owner.principal_id,
    refs: [COLLABORATION_RELATIVE_PATH]
  });
  return bootstrapOwner;
}

function resolvedRevision(target, revision) {
  const result = spawnSync("git", ["-C", target, "rev-parse", "--verify", `${revision}^{commit}`], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Cannot resolve validation revision: ${revision}`);
  return result.stdout.trim();
}

export async function recordCollaborationValidation(target, options) {
  const document = await readCollaborationState(target);
  requireV2(document, "Tiered collaboration validation");
  const level = String(options.level ?? "").trim();
  const status = String(options.status ?? "").trim();
  if (!VALIDATION_LEVELS.includes(level)) throw new Error(`--validation-level must be ${VALIDATION_LEVELS.join(", ")}`);
  if (!VALIDATION_STATUSES.includes(status)) throw new Error(`--status must be ${VALIDATION_STATUSES.join(", ")}`);
  const evidence = uniqueStrings(options.evidenceRefs);
  const participants = uniqueStrings(options.participants);
  const environments = uniqueStrings(options.environments);
  const revision = options.revision ? resolvedRevision(target, options.revision) : null;
  if (status === "passed" && (!revision || evidence.length === 0)) throw new Error("Passed validation requires an exact revision and evidence");
  if (level === "real_collaborative" && status === "passed") {
    const active = activePrincipalIds(document);
    if (participants.length < 2 || participants.some((id) => !active.has(id)) || environments.length < 2) {
      throw new Error("Real Collaborative pass requires two distinct active Principals and independently administered environments");
    }
  }
  const current = document.validation[level];
  const gate = {
    ...current,
    status,
    tested_revision: revision,
    evidence,
    participants,
    environments,
    recorded_at: new Date().toISOString()
  };
  const updated = { ...document, validation: { ...document.validation, [level]: gate } };
  await writeCollaborationState(target, updated);
  await appendEvent(target, {
    timestamp: gate.recorded_at,
    event_type: "collaboration_validation_recorded",
    actor: options.actor ?? "human",
    validation_level: level,
    status,
    tested_revision: revision,
    refs: [COLLABORATION_RELATIVE_PATH, ...evidence]
  });
  return gate;
}

export function sponsoredPrincipal(document, agentId) {
  return (document.sponsorships ?? []).find((entry) => entry.agent_id === agentId && sponsorshipStatus(entry) === "active")?.principal_id ?? null;
}

export function agentIsEligible(document, agentId, positionId, requiredDisciplines = []) {
  const memberships = (document.memberships ?? []).filter(
    (entry) =>
      membershipStatus(entry) === "active" &&
      (!entry.qualification?.expires_at || Date.parse(entry.qualification.expires_at) > Date.now()) &&
      entry.agent_id === agentId &&
      entry.position_id === positionId
  );
  const available = new Set(memberships.flatMap((entry) => entry.disciplines ?? []));
  return memberships.length > 0 && requiredDisciplines.every((discipline) => available.has(discipline));
}

async function contributorSnapshot(target) {
  const files = [COLLABORATION_RELATIVE_PATH, ".ai-org/project/project.json", ".ai-org/project/agents.json",
    ".ai-org/project/assignments.json", ".ai-org/core/positions.json"];
  const workDirectory = path.join(target, ".ai-org/work-items");
  const names = await fs.readdir(workDirectory).catch((error) => { if (error.code === "ENOENT") return []; throw error; });
  files.push(...names.filter((name) => /^WI-[a-zA-Z0-9-]+\.json$/.test(name)).sort().map((name) => `.ai-org/work-items/${name}`));
  for (const optional of [".ai-org/events/events.jsonl", ".ai-org/project/tasks.json", "temple.lock"]) {
    if (await pathExists(path.join(target, optional))) files.push(optional);
  }
  const contents = new Map(await Promise.all(files.sort().map(async (relative) => [relative, await fs.readFile(path.join(target, relative), "utf8")])));
  const json = (relative) => JSON.parse(contents.get(relative));
  const collaboration = json(COLLABORATION_RELATIVE_PATH);
  const agentsDocument = json(".ai-org/project/agents.json");
  const assignmentsDocument = json(".ai-org/project/assignments.json");
  const positionsDocument = json(".ai-org/core/positions.json");
  const context = { project: json(".ai-org/project/project.json"), collaboration, agentsDocument, assignmentsDocument, positionsDocument,
    agents: new Map((agentsDocument.agents ?? []).map((entry) => [entry.id, entry])),
    assignments: new Map((assignmentsDocument.assignments ?? []).filter((entry) => entry.active !== false).map((entry) => [entry.position_id, entry.agent_id])) };
  const workItems = [...contents.keys()].filter((relative) => relative.startsWith(".ai-org/work-items/")).map(json);
  return { collaboration, context, workItems, contents,
    fingerprint: `sha256:${sha256(formatJson([...contents].map(([relative, bytes]) => [relative, sha256(bytes)])))}` };
}

function activeWorkSummary(snapshot) {
  return snapshot.workItems.filter((item) => !["done", "cancelled"].includes(item.state)).map((item) => ({
    work_item_id: item.id, state: item.state, owner_position: item.owner_position,
    claim: item.claim?.status === "active" ? item.claim : null
  }));
}

function anonymousClaims(snapshot) {
  return activeWorkSummary(snapshot).filter((item) => item.claim && (!item.claim.principal_id || item.claim.principal_id === "human"));
}

function diagnostic(error, principalId = null) {
  return { code: error.code ?? "TEMPLE_CONTRIBUTOR_NOT_READY", message: error.message,
    mutation_status: "no-write", responsible_actor: error.details?.claim?.agent_id ?? error.details?.responsible_actor ?? principalId,
    next_action: error.next_action ?? "Inspect the contributor's current membership and attribution.", details: error.details ?? {} };
}

/** Navigation only. Readiness never creates membership, claims, local binding or acceptance. */
export async function contributorReadiness(target, options = {}) {
  const snapshot = await contributorSnapshot(target);
  const { collaboration, context } = snapshot;
  const principalId = options.principalId ?? null;
  const principal = (collaboration.principals ?? []).find((entry) => entry.id === principalId) ?? null;
  const ownAgents = [...context.agents.values()].filter((agent) => !principalId || sponsoredPrincipal(collaboration, agent.id) === principalId ||
    principalId === "human" && collaboration.profile === "solo" && !sponsoredPrincipal(collaboration, agent.id));
  const item = options.item ?? snapshot.workItems.find((entry) => entry.id === options.workItemId);
  const positions = [...new Set((collaboration.memberships ?? []).filter((entry) => ownAgents.some((agent) => agent.id === entry.agent_id)).map((entry) => entry.position_id))].sort();
  const blockers = [];
  const eligiblePositions = [];
  let selected = null;
  let actorPolicy;
  if (options.workItemId && !item) blockers.push(diagnostic(actorResolutionError("TEMPLE_CONTRIBUTOR_WORK_ITEM_MISSING",
    `Work Item ${options.workItemId} is missing.`, "Select an existing Work Item before checking its contributor readiness."), principalId));
  try { actorPolicy = effectiveActorPolicy(collaboration, { ...options, workflowProfile: options.workflowProfile ?? item?.workflow_profile }); }
  catch (error) { blockers.push(diagnostic(error, principalId)); }
  if (principalId && !(principalId === "human" && collaboration.profile === "solo") && (!principal || principalStatus(principal) !== "active")) {
    blockers.push(diagnostic(actorResolutionError("TEMPLE_ACTOR_PRINCIPAL_INACTIVE", `Unknown or inactive Principal: ${principalId}.`,
      "Complete explicitly authorized contributor setup or select an existing active Principal."), principalId));
  }
  if (blockers.length === 0) {
    const requestedPosition = options.positionId ?? item?.owner_position;
    for (const positionId of requestedPosition ? [requestedPosition] : positions) {
      try {
        const inspection = await inspectProjectActor(target, context, { ...options, item, collaboration, positionId });
        const actor = inspection.selected_actor;
        blockers.push(...inspection.blockers.map((entry) => ({ ...entry,
          responsible_actor: entry.details?.claim?.agent_id ?? entry.details?.responsible_actor ?? principalId })));
        if (actor) eligiblePositions.push({ position_id: positionId, agent_id: actor.agent_id, principal_id: actor.principal_id, provenance: actor.provenance, ready: inspection.ready });
        if (requestedPosition && actor) selected = actor;
      } catch (error) { blockers.push(diagnostic(error, principalId)); }
    }
  }
  if (!selected && eligiblePositions.length === 0 && blockers.length === 0) {
    blockers.push(diagnostic(actorResolutionError("TEMPLE_CONTRIBUTOR_MEMBERSHIP_REQUIRED", "No eligible Position membership is configured.",
      "Select the required delivery/review roles during explicitly authorized member setup."), principalId));
  }
  const taskBlockers = [...blockers];
  const claim = item?.claim?.status === "active" ? item.claim : null;
  const addTaskBlocker = (code, message, responsibleActor, nextAction) => taskBlockers.push({
    code, message, responsible_actor: responsibleActor, mutation_status: "no-write", next_action: nextAction
  });
  if (item) {
    if (["done", "cancelled", "concluded"].includes(item.state)) addTaskBlocker("TEMPLE_TASK_TERMINAL",
      `${item.id} is ${item.state}.`, item.owner_position, "Inspect the completed record; new work needs a separately authorized Work Item.");
    if (item.state === "blocked") addTaskBlocker("TEMPLE_TASK_BLOCKED", `${item.id} is blocked.`, item.owner_position,
      "Inspect the recorded unresolved conditions and obtain resolution evidence before resuming the previous stage.");
    if (options.positionId && options.positionId !== item.owner_position) addTaskBlocker("TEMPLE_TASK_WRONG_POSITION",
      `${item.id} currently belongs to ${item.owner_position}, not ${options.positionId}.`, claim?.agent_id ?? item.assigned_agent_id ?? item.owner_position,
      `Inspect context for ${item.owner_position}; complete the current stage before taking another responsibility.`);
    if (!claim && selected && item.planned_agent_id && item.planned_agent_id !== selected.agent_id) addTaskBlocker("TEMPLE_ACTOR_PLAN_MISMATCH",
      `${item.id} is planned for ${item.planned_agent_id}, not ${selected.agent_id}.`, item.planned_agent_id,
      "Ask the authorized coordinator to reconcile the planned assignment with the intended contributor; do not select another person's identity to bypass it.");
  }
  const taskReady = item ? taskBlockers.length === 0 && selected !== null : null;
  const task = item ? { work_item_id: item.id, state: item.state, owner_position: item.owner_position,
    recorded_agent_id: item.assigned_agent_id ?? null, planned_agent_id: item.planned_agent_id ?? null,
    active_claim: claim ? { id: claim.id, agent_id: claim.agent_id, principal_id: claim.principal_id, branch: claim.branch ?? null } : null,
    assignment_note: claim && item.planned_agent_id && item.planned_agent_id !== claim.agent_id ? "The active claim owns current work; the different planned assignment remains visible for coordinator reconciliation after handoff." : null,
    ready: taskReady, readiness_scope: "actor-and-assignment-only; execution guards still apply", blockers: taskBlockers,
    next_operation: taskReady ? claim ? "context resolve" : "work-item claim" : "resolve-task-blockers",
    responsible_actor: taskBlockers[0]?.responsible_actor ?? claim?.agent_id ?? selected?.agent_id ?? item.owner_position,
    next_action: taskBlockers[0]?.next_action ?? (claim ? `Continue the recorded claim ${claim.id} through the current ${item.owner_position} context; do not claim again.` : "Inspect current context, then claim as the selected contributor within the authorized scope.") } : null;
  return { schema_version: "temple.contributor-readiness/v1", authority: "navigation-only", mutation_status: "no-write",
    ready_scope: "actor-eligibility-only", task_ready: taskReady, task,
    ready: blockers.length === 0 && eligiblePositions.length > 0, principal_id: principalId, principal,
    actor_policy: actorPolicy ?? null, selected_actor: selected, eligible_positions: eligiblePositions,
    agents: ownAgents.map((agent) => ({ ...agent, label: formatAgentIdentity(context, agent.id, collaboration), sponsor_principal_id: sponsoredPrincipal(collaboration, agent.id) })),
    blockers, active_work: activeWorkSummary(snapshot), anonymous_active_claims: anonymousClaims(snapshot),
    next_action: task?.next_action ?? blockers[0]?.next_action ?? "Inspect the authorized Work Item before claiming with the selected eligible Agent.", fingerprint: snapshot.fingerprint };
}

export async function previewCollaborationTransition(target, options = {}) {
  const snapshot = await contributorSnapshot(target);
  const profile = options.profile ?? snapshot.collaboration.profile;
  if (!COLLABORATION_PROFILES.includes(profile)) throw actorResolutionError("TEMPLE_COLLABORATION_PROFILE_INVALID",
    `Unsupported profile: ${profile}.`, "Choose solo, collaborative or high-assurance.");
  const actorPolicy = options.actorPolicy === undefined ? snapshot.collaboration.actor_policy :
    typeof options.actorPolicy === "string" ? { ordinary_development: options.actorPolicy } : options.actorPolicy;
  const proposed = { ...snapshot.collaboration, profile, ...(actorPolicy !== undefined ? { actor_policy: actorPolicy } : {}) };
  const effective = effectiveActorPolicy(proposed);
  const positionIds = new Set((snapshot.context.positionsDocument.positions ?? []).map((entry) => entry.id));
  const validation = validateCollaborationState(proposed, snapshot.context.agentsDocument, snapshot.context.assignmentsDocument, positionIds);
  const anonymous = anonymousClaims(snapshot);
  const missingMappings = [...snapshot.context.agents.values()].filter((agent) => agent.active !== false &&
    !activePrincipalIds(proposed).has(sponsoredPrincipal(proposed, agent.id))).map((agent) => agent.id);
  const proposal = { profile, actor_policy: actorPolicy ?? null };
  const fingerprint = `sha256:${sha256(formatJson([snapshot.fingerprint, proposal]))}`;
  return { schema_version: "temple.collaboration-transition/v1", mutation_status: "no-write", fingerprint, input_fingerprint: snapshot.fingerprint,
    from: { profile: snapshot.collaboration.profile, actor_policy: snapshot.collaboration.actor_policy ?? null },
    to: proposal, actor_policy: effective,
    changed: formatJson(snapshot.collaboration) !== formatJson(proposed), applicable: validation.valid,
    blockers: validation.errors.map((message) => ({ code: "TEMPLE_COLLABORATION_PREREQUISITE", message, next_action: "Resolve the missing profile prerequisites before applying." })),
    warnings: validation.warnings, missing_sponsor_mappings: profile === "solo" ? [] : missingMappings,
    active_work: activeWorkSummary(snapshot), anonymous_active_claims: anonymous,
    recovery_choices: anonymous.length && profile !== "solo" ? [
      "Complete or release the anonymous claim under its original responsibility before changing profile.",
      "Apply without transferring the claim, then perform an explicitly authorized handoff preserving its history."
    ] : [],
    preserves: ["work-item IDs", "active claims", "history", "evidence", "local binding", "product files", "authority grants"],
    fingerprint_paths: [...snapshot.contents.keys()] };
}

async function writeContributorChanges(target, changes) {
  const written = [];
  try {
    for (const [relative, before, after] of changes) {
      const filename = path.join(target, relative);
      const current = await fs.readFile(filename, "utf8").catch((error) => { if (error.code === "ENOENT") return null; throw error; });
      if (current !== before) throw actorResolutionError("TEMPLE_CONTRIBUTOR_STALE", "Contributor configuration changed before writing.", "Preview the current configuration again.");
      await atomicWrite(filename, after);
      written.push({ path: filename, before, afterHash: sha256(after) });
    }
  } catch (error) {
    try { await rollbackFileChanges(written); }
    catch (rollbackError) { throw Object.assign(actorResolutionError("TEMPLE_CONTRIBUTOR_RECOVERY_REQUIRED", rollbackError.message,
      "Preserve the written files and reconcile the interrupted contributor setup.", { cause: error.message, written_paths: written.map((entry) => entry.path) }), { mutation_status: "recovery-required" }); }
    throw Object.assign(error, { mutation_status: written.length ? "rolled-back" : "not-started" });
  }
}

export async function applyCollaborationTransition(target, options = {}) {
  const preview = await previewCollaborationTransition(target, options);
  if (!options.fingerprint || options.fingerprint !== preview.fingerprint) throw actorResolutionError("TEMPLE_COLLABORATION_PREVIEW_STALE",
    "The collaboration transition preview is missing or stale.", "Preview the same profile and actor policy against current files and apply its fingerprint.", { current_fingerprint: preview.fingerprint });
  if (!preview.applicable) throw actorResolutionError("TEMPLE_COLLABORATION_PREREQUISITE", "The proposed profile has unmet prerequisites.",
    "Resolve the preview blockers and preview again.", { blockers: preview.blockers });
  const snapshot = await contributorSnapshot(target);
  if (snapshot.fingerprint !== preview.input_fingerprint) throw actorResolutionError("TEMPLE_COLLABORATION_PREVIEW_STALE",
    "Project state changed after preview validation.", "Preview again before applying.");
  if (!preview.changed) return { ...preview, mutation_status: "no-write", applied: false };
  const updated = { ...snapshot.collaboration, profile: preview.to.profile,
    ...(preview.to.actor_policy !== null ? { actor_policy: preview.to.actor_policy } : {}) };
  const eventPath = ".ai-org/events/events.jsonl";
  const events = snapshot.contents.get(eventPath) ?? null;
  const event = { timestamp: new Date().toISOString(), event_type: "collaboration_transition_applied", actor: options.actor ?? "human",
    from: preview.from, to: preview.to, preview_fingerprint: preview.fingerprint, anonymous_claims_preserved: preview.anonymous_active_claims.map((entry) => entry.work_item_id), refs: [COLLABORATION_RELATIVE_PATH] };
  await writeContributorChanges(target, [[COLLABORATION_RELATIVE_PATH, snapshot.contents.get(COLLABORATION_RELATIVE_PATH), formatJson(updated)],
    [eventPath, events, `${events ?? ""}${events && !events.endsWith("\n") ? "\n" : ""}${JSON.stringify(event)}\n`]]);
  return { ...preview, mutation_status: "applied", applied: true };
}

/** Caller supplies the existing human authorization and explicit roles; no authority is inferred from repository access. */
export async function setupContributor(target, options = {}) {
  if (options.authorized !== true) throw actorResolutionError("TEMPLE_CONTRIBUTOR_AUTHORIZATION_REQUIRED", "Contributor setup needs explicit authorization for the selected roles.",
    "Record the contributor's already-authorized scope and explicit Agent/Position choices.");
  const snapshot = await contributorSnapshot(target);
  if (snapshot.collaboration.schema_version !== COLLABORATION_SCHEMA_V2) throw actorResolutionError("TEMPLE_CONTRIBUTOR_SCHEMA_UPGRADE_REQUIRED",
    "Contributor setup requires collaboration v2.", "Preview and apply the existing collaboration schema migration first; profile transition does not perform schema migration.");
  const principalId = String(options.principalId ?? "").trim();
  const displayName = String(options.displayName ?? "").trim();
  if (!PRINCIPAL_ID.test(principalId) || validateDisplayName(displayName)) throw actorResolutionError("TEMPLE_CONTRIBUTOR_IDENTITY_INVALID",
    "A stable Principal ID and valid display name are required.", "Provide principal-<slug> and the contributor's display name.");
  const requestedAgents = [options.deliveryAgent, options.reviewAgent];
  if (requestedAgents.some((entry) => !entry || !AGENT_ID.test(entry.id ?? "") || validateDisplayName(entry.displayName ?? entry.display_name))) {
    throw actorResolutionError("TEMPLE_CONTRIBUTOR_AGENT_REQUIRED", "Explicit delivery and review Agent identities are required.", "Choose two distinct stable Agent IDs and their display names.");
  }
  if (requestedAgents[0].id === requestedAgents[1].id) throw actorResolutionError("TEMPLE_CONTRIBUTOR_SEPARATION_REQUIRED",
    "Delivery and review must use different Agent Identities.", "Reuse or select a distinct review Agent ID.");
  const updated = structuredClone(snapshot.collaboration);
  const agents = structuredClone(snapshot.context.agentsDocument);
  const timestamp = new Date().toISOString();
  const existingPrincipal = (updated.principals ?? []).find((entry) => entry.id === principalId);
  if (existingPrincipal && (principalStatus(existingPrincipal) !== "active" || existingPrincipal.display_name !== displayName)) throw actorResolutionError("TEMPLE_CONTRIBUTOR_EXISTING_IDENTITY_CONFLICT",
    "The existing Principal is inactive or has different identity details.", "Reuse the recorded identity details or perform an explicit identity/status change.", { principal_id: principalId });
  if (!existingPrincipal) updated.principals.push({ id: principalId, display_name: displayName, status: "active", active: true,
    provider_identities: [], created_at: timestamp, updated_at: timestamp });
  const knownPositions = new Set((snapshot.context.positionsDocument.positions ?? []).map((entry) => entry.id));
  for (const [index, requested] of requestedAgents.entries()) {
    const name = requested.displayName ?? requested.display_name;
    const roles = uniqueStrings(requested.positions);
    const reviewRoles = new Set(["quality_evaluator", "independent_qa", "release_manager"]);
    if (!roles.length || roles.some((role) => !knownPositions.has(role) || (index === 1 ? !reviewRoles.has(role) : reviewRoles.has(role)))) {
      throw actorResolutionError("TEMPLE_CONTRIBUTOR_ROLES_INVALID", "Select explicit, separate delivery and review Positions.",
        "Use delivery Positions for the delivery Agent and quality/release Positions for the review Agent.");
    }
    const existing = agents.agents.find((entry) => entry.id === requested.id);
    if (existing && (existing.active === false || existing.display_name !== name)) throw actorResolutionError("TEMPLE_CONTRIBUTOR_EXISTING_IDENTITY_CONFLICT",
      `The existing Agent ${requested.id} is inactive or has different details.`, "Reuse its recorded identity or perform an explicit identity change.");
    if (!existing) agents.agents.push({ id: requested.id, display_name: name, active: true, created_at: timestamp });
    const priorSponsorships = (updated.sponsorships ?? []).filter((entry) => entry.agent_id === requested.id);
    if (priorSponsorships.length && (sponsoredPrincipal(updated, requested.id) !== principalId ||
      priorSponsorships.filter((entry) => sponsorshipStatus(entry) === "active").length !== 1)) {
      throw actorResolutionError("TEMPLE_CONTRIBUTOR_SPONSOR_CONFLICT", `${requested.id} has another or inactive sponsorship.`,
        "Reuse that contributor's Agent or perform an explicit sponsorship change preserving history.");
    }
    if (!priorSponsorships.length) updated.sponsorships.push({ agent_id: requested.id, principal_id: principalId, status: "active", active: true, created_at: timestamp, ended_at: null });
    const opposite = index === 0 ? "independent_qa" : "developer";
    if (roles.includes(index === 0 ? "developer" : "independent_qa") && updated.memberships.some((entry) => entry.agent_id === requested.id && entry.position_id === opposite && membershipStatus(entry) === "active")) {
      throw actorResolutionError("TEMPLE_CONTRIBUTOR_SEPARATION_REQUIRED", `${requested.id} already holds the conflicting ${opposite} responsibility.`, "Select a distinct delivery/review identity.");
    }
    for (const positionId of roles) {
      const disciplines = uniqueStrings(requested.disciplines ?? DEFAULT_DISCIPLINES[positionId] ?? []);
      if (disciplines.some((value) => !DISCIPLINES.includes(value))) throw actorResolutionError("TEMPLE_CONTRIBUTOR_DISCIPLINE_INVALID", "An unsupported discipline was selected.", "Select a supported discipline for the Position.");
      const membership = updated.memberships.find((entry) => entry.agent_id === requested.id && entry.position_id === positionId);
      if (membership) {
        if (!agentIsEligible(updated, requested.id, positionId, disciplines)) throw actorResolutionError("TEMPLE_CONTRIBUTOR_QUALIFICATION_REQUIRED",
          `Existing membership for ${requested.id}/${positionId} is not currently eligible.`, "Review its qualification explicitly; setup does not renew or expand existing authority.");
        continue;
      }
      const evidenceRefs = uniqueStrings(requested.evidenceRefs ?? options.evidenceRefs);
      if (!evidenceRefs.length) throw actorResolutionError("TEMPLE_CONTRIBUTOR_QUALIFICATION_REQUIRED", `New membership for ${requested.id}/${positionId} requires qualification evidence.`,
        "Provide the already-approved membership qualification evidence references.");
      updated.memberships.push({ agent_id: requested.id, position_id: positionId, disciplines, default: false, status: "active", active: true,
        qualification: { basis: "evidence", evidence_refs: evidenceRefs, risk_ceiling: "standard", qualified_at: timestamp, review_after: null, expires_at: null } });
    }
  }
  const validation = validateCollaborationState(updated, agents, snapshot.context.assignmentsDocument, knownPositions);
  if (!validation.valid) throw actorResolutionError("TEMPLE_CONTRIBUTOR_CONFIGURATION_INVALID", validation.errors.join("; "), "Resolve the existing configuration conflicts before setup.");
  const changed = formatJson(updated) !== formatJson(snapshot.collaboration) || formatJson(agents) !== formatJson(snapshot.context.agentsDocument);
  if (!changed) return { schema_version: "temple.contributor-setup/v1", mutation_status: "no-write", changed: false, principal_id: principalId, agent_ids: requestedAgents.map((entry) => entry.id), authority_grants_changed: false,
    anonymous_active_claims: anonymousClaims(snapshot) };
  if ((await contributorSnapshot(target)).fingerprint !== snapshot.fingerprint) throw actorResolutionError("TEMPLE_CONTRIBUTOR_STALE", "Contributor state changed during setup.", "Retry against the current recorded identities.");
  const eventPath = ".ai-org/events/events.jsonl";
  const events = snapshot.contents.get(eventPath) ?? null;
  const event = { timestamp, event_type: "contributor_setup", actor: options.actor ?? "human", principal_id: principalId,
    agent_ids: requestedAgents.map((entry) => entry.id), refs: [COLLABORATION_RELATIVE_PATH, ".ai-org/project/agents.json", ...uniqueStrings(options.evidenceRefs)] };
  await writeContributorChanges(target, [[".ai-org/project/agents.json", snapshot.contents.get(".ai-org/project/agents.json"), formatJson(agents)],
    [COLLABORATION_RELATIVE_PATH, snapshot.contents.get(COLLABORATION_RELATIVE_PATH), formatJson(updated)],
    [eventPath, events, `${events ?? ""}${events && !events.endsWith("\n") ? "\n" : ""}${JSON.stringify(event)}\n`]]);
  return { schema_version: "temple.contributor-setup/v1", mutation_status: "applied", changed: true, principal_id: principalId,
    agent_ids: requestedAgents.map((entry) => entry.id), authority_grants_changed: false, anonymous_active_claims: anonymousClaims(snapshot),
    next_action: "Inspect contributor readiness for the authorized task." };
}
