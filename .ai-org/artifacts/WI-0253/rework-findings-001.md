# WI-0253 Same-scope Rework Findings

## Rejected candidate

Quality evaluation rejects candidate
`b0fe9161f654a17aaeefd53373770249efee0ceb` for completion because its required
`npm run verify` gate exited non-zero. The test-suite-slimming implementation did
not introduce a new failure class, but a behavioral candidate cannot advance while
the complete gate is red.

## Retained findings

The complete run reported six failure positions from two baseline harness defects:

1. `test/continuity-live-runner.test.mjs` expected the established target-collision
   error, but fixture preparation attempted to read a missing temporary
   `project-overlay/AGENTS.md` and produced `ENOENT`.
2. Four nested cases in `test/delivery-control-pair.test.mjs` stopped at
   `provider-protocol` because an unquoted `<revision>^{commit}` expression was
   expanded by zsh. Their parent case failed because the four children failed.

These exact findings are retained in
`.ai-org/artifacts/WI-0253/developer-evidence.md`. WI-0254 preserved the first
repair attempt and its cancellation. WI-0256 then qualified the same bounded
repair under immutable pre-build gates: exact candidate
`4ac435d8fa47dc246609e296a2b224c8590da55b` passed `npm run verify` across the
127-file full inventory, and distinct Quality Evaluator verification passed the
63 focused tests before accepting WI-0256.

## Same-scope decision

Return WI-0253 to Build without changing its approved scope or acceptance
criteria. The next Developer attempt must:

- retain the existing test-suite-slimming implementation and every assertion;
- include the already-qualified WI-0256 harness repair in the new candidate;
- record fresh attempt-specific Developer evidence against a new exact commit;
- rerun the full `npm run verify` gate on that commit; and
- submit the new candidate through WI-0253's existing Standard Test, Eval,
  Independent QA, and Release Gate stages.

No failed history is rewritten, and no WI-0253 gate is satisfied by WI-0256's
separate lifecycle alone.
