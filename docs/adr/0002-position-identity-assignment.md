# ADR-0002: Separate Position, Agent Identity, and Assignment

- Status: Accepted
- Date: 2026-08-29

## Context

Hard-coding names in Position configuration makes future expansion, reassignment, responsibility consolidation, and historical tracking difficult.

## Decision

The toolkit defines only Positions. During first initialization, each project creates its own Agent Identities with English `display_name` values, then connects the two through Assignments. An Identity's `agent_id` is stable; its display name may change.

## Consequences

One Agent can hold multiple Positions. Adding more AI workers later requires only changing Assignments. Audit records refer to stable IDs, never chat titles.
