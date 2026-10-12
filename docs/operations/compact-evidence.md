# Read compact evidence without changing it

Availability: unreleased `main` source; not included in the published Alpha.33
package. Use a project initialized or explicitly upgraded from a source revision
containing this command, through its pinned launcher. See the
[unreleased changes](../../CHANGELOG.md#unreleased-changes).

Use `evidence view` when a saved test log or JSON report is too verbose to read in
full. It only reads the selected file; it does not run tests, write an artifact,
grant acceptance, change lifecycle state or load a model.

```bash
node ./templew.mjs evidence view . --source .ai-org/artifacts/WI-0001/test.log --format node-test --compact
node ./templew.mjs evidence view . --source .ai-org/artifacts/WI-0001/usage.json --format json --compact --json
```

The source path must already exist in the selected repository. These example paths
refer to this framework repository's retained artifacts; downstream projects should
select their own logs/reports. `--json` produces the machine-readable envelope;
its `content` field is the reading view. Without `--compact`, full content is the
default. Existing commands retain their output and behavior.

| Format | With `--compact` |
| --- | --- |
| `text` (default) | Content unchanged |
| `json` | Only whitespace outside strings is removed; no fields, numbers or caveats are dropped |
| `node-test` | Omits complete top-level `✔ name (durationms)` lines before a recognized complete Node spec summary; all other lines remain |

The Node format requires consecutive `tests`, `suites`, `pass`, `fail`, `cancelled`,
`skipped`, `todo` and `duration_ms` summary lines. Unknown, colored or incomplete
summaries pass through. Indented subtests, unfamiliar result lines, failure
details and trailing failure listings remain. Select this format only for actual
Node spec logs; arbitrary program output is not authenticated by its appearance.
Omitted successful test names and timings require the original: their absence in
the view does not mean they were not run or establish named-test coverage.

## Read the original again

The envelope provides `source.path`, `source.sha256` and `original_read` arguments.
Use that exact observed digest when reading the file again:

```text
node ./templew.mjs evidence view . --source <same-path> --format text --expected-sha256 <source.sha256> --json
```

A mismatch fails before printing content. For the same digest, the returned
`content` is the original UTF-8 text, not the compact view. The reference is local:
there is no hidden cache, retained snapshot, automatic retrieval or cross-machine
transfer. Preserve the actual artifact through the project's evidence workflow.

## Limits

- Input is at most 8 MiB and must be valid UTF-8 without NUL bytes. Directories,
  special files, symlinks and traversal paths are rejected.
- JSON formatting preserves numeric lexemes (including large integers), duplicate
  keys and string escapes; it does not validate the report's meaning or schema.
- Failure evidence and limitations remain content, not instructions or permission.
- Source hashes bind bytes, not truth, ownership, current applicability or approval.
- The command has no token/billing measurement. Include its envelope and any later
  original reads when measuring actual context cost. Small reports can grow once
  the envelope is counted.
- Files may change after a successful read. Recheck the digest on later reads;
  ordinary-change detection is not a sandbox against hostile filesystem races.

The design boundary is recorded in [ADR-0070](../adr/0070-compact-evidence-reading-view.md).
