# Recover an applied Lean handoff

Use ordinary identical `work-item finish` replay when its original inputs still
match. Do not commit administrative records or amend bound evidence while its
diagnostics are pending. A passing CI does not settle local recovery state.

The source candidate additionally provides an explicit, bounded recovery command
for a fully applied Developer handoff whose diagnostics failed. It is not part of
the published Alpha.33 CLI. This command does not rerun lifecycle writes, grant
acceptance, start a model, or permit a merge or release.

## Supported case

The item must still be unclaimed, low-risk Lean Test in Solo mode, without UI,
indexed specifications, normalized evidence references, active workers or reserved
resources. The original candidate must be an ancestor of HEAD, and both committed
and working product files must be unchanged. Other cases require separately
qualified recovery or rework; do not force this route.

Recovery compares the actual scoped filesystem inventory, file bytes and executable
modes with the candidate Git tree. Index flags such as `assume-unchanged` and
`skip-worktree` cannot hide a change; unchanged flagged files need no index reset.
Ignored extra files within a scoped directory also prevent recovery. Symbolic
links, submodules and nonregular product entries require separate qualification.
The comparison uses raw blob bytes without executing Git filters; a checkout with
content transformations must match those bytes before using this narrow route.

The source candidate shares this physical check with ordinary `finish` and
`deliver`, including Developer and Verifier completion. It runs before lifecycle
writes and on journal revalidation; ordinary completion still requires candidate
HEAD equality. This is a consistency check, not a product-test runner. A hidden
change before completion is rejected without advancing the item. If files change
after lifecycle writes during diagnostics, the command rejects settlement but
does not roll back the already-applied lifecycle. Inspect the pending diagnostic
record and recover only with the original inputs; a lifecycle state alone is not
proof of successful completion. Historical replay remains explicitly historical.

Original item, receipt and handoff bytes must match. Events may only be appended.
Other bound inputs must match, except amended Developer evidence and the exact
legacy Solo to explicit attributed policy migration. Evidence amendments are
listed for review; they are not new acceptance. All current actor checks remain.
The original receipt's plan digest binds the complete input list and product scope;
editing a local diagnostic journal cannot narrow those checks.

Unrelated worker or resource reservation entries may change only when the original
registry bytes can be recovered from the candidate Git commit and match the
original snapshot hash. This item's entries, registry metadata and global resource
definitions must remain identical. Uncommitted original registry changes cannot be
reconstructed by guessing. Current diagnostics still validate the entire registry.

## Preview, approve and apply

Keep the human's actual recovery authorization in a new Work Item artifact.
Do not edit the original evidence to add recovery notes. Use the original actor:

```bash
node ./templew.mjs work-item finish-recover . \
  --work-item WI-0001 --operation-id original-operation \
  --agent-id agent-builder --principal-id human \
  --approval-ref .ai-org/artifacts/WI-0001/recovery-approval.md --dry-run --json
```

Review every changed input. With explicit authorization, repeat the command without
`--dry-run` and with `--expected-plan` set to the returned fingerprint. Changing
approval text, HEAD, evidence or a bound input invalidates that preview.

The CLI reruns full Doctor and status diagnostics. It retains the original journal
and receipt, writes an immutable recovery artifact with the original failed result,
and only then settles local diagnostic bookkeeping. A crash after the artifact
write can resume with the identical fingerprint if all inputs still match. A
conflicting artifact is a blocker, not permission to overwrite it.
Both crash resume and later reads validate the artifact's clean diagnostic outcome
and its original-record binding. This is local consistency checking, not a signature
or a security boundary against someone able to rewrite all repository/local state.

After recovery, a distinct Verifier must claim and verify the unchanged Developer
candidate. Historical finish replay remains historical; it is not fresh acceptance.
Do not reinterpret the recovery record as Test, Independent QA or release evidence.
