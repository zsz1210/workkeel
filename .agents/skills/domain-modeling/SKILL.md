---
name: domain-modeling
description: Clarify a project's domain language, boundaries, rules, and invariants when product documents, code, or people use conflicting terms. Use during project definition, specification, architecture decisions, or refactors where naming affects behavior; do not use for generic prose editing.
---

# Domain Modeling

Build a shared language that product decisions, code, tests, and Agent handoffs can use without guessing.

## Evidence first

1. Read the smallest authoritative set: Project Charter, glossary, relevant decisions, specifications, implementation, tests, and current assignments.
2. Separate observed terms, confirmed definitions, assumptions, conflicts, and missing owners.
3. Do not treat a frequently used term as confirmed when sources disagree.

## Challenge each important term

For every term that changes behavior, establish:

- a concise definition in this project's context;
- examples and non-examples;
- rules or invariants that must remain true;
- its owner or authoritative source;
- how it differs from nearby or legacy terms;
- the bounded context where the definition applies.

Use established Domain-Driven Design constructs only when they clarify the model. Do not force labels such as Entity, Value Object, Aggregate, Domain Event, or Bounded Context without supporting behavior and evidence.

## Authority boundary

Evidence gathering and model clarification are read-only by default. Persist glossary or ADR changes only when the user's request or current authorized work item includes repository updates; otherwise propose the exact entries and affected paths. Do not refactor code or rename interfaces without an explicit implementation request.

## Persist or propose the result

- Record confirmed vocabulary in `.ai-org/project/domain-glossary.md`, using `.ai-org/templates/domain-glossary.md` when the file does not exist.
- Record long-lived architectural consequences as an ADR under `.ai-org/decisions/`.
- Identify affected specifications, interfaces, migrations, code names, and tests. Do not mark those updates complete until changed and verified.
- Preserve unresolved conflicts with an owner and a decision trigger; do not silently choose a meaning.

Do not implement a refactor unless the user explicitly requests implementation.

Finish when confirmed vocabulary, unresolved conflicts, owners, and downstream impacts are visible in repository files or in an explicit proposed change when persistence was not authorized.
