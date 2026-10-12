# ADR-0021: Derive safe group dispatch waves without taking runtime authority

## Status

Accepted.

## Context

Individual parallel readiness can say whether one Work Item has enough scope, contract, ownership, and evidence metadata. It cannot decide which set of items may start together, respect dependencies inside a decomposed parent, apply runtime capacity, or show when a previously safe decision has become stale.

Making every Agent queue work manually wastes available concurrency. Letting a CLI invent tasks or create execution sessions would cross product, application, and external authority boundaries. A usable organization therefore needs a group-level plan that is deterministic and observable while remaining separate from runtime side effects.

## Decision

Add `temple parallel plan` and the generated `temple.parallel-plan/v1` view.

The Engineering Manager remains responsible for decomposition. The CLI selects all active Work Items or all descendants of a named parent, evaluates existing readiness and specification contracts, builds dependency and affected-path conflict graphs, and assigns dispatchable work to stable waves. Selected dependencies may appear in earlier waves. Unresolved write overlap cannot share a wave, and a same-wave overlap exception requires both Work Items to name each other explicitly.

Planning is parallel-by-default only when the work is safe and implementation is already authorized. A capable Agent runtime may dispatch the first fresh wave up to its available capacity without seeking a redundant parallelism confirmation. A runtime without concurrent workers preserves the same wave and executes sequentially.

The generated manifest records suggested task titles and bounded context commands, but it creates no Codex task, Work Item claim, or external action. Actual tasks and claims retain their existing explicit registration and Principal-backed contracts.

Each wave has an Integration Owner join gate for exact candidate revisions, verification results, and unresolved items. Canonical changes make the plan stale. The runtime must replan after the join before dependent work or lifecycle advancement. Status, doctor, and Context Capsules expose plan validity and freshness.

## Consequences

- Independent work can use available runtime concurrency without redefining Position authority or approval boundaries.
- Dependency, path-conflict, and capacity decisions are reproducible from repository state.
- `sequential` remains a legitimate disposition rather than a planning failure.
- Conservative repository-wide fingerprinting may mark a scoped plan stale after an unrelated Work Item change; this favors safe replanning over an incorrectly current manifest.
- Future waves are forecasts. Only the first wave of a fresh plan is immediately dispatchable.
- The CLI remains independent of any one task runtime and cannot prove semantic merge safety or distributed coordination.
- Real multi-human and multi-machine validation remains a separate evidence gate.

## Alternatives considered

### Let each Agent decide from chat

Rejected because separate tasks cannot reliably observe the same scope, dependency, or evidence state.

### Create tasks and claims directly from the CLI

Rejected because task runtimes are environment-specific and a planning command must not acquire execution or external mutation authority.

### Serialize every Work Item with an overlap

Rejected because explicit, bidirectional coordination can demonstrate that overlapping declared roots contain safely separated writes. The exception remains visible and reviewable.

### Treat a generated plan as canonical state

Rejected because dispatch plans are derived from Work Items, contracts, identities, and collaboration state. Making the projection authoritative would create competing truth and make stale decisions harder to detect.
