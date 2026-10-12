# ADR-0033: Federate project authority with read-only portfolios

- Status: Accepted
- Date: 2026-08-30

## Context

Large organizations often split systems across service repositories. Copying every service's Work Items, credentials, approvals, and evidence into one central Temple store would create conflicting truth and an excessive security boundary. Leaving repositories completely disconnected prevents cross-service contract and rollout coordination.

## Decision

Temple will federate repositories without centralizing mutable lifecycle authority.

- Every repository retains its own `.ai-org/` canonical state and immutable project ID.
- Cross-project identity uses composite references such as `project_id + work_item_id`; a bare Work Item ID is never globally unique.
- One repository owns each API or event contract. Consumers reference a version or exact revision instead of copying authority.
- A coordination repository may own genuinely cross-service Initiatives, domain maps, contract indexes, and rollout plans.
- The portfolio aggregates bounded read-only projections and links back to each authoritative repository. It cannot transition, approve, close, or release a local Work Item.
- Cross-repository delivery uses compatibility and rollout waves rather than an assumed atomic commit.
- Credentials, Human Principals, provider permissions, and release decisions remain repository-scoped and least-privileged.

## Consequences

- Teams can coordinate microservices while preserving local ownership and audit boundaries.
- Unavailable or stale repositories remain visibly `unknown`; the portfolio cannot infer success.
- Federation needs versioned references, source provenance, refresh state, and conflict diagnostics.
- Centralized mutable orchestration, organization-wide RBAC, and external write-back remain later, explicitly authorized scope.
