# Workkeel terminology

Use the established terms below for current Workkeel tasks. Names of persisted
schemas and historical records remain exact identifiers, not terms to rewrite.

| Term | Meaning in Workkeel | Important distinction |
| --- | --- | --- |
| Task contract | Approved goal, scope, actor, environment and acceptance criteria | Not an executable prompt or proof of completion |
| Agent / Principal | The executing identity / the human authority sponsoring it | Attributed IDs are not authenticated accounts; a second Agent is not a second human |
| Agent harness engineering | Designing instructions, tools, boundaries and checks around an agent | Workkeel orchestrates tasks; the coding runtime owns its internal agent loop |
| Context engineering | Supplying relevant instructions, Skills and evidence at the right task boundary | Not unconditional whole-repository reading or compression of authority |
| Graph orchestration | Explicit nodes, edges, branches, direct joins and bounded loops | A workflow graph is different from a repository knowledge graph or visualization |
| Durable execution | Checkpoints plus an intent/result journal for controlled recovery | Not a guarantee of exactly-once external effects |
| Feedback loop | Execute, evaluate and revise within declared limits | Not automatic learning, policy changes or unlimited retries |
| Human-in-the-loop | Stop for an attributed approval tied to a specific pending action | An approval does not expand the task's permissions |
| Policy-based model routing | Choose a model from approved explicit/rule/default settings | It does not switch the coding runtime or change a model halfway through a conversation |
| Runtime adapter | Trusted host code implementing compatibility, start, resume, cancel and results | An LLM gateway provides model transport, not the coding runtime's tools or sandbox |
| Requested / runtime-confirmed / observed model | The selected name / runtime's reported configuration / independently available backend observation | Unknown observations stay null; an alias alone does not prove the backend |
| Skill | A task-relevant project method with instructions and verification | Selection, reading, application and outcome quality are separate checks |

These terms describe concrete behavior in the [task contract](task-contract.md),
[workflow guide](../operations/workkeel-workflows.md), and
[context guide](../extensions/workkeel-context.md). We use **graph orchestration**
and **feedback loops**, not new product-specific meanings for “Graph Engineering”
or “Loop Engineering.”

## Compatibility vocabulary

The remaining glossary documents the retained Temple compatibility mode. Its
names and anchors support existing projects and records; they are not required
concepts for starting a Workkeel task.

Temple reuses familiar software-development words but gives some of them precise project-local meanings. This guide is the human-facing map. Schemas, policy files, and operating guides remain authoritative for machine validation and detailed behavior.

## How to read the vocabulary

- **Temple-specific name:** a framework concept that should not be inferred from ordinary English alone.
- **Precisely used software term:** a familiar word with an explicit Temple boundary.
- **Repository surface:** a file or directory with a defined ownership or authority role.

## People and responsibility

<a id="human-principal"></a>

### Human Principal

The human identity that holds business authority and sponsors AI work in a project. A Human Principal may approve only within the authority the project records; the term does not mean manager, repository administrator, or permanent superuser.

<a id="position"></a>

### Position

A stable responsibility contract such as Product Manager, Developer, or Independent QA. It describes expected work and approval boundaries. A Position is not a person, job title, reporting rank, or running Agent.

<a id="agent-identity"></a>

### Agent Identity

A project-specific identity for a person or AI that may perform work. Display names can change or repeat; the stable identity ID is what connects Assignments, claims, handoffs, and evidence.

<a id="assignment"></a>

### Assignment

The project's current default mapping from a Position to an Agent Identity. It answers who normally covers the responsibility; it does not prove that the Agent is online or currently owns a Work Item.

<a id="position-membership"></a>

### Position Membership

An eligibility record used when several people or Agents can cover the same Position. Qualification and lifecycle status determine whether that membership can be used. It is broader than one default Assignment and narrower than business authority.

<a id="discipline"></a>

### Discipline

A bounded specialization used for routing work inside a Position, such as frontend or backend development. A Discipline narrows expertise; it never expands the Position's authority.

## Execution adaptation

<a id="task-shape"></a>

### Task Shape

The structured characteristics of one execution step: Position, lifecycle stage, task kind, risk class, and Context Profile digest. It supports policy matching and fair comparison; it is not inferred from an Agent name or free-form title.

<a id="capability-route"></a>

### Capability Route

The required and optional capability IDs and modalities for one execution step. It states what the work needs. It does not install a Skill, authorize a service, expand Position authority, or prove that a Provider supports the capability.

<a id="execution-profile"></a>

### Execution Profile

A project-owned candidate configuration that declares model and reasoning classes, optional Provider/model mapping, capabilities, policy boundaries, risk support, and resource estimates. It is not a Position or a universal claim that one model is best.

<a id="execution-step"></a>

### Execution Step

One independently routable unit inside a Work Item. Several steps may resolve to different profiles while remaining part of the same Work Item lifecycle and authority boundary.

<a id="execution-route"></a>

### Execution Route

The deterministic result of filtering profiles against one step and applying the project's explicit preference policy. It explains the selected requested settings or why resolution failed. It is not a task launch, Provider acknowledgement, or effective-model observation.

<a id="resource-observation"></a>

### Resource Observation

A typed measurement such as Tokens, latency, Credits, GPU time, media quantity, or human editing time, together with its source and evidence quality. Unavailable data remains `null`; it is never interpreted as zero.

<a id="model-calibration"></a>

### Model Calibration

Project-local matched quality and resource evidence used to evaluate or revise execution-profile preference. Calibration can support a shadow or advisory result, but it does not execute a route or grant authority.

## Work and verification

<a id="work-item"></a>

### Work Item

One durable, bounded outcome with scope, state, owner, affected paths, dependencies, and acceptance evidence. It is Temple's lifecycle unit—not a chat title, not necessarily an external issue, and not the same thing as a Codex task.

<a id="claim"></a>

### Claim

A time-bounded record that an eligible Agent Identity is actively responsible for a Work Item in a specific checkout and revision context. It supports coordination but is not a distributed lock across machines.

<a id="handoff"></a>

### Handoff

An evidence-bearing transfer from one Position to the next. It records completed responsibility, input revision, and supporting files. A chat message saying “done” is not a durable handoff.

<a id="evidence"></a>

### Evidence

A normalized record that supports a claim about a known revision or environment: for example a test result, runtime observation, review, approval, risk, or rollback check. Evidence supports a gate; it does not automatically satisfy that gate or prove more than its stated scope.

<a id="independent-qa"></a>

### Independent QA

Verification by an Agent Identity different from the Developer for the same Work Item. It challenges the candidate against acceptance criteria and evidence. It is not the developer re-running their own checks under a different label.

<a id="release-gate"></a>

### Release Gate

The final organizational decision about whether the verified candidate is ready to be released. A `go` result records readiness; it does not itself deploy, publish, push, spend money, or perform another external action.

## Operating profiles

<a id="solo"></a>

### Solo

One human directs AI-assisted development. A small number of Agent Identities may cover several Positions, while Developer and Independent QA remain separate for the same work. Solo does not mean “no governance.”

<a id="collaborative"></a>

### Collaborative

Several humans and their Agents share the project. Sponsorship, eligible Position pools, memberships, claims, resources, overlaps, and integration ownership become explicit. Collaborative does not require a fixed team size or one person per Position.

<a id="high-assurance"></a>

### High-Assurance

A stricter profile for higher-risk work. It scales identity separation, revision-matched evidence, rollback readiness, and distinct human approvals by risk tier. It does not claim regulatory certification or authorize production action by itself.

<a id="evidence-profile"></a>

### Evidence Profile

A project-owned publication policy named `private`, `public`, or `restricted`. It separates evidence that can explain the work from data that must be normalized, reviewed, or kept local. It is not a Workflow Profile, Execution Profile, repository-visibility setting, or release approval.

<a id="auditable-self-hosting"></a>

### Auditable Self-Hosting

Using Temple's repository-backed operating model to develop the framework or project that provides it, while preserving enough evidence for another person to inspect how changes were governed. An Evidence Profile defines its publication boundary; self-hosting does not mean publishing every runtime detail.

## Learning and reusable methods

<a id="lesson"></a>

### Lesson

A project-owned observation captured from work and evidence. One Lesson is not automatically a rule, instruction, or Skill.

<a id="practice"></a>

### Practice

A validated and revalidated working method derived from one or more Lessons, with an owner and bounded applicability. A Practice can inform future work but still does not grant authority.

<a id="skill"></a>

### Skill

A reusable Agent method with a precise trigger, non-trigger, workflow, authority boundary, and completion condition. A Skill is not a Position, tool installation, project fact, or permission grant.

<a id="skill-proposal"></a>

### Skill Proposal

A reviewable recommendation to turn validated project learning into a Skill. Approval may authorize a separate authoring Work Item; it does not create, activate, publish, or promote the Skill automatically.

## Repository truth and ownership

<a id="canonical-source"></a>

### Canonical source

The repository file whose contents have authority for a specific subject. Derived dashboards, external observations, and old chats may help explain current state, but they do not outrank the named canonical source.

<a id="project-owned"></a>

### Project-owned

State the adopting project controls and preserves across Temple upgrades, such as its Agent Identities, Assignments, Work Items, evidence, and local extensions.

<a id="framework-managed"></a>

### Framework-managed

An exact file listed in `temple.lock.managed_files` whose clean framework version Temple may upgrade. An allowed directory is not automatically framework-owned, and checksum drift must fail closed instead of overwriting project changes.

<a id="generated-view"></a>

### Generated view

A rebuildable projection created from canonical sources for people or tools to inspect. A generated view may be deleted and rebuilt; editing it does not change lifecycle authority.

## What Temple adds to a project

<a id="temple-md"></a>

### `TEMPLE.md`

The project's human-readable entry to its installed AI development organization and operating boundaries.

<a id="ai-org"></a>

### `.ai-org/`

The organization state area. It contains project-owned configuration and records, exact framework-managed files, evidence and artifacts, and rebuildable views; ownership is determined by the relevant contract, not by the directory name alone.

<a id="templew"></a>

### `templew.mjs`

The repository launcher used to invoke the framework version pinned for that project. It prevents ordinary operation from silently depending on an unrelated global CLI version.

<a id="temple-lock"></a>

### `temple.lock`

The installed framework contract that pins bootstrap information and exact managed-file ownership. It is not a general claim over every file below an allowed root.

## Where to continue

- [Vision and operating model](vision.md) explains how these concepts work together.
- [Collaborative development](../operations/collaboration.md) explains multiple humans, sponsorship, memberships, and authority.
- [Evidence and Observer](../operations/evidence-and-observer.md) explains revision-matched verification and projections.
- [Engineering Learning Loop](../extensions/engineering-learning.md) explains Lesson, Practice, Skill Proposal, and promotion boundaries.
- [Temple Core Skills](../getting-started/core-skills.md) explains the reusable methods invoked with `$name`.
