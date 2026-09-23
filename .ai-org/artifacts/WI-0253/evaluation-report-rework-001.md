# WI-0253 Evaluation report — rework attempt 1

## Evaluation decision

**PASS** for exact corrected candidate
`6ace82eba938cbd7cde491f0b7126af6b5e9bd12`.

Evaluator: Lulu (`agent-lulu`), Quality & Evaluation Engineer, Principal `human`.
Developer: Rikku (`agent-rikku`). This is independent-agent evaluation under one
Human Principal; it is not independent-human validation.

## Acceptance mapping

| Acceptance criterion | Evaluation |
| --- | --- |
| Every removed, merged, or relocated check names equivalent retained coverage | **PASS.** No test or assertion was deleted or merged. The 13 reclassified offline experiment/process files remain in the full inventory. `developer-evidence.md` maps each relocation group to retained production lifecycle, authority, recovery, JSON-RPC, security, evidence, and integration boundaries. Fresh source review confirmed the current grouping matches that map. |
| Daily verification materially reduces wall time or output and preserves actionable failures | **PASS, bounded to the recorded machine/sample.** The retained same-runtime measurements reduce the broad routine selection from 119 files / 1,229 tests / 316.04 s to 45 files / 414 tests / 104.20 s, a 67.0% wall-time reduction in that sample. Dot reporting replaces successful per-test lines with compact progress. The fresh 72-test run passed the deliberate failure fixture proving failed test name, AssertionError, actual/expected values, stack, and source filename remain visible. |
| Full verification remains available with complete core, optional, experiment, authority, recovery, and security coverage | **PASS.** `test`, `test:full`, and `verify` use the explicit 127-file inventory. Core, optional, and experiments still partition every real test file; changed shared/runtime/package/state or unknown paths conservatively select full. The exact corrected candidate's full gate passed all 127 files. |
| Before/after evidence records counts, wall time, failures, and limitations on the same runtime | **PASS.** `design.md`, the retained original `developer-evidence.md`, fresh `developer-evidence-rework-001.md`, and `test-evidence-rework-001.md` preserve Node v24.7.0, file/test counts, wall times, predecessor failure signatures, the corrected green result, and single-sample/concurrency limitations. No universal speedup or full-suite performance improvement is claimed. |

## Coverage and risk judgment

The daily set retains fast contracts plus representative CLI, lifecycle,
authority, High-Assurance, recovery, rollback, evidence, JSON-RPC, and optional
Control Plane coverage. Offline exhaustive matrices remain in experiments and in
the full gate. Reclassification therefore changes routine scheduling, not
availability or release coverage.

The two corrected harness defects are limited and already separately qualified:
atomic collision reservation retains `ERR_FS_CP_EEXIST`, and quoted Git peel
arguments retain exact candidate equality. The fresh focused run reached all
formerly blocked assertions. No new product, schema, UI, package, release, or
external-system behavior enters this candidate.

## Limitations and next gate

- Timing samples are local diagnostics; Node test-file concurrency prevents
  treating summed test duration as wall time.
- The corrected complete run took 338.03 seconds versus the 347.31-second
  baseline sample. No repeatable full-suite speedup is claimed; the deterministic
  benefits are explicit inventory and compact success output.
- Daily remains a routine confidence gate, never a substitute for the full
  behavioral-candidate or release gate.
- Hosted CI, browser UI, publication, deployment, PR, and merge were not run.

Recommend advancing this exact candidate to Independent QA. Any affected product
or test change invalidates this report and requires a new attempt.

