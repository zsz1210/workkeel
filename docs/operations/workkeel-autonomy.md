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
All scopes and budgets must fit the actual task. Finite financial ceilings need an
enforcing host; unknown cost cannot satisfy them. Explicit null means no financial
ceiling, with operation/time bounds still enforced. An explicitly enqueued job with
`origin:"improvement"`, an
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

## Opt-in continuous improvement

Approve a [whole goal](workkeel-goals.md) with a sealed `admission` grant and a
task-authority-pinned `workkeel.improvement-template/v1` file. The template contains
`id`, `source_component_id`, `title_prefix`, `acceptance`, `include` and `exclude`.
It identifies one approved component as the source of task/model/data/tool
authority; it cannot grant an arbitrary repository.

The standing grant contains exactly:

```json
{
  "enabled":true,
  "directions":["quality"],
  "read_paths":["src","test"],
  "write_paths":["src","test"],
  "template_ref":"docs/improvement-template.json",
  "source_refs":["src/service.mjs","test/service.test.mjs"],
  "max_source_bytes":65536,
  "max_rounds":2,
  "cooldown_ms":3600000,
  "max_goals":6,
  "max_total_operations":120,
  "max_total_runtime_ms":3600000,
  "max_total_cost_usd":null,
  "max_reworks":1,
  "max_operations":20,
  "max_attempts":2,
  "max_runtime_ms":600000,
  "max_cost_usd":null
}
```

Explicit source references are bounded triggers; idle timers do not ask a model
for work. The controller must authorize `.ai-org/autonomy` and `.ai-org/goals`
metadata for derived goals; the source component must authorize the product
scope. Another repository needs its own actors, approval and metadata scope.
Sensitive/high-risk tasks are ineligible for automatic admission.

First complete the source goal. Enable project autonomy with
`admission:{enabled:true,goal_id:"approved-goal"}` and a bounded `discovery` policy
that only narrows this grant. Add `goal_id` to common mutation requests and use
the sealed original controller claim/hash returned by `goal show`; settings
deliberately remain usable after that claim ends. The UI selects an approved goal
without requiring typed claim identities. Saving settings does not start inference:
start the background service from the workspace or run `autonomy serve` explicitly.

Changed approved sources create a bounded read-only discovery goal. Its structured
report and distinct review must be accepted before admission. Each proposal has
stable `id`, `title`, `direction`, assessed `risk_tier`, `expected_benefit`, testable
`acceptance`, exact `evidence` pins, `scope` and `budget`. Unknown/elevated risk stays
for a human decision without silently lowering the task's risk.

The controller reserves cumulative goals, operations, time and any enabled cost
ceiling before creation. It freezes a receipt, narrower native tasks and a separate
derived goal, then continues checks, distinct review, repair and acceptance without
routine permission prompts. Partial intake recovers identical IDs/contracts;
uncertain reservations are not refunded. Equivalent failed problems remain
deduplicated after source changes. Completed improvements can trigger another
bounded source review. Original acceptance remains historical; changed interfaces
are never mislabeled as currently accepted.

After pending work and eligible proposals settle, an exhausted discovery round
allowance is reported even if approved sources are unchanged. It remains exhausted
after a new source event; the service does not renew its own grant. The workspace
shows the limit and retained results so a new authorized round is an explicit choice.

### Extend an approved discovery allowance

An authorized operator can raise a sealed goal's **cumulative** allowance without
rewriting its manifest or resetting spent rounds. For example, extending a total
of one round to five leaves four rounds available if one was already reserved.
The settings screen can only narrow the effective authorization; moving its limit
does not grant additional capacity.

Create and claim a configuration task whose write scope covers
`.ai-org/autonomy/admissions`. Pin a separate JSON approval in that task's policy
references before intake. The approval has schema
`workkeel.admission-extension/v1`, the original `goal_id` and `manifest_sha256`,
`from` and `to` objects containing exactly `max_rounds`, `max_goals`,
`max_total_operations` and `max_total_runtime_ms`, a nonempty `reason`, and an
explicit boolean `reevaluate_unchanged_sources`. The `from` values must match the
current effective grant; `to` must increase rounds without reducing any of these
cumulative ceilings. Allocate capacity for discovery and any approved repairs.
Scope, model choices, risk, cost limits and individual operation limits cannot be
changed by this extension.

Run `goal extend-admission . --request extension-request.json` through the pinned
launcher. The request contains `operation_id`, the current admission journal's
`expected_version`, `actor`, configuration `task_id`, `claim_id`,
`contract_sha256` and pinned `approval_ref`. Repeating the exact request is
idempotent. A stale version, changed approval, unpinned authority or conflicting
replay fails without adding capacity. Accepted setup tasks retain their approval;
cancellation, expiry or authority drift stops further execution. Pause and cancel
remain available.

After the extension, save the desired bounded discovery policy and continue the
service. `reevaluate_unchanged_sources:true` explicitly permits one new inspection
of unchanged sources under this authorization. Subsequent unchanged or empty
results return to standby; five is a ceiling, not a requirement to spend five
model turns. Old admissions, failed attempts and reservations remain intact, and
new admissions identify the extension that authorized them.

Explicitly cancelled work keeps its spent allowance and execution measurements.
Once cancellation is confirmed, it no longer blocks unrelated approved work.
Unresolved cancellation still needs attention, and cancelling an empty or blocked
discovery never automatically retries the same unchanged source.

Off, unchanged sources, empty findings, exhausted budgets and cooldown make no
inference calls. Turning improvement off stops new exploration/admission; each
goal has controls for existing work. Neither mode publishes, deploys, installs
dependencies or promotes a Skill globally. Skill learning retains its own
comparison, independent review and activation rules.
