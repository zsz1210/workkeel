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

Qualification waits do not extend authority: the original standing goal and
component authority are checked again before effects start, and an already-aborted
stop signal prevents dispatch. A persisted intent known not to have started can
resume with the same operation identity and reserved budget after revalidation.
Its original no-effects result remains retained. This does not make an uncertain
started operation safe to execute again.

The stock Codex path carries that check through its qualification and initialization
waits to the actual `turn/start` boundary. A trusted application-only runtime guard
rechecks current goal control, ownership, source/model policy and task authority;
task JSON cannot supply a callback or grant authority. A stop before any model
request resumes only when owned runtime cleanup is confirmed. Its prior thread and
no-model stop proof are retained; uncertain cleanup remains reconciliation work.
The bounded per-operation stop history holds at most 32 entries and is never pruned.

Requests for `goal pause|resume|cancel|recover` contain `goal_id`, original approved
operator `actor`, stable `operation_id` and current `expected_version`. Pause and
cancel remain usable after execution authority drifts or expires. Resume/recovery
revalidate authority. Confirmed cancellation requires actual operation and native
task quiescence; unknown effects require reconciliation.

If a fixed model or another required capability is unavailable, the workspace
overview identifies the affected goal as needing recovery. Open that goal, inspect
the recorded reason, restore the required capability or authority, then reconcile
and recover. Automatic dependency waits and deliberately paused goals do not
create recovery decisions.

Confirmed recovery clears the resolved aggregate error. Successful component work
updates the aggregate from remaining component problems, so another repository's
unresolved problem remains visible.

## Qualified stock host

The stock adapter uses Codex app-server with actual model/effort catalogue and
thread/turn confirmation, exact filesystem permissions, disabled network and
provider-default service. Its model provider is `openai`; its tool is Codex. There
is no silent model fallback. The desktop policy catalogue's `codex` provider names
the host and maps to `openai` only on this explicit subscription path; model,
reasoning, service, risk and data constraints remain unchanged. Component tasks must authorize
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

## Browser verification for UI work

The stock macOS host supports `command:"browser"` with one `.mjs` check path.
Pin that exact script as component approval evidence before intake. Both component
and controller must authorize the `browser` and `node` tools, allowlist
`127.0.0.1`, and authorize the `network` operation. Google Chrome must already be
installed at its standard application path. Model turns still have no network
access and do not gain browser tools.

If the application needs subprocesses (for example, a native Git-backed server),
start its preview separately under its approved application host. Pass a second
check argument naming a component-authority-pinned JSON file containing exactly
`{"origin":"http://127.0.0.1:4310"}` with the actual preview port. The check then
receives `WORKKEEL_CHECK_ORIGIN`; only that preview port and the coordinator's
browser control port are reachable. Workkeel does not stop a separately owned
preview. Its operator remains responsible for the preview's scope, lifetime and
candidate identity. The check receives `WORKKEEL_CHECK_CANDIDATE` to compare with
the application's version evidence. No remote origin or credential-bearing URL
is accepted.

The coordinator starts and owns Chrome. The approved check connects to
`process.env.WORKKEEL_BROWSER_URL` using CDP; for an already installed Playwright
Core, use `chromium.connectOverCDP(...)`. Serve the actual application on
`127.0.0.1` and `Number(process.env.WORKKEEL_CHECK_PORT)`. The check must start its
preview in-process: its OS sandbox denies child processes, including detached
ones. Product writes and connections to other ports are denied. Scratch belongs
under `process.env.TMPDIR`; save screenshots in `WORKKEEL_CHECK_OUTPUT`.

Keep one to sixteen named PNG files, at most 1 MiB each and 8 MiB total. Supported
screenshots are non-interlaced eight-bit RGB/RGBA, at most 16 million pixels and
10,000 pixels in either dimension. Invalid or missing screenshots fail the check.
The coordinator retains their exact hashes and dimensions with the committed
candidate, then removes browser scratch. The separate reviewer must inspect the
actual images. A screenshot or green script alone cannot accept the UI.

Cancellation settles the check process and owned browser before confirmation.
The same subprocess restriction applies to stock Node checks. Checks requiring a
different runtime, subprocess tools or external network need a separately
qualified host; there is no unrestricted fallback.
