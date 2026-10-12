# Public repository settings

The public repository is [zsz1210/workkeel](https://github.com/zsz1210/workkeel).
Its settings support framework distribution and public contribution. Internal
planning, task boards, measurements and acceptance records stay in the
[private development workspace](framework-development.md).

## Maintainer configuration

| Setting | Intended configuration |
| --- | --- |
| Visibility and default branch | Public, `main` |
| About | Framework description, documentation link and relevant agent/developer-tool topics |
| Issues | Enabled with bug and feature forms; synthetic reproductions only |
| Wiki and Projects | Disabled; versioned docs are the public documentation source |
| Discussions | Disabled until there is a maintained support workflow |
| Pull requests | Required check `Verify (Node.js 24)`, branch up to date, resolved conversations |
| Main branch | No force pushes or deletion; preserve existing protection when editing settings |
| Merge methods | Merge commits preserve the reviewed candidate in source ancestry; delete merged branches |
| Actions | Read-only default token; workflows cannot approve PRs |
| Security | Private vulnerability reporting, dependency alerts, secret scanning and push protection |
| Package publication | Separate release authorization and verified Trusted Publisher identity |

The default maintainer setup does not enforce protection against administrators,
and its minimum GitHub approval count is zero. The actual distinct-Agent review
is recorded privately under the native task policy; a green GitHub check does not
prove that review happened. Maintainers must use the PR gate without an admin
bypass. Teams can strengthen GitHub approval requirements for their own reviewers.

Use the issue forms for product reports and [the private form](https://github.com/zsz1210/workkeel/security/advisories/new)
for vulnerabilities. Native GitHub [push protection](https://docs.github.com/en/code-security/how-tos/secure-your-secrets/prevent-future-leaks/enable-push-protection)
and [private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)
add protection, but cannot classify every private document. Do not enable a paid
service or grant an external integration access merely to match this table.

## Verify settings rather than assume them

With an authenticated maintainer's GitHub CLI, these commands are read-only:

```sh
gh api repos/zsz1210/workkeel
gh api repos/zsz1210/workkeel/branches/main/protection
gh api repos/zsz1210/workkeel/actions/permissions/workflow
gh api repos/zsz1210/workkeel/private-vulnerability-reporting
gh api repos/zsz1210/workkeel/vulnerability-alerts
```

Keep settings snapshots and operational check results privately. A checked-in
workflow, this document or an old success report does not establish current
GitHub settings. The CI badge is a bounded source check; consult the
[testing guide](../getting-started/testing.md) for its limits.

The [npm release guide](npm-release.md) covers the separate package boundary.
Do not set `NPM_TRUST_REPOSITORY_ID` until the actual npm Trusted Publisher is
verified against this repository's current numeric ID. Public source availability
does not imply package publishing is configured or that `main` is a published version.
