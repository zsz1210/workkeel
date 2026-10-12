# Iteration evidence, preflight and media retention

Use the existing `task observe` command to add optional `delivery_progress` and
`iteration` fields to a normal attributed observation. Read the observation envelope
in [daily work](workkeel-daily-work.md). These fields preserve source revision,
actor and pinned evidence. They never grant lifecycle or artistic acceptance.
There is no new model, service or automatic game work.

## Distinct completion measures

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

## Keep each repair comparable

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

## Short gate before long work

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

## Media retirement with a retained receipt

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
[availability helper](workkeel-evidence-availability.md) with format
`workkeel-retirement-jsonl/v1`. A retirement receipt explains absence; it cannot
replay deleted evidence or certify visual quality.
