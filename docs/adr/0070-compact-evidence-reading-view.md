# ADR-0070: Optional compact evidence reading view

Status: accepted for implementation

## Context

Large successful-test listings consume reading context while failure details and
measurement caveats must remain visible. Generic compression can move necessary
limitations behind retrieval markers. A summary must not become authority or alter
the underlying evidence.

## Decision

Add a read-only `evidence view` command with explicit `text`, `json` and `node-test`
formats. Full content is the default. `--compact` only removes JSON whitespace
outside strings or recognized top-level passing Node spec result lines before a
complete summary. Unknown log formats and ordinary prose pass through. JSON
numbers, duplicate keys, order, escapes and strings stay lexically intact.

Every view includes the original relative path, SHA-256, byte counts, omissions,
limitations and digest-bound original-read arguments. The optional expected digest
must match before any content is printed. The original stays the evidence; neither
the view nor its digest grants acceptance, demonstrates test execution or satisfies
an independent judgment. Omitted named-test coverage needs the original.

Inputs are bounded regular UTF-8 files within the selected repository, with no
symlink components or traversal. Ordinary concurrent file replacement/change is
rejected; this is not a hostile concurrent-filesystem security sandbox. The source
is not copied, retained, rewritten or registered by this command. No new process,
dependency, proxy, model call, token counter or provider behavior is introduced.

## Consequences

Users explicitly opt into a smaller reading view and retain failure details and
caveats. Unsupported formats can remain large; the command never truncates to fit
a token budget. Existing evidence commands and lifecycle gates are unchanged.
An unavailable or changed original cannot be recovered from the digest alone.
See [the guide](../operations/compact-evidence.md) for limits and examples.
