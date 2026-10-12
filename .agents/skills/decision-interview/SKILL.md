---
name: decision-interview
description: Clarify consequential product, architecture, or implementation choices through a focused decision interview. Use when ambiguity blocks specification or design; inspect repository evidence in the same workflow when project facts constrain the decision. Do not use for status reporting or implementation.
---

# Decision Interview

Turn a fuzzy proposal into explicit decisions without taking over the user's intent.

## Choose the evidence mode

- Use conversational mode when the decision depends on the user's goals, preferences, or facts not yet stored in the repository.
- Use evidence-backed mode when existing instructions, project state, specifications, ADRs, code, tests, or Git state constrain the choice. Read the smallest authoritative set, cite exact repository paths, and distinguish current evidence from historical notes and generated views.
- Do not scan unrelated private content. Do not treat chat memory as stronger evidence than canonical project sources.

## Interview contract

- Start by restating the outcome under discussion and separating facts, assumptions, options, confirmed decisions, and unknowns.
- Ask the smallest set of high-leverage questions that changes the decision. Default to no more than three questions per round.
- Follow contradictions and costly unknowns before polishing details. Make trade-offs concrete.
- Do not manufacture consensus. Mark a decision confirmed only when the user confirms it or an authoritative project source already establishes it.
- Do not start implementation unless the user explicitly expands the request to implementation.

## Decision frontier

Maintain a visible frontier during the interview:

1. Decided now.
2. Needs evidence.
3. Deferred with a revisit trigger.
4. Rejected and why.

For technical choices, probe the outcome, constraints, failure modes, observability, rollback, ownership, and acceptance evidence when they materially apply. Skip irrelevant categories.

## Authority boundary

Interview and evidence gathering are read-only by default. Do not modify files or implement the decision merely because a likely answer emerges. Persist only when the user's request or the current authorized work item includes repository updates; otherwise show the exact proposed destination and content.

## Persistence

When persistence is authorized and a decision becomes confirmed:

- If this repository has an initialized `.ai-org` organization, create or update a focused file under `.ai-org/decisions/` using `.ai-org/templates/decision-ledger.md`.
- Link the durable work item and affected Spec, Design, or ADR.
- Add exact source paths and revision information when repository evidence constrained the decision.
- Propose an ADR for long-lived architecture, policy, interface, security, data ownership, or costly-to-reverse decisions.
- Propose a glossary update when authoritative sources conflict on an important term.
- Preserve the user's wording for intent while clearly labeling any inference.
- Never rewrite an accepted decision silently; supersede it with a reference and reason.

End with confirmed decisions, rejected alternatives, evidence gaps, unresolved questions, next owner, and whether the work is ready for Spec, Design, or neither. Never report downstream files as updated unless they were changed and verified.
