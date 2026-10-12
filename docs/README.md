# Workkeel documentation

Start with the [native quick start](getting-started/workkeel.md) for a new
project. Workkeel stores approved task contracts and review evidence in local
project state. The public source repository contains framework code and tests,
not actual maintainer task history. Framework development uses a separate private
workspace outside the public checkout; do not initialize maintainer task state in
the public checkout. This differs from installing Workkeel in a user's own project.

| Goal | Guide |
| --- | --- |
| Learn the task lifecycle | [Task contract](concepts/task-contract.md), [daily work](operations/workkeel-daily-work.md) |
| Develop and test the framework | [Private development workspace](operations/framework-development.md), [testing](getting-started/testing.md), [contributing](../CONTRIBUTING.md) |
| Inspect recorded work | [Local observer](operations/workkeel-observer.md) |
| Use optional automation | [Workflow execution](operations/workkeel-workflows.md), [native dispatch](operations/workkeel-native-dispatch.md) |
| Understand architecture and limits | [Architecture](concepts/architecture.md), [ADR index](adr/README.md), [security](../SECURITY.md) |
| Keep source and task state separate | [Publication boundary](operations/publication-boundary.md), [public source decision](adr/0083-public-source-private-state.md) |
| Maintain the public GitHub repository | [Repository settings](operations/repository-settings.md), [security reporting](../SECURITY.md) |
| Maintain an existing Temple project | [Compatibility and migration](getting-started/migration-from-temple.md) |

Native Workkeel is the default for new projects. The retained Temple guides,
Position-based lifecycle, and older ADRs document compatibility behavior and
historical design choices. They do not set the operating contract for this
source checkout. Follow the pinned instructions in each existing project.

The [ADR index](adr/README.md) preserves architectural rationale. Public
product tests can be reproduced from this repository; prior private task
reports and measurements are outside it. A test result applies only to its
candidate, environment, and command.
