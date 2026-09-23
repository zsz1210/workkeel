# Workkeel executable workflows and model routing

- Date: 2026-09-23
- Status: direction approved; implementation in progress
- Work Item: WI-0260
- Source: the maintainer approved P01–P10 and explicitly requested implementation
  through completion, model-appropriate delegation, OSS review and final cleanup.

The deferral of a Graph engine and automatic routing in DEC-0008 is superseded
for this new slice. Its completed migration history is not rewritten. DEC-0006's
quality-first and explainable-evidence principles remain; this slice adds an
explicit opt-in executor rather than silently converting advisory data into grants.

Approved outcomes are graph execution, node/task model selection, Headroom policy,
Claude/native onboarding, runtime qualification, Skills/terminology audits,
measured verification and readable three-language documentation/diagrams.

The maintainer subsequently clarified that existing ChatGPT-subscription Codex
is the primary runtime, with explicit Luna/Sol selection and no additional API
key. A bounded synthetic qualification is authorized. LiteLLM remains optional;
live gateway qualification requires service configuration and separate budget/data
authorization. No global account/default-model or subscription change is implied.

Implementation decisions and acceptance are in
`docs/adr/0073-opt-in-workflow-execution.md` and
`.ai-org/artifacts/WI-0260/specification.md`. LangGraph is an implementation choice
within the requested OSS-first direction, subject to exact-version license review
and tests. Models, live service and spend/data limits are not invented.
