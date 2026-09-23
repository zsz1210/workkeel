# WI-0257 — Task-first lifecycle and runtime boundary

## Approved work order and acceptance

The Human Principal selected Workkeel and approved continuing the complete
task-first redesign on 2026-09-23. WI-0255 established the data contract only.
This slice makes that contract operational in explicitly initialized task-first
projects, without company Positions or a generic AI capability catalogue.

Acceptance: initialize a minimal project; diagnose it; create, claim, hand off,
independently review and close a task against an exact Git candidate; preserve
history and refuse incomplete approval, identity, scope, dependencies or evidence.
Existing Temple projects retain their original lifecycle and safeguards. A fixed
optional LiteLLM connection is a separate runtime configuration; native execution
continues without a gateway. No live integration claim without live evidence.

## Design and compatibility

- Add a Workkeel entry point; existing `temple` and pinned projects continue to
  use their existing implementation. Task-first projects have a versioned
  `workkeel.lock` and a minimal Principal/Agent/approval policy, not Positions.
- Reuse `.ai-org/work-items/` for versioned canonical records. Each native record
  contains its task contract, optimistic version, claim, exact candidate,
  evidence digests and append-only operation history in one atomic durable write.
  No second database, Graph engine or autonomous model loop is introduced.
- Reuse project mutation locking and bounded no-symlink input reads. Validate
  policy and record on each operation. A lock plus expected version prevents
  competing writers; operation IDs make uncertain-write retries observable.
  No claim is silently stolen or automatically expired.
- Ordinary identity is explicitly attributed, not cryptographic authentication.
  An approved Principal authorizes the immutable contract; the assigned Agent
  claims execution. Review is attributed to a different registered Agent and,
  when required by policy, a different Principal. High/critical-risk and sensitive
  data execution remain on the established legacy assurance path in this release.
- Metadata guards enforce approved task scope and evidence/candidate binding.
  The host coding agent is responsible for actual filesystem, tool, network and
  secret enforcement. Workkeel does not call a declaration a sandbox. Runtime
  planning is read-only and never grants execution authority.
- Delivery requires a locally resolvable full commit, a clean tracked product
  tree, changed paths within approved write roots, evidence files with digests,
  resolved dependencies and no unresolved items. Review and close recheck the
  candidate/evidence. Review failure allows same-contract rework, not silent
  acceptance or authority expansion. Closure is local acceptance, not publication.
- Legacy mode remains usable unchanged. Explicit migration is previewed and
  fingerprinted, restricted to quiescent Solo history without active work or
  High-Assurance records. Legacy records are retained byte-for-byte and listed as
  legacy, never treated as new grants. Broader migrations require a later reviewed
  policy rather than dropping existing safeguards.
- Codex runtime start/resume/interrupt/result transport remains the existing
  provider. Per-thread model connection settings select native or a fixed
  Responses-compatible gateway; credentials are referenced by environment name.
  No global Codex configuration changes, model catalogues or automatic routing.

## Risk review

This is versioned metadata coordination, not a new security boundary. Main risks
are lost history, incorrect acceptance, accidentally weakening a legacy project,
symlink/path escape, stale authority and secret-bearing configuration. Mitigate
with strict schemas, no-overwrite init, explicit mode dispatch, fail-closed reads,
atomic single-record commits, expected-version/claim checks, immutable contract,
exact Git/evidence checks and offline adversarial tests. Unsupported risk stays
unsupported; do not downgrade it to fit the new path.

The other task owns existing test files/runners and WI-0256. This task owns new
focused test files and product code. Package scripts and historical records remain
unchanged. Public additions require exact package-inventory review, not removing
size/path guards. Repository branding is a subsequent coordinated step.

## Verification and rollback

New focused lifecycle and runtime tests include init → doctor → status, complete
delivery, review rejection/rework, malicious paths, policy identity, duplicate and
stale operations, evidence tampering, legacy migration preview and native/gateway
wire behavior. Run repository structural/package checks and final full verification
on a committed candidate, followed by a separate Agent's review. No real gateway,
key or provider budget has been supplied: live LiteLLM is explicitly pending.

Rollback through a normal reviewed revert; preserve records already created under
their versioned schema. Do not delete project history or switch populated projects
back to legacy writers. No production release, remote rename, package publication
or external model invocation is performed by this slice.
