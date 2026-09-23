# WI-0256 Developer Evidence

## Candidate

- Revision: `4ac435d8fa47dc246609e296a2b224c8590da55b`
- Branch: `codex/fix-test-harness-baselines`
- Scope: qualify the existing two-defect repair for the six retained baseline
  test failures under corrected immutable pre-build gates.

## Implementation reviewed

- `preparePreviousInstructionRuntime` reserves its target with an atomic
  non-recursive `mkdir`. Existing targets fail with `ERR_FS_CP_EEXIST` before any
  copy or instruction write, while other filesystem errors are preserved.
- The delivery-pair replay passes `git rev-parse <revision>^{commit}` through the
  existing shell-argument quoting path, so zsh cannot treat the peel suffix as a
  glob and the exact-candidate assertion remains unchanged.
- No assertion, test case, safety boundary, or full-suite inventory entry was
  removed or skipped.

## Exact-candidate verification

The worktree was clean and `git rev-parse HEAD` returned the candidate above
before verification.

- `npm run verify`: exit code 0 on the exact candidate.
- Repository checks: passed for 118 overlay files and 10 Positions.
- Documentation-link checks: passed.
- Package boundary: passed for 459 files, 1,042,826 packed bytes, and 4,023,286
  unpacked bytes.
- Full test inventory: all 127 declared test files completed without failure.
- Wall-clock time: 332.44 seconds.
- Post-verification `node ./templew.mjs doctor`: 37 pass, 0 warn, 0 fail after
  rebuilding the generated parallel plan.
- Candidate SHA remained exact and the worktree remained clean before this
  post-candidate evidence file was added.

## Prior evidence boundary

WI-0254's 63/63 focused run and detached-candidate QA remain retained historical
evidence, but they are supplementary only. This document records a new full gate
on WI-0256's exact candidate and does not convert WI-0254's cancelled lifecycle
into a completed one.

## Boundaries and rollback

- No UI changed, so no browser gate applies.
- This is Developer evidence, not the Quality Evaluator's independent judgment.
- WI-0253 remains at its frozen test-slimming candidate until its own rework and
  exact-candidate evaluation are performed.
- Rollback is a normal revert of the bounded harness-repair commit
  `b863ee4976c9ed1c8fe586525401b2dddcea39bc`; retained evidence must not be
  rewritten.
