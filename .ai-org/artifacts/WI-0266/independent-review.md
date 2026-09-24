# WI-0266 independent candidate review

Reviewer: agent-lulu, Quality & Evaluation Engineer; Principal: human. Developer:
agent-rikku. Reviewed handoff candidate
`e37f416f6696c5fd16eeb1d479638ea9247b05ab`, executable candidate
`96a241ab8916f63a98952cb241176955c4f735c1`, against base
`bab9b8fe045ccc939635f45537ffcca20bff78ef`. This is a distinct review of
the bounded cleanup and pilot, not a publication or release decision.

## Judgment

**Pass for the specified cleanup and diagnostic pilot.** No correction is
required within this candidate scope. The recorded evidence supports three
completed matched pairs, six first-pass successes and no repairs. It does not
support a general model ranking, a dollar saving, backend-model attestation or
public certification of the whole repository.

## Independent checks

- Read the WI-0266 work order, both normalization plans and results, oracle
  preflight, developer evidence, pilot results and handoff. The two applied
  result digests match their plans. At the executable revision, all nine
  canonical before/after file hashes match the plan; comparing parsed values
  after removing only `worktree` gives equality for all nine. The plan records
  42 released-claim and five terminal-worker coordinate removals. No active
  coordinate is counted. All eight artifact before/after hashes match their
  plan, each with one local-path substitution. The source revision for that
  plan is the base revision and the plan reports no active evidence impact.
- The original event journal at the base revision is an exact byte prefix of
  both the executable candidate and current journal. Its SHA-256 at the
  executable candidate is
  `72f6a0d704be3cbd45352cdc79475fd439e7c8e3446ae71c621083d76a685c7c`.
  Original evidence bytes remain available in Git history. No scanner source
  or limit changed. The current publication audit is **blocked** by the
  oversized journal, with 117 binary files requiring separate review; the
  package surface has no findings. Its sole local-environment finding is an
  allowed, previously reviewed adapter fixture. This is not a whole-tree
  publication certification.
- The base-to-executable diff changes the manual pilot harness and its tests,
  with no `src/`, dependency or package-manifest changes. The harness binds a
  regular WI work-order file hash, fresh plan limits and a quota floor before
  pair execution. The corrected fixed oracle was reviewed separately before
  dispatch. Focused offline tests pass 5/5 and `npm run verify:fast` passes.
  The developer's full verification log hash matches
  `672ee3e03345395dfffcaae450d080f07a22b6cf55c603c7c934985f0b34bbe5`;
  it records the full 137-file run and 1,408 passing markers at the executable
  revision before live dispatch. The handoff revision adds only
  `developer-evidence.md` and `pilot-results.json` to that executable revision.
- All six local raw result file hashes match the machine-readable report, and
  their checks match its 13/10/7 per-case records. The result records show
  three first-pass passes for each model, zero repairs, no infrastructure
  failures and no extra attempt. Reported totals are Luna 133,616 input and
  2,432 output tokens, 87.938 seconds adapter time; Sol 155,812 input and
  3,544 output tokens, 127.415 seconds adapter time. Combined step tokens
  are 136,048 versus 159,356 respectively. Reported suite wall time is
  245.373 seconds. Requested and runtime labels agree in all six records;
  backend identities and dollar cost remain unknown/null. The shared-account
  quota values remain local. The earlier stopped pilot is excluded.

## Limits and next owner

This is three synthetic tasks per model and listed-check correctness, not
full-domain correctness or a statistically qualified model preference.
Coordinator and reviewer usage, shared-account activity, and subscription
billing cannot be attributed to these step totals. The current Doctor result
is 36 pass, one warning, zero fail: the generated parallel plan became stale
after lifecycle activity. Refresh it before any further governed dispatch.
The next owner may use this report for the named workflow gates, while keeping
the blocked publication audit and separate binary reviews explicit. No further
model inference, scanner-policy change or publication is implied.
