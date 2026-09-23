# Developer evidence — WI-0253

## Candidate and environment

- Behavioral candidate: `b0fe9161f654a17aaeefd53373770249efee0ceb`
- Baseline: `2c5daa45afd756cf6ff18a31fdf13d8e03720828`
- Runtime: Node.js `v24.7.0`
- Environment: same local checkout and machine; one wall-clock sample per reported
  comparison unless noted. Node executes test files concurrently, so these samples
  are diagnostic and not a performance guarantee.

## Result

No assertion or test file was deleted. The complete inventory remains 127 real test
files. The change adds a 45-file representative daily gate, moves 13 offline
model/process harness files from core to the experiments group, makes full execution
use the explicit inventory, and uses Node's compact reporter by default.

The structural complete-test count remains 1,329: one real test was added to prove
that compact reporting retains failure details, while explicit inventory removes
the unintended `scripts/test-groups.mjs` runner pseudo-test that Node previously
discovered. The previous recursive-test warning is absent.

| Gate | Baseline | Candidate | Outcome |
| --- | --- | --- | --- |
| Fast | 10 files, 58 tests, 5.14 s | 10 files, 59 tests, 4.80 s | Passed; per-test success names became three dot-progress lines |
| Broad daily-equivalent | 119 core+optional files, 1,229 tests, 316.04 s | 45 representative files, 414 tests, 104.20 s | Passed on candidate; 74 fewer routine files, 815 fewer routine tests, 211.84 s / 67.0% lower wall time in this sample |
| Complete | 127 inventory files plus one unintended runner pseudo-test, 1,329 tests, 347.31 s | 127 explicit inventory files, structurally 1,329 tests, 322.91 s | Failed with the same six baseline signatures; no new failure class |

The complete timing varied between 322.91 and 371.74 seconds in candidate-era
samples. Because every complete test remains, no repeatable full-suite speedup is
claimed. The complete improvement is bounded to deterministic discovery and much
smaller successful output.

## Exact-candidate verification

- `npm run verify:fast`: passed, 59/59, 4.80 seconds.
- `npm run verify:daily`: passed, 414/414, 104.20 seconds. A second TAP-summary
  count passed 414/414 in 103.29 seconds.
- `npm run verify`: repository, link, and package checks passed; the test phase
  failed after 322.91 seconds with the same six baseline failures.
- `node --test --test-reporter=dot test/test-groups.test.mjs test/ci-scope.test.mjs`:
  passed 9/9 focused contracts.
- `node ./templew.mjs doctor . --compact --json`: 36 pass, 0 fail, and one known
  warning that the generated parallel plan is stale. This Work Item is sequential;
  no parallel dispatch is authorized or required.

## Retained full failures

1. `test/continuity-live-runner.test.mjs` — `previous-instruction preparation never
   adopts an existing directory` fails because the fixture attempts to open a
   missing temporary `project-overlay/AGENTS.md` (`ENOENT`).
2. Four nested cases in `test/delivery-control-pair.test.mjs` stop at
   `provider-protocol` because a synthetic zsh command receives an unquoted
   `REV^{commit}` and reports `no matches found`.
3. The parent `delivery pair readiness and actual injected lifecycles...` case
   fails because those four nested cases failed.

These failures existed at the baseline revision and are outside this Work Item's
test-suite-slimming scope. Moving the files to the experiments group removes their
unrelated block from the daily gate, but `npm run test:experiments` and
`npm run verify` still execute and report them in full.

## Relocation coverage map

No check below was deleted; each file remains in the complete suite.

| Relocated experiment files | Equivalent risk boundary retained in daily/core |
| --- | --- |
| `autonomy-experiment`, `autonomy-protocol-stop` | `autonomous-delivery`, `app-server-protocol-replay`, `json-rpc-process-protocol`, and `json-rpc-process-cleanup` retain real entry, protocol, isolation, shutdown, and cleanup coverage. |
| `continuity-live-runner`, `delivery-control-pair` | `daily-delivery`, `delivery-command-policy`, `handoff-revision`, `app-server-protocol-replay`, and JSON-RPC tests retain candidate, command, evidence, protocol, and process boundaries. |
| `delivery-matrix-completion`, `delivery-matrix-experiment`, `delivery-matrix-fixtures`, `paired-entry-experiment`, `lean-interruption-experiment` | `autonomous-delivery`, `daily-delivery`, `high-assurance`, `recovery`, and `collaborative-recovery` retain production lifecycle, exact-candidate, rollback, recovery, and distinct-review behavior. |
| `learning-review-experiment`, `learning-review-oracle` | `learning-operations` remains in daily; `learning-review-coverage` and the experiment/oracle tests remain in core/full for exhaustive review history and oracle matrices. |
| `recovery-matrix-experiment`, `recovery-matrix-fixtures` | `recovery`, `collaborative-recovery`, and `field-verification` retain real recovery, competing history, and verifier boundaries. |

The daily list also retains all ten fast files plus representative production CLI,
lifecycle, authority, recovery, rollback, High-Assurance, evidence, JSON-RPC, and
optional Control Plane paths. It does not change group ownership: core, optional,
and experiments still partition all 127 files. A changed test still selects its
entire group plus fast tests; changes to shared source, scripts, package metadata,
canonical state, deleted tests, or unknown paths still fail toward all 127 files.

## Output and diagnostics

- Successful group runs use Node's dot reporter instead of emitting one named line
  per successful test. This materially reduces terminal and model-context output.
- A new failing-fixture contract proves the compact reporter still emits `Failed
  tests`, the test name, `AssertionError`, actual/expected values, stack, and source
  filename.
- `--verbose` and `npm run test:full:verbose` retain per-test success names and
  timings for investigations.

## Limits and unperformed work

- The full gate is not green; the six retained baseline failures remain unresolved.
- Daily is an editing/routine confidence gate, not complete candidate, Independent
  QA, or Release evidence. Final behavioral candidates and Releases still use
  `npm run verify`.
- No browser gate was run because no Management Console/UI implementation changed.
- No hosted CI, remote push, pull request, merge, publication, deployment, external
  tracker write, or live provider call was performed.
