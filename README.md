# Workkeel

Workkeel keeps a coding task's approved scope, ownership, handoff, review, and
acceptance in repository-local records. It coordinates coding agents while the
execution host supplies the model, tools, and access controls. Workkeel records
authority; it does not enforce a sandbox.

English · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md)

Experimental Beta.1 · Node.js 24+ · [MIT](LICENSE)

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

To inspect this source checkout, run `npm ci --omit=optional --ignore-scripts`
and `node bin/workkeel.mjs help`. Source may differ from the published Beta.1
package. The [testing guide](docs/getting-started/testing.md) explains checks
for contributors; passing tests in one checkout is not a release qualification.

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

A fresh clone of this source repository has framework code, examples, and tests,
but no maintainer task history. Initialize task state locally when developing
the framework. Keep actual tasks, approvals, execution logs, review evidence,
`.ai-org/`, and `workkeel.lock` out of public Git history; back up needed
private state separately. The [separation decision](docs/adr/0083-public-source-private-state.md)
and [contribution guide](CONTRIBUTING.md) explain this boundary.

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
