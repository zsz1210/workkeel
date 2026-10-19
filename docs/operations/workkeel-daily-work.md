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
[requirement bundle](workkeel-daily-work.md#preserve-approved-requirements) before intake and reference it in the
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
Use the [capture helper](workkeel-observer.md#capture-an-operation-from-start-to-finish)
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
[recording-boundary table](workkeel-observer.md#recording-boundaries-for-new-work)
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
added later, check it before naming it as evidence. Prefer committing evidence in
the candidate, where Git keeps it immutable; handoff records paths, not digests.
A generated report never substitutes for executing verification
or obtaining an actual independent review.

Use the same expected-operation list for handoff and closeout reporting. The
delivery check separates native task acceptance, terminal source collection and
required metric completeness. A completed task can still have a pending source;
keep that binding and its explicit follow-up instead of reopening the task or
inventing missing time. Record any remaining reporting gap in closeout evidence.
When a late terminal row arrives, collect that same source and generate a new
snapshot outside the candidate or under the existing ignored private capture
directory. Do not revise evidence files already named by handoff or acceptance.
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
optional [native measurement collector](workkeel-observer.md#native-execution-reports) reads metadata
from explicitly bound operations; it does not scan unrelated conversations or
call models. Native tokens can arrive before timing. A total turn duration is
kept separate when human waiting cannot be excluded; only measured execution
intervals appear in stage and activity charts. Task content, documents and events
remain available when either measurement is missing.
The activity page opens its bounded event list by default;
the backlog links document counts to each task's document list.

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
200. Execution inventory remains bounded at 4,096 entries and responses at 4 MiB. This is a point-in-time,
single-project view; it does not guarantee process liveness or collect arbitrary
native-session tokens. Keep the capability URL private and stop with Ctrl-C.

## Repository maintenance

Run Doctor after moving a checkout. Do not make missing historical commits pass
by suppressing evidence checks. Large historical experiments remain frozen
reproduction instruments unless a named task explicitly maintains them; no
age-based deletion is implied. Before archiving historical evidence, verify every
digest and read back a selected original. Removing a working-tree
file neither shrinks Git history nor proves that its references are unused.

## Preserve approved requirements

Use this guard when an approved product decision must survive planning,
implementation and autonomous improvement. It extends native task gates without
adding another workflow or requiring a different Agent for every activity.

### Original decisions and scope

Reference a versioned JSON bundle in the task's
`environment.data.policy_refs`. Preserve original human wording and exact source
file byte digests, not only a model summary or the current implementation.

```json
{
  "schema_version": "workkeel.requirements/v1",
  "id": "interface-v1",
  "requirements": [{
    "id": "R-identity",
    "criterion": "Use official product marks for reported execution tools",
    "paths": ["src/ui"],
    "sources": [{
      "path": ".workkeel-private/decisions/identity.md",
      "sha256": "<64-character SHA-256 of original file bytes>",
      "quote": "<exact original approved wording>"
    }],
    "superseded_by": null,
    "visual": true
  }]
}
```

For new projects, the initialization policy optionally accepts
`requirements_refs: [".workkeel-private/decisions/interface-v1.json"]`.
Intake and the native API then reject omission of the entire bundle. Without that
project setting, bundles are opt-in: unreferenced decisions cannot be detected.
Existing task contracts and project policies remain immutable; do not hand-edit
them to retrofit this feature. Include bundles in newly approved task contracts,
or initialize a new project through its native policy path.

Active requirements apply when their paths overlap task write roots in either
direction. Their exact criteria must appear in task acceptance. Derived
implementation tasks inherit applicable criteria from the original contract.
Discovery retains all active decisions for assessment, even when its only write
scope is discovery artifacts.

Keep at most 8 bundles, 64 total requirements, 32 paths and 8 original sources per
requirement. Unique source text is limited to 1 MiB. Partition large projects by
approved scope rather than loading their entire history.

An approved change uses a new bundle version. Retain older entries with
`superseded_by` pointing to their replacement in that bundle. Cycles, missing
targets and duplicate IDs are rejected. Metadata does not grant authority: the new
original source must record the human-approved change. Create a newly approved
task; never overwrite sources pinned by running or accepted work.

### Execution and discovery

Prepared material includes one `requirements_alignment` row per active decision:
`{id, status: "aligned", observation}`. Conflicts or uncertainty block preparation.
Original source files are included automatically. Guarded graph runtime nodes
require prepared material. The native goal host supplies original quotations and
pins to roles and requests structured results.

Discovery returns `requirement_assessments` beside `proposals`. Each active
decision needs `id`, `status`, `observation`, `sources`, `evidence` and
`proposal_id`. Statuses are `observed-satisfied`, `unmet`, `unverified` and
`not-applicable`. Observed results need actual evidence; unmet or unknown
requirements need a linked proposal. Non-applicability needs a concrete scope
reason. Assessment does not establish product fulfillment.

The controller attempts eligible known proposals before new exploration.
Unresolved scope or risk leaves `known-findings-need-attention`; waiting calls no
model. Resolve the finding through authorized work instead of downgrading risk.
There is no automatic dismissal of manual proposals. The standing goal approver can
settle a stale or equivalent proposal with `goal dispose-proposal . --request
request.json` (`goal_id`, `proposal_id`, `disposition` of `superseded`,
`dismissed` or `needs-reevaluation`, `superseded_by` for `superseded`, and a
`reason`). The proposal stops blocking exploration; its record, evidence and any
reservation stay, and nothing is retried automatically. A separately approved repair
and a newly accepted continuation goal can establish the next baseline; the prior
proposal and its evidence remain historical. Changing source bytes alone is not
proof that a finding was resolved.

### Native delivery gates

Passing delivery and independent review each need their own evidence report:

```json
{
  "schema_version": "workkeel.requirement-outcomes/v1",
  "task_id": "WK-example",
  "contract_sha256": "<contract digest>",
  "candidate_revision": "<full Git revision>",
  "requirements_sha256": "<resolver digest>",
  "phase": "delivery",
  "actor": {"agent_id": "builder", "principal_id": "owner"},
  "requirements": [{
    "id": "R-identity",
    "status": "pass",
    "observation": "What was actually seen against the original decision",
    "sources": [{"path": "<original source>", "sha256": "<original bytes digest>"}],
    "evidence": [{"path": "<actual artifact>", "sha256": "<artifact digest>", "kind": "screenshot"}]
  }],
  "open_findings": []
}
```

The source API `loadTaskRequirements(target, contract)` returns the digest and
pins. The native goal host wraps model-authored observations with the exact task,
actor and candidate; it does not invent verdicts. Direct coordinators build the
report from the resolver and actual evidence. The distinct reviewer authors a
separate `phase: "review"` report.

Every applicable requirement must be covered. Evidence kinds are `observation`,
`check` and `screenshot`. Visual criteria need a complete supported PNG and
actual visual review. Missing, partial, failed, unverified or stale evidence cannot
pass. Failed review decisions remain recordable. Passing review rechecks delivery
evidence; close rechecks both sets. The broader
[completion report](workkeel-evidence.md#check-completion-evidence-before-delivery) records whole-scope checks and
self-reviews without supplying independent acceptance.

These are structural checks of authored judgments. They do not prove semantic
truth, image authorship, design quality or arbitrary free-text consistency. An
independent reviewer must compare the instruction, exclusions and result to the
original. A valid file digest or an unrelated passing test is insufficient.

Use positive and negative evaluations: omitted or inverted requirements, stale
references, missing evidence, legitimate supersession and a successful complete
delivery. Run affected checks during repair, then the required full gate on the
frozen candidate. Track uncovered/reopened requirements, repair rounds and
reported time/usage; unavailable usage stays unknown. Keep real evidence and
[scoped learning](../extensions/workkeel-learning.md) private. One incident does
not automatically become a framework-wide Skill.

## Task material and confirmed continuation

This opt-in task-first entry prepares navigation from the full approved contract.
It does not grant permission, prove that a model read a file, or replace acceptance.
Existing workflow v1 string inputs remain supported.

### Prepare material

```sh
workkeel context prepare . --id WK-example --request docs/material-request.json
```

The command prints a JSON packet without writing project state or calling a model.
Save that output to a new project-local file, then reference it in a workflow plan
or run request as `material_refs: { "work": "docs/material.json" }`, where `work`
is an existing runtime node. The run command still takes a `{ "run": ... }` wrapper.
Do not add packet fields to the workflow v1 node schema.

Example material request:

```json
{
  "kind": "initial",
  "instruction": "Implement the specified parser and report actual checks.",
  "write_paths": ["src"],
  "materials": [
    {"path": "docs/spec.md", "use": "required", "purpose": "specification"},
    {"path": "src/parser.mjs", "use": "required", "purpose": "source"},
    {"path": "docs/history.md", "use": "reference", "purpose": "history"}
  ]
}
```

Selected files must be inside approved read roots or already required by the
contract. Policy refs, approval, named Skills and discovered applicable project
instructions remain required. Applicable nested instructions and matching Skills
still have to be read during work. The packet binds source bytes and is checked
again before dispatch; changed material requires a newly prepared packet and run.
Keep generated packets outside policy refs to avoid a circular hash dependency.

| Kind | Additional required purposes | Write scope / candidate |
| --- | --- | --- |
| `initial` | none | Exact selected approved roots |
| `repair` | `findings` | Exact selected approved roots |
| `takeover` | `checkpoint` | Exact selected approved roots |
| `review` | `source`, `diff` | Empty writes; full `candidate_revision` |
| `rereview` | `source`, `findings`, `diff` | Empty writes; full candidate |
| `reconsideration` | `source`, `findings`, `counterevidence` | Empty writes; `prior_revision` equals candidate |

Review source files must match their Git blobs at current candidate HEAD. A point
reconsideration produces a point judgment, never a new whole-candidate PASS.
Optional material `kinds` selects applicable types; required contract refs cannot
be filtered out. Arbitrary specification text is never truncated. Requests are
bounded to 64 selected materials and 1 MiB of source text; split larger work.
`summarizeChecks` groups exact status/message pairs with all original test IDs,
without asserting acceptance. Preserve original check evidence beside summaries.

### Continue a confirmed interruption

```sh
workkeel workflow continuation-plan . --request docs/continuation-plan.json
workkeel workflow continue . --request docs/continuation-run.json
```

The plan request contains `source_run_id`, a distinct new `run_id`, `actor`,
`workflow_ref`, `policy_ref` and optional fresh `material_refs`. The successor
workflow and policy must already belong to the task's approved policy refs.
Prepare the successor workflow when authoring the task; a prompt cannot waive
an unapproved policy change. The execute request wraps those fields and the
returned digest as `{ "run": { ..., "expected_plan": "..." } }`.

Only a terminal interrupted operation with confirmed cleanup, complete journal,
unchanged Git HEAD and bounded partial product snapshot can qualify. Explicit
cancellation, an active/unknown runner, uncertain operation, changed authority,
expired approval, or source drift blocks dispatch. The default snapshot supports
bounded UTF-8 product directories (512 entries, 16 MiB), not arbitrary binaries,
symlinks, the entire repository or `.ai-org`. Unsupported snapshots remain blocked.

Continuation preserves the original operation and creates one durable successor
through ordinary release/claim operations. Retrying the exact continuation request
can finish interrupted initialization. Once a successor run exists, repeated calls
only inspect it; they do not automatically restart it. A retained diagnostic lock
still requires the existing recovery procedure. Old runs without settlement receipts
cannot be retroactively declared clean. This is not cross-host or hard-crash recovery.

The existing monitor uses a redacted read-only projection of the same checks for
its next action. Full plans, prompts, conversation IDs and source bytes are not
added to the public projection. The view does not authorize a run.

### Scope and limits

The personal `prepare-stage.mjs` wrapper and CLI use the same core preparation.
Free-text callers retain responsibility for semantic scope; this system validates
structured scopes and provenance, not the truth of arbitrary instructions.
Required materials may make a prepared packet larger. No speed, token-cost or
monetary savings follow solely from shorter optional instructions.

See [workflow execution](workkeel-workflows.md) and
[ADR-0079](../adr/0079-stage-material-and-confirmed-continuation.md).
