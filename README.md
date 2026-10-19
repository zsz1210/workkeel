# Workkeel

A repository-native task coordination framework for coding agents.

Workkeel records approved task scope, handoffs and review evidence beside your
code, bound to Git commits. It works with instruction-following coding tools on
cloud or local models and is not tied to a particular provider or model.

English · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md)

[![CI](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml/badge.svg)](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml)
0.2.0-beta.0 unpublished source · Node.js 24.15+ · [MIT](LICENSE)

## What it does

- **Keep work resumable:** goals, boundaries, decisions and partial results stay
  in the repository when tools or conversations change.
- **Scale review to risk:** each task has a `low`, `standard`, `high` or `critical`
  tier. Project policy sets the minimum, and riskier changes raise it at handoff.
- **Review exact changes:** a different Agent reviews the exact delivered commit
  before an approver accepts it. Approval and evidence are tied to Git, not chat.
- **Stay out of the way:** the core is a CLI and files in your repository. No
  server, model call or global setting is required.
- **Observe existing records:** an optional local website shows tasks, documents,
  execution time and tokens without calling a model.

The coding tool you already use executes the work and enforces its own permissions.
Workkeel's records are not a sandbox, and a finished execution is not an accepted task.

## From request to accepted change

<picture>
  <source media="(max-width: 640px)" srcset="docs/assets/workkeel-workflow-mobile.svg">
  <img src="docs/assets/workkeel-workflow.svg" alt="Approve scope, execute, review the exact candidate, and accept; failed review returns to implementation.">
</picture>

For a bug fix, approve the goal and the files that may change, let a coding tool
investigate and implement, keep the test evidence, then have another Agent review
the candidate commit. A failed review returns the task for rework under the same
approved scope.

## Quick start

Requires Git, Node.js 24.15+ and a coding tool. Run the current source from a clone:

```sh
git clone https://github.com/zsz1210/workkeel.git
cd workkeel && npm ci --omit=optional --ignore-scripts
alias workkeel="node $PWD/bin/workkeel.mjs"
```

In your project, one owner with a `builder` and a `reviewer` Agent:

```sh
workkeel init . --solo
echo ".workkeel/" >> .gitignore && git add -A && git commit -m "Start Workkeel"
workkeel task new --goal "Clarify the guide" --acceptance "The guide names its audience" --write docs --actor builder
workkeel task claim --id WK-0001 --actor builder
# edit, commit, and save evidence under .ai-org/artifacts/WK-0001/
workkeel task handoff --id WK-0001 --actor builder --summary "Guide updated" --evidence .ai-org/artifacts/WK-0001/check.md
workkeel task review --id WK-0001 --actor reviewer --judgment pass --summary "Meets the criterion" --evidence .ai-org/artifacts/WK-0001/review.md
workkeel task close --id WK-0001 --actor builder --summary Accepted --rollback "Revert the guide commit" --evidence .ai-org/artifacts/WK-0001/review.md
```

`workkeel start .` previews setup without writing anything, and
`workkeel help advanced` lists every command. The
[quick start guide](docs/getting-started/workkeel.md) covers team policies,
request files and rollback.

## Risk tiers and teams

| Tier | Typical use | Before close |
| --- | --- | --- |
| `low` | Documentation and wording | Review by a different Agent; evidence optional |
| `standard` | Ordinary features and fixes | Handoff evidence and review by a different Agent |
| `high` | Authentication, migrations, sensitive data | Reviewer from another model family with its own review report; no open issues; the approving Principal closes |
| `critical` | Deployment, CI, production configuration | Everything in `high`, plus a rollback plan and a committed approval record |

A project with more than one Principal is a team: high-risk approval, review and
close then also require a different person from the implementer. Read
[team adoption and risk tiers](docs/operations/team-adoption-and-risk.md) before
rolling Workkeel out to a team.

## Published Beta.1

The npm package `@zsz1210/workkeel@0.1.0-beta.1` on the `next` channel is an
earlier line. It still contains the Temple compatibility mode removed from this
source and does not have the flag commands or the high and critical tiers above. Use it only to
evaluate that earlier release; see its [release notes](CHANGELOG.md#010-beta1).

## Optional components

| Component | Default | Boundary |
| --- | --- | --- |
| Task coordination | Core | Contracts, claims, handoffs, review and acceptance; no server |
| Coding tool and model | Your existing host | Workkeel changes no global model setting |
| Observer (`workkeel monitor`) | Off | Local and read-only; makes zero model calls |
| Workflow execution | Opt-in | Optional LangGraph dependencies and an approved graph and model policy |
| Native dispatch and model routing | Opt-in | Records the requested model and reason; the host reports what actually ran |
| Headroom tool-output views | Off | Lossy views only on request; originals stay readable |
| Learning and Skill versions | Optional records | Approval does not create or activate a Skill |
| Desktop workspace, whole goals, bounded autonomy | Experimental | Source CLI only; automatic work is limited to `low` and `standard` tasks |

[Observer](docs/operations/workkeel-observer.md) ·
[Workflows](docs/operations/workkeel-workflows.md) ·
[Native dispatch](docs/operations/workkeel-native-dispatch.md) ·
[Project context and Skills](docs/extensions/workkeel-context.md)

## Architecture

<picture>
  <source media="(max-width: 640px)" srcset="docs/assets/workkeel-architecture-mobile.svg">
  <img src="docs/assets/workkeel-architecture.svg" alt="Project task contracts feed coordination and optional workflow execution. The execution host uses tools and returns evidence. Review and acceptance remain separate.">
</picture>

Project files hold task authority and evidence. The coding host executes within its
own permissions. An optional runner manages workflow progress and approved model
choices; uncertain effects stop for reconciliation. The observer only reads.

[Architecture](docs/concepts/architecture.md) ·
[Task contract](docs/concepts/task-contract.md)

## Limits

- This is an experimental beta. Recovery from every interruption and installation
  on a fresh machine are not fully qualified.
- Principals and Agents are attributed names, not authenticated accounts. Workkeel
  cannot prove that two Principals are two people or which model actually ran.
- Local locks are not distributed coordination. Native host sessions have no usage
  data unless the host records it.
- Projects created with the earlier Temple mode keep using that CLI version; there
  is no migration path.

## Developing Workkeel

This repository holds framework source, public documentation, generic templates and
reproducible tests. Actual tasks, approvals, logs and review evidence for developing
Workkeel stay in a
[separate private workspace](docs/operations/framework-development.md), never in
this checkout, even where Git would ignore them. See
[ADR-0083](docs/adr/0083-public-source-private-state.md).

[Documentation](docs/README.md) · [Testing](docs/getting-started/testing.md) ·
[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) ·
[MIT](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
