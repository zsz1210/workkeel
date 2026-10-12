# Temple compatibility and migration

Native Workkeel is the default for a new project. A project already initialized
with Temple keeps its pinned `templew.mjs`, `temple.lock`, organization state,
and Position-based operating contract until its owner approves a migration.
The source repository retains the legacy CLI and fixtures to support that
behavior. Installing Workkeel or running `workkeel start` does not migrate it.

## Choose the path deliberately

| Situation | Action |
| --- | --- |
| New repository with no task framework | Follow the [native quick start](workkeel.md). |
| Existing Temple repository with active tasks | Continue its pinned legacy workflow and preserve its records. |
| Existing Temple repository considering native Workkeel | Review task authority, identities, open work, file ownership, and backup needs before approving a bounded migration. |
| Source checkout for framework development | Follow [AGENTS.md](../../AGENTS.md) and the [private development workspace guide](../operations/framework-development.md); never initialize maintainer task state in the public checkout. |

Temple's Positions, Agent Identities, assignments, and Independent QA rules
remain distinct in legacy projects. A native task uses its approved task
contract, actual executor identity, separate reviewer, and authorized
Principal. Do not relabel old records or infer approval from a CLI preview.

Before any migration, back up the existing project's canonical state and
check its pinned version. Inventory open tasks and exact managed files; an
allowed root is not an ownership claim. Prepare a reviewed plan for how
active work will finish, which records remain as history, and how native
instructions will be installed. Test that plan in a disposable copy with
fictional data before changing the real project. If no approved, verified
conversion exists for its state, finish active work in Temple and initialize
native Workkeel for later tasks only when its owner approves that boundary.

See the [native task contract](../concepts/task-contract.md),
[extension and migration contracts](../extensions/extension-and-migrations.md),
and [public source/private state decision](../adr/0083-public-source-private-state.md).
