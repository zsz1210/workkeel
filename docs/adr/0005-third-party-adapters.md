# ADR-0005: Keep third-party capabilities behind an adapter boundary

- Status: Accepted
- Date: 2026-08-29

## Context

Tools such as Archify can improve architecture communication, but making them core state or implicit dependencies increases supply-chain, upgrade, and portability risk.

## Decision

Third-party capabilities use opt-in adapters: pin the version and commit, record the license, constrain inputs and outputs, and prohibit changes to canonical state or gate approvals. Alpha.19 implements the Archify contract as a local-source-only isolated installation with per-file digests and safe absence. It does not download or execute the adapter.

The Alpha.30 security update pins Archify `v2.16.0` at commit `c826e6c3a7abad19c0f3cd1ca57207d54b1ad8de`. Its upstream dependency override was no longer sufficient for current `fast-uri` advisories, so Temple applies one reviewed data-only downstream patch during the copy: exact pre-patch package and lock values must match, then both are changed to `3.1.7`. The manifest records that patch separately from upstream provenance. The installer still performs no network request, package installation, or source execution, and any precondition or digest drift fails closed.

## Consequences

The visualization can be replaced or disabled while the text and JSON workflow continues to work in full. Operators must obtain the exact third-party source through an independently authorized process, and digest drift makes the installed adapter unusable rather than silently trusted.

A future upstream release that incorporates an adequate fix should replace the downstream patch after the same version, commit, license, behavior, and provenance review. Historical evidence continues to identify the adapter revision used when that evidence was produced.
