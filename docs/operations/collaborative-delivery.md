# Contributor onboarding and reusable delivery evidence

New to an existing team repository? Start with [Join an existing Temple project](../getting-started/team-entry.md), then return here for coordinator setup, reuse or recovery details.

This guide describes the WI-0230 candidate implemented under [ADR-0067](../adr/0067-low-friction-collaborative-delivery.md). It does not install the candidate into another project or change Git hosting permissions. The fixed [field specification](../planning/field-remediation.md) records its acceptance cases.

## Start ordinary work

Use the repository's pinned launcher. Inspect your recorded responsibilities first:

```sh
node ./templew.mjs collaboration readiness . --principal-id principal-member --work-item WI-0001 --json
```

Use the returned qualified stable Agent ID with `work-item claim`. An actual claim takes precedence over a default Assignment. Display names may repeat and ambiguous choices require an ID. Ordinary `attributed` policy needs an active recorded Principal/sponsor/membership, not Temple login. Existing valid binding remains usable; expired or contradictory binding is diagnosed explicitly. New projects use attributed ordinary work. Existing project-owned configurations without `actor_policy` preserve the legacy Solo exception and verified team requirement until explicitly changed. High-Assurance and explicitly verified operations require externally supplied provenance. Temple does not authenticate a provider from local JSON.

An authorized coordinator can reuse or create explicit member identities using `collaboration setup-contributor . --config member.json --json`. Example:

```json
{
  "authorized": true,
  "principalId": "principal-member",
  "displayName": "Project member",
  "deliveryAgent": { "id": "agent-member-build", "displayName": "Builder", "positions": ["developer"] },
  "reviewAgent": { "id": "agent-member-review", "displayName": "Reviewer", "positions": ["quality_evaluator", "independent_qa"] },
  "evidenceRefs": ["docs/approved-member-scope.md"]
}
```

The configuration records authorization already given for these roles. It grants no human approval authority, extends no expiry, and changes no default Assignments. Repeating identical setup reuses identities. Existing inactive/conflicting identities or memberships need explicit recovery, not replacement IDs.

## Propose a task as a contributor

The unreleased [ADR-0068 candidate](../adr/0068-collaborative-completion-recovery.md)
adds an explicit intake route for an already qualified contributor:

```sh
node ./templew.mjs work-item propose . --title 'Describe the requested outcome' --position developer --agent-id agent-member-build --principal-id principal-member --ui-mode not-applicable --affected-path src/example.mjs --json
```

Use your own stable actor IDs. The new item records `proposed_by`, remains unclaimed
at intake, and retains the configured intake owner. A proposal is not approved
implementation scope. The coordinator still reviews and assigns it through normal
workflow. `create` retains its existing intake-owner requirement. This avoids
impersonating the manager or granting every developer a management membership.

## Change Solo/team policy deliberately

Readiness distinguishes `ready` (actor eligibility) from `task_ready` (the current
task's actor and assignment conditions). Inspect `task.owner_position`,
`recorded_agent_id`, `planned_agent_id`, `active_claim`, `blockers` and `next_action`.
A qualified member may still need the coordinator to reconcile a planned
assignment. An existing claim should be continued, not claimed again. These are
navigation observations; context, policy and execution guards still apply.
An active claim takes precedence over a different planned assignment; that
difference remains visible as `assignment_note` without blocking its current owner.

`--context-ref` accepts an ID from `.ai-org/project/context-map.json`. Use
`--affected-path` for changed files. Unknown route IDs fail before item creation.

```sh
node ./templew.mjs collaboration preview-profile . --profile collaborative --actor-policy attributed --json
node ./templew.mjs collaboration apply-profile . --profile collaborative --actor-policy attributed --fingerprint '<preview fingerprint>' --json
```

Apply checks the exact proposed policy and current canonical inputs. Missing mappings and anonymous active claims remain visible. Application preserves claims; it does not transfer them. Complete/release original responsibility before switching, or use an authorized handoff that preserves history. Risk floors and deployment/security triggers still apply per task; a large team does not make every copy edit a High-Assurance task.

Creating a Work Item records intended work under the project's actor policy; it does not authorize execution of the declared high-risk task. Claims and lifecycle operations validate the current stage's qualifications. Legacy `--discipline` applies wherever a stage has no override; use `--stage-discipline build=backend` for a Build-only skill rather than accidentally requiring every planning and review Position to be a backend developer.

Reconciliation rebuilds status, capabilities and an existing valid parallel plan while retaining its scope and worker ceiling. It never dispatches the resulting plan. If generated-view rebuilding fails after a canonical apply or rollback, the result preserves that mutation status and names the failed view condition. Repair that condition and run `node ./templew.mjs reconcile refresh-views . --json`; this regenerates views without replaying canonical changes. A malformed existing plan is preserved for explicit repair.

## Reuse measurements without inventing tests

Inspect `measurement capabilities . --json` before selecting an adapter. A measurement plan declares every input category, even empty categories, and the command's actual toolchain/environment identity:

```json
{
  "schema_version": "temple.measurement-plan/v1",
  "check_policy": "trusted-local",
  "command": { "executable": "node", "args": ["--test", "test/parser.test.mjs"], "cwd": "." },
  "inputs": { "files": ["src/parser.mjs"], "directories": [], "tests": ["test/parser.test.mjs"], "fixtures": [], "dependencies": ["package-lock.json"] },
  "toolchain": { "identity": "node-24-project-toolchain", "files": [] },
  "environment": { "identity": "local-development", "names": ["PATH"] },
  "timeout_ms": 30000,
  "output_limit_bytes": 1048576,
  "outputs": []
}
```

Bare executable names such as `node` require `PATH` in the declared environment, as above. An absolute executable path avoids that lookup but still requires any environment variables the command itself uses. Undeclared variables are not inherited.

Run `measurement inspect . --config plan.json --json` for read-only reuse eligibility, then `measurement run . --config plan.json --json`. A successful hit returns a completed result with `execution_started:false` and `acceptance_granted:false`. Failed or unavailable execution returns a failing CLI status. CI should execute this command and report its result rather than skip a required workflow using path filters. To share results between clones, restore the selected immutable measurement artifact store with CI's existing artifact mechanism and inspect it again; Temple introduces no hosted cache service.

A v2 autonomous delivery plan may embed `measurement_plan` instead of legacy `tests`; its top-level check policy and timeout must match. Existing plan authorization, buffered budget and stage gates remain. The reuse key includes selected bytes/modes/directory inventory, tests, dependencies, fixtures, executable bytes, arguments, toolchain and declared environment fingerprints. Declare all real dependencies, including environmental variability; an incomplete declaration cannot prove applicability. A reviewer must make that judgment for the candidate. Secret environment values are hashed, not recorded as values.

Trusted-local executes argv without shell expansion and supports non-Node tools on supported POSIX hosts. It is not a sandbox: detached sessions, transient writes and external side effects are outside its process-group/workspace observation boundary. Commands must not daemonize. Confined-node retains its exact macOS Node adapter and has no unrestricted fallback. Windows is explicitly unavailable pending a Job Object cleanup adapter and real Windows validation.

## Explain waits and recover records

After a measurement, generate mechanical closeout evidence without rerunning it:

```sh
node ./templew.mjs measurement report . --config plan.json --work-item WI-0001 --revision '<full candidate commit>' --output measurement-attempt-01.md --json
```

Omit `--output` for a read-only report. Output filenames are confined to
`.ai-org/artifacts/WI-0001/`; identical exports are idempotent and different bytes
cannot overwrite evidence. The report preserves the original attempt's duration,
exit status and raw artifact references. Token usage and cost stay null. A cache
hit means reuse is currently eligible, not that a caller performed another test.
Failed, incomplete, stale or candidate-mismatched results produce a failing CLI
status, even when saved for diagnosis. Only declared inputs are compared with Git;
the reviewer must assess dependency completeness and acceptance coverage. Add the
reviewer's judgment by reference rather than rewriting this report or treating it
as independent QA. See [ADR-0069](../adr/0069-mechanical-closeout-and-task-readiness.md).

The ADR-0068 candidate preserves an exact product SHA across subsequent committed
handoff records. A Lean verifier or identical-request recovery can use that SHA
only when it is an ancestor of HEAD and every changed path is permitted delivery
administration for the same item, a generated view, or explicitly referenced new
Markdown evidence. Source, dependency, instruction, policy and unrelated-item
changes still block; Developer first delivery still requires current HEAD.

Finish writes a small diagnostic observation alongside its immutable receipt.
Commit both. A new clone exposes failed, missing or conflicting observations in
Status, Doctor and recovery Context, including a responsible next action. It cannot
recover without the original checkout's matching journal. Ask the original owner
to retry the identical request there, inspect the result and commit its observation.
Do not copy journals or delete records. Old receipts without an observation marker
remain readable; a subsequent recovery can add an observation. This is not a
distributed transaction service or independent acceptance evidence.

The isolated warning that real multi-human/multi-machine validation has not passed
remains visible but no longer fails ordinary Lean finish. A mixed warning about
actor policy, sponsorship or other debt still blocks, as do every unknown warning
and failure. A passed historical receipt is not current verification.

Record an actual missing condition with `work-item unresolved . --work-item WI-0001 --merge 'Real device observation unavailable' --condition-kind environment`. Resolve that same text after obtaining evidence using `--resolve`. CLI status and the Console distinguish attached execution, review completion, missing environment/decision/evidence and organizational acceptance. A finished or unattached reviewer is not running QA. Merged code is not automatically accepted.

Inspect historical evidence with `evidence durability . --work-item WI-0001 --revision <candidate> --json`. Full Doctor continues reporting baseline debt. Export selected records using `evidence export-bundle . --evidence EVID-ID --output archive.json --json`; verify/import with `evidence verify-bundle` or `evidence import-bundle` and `--bundle archive.json`. The archive requires exact historical Git bytes and verifies hashes. Import stores an immutable archive, not a rewritten pass in the evidence registry. Archive integrity and original Git commit availability are separate results; missing historical bytes cannot be repaired by hashing today's files.

For reports committed after their tested candidate, use the explicit append-only
[artifact source recovery procedure](evidence-source-recovery.md). A source map
preserves the tested revision and original record, and enables portable v2 export
without granting new acceptance. Existing v1 archives remain supported.

For competing collaboration branches, `reconcile preview . --config request.json --json` accepts `{ "baseRevision": "<base>", "incomingRevision": "<incoming>", "paths": [".ai-org/project/evidence.json"] }`. Review the result, save that exact JSON and apply with `reconcile apply . --config preview.json --fingerprint '<fingerprint>' --json`. Stable-ID independent changes combine; divergent IDs, competing claims, deletion versus modification and lifecycle conflicts block application. Stale previews cannot write. An interrupted apply retains a journal; `reconcile recover . --transaction-id <id> --json` restores recorded originals only if intervening edits remain safe. Generated views are rebuilt, never used as conflict authority.

Human-written, ordinary AI-written and governed Agent-written candidates use the same applicable checks and acceptance rules. Record real authorship and evidence; do not backdate a claim to make a prior edit look governed. Organizational acceptance does not publish, deploy, or satisfy hosting rules by itself.
