# ADR-0078: Observer task lifecycle measurements

Status: Accepted

## Decision

Extend the read-only task summary with structured attention reasons, approved
scope and lifecycle measurements. Derive disjoint intervals from verified native
task history at a single snapshot time. Intake is waiting for claim; build is
implementation, or rework after a rework event; test is review-stage elapsed time,
including waiting; release_gate is waiting for acceptance. A failed review's test
interval remains review-stage time until rework is authorized. Terminal tasks stop
at their terminal event. Invalid, reversed or future chronology is unknown.

All intervals are elapsed calendar time, not active effort. Adapter calls are a
separate, potentially overlapping measurement. Human effort, unobserved model use,
baseline duration, monetary savings and time saved remain unknown. Observed zero
is preserved. Samples are labeled individually; no unlike-sample aggregate ranking.

The observer uses Traditional Chinese labels and offers a user-triggered plain
text handoff. Copy contains approved task scope, exact candidate and evidence
status, next actions and observation limits. It excludes capability URLs and raw
runtime output. Clipboard rejection provides a selectable local fallback. No
automatic external write, lifecycle mutation or new data collection is introduced.

## Consequences

This is an additive observation projection, not a durable task schema migration.
Native lifecycle authority, independent review, acceptance and local security
boundaries remain unchanged. Complete timing coverage does not imply complete
cost coverage. Fresh snapshot reads do not prove a live execution process.
