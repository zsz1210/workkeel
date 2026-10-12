# ADR-0046: Separate adaptive execution routing from responsibility and calibration

## Status

Status: Accepted for compatibility design.

## Context

Temple already records Position responsibility, capability discovery, workflow risk profiles, requested and effective model metadata, Token attribution, and matched model evaluations. Those mechanisms did not define one contract for choosing a suitable execution configuration for each step.

Earlier validation exposed the consequences. A fixed Position-to-model assumption could not explain why the same Position needed different reasoning depth across planning, implementation, and mechanical work. Model comparisons also failed to separate task-shape mismatch, missing capabilities, Provider compatibility, quality, and resource use. Repeating more model calls could add cost without correcting that design gap.

The framework must also support future responsibilities beyond software delivery. Video, audio, image, local-model, SRE, or security work may need different modalities, services, hardware, and measures. A Token-only or software-Position-only router would not scale to those cases.

## Decision

Add a distinct adaptive execution-routing layer with these boundaries:

1. Position remains the stable responsibility and authority contract. It never selects a model by itself.
2. A Work Item may contain multiple independently routed Execution Steps.
3. Each step declares a structured Task Shape and a Capability Route with required and optional capability IDs.
4. A project-owned Execution Policy defines Provider-neutral Execution Profiles, optional concrete mappings, ordered rules, an explicit fallback, and typed resource measures.
5. The deterministic resolver filters hard capability, modality, Provider, data, boundary, risk, and resource constraints before preference.
6. `pinned`, `shadow`, and `advisory` are the only supported selection modes. `automatic` remains invalid.
7. The resolved route records requested settings separately from effective Provider observations and performs no Provider contact, task launch, model switch, or canonical mutation.
8. Resource observation covers Tokens and other typed measures; missing evidence remains unknown rather than zero.
9. Usage observation and matched Model Calibration remain separate from route resolution. Calibration may inform project preference, but it does not grant execution authority.

Framework defaults remain Provider-neutral. Each initialized project owns its policy and can map profiles or add capabilities without changing Temple's Position catalog.

## Consequences

- The same Agent and Position can use different profiles for different steps without identity churn.
- Rejected candidates and unresolved routes become explainable before a costly execution attempt.
- Projects can extend routing to content production or specialized local services without making those concerns core Positions.
- Console and status surfaces can show mapping and policy state without pretending work was executed.
- The first implementation is intentionally a resolver, schema, projection, fixture, and documentation foundation—not an autonomous scheduler.
- A future executor requires its own ADR, authority boundary, Provider contract tests, rollback behavior, and evidence threshold.

## Relationship to earlier decisions

- [ADR-0002](0002-position-identity-assignment.md) keeps Position separate from Agent Identity; this decision also keeps Position separate from execution configuration.
- [ADR-0034](0034-attribute-usage-before-routing-models.md) requires attribution before optimization; this decision supplies the missing per-step route contract without weakening that requirement.
- [ADR-0045](0045-adaptive-workflow-profiles.md) selects delivery controls for a Work Item; this decision selects an eligible execution candidate for one step. Neither profile type substitutes for the other.

## Rejected alternatives

- Assign one fixed model to every Position.
- Select from free-form prompt text or Agent display names.
- Treat the cheapest or lowest-Token candidate as best without a quality gate.
- Merge workflow profile, execution profile, and model calibration into one policy.
- Automatically execute an advisory route in the first release.
- Hard-code software-only capabilities or Token-only resource accounting.
