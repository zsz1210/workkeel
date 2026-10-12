# ADR-0007: Separate the toolkit name from project identity

- Status: Accepted
- Date: 2026-08-29

## Context

The central toolkit and CLI need stable names to preserve compatibility across commands, schemas, locks, Skill discovery, and upgrades. After installation into a product repository, however, the AI development organization is part of that product. If status output, instructions, or artifacts continue calling it Temple, they imply a separate organization embedded inside the project and weaken the product's own identity.

## Decision

`Temple` names only the central toolkit, CLI, and technical namespace. The `temple` CLI, `temple.lock`, `temple.*` schemas, CLI-specific `$temple-init` and `$temple-work` Skill IDs, and compatibility markers retain their names. General-purpose Skills use neutral names.

After installation, project-facing headings, instructions, generated views, artifacts, and Agent descriptions use the project name or "this project's AI development organization." The project and its Agent team must not be called Temple. `TEMPLE.md` remains as a compatibility filename for now, but its contents describe the repository's own operating contract.

## Consequences

- Product repository language and identity feel native rather than attached to an external project.
- The central CLI, existing locks, schemas, and Skill invocations remain compatible.
- Future project-facing output must respect the naming boundary. Purely technical errors, commands, and central documentation may still use Temple.
- Removing the `TEMPLE.md` filename in the future requires a migration with rollback, not an upgrade that leaves an orphaned file or forcibly deletes one.
