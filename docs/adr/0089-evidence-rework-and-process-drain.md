# ADR-0089: Evidence-only rework and bounded process drain

Status: Accepted

## Context

A rejected delivery may need corrected evidence while its source commit remains
valid. Requiring a new commit for every retry encourages meaningless source changes.
Conversely, accepting the same evidence again could erase the value of a failed
review. Delivery source and delivery evidence must remain separately identifiable.

A command's direct child may exit before its already-stopping helpers. Immediate
group termination can misclassify this exit order as a leak or race with cleanup.
Waiting indefinitely would hide real survivors and defeat the command deadline.

## Decision

Ordinary `task rework` retains its requirement for a fresh source revision. An
approver may explicitly choose `mode: "evidence-only"` on a failed native review.
This mode requires the same rejected commit, at least one new evidence content
digest, and unchanged prior rejected delivery and review evidence. Renaming,
reordering or resubmitting the old bytes does not qualify. Each delivery records
the preceding rejected-review and evidence digests. New claims, current operation
versions, independent review, authority and clean-candidate checks still apply.

Rejected evidence remains pinned through subsequent review, acceptance, dependency
use and Doctor. Task-owned retained artifacts are administrative only where the
existing artifact boundary permits them. The new mode does not exempt arbitrary
files or decide whether the correction addresses a finding: the distinct reviewer
must judge that. Source changes require ordinary source rework.

For successful supervised POSIX commands, allow up to 500 ms of natural process-group
drain, bounded by the original command deadline. A remaining descendant is still
reported and terminated; cleanup does not convert it into success. Timeout,
missing terminal results, output limits, failed termination signals and unconfirmed
group exit remain failures. Local test supervision uses the same drain rule.
This process-group boundary is not a sandbox and does not cover escaped groups.

## Consequences

Private report corrections need no dummy commit. Failed verdicts and original
artifacts remain inspectable, and a new report is not automatically acceptance.
Existing records without a rework mode keep their source-rework behavior.

Successful shutdown may take a bounded additional interval. A transient exit-order
fixture proves the distinction from a lasting helper; it does not retroactively
prove why any historical provider shutdown failed. Live qualification and model
comparisons retain their own frozen protocols, raw errors and resource accounting.
