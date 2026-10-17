# Native dispatch and model selection

The main conversation keeps the user's selected model. Newly delegated operations
get explicit selections, bounded scopes and generated execution IDs. Nicknames are
optional. Registered actors remain accountability keys, separate from models.

## Supplied-source review

Trusted embedding code can opt into
`createLocalCodexSubscriptionRuntime(target, { sourceReview: true })` when the
coordinator has supplied the complete source packet and applicable requirements.
This is separate from repository review, which may need file-reading tools. It
does not become the default for every review activity.

This mode requires a fresh conversation, no write roots, named Skills, external
resources or tool networking. The local host checks the installed protocol version,
disables executable/image/browser tool features and Skill discovery, and the
runtime sends empty environment/capability lists. Effective configuration must
confirm restrictions before inference. Unexpected tool or unknown operation events
fail the review. Permissions, model identity, expiry and usage checks still apply.

The model receives the supplied packet without instructions to discover repository
files or append lifecycle reporting fields. The requested answer format is retained
inside the normal runtime result's `output`; the coordinator records checks, Skill
use, provenance and acceptance separately. Missing source context needs attention,
not an inferred clean review. Resume and combinations with repository-role contracts
are rejected. Existing ordinary coding callers retain their behavior.

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

### Layered settings for new operations

The desktop policy editor independently configures model, reasoning and service
as inherited, automatic or fixed. It can narrow the model catalog already approved
for the task. A saved draft needs exact-version approval; neither save nor approval
starts an operation. See [desktop settings](workkeel-workspace.md).

To authorize runtime adoption, a new pinned dispatch policy may include:

```json
{"model_policy":{"policy_id":"project-routing","version":1,"sha256":"exact-approved-policy-digest","min_quality":0}}
```

This is an additional field on the existing dispatch policy, not a complete policy
file. Each approved model entry can additionally declare `reasoning_efforts` and
`service_tiers`. Those explicit lists constrain the selected tuple; absence does
not authorize overriding scalar reasoning or inventing service support. Approve
the policy bytes through a new native task contract before dispatch. Existing
immutable contracts and tickets cannot adopt changed policy files.

New `dispatch prepare` requests optionally include `model_policy` with the exact
`policy_id`, `version`, `sha256` and optional `context:{role}`. The pinned bridge
also applies when the request omits this field. Task, node and activity context
comes from the actual task and dispatch node. Model allowlist, data classification,
risk, approved quality floor and actual host support are hard constraints. High
risk retains the conservative alias constraint. Cost/quota preferences cannot lower
those constraints. Same-layer conflicts and unavailable fixed values fail explicitly.

Layered capabilities include each model's `service_tiers` as well as its reasoning
list. The resulting immutable ticket contains `model_snapshot`, the policy pin and
the exact capability fingerprint. Requested, selected and reported values remain
distinct. New operations require the active exact approved policy version; already
prepared tickets retain their historical approved version after later activation.

For a layered ticket, `dispatch bind` also requires `capabilities` and an attributed
`runtime_selection:{provider,model,reasoning,service}` matching that exact tuple.
Direct `usage bind` must supply the same proof in `routing_ack`; it cannot bypass
the routing guard. A capability declaration alone is not execution proof, and local
acknowledgements are not provider-authenticated records. The host must genuinely
select and enforce the declared settings before reporting them.

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
5. Before product work, use the [capture helper](workkeel-native-usage.md#capture-an-operation-from-start-to-finish)
   to bind the returned exact thread/turn and start its activity clock. Hosts that
   already measure intervals can use `dispatch bind` with `{execution_id,source}`.
   Binding rechecks active dependency/conflict limits. A local runner or
   other host uses `source.kind:"host-report"`; the optional Codex reader uses an
   explicitly selected rollout path. No unrelated conversations are discovered.
6. Finish the capture and inspect its receipt, or report the host's own usage and
   actual intervals. Retry collection after a late host completion row without
   restarting the clock. Pause while awaiting a person. The coordinator
   must not count idle waiting for a child as its own work. Preserve unknown data.
7. An actual different Agent reviews the exact candidate and records the ordinary
   lifecycle review. Prepare/bind its operation before handoff; existing bindings
   may finish afterward. A new binding after handoff is not authorized by the old
   implementation claim. A generated ID alone does not prove independence.

The source-checkout [delivery helper](#compact-resumption-and-execution-receipts) provides `context`,
`attach`, `finish`, `check` and `review` commands over these existing APIs. Experimental
`guide` and `prepare` commands are retained for explicit evaluation; they are not
the default lifecycle entry. The helper fills immutable ticket
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

New dispatch preparation retains the original claim body before creating its
ticket. Identical retries do not replace that proof. Some older cancellations
removed the active claim ID. An older historical dispatch then remains unavailable
unless an operator explicitly retains the original task body
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
Missing proof is reported as `host-claim-proof-missing`; invalid proof is
`host-claim-proof-invalid`. Neither error is a media-file error. Never reconstruct
an old claim from a ticket or reinterpret unavailable usage as zero.

The source repository's development dispatch policy is private, project-owned
configuration. Its model choices and worker limits are not provider restrictions
imposed on other projects.

## Compact resumption and execution receipts

These optional source-checkout helpers reuse the native task, dispatch and usage
APIs. They require no new dependency, service, provider or model call. They reduce
repeated task-history output and repeated entry of ticket identity fields. The
execution host still starts Agents and supplies its own measurements.

### Delivery evidence preflight and report

Before handing off, recording review, or closing, inspect the exact pending
operation's candidate files. Save an input containing `task_id`, `action`
(`handoff`, `review`, or `close`) and `request` (the complete pending native
operation request, including the exact candidate and evidence paths):

```sh
node /path/to/workkeel/scripts/workkeel-delivery-preflight.mjs candidate /absolute/project /private/candidate-request.json
```

This read-only command shares file classification with the lifecycle writer.
`candidate_files_passed` describes files only, not permission, verification or
review. It identifies out-of-scope committed changes, product drift, unlisted
reports and changes to already tracked candidate artifacts. Output is bounded;
`truncated` and counts identify omitted rows. The actual operation still rechecks
the current claim, authority, version, dependencies, evidence and separation.

Prepare analysis programs and delivery documents before the verified candidate.
Later local analysis programs belong in ignored output; their report files may
be named explicitly as new administrative evidence. Do not rename code as a report
to bypass the product gate. A new snapshot needs its own evidence path; listing an
old tracked report never permits changing its bytes. Preserve existing pinned
reports and save late measurements under new names.

The optional source-checkout command reads existing task-bound receipts and an
explicit list of evidence files. It does not collect sessions, call models or
perform lifecycle transitions. Use it to prepare delivery documents before the
final candidate checks, then repeat the evidence check against the committed
candidate before handoff.

```json
{
  "task_id":"WK-example",
  "expected":[
    {"label":"implementation","activity_kind":"implementation",
     "binding":{"kind":"dispatch","id":"<prepared UUID>"}}
  ],
  "candidate_revision":"<exact 40-character commit>",
  "evidence":[".ai-org/artifacts/WK-example/approval.md"]
}
```

```sh
node /path/to/workkeel/scripts/workkeel-delivery-preflight.mjs check /absolute/project /private/preflight.json
node /path/to/workkeel/scripts/workkeel-delivery-preflight.mjs report /absolute/project /private/preflight.json
```

Both commands write to stdout only. `check` produces JSON; `report` produces an
English Markdown table. They return a nonzero exit status when evidence preflight
fails. Evidence must be bounded regular files, match the exact current Git
candidate and pass the same documentation language policy as repository checks.
Untracked files, changed bytes, symlinks, stale candidates and invalid authority
evidence remain visible as failures. A localization-looking filename alone does
not exempt a document from the repository language policy.

If a generated report is part of candidate evidence, save it before final
verification and check it with the other documents. Later measurement snapshots
belong outside the candidate or in the existing ignored private capture directory;
do not rewrite pinned evidence or create unlisted files during review. The report
describes the supplied candidate and measurement snapshot, not a future revision
containing the report.

Totals add only known values from declared operations. Unknown is different from
zero; partial subtotals include their coverage. Cached input is already included
in input and is never added to it again. Summed operation time includes parallel
work and is not elapsed task time. A completed expected list cannot establish
that every task operation was declared. The main conversation may still have an
uncollected tail at the time of a snapshot.

`evidence_preflight_passed` concerns only these evidence checks. Full verification
and independent review remain unperformed by this command, even when a file is
named `verification.md` or contains a passing claim. Run the applicable gate on
the exact candidate, preserve its actual output, and have the distinct reviewer
record the normal native review. This command grants no execution or acceptance
authority and does not replace native lifecycle guards.

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

### Prepare a lifecycle request

**Experimental, not the default delivery path.** Use the existing
[direct native requests](../getting-started/workkeel.md#claim-deliver-review-accept)
for ordinary work. The helper adds intermediate steps; no general time or
Token benefit has been established. No instruction to use this helper overrides
the project's scope or candidate checks.

For explicit evaluation from a reviewed source checkout:

```sh
node /path/to/workkeel/scripts/workkeel-delivery.mjs guide /absolute/project WK-example
```

This read-only response combines the compact context with the current operation's
required fields and one instruction. Scope, acceptance and evidence warnings remain
complete. Read required project instructions, the approved contract and relevant
evidence; load the detailed operation reference when a question remains. The helper
is source-checkout tooling, not a new installed CLI command or bundled npm script.

The same helper prepares mechanical fields without changing task state. Save an
input with actual decisions, for example a completed handoff:

```json
{
  "task_id":"WK-example",
  "action":"handoff",
  "actor":{"agent_id":"builder","principal_id":"owner"},
  "operation_id":"handoff-1",
  "summary":"Describe the actual changes and completed checks",
  "evidence":[".ai-org/artifacts/WK-example/developer.md"],
  "unresolved":[]
}
```

```sh
node /path/to/workkeel/scripts/workkeel-delivery.mjs prepare /absolute/project /private/decision.json > /private/prepared.json
```

Inspect the returned `request`, including its exact revision. Save only that field
as a task-local request file, then use the existing pinned native command:

```sh
workkeel task handoff . --id WK-example --request .ai-org/artifacts/WK-example/handoff.json
```

The example's private decision and prepared-output files are outside the product
repository. A decision input is not a recorded native request. Placing it under
task artifacts does not automatically exempt it from candidate checks. Preserve
it only within authorized locations; where it is deliberately retained as task
evidence, list the exact file in the applicable evidence references. Do not add
ignore rules or delete evidence merely to get past a candidate rejection. Inspect
the task and the file's purpose before retrying the identical saved request.

| Action | Caller supplies, in addition to task, action, actor and operation ID | Derived fields |
| --- | --- | --- |
| `claim` | No decision fields | Current task version and Git HEAD |
| `handoff` | Actual summary, evidence and explicit empty unresolved list | Current version, claim ID and Git HEAD |
| `review` | Actual review judgment, summary and evidence | Current version and delivered revision |
| `close` | Actual acceptance summary, rollback and evidence | Current version and delivered revision |

Preparation neither runs checks nor validates all candidate/evidence conditions.
`validation_status: native-apply-required` means the ordinary native command must
still check authority, dependencies, version, candidate, scope, evidence and reviewer
separation. Input cannot override derived fields. No verdict, summary, evidence,
actor or operation ID is invented. A distinct actual reviewer still owns review;
preparing a request does not make the caller independent or grant acceptance authority.

Save requests before applying. After an uncertain write, inspect history and replay
the identical saved request. Preparation refuses already-recorded operation IDs;
it must not silently refresh a stale request or change its meaning on retry. A
failed review needs the existing explicit rework path. Cancellation and release
also retain their existing native commands. No new model, network call or lifecycle
mutation is performed by `guide` or `prepare`.

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

Complete available reports before release, rework, cancellation or task close.
If the host writes its terminal row only after the reporting turn ends, explicitly
retain the pending binding for later collection and disclose the gap in closeout.
Do not mark the source completed or infer activity to make a report look final. Existing
pre-bound reporting across handoff retains its validated authority; a convenience
helper does not create a new implementation claim or authorize a new binding.
Independent review and local acceptance remain separate lifecycle commands.

### Check expected operations before handoff and closeout

Keep an explicit, task-local list of expected operations. Include the coordinator
and each implementation, repair, review or verification operation that actually
takes place. Declare an unbound operation with `binding:null`; do not omit it to
make coverage look complete. A host binding supports the coordinator without
changing the main conversation's model. Dispatch bindings use the prepared UUID.

```json
{
  "task_id":"WK-example",
  "expected":[
    {"label":"coordinator","activity_kind":"planning","binding":{"kind":"host","id":"coordinator-binding"}},
    {"label":"implementation","activity_kind":"implementation","binding":{"kind":"dispatch","id":"<prepared UUID>"}},
    {"label":"repair","activity_kind":"repair","binding":null}
  ]
}
```

```sh
node /path/to/workkeel/scripts/workkeel-delivery.mjs check /absolute/project /private/expected.json
```

Before handoff, check `bindings_ready`, especially for the reviewer: new bindings
require the active build claim. After executions finish, run their reports and
check `declared_reports_complete` before local acceptance. Each row distinguishes
missing binding, unavailable record, incomplete report and reported operation.
Completion here requires an observed source, a completed operation, active time,
input tokens and output tokens. Other token counters and model fields stay visible
as missing when unavailable; measured zero is valid. This is a reporting check,
not a replacement for task authority or a mandatory acceptance gate.

The same check also exposes `task_state`, `task_locally_accepted` and `collection`.
These answer separate questions: was the task accepted, have the declared sources
reached an observed terminal outcome, and are the required measurements present?
`collection.status` is `completed`, `pending`, `stopped` or `unavailable`;
its counts retain missing bindings and its follow-up list identifies unresolved
operations. A terminal interrupted operation can finish collection without being
a successful execution. An explicit stop does not certify final source coverage.
Unavailable or mismatched bindings and inventory errors prevent collection from
being summarized as complete. Existing report-completeness requirements stay unchanged.

Each receipt includes `cutoffs.usage_observed_at`, `activity_ended_at` and
`collected_at`. The first requires an observed token counter, the second comes
only from recorded execution intervals, and the third is the collector's timestamp.
`usage_observed_after_activity` is null if either cutoff is unknown. True means
the usage observation is later; it cannot distinguish late recording from unmeasured
work and does not authorize extending activity time or calculating tokens per second.
The Markdown preflight report shows these cutoffs and follow-up actions together.
Checks read existing sanitized records without opening raw execution sources or
changing the task. Collect a pending source explicitly, then rerun the same check.

`task_coverage_complete` always remains false. The list is caller-declared and
cannot prove that no work was omitted. `unlisted_binding_count` exposes additional
recorded operations in this task, while corrupt project inventory stays explicit.
No unrelated conversation is searched and no source is collected by this check.
Missing history stays unknown. Add a repair operation when repair begins; do not
invent one with zero time just because no repair was recorded.

### Review and record in one actual reviewer turn

Prepare the exact candidate, verification evidence and a bounded review packet
before starting the distinct reviewer. Prepare its ticket and bind the actual
turn while the build claim is active, then hand off that candidate. Pass the
reviewer the task ID, execution ID, candidate and evidence paths. The reviewer
can obtain the packet after handoff:

```json
{
  "task_id":"WK-example",
  "execution_id":"<pre-bound review UUID>",
  "reviewer":{"agent_id":"reviewer","principal_id":"owner"}
}
```

```sh
node /path/to/workkeel/scripts/workkeel-delivery.mjs review /absolute/project /private/review-packet.json
```

The packet contains changed paths, acceptance criteria, evidence references and
a request template with the exact delivered revision and current task version.
Judgment, summary, evidence and operation ID are deliberately unset: the actual
reviewer supplies them after inspecting the candidate. It then records `task
review` in that same turn. Do not spawn another turn solely to copy a verdict.
A failure is recorded as a failure and follows the ordinary rework path.

The packet requires the current delivery's pre-bound review ticket and a
registered reviewer satisfying separation. It grants no authority and does not
verify product changes; the native review command still checks drift, evidence,
dependencies, current approval and identity. Finish that review's usage report
before the authorized coordinator records local acceptance.

If that review is interrupted before a verdict, do not cancel or recreate the
task. Close its usage collection as stopped and follow
[interrupted review recovery](workkeel-review-recovery.md), which also describes
the opt-in role preflight for dispatched roles.

For future real product work, record the same fields and review/repair outcomes.
Do not invent an unrelated product task or model benchmark to fill the dashboard.
Compare only compatible recorded scopes; publishing, user waiting and unmeasured
work must remain explicit. This helper does not alter the observer UI or learning
promotion rules.

## Direct and prepared delivery requests

### Decision

Ordinary work uses the [direct native lifecycle](../getting-started/workkeel.md#claim-deliver-review-accept).
The source-checkout `guide` and `prepare` helpers remain experimental, available
for explicitly scoped evaluation. There is no established efficiency benefit.
This correction changes human-facing entry guidance, not executable behavior,
task stages, model policy, candidate checks or review independence.

### What differs

| Step | Direct requests (default) | Guided preparation (experimental) |
| --- | --- | --- |
| Read | Required project instructions, approved contract, relevant native request reference | The same mandatory sources plus a current-stage `guide` response; full references on demand |
| Decide | Actor, operation ID, actual summary, evidence, verdict and acceptance | The same human/Agent decisions; the helper cannot make them |
| Build request | Fill current version, claim and exact candidate in one complete request | Save decision input, run `prepare`, inspect its returned request, save that request |
| Apply | Inspect and submit the saved request to the native CLI | Submit the saved prepared request to the same native CLI |
| Guard | Authority, current version, exact candidate, scope, evidence, distinct review | The same unchanged native guards; successful preparation is not acceptance |
| Recover | Inspect state/history and replay the identical saved request when appropriate | The same recovery requirement, plus lifecycle management for intermediate input/output files |

The helper derives mechanical fields. That can avoid a transcription error, but
it also adds calls and intermediate artifacts. The direct route does not require
re-reading entire manuals at every transition, skipping review or guessing fields.
Existing compact context and execution reporting remain available in both routes.

### Evaluation boundary

Prepared requests add intermediate files and calls. Their effects on time,
Tokens, and quality depend on the task and host; no public benchmark dataset is
included here. Evaluate a specific candidate with frozen inputs, real checks,
and separate review before changing the default direct route.


### Optional test evidence recording

For an approved Node test run, `record-check` records a real Node test
run without changing task state. Direct native lifecycle requests remain the
default; the recorder performs no lifecycle operation. This utility is available from the
source checkout; it is not included in the npm package.

```sh
node /path/to/workkeel/scripts/workkeel-delivery.mjs record-check /absolute/project - <<'JSON'
{"task_id":"WK-example","actor":{"agent_id":"builder","principal_id":"owner"},"expected_version":2,"name":"red-test","tests":["test/example.test.mjs"],"files":["src/example.mjs","test/example.test.mjs"]}
JSON
```

The current build claimant supplies the observed version and explicit test/source
paths. The approved environment must permit Node, repository-root execution and
reading those files and writing the task's log path under
`.ai-org/artifacts/<task>/`. This source-checkout utility currently requires a POSIX host.
It executes `node --test --test-reporter=tap` with the specified tests, records the
actual command, output, exit code and file hashes, then rechecks task authority
and declared files. The process supervisor limits execution to 60 seconds and
output to 512 KiB, and checks child-process cleanup. It never calls a model.

The JSON receipt includes the actual command and output, limited to 12 KiB per
stream, with an explicit `output.truncated` flag. Inspect that output to check
whether RED failed for the expected reason and GREEN passed. Open the preserved
log when output is truncated or more detail is needed; a separate log-reading
command is otherwise unnecessary. The full admitted output stays in the log.

Logs are created exclusively under `.ai-org/artifacts/<task>/<name>.log`. Use
separate names for `red-test`, `green-test` and any `candidate-test`; old evidence
is never overwritten. Include every retained log in handoff evidence. A failed
test returns a nonzero CLI status; that is expected for a genuine RED run. A
timeout, output overflow or failed cleanup is an instrumentation failure. Changed
declared files or task context invalidate the result. A log ending with only its
running header has no completed result. Preserve it and use a new name if an
authorized retry is needed.

The recorder verifies only the explicitly listed files. It is not a sandbox or
a complete inventory of test dependencies; the execution host still enforces
path, network and data boundaries. A passing receipt proves that this recorded
command passed on those inputs. It does not grant task acceptance, establish
independent review or prove all requirements were tested.

### Recorder adoption limits

For original candidate/environment snapshots and separate criterion confirmation,
use the optional [check evidence adapter](workkeel-review-assessment.md#original-check-evidence). It composes
this recorder with the existing assessor and retains exact bundle/log handoff
registration. Raw receipts without original snapshots cannot be backfilled.

The recorder remains optional and direct lifecycle requests remain the default.
It supports approved Node tests on POSIX hosts and imposes no provider or model
requirement. A receipt is evidence for the recorded command and listed inputs;
it does not prove the whole task or grant acceptance. Private comparison runs
are outside this public source repository.


### Next improvement boundary

Before another live comparison, define a supported lifetime for decision inputs
and prepared output, then verify the complete prepare/apply sequence offline.
Preserve candidate scope and evidence checks. Any convenience must remove caller
steps rather than require the model to copy another intermediate JSON object.
Review claims must point to individually identifiable successful checks. No new
helper redesign, model trial, release or deployment is performed by this decision.
