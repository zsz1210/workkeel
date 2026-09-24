# Daily work: brief, handoff and observation

Use this path in an initialized task-first project. Your Codex conversation is
the place to agree on work and execute it; the optional observer is read-only.
No desktop plugin, global model change, background service or extra dependency
is required. Commands below use `workkeel` as shorthand for
`node /path/to/workkeel/bin/workkeel.mjs` from the reviewed source checkout.

## One brief instead of repeating the full contract

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

## Handoff and quality

`task summary` reports the current lifecycle, goal, acceptance, next action,
exact delivery revision, handoff/review/closeout summaries, evidence digest state
and task timeline. Rework counts rejected native deliveries, not arbitrary model
requests; workflow attempts remain separately visible. First-review quality is
unknown before a review. Lifecycle duration includes waits and human/coordinator
work; recorded adapter time and tokens cover workflow runs only.

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
- **Task detail:** next action, acceptance, delivery evidence, observed links,
  timeline and recorded model operations.
- **Usage & quality:** per-task sample kind, token coverage, adapter/lifecycle time,
  rework and review. It does not rank models or infer subscription costs.

The viewer validates the execution inventory once per snapshot. Attributable
errors mark the affected task incomplete; unknown run attribution marks every
task's measurement total incomplete. Healthy task state can remain visible.
Fatal snapshot errors hide old content until recovery. Up to 200 visible native
tasks, 4,096 inventory entries and 4 MiB response are supported. Retained legacy
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
