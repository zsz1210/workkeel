# Domain glossary

Project-owned vocabulary for product decisions, implementation, tests, and handoffs. Only confirmed terms belong in this file; unresolved protocol gaps stay explicit.

## Human Principal

- Status: confirmed
- Bounded context: Temple project accountability and governance
- Definition: An accountable human identity with an immutable project Principal ID. It is neither a Position nor a reporting-hierarchy title.
- Examples: A maintainer sponsoring an Agent Identity; two distinct reviewers satisfying a critical governance approval.
- Non-examples: A GitHub team, company job title, email address, Agent Identity, or Codex task.
- Invariants: IDs are never reused; display names may duplicate; inactive history remains attributable.
- Owner or authoritative source: Collaboration state and ADR-0038.
- Related terms: Local Actor Binding; Human Authority Grant; Agent sponsorship.
- Last confirmed: 2026-08-31

## Agent Identity

- Status: confirmed
- Bounded context: Temple organization and work attribution
- Definition: A durable project identity for an AI participant, separate from a model, runtime worker, Codex task, and Human Principal.
- Examples: `agent-rikku` holding Developer membership and claiming one Work Item.
- Non-examples: A temporary subagent process, model name, chat title, or human account.
- Invariants: Collaborative and High-Assurance active Agents have accountable sponsorship; one Agent cannot implement and independently QA the same candidate.
- Owner or authoritative source: Assignments, collaboration state, and ADR-0002.
- Related terms: Position Membership; default Assignment; Runtime worker.
- Last confirmed: 2026-08-31

## Position Membership

- Status: confirmed
- Bounded context: Temple responsibility eligibility
- Definition: The project record that makes one Agent Identity eligible for one framework Position with bounded Disciplines and qualification state.
- Examples: A provisionally qualified Developer membership covering `frontend`; an active membership with evidence and review date.
- Non-examples: The Position definition, default Assignment, active Work claim, Human Authority Grant, Skill, or company title.
- Invariants: Membership may be provisional, active, suspended, expired, or revoked; Skill discovery and model selection do not grant membership.
- Owner or authoritative source: Collaboration state and ADR-0038.
- Related terms: Position; Discipline; default Assignment; qualification.
- Last confirmed: 2026-08-31

## Default Assignment

- Status: confirmed
- Bounded context: Temple Position ownership fallback
- Definition: The single Agent Identity selected as the default owner of a Position when no bounded Work claim selects another eligible pool member.
- Examples: `agent-rikku` as the default Developer while other active Developer members remain eligible.
- Non-examples: Exclusive Position membership, human employment assignment, or current runtime activity.
- Invariants: Every configured Position has one active default Assignment; the Position pool may contain many eligible Agents.
- Owner or authoritative source: `.ai-org/project/assignments.json` and organization policy.
- Related terms: Position Membership; Work claim.
- Last confirmed: 2026-08-31

## Human Authority Grant

- Status: confirmed
- Bounded context: Temple governance authorization
- Definition: A scoped, time-bounded project record allowing one Human Principal to perform or approve a named governance action up to a stated risk ceiling.
- Examples: Project-scoped identity administration; revision-scoped high-risk release approval.
- Non-examples: Position Membership, sponsorship, GitHub repository permission, job title, or Skill invocation.
- Invariants: Grants do not arise from titles; authority expansion follows the configured distinct-approval rule; expired or revoked grants confer no authority.
- Owner or authoritative source: Collaboration state and ADR-0038.
- Related terms: Bootstrap Owner; governance recovery; Position authority.
- Last confirmed: 2026-08-31

## Bootstrap Owner

- Status: confirmed
- Bounded context: Initial Collaborative governance setup
- Definition: A temporary Human Principal allowed to establish the first viable scoped governance grants before ordinary multi-principal approval rules can operate.
- Examples: The first project maintainer configuring initial authority holders and recovery trustees.
- Non-examples: A permanent superuser, production credential, hidden backdoor, or Human Principal hierarchy apex.
- Invariants: Retirement is explicit and permanent; retirement requires viable grants and configured recovery; it cannot be silently recreated.
- Owner or authoritative source: Collaboration state and ADR-0038.
- Related terms: Human Authority Grant; governance recovery.
- Last confirmed: 2026-08-31

## Local Actor Binding

- Status: confirmed
- Bounded context: One local Git clone and its linked worktrees
- Definition: A generated private mapping below the Git common directory from the current local operator to a project Principal ID plus an evidence-labelled verification class.
- Examples: Solo `human` with self-asserted verification; a provider subject imported from an external verified observation.
- Non-examples: A repository Principal record, credential, authorization grant, email registry, or proof created merely by selecting a Principal ID.
- Invariants: It is never version-controlled; Temple reports rather than fabricates unavailable provider verification.
- Owner or authoritative source: Local identity runtime contract and ADR-0038.
- Related terms: Human Principal; provider identity; step-up verification.
- Last confirmed: 2026-08-31

## Simulated Collaborative validation

- Status: confirmed
- Bounded context: Temple validation evidence
- Definition: A controlled exercise using separate local clones, fixtures, processes, or synthetic identities to test collaboration mechanics without two independently accountable humans.
- Examples: Two clones competing for one claim and recovering from a Git conflict on one machine.
- Non-examples: Real Collaborative validation or proof of organizational adoption.
- Invariants: It cannot satisfy the real-environment gate and must retain its environment limitation.
- Owner or authoritative source: Collaborative validation plan.
- Related terms: Real Collaborative validation; repository coordination backend.
- Last confirmed: 2026-08-31

## Real Collaborative validation

- Status: confirmed
- Bounded context: Temple validation evidence
- Definition: A retained test in which at least two distinct Human Principals operate independently administered environments through real Git hosting, pull requests, checks, and conflict recovery.
- Examples: Two contributors use their own machines and identities while a distinct Agent performs Independent QA on the integrated revision.
- Non-examples: One person with multiple accounts, two worktrees on one machine, or deterministic fixtures.
- Invariants: Team size beyond required responsibility distinctions is not prescribed; repository coordination still does not become a distributed lock.
- Owner or authoritative source: Collaborative validation plan and ADR-0038.
- Related terms: Simulated Collaborative validation; representative team pilot.
- Last confirmed: 2026-08-31

## Requested turn reasoning effort

- Status: confirmed
- Bounded context: Temple Provider-owned task launch and task registry
- Definition: The reasoning effort Temple sends in the `turn/start.effort` field for one turn.
- Examples: A launch request containing `effort: "max"` records `requested_reasoning_effort: "max"`.
- Non-examples: A value returned by `thread/start`; an inference from output Token counts; a model family default.
- Invariants: It records intent, not proof that the Provider executed the turn with that value.
- Owner or authoritative source: Temple launch request plus the installed App Server `TurnStartParams` schema.
- Related terms: Observed thread reasoning effort; effective turn reasoning effort.
- Supersedes: Ambiguous use of `reasoning_effort` as both request and observation.
- Last confirmed: 2026-08-31

## Observed thread reasoning effort

- Status: confirmed
- Bounded context: Codex App Server `thread/start` acknowledgement
- Definition: The nullable thread-level `reasoningEffort` returned by the Provider when a thread is created.
- Examples: `thread/start` returns `reasoningEffort: "xhigh"` while a later `turn/start` requests `max`.
- Non-examples: A direct acknowledgement of the effective effort for the individual turn.
- Invariants: It must never be labeled as effective turn reasoning unless a future inspected protocol explicitly defines that equivalence.
- Owner or authoritative source: Installed App Server `ThreadStartResponse` schema.
- Related terms: Requested turn reasoning effort; effective turn reasoning effort.
- Supersedes: Treating the thread acknowledgement as the effective turn value.
- Last confirmed: 2026-08-31

## Effective turn reasoning effort

- Status: confirmed
- Bounded context: Provider-observed turn execution metadata
- Definition: A reasoning effort explicitly acknowledged by the Provider as the value actually used for one identified turn.
- Examples: A future protocol event or response that names both a turn ID and its effective effort.
- Non-examples: The request sent by Temple; the thread-level acknowledgement; an estimate derived from reasoning-output Tokens.
- Invariants: The value remains `null` when the inspected Provider protocol exposes no direct turn-effective acknowledgement.
- Owner or authoritative source: The exact installed Provider protocol and its versioned wire contract.
- Related terms: Requested turn reasoning effort; observed thread reasoning effort.
- Supersedes: Guessed or fallback effective reasoning labels.
- Last confirmed: 2026-08-31

## Compatibility reasoning effort

- Status: confirmed
- Bounded context: Legacy `temple.tasks/v1` and usage consumers
- Definition: A backwards-compatible projection stored in the legacy `reasoning_effort` field together with an explicit `reasoning_effort_source`.
- Examples: `xhigh` with source `provider-thread`; `max` with source `canonical-requested` when no Provider observation exists.
- Non-examples: An independently proven effective-turn value when the source is not `provider-turn`.
- Invariants: Consumers must inspect the source and must not label this field alone as effective turn reasoning.
- Owner or authoritative source: Temple task compatibility policy.
- Related terms: Requested turn reasoning effort; observed thread reasoning effort; effective turn reasoning effort.
- Supersedes: Source-less legacy reasoning metadata.
- Last confirmed: 2026-08-31

## Exact task shape

- Status: confirmed
- Bounded context: Temple usage calibration and model evaluation
- Definition: The complete comparison identity required by project policy: Position, lifecycle stage, task kind, risk class, and Context Profile digest.
- Examples: Two bounded Developer Build cases with the same task kind, standard risk class, and identical Context Profile digest.
- Non-examples: `developer:build` alone; Agent display name; two Work Items that merely have similar titles.
- Invariants: Fallback dimensions support descriptive reporting only; missing or different required dimensions cannot qualify matched comparison.
- Owner or authoritative source: Usage Policy, DEC-0006, and WI-0083 product direction.
- Related terms: Matched evaluation; Context Profile; shadow recommendation.
- Last confirmed: 2026-09-01

## Matched evaluation

- Status: confirmed
- Bounded context: Temple project-local model calibration
- Definition: A project-owned evaluation set in which every candidate profile attempts the same case IDs under one quality rubric, exact task shape, source revision or content digest, and measurement contract.
- Examples: Terra and Luna profiles evaluated against the same three repository-owned cases with the same pass threshold and revision.
- Non-examples: Comparing unrelated completed Work Items; comparing only average Token totals; account-wide usage buckets.
- Invariants: Quality is a gate before resource comparison; missing, duplicated, mixed-shape, stale, or revision-mismatched cases fail closed.
- Owner or authoritative source: DEC-0006 and the matched-evaluation schema introduced by WI-0083.
- Related terms: Exact task shape; quality gate; advisory recommendation.
- Last confirmed: 2026-09-01

## Shadow recommendation

- Status: confirmed
- Bounded context: Temple usage observation
- Definition: A low-confidence, read-only candidate derived from naturally occurring accepted work for diagnosis and learning, without matched quality evidence.
- Examples: A lower observed Token candidate displayed after the diagnostic coverage threshold.
- Non-examples: A qualified preferred profile; permission to switch models; a savings claim.
- Invariants: It retains `matched_evaluation: false`, has no routing authority, and cannot execute a model change.
- Owner or authoritative source: Usage Policy and WI-0069.
- Related terms: Advisory recommendation; automatic routing.
- Last confirmed: 2026-09-01

## Advisory recommendation

- Status: confirmed
- Bounded context: Temple matched model evaluation
- Definition: A read-only, explainable profile recommendation supported by a valid matched evaluation and the project's configured decision contract.
- Examples: Recommending an approved Luna profile after it and Terra pass the same quality gate and Luna wins the declared resource comparison.
- Non-examples: Starting a task, changing a task model, rewriting policy, or granting release authority.
- Invariants: It never bypasses quality, authority, budget, lifecycle, or Independent QA requirements; automatic routing remains a separate capability.
- Owner or authoritative source: DEC-0006 and WI-0083.
- Related terms: Matched evaluation; shadow recommendation; automatic routing.
- Last confirmed: 2026-09-01

## Automatic routing

- Status: confirmed
- Bounded context: Future Temple model execution
- Definition: Applying a qualified project profile to a task without a new per-task model choice, inside a separately implemented and authorized executor.
- Examples: A future allowlisted low-risk mechanical task receiving a calibrated profile with a tested fallback.
- Non-examples: Displaying a shadow or advisory recommendation; routine read-only observation; a coordinator manually accepting a suggestion.
- Invariants: A recommendation never proves the executor exists or grants execution authority; ADR-0046 adds a read-only resolver while keeping routing execution unimplemented.
- Owner or authoritative source: Usage Policy autonomy boundary and DEC-0006.
- Related terms: Advisory recommendation; Autonomy Envelope; model switch.
- Last confirmed: 2026-09-01

## Task Shape

- Status: confirmed
- Bounded context: Adaptive execution routing
- Definition: Structured characteristics of one execution step: Position, lifecycle stage, task kind, risk class, and Context Profile digest.
- Examples: A Tech Lead design step for high-risk security architecture; a Developer low-risk mechanical edit.
- Non-examples: Agent display name, Work Item title, free-form prompt, or fixed Position-to-model mapping.
- Invariants: Routing matches declared fields; it does not infer task shape from prose. Matched calibration requires the stronger Exact task shape identity.
- Owner or authoritative source: Execution Policy, execution-request schema, and ADR-0046.
- Related terms: Exact task shape; Execution Step; Capability Route.
- Last confirmed: 2026-09-03

## Capability Route

- Status: confirmed
- Bounded context: Adaptive execution routing
- Definition: The required and optional capability IDs plus modalities declared for one Execution Step.
- Examples: `text.reasoning` plus `architecture.design`; project-owned `content.storyboard` plus `media.video.render`.
- Non-examples: A Position Membership, Skill installation, Provider permission, or proof that a tool was invoked.
- Invariants: Missing required capabilities reject a profile; missing optional capabilities stay visible without blocking; routing never expands authority.
- Owner or authoritative source: Execution Policy, execution-request schema, and ADR-0046.
- Related terms: Capability Registry; Skill; Execution Profile.
- Last confirmed: 2026-09-03

## Execution Profile

- Status: confirmed
- Bounded context: Adaptive execution routing
- Definition: A project-owned candidate configuration declaring model and reasoning classes, optional concrete Provider mapping, capabilities, modalities, data and execution boundaries, supported risk, and resource estimates.
- Examples: A Provider-neutral balanced profile; a project-mapped GPT-5.6 profile; a local media-rendering profile.
- Non-examples: Position, Agent Identity, universal best-model claim, task launch, or Provider acknowledgement.
- Invariants: Provider, model, and reasoning mapping is either complete or entirely unknown; eligibility is checked before preference.
- Owner or authoritative source: `.ai-org/project/execution-policy.json` and ADR-0046.
- Related terms: Execution Route; Model Calibration; Task Shape.
- Last confirmed: 2026-09-03

## Execution Step

- Status: confirmed
- Bounded context: Adaptive execution routing inside a Work Item
- Definition: One independently routable unit with its own Task Shape, Capability Route, constraints, selection mode, and resource observations.
- Examples: Design, implementation, and evaluation steps inside one feature Work Item.
- Non-examples: A new Work Item lifecycle, Codex task, Agent identity, or lifecycle transition.
- Invariants: Several steps may resolve different profiles without changing Work Item scope or authority.
- Owner or authoritative source: Execution-request schema and ADR-0046.
- Related terms: Work Item; Task Shape; Execution Route.
- Last confirmed: 2026-09-03

## Execution Route

- Status: confirmed
- Bounded context: Adaptive execution routing result
- Definition: The deterministic per-step result containing eligibility, rejection reasons, rule and fallback details, selected profile, and requested execution settings.
- Examples: An advisory route to `critical-planning`; an unresolved pinned route whose profile fails the risk constraint.
- Non-examples: Provider contact, task creation, model switch, effective-model evidence, or lifecycle authority.
- Invariants: Every current result records automatic execution, Provider contact, and mutation as false; requested and effective fields remain separate.
- Owner or authoritative source: Execution-route schema, resolver, and ADR-0046.
- Related terms: Execution Profile; Requested model; effective model.
- Last confirmed: 2026-09-03

## Resource Observation

- Status: confirmed
- Bounded context: Execution routing and operational analysis
- Definition: A typed numeric observation with measure ID, unit defined by policy, source, and evidence quality, or an explicit unavailable value.
- Examples: Provider-reported total Tokens; measured latency; local GPU seconds; human editing minutes; unavailable Credits.
- Non-examples: A guessed cost, missing data recorded as zero, or a quality claim without its rubric.
- Invariants: Unavailable values are `null`; project measures have stable IDs, units, and aggregation rules; observations do not grant routing authority.
- Owner or authoritative source: Execution Policy, execution-request schema, and ADR-0046.
- Related terms: Usage observation; Model Calibration; Execution Profile.
- Last confirmed: 2026-09-03

## Model Calibration

- Status: confirmed
- Bounded context: Project-local execution-profile preference
- Definition: Matched quality and resource evidence used to evaluate or revise which profile a project prefers for one Exact task shape.
- Examples: Two profiles pass the same quality gate on identical cases before Token and latency comparison.
- Non-examples: Natural-work Token totals alone, Position-to-model assignment, or permission to launch a model.
- Invariants: Calibration and route resolution remain separate; a recommendation has no automatic execution authority.
- Owner or authoritative source: Usage Policy, matched-evaluation schema, ADR-0034, and ADR-0046.
- Related terms: Matched evaluation; Execution Profile; Advisory recommendation.
- Last confirmed: 2026-09-03

## Workkeel task contract

- Status: confirmed for the additive WI-0255 contract; lifecycle migration pending
- Bounded context: Workkeel task description and legacy migration inspection
- Definition: A role-free description of goal, scope, actor, state, dependencies, acceptance, review separation, handoff and explicit environment/operation constraints.
- Examples: `workkeel.task-contract/v1` validated locally; a read-only legacy Work Item projection with unresolved environment and approval.
- Non-examples: A canonical replacement Work Item, Position Membership, execution grant, verified approval or sandbox.
- Invariants: Valid shape does not authorize execution. Unknown boundaries are unresolved. Actual implementer/reviewer identity separation remains necessary where required. Legacy roles and evidence are preserved rather than rewritten.
- Owner or authoritative source: Human-approved task-first direction, DEC-0008, WI-0255 and `src/task-contract.mjs`.
- Related terms: Agent Identity; Human Principal; Work claim; Task Shape (legacy execution routing, unchanged).
- Last confirmed: 2026-09-23

## Workkeel runtime requirements and model connection

- Status: confirmed for descriptor validation only
- Bounded context: Workkeel task-contract execution description
- Definition: Runtime requirements describe the host/adapter and actual required runtime features; a separate connection describes native model handling or an optional fixed gateway model.
- Examples: User-operated native coding agent; a declared adapter with an explicitly configured LiteLLM gateway alias and credential environment-variable name.
- Non-examples: Generic AI coding/reasoning skill scores, company titles, model quality evidence, adapter support, live provider verification or permission to spend.
- Invariants: Configuration never launches work or reads credentials. Permission/environment, project Skill references and model choice remain distinct. Existing Provider contracts and execution-routing authority remain unchanged.
- Owner or authoritative source: DEC-0008 and WI-0255 contract reference.
- Related terms: Execution Profile; Capability Route (legacy meanings, not removed); Resource Observation.
- Last confirmed: 2026-09-23

## Unresolved terminology

## Task-first canonical record

- Status: implemented in WI-0258, pending candidate qualification
- Bounded context: Opt-in Workkeel project lifecycle
- Definition: A `workkeel.work-item/v1` record in the existing Work Item store, with an immutable approved contract and separate versioned claim, delivery, review, acceptance and append-only operation history.
- Examples: A native task completed by an attributed Agent and a distinct registered reviewer without company Positions.
- Non-examples: A sandbox, authenticated human identity, model turn completion, external publication, or automatic conversion of legacy authority.
- Invariants: Exact candidate and evidence bindings; explicit approving Principal; no silent claim takeover; preserved failed attempts; no generic model-skill catalogue. Host execution boundaries remain the host's responsibility.
- Owner or authoritative source: WI-0258, ADR-0072 and `src/workkeel-tasks.mjs`.
- Related terms: Workkeel task contract; Agent Identity; Human Principal; model connection.
- Last confirmed: 2026-09-23

## Workkeel workflow orchestration

- Status: implemented in WI-0260; final candidate qualification pending
- Bounded context: Optional native-task execution
- Definition: A versioned graph executed through LangGraph and registered trusted runtime adapters, with task/definition/policy pins, attributed approvals and durable progress.
- Examples: Sequential Luna inspection and Sol implementation; direct disjoint parallel branches with one explicit join; a bounded outcome-driven loop.
- Non-examples: A repository knowledge graph, a new inner coding-agent loop, task acceptance, distributed locking or exactly-once external effects.
- Invariants: One run per claim; intent precedes dispatch; missing or ambiguous history blocks replay; a workflow cannot widen task authority; completion remains separate from review and acceptance.
- Owner or authoritative source: Maintainer-approved WI-0260; ADR-0073; `src/workkeel-workflows.mjs` and `src/workkeel-workflow-schema.mjs`.
- Related terms: Graph orchestration; state machine; durable execution; feedback loop; human-in-the-loop.
- Last confirmed: 2026-09-23

## Workkeel policy-based model routing

- Status: implemented in WI-0260; bounded subscription smoke test observed
- Bounded context: Model selection for a workflow node conversation
- Definition: Deterministic selection from approved explicit, non-overlapping rule or default connections, checked against data policy and the host's actual model catalog.
- Examples: Luna for a named bounded inspection node; Sol by default; an explicit approved Astra node.
- Non-examples: Changing an already running desktop chat, a universal model-capability ranking, a second hidden gateway router or inferred subscription savings.
- Invariants: Pin the conversation's selected connection; reject reported model drift; fallback requires confirmed zero dispatch; requested, runtime-confirmed and independently observed model values are distinct; unknown measurements remain null.
- Owner or authoritative source: Maintainer subscription clarification; ADR-0073; `src/workkeel-execution-policy.mjs` and `src/workkeel-codex-runtime.mjs`.
- Related terms: Policy-based routing; runtime adapter; model gateway; resource observation.
- Last confirmed: 2026-09-23

## Workkeel context engineering and Skill application

- Status: confirmed for WI-0260
- Bounded context: Task-relevant repository instructions and derived tool views
- Definition: Selecting relevant project instructions, reading their complete requirements, applying them and checking the resulting output; optionally reducing eligible tool-output size without replacing originals.
- Examples: Applying the documentation Skill to a README request even without an explicit Skill name; a host-owned lossless Headroom view with exact original readback.
- Non-examples: Reading every installed Skill on every step, treating a nonempty record as quality proof, compressing authority, or claiming this Codex adapter compresses native tool output.
- Invariants: Selection, reading, application and verification are distinct; Skill instructions grant no authority; Headroom is planned off/lossless and falls back to originals; the concrete Codex subscription host requires off.
- Owner or authoritative source: `docs/extensions/workkeel-context.md`; native instruction bridge; Skill audit and Headroom modules.
- Related terms: Context engineering; agent harness engineering; Skills; lossless compression.
- Last confirmed: 2026-09-23

## Unresolved compatibility migration questions

| Conflict | Affected contexts | Decision owner | Evidence needed | Revisit trigger |
|---|---|---|---|---|
| Mapping existing Position-based lifecycle ownership and review gates into task-level actor/approval contracts | Work Items, init, actor selection, workflow, Doctor and adapters | Human Principal and migration design owner | Reviewed writer migration, compatibility fixtures and exact-revision independent QA | Follow-up lifecycle migration after WI-0255 |
| Whether a future App Server thread default constrains or is overridden by each turn | Provider launch, usage attribution, Workspace | Tech Lead | Versioned official and installed schema that acknowledges the effective value for a specific turn | App Server adds turn-effective reasoning metadata or changes override semantics |
