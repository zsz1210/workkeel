# Runtime coordination and recovery

Temple separates a deterministic plan from the runtime that performs the work. The repository records enough state to recover which CLI version, Work Item claim, worker, task, stage requirements, and scarce resources belong together without treating chat history as authority.

## Repository launcher

Every initialized project receives `templew.mjs` plus a `temple.cli-bootstrap/v1` record in `temple.lock`. Use the launcher from the project root for durable commands:

```bash
node ./templew.mjs doctor .
node ./templew.mjs status .
```

The lock pins the exact framework version and Node.js requirement. When initialization comes from a clean Git checkout, it also pins the exact source commit and the launcher can recover the CLI through `npm exec` from that revision. The package-version fallback is recorded for a future published distribution; it must not be described as available until that version is actually published. `TEMPLE_CLI_PATH` is a development and test override, and the launcher rejects it unless `--version` exactly matches the lock.

This wrapper makes the CLI discoverable from the product repository and prevents an unversioned global `temple` command from silently changing behavior. It does not bundle Node.js, Git credentials, network access, or package caches.

## Handoff revision identity

Published Alpha.33 includes [ADR-0052](../adr/0052-immutable-handoff-revisions.md): every new handoff input resolves to an exact Git commit before artifacts or canonical state are written. Older Alpha.30 resolves handoff inputs automatically only for High-Assurance work; Alpha.30 users should supply a full commit SHA themselves.

HEAD, branches, commit tags, and abbreviated commits are convenient inputs, not durable stored identities. Unresolvable or non-commit inputs fail without creating a handoff. A resolved commit does not establish tests, a clean working tree, approval, or permission to advance. Existing historical handoffs are preserved; never infer their original commit from today's HEAD.

## Stage-specific execution requirements

`required_disciplines` remains the backward-compatible default. A Work Item can replace it at a specific lifecycle stage:

```bash
node ./templew.mjs work-item configure . \
  --work-item WI-0001 \
  --stage-discipline build=frontend \
  --stage-discipline test=quality
```

The active stage entry replaces, rather than merges with, the legacy default. This prevents a Developer qualification from being mistaken for test or Independent QA eligibility. The current requirement and eligibility result appear in parallel readiness, the dispatch plan, status, and doctor output.

## Shared runtime and verification capacity

Declare a project-owned resource when two otherwise independent Work Items cannot safely use the same runtime at once:

```bash
node ./templew.mjs resource define . \
  --resource-id ios-simulator \
  --name "iOS Simulator" \
  --capacity 1 \
  --description "Shared local verification runtime"

node ./templew.mjs work-item configure . \
  --work-item WI-0001 \
  --stage-resource test=ios-simulator
```

The planner places requirements that exceed capacity into separate waves. Active reservations live in `.ai-org/project/resources.json`, appear in status and doctor, and are released when their runtime worker becomes terminal. A resource record is coordination evidence, not a distributed lock: separate machines still need Git hosting, CI, device-farm, or infrastructure controls appropriate to the resource.

## Claim-before-worker protocol

After `parallel plan` writes a fresh plan, prepare each member of the first wave before creating its runtime worker:

```bash
node ./templew.mjs parallel prepare . \
  --work-item WI-0001 \
  --agent-id agent-example \
  --principal-id human \
  --base-revision BASE_SHA \
  --branch work/wi-0001 \
  --runtime-kind internal-subagent
```

Preparation runs under the local project mutation lock and atomically records:

1. the eligible Principal-backed Work Item claim;
2. any active resource reservations; and
3. a reserved runtime-worker record tied to the plan, wave, and preparation fingerprint.

If any write fails, the files touched by preparation are restored. The runtime must be created only after preparation succeeds. Each dispatch entry has its own preparation fingerprint, so the remaining members of one previously verified wave can still be prepared after an earlier member changes runtime state. A changed target Work Item, framework policy, assignment, resource definition, or edited plan is rejected and requires replanning.

## Runtime kinds and attachment

Temple records two runtime kinds without pretending they are the same UI object:

- `internal-subagent` is an implementation worker inside the current user-owned task. Attach its runtime identifier with `worker attach`; it must not be added to the Codex task registry.
- `user-task` is a separate Codex task visible to the user. Pass the reserved `--worker-id` to `task register`; that registration attaches the task to the reservation.

```bash
# Internal subagent
node ./templew.mjs worker attach . --worker-id worker-ID --runtime-id runtime-ID

# User-owned Codex task
node ./templew.mjs task register . \
  --work-item WI-0001 \
  --position developer \
  --thread-id THREAD_ID \
  --worker-id worker-ID
```

Update runtime state and exact candidate evidence independently from the Work Item lifecycle:

```bash
node ./templew.mjs worker update . \
  --worker-id worker-ID \
  --status completed \
  --revision CANDIDATE_SHA \
  --evidence .ai-org/evidence/wi-0001.json
```

A terminal worker releases its shared resources. Completion does not release the Work Item claim, forge a handoff, advance a lifecycle state, or satisfy Independent QA. The responsible Position must still record the evidence-bearing handoff and explicitly release ownership at the correct lifecycle boundary. Cancelling a reservation before attachment is the one safe automatic claim-release case.

## Recovery checks and current limit

Use `worker list`, `resource list`, `status`, and `doctor` to recover the runtime relationship. Doctor checks worker-to-claim, worker-to-resource, and user-task correlation while keeping internal subagents out of the task registry.

Alpha.17 proves these invariants under one repository process boundary and simulated CLI concurrency. It does not prove multi-human, multi-machine Git or pull-request contention; that retained validation remains `not_run`.
