# ADR-0006: Use the CLI for lifecycle mutation and a registry for Codex tasks

- Status: Accepted
- Date: 2026-08-29

## Context

Early pilot work showed that repository canonical state can carry work from
Developer to Independent QA. Manual editing of work items and events remained
error-prone, while chat titles alone could cause duplicate work or incorrect
handoffs.

## Decision

Temple provides `work-item create`, `handoff`, `transition`, and `close` as the lifecycle mutation boundary. A transition must provide an evidence reference for every named workflow requirement. The CLI rejects invalid edges and missing gate evidence.

Codex tasks and threads are registered in `.ai-org/project/tasks.json` with a stable task ID, work item, Position, Agent, thread or client-thread ID, revision, and status. The actual identifiers are the Work Item ID and thread ID. Temple calculates archive readiness but does not directly create, rename, or archive Codex app tasks. [ADR-0041](0041-outcome-first-codex-task-titles.md) later supersedes this ADR's original title-format sentence with an outcome-first human navigation convention.

## Consequences

- A new conversation can recover work from the work item, registry, and exact revision without depending on a title or chat memory.
- Manual JSON drift and skipped gates become less likely, but the user or Agent must explicitly provide evidence mappings.
- Actual Codex app task mutations still use product tools and follow user authorization; the CLI only maintains the canonical registry.
- The Observer can identify blocked, attention, and archive-ready states, but cannot make decisions for the Manager, QA, or Release Manager.
