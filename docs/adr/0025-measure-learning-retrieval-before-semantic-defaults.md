# ADR-0025: Measure learning retrieval before selecting a semantic default

- Status: Accepted
- Date: 2026-08-30
- Scope: Phase 2C learning and retrieval maturity

## Context

Lessons and Practices are useful only when later work can retrieve and challenge them. A semantic or RAG layer may eventually help large repositories, but adding a model, embeddings, vector storage, or daemon before measuring deterministic misses would add operational cost and privacy risk without evidence.

## Decision

Add CLI mutations for Lessons and Practices, explicit revalidation history and review dates, and due/overdue/contradicted signals. Mutations update the compact index and Markdown record together under the project lock.

Add a deterministic retrieval-evaluation fixture and result format. Each case names a corpus kind, query, expected IDs, and result limit; the report records hit rate and reciprocal rank with provider provenance.

Define a privacy-preserving local hybrid provider boundary that can merge results from an injected semantic provider with deterministic results. It must retain repository-relative sources, bounded limits, provider provenance, and deterministic fallback. The installed configuration continues to select `repository-deterministic`; no semantic dependency or service is installed.

## Consequences

- Learning can be preserved and revalidated without hand-editing two files.
- Retrieval changes can be compared against checked-in cases.
- A later local LLM or embeddings adapter has a stable seam, but Temple has no model preference without project evidence.

## Not claimed

Local fixture results do not establish large-repository quality. Semantic retrieval, model installation, embeddings, vector storage, daemons, and remote search remain unconfigured and unvalidated.
