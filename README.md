# Workkeel

A repository-native task coordination framework for coding agents.

Keep the work moving when the conversation, agent or model changes.

English · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md)

[![CI](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml/badge.svg)](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml)
Early Alpha · Node.js 24+ · [MIT](LICENSE)

## Coordinate the work, not an imaginary company

Coding agents can already plan, implement and test. What a new conversation often
loses is the agreement around that work: what was approved, who is doing it, which
files and tools are allowed, what was handed over, and which exact result passed
review.

Workkeel keeps that agreement beside the code. Its task-first mode needs no CEO,
PM or engineer titles, and no catalogue of generic skills to tell an AI that it
can code. You use your existing coding agent; Workkeel records scope, identities,
operation boundaries, dependencies, evidence and acceptance.

It is not an application framework, a model, a new agent execution engine or an
autonomous manager. Your repository's architecture, tools and human authority stay
yours. An AI-company configuration remains a legacy option, not the new core.

## One task, from approval to verified handoff

1. Approve the goal, scope, acceptance criteria and actual working conditions.
2. Let the assigned Agent claim the task and work in the existing coding runtime.
3. Hand off an exact Git revision with evidence and no unresolved work.
4. Have a different registered Agent review it; reject and rework when necessary.
5. Accept the reviewed candidate explicitly. Acceptance does not publish or deploy.

The approved contract stays immutable. Progress, claims, failed attempts and review
results are recorded separately. Version checks prevent stale updates; evidence
digests expose changed reports. A directory called “artifacts” is not a loophole
for unreviewed code. The host remains responsible for actual tool/network sandbox
enforcement—metadata validation never grants permission.

## Start from the development source

This Workkeel redesign is **unreleased source**, not the previously published
Temple Alpha.33 package. A renamed repository or package manifest does not publish
an npm version. Requirements: Git, Node.js 24+, and an existing Git project.

```sh
git clone https://github.com/zsz1210/workkeel.git
cd workkeel
npm ci --ignore-scripts
node bin/workkeel.mjs help
```

Open this source in your coding agent and ask:

> Read the task-first guide and my project's native instructions. Help me confirm
> the Agent/Principal identities, approval policy, working directory, allowed
> files/tools, and data-handling conditions. Show the setup for confirmation, then
> initialize Workkeel without company titles. Keep existing project files intact.

Follow the [task-first quick start](docs/getting-started/workkeel.md) for the small
policy, complete task example and claim/handoff/review commands. Each project gets
its own pinned `workkeelw.mjs`; the guide explains the version-checked source
override until a package is released. No global install or model gateway is needed.

## Keep four different concerns separate

- **Task and authority:** the approved outcome, Agent/Principal identities, scope,
  permitted operations and review separation.
- **Environment and runtime:** working directory, readable/writable roots, tools,
  resources, network and data policy. The host coding agent performs execution.
- **Project methods:** optional Skills for project-specific knowledge or procedures,
  not a mandatory inventory of general model abilities.
- **Model connection:** native host settings by default; an optional fixed gateway
  connection is separate from runtime tools and lifecycle acceptance.

The optional LiteLLM/Codex configuration path currently produces a **read-only
runtime plan**. It does not launch a model, modify global settings or read keys.
Actual gateway/tool interaction and automatic task-first dispatch are not yet
qualified or enabled. Automatic model routing and a new Graph engine are not part
of this release scope.

## Existing Temple projects keep their history

Workkeel is the new name of Temple.
The `temple` CLI alias, `templew.mjs`, `temple.lock`, `temple.*` schema IDs and
historical evidence remain compatible. Do not globally rename canonical records.

Existing projects keep their original Position-based workflow until explicitly
migrated. A fingerprinted migration is available only for quiescent, ordinary Solo
projects with compatible default policies. Active, customized, team, high-risk and
sensitive-data workflows retain the [legacy guides](docs/getting-started/usage.md).
Legacy Console, routing and assurance documents describe that mode, not mandatory
task-first setup. [Migration details](docs/getting-started/workkeel.md#legacy-history-and-migration).

## Maturity and development

Early Alpha, intended for supervised local work. Task-first lifecycle and rejection
paths have offline tests; that is not proof of production readiness, authenticated
multi-human operation, distributed locking, live gateway support, or universal time
and token savings. A distinct Agent under one owner is not an independent human.

For development, use the [testing guide](docs/getting-started/testing.md): focused
checks while editing and full verification for the final behavioral candidate.
Initializing a product project does not require rerunning the framework's full
suite. Existing test scripts and failure evidence are preserved.

[Documentation](docs/README.md) · [Task contract](docs/concepts/task-contract.md) ·
[Design decision](docs/adr/0072-task-first-lifecycle.md) · [Changelog](CHANGELOG.md) ·
[Contributing](CONTRIBUTING.md) · [Governance](GOVERNANCE.md) ·
[Code of Conduct](CODE_OF_CONDUCT.md) · [Security](SECURITY.md)

[MIT](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md) for optional
integration provenance and adoption limits.
