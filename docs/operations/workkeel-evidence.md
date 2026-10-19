# Completion evidence and retained media

This guide collects the evidence checks that run before delivery: requirement coverage, per-repair iteration records, a short preflight gate before long tests, and media retention with an availability inventory. None of these tools grant lifecycle acceptance; native handoff, review and close remain the gates.

## Check completion evidence before delivery

Use [approved requirement fidelity](workkeel-daily-work.md#preserve-approved-requirements) when original
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

## Iteration evidence, preflight and media retention

Use the existing `task observe` command to add optional `delivery_progress` and
`iteration` fields to a normal attributed observation. Read the observation envelope
in [daily work](workkeel-daily-work.md). These fields preserve source revision,
actor and pinned evidence. They never grant lifecycle or artistic acceptance.
There is no new model, service or automatic game work.

### Distinct completion measures

`delivery_progress` contains `total` (1–10,000), `produced`,
`functionally_verified`, `quality_accepted`, and `quality_authority`.
Each stage has `{count, evidence_ref}`. Unknown is `count:null`; a measured zero
still needs evidence. Count distinct catalog items, never raw test assertions.
Positive quality acceptance requires the named authority and its evidence.
Known later-stage counts cannot exceed earlier-stage counts. Do not fill a
missing count from the task's state or a passing functional test.

The task-detail card shows each count, evidence revision and whether it matches
the delivered candidate. Before delivery it is explicitly labeled not delivered.
Changed or missing pinned evidence hides the old projection. Help uses the existing
popover. Attribution is not authentication of the person named as authority.

### Keep each repair comparable

`iteration` requires `id`, `issue_id`, `hypothesis`, `change`,
`conditions_sha256`, `baseline_ref`, `result_ref`, `resolution`, `failure_kind`,
and `metrics`. IDs are stable and unique per task. A replay is idempotent;
changing an existing round is rejected. Pin text/JSON reports which identify the
camera, device, viewport, build and retained media, not large media itself.

Resolution is `unresolved`, `improved` or `resolved`. Failure kind is `product`,
`environment`, `none` or `unknown`. Metrics are `ai_active_ms`, `input_tokens`,
`output_tokens`, `generated_bytes`, `retained_bytes`: nonnegative integers or null.
Only use real measured active intervals; exclude human waits and pauses. Tokens
remain null without an actual report. Generated and retained bytes describe the
declared inventory, not total machine storage.

The three-round window counts the first three `real-task` iterations in the latest
explicit `comparison_group`, not fixtures or ungrouped records. It
reports missing rounds and metric coverage separately. A grouping label alone
does not establish a controlled experiment. Use one previously approved change
per round and keep conditions fixed; stop after three observations to compare.
Do not create new game work to fill an empty measurement window.

### Short gate before long work

Source checkout command:

```sh
node scripts/workkeel-iteration.mjs check PROJECT REQUEST.json
node scripts/workkeel-iteration.mjs run PROJECT REQUEST.json
```

The request has `task_id`, current `claim_id`, exact `expected_revision`,
`issue:{issue_id,hypothesis,change}`, `sample:{baseline,result,approval}`,
`probe_command` and `test_command` argv arrays, and `timeout_ms` (up to one hour).
Each sample reference is `{path,sha256}`. Both sample reports use
`schema_version:"workkeel.sample/v1"`, `conditions_sha256`, `candidate_revision`
and `pass`. The baseline must fail the declared repair criterion and be a distinct
file and digest. The after sample must pass on the expected candidate, under the same
conditions. Approval uses `workkeel.sample-decision/v1`, `candidate_revision`,
`sample_sha256`, `decision:"ready"` and the task approver's `authority`.
This is explicit recorded sample approval, not automatic visual judgment.

The probe is a project-owned command, at most 30 seconds, returning JSON with
`schema_version:"workkeel.test-probe/v1"`, `revision`, `observed_at`, actual
`viewport:{width,height}`, `input_viewport:{width,height}`, visible interactive
`targets:[{x,y,width,height}]`, `required_resources:[{path,sha256}]`,
`estimated_generated_bytes`, `max_generated_bytes`, and `reserve_bytes`.
Read the actual running app's viewport and target bounds; never echo the expected
dimensions. Include every target/resource used by the intended journey.
The helper reads actual free disk space. Probe age must be at most 30 seconds.

Missing/mismatched samples, two identical unresolved repair approaches, changed
claim/authority/revision, expired probes, offscreen targets, mismatched input
coordinates, missing resources or exceeded disk budget block the long command.
Exit 1 is a failed gate, not a successful long test. `check` runs the short probe
only; `run` executes the long argv only after a passing gate. Commands must be in
the task's approved tool list; the execution host still enforces filesystem and
network boundaries. This helper is not a sandbox, scheduler or Unity plugin.
Projects must explicitly invoke this wrapper; existing test commands are not
silently intercepted.

### Media retirement with a retained receipt

The source-only `scripts/workkeel-media-retention.mjs` defaults to no action unless
given a subcommand. `plan PROJECT POLICY.json` hashes only an explicit inventory
and prints a plan. A `workkeel.media-policy/v1` has `roots`, `protected` file paths,
`retire` file paths, `replacement:{path,sha256,validation_ref}`,
`max_retained_bytes` and `reason`. Protected files, replacement and validation
cannot be retired. No age-based scanning, automatic deletion or compression runs.
Known incomplete receipts remain incomplete after interruption.

Retain a real decoder report at `validation_ref` using
`workkeel.media-validation/v1`, `status:"pass"`, `check:"full-decode"`,
`replacement_sha256` and the actual `command`. A metadata probe alone is not full
decode. This report is attributed evidence; the retention helper verifies its
pin and replacement hash, not its truth. Use a real decoder before recording it.
Protect current required originals, the latest failed reproduction and accepted
baselines explicitly. Oversized protected evidence blocks retirement; adjust the
budget or reviewed inventory without deleting required originals. Retained byte
counts cover this inventory only.

Only after explicit deletion authorization, use
`retire PROJECT PLAN.json PLAN_SHA256 Evidence/NEW-RECEIPT.jsonl`.
The exact preview is revalidated; changed data or symlinks stop retirement.
The exclusively created receipt records intent, successful retirement and final
counts, with durable writes. Keep it and compact reports permanently. Interrupted
retirement may have removed some files: inspect its intents and do not blindly
replay. Completed receipts can be read by the
[availability helper](workkeel-evidence.md#evidence-availability) with format
`workkeel-retirement-jsonl/v1`. A retirement receipt explains absence; it cannot
replay deleted evidence or certify visual quality.

## Evidence availability

Large movies and frame sequences are not required to retain usage counters,
task history or small test reports. Keep the original reports, candidate revision,
media manifest with size and SHA-256, and any authorized retirement receipt.
Keep the latest required capture and comparison baselines according to the
project's retention policy. This document does not authorize deleting any file.

A prior passing test remains a recorded historical result after media removal.
Its visual evidence may no longer be replayable. A checksum identifies expected
bytes; it cannot reconstruct deleted bytes or prove current availability.
Missing media does not prove that a test failed, that an Agent spent zero time,
or that a task should be accepted. Current visual acceptance may require a new
capture if the necessary original cannot be retrieved.

The optional source-checkout helper produces a read-only inventory:

```sh
node scripts/workkeel-evidence-availability.mjs /absolute/project /private/request.json
```

```json
{
  "files": [
    {"path":"Evidence/latest.mp4","bytes":123,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
    {"path":"Evidence/older.mp4","archive_path":"Evidence/archive.zip"}
  ],
  "retirement_journals":[
    {"path":"Evidence/cleanup.jsonl","format":"slime-retirement-jsonl/v1"}
  ]
}
```

File paths are explicit repository-relative references. The helper reads no
media bodies, follows no symlink and changes no project file. The caller chooses
the inventory; this is not a completeness claim about all project evidence.
It distinguishes present files, size mismatch, recorded retirement, unexplained
absence, unsafe/unavailable paths and uninspected archive leads. SHA-256 values
are declared metadata, not newly verified hashes. A present file is not a
successful replay or content-integrity check.

The optional Slime adapter validates bounded JSONL receipts with an authorization
header, unique retire rows, a final completion row and matching file/byte totals.
The header records the earlier operator's statement; it grants no authority here.
Incomplete or conflicting receipts cannot explain a missing file. Availability is
checked separately, so a recreated file is present even when an old receipt exists.

Keep these three questions separate in reports: what the test reported, whether
its original media is currently accessible, and whether the current candidate
has been accepted. The tool does not mutate any of those historical decisions.
Historical claim-proof errors in usage are a separate issue; see
[dispatch retained claim evidence](workkeel-native-dispatch.md#retained-claim-evidence).
