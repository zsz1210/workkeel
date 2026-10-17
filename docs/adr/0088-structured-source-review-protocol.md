# ADR 0088: Explicit structured source-review protocol

## Context

A JSON transport envelope does not make the model's prose a structured review.
Extracting JSON from prose can hide formatting failures. Supervision has a similar
boundary: an exited supervisor is not proof that its command reported a result.

## Decision

Keep both boundaries explicit. The command supervisor reports actual completion
over IPC, preserving a signal's absent numeric exit code. Missing completion,
signals and supervisor/result disagreement are instrumentation failures. Genuine
numeric test failures remain failures; task acceptance remains separate.

Provide an opt-in `prepareClaudeSourceReview` protocol helper. It prepares CLI
arguments and validates a native result; it never launches a process or grants
access. The caller supplies approved model identities, reasoning, a fresh session
UUID and a bounded immutable source packet. Use native `--json-schema` plus
`structured_output`, then validate findings locally against their exact files and
line bounds. Never convert prose, Markdown or a provider error into success.

The external CLI qualification is pinned to Claude Code **2.1.287**. Other versions
require deliberate requalification; there is no automatic upgrade or fallback.
The prepared arguments disable customizations, built-in tools, MCP, skills,
Chrome and session persistence while retaining the caller's existing authorized
authentication. Managed policy still applies. These controls are not an OS sandbox.
An approved host must enforce scope, capture raw bytes, bound time/output, confirm
owned-process cleanup and validate the reported model before accepting findings.

Native usage is separate from semantic success. Preserve available counters even
on error, treat unknowns as unknown, include Claude cache input exactly once and
keep reasoning tokens inside output totals. Monetary estimates are not bills.

## Dependency and license review

No vendor implementation, binary, SDK or new package is bundled or downloaded.
The helper is Workkeel code using the existing pinned Ajv dependency. The external
CLI remains separately installed and subject to the vendor's terms; its
[license notice](https://github.com/anthropics/claude-code/blob/main/LICENSE.md)
reserves rights and points to Anthropic's commercial terms. Workkeel does not
relicense it, activate it by default or make it a core runtime dependency.

The interface follows the official [programmatic CLI documentation](https://code.claude.com/docs/en/headless).
Synthetic protocol and process-fault tests are public; real execution records and
live qualification evidence remain private. Protocol compatibility does not prove
review quality or justify changing task routing.
