# ADR-0040: Gate the Management Console with installed Chrome and semantic browser contracts

## Status

Status: Accepted for compatibility design.

## Context

Temple's Management Console tests verify server responses, HTML generation, state projections, and interaction helpers. Those checks remained green while real rendered screens still showed collapsed spacing, narrow-sidebar distortion, clipped text, and overlapping content. Manual Playwright reviews found and corrected the defects, but their commands and screenshots were not a repeatable release gate.

A complete bundled-browser test stack would add a large download and another source of CI cost. A home-grown Chrome DevTools Protocol client would duplicate mature browser-automation behavior and create a maintenance burden.

## Decision

Use exact `playwright-core` version `1.62.1` as a development-only dependency under Apache-2.0. Launch an already installed Google Chrome through Playwright's branded `chrome` channel. Do not download, vendor, cache, or distribute a browser binary.

Build a repository-owned semantic browser harness around the real loopback Control Plane. Cover mobile, tablet, desktop, and ultrawide viewports. Assert navigation, live rendering, document overflow, primary text clipping, named high-level region intersections, keyboard tab behavior, reduced motion, browser console errors, and uncaught page errors. Preserve a failure screenshot, but do not use pixel snapshots as the pass/fail oracle.

Run the browser gate only in the existing Node.js 24 full GitHub Actions lane and include its outcome in the final aggregated result. Do not add a job, duplicate the browser gate on Node.js 22, or run it for documentation/evidence-only changes.

## Consequences

- A green hosted full lane now includes a real human-interface render, not only strings and server contracts.
- Normal CI gains one Chrome launch inside an already-running full job; narrow lanes retain their measured runtime advantage.
- Local contributors need Google Chrome to run `npm run test:browser`; the normal non-browser suite remains available separately.
- Chrome's installed version may change with the host image, so the harness reports it and avoids pixel-perfect claims.
- This proves the Console in Chrome only. Other browser engines remain future compatibility work, not implied support.
- Playwright Core remains outside Temple's runtime and npm artifact.

## Rejected alternatives

- Continue relying on manual screenshots and visual review alone.
- Add Playwright Test plus downloaded Chromium to every install and every matrix lane.
- Add a separate browser-test GitHub Actions job with its own rounded billing time.
- Implement a custom Chrome DevTools Protocol automation layer.
- Use screenshot pixel diffs as the primary oracle for dynamic repository data.
