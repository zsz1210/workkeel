# Team adoption and risk tiers

This guide is for the person who sets up Workkeel in a repository and decides how
much review each kind of change needs. It covers who to register, how a task gets
its risk tier, and what each tier requires before a task can close. The
[quick start](../getting-started/workkeel.md) shows the commands; this page explains
the choices behind them.

Workkeel records and checks these rules. It does not authenticate people, enforce
a sandbox or run your tests. Identities are attributed, not verified accounts.

## Solo or team

A project is a **team** project when its policy registers more than one Principal
(a person accountable for approvals). With one Principal it is **solo**.

| | Solo | Team |
| --- | --- | --- |
| Start | `workkeel init . --solo` | `workkeel init . --team --policy task-policy.json` |
| Registered by default | Principal `owner`, Agents `builder` and `reviewer` | Whatever the reviewed policy file lists |
| Implementer and reviewer | Always different Agents | Always different Agents; `distinct-principal` also requires different people |
| High and critical approval | The owner approves and closes | Another Principal approves; the implementer's Principal cannot close |

Start solo when one person owns the repository and its decisions. Move to a team
policy as soon as a second person approves, reviews or closes work, and replace
the policy with `workkeel policy update`. Open tasks pinned to the old policy must
then be approved again.

Choose `review_separation` deliberately:

- `distinct-agent` (the default) requires only a different Agent. It suits one
  person working with two coding agents.
- `distinct-principal` requires the reviewer to belong to a different Principal.
  Select it only when separate people are actually registered; a second Agent is
  not an independent human.

### Register model families for high-risk work

High and critical review requires a reviewer Agent from a different **model
family** than the implementer. Record it in the policy's `agents` entries, for
example `{"agent_id": "builder", "principal_id": "owner", "model_family": "claude"}`
and `{"agent_id": "reviewer", "principal_id": "owner", "model_family": "codex"}`.
The solo default does not set `model_family`, so a solo owner who needs high-risk
work adds the families with `workkeel policy update` first. Workkeel compares the
recorded labels; it does not inspect which model actually ran.

## How a task gets its tier

Every task has one of four tiers: `low`, `standard`, `high` or `critical`. The tier
can always be raised. It can never be lowered below the floor that the project
policy sets.

1. **Floor from the approved write paths.** The policy's optional `risk_paths`
   maps each tier to repository-relative globs. A write path that matches takes
   the highest matching tier. Without a match, paths under `docs/` and Markdown
   files are `low`, and everything else is `standard`.
2. **Floor from the data.** A task whose data classification is `sensitive` is at
   least `high`.
3. **Author's choice.** The task author may declare a higher tier than the floor,
   never a lower one. `task new` uses the floor when no tier is given; the
   single-brief entry defaults to `standard`.
4. **Escalation at handoff.** The files a candidate actually changed are scored
   again. A change that touches a higher-tier path raises the task's tier, and a
   rejected attempt's tier stays even after its risky change is withdrawn.

Example policy fragment:

```json
{
  "risk_paths": {
    "low": ["docs/**", "*.md"],
    "high": ["src/auth/**", "migrations/**"],
    "critical": ["deploy/**", ".github/workflows/**"]
  }
}
```

Patterns cannot be negated or absolute. `deploy/**` also covers dotfiles such as
`deploy/.env`.

## Choosing a tier

| Tier | Use it for | Typical examples |
| --- | --- | --- |
| `low` | Changes a reader can check by eye and revert without side effects | Documentation, comments, wording |
| `standard` | Ordinary product changes covered by the project's tests | Features, bug fixes, refactors inside one module |
| `high` | Changes where a mistake is costly or hard to notice | Authentication, data migrations, shared APIs, sensitive data |
| `critical` | Changes that can cause an outage, data loss or exposure on release | Deployment, CI and release workflows, production configuration, secrets handling |

When unsure between two tiers, choose the higher one. Lowering the burden of
review is not a reason to pick a lower tier.

## What each tier requires

Every tier keeps these rules: the reviewer is a different Agent from the
implementer; review and close name the exact delivered commit; and close needs a
passing review of that commit.

| Requirement | low | standard | high | critical |
| --- | --- | --- | --- | --- |
| Evidence at handoff | Optional | Required | Required | Required |
| Review evidence | Summary may suffice | Summary may suffice | Reviewer's own `workkeel.review-report/v1` record | Same as high |
| Reviewer | Different Agent | Different Agent | Different Agent from a different model family | Same as high |
| Unresolved issues listed at handoff | Reviewer decides | Reviewer decides | Review cannot pass | Handoff is refused |
| Who closes | An approver | An approver | The task's approving Principal | The task's approving Principal |
| Team approval | Creator | Creator | A Principal other than the implementer and the initiator | Same as high |
| Team review and close | Separation policy applies | Separation policy applies | Not by the implementer's Principal | Same as high |
| Rollback plan at handoff | Optional | Optional | Optional | Required |
| Approval record | Not required | Not required | Not required | A committed `--approval` record whose content in the candidate must match what was approved |

Optional automation (whole goals, bounded autonomy and automatic improvement)
accepts only `low` and `standard` work. High and critical tasks always go through
the manual lifecycle.

## Rolling out in a team

1. **Agree the policy first.** Write `task-policy.json` with the real Principals,
   Agents, approvers, `review_separation` and `risk_paths`, and review it like
   code. Initialize with it, then commit `workkeel.lock`, `workkeelw.mjs`,
   `WORKKEEL.md` and `.ai-org/`, and ignore `.workkeel/`.
2. **Mark the dangerous paths.** List deployment, CI, migrations, authentication
   and secret-handling paths under `high` or `critical`. Anything not listed
   defaults to `standard`, which is the safe direction.
3. **Pilot on low and standard work.** Run a few documentation and ordinary
   tasks to learn the claim, handoff, review and close steps before relying on
   the high-risk path.
4. **Register model families before the first high task.** Confirm that at least
   one reviewer Agent has a different `model_family` from each implementer.
5. **Keep the records where they belong.** Task records and evidence live in the
   project repository under the project's own data policy. Workkeel's own
   framework development keeps them in a private workspace instead; see the
   [publication boundary](publication-boundary.md).

## Limits

- Principals and Agents are names in a policy file. Workkeel cannot tell whether
  two Principals are really two people or whether the recorded model family ran.
- A tier controls lifecycle evidence and approval. It never authorizes a
  deployment, release or other external action.
- Escalation compares all changes since the first unaccepted claim base, so work
  merged meanwhile by others can raise a tier.
