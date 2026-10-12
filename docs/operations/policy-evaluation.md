# Adversarial policy evaluation

Phase 4B evaluates whether the development organization resists realistic failure, not only whether ordinary feature tests pass. The scorecard is a read-only evaluation of supplied observations. It never advances a Work Item or turns a fixture into canonical evidence.

## Scenario catalog

The managed `.ai-org/core/adversarial-scenarios.json` catalog currently covers:

- false completion;
- evidence from the wrong revision;
- self-approval and loss of separation of duties;
- unauthorized external mutation;
- stale scope;
- cold-task context loss;
- duplicate or unactionable notifications.

Each scenario names the attempted violation, applicable collaboration profiles, acceptable outcomes, required invariant checks, required evidence labels, allowed side effects, and cleanup boundary. Projects may add more evaluation artifacts, but changing the managed catalog is a framework-version change.

## Run an evaluation

Copy `.ai-org/templates/policy-evaluation-fixture.json` into a project-owned artifact path, select `solo`, `collaborative`, or `high-assurance`, and replace every `unknown` result with an observed outcome and evidence labels:

```bash
node ./templew.mjs evaluation run . \
  --fixture .ai-org/artifacts/policy-evaluation/solo.json \
  --no-write \
  --json
```

Remove `--no-write` to create the rebuildable `.ai-org/views/policy-evaluation.json` scorecard.

Outcomes mean:

| Outcome | Meaning |
|---|---|
| `prevented` | The attempted violation was refused before it changed protected state |
| `detected` | The violation or inconsistency was surfaced and remained unresolved or safely bounded |
| `recovered` | The system returned to a valid state through recorded recovery steps |
| `unknown` | Available evidence cannot support a conclusion |
| `escaped` | The prohibited outcome or invariant failure occurred |

A report passes only when every profile-applicable scenario has an acceptable outcome, all required checks are true, all required evidence labels are present, and every side effect was declared. Missing and `unknown` cases return incomplete. Escapes, invariant failures, undeclared side effects, and missing evidence fail closed.

## Scorecard

The report includes outcome counts and the following measures:

- gate integrity;
- revision correctness;
- separation of duties;
- external-authority preservation;
- context recovery;
- recovery steps and rework actions;
- human intervention;
- emitted, actionable, and suppressed duplicate notifications.

These measures explain the observed run. They do not prove a production incident exercise, regulated acceptance, or improvement over a historical baseline.

## Authority and privacy

The command reads repository artifacts and writes only an optional generated view. It performs no external action, approval, deployment, model call, or lifecycle mutation. A fixture should contain bounded evidence labels and numeric measures, not prompts, hidden reasoning, credentials, or source bodies. Authorized live exercises remain separate evidence records with their own environment and exact revision.
