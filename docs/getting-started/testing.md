# Testing strategy

Workkeel separates the bounded remote repository gate from complete local verification. This repository uses the native task lifecycle: claim, exact-candidate handoff, independent Agent review, and authorized Principal acceptance. Retained Temple organization and Position behavior remains covered by isolated compatibility fixtures. The goal is to preserve the safety guarantees of a repository-writing framework without spending several hosted runner-minutes after every push.

`npm run check` validates repository structure, documentation language boundaries, local Markdown link targets, and the actual npm dry-run package boundary. These checks run for every change. The full suite is offline: it tests code, contracts, and simulated providers, not paid model calls.

## Local development

Run repository policy checks and the fastest contract tests while editing:

```bash
npm run verify:fast
```

Run a focused test file for the area being changed:

```bash
node --test test/tracker.test.mjs
node --test test/workflow.test.mjs
```

For a wider edit, choose an explicit local group:

| Command | Coverage |
| --- | --- |
| `npm run test:core` | Core CLI, lifecycle, routing, recovery, governance, and mixed core/optional tests |
| `npm run test:optional` | Console, Control Plane, and optional observer/provider integration |
| `npm run test:experiments` | Offline experiment harnesses, acquisition classification, protocols, and analysis |
| `npm run test:daily` | Curated representative core/optional safety paths for a broad routine check |
| `npm run test:fast` | Small contracts, package-validator edge cases, and evidence Git-read behavior |

The three broad groups partition the test inventory. New test files default to core. Fast tests overlap these groups intentionally; they are not another full suite.

Use `npm run verify:daily` for a broad routine check when the changed area needs more than the fast contracts. It covers representative production CLI, lifecycle, authority, recovery, rollback, High-Assurance, JSON-RPC, evidence, and optional Control Plane paths in one Node process. It is intentionally not an exhaustive matrix: changed test files still select their whole group, offline model/process experiments remain available through `npm run test:experiments`, and every test remains in the complete suite. A final behavioral candidate or Release still requires `npm run verify`.

Group commands use Node's compact dot reporter by default: successful cases occupy progress lines, while a failure still expands its test name, assertion diff, stack, and source location. Use `npm run test:full:verbose` only when per-test success names and durations are useful for investigation.

For conservative local selection against your branch base:

```bash
npm run test:changed -- --base origin/main --list
npm run verify:changed -- --base origin/main
```

Selection includes committed changes since the merge base, staged and unstaged changes, and untracked files. Prose-only changes select fast tests; changed test files select their entire group plus fast tests. Shared source, scripts, fixtures, package metadata, canonical state, deleted tests, unknown paths, or an unavailable base select the full suite. This is deliberately a local editing aid, not a dependency graph or a hosted CI selector. The `--list` form only previews selection and does not verify anything.

Prose-only changes require `npm run verify:fast` and appropriate rendered review. Changes to Agent instructions, Skills, executable examples, manifests, schemas, package contents, or behavioral contracts are not prose-only. This repository self-hosts native Workkeel; canonical task-state changes also require `WORKKEEL_CLI_PATH=./bin/workkeel.mjs node ./workkeelw.mjs doctor .`. Legacy compatibility is verified in isolated fixtures. Do not classify a mixed change by its smallest component.

Before proposing a behavioral change, run the complete suite:

```bash
npm run verify
```

Run it once on the final behavioral candidate, not after every intermediate edit. Further code, fixture, dependency, or contract changes invalidate that result. Later evidence/prose-only updates require their applicable checks and an explicit link to the tested code revision; they do not turn an untested code revision into a tested one. Release verification remains complete regardless of local selection.

Management Console changes also require the real-browser gate:

```bash
npm run test:browser
```

This command starts the repository-local Control Plane on loopback and opens four responsive layouts in an installed Google Chrome. It checks primary navigation, live rendering, browser errors, keyboard tabs, reduced-motion behavior, horizontal overflow, primary-text clipping, and named high-level layout regions. It does not download a browser or use the contributor's normal Chrome profile. A failure writes an actionable screenshot below `output/playwright/`.

For the task-first monitor, also run its focused browser gate:

```bash
node scripts/verify-workkeel-monitor.mjs
```

It uses synthetic task journals and installed Chrome at desktop/mobile sizes,
including unknown/partial data, changed snapshots, stale errors, read recovery,
access-link handling, keyboard controls and escaped task text. It makes no model
calls; its report distinguishes real journal states from injected UI projections.

## Continuous integration

Ordinary GitHub Actions is intentionally a short remote consistency check, not Workkeel's complete test environment. Every pull request and push to `main` runs one Node.js 24 job with an eight-minute ceiling. The job uses a clean checkout and performs:

- lockfile-strict dependency installation without lifecycle scripts;
- repository, documentation-link, and package-boundary checks;
- Native Workkeel Doctor, including retained-history and task-evidence validation;
- `npm run test:fast`.

The workflow reports every required result and fails if any required step fails. It uses immutable Action revisions, read-only repository permission, and cancels an older in-progress run when the same pull request receives a newer commit.

Ordinary PR/push CI does not run `npm run test:full` or `npm run test:browser`. The separate GitHub Release publishing workflow does run `npm run verify` against the Release source before publication. A green ordinary CI badge is only the remote repository gate: it does not prove the complete integration suite, browser behavior, independent review, or release readiness.

Complete evidence stays local and revision-specific:

- run `npm run verify` before proposing a behavioral candidate;
- run `npm run test:browser` for Management Console or other user-interface changes;
- record the exact tested revision and preserve the native task's independent review and authorized acceptance gates. Tests do not accept a task or authorize publication.

Legacy compatibility fixtures retain the original evaluation, Independent QA, and Release Gate rules for Position-based projects. They do not require native-task contributors to configure those Positions.

## Release and live validation

Workkeel requires Node.js 24 or later. Node.js 24 is the remote baseline and must pass exact-candidate local verification. A newer local Node.js version may provide an additional compatibility signal, but passing on that machine does not by itself qualify a separate runtime line.

Release candidates should also review the allowlisted package manifest, verify clean-source recovery, and pin every result to the exact candidate revision.

Live provider checks, multi-machine collaboration, external tracker writes, long-duration soak tests, and destructive recovery exercises are separate authorized validation activities. They are not silently triggered by a pull request and must retain their own bounded evidence records under [`docs/validation/`](../validation/README.md).

## Adding or changing tests

Prefer the smallest layer that proves the risk:

1. Pure validation or contract tests for deterministic rules.
2. In-process integration tests for module cooperation.
3. A small number of subprocess CLI tests for packaging, command boundaries, atomic writes, and rollback.
4. Semantic real-browser tests for human-interface layout, navigation, accessibility interaction, and runtime failures that a DOM-string contract cannot prove.
5. Explicit live validation only when a fixture cannot prove the behavior.

Do not remove a safety assertion merely to shorten CI. When subprocess setup dominates runtime, keep the assertion and move shared behavior to a faster harness while retaining representative end-to-end coverage.

Keep one real package-boundary check in `npm run check`; exercise invalid manifests in unit tests instead of repeating the same successful npm pack. Test cleanup by injecting startup/runtime failures, not by searching source code for a `finally` block. Avoid locking harmless copy or timeout values in tests; preserve real authority and resource boundaries.

For timing comparisons, use the same runtime, candidate, and command, and separate local from hosted results. Node test files run concurrently, so summed test durations are not wall-clock time. A reduced subprocess count is structural evidence; a single elapsed-time sample is diagnostic, not a promised speedup on every machine.
