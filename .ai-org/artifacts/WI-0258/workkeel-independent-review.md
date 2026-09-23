# WI-0258 — Independent review of the first lifecycle candidate

- Decision: **REJECT — return to Developer for same-scope rework**.
- Exact rejected behavioral candidate: `3dfb3094716b207cfc0c33a411ee7c506ba7dccf`.
- Reviewed checkout HEAD: `7629db85859d9b042ddf2c645a5f6a45ad8c02fc`.
- Review recorded: 2026-09-23 10:46 UTC; Node.js v24.7.0, local macOS.
- Reviewer: `agent-lulu`, Principal `human`, actual runtime
  `/root/workkeel_lifecycle_review`, worker `worker-20260923103738-489eacc0`.
- Developer: `agent-rikku`, a different actual Agent. This is distinct-Agent
  Standard review under the same Human Principal, not independent-human validation.
- Scope: the approved Workkeel lifecycle design and the three WI-0258 acceptance
  criteria. No product code, existing tests, runner or package scripts were edited.

## Blocking finding M1 — real legacy initialization cannot migrate

The normal Temple initializer installs `.ai-org/work-items/README.md`. Migration
preview rejects every non-JSON entry in that directory at
`src/workkeel-project.mjs:104`. Consequently even a newly initialized, idle,
attributed Solo project fails the advertised explicit migration path with:

```text
Unexpected entry in legacy Work Item store
```

This is a shipped framework file, not unknown user data. The real initialized
README is 245 bytes and matches `project-overlay/.ai-org/work-items/README.md`
exactly, SHA-256
`63a3b4e9cb96862b2841fc53111437aa90a9ea239295ebfc9f2d11c2706c995a`.

The same assumption appears in `listTaskItems` at `src/workkeel-tasks.mjs:73`:
it throws `Unexpected file in task store` for any non-JSON file. This second
observation is source-reviewed, not an independently reached post-migration
runtime result: preview stopped before apply. Fixing only preview would leave
the required byte-preserved README incompatible with status/doctor.

The committed migration test fabricates a partial legacy store containing only
JSON Work Items, so its passing result does not exercise actual initialization
output. Retain the unknown-file/symlink guard, account consistently for the
confirmed normal explanatory file, preserve its bytes in migration history, and
add a regression using the real init path through apply, status and doctor.

## Fresh independent checks

The retained scratch executable is `../wi0258-independent-checks.mjs` relative to
this checkout. It creates synthetic local projects outside the product checkout
using the repository's example identities solely as test data. Run from the
parent `work` directory with `node --test wi0258-independent-checks.mjs`.

1. Real legacy CLI dry-run and initialization: exit 0. The freshly generated
   pinned launcher then completed legacy Doctor and read-only Status, both exit 0.
   `workkeel migration preview` exited 1 with finding M1. Apply and the subsequent
   Workkeel Doctor were therefore not reached. Fixture retained at sibling
   `../wi0258-fixture-R9rEVj`; no history was deleted or manually repaired.
2. Independent native lifecycle: pass. A `distinct-principal` contract rejected
   another Agent under the same Principal, and rejected an arbitrary untracked
   `.ai-org/artifacts/WK-audit/runtime.json`. After moving only that scratch
   artifact out of the synthetic project, the registered different-Principal
   reviewer could pass it. Exact request JSON was accepted as metadata; the task
   closed with five history entries and Doctor valid. Fixture retained at sibling
   `../wi0258-fixture-gDTCBc`.

The two independent checks returned exit 1 overall: 1 pass, 1 fail, no skips;
observed total 2936.268416 ms. The real migration case took 1870.746542 ms and
the native lifecycle case took 936.415875 ms. These are local observations only.

Fresh existing focused tests passed, 21 cases total with no failures/skips:

- `test/workkeel-lifecycle.test.mjs` plus `test/workkeel-runtime.test.mjs`:
  13 cases, observed 7673.03075 ms.
- `test/task-contract.test.mjs`: 8 cases, observed 1013.264708 ms.

Source review and focused regressions cover contract/identity completeness,
approval and evidence digests, stale operation versions, exact claims and
candidates, separation, same-contract rework, scope roots, symlink/traversal
inputs, arbitrary artifact code, tracked artifact drift, accepted dependency
evidence and candidate ancestry. The earlier three support findings are addressed
in this candidate; M1 is an additional independent integration failure.

## Compatible Developer measurement, not independent acceptance

The candidate-to-HEAD diff contains only the Developer evidence and its raw full
log. Product sources, tests, docs, package metadata and scripts have no diff from
the exact behavioral candidate in this checkout. The complete Developer
`npm run verify` result is therefore compatible and was not rerun: exit 0,
130 test files, observed `real 361.98`, `user 1755.37`, `sys 750.98` seconds.
Raw log: `.ai-org/artifacts/WI-0258/workkeel-verify-3dfb3094.log`, SHA-256
`7a40f3f46ad4e7ec1cf67fcc3bc501e29d2c5f2bfd485c87d6e532b7585df8a1`.
The dot reporter establishes the file count, not an independently observed case
total. Passing this measurement does not override the fresh failed migration.

## Evaluation and next owner

The native local task lifecycle and offline runtime planning satisfy the checks
performed. The advertised legacy migration fails an actual generated project,
so Test cannot pass and Eval/Independent QA/Release Gate are not advanced.
The reviewer will finish the worker and invoke the supported same-scope rework
operation, which preserves this finding and retires the rejected attempt.
Developer must claim again, produce a corrected exact candidate with fresh
attempt-specific evidence, and repeat the required complete verification and
independent review. No task closure is authorized by this rejection.

Read-only native/gateway plans do not start or resume a runtime. Automatic
task-first launch, live LiteLLM/Responses tool compatibility, credentials, routing,
multi-machine coordination, remote publication and deployment were not tested or
performed. Host boundary enforcement and attributed identity remain explicit
limitations. Existing historical WI-0258 evidence was preserved.
