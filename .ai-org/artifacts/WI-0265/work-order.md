# WI-0265 — bounded development model pilot

## Authority and approved scope

The maintainer explicitly authorized completing a Luna/Sol matched-task pilot and
delegated round/budget decisions. They also authorized evaluating LiteLLM Auto as
an optional personal development tool, not a Workkeel core dependency. This is new
authority; it does not rewrite any earlier failed or stopped qualification.
Principal: human. Coordinator: agent-mog. Developer: agent-rikku. Independent
review must use a separate runtime and agent-lulu.

## Experiment design and observable stop

- Three fixed synthetic JavaScript tasks: interval bug fix, dependency-ready
  selection, incomplete token accounting. Two models: gpt-6-luna and gpt-6-sol,
  both medium effort. Identical prompts and starting files within each pair.
- Fresh isolated Git fixtures, only synthetic public data, no tool network, only
  `src` writable, no inherited tools/plugins/skills. Existing qualified monthly
  Codex host; do not weaken its sandbox, authentication or transport checks.
- Alternate model order across pairs. One initial attempt each, at most one
  repair after a settled quality failure with deterministic test feedback.
  Maximum 12 model work steps, 90 seconds per step, 20 minutes from first live
  dispatch. Each step may contain multiple model/tool calls. No Astra or paid API.
- Persist plan/source hashes before spending; exclusive intent/result records
  prevent silent replay. An unfinished intent or infrastructure failure stops
  the pilot. Preserve all attempts, including failures; no retry of uncertain
  operations. Repairs are new conversations with the prior code plus test feedback.
- Recheck account-shared weekly quota before each pair. Starting observation is
  45% remaining. Stop before the next pair if remaining is <= 40%, any limit is
  reached, usage is unavailable, or monthly login/model/sandbox is incompatible.
  This is a conservative account-level brake, not a per-pilot attribution or
  precise hard subscription cap. No purchase, reset credit or API fallback.
- Completion: three pairs or first stop condition. No expansion of sample size
  or automatic next experiment. n=3 per model is diagnostic, not statistical proof.

## Acceptance and technical design

Use external deterministic checks of model-written modules, not self-reported
success. Report first-pass and final pass, repair work steps, observed input/output
tokens with completeness, adapter elapsed time including setup/tools/cleanup,
and suite wall time separately. Cost remains null for subscription use; distinguish
requested, runtime-confirmed and independently observed backend model.
Offline tests exercise fixtures, unknown usage, budget and immutable-record guards.
Read-only measurements must retain partial observations on failure.

Evaluate LiteLLM using pinned primary-source versions, Auto feature licensing,
subscription compatibility and security information. Activation requires a safe
isolated profile, no global Codex rewrite, no unsupported account entitlement or
paid add-on. If those prerequisites are not established, deliver the evidence and
keep it disabled; do not substitute a different product without explaining it.

## Risk review and exclusions

No API credentials are requested or copied. No account changes, paid service,
production data, background daemon, UI rebuild, publication, push, dependency
in core, upstream license bypass, or change to user's default model. Optional
integration activation requires an ADR, exact pin, license review and tests.
Auth interaction or entitlement uncertainty is a real boundary, not a reason to
spoof a client or broaden permissions. This work does not qualify all workflows.

## Verification and rollback

Full offline verification on the final executable candidate, Doctor, and distinct
review. Retain local-only evidence. Revert only this candidate's authored files
if rejected; preserve raw pilot attempts and existing user work.
