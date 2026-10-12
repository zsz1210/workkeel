# Collaborative large-scale real-environment test plan

- Status: planned / not run
- Minimum: two real Human Principals, enough distinct Agent Identities to preserve implementation and Independent QA separation, and two independently administered development environments
- Hosting: protected default branch, pull requests, required CI, and review rules

## Scenario

1. Decompose one parent feature into contract, UX or UI, frontend, backend, infrastructure, and integration or QA Work Items.
2. Include disjoint scopes, an intentional affected-path conflict, a blocked dependency, and a shared-contract change.
3. Create Work Items concurrently from two clones and attempt competing claims on the same Work Item.
4. Exercise eligible and ineligible Discipline claims.
5. Integrate through separate pull requests and the named integration owner.
6. Run Independent QA on the exact integrated candidate, then recover state in a new task without reading old conversations.

## Pass criteria

- No ID collision, silently lost claim, or silently lost canonical record.
- Conflicting scope becomes sequential, blocked, or explicitly coordinated.
- Every accepted scope identifies Principal, Agent, base revision, branch or PR, evidence, and integration owner.
- Developer and Independent QA remain separate on the accepted revision.
- A new task can recover active, blocked, QA-pending, and closed state from repository files.

Passing local automated or simulated-clone tests does not pass this plan. Preserve a separate validation record with real participants, environment, commands, commit and pull-request evidence, failures, final results, and residual risks before changing `validation.real_collaborative.status` to `passed`.
