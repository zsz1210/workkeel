# Rework verification

Tested candidate: `c6dd4ff4f268393fe087ee92232e989fb4f6bd55`.
The actual first independent review rejected candidate 379b0338 because enabled
project Skills could disappear or be disabled without failing the pre-thread check.
Same-scope rework now records both enabled and disabled probe paths and requires
all previously enabled project Skills to remain present and enabled.

- Focused regressions: 24/24 pass, including removal, disablement and harmless
  catalogue reordering. Existing negative paths and named Skill validation remain.
- Fresh `npm run verify`: exit 0, all 141 test files, Node 24.20.0.
- Actual alpha.16.3 host preflight, zero model calls: controls pass, one project
  Skill remains enabled, 49 external Skills disabled; positive preservation passes.
- The two full report turns remain evidence for 379b0338 only, not new live turns
  on this candidate. This change adds a pre-thread guard; no permission, payload,
  model-selection or outcome behavior was modified. No additional report-model
  experiment was run. First QA FAIL and original evidence remain intact.

Fresh independent candidate judgment is pending. The original point-in-time,
other-version/machine and cost limitations still apply.
