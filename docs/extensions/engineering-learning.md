# Engineering Learning Loop

The Engineering Learning Loop is the framework's evidence-to-improvement system. It prevents a useful discovery from disappearing inside one conversation while also preventing every retrospective note from becoming a permanent instruction or Skill.

```text
Work evidence
  → Retrospective observation
  → Lesson
  → Validation
  → Practice or Guardrail
  → Skill, automated check, ADR, instruction, or no promotion
  → Revalidation or deprecation
```

## The artifacts are different

| Artifact | Purpose | Authority |
|---|---|---|
| Retrospective | Review one bounded body of work | May propose learning; does not create a rule by itself |
| Lesson | Preserve the smallest evidence-supported conclusion | Informational until validated or promoted |
| Practice or Guardrail | State adopted guidance with an explicit scope | Guides relevant work; does not grant permission or replace a gate |
| Skill | Execute a reusable, non-obvious decision procedure | Operates only inside the request and Position authority |
| Automated check | Enforce a deterministic condition | Reports or blocks only as configured |
| ADR | Preserve an important technical or organizational decision | Governs its declared decision scope |
| Instruction | Apply an always-on repository rule | Requires explicit approval because it affects recurring behavior |

The middle layer is **Practice**. It is stronger than a note because it has evidence, applicability, status, and an owner. It is lighter than a Skill because it does not define a full reusable procedure.

## Repository model

Learning is project-owned canonical state:

```text
.ai-org/learning/
├── index.json
├── lessons/
│   └── LESSON-0001.md
├── practices/
│   └── PRACTICE-0001.md
└── proposals/
    └── SKILL-PROPOSAL-0001.json
```

Explicit outcome reviews live separately under `reviews/WI-ID/OUTCOME_DIGEST.json`.
They do not add entries to the Lesson/Practice index. The directory is created on
first authorized capture; existing projects and history need no migration.

The initialized project includes an empty v2 `index.json`. Record templates are available in `.ai-org/templates/lesson.md` and `.ai-org/templates/practice.md`; the record directories are created only when the project has something authorized to preserve.

The machine-readable contract is `.ai-org/core/schemas/learning-index.schema.json`. `temple doctor` additionally checks ID-kind-path agreement, kind-specific states, duplicate IDs and paths, date values, and whether every indexed Markdown record exists and every record is indexed.

### What `index.json` contains

The index is a compact retrieval registry, not a copy of every record. Each entry contains:

- ID, kind, title, and one-sentence summary;
- status and confidence;
- tags and `applies_to` hints;
- source work-item IDs;
- Lesson derivation and the owning Position for a Practice;
- the record path;
- update, last-validation, next-review, and revalidation-history fields;
- revalidation evidence and confirmed, narrowed, or contradicted result;
- promotion target, proposal reference, human-decision status, review date, and authoring Work Item link.

An Agent should search the index first, select entries relevant to the current Position, work item, and technical area, then read only the referenced records. It must not load the whole learning history into every task.

## Loop stages

1. **Observe:** preserve facts, outcome, environment, revision, and evidence from a work item or retrospective.
2. **Capture:** write the smallest supported Lesson. Separate observation from interpretation and uncertainty.
3. **Validate:** reproduce it, find counterexamples, narrow applicability, and change confidence. One incident rarely supports a universal rule.
4. **Apply:** convert a validated Lesson into an active Practice only when the project intentionally adopts the guidance.
5. **Promote:** choose the correct destination. Use a Skill for a reusable decision procedure, an automated check for a deterministic condition, an ADR for a decision, or an instruction for an approved always-on rule.
6. **Revalidate:** revisit the Practice after relevant technology, architecture, policy, or evidence changes. Deprecate it when it no longer holds.

Promotion is optional. A valuable Lesson may remain a Lesson, and a simple Practice may never need a Skill.

### Skill promotion boundary

Temple detects a Skill candidate only when one Practice is active, has high confidence, has a confirmed revalidation result, and traces to at least two distinct Work Items. This is a deterministic triage threshold, not proof that a Skill should exist.

An eligible Practice may become a `SKILL-PROPOSAL-*` record. The proposal preserves the trigger, neighboring non-trigger, authority, risk class, dependencies, alternatives, overlap review, and evidence provenance. Observer and status surface eligible candidates, pending proposals, and deferred proposals whose review date has arrived.

A Human Principal must still choose `approve`, `reject`, or `defer`. Approval creates exactly one internal authoring Work Item scoped to the proposed `.agents/skills/<name>/` path. It does not write `SKILL.md`, activate a Skill, install a dependency, publish a pack, change a lifecycle gate, or perform the proposed procedure. Risk changes the validation depth of the later authoring work; low risk does not remove the approval boundary.

## CLI workflow

Use the CLI instead of hand-editing both files when possible:

```bash
node ./templew.mjs learning add-lesson . \
  --title "Bind runtime evidence to a revision" \
  --summary "Runtime evidence is reusable only with its exact revision." \
  --confidence medium \
  --tag runtime \
  --applies-to independent-qa

node ./templew.mjs learning add-practice . \
  --title "Revision-bound runtime evidence" \
  --summary "Record an exact revision for every runtime claim." \
  --confidence medium \
  --derived-from LESSON-0001 \
  --owner-position tech_lead

node ./templew.mjs learning revalidate . \
  --learning-id PRACTICE-0001 \
  --result confirmed \
  --review-after 2026-12-01T00:00:00.000Z

node ./templew.mjs learning list . --json

node ./templew.mjs learning skill-candidates . --json

node ./templew.mjs learning propose-skill . \
  --learning-id PRACTICE-0001 \
  --work-item WI-0001 \
  --skill-name revision-bound-runtime-check \
  --summary "Preserve revision-bound runtime verification as a reusable procedure." \
  --trigger "Use when runtime evidence must support a repository claim." \
  --non-trigger "Do not use to approve a release or perform an external action." \
  --authority "Guidance only; no lifecycle or release authority." \
  --risk-class medium \
  --overlap-review "No existing Skill has this exact routing boundary."

node ./templew.mjs learning decide-skill . \
  --proposal-id SKILL-PROPOSAL-0001 \
  --decision approve \
  --principal-id human \
  --reason "The evidence and routing boundary are sufficient."
```

`learning migrate --dry-run` reports whether a legacy v1 index would change; remove `--dry-run` for the explicit atomic v2 migration. Revalidation records history in both the index and Markdown record. Due, overdue, and contradicted entries appear in status or Observer attention; they do not rewrite guidance automatically.

`learning evaluate --fixture <repository-path> --no-write --json` runs checked-in retrieval cases and reports hit rate at the case limit plus mean reciprocal rank. Evaluation measures routing; it does not validate the truth of the returned learning.

## Responsibility

### Check which outcomes were reviewed

Run a read-only query before choosing work to retrospect:

```bash
node ./templew.mjs learning review-status . --work-item WI-0001 --json
node ./templew.mjs learning review-status . --compact --json
node ./templew.mjs learning review-status . --json
```

| Status | Meaning |
| --- | --- |
| `not-reviewed` | No explicit review record; outcome evidence has not been inspected by this query |
| `no-new-lesson` | A recorded review of this outcome found no new Lesson |
| `linked-lessons` | A recorded review links existing Lessons, including candidates; it does not validate or promote them |
| `review-required` | Outcome, referenced evidence, review note or linked Lesson changed |
| `not-eligible` | The Work Item is still active |
| `unknown` | Required revision, source or record is missing, invalid or unreadable |

Capture and query validate the same consumed Work Item fields before classifying
eligibility or absence of reviews. Unknown workflow states, invalid schema/outcome,
non-string revisions and malformed arrays are unknown and cannot be captured.
Absent optional legacy fields are supported; a present null array/object is invalid.

First write a repository review note describing what was examined and the bounded
conclusion. Supply the terminal Work Item's full `tested_revision` (or recorded
Developer candidate when testing did not finish) and an active project Agent ID:

```bash
node ./templew.mjs learning record-review . --work-item WI-0001 \
  --revision FULL_RECORDED_OUTCOME_SHA --result no-new-lesson \
  --actor YOUR_ACTIVE_AGENT_ID --evidence docs/reviews/WI-0001.md --json
```

To link Lessons already captured with `learning add-lesson`, use
`--result linked-lessons --learning-id LESSON-0001`; repeat `--learning-id` for more.
The [review input worksheet](../../project-overlay/.ai-org/templates/learning-review.json)
lists the fields; substitute them into CLI flags, rather than copying the worksheet
into canonical storage. The CLI generates hashes, time and immutable records.

Use `--compact` for counts without item bodies; it preserves unknown counts and
storage errors, and does not reduce the underlying all-item scan. A single-item
query remains the smallest diagnostic path. `status --compact --json --no-write`
also includes a `learning.reviews` summary of recorded items only. Its `recorded`
value counts historical records; status counts classify Work Items, so multiple
reviews for one Work Item increase the former without duplicating the latter.

Identical retries are no-write. An unchanged outcome with a different judgment,
actor, note or Lesson content is a conflict, not an overwrite. Updated outcome
evidence produces a new record; prior records remain. Do not fabricate an outcome
change to bypass a conflict.

After actually reconsidering a stale or mistaken review, write a new review note
and use the single-item query's current `review_digest` to append a replacement:

```bash
node ./templew.mjs learning record-review . --work-item WI-0001 \
  --revision FULL_RECORDED_OUTCOME_SHA --result linked-lessons \
  --actor YOUR_ACTIVE_AGENT_ID --evidence docs/reviews/WI-0001-followup.md \
  --learning-id LESSON-0001 --supersedes CURRENT_REVIEW_DIGEST \
  --reason "Reconsidered the review after the linked metadata correction" --json
```

The predecessor must still be the current review for the same outcome. The new
note path must differ from its predecessor; retain the prior note and record.
An identical retry of the current replacement is no-write; stale predecessors,
missing parents, forked history, invalid sources and ordinary conflicts fail.
The command adds a v2 successor under `OUTCOME_DIGEST.REVIEW_DIGEST.json`; v1 roots
are preserved. Current review selection follows validated links, never wall-clock
time. Clients predating v2 reject successor storage; a downgrade requires its own
compatibility plan. This is explicit judgment capture, not automatic acceptance.

### Keep current Learning metadata readable

Revalidation updates both the index and the document's current Status/Last
validated header fields while appending its validation event. For an old document
whose header is stale, synchronize presentation from the existing index:

```bash
node ./templew.mjs learning sync-metadata . --learning-id LESSON-0001 --dry-run --json
node ./templew.mjs learning sync-metadata . --learning-id LESSON-0001 --json
```

This explicit operation is idempotent, changes only those two unique metadata
fields, and preserves the index, narrative and history. It does not declare a new
validation or promote a Lesson/Practice. Missing/ambiguous headers and unsafe
record paths are rejected. Correcting a linked document still makes its reviews
stale; inspect and explicitly reconsider them rather than silently waiving hashes.

The outcome digest binds scope, acceptance, unresolved issues, terminal state,
candidate revisions and evidence references/content. Administrative timestamps and
claims do not cause re-review. Repository evidence is read locally; normalized
Evidence IDs bind their selected registry entry. Full Git hashes and HTTP(S) links
are opaque references, with no Git-object or remote-content validation. Missing
local evidence is unknown; symlinks and unsafe paths are rejected. Review coverage
is not acceptance, proof of learning quality, or production authorization.

Single-item queries avoid scanning other Work Items and unrelated Lesson bodies.
The all-item query scans Work Item metadata and inspects evidence only for recorded
reviews. Status reports counts for recorded items only; Doctor flags corrupt or
unreadable review storage. With no review store, those existing commands do no
extra Work Item scan. These operations make no model calls and never schedule a
retrospective, create a Lesson, change lifecycle state or promote guidance.

See [ADR-0066](../adr/0066-demand-driven-learning-review-coverage.md) and the
[record schema](../../project-overlay/.ai-org/core/schemas/learning-review.schema.json).

### Ownership

- Any Position may propose a Lesson from evidence in its authorized work.
- The Engineering Manager triages duplicates, missing evidence, ownership, and follow-up.
- The Tech Lead validates technical Practices and may create an evidence-backed Skill Proposal from an eligible candidate while holding the Design-stage claim.
- Quality & Evaluation and Independent QA may challenge generalization and add counterexamples.
- The Observer surfaces counts, candidate Lessons, active Practices, stale validation, contradictions, Skill candidates, and proposal decisions that need attention without approving them.
- Human Principals approve, reject, or defer project Skill authoring and approve cross-project sharing, recurring instructions, and promotion into the central framework.

## Privacy and cross-project learning

Project learning never flows into the central framework automatically. A framework-level candidate requires explicit human approval, removal of private product information, provenance review, and repeated evidence from more than one bounded case. Open-source Temple must not expose a private pilot's code, data, or identifying evidence.

## Current alpha boundary

Alpha.27 installs the project-owned index, managed templates, atomic Learning CLI, explicit migration, revalidation signals, deterministic retrieval evaluation, candidate detection, evidence-backed Skill Proposals, Human Principal decisions, idempotent authoring Work Item creation, doctor validation, and status/Observer attention. It does not execute retrospectives on a schedule, write or activate a Skill automatically, synchronize projects, install or select a semantic runtime, or provide a `$retrospective` Skill. Large-repository retrieval evaluation remains `not_run`.
