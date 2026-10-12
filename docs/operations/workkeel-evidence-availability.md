# Evidence availability and media retention

Large movies and frame sequences are not required to retain usage counters,
task history or small test reports. Keep the original reports, candidate revision,
media manifest with size and SHA-256, and any authorized retirement receipt.
Keep the latest required capture and comparison baselines according to the
project's retention policy. This document does not authorize deleting any file.

A prior passing test remains a recorded historical result after media removal.
Its visual evidence may no longer be replayable. A checksum identifies expected
bytes; it cannot reconstruct deleted bytes or prove current availability.
Missing media does not prove that a test failed, that an Agent spent zero time,
or that a task should be accepted. Current visual acceptance may require a new
capture if the necessary original cannot be retrieved.

The optional source-checkout helper produces a read-only inventory:

```sh
node scripts/workkeel-evidence-availability.mjs /absolute/project /private/request.json
```

```json
{
  "files": [
    {"path":"Evidence/latest.mp4","bytes":123,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
    {"path":"Evidence/older.mp4","archive_path":"Evidence/archive.zip"}
  ],
  "retirement_journals":[
    {"path":"Evidence/cleanup.jsonl","format":"slime-retirement-jsonl/v1"}
  ]
}
```

File paths are explicit repository-relative references. The helper reads no
media bodies, follows no symlink and changes no project file. The caller chooses
the inventory; this is not a completeness claim about all project evidence.
It distinguishes present files, size mismatch, recorded retirement, unexplained
absence, unsafe/unavailable paths and uninspected archive leads. SHA-256 values
are declared metadata, not newly verified hashes. A present file is not a
successful replay or content-integrity check.

The optional Slime adapter validates bounded JSONL receipts with an authorization
header, unique retire rows, a final completion row and matching file/byte totals.
The header records the earlier operator's statement; it grants no authority here.
Incomplete or conflicting receipts cannot explain a missing file. Availability is
checked separately, so a recreated file is present even when an old receipt exists.

Keep these three questions separate in reports: what the test reported, whether
its original media is currently accessible, and whether the current candidate
has been accepted. The tool does not mutate any of those historical decisions.
Historical claim-proof errors in usage are a separate issue; see
[dispatch retained claim evidence](workkeel-native-dispatch.md#retained-claim-evidence).
