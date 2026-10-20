# Architecture

## Core and optional parts

The core is repository files for task contracts, evidence and policy, plus the
CLI that records claims, handoffs, review and acceptance. Your existing coding
tool executes the work and enforces its permissions. Core task coordination needs
no server, workflow runner or model call.

![Workkeel core: repository files and CLI, beside your coding tool. Dashed optional boxes: workspace observatory, workflow runner/LangGraph, Workkeel Loop L1 report, native dispatch and read-only observer.](../assets/workkeel-core-optional.svg)

The dashed boxes are optional additions. The workspace observatory starts with
`workkeel workspace serve`; the separate read-only observer uses
`workkeel monitor`. Opt-in workflows add a LangGraph runner and approved model
policy, while native dispatch records execution handoffs. The
[Workkeel Loop L1 report](../operations/loop-trial.md) provides a weekly read-only
view through `workkeel stats --report --cutoff 2026-10-19T00:00:00Z --timezone UTC` with no model/API spend.

## Workkeel execution and authority boundaries

Native Workkeel coordinates approved tasks in the repository. A
`workkeel.lock` pins the CLI and explicit Agent/Principal approval policy. Each
`.ai-org/work-items/` record keeps an immutable contract, current claim, exact
candidate, evidence digests, review, closeout and failed-attempt history.

Framework development uses native Workkeel in a
[separate private workspace](../operations/framework-development.md). Contributors
follow this source checkout's [AGENTS.md](../../AGENTS.md) and the private
workspace's generated `WORKKEEL.md`. Actual maintainer task state and evidence
must remain outside the public checkout, including Git-ignored files.
Use the [native quickstart](../getting-started/workkeel.md) for new projects and
the [daily-work guide](../operations/workkeel-daily-work.md) for task operations.

The host coding agent executes the work and enforces actual tool, filesystem,
network and data controls. Optional project Skills supply specific procedures;
they are not authority or a mandatory generic model-capability catalog. Model
transport is separate. Native coordination uses the existing coding agent; opt-in
workflows use LangGraph to orchestrate a registered runtime, not replace the
runtime's internal coding loop. The concrete Codex host uses the existing ChatGPT
subscription and explicitly selected models. See the
[workflow guide](../operations/workkeel-workflows.md) and
[execution ADR](../adr/0073-opt-in-workflow-execution.md).

The optional native [desktop workspace](../operations/workkeel-workspace.md)
observatory starts only with `workkeel workspace serve`; core task and goal
delivery does not depend on it. It observes registered projects without relocating
their task authority. Its controlled settings feed exact approved pins into new
dispatches. A bounded continuation
runner resumes eligible approved work; improvement discovery creates evidenced
proposals rather than new permission. Versioned Skill reuse stays project-local.

```mermaid
flowchart LR
  UI[Optional desktop workspace] -->|observe| A[Project A task records]
  UI -->|observe| B[Project B task records]
  UI -->|authorized intent| C[Version and authority checks]
  C --> J[Durable approved jobs]
  J --> P[Pinned model and workflow policy]
  P --> H[Enforcing runtime host]
  H --> E[Exact result and usage evidence]
  E --> R[Different Agent review]
  R --> T[Authorized task acceptance]
  E --> L[Scoped learning comparison and review]
  L --> S[Approved project Skill version]
  S -->|bounded relevant retrieval| P
```

These are source capabilities. The workspace makes no idle inference calls,
dispatch completion does not accept a task, and a Skill cannot grant authority.
See [ADR-0085](../adr/0085-native-workspace-bounded-autonomy-and-skill-learning.md).

| Boundary | Authoritative source | Enforcement |
| --- | --- | --- |
| Task approval and acceptance | Immutable task contract; canonical task operations | Claim, scope, dependency, evidence and distinct-review guards |
| Workflow progress | Pinned workflow/policy; local SQLite checkpoints and intent/result journal | One run per claim, bounded dispatch, integrity checks and explicit uncertain-state reconciliation |
| Model selection | Approved node/rule/default policy; runtime catalog | Connection pinning, reported-model continuity and refusal of silent rerouting |
| Files, tools and networking | Actual qualified coding host | Codex permission profiles and disabled unsupported tools; unsupported constraints stop launch |
| Project context | Native instructions and selected Skill sources | Bounded selection, full reading and separate output review; prompts are not a sandbox |

Recovery state is local and excluded from Git. It can include task outputs; retain
it securely. A completed runtime operation is not a task review. A digest detects
changed records, not malicious host behavior or authenticated human intent.
Checkpoints do not establish exactly-once effects across external services.
