# ADR-0028: Negotiate provider capabilities and reconcile replay

- Status: Accepted
- Date: 2026-08-30
- Scope: Phase 3 provider ingestion and recovery

## Context

Codex App Server documents rich live events for a connection that starts or resumes threads, but it does not document a universal subscription to all existing Codex Desktop tasks or a durable notification cursor owned by an external consumer. Repository observation and GitHub observation have different latency, history, and approval capabilities.

A single boolean such as `connected` would therefore overstate what Temple actually knows.

## Decision

Every provider publishes a capability contract for enumeration, history snapshots, live events, plan summaries, diff summaries, token usage, runtime approvals, thread launch, and thread resume. Each capability is `supported`, `unsupported`, or `unknown`, with provider version, last successful observation, and degradation reason.

Ship the repository provider as the always-available baseline. Add a Codex App Server provider for sessions that Temple explicitly manages or can safely resume. Treat other Codex Desktop tasks as snapshot-only or registered-only unless a documented and tested interface proves a stronger capability. Add GitHub only as a read-only observation provider.

The control plane normalizes provider records, assigns a monotonic local cursor, and deduplicates by provider source identity plus lifecycle state. Browser clients resume the local journal with their last cursor.

After a provider reconnect, Temple reconciles a fresh provider snapshot with its journal. Terminal provider records override transient deltas. Missing or conflicting state becomes `unknown` or blocked attention, never an inferred success. An interrupted runtime approval that cannot be safely reattached becomes unanswerable and blocked; it is never auto-approved or silently recreated.

## Consequences

- The dashboard can honestly show full, degraded, snapshot-only, or unavailable telemetry.
- Replay safety means idempotent local projection and canonical mutations, not a claim of upstream exactly-once delivery.
- App Server schema and behavior must be pinned and tested for every supported Codex version.
- New providers can be added without changing project authority.
- Users may see less detail for tasks not managed by Temple, but the visible detail is trustworthy.

## Not claimed

This decision does not promise live access to every task in Codex Desktop, recovery of every transient text delta, or execution control over a provider that exposes observation only.
