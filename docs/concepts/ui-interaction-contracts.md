# UI interaction contracts

A UI interaction contract connects product behavior, user experience, visual treatment, frontend state, API semantics, and backend rules before collaborators implement separate pieces. It complements the [UI design brief](ui-design.md): the brief selects visual-delivery evidence, while the interaction contract defines what the integrated experience must do.

## Tool-neutral contract paths

| Contract path | Use when | Required evidence |
|---|---|---|
| Not applicable | The work changes no user-facing or operator-facing interaction | A recorded rationale, affected surfaces, and any separate API or backend contract still required |
| Code-first | Interaction and visual risk are low and executable iteration is inexpensive | Concise interaction mapping, required states, executable result, runtime review |
| Preview-first | Flow, layout, or stakeholder interpretation should be reviewed before full implementation | Interaction mapping plus a reviewed wireframe, code preview, prototype, or equivalent artifact |
| Design-led | Brand, accessibility, multi-team coordination, or rework risk requires an approved design source | Versioned interaction contract, approved design source, implementation mapping, and runtime comparison |

The machine-readable UI policy records all four values. `not-applicable` is the explicit result for work without a user-facing interface; code-first, preview-first, and design-led are the three delivery modes for interface work. A backend-only Work Item may select `not-applicable` while still requiring an API, event, data, or operational contract. The choice must be explicit before Build; null remains readable only while new work is undecided or for legacy records.

The framework defines evidence rather than a mandatory tool. Figma is one optional visual artifact alongside native previews, Storybook, browser prototypes, annotated screenshots, Markdown, and other project-approved media. A Figma link does not replace written interaction or API semantics unless the project explicitly assigns that file and revision authority for named decisions.

## Responsibility boundaries

| Responsibility | Accountable owner | Required contribution | Does not self-certify |
|---|---|---|---|
| UX | UX Designer | User goal, journey, information and interaction structure, behavioral states, usability risk, copy intent, recovery path | Visual implementation quality or release |
| UI | UI Designer | Hierarchy, layout, components, visual states, design-system mapping, responsive and accessibility treatment, delivery mode | Frontend correctness or release |
| Frontend | Developer with frontend or mobile Discipline | Executable state model, input handling, client validation, accessibility implementation, API integration, runtime evidence | Product scope or Independent QA |
| API contract | Tech Lead with the assigned API-capable Developer | Operation and schema, versioning, authentication boundary, success and failure semantics, compatibility | Product priority or release |
| Backend | Developer with backend Discipline | Business rules, authorization, persistence, state transitions, idempotency, observability, contract tests | UX acceptance or Independent QA |
| Integration | Named integration owner | Shared-contract revision, dependency order, candidate assembly, cross-layer evidence | Independent QA of their own implementation |

API and frontend or backend are Disciplines and contract responsibilities, not new framework Positions. Position authority and human approval boundaries remain unchanged.

## Screen-state-action-error mapping

For each affected surface, map observable behavior across layers rather than writing separate, inconsistent lists.

| Surface | User state | User action or event | Frontend response | API or service operation | Backend rule or transition | Error and recovery | Owner | Acceptance evidence |
|---|---|---|---|---|---|---|---|---|
| Example surface | Ready | Submit valid input | Disable duplicate submit and show progress | `POST /example` | Validate invariant and apply one idempotent transition | Map validation, authorization, conflict, offline, timeout, and unexpected failures to a recoverable outcome | Named owners | Test, preview, runtime capture, or QA reference |

Include only states relevant to the feature, but explicitly consider:

- initial, empty, loading, ready, editing, submitting, success, and partial-success states;
- validation, authorization, permission, conflict, rate-limit, offline, timeout, and unexpected-error states;
- retry, cancel, back, resume, duplicate action, and stale-data behavior;
- keyboard, focus, screen-reader, contrast, motion, localization, responsive, and device constraints; and
- telemetry or operator evidence needed to diagnose a failed cross-layer interaction.

Errors are part of the product contract. Do not leave error copy to UI, status-code meaning to frontend, or recovery rules to backend independently.

## Contract-first parallel slicing

Parallel work is safe only after the shared behavior is stable enough for each child Work Item to implement against the same revision.

```text
Approved Feature Spec
        |
        v
Stable interaction + API + data/error contracts
        |
        +--> UX slice
        +--> UI slice
        +--> Frontend slice
        +--> API/backend slice
        +--> Test/evaluation slice
        |
        v
Named integration owner -> integrated candidate -> Independent QA
```

Before declaring parallel readiness:

1. Link the approved Feature Spec and product requirement IDs.
2. Record the interaction-contract revision, API or data schema revision, error taxonomy, and unresolved decisions.
3. Give each child Work Item explicit scope, required Discipline, dependency state, affected paths, evidence, and owner eligibility.
4. Separate shared-contract files from implementation scopes, or name an explicit coordination owner for overlapping writes.
5. Name the integration owner and the candidate assembly point.
6. Block or sequence work when a dependency is incomplete, a shared contract is unstable, or semantic independence is unproven.

`temple parallel check` can evaluate the existing deterministic readiness fields, but it does not prove that contracts are semantically complete. The responsible Positions still review the actual specifications.

## Verification and change control

- UX verifies journey, behavior, content intent, and recovery against the approved contract.
- UI verifies hierarchy, components, states, accessibility treatment, and the selected visual artifact where applicable.
- Developers preserve unit, contract, integration, and runtime evidence for their owned layers.
- Quality & Evaluation Engineer tests cross-layer state and error combinations, not only the happy path.
- Independent QA reproduces acceptance against the integrated candidate revision reference.
- A material behavior, schema, error, or visual-authority change increments the contract revision, updates affected Work Items, and rechecks parallel readiness.

## Current implementation boundary

The framework currently records `not-applicable` plus the three interface delivery modes and installs UI design-brief and interaction-contract starting templates. Project instances are project-owned. The current implementation records the selected mode and specification references on a Work Item; it does not add a Figma adapter, external design sync, or automatic semantic contract validator.
