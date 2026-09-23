# Publication evidence review

Status: historical exact-candidate review for WI-0162, not current-tree clearance.
The results below apply to the recorded revision only. Later repository changes
require a fresh audit; this report does not establish that today's tree is safe
to publish.

Work Items: `WI-0160` through `WI-0162`

This review answers a narrow question: what remains in Temple's current tracked evidence surface after blocked private values were removed, and what must happen before the repository owner considers public visibility?

## Result

The public-profile audit reports zero blockers on both repository and package surfaces. `WI-0161` reduced the canonical-state queue from 245 occurrences to zero. `WI-0162` then normalized 70 retained-artifact occurrences across 59 files, replaced 18 literal first-party fixture occurrences, and recorded one provenance-bound allowed disposition for the unchanged pinned Archify fixture.

No unresolved text finding remains. The audit still reports `review-required` for 68 PNGs because text inspection deliberately cannot certify binary content. All 68 PNGs passed the separate digest-bound review below; changing any image bytes invalidates that evidence. This is current-tree preparation evidence, not publication authority.

Independent QA reproduced the final result in a clean detached worktree at `9012ece9e1ff3871f8e24bfc68ec79f77060d5a8`, including all 443 tests, Doctor with zero failures, exact adapter provenance, and the retained binary digests.

## Text findings

| Area | Original finding records | Original occurrences | Files | Current result |
| --- | ---: | ---: | ---: | --- |
| Canonical Work Items and project registries | 245 | 245 | 50 | Resolved by the stale-safe, field-aware WI-0161 operation |
| Retained self-host artifacts | 70 | 70 | 59 | Resolved by the revision-bound WI-0162 artifact plan/apply operation |
| First-party test fixtures | 14 | 18 | 2 | Runtime behavior preserved; audit-shaped literals removed from tracked source |
| Pinned Archify test fixture | 1 | 1 | 1 | Allowed only at the exact source and installed-manifest digest; the fixture bytes remain unchanged in the reviewed v2.16.0 base |
| **Total** | **330** | **334** | **112** | |

The table preserves the original WI-0160 review baseline. The WI-0161 command normalized 315 fields across two exact plans: released claim worktrees, terminal worker and task worktrees, twelve Evidence-detail values, and one allowlisted Work Item description. Evidence IDs, revisions, artifact paths, and artifact digests remained unchanged.

By rule, the queue contains 279 home-path occurrences, 49 private-address occurrences, and six private-Tailnet-host occurrences. The new inventory retains paths, line numbers, rule classes, and counts, but never copies the matched value or source-line text.

The largest original cluster was durable lifecycle history: 187 values occurred in historical claim entries and 40 in the current claim field of terminal Work Items. That is why WI-0161 used a schema-aware operation instead of mass replacement. Retained artifacts then used a separate plan that records file-level before/after digests while leaving Git history intact.

## Binary review

All 68 tracked binaries are PNGs: 21 retained artifact images and 47 real-browser screenshots. Together they occupy 15,455,256 bytes.

Every image was included in an ordered contact-sheet inspection. Dense command, configuration, and workflow views also received original-size inspection. Apple Vision OCR found no home path, maintainer identifier, private address, Tailnet hostname, email address, or live account-state value. Five command-gateway screenshots contain generic credential-warning copy; that is safety guidance, not a credential. PNG chunk inspection found no embedded text or EXIF payload in any file.

The images may remain at their current digests. Any changed image bytes require a new review.

## What Temple automates safely

- Rebuild the value-redacted finding inventory.
- Verify audit totals, file paths, line numbers, rules, binary digests, dimensions, and metadata.
- Detect drift when a reviewed binary changes.
- Apply schema-aware canonical-state normalization through an exact reviewed plan.
- Apply tracked retained-artifact normalization through a separate exact reviewed plan.
- Accept one reviewed adapter fixture only while the current source digest matches its installed provenance manifest.

## What remains separate

1. Repeat the public audit and full verification at the frozen release candidate.
2. Let the repository owner decide whether already-shared historical Git objects are acceptable.
3. Separately decide whether repository visibility, version, tag, Release, or npm state may change.

No version, tag, GitHub Release, npm publication, announcement, visibility change, or Git-history rewrite was authorized or performed by this review.

## Reproduction

```bash
node ./templew.mjs publication audit . --profile public --surface both --json
node ./.ai-org/artifacts/WI-0161/verify-canonical-normalization.mjs
node ./.ai-org/artifacts/WI-0162/verify-current-publication.mjs
node ./templew.mjs publication artifact-plan . --json
npm run verify
```

Machine-readable evidence:

- [Text inventory](../../.ai-org/artifacts/WI-0160/text-inventory.json)
- [Binary review](../../.ai-org/artifacts/WI-0160/binary-review.json)
- [Retained-artifact normalization plan](../../.ai-org/artifacts/WI-0162/artifact-normalization-plan.json)
- [Retained-artifact normalization result](../../.ai-org/artifacts/WI-0162/artifact-normalization-result.json)
