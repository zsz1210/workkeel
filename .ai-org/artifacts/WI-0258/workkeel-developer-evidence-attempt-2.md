# WI-0258 — Corrected lifecycle candidate

Candidate: `6bb9c98e25fe6056621ba4189ce0ed640e8f4438`.
Developer: `agent-rikku`, Principal `human`. This is a new attempt, not reuse of
the rejected candidate's acceptance evidence.

## Rework resolution

Independent review rejected `3dfb3094716b207cfc0c33a411ee7c506ba7dccf` because
real legacy initialization installs `.ai-org/work-items/README.md`, rejected by
both migration preview and the task store reader. The failure and its original
measurement are retained in `workkeel-independent-review.md` in this directory.

The corrected implementation permits only that named explanatory entry in legacy
migration, reads it with the bounded no-symlink reader, and includes its digest
in the reviewed migration fingerprint and preserved history. Task listing only
accepts it when pinned by the legacy manifest and unchanged. It is not counted
as a task. Unknown entries, changed content and symlinks remain rejected.

A real CLI initializer regression now verifies no-write preview, stale README
fingerprint rejection, unknown-file/symlink rejection, byte-preserved apply,
correct migrated-record count, generated Workkeel launcher Doctor and empty task
listing. Post-migration README tampering fails listing and diagnostics.

## Exact-candidate results

The same final source includes the coordinated WI-0259 package rename and genuine
test-slimming main integration. Complete `npm run verify` passed on the exact
candidate: exit 0, 131 files, Node.js v24.7.0, real 335.35 seconds, user 1605.39,
sys 733.67. Complete original log is
`.ai-org/artifacts/WI-0259/workkeel-verify-6bb9c98e.log`, SHA-256
`4a2bd1ab486491545c7685c2aa9834ed893e5fea17cda576b9dfe288c04a9f8c`.
The original reporter's whitespace is retained; do not rewrite raw evidence.

The final full measurement includes all contract, lifecycle, runtime, branding,
legacy upgrade/recovery and installed onboarding tests. Structural, links and
package checks passed (469 files). Focused lifecycle/runtime/branding had 16
passing cases before the later naming-only onboarding fix; the latter isolated
case passed before the final complete run. No test was removed or weakened.

## Handoff

Request fresh independent judgment of the corrected candidate, especially real
init → migration → status/doctor and the prior candidate/metadata/dependency
boundaries. The original reviewer scratch checks remain available for replay.
Reuse the compatible full measurement, not its Developer judgment; do not run
the full suite redundantly. Complete normal Standard Test/Eval/Independent QA
and return to Release Gate only if all applicable acceptance passes.

Actual host execution remains native. Gateway plans neither read keys nor start
providers; live LiteLLM/Responses tools, automatic task-first dispatch, remote
coordination and production use remain unverified. No model spending or global
configuration change is authorized. Rollback is a reviewed revert preserving
records; do not delete locks or rewrite failed history. No external release is
performed by local lifecycle acceptance.
