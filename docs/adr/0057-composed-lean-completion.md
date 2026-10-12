# ADR-0057: Composed Lean completion with separate diagnostics

Status: Accepted for bounded compatibility implementation.

## Context

Existing Lean Developer delivery composes handoff, release and Test entry.
Reducing repeated completion administration must preserve authority, evidence
and recovery checks.

## Decision

Provide an optional `work-item finish` command with explicit Position, Identity, Principal, active claim, committed candidate and stable operation ID. Developer completion uses the existing delivery validators. Quality Evaluator completion requires a distinct Identity from the latest Developer handoff, a matching candidate, explicit passing judgment and test/Lean-closeout evidence. It composes existing claim-release and transition preparations under the project mutation lock. Other profiles, higher risk, unclear scope, UI delivery and active runtime workers remain on the existing route.

Retain journaled, exact-request recovery at every lifecycle persistence boundary. A duplicate request reports historical application. Changing request facts, candidate, evidence, eligibility or authority cannot turn a replay into a new operation or bypass unsettled recovery.

After lifecycle application, rebuild full Status and run full Doctor, returning compact diagnostics. Mutation and diagnostics are separate facts: a failed diagnostic returns a non-success outcome with mutation already applied. Keep scoped pending/failed diagnostic attention in checkout-local recovery state, observable in Status/Doctor even for terminal work. Retry only validates and repairs diagnostics; never repeat lifecycle writes. Bind diagnostic repair to current resulting state, complete relevant authority and evidence, and exact candidate. A stale result is neither fresh verification nor permission to mutate.

No product test shell is executed, no judgment is generated, and no diagnostic success substitutes for acceptance evidence. Lean verification remains distinct from formal Independent QA. Preserve existing `deliver` defaults and managed entry instructions. Entry/Skill integration is deferred to dependent slice C after B acceptance.

## Validation and consequences

Require actual CLI and semantic equivalence checks, all write/diagnostic interruption boundaries, actor/candidate/evidence/authority drift, truthful terminal attention and no duplicate replay. Existing Standard gates qualify the implementation through complete tests and distinct QA. Operation-count reductions are structural measurements, not measured Token or model-latency improvement.
