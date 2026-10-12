# ADR-0068: Portable completion diagnostics and contributor proposals

Status: accepted for implementation under the maintainer's repair authorization,
2026-09-17. Supplements ADR-0057 and ADR-0067.

The bounded two-machine rehearsal showed that ordinary delivery can start without
local binding, yet an informational maturity warning fails finish after its
lifecycle writes. New clones lose that diagnostic state. Later evidence commits
also make exact-candidate verification fail a blanket HEAD equality check, and a
Developer cannot submit a new intake item under their own identity.

## Decisions

- Classify only Doctor's isolated `COLLABORATION_REAL_VALIDATION_NOT_PASSED`
  maturity warning as informational for ordinary Lean completion. Preserve its
  message. Failures and every unclassified
  warning remain blocking, including integration-policy and recovery warnings.
- Persist a small diagnostic observation beside the existing completion receipt.
  Bind its work item, operation, candidate, plan and receipt hash. Read it for
  navigation across clones; do not copy machine-local journals or treat an
  observation as replay or acceptance authority. Origin records dominate local
  recovery, and conflicting/malformed portable observations remain visible.
- A verifier or identical-request recovery may retain the exact candidate after
  a descendant commit containing only bounded delivery administration and named
  Markdown evidence. Check every changed path, not just declared product paths.
  Inspect every intervening parent diff as well as dirty/untracked paths; a
  reverted source/policy commit is not administrative history. Candidate ancestry,
  clean product scope, unchanged product blobs, current
  qualification, evidence hashes and snapshot guards remain required. Developer
  first delivery still pins current HEAD.
  Scope, approval, design and other pre-delivery gate evidence outrank the
  administrative path allowance, even in the item's own artifact directory or
  through normalized evidence references. Check pre-candidate authority bytes
  physically so Git index flags cannot hide drift; reverted authority changes
  remain non-administrative history.
  Physical authority validation also precedes exact-HEAD completion, for both
  Developer and Verifier; HEAD equality is not proof of unchanged working bytes.
  Other own-item artifacts must also be absent from the candidate and explicitly
  referenced evidence or named finish/diagnostic outputs; a directory is not a
  blanket allowance for changed existing artifacts or unreferenced new files.
- Add explicit `work-item propose`: a contributor acts in their own qualified
  Position and records provenance, while the item remains unclaimed at intake
  under its configured manager. Existing create, claim, transition, assignment
  and acceptance rules remain. The proposal is a request, never approved scope.
- Report competing claims with both stable actors and original branch/base facts.
  Do not infer a winning owner or silently union conflicting Work Items.

## Validation and compatibility

Use synthetic clone fixtures and fault injection, including changed source outside
declared scope, dependency/policy drift, unknown warning, unavailable journal,
malformed/path-escaped observation, wrong sponsor, inactive member, and conflicting
claim apply. Preserve original failures and report elapsed process time separately
from model latency or billing. Full Node 24 verification and distinct review remain
required. A second real GitHub account and independent humans are not simulated by
these fixtures. No release or downstream rollout is implied.
