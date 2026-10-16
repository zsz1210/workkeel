# Check completion evidence before delivery

Use [approved requirement fidelity](requirement-fidelity.md) when original
decisions must survive derived tasks and block native gates when omitted.

Passing tests is one evidence class. It does not establish that every agreed
requirement exists or that an interface is understandable. Compare the immutable
task criteria and approved supporting design with the executable result before
handoff. Keep omissions, failed reviews and later repairs as separate records.

The read-only coverage checker helps detect missing criteria, nonpassing
observations, unresolved findings, changed evidence and candidate drift. It reads
an initialized private project; it never initializes state, runs a model, modifies
the task or supplies independent acceptance.

Evidence must stay inside the task's approved read scope or its own artifact
directory. Candidate drift covers product files; canonical `.ai-org/` lifecycle
records and private `.workkeel-private/` evidence can advance after the source
commit. A successful report check does not establish that those records are valid.

```sh
node ./workkeelw.mjs task evidence-check /private/development --id WK-example --request .ai-org/artifacts/WK-example/completion.json
```

Use the exact strings from `task show` in `requirements[].criterion`. Do not
replace the agreed criteria with easier descriptions. The report has this shape:

```json
{
  "schema_version":"workkeel.completion-evidence/v1",
  "candidate_revision":"<full current Git revision>",
  "ui_mode":"code-first",
  "requirements":[{
    "criterion":"<exact approved criterion>",
    "status":"pass",
    "observation":"What was actually checked and observed",
    "evidence":[{"path":".ai-org/artifacts/WK-example/check.txt","sha256":"<exact bytes digest>","kind":"test"}]
  }],
  "self_reviews":[{
    "id":"hierarchy",
    "candidate_revision":"<same revision>",
    "observation":"Which executable states and information hierarchy were inspected",
    "evidence":[{"path":".ai-org/artifacts/WK-example/desktop.png","sha256":"<exact bytes digest>","kind":"screenshot"}]
  }],
  "open_findings":[]
}
```

UI modes are `code-first`, `preview-first`, `design-led` and `not-applicable`,
following the approved [UI delivery policy](../concepts/ui-design.md). UI work
requires at least two distinct recorded visual review rounds, each with exact
PNG evidence on the current candidate. Inspect actual scenarios: the main
decision, ordinary progress, missing/stale data, error/recovery, keyboard access,
themes and relevant desktop sizes. Include every supporting design requirement
in the authored assessment even when several belong to one task criterion.
The example intentionally shows one round; it is incomplete until the applicable
required reviews and all criteria are supplied. Do not use `not-applicable` to
avoid interface work that the scope requires.

`coverage_consistent: true` verifies the report's mapping and file provenance,
not the truth of its authored observations or visual quality. PNG recognition is
a file-format check, not proof that the screenshot came from the browser or shows
the promised behavior. The actual reviewer must inspect the evidence and challenge
the claim. The checker always reports `semantic_correctness: requires-review` and
`independent_acceptance: not-evaluated`; native handoff/review/close remain the gates.

If a required result is missing, mark it `unverified` or `fail`, record the finding
and continue authorized repair. Retest affected behavior and then run the full
candidate gate. Do not ask the owner to discover missing requirements after saying
everything is complete. Budget, scope and external-action boundaries still apply.

Keep real reports, screenshots and raw checks in the private workspace and backup.
Public source contains the framework checker, documentation and synthetic tests.
