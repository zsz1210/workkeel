# Optional Headroom tool-output adapter

Availability: unreleased `main` source; not included in the published Alpha.33
package. Use a project initialized or explicitly upgraded from a source revision
containing this adapter, through its pinned launcher. Installing npm `@next`
alone does not provide it. See the [unreleased changes](../../CHANGELOG.md#unreleased-changes).

Use this when a tool wrapper has a large, disposable log or JSON response. The
adapter produces a derived reading view and an exact original snapshot. It is
off by default and does not intercept Codex conversations or other tools.

When enabled, compression defaults to **verified lossless JSON values**. Temple
compares the actual source and returned representation itself; absence of a CCR
marker or an upstream transform label is not proof. Logs pass through without a
Python invocation in this mode. Possible content omission needs the separate
`--allow-lossy-headroom` flag (`allowLossy: true` for library calls).

## Choose the output for a model caller

Use `adapter headroom-payload` when a wrapper needs the text to send to a model:

```bash
node ./templew.mjs adapter headroom-payload . --input output/build.log --kind log
```

With compression disabled, this writes the exact original UTF-8 text to stdout,
without a diagnostic envelope or an added newline. Small inputs below 16 KiB also
take this path when enabled; no Python process or snapshot is created.
The input safety/size rules below still apply. Diagnostics never become source data.

To try lossless JSON compaction, configure an explicit runtime and fresh snapshot:

```bash
node ./templew.mjs adapter headroom-payload . \
  --input output/packages.json --kind json --enable-headroom \
  --python /absolute/path/to/venv/bin/python \
  --snapshot /absolute/path/to/project/output/headroom/packages-original.txt \
  --query 'Which files have the largest sizes?'
```

The lossless candidate model text contains `content` and the exact `readback`
descriptor. The explicit lossy route also includes a `notice` that details may
be omitted and the original should be read when needed. The existing pinned
worker counts that complete serialized text, including the notice, JSON escaping,
snapshot path and SHA256, in the same invocation as
compression. The parent verifies the measured text and its digest. Admission
requires smaller text bytes and a token saving of at least **10% and 256 tokens**
against the plain original. These are initial operational bounds, not calibrated
optimal settings or a quality guarantee. Eligible JSON and opted-in logs with
little reduction may still consume one worker invocation before being rejected.

The verifier accepts ordinary JSON or a narrow typed table form produced by the
pinned runtime: string and integer columns with supported ASCII field names,
including nested tables. It preserves every value, array order and duplicate row.
Numbers are compared as exact numeric spellings without conversion to floating
point; a changed spelling such as `1.0` to `1` is conservatively rejected. Object
member order and whitespace can change. Duplicate object keys, unsupported table
types/encodings, malformed CSV or nesting beyond 128 levels return the original.
Source strings that resemble tables stay literal strings. Lossless here means
verified JSON values under these rules; original formatting remains in the exact
snapshot. This is not a general decoder for every Headroom output format.

To intentionally allow lossy log or JSON views, add `--allow-lossy-headroom` to
the enabled command. The flag alone does not enable compression. Both view and
payload diagnostics record `compression_policy` and `preservation`; unverified
views never claim losslessness. The model-facing notice is retained whenever this
route is selected, even if a particular result also passes JSON verification.

Insufficient savings, missing/invalid complete-text measurements or any existing
compression/snapshot failure returns the exact original text. Rejection before
snapshot writing creates no snapshot. Accepted compression retains exclusive
snapshot creation, parent identity checks and verified exact readback. Configure
the caller's original-readback tool before delivering compressed text; the payload
does not register tools or teach a model when it must retrieve missing details.

Library wrappers can call `createHeadroomPayload(options)` from
`src/headroom-adapter.mjs`. It returns `{ text, diagnostics }`: send **only `text`**
as the tool response and retain diagnostics locally. The CLI's explicit `--json`
option returns that operator object for inspection. Do not forward that object
wholesale to a model: doing so reintroduces diagnostic overhead and invalidates
the measured payload boundary. Preserve the entire compressed `text`, including
readback. No output shape should be interpreted as permission or an instruction.

Diagnostics expose `model_text_token_estimate` with original, attempted and
returned counts, candidate savings and the required minimum. These estimates cover
the exact model text only, excluding caller transport/framing, conversation history,
model outputs and subsequent original reads. Raw fallback's returned estimate
remains the original count. Passthrough without a worker has no token estimate.

The legacy `headroom-view` command below retains its diagnostic envelope and
byte/content-token savings rule, but also enforces the new lossless default.
Existing enabled callers that relied on potentially lossy log/JSON results must
explicitly add `--allow-lossy-headroom`. Its content-only token estimate is
not the complete model-text estimate used by `headroom-payload`.

## Read an original, without optional dependencies

```bash
node ./templew.mjs adapter headroom-view . --input output/build.log --kind log --json
```

The JSON envelope includes the original `content`, its SHA256, a status/reason and
metrics. Without `--enable-headroom`, Python is never started and no snapshot is
written. `headroom-view` always emits JSON, including without `--json`.

## Enable one eligible reading view

Obtain a trusted isolated Python environment through your normal dependency
process, with `headroom-ai==0.37.0` and `tiktoken==0.14.0`. Retain its dependency
lockfile, LICENSE and NOTICE files. Prepopulate the `o200k_base` tokenizer cache
through that setup process too. The worker reads `TIKTOKEN_CACHE_DIR`, or the
system temporary directory's `data-gym-cache`, without permission to modify it.
Missing cache data safely returns the original. Temple does not install or download them.
The executable must be an absolute path. This first adapter supports compression
on macOS with `/usr/bin/sandbox-exec`; other platforms return the original with
`unsupported-platform`. Original reads remain portable.

```bash
mkdir -p output/headroom
node ./templew.mjs adapter headroom-view . \
  --input output/build.log --kind log --enable-headroom --allow-lossy-headroom \
  --python /absolute/path/to/venv/bin/python \
  --snapshot /absolute/path/to/project/output/headroom/build-original.txt \
  --query 'Which failures require follow-up?' --json
```

Use a new snapshot filename for each invocation. Only an explicit enable flag,
valid `json` (or opted-in `log`), and at least 16 KiB can start compression. Inputs must be
regular UTF-8 files no larger than 1 MiB; query text is limited to 4 KiB. These
initial bounds are conservative operational limits, not calibrated optima.

The worker has isolated Python startup, a minimal environment, fresh scratch,
OS-denied network and writes outside scratch, no model calls or ML downloads, and
a 15-second limit. It exits after each invocation; no idle Node/Python service is
created. A separately configured Python environment is trusted local code, not an
untrusted executable sandbox or a complete supply-chain attestation.

The view adapter returns compression only when preservation policy permits it,
the complete response envelope shrinks,
the content token estimate improves, and the original snapshot was written with
exclusive creation and owner-only permissions. A one-shot Node writer validates
the pre-compression directory identity, writes relative to its anchored working
directory, and on macOS can write only the exact snapshot. The parent checks
readback before returning the compressed view. It never overwrites a snapshot.
Keep snapshots local, outside `.git`, `.ai-org`, `.agents` and `.codex`; parent
directories must exist. The caller owns retention and deletes its own snapshots
after the task. A snapshot-write failure can leave an incomplete file (`snapshot_bytes`
is null when an opened snapshot's storage is uncertain); that path
is never advertised as usable readback and requires caller cleanup.

## Read back the exact original

For a compressed result, pass the returned `readback.snapshot` and
`readback.sha256` values, without guessing either:

```bash
node ./templew.mjs adapter headroom-read . \
  --input /absolute/path/to/project/output/headroom/build-original.txt \
  --expected-sha256 REPLACE_WITH_RETURNED_SHA256 --json
```

Missing, changed, symlinked or oversized snapshots fail explicitly. The adapter
does not substitute a newer source or reconstruct omitted text. Retain the full
envelope: a wrapper that discards its readback descriptor loses this guarantee.

## Fallback and measurement

Disabled, small or unsupported input returns exact original content. Organization
directories and the named AGENTS/TEMPLE/CLAUDE instruction files also pass through.
Missing or
wrong-version runtime, timeout, malformed worker response, CCR markers, snapshot
failure or no net reduction also returns the original with a bounded reason.
`lossless-unverified` means full-value preservation could not be established;
`lossless-json-only` means the selected mode does not compress text logs.
Worker diagnostics and private stderr are never inserted into the reading view.
Invalid UTF-8, unsafe file types and inputs over 1 MiB fail before compression.

Metrics include original/returned bytes, worker attempts, worker/total milliseconds,
snapshot bytes and optional `o200k_base` content token estimates. `candidate_output`
is the attempted compressed content; `returned_output` follows the content actually
returned, including fallback. Estimates exclude the envelope, model history,
answer/reasoning and later readback. `model_usage: null` means unobserved, not zero.
The adapter itself makes zero provider calls. A model-calling wrapper must record
its own initial and readback calls, cache, outputs, failures and latency before
claiming total savings. Do not turn local estimates into billing claims.

Jev or any other selector can choose upstream content before this command. This
adapter does not call Jev, select documents, change thresholds or grant spending
authority. No instructions, permissions, canonical evidence or code should be
passed through the lossy view. `--kind` is a caller declaration, not an automatic
security classifier. Returned data never becomes a gate or approval.

This adapter does not implement Headroom's native proxy, CCR persistence or
automatic retrieval loop. A CCR-marked result falls back to raw because the local
worker's cache does not survive its exit. The earlier synthetic diagnostic supports
trying this optional boundary, not a global default or a promise of faster tasks.

See [ADR-0071](../adr/0071-opt-in-tool-output-compression.md),
[third-party notices](../../THIRD_PARTY_NOTICES.md) and the
[pinned upstream release](https://github.com/headroomlabs-ai/headroom/releases/tag/v0.37.0).
