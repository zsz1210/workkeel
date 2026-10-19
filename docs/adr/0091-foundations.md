# ADR-0091: Foundations carried forward from the Temple-era decisions

- Status: Accepted
- Date: 2026-10-19
- Replaces: ADR-0001 to ADR-0070 (removed from the source tree; Git history retains them)

## Context

ADR-0001 to ADR-0070 were written for Temple, the earlier Position-based
framework. Temple compatibility mode, its CLI, `temple.lock` and its Position,
Work Item and Control Plane structures have been removed from this source.
Most of those records now describe mechanisms that no longer exist, yet a few
principles still govern Workkeel. Readers had to search seventy records to find
them, and records that still described removed features as supported misled
both people and Agents.

This record keeps the principles that still apply and states them in current
terms. It does not revive any removed mechanism. Where a principle came from a
specific earlier record, the record number is given for Git-history lookup only.

## Decision

### 1. Public source and private task state (from ADR-0083)

[ADR-0083](0083-public-source-private-state.md) remains in force unchanged and
is not replaced by this record. Its rules are restated here so that they cannot
be lost when reading this summary alone; where the two differ, ADR-0083 governs.

- Publish framework code, generic project overlay, examples, documentation,
  license notices, and reproducible tests in a fresh source history.
- Keep actual task records, approvals, dispatch records, review evidence,
  raw execution output, machine settings, `.ai-org/`, and `workkeel.lock`
  in an independent private development workspace outside the public source
  checkout. Git ignore rules are defense in depth, not permission to store real
  development data in that checkout. Back up private state separately with access
  suited to its contents.
- A public source checkout does not contain or initialize maintainer tasks. Run
  the native lifecycle in a private working copy of the same source revision.
  Promote only reviewed source commits into the clean public checkout. There is
  one framework source history, not a second implementation in the private archive.
- Public issues, PR descriptions and release notes contain product-facing reports
  and concise sanitized verification summaries. Never mirror the internal task
  ledger or upload actual development records, raw outputs or evidence attachments.
- Use fictional examples in public guidance. Product tests demonstrate
  behavior; private acceptance evidence and local measurements remain
  candidate-specific and are not represented as public test results.
- Audit all outgoing Git history before a public push. Ignoring a path in
  the current tree does not remove it from earlier commits.

Two older rules point the same way and remain in force (ADR-0011, ADR-0048):

- Lessons learned in a private project may reach this source only without that
  project's private content. Never copy code or data from a private project or
  pilot repository into the framework.
- A passing publication audit is evidence. It is not publication authority or a
  security certification.

### 2. Documentation language (from ADR-0012)

- `README.md` is the canonical English entry point.
- `README.ja.md` and `README.zh-TW.md` are maintained entry points with the same
  information hierarchy and claims.
- All other framework documentation, installed instructions, Skills, templates,
  changelog entries, contribution guidance, and security guidance use English.
- A change to public README behavior or claims updates all three README variants
  in the same change.
- Repository checks reject CJK text in Markdown outside the localized README
  files. Identifiers, product names written in Latin characters, diagrams, and
  non-language typography are unaffected.
- This policy covers the framework source only. The installed
  `$project-documentation` Skill follows each target project's own language
  policy and does not impose multilingual documentation on product repositories.

### 3. Distribution, runtime support and CI (from ADR-0039, ADR-0043, ADR-0051)

- The supported runtime is the Node.js version declared in `package.json`
  `engines.node` (currently Node.js 24). A newer local Node.js version may work,
  but its success does not by itself qualify that major. A new Node.js major is
  not added merely because it is Current; it must reach LTS and pass
  exact-candidate verification.
- The npm package uses an explicit `files` allowlist. A dry-run package check
  rejects maintainer state, tests, examples, generated evidence and development
  scripts, so unexpected package growth is a failing check rather than a manual
  observation.
- Third-party GitHub Actions are pinned to reviewed full commit SHAs, and
  workflows keep least-privilege permissions.
- Ordinary hosted CI is one bounded job on Node.js 24 that cancels superseded
  runs. It installs locked dependencies without lifecycle scripts and runs the
  repository, documentation-link and package checks, the clean-clone entrypoint
  and publication-boundary checks, and the fast contract suite. It does not run
  the full suite or browser verification.
- Complete verification stays local. A behavioral candidate passes
  `npm run verify`; a user-interface candidate also passes
  `npm run test:browser`. Prose-only changes use `npm run verify:fast`. Hosted
  CI is a remote consistency guard, not a replacement for local full testing,
  independent review or the release gate.
- Historical records keep the runtime versions and CI results actually observed.
  They are not rewritten to match a later policy.
- The repository uses the MIT License. Copied or modified third-party material
  keeps its own license and notices; this repository's LICENSE cannot replace them.

### 4. Release publication (from ADR-0050)

- npm publication uses Trusted Publishing from a single GitHub Actions workflow
  triggered only by a published GitHub Release. It has `contents: read` and
  `id-token: write`, stores no npm write token and uses an exact trusted
  workflow filename.
- Publishing a draft, editing a Release, pushing a tag, merging a pull request
  or manually dispatching a workflow cannot reach that path. Merge authority and
  release authority are different.
- Before publication the workflow checks out the Release tag, packs with the
  qualified official Node distribution, validates tag and channel metadata,
  downloads the archive attached to the Release and requires byte identity. It
  then runs complete verification, packs again and rechecks the asset before
  publishing that exact asset. Decompressed equality does not substitute for
  byte identity.
- A semantic prerelease requires a GitHub prerelease and publishes under npm
  `next`; a stable version requires a non-prerelease Release and publishes under
  `latest`.
- Published npm versions are immutable. Recovery uses deprecation, a corrected
  successor and intentional dist-tag repair, never replaced bytes.
- Task acceptance, a passing check or a successful closeout never creates a tag,
  changes repository visibility or settings, or publishes a package. Each of those
  remains a separate human action. Operational detail is in the
  [npm release guide](../operations/npm-release.md).

### 5. Authority lives in recorded state (from ADR-0003, ADR-0009, ADR-0019, ADR-0023, ADR-0027)

- Approved scope, decisions, evidence and approvals are stored in project files,
  Git or explicitly linked external systems. Chat is for discussion and handoff;
  it is not the record.
- Generated views, observer pages, summaries, search results and AI-written
  digests are derived projections. They cite canonical sources and never become
  approval or decision authority.
- Inspect, explain, diagnose, review and status requests are read-only by
  default. Writing requires a request from the user or an approved task whose
  scope includes the write.
- A recorded handoff names an exact Git commit. A moved branch or tag cannot
  change what was recorded, and historical records are not rewritten to fit the
  current tree (ADR-0052).

### 6. Bounded work stops at its boundary (from ADR-0011)

A task defined as a pilot, example, proof or experiment states its purpose,
observable stop condition and excluded follow-on work. Accepting it accepts only
that bounded result. New features, a second task, distribution, or promotion of
the result into a product need a new explicit request.

### 7. Third-party material and measurement (from ADR-0005, ADR-0008, ADR-0034)

- Third-party capabilities are opt-in. Pin the version and source, record the
  license and notices, constrain inputs and outputs, and never let an adapter
  change canonical state or satisfy an approval.
- Do not vendor an external Skill or library without an explicit decision.
- Prefer provider-reported usage. Never invoke a model solely to count tokens.
  A dimension that was not measured stays unknown rather than being estimated
  into a fact, and a budget never authorizes skipping context, evidence, review
  or approval.

### 8. Private observer access is read-only (from ADR-0035)

The observer has no mutation or command gateway. Optional private access over
the owner's existing Tailscale network goes through a loopback reverse proxy
that forwards only GET requests for the observer page, assets and task APIs,
checks the exact Host, the Origin when supplied and the owner's login header,
and fails closed for any other identity. Credentials, source logs, private
binding paths and the local access capability never reach the browser. Loopback
is a transport trust boundary, not isolation from other local processes.
Workkeel never enables Funnel, changes tailnet grants, renames the device or
installs a login service.

## Consequences

- The ADR index lists ADR-0071 onward plus this record. Removed records stay
  reachable through Git history; nothing in this tree links to them.
- ADR-0083's public and private boundary is unchanged. This record repeats its
  rules; it does not relax, shorten or reinterpret them.
- The Temple-specific mechanisms of the removed records (Positions, Work Items,
  `temple.lock`, Control Plane, Human Inbox, Management Console, Lean and
  High-Assurance profiles, federation, tracker coordination) are not supported
  and must not be cited as current behavior.
- Risk tiers for native tasks are described in the
  [team adoption and risk tier guide](../operations/team-adoption-and-risk.md),
  not by the removed High-Assurance records.

## Rejected alternatives

- Keep all seventy records with a "historical" banner. Rejected because readers
  and Agents kept treating removed mechanisms as current.
- Delete the records without a summary. Rejected because the documentation
  language, distribution, release and boundary rules still govern this source.
- Edit ADR-0083 into this record. Rejected so that the boundary decision keeps
  its exact wording and its own history.
