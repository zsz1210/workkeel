# Optional reference usage: project Bots and coding agents

This is one way to use Workkeel, not part of the framework core. Project Bots
can handle requirements conversations while existing coding tools implement and
review approved tasks. Workkeel supplies the task contracts, handoffs and evidence
records; this setup does not require a Bot platform, model bundle or workspace UI.

## Roles

| Role | Responsibility |
| --- | --- |
| Person | Sets priorities and approves scope, acceptance and release |
| Project Bots | Take requirements from the person, clarify intent and prepare a task brief |
| Claude Code builder | Claims the approved task, implements within scope and retains check evidence |
| Codex reviewer | Independently reviews the exact candidate and runs relevant tests |
| High/critical reviewers | Separate Codex and Claude Agents independently cross-review the exact candidate |

Bot conversations feed the approved task contract; they do not grant broader
authority. The builder and reviewer remain distinct Agents. Model names describe
this reference setup, not a framework-wide provider requirement. See the
[native lifecycle](workkeel-daily-work.md) for claim and handoff details.

## Three human gates

1. **A — Scope and acceptance.** Before implementation, the person approves the
   goal, allowed paths, exclusions, risk tier and acceptance criteria. Project
   Bots turn the conversation into a reviewable brief. Unresolved requirements
   return to the person before work begins.
2. **B — Screenshots or evaluation report.** After implementation, the person
   inspects screenshots for visual work or an evaluation report for other work,
   alongside test results and independent review. Evidence identifies the exact
   candidate and covers the agreed criteria. Failed checks or missing evidence
   return for correction within the approved scope and rework budget.
3. **C — Release approval.** After required review and task acceptance, the
   person explicitly approves the release scope and any publication or deployment.
   Task acceptance does not grant release authority. Retain the required rollback
   plan and approval record for critical work.

These gates are a team convention layered over Workkeel's existing authority
checks. Screenshots and reports support a decision; they do not automatically
establish acceptance. See [completion evidence](workkeel-evidence.md) and
[risk requirements](team-adoption-and-risk.md#what-each-tier-requires).

## Review and bounded correction

For high/critical work, give Codex and Claude the same intent, exact candidate,
context and rubric in separate review threads. Both reviewers must be distinct
from the implementer; the Claude reviewer is a separate Agent from the Claude
Code builder. Each submits findings before seeing the other's review. Preserve
both reviews and the lead's evidence-based dispositions: Must fix, Consider,
Note or Dismiss. Follow the existing
[QA and cross-review specification](workkeel-review-assessment.md#independent-qa-and-release-gate),
including model-family and Principal separation requirements.

Cap rework at two rounds for low risk and three for standard, high and critical,
or a tighter approved budget. At the limit, stop and ask the person to re-scope,
approve a new task or cancel. Optional review scores remain statistical records;
they do not replace findings, required checks or human gates.

Use the CLI and repository files on their own, or optionally inspect records in
the [workspace observatory](workkeel-workspace.md) with
`workkeel workspace serve`. Viewing records does not start model work or approve
a release.
