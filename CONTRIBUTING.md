# Contributing

Workkeel welcomes focused bug reports, documentation fixes, tests, and code
proposals. Open an issue before a large feature or a change to task authority,
file ownership, security, public APIs, or external integrations. Use synthetic
examples. Report vulnerabilities through [SECURITY.md](SECURITY.md).

This repository contains framework content only. Read [AGENTS.md](AGENTS.md) and
the [framework development guide](docs/operations/framework-development.md)
before governed work. Create real tasks only in a separate private workspace
outside the public source checkout, and back that workspace up independently.
Do not put tasks, plans, approvals, conversations, experiment results, raw test
output or review evidence in the public checkout, even under ignored paths.
The same rule covers Git history, public issues, PR attachments and release assets.

Public issues and PRs are for product-facing reports and source proposals with
synthetic reproductions. Publish reusable code, generic templates, reproducible
tests and documentation of the resulting behavior; retain the development
process and acceptance records privately, linked to the exact source revision.
See the [separation decision](docs/adr/0083-public-source-private-state.md).

For a pull request:

1. Create a focused branch and state the user problem and proposed behavior.
2. Keep framework files generic. Preserve managed, project-owned, and generated
   file boundaries; add a decision record when changing a durable contract.
3. In the private workspace, add meaningful behavioral tests where needed. Use `npm ci --ignore-scripts`
   and follow the [testing guide](docs/getting-started/testing.md):
   `npm run verify:fast` for prose-only edits and `npm run verify` for
   behavioral candidates. UI changes also need the applicable browser gate.
4. Describe the exact candidate tested, what the checks prove, and any
   unverified behavior. Have a different registered Agent review it before
   task acceptance. A passing test or PR check does not itself accept a task.
5. Promote only reviewed source commits to the clean public checkout; never copy
   the private workspace wholesale. Install its local pre-push hook with
   `npm run setup:hooks`. Run `npm run check:source-checkout`, review additions to
   `public-files.json` and run `npm run check:publication` and
   `npm run check:public-history` before any public push. Follow the
   [publication boundary guide](docs/operations/publication-boundary.md).
   Publication and package release require separate maintainer authorization.

Include a concise, non-sensitive verification summary in a PR: candidate revision,
commands, results and material limits. Keep raw output and private review records
outside the public repository. The [repository settings guide](docs/operations/repository-settings.md)
describes the public contribution and security surfaces.

The English README is the canonical public entry point. Keep
[Japanese](README.ja.md) and [Traditional Chinese](README.zh-TW.md) aligned
when changing its capabilities or commands; see
[ADR-0012](docs/adr/0012-documentation-language-policy.md).
Existing Temple projects follow the
[compatibility and migration guide](docs/getting-started/migration-from-temple.md).
