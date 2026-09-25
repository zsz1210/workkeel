# Complete evidence census and bounded recovery

Base: `ff94b638f49fea215cec0e579b92159e1a852628`. The source implementation is
unchanged from tested candidate `2673ebe34a5c55a3a70c25e079f5fde8659723a8` (WI-0270).
This candidate only adds source maps and self-hosted delivery/evidence records.

## Complete snapshot, not the earlier partial failure scan

594 records reference 1,820 artifacts at 1,180 distinct paths. Originally 151
records are retrievable at their tested scope. The previous pilot recovers another
3. This run fully recovers 435 more. Five records remain historical exceptions:
four explicitly invalidated source conflicts and one unversioned unverified claim.
The earlier 147 failed exports were not a complete census.

889 artifact references match their tested commit; 927 were absent there; four
have digest conflicts at their tested commit. All 927 missing references have
exact matching Git content: five retain the prior map and 922 receive new maps.
There are no recorded exact commits missing from local Git. The null-scope claim
is deliberately unverified, not a lost Git commit. 128 records have no artifacts;
their archives contain metadata and do not back up Git commit objects.

## Executed recovery and verification

- 19 immutable source maps appended in batches of at most 25 records, covering
  922 artifact references; prior map preserved. Existing APIs validate full entry
  digest, exact source commit, original artifact hash/size, regular mode and absence
  at tested scope. Identical recording replay was a no-op.
- 26 full bundles contain 589 records and 1,800 artifact references, 21,230,060
  decoded bytes. Each was imported in a separate directory without source commits
  and retrieved using existing archive APIs. Original entries match byte-derived
  snapshot metadata; false source availability and no acceptance were reported.
  Tampered copies were rejected without mutation in every bundle batch.
- Two conflicted records additionally recovered three missing files. Their full
  export still correctly fails. Separately retained partial content is explicitly
  an audit artifact, not a valid evidence bundle or reinstated acceptance.
- An independent Python standard-library decoder and direct Git cat-file check
  cross-checked all 589 records / 1,800 references against the original registry,
  including 1,368 distinct Git source locations and 1,250 content hashes.
- All 35 prior invalidations remain: 31 in complete bundles and four unresolved
  conflicts. Three explicit replacement records for conflicted evidence are
  independently confirmed retrievable and not invalidated. No replacement was
  invented where the registry did not provide one.
- All 236 tested/artifact source revisions are reachable from remote main or
  exact remote preservation tags. No source refs were deleted or force-updated.
- Original registry SHA-256 remains
  `f0b3f0f58200a111828dda9fafc99046a586f49ec95107dee3e3bef3758b16e3`.
- `npm run verify:fast`: exit 0, ten test files, repository/docs/package checks
  passed. Frozen implementation full-suite evidence belongs to WI-0270; it is not
  claimed as rerun here. Doctor and actual distinct data review remain final gates.

## Retention judgment and limits

No historical path is approved for deletion. Archives do not redirect consumers
of the original paths or prove authenticated past test execution. Portable local
readback is verified, but a separate backup-location restore is not. Preserve
registry, original artifacts, source maps, Git refs, invalidations and review history.
Next assess external backup/restore and reference migration before any deletion.
No package publication, deployment, install, global setting or new benchmark.

The exact source-map list, external bundle hashes, method hashes and reconciled
counts are in recovery-index.json. External detailed evidence and the Traditional
Chinese report are in `outputs/workkeel-evidence-recovery-batches-20260925/` in the
coordinator task workspace. Scripts there are local audit methods, not product APIs.
