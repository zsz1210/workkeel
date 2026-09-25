# Developer verification

Tested behavioral candidate: `379b03387ad4eeb4f07d05021eec9e7fd2236088`.
Node 24.20.0, macOS arm64, Codex 0.155.0-alpha.16.3.

- Focused host Skill, runtime and version regressions: 23 passed, no failures.
- `npm run verify`: exit 0; repository, documentation links, package checks and
  all 141 test files passed. Existing dependencies were reused; no install.
- Real host metadata probe: 49 external Skills disabled, effective host controls
  passed. No model call was made by those probes.
- Two actual GPT-6 Sol / medium turns: both completed/done, no repair, 27/27
  coordinator source checks passed. Each retained one required project Skill and
  read its required reference, while all 49 external Skills were disabled.
- Audit used 105743 tokens / 59.005 seconds; backlog used 110510 tokens / 70.559
  seconds. The sum is 216253 tokens, not a subscription price or savings claim.
- Both report tasks received distinct coordinator review and normal acceptance.
  Historical attention results were not rewritten. These reruns used frozen real
  maintenance sources plus a local Skill fixture, with concurrent full tests;
  they are qualification samples, not a controlled performance experiment.
- Doctor: 36 pass, 1 pre-existing stale generated parallel-plan warning, 0 fail.
  Sequential work did not use the stale plan. No UI changed; browser gate N/A.

Independent candidate QA and Release Gate are still next-owner work. Required
references remain mandatory and filesystem/network permissions are unchanged.
Effective catalogue validation is point-in-time; reference changes after it can
still require attention. Other Codex versions and machines were not tested.
