# ADR-0053: Same-scope review rework

Status: Accepted for implementation; unreleased.

## Context

A failed review is not necessarily a new product request. Opening another Work Item for each correction fragments ownership and evidence, but a bare backward transition could reuse approvals for a rejected candidate.

## Decision

Add `work-item rework` as a guarded operation, not an ordinary backward workflow edge. Only an active eligible review claimant at Test, Eval or Independent QA may return the current exact Developer candidate to Build. Require explicit same-scope confirmation, a reason and repository findings. Revalidate governing references, prebuild approvals and UI policy. Reject active runtime workers/resources, terminal states and Release Gate.

Keep the approved scope, acceptance, profile, risk and authority references. Record the rejected candidate, reviewer, findings, downstream gates, candidate pointers and prior handoffs in append-only `rework_history`. Clear downstream gate and current-candidate projections; release the reviewer claim without claiming work for the Developer.

After rework, require a new Developer claim and exact candidate, followed by fresh evidence through the selected profile. Rejected revisions and retired evidence references cannot satisfy another attempt. Normalized downstream evidence must match the new candidate. File evidence must use new attempt-specific paths; retaining a file path does not prove new verification. Historical references remain inspectable but are not gate authority.

The operation does not change scope or reopen closed attempts. A scope change needs a separately approved Work Item; an existing Release Gate decision uses its existing closeout path. No external action is authorized.

Compensate a caught audit persistence failure by restoring exact pre-operation Work Item bytes while retaining the mutation lock. A rollback failure is explicit and preserves the error context for recovery. This bounded compensation does not claim crash atomicity or replace the separate delivery-operation journal under development.

## Consequences

Same-scope repairs retain one durable ID. Operators must explicitly finish runtime work and claim the next responsibility. Legacy symbolic candidate records are not guessed or rewritten. This is a local CLI contract, not a distributed lock or semantic proof that a repair fits scope. Standard repository review and human authority boundaries remain necessary.
