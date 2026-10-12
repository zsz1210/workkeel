# Evidence and Observer

Temple separates three things that are often accidentally collapsed:

1. an observation was recorded;
2. a Position accepted that observation for a named lifecycle gate;
3. a human authorized a high-risk or external action.

The Evidence Registry handles only the first. Work Item transitions handle the second. Existing human-authority boundaries handle the third.

## Registry

`.ai-org/project/evidence.json` is project-owned canonical state. Each `temple.evidence/v1` entry identifies its Work Item, kind, outcome, actor, observation time, adapter, exact Git scope revision when available, and SHA-256 digests for repository artifacts.

Supported kinds are:

| Kind | Source | Important behavior |
|---|---|---|
| `git-revision` | Local Git object database | Resolves the supplied ref to an exact 40-character commit |
| `test` | `temple.test-observation/v1` JSON | Checks result/exit-code consistency and hashes the observation and artifacts |
| `runtime` | `temple.runtime-observation/v1` JSON | Records environment, scenario, provenance, result, revision, and artifacts |
| `unverified-claim` | Explicit manual statement | Remains `unverified` and creates Observer attention |
| `risk` | Explicit manual review | Preserves severity, status, and mitigation; open high or critical risk creates attention |
| `rollback` | Repository procedure | Hashes the procedure; `verified` also requires an exact Git revision |

The adapters inspect supplied local state. They do not execute tests, launch runtimes, deploy, publish, contact a provider, mutate an external tracker, or add a reference to `gate_evidence`.

## Revision durability

An exact evidence revision must remain obtainable after the worker branch or worktree disappears. Doctor therefore accepts a revision only when it is either an ancestor of the current `HEAD` or retained by the deterministic tag `refs/tags/temple/evidence/<exact-sha>`. An ordinary local branch is not durable evidence retention.

If integration preserves ancestry through a merge, no additional tag is needed. If integration uses a cherry-pick, squash, patch application, or another operation that changes the commit identity, preserve the original evidence revision locally:

```bash
node ./templew.mjs evidence preserve . \
  --work-item WI-0001 \
  --revision 0123456789abcdef0123456789abcdef01234567
```

The command succeeds only when that Work Item already has evidence bound to the exact revision. It creates a lightweight local `temple/evidence/<sha>` tag and is idempotent; it does not contact or mutate a remote. Publish that exact tag through the project's normal reviewed Git workflow before deleting the source branch:

```bash
git push origin refs/tags/temple/evidence/0123456789abcdef0123456789abcdef01234567
```

A fresh clone or CI checkout must resolve the original revision. Do not rewrite historical evidence to a patch-equivalent integration commit: the recorded observation did not run at that different commit.

## Capture examples

Copy the managed observation templates into a project-owned artifact path and replace every placeholder with facts from the actual run. A test observation is JSON, not the Markdown Developer or QA report. This is the minimum valid shape:

```json
{
  "schema_version": "temple.test-observation/v1",
  "revision": "HEAD",
  "command": ["npm test"],
  "result": "pass",
  "exit_code": 0,
  "started_at": "2026-09-04T00:00:00.000Z",
  "completed_at": "2026-09-04T00:00:01.000Z",
  "artifact_refs": []
}
```

Save the JSON below the Work Item, for example `.ai-org/artifacts/WI-0001/test-observation.json`. Keep the human explanation in a separate Markdown report and add its repository-relative path to `artifact_refs` when it should be content-addressed with the observation.

```bash
node ./templew.mjs evidence git . \
  --work-item WI-0001 \
  --revision HEAD \
  --title "Candidate revision"

node ./templew.mjs evidence test . \
  --work-item WI-0001 \
  --observation .ai-org/artifacts/WI-0001/test-observation.json

node ./templew.mjs evidence runtime . \
  --work-item WI-0001 \
  --observation .ai-org/artifacts/WI-0001/runtime-observation.json
```

Successful capture prints two different references:

```text
Recorded EVID-20260904T000001Z-1234ABCD: test (pass)
Reusable gate reference (copy exactly): EVID-20260904T000001Z-1234ABCD
Lifecycle gate satisfied: no
```

The JSON path identifies what Temple inspected and hashed. The complete `EVID-...` value identifies the normalized record. Copy that value exactly when a later lifecycle requirement calls for normalized Evidence:

```bash
node ./templew.mjs transition . \
  --work-item WI-0001 \
  --to independent_qa \
  --satisfy evaluation_report=EVID-20260904T000001Z-1234ABCD
```

The example only demonstrates reference flow; the Evidence kind and responsible Position must still match the actual workflow requirement. Never shorten the ID, substitute the observation path when normalized Evidence is required, or assume that capture advanced the Work Item.

Git evidence capture inspects staged, unstaged, and untracked paths. It refuses capture when a declared Work Item `affected_path` is dirty because the exact commit would not contain the implementation being described. Unrelated or governance-only changes remain allowed and are classified in evidence metadata as `outside-affected-scope`; this keeps post-candidate handoff artifacts from being confused with uncommitted implementation.

When the correct environment is unavailable, record that limitation rather than manufacturing a pass:

```bash
node ./templew.mjs evidence unverified . \
  --work-item WI-0001 \
  --summary "The interaction looks correct in the static preview" \
  --reason "The required device is unavailable" \
  --expected-verification "Reproduce the interaction on the named device"
```

## Observer projection

`node ./templew.mjs observe . --no-write --json` reads Work Items, runtime workers, events, and normalized evidence. It classifies work as active, blocked, QA-pending, approval-pending, or queued and reports:

- evidence bound to a different resolved scope revision;
- explicitly unverified, invalidated, or expired evidence;
- failed test or runtime observations;
- open high and critical risks;
- release approval still pending;
- failed or attention-state runtime workers.

Without `--no-write`, the same command writes `.ai-org/views/observer.json` and a static `.ai-org/views/overview.html`. They are generated, read-only projections with no approval or mutation controls. Delete and rebuild them at any time.

For terminal Work Items, `tested_revision` is the current exact-revision authority. Evidence captured against earlier revisions remains classified and visible as immutable history, but revision drift in that history is no longer current operational attention. Nonterminal stale evidence continues to require attention.

## Gate use

After the responsible Position reviews a registry entry and its source, it may deliberately cite the complete entry ID or an artifact path when that workflow requirement permits it through the normal `transition --satisfy requirement=reference` command. Recording evidence alone never changes the Work Item.

`doctor` validates the registry structure, Work Item references, revision durability, and captured artifact digests. It does not claim that a local preservation tag was pushed, that a supplied observation is truthful, or that an external environment was actually exercised; a fresh-clone check and Independent QA must still reproduce the required behavior.
