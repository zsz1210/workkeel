# Temple Core Path

Compatibility guide for existing Temple-mode projects. New Workkeel projects
start with the [Workkeel quick start](workkeel.md) and optional
[executable workflows](../operations/workkeel-workflows.md).

This is the shortest complete path from an initialized repository to a closed Work Item. It uses no Management Console, Observer daemon, Usage Collector, or automatic model execution.

Use the repository launcher in every command:

```bash
node ./templew.mjs --version
node ./templew.mjs doctor .
node ./templew.mjs status . --no-write
```

## 1. Choose the smallest safe workflow

| Workflow | Choose it when |
| --- | --- |
| Lean | The change is bounded, local, reversible, low risk, and does not require Independent QA |
| Standard | Ordinary product delivery, shared behavior, or work that requires Independent QA |
| High-Assurance | Production, security, sensitive data, destructive behavior, or difficult rollback |

The example below uses Lean. If an external write, migration, shared cross-repository contract, unresolved scope, or Independent QA is required, start with Standard. Use High-Assurance for its named risk boundaries. See [Workflow profiles](../concepts/workflow-profiles.md).

## 2. Create one bounded Work Item

```bash
node ./templew.mjs work-item create . \
  --title "Correct the checkout total" \
  --scope "Checkout calculation and focused tests" \
  --scope "No deployment or external release" \
  --acceptance "The reproduced total is correct" \
  --acceptance "Existing checkout tests still pass" \
  --affected-path "src/checkout/**" \
  --affected-path "test/checkout/**" \
  --workflow-profile lean \
  --risk-tier low \
  --scope-class bounded \
  --profile-rationale "Local reversible change with stable acceptance" \
  --ui-mode not-applicable
```

Keep the returned `WI-####`; do not use the conversation title as the identifier. The Work Item begins at Intake and names the next responsible Position.

## 3. Approve one delivery brief and enter Build

Create `.ai-org/artifacts/WI-####/delivery-brief.md` with these short sections:

- work order and approved scope;
- acceptance criteria;
- technical approach;
- risk and rollback review; and
- why Lean is eligible.

Then enter Build using that one reviewed brief:

```bash
node ./templew.mjs transition . \
  --work-item WI-#### \
  --to build \
  --satisfy work_order=.ai-org/artifacts/WI-####/delivery-brief.md \
  --satisfy approved_scope=.ai-org/artifacts/WI-####/delivery-brief.md \
  --satisfy acceptance_criteria=.ai-org/artifacts/WI-####/delivery-brief.md \
  --satisfy technical_design=.ai-org/artifacts/WI-####/delivery-brief.md \
  --satisfy risk_review=.ai-org/artifacts/WI-####/delivery-brief.md \
  --satisfy profile_eligibility=.ai-org/artifacts/WI-####/delivery-brief.md
```

Temple rejects the transition if the profile or evidence is insufficient.

For an explicitly selected daily execution plan, eligible low-risk bounded Lean
work can now follow [Daily core delivery](../operations/daily-delivery.md). The AI
chooses implementation methods; the CLI runs fixed checks and records handoff,
repair and task accounting. The coordinator continues authorized work to a
distinct Verifier without requiring another human “continue.” This is an optional
execution style within Lean, not a new workflow profile or background service.
The manual route below remains available; Standard and High-Assurance retain
their required gates.

An explicitly selected v2 plan uses [Autonomous delivery](../operations/autonomous-delivery.md)
across all three profiles after approved Build entry. The same AI may complete
eligible review responsibilities from one substantive judgment; the CLI preserves
each named gate, distinct Developer/reviewer identities and existing risk requirements.

## 4. Take ownership and resolve how to work

Read the assigned Developer Agent ID, current revision, and branch before claiming active ownership:

```bash
git rev-parse HEAD
git branch --show-current

node ./templew.mjs work-item claim . \
  --work-item WI-#### \
  --agent-id agent-name \
  --principal-id human \
  --base-revision commit-sha \
  --branch branch-name
```

Immediately before execution, discover the relevant method and bounded context:

```bash
node ./templew.mjs capability find . \
  --query "checkout calculation" \
  --position developer

node ./templew.mjs context resolve . \
  --work-item WI-#### \
  --position developer \
  --revision commit-sha \
  --no-write \
  --json
```

If the project uses Adaptive Execution Routing, describe the current step in a repository-relative request and preview the recommendation:

```bash
node ./templew.mjs execution resolve . \
  --request .ai-org/evaluations/execution/WI-####-build.json \
  --json
```

The route is advice only. It does not contact a Provider, start an Agent, switch a model, or grant permission. See [Execution routing operations](../operations/execution-routing.md) for the request format.

## 5. Build, verify, and hand off

Make the bounded change, run its focused tests, and commit the candidate. Record a short Developer report and test observation below `.ai-org/artifacts/WI-####/`.

```bash
node ./templew.mjs handoff . \
  --work-item WI-#### \
  --to quality_evaluator \
  --input-revision candidate-commit \
  --completed "Implemented the approved bounded change" \
  --evidence .ai-org/artifacts/WI-####/developer-report.md \
  --evidence .ai-org/artifacts/WI-####/developer-test.md

node ./templew.mjs work-item release . \
  --work-item WI-#### \
  --agent-id agent-name \
  --principal-id human \
  --reason "Developer handoff recorded"

node ./templew.mjs transition . \
  --work-item WI-#### \
  --to test \
  --satisfy developer_handoff=.ai-org/artifacts/WI-####/printed-handoff-file.md \
  --satisfy developer_evidence=.ai-org/artifacts/WI-####/developer-test.md
```

The `handoff` command prints its exact artifact path; use that path instead of the illustrative `printed-handoff-file.md`. Releasing the claim means the Developer is no longer the active runtime owner. The Work Item and Assignment remain intact.

## 6. Test and close the Lean Work Item

The assigned Quality Evaluator claims the Test stage, reproduces acceptance, and writes `quality-report.md`:

```bash
node ./templew.mjs work-item claim . \
  --work-item WI-#### \
  --agent-id quality-agent-name \
  --principal-id human \
  --base-revision candidate-commit \
  --branch branch-name

node ./templew.mjs work-item release . \
  --work-item WI-#### \
  --agent-id quality-agent-name \
  --principal-id human \
  --reason "Test evidence recorded"

node ./templew.mjs transition . \
  --work-item WI-#### \
  --to done \
  --satisfy test_evidence=.ai-org/artifacts/WI-####/quality-report.md \
  --satisfy lean_closeout=.ai-org/artifacts/WI-####/quality-report.md
```

Lean closeout records organizational completion only. It never deploys, publishes, or sends an external message.

Standard continues through Eval, a distinct Independent QA Agent Identity, and Release Gate. High-Assurance adds revision-matched evidence, stronger separation, verified rollback, and named human approvals. Follow the complete [Usage guide](usage.md) for those paths.

## 7. Confirm continuity

```bash
node ./templew.mjs status . --no-write
node ./templew.mjs doctor .
```

A fresh task should recover the Work Item, outcome, evidence, and next safe action from the repository. Capture a Lesson only when the work produced reusable evidence; do not turn every closeout into a Skill.

If a Standard or High-Assurance release attempt ends with `no-go`, the terminal state is `concluded` and the outcome is `no-go` or `inconclusive`. Use `blocked` only for unfinished work that can resume after a named impediment is resolved.
