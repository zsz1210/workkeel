# Contributing

Workkeel welcomes focused bug reports, documentation improvements, tests, and implementation proposals. The project is still in Alpha, so open an issue before starting a large feature or a change to architecture, lifecycle authority, file ownership, security, or external integrations.

New projects may use [task-first mode](docs/getting-started/workkeel.md). This
framework repository still self-hosts the legacy Temple operating contract;
its current lifecycle gates and instructions remain binding for contributions.

This repository is the central framework. Do not add Agent names, product specifications, work items, prompts, credentials, telemetry, or verification evidence from any real project.

## Submit an issue

- Use the bug form for reproducible defects and the feature form for a concrete user problem.
- Search existing issues first and keep one problem per issue.
- Use minimal synthetic examples. Never paste secrets or private project data.
- Suspected vulnerabilities must follow [`SECURITY.md`](SECURITY.md), not the public issue tracker.

## Submit a pull request

1. Fork the repository and create a focused branch.
2. Update the relevant specification or ADR before changing a durable contract.
3. Keep framework files generic; place no project-specific Agent names or real-project state in `project-overlay/`.
4. Add or update tests that prove the behavior and its safety boundary.
5. Run `npm ci --ignore-scripts`, then `npm run verify` for a behavioral candidate or `npm run verify:fast` for prose-only changes. Follow the [testing guide](docs/getting-started/testing.md) for focused development, organization-state checks, and UI verification.
6. Explain the user problem, the chosen boundary, verification performed, and any remaining risk in the pull request.

If AI assisted the contribution, the human contributor remains responsible for reviewing the result, respecting third-party licenses, removing private data, and confirming that the submitted code and prose may be distributed under this repository's license.

By submitting a contribution, you agree that it may be distributed under the repository's MIT License. Acceptance, release timing, and maintainer authority follow [`GOVERNANCE.md`](GOVERNANCE.md).

## Maintainer change workflow

Follow the [single-maintainer pull request policy](GOVERNANCE.md#single-maintainer-pull-request-policy). GitHub approval by another account is optional while there is one human maintainer; pull requests, required CI, applicable local verification, and the effective Temple profile's independent review remain required. Verify recorded evidence for the candidate revision before merging. An already-authorized integration does not need another confirmation merely because the author cannot approve their own PR; the policy does not expand task or release authority.

1. Update the relevant specification or ADR first.
2. Update `project-overlay/`, the central documentation, or the CLI.
3. Run the checks required by the [testing guide](docs/getting-started/testing.md); retain full verification for behavioral candidates and releases.
4. For initialization, upgrade, packaging, or organization-contract changes, run `init -> doctor -> status` once in a temporary directory.
5. Update the changelog before creating a version tag.

When adding or modifying a Skill, follow the public contract in `docs/extensions/skill-authoring.md`, the maintainer promotion rules in `docs/extensions/skill-design.md`, and update the adoption state and third-party provenance in `docs/extensions/capability-catalog.md`.

When changing Engineering Learning, update the record model, `index.json` validation, doctor and status behavior, templates, and `docs/extensions/engineering-learning.md` together. Project Lessons and Practices remain project-owned and must never be promoted into framework behavior automatically.

When changing Positions, update initialization examples, lean Assignment slots, Position configs, doctor checks, upgrade migration, and tests together. UI design changes must preserve the code-first, preview-first, and design-led evidence contract without imposing a mandatory vendor tool.

Documentation is English except for the localized README and Roadmap entry points. Keep the English, Japanese, and Traditional Chinese README files structurally aligned whenever public behavior, installation, or capability claims change. Keep `docs/planning/roadmap.md`, `docs/planning/roadmap.ja.md`, and `docs/planning/roadmap.zh-TW.md` aligned whenever phase status, gates, or planned scope changes. See [ADR-0012](docs/adr/0012-documentation-language-policy.md).

Every upgrade feature must preserve these rules: managed files may be updated, project-owned files must not be overwritten, and generated files may be rebuilt.
