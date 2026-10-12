# ADR-0041: Put the outcome before responsibility in Codex task titles

## Status

Accepted on 2026-09-02. This supersedes only the title-format sentence in ADR-0006; its lifecycle CLI, task registry, and canonical-identity decisions remain accepted.

## Context

Temple originally suggested `WI-#### · Position · Agent Name`. That format was reproducible, but a human scanning the Codex sidebar could not tell what each task was doing. Agent display names alone also became difficult to remember when one Agent Identity held several Positions. Unstructured app-generated titles made duplicate or abandoned work harder to recognize.

The title must become more useful without becoming a second source of truth. It also must distinguish a bounded execution task from the long-lived project control conversation.

## Decision

Use these human navigation conventions:

- ordinary bounded work: `WI-#### · short goal · Position (Agent)`;
- project control task: `Project · control scope · Primary Position (Agent)`.

Derive the ordinary short goal from the canonical Work Item title: collapse whitespace and replace embedded `·`. Bound the complete suggested title to 58 Unicode code points by shortening only the goal and appending `…`; keep the Work Item ID, Position, and Agent name visible. If the non-goal fields alone exceed that budget, preserve them rather than silently abbreviating identity or responsibility.

The total-title limit protects the Position and Agent suffix from host
truncation. Keep the full title below the observed host boundary rather than
budgeting only the goal text.

Store the ordinary suggestion in the task registry, but keep the Work Item ID and Codex thread ID as the actual identity. Refresh existing stored suggestions only through an explicit idempotent command. Updating the registry does not rename, create, message, archive, or otherwise mutate a Codex app task; an app rename is a separate observable action.

The main control title is not registered as a fake Work Item task. It is a human label for the project-wide control conversation.

## Consequences

- Humans can scan for both outcome and responsibility without memorizing Agent names.
- Task titles may change safely as navigation labels while canonical identity and evidence remain stable.
- Existing registry suggestions can be reconciled without disturbing runtime metadata.
- The app and repository may temporarily show different labels; status must not claim synchronization until the app rename succeeds.
- Long or poorly written Work Item titles still affect readability, but deterministic whole-title bounding keeps responsibility visible on the verified Codex surface.

## Rejected alternatives

- Keep Position and Agent only.
- Use Agent names as the leading label.
- Let chat-generated titles become identifiers.
- Automatically rename every historical Codex task during upgrade.
- Register the project control conversation against a fabricated Work Item.
