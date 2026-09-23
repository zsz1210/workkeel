# Workkeel naming and public-entry migration

Approved direction: the Human Principal selected Workkeel and requested repository,
framework naming and README repositioning. The separate test-suite task must finish
its GitHub integration before the shared remote changes.

## Planned acceptance

- Rename the existing GitHub repository to zsz1210/workkeel without replacing its
  history. Update About/topics and the shared clone's origin after verification.
  Preserve other tasks' worktrees, branches, evidence, package scripts and gates.
- Use @zsz1210/workkeel as new source package metadata and workkeel as primary CLI.
  Keep temple and templew.mjs as legacy compatibility entries; accept old exact
  package pins while newly initialized legacy projects use new package metadata.
  Keep historical temple.* schemas and old records unchanged.
- Do not publish npm, release a tag, change global installations, rewrite existing
  release assets, reconfigure account credentials or rename active local folders.
  Document that npm Trusted Publishing must be reviewed for the new repository
  before an eventual release. A source rename is not a published package.
- Align English, Traditional Chinese and Japanese README with task-first source
  capability. Mark legacy workflows and diagram references as legacy; preserve
  detailed historical docs with an explicit new-mode entry, not global replacement.
  Update current documentation index, vision/architecture scope, contribution and
  governance naming while preserving approved policy and reporting contacts.
- Do not invent a new email alias. Existing maintainer-approved security/conduct
  addresses and subject routing remain unchanged, explicitly as legacy contacts.
- Keep new runtime/LiteLLM claims to the tested read-only configuration boundary.
  A real connection and automatic dispatch are not implemented or validated.

## Verification

Test package/CLI name consistency, old pin compatibility, existing upgrade behavior
and the generated task-first launcher. The one legacy test asserting the current
package's literal name should track the current PACKAGE_NAME constant while a
separate explicit old-name fixture preserves backward-compatibility coverage.
Run documentation/package checks and exact-candidate full verification, then
independent review. No test runner edits or test removal.

Full verification exposed one additional naming impact in
`scripts/validate-agent-led-onboarding.mjs`: its installed CLI path hard-codes the
old scoped package segments. Within this same approved rename scope, derive that
path from the already-read source package name and legacy bin entry. Preserve the
other task's offline lock/install logic and every onboarding assertion. This is
an affected compatibility-harness path, not test-suite slimming or a weaker gate.

## Risk and rollback

Main risks: broken old pins, misleading installation commands, stale links,
reporting-route changes and interrupting the other task. Preserve exact historical
pins and source IDs, state unreleased status, retain contacts, and coordinate the
remote operation. GitHub has_pages was false at the preflight; no reusable action
entrypoint was found. Record rename result and final GitHub URL explicitly.
Rollback is a reviewed code revert plus, if necessary and authorized, reverting
the repository name. Never rewrite published versions or delete preserved history.
