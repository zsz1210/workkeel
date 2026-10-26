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
(model family `codex`) by default; override with `--builder <family>` and `--reviewer <family>`. To register other people or
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
| Reviewer fails for | P1, or P2 hit in normal use | P1 or P2 hit in normal use | Any P1 or P2 | Same as high |
| Rework rounds before a human decides | 2 | 3 | 3 | 3 |
| Who closes | An approver | An approver | The task's approving Principal, as the human confirmation | Same as high |
| Rollback plan at handoff | Optional | Optional | Optional | Required |
| Approval record | Not required | Not required | Not required | A committed `--approval` record whose content in the candidate must match what was approved |

Optional automation (whole goals, bounded autonomy and automatic improvement)
accepts only `low` and `standard` work. High and critical tasks always go through
the manual lifecycle: another model family reviews, then a person confirms.
Below high risk, an issue that only appears under concurrent use is recorded as
a known issue, not a blocker. Past the rework limit, `rework` is refused and the
work stops until a person re-scopes it, approves a new task or cancels it. A goal's
`max_reworks` is clamped to the same limit for each component's risk.

The [independent QA and release gate](workkeel-review-assessment.md#independent-qa-and-release-gate)
specifies finding dispositions, bounded rework and mandatory Codex/Claude
cross-review for high/critical work. These are review procedure requirements;
the CLI's recorded model-family check does not establish that both reviews ran.

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

The unused `self_eval` placeholder is ignored when reading historical score blocks
and is not emitted in statistics. New score blocks must omit it. Reports should
contain the external reviewer score and findings only; other unknown score fields
are reported as invalid scores.

`workkeel stats` reads these blocks and the task records without writing
anything. Per task it reports `task_id`, `risk`, `model`, `reasoning_effort`,
`external_score` (with the review round, counted from the task
history) and `rework` (rounds, and each round's reasons by P level; a round
without findings uses the rework summary). Per tier it reports the average scores
for each rubric, rework rounds and the distribution of rework reasons. A malformed
score block is listed under `errors` and left out of the averages. A score counts
only from the actual reviewer's own report for that candidate and judgment; an
author's report or a delivered file is ignored, and two different reviewer scores
for one review are left unknown.

`workkeel stats --report --cutoff 2026-10-19T00:00:00Z --timezone UTC
[--previous sha256] [--json]` observes the preceding seven days once, then stops.
The fixed cutoff must have an offset and the timezone must be an IANA zone.
The interval includes its start and excludes its cutoff. Selection uses task
history and goal-operation events, including check failures before handoff;
a task's last update is never the period filter. Run this command weekly with
the agreed cutoff. There is no background scheduler or model call.

The report groups task counts, first-pass rate, failed/stopped/unfinished tasks
and rework by risk. First-pass rate is first independent-review passes divided
by tasks whose first independent review happened in the period. Tasks awaiting
their first review are listed separately and excluded from the denominator.
Tasks not yet handed off are also listed separately.
First and last review scores retain their actual reviewer, candidate, round and
evidence; an unscored last review stays unknown even if an earlier score exists.

One correction iteration counts as one rework round. Native review rework and
a goal repair for the same candidate are deduplicated. Several failing checks or
findings in that iteration do not multiply rounds. Check-failure repairs before
handoff are included. A failed check without a repair is a failure, not a repair
round. Unavailable check history makes complete rework totals/averages/maxima
unknown; the report separately shows recorded lower bounds. Scores, unknown task
types, missing checks and source errors have explicit coverage. Native contracts
lack a task-type field: explicit non-code scores are excluded, while unknown
unscored tasks remain visible. Token usage is recorded only, never optimized.

Reason categories are requirements, code-error, tests, evidence, scope,
false-block and unknown. A review reason can declare its category using an
explicit prefix such as `[evidence]`; unclassified prose stays unknown. A reason
category repeated in at least two distinct correction rounds can produce a
candidate. Unknown reasons must also have matching normalized text. Candidates
retain task IDs, candidates, rounds, source events and evidence references.
A low score alone does not authorize work.

Markdown embeds the entire JSON record, so both formats contain identical data.
The report includes rules and filter settings in its input fingerprint. Rules
version `workkeel.stats-report-rules/3` identifies the current L1 accounting; reports
using earlier rules do not share its fingerprint, even with identical inputs. Stop
reasons include `complete`, `no-input`, `unchanged` and `no-candidate`; all are
normal outcomes. Missing data never becomes a pass or a measured zero. The only
suggested follow-up is to submit one L2 proposal for explicit user approval.
The report does not create tasks, lessons or Skill versions.

### Several projects in one report

Pass each project root with `--project`, or list the roots in a file with
`--projects-file`:

```sh
workkeel stats --report --project ../app --project ../tools \
  --cutoff 2026-10-19T00:00:00Z --timezone UTC [--previous sha256] [--strict] [--json]
workkeel stats --report --projects-file weekly-projects.txt --cutoff ... --timezone ...
```

The list file has one path per line. Blank lines and lines that start with `#`
are ignored. A relative path is relative to the list file. You can use both flags
in one command. Do not also give a positional target.

The output schema is `workkeel.stats-multi-report/v1`. All sources use the same
cutoff, time zone and period. `sources` holds one entry per project root with
its `format`, `status` (`ok`, `partial` or `failed`), `fingerprint`, `by_risk`
and `coverage`. A source fingerprint equals the fingerprint of a single-source
report for that root. The top-level `by_risk`, `tasks`, `reasons` and
`suggestions` merge all readable sources. Each task, error and missing-data
record names its `root`. A task with the same ID and the same last history hash
in two sources counts once and is listed in `coverage.duplicates`.

A source is `failed` when the report cannot list its tasks, for example a
missing directory or an unknown project pin. A failed source is not zero. Its
counts are `null`, the merged report sets `stop_reason` to `source-error`, the
merged complete rework totals become unknown, and `coverage.complete` is false.
A `partial` source has some unreadable records; those records appear in
`coverage.errors`.

The report does not read backup copies. The rule checks each segment of a
project path and each entry name in a task store (`.ai-org/work-items/`), for
both current and 0.1.0-beta.1 projects:

- A name `backup` or `backups`, in any case, is a backup directory.
- A name that ends with `.bak` or `.backup`, in any case, is a backup copy. A
  label after it, which starts with `.`, `_` or `-`, also matches, such as
  `app.bak-2026`, `RN-1.json.bak` or `app.backup.1`. A name that ends with `~`
  also matches.
- A task store file named `<task-id>.json` is always a task record. The report
  reads `WK-backup-check.json` and `RN-1.bak.json` as tasks.
- Other names do not match, such as `app-backup`, `mybackup` or `bakery`.

Skipped projects appear in `excluded_sources`, with a repeated root as
`duplicate`. Skipped task store entries appear in the source's
`coverage.excluded`. Only the report skips them. `workkeel status` and the
lifecycle commands still stop on an unexpected entry in a task store.

### Reading 0.1.0-beta.1 projects

The report reads a project with a `workkeel.project/v1` lock pinned to
`0.1.0-beta.1` for statistics only. It reads the task records and their history,
and writes nothing. It does not migrate or upgrade the project. All other
commands, including `status`, `task claim` and `task close`, still refuse that
pin. The report checks each record against the format that 0.1.0-beta.1
wrote, at every level: the record, its contract, claim, delivery, review,
closeout, attempts, pins and history. It also checks the hash chain, the record
digest and the contract digest. A record with an unknown field or value at any
level, or a broken chain, goes to `coverage.errors` with its task ID and the
first failing path. The report does not
guess the missing parts and does not count them as zero. A legacy project has no
goal history, so check repairs stay unknown, as for current projects without
goals.

This changes two single-source results. Before, a report on a 0.1.0-beta.1
project stopped with `source-error` and no data. Now it reads the records and
adds `input.format` and `input.excluded`. Before, a backup entry in a current
task store made the listing fail with `source-error`. Now the report skips it and
adds `input.excluded`. Reports on current projects without backup entries keep
the same fields, fingerprint and exit code.

### Exit codes for schedulers

Without `--strict`, the report exits 0 when it prints a report, as before.
With `--strict`, it exits 3 when `stop_reason` is `source-error` or
`wall-clock-limit`, or when `coverage.errors` is not empty. The report is still
printed, so the scheduler can read the cause. Invalid arguments exit 1.

The optional trial infrastructure, including persistent run limits and sealed
comparison records, is described in [the loop trial guide](loop-trial.md).

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
