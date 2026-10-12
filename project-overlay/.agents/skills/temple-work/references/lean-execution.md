# Optional bounded Lean execution

Only for an existing low-risk bounded Lean Build/Test task without UI or active
workers. Standard, High-Assurance, recovery, unclear scope and conflicting ownership
retain the existing route. No profile downgrade or new authority is granted.

## Read and claim

Choose one route: compact `context resolve` plus required reads is sufficient;
`finish` does not require a packet. If material is needed, opt in with:

```text
node ./templew.mjs context enter . --work-item WI-#### --position <position> --agent-id <agent-id> --principal-id <principal-id> --no-write --json
```

This may replace the initial preview, not required instructions. Consume the whole
required bodies and nested/unselected references, or follow the explicit fallback
to compact navigation. Derived inventory cannot replace an independently required
whole source. Reuse follows `TEMPLE.md`; no read receipt or session memory is
inferred. Entry does not claim work and its digest is not mutation permission.

If unclaimed, `work-item claim` with the eligible actor and current base revision.
Recheck changed state/authority. Implement and test independently of lifecycle commands.

## Complete once

Developer: commit the exact product candidate and record actual evidence, then:

```text
node ./templew.mjs work-item finish . --work-item WI-#### --position developer --operation-id <stable-id> --claim-id <active-claim> --agent-id <builder-id> --principal-id <principal-id> --revision <full-candidate-sha> --completed <facts> --evidence <repository-ref> --json
```

Quality Evaluator: a different Identity independently verifies and claims that
Developer candidate. Record Test/Lean-closeout evidence; only on passing acceptance:

```text
node ./templew.mjs work-item finish . --work-item WI-#### --position quality_evaluator --operation-id <stable-id> --claim-id <active-claim> --agent-id <verifier-id> --principal-id <principal-id> --revision <full-candidate-sha> --judgment pass --test-evidence <repository-ref> --lean-closeout <repository-ref> --json
```

Keep the original Developer candidate SHA after committing handoff records. The
CLI permits descendant HEAD only for verification or identical-request recovery,
and only for that item's administration, generated views and explicitly referenced
new Markdown evidence. Changed product, dependencies, instructions or policy still
reject; do not substitute HEAD or amend the candidate to evade a mismatch.

Do not also call `deliver` or a second manual handoff/release/transition. `--dry-run`
and `--expected-plan` are optional, not required round trips. A failed verification
uses issue/rework handling. Never reuse an unsettled operation ID with changed facts.

## Inspect the result

Inspect `mutation` and `diagnostics` as directed by the Work Skill. After inspecting
the receipt/state, the identical request may repair diagnostics only if candidate,
evidence and authority still match. Interrupted journals use that identical request,
not individual mutations or deletion. Read [Assurance and recovery](assurance-and-recovery.md)
when needed. Stop at this stage's result and next owner; formal QA, merge, publication
and another task are not implied.

Only the isolated real-collaboration maturity warning is informational for finish.
Other warnings and failures remain unresolved. Commit the generated receipt and
diagnostic observation with delivery records so another clone can see failures;
the observation is not replay authority or fresh acceptance evidence.
