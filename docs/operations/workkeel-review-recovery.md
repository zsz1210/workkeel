# Role preflight and interrupted review recovery

Both features are JavaScript APIs for trusted embedding code. Neither adds a CLI
command, network dependency or new integration. Examples use fictional names.

## Role preflight

A role contract states requirements. It cannot claim that a sandbox is enforced
or that a tool exists:

```json
{
  "schema_version": "workkeel.role-contract/v1",
  "role": "implementation",
  "product_access": "write",
  "tests": "coordinator",
  "edit_tools": ["apply_patch"],
  "model": { "provider": "example-provider", "model": "example-model", "effort": "high" },
  "usage": { "fields": ["input_tokens", "output_tokens"] }
}
```

Roles are `planning`, `implementation`, `repair`, `review` and `verification`.
Implementation and repair need write access and an editing tool; the others are
read-only and cannot require one. `tests` is `role`, `coordinator` or `none`, and
must agree with the coordinator's check ownership.

Application code registers the host that answers the probe:

```js
import { createTrustedRoleHost, runRolePreflight } from "./src/workkeel-role-preflight.mjs";

const host = createTrustedRoleHost({ id: "example-host", probe: async role => inspectExampleHost(role) });
const receipt = await runRolePreflight({ role, host,
  context: { approved_tools: ["apply_patch", "shell"], coordinator_checks: ["git", "tests"] } });
```

The probe inspects the actual host and catalogue without starting inference and
returns:

```json
{
  "host": "example-host",
  "enforcement": { "sandbox": "enforced", "product_access": "write", "network": "disabled", "test_scratch": "none" },
  "tools": ["apply_patch", "shell"],
  "models": [{ "provider": "example-provider", "model": "example-model", "efforts": ["high"] }],
  "usage": { "fields": ["input_tokens", "output_tokens"], "unknown": "null" }
}
```

Preflight fails before inference on an unregistered or serialized host, a failed
probe, unproven sandbox or network isolation, mismatched product access, a
read-only role running tests without host-private scratch, a missing or
unapproved editing tool, contradictory test ownership, an unavailable exact model
and effort, missing usage fields, unknown counters not reported as null, unknown
fields, or sparse arrays. The receipt is an observation, not authority.

`createCodexRuntime(host, { coordinatorChecks, role: { contract, host: roleHost } })`
runs the preflight before opening a Codex process and also requires the selected
connection to match the role's model and effort. Without `role`, behavior is
unchanged.

## Interrupted review recovery

Use this when a dispatched independent review stopped before its reviewer
authored a verdict. The task must be in `test` with the delivered candidate and
no review. The original review binding must be closed with status `interrupted`,
`stopped`, `cancelled` or `error`, and no other usage collection may be open.

Inspect the current chain first. This reads only:

```js
const view = await readReviewRecovery("/work/example-project", "WK-example");
```

An approving Principal's Agent then supplies an explicit request:

```json
{
  "schema_version": "workkeel.review-recovery-request/v1",
  "operation_id": "retry-review-1",
  "task_id": "WK-example",
  "expected_version": 3,
  "expected_chain_sha256": null,
  "revision": "<exact delivered full revision>",
  "actor": { "agent_id": "coordinator", "principal_id": "owner" },
  "reviewer": { "agent_id": "reviewer", "principal_id": "owner" },
  "predecessor": { "kind": "host-binding", "id": "<review execution UUID>", "sha256": "<binding.json SHA-256>" },
  "policy_ref": "docs/dispatch.json",
  "model": { "provider": "example-provider", "model": "example-model", "reasoning": "high" },
  "source": { "thread_id": "fresh-thread", "turn_id": "fresh-turn" }
}
```

```js
const host = createTrustedRoleHost({ id: "example-host", probe, runtimeState, launch });
const result = await recoverInterruptedReview("/work/example-project", request, { host });
```

- `probe` runs the read-only review role preflight.
- `runtimeState` must return exactly `{ "state": "stopped" }` for the named
  predecessor. `active`, any other value or an error rejects the request.
- `launch` starts the fresh reviewer with product read-only access and returns
  `status`, `usage`, `runtime_model`, `reasoning` and `output`.

The launch specification contains a frozen execution contract whose
`environment.read_paths` are exactly the original dispatch node's read roots
and whose `environment.write_paths` are empty. Its `dispatch` carries the
original execution ID and the same read-only node. Hosts must enforce these
roots; the broader canonical task contract is unchanged and does not expand
the retry's access. Delivery evidence remains pinned separately.

The request is copied and validated before the first await; later changes to the
caller's object do not affect the reservation, the launch or the replay digest.
The source thread and turn must be fresh across the whole workspace: no retained
host binding of any task and no recovery attempt of any chain may share either
ID, and ordinary host binding rejects sources reserved by recovery attempts.
Both stores form one source inventory guarded by the host-usage writer lock.
Ordinary binding checks and records its source under that lock alone, so a
caller that already holds the project mutation lock, such as execution capture,
can still bind. Recovery takes the same writer lock inside its project-locked
reservation phase (order: project, then host), rechecks both stores and creates
the attempt, then releases it before launch. Concurrent claims on one source
therefore have exactly one winner. Neither lock is held while the model runs.
Pre-probe checks and binding readiness are observations, not reservations.

Ordinary dispatch and recovery also share execution capacity and read/write
conflict checks under that writer lock. A pending recovery consumes one slot
and reserves its original read roots, whether it starts before or after another
dispatch. Disjoint work may run within the policy's parallelism limit. The
checks repeat after host probes, before an attempt is durably reserved.
Result publication uses the same lock, so an admission cannot read a partially
published result.

Valid terminal host results and `not-launched` outcomes release the slot.
Missing results, `launch-unconfirmed`, `invalid-host-result`, task cancellation
and authorization expiry do not prove that a process stopped. Those attempts
keep their reservation. A retry may replace its predecessor's reservation only
after its trusted host confirms that predecessor stopped. Completed historical
records retain their source IDs but do not occupy capacity or require their old
model policy to remain current.

New attempts pin their narrowed `execution_scope` against the original ticket.
An unresolved older attempt without that field keeps the full original task
read scope reserved: the new sandbox restriction cannot retroactively change a
process already launched by the old version. Its host must confirm it stopped
before that broader reservation can be released or replaced.

For an unresolved process that will not be retried, including a cancelled task,
the original approving actor can explicitly record a stop observation:

```js
const stopped = await confirmReviewRecoveryStopped("/work/example-project", {
  operation_id: "confirm-review-stopped",
  task_id: "WK-example",
  attempt_id: "<exact attempt ID>",
  attempt_sha256: "<exact attempt file SHA-256>",
  actor: { agent_id: "coordinator", principal_id: "owner" }
}, { host });
```

The actor must still be a registered approving Principal's Agent. The trusted
host must match the attempt's original host ID and return exactly
`{ state: "stopped" }` for that attempt and source. The API rechecks authority
and exact bytes after the probe. It never launches work or edits the task,
attempt or result; it releases only that process reservation. Identical replay
does not probe again. A changed request or mismatched observation is rejected.
Observations are immutable, Git-ignored records under
`.ai-org/review-recovery-stops/<attempt ID>.json`. Source IDs remain reserved.

Later retries name the chain head: `{ "kind": "review-attempt", "id": ..., "sha256": ... }`
with the current `expected_chain_sha256` from `readReviewRecovery`. A chain holds
at most three attempts.

The result reports `completed`, `failed`, `interrupted` or `not-launched`, and
always `acceptance: "not-performed"`. After `completed`, the named reviewer
records ordinary `task review` with `review_attempt_id`. The review is rejected
for any other attempt, reviewer or revision. The review stores the attempt digest,
the completed result digest and the chain digest; close is rejected if any of
them differs afterwards, including a rewritten, rehashed or deleted result.

## Failure behavior

| Situation | Behavior |
| --- | --- |
| Wrong revision, stale version, stale chain, unknown fields | Rejected; nothing recorded or launched |
| Reviewer equals implementer or approver, or is unregistered | Rejected before any probe |
| Changed policy, pins, evidence or candidate | Rejected; no attempt |
| Different model, policy reference or data scope | Rejected; no fallback |
| Authored PASS or FAIL, `release_gate`, `done`, `cancelled` | Rejected; FAIL uses ordinary rework |
| Predecessor active, unknown, open or already recovered | Rejected; no launch |
| Expiry, cancellation or drift while a probe is awaited | Rejected under the lock; no attempt |
| Expiry or pinned-file drift after reservation, before launch | Attempt recorded as `not-launched`; no launch |
| Same operation ID and input | Returns the recorded attempt; no second launch |
| Same operation ID with other input, racing retries | One winner; others rejected |
| Result after supersession or cancellation | Not recorded; attempt stays `unrecorded` |
| Fourth attempt | Rejected; preserve evidence and obtain a new decision |
| Attempt or result with unknown fields, invalid status or negative measurements | Chain read rejected, even with a matching envelope digest |
| Reused thread or turn from any binding or recovery attempt | Rejected; nothing recorded or launched |
| Shared execution limit reached or conflicting active scope | Rejected before launch; recovery and ordinary dispatch use the same gate |
| Unknown runtime or cancelled task without a terminal result | Capacity remains reserved until explicit trusted stop confirmation |
| Blank, multi-line or malformed reported model or effort | Recorded as `interrupted` with `invalid-host-result` and unknown usage; retry remains possible |
| Completed result whose model or effort differs from the pinned selection | Chain read, review and close rejected, even when rehashed |
| Attempt selection, policy reference or dispatch identity rewritten together with its result | Chain read, review and close rejected, even when both are rehashed |
| Result changed, rehashed or removed after the authored review | Close rejected |

Records live under `.ai-org/review-recovery/<task>/<delivery claim>/` as
`attempt-NNN.json` and `attempt-NNN-result.json`, created exclusively and never
rewritten. The store is Git-ignored. Original binding and attempt bytes are
preserved and are rechecked whenever the chain is read. Envelope digests detect
changed bytes only; every persisted field is also validated against its schema
and the current delivery. An attempt's own fields never grant authority: the
first attempt's dispatch identity must equal the one recorded in its pinned
predecessor binding, later attempts must keep that same identity, and each
attempt's policy reference, provider, model and effort must equal the validated
approved review dispatch ticket. Another valid ticket cannot be substituted.
`readReviewRecovery`, replay checks and record creation
all run under the project mutation lock, so a reader never observes a record
while it is still being published.

## Trust limitations

The checks are only as strong as the registered host code. Workkeel cannot verify
that a probe tells the truth, and a receipt describes one instant. Known usage is
recorded and unknown counters stay null; complete future token reports are not
promised. Recovery is local to one workspace and does not support distributed
identity or high-risk workflows.
