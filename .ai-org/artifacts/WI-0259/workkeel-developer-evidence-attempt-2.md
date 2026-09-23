# WI-0259 — Documentation correction and exact candidate

- Developer: `agent-rikku`, actual runtime `/root`, Principal `human`.
- Candidate: `1c1d57bf4d9a0981739d91b046fc3aa6027df027`.
- Scope: approved branding design, same-scope rework B1 from
  `workkeel-brand-review-attempt-1.md`. The rejected attempt remains unchanged.

## B1 correction

`docs/concepts/task-contract.md` now states that the opt-in native lifecycle and
Workkeel executable are available in unreleased source. It separates read-only
descriptor validation and legacy projection from current task operations and
links the current quick start for the intake/create payload and explicit migration.
Its existing build-state JSON is explicitly a validator example, not a native
task-create request. Actual runtime planning and unverified live integration are
distinguished. Historical ADR scope is identified as historical, not rewritten.

All fenced command and JSON examples were independently extracted from the base
and working file and compared with Node strict deep equality: byte-for-byte equal.
No behavior, schema, test, dependency, script, package metadata or runtime setting
changed in this correction. Against behavioral candidate
`6bb9c98e25fe6056621ba4189ce0ed640e8f4438`, the sole changed product/documentation
path is the prose reference above; other differences are evidence/administration.

## Verification

- Fresh `npm run verify:fast`: exit 0, 10 fast test files, repository and document
  link checks passed; package boundary remains 469 files.
- `git diff --check` excluding raw `.log` reporter whitespace: passed.
- Pinned Doctor after claim/rework administration: healthy, 36 pass / 1 stale-plan
  warning / 0 fail. A fresh plan is required before another reviewer dispatch.
- Reuse the complete behavioral verification from exact `6bb9c98e`: exit 0,
  131 test files, local Node `v24.7.0`, 335.35 seconds. Log remains
  `workkeel-verify-6bb9c98e.log`, SHA-256
  `4a2bd1ab486491545c7685c2aa9834ed893e5fea17cda576b9dfe288c04a9f8c`.
  This compatible measurement is not a new full-suite run on the prose-only
  candidate. Both previous review rejection and self-test failure are retained.

## Handoff and boundaries

Request fresh independent judgment on this exact corrected candidate, explicitly
resolving B1 and confirming compatible reuse. Earlier branding checks and the
separate accepted WI-0258 lifecycle review remain evidence, not automatic approval.
No paid model call, live LiteLLM test, automatic task-first runtime launch, npm
publication, deployment or main merge occurred. Repository rename is separately
observed in `workkeel-rename-observation.md`. Root has not performed its own QA.
