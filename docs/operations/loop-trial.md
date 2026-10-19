# Bounded loop trial infrastructure

L1 is the weekly read-only `stats --report` command described in
[team adoption and risk](team-adoption-and-risk.md). It writes nothing, calls no
model, emits one report and stops. L1 has a separate in-memory allowance of 60
observation operations and two hours including waits. It does not consume an L2
approval. Keep actual reports, approvals and evidence in a private workspace.

L2 delivery remains exclusively the existing native `goal` lifecycle: claim,
implementation, checks, actual independent review and authorized acceptance.
`learning_ids` are optional provenance and never an execution prerequisite. This
batch provides guard infrastructure and comparison data validation, not an L2
runner, automatic proposal approval or a second delivery path.

## Trusted host integration

The embedding host may call `startLoopRun(target, approval, options)` from
`src/workkeel-loop-run.mjs` after explicit user approval of one concrete proposal
and its sealed baseline. `approval` has exactly these fields:

```json
{
  "id": "synthetic-trial",
  "goal_id": "synthetic-goal",
  "proposal_sha256": "<64 lowercase hex characters>",
  "baseline_sha256": "<64 lowercase hex characters>",
  "cost_path": { "path": "qualified-host-identity", "billing": "subscription" }
}
```

`options.authorizeUser` is trusted host code that verifies the real user action;
a JSON actor label cannot substitute for it. `options.costPath` is the trusted
host's independently qualified actual billing path, exactly matching the approved
path. Billing must be `local` or `subscription`, verified as non-API-billed.
Unknown/API paths or missing proof refuse startup before creating a ledger.
A subscription label alone is not cost proof. The stock goal adapter therefore
has no default qualification: its trusted embedding must provide `costPath`
after checking the actual authentication/billing route. A finite monetary limit
is a separate capability and is not evidence of zero API spend.

State is private at `.ai-org/loop/run.json`, with an integrity envelope and
atomic writes under a shared lock. The ledger starts its absolute two-hour
clock at approval admission; waits, pauses and restarts consume time. It grants
60 operations shared by the goal, native mutations, host calls, checks, dispatch
and failed/retried attempts. Nested async work inherits the ledger and cannot
reset it by choosing a different target. The trial permits one project and one
goal; it refuses new autonomous admission and additional derived goals.
Trusted custom host adapters must use `countLoopOperation` for internal command,
check and comparison operations, just as the stock goal adapter charges its
commands. Orchestration steps and individual native/host calls each count;
the safety stop and abort signal close admission immediately. A host call reserves cancellation capacity before dispatch, across restarts;
explicit cancellation observations consume that reservation within the original
60-operation allowance. Unknown confirmation remains visible without extending
the deadline. Stop bookkeeping grants no execution allowance.

Use `requestLoopStop` for a user stop. `withLoopRun`, used by native goal steps,
checks the ledger before dispatch and closes admission before cancellation.
Deadline expiry, exhausted allowance, invalid authority or uncertain results
also retain a stop. `readLoopRun` exposes operation/time remaining and the stop's
requested, confirmed and unknown fields. A host must cooperate with cancellation;
unknown effects remain unknown, block further dispatch and require reconciliation.

Only a verified user action through trusted `clearLoopStop(target, {authorizeUser})`
can clear a confirmed stop. Clearing changes neither the old deadline nor the
operation count, does not restart the terminal run, and never authorizes another
L2. The one-L2 seal survives restart. Do not delete the ledger to resume work.

## Sealed comparison records

`validateLoopBaseline` and `validateLoopComparison` in
`src/workkeel-loop-comparison.mjs` validate data only. They call no host and write
nothing. Seal the baseline before approval using `executionDigest` over all
baseline fields except `sha256`. A baseline contains:

- `schema_version: workkeel.loop-baseline/v1`, exact `source_revision`, offset
  `cutoff`, IANA `timezone`, task IDs and case IDs with task, input SHA256 and risk.
- Source path/hash pins, the case risk distribution and fixed model settings.
- Review rules, sealed required check IDs, checks version, calculation version and a distinct judge with
  model family, anonymous review and randomized presentation requirements.
- Fixed thresholds: at least five pairs; first-pass increase of 0.20 or average
  rework decrease of 0.2; no regression in the other metric; total wall-clock
  increase at most 10%; no additional unexpected human rescues. Tokens have no gate.

The comparison record references that seal and the user approval digest, records
its author and complete attempt inventory, and has pairs bound to each sealed
case/input/risk. Both sides retain every attempt, including failure, with exact
candidate, unchanged model/rules/check/calculation settings, actual check and
review results, blind identity/order, findings and evidence pins. Measurements
include first-pass outcome, correction rounds, wall milliseconds, human rescues
and nullable recorded tokens. Unknown measurements are `null`, never zero.

Findings use Must fix, Consider, Note or Dismiss. Must fix must be resolved for
retention; Dismiss needs counterevidence or an explicit inapplicability reason.
High/critical cases require distinct-Agent Codex/Claude cross-review. A failed
check or review attempt remains recorded even when a later correction succeeds.
The quality floor applies to the final result on each side, not scores.

The final record has `conclusion` (`support-retain`, `do-not-support-retain` or
`inconclusive`), a reason and rollback status. Incomplete data or fewer than five
fixed pairs require `inconclusive`. Changed conditions fail validation and need
new user approval; an author cannot silently replace the baseline or thresholds.
Validation checks consistency, not the truth of host claims, completeness against
an external attempt ledger, randomization provenance or user acceptance. The
trusted host must pin the approval and full attempt inventory independently.
The host wraps waiting comparison work in `withLoopRun` using the same goal,
ledger and qualified adapter, and charges individual comparison operations with
`countLoopOperation` before validation,
then calls `finishLoopRun` after recording a normal comparison outcome. Goal
acceptance does not reset or end the shared comparison allowance. This is stop
bookkeeping, not an L2 runner. Only the user decides retention or rollback;
results support this trial alone.
