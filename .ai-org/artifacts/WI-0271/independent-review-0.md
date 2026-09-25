# Actual independent data review

Candidate: `bf03d754dddfd658efc1bfa5f63e0d545d76e3db`.
Actual model: GPT-6 Sol / medium. Coordinator tests are separate evidence.

PASS, with verification limits, for the WI-0271 data-only recovery evidence described by docs/candidate.json. No blocking inconsistency found in the material available for review.

The reported counts reconcile: 151 originally retrievable + 3 pilot + 435 newly recovered = 589 fully exportable records; 589 + 4 invalidated conflicts + 1 unversioned claim = 594. Artifact classes total 889 + 927 + 4 = 1,820. The 26 reported full bundles cover 1,800 references; partial recovery of three files in two conflicted records does not make those records valid. The four audit methods specify exact-hash, size, regular-file and tested-scope-absence checks, batches of at most 25 records, isolated readback, tamper rejection, and an independent Python byte/Git-object cross-check. The summary preserves 35 invalidations, the registry hash, and the distinction between source consistency and authentication. It claims neither acceptance nor deletion.

Limitations: I inspected the supplied methods, index, summaries, cross-check report, retention report, unresolved context, samples and relevant API code; I did not rerun tests, inspect every artifact byte, or verify the 236 remote-retention assertions independently. The 19 candidate source-map files and external bundle files were not supplied in the readable reference tree, so their hashes and the exact Git candidate remain coordinator-verification items. Samples are navigation evidence, not exhaustive proof. No files changed; no Git or Node checks run. No applicable Skill was used. Recommended next step: coordinator completes its assigned exact-candidate Git/Node checks and confirms the source-map and bundle hashes before handoff or acceptance.

