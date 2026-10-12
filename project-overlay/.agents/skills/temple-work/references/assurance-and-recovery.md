# Assurance and recovery

Read for High-Assurance work, failed review, Release Gate, or an operation failure.

## Evidence and closeout

Follow the effective workflow and applicable policy, not a shortened list inferred from Context. Standard retains Test, Eval, distinct-Identity Independent QA and Release Gate. For High-Assurance, read `.ai-org/core/high-assurance.json`: retain risk tier, normalized revision-matched evidence, qualified/sponsored identities, distinct Human Principals where required, and rollback evidence.

At `release_gate`, `close` requires a decision, exact tested revision, rollback procedure, gate evidence and approval record. `--approval not-required` is valid only when no governing trigger requires approval. Organizational closeout never authorizes publication or deployment.

For a rejected candidate within approved scope, the active eligible reviewer may use `work-item rework --same-scope` with the exact rejected revision, reason and repository findings. Finish runtime workers first. The Developer then needs a new claim, corrected candidate and fresh attempt-specific evidence. Rework neither broadens scope nor reopens terminal work or Release Gate.

## Failed operations

Use read-only Status/Context to distinguish a pending mutation journal from failed
post-mutation diagnostics. `no_pending_operation` does not mean completion passed.
A fresh clone can read a committed `finish-<operation>.json` receipt and bound
`diagnostics-<operation>.json` observation, but cannot replay the origin's journal.
Return the exact operation to its original owner/checkout for identical-request
recovery and commit the resulting observation. Missing or conflicting observations
remain unresolved. Never copy a journal or hand-edit a diagnostic to manufacture a
pass. Competing claims require the named owners to coordinate a handoff or release;
do not choose a winner with Git ours/theirs.

New delivery and compact Context JSON failures report `code`, `mutation_status` and `next_action`. They do not execute a retry:

| Code | Response |
|---|---|
| `INVALID_INPUT` | Correct the named argument within the authorized operation; use command help. |
| `STALE_PREVIEW` | Refresh Context and preview. Reconcile changed scope/authority before using a new digest. |
| `PENDING_RECOVERY` | Inspect the pending operation; resume only its identical request. |
| `GUARD_REJECTED` | Investigate the guard; repair approved work/evidence if authorized, and ask when authority or scope is missing. |
| `EXECUTION_UNCERTAIN` | Inspect receipt, journal and current files before retrying. Unknown is not no-write or success. |

After a bounded correction, revalidate once. If the same unexplained failure repeats, stop and report evidence rather than looping. This does not authorize model-experiment retries. Existing text-only errors require conservative inspection; do not infer a machine classification from wording alone.

Never fabricate passing tests, reuse retired evidence, alter approvals, steal a claim, remove a pending journal or hand-edit canonical JSON to bypass a guard. Claim conflicts, changed authority, invalid checksums or unexpected partial writes require reconciliation, not automatic fallback.
