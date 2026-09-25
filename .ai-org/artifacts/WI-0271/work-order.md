# Complete historical evidence inventory and bounded source recovery

On 2026-09-25 the maintainer approved proceeding with the recommendation to
classify the remaining historical evidence, append exact sources where recoverable,
verify portable readback, and assess retention. Normal PR integration remains
authorized. This extends the three-record WI-0270 pilot using its shipped APIs.

## Scope and acceptance

Inventory all 594 current registry records and 1,820 artifact references at base
`ff94b638f49fea215cec0e579b92159e1a852628`. Preserve the registry byte-for-byte,
existing maps, outcomes, invalidations and failed export evidence. Classify each
record and artifact, distinguishing unavailable commits, missing reports with exact
later sources, unrecovered content, and existing-source contradictions. Counts must
reconcile to the full snapshot; the prior 147 failures were not a full census.

Use existing explicit source-map recording, export, verify/import and retrieve
APIs. Every new source requires an available exact commit, regular file, matching
original SHA-256 and recorded size, and absence at tested scope. Search reachable
repository history only. Preserve ambiguous/unrecoverable/contradictory records as
debt; never weaken guards or modify registry hashes. Batch at most 25 records and
within existing byte limits. Retain prior three-record map without rewriting it.

Export fully retrievable selections and read each artifact back in an isolated
directory without source Git objects. Verify identity, metadata, original bytes,
invalidated states, mutation boundaries and rejected tampering. Retain an external
complete inventory, source requests, archives, source maps and observations; commit
source maps and concise project-owned audit evidence. No full archives in package.

## Design, risks and stop

No production code, contract, schema, package, UI or managed-overlay change is
planned. This is evidence/prose-only use of the frozen tested WI-0270 implementation.
Run applicable fast verification, Doctor and actual distinct reviewer judgment on
the data/evidence candidate, then normal CI, merge and canonical runtime sync.
Do not infer that archive integrity authenticates an old test or grants acceptance.
Source ancestry is observed separately because squash commits may differ.

Stop after the current 594-record snapshot is classified and all eligible exact
sources recovered and read back. Report unresolved categories and specific next
retention conditions. No deletion, new benchmark, install, model/provider setting,
credentials, deployment, publication or further product implementation is included.
