# Workkeel

A repository-native task coordination framework for coding agents.

Workkeel records approved task scope, execution, handoffs and review evidence beside
your code. It works with instruction-following coding tools using cloud or local
models. It is not tied to OpenAI, Codex or a particular model.

English · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md)

[![CI](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml/badge.svg)](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml)
Early Alpha · Node.js 24+ · [MIT](LICENSE)

## What it does

- **Keep work resumable:** preserve goals, boundaries, decisions and partial results
  when tools or conversations change.
- **Coordinate execution:** record ownership, dependencies, handoffs, bounded retries
  and recovery.
- **Use the right tools and models:** native hosts keep their own model settings;
  optional automatic workflows use an explicitly approved model policy.
- **Review exact changes:** bind evidence and a different Agent's review to a Git
  revision before accepting the task.
- **Observe existing records:** view tasks, documents, learning, Skills, execution
  time and Tokens in an optional local website without calling a model.

The execution host owns its tools and enforces permissions. Workkeel's records are
not a sandbox. An execution completing does not mean its output was accepted.

## From request to accepted change

<picture>
  <source media="(max-width: 640px)" srcset="docs/assets/workkeel-workflow-mobile.svg">
  <img src="docs/assets/workkeel-workflow.svg" alt="Approve scope, execute, review the exact candidate, and accept; failed review returns to implementation.">
</picture>

For a bug fix, approve the goal and allowed files, let a coding tool investigate and
implement, preserve test evidence, then have another Agent review the candidate.
The same model may perform several steps, or different models may handle different
steps. The task records remain in the project.

[Quick start](docs/getting-started/workkeel.md) ·
[Workflow execution](docs/operations/workkeel-workflows.md)

## Start from source

Requires Git, Node.js 24+ and an existing coding tool. This source is not yet a
published Workkeel npm release.

```sh
git clone https://github.com/zsz1210/workkeel.git
cd workkeel
npm ci --omit=optional --ignore-scripts
node bin/workkeel.mjs help
node bin/workkeel.mjs start /path/to/project
```

The final command only previews setup guidance and incomplete policy/brief drafts.
Follow the [quick start](docs/getting-started/workkeel.md) to initialize the project,
approve a task, claim work and record review. It does not start a model.

Task-first projects use WORKKEEL.md and the workkeel CLI. The optional
[AGENTS/CLAUDE bridge](docs/extensions/workkeel-context.md) preserves existing
instructions. This repository also uses the native five-stage workflow. The
workkeel-init/workkeel-work Skills cover native setup and delivery; TEMPLE.md and
temple-work remain historical compatibility material.

## Local observer

```sh
node bin/workkeel.mjs monitor /path/to/task-first-project
```

Open the complete local access URL printed by the command. The website includes:

- An attention-first Dashboard, a recent-work board and paginated task history.
- Tool-time/token bars and daily/weekly trends with shared filters; task scatter
  pairs full-turn duration and tokens from the same recorded operations.
- Cached input, uncached input and output subtotals with per-field coverage.
- Project Skills with origin labels and content search; learning milestones.
- Read-only settings with contextual popovers, task drawers and full detail pages.
- Recorded execution intervals, connection/source health and illustrated workflow guidance.
- Traditional Chinese and English, selectable in Settings.

**The observer makes zero model calls.** Local code reads and aggregates existing
records; charts, filtering and updates do not consume model tokens. Task execution
may consume tokens separately. Unknown and partial values stay visible; costs are
not estimated. A local index watches source changes; the visible page checks its
revision and connection health, then fetches changed data. Hidden pages pause. Ctrl-C stops
the foreground service; no daemon or external chart service is installed.

Background updates preserve open explanations, task tabs, keyboard focus and reading
position. A changed document offers a reload action while retaining the text being read.

Coverage counts only collected operations in the selected range. Even 100% field
coverage does not prove that every agent or earlier task operation was captured.
Full-turn duration includes tools and possible waits; it is separate from recorded
active intervals and is not model compute time or an efficiency ranking.

[Observer guide and data limits](docs/operations/workkeel-observer.md)

## Defaults, options and support

### Reuse a lesson

Native [Learning records](docs/extensions/workkeel-learning.md) keep the source,
validation, and later task use together. `workkeel learning search` finds current
guidance using explicit multilingual aliases; `learning impact` traces affected
lessons, practices and linked Skills after a source changes. Found, read, applied
and verified outcomes are separate records. The observer displays them read-only.
Proposal readiness does not create a Skill or establish time/token savings.

| Capability | Default | Current boundary |
| --- | --- | --- |
| Task coordination | Core | Task contracts, claims, handoffs, review and acceptance; no server required |
| Coding tool and model | Existing host | Instruction-following hosts, including those using local models; no global model changes |
| Automatic workflow | Opt-in | Optional LangGraph dependencies and an approved graph; automatic execution needs an actual adapter |
| Model routing | Opt-in | Pinned project policy, explicit native dispatch tickets or approved workflow rules; local classifier advice makes no model call |
| Built-in automatic adapter | Optional / experimental | Codex app-server; its subscription profile requires macOS and Codex ≥ 0.155.0-alpha.9.2 |
| Gateway connection | Optional | Fixed approved OpenAI-compatible/LiteLLM connection through a supporting runtime; live qualification is separate |
| Headroom | Off | Optional lossless views through host integration; no universal tool-output interception |
| Observer | Optional | Local, read-only, no model calls; observes recorded task-first data |
| Learning and Skills | Optional records | Lessons, practices and bounded authoring proposals; approval does not create or activate a Skill |

For automatic execution, the [runtime guide](docs/operations/workkeel-workflows.md)
describes optional dependencies and the implemented adapter. Supporting native
coordination with a tool does not imply a built-in automatic adapter or automatic
usage collection for that tool. The framework imposes no universal provider or model.

[Native dispatch](docs/operations/workkeel-native-dispatch.md) connects a local
classifier to the host you already use. It records the requested model, reason,
execution identity and bounded parallel work before execution; the host returns
actual model and usage metadata. The existing personal LiteLLM heuristic can plug
into this path without a Proxy or a new model call. Other classifiers and local
model runners use the same policy and reporting interfaces.

## Architecture

<picture>
  <source media="(max-width: 640px)" srcset="docs/assets/workkeel-architecture-mobile.svg">
  <img src="docs/assets/workkeel-architecture.svg" alt="Project task contracts feed coordination and optional workflow execution. The execution host uses tools and returns evidence. Review and acceptance remain separate.">
</picture>

Project files hold task authority and evidence. An optional runner manages graph
progress and approved model selections. The coding host executes within enforced
permissions. Checkpoints and a dispatch journal support recovery; uncertain effects
stop for reconciliation. The observer reads these records without executing work.

[Architecture](docs/concepts/architecture.md) ·
[Measurements](docs/operations/workkeel-measurements.md) ·
[Scoped continuation](docs/operations/workkeel-material-and-continuation.md) ·
[Skill selection and evidence](docs/extensions/workkeel-context.md)

## Evidence and limits

The framework is Alpha. Local locks are not distributed coordination, attributed
identities are not provider-authenticated identities, and native host sessions have
no automatic usage data unless their host records it. Skill selection does not prove
application quality. Learning milestones do not imply automatic Skill promotion.

Provider experiments qualify only their recorded conditions. Historical Codex
compatibility and Luna/Sol results are examples, not framework defaults or proof
about other models, tools, subscription savings or future versions.
[Recorded experiments](docs/validation/workkeel-automation.md) ·
[Personal routing experiment](docs/validation/workkeel-development-routing.md)

[Documentation](docs/README.md) · [Testing](docs/getting-started/testing.md) ·
[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) ·
[Compatibility and migration](docs/getting-started/workkeel.md#legacy-history-and-migration)

[MIT](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
