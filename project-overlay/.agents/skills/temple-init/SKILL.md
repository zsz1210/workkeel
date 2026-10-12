---
name: temple-init
description: Initialize a repository's AI development organization with the temple CLI, including project-specific Agent names and Position assignments. Use for first-time organization setup, not ordinary feature work.
---

# Project Organization Init

Initialize one target repository without inventing project facts or overwriting user files.

## Required outcome

- All ten required Positions remain stable.
- The target project receives its own Agent Identities only after the user confirms their English display names.
- One Identity may hold multiple Positions.
- Developer and Independent QA must use different Identities.
- Existing repository delivery policy remains authoritative; the framework records only the confirmed integration mapping it needs.
- `temple init --dry-run`, the real init, `temple doctor`, and `temple status` all complete or leave an explicit blocker.

## Workflow

1. Resolve the target repository and the central Toolkit checkout containing `bin/temple.mjs`. Treat them as different directories for ordinary projects. Use the same directory only when the user explicitly asks to self-host the central Toolkit; that path requires `--self-host` and must never be inferred. Confirm the checkout's lockfile dependencies were installed with `npm ci`; if a runtime dependency is missing, stop and report that exact prerequisite instead of guessing a global package.
2. Inspect the target read-only: repository name, current `AGENTS.md`, language/build clues, Git state, likely integration target, repository-host clues, CI configuration, `CONTRIBUTING.md`, governance or delivery documentation, and whether `.ai-org` or `temple.lock` already exists. Do not contact a remote provider or mutate repository settings merely to discover a workflow.
3. If `temple.lock` already identifies an initialized organization, stop treating this as first init and run `doctor`; do not create new identities.
4. Establish the repository integration boundary before proposing writes:
   - If authoritative project policy is visible, summarize it, cite the repository paths, and propose a `confirmed` `temple.repository-integration/v1` record. Treat the summary as routing help, not a copy or replacement of that policy.
   - If the policy is incomplete, ask only the missing questions that change execution: the integration target when relevant, whether changes must be isolated, and whether a review gate is required. Do not present GitHub Flow as the framework default.
   - If the user explicitly postpones the choice, propose `deferred` with the decision trigger. Otherwise leave unavailable facts `unconfirmed`; never guess direct-to-main, pull requests, merge requests, or release authority.
   - Never store credentials, tokens, private email addresses, or copied confidential policy text in the record.
5. Show the user the recommended five assignment slots:
   - Coordination: Engineering Manager, Release Manager, Observer.
   - Product Design: Product Manager, UX Designer, UI Designer.
   - Technical: Tech Lead.
   - Delivery: Developer.
   - Quality: Quality & Evaluation Engineer, Independent QA.
6. Ask whether the user wants to provide names or wants AI suggestions. When suggesting names, propose unique natural English names without encoding rank, model, or letters such as Agent A/B/C. Explain that names are editable labels and IDs remain stable.
7. Show one combined pre-write confirmation containing the repository integration summary, policy references, confirmation state, Agent names, and Position mappings. Wait for explicit confirmation. Do not initialize on an unconfirmed proposal.
8. Build a `temple.init/v1` JSON config with `naming_mode` and the complete `repository_integration` document set accurately. Use a temporary file outside the target repository when possible; do not commit it.
9. Run the dry-run first. Surface existing-file conflicts, repository-integration state, and the `AGENTS.md` integration plan. Only use `--integrate-agents` after the user has approved changing an existing `AGENTS.md`. For an explicitly approved Toolkit self-host, add `--self-host` to both dry-run and real init; never use that flag for another target.
10. Run the real init, verify that the target contains `templew.mjs`, `.ai-org/project/repository-integration.json`, and a matching `temple.cli-bootstrap/v1` lock record, then run `doctor` and `status` through `node ./templew.mjs` from the target. In a dirty Toolkit self-host checkout, set `TEMPLE_CLI_PATH` to that checkout's absolute `bin/temple.mjs`; do not substitute an unversioned global CLI. Remove only the exact temporary config you created.
11. Report the target path, repository-integration state, assigned identities, doctor result, generated status path, and any remaining manual integration. If integration remains unconfirmed or deferred, explain the exact trigger for asking again. Do not claim a GitHub push, CI pass, runtime verification, or hosting-policy enforcement without evidence.

The central Toolkit must never acquire these project names as distribution defaults. A confirmed self-host identity belongs only to root project state and must not enter `project-overlay/` or the central Position definitions.
