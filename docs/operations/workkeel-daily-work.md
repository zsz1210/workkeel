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

## One brief instead of repeating the full contract

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

## Handoff and quality

`task summary` reports the current lifecycle, goal, acceptance, next action,
exact delivery revision, handoff/review/closeout summaries, evidence digest state
and task timeline. Rework counts rejected native deliveries, not arbitrary model
requests; workflow attempts remain separately visible. First-review quality is
unknown before a review. Lifecycle duration includes waits and human/coordinator
work; recorded time and tokens cover workflow runs and explicitly bound native
reports only.

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

Preserve evidence tags when moving a self-hosted legacy checkout: verify the
exact `temple/evidence/<revision>` tags in addition to main/tree and run Doctor.
Do not make missing historical commits pass by suppressing evidence checks.

Retain `project-overlay` copies and installed managed files according to their
ownership. Large historical experiments remain frozen reproduction instruments
unless a named task explicitly maintains them; no age-based deletion is implied.
Before archiving historical evidence, export with the existing evidence-bundle
CLI, verify every digest and read back a selected original. Removing a working-tree
file neither shrinks Git history nor proves that its references are unused.
