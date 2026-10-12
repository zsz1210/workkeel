# Execution routing operations

Temple can resolve an explainable execution profile for each step without calling a Provider or changing project state.

## Inspect the active policy

The project-owned policy is:

```text
.ai-org/project/execution-policy.json
```

`temple status` and the Management Console System page show its selection mode, profile mapping coverage, capability count, resource-measure count, fallback, and non-executing boundary. These are read-only projections; edit and review the canonical policy through the project's normal repository workflow.

The framework seed is Provider-neutral. A concrete profile mapping is valid only when `provider_id`, `model`, and `reasoning_effort` are all strings or all `null`.

A freshly initialized project intentionally has no concrete mappings. Do not copy model names from the Temple repository or infer them from an Agent conversation. Follow [Model routing setup](../getting-started/model-routing.md) to discover the approved Provider catalog, qualify compatibility, propose and review project-owned mappings, and retain unknowns honestly.

## Describe a routed request

Store durable evaluation inputs below `.ai-org/evaluations/execution/` when the request should be reviewed and versioned. An ephemeral caller may also create a temporary repository-relative input. The schema supports several independent steps in one Work Item.

```json
{
  "schema_version": "temple.execution-request/v1",
  "work_item_id": "WI-0001",
  "steps": [
    {
      "step_id": "design-security-boundary",
      "responsibility": "tech_lead",
      "task_shape": {
        "position_id": "tech_lead",
        "lifecycle_stage": "design",
        "task_kind": "security",
        "risk_class": "high",
        "context_profile_digest": "sha256:replace-with-real-digest"
      },
      "capability_route": {
        "required": ["text.reasoning", "architecture.design"],
        "optional": []
      },
      "constraints": {
        "required_modalities": ["text"],
        "allowed_provider_ids": ["approved-provider"],
        "data_class": "internal",
        "execution_boundary": "approved-provider",
        "resource_limits": []
      },
      "selection": { "mode": "advisory" },
      "resource_observations": []
    }
  ]
}
```

The `responsibility` label is descriptive. Eligibility still comes from the Work Item claim, Position Membership, capability policy, and other existing authority checks. Routing never grants a new responsibility.

## Validate before resolving

```bash
node ./templew.mjs schema validate . --json
```

The catalog applies both JSON Schema and cross-document semantic checks. It rejects unknown required resource measures, invalid mappings, duplicate IDs, broken profile references, and authority values that imply Provider contact or automatic execution.

## Resolve the request

```bash
node ./templew.mjs execution resolve . \
  --request .ai-org/evaluations/execution/example.json \
  --json
```

The command:

- reads only a repository-relative file that resolves inside the project;
- validates the project policy and every request step;
- evaluates all hard constraints before preference;
- returns eligible and rejected profiles with stable reasons;
- separates requested Provider/model/reasoning from future effective observations; and
- performs no file write, network request, Provider call, task launch, lifecycle transition, or model switch.

## Read the result

For each step, check these fields in order:

1. `selection.status`: `resolved` or `unresolved`;
2. `selection.mode` and `selection.authority`;
3. `selection.rule_id`, `fallback_applied`, and `unresolved_reason`;
4. `capability_route.unknown_required` and `unknown_optional`;
5. `eligibility.rejected[].reasons`;
6. `selected.requested` for policy intent; and
7. `selected.effective.status`, which remains `unobserved` until a separate Provider boundary supplies evidence.

Do not label `selected.requested` as the model actually used. Do not convert a missing resource observation into zero.

## Change preference safely

1. Keep the existing policy and representative request fixtures under review.
2. Add or revise a profile without changing Position Assignment.
3. Confirm required capabilities, privacy, data class, execution boundary, and risk support.
4. Run schema validation and route fixtures.
5. Use matched quality evidence from the Usage Policy before claiming that one candidate is better.
6. Keep the mode `shadow` or `advisory` until a separately designed executor and authority contract exist.

Provider discovery and policy adoption are separate operations. A `model/list` result can establish that a model and reasoning option were advertised to the current Codex environment; it cannot establish project quality, price, execution authority, or the model that was effective for a later turn. Preserve discovered, compatible, proposed, adopted, requested, and effective states separately.

A Work Item or human decision may pin a profile, but pinning is not permission to contact its Provider.

## Extend beyond software development

A project may add capability IDs such as `content.storyboard` or `media.video.render`, define a compatible profile, and route a `video_producer` responsibility without modifying Temple's core Position catalog. The same policy rules apply: capabilities describe what the step needs; existing project governance decides who may request and perform it.

See [Adaptive execution routing](../concepts/adaptive-execution-routing.md), [Capability catalog](../extensions/capability-catalog.md), and [ADR-0046](../adr/0046-separate-adaptive-execution-routing.md).
