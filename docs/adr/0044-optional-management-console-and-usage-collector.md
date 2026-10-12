# ADR-0044: Keep the Management Console optional and separate usage collection

## Status

Status: Accepted for the compatibility console.

This decision narrows the ordinary runtime path introduced by ADR-0027, ADR-0034, ADR-0035, and ADR-0036. Their canonical-state, telemetry, usage-attribution, and private-viewer authority boundaries remain in force.

## Context

Temple can organize, build, test, evaluate, and close Work Items from repository state and the CLI. A browser interface is useful for people who want a human-readable overview, but it is not needed by every individual developer, automated environment, or project team.

The existing Control Plane combines three responsibilities in one process: serving the Management Console, polling repository and external providers, and collecting Codex usage events. Even with Codex observation disabled, the server owns the telemetry writer lease and starts the repository provider. Managed-local observation also starts the browser server and may expose a separately configured private viewer. This makes a viewing choice look like an observation choice and gives an optional interface the cost profile of a background collector.

Exact per-Work-Item Token attribution still requires instrumentation while supported provider events exist. It does not require the browser interface, and the core lifecycle must not depend on either capability. Unobserved historical usage cannot be reconstructed exactly and must remain unknown.

## Decision

Separate the runtime into three explicit layers:

1. **Temple Core** remains the default. It reads and mutates canonical repository state through existing commands and starts no Console, Collector, provider, listener, or service.
2. **Management Console** starts only through `temple console start`. It is read-only, opens the retained telemetry journal without a writer lease, attaches no Codex Provider, starts no repository polling loop, exposes no Inbox or Agent Command mutation route, and may run concurrently with the Collector. Bounded file-change invalidation refreshes a cached snapshot only when a browser asks for current data.
3. **Usage Collector** starts only through `temple usage collect` or the explicitly installed managed-local service. It owns the telemetry writer lease, connects the configured Codex Provider, writes observations, opens no HTTP listener, and leaves retained telemetry in place when stopped.

Keep the current combined `temple control-plane start` command for compatibility during this Alpha. Mark it as a legacy combined operator path in documentation and direct ordinary usage to the split commands. Removal requires a separate compatibility decision.

Managed-local collection remains an advanced experimental option and stays off by default. Its macOS LaunchAgent starts only `temple usage collect --observation-mode managed-local`; it does not start, install, or expose the Management Console. Console LAN or Tailscale access always requires a separate explicit Console invocation.

The first split Collector remains operator-bounded: it runs until interrupted and then closes the Provider and journal cleanly. Automatic per-task launch and stop may be added only after a provider-owned lifecycle can prove that a final usage update has been retained before shutdown. Do not claim that behavior from a turn-completed event alone.

## Consequences

- Developers who do not need the Console or Token analysis pay no background runtime cost.
- The Console can remain open while an on-demand Collector records telemetry, because only the Collector owns the writer lease.
- Viewing canonical state does not silently attach Codex, expose a network listener, or grow the telemetry journal.
- Stopping collection preserves prior observations but future per-Work-Item usage remains unknown until collection resumes.
- The optional Console still incurs snapshot work after relevant file changes;
  optimization requires separate measurement.
- The legacy combined command temporarily duplicates some orchestration code and must remain covered for compatibility.
- Automatic per-task capture is not delivered by this decision and remains a separately testable follow-up.

## Rejected alternatives

- Keep the combined server as the recommended path and tune only its polling interval.
- Make the Management Console a required Temple component.
- Keep a managed-local Observer running for every initialized project.
- Let the Console acquire the telemetry writer lease or connect Codex for convenience.
- Delete existing telemetry when observation is disabled.
- Backfill missing Work Item usage from account-level totals.
