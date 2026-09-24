# Executable workflows and model routing

Workkeel coordinates an approved task; a coding runtime performs its individual
steps. The optional LangGraph engine supplies execution order, branches, bounded
loops, direct parallel joins, approval interrupts and durable checkpoints.
Finishing a graph does **not** review, accept, publish or deploy its result.

The Codex subscription path is experimental. Later bounded Luna/Sol samples and
one real monitor-helper implementation/review passed; earlier failed attempts
remain recorded. These do not qualify general workflow reliability. See the
[measured validation and limits](../validation/workkeel-automation.md).

## Choose how to run

| Path | What it does | Requirements |
| --- | --- | --- |
| Native coding agent | Follow the task contract and record claim, handoff and review | Core CLI; existing Codex, Claude Code or another coding agent |
| Codex subscription workflow | Launch bounded nodes with explicit models through Codex App Server | Optional graph packages; existing ChatGPT login; qualified local host |
| Embedded runtime adapter | Connect an enforcing host using `start`, `resume`, `cancel` | Application-owned adapter and its own qualification |
| LiteLLM gateway | Describe a fixed, approved gateway connection | Separately operated gateway and enforcing host; live qualification still pending |

The concrete subscription profile was tested on macOS with
`codex-cli 0.155.0-alpha.9.2`. The local host accepts that version or a newer
semantic version on macOS, while retaining its App Server, model and sandbox
control checks. A newer version passing the version gate is not itself a live
qualification; record version-specific offline and live results separately.
Workkeel does not update Codex, log in, copy
credentials, alter global settings or bypass subscription limits. Current desktop
conversations keep their existing model; routing applies to Workkeel-launched
steps, not every chat in the app.

Install the optional engine from the reviewed source checkout:

```sh
npm ci --include=optional --ignore-scripts
node bin/workkeel.mjs help
```

The core-only installation uses `--omit=optional`. Initialization never downloads
a model, gateway or Python environment.

### Workkeel routing is not LiteLLM Auto Router

Workkeel selects a connection from the approved task policy. Its explicit rules
run locally, without a classifier model call. The optional LiteLLM connection
describes a fixed model through a separately operated gateway; it does not install
or enable [LiteLLM Auto Router](https://docs.litellm.ai/docs/auto_router/), which is
a separate request-classification and model-routing feature. The Codex monthly
subscription path goes directly to the local Codex host, not through LiteLLM.

Do not substitute an Auto Router alias and assume that it preserves a fixed-model
contract. Supporting gateway-owned routing would need an approved model allowlist,
data policy, actual-model observations, fallback rules and its own qualification.
That integration is not implemented here.

### Observation is optional

The workflow runner itself records per-attempt model, token and duration
observations without another process. Use `task metrics` or `workflow metrics`
for a read-only report; unknown native sessions and resumed-token baselines remain
explicit. See [task execution measurements](workkeel-measurements.md).

Core task coordination needs no server. The existing Console/control plane can
serve local views and event streams on demand; a managed observer is a separate
opt-in. Its current records are not yet a complete dashboard for the new Workkeel
task and graph execution stores. No macOS application is shipped.

A future monitor can show task state, runner state, selected/confirmed model,
completed steps, elapsed time and observed token usage without asking a model to
summarize progress. Model reasoning has no trustworthy percent-complete measure;
unknown usage remains unknown. Subscription tokens are not a dollar invoice.
An on-demand viewer need not install a background service, but continuing work
after closing it still requires the execution process to remain alive.

## Approve the workflow and model policy

Start with the complete [task setup](../getting-started/workkeel.md). For the local
subscription host, approve `tools: ["codex"]`, `cwd: "."`, `read_paths: ["."]`,
the actual writable directories, no external actions/resources, and tool network
`{"mode":"none","hosts":[]}`. Hosted inference still sends approved task data to
the account's model service: `data.model_access` must be `approved-connection`.
Tool networking and model-service transport are separate boundaries.

Add the workflow and policy files to `environment.data.policy_refs` **before task
creation**. They are digest-bound alongside the task approval. Set:

```json
{
  "runtime": {
    "kind": "adapter", "adapter_id": "codex-app-server",
    "required_features": ["filesystem-sandbox", "network-disabled", "fixed-model"]
  },
  "model_connection": {"kind": "policy", "policy_ref": "docs/model-policy.json"}
}
```

Example `docs/model-policy.json`:

```json
{
  "schema_version": "workkeel.execution-policy/v1",
  "models": [
    {"id":"luna","connection":{"kind":"codex-subscription","model":"gpt-6-luna","effort":"low"},"data_classes":["public","internal"]},
    {"id":"sol","connection":{"kind":"codex-subscription","model":"gpt-6-sol","effort":"medium"},"data_classes":["public","internal"]}
  ],
  "default_model": "sol",
  "rules": [{"id":"bounded-inspection","nodes":["inspect"],"model":"luna"}],
  "limits": {"steps":4,"attempts_per_node":1,"parallelism":1,"timeout_ms":300000,"max_cost_usd":null},
  "headroom": {"mode":"off"}
}
```

These are policy examples, not universal model rankings. The host checks the
selected model and reasoning effort against the current catalog. No extra model
call classifies the task. Explicit node `model` overrides a matching rule; otherwise
the default applies. Rules cannot overlap. Selection reasons and connection
fingerprints are recorded. An unavailable model stops execution; Astra is not an
implicit fallback. To use it, first include and approve it in the task policy.

Example `docs/workflow.json`:

```json
{
  "schema_version":"workkeel.workflow/v1",
  "nodes":[
    {"id":"inspect","kind":"runtime","write_paths":[],"input":"Read the relevant source and report the smallest change that satisfies this task."},
    {"id":"approve","kind":"approval","input":"Approve implementation of the reported approach within the existing task scope."},
    {"id":"implement","kind":"runtime","write_paths":["src","test"],"input":"Implement the approved change. Run the project's required checks and report their actual results."}
  ],
  "edges":[
    {"from":"start","to":"inspect"},
    {"from":"inspect","to":"approve"},
    {"from":"approve","to":"implement"},
    {"from":"implement","to":"end"}
  ]
}
```

Existing writable directories are required by the concrete host. A node may narrow
the task's write roots, never widen them. The host's permission profile denies
out-of-scope reads/writes and tool networking, with Codex's minimal system-tool
read exceptions. Task records, runner state and instruction entrypoints are
protected. MCP, plugins, apps, hooks, web/browser tools and automatic subagents are
disabled for this narrow profile. Unsupported conditions fail instead of quietly
relaxing the approved contract.

## Plan, run, approve and resume

After claiming the task, save a request with the returned claim ID:

```json
{
  "task_id":"WK-cart-total",
  "actor":{"agent_id":"builder","principal_id":"owner"},
  "claim_id":"<returned-claim-id>",
  "workflow_ref":"docs/workflow.json",
  "policy_ref":"docs/model-policy.json"
}
```

```sh
workkeel workflow plan . --request .ai-org/artifacts/WK-cart-total/plan.json
```

Planning validates the policy and returns selections without provider contact or
execution authority. For execution, put that object inside `run`, adding a stable
`run_id`, such as `cart-v1`:

```json
{"run":{"run_id":"cart-v1","task_id":"WK-cart-total","actor":{"agent_id":"builder","principal_id":"owner"},"claim_id":"<returned-claim-id>","workflow_ref":"docs/workflow.json","policy_ref":"docs/model-policy.json"}}
```

```sh
workkeel workflow run . --request .ai-org/artifacts/WK-cart-total/run.json
workkeel workflow show . --id cart-v1
```

An approval node returns `awaiting-approval` with an interrupt ID and token. Record
the real decision in a project evidence file. Add `approvals` beside `run`:

```json
{
  "<interrupt-id>": {
    "token":"<returned-token>", "approved":true,
    "actor":{"agent_id":"reviewer","principal_id":"owner"},
    "evidence_ref":".ai-org/artifacts/WK-cart-total/approval.md"
  }
}
```

Run the same command. The actor must be registered under an approving Principal;
the decision is attributed and digest-bound, not proof of authenticated human
identity. Approval cannot extend the original scope. `approved:false` records a
terminal rejection. A wrong token is rejected without consuming the pending
interrupt. Remove stale `approvals` when no interrupt is pending.

## Graph behavior and limits

Conditional edges use a runtime result's explicit `outcome`. An embedded adapter
can return task-specific outcomes; the concrete Codex adapter currently returns
`done` or `attention` through a required structured result. Provider-turn completion
is not task success: `attention` becomes a failed step and stops dispatch, rather
than passing refusal text to the next node. Commentary is excluded from result
text. Self-reported success still needs artifact checks and independent review.
The adapter retains the full task contract and adds a separate, numeric UTC expiry
observation immediately before dispatch. Initialization is followed by another
expiry check; expired or missing authorization prevents a model turn. This
snapshot grants no new permission, does not extend expiry and is not acceptance.
The coordinator owns lifecycle administration; the model receives the actual
node work separately. This offline handoff improvement has not been requalified
with live subscription calls.
Cycles and retries share the configured dispatch and
elapsed-time bounds. `retry:true` permits only a reported failed/retry continuation
of the same conversation, never an uncertain fresh attempt.

Parallel v1 uses a direct fork and explicit array join, for example
`start → [lint, inspect] → summarize` with
`{"from":["lint","inspect"],"to":"summarize"}`. Multi-level/implicit convergence
is rejected. Parallel writable roots must be disjoint after filesystem resolution;
set `write_paths: []` on read-only nodes. Serial execution is the simple default.

Optional `fallbacks: [{"node":"inspect","models":["luna","sol"]}]` requires an
attempt limit covering the sequence. An adapter must confirm `not-started`, zero
usage and no conversation before fallback. The concrete Codex adapter stops on
uncertainty; it does not assume a timeout means the provider did no work.

`steps` counts dispatch attempts, not a guaranteed token cap. `timeout_ms` includes
time spent waiting for approval. `max_cost_usd: null` means no financial cap can be
enforced; the subscription host rejects non-null dollar caps. Reported token usage
is not a dollar amount or a measurement of subscription quota saved.

## Recovery and cancellation

Checkpoints and intent/result journals live under `.ai-org/execution/<run-id>/`,
excluded from Git. They can contain task output; protect local storage accordingly.
One task claim is bound to one run ID. Resume the existing run instead of creating
another ID to repeat work. Definitions, claim and connection fingerprints must
still match. Missing/corrupt records stop recovery; they are never reset silently.

```sh
workkeel workflow cancel . --id cart-v1 --request actor.json
workkeel workflow recover-lock . --id cart-v1 --request actor.json
```

Here `actor.json` contains only `agent_id` and `principal_id`. Cancellation is a
request, not proof that external effects were undone. Lock recovery requires the
original local process to be provably stopped. A non-quiescent host leaves its
diagnostic lock intact. Do not delete locks, checkpoints or journals to force a run.
The Codex adapter interrupts a known active turn, cleans registered background
terminals, confirms an empty terminal list and closes its owned process. Failed
cleanup or an unidentified dispatched turn retains uncertainty and the lock.
Background/detached jobs are prohibited by the runtime instructions; terminal
cleanup does not prove arbitrary external effects were undone. Before explicit
lock recovery, the operator must also establish that any descendants have stopped.

If an adapter disconnected after dispatch, inspect its actual state. A host-backed
reconciliation may supply `reconciliations` beside `run`, each with `operation_id`,
a validated runtime `result`, and a nonempty `evidence_ref`. This records the
operator's finding; it does not magically establish exactly-once external effects.

After completion, run the project's verification and follow the ordinary
claim/handoff/distinct-agent review/acceptance path. Keep runtime completion and
task acceptance separate.

## Headroom and Skills

Headroom policy is chosen during planning: `off` or `lossless`. An enforcing
embedded adapter can pass derived tool outputs through `context.toolView`.
Instructions, approvals and policy references retain their originals. The local
Codex subscription adapter currently requires `off`: it cannot intercept native
Codex tool responses. See [context and Skills](../extensions/workkeel-context.md).

See [measured validation](../validation/workkeel-automation.md) for the precise
offline/live evidence and remaining limitations, and
[third-party notices](../../THIRD_PARTY_NOTICES.md) for OSS provenance.
