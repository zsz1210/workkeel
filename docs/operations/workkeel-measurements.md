# Task execution measurements

Inspect model choices, tokens and execution time without launching a model or a
server. These commands work in an initialized task-first project:

```sh
node /path/to/workkeel/bin/workkeel.mjs task metrics /path/to/project --id WK-example
node /path/to/workkeel/bin/workkeel.mjs workflow metrics /path/to/project --id run-one
```

Replace the example task/run IDs with existing IDs. Both commands return JSON and
are read-only. A future dashboard can consume this data; Console integration is
not implemented. No background collector, browser, API key or extra dependency
is needed to read it. Running the optional Graph still has its own prerequisites.

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
