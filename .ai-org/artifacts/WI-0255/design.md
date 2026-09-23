# WI-0255 — Workkeel contract foundation

## Work order and approved scope

On 2026-09-23 the Human Principal selected Workkeel and authorized the previously
agreed task-first redesign, provided it does not interfere with the separate
test-suite task. Issue #114 records this first implementation slice.

WI-0255 is additive: a role-free, versioned task-contract validator and read-only
legacy projection exposed through the existing CLI. It does not replace canonical
Work Items or authorize execution. Subsequent work will migrate lifecycle writers,
wire adapters, verify a real optional LiteLLM connection, and coordinate branding.
The full redesign remains pending until those slices are actually delivered.

## Isolation

- Worktree: `work/workkeel` in the coordinating task's workspace.
- Branch: `codex/workkeel-reframe`.
- Provisional base: `53d075bcf619f655cc5613046d5ff05b3e8ab767`; not a QA approval.
- The test-suite task explicitly reserved WI-0255 for this work. Its broad `test`
  declaration overlaps our **new** `test/task-contract.test.mjs`, but no existing
  test or runner is edited. Its checkouts, WI-0253/0254, timing runs and remote
  remain untouched. Final main synchronization precedes integration.

## Acceptance

1. A contract with goal, scope, actor identity, state, dependencies, handoff and
   acceptance/evidence validates without company titles or generic coding skills.
2. Explicit environment boundaries describe cwd, read/write roots, tools,
   resources, network, external actions and data handling. Missing information is
   unresolved, not permission. Path traversal, wildcard authority, unexpected
   fields and credential-bearing model settings are rejected.
3. Existing Work Items can be projected without changing their source or losing
   their original schema/role identifiers. A legacy affected-path list is not an
   access grant. Unspecified boundaries remain null and require migration review.
4. Execution-runtime requirements, authority, project Skill references and model
   preferences are distinct. Host-owned native models need no manual capability
   catalogue. A fixed optional gateway descriptor is validated offline only.
5. The CLI reports contract validation, not execution authorization or completion.
   Focused tests and final offline repository verification must pass. Existing
   lifecycle guards and independent-review requirements are unchanged.

## Design

`src/task-contract.mjs` is a pure data boundary plus a bounded repository reader.
Use `workkeel.task-contract/v1` for new documents. Keep legacy `temple.*` schema
identifiers and historical records unchanged. Add `work-item contract` (projection)
and `work-item validate-contract` (local JSON validation) as read-only commands.

No new task database or parallel execution engine is introduced. Projection uses
the existing Work Item store. The new contract has no `position_id` requirement;
legacy roles exist only under migration provenance. Lifecycle writers remain on
their existing guarded contract until an explicit migration is implemented.

Runtime configuration identifies host-owned versus optional adapter execution and
required runtime features; a separate model connection selects native or a fixed
gateway/model. Configuration is not proof that an adapter supports that model
connection. No environment secret is read, no process is launched, and no provider
is contacted. Runtime enforcement, resume/cancel and live LiteLLM validation are
follow-up implementation, not claims made by this slice.

## Risk review

The major risk is treating a well-formed document as a security boundary. Return
`authority: observation-only`, `mutation_status: no-write`, and
`execution_authorized: false` unconditionally. Schema validity is distinct from
contract completeness. Even a complete descriptor requires a real runtime to
enforce filesystem/network/tool boundaries and verify current authority.

Read only bounded regular JSON files within the repository; reject symlinks and
oversized input. Fail without echoing supplied values or secrets. Preserve unknown
legacy state as an error instead of guessing that work succeeded. Independent QA
must not be claimed by the implementer or by switching its role identity.

## Verification and rollback

Implementation impact clarification (same approved feature scope): packaging
requires `scripts/check-package.mjs` to require the three new public files and
increase the reviewed count by exactly three, from 459 to 462. Package roots,
size/security boundaries and test scripts remain unchanged. Domain vocabulary is
appended to `.ai-org/project/domain-glossary.md`; the confirmed migration decision
is recorded in `.ai-org/decisions/DEC-0008-workkeel-task-contract.md`. These are
supporting changes to this contract, not a broader lifecycle migration.

Add one focused file with grouped positive, negative, legacy compatibility and CLI
read-only tests. Preserve the other task's test selection and compact reporting.
Run the final full offline gate after its active verification finishes.
Rollback is an ordinary revert of the additive code/docs commits; there is no
canonical migration, provider operation, package publication or external rename.
