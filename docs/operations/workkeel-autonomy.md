# Bounded goal execution

Autonomy observes approved sources, selects bounded improvement work and delegates
all delivery to [native goals](workkeel-goals.md). Goal operations own planning,
execution, verification, independent review, repair, acceptance and cancellation.
The generic [workflow engine](workkeel-workflows.md) remains available separately.

## Trigger and control

Autonomy mutation requests have exact common fields `task_id`, `actor`, `claim_id`,
`contract_sha256`, `operation_id` and `expected_version`. Obtain the actual values
from the task and `autonomy show`. A stable operation ID makes identical retries
idempotent; changed requests conflict. Write scope must cover `.ai-org/autonomy`.
Standing control additionally names its approved `goal_id`, as described below.

```sh
node bin/workkeel.mjs autonomy show /private/project
node bin/workkeel.mjs autonomy policy /private/project --request docs/policy-request.json
node bin/workkeel.mjs autonomy event /private/project --request docs/event-request.json
node bin/workkeel.mjs autonomy tick /private/project
node bin/workkeel.mjs autonomy serve /private/project
```

A `policy` request adds `enabled`, explicit `directions`, `max_jobs`, `max_attempts`
and `cooldown_ms`, with optional `admission` and `discovery` objects. The default
is off. Policy only narrows a sealed standing grant; it does not approve work.
`max_jobs` bounds retained admissions and legacy jobs; `max_attempts` narrows
proposal budgets. Existing reservations are never reset by changing settings.
The `discovery` object contains exactly:

```json
{
  "enabled":true,
  "read_paths":["src","test"],
  "write_paths":["src","test"],
  "max_proposals":10,
  "max_source_bytes":65536,
  "max_rounds":2,
  "cooldown_ms":3600000,
  "max_runtime_ms":60000,
  "max_cost_usd":null
}
```

An `event` request adds `event_id` and wakes observation. It does not authorize
inference or force unchanged sources to be inspected again. `tick` advances one
eligible goal/admission step. `serve` watches local changes and uses bounded timers
for cooldown and missed events. It stays in the foreground; stop with Ctrl-C.
Idle observations make no model calls. `pause` and `resume` control future cycle
steps; stop existing operations through the owning goal's controls. A cancellation
request is not confirmation that a process stopped. Unknown effects retain their
operation identity and need explicit goal recovery, never automatic replay.

### Delivery evidence and recovery

Autonomy records policy changes and wake events; it does not own runtime results.
Use `goal show` for the derived goal's operation journal, current candidate,
verification and review evidence. The admission journal links the standing source,
proposal and derived goal while retaining cumulative reservations.

Pause stops the next cycle step. It does not establish quiescence of an already
running host operation. Use `goal pause`, `goal cancel` or `goal recover` with that
goal's exact authority and current version, following the goal operations guide.
An uncertain host result remains attached to its original operation. Recovery
must resolve that result before any new delivery can proceed.

A completed discovery is still subject to verification, distinct review and goal
acceptance before its proposals enter the autonomy inventory. An accepted proposal
report is evidence for selection, not permission to widen the standing grant.
High, critical and unknown risk remain for explicit human handling.

## Retired job delivery

`enqueue`, `cancel`, `resume-job` and marker-only `discover` are retired autonomy
commands. They fail with guidance to use goals; they never dispatch work. There is
no autonomy workflow adapter or TODO/FIXME scanner. Accepted discovery goals are
the only source of new proposal inventory.

Existing job records, recipes, receipts and reservations remain readable. Before
upgrading a workspace with unresolved jobs, stop and reconcile those runs using
their original runner. The new cycle refuses to deliver while any legacy job is
unsettled; it never translates an old execution ID into a new goal or claims that
an old process stopped. Retained terminal jobs continue to count toward capacity.

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
