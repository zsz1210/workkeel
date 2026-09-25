# Final candidate verification and QA reconciliation

Accepted behavioral candidate: `c6dd4ff4f268393fe087ee92232e989fb4f6bd55`.
Root coordinator verified physical product bytes/modes and all 113 supplied QA
reference files against this revision. Later lifecycle/evidence commits do not
claim new behavioral test execution.

Fresh focused verification passed 24 tests. Fresh `npm run verify` exited 0 across
141 test files; retained output is full-verify-1.log, with full-verification-1.json.
The actual alpha.16.3 preflight retained one enabled project Skill and 49 disabled
external Skills without any model turn. Explicit required files and all existing
authorization, fixed-model and sandbox checks remain unchanged.

Actual separate GPT-6 Sol / medium review first returned FAIL on 379b0338, finding
missing positive preservation of local Skills. The normal same-scope rework path
retired that candidate's gates. A new independent Sol / medium review of c6dd4ff4
returned PASS after examining the repair and full relevant boundary. This review
is static judgment; coordinator-owned Git and tests were not rerun by the reviewer.
The coordinator separately verified source identity and test results. Original
FAIL and PASS outputs are retained as independent-review-0.md and -1.md.

Two actual report task turns on the earlier 379b0338 candidate completed normally,
consumed a named project Skill and required reference, passed 27 source checks and
were locally accepted. They are not claimed as c6dd4ff4 live turns. The final repair
adds a pre-thread assertion, qualified by fresh tests and real host preflight.

Task turns used 216253 tokens. Initial QA used 352924; repaired QA used 222771.
Total four model calls: 791948 tokens. Billing is unknown. These qualification
samples do not prove token savings, population quality or performance. Prior daily
attention outcomes remain historical failures, without rewriting or replay.

Review preparation briefly exceeded the local helper's default stdout buffer
while hashing the large historical events file. It failed before any model call
or claim, then completed the missing manifest using a bounded 32 MiB buffer.
No repository code or model budget changed for that local harness recovery.

No UI changed; browser verification is not applicable. Other machines/CLI versions
and Gateway live qualification are outside this delivery. Catalogue validation
remains point-in-time. Rollback uses a normal reviewed revert of the product
change; preserve failed, repaired and final evidence.
