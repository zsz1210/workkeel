# ADR-0085: Native workspace, bounded autonomy and versioned Skill learning

- Status: Implementation candidate; independent acceptance required

## Context

A user needs to supervise multiple projects, understand who is working, choose
model settings and continue an approved goal without approving every routine
step. A finished execution is different from accepted work. Local observations,
model settings and learned procedures must not become new task authority.

## Decision

The workspace is a local projection over registered native projects. Project and
repository IDs namespace task references. Task records remain in their original
private project. Integration checks bind component revisions and evidence; a set
of accepted components alone does not accept their composition.

An immutable whole-goal manifest identifies the mandatory component set and an
integration component depending on every other component. A sealed controller
retains the original approved authority after explicit claim release. It continues
actual implementation, checks, distinct reviewer-authored native decisions and
bounded rework; unknown effects reconcile by identity without redispatch. Exact
task versions, candidates, interface bytes and integration evidence determine
current acceptance. Historical completion is retained separately after drift.

Model, reasoning and service settings are independent dimensions. Project defaults
and activity, role, task and node overrides resolve only among models permitted by
the task's data, risk, quality and host capability boundaries. Budget and quota
cannot lower those boundaries. Drafts require explicit approval. Runtime use needs
an exact approved policy pin; a settings change never rewrites a dispatched run.
Requested, selected and reported values remain distinct. Unsupported fixed values
block instead of silently falling back.

Autonomy uses durable jobs and idempotent enforcing host adapters. Idle observation
makes no inference calls. New work needs existing task authority. Runtime completion
awaits canonical acceptance, and independent review remains a different Agent's
decision. Live or unresolved ownership cannot be displaced by a lease expiry.
Pause, cancellation request, confirmed cancellation and recovery are separate states.

Improvement discovery is off by default. Explicit directions, source scope, rounds,
cooldown, runtime and spending bounds permit a bounded discovery run. Proposals pin
the sources that support them. Without standing admission they await task authority.
A separately sealed grant may authorize narrower derived native tasks after the
source goal is accepted, with exact original approval/template/model/data scope,
supported assessed risk, testable outcomes and cumulative reservations. Discovery
itself is read-only and independently reviewed. Equivalent failed issues remain
deduplicated; idle source observations do not invoke a model. Partial intake uses
the same frozen identities. No proposal fabricates an approval, installs a
dependency or publishes a change.

Project Skill learning has append-only candidate, comparison, independent review,
approval, activation, use, outcome and retrospective records. Comparison includes
holdout and neighboring negative-trigger cases and requires demonstrated improvement
without regression. Activation copies exact versioned project-local files with a
manifest. It is not global installation. An explicitly approved low-risk standing
policy may authorize activation after independent review; higher-risk candidates
still need explicit approval. Source drift, failed outcomes or revoked standing
authority removes current eligibility while preserving historical evidence.

Retrieval selects a bounded relevant subset under approved read roots. It cannot
infer reading, application, successful outcome or acceptance. A retrospective may
legitimately conclude that there is no new reusable learning.

Storage is bounded, measurement identity is preserved and unknown usage is never
zero. Verified archives preserve originals; archive copies release zero bytes.
No pruning of acceptance evidence or automatic cross-project learning is introduced.

## Consequences

Users gain one desktop workspace and explicit runtime/learning controls without
duplicating task state. Enforcing runtime adapters still determine supported model
and service settings. Settings and discovery cannot create authority; only the
sealed original standing grant can admit new bounded tasks. Capacity
limits fail explicitly rather than silently dropping evidence. All maintainer data
stays outside public source under ADR-0083.

See [workspace operations](../operations/workkeel-workspace.md),
[native Skill lifecycle](../extensions/workkeel-skill-lifecycle.md) and
[native learning](../extensions/workkeel-learning.md).
