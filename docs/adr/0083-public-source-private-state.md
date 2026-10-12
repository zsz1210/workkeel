# ADR-0083: Separate public framework source from private task state

- Status: Accepted for this public source repository

## Context

Workkeel develops its own framework using task records, approvals, execution
reports, and reviews. Those records describe real people, hosts, paths, and
work in progress. They are useful for local coordination and recovery, but
they are not framework source or reproducible product fixtures. Copying them
into a public repository would disclose private context and make one
maintainer's work history look like a default installation.

## Decision

- Publish framework code, generic project overlay, examples, documentation,
  license notices, and reproducible tests in a fresh source history.
- Keep actual task records, approvals, dispatch records, review evidence,
  raw execution output, machine settings, `.ai-org/`, and `workkeel.lock`
  in ignored local state. Back up needed state separately with access suited
  to its contents.
- A clean clone does not contain maintainer tasks. Its developer initializes
  local task state deliberately under the native Workkeel contract.
- Use fictional examples in public guidance. Product tests demonstrate
  behavior; private acceptance evidence and local measurements remain
  candidate-specific and are not represented as public test results.
- Audit all outgoing Git history before a public push. Ignoring a path in
  the current tree does not remove it from earlier commits.
- Retain Temple compatibility source and fixtures for existing projects,
  but use native Workkeel for new projects and this source checkout.

## Consequences

Public readers can reproduce source tests without receiving the maintainer's
private coordination state. Recovery of that state depends on its separate
backup. A package or source snapshot may include compatibility behavior
without claiming that a particular legacy project has migrated. Tests,
review, acceptance, merge, and publication remain separate decisions.
