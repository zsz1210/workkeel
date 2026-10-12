# ADR-0043: Require Node.js 24 and keep hosted CI bounded

## Status

Status: Accepted for the compatibility source workflow.

Updated by [ADR-0051](0051-scope-local-verification-and-deduplicate-evidence-reads.md): the implemented timeout is eight minutes, Doctor includes Schema validation, and local prose-only work has a fast verification path. [ADR-0050](0050-release-triggered-npm-trusted-publishing.md) separately requires complete verification in Release publishing. The historical decision below is retained as recorded.

This decision supersedes the active Node.js 22 compatibility and hosted full-suite requirements in ADR-0039 and the hosted browser requirement in ADR-0040. Their package-boundary, dependency-provenance, local browser-contract, and historical evidence decisions remain in force.

## Context

Earlier CI policy used a Node.js version matrix and complete hosted checks.
The repository owner chose a bounded remote gate with complete candidate
verification performed locally.

Conservative change classification can run the complete suite for a small
documentation or evidence update. The bounded remote gate avoids that
cost while preserving explicit full local candidate verification.

## Decision

Require Node.js 24 or later with `engines.node` and the repository launcher metadata set to `>=24.0.0`. Node.js 24 is the remote baseline that Temple actively checks. A newer local Node.js version may be used, but its success does not by itself claim separate compatibility qualification for that major.

Use one GitHub Actions job on Node.js 24 with a five-minute timeout and cancel superseded runs. The ordinary pull-request and `main` push gate performs only:

1. lockfile-strict dependency installation without lifecycle scripts;
2. repository, documentation-link, and package-boundary checks;
3. runtime JSON Schema validation;
4. source checks that require no private maintainer task history;
5. the bounded fast contract suite.

Private task Doctor runs in an initialized local checkout, where its exact
candidate evidence and Git history remain available.

Do not run `npm run test:full` or `npm run test:browser` in ordinary GitHub Actions. Remove the Node.js matrix and change-scope selector from the hosted workflow so its cost and maximum behavior are easy to understand.

Keep complete verification local. The implementation candidate must pass `npm run verify`. A user-interface candidate must also pass `npm run test:browser` with installed Chrome and preserve the required visual review evidence. Pull-request review checks the exact local revision and evidence; the bounded hosted job is a remote consistency guard, not a replacement for local full testing, Independent QA, or the Release Gate.

Historical records continue to state the Node.js versions and GitHub Actions results that were actually observed. They are not rewritten to match the new policy.

## Consequences

- Ordinary GitHub Actions uses one runner rather than two and has no hosted full or browser suite.
- The remote gate no longer proves the complete Linux integration suite or hosted browser behavior for every candidate.
- Local exact-revision evidence, Independent QA, and pull-request review become more important and remain release-blocking.
- Node.js 22 users must upgrade before using the next Temple candidate.
- Adding another remotely verified runtime or restoring a hosted full suite requires a separate decision justified by compatibility or release risk.

## Rejected alternatives

- Continue the Node.js 22 and 24 hosted matrix.
- Keep two jobs but shorten only their timeout.
- Run the complete integration or browser suite on every pull request.
- Remove GitHub Actions entirely and lose the independent clean-checkout guard.
- Rewrite old Alpha evidence as though it had been produced under this policy.
