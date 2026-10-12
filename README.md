# Workkeel

[![CI](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml/badge.svg)](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml)

Workkeel keeps a coding task's approved scope, ownership, handoff, review, and
acceptance in repository-local records. It coordinates coding agents while the
execution host supplies the model, tools, and access controls. Workkeel records
authority; it does not enforce a sandbox.

English · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md)

Experimental Beta.1 · Node.js 24+ · [MIT](LICENSE)

[Quick start](docs/getting-started/workkeel.md) · [Documentation](docs/README.md) ·
[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## Start

Install the published prerelease in a project that uses a coding tool:

```sh
npm install --save-dev --save-exact --ignore-scripts @zsz1210/workkeel@0.1.0-beta.1
npx --no-install workkeel --version
npx --no-install workkeel start .
```

`start` previews setup and task-intake guidance. It does not initialize the
project, run a model, or approve work. Follow the
[native quick start](docs/getting-started/workkeel.md) to review a local policy,
initialize task state, and create a task from an approved brief.

To inspect the framework source without creating task state:

```sh
git clone https://github.com/zsz1210/workkeel.git
cd workkeel
npm ci --omit=optional --ignore-scripts
node bin/workkeel.mjs help
```

Source may differ from the published Beta.1 package. The CI badge represents
the bounded repository gate; see the [testing guide](docs/getting-started/testing.md)
for complete candidate and release checks. To change the framework, first set up
the [separate private development workspace](docs/operations/framework-development.md).

## A task's path

1. A human approves the goal, paths, environment, data handling, and acceptance
   criteria.
2. An agent claims the task and records work and evidence against a Git candidate.
3. A different registered Agent reviews that exact candidate.
4. An authorized Principal accepts or returns it for rework.

The same workflow works across coding hosts and model providers. Optional
[workflow execution](docs/operations/workkeel-workflows.md) and
[native dispatch](docs/operations/workkeel-native-dispatch.md) add approved
routing and recovery; neither is required for the task lifecycle. The optional
[local observer](docs/operations/workkeel-observer.md) reads recorded state
without making model calls. Host-reported usage may be incomplete.

## Repository and project boundaries

This repository contains **only the framework**, including its public documentation,
generic templates, synthetic examples and reproducible tests. Actual development
tasks, plans, approvals, conversations, measurements, execution logs and review
evidence belong in a **separate private workspace outside the public checkout**.
Do not initialize maintainer task state here, even under Git-ignored paths.

Public issues and pull requests describe product problems and source changes with
synthetic reproductions; they are not a mirror of the private task ledger. Private
records must not enter public commits, branches, tags, attachments or releases.
The [development guide](docs/operations/framework-development.md),
[publication boundary](docs/operations/publication-boundary.md) and
[separation decision](docs/adr/0083-public-source-private-state.md) explain the workflow.

Native Workkeel is the default for new projects. Existing Temple projects can
keep their pinned legacy lifecycle. Read the
[compatibility and migration guide](docs/getting-started/migration-from-temple.md)
before changing one. Compatibility code and fixtures are retained; their
Position-based instructions do not govern this source checkout.

Workkeel is experimental. Local locks are not distributed coordination,
attributed identities are not authentication, and recorded completion is not
acceptance or publication. Review the [architecture](docs/concepts/architecture.md),
[documentation index](docs/README.md), [security policy](SECURITY.md), and
[third-party notices](THIRD_PARTY_NOTICES.md).
