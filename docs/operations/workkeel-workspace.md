# Desktop workspace

The workspace groups explicitly registered projects and repositories in one local
interface. Projects retain their native task records; the workspace is a projection,
not another writable copy of task acceptance. Its overview prioritizes required
decisions, project progress and recent deliveries. Task details provide execution,
dependencies and evidence when needed.

The default task and goal view starts with the current situation and next action.
A compact five-activity diagram shows planning, implementation, verification,
independent review and repair. A completed review execution can still have a
recorded FAIL. Goal views retain each component's actual review verdict and the
rejected review operations; one component's PASS never clears another's FAIL.
Current verdicts are bound to their reviewed candidate, rather than inferred from
task phase. Repository labels and dependency state are plain text, while exact
root-local task keys remain available for keyboard inspection.
These activities do not imply five separate Agents.
Each node uses recorded executors, models, time and tokens; select a node for its
records. Exact identifiers, source details and acceptance evidence are disclosed
on demand. Missing reports stay unknown, explicit zero remains zero, and a
recent running report expires after 60 seconds without extrapolating elapsed time.

The executor timeline places confirmed intervals on separate identity lanes and
retains overlaps and repeated repair operations. Goal dependency diagrams include
the complete mandatory component set across registered repositories. Component
acceptance does not imply whole-goal acceptance. Analysis compares one metric at a
time, with filters and measured coverage; it is not a model quality ranking.

Known timestamps remain ordered even when other activities lack dates. If an
activity has conflicting outcomes whose order cannot be established, its node
requires reconciliation. Missing chronology does not override an authoritative
native review decision or invent a latest activity.

Before delivery, use the [completion evidence check](completion-evidence.md) and
actual repeated visual review. A coverage result cannot judge usability or replace
the separate registered Agent's native review.

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

For execution use an approved [whole-goal manifest](workkeel-goals.md), whose
mandatory repository/task set is immutable. The goal's integration component
depends on every other component. Workspace goal views show that complete set,
repository registration gaps, exact candidates and integration acceptance; a
caller-selected inspection subset is not a whole-goal acceptance decision.

The control host can register an already authority-pinned goal, start its service,
and pause, resume or cancel it through `goals.create`, `goals.start`, `goals.pause`,
`goals.resume` and `goals.cancel` allowlisted actions. These commands require the
actual original operator and current resource/registry versions. `goals.recover`
reconciles the exact unresolved operation; it is not a retry of unknown effects.
Opening a view or saving a policy never starts a model.

## Goal execution and learning

Use native `autonomy` controls for approved work. Improvement discovery is off by
default; enable explicit directions and bounded resource limits through an authorized
task. Turning discovery off stops new improvement proposals; previously approved
work remains governed by its task. Pausing execution and cancelling a task are
separate operations, with host confirmation required before reporting a running
operation as stopped.

Automatic task creation additionally requires the source goal's sealed standing
admission grant. Settings only narrow its scope/resources, and select its real
registered goal rather than typing claim identities. `autonomy.start-service`
starts the approved event controller. The service indicator distinguishes a
service running in this host from an unconfirmed separate process; recorded task
activity is not process-liveness proof. Source discovery, proposed work and accepted
derived goals remain separately traceable, with unknown cost/token fields preserved.

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

Records & storage is a separate sidebar destination. Inventory runs only when it is
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

## Desktop navigation and model rules

The sidebar's project selector searches names and identifiers and pages results
20 at a time. The workspace groups projects; a project groups its registered
repositories, goals and tasks. Selecting a project keeps subsequent task, model
rule, improvement, learning and storage views in that project. All projects returns
to the workspace scope. Overview project updates show at most eight projects;
the complete project and task directories provide search and pagination.

Model rules starts with five activity summaries, rather than a permanently open
configuration form. Adjust opens a focused editor; Escape and Cancel discard the
edit without a request. Model, reasoning and service mode independently offer
Inherit, Auto and Fixed. Values come from the host's approved catalog; provider
effort names are not converted into an invented common scale. Compatibility checks
also examine inherited task settings when a project default changes. Host policy
selection remains authoritative and may reject choices the UI cannot qualify.

Project defaults are the policy root. The workspace itself is a navigation scope,
not a shared authorization or global model-policy layer. Task exception limits an
activity rule to a task in the project's canonical task root. It does not rewrite
that task's immutable contract or an already pinned dispatch policy. Other registered
repository roots retain their own authority. Advanced rules keeps existing role,
task-wide and exact-node overrides available.

An activity rule may have an optional `task` identifier. Unscoped activity and role
rules retain their existing precedence; task-wide overrides follow them, then
task-scoped activity overrides, then exact-node overrides. A `task` qualifier on
any other rule layer is rejected. Conflicting assignments in one layer remain
errors, even when a later layer could overwrite them. The browser and host use
the same pure dimension resolver; resolution alone never authorizes execution.

Save draft persists a new immutable policy version. The page labels the displayed
draft separately from the approved version. Approve this exact draft sends its
version and SHA-256 under the host's current task authority. Running tasks retain
their pinned policy; new adoption requires the existing approved policy bridge.
The editor's preview shows requested, selected and reported values separately;
it does not run a model or fill missing runtime reports from configured values.

Dark is the initial appearance; light and system remain available. Task and goal
execution views use a compact activity rail and emphasize the latest evidenced
activity, identity, model and measurements. Rows in project and goal lists contain
no decorative miniature flow diagrams. Evidence, executor timelines and complete
dependency diagrams remain available within task and goal detail.
