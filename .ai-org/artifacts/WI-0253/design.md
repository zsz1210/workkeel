# Test-suite slimming design — WI-0253

## Work order and approved scope

Evaluate the current test inventory and implement only evidence-backed test-suite
slimming. Preserve regression, authority, recovery, security, failure diagnostics,
and complete release verification. Do not publish, deploy, merge, change external
systems, weaken a guard, or hand-edit canonical Temple JSON.

The work may change the repository's test grouping/runner, package scripts,
testing documentation, and tests whose duplication or experimental classification
is demonstrated. Product behavior is out of scope.

## Acceptance criteria

- Every deleted, merged, or relocated check identifies retained equivalent coverage.
- The ordinary behavioral-candidate command has lower wall time or materially less
  successful-output volume while failures remain actionable.
- A complete release command still covers core, optional, experimental, authority,
  recovery, and security tests.
- Before/after evidence uses Node.js v24.7.0 and records command, revision, file/test
  counts, wall time, failures, and limitations. A single timing sample is diagnostic,
  not a universal performance claim.

## Baseline at `2c5daa45afd756cf6ff18a31fdf13d8e03720828`

- `npm run verify:fast`: 10 test files, 58 tests, all passed, 5.14 seconds wall time.
- `npm run verify`: the runner reported 127 test files and the user-visible inventory
  is 1,329 tests. It failed after 347.31 seconds wall time.
- The complete run emitted one success line per test plus nested fixture output,
  producing thousands of lines before the final diagnostic.
- Pre-existing failures include `test/continuity-live-runner.test.mjs`, which could
  not create a previous-instruction runtime fixture, and
  `test/delivery-control-pair.test.mjs`, whose synthetic zsh command expands an
  unquoted `REV^{commit}` as a glob and stops with `provider-protocol`.
- The baseline is therefore not green. This Work Item must not claim that later
  failures were introduced or removed without exact comparison.

## Technical design

1. Make the full runner enumerate test inventory explicitly instead of relying on
   Node's default discovery. This prevents `scripts/test-groups.mjs` from itself
   being discovered as a test-like file and removes the recursive-run warning.
2. Add a compact success reporter for routine commands while preserving full
   assertion, stack, stdout/stderr, and summary diagnostics for failures. Retain an
   explicit verbose entry for investigations.
3. Classify tests by the behavior they protect. Move only experiment/protocol
   harnesses that do not gate production runtime into the existing experiments
   group. Keep representative production CLI, authority, recovery, rollback,
   security, package, and optional integration coverage in daily or full gates.
4. Keep a complete release command that runs all groups. Ordinary CI remains the
   bounded package/Doctor/fast gate; release workflow must call the complete gate.
5. Update group-contract tests and documentation so new files default to core,
   changed shared/runtime paths fail toward the complete suite, and changed
   experimental tests select their whole group plus fast checks.

## Risk review

- Primary risk: reclassification could hide a regression from ordinary candidate
  verification. Mitigation: no safety assertion is deleted for timing alone; full
  release coverage remains explicit; changed/unclassified shared code continues to
  select the complete suite.
- Diagnostic risk: compact output could suppress the cause of failure. Mitigation:
  the reporter must emit detailed failed-test diagnostics and be covered by a
  deliberate failing fixture test.
- Measurement risk: Node runs files concurrently, so summed test durations do not
  equal wall time. Compare identical commands on the same runtime and report each
  wall-clock sample as diagnostic only.
- Baseline instability: existing failures prevent a green before/after full result.
  Preserve their exact signatures and report them as retained limitations rather
  than broadening this Work Item into unrelated repairs.

## Stop boundary and rollback

Stop after a local exact-candidate implementation, proportionate verification,
Standard workflow evidence, and a reviewable local branch. No remote push, pull
request, merge, publication, deployment, or external tracker write is authorized.
Rollback is a reviewed revert of the test-runner/grouping/documentation changes;
retain this Work Item and measurement history.
