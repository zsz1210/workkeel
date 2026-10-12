# ADR-0027: Separate canonical state, runtime telemetry, and live views

- Status: Accepted
- Date: 2026-08-30
- Scope: Phase 3 control-plane state

## Context

Phase 2 stores project decisions, Work Items, evidence, approvals, runtime-worker records, and an append-only audit stream in the repository. Phase 3 needs higher-volume task, turn, plan, diff, token, provider-health, and alert updates. Committing those updates would create noisy diffs, increase merge contention, retain sensitive content, and confuse an observation with organizational truth.

Linked Git worktrees also need one local live view even though each worktree has a different checkout directory.

## Decision

Use three explicit state layers:

1. **Canonical project state** remains under `.ai-org/` and is mutated only through existing policy-checked commands. Work Items, normalized evidence, governance approvals, and canonical audit events remain authoritative.
2. **Runtime telemetry** is generated and local. The default location is `<git-common-dir>/temple/control-plane/`, with an explicit configuration override for unsupported environments. It contains a normalized append-only journal, checkpoints, provider leases, health, and projections. It is rebuildable and must not satisfy a lifecycle gate.
3. **Live views** are generated from canonical state plus runtime telemetry. Browser views, SSE frames, caches, alert projections, and summaries are disposable.

New canonical audit events use a versioned envelope with a stable ID, source, type, occurrence time, observation time, subject, actor, correlation fields, exact revision when applicable, and redacted data. Existing unversioned event lines remain readable and are never rewritten in place.

Raw prompts, hidden reasoning, command output, tool arguments, tool results, secrets, and complete diffs are excluded from the runtime journal by default. The journal records bounded summaries, hashes, file lists, counts, and provider references.

## Consequences

- Git history remains reviewable while the dashboard can update frequently.
- All linked worktrees in one clone can share the same local control plane.
- Losing the telemetry directory loses local history but not canonical project truth.
- A fresh control plane can rebuild canonical projections, while provider-only transient details may remain unavailable.
- Event readers require a backward-compatible legacy adapter and an explicit future migration path.
- Cross-clone convergence is not solved by the local journal.

## Not claimed

This decision does not provide a remote control plane, distributed consensus, backup, cross-machine event merging, or production-grade retention. Those belong to later reliability work.
