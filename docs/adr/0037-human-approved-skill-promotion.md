# ADR-0037: Automatically propose Skills, require human activation

## Status

Status: Accepted for compatibility design.

## Context

The Engineering Learning Loop deliberately prevents one Lesson from becoming a permanent rule. It can capture, validate, retrieve, and revalidate learning, but the promotion frontier remains manual. Requiring the human to discover and manage every candidate defeats part of the organization framework's purpose. Allowing an Agent to write an active Skill silently would change recurring behavior without an explicit authority decision.

## Decision

Temple will automatically derive Skill-review candidates from repeated validated Practices and surface them through Status, Observer, and the existing Now attention projection. A claimed Tech Lead may create an evidence-backed project Skill Proposal. A human may approve, reject, or defer the proposal.

Approval creates exactly one bounded Skill-authoring Work Item. It does not create a Skill, install a dependency, run the target procedure, publish an extension, or promote anything into Temple core or an official pack. Actual Skill creation remains a separate authorized lifecycle using `$skill-authoring`.

Risk determines validation and approval depth, not whether authority is required. Silent low-risk activation remains deferred until representative proposal, routing, authority-boundary, and rollback evidence supports an opt-in standing policy.

Generated candidate and Observer projections are navigation aids. Canonical authority remains the Learning Index, proposal record, human decision, Work Item, Skill files, and lifecycle evidence.

## Consequences

- Humans approve persistent recurring behavior without manually mining the Learning Index.
- Candidate detection remains reproducible and local; it does not need a model or semantic runtime.
- A deterministic recurrence threshold can surface review but cannot prove that Skill is the correct artifact, so Tech Lead classification remains explicit.
- Rejection and deferral are auditable and prevent repeated noisy prompting.
- The system gains a recoverable, idempotent boundary between approval and authoring Work Item creation.
- A future standing authorization for low-risk project Skills requires a separate ADR and validation program.
