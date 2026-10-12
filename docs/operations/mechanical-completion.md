# Complete an exact text replacement

This optional route avoids a fresh Verifier only when the work is an exact,
preapproved replacement in a non-normative plain-text note. It is not a general
shortcut for small code changes. It is available in the source candidate described
by [ADR-0061](../adr/0061-exact-text-mechanical-completion.md); it is not activated
automatically on installation or upgrade. Use a CLI version that supports the
option, not an older published package.

## When it fits

A Solo project owner has explicitly classified one regular, non-executable file
under `docs/notes/` as non-normative. The filename uses lowercase letters, digits
and hyphens, ending in `.txt`. The file is not managed by the framework or indexed
as an authority source. The task is low-risk bounded Lean Build, with no interface,
dependencies, shared contracts, specification references or unresolved questions.

Do not use this for instructions, Skills, specifications, executable examples,
legal/security text, tests, release notes, behavior changes or unknown files.
Calling a file a note does not make it harmless: the owner must know that nothing
relies on it as an instruction or contract. The check cannot infer that fact.

## Preapprove the exact change

The project owner opts in with the project-owned file
`.ai-org/project/mechanical-policy.json`. The list is exact, not a directory glob:

```json
{
  "schema_version": "temple.mechanical-policy/v1",
  "enabled": true,
  "approved_by": "human",
  "non_normative_files": ["docs/notes/reading.txt"]
}
```

For an existing Work Item, record the owner's exact requested transformation at
`.ai-org/artifacts/WI-0001/mechanical-contract.json` (use the actual Work Item ID):

```json
{
  "schema_version": "temple.mechanical-contract/v1",
  "work_item_id": "WI-0001",
  "approved_by": "human",
  "file": "docs/notes/reading.txt",
  "before_sha256": "REPLACE_WITH_THE_64_HEX_SHA256_OF_THE_ORIGINAL_FILE",
  "old_text": "smal",
  "new_text": "small"
}
```

Use the actual principal, original digest and authorized text. The old fragment
must occur exactly once. Both fragments must be nonempty single-line strings and
at most 4,096 UTF-8 bytes; files are limited to 65,536 bytes. Unknown fields and
versions reject. Approval records are repository trust, not cryptographic human
signatures. An Agent may record explicit approval but must not invent it from its
own judgment that a change is small.

Cite this contract as both `approved_scope` and `acceptance_criteria` when entering
Build through the [ordinary Lean setup](../concepts/workflow-profiles.md). Declare
the note as the only affected product file. Commit the original note, opt-in and
contract **before claiming that exact base SHA**. If an earlier claim already
exists, release it through the normal workflow before claiming the approved base.

Apply and commit only the literal replacement. A candidate containing other
changed files is ineligible; do not hide an unrelated change in the same commit.

## Finish and inspect the result

Use the existing finish command with the explicit contract instead of
caller-authored completion/evidence or Verifier judgment fields:

```sh
node ./templew.mjs work-item finish . \
  --work-item WI-0001 --position developer \
  --operation-id note-correction --claim-id ACTIVE_CLAIM_ID \
  --agent-id BUILDER_ID --principal-id human \
  --revision FULL_CANDIDATE_SHA \
  --mechanical-contract .ai-org/artifacts/WI-0001/mechanical-contract.json \
  --dry-run --json
```

For execution, remove `--dry-run`; optionally pass the returned
`mutation.plan_digest` through `--expected-plan`. The CLI rechecks approval inputs,
base ancestry, exact candidate, file modes/content, whole committed diff and
uncommitted product changes. It never performs the text edit itself or runs an
arbitrary shell command supplied in a contract.

Successful completion records `completion_kind: mechanical`, the before/after and
approval hashes, the accountable Developer and released claim. The Work Item is
done with an explicit mechanical closeout reason. No Verifier handoff, Test-stage
judgment or Independent QA pass is invented. Normal `finish` without this option
still hands Developer work to the distinct Verifier.

Inspect both `mutation` and `diagnostics`. A diagnostic failure after lifecycle
mutation is not a rollback; the unchanged request can recover through the existing
[Lean delivery recovery rules](lean-delivery.md). Never delete journals or
switch CLI versions while an operation is pending. A historical receipt is not a
new verification of changed files. Any preflight mismatch leaves the ordinary
verification route available; do not change approvals after the fact to fit an
unapproved result.

This removes one actor handoff in the supported case, not all task administration.
It does not prove Token, time, quality or organization-wide efficiency gains.
