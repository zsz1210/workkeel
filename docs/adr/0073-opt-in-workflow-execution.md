# Opt-in workflow execution with explicit model and context policies

- Date: 2026-09-23
- Status: accepted implementation design; verification and live qualification pending
- Scope: Workkeel workflow orchestration, not a replacement coding-agent harness

## Decision

Use the MIT-licensed `@langchain/langgraph` 1.4.17 as an optional graph engine,
with pinned `@langchain/core` 1.2.12, `@langchain/langgraph-checkpoint` 1.1.5 and
`zod` 4.6.5 peers. Resolve the full npm closure in the lockfile. Core task commands
must work with optional dependencies omitted; graph commands load the engine only
when invoked and report an actionable missing-dependency error.

Use LangGraph's StateGraph, conditional edges, joins, interrupts and checkpoints,
not a second independently invented graph scheduler. Provide project-local durable
checkpoints behind its public saver interface. The checkpoint is execution state,
not accepted task state. Record dispatch intent/results independently so recovery
cannot blindly repeat an uncertain side effect.

Adapters are registered trusted application code with explicit start/resume/cancel
and result contracts. They retain responsibility for actual filesystem, tool,
network and data enforcement. Workkeel checks compatibility before dispatch and
never advertises a configuration validator as an operating-system sandbox.
Arbitrary executable code is not loaded from a model-produced graph definition.

First support deterministic, explainable model selection at node boundaries from
approved fixed connections. The initial concrete host uses the existing Codex
ChatGPT subscription, with explicit model and reasoning effort checked against
the installed runtime's catalog. Luna/Sol are the example policy; Astra requires
an explicit approved selection. This does not alter the desktop app's global
default or switch an already running conversation. The selected connection is
pinned for that node's conversation. LiteLLM may provide transport, but a second service-side automatic
router/fallback must not silently replace the selection. A native coding agent
and a model provider are different components. Unsupported model switching or
budget enforcement blocks execution instead of pretending to support it.

Headroom remains independent, optional and lossless-by-default. A planned policy
controls eligible derived tool output; it cannot rewrite task authority, native
instructions or original evidence. No paid provider call, remote deployment or
automatic install occurs simply by initializing a Workkeel project.

## OSS and distribution

LangGraph, LangChain Core, checkpoint and Zod package metadata declares MIT.
Review the exact installed license files and transitive closure before delivery;
retain notices in installed dependencies and describe them in the distributed
third-party notice. Workkeel does not copy Enterprise or hosted-service code.
LiteLLM is an externally operated optional gateway: upstream's root license
excludes the separately licensed `enterprise/` directory. No Enterprise material
is adopted, and service configuration does not confer a commercial license.

Sources: [LangGraph license](https://github.com/langchain-ai/langgraphjs/blob/main/LICENSE),
[checkpoint API](https://docs.langchain.com/oss/javascript/langgraph/persistence),
[LiteLLM license](https://github.com/BerriAI/litellm/blob/main/LICENSE).
Immutable package versions and lockfile integrity identify the reviewed artifacts;
upstream `main` links are navigation only, not revision pins.

## Consequences

Graph installation is larger than the minimal task CLI; users who need only task
coordination can omit optional dependencies. No graph designer UI, distributed
locking, exactly-once external effects, self-training router, universal provider
compatibility or unmeasured cost saving is promised. Successful execution still
requires normal task review and acceptance.

Qualification includes failure injection, separate-process recovery, approval and
stale-policy checks, actual adapter/process tests, distribution/license review and
an explicitly authorized live model check. Until a live check exists, it remains
unverified even if offline protocol tests pass.
