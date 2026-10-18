# Workkeel documentation

Start with the [quick start](getting-started/workkeel.md). Workkeel keeps approved
tasks, execution and review evidence together in your repository. For framework
development, keep actual task state and evidence
in a [separate private workspace](operations/framework-development.md), outside
this public source checkout even when Git would ignore those files. Installing
Workkeel in your own project is a separate use case.

## Current Workkeel guides

| Goal | Read |
| --- | --- |
| Understand the framework and its concepts | [README](../README.md), [terminology](concepts/terminology.md), [architecture](concepts/architecture.md) |
| Install the published Beta.1 and check its limits | [Installation](../README.md#install-beta1), [release notes](../CHANGELOG.md#010-beta1) |
| Initialize, claim, hand off and accept a task | [Quick start](getting-started/workkeel.md), [task contract](concepts/task-contract.md) |
| Prepare a daily brief, resume a handoff and observe delivery | [Daily work](operations/workkeel-daily-work.md) |
| Validate, find and reuse lessons; inspect source changes | [Native Learning](extensions/workkeel-learning.md) |
| Compare, activate and revalidate a project Skill version | [Versioned Skill learning](extensions/workkeel-skill-lifecycle.md) |
| Observe tasks, read their documents, and compare recorded time and tokens | [Local observer workspace](operations/workkeel-observer.md) |
| Manage several projects and repositories from the desktop | [Desktop workspace and controlled settings](operations/workkeel-workspace.md) |
| Check agreed requirements and visual evidence before declaring completion | [Completion evidence](operations/completion-evidence.md) |
| Deliver all mandatory repositories with distinct review and bounded repair | [Whole-goal coordination](operations/workkeel-goals.md), [opt-in improvement](operations/workkeel-autonomy.md) |
| Explore optional workflow adapters and model routing | [Workflow and routing guide](operations/workkeel-workflows.md), [native dispatch](operations/workkeel-native-dispatch.md) |
| Connect Codex/Claude instructions, check Skill use, plan Headroom | [Project context](extensions/workkeel-context.md) |
| Inspect measurements and qualification limits | [Measurement definitions](operations/workkeel-measurements.md), [testing policy](getting-started/testing.md) |
| Review dependencies and licenses | [Third-party notices](../THIRD_PARTY_NOTICES.md), [execution ADR](adr/0073-opt-in-workflow-execution.md) |
| Develop and test the framework | [Private development workspace](operations/framework-development.md), [testing](getting-started/testing.md), [contributing](../CONTRIBUTING.md) |
| Keep source and task state separate | [Publication boundary](operations/publication-boundary.md), [public source decision](adr/0083-public-source-private-state.md) |
| Maintain the public GitHub repository | [Repository settings](operations/repository-settings.md), [security reporting](../SECURITY.md) |

## Decision records

[Architecture decision records](adr/README.md) keep their original wording and
revision-specific claims. They do not qualify new behavior or govern this source
checkout. Actual validation, planning, research and pilot records remain private.
