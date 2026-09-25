# Frozen candidate verification

Candidate: `2673ebe34a5c55a3a70c25e079f5fde8659723a8`.
Coordinator observations, with separate actual independent QA judgment.

- `npm run verify`: exit 0, full 140 test files. Repository checks, documentation
  links and package boundary passed (500 files, 4,374,792 unpacked bytes).
- `node --test test/field-evidence.test.mjs`: 12 passed, zero failures. Covers
  unchanged v1 semantics, source-map recording, portable v2 archive and readback,
  preserved failed/invalidation metadata, stale binding and tampering rejection,
  limits, symbolic links, direct commit objects, collisions and CLI operations.
- Three original WI-0168 records exported through the real CLI with three repeated
  --evidence flags; all three IDs and five artifacts were present. Repeated again
  on the frozen candidate as counterevidence to review 0. Exit 0 both times.
- Five real files, 5,788 bytes, recovered from exact Git sources and read back in
  an isolated directory; registry bytes unchanged. See pilot-verification.md.
- Tested commit preservation tag exists remotely; both artifact source commits
  are ancestors of origin/main. This is source retention evidence, not a new
  attestation that the old tests actually ran or passed.
- Actual distinct GPT-6 Sol / medium reconsideration: PASS. The reviewer explicitly
  retracted its prior false --evidence finding after inspecting the same source.
  Preserve independent-review-0.md, independent-review-1.md and the external
  multi-record-cli-proof.json. No product changes were made between these reviews.

No browser gate is needed: no UI code changed. No new dependency, global model or
account setting, deployment, package publication or historical deletion occurred.
Canonical closeout changes after the candidate are metadata only; final physical
product bytes/modes must match this candidate before integration.
