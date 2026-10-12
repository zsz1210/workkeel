# Backup and recovery

Temple can create, inspect, retain, and restore local, transparent backups of the project-owned organization state that Temple coordinates. It can also build a bounded audit export from canonical events and recovery metadata. These are durability mechanisms for Temple state, not replacements for Git hosting, application backups, database backups, log archives, or organization-wide disaster recovery.

## Recovery boundary

A backup includes:

- `temple.lock` and the project's `AGENTS.md`, when present;
- project identity, assignments, collaboration state, specifications, context routes, Work Items, learning, decisions, events, artifacts, adapters, evidence, and other project-owned files below the declared `.ai-org/` roots;
- project-owned Skills below `.agents/skills/` that are not exact checksum-managed entries in `temple.lock`.

It excludes generated `.ai-org/views/`, framework-managed core files and Skills, application source, dependencies, Git objects, external systems, and local control-plane telemetry outside the worktree. The manifest records these boundaries, the installed Temple version, project ID, Git revision and dirty signal when available, file modes, sizes, and SHA-256 digests.

The backup directory is intentionally inspectable:

```text
project-backup/
├── manifest.json
└── files/
    ├── temple.lock
    ├── AGENTS.md
    └── .ai-org/...
```

Backups are not compressed or encrypted. They may contain sensitive project-owned documentation, so store and transmit them according to the project's own access and retention policy.

## Create and verify a backup

Write the backup outside the project worktree. The destination must not already exist. Temple stages the complete output in a unique sibling directory, verifies every payload against the manifest, and only then renames it into place.

```bash
node ./templew.mjs backup create . \
  --output /absolute/recovery/location/project-backup

node ./templew.mjs backup inspect . \
  --backup /absolute/recovery/location/project-backup
```

Use `--json` when another tool needs the content digest, manifest digest, file count, or installed-version metadata. `backup inspect` is read-only and rejects missing, extra, oversized, linked, special, or checksum-mismatched payloads.

## Prepare a restore target

This backup does not contain the application repository or framework-managed files. Recover the repository checkout through its normal Git or source-distribution path first. The target must have the same immutable project ID and the same installed Temple version as the backup. For an older backup, prepare a checkout at that backup's source revision and Temple version, restore it, and then use the normal checksum-safe upgrade path.

Do not restore an older `temple.lock` over a newer set of managed framework files. Temple reports this as a compatibility conflict instead of manufacturing a mixed installation.

## Preview, apply, and recover

Preview is mandatory and read-only:

```bash
node ./templew.mjs restore preview . \
  --backup /absolute/recovery/location/project-backup
```

The plan classifies every backed-up path as `create`, `replace`, or `identical`, lists target-only project files that will be preserved, reports compatibility conflicts, and returns a content-derived `plan_digest`. A later target or backup change makes that digest stale.

Apply the exact reviewed plan:

```bash
node ./templew.mjs restore apply . \
  --backup /absolute/recovery/location/project-backup \
  --expected-plan PLAN_DIGEST \
  --allow-replace
```

Omit `--allow-replace` when the preview contains no replacement. Temple never deletes target-only files in this release.

Before writing, Temple records before-images and a durable transaction ledger outside the worktree, preferably below the Git common directory. It updates the ledger around each target write. Ordinary errors trigger immediate rollback. If the process or machine stops mid-command, run:

```bash
node ./templew.mjs restore recover .
```

Recovery rolls back only a path that still matches the interrupted restore output. If a person or another process changed that path afterward, Temple stops and preserves the newer content for manual resolution. Completed transaction metadata is retained in a bounded local history; before-images are removed after completion or rollback.

## Inspect and retain a backup set

Phase 4A adds module APIs for deterministic retention under an explicit caller-provided backup root:

- `inspectBackupSet(backupRoot, { projectRoot })` validates every direct child as a complete backup and returns a content-derived inspection digest;
- `planBackupRetention(target, backupRoot, { minimumToKeep, preserveBackupNames })` produces a read-only keep/delete decision and `plan_digest`;
- `applyBackupRetention(target, backupRoot, { minimumToKeep, preserveBackupNames, expectedPlan, confirmDelete: true })` recomputes the plan, rejects a stale digest, preflights every deletion, and then applies only reviewed deletions.

The root must be an existing real directory outside the project worktree. Each direct child must have a conservative portable name and be a real directory containing one valid backup. Links, files, special entries, unsafe names, traversal, and a root that contains the project or is contained by it fail closed.

Retention is project-aware. It keeps at least the requested number of newest backups for the target project, ordered by parsed creation time and then name. Explicitly named backups and every backup belonging to another project are also preserved. The minimum must be at least one. A partial filesystem failure stops further deletion, reports the names already deleted and still pending, and requires a new preview before retry.

Alpha.27 exposes these APIs through the shared CLI. Preview before apply and retain the exact returned digest:

```bash
# Inspect the complete set without mutation.
node ./templew.mjs backup set-inspect . \
  --root /absolute/recovery/location/project-backups

node ./templew.mjs backup retention-preview . \
  --root /absolute/recovery/location/project-backups \
  --minimum-to-keep 3 \
  --preserve backup-before-release

node ./templew.mjs backup retention-apply . \
  --root /absolute/recovery/location/project-backups \
  --minimum-to-keep 3 \
  --preserve backup-before-release \
  --expected-plan PLAN_DIGEST \
  --confirm-delete
```

## Export bounded audit evidence

`buildAuditExport(target, options)` returns a deterministic `temple.audit-export/v1` document. `writeAuditExport(target, outputPath, options)` creates that document at an explicit new path and refuses to overwrite an existing file. The export contains:

- project ID and installed Temple version;
- the latest matching canonical events, in source order, after optional Work Item and event-type filters;
- a bounded recovery summary with transaction IDs, status and timestamps, plan and manifest digests, action-state counts, and recovery-failure counts;
- the applied selection bounds and an explicit exclusion contract;
- a content-derived export digest.

The default event limit is 1,000 and the hard maximum is 10,000. The default recovery-transaction limit is 20 and the hard maximum is 100. The event journal is streamed rather than loaded as one unbounded string, and a source line larger than 2 MiB is rejected. Malformed canonical events or unsafe recovery ledgers fail the export instead of being silently skipped.

The event projection is deliberately conservative. It allow-lists defined token-like audit fields, bounds arrays and strings, replaces free-form scalar text, omits arbitrary `metadata`, and reapplies Temple's recursive telemetry redaction with optional extra redaction keys. Repository-relative references remain usable. Absolute filesystem paths, traversal references, non-string references, and oversized references become `[REDACTED_REF]`; HTTP(S) references lose embedded credentials, query strings, and fragments.

The export never includes raw prompts or responses, hidden reasoning, credentials, runtime secrets, provider payload bodies, raw command output, tool arguments or results, recovery before-images, per-file recovery paths, or recovery failure bodies. It is still an unencrypted file containing project identifiers and event metadata. Review it under the project's data-handling policy before sharing.

Alpha.27 exposes audit export through the shared CLI:

```bash
node ./templew.mjs audit export . \
  --output /absolute/audit/location/temple-audit.json \
  --work-item WI-0001 \
  --event-type evidence_recorded \
  --max-events 1000 \
  --max-recovery-transactions 20 \
  --redact-key customer-reference
```

## Rehearse rollback on disposable copies

Never use a primary checkout as the first post-upgrade rollback experiment. Use a disposable source copy and an external backup:

1. record the primary revision, dirty state, installed Temple version, and canonical backup digest;
2. create separate pre-upgrade, forward-upgrade, rollback, and interruption copies;
3. create and inspect the pre-upgrade backup outside all project copies;
4. upgrade only the forward-upgrade copy and run the normal verification gates;
5. prepare the rollback copy at the backup's Temple version, preview the restore, and apply the exact reviewed digest;
6. compare every restored manifest digest and rebuild generated views before Doctor;
7. on the interruption copy, stop at an approved simulated boundary and prove `restore recover` returns the exact before-image state;
8. recheck that the primary checkout revision and contents never changed.

This procedure demonstrates the local software boundaries. It must not be presented as real power-loss, cross-machine, production, or disaster-recovery evidence unless those environments were actually exercised and recorded separately.

## Current evidence and limits

Automated fixtures cover boundary selection, payload tampering, deterministic retention ordering and preservation, stale retention and restore plans, explicit deletion and replacement consent, traversal and link refusal, partial retention failure, target-only preservation, project and version conflicts, interruption rollback, post-interruption human changes, conservative audit projection, recursive redaction, event and recovery bounds, exclusive audit-file creation, and a post-upgrade rollback rehearsal confined to disposable copies.

Recovery checks should use a disposable copy of the project's private state.
Preserve the original backup, compare canonical digests, and run Doctor after
restore. A local rehearsal does not qualify recovery on another machine.

Physical power loss, corrupted storage, remote or encrypted transport, another operating system, multi-machine disaster recovery, and production recovery remain separate qualification. Describe this capability as local alpha recovery, never production disaster recovery, until those named environments are exercised.
