# ADR-0054: Bound delivery entry and compose recoverable administration

Status: Accepted for implementation; unreleased.

## Context

Repeated reads and separate administrative commands can add overhead.
Shorter instructions alone cannot qualify a composed delivery implementation
or explain latency. The design must preserve authority and recovery checks.

## Decision

Integrate the existing `work-item deliver` implementation through shared non-writing handoff, claim-release, and transition preparation. Preserve current main's immutable candidate and review-rework protections. Eligibility remains low-risk bounded Lean Developer Build, no graphical interface and no active runtime worker. A receipt records administration, not testing, acceptance, Independent QA, or release.

Persist a per-checkout journal before the four canonical outputs: handoff, Work Item, event history, receipt. Under the mutation lock, resume only the same normalized request and validate current inputs, candidate, eligibility, expiry, and before/after hashes. Write the receipt last. An exact completed replay performs no canonical write or view refresh and describes historical application, not current certification. Unknown edits or corrupt journals require investigation, not deletion or fallback to individual commands. This is not a distributed lock or a general transaction service.

Add an opt-in compact read-only projection to `context resolve`. Reuse existing selection and validation; expose responsibilities, exact recorded candidate, acceptance, current claim, required source references and the profile's next edge. Include warnings and measured source manifests for freshness. A selected-source digest is not evidence of instruction loading or freshness of unselected authority. Compact output is navigation only; it cannot authorize mutation, assert provider observation, or replace governing documents. Keep the existing full response and generated capsule schema unchanged.

Keep essential lifecycle boundaries and route selection in `temple-work`; move substantial conditional procedures into references. Use supported managed-file upgrade. Do not require all references on every invocation or impose Standard on Lean. First-session, bootstrap, recovery, and ambiguous-authority reads remain explicit.

Provide structured errors for the new command surfaces. Report input repair before mutation separately from stale preview, pending operation, guard rejection, and uncertain execution failure. Advice never executes commands, changes authority, retries model generation, or certifies that an unknown write failed atomically. Same-operation recovery always revalidates state. Existing text-mode failure compatibility is retained.

## Validation and limitations

Exercise ordinary and composed operations, every persistence boundary, idempotency, changed authority/evidence, rework attempts, malformed options, compact read-only hashes, and installed Skill references. Use local measurements only for serialized bytes and deterministic administrative behavior. They are not Token or quality savings. The next live comparison must pin an updated command policy, prove the selected operation path locally, and preserve a competent ordinary baseline.

No Observer, model router, dependency, managed core schema, release automation, or default workflow change is introduced. Full comparison history stays frozen on its owner branch; branch-local record collisions are not resolved by overwriting either history.
