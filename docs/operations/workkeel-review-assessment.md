# Advisory review assessment

Use this read-only report to focus a native task's independent review and inspect
measurement coverage. It does not accept work, run tests, launch a model, change
policy, or certify that a lifecycle command will succeed. Existing required
suites and distinct review still apply. See [ADR-0082](../adr/0082-advisory-review-assessment.md)
and the [native task guide](../getting-started/workkeel.md).

For fresh authorized Node checks, the optional source-only
[check evidence adapter](#original-check-evidence) captures original execution
dimensions and converts explicit retained attempts into this assessor's input.
It separately attributes criterion statements to a current pinned distinct review;
it does not change this assessor's authority or establish semantic coverage.

## Start with the repository facts

In an initialized native project with a claimed or delivered task:

```bash
node ./workkeelw.mjs task assess . --id WK-example
```

The command emits JSON and writes nothing. A successfully produced advisory
report exits zero even when `route` is `blocked`; automation must inspect the
report. Invalid input or an unsupported project/record version is an error.
The report checks current authority, evidence bytes, accepted dependencies,
actual candidate paths/object IDs/modes and current product drift. It reuses the
existing candidate inspector, including its administrative-file rules.

All native project-root and candidate Git reads use a bounded child environment
that suppresses fsmonitor/hooks, external diff/textconv, optional index writes,
replacement objects and lazy network fetches. Caller Git environment variables
and system/global configuration are not inherited. Local or included clean/process
filters and indexed submodules fail closed before diff inspection: disabling
content conversion could otherwise change the meaning of clean product bytes.
An unresolved configuration blocks assessment; no Git setting is changed.

Without optional facts, irreversible impact remains unknown and the route is
`blocked`. This is an explicit missing fact, not evidence that the change is
dangerous. No Markdown extension or small diff establishes harmless semantics.
Missing measurement coverage is reported separately from route selection; a
focused route is not a readiness verdict.

The default candidate is the delivered revision, or current HEAD before delivery.
Before handoff it must equal HEAD. After delivery, an identical-tree HEAD does not
invalidate assessment of the original delivered revision. Explicitly selecting a
different revision cannot transfer that delivery or its acceptance evidence.

## Optional approved impact statement

Native v1 has no irreversible-impact field. For an affirmative routing suggestion,
an approving Principal can include this exact document in a task's approval or
data-policy references **before task creation**, so the normal task writer pins it:

```json
{
  "schema_version": "workkeel.review-impact/v1",
  "task_id": "WK-example",
  "approved_by": "owner",
  "irreversible_impact": "none"
}
```

Permitted impact values are `none`, `material` and `unknown`. The Principal must
match the task's approved authority and current project approvers. This is an
attributed declaration, not authenticated proof that a human participated. Do not
edit an existing pinned approval to add it: that creates authority drift. Existing
tasks without the statement can still obtain the conservative blocked report.

The optional request is strictly versioned:

```json
{
  "schema_version": "workkeel.review-assessment-input/v1",
  "impact_ref": "approval.json"
}
```

```bash
node ./workkeelw.mjs task assess . --id WK-example --request assessment.json
```

Request paths are repository-relative regular UTF-8 JSON files, at most 1 MiB,
with no traversal or symlink components. A new untracked request in the product
tree is still product drift. Use a request already present in the candidate or
recorded as exact task evidence; the assessor does not invent a new exemption.
For inline read-only requests, use the API below instead of creating a file.

## Complete API example: inspect incomplete evidence

Run this from the Workkeel source checkout using Node.js 24 or later. The target is
an existing native project, with a delivered `WK-example` task and `approval.json`
already pinned as above. Its approved criterion is `Value equals two`. The four
named evidence files must already exist in its candidate or exact task evidence.
Replace those paths and the criterion with the actual task's evidence. The example
reads files; it does not execute the declared command or create project artifacts.

```bash
node --input-type=module - /absolute/path/to/project <<'JS'
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assessNativeTask } from './src/workkeel-review-assessment.mjs';
const target = process.argv[2];
const pin = async ref => ({ path: ref, sha256: createHash('sha256')
  .update(await fs.readFile(path.join(target, ref))).digest('hex') });
const request = { schema_version: 'workkeel.review-assessment-input/v1',
  impact_ref: 'approval.json' };
const initial = await assessNativeTask(target, 'WK-example', request);
const current = {
  tests: [await pin('checks/test.mjs')],
  oracles: [await pin('checks/oracle.json')],
  inputs: [await pin('checks/input.json')],
  runtime: [{ name: 'node', version: process.versions.node }],
  tools: [{ name: 'node-test-runner', version: process.versions.node }],
  packages: [], command: 'node --test checks/test.mjs', configuration: []
};
request.current = current;
request.measurements = [{
  id: 'check-1',
  dimensions: { ...initial.repository_observed.dimensions, ...current },
  coverage: [{ criterion: 'Value equals two', extent: 'complete' }],
  status: 'unknown',
  provenance: {
    kind: 'unknown', source: 'unverified retained command output',
    actor: { agent_id: 'builder', principal_id: 'owner' },
    files: [await pin('capture.log')], completed: false, exit_code: null
  }
}];
console.log(JSON.stringify(await assessNativeTask(target, 'WK-example', request), null, 2));
JS
```

This example deliberately returns an ineligible measurement: reading a log and
copying current dimensions cannot establish its historical execution environment.
For a real complete capture, load measurement dimensions, status and provenance
from its original retained execution record. Otherwise retain `unknown`
provenance or omit the measurement. Never rewrite a historical measurement's
candidate to make it match the current task.

## Interpret the result

`repository_observed` contains canonical hashes, dependency snapshot and Git
observations. `declarations` contains the approved impact statement and caller
environment claims. The assessor compares declared measurement dimensions to
observed candidate/contract/policy/dependency hashes, checks referenced file bytes,
and compares the declared current test/oracle/input/runtime/tool/package/command/
configuration dimensions. Matching declarations are not independently verified
runtime facts.

Each measurement requires all dimension fields, a unique ID, exact approved
criteria, status and execution provenance. Arrays have at most 64 entries and
unique paths or names. Runtime and tools require explicit version entries;
packages and configuration may be empty only when the caller asserts none are
relevant. Current and measured versions such as `unknown`, `latest`, `*` or
`unresolved` do not qualify, including case and surrounding-whitespace variants.
Original version declarations remain visible. Coverage extent is `complete` or
`partial`; status is `pass`, `fail`, `incomplete` or `unknown`; provenance kind is
`captured`, `asserted` or `unknown`.
Capture files must retain their exact bytes, with a registered source actor,
completed execution and exit code zero for a reuse candidate. Commands are data.

`candidate-for-independent-confirmation` means a complete, matching successful
capture was declared. The reviewer must still confirm its provenance, scope,
environment completeness and relevance, then make their own judgment. The
assessor does not parse arbitrary logs into trusted verdicts. A current candidate's
failed measurement or failed independent review blocks the route and invalidates
green reuse candidates. Incomplete or stale measurements remain ineligible; they
never become a pass. Each measurement retains its declared dimensions, candidate
revision and `current` or `historical` candidate status. Criterion
`failed_measurements` contains current-candidate failures;
`historical_failed_measurements` retains older failures without labeling current
green coverage as failed. Optional `blockers` records further declared unresolved
defects. The assessor cannot detect undisclosed failures.

Routes are `blocked`, `established-assurance` or `focused-independent-review`.
The current task/project separation floor is always included. Mechanical owner
acceptance remains unsupported in v1. No result authorizes execution or release.

The API bounds dependency traversal to 128 visits and depth 32, changed paths to
256, observed files to 1024, and its own Git reads to 1 MiB/10 seconds per child.
Individual evidence readers retain the existing 1 MiB bound. The shared native
candidate/project readers allow 4 MiB/10 seconds per Git child. Read inputs and
candidate diagnostics are checked again at the end; this is not a transaction or a distributed lock. A
subsequent lifecycle action must always perform its own fresh checks.

## Original check evidence

The optional source-checkout adapter joins the existing Node check recorder to
the [read-only assessor](workkeel-review-assessment.md). It retains original
execution context and keeps author coverage separate from a reviewer's criterion
statement. It does not execute a second test engine, accept a task, relax review,
or establish that a requirement was tested merely because a command passed.
The bounded design deliberately stays source-only, with no core lifecycle or
assessor schema change. Existing execution and review guards retain authority.

`scripts/workkeel-check-evidence.mjs` and the delivery script are source utilities,
not npm package exports. Use an existing source checkout on a POSIX host with
Node 24 or later. No model, new dependency, external service or provider is used.
The approved native task must already have a current build claim. Its environment
must allow Node, root execution, the selected input reads and both reads and writes
under its task artifact directory. The host still enforces those boundaries.

### Capture a fresh authorized check

Commit the candidate first. This example runs the exact selected tests through
the existing recorder; it is an execution operation, not an inspection command.
The criterion text must exactly match an approved criterion on `WK-example`:

```sh
node /path/to/workkeel/scripts/workkeel-delivery.mjs capture-check /absolute/project - <<'JSON'
{
  "schema_version": "workkeel.capture-check/v1",
  "task_id": "WK-example",
  "actor": {"agent_id": "builder", "principal_id": "owner"},
  "expected_version": 2,
  "name": "candidate-check",
  "inventory": {
    "tests": ["test/example.test.mjs"],
    "oracles": ["docs/acceptance.md"],
    "inputs": ["src/example.mjs"],
    "configuration": ["package-lock.json"],
    "packages": [{"name": "example-dependency", "version": "1.2.3"}],
    "environment": ["NODE_ENV", "WK_CHECK_MODE"]
  },
  "coverage": [{"criterion": "Reject negative quantities", "extent": "complete"}]
}
JSON
```

Use actual relevant files and package versions, not the example inventory. Tests,
oracles and inputs are nonempty. Configuration and packages may be explicit empty
arrays when none are declared relevant. The union has at most 32 files, including
at most 16 tests. Packages are author declarations, not resolved dependency
closure. Pin relevant lockfiles as configuration and include other input files
deliberately. The adapter observes byte digests, the running Node version and
executable path; it does not hash the executable or inventory installed tools.

The response returns byte pins for two exclusive new files:

- `.ai-org/artifacts/WK-example/candidate-check.log`: original recorder output.
- `.ai-org/artifacts/WK-example/candidate-check.json`: versioned bundle containing
  the raw receipt, original before/after repository dimensions, input pins,
  runtime observation, launch environment fingerprints and attributed coverage.

Capture returns nonzero for red, invalidated or incomplete results. Preserve them
alongside green attempts and use a new name for an authorized retry. The bundle
is first reserved with `state: "capturing"` and no receipt/completion, then completed
through that same file handle. A process interrupted in between can leave that
incomplete reservation or an unreadable partial file; neither is usable proof.
Recoverable capture failures retain an incomplete bundle and any captured log.
An existing name is never replaced. A changed reserved file is rejected.

The snapshot retains original authority and candidate problems. Product drift or
changing input/authority invalidates reuse even when the command exits zero.
New exact evidence files are still ordinary `unlisted-report` findings until
handoff. Include **both exact log and bundle paths for every retained attempt** in
the existing native handoff evidence. The adapter does not exempt artifact roots
or perform that handoff. If interruption left a log without a pin, inspect and
register the exact file as incomplete evidence, not as a successful capture.

### Select environment inputs deliberately

Only `TZ`, `LANG`, `LC_ALL`, `NODE_ENV`, `CI`, `NODE_OPTIONS`, `NODE_PATH`,
`NODE_TEST_CONTEXT` and names beginning `WK_CHECK_` are selectable, up to 16 names.
Names containing credential markers such as `SECRET`, `TOKEN`, `PASSWORD`,
`CREDENTIAL`, `COOKIE`, `AUTHORIZATION`, `PRIVATE` or `KEY` are rejected.
Do not use a permitted name for a secret: hashing is not secret protection.

The bundle stores name, presence and SHA-256 only, never a selected raw value.
Unset and empty are different. Values are bounded to 4 KiB. The launch observation
uses the exact environment copy passed to the existing supervisor, after removing
`NODE_OPTIONS`, `NODE_PATH` and `NODE_TEST_CONTEXT`; those selected entries are
therefore absent. Node can introduce its own test-runner variables afterward.
Other ambient variables remain inherited by the existing recorder and **unknown
to this inventory**. Equal fingerprints cannot establish complete environment
equivalence or detect a transient change between observations.

### Assess explicit retained attempts without executing

Save the returned bundle pins. Supply them unchanged in a request such as this,
replacing the placeholder digest with the actual 64-character returned SHA-256:

```json
{
  "schema_version": "workkeel.assess-checks/v1",
  "task_id": "WK-example",
  "inventory": {
    "tests": ["test/example.test.mjs"],
    "oracles": ["docs/acceptance.md"],
    "inputs": ["src/example.mjs"],
    "configuration": ["package-lock.json"],
    "packages": [{"name": "example-dependency", "version": "1.2.3"}],
    "environment": ["NODE_ENV", "WK_CHECK_MODE"]
  },
  "attempts": [{"path": ".ai-org/artifacts/WK-example/candidate-check.json", "sha256": "RETURNED_BUNDLE_SHA256"}],
  "impact_ref": "docs/approved-impact.json"
}
```

```sh
node /path/to/workkeel/scripts/workkeel-delivery.mjs assess-checks /absolute/project /outside/project/assessment-request.json
```

The optional impact document must already be a pinned task authority reference,
as explained in the assessor guide. Omitting it preserves the unknown-impact
blocker. Requests may also come from standard input with `-`; the CLI accepts at
most 64 KiB and rejects malformed input. A successfully emitted assessment exits
zero even if its route is blocked. Check `assessment.route`, attempt issues and
measurement eligibility. The operation writes no project files or lifecycle data.

Assessment accepts at most 24 distinct pinned bundles. Missing, changed, malformed,
cross-task and legacy raw receipts remain unresolved attempts. Legacy receipts
have no original context and require a fresh authorized capture; today's context
is never retrofitted. Incomplete current attempts block reuse. Recorded red remains
visible even with mismatching environment. Historical red keeps its original
candidate and is reported separately after a real repair and fresh capture.

`attempt_inventory: "caller-listed-only"` is deliberate: selecting only green
bundles cannot prove that omitted failures do not exist. Pins preserve local byte
integrity, not provenance authenticity. A fabricated internally consistent bundle
is not cryptographically distinguishable from real capture by this adapter.

### Attribute a criterion statement to an actual review

Coverage in a capture is always the author's exact-criterion declaration, bound
to the original contract digest. For separate reviewer attribution, the actual
distinct registered reviewer can create this versioned document and supply its
path, plus each supporting evidence path, to the **existing native review**:

```json
{
  "schema_version": "workkeel.criterion-confirmation/v1",
  "task_id": "WK-example",
  "candidate_revision": "EXACT_DELIVERED_COMMIT",
  "contract_sha256": "EXACT_CONTRACT_SHA256",
  "reviewer": {"agent_id": "reviewer", "principal_id": "owner"},
  "criteria": [{
    "criterion": "Reject negative quantities",
    "status": "contradicted",
    "evidence": [{"path": ".ai-org/artifacts/WK-example/reviewer-check.log", "sha256": "SUPPORT_BYTES_SHA256"}]
  }]
}
```

Use real immutable commit/digest values and actual review findings. Add the
document's byte pin as optional `confirmation` in the assessment request. It is
usable only when that document and its support are pinned in the current native
review, matching the exact task, candidate, contract and reviewer separation.
An author cannot manufacture review authority by supplying a different name in
this document. Review identity records themselves remain local attribution, not
provider authentication or proof of independent thought.

Each criterion is reported as `confirmed`, `partial`, `contradicted` or `unknown`.
Missing or invalid binding leaves unknown. A valid negative or partial finding
stays visible when red or a failed independent review blocks the main route.
`confirmation_binding` explains whether the statement is bound to the current
pinned distinct review. Changed or unavailable authority, candidate or review
evidence withholds the statement, including drift already present when assessment
begins. Plain failed tests still retain correctly bound negative findings.
Before/after rechecks are not atomic.

Confirmation never upgrades the assessor route or changes measurement coverage
into acceptance. Required suites, distinct judgment and the existing authorized
closeout remain separate operations. This adapter measures no throughput, cost
savings, defect-rate improvement or framework-wide review benefit.
