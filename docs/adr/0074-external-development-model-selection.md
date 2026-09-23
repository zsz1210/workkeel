# ADR-0074: Keep personal development model selection external

Status: accepted for bounded local evaluation; not a framework runtime integration.

## Context

The maintainer wants to avoid using a frontier model for every development task
while retaining the existing ChatGPT subscription. Native Codex currently lists
`gpt-6-luna` and `gpt-6-sol` at medium effort for this host. A matched synthetic
pilot compares those destinations; it does not validate a LiteLLM gateway.

## Decision

Keep LiteLLM optional and outside Workkeel dependencies and core. Evaluate its
local heuristic classifier as a task-start recommendation, with native Codex
remaining responsible for authentication, approvals and execution. This is not
LiteLLM proxy routing on every model request. Do not copy credentials, modify
global Codex settings, introduce a background service, or weaken Workkeel's
qualified host transport guard. A preview does not launch an agent.

Evaluate LiteLLM **1.101.0**, Git tag commit
`18243cd7af4c3325165ba68b21379e2719e051c7`. The PyPI macOS ARM64 wheel
SHA-256 is `d4064024151ff2877e542b56c6bb6a39e0c3e6651abf4639af9346a678586e52`.
Use an isolated personal environment, binary wheels only, and retain installation
versions/hashes. Do not use a floating installer. Only heuristic classification:
no LLM/JEV/embedding classifier, completion calls, price fetches or savings claims.
Local classification must have denied network and no credential environment.

The optional tool should preview the selected model and reason, default to no
execution, and allow only Luna/Sol. A later explicit launch uses native Codex;
it is not evidence that LiteLLM's ChatGPT provider supports this account.
Classifier failure must stop, not silently select an expensive model. No automatic
escalation to Astra, retries, paid API, or account reset.

## License and compatibility review

[LiteLLM's pinned license](https://github.com/BerriAI/litellm/blob/v1.101.0/LICENSE)
places non-enterprise source under MIT. The
[heuristic implementation](https://github.com/BerriAI/litellm/blob/v1.101.0/litellm/router_strategy/complexity_router/complexity_router.py)
is outside that enterprise directory; built-in heuristic scoring makes no
classifier API calls. MIT copyright and permission notices must accompany copied
or redistributed substantial upstream code. This project vendors no upstream
source and installs nothing in its published package. Retain upstream license in
the separate installed distribution. Enterprise controls are not authorized.

The [subscription-provider documentation](https://docs.litellm.ai/docs/providers/chatgpt)
does not establish this host's Pro Lite plus GPT-6 Luna/Sol combination. Therefore
do not activate that OAuth/proxy path or describe it as qualified. Absence from
documentation is uncertainty, not proof that it can never work.

[The upstream incident report](https://github.com/BerriAI/litellm/issues/24518)
identifies compromised PyPI 1.82.7 and 1.82.8. Do not install them. Pinning the
reviewed later release is not a blanket security guarantee; refresh official
advisories before any future installation or update.

## Consequences and verification

No API key, proxy daemon or new paid license is needed for local heuristic
classification alone. The native Codex work still consumes subscription quota.
Token counts do not measure dollar savings or monthly credits. The heuristic can
misclassify short, implicit or non-English tasks; preview and explicit model
override remain important. Do not auto-apply this experiment as project policy.

Verify classifier behavior offline with pinned dependencies, blocked network and
synthetic English/Traditional Chinese cases before presenting it as usable.
The existing paired pilot tests native model execution separately. No additional
model calls are implied by this decision. Uninstalling the separate environment
and launcher removes the option without changing framework state or Codex login.
