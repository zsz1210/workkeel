# Developer verification

Developer: agent-rikku. Principal: human. This is not Independent QA.
Executable candidate: `b6f8967c5187e8f65596f9f9518e087f72f2f18c`.
Base: `314bc1b2bce586191119ca4078f5724ab485131e`.

## Delivered

Expiry is checked numerically before connecting and immediately before a turn.
The complete contract is unchanged; the separate dispatch snapshot describes only
the actual point-in-time expiry check. Missing/invalid/expired authorization
blocks work; initialization cannot silently outlive expiry. Existing sandbox,
attention, model-pinning, claim and lifecycle policies remain intact.

Four original vector diagrams, a bilingual offline state explorer and three
aligned README default/support tables were delivered. Core vs optional paths,
LiteLLM vs Workkeel selection, and runner completion vs task acceptance are
explicit. Console/macOS changes are advice only and not implemented.

## Checks

- `npm run verify`: exit 0, 135 files, 1,392 passing dot-reporter markers.
  Log `full-verification-01.log`; created 2026-09-23T16:21:16.239Z, final output
  2026-09-23T16:26:35.255Z (~319 s log interval, not a benchmark).
- `node --test test/workkeel-codex-runtime.test.mjs test/workkeel-visuals.test.mjs`:
  16 pass, 0 fail, 2.18 s; real local JSON-RPC fixtures, no model service.
- `npm run test:browser`: exit 0, four layouts, six views, reduced motion and six
  attention states. `browser-verification-01.log` (~113 s log interval).
- `visual-review.md`: actual interactive matrix and rendered diagram checks;
  initial harness preview failures are disclosed and not counted as passes.
- XML validation, local documentation links, source regeneration consistency and
  package boundary pass. Package 487 files / 4,274,703 bytes unpacked at the
  executable candidate, below the unchanged 8 MiB ceiling.
- Pre-candidate Doctor: 36 pass, stale generated parallel-plan warning, no failure.
  Refresh the plan before reviewer dispatch; final diagnostics must be rerun.

## Evaluation and limits

No added dependency or copied third-party image; project MIT covers new assets.
No live model test, account/settings change, gateway, Console rebuild, macOS app,
push, PR, publication or deployment. Previous failed subscription qualification
remains failed. The new prompt's real-model effectiveness is unverified.

Follow-up public prose records these results without changing executable source.
Independent QA must judge the exact final documentation candidate and verify its
executable equality with the tested revision above. Release is local acceptance
only; the maintainer retains external integration authority.

Rollback: revert this Work Item's product changes; preserve all historical task,
review and failed qualification records.
