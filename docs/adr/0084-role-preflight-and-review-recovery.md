# ADR 0084: Role preflight and interrupted review recovery

Status: Accepted for the bounded native dispatch reliability implementation

## Context

A dispatched role can fail after inference starts because the host lacks an
editing tool, runs tests the coordinator also owns, cannot serve the exact model
and effort, or reports usage in an unexpected shape. A JSON declaration cannot
prove any of these facts, and metadata is not a sandbox.

An independent review can also be interrupted after handoff. The implementation
claim has ended, so the claim-based ticket and binding APIs correctly refuse a
new review binding. Cancelling and recreating the task only to obtain a binding
would discard the original authority and candidate identity.

## Decision

Add a model-neutral role preflight. A role contract states requirements only:
role, product access, test ownership, editing tools, exact model and effort, and
required usage fields. Only a host object registered in-process by trusted
embedding code through `createTrustedRoleHost` can satisfy it. Its probe must
actually inspect sandbox, product access, network, test scratch, tools, model
catalogue and usage report shape without starting inference. Unknown, missing,
malformed, sparse or contradictory values fail before any model turn. Codex
dispatch uses the preflight only when a caller opts in with a role; a read-only
role then makes approved write roots read-only in the host permission profile.

Add `recoverInterruptedReview`, a trusted embedding API rather than a CLI command,
because a stopped predecessor and read-only enforcement can only be proven by
host code. It retries a review on the same task and exact delivered candidate
after an explicit request by a registered approver naming a distinct registered
reviewer. It requires the current task version, the current chain digest, the
closed and stopped predecessor collection or chain head, a fresh source, the
approved review ticket's policy, model and data scope, unexpired authority and
unchanged pins, evidence and candidate.

Host probes run outside the project mutation lock. Replay checks, chain reads and
record publication run under it; everything the probes could have outlived is
revalidated under the lock, which is held through attempt reservation and launch
invocation but released before the model runs. Each attempt and its result are
separate immutable records in a bounded chain of three, validated field by field
in addition to their envelope digests. A result is recorded only while its
attempt is the chain head and the task is unchanged.

Ordinary `task review` must name the current completed attempt when a chain exists,
and records the attempt, completed result and chain digests. `task close` refuses
any difference, including a deleted result. Tasks without a chain keep the
existing review and close behavior.

## Consequences

Recovery never revives the implementation claim, authors a verdict or accepts the
task. An authored failure still uses rework; accepted, cancelled and done tasks
cannot resume. Existing claim, binding, separation, evidence and publication
guards are unchanged, and v1 records remain readable.

The trust boundary is the embedding application's host code: a dishonest probe
defeats the check. Receipts are point-in-time observations and do not promise
complete future token reports; unknown counters remain null. A late report from
a superseded or cancelled attempt is rejected rather than recorded. A recovery
chain is local to one workspace and adds no distributed identity or high-risk
workflow support.

See the [operation guide](../operations/workkeel-review-recovery.md) and the
[native dispatch decision](0081-native-dispatch-and-reading-state.md).
