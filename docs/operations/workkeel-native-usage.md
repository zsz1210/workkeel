# Native execution reports

The observer can show measurements from a coding tool, a local model runner or
another runtime. It reads normalized metadata; it never calls a model to obtain
time, tokens or explanations. Collection is optional and separate from task state.

For newly delegated work, use the [delivery helper](workkeel-native-dispatch.md#compact-resumption-and-execution-receipts) to attach
the exact host source and finish its report under the original dispatch identity.
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

The installed Codex adapter reads bounded metadata rows such as
`token_usage_record`, `turn_context` and turn lifecycle events. The local storage
format is version-sensitive. Source identity changes, truncation and malformed
usage must remain visible as incomplete observations. No credentials, provider
request or new model turn are needed. The adapter cannot infer missing child-agent
usage or distinguish human waiting from every host-reported turn duration.

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
be regular, non-symlinked and readable only by its owner. The service loads this
list at startup and collects every five seconds without overlapping reads.

This does not create bindings or launch models. The collector writes measurement
metadata; the HTTP observer remains read-only. Existing file notifications update
the observer index and connected pages. Remove a binding from the list and restart
the owned service to stop automatic collection; close the binding to retain its
final known subtotal. No global model settings or accounts are changed.

The store is bounded to 128 bindings and 4,096 response/report identities per
binding, with a 1 MiB record limit. Source reads use incremental byte checkpoints
and bounded metadata rows; limits and identity changes produce an explicit
incomplete result. Archive or export retained measurements deliberately before
reaching the inventory limit; the collector does not silently delete history.

The adapter and normalized report format are covered by offline fixtures. A live
read from an explicitly bound local session verifies the installed host format;
it does not prove coverage of unobserved agents or unsupported host versions.
