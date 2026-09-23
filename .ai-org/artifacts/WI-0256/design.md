# WI-0256 Design and Risk Review

## Work order and approved scope

Qualify the already-implemented repair for the six retained baseline test
failures. The repair is limited to the two underlying test-harness defects:

1. `preparePreviousInstructionRuntime` rejects an already-existing target before
   copying or writing any instruction files.
2. The delivery-pair replay harness passes `<revision>^{commit}` to zsh as a
   literal Git revision expression.

The implementation first appeared in candidate
`b863ee4976c9ed1c8fe586525401b2dddcea39bc`. WI-0254 independently verified that
candidate but was cancelled because two pre-build gate references pointed to a
mutable Work Item document. This replacement Work Item corrects the governance
record and does not rewrite WI-0254 or claim its cancelled lifecycle as complete.

## Acceptance criteria

- An existing target fails deterministically with `ERR_FS_CP_EEXIST` before any
  copy, directory creation, or instruction replacement.
- A fresh absent target is still copied and receives the pinned instruction
  files.
- The synthetic zsh command quotes the revision expression safely and retains
  the exact candidate-revision assertion.
- The focused test files and the repository's full `npm run verify` gate pass on
  the exact committed replacement candidate.

## Technical design

- Reserve the target directory with an atomic non-recursive `mkdir`. Convert only
  `EEXIST` into `ERR_FS_CP_EEXIST` and preserve every other filesystem error.
- Copy into the newly reserved, coordinator-owned directory with
  `fs.cp(..., { recursive: true, errorOnExist: true, force: false })`.
- Retain the regression case proving the collision guard neither changes the
  existing target nor depends on the source containing `project-overlay`.
- Quote the synthetic SHA-plus-peel expression with the harness's shell-argument
  encoder instead of interpolating it as unquoted zsh source.

## Risk review and Lean eligibility

Risk is low and bounded: only an internal runtime-preparation helper and synthetic
test harness are affected. There is no UI, schema, data migration, external write,
security-boundary, deployment, package, or production behavior change. The main
risks are changing the public error code, masking unexpected filesystem failures,
or weakening exact-revision validation. The design mitigates them by retaining
the documented collision code, rethrowing every non-collision filesystem error,
keeping the copy-time collision guard, and preserving the existing exact-SHA
assertion.

The Lean profile is eligible because the scope is bounded, reversible, local,
covered by deterministic tests, and has no escalation trigger. Full repository
verification remains mandatory because this is a behavioral candidate. This
immutable artifact is the source for every pre-build gate.

## Prior evidence retained as history

- `.ai-org/artifacts/WI-0254/developer-evidence.md`
- `.ai-org/artifacts/WI-0254/qa-report.md`
- `.ai-org/artifacts/WI-0254/cancellation-reason.md`

Those records are supplementary only. WI-0256 requires fresh exact-candidate
Developer verification and an independent Quality Evaluator judgment.
