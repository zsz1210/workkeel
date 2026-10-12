# ADR-0049: Bind reviewed adapter fixtures to installed provenance

## Status

Status: Accepted for compatibility design.

## Context

Temple's public Evidence Profile blocks new private addresses and maintainer-specific paths. That is the correct default for project code and retained evidence. A pinned third-party adapter can nevertheless contain a deliberate private-address fixture that tests a security boundary. Rewriting that vendored file would break the adapter's byte-for-byte provenance, while a filename or directory allowlist could hide unrelated or newly introduced values.

## Decision

Temple permits a narrow `reviewed_adapter_fixtures` disposition:

1. It applies only to the repository surface and only to local-environment rules.
2. The source file must sit below an installed `.ai-org/adapters/` root.
3. The Evidence Profile records the exact path, rule, line, count, file SHA-256, adapter manifest, approver, time, and rationale.
4. The named adapter manifest must record the same source path and SHA-256.
5. The audit consumes no more than the reviewed number of exact occurrences. Drift, absence, malformed provenance, or additional occurrences is blocked.
6. Secrets, local-only runtime data, inspection failures, package contents, and binary files cannot use this disposition.
7. The allowed finding remains visible in the audit as reviewed evidence; it is not silently ignored.

## Consequences

- Pinned third-party source can remain byte-for-byte verifiable.
- A human review decision is durable, specific, and fails closed when source or provenance changes.
- First-party fixtures still need synthetic construction or ordinary remediation.
- Projects cannot use this mechanism as a broad path or regex allowlist.
- Publication remains a separate human decision.

## Rejected alternatives

- Patch the installed adapter and update only its local manifest.
- Ignore all findings below `.ai-org/adapters/`.
- Add a filename-only or pattern-based allowlist.
- Treat every fixture as safe based on its name.
- Make the same exception apply to npm package contents.
