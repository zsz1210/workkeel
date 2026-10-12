# ADR-0022: Reserve governed work before creating a runtime worker

- Status: Accepted
- Date: 2026-08-30
- Scope: Phase 2A recovery and runtime coordination

## Context

Safe parallel-wave derivation is plan-only. Pilot use exposed operational
gaps after planning: CLI discovery, claims before worker start, separation of
internal workers from user-owned tasks, stage-specific requirements, and
shared-resource contention. The dispatch contract addresses these boundaries.

Temple must close those gaps without claiming authority to create Codex tasks, start subagents, or control an external runtime.

## Decision

1. Every initialized repository receives a managed, project-local `templew.mjs` launcher. It reads the exact Temple version and pinned distribution source from `temple.lock`, prefers an explicitly supplied compatible local CLI, and otherwise invokes the pinned distribution through the package runner. It never falls back to an unversioned global `temple` command.
2. Parallel execution uses a two-step boundary:
   - `parallel prepare` atomically validates a first-wave dispatch entry, creates the Work Item claim, records a runtime-worker reservation, and reserves declared shared resources. The first preparation requires a fresh deterministic plan; later members of that same unchanged first wave use the exact plan digest plus their own preparation fingerprints and current readiness so one sibling's expected runtime mutation does not strand the rest of the wave.
   - The authorized runtime creates the external worker only after preparation succeeds, then correlates it through a user-owned Codex task record or an internal runtime-worker attachment.
3. The runtime-worker registry is project-owned canonical state. It distinguishes `user-task` from `internal-subagent`; a user-task correlation points to the existing Codex task registry, while an internal subagent records only its runtime identifier. A runtime worker is not a new Position, Agent Identity, or source of product authority.
4. Work Items may define lifecycle-stage execution requirements. Current-stage Disciplines and resources supersede legacy Work Item-wide Disciplines for that stage; legacy fields remain readable and act as the fallback.
5. Shared resources are project-owned definitions with explicit capacity. Active reservations are observable and participate in readiness and wave construction. Temple coordinates repository records only; it does not claim to lock Simulator, ports, devices, hosted CI, or other systems directly.
6. Preparation is recoverable. A failed prepare operation restores the Work Item, event stream, worker registry, and resource registry to their pre-operation contents. Cancelling, failing, or completing a worker releases its resource reservations; claim release remains an explicit lifecycle action unless cancellation occurs before attachment.

## Consequences

- A fresh task has a repository-visible, copyable, version-pinned CLI invocation.
- A runtime can prove that governance state existed before worker creation without giving Temple runtime authority.
- Internal subagents no longer inflate the user-owned Codex task registry.
- Developer, Quality, Independent QA, and other stages can require different Disciplines and shared resources.
- Planning may safely degrade verification concurrency while preserving implementation parallelism.
- The local project mutation lock still does not coordinate separate machines. Git hosting controls and the retained multi-machine validation remain necessary.

## Rejected alternatives

- Treat every internal subagent as a Codex task: this misrepresents user-visible task ownership and creates sidebar noise.
- Start workers and record claims afterward: a failure or interruption leaves ungoverned work in progress.
- Make the Temple CLI globally installed: this is machine-local, unpinned, and not recoverable from repository state.
- Treat every shared resource as a global mutex: capacities and lifecycle-stage use would be lost, unnecessarily serializing unrelated implementation.
