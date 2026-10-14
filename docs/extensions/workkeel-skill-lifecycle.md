# Versioned project Skill learning

Native projects can compare, review and activate a specific project Skill version.
This complements [native learning](workkeel-learning.md); it does not import legacy
records or turn one observation into a framework rule.

## Evidence and authority

The journal is `.ai-org/learning/skill-lifecycle/`. Every mutation requires a live
native build claim, unchanged contract pins, authorized write scope and bounded
local evidence under approved read roots. Requests are idempotent by task and
operation ID. The journal is append-only, bounded to 1,000 events and protected by
the project mutation lock. Never edit it manually.

All requests contain:

```json
{
  "task_id":"WK-example",
  "actor":{"agent_id":"builder","principal_id":"owner"},
  "claim_id":"actual-claim-id",
  "contract_sha256":"actual-task-contract-digest",
  "operation_id":"stable-operation-id"
}
```

An optional `expected_version` checks the journal version under the lock. Use actual
values returned by native commands; the illustrative identity above is not an
authorization. Store request and evidence files in the private project.

```sh
node bin/workkeel.mjs skill-lifecycle list /private/project
node bin/workkeel.mjs skill-lifecycle candidate /private/project --request docs/candidate.json
node bin/workkeel.mjs skill-lifecycle evaluate /private/project --request docs/comparison.json
node bin/workkeel.mjs skill-lifecycle review /private/project --request docs/review.json
node bin/workkeel.mjs skill-lifecycle approve /private/project --request docs/approval.json
node bin/workkeel.mjs skill-lifecycle activate /private/project --request docs/activation.json
```

## Request fields

The exact fields below extend the common request. Unknown fields fail.

| Action | Additional fields |
| --- | --- |
| `candidate` | `skill_id`, SemVer `version`, `skill_dir`, exact `files`, `learning_ids`, `risk_tier`, `trigger`, `non_trigger`, `authority`, `dependencies`, `provenance`, `evidence` |
| `evaluate` | `skill_id`, `version`, `comparison` (`with-without` or `old-new`), `baseline_version` (null or version), `cases`, `evidence` |
| `review` | `skill_id`, `version`, `result` (`accept` or `reject`), `decision`, `evidence` |
| `approve` | `skill_id`, `version`, `decision` (`approve` or `reject`), `evidence` |
| `policy` | `enabled`, explicit `skill_ids`, `approval_ref`, `expires_at` (null or timestamp) |
| `activate`, `rollback`, `revalidate` | `skill_id`, `version`, `evidence` |
| `suspend` | `skill_id`, `version`, `decision`, `evidence` |
| `use` | `skill_id`, `version`, `stage` (`found`, `read`, `applied`, `outcome`), `outcome`, `decision`, `evidence` |
| `retrospective` | `decision` (`no-new-learning` or `captured`), `learning_ids`, `skill_versions`, `summary`, `evidence` |

Candidate files include `SKILL.md` and every declared resource. Their bytes are
pinned; changed Skill content requires a new version. Follow
[Skill authoring](skill-authoring.md) for routing, authority, dependencies and
provenance. Frontmatter uses supported plain scalar name and description fields;
unsupported YAML constructs fail rather than being interpreted inconsistently.

Each comparison case has `id`, `kind` (`training`, `holdout` or `negative-trigger`),
`input_ref`, `baseline` and `candidate`. Each result contains boolean `success`,
boolean `triggered`, and nonempty local `evidence` references. Include at least a
holdout and a negative-trigger case. Every candidate case must succeed with the
correct trigger behavior, and at least one baseline result must improve. Identical
passing baseline/candidate results do not demonstrate a benefit. These are attributed
evaluation reports, not provider-authenticated measurements or automatically graded
model benchmarks; the independent reviewer must inspect the actual evidence.

The reviewer must differ from both the author and evaluator. A review decision is
recorded under that reviewer's actual native claim; the author cannot adopt the
reviewer's identity. Approval requires an authorized Principal. An enabled, pinned,
unexpired standing policy can authorize independently reviewed low-risk activation
for its explicit Skill IDs only. Default is off.

## Activation, use and recovery

Activation writes `.agents/skills/workkeel-local/<id>/<version>/` with an exact
manifest. This remains project-owned and grants no permissions. It does not create
an unversioned global Skill. `context prepare` with a concrete `learning_query`
can select an active relevant version under task read scope. Required task Skills
remain unchanged; selection does not record reading or application.

Use reports must follow `found → read → applied → outcome` for the same task and
version. `outcome` is null before the final stage, then `verified`, `failed` or
`unknown`. A failed reported outcome suspends recommendation. Revalidation needs a
fresh comparison and independent review. Drift in source files, copied resources,
comparison evidence or the previous-version baseline also makes the version
ineligible. Original judgments remain available.

`rollback` selects an exact previously approved eligible version. It preserves later
versions and original failures. A retrospective can explicitly record no new
learning; `captured` must reference learning captured by that task, and listed Skill
versions require actual application receipts. Neither judgment completes the task.

The qualified Codex host also checks the project-local versioned Skill inventory.
Unapproved, inactive or drifted versions are disabled before model work. Existing
ordinary project Skills keep their original behavior. Host discovery and successful
application are still different evidence states.

See [ADR-0085](../adr/0085-native-workspace-bounded-autonomy-and-skill-learning.md).
