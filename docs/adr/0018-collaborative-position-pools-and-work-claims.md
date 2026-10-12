# ADR-0018: Collaborative Position pools and Work Item claims

- Status: Accepted
- Date: 2026-08-29

## Context

The original project model assigned exactly one Agent Identity to every Position. That works for a lean Solo organization but cannot accurately represent a company where several people operate separate AI Agents, several engineers share a specialty, or a full-stack engineer can accept more than one technical scope. Replacing default Assignments would break installed projects and historical ownership.

Parallel execution also needs more than multiple Codex tasks. Without a Principal, eligible pool, bounded affected paths, dependency state, base revision, contract status, and integration owner, parallel work can duplicate effort or overwrite shared artifacts.

## Decision

Keep `assignments.json` as the backward-compatible default owner for each Position. Add project-owned `collaboration.json` with:

- selectable Solo and Collaborative profiles;
- Human Principals;
- Principal-to-Agent sponsorship;
- many-to-many Agent Position Memberships with Disciplines;
- repository coordination as the current backend; and
- an explicit large-scale validation status.

Add Work Item parent/dependency, required Discipline, base revision, affected-path, contract, integration-owner, parallel-mode, and claim fields. Collaborative mode allocates collision-resistant Work Item IDs. An eligible Agent may claim a Work Item under its sponsoring Principal with a branch and optional worktree. Parallel mode is accepted only after deterministic readiness checks pass.

Alpha.19 makes High-Assurance selectable only after its stronger human-accountability prerequisites pass. Each High-Assurance Work Item then records a risk tier and enforces exact-revision, normalized evidence, rollback, and independent approval gates defined by ADR-0026.

## Consequences

- Existing Solo organizations remain valid and keep their default Assignments.
- Several Agents may become eligible for one Position without weakening its authority boundary.
- Technical specialties are Disciplines rather than a proliferation of framework Positions.
- Work claims become attributable and observable across conversations.
- The local mutation lock still does not coordinate separate machines. Git conflicts, protected branches, pull requests, and CI remain necessary.
- Automated tests do not prove real multi-human operation. A retained multi-machine validation plan remains an explicit warning until completed.
