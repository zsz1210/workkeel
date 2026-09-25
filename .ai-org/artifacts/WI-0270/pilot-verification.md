# Historical source pilot

On 2026-09-25 the coordinator selected these existing WI-0168 records:
EVID-20260905T001504Z-9FB745D0, EVID-20260905T001816Z-6A71EB55,
EVID-20260905T002557Z-0BC00026. All retain tested scope
`a9265f7e10ecb08cec6474adfc8d35050abfca38`.

Four reports match exact bytes in `bf608931cf62f82a15a6fac07e9a5f617801860c`;
the rollback plan matches `775110db1cd250198e8586dae5127525978a1cdc`.
These squash-delivered source commits do not descend from the tested commit.
The appended source map is
`.ai-org/artifacts/evidence-sources/b8c1a5c227fb702b6cb79a229f5e79e53de90d730bf2292d1713d980f6b4d307.json`.

The CLI recorded and idempotently replayed the map, then exported all three records
as v2. All five artifacts (5,788 bytes total) imported and read back byte-for-byte
in an isolated directory with neither Git source available. Both availability
fields correctly reported false. Tampered bytes rejected. Before/after registry
bytes were identical. Original scope, outcomes, hashes and metadata were retained.
No deletion or acceptance was performed.

External detailed evidence is in the task output directory
`outputs/workkeel-evidence-source-repair-20260925/`: source-request.json,
baseline-export.json, source-map-recording.json, source-map.json,
recovered-bundle.json, export-verification.json and pilot-result.json.
These are coordinator observations, not independent QA or complete historical
recovery. The earlier 147 export blockers were a bounded scan, not a full count.
