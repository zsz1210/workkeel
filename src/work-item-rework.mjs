import path from "node:path";
import { readJson, sha256 } from "./files.mjs";
import { profileTransitions } from "./workflow.mjs";

export const REVIEW_STATES = new Set(["test", "eval", "independent_qa"]);
const CANDIDATE_FIELDS = ["developer_candidate_revision", "tested_revision", "independent_qa_revision", "qa_evidence_revision", "closeout_revision", "dispatch_revision", "release_record", "release_gate_result", "lifecycle_outcome", "approval_record", "closeout_reasons"];
const BOUNDARY_FIELDS = ["scope", "acceptance_criteria", "specification_mode", "spec_refs", "ux_refs", "ui_refs", "contract_refs", "ui_delivery_mode", "workflow_profile", "risk_tier", "assurance"];

export function reworkScopeDigest(item) {
  return sha256(JSON.stringify(Object.fromEntries(BOUNDARY_FIELDS.map(key => [key, item[key] ?? null]))));
}

export function prebuildRequirements(workflow, item, extra = []) {
  const transitions = profileTransitions(workflow, item);
  const required = new Set(extra);
  const visited = new Set();
  let state = workflow.initial_state;
  while (state !== "build") {
    const edges = transitions.filter(edge => edge.from === state);
    if (visited.has(state) || edges.length !== 1) throw new Error("Rework requires an unambiguous configured prebuild path");
    visited.add(state);
    for (const requirement of edges[0].requires ?? []) required.add(requirement);
    state = edges[0].to;
  }
  const downstream = transitions.filter(edge => !visited.has(edge.from)).flatMap(edge => edge.requires ?? []);
  if (downstream.some(key => required.has(key))) throw new Error("Rework cannot classify a gate used both before and after Build");
  if (!transitions.some(edge => edge.from === item.state)) throw new Error("Review state is unavailable in this workflow profile");
  return [...required];
}

export function assertReworkScope(item) {
  const last = item.rework_history?.at(-1);
  if (last && last.scope_digest !== reworkScopeDigest(item)) throw new Error("Rework scope or governing boundary changed; reconcile through separately approved work");
}

export function assertFreshReworkCandidate(item, revision) {
  assertReworkScope(item);
  if (item.rework_history?.some(entry => entry.rejected_revision === revision)) throw new Error("A rejected rework candidate cannot be handed off again; record the corrected commit");
}

// Retired evidence is retained for reading, never reactivated as a later gate.
export async function assertFreshReworkGates(target, item, gates) {
  const history = item.rework_history ?? [];
  if (!history.length) return;
  assertReworkScope(item);
  const retained = new Set(history.at(-1).retained_requirements);
  const referenceKey = ref => ref.startsWith("EVID-") || ref.includes(":") ? ref : path.normalize(ref);
  const retired = new Set(history.flatMap(entry => [
    ...Object.values(entry.retired_gate_evidence).flat(), ...entry.findings, ...entry.handoff_refs
  ]).map(referenceKey));
  let registry;
  for (const [requirement, refs] of Object.entries(gates)) {
    if (retained.has(requirement)) continue;
    for (const ref of refs) {
      if (retired.has(referenceKey(ref))) throw new Error(`Retired rework evidence cannot satisfy ${requirement}: ${ref}`);
      if (ref.startsWith("EVID-")) {
        registry ??= await readJson(path.join(target, ".ai-org/project/evidence.json"));
        const entry = registry.entries.find(entry => entry.id === ref);
        if (!item.developer_candidate_revision || entry?.scope_revision !== item.developer_candidate_revision) {
          throw new Error(`Rework evidence must match the new Developer candidate: ${ref}`);
        }
      }
    }
  }
}

export function prepareRework(item, { actor, reason, findings, revision, retainedRequirements, timestamp }) {
  const retained = new Set(retainedRequirements);
  const gateEvidence = Object.fromEntries(Object.entries(item.gate_evidence ?? {}).filter(([key]) => retained.has(key)));
  const retired = Object.fromEntries(Object.entries(item.gate_evidence ?? {}).filter(([key]) => !retained.has(key)));
  const claim = { ...item.claim, status: "released", released_at: timestamp, release_reason: "review_rework" };
  const entry = {
    sequence: (item.rework_history?.length ?? 0) + 1,
    returned_at: timestamp,
    from_state: item.state,
    reviewer_agent_id: actor,
    reviewer_claim_id: item.claim.id,
    rejected_revision: revision,
    reason,
    findings,
    scope_digest: reworkScopeDigest(item),
    retained_requirements: retainedRequirements,
    retired_gate_evidence: retired,
    retired_candidate_fields: Object.fromEntries(CANDIDATE_FIELDS.filter(key => Object.hasOwn(item, key)).map(key => [key, item[key]])),
    handoff_refs: (item.handoffs ?? []).map(handoff => handoff.artifact)
  };
  const updated = {
    ...item, state: "build", owner_position: "developer", planned_agent_id: null,
    updated_at: timestamp, claim,
    claims: [...(item.claims ?? []).filter(prior => prior.id !== claim.id), claim],
    gate_evidence: gateEvidence,
    rework_history: [...(item.rework_history ?? []), entry],
    next_position: "developer"
  };
  for (const field of [...CANDIDATE_FIELDS, "previous_state"]) delete updated[field];
  return { item: updated, entry };
}
