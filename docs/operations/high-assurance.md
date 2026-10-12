# High-Assurance profile

High-Assurance is a selectable risk contract for work that needs stronger traceability and human accountability. It is not a larger team preset and it does not authorize production changes.

## Entry prerequisites

Before selecting the profile, the project must have:

- at least two active Human Principals;
- one active Principal sponsor for every active Agent Identity;
- different Agent Identities for Developer and Independent QA; and
- different Agent Identities for Developer and Release Manager.

`collaboration set-profile --profile high-assurance` rejects the change until these conditions hold. `doctor` rechecks them afterward.

## Risk tiers

Every new High-Assurance Work Item records a risk tier and its derived immutable assurance contract. The contract stays attached to that Work Item even if the project later selects Solo or Collaborative for new work; profile switching cannot downgrade an existing gate. `doctor` rejects a stored contract that no longer matches its recorded risk tier and installed policy schema.

| Tier | Artifact depth | UI modes | Human approvals | Rollback |
|---|---|---|---:|---|
| `low` | Lean | Any declared mode | 1 | Planned or verified |
| `standard` | Standard | Any declared mode | 1 | Planned or verified |
| `high` | Controlled | No `code-first` | 1 independent Principal | Planned or verified |
| `critical` | Controlled | `not-applicable` or `design-led` | 2 distinct Principals | Verified |

No-UI work remains valid through `not-applicable`. High risk does not force a vendor design tool; it requires a reviewable delivery mode appropriate to the risk.

## Additional lifecycle gates

High-Assurance adds normalized evidence requirements to the existing lifecycle:

| Transition | Additional requirement |
|---|---|
| Design → Build | Accepted or mitigated risk evidence at sufficient severity |
| Build → Test | Verified exact Git candidate evidence |
| Test → Eval | Passing normalized test evidence |
| Independent QA → Release Gate | Passing test or runtime evidence recorded by the assigned Independent QA Agent |
| Release Gate → close | Same exact tested revision, risk-appropriate rollback evidence, and a repository approval record |

Evidence IDs must belong to the Work Item, be current, and match the exact scope revision. A High-Assurance handoff resolves its input ref to a full Git commit instead of preserving only the caller's moving ref.

## Approval record

Copy `.ai-org/templates/high-assurance-approval.example.json` into a project-owned artifact path and replace every placeholder. The record uses `temple.approval/v1`, names the Work Item and exact commit, records the decision and distinct active Principals, and keeps `external_action_authorized` false.

An approver independent of the Developer sponsor is required. A valid organizational closeout is still not authorization to deploy, publish, spend money, send a message, handle sensitive data, or perform an irreversible action.

## Example start

```bash
node ./templew.mjs collaboration set-profile . --profile high-assurance

node ./templew.mjs work-item create . \
  --title "Migrate one bounded record" \
  --scope "One reversible migration" \
  --acceptance "Exact-revision test and Independent QA pass" \
  --affected-path "src/migration" \
  --base-revision HEAD \
  --risk-tier high \
  --ui-mode not-applicable
```

Use `evidence risk`, `evidence git`, `evidence test`, `evidence runtime`, and `evidence rollback` to create the normalized IDs named at later gates. See `node ./templew.mjs --help` for the full arguments.

## Evidence boundary

Automated tests cover local prerequisites, risk-scaled UI defaults, exact-revision evidence, Independent QA attribution, rollback depth, approval validation, and closeout. Real regulated deployment, external audit acceptance, several-machine contention, and production authorization remain unverified. The retained large collaboration test remains `not_run`.

See [ADR-0026](../adr/0026-high-assurance-is-a-risk-contract.md).
