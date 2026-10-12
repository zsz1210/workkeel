# ADR-0031: Prove durable recovery before persistence growth

- Status: Accepted
- Date: 2026-08-30

## Context

Temple has repository-owned canonical state, atomic file operations, idempotent commands, a replayable local telemetry journal, and explicit migrations. These controls cover normal retries and many local failures, but they do not prove recovery at every write boundary. Phase 4 adds retention, audit, portfolio, and usage surfaces that would make an undefined recovery model more dangerous.

## Decision

Temple will define and verify a versioned backup and restore contract before adding new canonical persistence formats.

- A backup manifest records project ID, Temple version, source revision, included paths, exclusions, and content digests.
- Canonical project state and declared project-owned artifacts are the recovery unit. Generated views are rebuilt; runtime telemetry is an optional, separately labeled export.
- Restore begins with read-only inspection and compatibility validation. It refuses an incompatible or conflicting target instead of silently overwriting project-owned data.
- Mutations that span files use a recoverable command ledger or equivalent transaction record with deterministic replay or rollback behavior.
- Migration rehearsal operates on a data-bearing copy and preserves an explicit rollback path.
- Crash injection and clean-environment restore evidence are required before durability is represented as delivered.

## Consequences

- Recovery becomes testable independently from the dashboard or provider runtime.
- Backups do not turn generated projections into authority.
- Phase 4 implementation must carry format versions, integrity checks, retention rules, and actionable failure states.
- Distributed exactly-once execution, remote backup hosting, and organization-wide disaster recovery remain separate claims.
