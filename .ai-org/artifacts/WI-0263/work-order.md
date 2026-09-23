# Execution handoff and visual documentation

## Approved scope and acceptance

The maintainer requests the previous offline-only recommendation, clearer README
diagrams, an animated state-flow explanation, explicit defaults/options/support,
and advice about LiteLLM Auto and a task monitor. This authorizes local changes,
not another live model qualification, Console replacement, a native app, push,
publication, or changes to permissions/approval policy.

Developer: agent-rikku; independent reviewer: a separate runtime as agent-lulu.
Product/UI responsibility: agent-yuna; technical design: agent-tidus; local
integration/release responsibility: agent-mog. Principal: human.

Acceptance: preserve actual expiry and scope enforcement; a code-checked
model-facing authorization snapshot must not claim broader authority; test valid,
expired and missing authorization plus expiration during initialization offline.
Retain structured attention failures and failed live evidence. Redraw flow and
architecture with readable desktop/mobile layouts; provide an offline, controllable
animation (not live telemetry). Align all three README capability tables. Full
offline verification, browser gate, rendered review and distinct-Agent judgment
are required. No new runtime dependency or third-party artwork.

## Technical design and risk review

Keep the complete task contract unchanged. Immediately before opening a runtime
and again before sending a turn, validate authorization expiry numerically. Add a
dispatch-only snapshot containing the checked UTC timestamp and expiry; explicitly
separate coordinator-owned lifecycle/authorization checks from the assigned work.
The snapshot is explanatory, not a grant. Existing task/policy/claim checks and
host sandbox remain authoritative. Do not ask the model to infer expiry from its
date-only context. Missing materials, scope conflict or refusal remain attention.

Use original repository-owned vector assets and a self-contained HTML explainer.
No model calls, network requests, external scripts, background installation or
runtime data access. README uses stable static images; its animation link opens
the locally downloaded/cloned explainer, not executable JavaScript inside GitHub
Markdown. Keep state-machine states separate from optional runner states.

## UI brief and required state coverage

Mode: code-first. UI Designer responsibility: agent-yuna. The maintainer supplied
a stacked-layer infographic reference; borrow only its explanatory organization,
not artwork, branding or text. Low-risk documentation can be iterated in code.

Workflow: numbered main path with explicit review/rework and pause branches.
Architecture: four large stacked layers, each answering one question (agreement,
coordination, execution, evidence), left-to-right flow within each layer, explicit
default/optional markers and the boundary between completion and acceptance.
Use readable type, sparse arrows, accessible titles/descriptions, no tiny labels.

Animation: initial/playing/paused/end, happy path/rework/blocked/cancelled;
step-through controls; no autoplay; reduced-motion support; keyboard navigation;
light/dark; 390px and 1280px; no overflow or clipped text. Static images remain
useful without animation. Review actual browser renders and interactions.

Rollback: revert only this candidate's product files; preserve task history and
all previous failed qualification evidence. Stop at local acceptance and report
that live reliability remains unqualified. Console/macOS choice remains advice.
