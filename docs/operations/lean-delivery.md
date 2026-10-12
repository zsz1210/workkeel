# Lean delivery

The CLI provides `work-item deliver` for a low-risk, bounded Lean change that is ready to hand from Developer to Quality Evaluator. It combines the handoff, claim release and entry into Test. This command is included in published Alpha.33; use the repository-pinned launcher. Its design is recorded in ADR-0054.

It does **not** run tests, approve the result or close the Work Item. Standard, High-Assurance, interface work and work with active runtime workers keep their existing workflow. Never lower a profile just to use this command.

## Use it

Choose one completion route. For a small eligible task that also needs current Status/Doctor, prefer [stage completion](../extensions/lean-completion.md) with `work-item finish`. Keep `deliver` when only the three administrative steps are needed. Do not call both, and do not build a context packet solely to finish a stage.

First inspect the current Work Item:

```bash
node ./templew.mjs context resolve . --work-item WI-0001 --position developer --compact --no-write --json
```

The response identifies the current claim, recorded candidate, acceptance criteria and sources to read. Its next-operation hint is not authorization or a passed readiness check. Complete the approved work and tests, commit the candidate, and keep the actual evidence in the repository.

Replace the placeholders below with the current claim/Identity/Principal, full candidate SHA and existing evidence. Keep the same operation ID and exact arguments when recovering this attempt:

```text
node ./templew.mjs work-item deliver . --work-item WI-0001 --operation-id attempt-1 --claim-id <claim-id> --agent-id <developer-id> --principal-id <principal-id> --revision <full-sha> --completed <completed-work> --evidence <evidence-path-or-id> --json
```

The default validates and applies under the local mutation lock. Add `--dry-run` to preview without writing; add `--expected-plan <plan-digest>` when applying to require the same plan. Preview plus application is optional, not an extra required round trip. A stale preview must be reconciled, not silently replaced.

After success the Quality Evaluator owns Test and must claim and verify the candidate. For a same-scope failed review, the reviewer uses the existing [rework operation](../adr/0053-review-rework.md); another delivery must use a corrected candidate and fresh evidence.

## Recover without duplicating the handoff

The command journals its intended writes locally below the checkout's Git directory and creates a repository receipt last. If interrupted, rerun only the identical request after inspecting its error and current state. Recovery checks current inputs and applies only missing writes. Other mutations remain blocked while the operation is pending. Never delete the journal or switch to individual commands to bypass this protection.

An exact completed replay returns `already_applied` without new writes. That is a historical receipt, not evidence that the Work Item is still at Test or that it passed verification. A different request cannot reuse that operation ID.

For JSON failures, inspect `code`, `mutation_status` and `next_action`:

- `INVALID_INPUT`: repair the named argument within the same authorized operation.
- `STALE_PREVIEW`: reread changed context/authority and preview again.
- `PENDING_RECOVERY`: inspect and resume the pending identical operation.
- `GUARD_REJECTED`: reconcile the failed claim, eligibility, evidence or other guard; do not bypass it.
- `EXECUTION_UNCERTAIN`: preserve files and inspect journal/receipt before retrying. Unknown is not no-write.

No error response executes a retry. A receipt or closeout cannot authorize deployment, publication or spending.

## What this improvement establishes

The documented handoff/release/transition sequence has three CLI invocations. Handoff plus the transition's existing automatic claim release already uses two. Direct `deliver` uses one; preview plus apply uses two. A scripted baseline can also batch calls into one host tool invocation, so CLI counts alone do not demonstrate fewer model turns or Tokens.

Local checks qualify state transitions, recovery and compatibility. Model efficiency and human usability require their own matched observations. No general speed, cost or quality improvement is claimed.
