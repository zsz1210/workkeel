# Correct a change without opening another Work Item

Availability: included in published Alpha.33. Alpha.30 does not include this command; explicitly upgrade older projects before relying on it.

Use rework when a review finds a defect **inside the approved scope**. The Work Item keeps its ID, scope, acceptance criteria and design approvals. The rejected candidate and its evidence remain in history; they no longer count as proof for the repair.

## Return a candidate to Build

1. Save the findings in a repository file, naming the defect and acceptance criterion.
2. Finish or explicitly cancel any runtime worker through the normal Worker commands. Rework does not stop processes or cancel workers for you.
3. Claim the Work Item as its current review Position. Test and Eval belong to the Quality Evaluator; Independent QA belongs to Independent QA. Team work requires the claimant's active sponsored Principal; ordinary attributed policy needs no Temple login. Legacy or explicitly verified/High-Assurance policy retains current provenance requirements. Use contributor readiness to inspect the applicable policy.
4. Run the following from the project root, replacing the example ID and SHA with the current Developer handoff's exact values:

```sh
node ./templew.mjs work-item rework . \
  --work-item WI-0001 \
  --same-scope \
  --input-revision <full-current-developer-commit-sha> \
  --reason "The approved empty-state behavior fails the acceptance test" \
  --evidence .ai-org/artifacts/WI-0001/attempt-1-findings.md
```

The command returns the item to Build and releases the review claim. It does not launch an Agent, change the product scope or grant release authority. `--same-scope` records an explicit assertion, not an automated semantic assessment of the change.

## Deliver and verify the repair

Claim the returned item as Developer using `work-item claim`. Make the repair, commit it, then record a new Developer handoff. The Developer and reviewer must be different Agent Identities. Use new attempt-specific evidence paths, such as `attempt-2-tests.md`, or new normalized Evidence IDs tied to the corrected commit.

Continue through the normal workflow: Lean returns to Test; Standard and High-Assurance repeat Test, Eval and Independent QA before Release Gate. Rework does not downgrade the profile, remove High-Assurance requirements or relax human approval rules. A successful closeout must name the current Developer candidate.

The CLI rejects rejected commits, retired evidence references (including equivalent path spellings), missing candidate handoffs and normalized evidence for a different revision. It cannot prove that prose reports are truthful or that copied files contain fresh results; Independent QA and repository review remain necessary. Preserve old reports instead of overwriting them.

## When to stop

- New behavior or changed scope: obtain approval for separate work; do not disguise it as rework.
- Release Gate or a terminal item: use the existing release/closeout decision, not this command. Closed attempts are not reopened.
- Missing or stale specification, design, UI or risk authority: reconcile that evidence explicitly. Rework does not approve it for you.
- Legacy symbolic candidate revisions: reconcile the exact reviewed commit before proceeding; `HEAD` is not an acceptable rejected revision.
- Legacy handoffs without a recorded author: rework cannot infer the historical Developer from today's assignment. Continue the existing review/closeout path or authorize follow-up work; do not invent an author to reopen the candidate.
- Active worker or resource reservation: finish the owning runtime first. Rework will not interfere with running work.

## Where the history lives

The Work Item's `rework_history` records each rejected SHA, reviewer claim, findings, retired gates and candidate pointers. The event stream records `work_item_reworked`. Prior handoff files remain unchanged. Current candidate/test/QA/release pointers are cleared until new evidence is supplied; historical records must not be treated as the current candidate.

If audit persistence fails during the operation, the CLI restores the original Work Item bytes under the same mutation lock. This is in-process failure compensation, not crash-atomic storage: abrupt termination or an additional rollback I/O failure requires explicit repository recovery. After an unexpected interruption, inspect the Work Item and event stream before retrying; do not assume a failed process means nothing was written.

See [runtime coordination](runtime-coordination.md), [High-Assurance](high-assurance.md), and [ADR-0053](../adr/0053-review-rework.md). This local operation does not replace branches, repository review, or cross-machine coordination.
