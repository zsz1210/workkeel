# ADR-0020: Separate external planning, Work Items, and Agent sessions

- Status: Accepted
- Date: 2026-08-30

## Context

Companies already coordinate work in Jira, GitHub Projects, Asana, or another tracker. AI Agents need smaller implementation and verification slices than humans normally want to see on that board. Codex tasks add a third identity and lifecycle. Mirroring every AI subtask into the company tracker creates noise; keeping every item local hides dependencies from coworkers. Automatic bidirectional synchronization also creates ambiguous ownership and can falsely treat an external completion as delivery evidence.

## Decision

Temple models three explicit layers:

1. the external tracker remains the human planning and commitment surface;
2. repository Work Items remain the execution, lifecycle, evidence, and handoff surface; and
3. Codex task records remain execution-session identities.

Projects select `repository-only`, `linked-tracker`, or `externally-planned`, plus `parent-only`, `team-visible`, or `full` mapping granularity. Root Work Items default to `team-visible`; child Work Items default to `internal`. Internal children may inherit an ancestor mapping for context but do not become separately synchronized.

The configuration and Work Item mappings are project-owned. Observations and plans are generated. Reconciliation decisions and their evidence are project-owned. Provider credentials are never stored in project state.

Field ownership is explicit. Temple protects lifecycle, contracts, evidence, claims, tested revision, and release decision. The external system owns company planning fields. Title and relationships require negotiation. External completion cannot advance the lifecycle.

Alpha.15 implements read, mapping, plan, and repository reconciliation only. It has no external mutation path. Any future write-back must require exact user authorization in addition to provider policy and must preserve an auditable before/after observation.

## Consequences

- Human boards remain readable because internal AI decomposition can stay internal.
- Several specialists and their Agents can work under one company-visible outcome.
- Agents do not need independent tracker accounts merely to have distinct repository identities.
- The repository can recover mapping and reconciliation state without chat history.
- Teams must choose mapping granularity and occasionally resolve drift explicitly.
- Jira and other providers initially require normalized observation files until reviewed live adapters exist.
- A future synchronization service cannot assume that matching field names have matching authority.

## Rejected alternatives

- Treat the external tracker as the only canonical execution state: this cannot represent Temple evidence gates or AI-only decomposition safely.
- Mirror every Work Item automatically: this creates excessive board noise and exposes internal execution details.
- Keep trackers entirely unrelated: this hides human dependencies and duplicates feature-level work.
- Implement bidirectional synchronization first: field ownership, authorization, conflict handling, and failure recovery are not safe defaults.
