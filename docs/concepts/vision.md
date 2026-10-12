# Vision and operating model

## Workkeel direction

Workkeel is a repository-native task coordination framework for coding agents.
It preserves the approved goal, scope, Agent/Principal identities, working and
data conditions, dependencies, handoff and exact-candidate acceptance across
conversations. Company titles and generic AI skill inventories are not prerequisites.
Use specific project Skills when they add needed knowledge or procedure.

Execution stays with the existing host agent. Runtime tools, scoped permission
and optional fixed-model connections are different concerns. Native settings are
the default; LiteLLM configuration is currently a read-only plan, not a validated
live connection or automatic dispatcher. A new Graph engine, per-request routing
and large framework comparisons are deferred.

The [task-first guide](../getting-started/workkeel.md) describes implemented source
behavior and limits. The remainder preserves the **legacy Temple operating model**;
its ten Positions and seven layers are not requirements for new task-first projects.
Historical qualification does not transfer automatically to this redesign.

## Legacy operating model

Temple is a repository-native, extensible framework for turning product intent into trustworthy software through role-based AI collaboration, composable engineering methods, durable project state, and evidence-gated delivery.

It does not try to make every AI conversation remember everything. It gives every Position a shared operating model and a recoverable source of truth, so work can continue across tasks, Agents, and time without reconstructing the development organization.

## The seven framework layers

| Layer | Question it answers | Primary mechanisms |
|---|---|---|
| Product intent and domain | What problem, language, boundary, and outcome are real? | Decision interview, domain modeling, revisioned specification authority, glossary, ADRs |
| Organization and authority | Who is responsible, and who may approve what? | Positions, Agent Identities, Assignments, human approval boundaries |
| Engineering methods and capabilities | How should this kind of work be performed? | Core Skills, official packs, project and third-party extensions |
| Execution adaptation | What capabilities does this step need, which profiles remain eligible, and what resources were observed? | Task Shape, Capability Route, Execution Profiles, deterministic route resolution, resource observations, model calibration |
| Work orchestration | What is happening now, what can safely run together, what is visible to the company, and what comes next? | External tracker mappings, Work Items, lifecycle transitions, safe dispatch waves, claim-before-worker preparation, runtime and task registries, shared-resource reservations, handoffs |
| Verification and delivery | What evidence supports completion? | Tests, evaluation, Independent QA, exact revision, release gate |
| Durable state and observability | Can another task recover, learn from, and inspect the truth? | Project files, Context Map, Capability Registry, Context Capsules, Learning Loop, event log, status projections, local live control plane, checksums, bounded adapters |

No single layer is the framework by itself. Roles without engineering methods only divide labor. Skills without authority and durable state become disconnected prompts. Model choices bound directly to roles ignore the actual step. Workflow without evidence produces ceremonial completion. Temple connects these parts while keeping product truth in the repository.

## Scaling principle

The responsibilities remain stable as a project grows; staffing, method depth, artifacts, and gates change in proportion to risk.

- A small experiment may use five Agent Identities across ten Positions, a short Spec, one vertical slice, and local verification.
- A future larger-product profile can separate more Positions into dedicated Identities, install focused capability packs, require deeper design and evaluation, and integrate additional evidence sources.
- A future high-risk profile can add specialized Skills, stricter approval policy, security review, release evidence, and external adapters without replacing the core lifecycle.

The current alpha proves a lean configuration, core Skills, one optional Pack-v2 Build Quality pack, project-local state, bounded pilots, deterministic Progressive Context Routing and evaluation, per-step non-executing Adaptive Execution Routing, locally tested group dispatch planning, selectable Collaborative and High-Assurance contracts, version-pinned project CLI recovery, atomic first-wave preparation, stage-specific execution requirements, declared shared-resource coordination, normalized evidence and Observer projections, read-only external-tracker coordination with explicit repository reconciliation, and a local replay-safe control plane with capability-labelled providers, stateful conditions, authority-separated Human Inbox actions, and exact-SHA read-only GitHub PR evidence. It also proves bounded local, read-only federation and portfolio projections while every participant repository retains lifecycle authority.

Custom Positions and workflows, custom-pack publishing, configured semantic Retrieval Providers, external tracker or GitHub writes, remote control, operational coordination across remote repositories and machines, real regulated audit acceptance, and large multi-human or multi-machine collaboration evidence remain planned or explicitly unverified rather than claimed as shipped.

The same scaling principle applies to learning. Evidence from one work item begins as a project Lesson, not a universal rule. Repeated and validated learning may become a Practice, then the project may deliberately promote it to a Skill, automated check, ADR, or instruction. See the [Engineering Learning Loop](../extensions/engineering-learning.md).

## Organizational principles

1. A Position is a stable set of responsibilities and authority. An Agent Identity is a named executor in a project. An Assignment connects them.
2. One Agent may hold multiple Positions, so a small project does not need ten AI workers running at once.
3. Every Position exists from day one. Adding Agents later changes Assignments, not workflow language or historical data.
4. Developer and Independent QA must use different Agent Identities so one executor does not certify its own work.
5. Humans own business truth, priorities, cost, and high-risk approval. The Engineering Manager is the primary entry point.
6. Approved documents, their recorded authority and revisions, Git state, test results, runtime evidence, and approval records—not chat memory or generated projections—are canonical state.
7. Engineering methods are composable. A Skill changes the reusable procedure, not the Position's authority or the user's authorization.
8. Extensions remain project-owned unless an explicit promotion process transfers them into core or an official pack.
9. Independent authorized work runs in parallel when a fresh plan and runtime capacity make it safe. Sequential work remains explicit, and every wave rejoins through evidence before dependent work advances.

## The ten Positions

| Position | Primary responsibilities | Primary outputs | Cannot self-approve |
|---|---|---|---|
| Engineering Manager | Intake, decomposition, tracker mapping plans, delegation, unblocking, learning triage, overall status | Work order, mapping and reconciliation plan, handoff, learning triage, status | Business priority, high-risk release |
| Product Manager | Problem, scope, acceptance criteria, team-visible outcome framing | Specification, acceptance criteria | Technical design, business priority without authority, release |
| UX Designer | User flow, states, interaction risks | UX notes, flow, copy decisions | Implementation quality, release |
| UI Designer | Visual hierarchy, layout, components, design-system guidance, UI delivery mode | UI brief, visual direction, preview or design source when required | Implementation quality, release |
| Tech Lead | Architecture, interfaces, risk, technical decisions, technical Practices | Design, ADR, implementation plan, technical Practice | Product scope, independent QA |
| Developer | Implementation, unit tests, self-verification | Code, test evidence, handoff | Independent QA of their own work |
| Quality & Evaluation Engineer | Test design, evaluation, regression evidence | Test plan, evaluation report | Release |
| Independent QA | Independent reproduction, acceptance, counterexample search | QA report, pass or fail | Their own upstream implementation |
| Release Manager | Release gate, versioning, rollback readiness | Release record, go or no-go proposal | High-risk human approval |
| Observer | Observable views derived from canonical state | Status, timeline, tracker conflicts, learning signals, stale alerts | Any product or release decision |

## Recommended initial configuration

A small project can cover ten Positions with five Agent Identities:

1. Coordination: Engineering Manager, Release Manager, Observer.
2. Product Design: Product Manager, UX Designer, UI Designer.
3. Technical: Tech Lead.
4. Delivery: Developer.
5. Quality: Quality & Evaluation Engineer, Independent QA.

These are Assignment slots, not Agent names. Names are created only during the project's first initialization.

## UI design depth

Interface scope is explicit, and pre-implementation visual artifacts scale with risk:

- **Not applicable:** the Work Item has no user-facing interface change and carries no UI specification reference.
- **Code-first:** implementation is the first visual artifact; a concise UI brief, state coverage, and runtime visual review remain required.
- **Preview-first:** review a wireframe, code preview, prototype, or equivalent artifact before full implementation.
- **Design-led:** use an approved, versioned design source and implementation mapping for brand-sensitive, expensive, or multi-party work.

The framework defines evidence rather than mandating Figma. An interaction contract may link behavior and states to any design medium, code surface, backend contract, and runtime evidence. See [UI design responsibility and delivery modes](ui-design.md) and [UI interaction contracts](ui-interaction-contracts.md).

## Product specification depth

Temple establishes the smallest approved product truth needed for a bounded vertical slice, then preserves what was learned through an intentional revision. The project-owned specification index can point to repository-native documents, approved external systems, non-authoritative projections, and unresolved legacy material without forcing a company to replace its existing business workflow. Work Items pin the exact approved revisions they depend on; a stale or superseded reference stops later delivery until it is reconciled. See [Product specification system](product-specifications.md) and [Enterprise document adoption](../getting-started/enterprise-document-adoption.md).

## Work lifecycle

```text
Intake
  → Spec
  → Design
  → Build
  → Test
  → Eval
  → Independent QA
  → Release Gate
  → Done
```

Every handoff must include the work item ID, input revision, completed work, evidence location, unresolved issues, and next Position. Without those fields, conversation content is context—not proof of completion.

One lifecycle outcome may contain several child Work Items. The Engineering Manager defines their boundaries; `parallel plan` derives safe waves; `parallel prepare` records each first-wave claim, declared resource capacity, and runtime reservation before creation; an authorized runtime attaches internal subagents or separate user-owned tasks up to capacity; and the Integration Owner joins exact revisions and verification before replanning. Planning and preparation never grant new product scope or external authority, and worker completion never advances the lifecycle by itself. See [Parallel orchestration](../operations/parallel-orchestration.md) and [Runtime coordination and recovery](../operations/runtime-coordination.md).

## Company planning and AI execution

An external tracker may remain the human planning surface while Work Items preserve bounded AI execution, contracts, evidence, and lifecycle. Team-visible parent outcomes map externally; internal children represent AI-only decomposition; Codex tasks represent execution sessions. Explicit field ownership prevents automatic synchronization from turning company status into release authority. See [Task and external tracker coordination](../operations/task-and-tracker-coordination.md).
