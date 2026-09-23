# Workkeel task-first quick start

Workkeel is a repository-native task coordination framework for coding agents.
Your existing coding agent executes the work. The repository retains the approved
task, identities, boundaries, handoff and acceptance. No company Positions or
generic AI skill catalogue is required in task-first mode.

## Availability and compatibility

Use Node.js 24 or newer. This checkout provides `node bin/workkeel.mjs`.
The new npm name is not a publication claim: do not assume a Workkeel package has
been released. Existing projects keep `temple`, `templew.mjs`, `temple.lock` and
their original workflows; `workkeel legacy <arguments>` is an explicit alias.

Task-first v1 supports ordinary low/standard-risk work. High/critical-risk,
sensitive-data and verified/distributed identity workflows retain legacy mode.
The optional Console and legacy provider are not required for task coordination.

## Initialize an existing repository

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
framework files. It preserves `AGENTS.md`; read `WORKKEEL.md` alongside native
instructions. The source override above is version-checked and avoids depending
on an unpublished package. Once released, the launcher uses its pinned package.
Commit policy, guidance and baseline product files before claiming work.

Below, `workkeel` means the installed command or
`node /path/to/workkeel/bin/workkeel.mjs` from the reviewed source checkout.

## Approve a task

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
workkeel task handoff . --id WK-cart-total --request .ai-org/artifacts/WK-cart-total/handoff.json
workkeel task review . --id WK-cart-total --request .ai-org/artifacts/WK-cart-total/review.json
workkeel task close . --id WK-cart-total --request .ai-org/artifacts/WK-cart-total/close.json
workkeel status .
workkeel doctor .
```

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

The existing provider cannot enforce every narrower filesystem root or hostname
allowlist. Automatic task-first dispatch is therefore not enabled. The host must
enforce actual boundaries. Live LiteLLM tools, model alias, routing and results
remain unverified until a real service and explicit test authority are supplied.
Runtime completion never equals task acceptance.

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

The preview binds legacy policy, events, tasks and the proposed policy. Apply
rechecks that fingerprint, adds new files and preserves old ones byte-for-byte.
Status marks old records `legacy-read-only`; their terminal labels are not native
dependency grants. Review native/AGENTS instructions with the maintainer when
switching; init never rewrites user guidance. Old lifecycle writers reject the
new mode when invoked from this release. Previously installed old binaries cannot
know this new marker and must not be used after opting in. Larger, active, team and verified-identity migrations stay unsupported
rather than dropping safeguards. Inputs over the bounded size also fail closed.

Do not remove the new lock to roll back a populated project. Preserve versioned
records and revert code through normal review. Locks coordinate this checkout,
not all machines; cross-machine reconciliation is a separate workflow.
