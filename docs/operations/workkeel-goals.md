# Deliver an approved whole goal

A native goal coordinates an immutable set of mandatory tasks. It continues
planning, implementation, verification, distinct review and bounded repair until
the exact combination is accepted or a real authority, host or resource limit
blocks it. Finishing a model turn does not finish the goal.

## Approve the scope once

Register each repository as a native project with its own approval, registered
actors, task contract and model/data/tool permissions. Prepare the component tasks
before the controller: their contract digests are inputs to the goal manifest.
Workspace registration grants observation, not permission to execute a repository.

The private `workkeel.goal/v1` manifest has these required fields:

| Field | Meaning |
| --- | --- |
| `id`, `title` | Stable identity and intended result |
| `approval_ref`, `approved_by`, `expires_at` | Exact approval file, actor object and expiry or explicit null |
| `components` | Every mandatory component: ID, project/repo IDs, canonical absolute Git root, task ID/digest, dependencies, checks, rollback and interface references |
| `integration` | Integration component and criteria; it depends on every other mandatory component |
| `roles` | Registered implementer, distinct reviewer and authorized approver actor objects |
| `models` | Approved provider/model/reasoning/service tuple for planning, implementation, verification, repair and review |
| `limits` | Maximum operations, reworks, total reserved time and financial ceiling or null; optional per-operation timeout |
| `control` | Explicit `release_parent` policy for the controller's original claim |

Checks are `{id,command,args}` with approved explicit tool names. Integration cannot
select a convenient subset. Dependencies cannot form a cycle. Project boundaries
do not remove claim conflicts on the same underlying repository.

Pin the manifest and approval as the controller's data policy references before
intake. Claim that controller through the native lifecycle. Give it explicit goal
metadata write scope, approved check tools and the source read scope it needs. A
broad controller claim must be deliberately released before component claims can
acquire those same paths. The sealed goal retains its approved authority after
release; it cannot change the contract, manifest or permissions.

Register using the controller's actual returned claim and contract:

```json
{
  "task_id":"WK-controller",
  "actor":{"agent_id":"builder","principal_id":"owner"},
  "claim_id":"actual-returned-claim",
  "contract_sha256":"actual-controller-contract-digest",
  "operation_id":"register-approved-goal",
  "expected_version":0,
  "manifest_ref":"docs/approved-goal.json"
}
```

These identifiers describe a shape, not runnable maintainer data. Keep actual
manifests, approvals, tasks and reports in your private project.

```sh
workkeel goal create /private/project --request docs/register-goal.json
workkeel goal show /private/project --id approved-goal
workkeel goal tick /private/project --id approved-goal
workkeel goal serve /private/project --id approved-goal
```

`tick` performs one eligible step. `serve` watches local changes and reconciles
missed events without idle inference. It runs in the foreground; stop with Ctrl-C.
Closing a browser tab leaves its host running. Stopping the workspace host stops
services it owns; a separately started CLI service has its own lifetime. The UI
only confirms services it actually owns.

## Review and completion

The implementer may reuse one actual thread across compatible activities. Review
uses a different registered identity and actual thread with read-only product
access. The authored native request is preserved and relayed unchanged; the
controller never manufactures a judgment. A FAIL remains attached to its rejected
candidate. Rework produces a fresh candidate, checks and another distinct review.

Whole acceptance binds all mandatory task versions, candidates, review/evidence
pins, current interface bytes and the exact integration proof. Changed interfaces
or approval sources make current acceptance stale without erasing its historical
decision. Acceptance, merge, publication and deployment remain separate outcomes.
An uncertain host result is reconciled by exact operation identity, never blindly
dispatched again after a crash or lease timeout.

Requests for `goal pause|resume|cancel|recover` contain `goal_id`, original approved
operator `actor`, stable `operation_id` and current `expected_version`. Pause and
cancel remain usable after execution authority drifts or expires. Resume/recovery
revalidate authority. Confirmed cancellation requires actual operation and native
task quiescence; unknown effects require reconciliation.

## Qualified stock host

The stock adapter uses Codex app-server with actual model/effort catalogue and
thread/turn confirmation, exact filesystem permissions, disabled network and
provider-default service. Its model provider is `openai`; its tool is Codex. There
is no provider alias or silent fallback. Component tasks must authorize
`codex-app-server` and `approved-connection`; fixed implementation connections must
match the manifest. A fixed component connection constrains every inference role.
To authorize different planning/review models, use a `kind:"policy"` connection and pin its execution
model allowlist before component intake. Every goal role must remain inside its
original data/risk allowlist; the goal cannot broaden it. Unsupported hosts block
before inference.

Stock checkpoint/check execution currently requires the qualified macOS command
sandbox and approved Node/Git tools. It stages only approved source paths, disables
hooks/network helpers and protects private runtime state. There is no unsandboxed
fallback. Local checks report actual zero model tokens; unreported inference usage
stays null. Subscription financial cost is unavailable: explicit
`max_cost_usd:null` uses enforceable operation/time bounds without a monetary
ceiling. Finite ceilings require a qualified enforcing host and are rejected by
the stock subscription adapter before inference. This does not mean free execution.

The controller records observed adapter start/end and wall duration separately
from provider usage. This includes tool/host waiting and is not model compute
time. Crash gaps stay unknown; later reconciliation does not replace or double
count the original execution measurement.

[Model policies](../getting-started/model-routing.md) resolve settings before dispatch. The
goal manifest freezes its approved phase selections. Saving a project default
cannot rewrite this manifest or an in-flight turn; changed selections require a
newly approved goal. Auto/fixed dimensions retain provider-specific meaning and
must satisfy task, risk, data and host boundaries.

See [bounded improvement](workkeel-autonomy.md) and
[workspace operations](workkeel-workspace.md).
