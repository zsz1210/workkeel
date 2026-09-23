# Workkeel: introduce a task contract before migrating lifecycle authority

- Status: accepted for additive implementation; lifecycle migration pending
- Date: 2026-09-23
- Work Item: WI-0255
- Discussion: [issue #114](https://github.com/zsz1210/temple-ai-dev-org/issues/114)

## Context

The approved Workkeel direction is repository-native task coordination for coding
agents, not a simulated company. Company titles should not be a prerequisite for
describing work. Existing records, actor selection, workflow guards and adapters
still use Positions; deleting those fields would discard authority and history.

## Decision

Introduce `workkeel.task-contract/v1` as an additive, role-free data boundary.
Describe goal, scope, actor identity, state, dependencies, acceptance, handoff and
explicit environment/operation constraints. Separate actual runtime features,
permission, project-specific Skills and model configuration. Do not require a
catalogue asserting that a model can code, reason or design.

The existing CLI validates local contracts and projects existing Work Items into
this contract without writing canonical state. Projection retains legacy schema,
roles, source path and digest as provenance. Missing authority remains unresolved;
an affected-path declaration must never become a filesystem grant.

Runtime execution and model connection are different contracts. The baseline is
a user-operated coding agent with its native connection. Optional adapters and a
fixed LiteLLM gateway descriptor can be described without launching anything.
Description does not establish adapter support, tool compatibility, credentials,
provider availability, spend authority or independent verification.

## Consequences and migration order

This slice does **not** provide a second task database or bypass existing guards.
Existing lifecycle writes still require Positions. New schema validity never
means execution authorization, sandbox enforcement or acceptance of a result.

Next migrate actor selection, lifecycle ownership/gates, init/doctor and durable
writers together, including exact-revision independent review. Then wire adapter
enforcement and one explicitly configured gateway; qualify real tool interactions
before claiming live support. Rename public entrypoints and the repository only
after coordinating the separate test-suite integration. Preserve legacy schema
identifiers and historical evidence rather than globally replacing Temple text.

See the [contract reference](../concepts/task-contract.md). The repository-only
scoped implementation design is `.ai-org/artifacts/WI-0255/design.md`.
