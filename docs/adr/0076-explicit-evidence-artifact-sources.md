# ADR 0076: Explicit historical evidence artifact sources

Status: Accepted

## Context

Some legacy reports were written after a tested candidate, while registry
`scope_revision` names that candidate. Later squash commits contain the recorded
bytes but may not descend from that candidate. Recovering the candidate Git object
alone does not recover those reports. Rewriting scope or hashes would lose history.

## Decision

Append an explicit `temple.evidence-sources/v1` content-addressed map. Each mapping
pins the full original registry entry digest, tested scope, artifact path/hash and
an exact artifact source commit. Recording requires both commit objects, a missing
path at the tested scope, and exact recorded bytes in a regular file at the source.
Existing tested-scope objects cannot be overridden, even with matching content.
The registry, invalidation state and gates are untouched. A changed registry entry
requires a new reviewed map; previous maps remain immutable.

Export with an explicit map creates `temple.evidence-bundle/v2`, embedding that map
and source revisions. Unmapped exports and v1 verification retain their semantics.
Available Git objects are checked; portable readback without them establishes only
archive consistency. Report tested and artifact commit availability separately.
Ancestry is an observation and may be false after squash delivery. Neither map nor
archive is a signature, authenticated provenance, approval or new acceptance.

## Consequences

This repairs exact-byte retrieval without rewriting historical authority. Consumers
must explicitly select the map and all mapped records. The tool does not search
history, guess a source, delete evidence, or make retention decisions. Missing or
invalid original data remains debt until reviewed exact source bytes are available.
Normal limits, safe paths, exclusive creation and project mutation locking apply.
See the [recovery procedure](../operations/evidence-source-recovery.md).
