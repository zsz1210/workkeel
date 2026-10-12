# ADR 0082: Read-only review assessment

Status: Accepted for the bounded advisory assessment implementation

## Context

Native v1 requires distinct review. Its file digests establish integrity, not
test execution or semantic correctness. Reviewers need an explanation of actual
candidate changes, missing evidence and whether recorded measurements still
apply. The proposed Mechanical acceptance path is not adopted.

## Decision

Add `workkeel task assess` and `assessNativeTask` as read-only observers. Validate
native records with the existing readers, inspect Git changes without executing
diff drivers, check authority/evidence pins and recursively accepted dependency
snapshots, and retain the stricter task/project review floor. No model, writer,
mutation lock, dispatch, acceptance transition or new dependency is involved.

The assessor and the native project/task readers share a bounded per-child Git
reader. It suppresses executable hooks, external diff/textconv, optional writes,
replacement objects and network fetches without changing process-global
environment or repository configuration. Configured clean/process filters and
submodule worktrees block diff observation rather than changing content semantics
or allowing another repository's executable configuration to run.

Optional versioned input supplies coverage and measurement dimensions. Every
caller assertion remains labeled as declared. File bytes and canonical candidate,
contract, policy and dependency dimensions are independently observed. Compatible
complete captures can be candidates for reuse after independent confirmation;
they are never automatically reusable proof or a reused acceptance judgment.
Failures, incomplete captures, unknown provenance and mismatches remain explicit.
Reserved unknown version labels are recognized independent of case or surrounding
whitespace, with original declarations retained. Historical failures keep their
candidate attribution and remain visible separately from current coverage failures.

Native contracts do not encode irreversible impact. The assessor can read an
explicit, task-specific impact statement only from a currently pinned authority
file, attributed to the task's registered approving Principal. Otherwise that
fact remains unknown. This optional observational document does not change the
native policy or approval model; attribution is not authentication.

## Consequences

The report is advisory and cannot certify lifecycle eligibility. Unknown impact
or stale authority blocks an affirmative route. High risk, sensitive data or
material irreversible impact selects established assurance. Ordinary semantic
uncertainty retains focused independent review. No extension or small diff proves
that prose is non-normative; v1 mechanical owner acceptance is unsupported.

The snapshot is bounded and rechecked for concurrent changes, not a transaction
or distributed lock. Supplied commands are data and are never run. Measurement
runtime/tool/configuration declarations require reviewer confirmation even when
they match. Existing required suites and independent judgment remain mandatory.

See the [operation guide](../operations/workkeel-review-assessment.md) and the
existing [native lifecycle decision](0072-task-first-lifecycle.md).
