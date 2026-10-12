# ADR-0019: Define product specifications and external source contracts

- Status: Accepted
- Date: 2026-08-29
- Extends: ADR-0016 by recording `not-applicable` alongside its three interface delivery modes; the UI ownership and tool-neutral evidence decisions remain in force.

## Context

Temple defines product intent as a framework layer, but a growing project needs a stable path from product purpose to requirements, bounded Feature Specs, and the contracts used by parallel implementers. Without that path, an Agent can treat a prompt, ticket, design artifact, test, or generated summary as the latest requirement without knowing which source owns the decision.

Existing enterprise projects also hold legitimate authority in wikis, issue trackers, office documents, API registries, design systems, and regulated record stores. Requiring a bulk Markdown migration would duplicate truth, lose native workflow and permissions, and block adoption. At the same time, frontend and backend work cannot safely proceed in parallel when interaction, API, state, and error semantics are implicit.

## Decision

### Use contract-guided iterative product specifications

Product definition follows a traceable hierarchy:

```text
Product Charter -> Product Requirements -> Feature Spec -> supporting contracts -> Work Items and evidence
```

Each artifact records a stable ID, status, owner, authoritative location, source revision, parent references, and supersession state. Only approved artifacts govern delivery. Iteration changes the owning source through explicit revision and impact review; implementation, tests, conversations, and generated views do not revise requirements by implication.

A Work Item records one of two product-specification modes. `gate-evidence` is the lightweight default when no indexed product specification governs: the existing Spec gate's named approved-scope and acceptance references remain authoritative for that bounded item, and the item cannot carry `spec_refs` or claim index-based product-scope staleness protection. Indexed UX, UI, API, or technical contracts may still govern their declared subjects. `indexed` requires at least one approved current `spec_ref` before Design and is the expected path for maintained, multi-party, or long-lived product behavior.

Artifact depth scales with product and coordination risk. Small work may combine concise baselines, Standard work uses independently reviewable and traceable specifications, and high-assurance work requires controlled baselines, approvals, retained evidence, and stronger separation. This specification depth is distinct from selecting and satisfying the implemented High-Assurance collaboration profile.

### Support federated, hybrid, and Temple-native adoption

- **Federated:** declared external systems remain authoritative and the repository stores bounded routes and evidence references.
- **Hybrid:** existing sources remain authoritative until touched, while active contracts and new project-native decisions are maintained in the repository.
- **Temple-native:** project-owned repository documents are authoritative by deliberate project choice.

Hybrid is the default for an existing enterprise project. Adoption preserves external formats, IDs, permissions, owners, revisions, approvals, retention, and provenance. Migration occurs only when authorized work touches a bounded source. Conflicts stop acceptance until the responsible owner selects or reconciles authority.

Context Maps, Context Capsules, generated Capability Registries, dashboards, diagrams, search indexes, exports, and AI summaries are derived projections. They cite and route to canonical sources; they never become approval or decision authority. The project-owned specification index is different: it records declared authority and revision metadata, but still does not replace the indexed source body.

### Define tool-neutral UI interaction contracts

An interaction contract maps surfaces, user states, actions, frontend responses, API operations, backend rules, errors, recovery, owners, and acceptance evidence. It complements the UI design brief rather than replacing it.

The contract path is `not-applicable`, `code-first`, `preview-first`, or `design-led`. The machine-readable UI policy records all four values: `not-applicable` explicitly records that no user-facing interface changes, while the other three select the evidence depth for interface work. Figma is one optional artifact, not a framework dependency or universal source of truth.

UX Designer owns interaction structure and usability; UI Designer owns visual treatment and delivery mode; Developer Disciplines own frontend, API, and backend implementation contracts; Tech Lead owns technical interface integrity; a named integration owner assembles the candidate; Quality & Evaluation and Independent QA verify the integrated behavior. These responsibilities do not create new Positions or expand authority.

Parallel child Work Items begin only after shared interaction, API, data, and error contracts are stable enough to reference by revision. Each slice records dependencies, affected paths, required Disciplines, and integration ownership. A deterministic readiness result cannot prove semantic contract completeness.

### Install managed starting templates

The framework installs managed templates for a Product Charter, Product Requirements, Feature Spec, UI interaction contract, and legacy-document audit. Copies created for a product are project-owned artifacts at project-native paths. A copy governs only when it is registered and approved as `temple_native`; a `derived_projection` remains non-authoritative. The templates themselves are not product truth.

## Current implementation boundary

The current implementation installs the managed Markdown templates, a project-owned specification index with authority, approval, revision, and repository-content integrity metadata, versioned Work Item references, and a per-item UI delivery-mode field with prebuild and closeout evidence checks. Alpha.19 separately adds a selectable risk-based High-Assurance profile. It still does not add specification-authoring CLI commands, automatic document migration, external connectors, external write-back, Figma integration, design synchronization, or semantic contract validation. Existing collaboration readiness, Context Map, canonical ownership, and human approval boundaries remain in force.

## Consequences

- Product intent can remain traceable as delivery becomes iterative and parallel.
- New projects gain a repository-native specification path without forcing every project to create the maximum document set.
- Existing enterprises can preserve authoritative systems and migrate active contracts gradually.
- UI, frontend, API, and backend collaborators share explicit state and failure semantics before implementation diverges.
- Projects must maintain authority, revision, and supersession metadata; ungoverned duplicate copies remain a risk.
- External access, proprietary formats, and semantic completeness still require human ownership and project-specific evidence.
