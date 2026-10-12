# ADR-0052: Resolve every new handoff to an immutable commit

## Status

Status: Accepted for compatibility design.

## Context

High-Assurance handoffs resolve Git references to exact commits, while other profiles previously retained the supplied string. A Standard self-host handoff therefore retained `HEAD` even though its tested revision was an exact commit. Later commits make a symbolic reference ambiguous as historical evidence. Lighter workflows should reduce operating cost, not weaken candidate identity.

## Decision

All new handoffs resolve the supplied revision to a Git commit before the first artifact, Work Item, or event write. Accept resolvable commit references, including HEAD, branches, commit tags, abbreviated commits, and full commit IDs. Reject missing, unknown, option-like invalid, tree, and blob references, and repositories without a resolvable commit. Use Git's end-of-options boundary for untrusted revision input.

Store the resolved commit consistently in the Markdown handoff, Work Item handoff entry, Developer candidate when applicable, and event. A reference moving afterward cannot change the recorded handoff. Keep the existing helper signature and authority/gate requirements; a resolved commit proves identity only, not cleanliness, tests, approval, or repository durability.

Existing handoffs remain historical evidence. Do not rewrite them or infer their original meaning from the current HEAD. If an old symbolic handoff needs stronger evidence, create a new reviewed handoff at the confirmed revision through the existing lifecycle rather than changing the old record. This decision does not introduce a migration, automatic rewind, or rework transition.

## Consequences and verification

- Lean and Standard callers must have a real commit before handing off. Fake revision labels are no longer accepted.
- Invalid inputs fail before any handoff side effect, including in an unborn or non-Git project.
- Real-Git regressions cover reference normalization, reference movement, rejected non-commit inputs, unchanged canonical records on rejection, and retained High-Assurance behavior.
- Existing sealed experiment results remain unchanged. Future comparisons must pin the candidate version and must not attribute this unreleased behavior to Alpha.30.
