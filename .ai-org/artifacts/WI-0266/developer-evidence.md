# WI-0266 Developer evidence

Executable candidate: `96a241ab8916f63a98952cb241176955c4f735c1`.
Base: `bab9b8fe045ccc939635f45537ffcca20bff78ef`.
Developer: agent-rikku. This is not independent acceptance.

## Cleanup result

The supported, digest-bound operations normalized 47 obsolete execution-coordinate
fields across nine canonical files and eight home-path occurrences across eight
retained artifacts. Both result records report successful writes and appended
events. Fresh canonical and artifact previews then reported zero pending changes.
All 29 previously blocked home-path findings and the older local-path finding
are absent from the current text scan.

The before/after plans are value-redacted and retain exact digests. Recursive
comparison of the affected canonical files after excluding only `worktree` found
no other semantic change. The eight artifact changes equal the normalizer's
specified local-path substitution exactly. Original bytes remain in Git history;
the event journal preserves the base's exact prefix. No active claim coordinates
or active evidence artifact was changed. No Git history, failure result, evidence
identity, revision, timestamp or scanner policy was rewritten.

The whole-tree audit remains **blocked**, not certified: one oversized event file
exceeds the unchanged 2 MiB text limit, and 117 pre-existing binaries require their
separate reviews. The package surface has zero findings. Separately applying the
same text rules to the entire 2,178,254-byte journal found zero matches; SHA-256
at the executable candidate is
`72f6a0d704be3cbd45352cdc79475fd439e7c8e3446ae71c621083d76a685c7c`.
Later lifecycle events change that digest, not the preserved prefix. This is
bounded cleanup, not a new certification of every historical image.

## Offline checks

- Focused manual-pilot tests: 5/5 pass. Existing prompt/oracle checks are retained;
  fresh approval and quota binding, missing/invalid approval, unknown quota,
  floor rejection, edited approval digest/limits and immutable attempts are covered.
- Full `npm run verify`: **exit 0, 1,408 passing markers / 137 files** at the exact
  executable candidate, completed before the first live dispatch.
- Local raw log: `full-verification-01.log`, SHA-256
  `672ee3e03345395dfffcaae450d080f07a22b6cf55c603c7c934985f0b34bbe5`.
- Package boundary: 489 files, 1,119,138 packed and 4,295,104 unpacked bytes,
  unchanged. Production source and dependencies are unchanged.
- Doctor after plan refresh: 37 pass, 0 warn, 0 fail. Final evidence-only updates
  require a fresh fast gate and Doctor; no new UI or browser qualification.

## Fresh live pilot: completed, diagnostic only

The independent source-only [oracle preflight](oracle-preflight.md) found no
prompt/check contradiction. The fresh plan bound WI-0266 approval and current
source hashes. It ran on the same qualified macOS Codex CLI version with native
ChatGPT subscription login, restricted reads/writes and no tool network.
No model permission or global configuration was changed.

All three paired tasks completed in six initial work steps. Both models passed
the listed 13, 10 and 7 checks respectively, with **zero repair attempts**.
No infrastructure failure, fallback, Astra call, paid API call or extra pilot ran.
The first dispatch through final pair record took 245.373 seconds. Full offline
tests were not run concurrently. Ordinary OS/application activity is uncontrolled.

| Model (medium) | First-pass tasks | Repairs | Input tokens | Output tokens | Adapter time |
| --- | --- | --- | --- | --- | --- |
| gpt-6-luna | 3/3 | 0 | 133,616 | 2,432 | 87.94 s |
| gpt-6-sol | 3/3 | 0 | 155,812 | 3,544 | 127.42 s |

Within this sample Luna used 136,048 combined tokens versus 159,356 for Sol
(14.6% fewer) and 31.0% less summed adapter time. This is not universal: on
dependency readiness Luna used 54,637 tokens versus Sol's 45,055. There is no
observed difference in the listed-check success rate. n=3 per model cannot
establish broad superiority, production reliability or subscription savings.

The [machine-readable results](pilot-results.json) retain checks, source/plan
hashes, runtime labels and SHA-256 of all six raw reports. Raw reports, synthetic
answers and live account snapshots remain local outside the repository.
Runtime labels confirm the requested Luna/Sol choices, not independently observed
backend identities. Dollar cost stays null. Token counts include repeated context;
adapter time includes setup, tools and cleanup. Coordinator/helper usage is not
part of these narrowly scoped totals. The old stopped WI-0265 pilot remains
unaltered and is excluded from this sample.

## Interpretation and remaining work

Keep the existing optional conservative router unchanged: this supports trying
Luna on small bounded work, not making it the universal default or moving LiteLLM
into the framework. A separately approved real Workkeel maintenance task would
be a more relevant next observation than automatically growing this synthetic set.

This completes the authorized live experiment. Remaining current-scope steps are
independent candidate review, lifecycle closeout and ordinary PR/CI integration.
No release, package publication, larger benchmark or further inference is implied.
