# Per-task execution measurements

## Approved scope and acceptance

The maintainer explicitly selected task model, token and elapsed-time records
before resource measurement or a new Console. Deliver additive local observations
and read-only task/run query commands. No UI, daemon, native app, global model
setting, LiteLLM Auto installation, new dependency, external publication or live
model trial. Native host work not collected by Workkeel stays unobserved.

Developer agent-rikku; distinct reviewer agent-lulu in a separate runtime;
technical design agent-tidus; product agent-yuna; integration/release agent-mog;
Principal human. Standard profile, no UI. No overlapping active Work Items.

Acceptance: show requested, runtime-confirmed and provider-observed models
separately; persist bounded usage snapshots even before completion and on failure;
repeated cumulative notifications replace snapshots, never add to them; resumed
Codex turns without a trustworthy baseline remain unknown. Final totals require
complete observations; partial subtotals and coverage remain explicit. Include
per-attempt monotonic elapsed time and separately labeled run wall-clock span.
Retries/fallbacks and multiple runs belong to one task without replay duplication.
Missing legacy timing and uncollected native sessions are null, not zero. Query
does not dispatch, mutate lifecycle, expose prompts/output/credentials, or accept
tasks. Integrity failures and incomplete inventory must be visible.

## Technical decision and risk review

Add an optional trusted-adapter observation callback with an allowlisted numeric
usage/model snapshot. Serialize durable writes in the existing private operation
journal; no new observer process. Retain result-null uncertainty and dispatch
guards. Record monotonic adapter-call duration on return or exception, not guessed
LLM compute time. Sum attempt durations as work (parallel work may exceed wall
time); never infer waiting time by subtracting them. Read-only projections derive
counts, per-attempt metrics and known subtotals from integrity-checked records.
Observation is not lifecycle authority, model attestation, a bill or subscription
quota. Codex cost stays null. Old journals remain readable without backfilling
unknown evidence. Add no new runtime schema dependency or integration.

## Verification and stopping boundary

Use deterministic offline fixtures for duplicate notifications, multiple requests
in a turn, retries, failures, interrupted calls, missing data, replay, parallel
work and corrupt journals. Execute full offline verification on the final code
candidate; distinct reviewer checks evidence and implementation. No live model
call is permitted by this Work Item. Stop at locally accepted measurement layer
and propose a bounded data-test plan; a later live comparison needs new budget
and authorization. No CPU/RAM benchmark in this slice.

Rollback: revert only this candidate's product changes; preserve all execution
journals and failed evidence. New observations are optional for old readers.
