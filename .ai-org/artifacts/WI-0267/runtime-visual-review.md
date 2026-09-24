# Code-first monitor runtime review

Developer review on 2026-09-24. Actual installed Chrome, real loopback server with
synthetic task-first journal, 1440x1000 desktop and 390x844 mobile. No credentials,
provider calls, private account values or live project content in screenshots.
Screenshots are retained locally, not added to the reviewed binary inventory.

`node scripts/verify-workkeel-monitor.mjs` passed 16 viewport/state checks.
Actual journal states: completed, interrupted/partial, unobserved and empty.
Browser-injected projection states: changed running measurements and 503 error.
These injections test rendering/polling, not real model execution or liveness.
Read recovery, missing access link after reload, escaped HTML-like task title,
keyboard focus order, no document horizontal overflow, no browser JS errors and
reduced-motion operation passed. Partial totals remain visibly labeled; unknown
cost/backend and no inferred percentage remain explicit.

The coordinator also opened the page with Playwright CLI, switched tasks, resized
to mobile/desktop and visually inspected both screenshots. Mobile summary cards
wrap without clipping. The operation table scrolls inside its labeled keyboard-
focusable region rather than expanding the page. A stale read hides the previous
detail instead of presenting it as current. UI matches the code-first brief.

The independently measured Luna display module was copied byte-for-byte after
32 coordinator checks and Sol source review; it was not rewritten during UI work.
Final candidate identity and complete verification belong in developer-evidence.
