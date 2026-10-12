# Native execution reports

The observer can show measurements from a coding tool, a local model runner or
another runtime. It reads normalized metadata; it never calls a model to obtain
time, tokens or explanations. Collection is optional and separate from task state.

For new operations, use the [capture helper](#capture-an-operation-from-start-to-finish)
to attach the exact host source, record work intervals and finish its report under
the original identity. The [delivery helper](workkeel-native-dispatch.md#compact-resumption-and-execution-receipts)
also remains available for hosts that already measure their own intervals.
The host still has to provide measurements. The helper does not discover sessions,
infer model activity or grant permission to read another conversation.

## Scope and meaning

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

### Token breakdown and field coverage

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

## Bind an approved operation

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

### Recording boundaries for new work

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

### Source-turn references and gaps

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

## Capture an operation from start to finish

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

## Report from another runtime

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

## Optional continuous collection

### Explicit activity and dispatch identity

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

### Background collector

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
