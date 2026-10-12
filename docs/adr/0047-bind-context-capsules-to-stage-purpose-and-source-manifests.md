# ADR-0047: Bind Context Capsules to stage, purpose, and measured source manifests

- Status: Accepted
- Date: 2026-09-04

## Context

Temple routes a known Work Item to a bounded set of repository paths. The
original capsule did not say whether it was prepared for primary work,
integration, or recovery, and did not expose the byte footprint or content
identity of selected sources.

Without those facts, a caller can repeatedly load a route intended for a different stage, cannot tell whether the selected context changed, and cannot evaluate an optimization without relying on model Token observations after the fact.

## Decision

Temple will generate Context Capsule v2 with four additional boundaries:

1. Every resolution is bound to one effective lifecycle stage and one purpose: `primary`, `integration`, or `recovery`. The current Work Item stage is the default; an explicit stage is accepted only when it exists in the configured workflow.
2. Context Map v2 routes may declare optional `stages` and `purposes`. Empty arrays mean all stages or purposes. Context Map v1 remains readable and is treated as unscoped.
3. The generated capsule contains a deterministic selection manifest for the selected repository files. Each safe, regular, in-repository file contributes its path, categories, byte size, and SHA-256 digest. Source bodies are never copied into the capsule.
4. A capsule states its fallback boundary. `TEMPLE.md` is recovery context, not a mandatory body for every known bounded Work Item. Missing authority or an incomplete route is surfaced as a warning rather than silently broadening the prompt.

The selection manifest measures repository bytes, not model Tokens. Provider-reported input, cached input, output, reasoning output, latency, and tool-output measurements remain separate observations.

## Topology

The contract is independent of repository topology:

- one repository resolves one local manifest;
- a coordinator-led workspace may prepare a component-scoped route without making the component an autonomous lifecycle authority;
- an autonomous federation resolves a separate capsule within each participant repository, which keeps its existing authority.

This ADR does not introduce coordinator-owned lifecycle authority across repositories. Such a mode requires a separate authority and upgrade decision.

## Consequences

- A fresh Agent can compare the selection digest before reopening unchanged context.
- Build and Integration routes can be measured independently instead of being inferred from one aggregate Token total.
- Projects can incrementally add stage or purpose constraints; legacy routes keep working.
- Local hashing adds bounded filesystem I/O but no model Tokens and retains no source bodies.
- Byte size is useful for change detection and route composition, but cannot be presented as a Token or price estimate.
- A later cold-handoff comparison can test whether the new route reduces repeated context without weakening recovery.

## Rejected alternatives

- **Load the full operating contract for every turn.** This preserves information but repeats context that a known Work Item route should already narrow.
- **Use a vector database as the first fix.** The observed problem is route composition and repeated loading, not evidence that deterministic retrieval failed semantically.
- **Set a guessed Token budget per stage.** One matched scenario is not sufficient to establish a generally valid threshold.
- **Store source bodies in the capsule.** This creates duplicate authority, larger generated artifacts, and a new privacy surface.
