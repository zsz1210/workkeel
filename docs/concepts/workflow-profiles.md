# Workflow profiles and lifecycle outcomes

Temple separates three ideas that are easy to confuse:

- the **organization profile** describes how people, Agent Identities, and Positions coordinate;
- the **workflow profile** controls how much delivery evidence one Work Item needs; and
- the **model route** is execution advice recorded separately from lifecycle authority.

Changing one does not silently change the others.

## Choose the smallest safe workflow

| Workflow | Use it when | Route | What it keeps |
|---|---|---|---|
| Lean | The work is bounded, local, reversible, low risk, and has clear acceptance | Intake → Build → Test → Done | One delivery brief, implementation evidence, test evidence, closeout |
| Standard | Ordinary product or engineering delivery | Spec → Design → Build → Test → Eval → Independent QA → Release Gate | Separate responsibility and evidence gates |
| High-Assurance | Failure could materially affect production, security, sensitive data, or irreversible operations | Standard route plus the risk-tier contract | Revision-matched evidence, stronger separation, rollback, named human approvals |

Standard is the default. Lean is opt-in and requires a recorded low risk tier, bounded scope class, and rationale. High-Assurance also requires the repository's High-Assurance collaboration prerequisites.

## What makes Lean ineligible?

Temple uses explicit signals rather than guessing from prose.

These signals require at least Standard:

- an external write or publication;
- a schema or data migration;
- a shared cross-repository contract;
- unresolved scope; or
- a requirement for Independent QA.

These signals require High-Assurance:

- deployment or production release;
- destructive or difficult-to-reverse behavior;
- sensitive-data handling; or
- security or authorization boundary changes.

Risk tier and scope class also set minimum profiles. The strongest recorded requirement wins. A repository that is not configured for High-Assurance fails closed instead of quietly falling back to Standard.

## Create a Lean Work Item

```bash
node ./templew.mjs work-item create . \
  --title "Correct one local parser edge case" \
  --scope "Parser module and focused tests" \
  --acceptance "The reproduced input passes without regression" \
  --workflow-profile lean \
  --risk-tier low \
  --scope-class bounded \
  --profile-rationale "Local reversible change with stable acceptance" \
  --ui-mode not-applicable
```

Before Build, the delivery brief must satisfy `work_order`, `approved_scope`, `acceptance_criteria`, `technical_design`, `risk_review`, and `profile_eligibility`. Lean still requires Developer evidence and Test evidence. It performs no external release.

To inspect why a profile was selected, read `workflow_profile`, `risk_tier`, and `profile_assessment` on the Work Item or open its Work detail in the optional Management Console.

## Escalate without losing the reason

Before Build, configure a stronger signal and let the CLI recompute the profile:

```bash
node ./templew.mjs work-item configure . \
  --work-item WI-0001 \
  --escalation-trigger cross-repo-contract \
  --profile-rationale "The change now alters a shared service contract"
```

Temple allows only a preserved or stronger profile. After Build, stop and replan the Work Item before changing its profile so already-produced evidence is not misrepresented as evidence for a different risk contract.

## Read terminal outcomes correctly

| State | Meaning | Needs current attention? |
|---|---|---:|
| `blocked` | Work is unfinished and a named impediment prevents progress | Yes |
| `done` / `accepted` | The approved scope passed its closeout | No |
| `concluded` / `no-go` | The attempt finished and the decision was not to proceed | No |
| `concluded` / `inconclusive` | The attempt finished without enough evidence for the intended claim | No |
| `cancelled` | Work ended without a delivery decision | No |

For old repositories, preview narrow legacy reconciliation first:

```bash
node ./templew.mjs work-item migrate-outcomes . --dry-run --json
```

Only legacy records that already contain a Release Gate no-go and release record qualify. Apply `--outcome inconclusive` only when a human or accepted evidence has made that interpretation explicit; Temple does not infer it from prose.

## Model guidance is separate

This repository currently uses Sol for consequential planning and evaluation, Terra for ordinary implementation and integration, and Luna for stable bounded or mechanical work. That is project-local advisory policy, not a framework-wide proof and not an automatic routing rule.

Current OpenAI guidance similarly recommends comparing representative tasks across success, evidence quality, Tokens, latency, and cost instead of assuming the largest model or highest reasoning level always wins. See [OpenAI model selection guidance](https://developers.openai.com/api/docs/guides/latest-model).

Related decisions: [ADR-0026](../adr/0026-high-assurance-is-a-risk-contract.md), [ADR-0034](../adr/0034-attribute-usage-before-routing-models.md), and [ADR-0045](../adr/0045-adaptive-workflow-profiles.md).
