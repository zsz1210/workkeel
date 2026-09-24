# WI-0268 — complete the publication inspection surface

Maintainer approved follow-up 4 on 2026-09-24. Principal human; manager agent-mog;
specification agent-yuna; design agent-tidus; Developer agent-rikku; independent
QA agent-lulu. Standard delivery, no UI change, no release or visibility change.

## Acceptance and design

Remove the oversized current event-journal inspection blind spot by bounded
streaming, not by disabling rules or rewriting history. Preserve exact text-rule
semantics, fingerprints and line numbers across chunks, including very long
tokens, UTF-8, newline boundaries, CIDR exceptions, late binary content and drift.
Use fail-closed explicit bounds for total bytes and maximum logical line length;
oversized unsupported content must remain an inspection failure. Do not relax the
existing in-memory threshold/profile. History scanning retains existing scope.

Inspect all 117 existing binary paths and bind review to exact bytes, path and
method. Existing reviewed digests may be reused only when identical. New or
changed bytes never inherit clearance. Preserve old artifacts and findings;
never declare raw binary content safe solely because a file extension is PNG.
Prefer a separate digest-bound evidence verifier over silently changing generic
audit semantics. Report any unresolved images honestly; no secrets in evidence.

Run focused regression checks; the integration owner performs full verification
on the joined candidate, independent review and normal PR merge. No new external
dependency or paid service; no canonical policy JSON hand edits. Rollback through
a reviewed forward source correction, retaining append-only history and review
records. Complete at the fixed inventory plus scanner behavior, not a new scan
of unrelated accounts or systems.
