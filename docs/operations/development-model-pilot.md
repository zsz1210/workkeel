# Development model selection: bounded pilot

This is a maintainer development experiment, not a default Workkeel policy or a
quality benchmark. Workkeel's core and dependencies are unchanged.

## Native Codex pilot: stopped, inconclusive

On 2026-09-23 UTC, the authorized plan allowed three matched synthetic JavaScript
tasks, Luna/Sol both at medium effort, up to one repair per initial failure,
12 work steps and 20 minutes. It used existing ChatGPT subscription authentication,
no Astra, no paid API, and no tool network. A conservative shared-quota brake was
checked before each pair. Five work steps actually ran before the stop condition.

Only the interval-merge task is a valid completed matched pair:

| Model | Checks | Repairs | Input tokens | Output tokens | Adapter elapsed |
| --- | --- | --- | --- | --- | --- |
| gpt-6-luna | 13/13 | 0 | 44,624 | 1,082 | 35.44 s |
| gpt-6-sol | 13/13 | 0 | 87,342 | 2,645 | 78.27 s |

The dependency-selection task is **excluded**, not scored as Sol failure. Two
oracle expectations contradicted the wording about missing task IDs. This caused
one unnecessary Sol repair. Luna then returned attention after writing its module
because it could not run Node.js in the restricted tool environment. The runner
stopped; the third task was not dispatched. Original results and the flawed oracle
remain preserved at the live revision. They were not overwritten with passing
post-hoc scores.

The five steps recorded 326,403 input and 7,742 output tokens (334,145 combined),
251.33 seconds of adapter work, and unknown subscription dollar cost. Those totals
include the invalid pair and its unnecessary repair. Adapter time includes setup,
model/tool calls and cleanup; it is not pure model compute or suite wall time.
Full offline verification overlapped the experiment, so timing also has a local
load confound. Input counts include repeated context; they do not establish
cache-adjusted charges or monthly quota savings. Coordinator/helper usage is not
included. Account-wide remaining quota moved from 45% during planning to 43% after
the stop; this is not attributable solely to the pilot.

The original live candidate was `d45b4eec95665049a1c1fb7e1308cc01255e3cf7`.
The machine-readable [results](../../.ai-org/artifacts/WI-0265/pilot-results.json)
bind source hashes, original checks, model confirmations and raw report hashes.
Runtime-confirmed models are not independently observed backend models.

## Offline correction and next decision

The harness now explicitly defines missing dependency IDs, corrects the two cases,
and includes a regression case for an absent-but-completed ID. The task prompt now
states that the coordinator performs independent tests and that Node.js is not
available in the model sandbox. This corrects the experiment contract without
broadening sandbox permissions or pretending the model ran checks.

These changes are offline-tested, **not live requalified**. No additional model
calls followed the stop. Do not report a three-case success rate or use the flawed
repair count to choose a winner. Before another separately bounded pilot, have an
independent reviewer validate the oracle and avoid simultaneous CPU-heavy tests.

The manual harness is source-checkout-only, excluded from the published package.
`prepare` creates an exclusive plan; `run-pair` requires explicit subscription
opt-in and a fresh quota observation. An unfinished attempt, source drift or
infrastructure failure rejects continuation. A fresh directory is not permission
to spend again; obtain a new bounded work order first.

## LiteLLM option

[ADR-0074](../adr/0074-external-development-model-selection.md) keeps this outside
the framework. The personal prototype uses LiteLLM 1.101.0's **local heuristic
classifier**, then offers native Codex as the executor. It is not a LiteLLM proxy
and does not automatically switch models inside the current Codex app task.

The real classifier ran with denied network, write access and unrelated project
reads in a version-pinned Codex sandbox. Its environment excludes credentials.
Four offline checks cover real classification, a conservative bilingual selection
guard, denied access and launch argument boundaries. The isolated installation
is about 236 MiB on this machine; there is no always-on process. Cold startup is
not sub-millisecond: the four classification samples plus tests took about 5.6 s.

The raw heuristic misclassified a Chinese authentication/migration task as SIMPLE.
Therefore only explicitly mechanical SIMPLE tasks select Luna; unclear, general
or risk-sensitive work selects Sol. Both are medium effort. No Astra destination
or paid fallback exists. Preview is the default. Explicit interactive launch
requires existing ChatGPT login and does not edit global configuration. Interactive
launch itself was not exercised with a new paid/subscription inference call.

This is a conservative personal recommendation tool, not validated optimal routing.
The LiteLLM OAuth/proxy route for this account remains unverified and disabled.
No third-party implementation is vendored into Workkeel; dependency licenses stay
with the separate installed distributions. No package or release was published.
