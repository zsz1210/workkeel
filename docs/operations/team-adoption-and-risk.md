# Adoption and risk tiers

This guide is for the person who sets up Workkeel in a repository and decides how
much review each kind of change needs. It covers who to register, how a task gets
its risk tier, and what each tier requires before a task can close. The
[quick start](../getting-started/workkeel.md) shows the commands; this page explains
the choices behind them.

Workkeel records and checks these rules. It does not authenticate people, enforce
a sandbox or run your tests. Identities are attributed, not verified accounts.

## Who to register

`workkeel init .` registers one Principal (a person accountable for approvals),
`owner`, with two Agents: `builder` (model family `claude`) and `reviewer`
(model family `codex`). To register other people or
Agents, write a reviewed policy file and use `workkeel init . --policy task-policy.json`
instead, or replace the policy later with `workkeel policy update`. Open tasks
pinned to the old policy must then be approved again. The rules below are the
same however many Principals the policy lists.

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
The default policy from `workkeel init .` already records exactly these two
families, so high-risk tasks can start right after init. A policy given with
`--policy` is used as written; add the families there or later with
`workkeel policy update`. The rule itself does not change: high and critical work
still needs a reviewer from another model family and close by the approving
Principal. Workkeel compares the recorded labels; it does not inspect which model
actually ran.

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
| Who closes | An approver | An approver | The task's approving Principal, as the human confirmation | Same as high |
| Rollback plan at handoff | Optional | Optional | Optional | Required |
| Approval record | Not required | Not required | Not required | A committed `--approval` record whose content in the candidate must match what was approved |

Optional automation (whole goals, bounded autonomy and automatic improvement)
accepts only `low` and `standard` work. High and critical tasks always go through
the manual lifecycle: another model family reviews, then a person confirms.

## Review scores (optional)

A reviewer may add a `score` block to its own `workkeel.review-report/v1` file.
It is part of the same review, not another round. Scores are for statistics
only: they never trigger rework or block a close. Whether work goes back for
rework is decided by the risk tier and the findings, as before.

```json
"score": {
  "model": "<implementing model or null>", "reasoning_effort": "<label or null>",
  "external_score": {
    "reviewer_model": "<reviewing model or null>", "rubric": "code",
    "scores": {"requirements": 4, "correctness": 5, "tests": 4, "maintainability": 4}
  },
  "findings": [{"level": "P2", "note": "Total ignores discounts in ordinary use"}]
}
```

- **Rubric by task type.** `code` scores `requirements` (does it do what the
  contract asks), `correctness`, `tests` and `maintainability`. `non-code` scores
  `requirements` only; visual judgment stays with the person at acceptance. Each
  criterion is an integer from 1 to 5. An optional `total` must equal the sum.
- **Score what matters.** Do not take points off for minor style issues, rare
  cases or problems that only occur under concurrent use; record those as known
  issues instead.
- **Findings** give the reasons for a failed review as `P1` to `P3` with a short
  note. `P3` findings are never counted as rework reasons.
- **Self-evaluation** is reserved: `self_eval` defaults to `{"enabled": false, ...}`
  because an externally reviewed task does not need one.

`workkeel stats` reads these blocks and the task records without writing
anything. Per task it reports `task_id`, `risk`, `model`, `reasoning_effort`,
`self_eval`, `external_score` (with the review round, counted from the task
history) and `rework` (rounds, and each round's reasons by P level; a round
without findings uses the rework summary). Per tier it reports the average scores
for each rubric, rework rounds and the distribution of rework reasons. A malformed
score block is listed under `errors` and left out of the averages.

## Rolling out

1. **Agree the policy first.** Start from `workkeel init .`, or write
   `task-policy.json` with the real Principals, Agents, approvers,
   `review_separation` and `risk_paths`, review it like code and pass it with
   `--policy`. Then commit `workkeel.lock`, `workkeelw.mjs`,
   `WORKKEEL.md` and `.ai-org/`, and ignore `.workkeel/`.
2. **Mark the dangerous paths.** List deployment, CI, migrations, authentication
   and secret-handling paths under `high` or `critical`. Anything not listed
   defaults to `standard`, except files under `docs/` and Markdown files, which
   default to `low` wherever they are. List a documentation path under a higher
   tier when its review must be stricter.
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
