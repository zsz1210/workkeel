# Skill scenario matrix

## Proportionate delivery scenarios

These are static contract cases, not observed model behavior or Independent QA.

| Request or condition | Expected route and stopping point |
| --- | --- |
| Inspect the status of an existing item | Read-only inspection; no lifecycle mutation |
| Implement one sequential bounded change | Existing claim and workflow; no parallel plan solely for sequential execution |
| Find callers of an API using an authorized native helper | Read-only support; return source references and uncertainties to parent, no child Work Item solely for assistance |
| Helper discovers a required edit | Stop support and return findings; obtain authority and use governed delivery before editing |
| Helper is asked to certify acceptance or Independent QA | Not support; use assigned formal verification responsibility and existing governance |
| Inspection requires a shared simulator or writing a report | Not support; apply resource/write authority and governed route |
| Helper cannot maintain read-only access | Do not dispatch; inspect locally only within authority |
| Already attached worker is called a helper | Retain its claim, resource, handoff and cleanup obligations |
| Developer completes a successful composed finish | Inspect mutation and diagnostics; stop at next owner, no duplicate checks for unchanged verified scope |
| Finish diagnostics fail or receipt is historical | Preserve unresolved failure or historical status; no fresh acceptance claim |
| Fresh clone has a failed finish observation but no pending journal | Show unresolved diagnostics and origin-owner recovery; no new completion operation or journal import |
| Qualified contributor has no intake ownership | Explicit proposal under own Agent/Principal/Position; no management impersonation or execution grant |
| Verifier sees a committed handoff after the exact product candidate | Retain candidate SHA; allow only CLI-validated descendant administration, reject source or authority drift |
| Context or authority changed | Reacquire required sources and invalidate stale evidence; do not reuse an old digest as permission |

This matrix is the routing, authority, and completion contract for repository Skills. The machine-readable fixture in `test/fixtures/skill-scenarios.json` prevents the contract from drifting away from the canonical Skill registry.

| Scenario | Expected Skill | Mode | Repository authority | Completion boundary |
|---|---|---|---|---|
| A fuzzy product idea with no authoritative project documents | `$decision-interview` | conversational | Read-only unless persistence is explicitly requested | Confirmed decisions, rejected alternatives, open evidence, owner, and readiness |
| An architecture choice conflicts with an ADR, code, or tests | `$decision-interview` | evidence-backed | Read the smallest authoritative set and cite paths; do not write unless authorized | Same decision frontier plus evidence gaps and proposed downstream updates |
| Product documents and code disagree on a domain term | `$domain-modeling` | evidence-backed proposal | Read-only by default; propose glossary and ADR entries when persistence is not authorized | Definitions, examples, invariants, boundaries, conflicts, owners, and impacts |
| A README or setup guide must match shipped commands, links, and capabilities | `$project-documentation` | human documentation mutation | Read evidence first; edit only when documentation changes are authorized | Focused human documentation, checked commands and links, honest claims, and explicit unverified gaps |
| A repeated project procedure should become a repository-local Skill | `$skill-authoring` | project Skill authoring | Check exact lock ownership; edit only a collision-free project-owned path when Skill changes are authorized | Trigger, non-trigger, authority, dependencies, provenance, completion, and validation evidence are explicit |
| The user asks to perform an existing capability, not author a Skill | none | normal capability execution | Follow that capability's own authority; Skill authoring does not expand it | The target outcome is handled without creating another Skill |
| The user asks only for current status or a diagnosis | none | read-only | `temple status --no-write`, doctor, and repository inspection only | Evidence-backed report with no lifecycle or source mutation |
| The user authorizes creation or transition of a work item | `$temple-work` | lifecycle mutation | Mutate only the named canonical state through the CLI | Requested state change, evidence, rebuilt status, and doctor result |
| A cold low-risk task reads the compact operating contract | `$temple-work` for its lifecycle operation only | source-level instruction reduction | Read the whole native/project contract and triggered procedure; no new cache, Position or skipped gate | Current authority and one evidence-bearing completion, not a Token-saving claim |
| An authorized operation resumes a known Work Item | `$temple-work` | known-work entry | Preview read-only Context first; reuse only already-read, available, unchanged bodies; still resolve current authority | Named operation only, using the effective workflow and CLI-suggested task title |
| Eligible Lean Developer work is ready for handoff | `$temple-work` | composed delivery | Read the conditional Lean reference and use current claim, exact candidate and evidence | One recoverable handoff/release/Test entry; no test, acceptance or release claim |
| The caller deliberately selects bounded Lean entry for an existing task | `$temple-work` | optional material entry | Explicit actor and read-only entry; read delivered bodies and required remaining sources, preserve bootstrap | Eligible packet and claim/finish navigation, or explicit existing-route fallback; no mutation |
| A distinct Lean Verifier has passing evidence for the exact candidate | `$temple-work` | optional composed completion | Current claim, explicit judgment and existing test/closeout evidence | Applied acceptance plus separate full diagnostics; no formal Independent QA or external release claim |
| A delivery operation fails | `$temple-work` | bounded recovery | Inspect code, mutation status, receipt and authority; repair only within approved scope | Same-request recovery or a clear stop; no automatic model retries or guard bypass |
| A new session resumes work without its earlier source bodies, or init reports pending bootstrap | `$temple-work` | explicit recovery | Read the required sources even when a digest matches; complete bootstrap before mutation | Current responsibility and authority established, or an explicit blocker without mutation |
| An eligible Lean Work Item has completed Test | `$temple-work` | Lean closeout | Satisfy `test_evidence` and `lean_closeout` through the existing Test-to-Done transition | Done for the approved scope; no Independent QA or external-release claim |
| Standard or High-Assurance work has completed Test | `$temple-work` | full assurance | Keep Eval, distinct-identity Independent QA, Release Gate, and applicable risk/approval requirements | Evidence-backed organizational closeout only |
| A required authority source cannot be read | `$temple-work` | blocked before mutation | A context digest is not permission or a substitute for the missing source | Report the missing authority without changing lifecycle state |
| Authorized implementation has decomposed child Work Items and needs a safe dispatch plan | `$temple-work` | group dispatch planning | Derive a generated plan only; create no task, claim, scope, or external action | Valid fresh waves, explicit sequential and blocked reasons, plan-only markers, and join ownership |
| A new project needs names but the proposed mapping is unconfirmed | `$temple-init` | confirmation gate | Inspect and suggest only; do not initialize | User confirms five names and ten Position mappings, or an explicit blocker remains |
| A confirmed decision must be recorded by an authorized work item | `$decision-interview` | persistence authorized | Update only the focused Decision Ledger or ADR described by the work item | Changed path, source references, revision, and verification are reported |
| The user asks to implement an already approved feature | none | normal implementation | Follow the Position and task scope; `$temple-work` is used only for a separate lifecycle mutation | Implementation and requested verification, without invented lifecycle state |
| An approved behavior can be expressed at a stable public test seam | `$tdd` from Build Quality | red-green implementation | Production mutation must already be authorized; pack use does not change lifecycle state | Real red reason, minimal green change, regression result, exact revision, and unresolved environments |
| A reproducible test or runtime symptom has no supported cause yet | `$diagnosing-bugs` from Build Quality | fault isolation | Diagnosis is read-only unless the user or work item also authorizes a fix | Reproduction, ranked hypotheses, discriminating evidence, supported cause or explicit uncertainty |

## Validation status

- Automated: core Skill directory equality, optional pack manifest and frontmatter shape, unique descriptions, bootstrap init equality, scenario fixture references, opt-in install/remove, exact lock ownership, and checksum-aware upgrade/removal.
- Manual design review: trigger overlap, authority wording, evidence mode, and completion boundaries.
- Scenario tests should use fictional projects and check routing, installation,
  upgrade, authority, and stop boundaries. Private forward-test reports are
  outside this public repository. A synthetic fixture does not prove real
  multi-human or multi-machine execution.

The first two checks verify structure and policy consistency. They do not prove that every model invocation will route correctly, and they are not Independent QA evidence.
