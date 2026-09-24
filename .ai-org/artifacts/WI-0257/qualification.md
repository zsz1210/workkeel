# WI-0257 candidate qualification and Lean closeout

Product candidate: `5a6e4f8ef4015a9b6ebdc9d865170da278186acd`.
Base: `9b2669dfd7918393e9f241d8d71a0b917326ba35`.
Checkout: `<LOCAL_HOME>/Documents/ChatGPT/temple-compact-evidence`.
Branch: `codex/compact-evidence-output`. Node: `v24.20.0`.

## Exact candidate verification

Coordinator ran `/usr/bin/time -p npm run verify` once on the frozen candidate.
Exit status 0. Repository checks: 118 overlay files, 10 Positions. Documentation
links passed. Package boundary: 454 files, 1,023,227 packed bytes, 3,964,327 unpacked
bytes. Full Node test result: **1,303 passed, 0 failed, 0 cancelled, 0 skipped,
0 todo**, duration 307,540.6965 ms. Complete command wall time: **308.93 seconds**.

Raw evidence: [full-verify.log](full-verify.log), SHA-256
`111ff8105acce64e0f46c086e0feaf09cb4e73cb44bd24a8965bd8c1f3ecf227`.
The retained artifact was digest-compared to the original command log; they match.
Node emitted the existing recursive test-runner warning from discovering
`scripts/test-groups.mjs`. The same warning is present in the retained WI-0252
accepted baseline. The parent suite completed with the totals above; the warning
is retained, not hidden or presented as a new feature defect.

The 11 changed product files were independently compared with `git show` bytes
and `git ls-tree` executable modes at the candidate revision: all matched.
Final product worktree status after the full suite was clean. No product edits
were made after the distinct verifier reviewed this candidate.

## Distinct judgment and sample acceptance

Actual separate runtime `/root/compact_evidence_verifier`, `agent-lulu`, supplied
PASS with no blocking defect in its bounded review. Developer is `agent-rikku`.
Its exact judgment and limits are preserved in [verifier.md](verifier.md):
7 focused tests and 10 additional assertion groups passed, including a real
intentionally failing Node spec fixture. This is Lean Quality Evaluator review,
not a claim that Standard/High-Assurance formal Independent QA or release ran.

Coordinator's actual seven-sample acceptance is in [measurements.json](measurements.json):
74/74 predetermined information checks retained; 7/7 digest-bound original reads
byte-equal; source digests unchanged. Seven compact calls plus seven original
reads, zero model calls. Original content 83,653 tokens, compact content 33,713,
actual compact JSON envelopes 40,880, measured with o200k_base. Envelope comparison
saves 51.1% against raw original payloads on these samples; no billed-cost,
cache-efficiency, task-quality or provider-latency claim follows.

All bounded design acceptance criteria passed. No unresolved blocking product
defect remains within this slice. Original source evidence, permissions, lifecycle
authority and existing output defaults remain unchanged by the new command.

## Closeout boundary

Authorized implementation, measurement and verification are complete. Keep the
feature optional: short reports can grow after metadata; successful test names
and timings omitted from the reading view require the original. The source hash
binds bytes, not truth or acceptance. Hostile filesystem races were not qualified.

No main merge, publication, deployment, Headroom integration, provider experiment
or global adoption was performed. Canonical WI-0257 administration is retained in
the shared canonical checkout separately from the product branch, avoiding the
other task's WI-0253 through WI-0256 records. Those unrelated records are not part
of the product candidate. Rollback is to stop invoking the additive command, or
revert its product commit; preserve actual evidence.

Next recommendation: review and merge this qualified branch, then use the compact
view selectively for long test logs. That follow-up is not started by this
closeout. User report: [REPORT.zh-TW.md](REPORT.zh-TW.md).
