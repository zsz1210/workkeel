# Task material and confirmed continuation

This opt-in task-first entry prepares navigation from the full approved contract.
It does not grant permission, prove that a model read a file, or replace acceptance.
Existing workflow v1 string inputs remain supported.

## Prepare material

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

## Continue a confirmed interruption

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

## Scope and limits

The personal `prepare-stage.mjs` wrapper and CLI use the same core preparation.
Free-text callers retain responsibility for semantic scope; this system validates
structured scopes and provenance, not the truth of arbitrary instructions.
Required materials may make a prepared packet larger. No speed, token-cost or
monetary savings follow solely from shorter optional instructions.

See [workflow execution](workkeel-workflows.md) and
[ADR-0079](../adr/0079-stage-material-and-confirmed-continuation.md).
