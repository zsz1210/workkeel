# ADR-0024: Version extension contracts and state migrations explicitly

- Status: Accepted
- Date: 2026-08-30
- Scope: Phase 2C extension safety

## Context

A pack that lists only Skill entrypoints cannot safely carry their references, scripts, assets, dependencies, provenance, or compatibility boundaries. Likewise, checksum-aware framework upgrades are not enough when project-owned document schemas evolve: operators need to know which migrations exist, which are automatic framework migrations, and which project data changes require an explicit command.

## Decision

Adopt `temple.pack/v2`. A pack declares every managed file by category, its Skill IDs, dependencies, upstream provenance, license, and Temple/Node compatibility. Installation remains opt-in, conflict-first, checksum-managed, and journaled. A dependency declaration is metadata and validation; it is not permission to install software.

Add a managed `temple.migrations/v1` registry and expose its plan through the CLI. `temple upgrade` records only migrations it actually applies. Pure framework-file and empty-seed migrations may be automatic; project-owned content migrations are explicit and must preserve or restore the original on failure.

Use Draft 2020-12 JSON Schema validation at runtime for cataloged canonical and generated JSON documents. Domain-specific validators remain in place for cross-file invariants and authority rules that JSON Schema cannot express.

## Consequences

- Packs can evolve without hiding executable or supporting files.
- Installed locks retain provenance and compatibility evidence.
- Schema failures are reported at the document path and JSON instance path.
- A framework version bump no longer implies that every project-owned document was silently rewritten.

## Not claimed

The manifest does not make third-party code trustworthy, resolve package dependencies, or authorize execution. The migration registry is local coordination, not distributed database migration infrastructure.
