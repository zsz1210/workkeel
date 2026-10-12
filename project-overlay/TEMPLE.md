# Project AI development organization operating contract

Read this whole contract with applicable native/project instructions. Navigation is
in `AGENTS.md`; lifecycle mechanics are in [temple-work](.agents/skills/temple-work/SKILL.md).
Read procedures when their trigger applies, not the entire catalog. Required
unselected and nested sources still apply. Reuse only whole bodies actually read,
still available and unchanged; a digest proves neither reading nor comprehension.
An unreadable required source blocks mutation. An incomplete route or unclear
authority requires recovery, not a best-effort substitute.

## Authority and scope

- Inspection, explanation, diagnosis, review and status are read-only unless the
  request authorizes changes. Identify Work Item, Position, Agent Identity,
  Principal and scope. A Position is not an Identity, Assignment, Discipline or
  authority grant; Disciplines never expand authority. Collaborative/High-Assurance
  claims require the sponsored Identity and eligible Position Membership.
  Fresh ordinary work uses attributed responsibility without framework-specific login;
  missing legacy actor policy retains its prior behavior. Explicitly verified and
  High-Assurance operations require current provenance. Local evidence metadata is
  not provider authentication. Stable Agent IDs, not display names, select actors.
- Follow `.ai-org/core/workflow.json` and the item's effective profile/risk.
  Standard retains Spec, Design, Build, Test, Eval, Independent QA and Release Gate;
  eligible Lean retains a distinct Verifier, not formal Independent QA. Never
  downgrade a gate or accept external completion as repository evidence.
  Team profile alone does not raise a task's default workflow. Reuse compatible
  measurements conservatively; an independent candidate judgment is still required.
- Humans own business truth, priority, budget and external commitments. Material
  cost, irreversible actions, sensitive data and high-risk release need approval.
  Read `.ai-org/project/usage-policy.json` before model, reasoning, Credits or
  calibration choices. Automatic action is limited to its approved reversible,
  local, allowlisted budget; ask at its exceptions. Samples are not statistical proof.
- Only exact `temple.lock.managed_files` entries are framework-managed. Allowed
  roots are not ownership claims. Preserve project-owned files on init/upgrade.
  Resolve bootstrap mismatch before mutation; use the pinned CLI, not manual repair.
- Read `.ai-org/project/repository-integration.json` and its policy references
  before integration. Confirm an unconfirmed policy or respect its deferral;
  The framework imposes no GitHub Flow or merge/deploy permission. Separate machines
  coordinate through Git, branches, review and CI; a local lock is not distributed.

## Task-specific obligations

Sequential delivery: one active owner, no parallel preparation required.
Governed parallel delivery only: reserve eligible workers before dispatch and join
their exact evidence before dependent work; follow the Work Skill's parallel procedure.
If scope, risk or ownership changes, stop the narrow path before further mutation
and resolve the applicable route.

| When relevant | Required source or rule |
| --- | --- |
| First initialization | Read [temple-init](.agents/skills/temple-init/SKILL.md) before writes. Obtain its combined confirmation of names, mappings and integration policy; resolve existing-file conflicts before initialization. Post-init bootstrap does not replace this pre-write boundary. |
| Product authority | Read approved current scope/acceptance and supporting UX/UI/API/technical specs. `.ai-org/project/spec-index.json` is an authority registry, not copied documents. Indexed work pins approved repository-native SHA-256 revisions before Design; gate-evidence work cites named approved scope/acceptance without claiming indexed protection. Reconcile stale, derived, unapproved or drifted references before intentionally repinning. `contract_refs` governs API/technical specs; `shared_contract_refs` coordinates implementation, not product authority. |
| Context and repeated work | Keep `.ai-org/project/context-map.json` concise and reference-only. Search active Practices and matching validated Lessons. Learning routes knowledge, never permission or automatic promotion. Authorized capture/revalidation uses the Learning CLI and current learning index. |
| UI delivery | Read `.ai-org/core/ui-design.json` and `.ai-org/templates/ui-design-brief.md`. Resolve UI Designer; choose code-first, preview-first or design-led before Build. Record mode/rationale/references and required evidence; preview/design-led pins approved UI revisions and runtime visual checks remain. Use `not-applicable` with no `ui_refs` only without UI. No vendor is mandatory. |
| High-Assurance | Read `.ai-org/core/high-assurance.json` and [assurance](.agents/skills/temple-work/references/assurance-and-recovery.md). Preserve risk tier, sponsors, normalized revision-matched evidence, distinct Human Principals, rollback and approvals; Developer differs from QA and Release Manager. |
| External trackers/references | First read `.ai-org/project/tracker.json`. Keep repository Work Items, execution tasks and company items distinct. Inspect/reconcile do not write externally. Never store credentials, infer write-back permission or let external done/cancelled satisfy gates. |
| Console/control plane | Read its project configuration before operating it. Provider usage/health/events and views cannot satisfy gates; unsupported capabilities stay unknown. An Observer/Console is optional, not required for ordinary delivery. |
| Separate Codex task | Use the CLI's `suggested_title` verbatim: `WI-#### · short goal · Position (Agent Name)` or `Project · control scope · Primary Position (Agent Name)`. Register its stable ID. A custom-agent name identifies Position configuration, not display name. Registration does not create/rename/resume/archive tasks; those actions need actual app operations. |
| Open decision, domain ambiguity, documentation or Skill authoring | Use the applicable [decision](.agents/skills/decision-interview/SKILL.md), [domain](.agents/skills/domain-modeling/SKILL.md), [documentation](.agents/skills/project-documentation/SKILL.md) or [authoring](.agents/skills/skill-authoring/SKILL.md) Skill. Discovery is not authority to perform or promote the capability. |

## Initialization and recovery

If `temple init` ran this session, resolve `TEMPLE_BOOTSTRAP_REQUIRED` before
governed mutation. Prefer a fresh session after native entrypoint merges are
resolved and provider loading is known. For continuity, read every named source,
run read-only Doctor/Status/Context, identify the Work Item and report responsibility
and next action first. Neither acknowledgement nor import compatibility proves
loading, comprehension, permission or lifecycle progress. Init creates an absent
project-owned `CLAUDE.md` importing `@AGENTS.md`; compatible existing content is
preserved, conflicts remain at `.ai-org/project/CLAUDE.temple.md`. Do not assume
`AGENTS.md` is universal or that the CLI detects the current provider.

On a failed operation or pending journal, follow the Work Skill's
[assurance/recovery reference](.agents/skills/temple-work/references/assurance-and-recovery.md).
Preserve current evidence and uncertainty; never bypass guards or delete recovery state.

## Completion

One substantive evidence record may support multiple named gates: cite it rather
than duplicate its prose. Keep exact candidate, actual results, blockers and next
owner explicit. Generated handoffs/receipts record administration, not acceptance.
Follow the Work Skill's completion checks; a past receipt is not fresh verification.

Before a pilot/example/experiment, record purpose, observable stop and excluded
follow-on work. At that stop preserve evidence and return for the decision. A
bounded closeout `go` never authorizes another experiment, product task, dependency,
external action, publication or production. Do not infer continuation from success.
