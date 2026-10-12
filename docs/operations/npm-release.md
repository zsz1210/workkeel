# npm release operations

Ordinary Workkeel npm publishing runs after a maintainer deliberately publishes
a GitHub Release. Pull requests, pushes, merges, and draft Releases do not trigger
publication. The first-package bootstrap described below requires a separate
owner-authenticated upload before a Trusted Publisher can be configured.

`@zsz1210/workkeel@0.1.0-beta.1` is the published prerelease. This public
source repository is a fresh history. Creating it, merging a pull request,
or passing tests does not publish a new package. No later npm version is
promised by this guide.

## Repository and trust boundary

Before a future release, the maintainer must verify the new GitHub repository
identity, release workflow, npm package ownership, and Trusted Publisher
relationship against the actual services. A relationship configured for an
earlier repository identity is not evidence for this one. The release workflow
requires an explicitly verified repository ID; it must not infer trust from a
repository name or fall back to a write token.

Do not publish a GitHub Release while its package upload path is unverified.
Publishing is a separate maintainer decision. The
[public source/private-state decision](../adr/0083-public-source-private-state.md)
also requires an outgoing-history audit before public publication.

## One-time npm setup

The package owner creates one [npm Trusted Publisher](https://docs.npmjs.com/trusted-publishers/) connection for `@zsz1210/workkeel` with these exact values:

| Field | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `zsz1210` |
| Repository | `workkeel` |
| Workflow filename | `publish-npm.yml` |
| Environment | none |
| Allowed action | direct `npm publish` |

The filename is case-sensitive and names only the file inside `.github/workflows/`. Do not add an npm write token to GitHub. Trusted Publishing requires npm CLI 11.5.1 or newer; Workkeel's release packaging uses the stricter qualified toolchain below.

After `publish-npm.yml` reaches the repository's default branch, an authenticated
maintainer can configure the relationship with the npm CLI. For a migrated
repository, first inspect the existing relationship and follow npm's current
reauthorization procedure; the command must not be treated as proof of trust:

```bash
npm trust github @zsz1210/workkeel \
  --repo zsz1210/workkeel \
  --file publish-npm.yml \
  --allow-publish \
  --yes
```

After verifying the actual npm relationship against the current GitHub repository's
numeric ID, set `NPM_TRUST_REPOSITORY_ID` to that verified ID. Leave it unset until
then; the workflow stops if it is missing or does not match `github.repository_id`.
The name `zsz1210/workkeel` alone does not identify the previous repository.

This is an external permission change, not part of ordinary release preparation. Confirm the exact package, repository, workflow filename, and allowed action before completing it.

The package must already exist before `npm trust` can configure it. If the renamed
Workkeel package is absent, the owner must complete its first publication with the
required account authentication and two-factor confirmation, then establish the
trust relationship. Keep the GitHub release as a draft until that prerequisite
and the exact archive are ready; do not trigger a known-unconfigured OIDC upload
or silently substitute a token. See [npm trust](https://docs.npmjs.com/cli/v11/commands/npm-trust/).

After the first successful OIDC release, the package owner should confirm the registry provenance and may change npm's traditional publishing access to require two-factor authentication while disallowing tokens. Keep any interactive maintainer access needed for recovery until the OIDC path has succeeded once.

## Prepare a release

Use the official Node **24.20.0** distribution from
[nodejs.org](https://nodejs.org/dist/v24.20.0/), verified against its published
`SHASUMS256.txt`, with npm **11.19.0** and zlib **1.3.2.1-motley-42c2f19**. Put that
distribution's `bin` directory first on `PATH` for these commands. The release
workflow pins the same official Node version through `actions/setup-node`.
This requirement is for framework release maintainers; consumer Node >=24 support
and ordinary development/CI are unchanged.

Node/npm version strings alone are insufficient: distributions can produce different
gzip bytes despite identical complete uncompressed tar contents.
`release:pack` checks all three versions and runs npm with the same Node executable.
Its recorded fingerprint is compatibility evidence, not cryptographic proof of
distribution origin. Update the pinned fingerprint and workflow together only after
qualifying a new official runtime and pack result; never silently accept a new zlib.

Prepare and verify the candidate in the [private development workspace](framework-development.md).
Keep raw checks, screenshots, packing output and review evidence outside the public
checkout. Before promoting reviewed commits, audit their outgoing history and run
`npm run check:source-checkout` in the clean public checkout.

1. Choose a new semantic version. Use a prerelease version such as `0.2.0-alpha.1` for npm `next`, or a stable version such as `0.2.0` for npm `latest`.
2. Update all version-bearing files and the changelog on a reviewed branch. Review the documentation synchronization checklist below before freezing the candidate; planned publication must remain labeled as pending until registry verification.
3. Run `npm ci --ignore-scripts`, then the release pack command below to catch an incompatible environment before full testing. The output directory must be new, its parent must exist, and it must be outside the source checkout.
4. Run `npm run verify` on the exact candidate, then pack into a second new directory and compare against the first archive with `node scripts/validate-npm-release.mjs verify-asset --fresh <second-archive> --release <first-archive>`. Retain the verified `.tgz`, `toolchain.json` and `pack-result.json` as the candidate evidence.
5. Merge the candidate through the repository's normal review path.
6. Create a draft GitHub Release whose tag is exactly `v<package version>` at the verified commit.
7. Attach the exact candidate `.tgz`. Mark the GitHub Release as a prerelease if and only if the package version contains a semantic prerelease component.
8. Review the tag, target commit, prerelease flag, notes, and asset, then publish the GitHub Release.

From the framework source checkout, prepare an archive without installing dependencies or publishing:

```bash
release_parent=$(mktemp -d)
npm run release:pack -- --output "$release_parent/candidate"
```

The helper refuses existing output directories and leaves diagnostics in its owned
output directory if packing fails. It does not overwrite a candidate or change
your Node installation. Inspect and remove only your own failed output directory
before using a new destination.

Publishing the Release triggers `.github/workflows/publish-npm.yml`. GitHub recommends the `release.published` event for workflows that must cover both stable and prerelease publications, including prereleases published from drafts. The workflow first packs with the qualified toolchain, validates metadata, downloads the attached archive, and compares bytes. Only then does it run complete verification. It repacks and compares the retained asset again after testing. If the version is absent, it publishes through OIDC. For an already uploaded bootstrap version, it skips upload only after registry identity, both integrity hashes, downloaded bytes and the intended dist-tag match. Both paths finish with registry verification. A mismatch never becomes acceptable merely because the decompressed contents match. See [GitHub's release-event reference](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#release).

## Channel mapping

| GitHub Release and package | npm channel |
| --- | --- |
| Prerelease Release + semantic prerelease version | `next` |
| Stable Release + stable semantic version | `latest` |
| Any crossed or mismatched combination | stop before publish |

## Verify the result

After the workflow succeeds, verify the immutable version and channel separately:

```bash
npm view @zsz1210/workkeel@<version> version dist.shasum dist.integrity
npm view @zsz1210/workkeel dist-tags --json
```

Also inspect the npm package page for provenance and perform a clean installation from the intended dist-tag. A green GitHub job alone is not proof that consumers can retrieve and execute the package.

## Synchronize release documentation

Before freezing the candidate, review the English, Japanese and Traditional Chinese
README editions, changelog, private release-readiness and qualification records,
documentation index and command availability notes. Match feature claims to the
candidate revision, move only included changes out of `Unreleased`, and keep
development-source instructions distinct from published-package instructions.
Do not describe a planned release as already published.

After successful registry verification, record the observed GitHub tag/target,
publication date and npm dist-tags in the private release-readiness record. Update the three public
entry editions and any remaining preparation-only wording on a follow-up docs
branch. Remove obsolete `unreleased` labels only for features actually shipped;
retain later main changes under `Unreleased`. Run `npm run verify:fast` for the
prose-only follow-up. Do not move a published tag or rewrite historical candidate
evidence to make packaged documentation appear newer.

## Failure and recovery

- If any step before `npm publish` fails, correct the candidate and create a new Release/version as appropriate. Do not add a fallback token or bypass the validator.
- If npm rejects OIDC, first compare the npm Trusted Publisher repository and workflow filename with the exact GitHub workflow. npm does not validate that relationship when it is saved.
- If publication succeeds but the package is defective, npm versions cannot be replaced. Deprecate the affected version when appropriate, publish a corrected successor, and intentionally repair dist-tags.
- Do not rerun a successful workflow for an already published version.

## Evidence boundary

The workflow and its local tests prove trigger, metadata, permission, and archive-validation policy. The one-time npm setting proves only that the relationship was configured. The first new Release published through this path supplies the first end-to-end OIDC and registry evidence.
