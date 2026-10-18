# Daily work: brief, handoff and observation

Optional check/link observations are append-only project-local data under
`.ai-org/observations/`, with an exact `*` ignore policy like the execution journal.
They do not create untracked product changes or publish conversation links through
ordinary Git staging. Export needed records deliberately when preserving evidence;
changing the ignore policy blocks new observation writes for inspection.

Use this path in an initialized task-first project. Your coding-tool conversation is
the place to agree on work and execute it; the optional observer is read-only.
No desktop plugin, global model change, background service or extra dependency
is required. Commands below use `workkeel` as shorthand for
`node /path/to/workkeel/bin/workkeel.mjs` from the reviewed source checkout.

## Keep one delivery together

Use one native task for one approved user outcome. Implementation, documentation,
review and verification can be dispatch nodes under that task. Before intake,
check their shared files, dependencies, candidate integration and release boundary.
Use the existing dispatch planner for parallel nodes with nonconflicting scopes.
Separate checkouts are appropriate when independently claimed tasks need separate
candidates; a combined checkout must not bypass either task's path restrictions.

Check the brief's paths, current launcher, approval/document conventions and
publication prerequisites before pinning it. Run the relevant inexpensive checks
before the final full suite. A changed approved scope still requires explicit
authority; never edit a pinned contract merely to make a candidate fit.

For resumption, start with the [compact delivery context](workkeel-native-dispatch.md#compact-resumption-and-execution-receipts).
Read required project instructions and follow the current scope, attention reasons,
candidate and evidence references. Open detailed history only to resolve a concrete
question. A status question needs no new claim or repeat of completed verification.
Task creation, handoff and local acceptance do not establish external publication.

The default delivery path uses the existing [native lifecycle requests](../getting-started/workkeel.md#claim-deliver-review-accept):
read current task facts, save the complete request, inspect it, then apply it with
the pinned native CLI. Use the documented request fields and relevant references;
required project instructions and the approved contract remain mandatory.
The source-checkout `guide` and `prepare` helpers are experimental and are not
required by this path. The helper adds intermediate steps and is intended
for explicitly scoped evaluation; see [its limits](workkeel-native-dispatch.md#direct-and-prepared-delivery-requests).

## One brief instead of repeating the full contract

When work has approved supporting decisions, preserve their original sources in a
[requirement bundle](requirement-fidelity.md) before intake and reference it in the
new brief. Summaries, current code and old screenshots cannot replace those
decisions. Applicable criteria must survive derived implementation tasks; discovery
assesses them without claiming fulfillment. Do not rewrite an existing contract.

For relevant work with reusable prior evidence, use native
[Learning search and use records](../extensions/workkeel-learning.md). Query the
task's concrete topic, check applicability, and record a decision only when the
guidance actually changes the work. Found/read/applied/outcome remain separate;
there is no mandatory retrospective for every task or silent historical import.

Run `workkeel start .` to identify the next setup step and obtain an incomplete
brief draft. After saving the approved brief, `workkeel start . --request brief.json`
connects to the same intake preview below. Neither command writes or dispatches.

Ask the coding agent to turn your approved goal, acceptance and boundaries into
`brief.json`. The identities must already exist in the project's policy. Save
the actual approval and data policy in `docs/work-order.md`; the example is not
an approval grant. Missing facts must remain unresolved.

```json
{
  "schema_version": "workkeel.task-brief/v1",
  "id": "WK-cart-total",
  "goal": "Correct cart totals",
  "actor": {"agent_id":"builder","principal_id":"owner"},
  "acceptance": ["Totals round to exact cents"],
  "exclude": ["Deployment"],
  "environment": {
    "cwd":".","read_paths":["src","test"],"write_paths":["src","test"],
    "tools":["node"],"resources":[],"network":{"mode":"none","hosts":[]},
    "external_actions":[],
    "data":{"classification":"internal","model_access":"none","policy_refs":["docs/work-order.md"]}
  },
  "authorization": {
    "approved_by":"owner","approval_ref":"docs/work-order.md",
    "operations":["read","write","execute"],"expires_at":null
  }
}
```

The example allows no model access to task data. Approve the actual connection
and data handling explicitly before sending task data to a model. Paths, tools,
network and authority are never inferred from the goal. Optional `include`,
`dependencies`, `risk_tier`, `skills`, `execution` and `operation_id` preserve
the full native contract's controls. Defaults are native host execution, standard
risk and the project's existing review separation, with no claim or dispatch.

```sh
workkeel intake preview . --request brief.json
workkeel intake apply . --request brief.json --fingerprint <fingerprint-from-preview>
workkeel task summary . --id WK-cart-total
workkeel monitor .
```

Inspect the returned contract before applying. If the brief, policy or approval
bytes change, obtain a fresh preview. Apply calls the existing native creation
guard. Identical replays do not create duplicate tasks. Continue with the existing
[claim, handoff, review and close commands](../getting-started/workkeel.md).
Only separately approved [workflows](workkeel-workflows.md) launch a model.

Keep each executor's prompt bounded to its goal, permitted files, relevant
interfaces, acceptance and required instructions. Link supporting evidence instead
of copying the full parent discussion into every node. One executor reports its
own work; the coordinator alone performs lifecycle mutations. Prepare each exact
host binding at dispatch and complete its report before the task's closing steps.
Use the [capture helper](workkeel-native-usage.md#capture-an-operation-from-start-to-finish)
when the host does not already report active intervals. Begin before product work,
pause during waits, resume only while working, then finish and inspect the receipt.
Keep the original binding while waiting for a late host completion row. Explicit
source metadata is required; a missing child report is not evidence of zero usage.

## Handoff and quality

`task summary` reports the current lifecycle, goal, acceptance, next action,
exact delivery revision, handoff/review/closeout summaries, evidence digest state
and task timeline. Rework counts rejected native deliveries, not arbitrary model
requests; workflow attempts remain separately visible. `formal_first_review_pass`
and `formal_rework_count` describe only native delivery reviews; the older
`first_review_pass` and `rework_count` fields retain that meaning for compatibility.
First-review quality is unknown before a review. Lifecycle duration includes waits and human/coordinator
work; recorded time and tokens cover workflow runs and explicitly bound native
reports only.

Use the [delivery report check and review packet](workkeel-native-dispatch.md#check-expected-operations-before-handoff-and-closeout)
to check expected bindings before handoff and reports before acceptance. The
distinct reviewer inspects the delivered candidate and records its judgment in
the same turn; the coordinator must not impersonate that reviewer.

Keep coordination with the Agent that already knows the task. Use programs for
numeric reports and evidence checks; creating another Agent solely to copy
numbers, update status or reformat a report adds another context handoff.
For measurement-enabled work, declare preparation, implementation, review and
closeout in the expected work plan before detailed execution. Follow the
[recording-boundary table](workkeel-native-usage.md#recording-boundaries-for-new-work)
immediately after claim. Inspect excluded responses at begin and preserve pending
terminal collection through closeout. A mixed coordinator turn must not be
reported as several invented stage operations.
Delegate a separate implementation only when its scope is independent enough to
justify that handoff. Actual independent review remains a separate responsibility.
For a small coupled helper, test and documentation change, keep implementation
with that coordinator and dispatch only the distinct review. Do not create a
separate Agent simply because the changes occupy several files.

Prepare delivery documents before committing and verifying the final candidate.
The optional [evidence preflight and report](workkeel-native-dispatch.md#delivery-evidence-preflight-and-report)
checks explicit files and produces a numeric summary from existing receipts.
Then run the required repository gate on that candidate. If documentation is
added later, check it before pinning it as evidence. Preserve already accepted
evidence bytes. A generated report never substitutes for executing verification
or obtaining an actual independent review.

Use the same expected-operation list for handoff and closeout reporting. The
delivery check separates native task acceptance, terminal source collection and
required metric completeness. A completed task can still have a pending source;
keep that binding and its explicit follow-up instead of reopening the task or
inventing missing time. Record any remaining reporting gap in closeout evidence.
When a late terminal row arrives, collect that same source and generate a new
snapshot outside the candidate or under the existing ignored private capture
directory. Do not revise evidence bytes already pinned by handoff or acceptance.
Usage observation, activity end and collection timestamps remain separate; late
token rows never extend a stopped activity clock.

Timeline rows distinguish a failed review followed by rework from a voluntary
release of the task claim. A release returns the task to intake so another
executor can claim it; it does not establish a review failure. New history events
retain the operation summary and review judgment in their hash chain. For older
events, the observer can recover the summary from a bounded, task-local operation
request only when its complete request digest matches that history event. Missing
requests stay unexplained; the current task title is not a transition reason.

## Optional attributed observations

After a test or GitHub read, the coordinator may explicitly record bounded
metadata with `workkeel task observe . --id WK-cart-total --request observation.json`:

```json
{
  "schema_version":"workkeel.task-observation/v1",
  "task_id":"WK-cart-total","task_version":1,
  "actor":{"agent_id":"builder","principal_id":"owner"},
  "candidate_revision":null,
  "observed_at":"2026-09-25T00:00:00.000Z",
  "source":"Coordinator local check",
  "sample_kind":"real-task","comparison_group":null,
  "checks":[{"name":"Focused tests","status":"pass","evidence_ref":"docs/check-result.md"}],
  "links":{"conversation":null,"pull_request":null},
  "note":"Recorded check result; review and acceptance remain separate."
}
```

Use actual task version, time, check result and evidence, never these placeholder
claims. Candidate is an exact commit or null; evidence files are pinned by digest.
Supported links are `codex://threads/<UUID>` and ordinary HTTPS GitHub pull-request
URLs without query strings. A conversation link opens an existing known task; it
does not discover or read other conversations. Missing links stay absent.

Records are append-only and content-addressed under `.ai-org/observations/<id>/`,
with a 64-record bound. They are attributed observations, not provider-authenticated
facts or lifecycle approval. Reading does not contact GitHub. The latest timestamp
selects the displayed record; stale candidates, changed evidence and unknown data
are labeled. Do not store credentials, raw provider messages or sensitive output.
Use `real-task`, `paired-experiment`, `fixture` or `unspecified` to keep samples
separate; a grouping label alone does not prove a matched comparison.

### Source reviews before delivery

An optional `pre_delivery_review` field records a source review performed during
build, before formal handoff. Keep the full observation fields above, set the
actual current build-stage task version and non-null candidate commit, and add:

```json
{
  "pre_delivery_review": {
    "review_id":"source-review-1",
    "judgment":"fail",
    "findings_count":2,
    "evidence_ref":".ai-org/artifacts/WK-example/source-review-1.md"
  }
}
```

Use actual results and a registered actor. The evidence file is required and
pinned. Keep a stable review ID on retries; identical replay does not double count,
and changed content under that ID is rejected. A later review of a repaired
candidate gets its own ID and evidence. Do not rewrite a failed observation.

`quality.pre_delivery_review` summarizes all verified records: recorded reviews,
failed reviews, reported findings and their attributed candidate/evidence refs.
Counts describe recorded observations only, not every review or every unique
defect. They stay null when none were recorded or evidence is unavailable. A
finding reported in two reviews counts in both. `independence:not-asserted` means
attribution alone cannot prove that another actual Agent reviewed the source.

Pre-delivery observations never satisfy the formal review gate or change native
task history. A formal first pass can coexist with earlier source-review failures;
neither field alone establishes end-to-end speed or token savings. Older ordinary
observations remain supported, and the observer still reads data without models.

## Observer surfaces and limits

- **Work overview:** attention-first cards, search and status filter.
- **Task detail:** next action, acceptance, recorded execution time by stage,
  timeline, delivery evidence and observed links.
- **Usage & quality:** per-task sample kind, token coverage, recorded operation time,
  rework and review. It does not rank models or infer subscription costs.

The stage chart intersects recorded dispatch-to-completion intervals with the
task's implementation, review and rework stages. Overlapping intervals count once
in task details. Time without an execution interval, including time awaiting a
person, is never filled in from lifecycle residence. These intervals include the
execution tool's work; they are not measurements of model compute alone. A missing
completion timestamp or stage history leaves that portion unavailable or
unassigned. A recorded zero is preserved; missing measurements are not zero.
Usage analysis instead sums matching operations, so parallel work can make its
total larger than the non-overlapping time in task details.

Host-owned tasks report lifecycle transitions independently from usage. The
optional [native measurement collector](workkeel-native-usage.md) reads metadata
from explicitly bound operations; it does not scan unrelated conversations or
call models. Native tokens can arrive before timing. A total turn duration is
kept separate when human waiting cannot be excluded; only measured execution
intervals appear in stage and activity charts. Task content, documents and events
remain available when either measurement is missing.
The activity page opens its bounded event list by default;
the backlog separates current tasks from retained pre-migration history and links
document counts to each task's document list.

The indexed viewer validates the execution inventory when rebuilding its local
projection. Task summaries use bounded concurrency and a memory cache invalidated
by changes to their source files; fresh reconciliation runs every 30 seconds.
Task details and documents are revalidated when opened. The compatibility
full-snapshot endpoint uses fresh reads without this cross-request cache.
This changes no authority or acceptance rules.
Attributable errors mark the affected task incomplete; unknown run attribution marks every
task's measurement total incomplete. Healthy task state can remain visible.
Fatal snapshot errors hide old content until recovery. The indexed workspace supports
up to 2,000 native tasks; the compatibility full-snapshot endpoint remains capped at
200. Execution inventory remains bounded at 4,096 entries and responses at 4 MiB. Retained legacy
tasks are excluded from the visible-task count. This is a point-in-time,
single-project view; it does not guarantee process liveness or collect arbitrary
native-session tokens. Keep the capability URL private and stop with Ctrl-C.

## Repository maintenance

Run Doctor after moving a checkout. Do not make missing historical commits pass
by suppressing evidence checks. Large historical experiments remain frozen
reproduction instruments unless a named task explicitly maintains them; no
age-based deletion is implied. Before archiving historical evidence, verify every
digest and read back a selected original. Removing a working-tree
file neither shrinks Git history nor proves that its references are unused.
