# Preserve approved requirements

Use this guard when an approved product decision must survive planning,
implementation and autonomous improvement. It extends native task gates without
adding another workflow or requiring a different Agent for every activity.

## Original decisions and scope

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

## Execution and discovery

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
There is no automatic dismissal of manual proposals. A separately approved repair
and a newly accepted continuation goal can establish the next baseline; the prior
proposal and its evidence remain historical. Changing source bytes alone is not
proof that a finding was resolved.

## Native delivery gates

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
[completion report](completion-evidence.md) records whole-scope checks and
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
