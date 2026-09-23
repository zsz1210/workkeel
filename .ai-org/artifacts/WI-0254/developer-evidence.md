# WI-0254 Developer Evidence

## Candidate

- Revision: `b863ee4976c9ed1c8fe586525401b2dddcea39bc`
- Branch: `codex/fix-test-harness-baselines`
- Scope: repair the two underlying causes of the six retained baseline failures.

## Implementation

- `preparePreviousInstructionRuntime` now reserves its target with an atomic
  non-recursive `mkdir`. An existing file, directory, or symlink is converted to
  `ERR_FS_CP_EEXIST` before any copy or instruction write; other filesystem errors
  are preserved.
- The delivery-pair replay uses the existing argument-quoting execution path for
  `git rev-parse <revision>^{commit}`. The exact candidate assertion is unchanged,
  while zsh no longer interprets `^{commit}` as a glob.
- No assertion, test case, safety boundary, or full-suite inventory entry was
  removed or skipped.

## Verification

- Focused edit-time run:
  `node --test --test-reporter=spec test/continuity-live-runner.test.mjs test/delivery-control-pair.test.mjs`
  passed 63/63 tests. This confirmed all six former failure positions, including
  the four delivery-pair child scenarios and their parent, passed.
- After the atomic target-reservation refinement,
  `node --test --test-reporter=spec test/continuity-live-runner.test.mjs` passed
  27/27 tests.
- Exact candidate `b863ee4976c9ed1c8fe586525401b2dddcea39bc`:
  `npm run verify` passed with exit code 0. Repository checks, documentation links,
  package-boundary validation, and the explicit 127-file full test inventory all
  completed successfully. No failure diagnostic was emitted.
- Post-candidate `node ./templew.mjs doctor . --compact --json`: 36 pass, 0 fail,
  1 warning. The warning is the known stale generated parallel plan; WI-0254 is
  sequential and did not use parallel dispatch.
- Candidate SHA remained exact after verification and the worktree was clean
  before this post-candidate evidence file was added.

## Boundaries

- No UI changed, so no browser gate was applicable.
- This is Developer evidence, not the Lean verifier's independent judgment.
- WI-0253 remains at its frozen test-slimming candidate. WI-0254 is stacked after
  it and owns only this separate baseline-harness repair.
