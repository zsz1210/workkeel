# Workkeel automation v1 specification

Status: approved implementation scope from the maintainer's P01–P10 request;
concrete interfaces below are implementation design choices, not claims that
every field was individually approved. Scope/acceptance: [work order](work-order.md).

## Shared boundaries

Task contracts, identities, approved paths/operations and exact-candidate review
remain in the existing task store. A workflow run is execution telemetry and
recoverable progress, never a second acceptance database. Every run pins the
workflow definition, task contract and execution policy, with a stable run ID.
Continuation with changed definitions is rejected. Completion does not close a task.

An adapter describes its supported operations and authentic host enforcement;
`start`, `resume`, `cancel` and result/usage reporting have explicit schemas.
Unsupported paths, tools, network or data rules are rejected before contact.
Native host execution remains usable without an orchestration dependency.
The application/runtime host is trusted code; configuration cannot turn arbitrary
shell text or model output into a new registered executor. Workkeel does not
provide a new operating-system security boundary.

## Graph

A versioned JSON graph declares named nodes, edges, conditional outcomes, fan-out,
joins and explicit approval nodes. Each runnable node selects a registered adapter
and a bounded input. Limits cover graph steps, node attempts, parallelism and
elapsed time. Cycles require those limits; duplicate IDs, missing endpoints,
unreachable nodes and incompatible joins fail validation.

Persist checkpoints and an operation journal locally. Record intent before a
side-effecting dispatch and result after completion. A resumed ambiguous intent
requires reconciliation, not an automatic second dispatch. Deterministic completed
steps can be reused only against matching definition/input/policy digests.
Approval is bound to the exact run/node/policy and cannot grant new task scope.
Cancellation interrupts available host operations and reports uncertainty when
the external side effect cannot be confirmed cancelled. Do not promise exactly-once
effects, distributed locking, or a visual drag-and-drop editor.

## Model routing and output compression

First support explainable rule-based task/node selection over an approved set of
fixed model connections. This avoids an extra model call to choose a model and
does not require an invented model-capability catalogue. Explicit selection wins
only inside policy; otherwise a matching rule chooses a configured connection.
Quality-qualified rankings may come from matched evidence, not price alone.
Pin the selected connection for the run/node conversation. No model change on
resume or silent fallback. Record requested versus observed model separately.

LiteLLM is optional model transport. Do not also enable an independent hidden
gateway router. Service-side fallback assumptions and actual model observations
are qualification evidence, not inferred from a fixed alias. The runtime owns
tools, continuation and approvals; model routing does not switch the coding agent.
Budget observations unavailable from a provider stay unknown. A budget that
requires unavailable enforcement blocks automatic dispatch rather than estimating
financial safety from token limits.

Headroom is an independent `off` or verified-lossless policy with explicit
runtime configuration and the existing eligibility/savings gates. Optional lossy
behavior requires separate approval. Compress only derived eligible tool output;
preserve instructions, source evidence, readback and fallback semantics.

## Onboarding and documentation

Preserve project-owned instruction files. Offer a previewable/native onboarding
bridge to WORKKEEL.md and relevant project Skills; do not overwrite a user's
AGENTS.md/CLAUDE.md, and do not assume filenames guarantee model compliance.
Use short, task-specific Skill matching and outcome checks rather than unconditional
whole-catalog reading. Keep current docs Workkeel-first and historical material
clearly scoped outside the homepage's main explanation.

## Acceptance matrix

| Area | Required evidence |
| --- | --- |
| Shared runtime | start/resume/cancel/result, unknown capability rejected, no secret in records |
| Graph | real registered steps, sequential/fan-out/join/branch, bounded loop, failure and cancel |
| Recovery | separate-process resume, corrupt/stale checkpoint, concurrent run exclusion, ambiguous intent |
| Approval | pauses before action, exact-bound approval, rejection and stale approval |
| Routing | explicit/rule/default, prohibited model/data, no eligible model, pinned resume, no hidden fallback |
| Budget | unavailable accounting remains unknown; required unsupported enforcement blocks |
| Headroom | protected WORKKEEL/AGENTS/CLAUDE sources, native entrypoint, original readback and failure passthrough |
| Onboarding | existing instruction preservation, source launcher, discoverable guidance and Skills |
| Provider | protocol tests against primary docs, process lifecycle tests, explicit live qualification result |
| OSS | immutable versions, license text/provenance, dependency closure and package-boundary audit |
| Docs | working quick start, three aligned READMEs, rendered desktop/mobile diagrams, measured claims |

Run focused tests during editing and the required full verification on the final
behavioral candidate. A distinct Agent reviews that exact revision. The maintainer
authorized a bounded synthetic Codex-subscription qualification using the existing
login. Live LiteLLM evaluation remains pending configured service and budget/data
authorization; neither result proves general model-quality or quota savings.
