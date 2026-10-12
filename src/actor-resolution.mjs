import path from "node:path";
import { readJson } from "./files.mjs";
import { readLocalActorBinding, validateLocalActorBinding } from "./local-identity.mjs";

export const ACTOR_POLICY_MODES = ["attributed", "verified"];

export function actorResolutionError(code, message, nextAction, details = {}) {
  return Object.assign(new Error(message), {
    code, mutation_status: "not-started", next_action: nextAction, details
  });
}

export function effectiveActorPolicy(collaboration, options = {}) {
  const configured = collaboration?.actor_policy?.ordinary_development;
  if (collaboration?.actor_policy !== undefined &&
      (!collaboration.actor_policy || typeof collaboration.actor_policy !== "object" ||
       Array.isArray(collaboration.actor_policy) || !ACTOR_POLICY_MODES.includes(configured) ||
       Object.keys(collaboration.actor_policy).some((key) => key !== "ordinary_development"))) {
    throw actorResolutionError("TEMPLE_ACTOR_POLICY_INVALID", "The actor policy is invalid.",
      "Preview an explicit attributed or verified ordinary-development policy.");
  }
  const strict = options.strict === true || options.workflowProfile === "high-assurance" ||
    collaboration?.profile === "high-assurance";
  const legacySolo = configured === undefined && collaboration?.profile === "solo";
  const mode = strict ? "verified" : configured ?? (legacySolo ? "attributed" : "verified");
  return {
    ordinary_development: configured ?? null,
    mode,
    requires_verified: mode === "verified",
    source: strict ? "high-assurance-or-strict" : configured ? "explicit-policy" : "legacy-policy",
    provider_authentication: "not-performed-by-temple"
  };
}

const status = (record, inactive = "inactive") => record?.status ?? (record?.active === false ? inactive : "active");
const activePrincipal = (document, id) => id === "human" && document.profile === "solo" ||
  (document.principals ?? []).some((entry) => entry.id === id && status(entry) === "active");

function sponsorFor(document, agentId) {
  const sponsors = (document.sponsorships ?? []).filter((entry) => entry.agent_id === agentId && status(entry) === "active");
  if (sponsors.length > 1) throw actorResolutionError("TEMPLE_ACTOR_SPONSOR_AMBIGUOUS",
    `${agentId} has competing active sponsorships.`, "Reconcile sponsorship history before continuing.", { agent_id: agentId });
  return sponsors[0]?.principal_id ?? null;
}

function agentMap(context) {
  return context.agents instanceof Map ? context.agents :
    new Map((context.agentsDocument?.agents ?? context.agents?.agents ?? context.agents ?? []).map((entry) => [entry.id, entry]));
}

function defaultAgentId(context, positionId) {
  if (context.assignments instanceof Map) return context.assignments.get(positionId);
  return (context.assignmentsDocument?.assignments ?? context.assignments?.assignments ?? context.assignments ?? [])
    .find((entry) => entry.position_id === positionId && entry.active !== false)?.agent_id;
}

function eligible(document, id, positionId, disciplines, riskTier) {
  const risk = ["low", "standard", "high", "critical"];
  return (document.memberships ?? []).some((entry) => entry.agent_id === id && entry.position_id === positionId &&
    status(entry, "revoked") === "active" &&
    (!entry.qualification?.expires_at || Date.parse(entry.qualification.expires_at) > Date.now()) &&
    (!riskTier || risk.indexOf(entry.qualification?.risk_ceiling ?? "standard") >= risk.indexOf(riskTier)) &&
    disciplines.every((discipline) => (entry.disciplines ?? []).includes(discipline)));
}

function checkedBinding(context, document, input) {
  if (!input || input.status === "missing" || input.status === "unavailable") return null;
  const binding = input.binding ?? input;
  const validation = validateLocalActorBinding(binding, context.project?.id ?? null);
  if (!validation.valid) throw actorResolutionError("TEMPLE_ACTOR_BINDING_INVALID",
    `Invalid local actor binding: ${validation.errors.join("; ")}`,
    "Inspect or clear the invalid binding; provide the intended Principal explicitly.", { errors: validation.errors });
  if (input.status === "expired" || binding.expires_at && Date.parse(binding.expires_at) <= Date.now()) {
    throw actorResolutionError("TEMPLE_ACTOR_BINDING_EXPIRED", "The local actor binding is expired.",
      "Renew its supplied evidence or clear it and use explicit ordinary attribution.", { principal_id: binding.principal_id });
  }
  if (!activePrincipal(document, binding.principal_id)) throw actorResolutionError("TEMPLE_ACTOR_PRINCIPAL_INACTIVE",
    `The binding references an unknown or inactive Principal: ${binding.principal_id}.`,
    "Select an active recorded Principal; review or clear the stale binding.", { principal_id: binding.principal_id });
  const identities = (document.principals ?? []).find((entry) => entry.id === binding.principal_id)?.provider_identities ?? [];
  if (binding.verification_class !== "self-asserted" && identities.length && !identities.some((identity) =>
    identity.status === "active" && identity.provider === binding.provider?.id && identity.subject === binding.provider?.subject)) {
    throw actorResolutionError("TEMPLE_ACTOR_BINDING_PROVIDER_MISMATCH", "The supplied binding contradicts the Principal's recorded provider identity.",
      "Supply matching current provenance or explicitly reconcile the recorded provider identity.", { principal_id: binding.principal_id });
  }
  return binding;
}

/** Pure selection. A supplied binding is validated; it is evidence metadata, not provider authentication. */
function selectActor(context, options = {}, enforceVerification = true) {
  const document = options.collaboration ?? context.collaboration;
  if (!document) throw actorResolutionError("TEMPLE_ACTOR_CONTEXT_MISSING", "Collaboration state is required.", "Load current project collaboration state.");
  const positionId = options.positionId ?? options.item?.owner_position;
  if (!positionId) throw actorResolutionError("TEMPLE_ACTOR_POSITION_REQUIRED", "A Position is required.", "Choose the responsibility being performed.");
  const knownPositions = context.positions instanceof Map ? context.positions : context.positionsDocument ?
    new Map((context.positionsDocument.positions ?? []).map((entry) => [entry.id, entry])) : null;
  if (knownPositions && !knownPositions.has(positionId)) throw actorResolutionError("TEMPLE_ACTOR_POSITION_INVALID",
    `Unknown Position: ${positionId}.`, "Select a Position defined by the current project contract.");
  const policy = effectiveActorPolicy(document, { ...options, workflowProfile: options.workflowProfile ?? options.item?.workflow_profile });
  const binding = checkedBinding(context, document, options.binding);
  const requestedPrincipal = options.principalId || null;
  const requestedAgent = options.agentId || (options.actor !== "human" ? options.actor : null) || null;
  if (requestedPrincipal && !activePrincipal(document, requestedPrincipal)) throw actorResolutionError("TEMPLE_ACTOR_PRINCIPAL_INACTIVE",
    `Unknown or inactive Principal: ${requestedPrincipal}.`, "Inspect contributor readiness and select an active Principal.", { principal_id: requestedPrincipal });
  if (requestedPrincipal && binding && requestedPrincipal !== binding.principal_id) throw actorResolutionError("TEMPLE_ACTOR_BINDING_MISMATCH",
    `This Git clone is bound to ${binding.principal_id}, not ${requestedPrincipal}.`,
    "Inspect or clear the conflicting binding before selecting the intended Principal.", { principal_id: requestedPrincipal, binding_principal_id: binding.principal_id });
  const memberId = requestedPrincipal ?? binding?.principal_id ?? null;
  const agents = agentMap(context);
  // Stage entries replace the legacy Work Item-wide requirement, including an
  // intentionally empty entry. Callers may supply a separately resolved scope;
  // ordinary item/readiness callers must not silently skip these qualifications.
  const stageRequirement = options.item?.stage_requirements?.[options.item?.state];
  const disciplines = options.requiredDisciplines ??
    (stageRequirement ? stageRequirement.disciplines ?? [] : options.item?.required_disciplines ?? []);
  const riskTier = options.riskTier ?? options.item?.risk_tier;
  if (riskTier && !["low", "standard", "high", "critical"].includes(riskTier)) throw actorResolutionError("TEMPLE_ACTOR_RISK_INVALID",
    `Unsupported qualification risk tier: ${riskTier}.`, "Use the Work Item's recorded low, standard, high or critical risk tier.");
  const claim = options.item?.claim?.status === "active" && options.item.owner_position === positionId ? options.item.claim : null;
  if (claim?.position_id && claim.position_id !== positionId) throw actorResolutionError("TEMPLE_ACTOR_CLAIM_CONFLICT",
    "The active claim belongs to a different Position than the current responsibility.",
    "Recover or hand off the original claim before continuing in the new Position.", { claim, position_id: positionId });
  if (claim && ((requestedAgent && requestedAgent !== claim.agent_id) || (memberId && memberId !== claim.principal_id))) {
    throw actorResolutionError("TEMPLE_ACTOR_CLAIM_CONFLICT", `Another actor holds the active claim: ${claim.agent_id}.`,
      "Continue as the recorded claimant, or request an authorized handoff/release before claiming.", { claim, requested_agent_id: requestedAgent, principal_id: memberId });
  }
  const candidates = [...agents.values()].filter((agent) => agent.active !== false &&
    eligible(document, agent.id, positionId, disciplines, riskTier) &&
    (!memberId || sponsorFor(document, agent.id) === memberId || document.profile === "solo" && memberId === "human" && !sponsorFor(document, agent.id)));
  let agentId = claim?.agent_id ?? requestedAgent;
  let source = claim ? "active-claim" : requestedAgent ? "explicit-agent" : null;
  if (!agentId && memberId) {
    if (candidates.length > 1) throw actorResolutionError("TEMPLE_ACTOR_AMBIGUOUS",
      `Several eligible Agents belong to ${memberId} for ${positionId}.`, "Select an Agent by its stable --agent-id.",
      { principal_id: memberId, position_id: positionId, candidates: candidates.map((entry) => ({ agent_id: entry.id, display_name: entry.display_name })) });
    if (candidates.length === 1) { agentId = candidates[0].id; source = "member-eligibility"; }
  }
  if (!agentId && !memberId) { agentId = defaultAgentId(context, positionId); source = "default-assignment"; }
  const agent = agents.get(agentId);
  if (!agent || agent.active === false || !eligible(document, agentId, positionId, disciplines, riskTier)) {
    throw actorResolutionError("TEMPLE_ACTOR_INELIGIBLE", `No eligible selected Agent can perform ${positionId}.`,
      "Inspect contributor readiness; select an active qualified membership with the required disciplines and risk ceiling.",
      { agent_id: agentId ?? null, principal_id: memberId, position_id: positionId, required_disciplines: disciplines });
  }
  const sponsor = sponsorFor(document, agentId);
  const principalId = claim?.principal_id ?? memberId ?? sponsor ?? (document.profile === "solo" ? "human" : null);
  if (!principalId || !activePrincipal(document, principalId)) throw actorResolutionError("TEMPLE_ACTOR_SPONSOR_REQUIRED",
    `${agentId} needs an active recorded Principal sponsor.`, "Complete explicitly authorized contributor setup or recover the original anonymous claim.",
    { agent_id: agentId, principal_id: principalId, claim });
  if ((sponsor && sponsor !== principalId) || (!sponsor && document.profile !== "solo")) {
    throw actorResolutionError("TEMPLE_ACTOR_PRINCIPAL_MISMATCH", `${principalId} does not sponsor ${agentId}.`,
      "Choose that Principal's qualified Agent; use an authorized handoff for existing responsibility.", { agent_id: agentId, principal_id: principalId, sponsor_principal_id: sponsor });
  }
  if (binding && binding.principal_id !== principalId) throw actorResolutionError("TEMPLE_ACTOR_BINDING_MISMATCH",
    `This Git clone is bound to ${binding.principal_id}, not ${principalId}.`, "Inspect or clear the conflicting binding.", { principal_id: principalId });
  if (enforceVerification && policy.requires_verified && (!binding || !["external-evidence", "step-up-evidence"].includes(binding.verification_class))) {
    throw actorResolutionError("TEMPLE_ACTOR_VERIFICATION_REQUIRED", "This actor policy requires externally supplied verification evidence.",
      "Provide current verification provenance for this Principal; a local self-description does not authenticate a provider.",
      { principal_id: principalId, actor_policy: policy, provider_authentication: "not-performed-by-temple" });
  }
  return {
    agent_id: agentId, principal_id: principalId, agent, position_id: positionId, source, actor_policy: policy,
    provenance: {
      selection: source, principal_source: claim ? "active-claim" : requestedPrincipal ? "explicit-principal" : binding ? "local-binding" : sponsor ? "recorded-sponsor" : "legacy-solo",
      verification_class: binding?.verification_class ?? "attributed", evidence_ref: binding?.evidence_ref ?? null,
      provider_authenticated: false, externally_supplied_evidence: Boolean(binding && binding.verification_class !== "self-asserted")
    }
  };
}

export function resolveActor(context, options = {}) {
  return selectActor(context, options);
}

export function inspectActor(context, options = {}) {
  try { return { authority: "navigation-only", mutation_status: "no-write", ready: true, selected_actor: resolveActor(context, options), blockers: [] }; }
  catch (error) {
    let selected = null;
    if (error.code === "TEMPLE_ACTOR_VERIFICATION_REQUIRED") selected = selectActor(context, options, false);
    return { authority: "navigation-only", mutation_status: "no-write", ready: false, selected_actor: selected,
      blockers: [{ code: error.code ?? "TEMPLE_ACTOR_UNAVAILABLE", message: error.message, mutation_status: "no-write",
        next_action: error.next_action ?? "Inspect the recorded contributor and Position membership.", details: error.details ?? {} }] };
  }
}

async function projectActorOptions(target, context, options) {
  const collaboration = options.collaboration ?? context.collaboration ?? await readJson(path.join(target, ".ai-org/project/collaboration.json"));
  let binding = options.binding;
  if (binding === undefined) {
    try { binding = await readLocalActorBinding(target); }
    catch (error) {
      if (error.code === "TEMPLE_ACTOR_GIT_REQUIRED") binding = { status: "unavailable", binding: null };
      else throw error;
    }
  }
  return { ...options, collaboration, binding };
}

export async function resolveProjectActor(target, context, options = {}) {
  return resolveActor(context, await projectActorOptions(target, context, options));
}

export async function inspectProjectActor(target, context, options = {}) {
  try { return inspectActor(context, await projectActorOptions(target, context, options)); }
  catch (error) { return { authority: "navigation-only", mutation_status: "no-write", ready: false, selected_actor: null,
    blockers: [{ code: error.code ?? "TEMPLE_ACTOR_UNAVAILABLE", message: error.message, mutation_status: "no-write",
      next_action: error.next_action ?? "Inspect the current binding and contributor configuration.", details: error.details ?? {} }] }; }
}

export function formatAgentIdentity(context, agentId, collaboration = context.collaboration ?? {}) {
  const agents = agentMap(context);
  const agent = agents.get(agentId);
  if (!agent) return agentId;
  const repeated = [...agents.values()].filter((entry) => entry.display_name?.toLowerCase() === agent.display_name?.toLowerCase()).length > 1;
  if (!repeated) return agent.display_name;
  const sponsor = sponsorFor(collaboration, agentId);
  return `${agent.display_name} (${sponsor ? `${sponsor} / ` : ""}${agentId})`;
}
