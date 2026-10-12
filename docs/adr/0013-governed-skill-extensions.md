# ADR-0013: Governed project and third-party Skill extensions

- Status: Accepted
- Date: 2026-08-29
- Supersedes: The three-tier distribution model and maintainer-only Skill-authoring disposition in ADR-0008; its licensing and provenance decisions remain in force.

## Context

The original capability model covered core Skills, official optional packs, and central maintainer guidance. The product direction now requires a user to extend an initialized repository with project-specific or third-party Skills without redesigning the development organization or risking those files during an organization-system upgrade.

The implementation already protects files by exact checksums in `temple.lock.managed_files`, but older documentation described the whole `.agents/skills/**` namespace as managed. That mismatch made project extensions ambiguous. Existing init, upgrade, and pack behavior could also adopt an untracked byte-identical file into managed ownership without explicit consent.

## Decision

### Ownership is exact-path based

- A file is organization-managed only when its exact path appears in `temple.lock.managed_files`.
- Directories such as `.agents/skills/` are allowed roots for managed files, not blanket ownership claims.
- A Skill file under `.agents/skills/**` that is not listed in `managed_files` is project-owned by default.
- Re-init, upgrade, official-pack installation, and removal must never overwrite or delete a project-owned Skill.
- An untracked path collision stops before writing even when the existing file is byte-identical. Ownership transfer requires a future explicit adoption operation; silent adoption is forbidden.

### Distribution and provenance are separate

Temple-compatible capabilities use four distribution classes:

1. **Core**: installed by default and organization-managed.
2. **Official pack**: opt-in and organization-managed after installation.
3. **Project extension**: created for one repository and project-owned.
4. **Third-party extension**: selected by the project and project-owned until a dedicated external-extension lifecycle exists.

Provenance is recorded independently as original, independently implemented from inspiration, adapted, vendored, or externally referenced. External material requires an immutable source reference, license review, dependency disclosure, and any required notices.

### Governed authoring is available before automated packaging

- A core `$skill-authoring` Skill and public authoring guide define routing, authority, progressive disclosure, completion, provenance, scenarios, and validation.
- Creating or revising a project Skill does not authorize installing dependencies, publishing, editing `temple.lock`, or promoting it into core or an official pack.
- Project Skills may be created at collision-free `.agents/skills/<skill-name>/` paths after checking exact managed ownership.
- Official promotion still requires repeated cross-project evidence, an ADR, license review, scenario tests, install/remove/upgrade coverage, and an explicit release.

### Current limits remain explicit

This decision does not claim support for `temple skill` mutation commands, project or third-party registries, custom-pack publishing, generic dependency resolution, or automated routing evaluation. ADR-0024 and Alpha.19 subsequently add multi-file official Pack v2 manifests with declared dependencies, provenance, and compatibility; project-owned Skill creation and promotion boundaries remain unchanged.

## Consequences

- Users can extend the repository without giving the framework ownership of their files.
- Core and official pack upgrades remain checksum-safe and stop on name collisions instead of silently changing ownership.
- Skill quality becomes part of the public framework contract rather than maintainer-only guidance.
- At the time of this decision, project and third-party Skills remained only partially observable. ADR-0017 later added generated discovery and validation without changing this decision's exact-path ownership boundary.
- The framework can include broad engineering methods without forcing every project to install every capability.
