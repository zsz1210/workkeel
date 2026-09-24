# Integration review boundary

WI-0267 owns monitor modules, public entrypoint, scripts and public documentation;
WI-0268 owns publication scanning and its exact binary-review artifacts. They
share no implementation paths. Integration owner: agent-mog. Both retain Standard
gates and an actual independent QA runtime distinct from either implementation.

The pinned CLI rejected an attempted affected-path configure option before
mutation because it is unsupported. No canonical JSON was edited to bypass it.
Implementation remains in the initially declared paths: CLI integration is in
`bin/workkeel.mjs`; the formatter is `src/workkeel-monitor-view.mjs`.

The package adds exactly four distributable files: two monitor modules, ADR-0074
and the development routing evaluation. They are required by the package guard;
the count increases from 489 to 493, with the unchanged 8 MiB unpacked cap and
unchanged allowed roots. The first package check correctly rejected the increased
count before review. No external launcher, LiteLLM installation, raw receipts,
tests, scripts or browser captures are packaged. No dependencies or licenses change.

The separate external measured launcher passed the real implementation/review
pair. Subsequent prompt-equality and adapter-selection hardening is offline-tested
only, deliberately without another model call. Three new guard tests plus four
existing classifier/sandbox tests pass. Its old interactive terminal path is not
claimed qualified. User-facing personal documentation gives an explicit measured
entry for an existing approved/claimed one-step task, never inferred approval.

Public documentation uses the project-documentation skill: reader-facing defaults,
one optional monitor command, links to detailed limits, aligned README languages;
past failures stay in validation history rather than cluttering onboarding.
