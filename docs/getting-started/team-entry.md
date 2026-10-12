# Join an existing Temple project

Start here when another teammate already installed Temple. Use the existing
repository; do not initialize it again or copy somebody else's local binding.
This guide describes current main behavior. An older installed package may lack
these commands or human-readable summaries; the coordinator owns its upgrade.

## What the coordinator gives you

- The repository and branch/worktree to use, plus its normal Git contribution rules.
- Your recorded Principal ID, your qualified Agent IDs, and an approved Work Item
  with a clear outcome and acceptance criteria. A Principal identifies a person;
  an Agent ID identifies an AI responsibility record in this project.
- The current task owner and where implementation, review and integration stop.

Git hosting controls access and merge permission. Temple records responsibility
and acceptance; repository access alone does not assign every task to its holder.
Ordinary attributed work needs no separate Temple login. Legacy configurations,
explicit verified policy and High-Assurance work retain their own requirements.

Agent records belong to the project. Two people can use the same display name,
such as "Builder", but should use the stable IDs and sponsorship selected for
their own responsibilities. Do not silently share another person's Agent ID or
create replacements to bypass an ambiguous or inactive membership. Developer
and the independent reviewer remain different Agent Identities.

## Your first two commands

Run from the repository root. Replace `principal-member` and `WI-0001` with the
IDs provided for your project; the example does not create or assign either one.

```sh
node ./templew.mjs --version
node ./templew.mjs collaboration readiness . --principal-id principal-member --work-item WI-0001
```

Read **Actor eligibility**, **Task readiness**, the active claim, and **Next action**.
Being a qualified contributor and owning the current task are separate checks.
A passing readiness result is navigation, not scope approval or permission to
skip stage gates. When several of your Agents qualify, add `--agent-id` with the
intended stable ID; do not choose another person's identity to make the check pass.

| What you see | What to do next | Who handles it |
| --- | --- | --- |
| Principal or membership missing/inactive | Give the coordinator the diagnostic; request the authorized role setup | Coordinator |
| Planned Agent differs from yours | Reconcile the intended assignment | Coordinator and intended owner |
| Active claim belongs to you | Continue that claim through current context; do not claim twice | You |
| Active claim belongs to someone else | Arrange a handoff or separate scope; do not overwrite it | Current claimant and coordinator |
| Wrong Position, blocked or terminal task | Follow the named stage or unresolved condition; completed work needs new approved scope | Named owner/coordinator |
| Verified identity or bootstrap required | Follow that project's explicit recovery/setup route | Coordinator |

The diagnostic supplies stable actor IDs where known. A Position instead of a
person means the coordinator still needs to resolve who owns that responsibility.
If help is needed, repeat readiness with `--json` and share the blocker code,
message, responsible actor, Work Item and next action through your team's normal
channel. Inspect the full report before sharing project-private details. A failing
readiness check does not modify state. Avoid rerunning the same blocked mutation.

## Begin the approved work

Once the current owner and scope are correct, resolve the existing Work Item's
context with the intended Position (replace `developer` when another stage owns it):

```sh
node ./templew.mjs context resolve . --work-item WI-0001 --position developer --compact --no-write --json
```

Read the routed instructions and approved acceptance. Use the project's
`temple-work` procedure to claim if unclaimed, implement within the approved
scope, and hand off the exact tested revision. Context and readiness do not claim
work for you. The [Core Path](core-path.md#4-take-ownership-and-resolve-how-to-work)
shows claim and delivery commands; your effective profile determines the gates.

If no task has been approved, use the contributor
[proposal route](../operations/collaborative-delivery.md#propose-a-task-as-a-contributor).
The coordinator reviews its intake; a successful proposal is not permission to
start implementation or to impersonate the coordinator.

## Hand off once and keep the evidence useful

Commit the product candidate, keep test results tied to that revision, and record
the applicable handoff. A distinct verifier supplies the required judgment. Do
not repeat an unchanged test just because responsibility changes: compatible
[measurement reuse](../operations/collaborative-delivery.md#reuse-measurements-without-inventing-tests)
and [mechanical reports](../operations/collaborative-delivery.md#explain-waits-and-recover-records)
can preserve the actual attempt. Changed inputs or a different acceptance question
may need a new check; required project verification still applies.

If completion reports diagnostics or recovery debt, retain its operation ID and
observation, then follow the named next action. A fresh clone cannot repair the
original checkout's journal. Organizational completion and a passing CI check do
not replace the project's PR/merge rules or authorize deployment.

Coordinators: use [contributor setup](../operations/collaborative-delivery.md#start-ordinary-work)
for approved memberships and [Solo/team transition](../operations/collaborative-delivery.md#change-soloteam-policy-deliberately)
for policy changes. A mode switch preserves existing claims; it does not transfer them.

## Observe first use without claiming maturity

For the first real teammate task, note version/revision, time to first meaningful
change, unexplained blocker, help requests, repeated checks, evidence-preparation
time and total delivery time. Keep model usage unknown if unavailable. Attribute
required approvals separately from avoidable unblock requests. This guide and
local fixtures are not evidence of unaided human onboarding; prior two-account
rehearsals used one human operator. See the
field-validation plan, maintained in the project's private task state.
