# Workkeel quick start

Workkeel is a repository-native task coordination framework for coding agents.
Your existing coding agent executes the work. The repository retains the approved
task, identities, boundaries, handoff and acceptance. Optional executable workflows
add explicit model routing and recoverable steps; start with the task lifecycle below.

## Availability and compatibility

Use Node.js 24 or newer. This checkout provides `node bin/workkeel.mjs`.
The new npm name is not a publication claim: do not assume a Workkeel package has
been released. Existing projects keep `temple`, `templew.mjs`, `temple.lock` and
their original workflows; `workkeel legacy <arguments>` is an explicit alias.

Task-first v1 supports ordinary low/standard-risk work. High/critical-risk,
sensitive-data and verified/distributed identity workflows retain legacy mode.
The optional Console and legacy provider are not required for task coordination.

## Initialize an existing repository

Start with read-only guidance from your reviewed source checkout:

```sh
node /path/to/workkeel/bin/workkeel.mjs start /path/to/your/project
```

The JSON response identifies the next setup stage: Git root, project policy,
instruction bridge, or task brief. `drafts.policy` and `drafts.brief` provide the
structure to fill in; nulls and empty required fields are unresolved decisions,
not defaults or approval. Ask your coding agent to fill them from your agreed
goal and boundaries and save the reviewed document. Existing identities are
listed as choices, never selected automatically. `next_command` is an argv array
for the reviewed Workkeel CLI, run from the selected project; it is not shell text.

Follow the returned step, then run `start` again. Initialization and instruction
application remain explicit. For an existing legacy project it points back to
the pinned legacy workflow. Broken project pins or conflicting instruction blocks
return an error without overwriting anything. This checks setup and intake inputs;
use `doctor` separately for existing task health.

Once the bridge is applied and the approved brief is saved:

```sh
node /path/to/workkeel/bin/workkeel.mjs start /path/to/your/project --request brief.json
```

Inspect `intake_preview` and use its exact fingerprint with the returned
`intake apply` arguments. `ready: true` means a preview was produced. It does not
claim work, launch a model or accept a task. Continue through the lifecycle below;
open `workkeel monitor .` when you want to inspect recorded progress and results.
An invalid brief returns exit code 1 with `mutation_status: no-write`; a valid
guidance step returns exit code 0 even when there is more setup to do.

Read native repository instructions and confirm identities, approval authority and
review separation with the human. Save the reviewed policy as `task-policy.json`:

```json
{
  "schema_version": "workkeel.task-policy/v1",
  "principals": ["owner"],
  "agents": [
    {"agent_id": "builder", "principal_id": "owner"},
    {"agent_id": "reviewer", "principal_id": "owner"}
  ],
  "approvers": ["owner"],
  "review_separation": "distinct-agent"
}
```

Identities are attributed, not authenticated accounts. A distinct Agent is not an
independent human. Select `distinct-principal` only with genuinely separate people
registered as Principals when that separation is required.

```sh
node /path/to/workkeel/bin/workkeel.mjs init . --policy task-policy.json
WORKKEEL_CLI_PATH=/path/to/workkeel/bin/workkeel.mjs node ./workkeelw.mjs doctor .
```

Init creates `workkeel.lock`, `workkeelw.mjs` and `WORKKEEL.md`, refusing existing
framework files. It preserves native instructions. Preview and apply the additive
[AGENTS/CLAUDE bridge](../extensions/workkeel-context.md#connect-native-instructions)
so the coding agent can discover Workkeel. The source override is version-checked.
The launcher uses a matching local package when present; it never silently fetches
an unpublished package. Network package fetching requires the explicit
`WORKKEEL_ALLOW_PACKAGE_FETCH=1` opt-in and an actually published pinned version.
Commit policy, guidance and baseline product files before claiming work.

Below, `workkeel` means the installed command or
`node /path/to/workkeel/bin/workkeel.mjs` from the reviewed source checkout.

## Approve a task

For daily work, the [single-brief entry](../operations/workkeel-daily-work.md)
previews and creates this same contract without repeating its lifecycle fields.
The full form below remains available for explicit integration.

Write the human-approved work order and data policy to `docs/work-order.md`. Save
this complete example as `task-contract.json`, adjusting its real boundaries:

```json
{
  "schema_version": "workkeel.task-contract/v1",
  "id": "WK-cart-total",
  "goal": "Correct cart totals",
  "scope": {"include": ["Cart calculation"], "exclude": ["Deployment"]},
  "actor": {"agent_id": "builder", "principal_id": "owner"},
  "state": "intake", "dependencies": [],
  "acceptance": {"criteria": ["Totals round to exact cents"], "evidence": []},
  "verification": {
    "risk_tier": "standard", "separation": "distinct-agent",
    "implementer": null, "reviewer": null, "candidate_revision": null
  },
  "handoff": null,
  "environment": {
    "cwd": ".", "read_paths": ["src", "test"], "write_paths": ["src", "test"],
    "tools": ["node"], "resources": [],
    "network": {"mode": "none", "hosts": []}, "external_actions": [],
    "data": {"classification": "internal", "model_access": "none", "policy_refs": ["docs/work-order.md"]}
  },
  "authorization": {
    "approved_by": "owner", "approval_ref": "docs/work-order.md",
    "operations": ["read", "write", "execute"], "expires_at": null
  },
  "skills": [],
  "execution": {
    "runtime": {"kind": "host-owned", "adapter_id": null, "required_features": []},
    "model_connection": {"kind": "native"}
  },
  "legacy": null
}
```

Paths are repository-relative, without traversal or globs. `.` explicitly grants
an entire declared root; it is not inferred. `tools` and `resources` are actual
environment requirements. `skills` holds project-specific instructions when needed,
not a list of things a generally capable model should know.

The example permits no model access to task data. If the existing host sends that
data to a model, explicitly approve `approved-connection` and the actual host's
data/network handling before work. A native connection is not automatically local
or private. Workkeel does not grant or enforce the host's tool/network sandbox.

Put transient requests and evidence under `.ai-org/artifacts/WK-cart-total/`.
Creation request `create.json`:

```json
{
  "operation_id": "create-cart-v1", "expected_version": 0,
  "actor": {"agent_id": "builder", "principal_id": "owner"}
}
```

```sh
workkeel task create . --source task-contract.json --request .ai-org/artifacts/WK-cart-total/create.json
workkeel task show . --id WK-cart-total
```

The approved contract stays immutable. Current state, claim, delivery, review and
closure are separate fields in the canonical record. Approval, data-policy and
Skill references are digest-bound. Changing them requires a newly approved task,
not editing the accepted contract in place.

Administrative reports/requests must not be runtime product inputs. Only exact
known report paths and digest-matching operation JSON are exempt as newly added
metadata; arbitrary code in an artifact folder is still product code. A tracked
candidate artifact cannot change after verification. The task record itself is
coordination state, never a mutable application configuration source.

## Claim, deliver, review, accept

Every request includes a fresh `operation_id`, the last observed
`expected_version`, and its actual `actor`. Retry an uncertain write only after
reading its operation history. Same-ID identical requests are recognizable;
changing parameters under that ID is rejected. No claim is silently stolen.

| Action | Additional request fields | Guard / result |
| --- | --- | --- |
| `claim` | `base_revision` (full current commit) | Approved Agent; accepted dependencies; no overlapping active write roots; returns `claim.id` |
| `release` | `claim_id`, `summary` | Owner returns work to intake, without acceptance |
| `handoff` | `claim_id`, `revision`, `summary`, `evidence` (paths), `unresolved: []` | Exact current commit descends from base; changed paths fit write roots; no tracked or untracked product drift |
| `review` | `revision`, `judgment: "pass"` or `"fail"`, `summary`, `evidence` | Distinct reviewer; exact delivered candidate and unchanged evidence |
| `rework` | `summary` | Approver; retain failure, same contract, new candidate and review |
| `close` | `revision`, `summary`, `rollback`, `evidence` | Approver; independent pass; local acceptance only |
| `cancel` | `summary`, `evidence` | Approver; preserve history, grant no further work |

For example, after creation returns version 1, prepare `claim.json`:

```json
{
  "operation_id": "claim-cart-v1", "expected_version": 1,
  "actor": {"agent_id": "builder", "principal_id": "owner"},
  "base_revision": "<full-current-git-commit>"
}
```

```sh
workkeel task claim . --id WK-cart-total --request .ai-org/artifacts/WK-cart-total/claim.json
```

Implement within the approved roots, commit the product change and run the
project's checks on that exact commit. Record real results in
`.ai-org/artifacts/WK-cart-total/developer.md`; do not copy a passing assertion
without running its check. Save `handoff.json` using the returned claim ID:

```json
{
  "operation_id": "handoff-cart-v1", "expected_version": 2,
  "actor": {"agent_id": "builder", "principal_id": "owner"},
  "claim_id": "<returned-claim-id>", "revision": "<full-tested-git-commit>",
  "summary": "Implemented the approved fix; see measured checks",
  "evidence": [".ai-org/artifacts/WK-cart-total/developer.md"],
  "unresolved": []
}
```

```sh
workkeel task handoff . --id WK-cart-total --request .ai-org/artifacts/WK-cart-total/handoff.json
```

The distinct reviewer inspects that candidate and records their own judgment in
`review.md`. Only after a passing review, their `review.json` may be:

```json
{
  "operation_id": "review-cart-v1", "expected_version": 3,
  "actor": {"agent_id": "reviewer", "principal_id": "owner"},
  "revision": "<same-full-tested-git-commit>", "judgment": "pass",
  "summary": "Acceptance checked against this exact candidate",
  "evidence": [".ai-org/artifacts/WK-cart-total/review.md"]
}
```

```sh
workkeel task review . --id WK-cart-total --request .ai-org/artifacts/WK-cart-total/review.json
```

The registered approver then records local acceptance in `close.json`. Do not use
the reviewer's identity for work they did not perform. This single-owner example
separates Agents, not humans; approval must still come from the actual owner.

```json
{
  "operation_id": "close-cart-v1", "expected_version": 4,
  "actor": {"agent_id": "builder", "principal_id": "owner"},
  "revision": "<same-full-tested-git-commit>",
  "summary": "Owner accepts the independently reviewed scope",
  "rollback": "Revert the candidate through a new reviewed change",
  "evidence": [".ai-org/artifacts/WK-cart-total/review.md"]
}
```

```sh
workkeel task close . --id WK-cart-total --request .ai-org/artifacts/WK-cart-total/close.json
workkeel status .
workkeel doctor .
```

These versions assume no intervening operations. Inspect `task show` before each
request; do not advance a stale version blindly. A failed review uses `rework`,
retaining its evidence, followed by a fresh claim/candidate/review. Acceptance
does not publish, deploy or merge a pull request.

Run the project's actual required checks and record the exact tested candidate.
The framework verifies bindings and lifecycle guards, not whether prose in an
evidence report is true. Input, policy, evidence and task records are bounded to
1 MiB each. Keep concise reports and preserve larger logs separately. Create a
successor task instead of deleting history to fit the limit.

## Optional runtime and model connection

The runtime owns tools, approvals, execution, cancellation and result reporting.
The model connection selects inference transport. Native mode needs no custom
provider or manually maintained model capability catalogue.

A fixed optional gateway uses runtime `kind: "adapter"` and
`adapter_id: "codex-app-server"`; its model connection uses `kind: "gateway"`,
`provider: "litellm"`, an HTTPS (or loopback HTTP) `base_url`, the approved `model`
alias, `selection: "fixed"`, and `credential_env: "LITELLM_API_KEY"`. Approve the
gateway hostname, network operation and data's `approved-connection`. Never store
API keys in the contract, URL or repository.

```sh
workkeel runtime plan . --id WK-cart-total
```

This produces separate `thread/start` and `thread/resume` model overrides for the
existing Codex App Server transport. It does not launch a runtime, read keys, edit
global configuration or prove live compatibility. Preserve the same connection
fingerprint on resume; no silent provider fallback. A fixed requested alias does
not prove the server disabled its own fallback/routing.

For automatic execution, follow [executable workflows](../operations/workkeel-workflows.md).
The qualified local Codex subscription host uses explicit models, read/write
permission profiles and disabled tool networking. It does not require a gateway
or an additional API key. Narrower unsupported conditions still block execution.
Live LiteLLM behavior remains unverified until a real service and explicit test
authority are supplied. Runtime completion never equals task acceptance.

## Legacy history and migration

Continue the original pinned launcher by default. Legacy `work-item contract`
provides a read-only projection; missing authority stays missing. Do not globally
replace old schema IDs, evidence URLs or historical names.

Explicit migration supports only quiescent, attributed Solo projects without
configured team governance, active work or High-Assurance history. Core policies
must match this release's unmodified legacy policy; custom/older policies require
a separately reviewed migration:

```sh
workkeel migration preview . --policy task-policy.json
workkeel migration apply . --policy task-policy.json --fingerprint <reviewed-sha256>
```

For explicitly authorized retirement of an old workflow, inactive unfinished
items can remain unfinished, read-only history. Save a retention request:

```json
{
  "schema_version": "workkeel.legacy-retention/v1",
  "approved_by": "owner",
  "approval_ref": "docs/migration-approval.md",
  "open_work_items": [
    {"id": "WI-0001", "sha256": "<sha256-of-exact-source-record>"}
  ]
}
```

Pass `--retain-open retention.json` to both migration preview and apply. The
request must name every unfinished item exactly; its approval and original record
digests are bound by the preview. Active claims, running workers, configured team
governance, High-Assurance history and changed core policies remain unsupported.
This does not close an item or accept its candidate. Create a separately approved
native task to continue work, referencing the retained evidence.

The event journal is hashed incrementally with a fixed 64 KiB buffer and an 8 MiB
archive ceiling. Authority JSON and individual task inputs retain their 1 MiB
bound. Doctor rechecks the frozen journal and retained records after migration.

The preview binds legacy policy, events, tasks and the proposed policy. Apply
rechecks that fingerprint, adds new files and preserves old ones byte-for-byte.
Status marks old records `legacy-read-only`; their terminal labels are not native
dependency grants. Review native/AGENTS instructions with the maintainer when
switching; init never rewrites user guidance. Old lifecycle writers reject the
new mode when invoked from this release. Previously installed old binaries cannot
know this new marker and must not be used after opting in. Active-runtime, team and verified-identity migrations stay unsupported
rather than dropping safeguards. Inputs over the bounded size also fail closed.

Do not remove the new lock to roll back a populated project. Preserve versioned
records and revert code through normal review. Locks coordinate this checkout,
not all machines; cross-machine reconciliation is a separate workflow.
