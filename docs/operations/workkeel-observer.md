# Workkeel observer and measurements

The observer reads a project's existing records and displays them in a local
website. Opening it, leaving it open, searching, filtering and drawing charts
make **zero model calls**. Task execution by a coding tool is separate and can consume
tokens; the observer only shows usage already recorded by that execution.

## Open

From an existing source checkout:

```sh
node bin/workkeel.mjs monitor /path/to/task-first-project
```

Open the complete loopback URL printed by the command. Keep this access link private.
The page removes the fragment after retaining access in that tab's session storage;
reloading the same tab works while the server remains running. Stop the terminal
process with Ctrl-C to revoke that server's access. No daemon is installed.

### A stable local address or an existing Work Item repository

The source-checkout entry point below retains a private access token across restarts
and supports an explicitly selected record format:

```sh
node scripts/serve-workkeel-observer.mjs /path/to/project /path/to/private-state 49618
```

The state directory holds `access-url.txt` and a private observer access token, not
a model credential. The process listens only on `127.0.0.1`. A local process manager
may keep it running; the script itself neither detaches nor installs login startup.
Stopping it disconnects the website. Retaining the state directory preserves access
on restart; revoke old access by stopping the server and removing its access-token
and URL files before restarting.

An optional fifth argument selects a JSON file of additional Skill directories:

```json
[
  {"path": "/absolute/path/to/personal-skills", "origin": "user", "label": "Personal skills"},
  {"path": "/absolute/path/to/plugin/skills", "origin": "third-party", "label": "Plugin skills"}
]
```

Each source contributes only immediate `<skill-name>/SKILL.md` files. Select the
directories explicitly at launch. The website cannot add sources or browse
arbitrary files. Missing sources are reported while available sources remain visible.

## Pages

| Page | Contents |
| --- | --- |
| Dashboard | Current workload, required action, recent results, known usage and observation coverage |
| Task board | Last seven days, at most ten cards per column, with a discoverable unfinished-history entry |
| Usage analysis | Paired time/token bars, task scatter and daily/weekly trends; shared filters |
| Activity | Recorded execution lanes over 24 hours or seven days; paged events on demand; gaps stay unknown |
| Backlog | Searchable task/document history, 50 rows per page |
| Learning & skills | Project learning, compact milestones, project/configured Skills and content search |
| Settings | Language/timezone display preferences and read-only project/runtime policy explanations |
| How Workkeel works | Task flow, component responsibilities and the optional learning path |

Task details separate the requested model from the runtime/provider model reports.
A task can contain several tools, models and operations. Reasoning settings preserve
the provider's name/value; requested effort is not reported effort. No cost estimates
or inferred savings are displayed.

## Reading metrics

Task execution time is the union of recorded dispatch/end intervals. Overlap counts
once; unknown/open intervals are not extended to the current time. Usage analysis
separately sums recorded adapter durations, including setup, tools and cleanup.
Phase residence includes waiting and downtime. None is human effort or pure model
compute time. This distinction also appears in contextual help beside each heading.

Tokens combine recorded input and output. An asterisk marks a partial subtotal;
unknown is never zero. An operation's final result replaces its cumulative progress
report. Filters apply at operation level. Scatter points aggregate the selected
operations per task; a diamond marks a task whose full record includes multiple
reported models. Unavailable tasks and corrupt journals cannot establish complete
project totals. No population-wide model ranking follows from these charts.

Dates use the browser's system timezone by default; the header shows its name and
current UTC offset. Settings can select another IANA timezone. The preference stays
in this browser and changes activity dates, detail timestamps, date filters and
trends together. Durations and token totals do not change. The last 7/30 days include
today in that timezone; they are calendar dates, not rolling 24-hour intervals.
Trends use operation start dates in the selected timezone; weekly buckets start on
Monday. Cross-day operations are not split by guessing. Unrecorded days are not
filled with zero.
Native coding sessions and other tools have no automatic usage until their host
records it. Task categories use the existing sample classification (real task,
paired experiment, fixture or unclassified); feature/bug/documentation types are
not inferred from task titles.

## Sources and privacy

The observer reads the selected task format, referenced Markdown/text evidence,
execution journals, project learning records, project Skills and explicitly
configured personal or plugin Skill directories. It does not
scan user-wide credentials or model settings. Document bodies are requested on open;
Skill/learning content is indexed locally for search. Documents remain at the opened
version while reading; an update notice lets you choose when to reload.

Skill origin is a declared/configured third-party source, or a project/personal
location with unrecorded authorship. Workkeel ships no Skills, so no origin means
"written by Workkeel". Installation location is not author proof. Source and project
availability are separate fields: a personal Skill is not necessarily installed in
this project. Skills tied to the retired lifecycle are hidden by default and explicitly labelled as compatibility
material; their source identifiers and historical content are preserved.
Task contract selection is shown separately from reading/application/verification;
the current native task records do not store a unified application receipt, so those
fields remain unrecorded. Running a Skill audit is not itself a persisted receipt.

Learning stages are conditional milestones, not percentages of time. Existing
learning/proposal records can confirm capture through approval. A Skill proposal
approval authorizes authoring; it does not create or enable a Skill. The observer
does not claim that automatic promotion or the later completion records exist.

## Local overhead and limits

A rebuildable bounded memory index watches file changes. Dependencies recorded by
the safe reader invalidate affected task projections; new observations invalidate
their task, while shared policy changes invalidate all dependent projections.
Fresh source reconciliation clears task caches every 30 seconds. The browser checks
an authenticated change endpoint every two seconds while visible; unchanged checks
reuse the index and perform no source reads. Hidden pages pause. Watch delivery is
not transactional, so the header exposes last check, last source validation and last
data change separately. Direct task/detail and document requests revalidate sources.
Derived library indexes remain keyed by content digests, at most 256 entries.
Semantic revisions ignore heartbeat/read timestamps while retaining real usage and
source changes. The browser patches retained nodes, preserving task tabs, open and
closed disclosures, focus, selection and scroll. Library source changes still
invalidate content. Open documents retain their text and offer a reload action.
Authenticated diagnostics at `/api/diagnostics` show local read counts, bytes, elapsed
time, response size and cache hits. No model performs these calculations.

The workspace index supports up to 2,000 native tasks and 50,000 operations.
Task and operation APIs use revision/filter-bound cursors, 50 rows by default and
100 maximum. Charts aggregate before capping display to 20 bars, 100 points and 180
buckets, with coverage and visible limits. The compatibility full-snapshot API
retains its 200-task bound. Explicit Work Item mode allows 1000 records
and an 8 MiB event journal; its timeline shows at most 200 recent events per task,
without claiming complete phase timing. Up to 64 configured Skill sources are
allowed. Combined Skill inventories and learning inventories are each capped at
256 entries; readable document bodies at 256 KiB and API responses at 4 MiB. Limits
fail visibly instead of silently calling a model or reading arbitrary files.

The framework is model/provider-neutral. Native hosts can use cloud or local models.
Automatic workflow execution still needs an actual adapter; see the current
[runtime support boundary](workkeel-workflows.md#choose-how-to-run). The website
neither installs an adapter nor claims a connection is tested because it can display
its recorded name.

## Private access over Tailscale

The native website can also use an owner-only Tailscale Serve route. It remains
read-only and makes no model calls. The local URL keeps its existing capability
requirement. The private viewer checks the exact tailnet hostname and the
configured owner's `Tailscale-User-Login` header before serving either the page
or an API. Other users, missing identities and tagged-device requests are denied.

The current integration was validated with the already-installed Tailscale CLI
`1.98.8`. No package is installed or vendored; the open-source client is BSD-3-Clause
licensed. Hosted account terms remain separate. See
[ADR-0091](../adr/0091-foundations.md#8-private-observer-access-is-read-only-from-adr-0035)
and the [official Serve identity documentation](https://tailscale.com/docs/features/tailscale-serve).

For the existing source-checkout service, an optional owner-readable-only regular
file `tailnet-observer.json` in its private state directory selects `hostname`,
`allowedLogin` and a separate loopback `port`. Use the exact existing DNS name and
owner Login from local Tailscale status, not an inferred account name. The HTTP
backend retains its private access capability; it never publishes that capability
to the remote browser. The UI's private-mode marker is not an API authorization.

After reviewing the private config and restarting the owned observer, inspect
`tailscale serve status --json`. Proceed only when it is empty or already exactly
matches this observer. Start the existing loopback proxy with
`tailscale serve --bg --https=443 http://127.0.0.1:49619` and verify the returned
hostname, target and that Funnel is disabled. Do not overwrite unrelated routes,
change ACLs, or enable Funnel. This setup uses the user's existing signed-in
tailnet; if HTTPS setup needs account consent, leave that separate step unresolved.

Serve with `--bg` survives Tailscale restarts. The observer process must also be
running; this option does not itself install login startup. Tailscale access rules
still apply. Identity headers are trusted only on loopback and do not isolate
this service from other processes already running on the same Mac.

Rollback removes only the verified observer route using
`tailscale serve --https=443 off`. Remove its private config and restart the owned
observer to stop the separate listener. Do not reset unrelated Serve routes or
delete task records.

## Task execution measurements

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

### Optional task monitor

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
packages merely to view them. It does not migrate a project. The indexed observer supports
2,000 native tasks with bounded, paginated APIs; the compatibility full snapshot
retains its 200-task and 4 MiB response limits. See the
[observer bounds](workkeel-observer.md#local-overhead-and-limits).
Starting the viewer and reading snapshots writes no project files. Same-tab reload
uses sessionStorage to retain local access when available; after tab/session loss
or unavailable storage, reopen the printed capability link. Proxy access follows
its configured authentication mode.

This is a task monitor, not the [offline workflow explainer](../assets/workkeel-flow.html).

#### Execution time and handoff

Task details show recorded execution intervals and their intersection with the
implementation, review and rework stages. Overlapping execution counts once in
task details; usage analysis sums operations, which can overlap. Missing execution
intervals stay unknown. Task creation or state residence never establishes active
work. The separate `lifecycle` field in `task summary` JSON retains calendar
residence for diagnosis, including waiting and downtime.

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
Copied project fields are quoted with escaped newlines and directional controls,
so embedded task text cannot introduce an unquoted acceptance or status field.

See [ADR-0078](../adr/0078-observer-task-lifecycle-measurements.md).

### Coverage and defaults

Workkeel's optional workflow runner records measurements by default during its
existing execution process. Data remains in its private, Git-ignored
`.ai-org/execution/<run-id>/` journal. Each operation has a stable ID for its node,
visit and attempt; repeat reads and completed-run replay do not add usage. A task
query includes all recorded runs for that task, not just the latest one.

Native coding-agent operations can use the optional
[explicitly bound native collector](workkeel-observer.md#native-execution-reports). Unbound sessions
and other desktop tasks are **not collected**. A task without a recorded run has `coverage: unobserved`
and null totals. With runs, `recorded-workflow-runs-only` explicitly limits the
scope: this is not proof of the task's entire development cost. Historical runs
can expose their saved result usage, but missing timing is not reconstructed.
Native-only coverage is `bound-host-operations-only`; mixed records use
`recorded-workflow-and-bound-host-operations`. Native reports remain partial task
coverage even when a bound operation has completed.

### Reading the fields

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

### Live observations, failures and retries

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

### Validation boundary

Offline tests cover snapshots, failures, unknowns, retries, multiple runs,
read-only commands, replay and integrity. They prove accounting behavior against
fixtures, not live model quality, cost savings or monthly quota consumption.
The subscription adapter remains experimental and requires separately authorized
live qualification. See [workflow setup and limits](workkeel-workflows.md).

## Native execution reports

The observer can show measurements from a coding tool, a local model runner or
another runtime. It reads normalized metadata; it never calls a model to obtain
time, tokens or explanations. Collection is optional and separate from task state.

For new operations, use the [capture helper](#capture-an-operation-from-start-to-finish)
to attach the exact host source, record work intervals and finish its report under
the original identity. The [delivery helper](workkeel-native-dispatch.md#compact-resumption-and-execution-receipts)
also remains available for hosts that already measure their own intervals.
The host still has to provide measurements. The helper does not discover sessions,
infer model activity or grant permission to read another conversation.

### Scope and meaning

- A binding identifies one approved task contract, its active claim and one exact
  host thread/turn or operation. Unbound conversations and agents are excluded.
- Tokens are input plus output reported by the runtime. Cached input is already
  part of input and reasoning output is already part of output; neither is added
  twice. These are usage counts, not subscription quota or prices.
- Native totals are **known subtotals**. A completed bound turn does not prove
  that every agent or earlier operation in the task was captured.
- Active execution requires reported intervals that exclude waiting for a person.
  A host's total turn duration is retained separately because it may include
  waiting. It is never converted into active time or a fabricated stage interval.
- Repeated collection replaces cumulative observations; it does not add them
  again. Missing values remain null and measured zero remains zero.

#### Token breakdown and field coverage

The observer reports input, cached input, uncached input, output and total as
separate subtotals. Uncached input is derived only when input and cached input are
valid and cached input does not exceed input. Missing cache is not zero. A total
requires both input and output; the older overall Tokens subtotal can include a
partially reported operation. Reasoning output and cached input are never added
again. Out-of-range sums stay unknown.

Each field shows known values / collected operations after filters. Rows can have
different denominators of known values, so incomplete subtotals need not reconcile.
This is field availability, not proof of all task work being captured or a billing
statement. Terminal/integrity checks remain separate from field availability.

Tool time continues to use recorded execution intervals. Full-turn time uses only
an explicit host duration and may include tool work and waits. The scatter chart
includes only operations that have a terminal result, a healthy journal, input and
output totals, and an explicit full-turn duration. Both axes sum that same subset;
missing operations are omitted and the paired count is shown. A task with no such
pair has no point. This avoids comparing a short reported work interval with tokens
from a much longer turn, but does not measure pure inference speed or establish a
causal model/framework efficiency difference.

Records live in the private, ignored `.ai-org/host-usage/` directory. The observer
receives only validated measurement fields, not private source paths, prompts,
responses or credentials. Local checksums detect changed records; they do not
authenticate a provider's billing statement.

### Bind an approved operation

Use the actual task contract hash, current claim and approved actor. The request
must be a repository-relative JSON file. A Codex source is an explicitly selected
local rollout file for an exact thread and turn; the collector does not search
other conversations. Other tools use `source.kind: "host-report"` and submit
normalized reports through the same interface.
Keep requests containing private source paths out of Git. The source-checkout
helper `scripts/collect-workkeel-host-usage.mjs bind TARGET REQUEST.json` also
accepts a bounded private request file outside the repository.

```sh
workkeel usage bind . --request docs/usage-binding.json
workkeel usage collect . --id my-binding
workkeel task metrics . --id WK-example
```

The collector defaults to measurements after attachment. Capturing an existing
turn from its start requires the explicit `capture_turn_from_start` option and
the task's exact approved authority reference. Do not use this option to assign
an entire conversation to a task. A new task or turn needs its own binding;
finishing a turn does not authorize following future conversations.

#### Recording boundaries for new work

Claim the approved task, then bind before detailed planning or implementation.
For an approved Codex turn, explicitly pass `capture_turn_from_start: true` and
the exact `approval_ref` at begin to include eligible samples after that claim.
This remains opt-in: it does not include pre-claim samples, backdate activity
time, or change any earlier binding. Check the begin result's
`measurement.usage_scope` immediately; excluded responses signal a narrower
recording boundary, even if final collection later succeeds.

| Work | Recording start and end |
| --- | --- |
| Preparation and planning | Bind immediately after the approved claim, before the detailed work. Pre-claim intake/setup stays outside task attribution. |
| Implementation or repair | Bind the actual operation before edits; use the matching activity kind. Pause on waits and finish after the work. |
| Independent review | Prepare the ticket first; the reviewer binds its own exact source before reading the candidate. |
| Verification and closeout | Plan this work in the expected-operation list before handoff. Preserve an existing coordinator binding through its actual final work, pausing on review waits; collect its terminal row after the turn ends. |

One mixed coordinator turn is not several separately measured activities. Never
reuse a source with invented operation IDs to bypass binding guards or assign all
of its time to each stage. If the runtime has no separate operations or measured
segments, record the mixed scope and leave the per-activity split unknown. A
finished activity clock does not extend when late tokens are collected. New
bindings/resumes still require the existing live-claim authority; handoff does
not grant a new claim for closeout.

#### Source-turn references and gaps

Measurements and delivery receipts expose `usage_scope` separately from the
recorded operation's `usage`. For an already bound Codex source with a healthy
scan and turn-start metadata, `turn_reference.usage` is its validated cumulative
turn counter; `outside_operation_usage` subtracts known recorded values from
known reference values. Missing, unsafe or inconsistent fields remain null.
This may include preparation or other work and is not newly attributed task
usage. A nonzero difference is not proof of a lost task report.

The observer lists these references per operation in collapsed tables; it never
adds them to task/model totals, charts or each other. Unknown, pending, stopped
and unavailable references remain distinct. Other runtimes without a turn
reference report that absence. Existing bindings, token totals, activity
intervals and evidence retain their original scope; the supplemental projection
does not rewrite them. Reading it does not open another source or call a model.

The delivery helper also shows declared/reported counts for each activity kind.
An undeclared activity is not measured zero or proof it was unnecessary. Keep
preparation and closeout explicitly in the expected work plan, including a
missing binding when one is genuinely needed; complete declared reports still
do not prove complete task coverage.

The installed Codex adapter reads bounded metadata rows such as
`token_usage_record`, `turn_context` and turn lifecycle events. The local storage
format is version-sensitive. Source identity changes, truncation and malformed
usage must remain visible as incomplete observations. No credentials, provider
request or new model turn are needed. The adapter cannot infer missing child-agent
usage or distinguish human waiting from every host-reported turn duration.

### Capture an operation from start to finish

The optional source-checkout `scripts/workkeel-execution-capture.mjs` helper
combines binding, an explicit activity clock and existing native usage reports.
It requires no package, model call or background service. The execution host
must call it at the actual work boundaries; it cannot intercept arbitrary tool
calls or automatically identify idle time inside an Agent turn.

1. Prepare the approved dispatch ticket, then start the selected executor. Have
   the host supply its exact thread/turn and source file before product work.
2. Run `check` with the intended begin request to inspect binding readiness, then
   call `begin` with that source and a stable capture ID. It resolves the exact
   turn's byte offset, attaches the binding and starts the activity clock.
3. Call `pause` before waiting for a person or another Agent, and `resume` when
   work actually resumes. Give each transition a stable operation ID.
4. Call `finish` after the operation. The helper freezes the clock and collects
   available source metadata, or submits the supplied normalized host report.
5. Inspect the receipt and the [expected-operation check](workkeel-native-dispatch.md#check-expected-operations-before-handoff-and-closeout).
   A successful command alone does not establish complete task coverage.

```sh
node scripts/workkeel-execution-capture.mjs check /absolute/project /private/begin.json
node scripts/workkeel-execution-capture.mjs begin /absolute/project /private/begin.json
node scripts/workkeel-execution-capture.mjs pause /absolute/project /private/pause.json
node scripts/workkeel-execution-capture.mjs resume /absolute/project /private/resume.json
node scripts/workkeel-execution-capture.mjs finish /absolute/project /private/finish.json
```

`check` reads binding prerequisites without creating a ledger, binding, lock or
source collection. It reports dependency or conflicting binding IDs when safe;
it never returns source paths or contents. It cannot prove that a source is valid
or reserve a place in the next execution group. `begin` checks predictable
binding blockers before saving a new prepared ledger, and the actual bind checks
again under its existing lock. A race or interrupted persistence still requires
explicit recovery; a readiness result does not waive any guard.

Dispatch dependencies require completed reports from the declared nodes in the
same task and claim, not just an in-memory `completed` list. Declare coordinator
work as host-owned when it is performed in the main conversation; inspect its
actual report before review. Do not manufacture a dispatched model operation to
stand in for that work. Each independently executing program has its own source
identity. If a thread is occupied, complete/collect the actual prior operation
or use the genuinely distinct execution source; never relabel the same operation
to bypass a conflict. Reused checkouts can contain ignored bindings for absent
historical tasks. Preserve that history and use a suitable checkout; do not delete
the inventory to make readiness pass.

A dispatch begin request uses this shape (replace every example identity):

```json
{
  "capture_id":"implementation-1",
  "binding":{"kind":"dispatch","execution_id":"returned-execution-id"},
  "source":{
    "kind":"codex-rollout",
    "path":"/private/explicit-source.jsonl",
    "thread_id":"exact-thread",
    "turn_id":"exact-turn"
  },
  "sample_kind":"real-task"
}
```

Other execution hosts use `source.kind:"host-report"` with their own thread and
operation IDs. A coordinator without a dispatch ticket uses
`binding:{kind:"host",binding_id,task_id,actor,claim_id,contract_sha256}` and
an explicit `activity_kind`. A dispatch takes its activity kind from the ticket.
Each activity needs a separate operation; an implementation clock cannot stand
in for review or repair.

Pause and resume requests contain `capture_id` and `operation_id`. A Codex finish
request contains only `capture_id`; tokens and actual model are read from its
bound source. For another runtime, finish also takes `report` with the supported
usage and actual runtime metadata. Missing usage stays unknown. A real command
that calls no model may report measured zero tokens; this says nothing about the
Agent that arranged that command.

Finishing an active source can return a pending receipt because the host has not
yet written its completion row. Retry the same finish after that row arrives:
the clock stays frozen while tokens and completion are collected. This avoids
counting the collection delay as work or adding the same measurements twice.
`final_collection:"completed"` means the terminal report was collected; inspect
the measurement's `runner_state` for completed, interrupted or cancelled work.
Successful collection does not turn an interrupted operation into a success.
The clock measures explicitly declared working intervals, including tool work;
it does not measure pure model inference. Forgotten pauses cannot be inferred
from task status. Earlier unbound work and an unfinished coordinator turn remain
outside complete coverage.

The `source` command accepts an explicit path, exact thread and exact turn and
returns metadata for optional preflight. It never chooses the latest conversation
or scans directories. Rotated files must be selected by the host; an old file for
the same thread is not evidence of the current turn. Source identity, header,
anchor and bounded-read guards still apply at begin. An optional fingerprint
pins a preflight result; a changed source must be inspected instead of silently
accepted. Keep source requests and the ignored `.ai-org/execution-capture/`
ledger private. The ledger contains checkpoints, not prompts or responses.

Interrupted preparation is explicit and requires recovery; the helper does not
adopt an unrelated existing binding. Begin and resume require a live approved
claim. An operation already bound before handoff may finish afterward under the
existing report rules; finishing never revives an ended claim or accepts a task.

### Report from another runtime

```sh
workkeel usage report . --request docs/usage-report.json
workkeel usage close . --request docs/usage-close.json
```

A report supplies the binding identity, actor, claim and contract hash, a stable
report ID, cumulative input/output usage, tool, provider/model when known,
reasoning setting, status and observation timestamp. Unknown model fields stay
null. Actual execution intervals and a measured execution duration are optional;
the reporter must exclude user waiting and must not derive them from task state.
Reports may describe a local tool invocation with zero model tokens when that
invocation truly made no model calls. This covers the tool work only.

### Optional continuous collection

#### Explicit activity and dispatch identity

The [native dispatch path](workkeel-native-dispatch.md) attaches immutable requested
model/reasoning, selection reason, execution UUID and optional nickname. Actual host
model reports stay separate. New explicit activity kinds distinguish planning,
implementation, review, repair and verification even while governance state is build.

For a bound Codex source, `usage activity` reports cumulative, measured intervals
without changing source-derived tokens or model. Supply `binding_id`, `report_id`,
`actor`, `claim_id`, `contract_sha256`, `observed_at`, `activity_kind`,
`execution_duration_ms` and `execution_intervals` with start/end timestamps.
Reports are attributed assertions, not automatic measurements of model compute.
They may finish after handoff but not after release, rework, cancellation or closing
the binding. Intervals cannot erase earlier coverage or change the activity kind.
Use separate operations for separate kinds; report gaps rather than inventing them.

The observer's task detail lists each recorded execution with its activity, tool,
actual reported model and reasoning, duration, and tokens. Execution numbers are
local row labels, not a count of distinct agents. A single executor can produce
multiple operations; the original execution ID and selection reason remain in
expandable details. Historical registered actor IDs are retained as accountability
keys under event record details rather than shown as current agent names.

Every stage remains visible. A stage without measured intervals says its time was
not recorded, even if review or repair events exist. Interval overlap establishes
concurrent recorded operations only; missing records cannot establish serial work
or the full agent roster. Unknown model/reasoning values are never filled from
requested settings in the execution breakdown.

Usage analysis coalesces identical pending queries and discards superseded filter
responses. Temporary source contention has bounded retry; read errors retain a
visible retry action instead of becoming an empty page or perpetual loading state.
Background updates preserve open disclosures and the current reading position.

For long-lived logs, optional `source.start_offset` must point to the exact matching
`task_started` row at a byte boundary. The reader separately verifies the source
header and preserves its 32 MiB scan limit, checkpoints and source replacement guards.
This is an explicit offset, not a search across conversations.

#### Background collector

The source-checkout deployment entry point
`scripts/serve-workkeel-observer.mjs` accepts an optional private file named
`host-usage-bindings.json` in its existing service state directory. It contains an
array of previously approved binding IDs, with at most 32 entries. The file must
be regular, non-symlinked and readable only by its owner. The service reloads this
explicit list before each collection cycle, normally every five seconds, without
overlapping reads. Adding or removing an ID takes effect on the next cycle after
any in-flight collection finishes; restarting the website is unnecessary.

This does not create bindings or launch models. The collector writes measurement
metadata; the HTTP observer remains read-only. Existing file notifications update
the observer index and connected pages. Remove a binding from the list to stop
future automatic collection; removal does not erase its known measurements or
close its binding. Keep a binding listed until a late host completion row has
arrived, including the main conversation's final response. Close the binding
separately when retaining its final known subtotal.

A missing configuration file means an empty collection list. Invalid or unsafe
configuration pauses collection for that cycle; the old list is not reused. The
HTTP observer stays available with its existing measurements, and collection
resumes after a valid list is restored. Individual binding failures are isolated
and retried without preventing other listed bindings from being collected.
Errors are logged without source paths or configuration contents. Shutdown waits
for the active collection and starts no further binding reads.

Every new operation still requires its own approved exact binding and explicit
list entry. This is not automatic session discovery, permission to scan other
conversations or proof of whole-task coverage. No global model settings or
accounts are changed.

Closing collection with `usage close` frees an open slot while preserving the
original binding, measurements and duplicate-source guards. A completed host turn
can still receive late metadata, so it remains open until explicitly closed.
The capture helper similarly retains up to 1,024 ledgers, with at most 128
unfinished clocks. It never removes a finished ledger automatically.

The store is bounded to 1,024 retained bindings, 128 open collectors and 4,096 response/report identities per
binding, with a 1 MiB record limit. Source reads use incremental byte checkpoints
and bounded metadata rows; limits and identity changes produce an explicit
incomplete result. Archive or export retained measurements deliberately before
reaching the inventory limit; the collector does not silently delete history.

The adapter and normalized report format are covered by offline fixtures. A live
read from an explicitly bound local session verifies the installed host format;
it does not prove coverage of unobserved agents or unsupported host versions.
