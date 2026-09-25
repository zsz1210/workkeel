# Recover reports committed after their tested candidate

Use this only when an existing registry record has the correct artifact digest but
the artifact path is absent at its tested `scope_revision`. Keep the original
registry and failed/invalidated attempts. Recovery is not candidate acceptance.

1. Inspect `evidence durability` and the original record. Locate an exact commit
   containing the recorded bytes, independently review that source, and preserve
   both commits in your retention process. Do not use today's file or a branch name.
2. Write an explicit request (full 40-character commit IDs):

   ```json
   {"sources":[{"evidence_id":"EVID-ID","path":".ai-org/artifacts/WI-ID/report.md","source_revision":"0123456789abcdef0123456789abcdef01234567"}]}
   ```

3. Append the immutable map:

   ```sh
   node ./templew.mjs evidence record-sources . --source request.json --json
   ```

   Save the returned `source_map_path`. Repeating identical input is idempotent.
   Both exact commit objects must be available. Source bytes must match the
   original artifact hash and any recorded size. Symlinks, unsafe paths, duplicate
   entries, incorrect bytes and overrides of existing tested-scope objects reject.
4. Select the map explicitly, together with every evidence ID named in it:

   ```sh
   node ./templew.mjs evidence export-bundle . --evidence EVID-ID --source-map .ai-org/artifacts/evidence-sources/DIGEST.json --output recovered.json --json
   node ./templew.mjs evidence verify-bundle . --bundle recovered.json --json
   ```

   Repeat `--evidence` for multiple records. A map binding unrelated to the selected
   records rejects. `evidence durability` also accepts `--source-map`; its Work Item
   filter must include every mapped record. Without a map, original retrieval and
   v1 export behavior remain unchanged; source maps are never discovered implicitly.
5. Verify/import the v2 archive in a separate location and retrieve each artifact.
   `verifyEvidenceBundle`, `importEvidenceBundle` and `retrieveEvidenceBundleArtifact`
   in `src/evidence-bundle.mjs` support both versions. Import stores an immutable
   archive without rewriting registry/gates. Compare byte hashes and retain the
   original failed export, source request, map, archive and readback observations.

## Interpret the result

`scope_revision` remains the tested candidate. `source_revision` identifies the
artifact file. `original_revision_availability` and
`artifact_source_revision_availability` are separate. Unknown availability without
a target is `null`; unavailable Git objects in a target are `false`.
`tested_revision_is_ancestor` can be false after a squash; it grants no authority.
`archive_integrity: verified` establishes internal byte consistency, while
`source_authentication: not-established-by-archive` and `acceptance_granted: false`
remain explicit. An attacker able to replace all metadata and hashes can forge a
self-consistent archive when Git sources are absent: checksums are not signatures.

Full registry-entry binding preserves outcome/invalidation metadata. A later
registry change makes an old map stale for new exports. Review and append a new map
instead of changing the old one. Do not delete history based on a successful pilot;
complete source retention, portable readback and retention approval separately.
