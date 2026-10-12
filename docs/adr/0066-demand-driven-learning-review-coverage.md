# ADR-0066: Track Learning review coverage without automatic retrospectives

Status: Accepted for bounded implementation, 2026-09-09.

## Problem and decision

The existing Learning index describes Lessons and Practices. A Work Item with no
linked Lesson may never have been reviewed or may have produced no new lesson.
Record explicit reviews separately, keyed by Work Item and a digest of its exact
terminal outcome and evidence. Keep the existing index unchanged.

The CLI records a human/agent-authored judgment, not proof of its correctness.
`no-new-lesson` requires no Lesson links; `linked-lessons` requires existing Lesson
IDs. Both require a review note and an active Agent Identity. No mandatory model
call, lifecycle gate, background reviewer, promotion or historical migration is added.

Coverage is `not-reviewed`, `no-new-lesson`, `linked-lessons`, `review-required`,
`not-eligible` or `unknown`. Terminal items require a full tested revision or,
where testing did not finish, a recorded Developer candidate. This does not turn
an interrupted candidate into accepted delivery. Outcomes lacking those revisions
remain unknown. The snapshot includes scope, acceptance, unresolved issues,
terminal state/outcome, candidate revisions, evidence and gate references. Local
evidence content is hashed; normalized Evidence IDs resolve to their record files.
Full Git revisions and external URLs are retained as opaque references, never
fetched. Unsupported references make coverage unknown. Claims, timestamps and
other administrative fields do not invalidate a review.

Review files are immutable project-owned records below
`.ai-org/learning/reviews/WI-ID/OUTCOME_DIGEST.json`. Identical retries are no-write;
conflicting judgments for an unchanged outcome fail instead of replacing history.
A changed review note or Lesson makes the prior review stale; restoring the original
content restores its coverage. The initial v1 implementation has no correction
command. The compatible explicit supersession extension below adds that operation
without changing the existing v1 files or weakening their fingerprints.

Single-item queries read only the named Work Item, its review records and relevant
evidence/Lesson references. All-item queries scan Work Item metadata, then only
read evidence for items with records. Status and Doctor inspect this optional
store only when present. No derived coverage file becomes lifecycle authority.
Malformed/missing evidence is unknown; malformed storage is a Doctor failure.
Symlinks, absolute/traversal paths and unexpected record entries are rejected.
Writes use the existing project mutation lock and exclusive atomic creation.

## Consequences and acceptance

This gives an auditable answer to what was reviewed without loading every Lesson
body. Content hashing has filesystem cost proportional to the reviewed evidence;
there is no claim of sublinear all-project querying or measured Token savings.
No semantic retrieval dependency is justified by this feature. Test idempotency,
outcome and evidence changes, malformed input, unsafe storage, concurrency,
no-write queries and existing-data preservation. Independent QA must validate the
exact candidate. Existing Learning validation/promotion boundaries remain intact.

## Accepted extension: compact views and explicit review refresh, 2026-09-10

The three-task pilot found oversized all-item output, stale current metadata in
Learning document headers, and no way to reconsider a review after correcting that
presentation. Add opt-in counts-only review queries and recorded-review counts in
compact Status. Preserve existing verbose defaults and unknown/error signals.

`learning sync-metadata` copies current Status and Last validated fields from the
valid index into one explicitly named document's unique metadata header. It does
not change the index, narrative, validation history, or assert new validation.
Revalidation updates those same current fields as part of its existing operation.
Header synchronization is idempotent and rejects ambiguous headers and symlinks.
Changing linked document bytes still makes existing reviews stale.

An explicitly reconsidered same-outcome review may append a v2 record using
`record-review --supersedes REVIEW_DIGEST --reason TEXT`, a new note path and the
current outcome revision. Its predecessor must be the current chain tip for that
exact outcome. A successor file is named `OUTCOME_DIGEST.REVIEW_DIGEST.json`, where
the latter digest hashes canonical sorted-key JSON of the complete record. V1
roots keep their original names and bytes. V2 records add only the predecessor
digest and nonempty reason; they retain all current actor, note, Lesson and outcome
validation. The query exposes the current `review_digest`, including when its
linked metadata is stale, so the caller can explicitly reconsider that version.

Select the current review by its validated predecessor chain, not timestamps.
Missing parents, forks and malformed files are unknown and reject writes. Stale
predecessor requests fail; an identical retry of the current successor is no-write.
Ordinary conflicting writes remain rejected. Writes use the existing CLI mutation
lock; history is append-only but not cryptographically tamper-proof storage.
Old clients reject v2 records rather than silently treating the v1 root as current;
do not downgrade a project containing successors without a compatibility plan.

This does not automatically re-review changed documents, rewrite historical
outcomes, create Lessons, promote guidance or schedule model calls. An explicit
refresh records a new judgment; it does not prove the judgment is correct.
