# ADR-0034: Attribute usage before routing models

- Status: Accepted
- Date: 2026-08-30

## Context

Temple already receives numeric Token usage from capable providers and can warn against one explicit project budget. It does not yet explain which Work Item, Position, lifecycle stage, attempt, context route, or model drove the usage. Automatically choosing a cheaper model without that attribution can reduce per-turn cost while increasing retries, defects, or total delivery cost.

Provider model catalogs, aliases, reasoning settings, cache behavior, prices, and availability change. A fixed Position-to-model table would age quickly and ignore task risk and capability requirements.

## Decision

Temple will separate usage observation, attribution, recommendation, and execution.

1. Prefer provider-reported usage metadata. A local deterministic tokenizer may produce a labeled estimate; Temple never invokes a model solely to count Tokens.
2. Attribute observations to proven project, Work Item, Position, lifecycle stage, Agent task, attempt chain, provider, effective model, and outcome dimensions. Missing dimensions remain `unknown`.
3. Store numeric usage separately from monetary cost. Cost requires a versioned, user-approved pricing source and preserves provider, model, cache, tier, currency, and effective-date provenance.
4. Use Position and stage as routing defaults, not the complete decision. Risk, capability, context, privacy, latency, availability, and spending policy constrain eligible models.
5. An explicit human override has precedence only within configured privacy, capability, and spending boundaries. Record requested and effective routing plus fallback reasons.
6. Start with reports and recommendations. Automatic routing is opt-in and requires representative evaluation evidence. A budget cannot authorize skipped context, evidence, QA, or approval.

Official OpenAI documentation is one current implementation input: the [Responses usage schema](https://developers.openai.com/api/reference/cli/resources/responses/methods/retrieve) exposes input, cached-input, output, reasoning-output, and total usage, while [model guidance](https://developers.openai.com/api/docs/guides/latest-model) recommends representative quality, Token, latency, and cost comparisons. Temple's contract remains provider-neutral.

## Consequences

- Reading provider usage metadata adds local processing and storage but no extra inference Tokens.
- Maintainers can investigate usage drivers without retaining raw prompts or blaming a Position from totals alone.
- Model recommendations become reproducible and reviewable rather than hidden heuristics.
- The first Phase 4 slice does not automatically switch models or claim savings.
- Providers with incomplete telemetry produce partial or unknown reports instead of fabricated zero usage or cost.
