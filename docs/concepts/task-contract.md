# Workkeel task contract reference

Workkeel provides an opt-in task-first lifecycle through the `workkeel` executable.
See the [task-first quick start](../getting-started/workkeel.md) for initialization,
canonical creation, claiming, delivery, distinct-Agent review and closeout.
The renamed package is unreleased source; legacy `temple` commands and guarded
Work Items remain available in legacy mode.

This page describes the **read-only descriptor validator and legacy projection**
originally introduced as the migration foundation. These inspection operations
are separate from the current native lifecycle; validation alone never creates
a task or authorizes its execution.

## What is implemented

`workkeel.task-contract/v1` describes work without company titles or a manual
list of generic AI skills. The executable schema and semantic validator are in
`src/task-contract.mjs`. The existing CLI can validate a proposed local document
or project an existing Work Item. In a legacy checkout, both operations below
are strictly read-only:

```bash
node ./templew.mjs work-item contract . --work-item WI-0001 --no-write --json
node ./templew.mjs work-item validate-contract . --source work-order.json --no-write --json
```

Projection returns exit code 0 for a structurally valid projection, even when
migration fields remain unresolved. Validation returns exit code 0 only for a
structurally valid, complete descriptor; incomplete or invalid input returns 1.
Neither result authorizes execution, authenticates identities, verifies referenced
evidence or proves completion. `execution_authorized` is always false and
`boundary_enforcement` is always `not-performed`.

The input file must be repository-relative, valid UTF-8 JSON, a regular file no
larger than 1 MiB, with no symlink components. Ordinary replacement/change while
reading is rejected. This reader is not a hostile-filesystem sandbox.

## Descriptor-validation example without Positions

This JSON illustrates a descriptor accepted by the standalone validator. It is
**not a native task-create payload**: its build state and populated implementer
describe progress that the create operation does not allow callers to fabricate.
Use the complete intake example in the
[task-first quick start](../getting-started/workkeel.md) when creating a task.

The references below are illustrative. Create and review the actual project
policy and approval artifacts before using the native lifecycle. A well-formed
filename is not proof that the approval exists or is current.

```json
{
  "schema_version": "workkeel.task-contract/v1",
  "id": "WI-0001",
  "goal": "Correct the checkout total",
  "scope": {
    "include": ["Checkout calculation and focused regression coverage"],
    "exclude": ["Deployment and payment-provider changes"]
  },
  "actor": { "agent_id": "agent-a", "principal_id": "project-owner" },
  "state": "build",
  "dependencies": [],
  "acceptance": { "criteria": ["The reproduced total is exact"], "evidence": [] },
  "verification": {
    "risk_tier": "standard",
    "separation": "distinct-agent",
    "implementer": { "agent_id": "agent-a", "principal_id": "project-owner" },
    "reviewer": null,
    "candidate_revision": null
  },
  "handoff": null,
  "environment": {
    "cwd": ".",
    "read_paths": ["src", "test"],
    "write_paths": ["src/cart.mjs", "test/cart.test.mjs"],
    "tools": ["node"],
    "resources": [],
    "network": { "mode": "none", "hosts": [] },
    "external_actions": [],
    "data": {
      "classification": "internal",
      "model_access": "none",
      "policy_refs": ["docs/data-policy.md"]
    }
  },
  "authorization": {
    "approved_by": "project-owner",
    "approval_ref": "docs/work-order.md",
    "operations": ["read", "write", "execute"],
    "expires_at": null
  },
  "skills": [],
  "execution": {
    "runtime": { "kind": "host-owned", "adapter_id": null, "required_features": [] },
    "model_connection": { "kind": "native" }
  },
  "legacy": null
}
```

All fields are explicit; unknown fields are rejected. `environment` and
`authorization` may be null during migration, but the descriptor is then
incomplete. Paths are normalized repository-relative roots (a directory includes
its descendants); `.` represents the repository root. No absolute paths, parent
traversal, Windows drive paths, control characters or globs are accepted. All
paths remain relative to the repository, **not** the requested `cwd`.

Tools, resources, actor IDs and adapter IDs are identifiers, not executable shell
commands. Nothing in this command runs a tool or grants resource access. Network
hosts are explicit lower-case hostnames/IPv4 addresses, without ports or wildcard
patterns; URL parsing is separate. The runtime must later enforce actual hosts,
ports, redirect behavior, symlinks, resource limits and command permissions.

## Four separate concerns

| Concern | Contract location | Meaning |
| --- | --- | --- |
| Work and accountability | `actor`, `scope`, `acceptance`, `handoff` | Who performs this task and what must be delivered |
| Permission and environment | `authorization`, `environment` | Explicit approval references and requested operational boundaries |
| Project methods | `skills` | Repository-relative instructions needed by this project, not generic AI abilities |
| Execution and model connection | `execution.runtime`, `execution.model_connection` | Runtime requirements versus native or optional gateway model settings |

`verification` preserves actual identity separation. A distinct-agent requirement
rejects the same agent as implementer and reviewer. Distinct-principal also
requires different known Principal IDs. Merely renaming a persona does not prove
independence: the current project must verify those identities and evidence. High
and critical risk cannot declare no separation. Legacy review policy is projected
as unresolved, not inferred from a Position label.

This validator does not resolve dependencies, verify acceptance evidence, match a
review to a candidate, authenticate approvals, measure model quality or implement
lifecycle transitions. Done-state descriptors need evidence, a candidate revision
and the declared reviewer fields, but passing those structural checks is not an
acceptance judgment. Native task operations separately check the approved contract,
dependencies, exact candidates, evidence and lifecycle transitions as described in
the quick start. Legacy projects retain their existing lifecycle gates. Neither
path authenticates a human merely from an attributed identity.

## Optional fixed gateway descriptor

Model selection belongs to the adapter/model connection, not a job title. A
gateway descriptor has this shape:

```json
{
  "kind": "gateway",
  "provider": "litellm",
  "base_url": "http://localhost:4000/v1",
  "model": "configured-model-alias",
  "selection": "fixed",
  "credential_env": "WORKKEEL_GATEWAY_KEY"
}
```

This requires `runtime.kind: adapter` with an explicit adapter ID, the gateway
hostname in the network allowlist, network operation approval and data policy
`model_access: approved-connection`. URLs require HTTPS except loopback HTTP;
embedded credentials, query strings and fragments are rejected. Only the name of
a credential environment variable is stored. It is never read by this command.
Do not place credentials in URL paths, model aliases, free text or policy files.

The native baseline deliberately leaves the host's model selection alone. A
native setting cannot bypass `model_access: none`; that example is a local-only
descriptor. If work sends project data to any hosted model, its actual network
and data policies still need approval and runtime enforcement.

This is **configuration validation only**. No LiteLLM client, service installation,
credential access, automatic router, provider call or working adapter integration
is delivered by this validator. The current runtime planner, described in the
[task-first quick start](../getting-started/workkeel.md), can produce read-only
native or fixed-gateway plans without launching a provider. Existing legacy
runtime/provider interfaces remain intact. Live model/tool compatibility,
start/resume/cancel, result reporting and host boundary enforcement still require
explicit qualification before a live-support claim.

## Legacy compatibility

The projector reads the same `.ai-org/work-items/WI-ID.json` used by current
commands. It never rewrites that file, old schema names, events or evidence.
Goal, scope, state, dependencies, acceptance references and the last exact-revision
handoff are projected. The original source path/digest and legacy role/assignment
remain under `legacy`.

An active claim contributes its recorded actor and Principal. A default assignment
without an active claim has no inferred Principal. The legacy `affected_paths`
field is **not** converted into read/write permission. Environment and approval
must be deliberately supplied; original gates, historical claims and full handoff
artifacts must be reviewed during migration. Native/host-owned execution is a
suggested baseline, not a claim about the legacy task's actual runtime.

Position-free canonical creation, claiming, delivery and closeout are now
available in the opt-in native lifecycle. The
[task-first quick start](../getting-started/workkeel.md) also documents explicit,
fingerprint-bound migration for compatible quiescent Solo projects. Read-only
projection does not perform that migration or waive its restrictions. The
[original migration decision](../adr/0071-workkeel-task-contract.md) preserves
the scope and limitations of the earlier foundation slice.
