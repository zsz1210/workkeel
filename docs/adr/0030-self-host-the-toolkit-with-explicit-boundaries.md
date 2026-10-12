# ADR-0030: Self-host the toolkit with explicit source and project boundaries

## Status

Accepted.

## Context

Temple exists because chat-local coordination, implicit ownership, and unverifiable completion do not scale. Developing the framework only through informal adherence would leave its central claim untested.

The toolkit repository is also an unusual initialization target. It contains the framework source, the distributable `project-overlay/`, its own maintainer `AGENTS.md`, and a bootstrap copy of `$temple-init`. Ordinary initialization correctly refuses to adopt an identical untracked managed file, so running normal `temple init .` would either fail or require weakening the ownership contract for every project.

## Decision

Temple supports an explicit toolkit-only initialization mode:

```bash
temple init . --self-host --config /path/to/confirmed-config.json --dry-run --integrate-agents
```

- `--self-host` is accepted only when the target is the toolkit checkout from which that CLI is running.
- A toolkit checkout cannot be initialized without the explicit flag.
- `project-overlay/` remains the distribution source. Root `.ai-org/` is project-owned canonical state for developing Temple itself.
- Project-specific Agent Identities, Assignments, Work Items, evidence, and learning live only in the root self-host state and never become overlay defaults.
- Self-host initialization may adopt only the byte-identical root bootstrap file explicitly listed by the framework. It does not create a general exception for identical untracked managed paths.
- `temple.lock` records `toolkit-self-host`, the overlay source, and every explicitly adopted managed path. Doctor rejects a self-host lock outside its own toolkit checkout.
- In toolkit self-host mode, the repository launcher executes the current worktree's canonical `bin/temple.mjs`, verifies its pinned version, and fails closed if that path is missing or escapes the worktree. It never substitutes another same-version global or linked package.
- The root `AGENTS.md` keeps its maintainer instructions and receives the approved project-facing organization block through the existing integration mechanism.
- Historical work is not rewritten as if Temple managed it. Canonical dogfood evidence starts when the self-host installation is activated.

## Consequences

Temple can use its own Positions, Work Items, lifecycle, Evidence Registry, Observer, and Learning Loop while preserving the product/source boundary it promises to adopters.

The toolkit must sync managed root copies through the same checksum-safe release path used by projects. Self-host contributors normally use the repository launcher without an override because it is bound to the current worktree. An exact-version `TEMPLE_CLI_PATH` remains an explicit diagnostic override. A clean pinned release or version-pinned package remains the recovery path for ordinary projects.

Self-hosting is implementation evidence, not enterprise-scale proof. Multi-human, multi-machine, and multi-repository claims still require their retained validation plans.
