---
name: tdd
description: Implement an approved behavior change through an observable red-green loop at a public test seam. Use when code changes are authorized and a deterministic automated test can express the behavior; do not use for status-only review, exploratory prototypes, or failures that are not yet reproducible.
---

# Test-Driven Development

Deliver one accepted behavior through evidence that can fail before the implementation and pass afterward.

## Entry conditions

- Confirm that implementation is authorized and identify the accepted behavior or defect outcome.
- Choose the narrowest stable public seam that proves the outcome: a public API, user-visible UI, protocol boundary, persisted state, or supported integration surface.
- Establish a runnable feedback loop. If the symptom is not reproducible or the reason for failure is unclear, diagnose it before treating the work as a red-green implementation.

This Skill does not create or transition work items, approve scope, publish changes, or replace Independent QA.

## Red

1. Add or focus a test that expresses the missing behavior without reading private implementation state.
2. Run the smallest relevant command before changing production code.
3. Record the expected failure and confirm it fails for the intended behavioral reason. A broken fixture, unrelated compiler error, unavailable service, or assertion that cannot observe the seam is not useful red evidence.

If the test is already green, check whether the behavior already exists or the assertion is too weak. Do not weaken acceptance criteria or manufacture a failure.

## Green

1. Make the smallest production change that satisfies the observed behavior.
2. Re-run the focused test until it passes.
3. Run the proportionate neighboring regression set. Do not mix unrelated refactors into the red-green loop.
4. Remove temporary probes, fixtures, or debug output that are not part of the lasting test surface.

## Evidence and completion

When the project uses normalized evidence, read [the evidence contract](references/evidence-contract.md) and use the bundled validator for a supplied `temple.test-observation/v1` artifact. The script validates a record; it does not run the command or claim that the observation is truthful.

Preserve:

- the public seam and accepted behavior;
- the initial failing command and failure reason;
- the passing focused command and relevant regression result;
- the exact candidate revision;
- skipped environments, unresolved risks, and any evidence that still requires Independent QA.

Finish only when the behavior has observable red-to-green evidence or when a concrete blocker explains why the loop cannot be established. A green developer run is not Independent QA approval.
