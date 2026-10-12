# ADR-0051: Scope local verification and deduplicate evidence reads

## Status

Status: Accepted for compatibility design.

## Context

Ordinary hosted CI already runs a bounded fast suite, not the complete suite. The audit found repeated Git process startup in Doctor, repeated full local runs for prose-only changes, redundant package/Skill success checks, and a classifier test rebuilding a complete experiment lab.

## Decision

Preserve ADR-0043's single bounded Node.js 24 PR/push job. Its implemented timeout is eight minutes. Doctor performs organization Schema validation, so remove the separate duplicate invocation. Full verification stays required for behavioral candidates; ADR-0050's Release workflow also reruns it. No hosted change-scope selector or browser installation is introduced.

Expose local core, optional, and experiment groups, plus a conservative changed-path editing helper. Classify every discovered test, default new tests to core, include committed/staged/unstaged/untracked changes against an explicit Git base, and fall back to complete Node discovery for missing/unknown/shared change scope. Selection is not a release gate or a dependency-coverage proof.

Prose-only work uses fast repository/package/link checks and applicable rendered review. Behavioral candidates, instructions, Skills, executable examples, schemas, dependencies, and contract changes require complete verification. Canonical organization-state updates require Doctor. UI candidates retain browser verification. Record exact tested revisions; do not rerun the complete suite for every intermediate edit or evidence-only update to unchanged tested code.

Deduplicate evidence Git reads within one validator call only. Batch immutable object reads in bounded chunks, retain digests instead of bodies, and preserve per-object fallback on batch failures or unusual paths. Never persist the cache, weaken ancestry/tag preservation, or accept malformed partial batch output as verification.

Keep one real package dry-run in repository checks and test invalid manifests separately. Keep full experiment preparation tests while replacing classifier-only lab setup with minimal real files and symlinks. Test browser-harness cleanup with injected failures rather than source-text matching.

## Consequences

- Full safety coverage and historical evidence verification remain mandatory at their appropriate gates.
- Fast tests may gain useful behavioral assertions even while total verification cost falls.
- Unclassified local changes intentionally select more tests. This helper does not claim precise transitive impact analysis.
- Timings are environment-specific observations; subprocess counts and equivalent findings accompany speed measurements.
- No framework lifecycle, authority, publication permission, model policy, or sealed experiment record changes.
