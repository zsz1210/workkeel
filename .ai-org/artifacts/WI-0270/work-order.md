# Explicit historical evidence sources

The maintainer approved proceeding with historical source repair on 2026-09-25,
including implementation, verification and ordinary PR integration. Pilot three
WI-0168 records whose reports were committed after their tested candidate.

## Approved scope and acceptance

Append immutable, content-addressed source maps bound to complete original
registry entries and artifact hashes. Keep scope_revision as the tested candidate;
source_revision identifies exact artifact bytes in Git. Never rewrite the registry,
discard invalidation/failure history, substitute working-tree bytes, or grant
acceptance. Export and read back portable v2 bundles with explicit source metadata;
v1 remains compatible. No deletion, installation, account/global configuration
change, deployment or package release. Review actual five pilot artifact hashes.

Reject unsafe paths, symbolic links, stale entry bindings, wrong hashes, malformed
or duplicate maps and oversized input. A mapping cannot override an available
artifact at the tested revision. Preserve unknown Git availability during portable
readback. Full offline verification and distinct actual candidate review precede
normal merge; save an external Traditional Chinese report and synchronize runtime.

## Design and risk review

Use a separate temple.evidence-sources/v1 map and explicit --source-map opt-in.
Map creation requires both exact commit objects and missing artifacts at the
tested revision, plus identical source bytes. Squash integration means ancestry
is an observation, not a requirement: matching content and map integrity are not
source authentication, review approval, or acceptance. Registry changes make a map
stale; append a newly reviewed map instead of modifying an old one. Map output
uses safe paths, project mutation locking and exclusive durable creation.

No UI changes. Root coordinates administrative roles and implementation; a real
separate GPT-6 Sol review judges the frozen candidate, with coordinator-run tests.
Rollback is an ordinary revert. No existing evidence is removed.
