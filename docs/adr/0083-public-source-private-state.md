# ADR-0083: Separate public framework source from private task state

- Status: Accepted for this public source repository
- Note (2026-10-19): Temple compatibility source was removed in 0.2, so the last
  Decision bullet no longer has anything to retain. Every other rule here is
  unchanged and is restated, not replaced, in [ADR-0091](0091-foundations.md).

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
  in an independent private development workspace outside the public source
  checkout. Git ignore rules are defense in depth, not permission to store real
  development data in that checkout. Back up private state separately with access
  suited to its contents.
- A public source checkout does not contain or initialize maintainer tasks. Run
  the native lifecycle in a private working copy of the same source revision.
  Promote only reviewed source commits into the clean public checkout. There is
  one framework source history, not a second implementation in the private archive.
- Public issues, PR descriptions and release notes contain product-facing reports
  and concise sanitized verification summaries. Never mirror the internal task
  ledger or upload actual development records, raw outputs or evidence attachments.
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
