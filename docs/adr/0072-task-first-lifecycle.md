# ADR-0072: Task-first lifecycle without company Positions

Status: accepted for the opt-in implementation; live runtime qualification pending.

## Decision

Workkeel coordinates repository tasks; it is not an AI company simulator or a new
execution engine. New task-first projects register attributed Agents/Principals,
approvers and review separation. They do not require Positions or generic coding
skill catalogues. Project Skills, runtime features, model connections and scoped
authority remain separate. The host coding agent performs the work.

Preserve the complete approved contract and its hash, with mutable claim, delivery,
review and closure outside it. Store each task and its append-only hash-linked
operation history together in `.ai-org/work-items/` using an atomic durable write.
Expected versions and operation IDs guard stale writes and identical retries.
This is local checkout coordination, not distributed locking or authentication.

Acceptance requires an exact Git candidate descended from the claim base, declared
write roots, stable approval/evidence bytes, completed dependencies and a distinct
registered reviewer. Completion is local acceptance, not external release. Native
host execution is the default; a runtime-plan document never launches anything.

Existing Temple projects keep their pinned CLI, Position policies and schemas.
An explicit preview/fingerprint migration supports only quiescent Solo history;
legacy files remain byte-for-byte and legacy writers reject task-first projects.
High/critical-risk and sensitive-data work retain the established assurance path.
No automatic conversion of legacy authority or historical short revisions occurs.

## Runtime/model separation

Use the existing Codex App Server protocol, not a new agent loop. A fixed optional
gateway maps to a custom Responses provider using an environment-variable name.
Native model connections require no overrides. Start/resume must retain the same
connection fingerprint; cancellation and result reporting remain runtime concerns.
Tool/network policies are not the same as model transport configuration.

The existing provider cannot express every narrow filesystem or hostname boundary.
Therefore this slice exposes read-only plans, not automatic task-first dispatch.
Actual gateway/tool behavior requires explicit live qualification. No LiteLLM code
is vendored or service activated, so no new dependency or license is introduced.
The local protocol inspection used Codex CLI 0.155.0-alpha.9.2 generated schemas.

References: [Codex App Server](https://developers.openai.com/codex/app-server),
[Codex configuration](https://developers.openai.com/codex/config-reference),
[LiteLLM Codex setup](https://docs.litellm.ai/docs/proxy/client_setup/codex_cli).

## Consequences

Task-first mode is smaller and independent of title assignment, but it does not
pretend to authenticate actors, sandbox tools, migrate active teams, or establish
live model compatibility. Project instructions must be reviewed when opting in.
Old artifacts, failed attempts and version pins are retained. No Graph engine,
per-request auto router or large framework comparison is introduced.
