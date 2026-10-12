# Public source boundary

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

`check:source-checkout` rejects known runtime/data paths in the public checkout,
including ignored entries and symlinks. It does not run in the private workspace,
where those records deliberately live. It permits nested generic templates and
does not inspect or print private contents. Run it again after verification.

`check:publication` reads tracked and non-ignored working files. `--staged` reads
the actual index bytes, even if the working copy differs. The history check reads every
reachable local commit, including files deleted from the latest tree. The pre-push
hook checks source-checkout cleanliness and the complete ancestry of every outgoing
commit. The publication scanner rejects undeclared
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
