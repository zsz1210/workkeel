# ADR-0008: Skill tiers and open-source distribution

- Status: Accepted
- Date: 2026-08-29

## Context

External Skill catalogs contain many valuable development capabilities, but copying an entire catalog into every project creates overlapping triggers, recurring context cost, dependencies, and license maintenance. Temple is also intended for public distribution, so users must be able to distinguish original implementations, external inspiration, vendored code, and optional integrations.

## Decision

Temple divides capabilities into three tiers: core Skills needed by every project, optional packs installed only after empirical validation, and maintainer guidance that exists only in the central repository.

This version includes the independently implemented `domain-modeling` Skill in core. It preserves TDD, diagnosis, prototyping, code review, and architecture improvement in the capability catalog, while Skill-authoring principles remain in central maintainer documentation. External sources must record their URL, pin, license, and adoption state. Do not vendor an external Skill without an explicit decision.

The repository uses the MIT License. If third-party code is copied or modified in the future, its license requirements and notices must be preserved; this repository's LICENSE cannot replace them.

## Consequences

- Important candidate capabilities are not lost merely because installation is deferred.
- New projects retain a small default context with fewer competing Skill triggers.
- Third-party inspiration, original implementations, and future vendoring have auditable boundaries.
- Optional packs require a real pilot, license review, tests, and an ADR. Adoption is slower than direct copying, but avoids long-term upgrade and provenance problems.
