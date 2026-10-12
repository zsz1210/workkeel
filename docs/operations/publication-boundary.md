# Public source boundary

The public Git repository is the framework source of truth. Keep actual task
records, approvals, execution sources, raw results and reviews in private local
state with an independent backup. Tie those records to the exact source commit.
Do not maintain a second divergent framework implementation in the private archive.

`public-files.json` declares the exact filenames reviewed for public source.
Adding a file requires reviewing both its purpose and its contents, then adding
its relative path to the manifest. Do not regenerate the manifest from arbitrary
working files as a publication shortcut. Root `.ai-org/`, output, machine settings,
legacy project instructions, and internal development reports are never public.
Generic `project-overlay/` templates and synthetic product fixtures are deliberate
exceptions to the distinction between runtime data and source templates.

For a clean clone, install pinned dependencies with `npm ci --ignore-scripts` and
enable the local hook with `npm run setup:hooks`. The source repository ignores
the generated `WORKKEEL.md`, `workkeelw.mjs` and `workkeel.lock`, so approved native
initialization can create them without colliding with tracked maintainer state.
Save a reviewed policy under ignored `.workkeel-private/policy.json`, then use
`node bin/workkeel.mjs init . --policy .workkeel-private/policy.json`. Run Doctor
after setup. Back up the resulting private state; an ignore rule is not a backup.

Before publication:

```sh
npm run check:publication
node scripts/check-publication.mjs --staged
npm run check:public-history
```

The first command reads tracked and non-ignored working files. The second reads
the actual index bytes, even if the working copy differs. The third checks every
reachable local commit, including files deleted from the latest tree. The pre-push
hook checks the complete ancestry of every outgoing commit. It rejects undeclared
paths, private roots, symlinks, submodules, unapproved binary data, oversized files,
personal home paths and common credential formats without echoing matched secrets.
CI repeats the history check after upload; it cannot undo an earlier disclosure.

The scanner does not understand all private prose or every credential format.
Local hooks can be bypassed. Review newly allowlisted content and preserve the
publication procedure; these checks reduce mistakes rather than prove arbitrary
content safe. Verify the npm package file set separately with `npm run check`.
Framework tests belong in source; actual test output does not.

The fresh history retains license notices and necessary attribution. Existing
package versions and old private history remain separate. A new GitHub repository
identity does not itself establish npm Trusted Publishing permission; see the
[release guide](npm-release.md) before enabling a package release.
