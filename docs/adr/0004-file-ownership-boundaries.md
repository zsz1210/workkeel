# ADR-0004: Managed, project-owned, and generated boundaries

- Status: Accepted
- Date: 2026-08-29

## Context

The central toolkit needs to update rules and Skills without overwriting product specifications, Agent names, or work history.

## Decision

Every installed file is classified as managed, project-owned, or generated. `temple.lock` records managed checksums; an operation must stop rather than forcibly overwrite a managed file whose contents differ.

## Consequences

Upgrades become more predictable, but they also require explicit extension points and a conflict-resolution process.
