# WI-0254 Design and Risk Review

## Work order and approved scope

The Human Principal requested repair of the six retained baseline test failures.
This Work Item is limited to the two underlying test-harness defects:

1. `preparePreviousInstructionRuntime` must reject an already-existing target
   before copying or writing any instruction files.
2. The delivery-pair replay harness must pass the Git peel expression
   `<revision>^{commit}` to zsh as a literal argument.

The change is stacked after WI-0253 only because WI-0253 first documented these
baseline failures. WI-0253 has no active claim, WI-0254 is sequential, and this
repair does not change WI-0253's frozen candidate or its test-slimming scope.

## Acceptance criteria

- An existing target fails deterministically with `ERR_FS_CP_EEXIST` before any
  copy, directory creation, or instruction replacement.
- A fresh absent target is still copied and receives the pinned instruction
  files.
- The synthetic zsh command quotes the revision expression safely and retains
  the exact candidate-revision assertion.
- The two focused test files and the repository's full `npm run verify` gate pass
  on the exact committed candidate.

## Technical design

- Reserve the target directory with an atomic non-recursive `mkdir`. Convert only
  `EEXIST` into `ERR_FS_CP_EEXIST` and preserve every other filesystem error.
- Copy into the newly reserved, coordinator-owned directory with
  `fs.cp(..., { recursive: true, errorOnExist: true, force: false })`.
- Add a regression case proving the collision guard neither changes the existing
  target nor depends on the source containing `project-overlay`.
- Quote the synthetic SHA-plus-peel expression with the harness's shell-argument
  encoder instead of interpolating it as unquoted zsh source.

## Risk review and Lean eligibility

Risk is low and bounded: only an internal runtime-preparation helper and synthetic
test harness are affected. There is no UI, schema, data migration, external write,
security-boundary, deployment, package, or production behavior change. The main
risks are changing the public error code, masking unexpected filesystem failures,
or weakening exact-revision validation. The design mitigates them by retaining the
documented collision code, rethrowing every non-`ENOENT` preflight error, keeping
the copy-time collision guard, and preserving the existing exact-SHA assertion.

The Lean profile is eligible because the scope is bounded, reversible, local,
covered by deterministic tests, and has no escalation trigger. Full repository
verification remains mandatory because this is a behavioral candidate.
