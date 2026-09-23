# WI-0255 Developer evidence

- Behavioral candidate: `8165774f97f98e4609dbd021620f1e9852967c36`.
- Base: `53d075bcf619f655cc5613046d5ff05b3e8ab767`, a provisional stacked
  baseline; final integration of the separate test-suite task remains pending.
- Environment: local macOS, Node.js `v24.7.0`.
- Date: 2026-09-23.
- Responsibility: Developer, `agent-rikku`, attributed to Principal `human`.
- This is Developer evidence, **not** independent acceptance or release approval.

## Implemented

The first additive Workkeel migration slice adds role-free contract validation,
explicit operational/environment descriptors, actor-based review separation,
read-only legacy Work Item projection, and separate runtime/model configuration.
The optional fixed gateway descriptor is validated without reading credentials,
contacting a provider or altering the host's model selection.

Two read-only CLI entrypoints are available under the existing pinned launcher.
Malformed, incomplete, unsafe-path and secret-bearing configuration cases retain
explicit failure/uncertainty. Legacy projection never converts affected paths into
permission or modifies original records. Existing mutation guards are unchanged.

## Observed verification

1. `node --test --test-reporter=dot test/task-contract.test.mjs`: exit 0, eight
   grouped tests. Includes schema examples, source preservation, malformed input,
   bounded reading, CLI option rejection, reviewer separation and gateway policy.
2. `npm run check`: exit 0. Repository structure and documentation links pass;
   the package has exactly 462 files, including the three reviewed additions.
3. `npm run verify` on the committed candidate: exit 0, **128 test files**,
   `real 328.76`, `user 1566.37`, `sys 721.68` seconds. Raw output retained at
   `.ai-org/artifacts/WI-0255/verify-8165774f.log`. The dot reporter does not provide
   a test-case total, so no case count is inferred.
4. Pinned `work-item contract` smoke on WI-0255: valid projection, incomplete
   environment/authorization/review mapping, `execution_authorized: false`.
5. Doctor after canonical changes: healthy, 36 pass / 1 warning / 0 fail.
   Existing stale parallel-plan warning is retained; dispatch must refresh it.
6. `git diff --check`: exit 0. Package scripts, lockfile, test group runner and
   the other task's two existing test files are unchanged from the stated base.

The separate test task explicitly yielded its full-suite window before this run.
No overlapping complete-suite run or performance improvement claim is asserted.
Tokens and cost were not measured. No live LiteLLM/model/provider validation.

## Limits and remaining work

Existing lifecycle writers, init/Doctor, routing and memberships still use
Positions. This candidate does not remove those dependencies, migrate canonical
records, implement runtime enforcement, integrate LiteLLM, rename the remote or
publish packages. The full approved redesign needs subsequent governed work.

Independent verification must review this exact candidate and the new contract's
truthful non-authority boundary. It may reuse this compatible full-suite result
but must provide its own judgment and name any additional checks. No identity
switch by the Developer may stand in for that review.

## Rollback

Revert the additive feature commit through normal review. No canonical migration,
provider action or external rename requires reversal. Preserve Work Item evidence
and the separate test-suite history.
