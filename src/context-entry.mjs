import { nextStateForItem, transitionFor } from "./workflow.mjs";
import { sha256 } from "./files.mjs";

// These are measured freshness inputs, not an instruction to load every body.
export function contextAuthorityPaths(item) {
  return [
    "AGENTS.md", "TEMPLE.md", "temple.lock", ".ai-org/core/workflow.json",
    ".ai-org/core/positions.json", ".ai-org/core/policies.json",
    ".ai-org/project/assignments.json", ".ai-org/project/agents.json",
    ".ai-org/project/collaboration.json", ".ai-org/project/spec-index.json",
    ".ai-org/project/usage-policy.json", ".ai-org/project/repository-integration.json",
    ...(item.ui_delivery_mode !== "not-applicable" ? [".ai-org/core/ui-design.json"] : []),
    ...(item.workflow_profile === "high-assurance" || item.assurance?.profile === "high-assurance" ? [".ai-org/core/high-assurance.json"] : [])
  ];
}

export function compactContextEntry(capsule, item, context, pending = null, diagnostics = []) {
  const authorityPaths = new Set(contextAuthorityPaths(item));
  const selected = capsule.source_manifest.sources.filter(source => !authorityPaths.has(source.path));
  const authoritySources = capsule.source_manifest.sources.filter(source => authorityPaths.has(source.path));
  const terminal = capsule.work_item.terminal;
  const nextState = terminal ? null : nextStateForItem(context.workflow, item);
  const edge = nextState ? transitionFor(context.workflow, item, nextState) : null;
  const claim = item.claim;
  const currentAgentId = claim?.status === "active" ? claim.agent_id : item.assigned_agent_id;
  const handoff = (item.handoffs ?? []).at(-1) ?? null;
  const requestedOwner = capsule.position.id === item.owner_position;
  const composed = item.state === "build" && capsule.work_item.workflow_profile === "lean" &&
    item.risk_tier === "low" && item.profile_assessment?.scope_class === "bounded" &&
    item.ui_delivery_mode === "not-applicable";
  let operation = null;
  if (!terminal && requestedOwner) {
    if (item.state === "blocked") operation = "inspect-blocker";
    else if (claim?.status !== "active") operation = "work-item claim";
    else if (item.state === "build") operation = composed ? "work-item deliver" : "handoff";
    else if (item.state === "release_gate") operation = "close";
    else if (nextState) operation = "transition";
  }
  return {
    schema_version: "temple.context-entry/v1",
    authority: "navigation-only", mutation_performed: false,
    work_item: {
      id: item.id, title: item.title, path: capsule.work_item.path,
      state: item.state, workflow_profile: capsule.work_item.workflow_profile, terminal,
      scope: item.scope ?? [], acceptance_criteria: item.acceptance_criteria ?? [], unresolved: item.unresolved ?? []
    },
    responsibility: {
      owner_position: item.owner_position,
      recorded_agent: { id: currentAgentId ?? null, display_name: context.agents.get(currentAgentId)?.display_name ?? null },
      requested_position: capsule.position.id,
      selected_actor: capsule.actor_selection ?? null,
      actor_diagnostic: capsule.actor_diagnostic ?? null,
      claim: claim ? { id: claim.id, status: claim.status, agent_id: claim.agent_id, principal_id: claim.principal_id, base_revision: claim.base_revision } : null
    },
    candidate: {
      developer_revision: item.developer_candidate_revision ?? null,
      handoff: handoff ? { artifact: handoff.artifact, revision: handoff.input_revision, from_position: handoff.from_position, to_position: handoff.to_position } : null,
      verification: "not-performed-by-context"
    },
    route: capsule.route,
    next_step: {
      candidate_operation: pending || diagnostics.length ? null : operation,
      workflow_edge: edge ? { from: item.state, to: nextState, requirements: edge.requires ?? [] } : null,
      gate_refs: Object.fromEntries((edge?.requires ?? []).map(key => [key, item.gate_evidence?.[key] ?? []])),
      note: pending ? "A delivery is pending; inspect and recover it before other mutations." : diagnostics.length ? "Completion diagnostics remain unresolved; inspect their source and recovery instructions before continuing." : terminal ? "Terminal work has no continuation." : !requestedOwner
        ? "Requested Position is not the current owner; coordinate the handoff before mutation."
        : "Finish this responsibility first; all policy, evidence, claim and runtime guards still require validation.",
      pending_operation: pending?.journal.operation_key ?? null,
      completion_diagnostics: diagnostics,
      authorization_granted: false
    },
    references: {
      governing_specs: capsule.specifications,
      context_routes: capsule.context_routes.map(({ id, paths }) => ({ id, paths })),
      learning: capsule.learning.map(({ id, path, status }) => ({ id, path, status })),
      capabilities: capsule.capabilities.map(({ id, path }) => ({ id, path })),
      affected_paths: capsule.affected_paths,
      overlaps: capsule.affected_path_overlaps
    },
    source_manifest: {
      // This compact projection deliberately has no full-manifest schema marker.
      selection_digest: capsule.source_manifest.selection_digest,
      source_count: capsule.source_manifest.source_count,
      measured_bytes: capsule.source_manifest.measured_bytes,
      sources: selected,
      authority_snapshot: {
        digest: `sha256:${sha256(JSON.stringify(authoritySources))}`,
        paths: authoritySources.map(source => source.path)
      },
      source_bodies_retained: false
    },
    read_policy: "Read current scope, acceptance, candidate evidence and applicable instructions. authority_snapshot.paths lists CLI freshness inputs, not a blanket reading checklist. Explicit native/project, bootstrap, recovery and required selected/unselected reading obligations still apply; resolve missing or unclear authority. Hashes do not prove reading. Reuse only already-read, available, unchanged bodies. Recheck changed authority groups.",
    warnings: capsule.warnings
  };
}
