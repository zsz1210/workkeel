# Native dispatch and model selection

The main conversation keeps the user's selected model. Newly delegated operations
get explicit selections, bounded scopes and generated execution IDs. Nicknames are
optional. Registered actors remain accountability keys, separate from models.

## Project policy

Save the reviewed policy and include its path in a new task brief's
`environment.data.policy_refs`. Approval pins exact bytes; existing contracts cannot
acquire a changed policy by editing a file afterward.

```json
{
  "schema_version":"workkeel.dispatch-policy/v1",
  "models":[
    {"alias":"small","provider":"local","model":"your-small-model","reasoning":null,"data_classes":["public","internal"]},
    {"alias":"review","provider":"your-provider","model":"your-reviewed-model","reasoning":"high","data_classes":["public","internal"]}
  ],
  "default_alias":"small","conservative_alias":"review","parallelism":2
}
```

Names above are placeholders. Use models approved and actually supported by the
host. There is no framework default vendor, paid API requirement or universal
reasoning scale. Host capabilities and permitted data classes must match.

## Dispatch sequence

1. Claim the task. Split work into nodes with `id`, `activity_kind`, `depends_on`,
   `read_paths` and `write_paths`. Kinds are `planning`, `implementation`, `review`,
   `repair`, `verification`. Review nodes are read-only.
2. `dispatch plan` takes `{policy,plan:{nodes,completed,running}}`. Its ready group
   respects dependencies, read/write conflicts and parallel limits. Record actual
   completion before requesting the next group. Planning does not launch a model.
3. `dispatch prepare` takes `operation_id`, `task_id`, `actor`, `claim_id`,
   `contract_sha256`, pinned `policy_ref`, `node`, `capabilities`, and optional
   `route`/`display_label`. Identical retries return the original UUID; conflicting
   retries stop. Keep the operation ID stable after an uncertain result.
4. Pass the ticket's `selected.model` and `selected.reasoning` explicitly to the
   host's agent-start tool with only necessary context and approved scope. If the
   host cannot select that tuple, report the mismatch; never silently inherit the
   coordinator model. The host still enforces filesystem, tools and networking.
5. `dispatch bind` takes `{execution_id,source}` for the returned exact thread/turn
   or operation. It rechecks active dependency/conflict limits. A local runner or
   other host uses `source.kind:"host-report"`; the optional Codex reader uses an
   explicitly selected rollout path. No unrelated conversations are discovered.
6. Report usage and actual intervals. Pause while awaiting a person. The coordinator
   must not count idle waiting for a child as its own work. Preserve unknown data.
7. An actual different Agent reviews the exact candidate and records the ordinary
   lifecycle review. Prepare/bind its operation before handoff; existing bindings
   may finish afterward. A new binding after handoff is not authorized by the old
   implementation claim. A generated ID alone does not prove independence.

The source-checkout [delivery helper](#compact-resumption-and-execution-receipts) provides `context`,
`attach` and `finish` commands over these existing APIs. It fills immutable ticket
identity fields when reporting, preserves explicit host measurements and returns
a compact receipt with missing fields. It does not start or schedule an Agent.
Use one operation per activity kind; a review or repair needs its own prepared
ticket and exact host binding. Report completion before releasing or closing the
task, and inspect the receipt instead of treating a successful host turn as proof
that usage was captured.

Prepare the bounded review packet when the candidate and relevant checks are
ready. It should identify the exact revision, changed paths, acceptance, completed
checks and unresolved issues. Let independent verification commands retain their
own output; the reviewer need not repeatedly reload progress while waiting.
One final behavioral candidate still needs the complete verification gate.

```sh
workkeel dispatch plan . --request plan.json
workkeel dispatch prepare . --request dispatch.json
workkeel dispatch show . --id <returned-execution-id>
workkeel dispatch bind . --request binding.json
workkeel usage report . --request result.json
workkeel usage activity . --request intervals.json
```

Capabilities have shape `{host,models:[{provider,model,reasoning:["high",null]}]}`.
`route.alias` chooses an approved model. Eligible local classifier advice chooses
its approved alias; ineligible advice and `route.risk:"high"` use the conservative
alias. Classifier metadata is `{alias,eligible,name,tier,selection_reason,model_called:false}`
under `route.classifier`. Complexity scores are not confidence probabilities.

## Existing personal LiteLLM selector

The source-checkout helper connects the already installed selector:

```sh
node scripts/prepare-workkeel-dispatch.mjs /absolute/project /absolute/request.json /absolute/personal-tool/route.mjs /absolute/private/machine.json
```

The request is `{dispatch:<prepare request>,prompt:<bounded description>,profile:"auto"}`.
Profiles are `auto`, `bounded-low-risk` and `review`. The helper maps the guarded
result to one unique approved model alias and saves selection metadata, not the
prompt. It explicitly imports a trusted local module exporting
`preview(prompt,{profile,config})`; review that executable module before use.
This helper is not a sandbox for arbitrary plugins.

The existing personal selector uses LiteLLM 1.101.0's network-disabled local heuristic
and conservative guards. It calls neither a classifier model nor LiteLLM Proxy.
The helper installs and vendors nothing, leaves the original personal tool intact,
and changes no account or global model settings. Other local classifiers may
implement the same interface. Execution through a gateway is a separate choice.

## Records and limits

Immutable tickets are ignored project-local intent records under `.ai-org/dispatch`,
bounded to 1,024 entries. A ticket does not prove execution. Usage bindings record
the exact host source, selected/reported model and activity kind. Export deliberately;
the observer serves no raw prompt, private source path or credential.

Usage analysis sums operation durations; task execution time takes their interval
union. Parallel operations can overlap, including across kinds. Explicit activity
labels take precedence over old lifecycle attribution. Unknown, partial and measured
zero remain distinct. See [native reporting](workkeel-native-usage.md).

Hosts must actually consume tickets and report execution. Workkeel cannot intercept
arbitrary desktop tool calls. Repository instructions require this path for new
approved delegation; unsupported hosts expose their selection or reporting gap.

### Retained claim evidence

Some older cancellations removed the active claim ID. A historical dispatch then
remains unavailable unless an operator explicitly retains the original task body
at `.ai-org/artifacts/<task-id>/dispatch-claim-<claim-event-hash>.json`.
The reader uses the normal task validator and requires the exact task version,
contract, actor, claim ID and complete history prefix. The last event's body hash
must match the snapshot and the current canonical chain. A copied ticket or a
reconstructed claim ID is insufficient. Missing, changed, oversized or symlinked
proofs fail closed. Readers do not scan Git or conversations to find a snapshot.

This restores access to existing measurements only. It neither revives a claim
nor permits new execution, rewrites task/ticket history, invents measurements or
accepts a delivery. Preserve the exact snapshot bytes and review the source before
retaining it; live execution still requires the current approved claim.

This repository's own [development policy](../policies/development-dispatch.json)
retains the approved personal Luna/Sol medium choices and at most three workers.
It is project configuration, not a provider restriction imposed on other projects.

## Compact resumption and execution receipts

These optional source-checkout helpers reuse the native task, dispatch and usage
APIs. They require no new dependency, service, provider or model call. They reduce
repeated task-history output and repeated entry of ticket identity fields. The
execution host still starts Agents and supplies its own measurements.

### Resume from current facts

```sh
node /path/to/workkeel/scripts/workkeel-delivery.mjs context /absolute/project WK-example
```

Read the current goal, state, scope, acceptance, next action, candidate, attention
reasons and evidence references first. Required project instructions still apply.
The view does not include the entire event timeline or evidence bodies. Open a
referenced source when needed; use `workkeel task summary` for the complete view.
Neither command claims work, revives an ended claim, verifies a running process
or authorizes implementation. Evidence and authority warnings remain visible.

Keep one approved delivery in one native task. Use dispatch nodes to divide
implementation, review, repair and verification. Before claiming, check shared
files and candidate integration, approval text, versions and publication needs.
If the actual scope changes, preserve the earlier contract and obtain appropriate
authority. Do not create replacement tasks solely to rename a node or continue
the same approved implementation.

### Attach the exact execution

Prepare a dispatch ticket using the [native dispatch sequence](workkeel-native-dispatch.md),
start the selected runtime, and save its exact source in a private request file.
The attach request is the existing `dispatch bind` request:

```json
{
  "execution_id": "<prepared UUID>",
  "source": {"kind":"host-report","thread_id":"actual-host-session","turn_id":"actual-operation"},
  "sample_kind": "real-task"
}
```

```sh
node /path/to/workkeel/scripts/workkeel-delivery.mjs attach /absolute/project /private/attach.json
```

The optional Codex reader accepts its existing exact rollout path/thread/turn
source instead. Preserve the explicit approval requirement for capture from the
start of a turn. Do not search unrelated conversations or store source paths in
public delivery evidence. Source checks, dispatch limits and claim guards remain
those of the existing binding API.

### Finish a host report

Use the same execution ID and a stable report ID on retries. The `report` object
uses the existing host-report fields; ticket identity and activity kind come from
the verified ticket. This example describes an actually model-free verification
command. Use actual model metadata and usage for model execution; unknown fields
must not be filled with zero or requested model values.

```json
{
  "execution_id": "<prepared UUID>",
  "report": {
    "report_id": "verification-result-1",
    "status": "completed",
    "usage": {"input_tokens":0,"output_tokens":0},
    "tool": "node",
    "provider": "local",
    "model": null,
    "reported_reasoning": null,
    "sample_kind": "real-task",
    "observed_at": "<actual ISO timestamp>"
  }
}
```

```sh
node /path/to/workkeel/scripts/workkeel-delivery.mjs finish /absolute/project /private/result.json
```

When the host can measure activity excluding waiting, supply
`execution_duration_ms` and `execution_intervals` with actual start/end times.
Intervals are cumulative assertions validated by the existing API. Omitting them
leaves activity unknown. Never copy full-turn duration into activity merely to
make a chart complete. Keep separate operations for implementation, review and
repair rather than relabeling a previous operation.

### Collect an already attached source

```json
{"execution_id":"<prepared UUID>","collect":true}
```

An optional `activity` object contains `report_id`, `observed_at`,
`execution_duration_ms` and `execution_intervals`. It must describe actual
wait-excluded work and pass the same cumulative-interval guards. No timestamp is
derived from task state, the current clock or a full-turn duration.

`report` and `collect` are alternative modes. Wrong-source requests are refused.
The helper does not close collection or mark a still-running source completed.
Collection and activity reporting use existing sequential operations, not a new
transaction. If collection reports a source problem, inspect the receipt and retry
the same valid report; a successful activity write alone does not prove complete
usage collection. The existing replay guard prevents a report from being counted
twice and rejects changed content under the same report ID.

### Read the receipt and stop at the right boundary

The compact receipt shows actual reported model and usage, recorded activity,
separate host turn duration when available, source state and missing fields.
Missing and measured zero remain different. A completed operation does not prove
complete task coverage. Unsupported hosts must expose their reporting gap.

Complete reports before release, rework, cancellation or task close. Existing
pre-bound reporting across handoff retains its validated authority; a convenience
helper does not create a new implementation claim or authorize a new binding.
Independent review and local acceptance remain separate lifecycle commands.

For future real product work, record the same fields and review/repair outcomes.
Do not invent an unrelated product task or model benchmark to fill the dashboard.
Compare only compatible recorded scopes; publishing, user waiting and unmeasured
work must remain explicit. This helper does not alter the observer UI or learning
promotion rules.
