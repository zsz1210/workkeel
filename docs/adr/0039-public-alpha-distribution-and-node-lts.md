# ADR-0039: Qualify public distribution against maintained Node.js LTS lines

## Status

Status: Accepted for compatibility design.

## Context

Temple's package declared `node >=20`, although Node.js 20 is end-of-life. The CI workflow tested only Node.js 22, and the package had no explicit file allowlist, so a dry run included repository self-host state, test evidence, screenshots, and optional examples. External GitHub Actions were referenced by movable major tags.

Node.js 26 is the latest Current release, but it does not enter LTS until October 2026. A public CLI needs a support promise based on maintained, repeatable environments rather than whichever major is newest on a maintainer machine.

## Decision

Support Node.js 22 and 24 LTS for the first public Alpha using the package range `^22.0.0 || ^24.0.0`. Run both majors in hosted CI. Node.js 24 is the primary current LTS environment; Node.js 22 is the compatibility floor. Node.js 26 may be tested as a non-blocking forward-compatibility signal, but it is not part of the support contract until it reaches LTS and passes the release matrix.

Define an explicit npm `files` allowlist containing the CLI runtime, initialization overlay, optional framework packs, and public documentation. Enforce the package boundary with a dry-run manifest check that rejects repository self-host state, tests, examples, generated evidence, and development scripts.

Pin third-party GitHub Actions to reviewed full commit SHAs and retain least-privilege workflow permissions. Keep `private: true` until a separate release decision authorizes npm publication. A successful repository closeout does not create a tag, change visibility, publish a package, or alter GitHub settings.

Retain MIT for the first public Alpha. Reconsider Apache-2.0 before a stable release if explicit patent grants, patent retaliation terms, or enterprise legal review become material requirements.

## Consequences

- Odd-numbered and end-of-life Node.js majors are not supported even if they happen to run locally.
- A new Node.js major is not added merely because it is Current; it must become LTS and pass exact-candidate verification.
- Package manifest growth becomes a failing repository check rather than a manual observation.
- Consumers receive framework runtime and documentation, not Temple's own development organization state.
- npm publication, repository visibility, branch protection, private vulnerability reporting, secret protection, a public code of conduct, and the first immutable release remain separate Human Principal actions or gates.

## Rejected alternatives

- Continue promising every Node.js version greater than or equal to 20.
- Support Node.js 26 Current before the LTS transition.
- Publish the repository root and maintain a growing exclusion list.
- Leave GitHub Actions on movable major tags.
- Switch to Apache-2.0 without a demonstrated patent-policy need.
