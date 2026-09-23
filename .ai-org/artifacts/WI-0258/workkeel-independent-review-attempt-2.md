# WI-0258 — Independent review of the corrected lifecycle candidate

- Judgment: **PASS** for the three approved WI-0258 acceptance criteria;
  proceed through Standard Test, Eval and Independent QA to Release Gate.
- Exact behavioral candidate: `6bb9c98e25fe6056621ba4189ce0ed640e8f4438`.
- Reviewed checkout HEAD: `500bd3ec2a880471c1ab2fe21367c92e51dcae2c`.
- Review date: 2026-09-23, local macOS, Node.js `v24.7.0`.
- Reviewer: `agent-lulu`, Principal `human`, actual separate runtime
  `/root/workkeel_rework_acceptance`, attached worker
  `worker-20260923111127-c847b9d2`.
- Developer: `agent-rikku`, actual parent Agent `/root`. This is distinct-Agent
  Standard review under one Human Principal, not independent-human validation.
- Authority: the approved design and acceptance in `workkeel-design.md`, the
  attempt-2 Developer handoff, and the authorized formal review slice. No product,
  existing test, runner, package, global configuration or provider change was made.

## Finding M1 resolution and independent judgment

The first review rejected candidate
`3dfb3094716b207cfc0c33a411ee7c506ba7dccf` because normal legacy initialization
installed `.ai-org/work-items/README.md`, which both migration and the native task
reader rejected. The old report, fixtures and rejected attempt remain intact.

The corrected code reads only the named README through the bounded no-symlink
reader, binds its digest into the migration fingerprint and retained manifest,
and validates its pin when listing tasks. It excludes this documentation entry
from the migrated-record count. Unknown entries still fail. The new committed
regression uses actual CLI initialization, not a fabricated JSON-only store.

I independently exercised that behavior through real initialization, migration,
the generated pinned launcher, status and Doctor. The README survives byte-for-byte;
status contains no phantom task and `migrated_legacy_records` is zero for an empty
initialized store. Stale README fingerprints, unknown store entries, symlinks and
post-migration README tampering all fail closed. M1 is resolved.

## Fresh executable evidence

All commands below ran on the reviewed candidate's unchanged product tree.
Fixtures were newly created in the parent `work` directory and retained; prior
failed fixtures were not overwritten. Synthetic identities are test data.

1. `node --test wi0258-independent-checks.mjs` from the parent directory:
   **2/2 pass**, zero failures/skips, observed `3689.186042 ms`.
   Real CLI dry-run/init and pinned legacy diagnostics passed; migration preview
   made no writes; apply preserved all **129** preexisting files (including the
   supplemental policy file); pinned Workkeel Doctor passed. The native lifecycle
   independently rejected same-Principal review under a distinct-Principal policy
   and arbitrary JSON masquerading as administrative metadata, then accepted exact
   operation requests and completed a synthetic task with five history entries.
   Retained fixtures: `../wi0258-fixture-dUxjmg` and
   `../wi0258-fixture-95gPG3`.
2. `node --test wi0258-rework-independent-probes.mjs` from the parent directory:
   **2/2 pass**, zero failures/skips, observed `3402.945584 ms`.
   This new independent probe covers the M1 negative paths above and preserved all
   **128** original initializer files. It explicitly calls generated-launcher status
   and Doctor. A separate native fixture rechecks dependency evidence and candidate
   ancestry: modified accepted evidence and an unintegrated dependency revision
   cannot be claimed; the rejected operations leave the child's canonical record
   exactly unchanged; the restored accepted dependency can be claimed.
   Retained fixtures: `../wi0258-rework-probe-CRvEgB` and
   `../wi0258-rework-probe-gf79AL`.
3. `node --test test/task-contract.test.mjs test/workkeel-lifecycle.test.mjs
   test/workkeel-runtime.test.mjs`: **22/22 pass** (8 contract, 11 lifecycle,
   3 runtime), zero failures/skips, observed `9225.780292 ms`.
   Coverage includes approval/policy pins, exact claims/revisions, self-review and
   separation, replay/stale versions, rework history, scope roots, untracked or
   tracked artifact code, dependency evidence/ancestry, no-overwrite initialization,
   legacy mode, bounded paths/readers, and offline native/fixed-gateway planning.

Source review covered `workkeel-project`, `workkeel-tasks`, `workkeel-cli`,
`workkeel-runtime`, the corrected regression and current task-first quick-start.
No new behavioral blocker was found in this bounded review.

## Compatible full measurement

The Developer's complete `npm run verify` ran on the exact behavioral candidate:
exit 0, **131 test files**, Node.js `v24.7.0`, observed `real 335.35`,
`user 1605.39`, `sys 733.67` seconds. Repository, documentation-link and package
checks passed (469 package files). These are reused Developer measurements, not
my independent judgment or an independently observed total test-case count.

Raw committed log:
`.ai-org/artifacts/WI-0259/workkeel-verify-6bb9c98e.log`, SHA-256
`4a2bd1ab486491545c7685c2aa9834ed893e5fea17cda576b9dfe288c04a9f8c`.
The digest was independently verified. Candidate-to-HEAD and candidate-to-current
diffs for source, binaries, tests, docs, scripts and package manifests were empty;
remaining commits contain evidence and administration only. The compatible full
run was therefore reused without a redundant complete-suite run. Raw reporter
whitespace was preserved.

## Evaluation, limitations and next owner

- Acceptance 1 passes: native initialization, diagnostics and the complete exact
  candidate lifecycle function without Positions, with distinct-Agent review.
- Acceptance 2 passes within the stated metadata trust boundary: scope, identity,
  approvals, evidence, dependencies, stale writes and explicit legacy migration
  guards have fresh negative evidence, and prior history remains preserved.
- Acceptance 3 passes: native execution and fixed model connection planning are
  separate; offline checks pass and plans explicitly neither launch a runtime nor
  prove live gateway compatibility.

Attribution is not provider authentication. The host enforces real filesystem,
tool, network and data boundaries. Live LiteLLM/Responses tools, model routing,
automatic task-first runtime launch, multi-machine coordination, production use
and external publication remain unverified and were not performed.

The old foundation guide `docs/concepts/task-contract.md` still contains a stale
availability sentence about the absence of a Workkeel executable. The current
quick-start is accurate. This nonblocking navigation observation was sent to the
sequential WI-0259 owner for its authorized documentation review; no document or
WI-0259 state was changed by this reviewer.

This report supplies `test_evidence`, `evaluation_report` and
`independent_qa_pass` for this exact candidate. Release Gate remains the next
owner's responsibility; this review neither closes WI-0258 nor authorizes a
release. Rollback remains a reviewed revert preserving versioned records and
failed history, not lock deletion or historical-record rewriting.

Initial post-attachment repository Doctor: **36 pass, 1 warning, 0 fail**.
The warning is the generated parallel plan becoming stale after dispatch; a new
dispatch must rebuild it.

## Formal administration completed

The pinned CLI recorded Test → Eval → Independent QA → Release Gate, with this
report supplying each named gate. Generated exact-candidate handoffs are
`handoff-005-quality_evaluator-to-independent_qa.md` and
`handoff-006-independent_qa-to-release_manager.md` in this directory. No historical
handoff filename was overwritten.

Worker `worker-20260923111127-c847b9d2` is **completed**, with the actual runtime ID
and this report recorded. Its Test/Eval claim `claim-20260923111127-e6230ca3`
and the subsequent Independent QA claim `claim-20260923111833-5a4d69be` are both
**released**. No runtime resources remain reserved by this worker.

Final repository Doctor after all canonical mutations: **36 pass, 1 warning,
0 fail**, healthy; the sole warning remains the stale generated parallel plan.
Final direct canonical inspection confirms `state: release_gate`, owner
`release_manager` / `agent-mog`, zero unresolved items and no active reviewer claim.
The product/test/docs/manifest diff against the behavioral candidate remains empty.
No close, commit, push, PR mutation, merge, release or WI-0259 mutation occurred.
