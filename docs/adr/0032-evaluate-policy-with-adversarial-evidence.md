# ADR-0032: Evaluate policy with adversarial evidence

- Status: Accepted
- Date: 2026-08-30

## Context

Temple's tests cover individual lifecycle, evidence, approval, provider, and privacy rules. A collection of passing happy paths does not show whether the organization resists realistic failure: false completion, wrong revision, self-approval, stale scope, unauthorized external action, lost context, or alert noise.

## Decision

Phase 4 will maintain a versioned adversarial scenario catalog and outcome scorecard.

- A scenario declares the attempted violation, initial state, expected refusal or escalation, allowed side effects, required evidence, and cleanup boundary.
- Results distinguish prevented, detected, recovered, unknown, and escaped outcomes.
- Scorecards include gate integrity, revision correctness, separation of duties, recovery, rework, human intervention, and notification quality—not only test counts.
- Usage and model-routing experiments must preserve acceptance, evidence completeness, and policy results while comparing Tokens, latency, and cost.
- Scenario fixtures provide repeatability; authorized live exercises remain separately labeled evidence.

## Consequences

- Temple can measure whether efficiency changes weaken organizational safeguards.
- A lower Token count or faster result is not an improvement when acceptance or policy performance regresses.
- Maintaining adversarial fixtures adds work, but exposes failures that ordinary feature tests do not.
- Regulated acceptance and production incident exercises still require their real organizational environment.
