# Alpha release readiness

Last refreshed: 2026-09-26

**Alpha.34 is the Workkeel release candidate; publication is pending.** The renamed
`@zsz1210/workkeel` registry endpoint returned 404 on the refresh date. Its first
publication and trusted-publisher configuration must be completed explicitly.
An npm trust relationship requires an existing package; see the official
[npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/).
Do not assume that the historical package's permission follows a rename.

**Historical Alpha.33 was published as `@zsz1210/temple-ai-dev-org`.** Publication completed
on 2026-09-16. WI-0243 retains candidate qualification; WI-0244 retains publication
and registry verification. The source version, a reviewed merge, a Git tag,
a GitHub Release and an npm version remain separate states.

## Current release surfaces

| Surface | Observed state | Next action |
| --- | --- | --- |
| Published GitHub prerelease | [v0.1.0-alpha.33](https://github.com/zsz1210/temple-ai-dev-org/releases/tag/v0.1.0-alpha.33), target `2e269d67bd764d3c47df665bc9043263cf8082e8` | Preserve the immutable published release |
| npm channels | The renamed Workkeel package is not yet available; prior dist-tags belong to the historical Temple package | Verify the exact name and version; do not treat historical availability as a Workkeel publication |
| Development source | Alpha.34 release candidate, including native Learning and observer work | Use the exact revision and [changelog](../../CHANGELOG.md) until archive and registry qualification are complete |
| Integration | [Single-maintainer PR policy](../../GOVERNANCE.md#single-maintainer-pull-request-policy) | Ordinary PR, required CI and independent native Workkeel review; no impossible self-approval requirement |
| npm publication | [Release-only workflow](../operations/npm-release.md) | Publishing a GitHub Release triggers verification and exact-asset comparison before OIDC upload |
| Real downstream projects | Not modified by release qualification | Plan an explicit project-specific upgrade; publication does not upgrade installed projects |

These service observations are dated, not live guarantees. Recheck immutable
version availability and dist-tags separately at publication time.

## Alpha.33 scope

The [changelog](../../CHANGELOG.md) records contributor readiness, explicit policy
transitions, attributable ownership, measurement reuse, evidence durability and
record reconciliation. Recent implementation work also reduced test duplication,
batched continuity Git reads, reused eligible schema compiler setup within one
Doctor call, and repaired Console test startup synchronization.

This remains an Alpha trial. Existing measurements are bounded by their candidate,
fixture and environment. They do not establish universal Token, cost or speed
savings, production readiness or complete multi-human/multi-machine qualification.

## Qualification gates

The [Alpha.33 qualification and upgrade guide](../validation/alpha-33-package-qualification.md)
defines reusable candidate checks. Alpha.33 candidate results belong to WI-0243;
WI-0244 retains the official archive and publication checks. This document does
not embed its own archive digest. A later main revision must be qualified separately.

| Gate | Required evidence |
| --- | --- |
| Source and dependency identity | Consistent package, lockfile, template and self-host bootstrap versions; clean lockfile installation on Node.js 24 |
| Repository verification | Complete `npm run verify` for the frozen release candidate, plus Doctor after organization-state mutations |
| Package boundary | Exact allowlisted manifest, integrity and SHA-256; no root self-host state or private project data |
| Consumer behavior | Install the retained archive, check CLI version, dry-run init, init, idempotence, pinned launcher, Doctor and Status |
| Upgrade safety | Published Alpha.32 baseline, unchanged project-owned files and policies, preserved local managed-file conflict, consistent Alpha.33 bootstrap |
| Independent judgment | Distinct Developer and Independent QA identities reviewing exact candidate evidence |
| Publication review | Matching tag, source, prerelease flag, notes and exact archive; deliberate maintainer publication |
| Post-publication | Registry version/integrity/channel verification and clean retrieval of the published package |

A package audit does not qualify every historical repository artifact for a new
publication surface. Prior historical disclosures and binary-review limits remain
in their original evidence. Preparation does not change repository visibility,
npm permissions, optional integrations or public deployment.

## Upgrade decision

Use a disposable copy first, retain the old lock and project-owned state, and
follow the [upgrade guide](../validation/alpha-33-package-qualification.md#upgrading-an-existing-project).
A framework upgrade preserves legacy project policy; it does not silently switch
a project to ordinary attribution or authorize a profile migration.

## Historical evidence

- [Alpha.30 package qualification](../validation/alpha-30-package-qualification.md)
  and WI-0167 retain the earlier 443-test/package/publication observations.
- [Final pre-Alpha clean-room rehearsal](../validation/final-pre-alpha-clean-room.md)
  retains the bounded fresh-session and cold-recovery results.
- Alpha.31's failed publication attempt remains in history. Alpha.32 corrected
  clean-host scratch and locked offline onboarding before its successful successor.
- Earlier privacy and public-source decisions remain in WI-0160 through WI-0167;
  they are not fresh verification of Alpha.33.

No announcement, stable `latest` promotion, hosted service or deployment follows
automatically from a passing candidate.
