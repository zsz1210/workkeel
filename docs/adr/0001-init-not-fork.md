# ADR-0001: Install the central toolkit with init, not primarily by fork

- Status: Accepted
- Date: 2026-08-29

## Context

If every product forks the template, product history and template history become intertwined. Upstream upgrades, project customization, and permission management all become harder.

## Decision

The central private repository publishes versions. Product repositories install them with `temple init`, and `temple.lock` records the source and managed checksums. GitHub's "Use this template" remains only a secondary entry point for a new repository.

## Consequences

The toolkit must provide explicit upgrade and migration tools. In return, each product can retain a clean Git history of its own.
