# Developer verification

Work Items: WI-0260 and bounded package support WI-0261. Developer: agent-rikku.
This is implementation evidence, not independent acceptance or publication authority.

## Candidate history

- `319684c12a7530e23fcc83b994e77e2b302e3d39`: full offline verification passed,
  exit 0, 134 test files / 1,387 passing dot-reporter cases, 347.10 seconds wall time.
  Repository/link/package checks passed. The browser gate passed in 116.86 seconds:
  four viewports, six primary views, reduced motion and six attention states.
  Logs: `full-verification-01.log`, `browser-verification-01.log` in this directory.
- `2481c93f5524929558a85ddc82383b5cfb60b021`: final runtime correction rejects
  model-reroute events before thread/turn identification and checks fatal state
  after completion notification. The Codex fixture passed 11/11 in 1.23 seconds,
  including an early-reroute rejection with zero threads started. The earlier
  full run is retained but does not qualify this changed runtime.

Final source `2481c93f5524929558a85ddc82383b5cfb60b021` passed full verification,
exit 0: 134 files / 1,387 passing cases, 347.69 seconds wall time. Repository,
documentation-link and package-boundary checks passed. Retained log:
`full-verification-02.log`. Later historical-status prose and evidence updates
do not change the tested executable source and require the fast check separately.

No live model run is part of `npm run verify`. The last authorized subscription check must stop
after one attempt, irrespective of its result; see `subscription-priority.md`.

## Other evidence

- Final result/prose update: `npm run verify:fast` passed, exit 0, 59 cases across
  10 files; repository/link/package checks passed. Retained log:
  `fast-verification-01.log`. Final public package inventory is 490 files,
  1,108,702 bytes packed / 4,317,389 bytes unpacked after the updated prose.

- Graph focused suite: 19/19; onboarding/context: 5/5. Full verification is the
  required integration gate, not replaced by these focused editing checks.
- Sandbox report `sandbox-qualification-05.json`: 9 model-free checks, no local
  network connections; exact profile-source hash recorded in the report.
- Actual installed tarball core-only smoke: `package-smoke-01.json`; optional
  graph absent, init/doctor/status/help passed. A refreshed final-source report
  is `package-smoke-02.json`: 490 files, 1,107,886 bytes packed, 4,315,292 bytes
  unpacked, 6.31 seconds. Both reports remain available.
- `documentation-review.md`: actual desktop/mobile and dark/light visual review,
  source and generated SVG hashes. Docs skill used for reader-first structure,
  aligned translations, supported claims and working commands.
- `cleanup-audit.md` and `THIRD_PARTY_NOTICES.md`: scoped cleanup and dependency
  license inventory. Historical records and failed experiments are preserved.

## Remaining boundaries

Final authorized live check `subscription-qualification-12.json`: **fail**,
11.31 seconds, one Luna dispatch, no Sol. Model wrongly interpreted the future
expiry (15:42:16 UTC) as earlier than dispatch (15:32:17 UTC); the exact returned
attention was inspected in the retained synthetic operation journal. Cumulative
input/output tokens: 23,628 / 160; dollar/quota cost unknown. Structured attention
correctly prevented downstream execution, but functional qualification failed.
No further live model calls are authorized. Do not accept this as successful
end-to-end subscription qualification or silently change its recorded outcome.

No LiteLLM endpoint or API credentials were configured. Claude has a native
instruction bridge, not an automatic adapter. The concrete Codex host does not
intercept native tool output for Headroom. General savings, backend-model identity,
human authentication, distributed locks and exactly-once side effects are not
qualified. Whole-repository publication audit remains blocked by inherited
findings; the package boundary is a separate passing check. No external
publication, deployment, account/configuration change or test-suite redesign.
