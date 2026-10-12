---
name: workkeel-work
description: Coordinate an approved native Workkeel task through claim, exact-candidate handoff, independent review and acceptance. Use for authorized native task lifecycle work; not status-only questions, implementation by a dispatched executor, legacy tasks or initialization.
---
# Native Workkeel delivery

Read the project's WORKKEEL.md and the approved native task contract. This Skill
does not grant authority or launch models. Dependencies: Node.js 24+, Git, and the
project's pinned workkeelw.mjs launcher. If an entrypoint or approval is missing,
report it; do not install packages or substitute the retired workflow.

For read-only status requests, read status or task summary and stop. A dispatched
executor reports its changes to the coordinator and never repeats lifecycle writes.

For authorized direct coordination:
1. Read the current task version and authority. Claim with the current Git base.
2. Implement only the approved scope. Preserve immutable task contracts and evidence.
3. Commit the candidate, run the applicable checks on that exact revision, and record
   checks actually completed, applied Skills and unresolved limitations.
4. Handoff once with the returned claim ID, candidate and evidence.
5. A different registered Agent performs and records its own review. Never adopt
   that identity or infer review from tests. A failed review retains its evidence.
6. Only the authorized approver accepts a passing candidate. Merge and publication
   need their own authority. Run native Doctor after lifecycle changes.

Stages are intake -> build -> test -> release_gate -> done. Use explicit rework or
cancel operations; do not manually edit canonical records. Read the shipped native
daily-work and getting-started guides for request fields rather than guessing flags.
Stop at the authorized boundary and report exact candidate, evidence and next step.

Provenance: original instructions for Workkeel's native CLI. The historical
temple-work name is not an alias for executing the retired lifecycle.
