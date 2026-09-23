# Subscription-first clarification

The maintainer clarified that no extra model API keys are available. The primary
goal is selecting among models in the existing monthly Codex subscription so that
ordinary work does not always inherit Astra. Gemini CLI may be available but is
not the main execution target. This supersedes the assumption that a live LiteLLM
endpoint is required for this iteration's main integration path.

Implement explicit Codex subscription connections and task/node routing, retaining
ChatGPT login and account availability checks. Use Luna/Sol for a small bounded
live qualification; do not reset usage, buy credits, switch login or modify global
configuration. Keep requested, runtime-confirmed and provider-observed model state
distinct. Subscription quota is not a dollar bill or a per-task token invoice.

LiteLLM remains an optional fixed-connection path with offline protocol checks.
Its live endpoint/model qualification stays not-run without credentials and is
not a prerequisite for the subscription path. Claude native onboarding and the
rest of P01–P10 remain in scope.

Read-only observations on 2026-09-23: local Codex CLI reports ChatGPT login;
model/list exposes gpt-6-astra (default), gpt-6-sol and gpt-6-luna. This does not
by itself prove a model turn, tool interaction or sandbox qualification.

## Final bounded retry authorization

On 2026-09-24 (Asia/Tokyo), after being told about the failed functional checks,
the maintainer explicitly authorized **one** further subscription qualification
after offline fixes and complete verification. Maximum: Luna then Sol, two workflow
dispatches and 180 seconds. Each dispatch may involve multiple model/tool calls;
precise subscription-credit cost remains unavailable. No Astra, account changes,
credits reset/purchase or subscription changes. Stop additional live model checks
after this attempt regardless of success or failure. Preserve its report and every
earlier result; a protocol-only probe is not model qualification.
