# Data recovery handoff

Candidate: `bf03d754dddfd658efc1bfa5f63e0d545d76e3db`.
Developer attribution: agent-rikku; coordinator executed the audit and recovery.

The complete current 594-record snapshot is classified. Nineteen immutable maps
recover 922 missing artifact references; existing prior mapping is unchanged.
Full readback covers 589 records / 1,800 references. Four invalidated contradictions
and one explicitly unversioned claim remain visible. Three otherwise missing files
inside two contradicted records are preserved as partial content, not full bundles.

Exact counts, SHA-256s, source retention and Python/Git crosscheck are in
recovery-index.json and recovery-summary.md. Registry bytes are unchanged.
`npm run verify:fast` passed; candidate Doctor reports 36 pass, 1 known stale
parallel-plan warning, 0 fail. No product or schema changes; prior exact-code full
verification is referenced honestly rather than claimed rerun. Actual separate
GPT-6 Sol data/evidence review is running and must provide its own final judgment.

No deletion is approved by this audit. Original referenced paths, Git history,
preservation tags and historical exceptions remain necessary retention inputs.
