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
| Check what the published Beta.1 contains | [Published Beta.1 release notes](../CHANGELOG.md#010-beta1) |
| Initialize, claim, hand off and accept a task | [Quick start](getting-started/workkeel.md), [task contract](concepts/task-contract.md) |
| Choose risk tiers, review requirements and a custom policy | [Adoption and risk tiers](operations/team-adoption-and-risk.md) |
| Prepare a daily brief, preserve approved requirements and resume a handoff | [Daily work](operations/workkeel-daily-work.md) |
| Check agreed requirements and visual evidence before declaring completion | [Completion evidence](operations/workkeel-evidence.md) |
| Focus an independent review or recover an interrupted one | [Review assessment and recovery](operations/workkeel-review-assessment.md) |
| Connect Codex/Claude instructions, check Skill use, plan Headroom | [Project context](extensions/workkeel-context.md) |
| Inspect measurements and qualification limits | [Measurement definitions](operations/workkeel-observer.md#task-execution-measurements), [testing policy](getting-started/testing.md) |
| Review dependencies and licenses | [Third-party notices](../THIRD_PARTY_NOTICES.md), [execution ADR](adr/0073-opt-in-workflow-execution.md) |
| Develop and test the framework | [Private development workspace](operations/framework-development.md), [testing](getting-started/testing.md), [contributing](../CONTRIBUTING.md) |
| Keep source and task state separate | [Publication boundary](operations/publication-boundary.md), [public source decision](adr/0083-public-source-private-state.md), [foundations](adr/0091-foundations.md) |
| Publish an npm release | [npm release operations](operations/npm-release.md) |
| Maintain the public GitHub repository | [Repository settings](operations/publication-boundary.md#public-repository-settings), [security reporting](../SECURITY.md) |

## Optional subsystems

These subsystems are listed only by `workkeel help advanced`. The core lifecycle
never needs them, and each one stays off until you use it. They are kept and tested,
but may be removed in a later release if nobody uses them.

| Goal | Read |
| --- | --- |
| Validate, find and reuse lessons; inspect source changes | [Native Learning](extensions/workkeel-learning.md) |
| Compare, activate and revalidate a project Skill version | [Versioned Skill learning](extensions/workkeel-skill-lifecycle.md) |
| Observe tasks, read their documents, and compare recorded time and tokens | [Local observer workspace](operations/workkeel-observer.md) |
| Manage several projects and repositories from the desktop | [Desktop workspace and controlled settings](operations/workkeel-workspace.md) |
| Deliver all mandatory repositories with distinct review and bounded repair | [Whole-goal coordination](operations/workkeel-goals.md), [opt-in improvement](operations/workkeel-autonomy.md) |
| Explore optional workflow adapters and model routing | [Workflow and routing guide](operations/workkeel-workflows.md) (LangGraph runner is EXPERIMENTAL: outside the 1.0 compatibility guarantees; we may change or remove it in a minor release), [native dispatch](operations/workkeel-native-dispatch.md) |

## Decision records

[Architecture decision records](adr/README.md) keep their original wording and
revision-specific claims; they do not qualify new behavior. Start with
[ADR-0091](adr/0091-foundations.md), which carries forward the principles of the
removed Temple-era records ADR-0001 to ADR-0070. Actual validation, planning,
research and pilot records remain private.
