# Model and process evaluation

Use this method when you need evidence that a Temple workflow change or model choice improves delivery. It is designed for recurring comparisons—not just one benchmark—and keeps quality, Token use, latency, cache behavior, rework, and human intervention visible without turning a test result into automatic routing authority.

Start from the [non-executable draft protocol](model-process-evaluation-protocol.json)
and copy it into the task's private workspace. Replace every placeholder,
freeze its digest, and obtain exact approval before any Provider generation.
The draft itself is non-executable.

## Choose one question

Do not change the process and model at the same time unless you intentionally design a factorial experiment.

| Evaluation | Change | Hold constant | Suitable question |
|---|---|---|---|
| Process-only | Temple workflow, Context Capsule, Skill, gate, or prompt assembly | Model, reasoning, task fixtures, output schema, sandbox, tools | Does the revised process improve accepted delivery? |
| Model-only | Model or reasoning configuration | Temple process, context, prompt, tasks, output schema, sandbox, tools | Is the new model better for this exact Task Shape? |
| Process-by-model factorial | Both factors, with every planned combination | Fixtures, scoring, environment, controls | Does one model benefit from the process differently? |

A comparison that changes both process and model without every planned combination is confounded. It may be useful as a rehearsal, but it cannot identify which change caused the result.

## Freeze the contract before the result

Every live evaluation needs a versioned protocol that binds:

- the decision to be made and falsifiable hypotheses;
- exact repository and fixture revisions;
- representative Task Shapes and objective expected results;
- arm definitions, model IDs, reasoning settings, process profile, prompt assembly, output schema, sandbox, and tool policy;
- assignment order and the source of randomness or counterbalancing;
- cache-control method and its evidence;
- quality gates, metrics, sample-size basis, limits, stop conditions, privacy, and authority exclusions;
- the Provider contract, protocol digest, and exact account-impact approval.

Do not choose a universal repetition count or Token ceiling from another project. Run deterministic rehearsal first, then a bounded pilot. Use pilot variance, the minimum effect worth acting on, and the desired error tolerance to set the next sample size. A small diagnostic sample can reveal a defect; it does not establish a general policy.

## Control cache explicitly

Provider cache behavior can dominate net Operational Tokens. A fresh thread is not proof of a cold cache. Choose and verify one method before the run:

1. **Provider cache disabled** — use only when the Provider acknowledges the control and cached-input usage remains zero.
2. **Matched cache share** — predeclare a balance tolerance from Provider behavior and pilot evidence, then pair arms within the same task/repetition block.
3. **Randomized blocks** — distribute order and cache-state variation across enough independent blocks, and analyze block effects.
4. **Uncontrolled** — keep the result descriptive and block causal efficiency claims.

Never invent a cache-balance threshold after seeing the result. If the Provider cannot expose sufficient cache evidence, report the limitation instead of treating cached input as ordinary input or zero.

Always report these values together:

```text
non-cached input = gross input - cached input
Operational Tokens = non-cached input + output
cache share = cached input / gross input
```

Operational Tokens are a project analysis unit, not a bill. Monetary claims require a separately versioned price or Credits source that was effective during the run.

## Gate quality before efficiency

Each candidate first has to pass the same objective task oracle. Prefer typed facts, tests, exact revisions, and acceptance checks over prose similarity. When human judgment is unavoidable, freeze the rubric and blind arm identity; record the judge model as another measurement dependency.

After the quality gate, compare at least:

- gross, cached, non-cached, output, reasoning-output when available, and Operational Tokens;
- wall-clock and turn latency;
- tool and source acquisition;
- human interventions and rework;
- failures, censoring, retries, fallback, and model reroutes;
- repetition-level values, dispersion, missingness, and protocol deviations.

Keep correctness, route adherence, and efficiency as separate hypotheses. A smaller context package is not proof that the Agent read less; a lower mean is not a causal result when cache control failed.

## Safe execution sequence

1. Create a bounded Work Item and state the decision, baseline, candidate, and non-goals.
2. Build deterministic fixtures, objective oracles, and a generation-free rehearsal.
3. Research and verify the live Provider contract. Do not assume model name, reasoning controls, usage fields, cache behavior, or pricing from an older model.
4. Run a bounded pilot to expose failure modes and derive limits—not to declare a winner.
5. Freeze the protocol, order, cache method, analysis rule, digest, and approval template.
6. Obtain exact approval for the protocol and account-impact boundary.
7. Run each condition once. Stop at the first run-level violation; do not silently retry or fall back.
8. Seal the raw bounded observation, then compute deterministic analysis and a human report.
9. Use a different Agent Identity for Independent QA and reproduce the exact candidate revision.
10. Record a Lesson. Promote a routing Practice only after repeated, matching evidence and explicit adoption.

For multi-repository execution controls, continue with [Validation programs](validation-programs.md). For how results may influence—but not automatically control—model choice, see [Token Efficiency and Model Routing](token-efficiency-and-model-routing.md) and [Execution routing](execution-routing.md).

## When a new model appears

Treat a newly released model, such as a future GPT-6, as an unverified Provider capability rather than a drop-in replacement:

- verify its exact model ID, availability, reasoning controls, context limits, tool behavior, structured-output support, usage fields, caching, service tier, and price source;
- run compatibility and objective-quality tests before efficiency comparison;
- compare it with the current baseline on the same representative Task Shapes and frozen Temple process;
- add process-by-model testing only if the model-only result suggests a meaningful interaction worth measuring;
- keep the result project- and Task-Shape-specific until other evidence supports broader guidance.

Passing this evaluation may support a project recommendation. It never authorizes spending, release, publication, automatic routing, or a framework-wide default by itself.
