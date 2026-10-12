# ADR-0045: Match delivery controls to risk and keep concluded work out of the blocked queue

## Status

Status: Accepted for compatibility design.

## Context

Temple originally used one complete lifecycle for every Work Item. That route is useful for consequential delivery, but it makes a bounded, reversible local change carry the same coordination stages as a release-sensitive change. It also recorded every Release Gate no-go as `blocked`, even when the approved experiment had finished and no continuation was intended.

Comparison attempts exposed the cost of ambiguous profile outcomes: an
execution can consume resources without producing an accepted candidate, and
an evaluator failure cannot be counted as a valid score. The decision keeps
quality and acceptance distinct from process completion.

## Decision

Add three Work Item workflow profiles:

- **Lean** for explicitly bounded, low-risk, reversible local work;
- **Standard** as the backward-compatible default for ordinary delivery; and
- **High-Assurance** for work that activates the existing risk contract.

Profile selection is recorded input, not a prose classifier. The CLI calculates the strongest required profile from the requested profile, risk tier, scope class, and named escalation triggers. Profiles may be raised before Build, never silently downgraded, and never changed after Build without first stopping and replanning the work.

Add `concluded` as a terminal state. A Release Gate go closes as `done` with outcome `accepted`; a no-go closes as `concluded` with outcome `no-go` or `inconclusive`. `blocked` is reserved for unfinished work that can resume after a named impediment is resolved.

Use one lifecycle resolver for transitions, terminal checks, task eligibility, projections, stale-evidence handling, tracker mapping, and the Management Console. Missing profile fields resolve to Standard, while existing High-Assurance records retain their stronger behavior. A narrow explicit migration rewrites only structurally qualified legacy Release Gate no-go records.

Model selection remains advisory. Temple records the requested and effective models and observed usage separately, but this decision does not add an automatic router or claim that one model is best.

## Consequences

- Small, well-bounded work can finish with fewer handoffs while retaining an approved brief, implementation evidence, testing, and a closeout.
- External writes, publication, migrations, cross-repository contracts, unresolved scope, security boundaries, sensitive data, deployment, release, and other named signals deterministically prevent an unsafe Lean route.
- A finished failed experiment appears in History with its honest outcome instead of inflating active blocker counts.
- Existing Work Items remain valid without a bulk rewrite; project-owned history changes only through an explicit migration command.
- Independent QA remains a distinct identity where Standard or High-Assurance requires it. Lean does not claim that its Test stage is Independent QA.
- The next process comparison must first prove its fixtures, evaluator contract, metrics, and stop behavior locally. Another model run is not justified merely because an earlier run stopped.

## Rejected alternatives

- Keep one workflow and treat every skipped stage as an exception.
- Infer risk or workflow profile from filenames, titles, or an unqualified model judgment.
- Continue treating a completed no-go experiment as active blocked work.
- Automatically choose or switch models from the current small and incomplete comparison set.
- Repeat the Wave 5 experiment before fixing the evaluator and measurement contract.
