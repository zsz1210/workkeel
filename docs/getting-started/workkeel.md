# Workkeel quick start

Workkeel is a repository-native task coordination framework for coding agents.
Your existing coding agent executes the work. The repository retains the approved
task, identities, boundaries, handoff and acceptance. Optional executable workflows
add explicit model routing and recoverable steps; start with the task lifecycle below.

This guide installs Workkeel in a project that will use it. To develop the
Workkeel framework itself, use the
[separate private development workspace](../operations/framework-development.md).
Do not run task initialization in the public framework source checkout.

## Availability and compatibility

Use Node.js 24.15 or newer. npm's `latest` dist-tag is `1.1.0`: install
`@zsz1210/workkeel` or `@zsz1210/workkeel@latest`. The `next` dist-tag still
points to the old `0.1.0-beta.1` [beta line](../../CHANGELOG.md#010-beta1);
do not install `@next` for the current release. You can also run the current source
as in the [README quick start](../../README.md#quick-start). Installed projects can
use `npx --no-install workkeel`; a reviewed source checkout provides
`node bin/workkeel.mjs`. Examples below using a source path remain the source
alternative. Version 0.2 removed the earlier Temple mode; Temple projects pinned
to an older CLI keep that version, and there is no migration path for their records.

`workkeel.lock` pins a CLI version. A CLI with the same major version that is not
older than the pin works normally. With any other CLI, read commands such as
`status` and `doctor` still run and print a warning on stderr. Commands that
write stop. Run `workkeel upgrade [target] [--actor id]` with the newer CLI to
move the pin to it and rewrite `workkeelw.mjs`. An approving Principal runs it.
It never downgrades the pin or converts task records.

Unknown top-level lock keys are ignored with a warning. They are kept when
`policy update` or `upgrade` rewrites the lock. Unknown task request fields are
ignored with a warning and never stored. Task policy and execution documents stay
strict. `schema_version` decides major compatibility. The compatibility check runs
before the mutation lock is taken. An upgrade running at the same moment as another
write may therefore not stop that write.

Native projects pinned to `0.2.0-beta.0` can use the `1.0.0` source CLI for reads
with a compatibility warning. Run `workkeel upgrade` with that CLI and an
approving Principal to enable mutations; task records are not converted.

Tasks carry a low, standard, high or critical risk tier. Project policy
`risk_paths` and sensitive data set a minimum tier, and high or critical work
adds review by another model family and close by the approving Principal.
Verified or distributed identity workflows are not supported.

## Fastest path: flags only

Task work requires a baseline Git commit. In an unborn repository, review the
files, then run `git add -A && git commit -m baseline` before claiming a task.

`init` registers one Principal, `owner`, with two Agents, `builder` and
`reviewer`; the implementer and reviewer still differ. Commit the
generated files and ignore `.workkeel/`, where `local.json` may name your default
`agent_id`:

```sh
workkeel init .
echo ".workkeel/" >> .gitignore && git add -A && git commit -m "Start Workkeel"
workkeel task new --goal "Clarify the guide" --acceptance "The guide names its audience" --write docs --actor builder
workkeel task claim --id WK-0001 --actor builder
# edit, commit, and save evidence under .ai-org/artifacts/WK-0001/
workkeel task handoff --id WK-0001 --actor builder --summary "Guide updated" --evidence .ai-org/artifacts/WK-0001/check.md
workkeel task review --id WK-0001 --actor reviewer --judgment pass --summary "Meets the criterion" --evidence .ai-org/artifacts/WK-0001/review-r1.md
workkeel task close --id WK-0001 --actor builder --summary Accepted --rollback "Revert the guide commit" --evidence .ai-org/artifacts/WK-0001/review-r1.md
```

Commit the `.ai-org/` task records too, with your work or after closing the task.
Work on one task at a time per branch or worktree: a handoff includes all changes since the claim, so interleaving commits from different tasks on one branch blocks handoff; use separate branches or worktrees.

`task new` needs only a goal and acceptance criteria. Unstated fields get recorded
defaults: the repository root as read and write path, no network, native
execution, and the lowest risk tier the write paths and data allow. Critical work also
needs `--approval path` to a committed approval record. Operation IDs and
expected versions are derived, and rerunning a command that already succeeded
replays it. Replay uses the exact requests this checkout saved under its Git
directory (`.git/workkeel/cli-operations/`); a fresh clone or another machine
does not have them. An identical `task new` always returns its first task, so use
different arguments or `--id` for another.

Known limitation: flag-command replay relies only on that local cache. When several
processes, or older and newer CLI versions, operate on the same task at the same
time, edge cases remain; a command that cannot confirm its original claim or
candidate stops instead of guessing. Hardening this is tracked separately. `--expect` and `--request` remain for
integrations. The default `init` policy records the `builder` Agent as model family
`claude` and the `reviewer` as `codex`; override these defaults with `--builder <family>` and `--reviewer <family>`.
To register other people or Agents, initialize with a reviewed policy file,
`init --policy task-policy.json`; `policy update` replaces the project policy
later. The same rules apply however many Principals it lists. `workkeel help advanced` lists every form, including the optional
subsystems that the lifecycle below never needs.

## Initialize an existing repository

Start with read-only guidance from your reviewed source checkout:

```sh
node /path/to/workkeel/bin/workkeel.mjs start /path/to/your/project
```

The JSON response identifies the next setup stage: Git root, `init`,
instruction bridge, or the first task. Before initialization it points to
`workkeel init .`; afterwards it points to `task new`, whose `<...>` values you
replace with the agreed goal, acceptance criteria and actor. Existing identities
are listed as choices, never selected automatically. `next_command` is an argv
array for the reviewed Workkeel CLI, run from the selected project; it is not
shell text.

Follow the returned step, then run `start` again. Initialization and instruction
application remain explicit. Broken project pins or conflicting instruction blocks
return an error without overwriting anything. This checks setup and intake inputs;
use `doctor` separately for existing task health.

An integration that already has an approved
[single brief](../operations/workkeel-daily-work.md) can preview it instead:

```sh
node /path/to/workkeel/bin/workkeel.mjs start /path/to/your/project --request brief.json
```

Inspect `intake_preview` and use its exact fingerprint with the returned
`intake apply` arguments. `ready: true` means a preview was produced. It does not
claim work, launch a model or accept a task. Continue through the lifecycle below;
the optional `workkeel monitor .` observer shows recorded progress and results.
An invalid brief returns exit code 1 with `mutation_status: no-write`; a valid
guidance step returns exit code 0 even when there is more setup to do.

Read native repository instructions and confirm identities, approval authority and
review separation with the human. Plain `init .` writes this policy; to use a
different one, save the reviewed policy as `task-policy.json`:

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
node /path/to/workkeel/bin/workkeel.mjs init .    # or: init . --policy task-policy.json
WORKKEEL_CLI_PATH=/path/to/workkeel/bin/workkeel.mjs node ./workkeelw.mjs doctor .
```

Init creates `workkeel.lock`, `workkeelw.mjs` and `WORKKEEL.md`, refusing existing
framework files. It preserves native instructions. Preview and apply the additive
[AGENTS/CLAUDE bridge](../extensions/workkeel-context.md#connect-native-instructions)
so the coding agent can discover Workkeel. The source override must report a version,
and the CLI checks it against the pin.
The launcher uses a matching local package when present; it never silently fetches
an unpublished package. Network package fetching requires the explicit
`WORKKEEL_ALLOW_PACKAGE_FETCH=1` opt-in and an actually published pinned version.
Prepare the approved policy, guidance and baseline product commit before claiming
work. Follow the target project's data policy when deciding what to commit.
Workkeel framework development keeps all actual task policy and evidence in its
private workspace, outside the public source checkout and public Git history.

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
  "schema_version": "workkeel.task-contract/v2",
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
  }
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
closure are separate fields in the canonical record. Approval is the registered
approving Principal plus the commit it was given at (`approval.approved_at_revision`).
Editing the approval, data-policy or Skill files afterwards does not invalidate an
active task, and Doctor does not recheck them; read the approved text with
`git show <approved_at_revision>:<path>` when it was committed. Changing the
contract itself still requires a newly approved task.

Everything under `.ai-org/` is administrative: task records, reports and requests
never count as product changes or drift. Do not keep runtime product inputs
there. The task record itself is coordination state, never a mutable application
configuration source.

## Claim, deliver, review, accept

Every request includes a fresh `operation_id`, the last observed
`expected_version`, and its actual `actor`. Retry an uncertain write only after
reading its operation history. Same-ID identical requests are recognizable;
changing parameters under that ID is rejected. No claim is silently stolen.

| Action | Additional request fields | Guard / result |
| --- | --- | --- |
| `claim` | `base_revision` (current commit; full or abbreviated ID), optional `pre_claim: true` | Approved Agent; accepted dependencies; no overlapping active write roots; returns `claim.id` |
| `release` | `claim_id`, `summary` | Owner returns work to intake, without acceptance |
| `handoff` | `claim_id`, `revision`, `summary`, `evidence` (paths), `unresolved` (notes) | Current commit descends from base; committed changes fit write roots; no tracked or untracked drift inside the write roots |
| `review` | `revision`, `judgment: "pass"` or `"fail"`, `summary`, `evidence` | Distinct reviewer; exact delivered candidate |
| `rework` | `summary`, optional `mode` | Approver; retain failure, same contract; every rework delivers a new commit for a fresh review |
| `close` | `revision`, `summary`, `rollback`, `evidence` | Approver; independent pass; local acceptance only |
| `cancel` | `summary`, `evidence` | Approver; preserve history, grant no further work |

Revisions may be full or abbreviated commit IDs; the record always stores the
full ID. Evidence is a list of paths, recorded without digests: a path committed
in the candidate, which Git keeps immutable, or a report under `.ai-org/`. Low
risk work may hand off without evidence; standard and higher need at least one
path. A review may put its evidence in the summary alone, except that high and
critical reviews need the reviewer's own `workkeel.review-report/v1` file.

`unresolved` lists open issues the implementer could not close. They are shown
with the delivery. For low and standard work the reviewer decides whether they
block; a high or critical review cannot pass with them, and critical work cannot
be delivered with them at all.

For a report-only correction after a failed review, an approver can record
`"mode": "evidence-only"` in the rework request. Either mode needs a new commit:
commit the corrected evidence, hand off that commit and obtain a fresh distinct
review. The rejected revision itself cannot be delivered again.

### Claim work that started before the task

Sometimes an Agent commits work before the task exists or before it claims the
task. A claim at HEAD then records the wrong base, and review does not cover the
earlier commits. To include them, claim with the last commit before the work
started and set `"pre_claim": true` (CLI: `--base <commit> --pre-claim`). The
base must be a commit ID. To get the full ID, run
`git rev-parse <first-work-commit>~1`. The base itself is not part of the task.

Workkeel accepts this claim only when all of these are true:

- The base is an ancestor of HEAD.
- Every product path that a commit in `base..HEAD` changes is inside the task's
  write roots. Workkeel checks each commit, so a change that a later commit
  reverts still counts. Paths under `.ai-org/` do not count.
- `base..HEAD` holds at most 100 commits.

If a check fails, the claim stops with the reason and the task stays at intake.
If the claim succeeds, `base_revision` is the older commit and the record gets
`pre_claim` with that base, the HEAD at claim time and the list of earlier
commits. Handoff, review and close compare from that base, so the reviewer sees
all of `base..candidate`. The risk check also starts at that base, even when an
earlier claim used a newer one. Release and rework keep `pre_claim` with the attempt.

Without `pre_claim`, `base_revision` must be the current HEAD, as before. If you
name an older commit without it, the error tells you about `--pre-claim`.

For example, after creation returns version 1, prepare `claim.json`:

```json
{
  "operation_id": "claim-cart-v1", "expected_version": 1,
  "actor": {"agent_id": "builder", "principal_id": "owner"},
  "base_revision": "<current-git-commit>"
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
  "claim_id": "<returned-claim-id>", "revision": "<tested-git-commit>",
  "summary": "Implemented the approved fix; see measured checks",
  "evidence": [".ai-org/artifacts/WK-cart-total/developer.md"],
  "unresolved": []
}
```

```sh
workkeel task handoff . --id WK-cart-total --request .ai-org/artifacts/WK-cart-total/handoff.json
```

The distinct reviewer inspects that candidate and records their own judgment in
`review-r1.md`. Use a new file for each review round, such as `review-r1.md` and
`review-r2.md`, to preserve the contents of earlier reports.
Only after a passing review, their `review.json` may be:

```json
{
  "operation_id": "review-cart-v1", "expected_version": 3,
  "actor": {"agent_id": "reviewer", "principal_id": "owner"},
  "revision": "<same-full-tested-git-commit>", "judgment": "pass",
  "summary": "Acceptance checked against this exact candidate",
  "evidence": [".ai-org/artifacts/WK-cart-total/review-r1.md"]
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
  "evidence": [".ai-org/artifacts/WK-cart-total/review-r1.md"]
}
```

```sh
workkeel task close . --id WK-cart-total --request .ai-org/artifacts/WK-cart-total/close.json
workkeel status .
workkeel doctor .
```

Close compares HEAD with the reviewed commit. If HEAD has any commit after the
reviewed one that changes a path outside `.ai-org/`, inside the write roots or
not, close stops with a non-zero exit status and lists each such commit, oldest
first. Nobody reviewed those commits. The error gives two options: check out
the reviewed revision, then close again to accept only what was reviewed; or
cancel the task and start a new task for the new commits. Commits that change only `.ai-org/`, such as a committed task
record or review report, do not block close.

In a shallow clone, the reviewed commit or its history to HEAD can be missing.
A shallow boundary can also cut the history behind the reviewed commit, for
example when HEAD merges a side branch that started before it. When Workkeel
cannot show that the history between the reviewed commit and HEAD is complete,
close stops, names the missing commit or history, and asks for the full history
(`git fetch --unshallow`). The task stays in `release_gate`. Task summaries and
the monitor still read done and cancelled tasks from their records, without
attention, and report `candidate_head.history_status: "unavailable"` without
later paths. Evidence committed in a reviewed commit that the clone lacks shows
the status `history-unavailable`, and `quality.evidence_current` is false.

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

## Rolling back

Do not remove the new lock to roll back a populated project. Preserve versioned
records and revert code through normal review. Locks coordinate this checkout,
not all machines; cross-machine reconciliation is a separate workflow.
