---
name: diagnosing-bugs
description: Diagnose a reproducible failure or regression through a tight red-capable feedback loop and ranked hypotheses. Use for test failures, runtime defects, and inconsistent behavior with an observable symptom; do not use for broad architecture improvement or an approved change whose implementation path is already known.
---

# Diagnosing Bugs

Find the smallest supported cause of an observed failure before expanding the fix.

## Authority boundary

Diagnosis is read-only by default. Reproduce, inspect, and report without changing product behavior unless the user request or current authorized work item includes a fix. This Skill does not expand scope, change lifecycle state, publish, deploy, or justify collecting sensitive data.

## Build a red-capable loop

1. State the symptom, expected behavior, environment, and last known relevant revision or condition.
2. Reproduce it with the narrowest reliable command or visible interaction. Reduce timing, network, device, and fixture variability where possible without changing the behavior under investigation.
3. Form a small ranked set of hypotheses. For each, name the observation that would distinguish it from the others.
4. Test one discriminating observation at a time. Prefer existing logs, tests, public interfaces, and runtime inspection before adding instrumentation.
5. If instrumentation is necessary, keep it bounded, redact secrets and personal data, and remove it after the cause is established.

Do not call a guess the root cause. If the symptom cannot be reproduced, preserve the attempted environment and evidence gap rather than applying speculative fixes.

## Fix and regression boundary

When a fix is authorized:

- change the smallest supported cause, not every plausible weakness nearby;
- add or strengthen a regression check at a stable public seam;
- re-run the original reproduction and the proportionate neighboring suite;
- verify that the fix did not merely hide the symptom or loosen the assertion.

When the cause and intended change are known, use a red-green implementation loop for the fix. Keep architecture cleanup separate unless it is necessary to remove the demonstrated cause and remains inside scope.

## Completion

Finish with the reproduced symptom, ranked hypotheses considered, discriminating evidence, supported cause or remaining uncertainty, exact verification commands, candidate revision when code changed, removed instrumentation, and residual environments not checked. Developer evidence remains separate from Independent QA.
