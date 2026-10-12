# ADR-0029: Separate Human Inbox request authority

- Status: Accepted
- Date: 2026-08-30
- Scope: Phase 3 Human Inbox

## Context

A real-time control plane can surface provider permission requests, questions that need business facts, and formal governance approvals. They may look similar in one inbox but have different authority, persistence, and risk. Treating every `Approve` action alike could accidentally convert a local runtime permission into a release decision or allow a conversational answer to overwrite a product contract.

## Decision

The Human Inbox uses three non-interchangeable request classes:

1. **Runtime permission** answers a live provider request such as command, file, or network permission. It is local, provider-scoped, redacted, and valid only while the original request remains answerable.
2. **Business fact or scope question** records a proposed answer and its source. If the answer changes a project contract, a separate policy-checked command must update the Decision Ledger, specification, or Work Item before Agents may rely on it.
3. **Governance approval** records a product, release, or High-Assurance decision in canonical project state, bound to the Work Item, exact revision, policy, principal, and idempotency key.

The browser never edits repository files directly. It sends an authenticated localhost command to a gateway that reuses CLI validation, mutation locking, current-state checks, Position and Human Principal rules, and append-only audit events. Repeating the same idempotency key returns the prior result rather than creating a duplicate approval.

Phase 3 binds to loopback by default, uses a per-session secret and same-origin request protection, never exposes stored credentials to the browser, and performs no remote access or notification.

## Consequences

- One inbox can remain convenient without collapsing authority boundaries.
- Business answers stay visible even when canonical incorporation is still pending.
- Governance approval remains revision-bound and auditable.
- Runtime requests may become blocked after disconnect instead of presenting an unsafe stale button.
- Remote access and organization-wide identity require a later security design.

## Not claimed

The Human Inbox does not authorize deployment, external tracker writes, arbitrary shell execution, or remote administration. Existing external-action boundaries remain unchanged.
