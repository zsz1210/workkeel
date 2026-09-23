# WI-0253 Developer Evidence — Rework Attempt 1

## Candidate and provenance

- Exact candidate: `6ace82eba938cbd7cde491f0b7126af6b5e9bd12`
- Rejected predecessor: `b0fe9161f654a17aaeefd53373770249efee0ceb`
- Runtime: Node.js `v24.7.0`
- Branch: `codex/fix-test-harness-baselines`
- Rework finding: `.ai-org/artifacts/WI-0253/rework-findings-001.md`

The candidate retains the original test-suite-slimming implementation and adds
the separately qualified WI-0256 repair for the two baseline harness defects.
The slimming-owned runner, package scripts, testing documentation, CI-scope test,
and group-contract test are byte-identical to the rejected candidate. Within
WI-0253's broad `test` scope, only
`test/delivery-control-pair.test.mjs` differs, and that change is the already
reviewed literal Git peel-expression repair. The corresponding runtime collision
repair is in `scripts/continuity-live-runner.mjs`.

No assertion, test case, group inventory entry, safety boundary, or retained
failure diagnostic was removed or skipped.

## Fresh exact-candidate verification

The worktree was clean and `git rev-parse HEAD` returned the candidate above when
the full gate started.

- `npm run verify`: exit code 0.
- Repository checks: passed for 118 overlay files and 10 Positions.
- Documentation-link checks: passed.
- Package boundary: passed for 459 files, 1,042,826 packed bytes, and 4,023,286
  unpacked bytes.
- Full inventory: all 127 declared test files completed without failure.
- Wall-clock time: 338.03 seconds (`user 1600.32`, `sys 728.06`).
- The six failure positions retained by the rejected candidate did not recur.
- Post-verification `node ./templew.mjs doctor`: 37 pass, 0 warn, 0 fail after
  rebuilding the generated parallel plan.
- Candidate SHA remained exact and the worktree remained clean before this
  post-candidate evidence file was added.

## Retained measurement evidence

The rejected candidate's Developer evidence remains the source for the same-
runtime before/after measurement and coverage map because the slimming-owned
implementation is unchanged:

- fast: 10 files / 59 tests / 4.80 seconds on the original candidate;
- representative daily: 45 files / 414 tests / 104.20 seconds;
- complete inventory: 127 files and structurally 1,329 tests;
- focused group/CI contracts: 9/9 passed;
- successful output uses compact progress while deliberate-failure tests preserve
  names, assertion values, stack and source file.

Those measurements remain diagnostic single-machine samples, not a universal
performance guarantee. The fresh green full gate above replaces the predecessor's
failed completion result; it does not rewrite the older observation.

## Boundaries and rollback

- No UI changed, so no browser gate applies.
- This is Developer evidence, not Test, Eval, Independent QA, Release Gate, PR,
  merge, publication, or deployment approval.
- WI-0258 remains a separate Workkeel product slice in another worktree; only its
  reconciled management records are present here.
- Rollback is a normal reviewed revert of the test-slimming and harness-repair
  commits while retaining all failed and passing lifecycle evidence.
