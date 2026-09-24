# WI-0253 Test evidence — rework attempt 1

## Candidate and responsibility

- Exact candidate: `6ace82eba938cbd7cde491f0b7126af6b5e9bd12`
- Rejected predecessor: `b0fe9161f654a17aaeefd53373770249efee0ceb`
- Quality Evaluator: Lulu (`agent-lulu`), Principal `human`
- Developer: Rikku (`agent-rikku`)
- Test claim: `claim-20260923103328-2a8f84fe`
- Runtime: Node.js `v24.7.0`

This is fresh attempt-specific Test evidence. It retains the predecessor's failed
full-gate history and does not rewrite WI-0254 or WI-0256 evidence.

## Candidate integrity and review

The fresh detached checkout
`<LOCAL_HOME>/Documents/Codex/2026-09-23/temple-test-slimming/work/wi0253-qa-exact`
reported HEAD exactly equal to the candidate and remained clean after testing.
Git comparisons found no byte or mode difference between the candidate and the
coordination branch anywhere in WI-0253's affected scope:
`scripts/test-groups.mjs`, `package.json`, `docs/getting-started/testing.md`, and
the complete `test` tree.

The slimming-owned runner, package scripts, guide, group contracts, and CI-scope
contracts are byte-identical to the rejected predecessor. The corrected candidate
adds only the separately qualified harness repairs: atomic collision reservation
in `scripts/continuity-live-runner.mjs` and quoted Git peel arguments in
`test/delivery-control-pair.test.mjs`.

No assertion, test file, inventory entry, failure diagnostic, authority guard,
recovery check, or security boundary was removed. The 13 relocated files remain
in the explicit 127-file full inventory. Unknown/shared/state/package/deleted-test
changes still fail toward full selection; a changed test selects its whole group
plus fast contracts.

## Fresh focused execution

Command:

`node --test --test-reporter=spec test/test-groups.test.mjs test/ci-scope.test.mjs test/continuity-live-runner.test.mjs test/delivery-control-pair.test.mjs`

Result: **72 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo**; reported duration
144,776.517375 ms. This includes the group/CI contracts, deliberate compact-
reporter failure diagnostic, target-collision regression, all four formerly
blocked delivery-pair child scenarios, and their parent.

Dependency preparation used `npm ci --ignore-scripts --prefer-offline`: exit 0,
7 packages installed, 0 vulnerabilities reported.

## Exact-candidate full measurement reused

The fresh Developer measurement in `developer-evidence-rework-001.md` was read
and conservatively reused rather than represented as this evaluator's command:
`npm run verify` exited 0 on the exact candidate; repository, documentation-link,
and package checks passed; all 127 declared test files completed without failure;
wall time was 338.03 seconds; post-run Doctor was 37 pass, 0 warn, 0 fail.

A second full run was not started because Workkeel owns the exclusive full-test
window. This does not weaken the gate: the retained result is fresh, SHA-specific,
and the evaluator independently verified candidate integrity, source behavior,
and all 72 scoped contracts.

## Test judgment

**PASS** for Standard Test on the exact corrected candidate. The six predecessor
failure positions no longer recur, the full gate is green, and no new failure or
coverage gap was found. This Test result is not Eval, Independent QA, Release
Gate approval, merge, publication, or deployment authorization.
