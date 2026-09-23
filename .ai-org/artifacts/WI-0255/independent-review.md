# WI-0255 independent review

- Judgment: **pass for this additive contract slice only**.
- Exact behavioral candidate: `8165774f97f98e4609dbd021620f1e9852967c36`.
- Base: `53d075bcf619f655cc5613046d5ff05b3e8ab767` (provisional stacked baseline).
- Reviewer: `agent-lulu`, Principal `human`, runtime
  `/root/workkeel_contract_review`, on 2026-09-23.
- Developer: `agent-rikku`, a different actual agent/runtime. Both agents are
  attributed to one Human Principal; this is not independent-human validation.
- Scope: Test, evaluation and independent QA judgment for the approved WI-0255
  design. No release, merge, publication or authorization of later slices.

## Candidate and evidence integrity

The review inspected the full new validator/reader/projector, new focused test
file, concept reference and ADR, plus the CLI and package-boundary diffs against
the stated base. At review entry, HEAD was
`a355bf301f8cfa9270be9f7a1dfe389f258779ec`; its committed differences from the
behavioral candidate were only Developer evidence and the raw full-suite log.
The existing uncommitted changes were WI-0255 lifecycle/worker administration.
No product code, package scripts or existing tests were changed by this reviewer.

The Developer's compatible exact-candidate `npm run verify` result is reused,
not relabeled as a newly executed independent full suite. The raw
`verify-8165774f.log` shows repository/documentation/package checks followed by
128 full-suite test files and elapsed `328.76` seconds; the Developer execution
record reports exit 0. No test-case total is inferred from dot output. This reuse
respects the shared machine's full-suite timing coordination.

## Fresh observations

Local runtime: Node.js `v24.7.0`.

1. `node --test --test-reporter=spec test/task-contract.test.mjs`: exit 0;
   8 tests, 8 pass, 0 fail, 0 skipped; observed duration `877.735375` ms.
2. Nine additional in-process assertions passed: control-character paths,
   dot-segment paths, repeated separators, unknown runtime properties, unresolved
   review separation, missing done evidence, complete done structure, a gateway
   URL fragment, and expiration exactly at the current-time boundary. Every
   result retained `execution_authorized: false`.
3. Read-only projection of all 255 repository Work Items: 251 valid projections;
   the four historical exceptions are described below. All 255 returned
   `execution_authorized: false`; none were rewritten.
4. Pinned CLI projection of WI-0255: valid but incomplete, identifying unresolved
   separation, environment and authorization; observation-only/no-write, no
   boundary enforcement or provider contact.
5. Pinned Doctor: healthy, 36 pass / 1 warning / 0 fail. The warning is the
   existing stale generated parallel plan; this does not authorize new dispatch.
6. `git diff --check`: exit 0.
7. `npm run verify:fast` after this review artifact: exit 0; repository and
   documentation checks passed, package boundary remained exactly 462 files,
   and all 10 selected fast-test files passed.

## Evaluation against acceptance

- Role-free description: no Position or generic skill catalogue is required.
  Unknown properties are rejected; actor identifiers and verification separation
  are separate from display names and company titles.
- Environment/authority: explicit null fields stay incomplete. Traversal,
  absolute and malformed paths, wildcard hosts, contradictory declared
  operations and malformed gateway settings fail validation. Neither complete
  nor incomplete results assert execution permission. Actual enforcement and
  identity/approval verification remain intentionally outside this slice.
- Legacy compatibility: projection reads the existing store and retains source
  digest, schema, role/assignment and handoff revision; affected paths never
  become filesystem grants. Current lifecycle writers and guards are unchanged.
- Runtime/model separation: native host ownership and an optional fixed gateway
  are separate descriptors. Gateway validation requires explicit adapter,
  network and data-policy settings; credentials are referenced by environment
  variable name only, never read. No adapter or live-provider support is claimed.
- Product truthfulness: docs explicitly state that canonical role-free writes,
  lifecycle migration, runtime enforcement, actual LiteLLM integration and
  Workkeel executable/repository renaming are still pending. The package change
  requires exactly three new public files without widening allowed roots.

No blocking defect was found in this bounded implementation.

## Historical migration limits, not repairs

The repository-wide probe found data that cannot honestly satisfy the new
contract's stronger exact-revision/acceptance requirements:

- WI-0007 uses the short revision `ffba88a` in its candidate and last handoff.
- WI-0129 uses the short candidate `3e5178b` despite a full last-handoff revision.
- WI-0170 records `HEAD` for its candidate and last handoff.
- WI-0203 has an empty acceptance-criteria list.

Those four projections retain the source values, return validation errors and
do not claim completeness. That is a fail-closed migration diagnostic, not loss
of old records or proof that the old work failed. Future canonical migration
must explicitly reconcile such records; it must not guess historical revisions
or invent acceptance criteria. This review does not certify that every old
record already conforms to the new schema.

## Gate judgment and remaining boundary

This substantive review supports `test_evidence`, `evaluation_report` and
`independent_qa_pass` for the exact candidate above. The reviewer performed an
independent source/acceptance judgment and fresh focused/adversarial checks,
while conservatively reusing the compatible full-suite measurement.

The file reader is bounded and rejects ordinary symlink/change cases; as
documented, it is not a hostile-filesystem sandbox. No live provider, external
tracker, credential, browser/UI, multi-machine, npm publication or GitHub rename
was exercised. The test-suite task's final main integration remains a separate
dependency. Any later behavioral change needs its own exact-candidate evidence.

Next owner: Release Manager, for the local acceptance/rollback decision only.
The full Workkeel redesign remains unfinished and is not approved by this slice.
