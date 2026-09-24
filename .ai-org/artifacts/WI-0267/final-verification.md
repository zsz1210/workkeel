# Joined verification — WI-0267 and WI-0268

Exact behavioral candidate: `0c35fd4450098f1b5bdc8ae2d2d6fe46554d2df3`.
Integration owner: agent-mog, Principal human. Both independent reviewers differ
from the Developer runtime. No later executable, fixture, dependency or contract
change was made to the tested candidate. Later changes are lifecycle/evidence and
one documentation addition naming the monitor browser gate.

## Completed checks

| Check | Result |
| --- | --- |
| `npm run verify` | Exit 0, 138 test files, 1,416 passing dot markers |
| Full log | `full-verification-01.txt`, SHA-256 `82b5d6dcfe6b2bdfcd038405706628fa113502f98c12704f4e938b5497fce2ae` |
| Full local duration | About 358.5 s from log creation to final output; diagnostic, not a benchmark |
| New monitor browser gate | 16 desktop/mobile state checks; actual and injected states labeled |
| Existing `npm run test:browser` | Exit 0; installed Chrome 154.0.8037.58; four viewports, six views, reduced motion and six attention states |
| Core-only actual tarball | Offline install without LangGraph; init, Doctor, monitor page, authenticated empty snapshot and close passed |
| Package | 493 files; 1,128,760 packed bytes; 4,322,427 unpacked bytes; no dependency/version change |
| Publication focused checks | 13 passed, including separate binary reconciliation test |
| Real maintenance | Two completed steps, 32 first-pass checks, Sol review pass, zero repairs; no third dispatch |
| Personal router | Seven offline classifier/sandbox/guard tests passed; outside the package |

The retained full log is byte-identical to the original process output. Full test
exit was observed from the process completion, not inferred from dots alone.
The actual package smoke used a fresh temporary directory and existing npm cache;
it did not publish anything or install a background service. All monitor/browser
test servers were stopped after their scoped checks.

## Independent joins

- WI-0267: `/root/monitor_publication_independent_qa`, agent-lulu, pass in
  `independent-review.md`; includes separate hashes for external personal tools
  and the post-live hardening limitation.
- WI-0268: `/root/publication_independent_qa`, agent-lulu, pass in
  `../WI-0268/independent-review.md`; independently inspected the eight new PNGs
  and all 41 decompressed archives including TAR headers and Windows path rules.
- All 117 current binary paths have exact inventory evidence. Generic audit
  remains review-required. Forty-two home-path-shaped matches are exact prior
  redaction placeholders, not live home usernames. No binary or history changed.
- The fixed-inventory archive verifier's future-coverage limitation remains
  explicit; changed/new bytes never inherit this review. No publication authority.

## Diagnostic preservation

A worker revision was initially recorded using a short Git hash and was expanded
through the supported worker command. Doctor failures were subsequently traced to
its distinct rule forbidding concurrent active claims on the same actual branch;
schema validation itself passed. The earlier green check occurred after claims
were released, not because a short hash was proven to be the cause. Final release
ownership is serialized: release the second claim, close the first, then claim
and close the second. No fictitious branch or manually edited claim is used.
A duplicate runtime attachment was rejected; the second reserved QA worker
received its own actual runtime. No fabricated ID, canonical JSON edit or failed-
history removal was used. Generated parallel plans are refreshed before checks.

## Completion boundary

The five authorized follow-ups are implemented and reviewed. Final closeout must
retain fresh fast checks, Doctor and ordinary required PR CI. A normal merge to
main is authorized; no npm publication, release/tag, native app, persistent daemon,
account setting change or additional live experiment follows from this result.
