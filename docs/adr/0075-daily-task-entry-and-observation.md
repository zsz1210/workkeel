# ADR-0075: Daily task briefs and evidence-first observation

- Status: accepted for implementation
- Date: 2026-09-25

Translate one explicit task brief into the existing native contract and creation
request. Preview returns a fingerprint binding the brief, project policy and
referenced approval bytes; apply recomputes it before calling the existing task
writer. Preview is not approval, a claim or a model dispatch. Unknown policy,
scope, actors or acceptance remain errors rather than inferred grants.

Provide task summaries and optional bounded, append-only observations for check
results and conversation/PR links. Observations are attributed metadata, not
authenticated provider facts or acceptance evidence. They name an exact candidate
when available, source and observation time. Stale/unbound observations cannot
certify the current candidate. Only explicit safe link schemes are rendered.

The foreground loopback observer retains ADR-0074's authority and security
boundary. Its overview, detail and measurements tabs consume validated task state
and a once-per-snapshot execution index. Isolate attributable read errors; unknown
run attribution marks all usage incomplete. No automatic repair, execution,
notifications, credentials, external tracker writes or background collectors.

Native lifecycle acceptance and recorded workflow usage remain distinct. The
quality view derives review/rework from task history, labels sample kind, and
never infers prices or compares unlike measurements. The retained legacy Console
is not migrated or removed. Historical evidence archiving requires verified
readback and preserves exact source revisions.
