# Workkeel documentation

Start with the [Workkeel task-first guide](getting-started/workkeel.md) for new
projects without company Positions. The [task contract](concepts/task-contract.md)
defines task, authority, environment and model-connection boundaries.

Most of the detailed catalog below documents the retained **Temple compatibility
mode**. Its organization, Console, capability-routing and assurance setup is not
required by task-first projects. Historical ADRs and validation records retain
their original names and revision-specific claims; they do not qualify new behavior.

## Start with your goal

For a preapproved literal correction in a non-normative note, see the opt-in
[mechanical completion](operations/mechanical-completion.md) route. This is not
a general small-code-change or Independent QA shortcut.

| I want to… | Start here | Continue with |
|---|---|---|
| Start a task-first Workkeel project | [Task-first quick start](getting-started/workkeel.md) | [Task contract](concepts/task-contract.md), [Lifecycle decision](adr/0072-task-first-lifecycle.md) |
| Evaluate the framework | [Vision and operating model](concepts/vision.md) | [Architecture](concepts/architecture.md), [Roadmap](planning/roadmap.md) |
| Understand Temple terms or the `$name` methods used in prompts | [Temple terminology](concepts/terminology.md) | [Temple Core Skills](getting-started/core-skills.md), [Capability catalog](extensions/capability-catalog.md) |
| Complete the first Work Item | [Core Path](getting-started/core-path.md) | [Usage guide](getting-started/usage.md), [Workflow profiles](concepts/workflow-profiles.md) |
| Install or adopt Temple | [Usage guide](getting-started/usage.md) | [Core Path](getting-started/core-path.md), [Enterprise document adoption](getting-started/enterprise-document-adoption.md) |
| Coordinate people and AI agents | [Collaborative development](operations/collaboration.md) | [Parallel orchestration](operations/parallel-orchestration.md), [Runtime coordination](operations/runtime-coordination.md) |
| Join an existing team project | [Team entry](getting-started/team-entry.md) | [Contributor setup and recovery](operations/collaborative-delivery.md) |
| Choose proportionate delivery controls | [Workflow profiles and outcomes](concepts/workflow-profiles.md) | [High-Assurance](operations/high-assurance.md), [ADR-0045](adr/0045-adaptive-workflow-profiles.md) |
| Hand off a small change with fewer administrative steps | [Lean delivery](operations/lean-delivery.md) | [Compact context entry](extensions/context-routing.md#compact-entry), [Workflow profiles](concepts/workflow-profiles.md) |
| Resolve a model or execution profile for one step | [Adaptive execution routing](concepts/adaptive-execution-routing.md) | [Execution routing operations](operations/execution-routing.md), [ADR-0046](adr/0046-separate-adaptive-execution-routing.md) |
| Define product, UX, UI, or API behavior | [Product specifications](concepts/product-specifications.md) | [UI design modes](concepts/ui-design.md), [UI interaction contracts](concepts/ui-interaction-contracts.md) |
| Add engineering methods or project Skills | [Capability catalog](extensions/capability-catalog.md) | [Skill authoring](extensions/skill-authoring.md), [Engineering Learning Loop](extensions/engineering-learning.md) |
| Inspect evidence, risk, or live project state | [Evidence and Observer](operations/evidence-and-observer.md) | [Optional Management Console](operations/management-console.md), [High-Assurance](operations/high-assurance.md) |
| Back up or recover Temple project state | [Backup and recovery](operations/backup-and-recovery.md) | [Architecture](concepts/architecture.md), [ADR-0031](adr/0031-durable-recovery-before-persistence-growth.md) |
| Prepare repository evidence for publication | [Auditable Self-Hosting](operations/auditable-self-hosting.md) | [ADR-0048](adr/0048-auditable-self-hosting-evidence-profiles.md), [Release readiness](planning/release-readiness.md) |
| Coordinate several authoritative repositories | [Multi-repository federation](operations/multi-repository-federation.md) | [ADR-0033](adr/0033-federate-project-authority-with-read-only-portfolios.md), [Phase 4 design](planning/phase-4.md) |
| Run a bounded multi-repository experiment | [Validation programs](operations/validation-programs.md) | [Effectiveness and microservice validation](planning/temple-effectiveness-and-microservice-validation.md), [Token Efficiency](operations/token-efficiency-and-model-routing.md) |
| Compare a Temple process or model choice | [Model and process evaluation](operations/model-and-process-evaluation.md) | [Validation programs](operations/validation-programs.md), [Token Efficiency](operations/token-efficiency-and-model-routing.md) |
| Test whether policy resists realistic failure | [Adversarial policy evaluation](operations/policy-evaluation.md) | [ADR-0032](adr/0032-evaluate-policy-with-adversarial-evidence.md), [Phase 4 design](planning/phase-4.md) |
| Understand Token usage, project calibration, or model selection | [Token Efficiency and Model Routing](operations/token-efficiency-and-model-routing.md) | [Phase 4 design](planning/phase-4.md), [ADR-0034](adr/0034-attribute-usage-before-routing-models.md) |
| Audit a decision or claim | [ADR index](adr/README.md) | [Validation index](validation/README.md), [Research index](research/README.md) |
| Check whether Temple is ready for public release | [Release readiness](planning/release-readiness.md) | [Roadmap](planning/roadmap.md), [Testing strategy](getting-started/testing.md) |
| Publish a qualified npm version | [npm release operations](operations/npm-release.md) | [Release readiness](planning/release-readiness.md), [ADR-0050](adr/0050-release-triggered-npm-trusted-publishing.md) |

## Documentation map

### Getting started

- [Task-first quick start](getting-started/workkeel.md) — the current Workkeel source path; role-free tasks, exact evidence, explicit migration and read-only runtime plans.
- [Core Path](getting-started/core-path.md) — the shortest Console-free journey from an initialized project to a closed Work Item.
- [Usage guide](getting-started/usage.md) — initialize, adopt, operate, self-host, upgrade, and troubleshoot.
- [Temple Core Skills](getting-started/core-skills.md) — human-facing triggers, outcomes, examples, and authority limits for the six repository Core Skills.
- [Enterprise document adoption](getting-started/enterprise-document-adoption.md) — preserve, bridge, or intentionally migrate an existing documentation system.
- [Testing strategy](getting-started/testing.md) — fast local checks, full behavioral verification, release checks, and explicitly authorized live tests.

### Concepts

- [Vision and operating model](concepts/vision.md) — Positions, Agent Identities, Skills, human authority, and lifecycle.
- [Temple terminology](concepts/terminology.md) — plain-language definitions for responsibility, identity, work, evidence, profiles, learning, and repository ownership.
- [Architecture](concepts/architecture.md) — a compact system-boundary diagram plus canonical state, ownership, mutation safety, generated views, and extension boundaries.
- [Workflow profiles and lifecycle outcomes](concepts/workflow-profiles.md) — choose Lean, Standard, or High-Assurance and distinguish concluded work from an active blocker.
- [Adaptive execution routing](concepts/adaptive-execution-routing.md) — separate responsibility, task shape, required capabilities, execution profiles, resource observations, and calibration.
- [Product specification system](concepts/product-specifications.md) — product truth, revisions, Feature Specs, and external authority.
- [UI design modes](concepts/ui-design.md) — proportionate design evidence without requiring a particular vendor.
- [UI interaction contracts](concepts/ui-interaction-contracts.md) — connect behavior, screens, implementation, APIs, and backend rules.

### Operations

- [Collaborative development](operations/collaboration.md) — Human Principals, specialists, Position pools, claims, and multi-maintainer boundaries.
- [Parallel orchestration](operations/parallel-orchestration.md) — safe waves, affected paths, preparation, and integration joins.
- [Runtime coordination](operations/runtime-coordination.md) — pinned launcher, workers, resources, task correlation, and recovery.
- [Review rework](operations/review-rework.md) — return a rejected candidate to Build within the same approved Work Item; included in Alpha.33.
- [Task and tracker coordination](operations/task-and-tracker-coordination.md) — company tracker, Temple Work Item, and Codex task boundaries.
- [Evidence and Observer](operations/evidence-and-observer.md) — normalized evidence, exact revisions, stale signals, and closeout.
- [High-Assurance profile](operations/high-assurance.md) — risk-scaled evidence, separation of duties, rollback, and human approvals.
- [Optional Management Console](operations/management-console.md) — an explicitly started read-only human view that does not start Usage collection.
- [Usage observation](operations/usage-observation.md) — off, on-demand Collector, and experimental managed-local modes.
- [Legacy combined control plane](operations/control-plane.md) — replay-safe events, providers, live projections, and the Human Inbox compatibility path.
- [Backup and recovery](operations/backup-and-recovery.md) — project-owned-state manifests, integrity checks, restore preview, and interrupted-write rollback.
- [Auditable Self-Hosting and Evidence Profiles](operations/auditable-self-hosting.md) — preserve useful development evidence while blocking new secrets, local runtime data, and machine-specific publication leaks.
- [Compact evidence reading](operations/compact-evidence.md) — unreleased main: opt-in saved-log and JSON views with failure details, limitations and digest-bound original references.
- [Adversarial policy evaluation](operations/policy-evaluation.md) — versioned failure scenarios, profile fixtures, fail-closed scorecards, and authority boundaries.
- [Token Efficiency and Model Routing](operations/token-efficiency-and-model-routing.md) — provider-reported usage, project-local calibration, Credits provenance, exception-only autonomy, and the boundary before automatic routing.
- [Execution routing](operations/execution-routing.md) — configure and inspect per-step deterministic routes without launching a Provider or mutating project state.
- [Multi-repository federation](operations/multi-repository-federation.md) — project-owned participants, exact revisions, composite references, rollout waves, and read-only portfolio authority.
- [Bounded validation programs](operations/validation-programs.md) — reviewed multi-repository waves, resource ceilings, durable checkpoints, write allowlists, and limitation-aware usage aggregation.
- [Model and process evaluation](operations/model-and-process-evaluation.md) — controlled process-only, model-only, or factorial comparisons with quality gates, cache controls, frozen protocols, and reusable reports.
- [npm release operations](operations/npm-release.md) — Release-only Trusted Publishing, exact asset checks, npm channel mapping, and recovery boundaries.
- [Evidence-driven Lean Mode retrospective](validation/evidence-driven-lean-mode.md) — what the Wave 5 evidence supports, what it does not, and why the next experiment changes shape.

### Extensions and learning

- [Capability catalog](extensions/capability-catalog.md) — core, optional, candidate, and project-owned engineering capabilities.
- [Context routing](extensions/context-routing.md) — bounded retrieval and the optional semantic-search boundary.
- [Engineering Learning Loop](extensions/engineering-learning.md) — Lessons, Practices, revalidation, and evidence-based promotion.
- [Skill authoring](extensions/skill-authoring.md) — create a bounded, discoverable, and verifiable project Skill.
- [Skill design policy](extensions/skill-design.md) and [scenario matrix](extensions/skill-scenarios.md) — maintainer rules and routing expectations.
- [Extension and migration contracts](extensions/extension-and-migrations.md) — Packs, provenance, compatibility, schemas, and explicit state migration.
- [Archify adapter](extensions/archify-adapter.md) — an optional, pinned, isolated adapter boundary.
- [Headroom adapter](extensions/headroom-adapter.md) — unreleased main: explicit large tool-output compression and exact original readback; off by default.
- [Tailscale private Dashboard](integrations/tailscale-private-dashboard.md) — a pinned, tailnet-only, read-only tablet viewer that leaves Agent control on loopback.

### Planning and historical boundaries

- [Autonomous delivery checkpoint](validation/autonomous-main-checkpoint.md) — integration scope, preserved gates, bounded observations, and reusable offline experiment preparation.
- [Roadmap](planning/roadmap.md) ([Japanese](planning/roadmap.ja.md), [Traditional Chinese](planning/roadmap.zh-TW.md)) — product purpose, capabilities, delivered milestones, current qualification, and later direction.
- [Release readiness](planning/release-readiness.md) — current public-Alpha gates, package and compatibility blockers, and retained non-blocking validation.
- [Pre-Phase 4 closeout review](planning/pre-phase-4-closeout-review.md) — the readiness audit that closed the earlier phases.
- [Phase 4 design](planning/phase-4.md) — completed local durability, evaluation, federation, and usage contracts plus retained enterprise qualification.
- [Phase 1 contract](planning/phase-1.md) — original foundation scope and exit gate.
- [Phase 3 design](planning/phase-3-control-plane.md) and [work breakdown](planning/phase-3-work-items.md) — accepted control-plane plan.
- [Changelog](../CHANGELOG.md) — chronological release history.
- [Architecture Decision Records](adr/README.md) — accepted rationale and consequences.
- [Validation records](validation/README.md) — revision-bound evidence and retained gaps.
- [Research](research/README.md) and [official sources](research/official-sources.md) — decision inputs, not shipped promises.
- [Pilot records](pilots/README.md) — bounded experiments with explicit stop conditions.

## What each document type means

| Type | Question it answers | Authority |
|---|---|---|
| README | What is this, why should I care, and how do I begin? | Human-facing entry point |
| Guide | How do I use a current capability? | Current operating guidance grounded in code and tests |
| ADR | Why did Temple choose this design? | Accepted decision until superseded |
| Validation record | What was tested, where, and with what limits? | Bounded evidence for one revision and environment |
| Roadmap | What is delivered, current, next, or intentionally later? | Direction, not release history |
| Changelog | What changed in each version? | Chronological release record |
| Research | What evidence informed a possible decision? | Input only; not a capability claim |

## Repository docs before a separate Wiki

Repository Markdown remains canonical because it is reviewed, versioned, tested, and released with the code it describes. If Temple later needs a documentation site or Wiki-style interface, generate it from this directory and link each published page back to its repository source. Do not maintain the same guide manually in two places.

## Maintaining this index

1. Give every document one primary reader and purpose.
2. Put it in the shallowest applicable category.
3. Put results in validation, rationale in ADRs, chronological changes in the changelog, and exploratory inputs in research.
4. Link it once from its primary category and only add it to the root README when a first-time visitor needs it.
5. Keep English as the canonical documentation language; only the README and roadmap have maintained Japanese and Traditional Chinese editions.
