# Token Efficiency and Model Routing

- Status: the current implementation exposes telemetry qualification, project-owned usage and execution policies, progressive calibration, low-confidence shadow candidates, project-configured matched-evaluation advisories, and a deterministic per-step route resolver; model invocation and automatic route execution remain unavailable
- Primary readers: maintainers, Engineering Managers, Tech Leads, Observers, and cost-accountable humans

Temple treats Token usage as an operational signal. The goal is not the smallest prompt or the cheapest individual turn. The goal is a correct, accepted Work Item with less waste, rework, latency, and coordination cost.

## Route resolution is now a separate layer

Model Calibration and Execution Routing answer different questions:

- Calibration asks whether matched project evidence supports preferring one profile for one exact Task Shape.
- Execution Routing asks which project profile is eligible for one current step after capability, modality, Provider, data, boundary, risk, and resource constraints.

The read-only command `temple execution resolve` now supplies the second contract. It can consume calibrated preference later, but it does not launch a model, apply a recommendation, or turn requested settings into effective observations. Position remains responsibility—not a fixed model assignment. See [Adaptive execution routing](../concepts/adaptive-execution-routing.md), [Execution routing operations](execution-routing.md), and [ADR-0046](../adr/0046-separate-adaptive-execution-routing.md).

## Does counting Tokens consume more Tokens?

Usually, no.

| Measurement method | Additional model Tokens | Temple policy |
|---|---:|---|
| Read usage metadata returned by the provider | None | Preferred exact source |
| Run a local tokenizer before or after a request | None | Allowed as an explicitly versioned estimate |
| Read a provider billing or usage API | None for inference; may have API and operational cost | Optional and separately authorized |
| Ask another model to inspect a prompt and estimate its usage | Yes | Prohibited solely for Token counting |

Recording numeric metadata still uses a small amount of local CPU, memory, disk, and dashboard bandwidth. That overhead must be measured separately from model Tokens and kept bounded through aggregation and retention.

Context Capsule v2 also reports a local, body-free source manifest: selected source count, measured bytes, per-source SHA-256, and one stable selection digest. These values require filesystem I/O but no model call. They answer whether a route changed and which source category dominates its repository footprint; they do **not** estimate prompt Tokens, cached-input billing, latency, or price.

OpenAI's Responses API, for example, returns input, cached-input, output, reasoning-output, and total usage fields in the response itself. Current official guidance also recommends comparing model and reasoning configurations on representative tasks by quality, tokens, latency, and cost rather than assuming one configuration is always best. See the [Responses usage schema](https://developers.openai.com/api/reference/cli/resources/responses/methods/retrieve) and [model guidance](https://developers.openai.com/api/docs/guides/latest-model). For Codex, the official [App Server protocol](https://developers.openai.com/codex/app-server/) identifies `thread/tokenUsage/updated` as a thread notification and `account/usage/read` as an account activity query.

## What Temple already has

The control plane can normalize provider-emitted:

- input Tokens;
- cached-input Tokens;
- output Tokens;
- reasoning-output Tokens;
- total Tokens;
- model context-window size;
- an explicit project Token budget and usage-anomaly condition.

It deliberately keeps raw prompts, hidden reasoning, command output, secrets, and full tool payloads out of durable telemetry. Monetary cost remains unavailable without a configured, versioned price source.

Every initialized project now owns `.ai-org/project/usage-policy.json`. The file defines its optimization objective, data boundary, seed profiles, calibration state, cost provenance, and autonomy envelope. Temple upgrades create it only when absent and never overwrite project choices.

### Optional observation modes

Per-Work-Item Token analysis is an optional local capability, not a prerequisite for using the framework:

- **Off** runs no Codex Provider and records missing usage as unknown.
- **On demand** observes eligible registered tasks only while a foreground Control Plane is running.
- **Managed local** is an explicitly installed, reversible, clone-local macOS service for operators who want continuous observation on one workstation.

The Usage view shows the selected mode, service state, retained history, and any completed Work Items after the observation boundary that lack detailed correlation. This gap is evidence of missing attribution, not proof that one particular process failed. Account-wide usage is never allocated back to a Work Item. See [Usage observation](usage-observation.md) for setup, removal, privacy, and multi-machine limits.

Alpha.25 adds a usage-attribution envelope and a read-only baseline report. Every observation carries the dimensions the provider and repository can prove, plus a `missing_dimensions` list and `partial` quality when model, version, service tier, Context Capsule digest, capability digest, or another field is unavailable. Reconciled history labels lifecycle stage as the current canonical stage at reconciliation rather than inventing a historical stage.

Alpha.26 keeps App Server and Desktop/session ownership separate. `thread/read` and `thread/resume` are attempted as independent operations: failure to read history does not prove that live resume is unavailable, and failure to resume does not erase history already read. Each registered task receives a bounded attach outcome with separate `history_read`, `live_resume`, and `attach_outcome` fields. The Provider registry exposes zero-filled outcome counts and a bounded 100-task summary for control-plane observation. Known unsupported, invalid, or missing-session failures use bounded reason codes; their failed operation is suppressed for that task on later provider reconnects instead of creating retry churn. A provider process still retries transient transport failures after a real reconnect.

The missing-session code `thread-not-in-app-server-store` means only that this App Server process cannot resume the registered host-owned thread. It does not mean that the Desktop task is absent, failed, or safe to recreate. Temple retains any available history, marks the provider degraded, and never creates a replacement task automatically.

### Provider-owned launch bridge

Current `main` includes a locally tested provider-owned launch primitive. It follows the official App Server boundary: `thread/start` creates and subscribes the local connection, Temple registers the returned thread as canonical state, and only then may `turn/start` begin generation. If canonical registration fails, no turn is started and no automatic retry occurs.

New task registrations distinguish `codex-host-owned` from `temple-provider-owned` execution. They can retain requested and effective model, reasoning effort, service tier when known, Provider ID, and three separate revisions: claim base, task launch, and current candidate. A successful request does not make the requested model an observed effective model, and the stable App Server launch surface does not currently accept a service-tier override. Legacy task documents remain valid and missing values remain unknown.

For Provider-owned registration, the Provider acknowledgement is the top-level `thread/start` result: `model` supplies `effective_model`, while nullable `reasoningEffort` supplies only the thread-level observation and `serviceTier` supplies the observed service tier. The nested `thread` remains the source of thread identity and lifecycle only. Temple never copies the requested model into a missing Provider acknowledgement.

Reasoning configuration has three separate meanings:

| Field | Evidence | What it proves |
|---|---|---|
| `requested_reasoning_effort` | Temple's exact `turn/start.effort` request | intent for that turn |
| `observed_thread_reasoning_effort` | top-level `thread/start.reasoningEffort` | the Provider's thread-level value |
| `effective_turn_reasoning_effort` | a Provider acknowledgement tied to that turn | the actual turn-effective value, when the protocol exposes it |

The inspected App Server `0.151.0-alpha.7.2` does not expose the third value in `TurnStartResponse`, the Turn record, or Token-usage notifications. Temple therefore records it as unknown. It does not infer it from the thread value, the requested value, reasoning-output Tokens, latency, or model output. The legacy `reasoning_effort` field remains as a source-labelled compatibility projection with `reasoning_effort_source`; consumers must not call it turn-effective evidence unless the source is `provider-turn`.

The normalized `model/rerouted` notification retains only the correlated thread and turn identifiers, canonical task and Work Item identifiers when exactly one registered thread matches, bounded `from_model`, `to_model`, and the Provider reason. For a valid correlated `toModel`, Temple updates the canonical task through the ordinary mutation boundary before appending the reroute observation; serialized notification processing then ensures later Token usage sees that effective model. An uncorrelated or malformed reroute remains observable but cannot update another task. A correlated update failure degrades the Provider, does not retry or select a fallback model, and does not retain raw Provider payloads.

An internal read-only label must be mapped to the installed App Server
`thread/start` wire value. Offline mocks alone do not prove wire compatibility;
verify the installed schema before a bounded live call.

### App Server protocol compatibility gate

Before a future live proof, Temple keeps its caller vocabulary separate from the inspected App Server wire contract:

| Temple internal policy | `thread/start` | `turn/start` |
|---|---|---|
| `readOnly` | `read-only` | `sandboxPolicy.type = readOnly` with network disabled |
| `workspaceWrite` | `workspace-write` | `sandboxPolicy.type = workspaceWrite` with explicit writable roots and network policy |
| `never` | `never` | `never` |
| `onRequest` | `on-request` | `on-request` |
| `unlessTrusted` | `untrusted` | `untrusted` |
| `onFailure` | unsupported; fail before Provider contact | no request |

Tests should validate emitted requests against separately inspected provider
enums rather than teaching a fake Provider to accept internal names. A Provider
rejection exposes only a stable reason, integer JSON-RPC code when available,
and bounded category; the raw message remains outside durable launch state.

Passing the compatibility gate proves local encoding and fail-closed behavior only. No Dashboard launch control or remote mutation route exists, and another real proof still requires explicit approval for its exact model, reasoning, instruction, Token threshold, retry ceiling, and wall-clock boundary.

The effective-model attribution correction is likewise a local gate. Passing its contract tests and Independent QA authorizes only a separately governed one-turn revalidation. It does not qualify the instrumentation path, enable automatic routing, or start the four-repository rehearsal.

Create a read-only report:

```bash
node ./templew.mjs usage report . --no-write --json
```

Remove `--no-write` to create `.ai-org/views/usage-baseline.json`. The report sums provider last-usage deltas instead of cumulative totals, groups drivers by the attribution dimensions below, and leaves monetary cost unknown without a versioned price source. This remains observation infrastructure, not a completed optimization system.

The report combines the active journal with bounded local journal archives so a Control Plane rebuild does not erase provider-only Token evidence from the Usage view. Archive cursors are not globally comparable, so Temple deduplicates by the Provider event identity (`source` plus `id`). Equal identities count once; conflicting identities are excluded entirely. Only a strict usage-only projection is retained in memory. Arbitrary event data, prompts, responses, instructions, tool payloads, hidden reasoning, and credentials do not enter the report.

Read `source.history` before interpreting the totals. `complete` means all eligible bounded archive files were read, `active-only` means no eligible archive contributed, and `partial` means at least one archive or identity was excluded. Counts cover active and archived observations, duplicates, conflicts, skipped files, and applied limits. These are coverage diagnostics, not cryptographic archive verification or lifecycle authority.

### Read longitudinal coverage

`source.longitudinal_coverage` compares three bounded sources without promoting an observation into canonical state:

- `canonical_work_items` counts repository Work Items and identifies those in `done`;
- `registered_task_coverage` reports how many completed Work Items have a registered Codex task;
- `task_eligibility` separates live-resumable tasks, history-reconcilable tasks, historical-only tasks, terminal tasks, and detached archived tasks;
- `detailed_token_observation_coverage` counts only an exact Work Item/task pair as correlated and reports `observed`, `partial`, or `unknown` support for each Token field;
- `qualification` shows the remaining gap to the project's diagnostic observation threshold;
- `recommendation` is a deterministic, read-only exploratory candidate only after that threshold and a within-shape, two-model comparison with at least two accepted Work Items per model.

The lists are sorted so coverage does not depend on repository-directory or task-registry order. A provider event with a missing or mismatched Work Item/task pair remains uncorrelated. A detailed event may prove one Token field while others remain `unknown`; if any included observation lacks a field, that aggregate remains unknown instead of treating the missing value as zero.

Qualification is deliberately strict. A Work Item contributes only when it is currently `done`, its registered task is `completed`, its Work Item/task pair matches, the observation revision matches the task's launch revision when recorded (otherwise its current revision), the Position and task shape are known, the Position matches the registered task, a provider-reported `total_tokens` delta is present, and the model is known. Mismatched, stale, partial, zero-field, and uncorrelated observations remain visible but do not fill the threshold. Multiple task/model/shape identities for one Work Item are excluded rather than cherry-picked.

The default ten-Work-Item count is only a **diagnostic observation threshold**. It is not a universal sample-size claim and never qualifies automatic routing. NIST notes that a defensible sample size depends on assumptions such as variance, meaningful effect, and decision risks; there is no correct context-free number. See [NIST sample-size guidance](https://www.itl.nist.gov/div898/handbook/prc/section2/prc222.htm).

Even when the exploratory candidate is available, its confidence is `low`, its evidence basis is `accepted-closeout-token-observation-only`, and `matched_evaluation` remains false. Different Work Items can differ in difficulty, so lower observed Tokens do not prove superior model quality or causal savings. Savings, cost, model-quality, and routing claims remain disabled unless the project separately configures a statistical decision contract and produces matched quality evidence.

The report places this observation at `source.longitudinal_coverage.recommendation` and mirrors it at `routing.shadow_recommendation`. A separately configured matched result appears at `routing.matched_advisory`, with `routing.recommendation_source` identifying which source is currently presented. The top-level routing executor remains `not-implemented`: every result has zero routing authority and cannot change a task or model.

## Evaluate project-owned matched evidence

Temple can evaluate an existing project-owned comparison without launching a model:

```bash
node ./templew.mjs usage evaluate . \
  --fixture .ai-org/evaluations/model/example.json \
  --no-write --json
```

To include an evaluation in ordinary `usage report` and `usage preflight` output, list its repository-relative path under `calibration.matched_evaluation.sources` in `.ai-org/project/usage-policy.json`. Temple reads only those explicitly configured JSON files below `.ai-org/evaluations/model/`; it does not scan for candidates, follow a symlink outside the repository, or promote a preview fixture into canonical evidence.

The current evaluator supports the versioned `paired-sign-test-v1` method and the `balanced` policy objective. The policy's statistical status must be `satisfied`, and the evaluation's method, minimum effect, alpha, power, and pilot variance must exactly match the project policy. This is a reproducibility contract, not a claim that one method or case count is universally correct.

Every candidate must use the same exact task shape, rubric, case IDs, input digests, and source revisions. Requested and effective provider, model, and reasoning evidence must also match a configured Seed Policy profile. Temple first rejects any candidate that misses the quality threshold. Only then does it compare paired Token use and apply the configured minimum effect and exact two-sided sign test; latency, rework, human intervention, and profile ID are deterministic tie-breakers.

The evaluation document contains structured scores, numeric resource measures, bounded evidence references, and provenance. Raw prompts, responses, hidden reasoning, credentials, and raw provider payloads are prohibited. Expired, mismatched, incomplete, unsafe, or privacy-invalid evidence fails closed. A qualified result in `shadow` mode remains a shadow result; `advisory` mode permits a read-only recommendation only. Even a policy value of `automatic` does not activate an executor in this release.

## Check whether a real baseline is possible

Run the preflight before interpreting a zero or missing usage report:

```bash
node ./templew.mjs usage preflight . --json
```

The command is read-only. It separates two sources that must not be merged:

| Source | What it can prove | What it cannot prove |
|---|---|---|
| `thread/tokenUsage/updated` | Usage for an observed provider thread, with Work Item and task attribution when the registered thread matches | Account billing totals or a project it did not observe |
| `account/usage/read` | Whether Codex-backed account activity fields and daily buckets are available | Which project, Work Item, Position, Agent, task, model, outcome, price, or cost produced that activity |

Capture health reports one of four current states. It is intentionally separate from whether historical evidence exists:

- `capturing`: the Codex Provider is ready, detailed Token notifications are supported, and at least one eligible active registered task can be observed;
- `ready-no-live-task`: the Provider is ready, but no eligible active registered task is attached, so there is nothing current to observe;
- `historical-only`: one or more detailed observations are retained, but the current Provider path is not ready. Totals stop at `last_observed_at` and must not imply that later work was measured;
- `not-capturing`: no detailed observation exists and the current Provider path cannot collect one. Missing usage stays unknown, not zero.

The report also exposes `evidence_status` as `observed` or `none`, the last successful capture time, eligible live-task count, and completed-Work-Item coverage. A ready Provider does not prove that a notification has arrived, while an old observation does not prove that capture is still running.

Completed tasks and tasks attached to `done` or `cancelled` Work Items remain eligible for bounded history reconciliation, but Temple never resumes them as live subscriptions. Archived tasks remain detached from Provider reconciliation. Registering a Codex task does not itself create or take ownership of a live task.

`usage preflight` uses the same completed-Work-Item qualification as `usage report`; a first Token observation is still `not-qualified`. If the threshold is met it includes the same exploratory candidate. It also evaluates the project-configured matched sources and exposes their status separately. Both paths include authority-denial flags and never change a model setting.

An optional account capability probe must be requested explicitly:

```bash
node ./templew.mjs usage preflight . --probe-codex-account --json
```

The probe makes no model-generation request. It retains only endpoint availability, returned field names, whether daily buckets exist, their count, and local request latency. It deliberately discards account Token values and labels the result `account-wide` and `unallocated`. Account activity can never qualify the project baseline; only correlated detailed thread observations can do that.

The preflight's local parsing, process startup, JSON exchange, and reporting consume a small amount of CPU, memory, time, and output bytes. `measurement_overhead` reports probe latency and confirms that no model call was used for Token counting. Temple does not yet claim that this overhead or the resulting measurements reduce Tokens.

## Attribution contract

Each usage observation should carry the dimensions the provider and Temple can prove:

| Dimension | Why it matters |
|---|---|
| `project_id` | Separates authoritative project boundaries |
| `work_item_id` | Connects consumption to one intended outcome |
| `position_id` | Shows which responsibility used the context |
| `lifecycle_stage` | Distinguishes Spec, Design, Build, Test, Eval, QA, and Release Gate |
| `task_id` and provider task ID | Identifies the actual execution session |
| attempt or retry chain | Exposes repeated work and failure loops |
| provider, model, and effective model version | Makes comparisons reproducible |
| requested, thread-observed, and turn-effective reasoning configuration plus service tier | Separates execution intent from Provider evidence and exposes protocol gaps |
| Context Capsule and capability-set digest | Detects repeated or oversized routed context without storing its body |
| source and quality | Distinguishes provider-reported, locally estimated, and unknown usage |
| outcome | Relates usage to accepted, rejected, blocked, or abandoned work |

One Agent Identity may hold several Positions. Attribute usage to the effective Position and lifecycle stage at event time, not to the display name alone. Missing correlation is `unknown`, never zero and never silently assigned to the nearest task.

## Finding the consumption driver

A high Token count is a lead for investigation, not proof of waste. The Observer should support drill-down in this order:

1. Project and Work Item.
2. Position and lifecycle stage.
3. Agent task and attempt chain.
4. Provider, model, reasoning configuration, and service tier.
5. Input, cached input, output, and reasoning-output composition.
6. Context Capsule size, capability set, tool-call count, retry count, and final outcome.

For stage analysis, keep four measurements separate:

| Measurement | Meaning |
|---|---|
| Source-manifest bytes | Unique selected repository file bytes before a caller chooses what to open |
| Provider input and cached input | Context the Provider actually reports for the model turn |
| Model or critical-path time | Provider execution time or end-to-end stage time, labelled by source |
| Tool-output bytes | Local command output exposed to the execution context, when the harness can measure it |

Do not add source bytes to provider Tokens or sum sequential model time and parallel critical-path time into one latency claim.

Useful initial measures include:

- total Tokens per accepted Work Item;
- Tokens per passed lifecycle gate;
- retry and abandoned-attempt share;
- cached-input ratio and repeated-context share;
- context loaded but not referenced in the final evidence path;
- Token change alongside acceptance rate, defects, rework, elapsed time, and human intervention.

Temple should call this **usage-driver analysis**, not blame an Agent or Position for being a "culprit." Product discovery, architecture, security review, and Independent QA may justifiably consume more Tokens when they prevent expensive failure later.

## Budget contract

Budgets may be declared at project, Work Item, Position, lifecycle-stage, or task level. More-specific policies can tighten a parent budget; relaxing an organizational limit requires explicit authority.

The project policy uses **Credits** as its accounting unit because that is the user-facing resource that may matter operationally. A Credits value remains `unknown` until the project supplies a versioned authoritative source and effective date. Token ceilings remain useful as reactive runtime safety guards, but they are not financial limits and cannot prove that an account will not be charged.

The first implementation uses budgets as:

- forecasts before dispatch;
- warnings as consumption approaches a threshold;
- anomaly signals after an unexpected spike;
- inputs to a human-approved routing recommendation.

A budget must not authorize Temple to remove required specifications, evidence, privacy controls, Independent QA, or approval gates. When safe completion cannot fit the budget, Temple escalates the conflict instead of silently degrading the work.

## Progressive Project Calibration

Temple does not assume that one person's results or one repository's optimal route applies to another project. Each project begins with a provider-neutral Seed Policy and learns only from its own correlated evidence by default.

Calibration progresses through explicit states:

1. `cold-start` — use Seed Policy profiles and collect evidence;
2. `exploratory` — show usage drivers and shadow candidates;
3. `calibrating` — run representative matched evaluations after the project defines quality measures and statistical assumptions;
4. `calibrated` — permit a separately implemented routing executor only inside the approved policy;
5. `stale` or `invalid` — fall back to the Seed Policy when models, prices, task distribution, or evidence no longer match.

Raw observations remain project-local. Organization-level aggregates and anonymous framework learning are independent opt-ins and are disabled by default. A future shared learning service must never silently pool private project telemetry.

Task shape is more than Position and lifecycle stage. The policy requires task kind, risk class, and Context Profile digest for a statistically meaningful comparison. The current Position-and-stage identifier remains a fallback for descriptive reporting and cannot by itself qualify automatic routing.

## Autonomy without approval gridlock

Temple's project policy uses an **exception-only autonomy envelope**:

- routine, reversible, local-only work inside approved scope, configured budget, provider allowlist, and confidence boundary proceeds automatically;
- approval is required only for external spend, external writes, irreversible action, deployment or release, privacy-boundary changes, an unapproved provider or model, budget exceedance, high-risk low-confidence decisions, or a policy change.

This does not remove lifecycle evidence or separation of duties. It removes redundant per-task approval for ordinary in-envelope decisions. In this release, routing execution is still not implemented, so neither a shadow candidate nor a matched advisory can switch a model even when no approval is needed to inspect it.

## Model-routing contract

Positions provide useful defaults, but Position alone is not enough to choose a model. Routing also considers task shape, lifecycle stage, risk, required capabilities, context size, privacy, latency, provider availability, and the project's spending policy.

Examples of reasonable defaults—not hard-coded model names—are:

- Product Manager and Tech Lead: broader context and stronger synthesis for consequential scope or architecture decisions.
- Developer: bounded code and contract context, with capability scaled to implementation difficulty.
- Quality Evaluator and Independent QA: exact candidate, acceptance criteria, and evidence with sufficient independence and reasoning quality.
- Observer: compact structured projections and inexpensive deterministic aggregation whenever model judgment is unnecessary.

Concrete model preferences belong to project-owned policy, not the
framework-managed template. The following profiles are illustrative:

| Profile | Model and reasoning | Typical Temple task |
|---|---|---|
| `critical-planning` | `gpt-5.6-sol`, `xhigh` | consequential planning, architecture, security, migrations, and high-risk review |
| `standard` | `gpt-5.6-terra`, `medium` or `high` | ordinary implementation, diagnosis, documentation synthesis, and broad exploration |
| `lightweight-quality` | `gpt-5.6-luna`, `max` | semantic ambiguity or invariant-sensitive work that justifies an advisory quality escalation |
| `mechanical-fast` | `gpt-5.6-luna`, `medium` or `low`, or no model | formatting, extraction, inventory, repetitive transformation, and deterministic checks |

These are coordinator choices for the exact task, not automatic-routing behavior and not defaults imposed on repositories that adopt Temple. Task shape and risk take precedence over Position or Agent display name. Explicit human task-level selection still wins within the authorized scope and spending boundary, and a fallback outside the GPT-5.6 family requires an explicit exception. Requested and effective model remain distinct facts.

OpenAI's current [GPT-5.6 guidance](https://developers.openai.com/api/docs/guides/latest-model) describes Luna for efficient high-volume work, Terra for a balance of capability and cost, and Sol for flagship capability. Higher reasoning effort can improve difficult-task quality while increasing Token use and latency. `Luna max` is therefore a deliberate quality-first lightweight profile, not a claim that every task becomes cheaper or better. Temple still requires project-specific evaluation before automating any choice.

Selection precedence is:

1. mandatory High-Assurance, privacy, data-residency, capability, and spending requirements;
2. an explicit human override for the exact task when it remains inside those boundaries;
3. project and Work Item routing policy;
4. Seed Policy profile selected by task shape and risk;
5. provider default, recorded as such.

Every routed task records requested and effective provider, model, model version or alias resolution when available, reasoning configuration, service tier, routing-policy version, and fallback reason. An unavailable preferred model must not silently fall back to a model that violates a capability, privacy, or risk requirement.

## Evaluation before automation

Model choice is promoted only after representative evaluations compare:

- acceptance and task-success rate;
- required evidence completeness;
- defect and rework rate;
- total and cached Tokens;
- latency and human intervention;
- monetary cost when a user-approved versioned price source exists.

The current release shows observations, calibration blockers, shadow candidates, and read-only results from explicitly configured matched-evaluation files. It does not run the evaluation cases or apply the recommendation. Opt-in automatic routing requires a separately implemented executor, a project-approved autonomy boundary, reproducible evidence, and a safe fallback. Adaptive self-modifying routing is later scope.

## Cost and pricing boundary

Token counts are not monetary cost. Cost also depends on provider, model, date, input or output class, cache reads and writes, service tier, currency, discounts, and provider-specific billing rules.

Temple therefore:

- stores numeric usage independently from price;
- accepts price data only from an identified, versioned, user-approved source;
- records the pricing source and effective date with every calculated projection;
- never purchases capacity, changes plans, or authorizes spending;
- marks cost `unknown` when usage or pricing provenance is incomplete.

## Privacy and retention

Usage reporting retains bounded identifiers and numeric measurements. It does not require raw prompts, hidden reasoning, source-code bodies, tool payloads, credentials, or personal data. Portfolio aggregation should prefer project-level summaries and drill-down links to the authoritative project rather than copying detailed telemetry across repositories.

## Delivery slices

1. **Telemetry qualification — implemented:** `usage preflight` distinguishes live task readiness, detailed observations, and optional account-wide capability without mixing their authority.
2. **Attribution — implemented:** normalized usage includes proven Work Item, Position, observed stage, task, attempt, provider, model, provenance, quality, and outcome fields; unavailable values stay unknown.
3. **Reporting — longitudinal coverage implemented:** `usage report` compares canonical Work Items, registered task eligibility, exact correlated observations, revision freshness, task shapes, and per-field support.
4. **Provider-owned execution — locally implemented, live proof pending:** fake App Server tests enforce thread creation, canonical registration, and then turn start without prompt retention or automatic retry.
5. **Policy foundation — implemented:** project-owned Seed Policy, data scope, Credits provenance, progressive calibration state, and exception-only autonomy are schema-validated without automatic switching.
6. **Recommendation — matched advisory evaluator implemented:** keep unmatched longitudinal observations as low-confidence shadow candidates; evaluate explicitly configured project-local matched evidence with a quality-first statistical contract and explicit non-authority. Real representative evaluation data remains project work rather than a framework claim.
7. **Opt-in routing — later:** apply an approved route, record the effective configuration, and preserve fallback and refusal evidence.

None of these slices changes lifecycle authority or replaces outcome-based evaluation.
