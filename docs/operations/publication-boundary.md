# Public source boundary and repository settings

The public Git repository is the framework source of truth. Keep actual task
records, approvals, execution sources, raw results and reviews in a separate
private development workspace outside the public source checkout, with an
independent backup. Tie those records to the exact source commit.
Do not maintain a second divergent framework implementation in the private archive.

`public-files.json` declares the exact filenames reviewed for public source.
Adding a file requires reviewing both its purpose and its contents, then adding
its relative path to the manifest. Do not regenerate the manifest from arbitrary
working files as a publication shortcut. Root `.ai-org/`, output, machine settings,
legacy project instructions, and internal development reports are never public.
Generic `project-overlay/` templates and synthetic product fixtures are deliberate
exceptions to the distinction between runtime data and source templates.

Two generic bootstrap files existed in the fresh source history before local
initialization was separated. `historical_files` pins only those exact reviewed
Git blobs. They are allowed only in past commits, never in a working/index check
or any outgoing branch/tag tip. Changed historical content still fails. This
exception does not allow a developer's generated instructions or launcher to be
added to public source.

For a clean public checkout, install pinned dependencies with
`npm ci --ignore-scripts` and enable the local hook with `npm run setup:hooks`.
Do not initialize real task state there. Follow the
[private development workspace guide](framework-development.md) for lifecycle
work and exact-commit promotion. Root ignore rules remain as defense in depth;
they do not authorize storing development data in the public checkout.

Before publication:

```sh
npm run check:source-checkout
npm run check:publication
node scripts/check-publication.mjs --staged
npm run check:public-history
```

`check:source-checkout` recursively rejects known runtime/data paths in the public
checkout, including nested ignored output and symlinks. It skips Git metadata and
root dependencies. Private-looking template paths are allowed only where the exact
public manifest declares them; extra records under a template directory fail too.
It does not run in the private workspace,
where those records deliberately live. It permits nested generic templates and
does not inspect or print private contents. Run it again after verification.

`check:publication` reads tracked and non-ignored working files. `--staged` reads
the actual index bytes, even if the working copy differs. The history check reads every
reachable local commit, including files deleted from the latest tree. The pre-push
hook refuses every push except to `workkeel/*` branches, so `main` changes only
through a PR; it then checks source-checkout cleanliness and the complete ancestry
of every outgoing commit. The publication scanner rejects undeclared
paths, private roots, symlinks, submodules, unapproved binary data, oversized files,
personal home paths and common credential formats without echoing matched secrets.
CI repeats the history check after upload; it cannot undo an earlier disclosure.

The scanner does not understand all private prose or every credential format.
Local hooks can be bypassed. Review newly allowlisted content and preserve the
publication procedure; these checks reduce mistakes rather than prove arbitrary
content safe. Verify the npm package file set separately with `npm run check`.
Framework tests belong in source; actual test output does not.

The boundary also applies outside Git: no internal tasks, execution transcripts,
screenshots of real projects, benchmark captures or private evidence attachments
in public issues, PRs, Actions artifacts or releases. A short product-facing check
summary is sufficient for a PR. CI may report results from its synthetic tests.

The fresh history retains license notices and necessary attribution. Existing
package versions and old private history remain separate. A new GitHub repository
identity does not itself establish npm Trusted Publishing permission; see the
[release guide](npm-release.md) before enabling a package release.

## Public repository settings

The public repository is [zsz1210/workkeel](https://github.com/zsz1210/workkeel).
Its settings support framework distribution and public contribution. Internal
planning, task boards, measurements and acceptance records stay in the
[private development workspace](framework-development.md).

### Maintainer configuration

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

### Verify settings rather than assume them

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
