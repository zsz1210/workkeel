# Set up model routing for a project

Temple does not assume that every project uses OpenAI, Codex, the same account, or the same models. A fresh project receives four abstract execution profiles, but their `provider_id`, `model`, and `reasoning_effort` values are deliberately `null`.

That means a new project can reason about the kind of execution it needs before it knows which concrete model will provide it:

| Abstract profile | Intended use |
|---|---|
| `mechanical-fast` | Low-risk repetitive work with objective checks |
| `lightweight-quality` | Bounded reversible work where quality matters |
| `standard` | Ordinary implementation, diagnosis, and documentation |
| `critical-planning` | Consequential architecture, security, migration, or independent judgment |

These are roles for execution configurations, not model rankings. They do not imply Luna, Terra, Sol, a local model, or any other Provider-specific choice.

## The portable onboarding path

### 1. Inspect the Provider catalog

Use the approved Provider's own discovery interface. For Codex App Server, the current official interface is [`model/list`](https://learn.chatgpt.com/docs/app-server#list-models-modellist). It reports the models visible to that environment, their supported reasoning efforts, default effort, input modalities, visibility, and related client metadata.

A catalog result proves only that the Provider advertised an option at that time. It does not prove:

- that the account can complete the project's task;
- that tools, structured output, or a particular sandbox work correctly;
- that the option is cheaper or higher quality;
- that its alias, price, or availability will remain stable; or
- that Temple is authorized to use it.

Record the Provider, discovery method, observed version when available, observation time, and unavailable fields. Do not fill missing facts from conversation memory.

### 2. Qualify compatibility

Before proposing a mapping, verify the requirements that matter to the project: modalities, reasoning options, tool behavior, structured output, data class, execution boundary, and the installed Provider protocol. Start with a generation-free contract or handshake when the interface supports one. A live compatibility test requires its own bounded authorization.

Unknown required capabilities fail closed. An optional unknown may remain visible without blocking an otherwise valid candidate.

### 3. Propose a project mapping

Map only compatible candidates into `.ai-org/project/execution-policy.json`. An AI can draft and explain this proposal, but the proposal must cite observed Provider facts and project requirements. It must not claim that a model is suitable merely because the AI remembers it or because another Temple project used it.

For example, one project may choose:

```json
{
  "id": "standard",
  "provider_id": "approved-provider",
  "model": "provider-model-id",
  "reasoning_effort": "medium"
}
```

Another project may leave the same profile unmapped, use a local model, or add a specialized profile. Concrete mappings are project-owned and are never written back into Temple's framework overlay.

Temple can build the first proposal deterministically from a normalized local input:

```bash
node ./templew.mjs execution onboarding-plan . \
  --input .ai-org/evaluations/model-onboarding/initial.json \
  --json
```

The input combines four deliberately separate sources:

- a timestamped Provider catalog observation;
- compatibility assessments with evidence and eligible abstract profiles;
- optional explicit project preferences; and
- optional aggregate usage history with `raw_content_included: false`.

For each unmapped profile, the planner prefers a compatible explicit preference, then a uniquely most-observed compatible historical configuration, and then a sole compatible candidate. A history-based result is labeled as a low-confidence **familiarity prior**. It does not claim that the familiar model is better, cheaper, safer, or more efficient. Ties, incompatible preferences, catalog-only models, and missing compatibility evidence stay unresolved.

The command reads only the supplied repository file and current execution policy. It does not call `model/list`, read past conversations, modify the policy, start a model, or retain its output. Provider discovery remains a preceding integration step; policy adoption remains a later reviewed step.

### 4. Review and adopt

Adopt the proposal through the project's normal repository review. Keep these states distinct:

- **discovered** — advertised by the Provider;
- **compatible** — passed the declared technical boundary;
- **proposed** — suggested for an abstract profile;
- **adopted** — present in the reviewed project policy;
- **requested** — selected for one execution route; and
- **effective** — acknowledged or observed for the actual Provider execution.

No earlier state implies a later one.

### 5. Resolve in shadow or advisory mode

Describe each execution step with its Task Shape, required capabilities, Provider and data constraints, risk, and resource limits. Then preview the route:

```bash
node ./templew.mjs execution resolve . \
  --request .ai-org/evaluations/execution/WI-####-step.json \
  --json
```

The resolver rejects ineligible profiles first, then applies the reviewed preference order. An unmapped profile is rejected with `provider-unmapped`. The command does not contact the Provider, start a task, switch a model, or change the repository.

### 6. Calibrate with project evidence

Start with a conservative adopted baseline in `shadow` or `advisory` mode. After representative Work Items exist, compare candidates on the same Task Shape using objective quality, Tokens, latency, retries, rework, and human intervention. A matched result may justify a reviewed project-policy proposal. It does not automatically modify the policy or become a framework-wide recommendation.

## Where judgment comes from

Temple uses three different inputs and never substitutes one for another:

| Input | What it decides |
|---|---|
| Framework rules | Safe profile semantics, eligibility, evidence, and authority boundaries |
| Provider evidence | What appears available and technically supported now |
| Project evidence and preferences | What is acceptable for this project's risks, quality needs, and resource envelope |

Conversation history may help an AI explain the choices, but it is not one of these evidence sources. A new user and a long-running user therefore follow the same routing contract.

See [Adaptive execution routing](../concepts/adaptive-execution-routing.md), [Execution routing operations](../operations/execution-routing.md), and [Model and process evaluation](../operations/model-and-process-evaluation.md).
