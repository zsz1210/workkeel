# Workkeel

A framework for coordinating coding-agent tasks through repository files.

Keep approved scope, handoffs and review evidence beside your code, tied to Git commits.
Use your existing coding tool; the core needs only repository files and a CLI.

English · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md)

[![CI](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml/badge.svg)](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml)

[npm](https://www.npmjs.com/package/@zsz1210/workkeel) 1.0.2 · Node.js 24.15+ · [MIT](LICENSE)

The [1.0 compatibility guarantees](docs/concepts/compatibility.md) list what is stable, best effort or experimental.

## Why Workkeel

- **Resume across tools:** keep task scope, decisions and partial results when a conversation ends or you switch coding tools.
- **Review the exact change:** a different Agent checks the delivered commit before an approver accepts it.
- **Match review to risk:** agree on a risk tier before starting; policy and changed files can raise it. Limit the number of reworks.
- **Keep the core small:** run task coordination without a server, model call or global model setting.

## Why not

Workkeel is not a sandbox or an agent runtime, and it does not deploy your work.
Your coding tool enforces permissions and executes changes. Compared with a tracker,
Workkeel binds task authority and evidence to commits; compared with an agent framework,
it leaves the coding loop to your tool.

## How a task flows

<picture>
  <source media="(max-width: 640px)" srcset="docs/assets/workkeel-workflow-mobile.svg">
  <img src="docs/assets/workkeel-workflow.svg" alt="Agree scope and risk, build with your coding tool, review the exact commit with a different Agent, accept, then done. A failed review stays in test until the approver runs task rework to return it to intake under the same contract; low allows 2 reworks, others 3, then stop and ask a person.">
</picture>

Agree scope, permissions, acceptance criteria and risk tier, then claim the task,
build with your coding tool and hand off a commit for another Agent to review.
After a failed review, the task stays in `test` until the approver runs `task rework`.
This preserves the failed attempt and returns the task to `intake` under the same
contract. The builder claims it again and delivers a new commit. Stop and ask a
person after two reworks for `low` or three for other tiers. After a passing review,
a registered Agent whose Principal accepts the work closes the exact candidate.
That Principal must be a registered approver; for `high` and `critical`, the Agent
must belong to the task's approving Principal, after review by a different model
family and the required cross-review.

## 30-second demo

Install the CLI below, then run the demo in a Git project with a baseline commit.
The output includes selected JSON fields. `init` registers `builder` and `reviewer`
under one `owner`. Their model families default to `claude` and `codex`; override
them with `--builder <family>` and `--reviewer <family>`.
The owner approves the task and acceptance, and the two Agents do their own work.

```text
$ workkeel init .
{"initialized":true,"mode":"task-first"}
# Ignore .workkeel/ and commit the generated setup files before claiming work.
$ workkeel task new --goal "Clarify the guide" --acceptance "The guide names its audience" --write docs --risk low --actor builder
{"id":"WK-0001","state":"intake"}
$ workkeel task claim --id WK-0001 --actor builder
{"id":"WK-0001","state":"build"}
# builder edits the guide, checks it and commits the change.
$ workkeel task handoff --id WK-0001 --actor builder --summary "Guide updated"
{"id":"WK-0001","state":"test"}
# reviewer checks the exact delivered commit against the criterion.
$ workkeel task review --id WK-0001 --actor reviewer --judgment pass --summary "Meets the criterion"
{"id":"WK-0001","state":"release_gate"}
# owner accepts; builder is a registered Agent under that approving Principal.
$ workkeel task close --id WK-0001 --actor builder --summary "Owner accepts" --rollback "Revert the guide commit"
{"id":"WK-0001","state":"done","external_release":"not-performed"}
```

This `low` example needs no evidence files; other tiers add requirements below.
The CLI records the lifecycle; your Agents do the editing and review, not the CLI.
Commit the `.ai-org/` task records too, with your work or after closing the task.

## Quick start

You need Git, Node.js 24.15+ and a coding tool. Install the current source:

```sh
git clone https://github.com/zsz1210/workkeel.git
cd workkeel
npm ci --omit=optional --ignore-scripts
alias workkeel="node $PWD/bin/workkeel.mjs"
```

Or install from npm with `npm install -g @zsz1210/workkeel` to use the `workkeel` command.
The npm `latest` dist-tag is `1.0.2`; `next` still points to the old
`0.1.0-beta.1`. Install `@zsz1210/workkeel` or `@zsz1210/workkeel@latest`,
rather than `@next`, for the current release.

Shell aliases only work in the interactive shell where they are defined. An alias
for `workkeel` will not work in non-interactive shells such as agent tool calls or
CI. Use `node workkeelw.mjs` after initialization, or `npx --no-install workkeel`
with a local installation.

Your repository needs a baseline commit before task work starts. In a new
repository, review the files to include, then run `git add -A && git commit -m baseline`.

Switch to your own project's Git repository and run `workkeel start .` for a
read-only setup preview. After `init`, run `workkeel start .` again for the optional
[instructions bridge](docs/extensions/workkeel-context.md#connect-native-instructions) suggestion.
Follow the [quick start guide](docs/getting-started/workkeel.md)
for initialization, policies, evidence and rollback. To develop Workkeel itself,
follow [Contributing](CONTRIBUTING.md).

### How the project launcher finds the CLI

`node workkeelw.mjs` reads the pin in `workkeel.lock` and tries these sources in order:

1. `WORKKEEL_CLI_PATH`, pointing to a compatible source `bin/workkeel.mjs`.
2. The local `node_modules/@zsz1210/workkeel/bin/workkeel.mjs` installation
   (`npm i -D @zsz1210/workkeel`).
3. A global `workkeel` on `PATH` (`npm i -g @zsz1210/workkeel`). The launcher
   resolves symlinks and accepts only `bin/workkeel.mjs` in a package named
   `@zsz1210/workkeel`. This fallback is skipped on Windows.
4. An explicit fetch of the pinned package version, only when
   `WORKKEEL_ALLOW_PACKAGE_FETCH=1` is set and no installed source was found.

The CLI checks version compatibility with the pin. No download is attempted by
default. Existing projects retain their launcher until an explicit `workkeel upgrade`.

## Risk tiers

| Tier | Typical use | Before close | Rework cap |
| --- | --- | --- | --- |
| `low` | Documentation and wording | Different Agent review; evidence files optional | 2 |
| `standard` | Ordinary features and fixes | Handoff evidence and different Agent review | 3 |
| `high` | Authentication, migrations, sensitive data | Different model family, reviewer's own report and cross-review; no open issues; approving Principal closes | 3 |
| `critical` | Deployment, CI, production configuration | Everything in `high`, plus handoff rollback plan and committed approval record | 3 |

At the cap, stop and ask a person to re-scope, approve a new task or cancel.
The [QA procedure](docs/operations/workkeel-review-assessment.md#independent-qa-and-release-gate)
defines Must fix (blocks) and Consider / Note / Dismiss (recorded), and requires
independent Codex/Claude cross-review for `high` and `critical`; the CLI checks
registered model families, but that check does not prove cross-review happened.

## Optional extras

- **[Workspace observatory](docs/operations/workkeel-workspace.md):** start with `workkeel workspace serve`; browse project records without idle model calls. The separate [read-only observer](docs/operations/workkeel-observer.md) uses `workkeel monitor`.
- **[Workflows / LangGraph](docs/operations/workkeel-workflows.md):** opt into a runner with approved graphs, model policy and recoverable steps. EXPERIMENTAL: outside the [1.0 compatibility guarantees](docs/concepts/compatibility.md); we may change or remove this runner in a minor release.
- **[Workkeel Loop L1 report](docs/operations/loop-trial.md):** `workkeel stats --report --cutoff 2026-10-19T00:00:00Z --timezone UTC` produces a weekly read-only report with zero model/API spend.
- **[Native dispatch](docs/operations/workkeel-native-dispatch.md):** record execution handoffs and requested models; the host reports what ran.
- **[Reference Bot-layer usage](docs/operations/reference-usage-bot-layer.md):** one way to coordinate project Bots, Claude Code and Codex through human gates, outside the core.

Find these and other optional parts in the [documentation index](docs/README.md).

## Limits

- Recovery from every interruption and fresh-machine installation are not fully qualified.
- Principals and Agents are attributed names, not authenticated accounts. Workkeel cannot prove two Principals are two people or which model ran.
- Local locks do not coordinate multiple machines. Native host usage data exists only when the host records it.

## Docs and contributing

[Documentation](docs/README.md) · [Architecture](docs/concepts/architecture.md) · [Testing](docs/getting-started/testing.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [MIT](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
