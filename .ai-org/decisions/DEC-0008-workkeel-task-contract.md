# DEC-0008 — Workkeel task-first migration

- Date: 2026-09-23
- Status: direction confirmed by Human Principal; implementation in progress
- Source: the coordinating conversation selected Workkeel and authorized the
  previously agreed changes once isolated from the separate test-suite task.
- Work Item: WI-0255, additive contract foundation only.

## Confirmed direction

Workkeel coordinates durable tasks for coding agents. Company job titles are not
the target core abstraction. Do not replace them with a large generic AI-skill
catalogue. Preserve accountable actor identity, scoped approval, environment/data
boundaries, project-specific Skills, handoff, acceptance and independent evidence.
Runtime execution and model connection are separate; native operation remains the
baseline and a fixed LiteLLM connection is optional. Automatic routing, a new graph
engine and large comparative benchmarks are deferred. Testing/context slimming
belongs to the other active task.

## Implementation staging, not an expanded approval claim

The implementer selected an additive validator and legacy projection as the first
safe migration slice. This is an implementation choice, not a claim that the Human
approved every new field individually. Existing lifecycle authority is unchanged;
no Position-free writer, runtime integration, live gateway support, package rename
or remote rename is delivered by WI-0255.

The remaining migration must replace Position dependencies across lifecycle,
actor selection, init/Doctor and adapters together. Preserve historical schema
identifiers and exact-revision gates. Repository/README/package renaming follows
the separate test task's integration. External publication and paid provider
access require their own authority and operational conditions.

## References

- [Task-contract ADR](../../docs/adr/0071-workkeel-task-contract.md)
- [Executable contract reference](../../docs/concepts/task-contract.md)
- [Implementation scope and acceptance](../artifacts/WI-0255/design.md)
