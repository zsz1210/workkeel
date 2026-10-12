# ADR-0026: Make High-Assurance a risk contract, not a larger team

- Status: Accepted
- Date: 2026-08-30
- Scope: Phase 2C High-Assurance profile

## Context

High-Assurance cannot mean merely assigning more Agent Identities or producing more documents. It must change which facts are required, who may approve them, how exact revisions are bound, and how rollback is demonstrated, while retaining the same ten Position responsibilities.

## Decision

Make `high-assurance` selectable only after the collaboration state has at least two active Human Principals, every active Agent Identity has one sponsor, and Developer, Independent QA, and Release Manager separation rules hold.

Every new High-Assurance Work Item records a `low`, `standard`, `high`, or `critical` risk tier and derived assurance contract. Risk controls scale artifact depth, acceptable UI delivery modes, normalized evidence requirements, rollback depth, and number of independent human approvals.

High-Assurance transitions require normalized evidence IDs, exact Git commits, passing test/runtime observations, and a resolved risk record at the specified boundaries. Closeout requires a repository approval record bound to the same exact tested revision. Critical work additionally requires a verified rollback and two distinct approvers. These controls govern organizational closeout only and never authorize a production action.

## Consequences

- Small but sensitive work can select strong controls without inventing new Positions.
- A large low-risk repository does not become High-Assurance merely because it has many Agents.
- The profile is deliberately harder to enable and may require collaboration setup first.

## Not claimed

This local contract is not a regulatory certification, security audit, production release authorization, or evidence that multi-machine races have been validated.
