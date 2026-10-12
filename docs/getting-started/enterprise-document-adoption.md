# Enterprise document adoption

Temple can join a project that already uses wikis, issue trackers, design systems, office documents, shared drives, architecture repositories, or regulated record systems. Adoption should make authority and retrieval clearer without forcing a disruptive rewrite into one repository format.

## Three adoption models

| Model | Authority | Repository role | Best fit |
|---|---|---|---|
| Federated | Existing external systems remain authoritative for their declared subjects | Store routes, bounded evidence references, ownership, revision, and access metadata | Mature organizations with governed tools, regulated records, or many teams |
| Hybrid | Existing sources remain authoritative until touched; active contracts and new project-native decisions are maintained in the repository | Bridge external truth to approved repository contracts without bulk migration | Default for an existing enterprise project |
| Temple-native | Project-owned repository documents are authoritative | Store the Charter, requirements, Feature Specs, ADRs, contracts, and evidence directly | New projects or teams that deliberately choose repository-native governance |

Hybrid is the default for an existing enterprise project because it preserves institutional history while giving active AI-assisted delivery a bounded, reviewable contract. Changing the model is a governance decision, not an automatic initialization side effect.

## Preserve external formats and authority

- Do not convert a source merely because Markdown is easier for an Agent to read.
- Preserve the external system's native document, identifiers, version history, owners, permissions, approval workflow, retention policy, and required notices.
- Record which subject each source governs. A product brief, API schema, ticket, visual artifact, test report, and approval record may each be authoritative for different questions.
- Capture a stable revision, version, or observation timestamp with every evidence reference. A mutable URL without provenance is insufficient for a gate claim.
- Pin approved repository-native documents with their SHA-256 content digest. If the file changes, revise and reapprove its index entry before delivery proceeds.
- If access is unavailable, stale, or ambiguous, record the gap and owner. Do not reconstruct restricted content from memory or an old summary.
- Figma may be one optional visual source. It has no special authority unless the project designates a specific file and revision as authoritative for named visual decisions.

Existing terminology and folder structure should remain project-native. Temple is the central framework and technical namespace; installed artifacts belong to the product and should not rename its teams, systems, or documentation estate.

## Migrate on touch

Bulk migration creates duplicate truth, loses review history, and consumes effort before a document is needed. Hybrid adoption therefore migrates only the bounded material touched by authorized work.

1. **Audit the source set.** Use the legacy-document-audit template to record location, format, owner, subject authority, revision, access, confidentiality, duplication, and known conflicts.
2. **Select the active contract.** Identify the smallest sources required for the Feature Spec or Work Item. Do not load or copy the whole documentation estate.
3. **Confirm authority.** Ask the owning human or policy which source governs each disputed subject. Preserve unresolved contradictions as blockers.
4. **Choose the treatment.** Keep the source federated, extract a bounded repository contract with explicit source references, or deliberately replace it with a Temple-native project document.
5. **Preserve provenance.** Record source identifiers, revisions, owners, approval records, local transformations, omissions, and access limits.
6. **Reconcile authority and routing.** Update `.ai-org/project/spec-index.json` with the approved authority, status, source, and revision; then update affected specifications and add or revise Context Map routes only where retrieval guidance is useful. Mark replaced copies as superseded or derived; do not leave two active authorities.
7. **Verify downstream impact.** Recheck Work Items, tests, UI or API contracts, approvals, retention rules, and handoffs affected by the migration.

Migrate-on-touch is not permission to edit or write back to an external system. External mutation requires explicit user authority, a supported connector, and that system's own approval process.

## Conflict and duplication rules

| Situation | Required response |
|---|---|
| Two sources claim authority for the same subject | Stop, name the conflict, and obtain an owner decision before acceptance |
| A repository copy is older than its external source | Treat the copy as stale; update or supersede it with provenance |
| An external source cannot be accessed | Mark verification blocked or limited; do not promote a cached summary to authority |
| A required format cannot be represented faithfully | Keep the native source and store a bounded explanatory contract or adapter reference |
| A historical document remains useful but no longer governs | Mark it superseded or reference-only and retain its replacement link |
| Different sources govern different fields | Record field- or subject-level authority explicitly instead of selecting a false global winner |

## Derived projections never become authority

Context Maps, Context Capsules, generated capability registries, dashboards, rendered diagrams, search indexes, exports, and AI summaries are derived projections. They may improve routing and observation, but they must:

- cite their canonical sources and source revisions;
- report generation time and transformation when relevant;
- expose missing or inaccessible evidence;
- remain disposable and rebuildable; and
- never approve, supersede, or silently repair an authoritative source.

A generated view can reveal a conflict. The conflict is resolved only in the owning source and then reflected in a regenerated view.

## Scaling adoption

- **Small project:** record a short source inventory and one authority decision for the active feature.
- **Standard project:** maintain subject-level ownership, migration decisions, Context Map routes, and periodic stale-source review.
- **High-assurance guidance:** retain controlled baselines, access and confidentiality classification, approval and retention evidence, transformation checks, and bidirectional traceability.

The current framework provides documentation contracts, project-owned routing, and generated views. It does not claim to synchronize external systems, preserve every proprietary format, bypass access controls, or perform external write-back automatically.
