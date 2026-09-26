# ADR-0081: Native dispatch and retained reading state

- Status: Accepted
- Date: 2026-09-26

## Context

Direct host delegation bypassed the existing external local LiteLLM selector.
Child usage lacked task bindings. Observer polling rebuilt DOM subtrees and closed
user-opened explanations.

## Decision

Add task-pinned, provider-neutral native dispatch policy and immutable UUID tickets.
Capabilities, dependencies and scopes are explicit. Optional local classifier advice
makes no model call and cannot widen authority. An explicit source helper adapts
the existing personal selector; no new dependency or third-party source is shipped.
The external installation remains LiteLLM 1.101.0, MIT non-enterprise, with its own
dependency notices. The original package is unchanged.

Nicknames are optional; preserve registered actors, historical pins and actual
independent review. Explicit activity kinds and wait-excluded execution intervals
are separate from governance state. Host elapsed time alone is insufficient.

Semantic observer revisions and retained DOM reconciliation preserve reading state.
Heartbeat timestamps do not replace content. Changed documents offer a reload
action. The observer remains read-only and model-free.

## Consequences

The host must use the tickets and report execution; metadata is not a sandbox or
interception layer. Unbound historical work stays incomplete. Long host logs use
validated exact-turn offsets with the existing bounded read limits. Retained Temple
schema IDs, evidence and hashes are not rewritten as a branding change.
