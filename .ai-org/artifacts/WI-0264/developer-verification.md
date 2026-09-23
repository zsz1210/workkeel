# Developer evidence: task measurements

Product candidate: `c901c420080326965a62ec483328fb7bd44a047f`.
Base: `5729bd91bbfe973b7ebfc83ddf8097a727d52a2d`.

Implemented additive per-operation snapshots and monotonic adapter-call timing;
read-only task/run metrics; null/partial accounting; bounded allowlisted data;
three aligned README entries and a public measurement guide. No dependency,
browser/Console UI, live-model, global-setting or external changes.

Focused verification: 44/44 pass, zero failures/skips, 13.231 seconds Node test
wall time. Source is the committed candidate; log is local ignored evidence at
`focused-verification-02.log` in this directory. The preceding retained
`focused-verification-01.log` failed because the multi-run fixture omitted the
release summary. An earlier interactive attempt also omitted its claim ID. Both
were fixture setup errors; the task mutation guards remained unchanged.

Repository/link/package check passed: 489 files, 1,119,138 bytes packed,
4,295,104 bytes unpacked at the observed check. Doctor 37 pass, 0 warn, 0 fail
before candidate commit. No UI change, so no browser gate is claimed.

Full `npm run verify` is currently running against this exact product candidate;
`full-verification-01.log` preserves its output. This document does not claim that
pending run passed. The reviewer must obtain its final exit status and retain a
completion record before acceptance. All checks are offline simulated providers;
no subscription quota, model quality, real cost or speedup was measured.

Required reviewer focus: result-null failures retain usage without granting
replay; final null cannot be filled with stale partial values; snapshots replace
instead of add; no model/effort selection changes; call durations are not wall or
model-compute time; old/uncollected records stay unknown; integrity and privacy
boundaries remain enforced. No further live model trial is authorized.
