# ADR-0014: Define Temple as an AI Development Organization Framework

- Status: Accepted
- Date: 2026-08-29
- Supersedes: The use of "toolkit" as Temple's product category in ADR-0007; ADR-0007's central-brand versus installed-project identity boundary remains in force.

## Context

Temple began by addressing lost context, duplicate work, unstable task titles, and file-based continuity. Its implemented and planned scope is broader: it connects product definition, stable responsibility and authority, reusable engineering methods, lifecycle orchestration, evidence-gated delivery, and recoverable project state. Calling it only a toolkit understates that operating model and makes individual commands or Skills appear to be the product.

The category must also avoid claiming that the current alpha already supports every project size. A stable framework can define extension and scaling principles before every profile, pack, adapter, and control-plane surface is implemented.

## Decision

The public product name is **Temple — AI Development Organization Framework**.

The framework has six connected layers:

1. product intent and domain;
2. organization and authority;
3. engineering methods and capabilities;
4. work orchestration;
5. verification and delivery;
6. durable state and observability.

Scale is expressed through stable responsibilities with variable staffing, method depth, artifacts, and gates in proportion to risk. Documentation must distinguish what the current alpha ships from future profiles and integrations.

`Temple`, `temple`, `temple.lock`, schemas, and other technical identifiers retain their compatibility roles. Once installed, the operating organization and its artifacts remain part of the product repository and use project-native language, as required by ADR-0007.

## Consequences

- README, Vision, Roadmap, package description, and current architecture documentation use Framework as the product category.
- Commands, Skills, packs, and files are components of the framework, not separate definitions of the product.
- Historical ADR wording may retain "toolkit" as context, but active documentation does not treat it as the current category.
- Claims about larger or higher-risk projects must identify planned profiles and evidence gaps until those paths are implemented and validated.
