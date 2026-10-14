# Bounded goal execution

The native autonomy runner continues explicitly enqueued approved work through the
qualified workflow engine. It observes local state without model polling. It does
not discover an unlimited mission, grant permissions or equate completed execution
with accepted work.

## Start with an approved recipe

Before intake, pin the workflow, execution policy and recipe as local task policy
references. A recipe contains a stable run ID and exact workflow/policy references:

```json
{"run":{"run_id":"feature-run","workflow_ref":"docs/feature-workflow.json","policy_ref":"docs/execution-policy.json"}}
```

The adapter fills task, actor and claim from the actual approved enqueue context
once. Do not try to predict a future claim ID. The frozen recipe cannot later be
rebound to another claim. Read [workflow execution](workkeel-workflows.md) for
supported enforcing runtimes and approval/checkpoint policy.

Autonomy mutation requests have exact common fields `task_id`, `actor`, `claim_id`,
`contract_sha256`, `operation_id` and `expected_version`. Obtain the actual values
from the current task and `autonomy show`. Use a stable operation ID for identical
retries; changed requests conflict. Each job requires its own authorized build task
and write scope containing `.ai-org/autonomy`.

An enqueue request adds:

```json
{
  "job":{
    "id":"feature-build",
    "origin":"assigned",
    "direction":null,
    "reason":"Complete the approved feature",
    "task_id":"WK-feature",
    "request_ref":"docs/feature-recipe.json",
    "depends_on":[]
  }
}
```

These examples describe shapes; actual request files belong to your private project.

```sh
node bin/workkeel.mjs autonomy show /private/project
node bin/workkeel.mjs autonomy enqueue /private/project --request docs/enqueue.json
node bin/workkeel.mjs autonomy tick /private/project
node bin/workkeel.mjs autonomy serve /private/project
```

`tick` performs one eligible scheduler step. `serve` watches local changes and uses
bounded timers for cooldown and missed-event reconciliation. It stays in the
foreground; stop with Ctrl-C. Idle observation makes no model calls. A configured
host must enforce the task's permissions, cancellation and spending limits.

## Progress, interruption and acceptance

Jobs move through queued, recorded running, recovery required, failed, awaiting
acceptance and accepted completion. Recorded running is not proof that a process
is currently computing. Runtime completion stops inference and waits for canonical
task acceptance. Dependencies become ready only after accepted completion, not after
a graph finishes. Independent review remains a different Agent's native task decision.

`pause` stops new scheduling. `resume` permits eligible scheduling again. `cancel`
adds `job_id`, requests cancellation from the qualified host and reports confirmation
only after the native journal and runner state establish quiescence. A submitted
request is not a stopped process. Canonical task cancellation remains a separate
authorized lifecycle action.

Cancellation names the job's exact original task, actor, claim and contract, even
after that claim ends. The actor must still be registered. Approval expiry or
changed source bytes block new execution, but do not block stopping an existing
run. Cancellation and passive reconciliation use its frozen recipe; neither grants
permission to resume, rebind or dispatch another operation.

An uncertain dispatch is never automatically replayed. Preserve the run ID and
operation journal, obtain host evidence, and use explicit workflow lock recovery
when required. `resume-job` adds `job_id` and `recovery_ref`; the latter contains
only explicitly authorized workflow `approvals` and/or `reconciliations`. The
runner resumes that exact checkpoint under the original claim. A dead local
process alone does not prove that external dispatch effects are safe to repeat.
Unrelated assignments can continue while one job awaits reconciliation.

## Optional improvement discovery

The default policy is off. A `policy` request adds a `policy` object with `enabled`,
explicit `directions`, `max_jobs`, `max_attempts` and `cooldown_ms`. An optional
`discovery` object contains exactly:

```json
{
  "enabled":true,
  "read_paths":["src","test"],
  "write_paths":["src","test",".ai-org/autonomy"],
  "max_proposals":10,
  "max_source_bytes":65536,
  "max_rounds":2,
  "cooldown_ms":3600000,
  "max_runtime_ms":60000,
  "max_cost_usd":1
}
```

Directions identify intentionally approved topics, not permission to fix everything.
All scopes and budgets must fit the actual task. Unknown cost ceilings do not count
as bounded discovery. An explicitly enqueued job with `origin:"improvement"`, an
approved `direction` and `purpose:"discovery"` runs a pinned qualified workflow.
The final completed runtime output must contain bounded JSON `proposals`, each
with `title`, exact `evidence` pins, `scope` and `budget`. Native runtime records,
actual usage and supporting source bytes remain attached. Invalid or broadened
output does not become executable work.

The separate `discover` command adds `event_id`, `direction`, `source_refs` and
`max_results`. It makes no model call: it captures explicit TODO/FIXME source
markers as proposals. It is not equivalent to AI architecture exploration.

Both paths deduplicate events and enforce rounds, cooldown, source-byte and proposal
bounds. Proposals await task authority. An approved improvement task can enqueue
`purpose:"execution"` with `proposal_id` after its source, scope and workflow
resource limits are checked. No task approval is invented from discovery.
The task's read and write roots must both fit the proposal. Its retry limit is the
smaller of the frozen proposal budget and current policy; later policy enlargement
does not enlarge that proposal. Turning discovery off stops new exploration;
already approved execution remains governed by
its task. Automatic publication, dependency installation and cross-project promotion
are excluded.

See [desktop workspace](workkeel-workspace.md) for observation and controlled
actions, and [ADR-0085](../adr/0085-native-workspace-bounded-autonomy-and-skill-learning.md)
for the authority boundaries.
