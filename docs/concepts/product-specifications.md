# Product specification system

Temple uses contract-guided iterative delivery: establish the smallest approved product truth needed for a bounded slice, deliver and verify that slice, then reconcile what was learned into the appropriate source. A specification is a maintained agreement, not a one-time prompt and not a substitute for evidence.

## Specification hierarchy

```text
Product Charter
      |
      v
Product Requirements
      |
      v
Feature Spec
      |
      v
Interaction / API / data contracts
      |
      v
Work Items, implementation, and evidence
```

| Artifact | Stable question | Expected lifetime | Primary owner |
|---|---|---|---|
| Product Charter | Why does this product exist, for whom, within which boundaries, and toward which outcomes? | Product-level; changes rarely | Product Manager with human business authority |
| Product Requirements | What product behavior, constraints, and quality outcomes must be satisfied? | Product or release horizon | Product Manager |
| Feature Spec | What bounded behavior will this delivery change, and how will it be accepted? | Feature lifecycle | Product Manager with UX Designer and Tech Lead input |
| Supporting contract | How do collaborating surfaces or components communicate and fail? | Interface lifecycle | The Position responsible for that contract |

The hierarchy is traceable, not duplicative. A Feature Spec references requirement IDs rather than copying the full requirements document. A requirement references Charter outcomes rather than restating the Charter. Work Items point to the approved Feature Spec and supporting contracts.

## Contract-guided iterative delivery

1. **Recover current truth.** Read the approved Charter, relevant requirements, active ADRs, domain sources, and external authoritative documents. Do not infer approval from chat history or a generated summary.
2. **Identify the decision frontier.** Separate confirmed facts, assumptions, unresolved questions, and the human decisions needed before scope can be accepted.
3. **Define the smallest stable contract.** Record observable behavior, boundaries, interfaces, failure semantics, acceptance evidence, and ownership needed for one vertical slice.
4. **Decompose around the contract.** Create bounded Work Items with dependencies, affected paths, required Disciplines, and a named integration owner. Parallel work begins only after shared contracts are stable.
5. **Deliver and verify.** Implementation, evaluation, and Independent QA use the same approved contract and candidate revision reference.
6. **Reconcile learning.** Update the owning specification only when evidence changes product truth. Implementation details, temporary investigation notes, and generated projections do not automatically become requirements.

Iteration does not mean silently changing acceptance criteria after implementation. A material scope or contract change returns to the owning Position, records the revision, updates affected references, and re-evaluates downstream work.

## Source-of-truth rules

- Every specification names its stable ID, status, owner, authoritative location, source revision, approval evidence, parent references, and any superseded artifact. Approved repository-native sources also pin a SHA-256 content digest so an unrecorded source edit cannot masquerade as the same revision.
- Use `draft`, `approved`, `superseded`, or `archived` explicitly. Only an approved artifact governs delivery; a draft may guide discovery but cannot silently replace approved scope.
- One subject has one declared authority. Links, Context Map routes, Context Capsules, dashboards, exports, and generated summaries are projections or navigation aids unless a human explicitly designates the underlying source as authoritative.
- When an external document remains authoritative, preserve its native format and record its canonical location, immutable revision or observation time, owner, access boundary, and repository evidence reference. In the current alpha, an `external` source location in the registry must be an HTTP(S) URL; record non-URL native identifiers in the owning evidence or approval record. See [Enterprise document adoption](../getting-started/enterprise-document-adoption.md).
- Repository templates are managed starting points. Documents created from them are project-owned and must live at project-native paths rather than inside `.ai-org/templates/`.
- Chat, task titles, and Agent memory may explain context but never supersede an approved specification.

## Project specification index

`.ai-org/project/spec-index.json` is the compact project-owned registry for specification identity, authority, revision, source, approval, and related Work Items. It records the selected `federated`, `hybrid`, or `temple-native` adoption profile and the `contract-guided-iterative` delivery method.

The index routes to sources; it does not duplicate their bodies. A `temple_native` entry points to a repository source, an `authoritative_external` entry points to an external source, a `derived_projection` cites the authority from which it was produced, and `legacy_unverified` cannot become approved until its authority is resolved. Work Items carry specification IDs with the revisions against which they were scoped so stale references can be reported rather than silently accepted.

## Work Item specification modes

- `gate-evidence` is the lightweight default for a bounded item with no indexed product specification. The existing Spec -> Design gate still requires named `approved_scope` and `acceptance_criteria` evidence, but the item cannot claim indexed product-scope revision or staleness protection. It cannot carry `spec_refs`; indexed UX, UI, API, or technical contracts may still govern their declared subjects.
- `indexed` is used when the Work Item is governed by registered product specifications. At least one current approved `spec_ref` is required before Design, and later lifecycle operations recheck approval, indexed revision, authority, approval provenance, and repository-source integrity.

Gate-evidence is not permission to use chat as scope. It is appropriate for a small low-risk change, a legacy repository during migrate-on-touch adoption, or a bounded discovery item whose approved scope evidence already lives outside the registry. Standard multi-party or long-lived product work should use indexed mode. Status exposes the selected mode so the lighter contract cannot be mistaken for indexed governance.

## Revision and traceability rules

1. Keep stable IDs when wording changes without changing the underlying product identity. Create a new ID when the product concept or contract is replaced rather than revised.
2. Record what changed, why, who approved it, an approval-record reference, the source revision and content digest where applicable, and which requirements, Feature Specs, Work Items, tests, or external documents are affected.
3. Preserve supersession links. Do not delete an approved contract while active work or historical evidence still references it.
4. Resolve contradictions at the owning source. Do not repair a conflict only in a Context Capsule, handoff, implementation comment, or test fixture.
5. A code change does not update product truth by implication. A test demonstrates behavior; it does not approve a requirement change.
6. Re-run affected acceptance, evaluation, and Independent QA gates after a material contract revision.
7. Once a Work Item enters Design, its specification mode and governing specification IDs are frozen. Once it enters Build, its UI delivery mode and UX, UI, and technical-contract IDs are frozen. A current approved revision of the same ID may be repinned; changing scope or contract identity requires stopping and replanning the item before delivery continues.

Recommended requirement IDs are stable and local to their owning document, such as `OUT-001`, `REQ-001`, `NFR-001`, and `AC-001`. The exact naming scheme may follow an existing project convention if traceability remains unambiguous.

## Scale by risk, not document count

| Depth | Appropriate use | Minimum specification evidence | Additional expectations |
|---|---|---|---|
| Small | Low-risk experiment or narrow internal change | Concise Charter or existing product baseline, focused requirements, one Feature Spec, observable acceptance | One vertical slice, explicit non-goals, local verification, Independent QA when the lifecycle requires it |
| Standard | Maintained product, several collaborators, or meaningful integration risk | Approved Charter, prioritized requirements, Feature Specs with traceability, relevant interaction/API contracts | Named owners, dependency and affected-path analysis, evaluation, revision history, integration plan |
| High-assurance guidance | Regulated, safety-sensitive, security-sensitive, or costly change | Controlled baselines, bidirectional traceability, formal approval records, explicit hazard and non-functional requirements | Stronger separation of duties, change-impact review, retained evidence, audit and rollback policy, exact external-source controls |

High-assurance depth remains specification guidance by itself. Framework-level High-Assurance operation additionally requires selecting the profile, satisfying its human-accountability prerequisites, recording a Work Item risk tier, and passing its normalized exact-revision, rollback, and approval gates. A controlled document set alone is not a High-Assurance completion claim.

Small projects may combine the Charter and requirements in one project-owned document when ownership, status, IDs, and traceability remain clear. Standard and higher-risk projects should keep independently reviewable baselines. No project should create empty documents merely to satisfy the hierarchy.

## Managed starting templates

- `product-charter.md`
- `product-requirements.md`
- `feature-spec.md`
- `ui-interaction-contract.md`
- `legacy-document-audit.md`

Copy only the templates needed for the current project and place the resulting artifacts in the project's chosen documentation structure. Register governing identity, authority, approval, and revision in the specification index; add a Context Map route only when Agents need retrieval guidance. Neither index copies the source body into generated state.
