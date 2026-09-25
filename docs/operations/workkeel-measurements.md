# Task execution measurements

Inspect model choices, tokens and execution time without launching a model or a
server. These commands work in an initialized task-first project:

```sh
node /path/to/workkeel/bin/workkeel.mjs task metrics /path/to/project --id WK-example
node /path/to/workkeel/bin/workkeel.mjs workflow metrics /path/to/project --id run-one
```

Replace the example task/run IDs with existing IDs. Both commands return JSON and
are read-only. An optional task monitor can display this data. No background collector,
browser, API key or extra dependency
is needed to read it. Running the optional Graph still has its own prerequisites.

## Optional task monitor

From a source checkout, start the foreground viewer for an initialized task-first
project (replace the example path):

```sh
node bin/workkeel.mjs monitor /path/to/project
```

With the package installed, use `workkeel monitor /path/to/project`. Open the
printed access URL in a browser; keep it private. The viewer binds only to
`127.0.0.1` on a random port. Ctrl-C stops it; nothing is installed at login and
no process needs to keep running when you are not viewing it. Do not expose it
through a tunnel or reverse proxy. The capability URL protects API access from
unrelated browser pages; it is not a security boundary against another process
already running as your local user.

The Traditional Chinese page offers an attention-first overview, task detail and a usage/quality table;
see the [daily work guide](workkeel-daily-work.md) for intake, handoff and optional
revision-bound check/link observations. It refreshes every two seconds while visible.
Choose a task to see its
lifecycle state, workflow state, recorded/completed/unresolved attempts, selected
and runtime-confirmed models, backend model when available, tokens, adapter work
and run wall time. Cost remains unknown for the subscription adapter. The display
does not infer a percentage, finish tasks or launch agents. Attributable corrupt
journals mark the affected totals incomplete; unknown attribution marks all totals
incomplete. Fatal snapshot failures hide old content. It never repairs or resumes execution.

The monitor reads existing records only and does not require optional LangGraph
packages merely to view them. It excludes retained legacy-mode tasks; it does not
migrate a project or replace the legacy Console. Limits: 200 visible native tasks and a
4 MiB response; use the per-task JSON command for larger projects. Starting the
viewer and reading snapshots writes no project files. Browser reload loses the
in-memory access token; reopen the printed link to regain access.

This is a task monitor, not the [offline workflow explainer](../assets/workkeel-flow.html).

### Full task time and handoff

Task detail and the quality table show total lifecycle elapsed time and five
disjoint phases: waiting for claim, implementation, review (including waiting),
rework implementation, and waiting for acceptance. A failed review remains in the
review phase until rework is authorized. Subsequent build intervals after a rework
event count as rework. Released claims return to waiting. Terminal tasks freeze at
the final event; ongoing tasks run to the snapshot read time. Invalid, reversed or
future event times make the whole timing projection unknown, not a partial total.
The additive `lifecycle` field is also available in `task summary` JSON; its phase
durations sum to `elapsed_ms`. The older terminal-only quality field is retained.

These are calendar intervals, including downtime. They do not measure active
human or reviewer effort. Adapter time can overlap and must not be added to task
time. A complete history does not imply complete token or cost coverage. Human
effort, general-workflow baseline and saved time remain null. First-review outcome,
rework count, current review and local acceptance are separate observations.
No percentage improvement is inferred without a suitable comparison dataset.

The page distinguishes snapshot read time, latest task event and latest external
observation. Concrete attention reasons identify expired approval, changed policy,
unavailable evidence, failed review, pending acceptance and incomplete workflow
records. Read freshness never proves process liveness.

Use the copy-handoff button to copy the currently selected task's goal, scope,
acceptance criteria, candidate, evidence hashes/status, next actions and timing
limits into your own Codex conversation. Copy is a user action, not a dispatch or
authorization. Browser clipboard denial offers a selectable text fallback. Its
timestamp identifies the frozen copy; refresh does not overwrite selected text.
Changing tasks or losing the snapshot clears the fallback. Runtime output and
monitor capability URLs are excluded. Project-authored text is not translated.

See [ADR-0078](../adr/0078-observer-task-lifecycle-measurements.md).

## Coverage and defaults

Workkeel's optional workflow runner records measurements by default during its
existing execution process. Data remains in its private, Git-ignored
`.ai-org/execution/<run-id>/` journal. Each operation has a stable ID for its node,
visit and attempt; repeat reads and completed-run replay do not add usage. A task
query includes all recorded runs for that task, not just the latest one.

Native coding-agent sessions and unrelated Codex desktop tasks are **not
automatically collected**. A task without a recorded run has `coverage: unobserved`
and null totals. With runs, `recorded-workflow-runs-only` explicitly limits the
scope: this is not proof of the task's entire development cost. Historical runs
can expose their saved result usage, but missing timing is not reconstructed.

## Reading the fields

| Field | Meaning |
| --- | --- |
| `requested_model` | Model selected by the approved execution policy; null for an unspecified native model |
| `runtime_model` | Model confirmed by the runtime configuration, not proof of the serving backend |
| `observed_model` | Provider-observed backend model when supplied; currently null for the Codex adapter |
| `usage.*.total` | Sum across recorded operations only when each has a final result and that metric is known |
| `usage.*.known_subtotal` | Sum of available final values or latest partial snapshots; never a substitute for an incomplete total |
| `usage.*.complete` | Whether the recorded-operation total is available; not whether the task is finished |
| `adapter_elapsed_ms` | Monotonic duration of one adapter call, including setup, tools and cleanup, on return or exception |
| `observed_elapsed_ms` | Adapter-call duration at the latest persisted observation; not a live liveness guarantee |
| `timing.adapter_work_ms` | Sum of measured adapter-call durations; parallel calls overlap, so it may exceed wall time |
| `wall_elapsed_ms` | Run creation to read time, or terminal status time; includes approvals, pauses and downtime |
| `progress` | Recorded/completed/unresolved attempts; no invented percentage for remaining agent work |

Null means unknown. Confirmed zero remains zero. Totals are field-specific: known
output tokens do not make unknown input tokens known. No monetary cost is inferred
from tokens. Codex monthly-subscription cost and quota conversion remain unknown;
`cost_usd` is null. A trusted custom adapter may return its own operation-scoped
cost observation, but Workkeel does not certify it as an invoice.

## Live observations, failures and retries

The Codex adapter saves runtime model confirmation and turn-bound cumulative
token snapshots. Cumulative notifications **replace**, not add to, the previous
snapshot. `last` describes one model request, not the entire tool-using turn, and
is not used as a turn total. Unrelated turn IDs are ignored. Regressing or invalid
counters remain unknown; resumed conversations without a trusted pre-turn baseline
also remain unknown, avoiding double-counting previous turns.

Progress survives a later runtime error. An unresolved operation has a partial
subtotal, not a final total or permission to replay. Even a measured adapter call
ending does not prove all external effects stopped. Existing uncertainty locks,
reconciliation requirements, approvals and task acceptance remain unchanged.
Retries are separate operations. Reconciliation replaces the result of an
existing operation rather than appending another charge.

Trusted embedding adapters can optionally call and await
`context.observe({ runtime_model, observed_model, usage })`, with usage containing
`input_tokens`, `output_tokens`, and `cost_usd` (nonnegative values or null).
Both observations and final result usage must be **operation-scoped**, not a
cumulative conversation total carried across attempts. Only these bounded fields
are accepted; do not include prompts, output, credentials or raw provider frames.
Await callback writes and do not call after the adapter settles. A final result
supersedes partial usage, including explicit null values.

Queries verify journal checksums and run/operation binding and reject missing or
corrupt entries. A changing index/status asks the caller to retry the read; this
does not authorize retrying execution. Cross-run results are point-in-time
observations, not one transaction, and a stale running label is not proof that a
process is alive. No observation satisfies review or acceptance gates.

## Validation boundary

Offline tests cover snapshots, failures, unknowns, retries, multiple runs,
read-only commands, replay and integrity. They prove accounting behavior against
fixtures, not live model quality, cost savings or monthly quota consumption.
The subscription adapter remains experimental and requires separately authorized
live qualification. See [workflow setup and limits](workkeel-workflows.md).
