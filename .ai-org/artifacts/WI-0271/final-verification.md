# Final data-candidate verification

Exact candidate: `bf03d754dddfd658efc1bfa5f63e0d545d76e3db`.

The coordinator completed all 27 batches: 26 full bundles and one deliberately
partial recovery batch. All 589 complete records / 1,800 references read back;
three additional files remain explicitly partial within two invalidated records.
Full counts and method hashes are in recovery-index.json. Registry bytes unchanged.

Independent Python JSON/base64/SHA-256 and direct Git-object checks covered all
1,800 bundled references and 1,368 distinct source locations. All 20 source maps
(19 new plus one preserved) were then compared with their exact candidate Git
bytes and indexed hashes; all 26 external bundle hashes matched. There were no
product changes: 824 physical product files and modes match base main. The tested
WI-0270 product implementation remains unchanged, so its full verification is
reused as prior code evidence, not represented as newly executed here.

Current `npm run verify:fast` passed ten files plus repository, documentation and
package checks. Candidate Doctor: 36 pass, 1 existing stale parallel-plan warning,
0 fail. No parallel dispatch, UI change, install or additional behavioral test run.

Actual independent GPT-6 Sol / medium judgment is PASS with explicit limits in
independent-review-0.md. It reviewed methods, count reconciliation, provenance,
samples and retention semantics. It did not independently rerun checks or inspect
every map/bundle byte. Exact map, bundle, Git-source and filesystem checks above
are coordinator evidence, fulfilling the review's assigned follow-up verification.

A local portable retention package was created and all 126 data members checked
against its manifest. It excludes Git objects and does not prove restore at an
external backup location. No file is approved for deletion by this work.

No package release, deployment, dependency installation, account/global model
change, original registry rewrite, source ref deletion or historical reinstatement.
