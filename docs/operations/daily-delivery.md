# Daily core delivery

Use this opt-in execution style for an already approved, low-risk bounded Lean
Work Item in Build, without UI or active workers. It preserves the existing Lean
workflow and a distinct Quality Evaluator (Verifier). Standard and High-Assurance
keep their required routes. This is installed product code, independent of the
experiment runner. It does not start models, isolate provider prompts, schedule
background work or grant authority.

The host coordinator keeps authorized work moving between implementation,
checks, repair and the next eligible owner. A stage worker stops at its own
handoff; the coordinator dispatches the next owner without asking the human to
repeat an existing instruction. Ask only for a genuinely missing decision or an
action outside the recorded authorization.

## Prepare once

Use the normal Work Item creation and prebuild gates. Record approved scope,
acceptance, affected paths and the project-required evidence. Read native
instructions and routed sources. Create a repository JSON plan before opening:

```json
{
  "schema_version": "temple.delivery-plan/v1",
  "authorization_ref": "docs/work/approved-brief.md",
  "tests": ["test/feature.test.mjs"],
  "test_timeout_ms": 60000,
  "budget": {
    "elapsed_limit_ms": 3600000,
    "max_repairs": 2,
    "verification_reserve_ms": 600000,
    "repair_reserve_ms": 600000,
    "cleanup_reserve_ms": 120000,
    "token_limit": null,
    "token_reserve": 0
  }
}
```

These are example limits, not a recommendation for every task. Select them from
the approved task before execution. Include implementation, checks, review,
repair, revalidation and cleanup. Pauses consume elapsed capacity. Repair limits
count reviewer rework and retries after failed checks. Time admission preserves
downstream reserves, including possible repair during verification; local checks
have an enforced subprocess deadline. Host model turns require host enforcement.
A null token limit explicitly means there is no measured token ceiling here;
financial and provider policy still apply. A positive token limit requires a
positive downstream token reserve and complete task-scoped provider observations
before admitting subsequent work. Unknown usage cannot prove remaining capacity.

```text
node ./templew.mjs delivery open . --work-item WI-#### --agent-id <builder-id> --principal-id <principal-id> --request docs/work/daily-plan.json --json
node ./templew.mjs delivery next . --work-item WI-#### --json
```

Open claims eligible ownership or reuses that same actor's claim. It returns the
scope, acceptance, content-deduplicated governing sources and next action.
Consume required native and nested references too. The packet is neither a
permission nor evidence of instruction loading. The CLI pins the plan and
authority hashes in its own Work Item artifact; do not hand-edit that record.

## Implement, check and hand off

The AI chooses investigation, design and implementation. Run all project-required
verification, commit the exact product candidate and record actual evidence.
Write the finish request before the final fixed check:

```json
{
  "operation_id": "developer-first",
  "position": "developer",
  "revision": "<full-40-character-candidate-sha>",
  "completed": ["Implemented the approved behavior and verified its edge cases"],
  "evidence": ["docs/work/developer-evidence.md"]
}
```

```text
node ./templew.mjs delivery check . --work-item WI-#### --agent-id <builder-id> --principal-id <principal-id> --json
node ./templew.mjs delivery finish . --work-item WI-#### --agent-id <builder-id> --principal-id <principal-id> --request docs/work/developer-finish.json --json
```

Check runs explicit Git-visible Node test files without a shell on POSIX.
A passing exit alone is insufficient: positive test count, no cancellation,
timeout, surviving descendants, temporary residue or Git-visible workspace
mutation are required. A separate watchdog terminates the owned process group
if the coordinator dies. The recorded group identity helps investigate an
interrupted check. This is supervision of trusted local tests, not a sandbox:
detached descendants or tests writing elsewhere remain within host permissions.

The snapshot covers tracked and nonignored untracked files, including selected
test bytes, but excludes Git internals, ignored files and the CLI's own delivery
record. Test-owned TMPDIR residue is checked separately before cleanup.
It does not prove the entire machine clean. Prepare evidence and requests before
checking; any subsequent Git-visible change requires a new check. This command
does not replace the project's full verification policy.

Finish validates the exact current candidate and calls the existing recoverable
Lean finish operation once. Do not additionally call deliver, handoff, release or
transition for that stage. Inspect lifecycle mutation and diagnostics separately.

## Independently verify and repair

A different eligible Agent Identity opens Test, inspects the exact Developer
candidate and checks acceptance independently. Record evidence and a request:

```json
{
  "operation_id": "verifier-first",
  "position": "quality_evaluator",
  "revision": "<the-same-candidate-sha>",
  "judgment": "pass",
  "test_evidence": ["docs/work/verifier-evidence.md"],
  "lean_closeout": ["docs/work/verifier-evidence.md"]
}
```

Use the same open, check and finish commands with the Verifier identity. Open
reuses the pinned plan; omit --request or supply that same plan path. Only an
actual passing judgment permits Done. Lean verification does not claim Standard
Independent QA or authorize publication, merge or deployment.

A failed Build check returns repair-and-check within the remaining budget.
A rejected review records findings and a rework request:

```json
{
  "revision": "<rejected-candidate-sha>",
  "reason": ["The approved edge case remains incorrect"],
  "evidence": ["docs/work/review-findings.md"]
}
```

```text
node ./templew.mjs delivery rework . --work-item WI-#### --agent-id <verifier-id> --principal-id <principal-id> --request docs/work/rework.json --json
```

The coordinator returns the same authorized scope to the Developer, opens a new
claim and completes repair plus independent revalidation. Preserve the original
rejection and use a new finish operation ID for a new attempt.

For interrupted finish or failed post-mutation diagnostics, repeat only the
identical request with unchanged authority, evidence and candidate. Known settled
operations are historical receipts, not a second mutation. Changed inputs,
unknown check/rework execution and ownership conflicts require inspection through
the normal recovery route; never clear journals or assume failure meant no write.
Deterministic invalid finish/rework inputs are preflighted before recording pending.

For a real pause, use delivery pause with a request containing reason
(missing-input, external-dependency, authority-change, budget-limit or
instrument-uncertain) and detail. Resume requires --request pointing to repository
resolution evidence, unchanged authority and sufficient remaining capacity.
It cannot waive pending execution, increase the frozen budget or approve new scope.
Routine tests and same-scope repairs do not require another human “continue.”

## Account without another model call

```text
node ./templew.mjs delivery report . --work-item WI-####
node ./templew.mjs delivery report . --work-item WI-#### --json
```

The default terminal summary shows canonical lifecycle and common-session completion
separately, candidate/tested revisions, the latest five delivery checks and recorded
test/evaluation/Independent QA references. References are not revalidated or parsed
to invent test counts. Lean review does not imply formal Independent QA. Pending
execution and active pauses remain visible; a failed check is not a terminal verdict.
Long check histories and reference lists show omitted counts. Use --json for the
unchanged machine report and the Work Item for complete gate references.

Unknown or partial task usage displays as unknown even when observed counters are
zero. Operational Tokens are input minus cached input plus output, not a price.
Repair counts cover recorded delivery rework/check retries, not every development
correction; explicit pauses do not measure all waiting or human intervention.
The summary adds no model call, test execution, lifecycle write or automatic advice.

Report is read-only. It separates lifecycle state, elapsed time since Work Item
creation, time before delivery opened, observed local operation durations, explicit
pauses, unclassified elapsed time, repairs and check history. Unclassified elapsed
time includes model work, coordination, idle time and unrecorded waiting; it is
not all active work.

Optional delivery observe accepts a task-scoped receipt file from a recorded
participant in solo mode; other collaboration profiles retain the existing
collector. It does not activate that collector or read private provider logs:

```json
{
  "schema_version": "temple.delivery-usage/v1",
  "work_item_id": "WI-####",
  "provider_id": "configured-provider",
  "call_id": "provider-unique-call-id",
  "phase": "build",
  "outcome": "failed",
  "elapsed_ms": 1234,
  "usage": { "input_tokens": 100, "cached_input_tokens": 60, "output_tokens": 20 }
}
```

```text
node ./templew.mjs delivery observe . --work-item WI-#### --agent-id <participant-id> --principal-id human --request docs/work/usage.json --json
```

Phases are preparation, coordination, build, check, verification, repair and
closeout; outcomes are completed, failed and interrupted. Use usage: null when
counters are unavailable. Operational tokens are input minus cached input plus
output; this is not price. Failed and interrupted calls remain in phase totals
and outcome breakdowns. Call IDs deduplicate exact receipts and reject conflicting
replacements. Preserve original receipt files; use a new path per call.

A supplied provider receipt may attest coverage with
coverage: { complete: true, from_work_item_creation: true, call_ids: [...] }.
It must name every unique recorded task call. That is a supplied attestation,
not independently inferred coverage. Later partial observations or stage changes
invalidate completeness. Whole-task tokens stay null without complete known
coverage; known partial counts remain visible. No account-level allocation,
estimated money, efficiency ranking or model-generated report is implied.
