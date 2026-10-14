# Desktop workspace

The workspace groups explicitly registered projects and repositories in one local
interface. Projects retain their native task records; the workspace is a projection,
not another writable copy of task acceptance. Its overview prioritizes required
decisions, project progress and recent deliveries. Task details provide execution,
dependencies and evidence when needed.

## Register projects

Choose a private state directory outside the framework source checkout. Create it
and place a configuration file named `create.json` there:

```json
{"id":"development","name":"Development"}
```

From a reviewed source checkout:

```sh
node bin/workkeel.mjs workspace create /private/workspace-state --request create.json
```

Register an existing initialized native project with `register.json` in that state
directory. Each repository has an explicit identifier, absolute path and relative
scope; `.` selects the entire repository.

```json
{
  "expected_version":1,
  "project":{
    "id":"example","name":"Example project",
    "task_root":"/projects/example-private",
    "repositories":[{"id":"service","path":"/projects/example-private","scope":"."}]
  }
}
```

```sh
node bin/workkeel.mjs workspace register /private/workspace-state --request register.json
node bin/workkeel.mjs workspace show /private/workspace-state
node bin/workkeel.mjs workspace serve /private/workspace-state
```

Open the printed private loopback link. Observation makes zero model calls. Close
the foreground server with Ctrl-C; a workspace page remaining open is not proof
that an executor is alive. Original project history, documents, Skills and learning
remain accessible through the project observer.

## Controlled actions

The default viewer has observation access. To enable specific actions, supply a
private server configuration using `--request server.json`. Its `control` object
names an actual registered actor and an explicit action allowlist. `host_models`
contains operator-verified provider/model, reasoning and service capabilities;
absence means unsupported or unknown, not a guessed provider default.

Policy drafts and approval require a currently claimed authorized native task.
The UI derives the task's claim and contract pins from canonical state. Changing
a project policy does not rewrite the policy pinned to an existing task. The model,
reasoning and service dimensions independently support inheritance, automatic
selection and fixed values. A fixed unavailable value blocks selection.

Control requests include the expected workspace and resource versions and a stable
idempotency key. A submitted command with an uncertain result remains pending
reconciliation; repeating the key does not start a new operation. Never share either
the read or control capability link.

## Repository integration

A task key contains its project identifier, so equal task IDs in different projects
remain distinct. Integration inspection uses exact component candidate revisions
and corresponding native acceptance. Individual component completion does not
accept the composed feature. Missing records or changed versions remain incomplete.

## Goal execution and learning

Use native `autonomy` controls for approved work. Improvement discovery is off by
default; enable explicit directions and bounded resource limits through an authorized
task. Turning discovery off stops new improvement proposals; previously approved
work remains governed by its task. Pausing execution and cancelling a task are
separate operations, with host confirmation required before reporting a running
operation as stopped.

The background runner uses the qualified workflow engine and stable run identity.
It cannot grant scope, bypass independent review or infer acceptance from a finished
graph. An enforcing host remains responsible for execution permissions and usage.

Native Skill learning records candidate versions, comparative evaluations,
independent review, approval, activation, use outcomes and rollback. Activation is
project-local. A low-risk standing policy is an explicit opt-in; a Skill cannot alter
the task's permissions or acceptance. Evaluation reports are attributed evidence,
not a guarantee of unbiased model performance.

For explicit bounded learning discovery, a `context prepare` request may include
`learning_query`. Only eligible guidance under approved read roots is returned.
Discovery does not claim reading or successful application. Original immutable task
Skills remain required.

See [native learning](../extensions/workkeel-learning.md),
[versioned Skill learning](../extensions/workkeel-skill-lifecycle.md),
[bounded goal execution](workkeel-autonomy.md),
[context preparation](workkeel-material-and-continuation.md), and
[testing](../getting-started/testing.md) for the existing evidence boundaries.

## Capacity and measurement identity

Settings includes a separate Storage tab. Inventory runs only when that tab is
opened; the overview does not recursively scan measurement storage. The default
hook inventories `.ai-org/host-usage` with explicit file and byte bounds. It shows
source bytes and the archive upper bound before an authorized archive command.
Source changes invalidate that preview.

Archives retain all originals, including task evidence and measurement source
identities. They release **zero bytes** and can increase disk use. The CLI `retention
preview`, `archive` and `verify` APIs allow an explicitly scoped archive policy;
there is no automatic evidence pruning. Capacity bounds fail explicitly. Back up
private state outside public source and review growth before raising those bounds.

`retention usage` summarizes explicitly supplied samples. Stable provider, thread,
turn and operation identity prevents double counting; a final observation replaces
earlier cumulative observations. Reported cost and policy estimates remain distinct.
Absent tokens, cost or elapsed time remains unknown, including when part of a
reported operation is measured. Conversation use outside those sources is not a
task total.
