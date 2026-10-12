# ADR-0009: One Decision Interview and explicit Skill authority

- Status: Accepted
- Date: 2026-08-29

## Context

`decision-interview` and `evidence-backed-decision-interview` share the same interview core and differ only in whether repository evidence is read first. Adjacent triggers force Agents and users to guess which one to choose and increase recurring context in every project. In addition, earlier Skill and Position instructions often said to "persist" directly, which could misinterpret a read-only review or status question as authorization to write files.

## Decision

Temple installs only `$decision-interview`. It selects conversational or evidence-backed mode according to whether existing repository facts constrain the decision. Both modes share the same facts, assumptions, options, decisions, unknowns, and completion frontier.

Every repository Skill must distinguish analysis from mutation. Inspect, explain, diagnose, review, and status requests are read-only by default. Persist changes only when the user requests them or when the currently authorized work item includes repository updates. `$temple-work` handles only explicitly authorized lifecycle canonical-state mutations; it does not grant general implementation authority.

One registry in `src/constants.mjs` supplies the required Skill list to both doctor and repository checks. During an upgrade from an older version, only an `evidence-backed-decision-interview` managed file whose checksum matches the old lock is removed. A project-modified version still stops as a conflict.

## Consequences

- Agents no longer need to choose between two highly overlapping interview Skills.
- Evidence-backed work still preserves source paths, revisions, ADRs, and glossary behavior.
- Skill wording no longer expands a read-only request into write authorization.
- Skill count and recurring context decrease, but scenario matrices and real pilots must still verify actual model routing. Structural tests cannot replace forward tests or Independent QA.
