# Solo delivery in a new repository

Use this path when one human leads a project and eligible Agents implement and independently verify its work. Solo describes human participation; it does not combine Developer and verifier identities. This guide retains the existing workflow profiles and optional autonomous delivery entry.

## Start with the project

Temple requires Node.js 24 or later to run its CLI. The project's own build tools remain separate. Confined delivery checks retain their supported Node test adapter. Alpha.33 also supports explicit non-Node commands through trusted-local measurement plans on supported POSIX hosts; this is not a sandbox, and Windows command execution remains unavailable. Inspect adapter capabilities and declare the actual toolchain and inputs as described in [collaborative delivery](../operations/collaborative-delivery.md#reuse-measurements-without-inventing-tests). A Go, Python, Flutter or other project must use its real verification route and must not be declared compatible merely because Temple initializes successfully.

Initialize in the product repository, following [Usage and initialization](usage.md). Establish project identity, Agent names and responsibilities, and the actual repository integration policy together. Retain existing source files, CI, documents and project-owned instructions. A local installation does not authorize pushing, merging, publishing or deploying.

Use the pinned `node ./templew.mjs` launcher from that repository. After initialization, read its operating contract and complete its bootstrap checks. Run Doctor and read-only Status; resolve errors before claiming work. A clean install proves setup, not delivery correctness.

When evaluating an unpublished source candidate or an exported runtime without Git metadata, select that exact CLI explicitly for every launcher invocation:

```text
TEMPLE_CLI_PATH=/absolute/path/to/verified-temple/bin/temple.mjs node ./templew.mjs doctor . --compact
```

The launcher checks the declared package version; the evaluator must also retain the exact source revision or runtime hashes. Without that override, an export with no repository pin resolves its pinned npm package, which may not contain unpublished source changes even when the package version matches. A source-candidate rehearsal does not qualify that published package.

## Agree once on the bounded outcome

Record the goal, acceptance criteria, affected paths, actual verification commands, authority and resource envelope. Include verification, repair, re-verification and cleanup reserves. Select Lean only when eligible; Standard and High-Assurance retain their own requirements. Choose one authorized scope and a stopping condition rather than asking for approval at every ordinary step.

After approved Build entry, explicitly select [Autonomous delivery](../operations/autonomous-delivery.md). The Developer chooses implementation methods. The coordinator runs fixed bookkeeping and checks, then continues to the distinct verifier. A real rejection returns to same-scope repair within the agreed allowance. Neither a generated receipt nor successful tests replace the reviewer's judgment.

When delegating implementation while retaining coordinator ownership of Git and lifecycle state, enforce that split in the worker's runtime permissions: approved product files may be writable, while Git and organization state remain read-only. A prompt alone does not prevent duplicate bookkeeping. The qualification runner demonstrates this boundary; installing Temple does not automatically restrict every host or Codex session.

Do not repeat individual handoff/transition commands after successful `delivery finish`. Reuse returned mutation and diagnostic results for unchanged state. A change in candidate, scope or authority requires the corresponding fresh check; it cannot be hidden by reusing a receipt.

## Continue in a fresh conversation

Provide the repository and Work Item ID. The new Agent reads the installed instructions and resolves the current context:

```text
node ./templew.mjs context resolve . --work-item WI-#### --position developer --purpose recovery --compact --no-write --json
node ./templew.mjs delivery next . --work-item WI-#### --json
```

Use the actual responsible Position; the example is for a Developer. `delivery next` applies only when a delivery session exists. Otherwise follow the Work Item's normal lifecycle. Identify current scope, ownership, exact candidate, existing evidence and the pending action before writing. Historical success is not current acceptance. An interrupted finish can resume only its identical recorded request; uncertain check execution needs reconciliation.

## Keep Learning selective

Search the Learning index and read the relevant validated Lessons or active Practices. Capture a bounded discovery when it helps future work; an uneventful task needs no model retrospective. [Learning review coverage](../extensions/engineering-learning.md#check-which-outcomes-were-reviewed) distinguishes no review, no new Lesson, linked Lessons and a review made stale by changed evidence.

Use `learning review-status . --work-item WI-#### --json` for a known task. Use `--compact` for a project overview. Compact output reduces returned material but still scans the underlying metadata; it is not an incremental index. Revalidate contradicted or outdated guidance instead of automatically turning it into an always-on instruction.

## Finish with evidence and useful numbers

Record accepted scope, tested revision, actual results, unresolved limits and next owner. Separate implementation, verification, repair and administration time. Retain failed attempts and human intervention counts. Provider-reported input, cached input and output can be recorded without an account quota query; unavailable usage remains unknown. Operational Tokens are input minus cached input plus output, not monetary cost or whole-context size.

Account monitoring is optional and requires its own user preference. Do not enable it just to collect task statistics. New-repository rehearsal, offline mechanism tests and fresh-agent results answer different questions; none establishes real multi-human collaboration or universal savings.

For the complete manual path and deeper contracts, see [Core path](core-path.md).
