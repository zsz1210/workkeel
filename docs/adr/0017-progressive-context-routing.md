# ADR-0017: Route bounded project context through generated views

- Status: Accepted
- Date: 2026-08-29

## Context

Repository canonical state prevents a conversation from becoming the source of truth, but a growing project can still require an Agent to inspect too many files before each task. Loading all Specs, ADRs, Skills, Lessons, and work history wastes context and increases the chance that an important source is missed. Installing a vector database or local model in every project would introduce privacy, dependency, indexing, and failure-mode costs before real use proves that semantic retrieval is necessary.

Temple also needs to discover project-owned and third-party Skills without silently claiming their files as framework-managed capabilities.

## Decision

Temple adopts Progressive Context Routing with four boundaries:

1. Canonical Specs, ADRs, Skills, work items, Learning records, and evidence remain authoritative.
2. The project maintains one thin, project-owned Context Map at `.ai-org/project/context-map.json` containing paths and retrieval metadata rather than copied document bodies.
3. The CLI generates a Capability Registry and per-work-item Context Capsules under `.ai-org/views/**`. These projections are disposable and never become decision authority.
4. The default Retrieval Provider is deterministic and repository-local. A versioned provider interface permits a semantic or hybrid adapter without making it a default dependency. Alpha.19 later adds an injectable local-hybrid boundary and deterministic evaluation while continuing to install no model, embeddings, vector database, daemon, or third-party service.

Work items gain optional `affected_paths` and `context_refs`. Context resolution reports overlapping affected paths across non-terminal work items, but the warning does not assign ownership, cancel work, or authorize edits.

Capability discovery derives lifecycle ownership from exact `temple.lock.managed_files` entries. Unlisted Skills are visible as project extensions and remain project-owned. A registry result is a routing suggestion, not authority to invoke the Skill or install its dependencies.

## Consequences

- Small projects can use context routing with no additional service or model.
- Agents receive bounded paths, scores, reasons, and provenance instead of an opaque claim that context is relevant.
- Projects maintain a compact index but do not duplicate full source documents.
- Project Skills become observable without being silently adopted by framework upgrades.
- Two active work items can surface likely affected-path conflicts before implementation proceeds.
- Generated timestamps mean Registry and Capsule views are not stable canonical artifacts; callers that need a read-only preview use `--no-write`.
- Deterministic token matching will miss some semantic relationships. Any configured local adapter must be justified by measured retrieval failures and retain deterministic fallback, source paths, privacy boundaries, and provider provenance; Alpha.19 implements that seam but does not select a semantic runtime.
