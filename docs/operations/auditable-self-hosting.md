# Auditable Self-Hosting and Evidence Profiles

Temple keeps decisions, Work Items, handoffs, evaluations, and release evidence beside the code. **Auditable Self-Hosting** applies that same operating model to the framework or project that provides it: the repository can show how its own changes were governed instead of presenting only a polished final snapshot.

That transparency still needs a publication boundary. An **Evidence Profile** states what the project intends to expose, what must be normalized, and what stays local. It does not change repository visibility or publish anything.

## Choose a profile

The project owns `.ai-org/project/evidence-profiles.json`.

| Profile | Use it when | Local environment details | Reviewed legacy evidence |
| --- | --- | --- | --- |
| `private` | The repository is private or internal | Review required | Review required |
| `public` | The source repository is intended to be public | New findings are blocked | Exact baseline matches require review |
| `restricted` | Customer, regulated, or confidential data may be present | Blocked | Blocked |

New Temple projects start with `private`. Changing the profile is a project policy decision; it is not an instruction to GitHub, GitLab, npm, or another host.

## What the public profile keeps

The public profile is designed to retain the evidence that makes development inspectable:

- lifecycle state, accepted scope, decisions, and handoffs;
- evaluation, Independent QA, and release-gate records;
- requested and effective model-routing metadata;
- Token counts and approved Token or time budgets;
- whether Credits, resets, retries, or fallback were allowed or prohibited; and
- experiment protocols, observations, limitations, and outcomes.

These facts describe governance and results. They are not credentials.

## What stays local

Temple blocks high-confidence secret and private-key shapes in every profile. Raw Provider telemetry, raw prompts or responses, live account balance or reset-availability snapshots, and tracked runtime-state directories are local-only.

For a public profile, new maintainer-specific home paths, private IPv4 addresses, and private Tailnet hostnames are also blocked until they are replaced with repository-relative paths, placeholders, or documentation-range addresses.

The scanner never prints the matched value, the containing source line, or its internal fingerprint. Rotate a real credential even if it appears only in history; redaction is not a substitute for revocation.

## Audit before publication

Run both current surfaces:

```bash
node ./templew.mjs publication audit . --profile public --surface both
```

Or inspect one surface as JSON:

```bash
node ./templew.mjs publication audit . --profile public --surface package --json
```

The command returns:

- `blocked` when at least one item must be resolved before the selected surface is published;
- `review-required` when no blocker exists but retained legacy or binary content still needs a human decision; or
- `allowed` when the bounded text inspection found neither condition.

The audit reads current Git-tracked files and the exact `npm pack --dry-run` manifest. It performs no lifecycle mutation, external request, visibility change, or publication.

## Adopt an existing repository without rewriting history

An existing project can record a reviewed full Git commit under `reviewed_legacy_baseline`. Temple fingerprints matching environment details in memory. If the same rule, path, and value existed at the baseline, the public repository audit reports it as `retained-legacy` and `review-required`. A new occurrence, a changed value, or an additional duplicate remains blocked.

The baseline is intentionally narrow:

- it applies only to the repository surface;
- it never excuses credentials, local-only runtime data, unreadable files, or inspection failures;
- it never applies to the npm package; and
- it records the reviewer, time, and rationale without storing detected values.

This is a migration mechanism, not an assertion that historical material is risk-free. Review the selected revision before recording it. Temple does not rewrite old commits or pull requests.

## Keep a reviewed adapter fixture without patching its source

A pinned installed adapter can contain a deliberate local-environment fixture that tests a security boundary. Do not weaken the scanner or edit the vendored copy merely to clear the report. A project may instead add one `reviewed_adapter_fixtures` entry to its Evidence Profile with the exact source path, rule, line, occurrence count, SHA-256 digest, installed-adapter manifest, approver, time, and rationale.

The repository audit accepts that occurrence only while the current file digest and the digest recorded by the adapter manifest both match. Drift, excess occurrences, missing provenance, unsafe paths, and unsupported rule classes are blocked. The disposition never applies to package contents, credentials, local-only data, inspection failures, first-party files, or binaries, and the allowed occurrence remains visible in the report.

## Minimize completed canonical records

Completed lifecycle records can retain machine-local worktree locations and Evidence descriptions even after execution has ended. Do not mass-edit those JSON files. Temple can prepare a field-aware, value-redacted plan instead:

```bash
node ./templew.mjs publication normalize-plan .
```

The preview lists affected canonical files, field classes, counts, before/after digests, and a deterministic plan digest. It never prints a matched local value or changes project state. Review the plan, then apply that exact digest through an actively claimed Work Item:

```bash
node ./templew.mjs publication normalize-apply . \
  --work-item WI-0001 \
  --expected-plan <plan-digest> \
  --confirm-normalization \
  --actor <claim-agent-id>
```

The operation clears worktree fields only for released claims and terminal workers or tasks. It also replaces local values in Work Item `scope`, `acceptance_criteria`, and `unresolved` descriptions and in strings below Evidence `details` with typed placeholders. It does not change active execution coordinates, Work Item path/ref fields, Evidence IDs, revisions, artifact paths, or artifact digests. A sensitive active coordinate, stale plan, failed schema check, or incomplete write stops the operation and leaves the pre-apply files in place.

Run `normalize-plan` again after success; `no-changes` is the idempotence check. The recorded audit event proves that a bounded canonical migration occurred, but does not authorize publication.

## Normalize retained current-tree artifacts

Retained reports and observations below `.ai-org/artifacts/` are evidence, not canonical lifecycle state, but their current-tree copies can still contain obsolete machine-local details. Preview a Git-tracked-only normalization plan:

```bash
node ./templew.mjs publication artifact-plan .
```

The plan shows paths, rule counts, the current Git revision, before/after digests, and a deterministic plan digest without printing matched values. Apply the exact reviewed plan through an active Work Item:

```bash
node ./templew.mjs publication artifact-apply . \
  --work-item WI-0001 \
  --expected-plan <plan-digest> \
  --confirm-normalization \
  --actor <claim-agent-id>
```

The operation changes only tracked regular text files below `.ai-org/artifacts/`, validates changed JSON and JavaScript, records a value-redacted event, and rolls back partial failure. It does not rewrite Git history, alter canonical Work Items, touch source or test fixtures, review binaries, or authorize publication. Re-run `artifact-plan`; `no-changes` confirms idempotence.

## Binary, history, and hosted-log review

The command identifies binary files but does not OCR screenshots or claim their contents are safe. Review rendered images, archives, and other binaries separately.

It also does not scan every historical commit or hosted CI log during an ordinary run. Keep package/current-tree checks fast in routine CI, and run full-history, hosted-log, dependency, license, and visual checks at the release gate. A passing publication audit is necessary evidence for that decision; it is not a security certification and does not authorize release.

## Common remediation

| Finding | Preferred change |
| --- | --- |
| Absolute home path | Use a repository-relative path or `/path/to/project` placeholder |
| Private LAN address | Use a placeholder or an address from the documentation ranges |
| Tailnet hostname | Use `<device>.<tailnet>.ts.net` only in prose that cannot be parsed as a real hostname |
| Raw runtime or account snapshot | Keep it in the configured local state directory and out of Git |
| Credential shape | Remove it, rotate it, and inspect history and hosted logs before publishing |
| Binary file | Open/render it and record a separate human or visual review |
| Deliberate pinned-adapter fixture | Bind the exact finding and file digest to its installed provenance manifest; never use a broad path allowlist |

See [ADR-0048](../adr/0048-auditable-self-hosting-evidence-profiles.md) and [ADR-0049](../adr/0049-bind-reviewed-adapter-fixtures-to-provenance.md) for the design rationale. Publication requires a separate history and package-boundary review.
