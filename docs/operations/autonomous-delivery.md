# Autonomous delivery across workflow profiles

Use a v2 delivery plan to select the shared autonomous entry for an existing
Lean, Standard or High-Assurance Work Item after its approved Build entry. The
Developer chooses investigation, decomposition, implementation and self-tests.
The coordinator executes fixed administration and continues to the next eligible
owner. A separate model turn per lifecycle stage is unnecessary.

The workflow profile still determines required evidence. Standard retains Test,
Eval, Independent QA and Release Gate; High-Assurance also retains normalized
revision-matched evidence, qualified identities, Human Principals and rollback.
The same substantive review may support several requirements when its author is
eligible for each responsibility. A check result is not that review judgment.

## Select and execute

Record this explicit plan in the Work Item's artifact directory, replacing the
authorization and test paths with the project's actual approved inputs:

```json
{
  "schema_version": "temple.delivery-plan/v2",
  "execution_mode": "autonomous",
  "check_policy": "confined-node",
  "authorization_ref": "docs/approved-brief.md",
  "tests": ["test/product.test.mjs"],
  "test_timeout_ms": 30000,
  "budget": {
    "elapsed_limit_ms": 3600000,
    "max_repairs": 1,
    "verification_reserve_ms": 600000,
    "repair_reserve_ms": 600000,
    "cleanup_reserve_ms": 120000,
    "token_limit": null,
    "token_reserve": 0
  }
}
```

This example illustrates fields, not a universal budget recommendation. Derive
limits from the task, including complete verification, repair, revalidation and
cleanup. A null token limit means unavailable enforcement/accounting, not zero cost
or financial authorization. Host model turns need host-side budget enforcement.

Commands retain the [daily delivery](daily-delivery.md) arguments:

```text
node ./templew.mjs delivery open . --work-item WI-#### --agent-id AGENT --principal-id PRINCIPAL --request PLAN --json
node ./templew.mjs delivery next . --work-item WI-#### --json
node ./templew.mjs delivery check . --work-item WI-#### --agent-id AGENT --principal-id PRINCIPAL --json
node ./templew.mjs delivery finish . --work-item WI-#### --agent-id AGENT --principal-id PRINCIPAL --request COMPLETION --json
```

`open` claims or reuses the current actor's claim and returns the task contract.
It first requires a declared product scope outside `.ai-org` and its descendants,
using the same scope rule as completion. Organization-only work is rejected before
claiming, recording a session or running checks; use the ordinary Work Item
lifecycle for that work. Mixed product/organization scopes remain eligible subject
to the existing authority and workflow gates. Reopening or checking an old
ineligible session preserves its record and rejects further execution.
`next` reports the next operation and profile-specific edge. Before `check`, finish
the implementation and required tests, commit the product, and write the evidence
and completion request. `finish` applies the existing recoverable lifecycle operation
and runs diagnostics. Inspect both results. Use the returned next owner automatically
within existing authorization; ask a human only for an actual unresolved decision.

## Completion requests

All v2 requests require `operation_id`, exact full `revision`, explicit current
`stage`, current `position` and a `satisfied` object mapping named requirements to
arrays of repository paths or normalized Evidence IDs. Supply only the current
edge's requirements; early evidence cannot prefill a later owner's gates.

| Stage | Additional request fields | Named requirements |
|---|---|---|
| Build | `completed`, `evidence` | Developer handoff/evidence are generated from actual supplied facts; High-Assurance also supplies `exact_candidate_revision` |
| Test | `judgment: "pass"` | `test_evidence`; Lean also `lean_closeout`; High-Assurance also `normalized_test_evidence` |
| Eval | `judgment: "pass"` | `evaluation_report` |
| Independent QA | `judgment: "pass"` | `independent_qa_pass`; High-Assurance also `normalized_independent_qa_evidence` |
| Release Gate | `judgment: "pass"`, `approval`, `rollback` | Existing release-policy requirements such as `accepted_scope` and `independent_qa_report`; prior current evidence may be reused |

For example, a Standard Test request has this shape:

```json
{
  "operation_id": "review-attempt-1-test",
  "revision": "FULL_TESTED_COMMIT_SHA",
  "stage": "test",
  "position": "quality_evaluator",
  "judgment": "pass",
  "satisfied": { "test_evidence": ["docs/verification.md"] }
}
```

Prepare matching Eval and Independent QA requests from the same substantive review
when the reviewer is eligible. After the first check passes, its result can carry
across those responsibilities for the same Identity and unchanged candidate/evidence.
Each stage still gets a distinct exact operation and claim. Any intervening content
change requires another check. Another Identity must run its own check. This is reuse
of observed execution, not a new test claim. Release remains a separate authority.

High-Assurance rollback values must be normalized rollback Evidence IDs; approval
must be its revision-matched approval JSON with the required Human Principals.
The Developer cannot complete review or release using its own Identity.

At Release Gate, `satisfied` also accepts the selected UI delivery mode's
`minimum_evidence` keys from the existing UI policy. For example, code-first can
submit `runtime_visual_review` with its actual repository evidence path. The native
close validator still requires the complete selected-mode evidence, valid references,
current candidate, approval and rollback. Other UI modes' keys are not implicitly
accepted, and this exception does not permit early submission at Build/Test/Eval/QA
or add UI keys to work marked `not-applicable`. Existing prebuild evidence may be
reused by reference where current; no UI mode or evidence requirement is changed.

## Execution boundary and recovery

For a human summary, run `node ./templew.mjs delivery report . --work-item WI-####`.
Add `--json` for the unchanged machine report. The summary distinguishes canonical
completion from session completion, displays recorded checks and evidence references,
and preserves unknown usage and incomplete execution. It does not perform fresh
verification. See [Daily delivery accounting](daily-delivery.md#account-without-another-model-call)
for the time, repair, pause and evidence coverage limits shared by both versions.

`trusted-local` runs trusted project tests with host permissions. `confined-node`
uses macOS `sandbox-exec` around a Node process with test isolation disabled so it
does not need child-process forks. It denies network, forks and source writes,
permits only owned temporary writes, and removes the inherited environment. Source
and necessary runtime locations are readable; unrelated user data is not. Paths
and the exact visible candidate are checked before and after execution.

The adapter is optional and uses a deprecated macOS facility; it is not a universal
hostile-code sandbox or production isolation guarantee. Unsupported hosts and startup
failures stop as instrument failures, with no unrestricted fallback. Subprocess-heavy
tests require an appropriately authorized external isolation adapter or the explicitly
selected trusted-local policy. The parent Codex conversation remains outside this
boundary. Restrict the actual provider worker environment for autonomous model tools.

Failed checks consume the configured repair allowance. Rejected review uses
`delivery rework` from Test/Eval/Independent QA, retaining the original rejection
and requiring a new Developer candidate. Identical interrupted finish requests use
the existing journal; never delete pending state. Changed authority, unknown execution,
insufficient reserves or conflicting ownership require reconciliation. Reports are
deterministic and keep incomplete usage unknown.

Done is organizational acceptance. Real deployment/external actions still require
their separately authorized environment adapter, candidate/authority checks, post-action
verification and recovery; this entry does not perform them. Learning is demand-driven
and no AI retrospective or automatic promotion is added.

See [ADR-0065](../adr/0065-unified-autonomous-delivery.md). Existing v1 plans and
historical Work Items retain their original behavior; selection is opt-in.

## Protocol failures in local diagnostics

The local App Server adapter rejects malformed JSON and invalid routing envelopes.
It retains a content-free first-failure record: reason, frame class, decoded UTF-8
length and SHA-256, frame number, preceding valid frames and pending request count.
No raw frame, parser input excerpt, prompt or reasoning is retained. The record
supports synthetic replay of a failure class, not reconstruction of discarded bytes.
Split Unicode and delayed CRLF framing are handled without inventing blank frames.

Pending requests fail promptly. A faulted connection permits only owned interrupt
and terminal-cleanup requests before close; no work retry occurs. Actor results keep
the diagnostic, partial usage and actual cleanup outcome separately. The diagnostic
runner persists its active cell and attempt as stopped before claim cleanup, retains
earlier accepted and later unrun cells, and releases ownership only after actor
cleanup is confirmed. Failed or uncertain cleanup remains explicit without replacing
the original cause. Historical sealed results are not rewritten by these changes.
