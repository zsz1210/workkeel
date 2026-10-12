# ADR-0015: Preserve engineering learning as project-owned canonical state

- Status: Accepted
- Date: 2026-08-29

## Context

Temple preserves decisions, work, evidence, and handoffs outside chat, but a completed work item can still teach something that has no durable destination. Leaving that learning in a retrospective or conversation loses it; copying every observation into Agent instructions or a Skill creates stale rules, overlapping triggers, excessive context, and unsupported generalization.

The framework needs a deliberate path from evidence to improvement. It must distinguish what happened, what was learned, what guidance the project adopted, and what deserves implementation as a Skill or deterministic check.

## Decision

Temple defines an **Engineering Learning Loop**:

```text
evidence → observation → Lesson → validation → Practice → promotion → revalidation or deprecation
```

### Learning is project-owned

- `.ai-org/learning/index.json` is a compact canonical retrieval registry.
- Full Lessons live at `.ai-org/learning/lessons/LESSON-####.md`.
- Full Practices live at `.ai-org/learning/practices/PRACTICE-####.md`.
- The central framework provides managed Lesson and Practice templates, but init, re-init, and upgrade do not own or overwrite project learning records.
- Upgrade creates an empty index only when it is missing; it never replaces an existing index.

### The index routes retrieval

Each entry records ID, kind, title, summary, status, confidence, tags, applicability hints, source work items, record path, validation dates, and promotion state. Agents inspect the index first and load only relevant records. The index does not duplicate full evidence or prose.

### A Practice is the intermediate artifact

- A Lesson is an evidence-supported conclusion from one or more bounded cases.
- A Practice is adopted guidance with explicit applicability, confidence, ownership, validation, and deprecation rules.
- A Skill is reserved for a reusable, non-obvious decision procedure.
- A deterministic condition should become an automated check rather than a prose-only Skill.
- Architecture or organizational decisions belong in ADRs; approved always-on rules belong in instructions.

No promotion is automatic, and no artifact expands the request, Position authority, or human approval boundary.

### Project learning does not become framework memory automatically

Cross-project promotion requires human approval, private-data removal, provenance review, repeated evidence, and the destination's normal adoption process.

## Current implementation boundary

Alpha.19 provides atomic Learning CLI mutations, explicit v1-to-v2 index migration, Lesson-to-Practice derivation, revalidation history, due and contradicted signals, Observer attention, and deterministic retrieval evaluation. The CLI updates the Markdown record and index together. It still does not run scheduled retrospectives, promote learning automatically, synchronize projects, install a semantic runtime, or ship a `$retrospective` Skill.

## Consequences

- Valuable learning can survive task and conversation boundaries without becoming an unreviewed global rule.
- Agents can retrieve relevant active guidance without loading the full history.
- Practices can be contradicted, narrowed, revalidated, or deprecated.
- The framework gains a governed improvement path while preserving the small core Skill set.
- Direct manual edits remain possible project ownership, but the CLI is the safer default because it preserves record/index consistency and event history.
