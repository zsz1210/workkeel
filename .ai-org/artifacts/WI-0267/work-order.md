# WI-0267 — measured development routing and an on-demand monitor

## Authority and acceptance

The maintainer approved all five proposed follow-ups and ordinary PR integration
on 2026-09-24. Principal human; manager agent-mog; specification/UI agent-yuna;
technical design agent-tidus; Developer agent-rikku; independent QA agent-lulu.
Complete a real bounded maintenance task with Luna implementation and Sol review,
verify selected/runtime model attribution through the external development entry,
document conservative escalation, join WI-0268 publication-audit work, and deliver
an optional read-only task monitor with aligned English/zh-TW/Japanese READMEs.
No native app, persistent daemon, releases, tags, paid APIs, global configuration
changes, credits purchases/resets, or automatic Astra calls.

## Technical design

Use existing task/workflow measurement readers, never arbitrary app-session logs.
Add an explicitly started localhost-only HTTP viewer with exact routes, read-only
methods, capability-token access and Host/Origin checks. Render text safely, no
external assets, provider calls, task mutations or telemetry. Stop with Ctrl-C.
Show lifecycle state separately from runner state; requested/runtime/backend
models separately; incomplete usage, cost and percentage remain unknown. Attempt
counts are not a claimed percentage or proof of acceptance. Retry reads only on
the next poll, show stale/error clearly and never silently keep a green snapshot.
Keep personal LiteLLM classification/launch code outside the framework/package.
Use native qualified Codex monthly authentication and its existing restrictive
adapter for measured dispatch; do not use an OAuth proxy or relax isolation.

## Real maintenance pilot and explicit stop

Implement the small pure display-formatting helper used by the actual monitor.
Pin its contract and independent checks before dispatch. Luna implements, Sol
reviews that exact source, then at most one Sol repair for a settled quality
failure. Maximum three steps, 120 seconds each, ten minutes from first dispatch;
fresh shared weekly quota before every dispatch, stop at or below 30% remaining.
No automatic retry after timeout, infrastructure failure, runtime-model drift,
unknown outcome or missing quota. Record immutable intent/result, source hashes,
first-pass/repair counts, input/output tokens and elapsed time. Backend model and
subscription dollars remain null unless actually observable. This is one real
maintenance sample, not a statistical model ranking; coordinator usage excluded.
Use an isolated public source packet with only the helper writable, no network,
installs, credentials, arbitrary host files or repository lifecycle mutation.
Coordinator tests the submitted code because the restricted tool runtime lacks
Node. Stop this experiment after the prescribed result; no follow-on inference.

## Routing rules

Explicitly bounded low-risk work with a verifiable contract may use Luna;
ambiguous, complex or consequential work uses Sol. Confirmed quality failure may
escalate once to Sol within the same budget. Infrastructure uncertainty stops
without a model escalation. Astra requires an explicit separate request. A local
heuristic is advisory, not reliable semantic understanding or a savings guarantee.

## Verification and rollback

Focused deterministic and browser tests, full final behavioral verification,
Doctor, exact-revision independent QA and normal protected PR merge. Preserve
failed evidence. Revert reviewed source changes through a new commit if needed;
do not rewrite audit events or account configuration. No extra dependency added.

