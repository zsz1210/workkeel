# ADR-0048: Govern auditable self-hosting with Evidence Profiles

## Status

Status: Accepted for compatibility design.

## Context

Temple stores organizational state and delivery evidence in the repository so work can survive conversation boundaries and be independently reviewed. The Temple toolkit also uses that operating model to develop itself. This makes the repository a useful demonstration, but it creates a publication question: useful history, machine-specific data, runtime telemetry, and secret material must not be treated as one undifferentiated category.

Removing all self-host evidence would make the framework's own operating claims harder to audit. Publishing everything would expose irrelevant local details and could expose sensitive data. Rewriting Git history would also destroy the exact development lineage the user wants to preserve.

## Decision

Temple defines the capability **Auditable Self-Hosting** and governs it through a project-owned **Evidence Profile**:

1. `private`, `public`, and `restricted` are the required profiles. New projects default to `private`.
2. Public evidence may retain lifecycle, QA, release, model-routing, Token-budget, Credits/reset approval, and experiment facts.
3. Credentials, raw Provider telemetry, and live account state remain local-only or blocked.
4. New public-facing maintainer paths and private endpoints are blocked until normalized.
5. An existing repository may pin a reviewed full Git commit as a repository-only legacy baseline. Exact counted matches remain `review-required`; new or changed matches are blocked.
6. The baseline never applies to package artifacts and never changes Git history.
7. The publication audit is deterministic, read-only, value-redacted, and bounded to declared surfaces. A passing report is evidence, not publication authority or security certification.
8. Binary files remain a separate manual or visual review obligation.

## Consequences

- Temple can preserve an inspectable self-host record without normalizing every old artifact in place.
- Existing repositories gain an enforceable no-new-leaks boundary without a forced history rewrite.
- Projects can adopt stricter handling without changing Temple's lifecycle or Position model.
- The npm package can be held to a stricter current-content boundary than the repository's retained history.
- Full-history, hosted-log, and binary-content reviews remain explicit release-gate work rather than continuous heavyweight CI.

## Rejected alternatives

- Delete `.ai-org` before publication.
- Publish all self-host data because the repository is intended to become public.
- Rewrite every historical commit and pull request.
- Treat Token budgets, Credits, or reset approval facts as credentials.
- Use a filename-only allowlist that can silently accept changed contents.
- Automatically sanitize files during audit.
