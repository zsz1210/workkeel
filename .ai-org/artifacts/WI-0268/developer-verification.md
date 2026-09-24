# WI-0268 Developer implementation evidence

Base revision: `c9d5ad7741bcf21de6f55825b42d67988372358f`. This is a working-tree Developer result, not an exact committed candidate or independent QA judgment. The integration owner will pin the joined revision and run full verification.

## Scanner result

- The existing profile's 2,097,152-byte in-memory threshold remains unchanged. Larger current regular files stream in 65,536-byte reads with a 67,108,864-byte total cap, a 4,194,304-byte logical-line cap, and a 10,000-finding cap. Exceeding any cap is a blocked inspection failure, with no partial findings reported. Smaller files are read only to their observed size plus one byte and checked for drift before classification.
- The scanner buffers only one logical line while hashing all read bytes. The existing text rules, match values used for fingerprints, CIDR exception, and one-based line numbers are preserved. UTF-8 sequences can cross read boundaries because decoding occurs after the logical line is assembled. The private-key header rule contains literal spaces and cannot match across a newline; this is the existing rule behavior.
- A NUL byte found late makes the entire file binary review-required; earlier tentative text findings are discarded. Changes between initial metadata, opened file, and completed scan produce a blocked drift finding for both small and streamed files. History scanning retains its prior limit and scope.
- Current public repository audit: zero blocked text findings, 117 generic binary-review findings, and one exact-provenance reviewed adapter fixture. The oversized current event journal has no finding. Overall status remains `review-required`; publication is not authorized.

## Exact binary inventory

`binary-review-addendum.json` binds 49 additional tracked binary paths to SHA-256, byte size, kind, and review method. The separate verifier reconciles their union with the 68 unchanged prior reviewed PNG records to the full 117-path tracked binary inventory. It checks the seven matching older archive provenance digests and treats the remaining closeout archive as bound only by this addendum. It rejects stale provenance, new paths, missing paths, changed bytes, malformed archives, unreviewed PNG metadata, and unmatched privacy patterns.

The eight new PNGs received original-size visual inspection and PNG text/EXIF chunk inspection. Thirty-three compressed artifacts had no publication-rule matches in decompressed regular payloads. Eight compressed artifacts had 42 home-path rule matches in total, all exact uppercase redaction placeholders; their respective counts are 1, 1, 2, 33, 2, 1, 1, 1 in addendum order. No other publication-rule category matched those decompressed payloads. Archive bytes and existing provenance were not changed. This is inventory-specific review of current digests; generic binary-review findings remain and this does not certify future bytes or authorize publication.

If a future publication criterion requires zero literal home-path-shaped placeholders even inside archives, produce new current-tree public copies with a non-path placeholder, then record new archive/member digests and forward provenance/evidence corrections. Preserve the original records and Git history. That cleanup was not performed in this slice.

## Focused checks

- `node --test test/publication-audit.test.mjs .ai-org/artifacts/WI-0268/binary-review-check.test.mjs`: 13 passed, 0 failed. Coverage includes chunk-spanning long token, UTF-8, newline and private-key rule behavior, CIDR exception, late NUL, file/line/finding caps, small and streamed drift, and stale/new/missing/tampered inventory lists.
- `node .ai-org/artifacts/WI-0268/verify-binary-review.mjs`: `exact-inventory-reviewed`, 68 exact prior matches, 117 current binary paths, 76 visually reviewed PNGs in total, 33 clear archives, eight redaction-placeholder archives.
- `git diff --check`: passed.

## Source fingerprints for integration review

| Path | SHA-256 |
| --- | --- |
| `src/publication-audit.mjs` | `a09b33822a8359507ea21b2698bf5001a211bd736ea15fa27b80b636795c889d` |
| `test/publication-audit.test.mjs` | `01f394e8643d5bf98bd1b4e39746ea963de942a30281771b2a1e696d13172a9f` |
| `.ai-org/artifacts/WI-0268/binary-review-addendum.json` | `ee01223849a486883577b3064f60be4391f62925932d7818932f7e3ba90dc2fb` |
| `.ai-org/artifacts/WI-0268/verify-binary-review.mjs` | `b029ae72807867eb87a5a4bd8fb5753862a5e00121be7b8f5a702fda75dd449c` |
| `.ai-org/artifacts/WI-0268/binary-review-check.mjs` | `5df494a144bbac5a7ab1a6e974725493f2c842f9e536a97e413c9dfa4d3700ff` |
| `.ai-org/artifacts/WI-0268/binary-review-check.test.mjs` | `8dd5971b8a4925094e808c9afa400dc067414620f1530e108ef4c603e0e96319` |

QA can review the source change with `git diff -- src/publication-audit.mjs test/publication-audit.test.mjs`; the newly added inventory and verifier files are under this Work Item's artifact directory.
