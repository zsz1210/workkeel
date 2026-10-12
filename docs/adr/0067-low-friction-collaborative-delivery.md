# ADR-0067: Low-friction collaboration with explicit assurance boundaries

Status: Accepted for compatibility implementation.

This supersedes the ordinary-development binding prerequisite and globally unique Agent display-name interpretation of ADR-0038/ADR-0002. It preserves stable IDs, actual responsibility, qualified membership, independent review and external hosting authority. It supplements ADR-0065 with portable trusted-local checks and reusable measurements; it does not weaken confined execution.

## Attribution and participant resolution

Add an explicit project actor policy with `attributed` and `verified` ordinary-development modes. Fresh initialized collaboration state uses `attributed`. Existing configurations without the field retain the legacy requirement until an explicit policy update; migration/readiness reports describe that difference. High-Assurance operations retain required verified provenance. No policy automatically extends membership or human authority.

In attributed mode a named active Principal and its sponsored qualified Agent are enough for ordinary work; missing local binding is not a login prompt. Explicitly provided invalid/mismatched provenance must not silently select another actor. Provenance identifies whether the selection came from an explicit argument, recorded claim or valid binding. Do not call self-description verified. Human authority mutations and strict assurance continue to enforce their own stronger conditions.

Introduce a shared actor-resolution module. Priority: active claim for the operation, explicit requested eligible Agent and Principal, current member's unambiguous eligible Agent, then a valid project default only when no member identity conflicts. Never select another person's default merely because it occupies a Position. Ambiguity returns candidates and a next action. Existing claim conflicts remain errors.

Lifecycle mutations and context use this resolution consistently. Preserve the actual outgoing Agent before release/transition. Assurance derives the Developer from the candidate's actual Developer handoff and the reviewer from the actual qualified QA evidence/claim, not global defaults. A historical default fallback is only permissible when no conflicting actual evidence exists, and its legacy provenance must be explicit. Missing evidence cannot satisfy strict independence.

Agent display names may repeat; IDs remain unique and immutable. Render ambiguous names with sponsor or ID. Names never select authority. New sessions and Position changes reuse stable Agent records.

## Onboarding and transition

Provide read-only contributor readiness and profile-change previews. Report active Principal/sponsor, eligible Positions, selected Agent candidates, actor policy, active work and blockers. Preview includes a fingerprint of relevant canonical inputs. Apply rechecks this fingerprint and performs no partial mutation on stale/conflicting input.

Changing Solo to team does not relabel an active anonymous claim, erase a binding or transfer work. Return explicit recovery choices: complete/release under the original responsibility, or perform an authorized handoff with retained history. Missing contributor configuration is actionable and must not be presented as successful onboarding. Provide idempotent member setup using explicit scope/role selection and distinct implementation/review identities; do not create or grant identities based only on public repository access.

New task default assurance follows the workflow default and per-task risk/scope assessment. Collaboration profile does not raise every task's default. Explicit risk floors, deployment/security triggers and selected stricter assurance remain enforced.

## Measurements and portable checks

Add a versioned measurement plan and result API, exposed by the pinned CLI. A plan declares executable and argv without shell evaluation, repository-relative working directory, input files/directories, test/fixture/dependency inputs, toolchain/environment identity, timeout, permitted outputs and check policy. Reject unsafe paths, missing fingerprint inputs and unsupported boundaries before spawn.

A reuse key includes content and modes of the complete selected input inventory, additions/deletions in selected directories, command/arguments, toolchain and declared environment fingerprints, check policy and schema. Hash sensitive environment values without storing them. A hit requires a successful non-retired result, matching key, verified artifact digests and compatible environment. Changes to dependencies, tests, fixture, command or toolchain are misses. Unknown inputs are misses. A hit means a measurement was reused, not that a command ran again or an independent review passed.

Retain the confined-node adapter and its explicit platform limits. Add trusted-local command execution for ordinary build/test tools, including non-Node projects. Supervise timeout, output limits, exit and descendants using the platform's supported mechanism. Unsupported cleanup guarantees are reported as unsupported/unconfirmed, never accepted. Commands that legitimately produce output declare it; unrelated workspace mutation is not accepted. An unrestricted parent remains unrestricted and is never described as sandboxed.

Keep historical measurement records immutable. Store individual attempt records rather than a single shared mutable cache list. Reuse lookup and CI reporting must produce explicit hit/miss/reason and a completed applicable result; skipping a workflow must not strand a required check. Current task acceptance still needs an eligible reviewer and candidate-specific applicability judgment.

## Evidence, reconciliation and status

Reuse the existing normalized evidence registry and historical Git digest validation. Add scoped durability inspection and portable evidence archive verification so a clean clone can retrieve recorded bytes without rehashing unrelated current content. Export only explicitly selected evidence, validate exact source bytes, reject path escapes/duplicate divergent records/oversize content, and distinguish archived artifact integrity from availability of the original Git commit. Missing historical evidence remains missing, with a recovery action. Never turn an archive into an invented pass or replace an invalidated attempt.

Add three-way semantic reconciliation for framework collaboration records. Match stable IDs; accept identical records and changes on only one side; combine independent additions; preserve event histories without dropping distinct entries. Same-ID divergent values, deletion versus modification, incompatible workflow/claim changes and conflicting evidence are explicit conflicts. Preview before apply, verify base/current fingerprints, and use a recoverable transaction for multi-file writes. Generated views are rebuilt from the result and never treated as authoritative conflict resolution. No ordinary Git conflict is resolved by blindly choosing ours/theirs or unioning JSON.

Derive per-item delivery attention from canonical work, workers and evidence. Separate active execution, awaiting owner, awaiting environment/decision, review completed, acceptance complete and historical evidence debt. An unattached or finished reviewer is not running QA. Display owner, missing conditions and next action in CLI and existing console views. Preserve private-view redaction. Scoped current-candidate checks may identify old baseline failures separately, but the full Doctor continues reporting them honestly.

## Implementation boundaries

| Component | Ownership/interface |
| --- | --- |
| Actor and collaboration core | New `src/actor-resolution.mjs`; updates to collaboration, local-identity, model and focused tests. Export actor policy, selection/readiness, transition preview/apply and display disambiguation APIs. |
| Measurement/check core | New `src/verification.mjs`; delivery-check/ledger integration and focused tests. Export plan validation, fingerprint, inspect/run and capabilities APIs with explicit mutation/execution status. |
| Evidence and reconciliation | New `src/evidence-bundle.mjs`, `src/reconciliation.mjs`, `src/delivery-attention.mjs` and focused tests. Export scoped pure projections and previewable mutation APIs. |
| Integration owner | Work Item lifecycle/assurance/context/CLI wiring, JSON schemas, status/console rendering, managed instructions, ADR/public documentation and combined regression. |

Dependent callers are integrated only after these interfaces have contract tests. If execution is delegated, use named non-overlapping ownership, actual prepared runtime records and a fresh safe wave under the Work Skill. Do not have multiple workers mutate shared lifecycle or CLI files.

## Risk review and compatibility

- An attributed ordinary claim is not provider authentication. Strict assertions and independent human approval cannot consume unverified attribution as verified evidence.
- Actor resolution must not expand eligibility, claim ownership, discipline or sponsor rights. Negative fixtures include a qualified non-default reviewer and an ineligible default.
- Existing project-owned policy is preserved on upgrade. Explicit adoption is previewable; no silent identity transfer, grant renewal or evidence rewrite.
- Verification reuse is conservative and candidate review remains independent. File additions, artifact loss, changed environment and injected failed attempts invalidate hits.
- Trusted-local commands retain their honest execution boundary; no fallback from confinement.
- Reconciliation rejects ambiguity and stale input before writes, with recovery evidence for interrupted apply.
- Readiness/status is navigation, not gate evidence or authority.
- No new external provider, hosted service, dependency or credential store is introduced.

Validate contract cases, full Node 24 checks, installation/upgrade, browser
states and independent QA. Actual Windows execution and separately operated
human machines require their own evidence; local fixtures retain that limit.
This decision does not deploy into unrelated projects or publish a release.
