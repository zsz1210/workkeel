# npm release operations

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

## Candidate preparation

1. Review the version, changelog, three README editions, package manifest,
   third-party notices, and actual command availability. Keep source-only
   behavior distinct from the published package.
2. Run `npm ci --ignore-scripts` and `npm run verify` on the exact candidate.
   Run applicable browser checks for UI changes. Record the tested Git
   revision and retain evidence privately.
3. Run `npm run release:pack -- --output <new-external-directory>` using the
   toolchain required by the release validator. The output directory must be
   new and outside this checkout. Review the package allowlist and archive.
4. Review the release workflow, archive comparison, registry identity,
   dist-tag mapping, and rollback plan. Obtain the maintainer's authorization
   for the actual release.

The release workflow and package validator are source contracts. Local tests
can check policy and archive bytes, but they cannot prove that the new
repository's OIDC relationship is configured or that npm accepted a future
upload. Verify those facts from the actual service when a release is authorized.

## Channels and verification

Semantic prerelease versions belong on npm `next`; stable versions belong on
`latest`. A mismatch stops publication. After an authorized release, verify
the exact version, integrity, and dist-tags from npm, then test a clean
installation. Preserve the resulting external evidence privately. A green
GitHub job alone does not prove that consumers can retrieve the package.

For the candidate test policy, see [testing](../getting-started/testing.md).
