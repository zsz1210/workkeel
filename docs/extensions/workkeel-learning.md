# Native Learning reuse

Native projects can preserve a narrowly scoped lesson, explicitly review it, and
record its later use without creating a legacy Work Item or Position. This feature
does not run models, infer use from files, change task acceptance, or activate Skills.

## Storage and authority

Records are append-only `workkeel.learning-event/v1` envelopes in
`.ai-org/learning/native/000001.json` and subsequent sequence files. The older
Learning index and Markdown records remain unchanged and are never auto-imported.
Each envelope contains `event` and its SHA-256; the event binds the request,
preceding event digest, sequence, timestamp and source byte digests. This detects
accidental edits, not an adversary rewriting all unsigned history.

Every mutation requires a currently approved native task in `build`, its matching
actor and claim, unchanged contract/authority pins, `write` authorization, and a
contract write root containing `.ai-org/learning/native`. Evidence must lie under
an approved read root. Path traversal, symlink components, unavailable files, empty
evidence and files over the existing 1 MiB task-file limit fail closed. The existing
project mutation lock and durable atomic creation serialize event writes. Replaying
the same task/operation ID and identical request is no-write; a different request
is a conflict. Replay still requires current authority.

The bounded store holds at most 1,000 events; each reference array has at most 32
distinct entries. It has no compaction or automatic retention policy. To revalidate
changed capture sources, an explicit confirmed review must include every original
capture source and Skill path in its evidence list, plus any check evidence. Only
this complete source set re-pins current guidance; a partial review never clears
stale capture sources. Original pins and all events remain immutable. Changed
guidance text or scope requires a new explicitly scoped record ID. Review never
adopts descendants.

## API and CLI

`src/workkeel-learning.mjs` exports the asynchronous functions below. `target` is
the initialized native project root. The CLI prints JSON:

```sh
node ./workkeelw.mjs learning list .
node ./workkeelw.mjs learning capture . --request docs/capture.json
node ./workkeelw.mjs learning review . --request docs/review.json
node ./workkeelw.mjs learning use . --request docs/use.json
node ./workkeelw.mjs learning search . --request docs/query.json
node ./workkeelw.mjs learning impact . --request docs/impact.json
```

All mutation requests have these exact common fields:

```json
{
  "task_id": "WK-example",
  "actor": {"agent_id": "builder", "principal_id": "owner"},
  "claim_id": "claim-from-native-task",
  "contract_sha256": "64-lowercase-hex-digest-from-native-task",
  "operation_id": "stable-operation-id"
}
```

Additional fields are exact; unknown fields fail rather than being ignored.

| Function / CLI action | Additional request fields |
| --- | --- |
| `captureNativeLearning` / `capture` | `record` as below |
| `reviewNativeLearning` / `review` | `learning_id`, `result` (`confirmed`, `contradicted`, `deferred`), nonempty `decision`, nonempty `evidence` path array, `adopt` boolean |
| `recordNativeLearningUse` / `use` | `learning_id`, `stage` (`found`, `read`, `applied`, `outcome`), nonempty `decision`, `evidence` path array, `outcome` |
| `listNativeLearning` / `list` | No request |
| `searchNativeLearning` / `search` | `query`, optional integer `limit` (1–20, default 5) |
| `nativeLearningImpact` / `impact` | `source`: exact local evidence path or native learning ID |

Capture `record` example:

```json
{
  "id": "LESSON-native-wire",
  "kind": "lesson",
  "title": "Check deployed wire contracts",
  "summary": "Map internal request values against the deployed schema.",
  "applicability": "The examined adapter version and request field.",
  "exclusions": "No guarantee about unexamined responses, events or providers.",
  "aliases": ["wire contract", "external interface"],
  "derived_from": [],
  "evidence": ["docs/reviews/wire-contract.md"],
  "skill_refs": []
}
```

IDs use 1–96 ASCII letters, digits, `_` or `-`, starting alphanumerically.
Aliases may include explicit phrases such as `外部介面` or `外部契約`.
`kind` is `lesson` or `practice`; a practice requires an existing lesson/practice
in `derived_from`. Only earlier existing records can be parents, so unknown refs,
self cycles and forward cycles fail. Text fields are nonempty and bounded to
4,000 characters; reference and alias strings are bounded to 1,024. Applicability
and exclusions must describe the human-reviewed scope; search does not prove
that scope applies to the current task. Aliases are explicitly authored search
phrases, not generated translations. To import legacy knowledge, supply its exact
local source path in `evidence` and an explicit new native record. Capture leaves
it a candidate regardless of the older document's wording.

`skill_refs` optionally links existing `*/SKILL.md` files for impact reporting;
it pins their bytes but does not assert that those Skills are installed or active.
All evidence and Skill paths are read locally; URLs and Git revision strings are
not accepted as substitutes for readable local evidence.

Review evidence must describe the actual bounded check. `adopt: true` is permitted
only for a confirmed practice. A confirmed lesson is validated guidance; an adopted
practice additionally requires every ancestor to be eligible. Deferred,
contradicted, candidate, unknown-evidence and stale-evidence records are excluded
from recommendations, including all transitive descendants.

Use facts are explicit sequential reports for the same task and learning ID:
`found` → `read` → `applied` → `outcome`. They are never inferred from search or
file access. `found` and `read` may have empty evidence; `applied` and `outcome`
require nonempty evidence. `outcome` must be `null` before the outcome stage;
at that stage it is `verified`, `failed` or `unknown`. A later outcome may report a
counterexample even after guidance becomes ineligible. These are reported facts,
not independent review or lifecycle acceptance.

## Observer projections and recommendation boundaries

List/search/impact return `workkeel.learning-view/v1`, `items`, `uses`,
`authority: observation-only`, `mutation_status: no-write`,
`quality_verified: false`, and limitations. Items retain capture metadata and
include `source_task`, `captured_at`, `capture_sha256`, original `pins`,
`current_pins`, current `review`, `status`,
`effective_state`, `eligible`, `reasons`, and `promotion`. Source changes make
`effective_state` `review-required`; original judgments remain visible. Reasons
include source paths and direct ineligible ancestor IDs. Following these links
explains transitive causes without copying branching reason trees. Uses contain the task ID,
stage, decision, outcome, pinned evidence, timestamp, event digest and source
problems. Nothing changes canonical task records.

Search is deterministic NFKC/case-normalized phrase/token matching against IDs,
titles, summaries and explicit multilingual aliases. It searches eligible records
only, returns bounded scored results and `semantic: false`, and makes no model
calls. Search is discovery, not automatic application or validation. Evaluation
queries authored after reading aliases are fixture coverage, not unbiased recall.

Impact follows exact source references and all transitive derivations, returning
`impact_reasons` per item, affected use facts and linked `skills` with review
reasons. It reports `historical_acceptance_changed: false`. A source conflict
blocks current recommendations while retaining historical judgments and uses.

`promotion.eligible` is proposal readiness only: an eligible adopted practice
with current confirmed evidence and at least two distinct native tasks having
an evidenced application plus a current latest `verified` outcome. Found/read
facts never count. Repeated operations from one task still count once; a later
failed/unknown outcome stops that task counting. It always reports
`requires_human_approval: true` and `skill_activated: false`. Proposal approval,
Skill authoring, activation and quality review remain separate authorized work.
