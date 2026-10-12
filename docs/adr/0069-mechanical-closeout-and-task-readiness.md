# ADR-0069: Mechanical closeout evidence and explicit task readiness

Status: Accepted for compatibility implementation; no release implied.

## Context

Collaboration rehearsals required manually transcribing command outcomes into
evidence. Generic contributor eligibility could also look like permission to
start a task assigned to somebody else. A path supplied as a context route ID
produced an uncertain-execution error despite failing before mutation.

## Decision

Reuse the measurement store through `measurement report`. Inspection does not run
the command. The report retains an exact candidate, Work Item, attempt reference,
original elapsed time, exit outcome and artifact integrity status. Unknown usage
and cost remain null. Success requires a reusable intact result and exact declared
input bytes/modes matching the candidate, with a second inspection for drift.
Coverage is limited to declared inputs; the reviewer must assess omitted
dependencies and whether the measurement actually addresses the acceptance criteria.

Optional output is an exclusively created Markdown file under that Work Item's
artifact directory. Repeating an identical export is idempotent; differing evidence
cannot overwrite the old file. No output path can escape through traversal or
symlinks, or overlap declared measurement inputs/outputs. This is not a sandbox
against hostile concurrent filesystem rewriting. Failed or unavailable results
remain failures, including when a diagnostic report is saved.

Readiness retains its existing actor eligibility field for compatibility and adds
explicit task responsibility, planned/recorded assignment, active claim and task
blockers. Task readiness is still only an actor/assignment observation: it never
waives execution, policy, recovery or evidence guards. A task blocker causes a
failing CLI status. Context references are route IDs; an unknown ID returns
`INVALID_INPUT` before creating a Work Item.

## Consequences

Agents can cite a generated mechanical record and add their own substantive
judgment without reconstructing measurements. This reduces manual transcription,
not proven provider cost. No lifecycle stage, independent review, original failed
attempt, candidate guard, hosting permission or responsibility record is removed.
