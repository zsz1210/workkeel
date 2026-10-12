# Contributing

Workkeel welcomes focused bug reports, documentation fixes, tests, and code
proposals. Open an issue before a large feature or a change to task authority,
file ownership, security, public APIs, or external integrations. Use synthetic
examples. Report vulnerabilities through [SECURITY.md](SECURITY.md).

This is a fresh public source repository. Its clone contains no maintainer
tasks or private acceptance evidence. Read the checkout's [AGENTS.md](AGENTS.md)
and [native setup guide](docs/getting-started/workkeel.md) before governed work. Initialize your own local
task state deliberately and keep it private. Do not commit `.ai-org/`,
`workkeel.lock`, approvals, raw execution output, credentials, machine paths,
or real project records. Back up private state outside the public checkout.
The [separation decision](docs/adr/0083-public-source-private-state.md)
explains the rule.

For a pull request:

1. Create a focused branch and state the user problem and proposed behavior.
2. Keep framework files generic. Preserve managed, project-owned, and generated
   file boundaries; add a decision record when changing a durable contract.
3. Add meaningful behavioral tests where needed. Use `npm ci --ignore-scripts`
   and follow the [testing guide](docs/getting-started/testing.md):
   `npm run verify:fast` for prose-only edits and `npm run verify` for
   behavioral candidates. UI changes also need the applicable browser gate.
4. Describe the exact candidate tested, what the checks prove, and any
   unverified behavior. Have a different registered Agent review it before
   task acceptance. A passing test or PR check does not itself accept a task.
5. Install the local pre-push hook with `npm run setup:hooks`. Review additions to
   `public-files.json` and run `npm run check:publication` and
   `npm run check:public-history` before any public push. Follow the
   [publication boundary guide](docs/operations/publication-boundary.md).
   Publication and package release require separate maintainer authorization.

The English README is the canonical public entry point. Keep
[Japanese](README.ja.md) and [Traditional Chinese](README.zh-TW.md) aligned
when changing its capabilities or commands; see
[ADR-0012](docs/adr/0012-documentation-language-policy.md).
Existing Temple projects follow the
[compatibility and migration guide](docs/getting-started/migration-from-temple.md).
