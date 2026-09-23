# WI-0259 — Independent branding review, attempt 1

- Judgment: **REWORK REQUIRED**. One documentation finding blocks WI-0259's
  requirement that task-first and legacy boundaries be accurately documented.
- Rejected candidate: `6bb9c98e25fe6056621ba4189ce0ed640e8f4438`.
- Reviewed checkout HEAD: `b760a0088c9de9c10cd8c668a3d1e1b2a41ce372`.
- Review date: 2026-09-23; local macOS; Node.js `v24.7.0`.
- Reviewer: `agent-lulu`, Principal `human`, actual separate runtime
  `/root/workkeel_brand_review`, worker `worker-20260923112426-33caa43a`.
- Developer: `agent-rikku`, parent runtime `/root`. This is distinct-Agent
  review under one Human Principal, not independent-human validation.
- Authority: WI-0259's approved branding design, acceptance criterion and exact
  Developer handoff. The current Test-stage review can reject the candidate;
  no passing Test, Eval, Independent QA or Release Gate is claimed here.

## B1 — Current task-contract guide contradicts implemented availability

`docs/concepts/task-contract.md` is linked as current conceptual guidance by all
three READMEs and the documentation index. At this candidate:

- Lines 3–6 call the implementation only a read-only boundary and explicitly say
  there is no `workkeel` executable.
- Lines 171–172 say Position-free canonical creation, claiming, delivery and
  closeout are not implemented.
- Lines 31–35 present the example against a future execution path without
  clearly separating a descriptor-validator sample from native task creation.
  Its `state: "build"` and populated `verification.implementer` cannot be passed
  unchanged to the actual create operation.

These statements conflict with `bin/workkeel.mjs`, the command dispatch in
`src/workkeel-cli.mjs`, the lifecycle in `src/workkeel-tasks.mjs`, and the current
`docs/getting-started/workkeel.md`. I ran `node bin/workkeel.mjs help` successfully;
it lists initialization and canonical task creation, claim, handoff, review,
rework and close. `createNativeTask` at lines 167–169 requires intake with no
fabricated progress, including a null implementer.

Impact: readers following the new public Workkeel entry points receive mutually
inconsistent availability and usage guidance. This directly violates WI-0259's
documentation acceptance criterion, even though the executable tests pass.

Required same-scope correction: describe the current executable lifecycle and
link the current quick start; retain the accurate read-only legacy projection
and descriptor validation explanation. Explicitly label the existing JSON as a
descriptor-validator example, not a native create payload. Preserve historical
ADRs and JSON examples unless a separately justified change is needed. A prose
correction can reuse the unchanged behavioral candidate's full measurement with
fresh documentation checks and a new exact-candidate independent judgment.

## Other bounded branding checks

No additional blocking branding defect was found in this review.

- `package.json`, `package-lock.json`, `PACKAGE_NAME`, `WORKKEEL_PACKAGE` and the
  repository constant consistently identify `@zsz1210/workkeel` /
  `zsz1210/workkeel`. Both `workkeel` and `temple` CLI aliases are present.
- Fresh `node --test test/workkeel-branding.test.mjs`: **2/2 pass**, no failures
  or skips, observed `417.66025 ms`. This checks both executable versions, new
  exact bootstrap pins, both retained old package names, and rejection of wrong
  versions, floating tags and unrelated names.
- Source comparison preserves explicit old exact-name compatibility while new
  initialization uses the new package name. The workflow assertion follows the
  package constant. The installed onboarding path derives from package metadata
  while keeping the offline installation/lock behavior and assertions.
- English, Traditional Chinese and Japanese READMEs align on unreleased source,
  task-first coordination, distinct-Agent review, host enforcement, ordinary
  migration restrictions, retained legacy mode and read-only runtime planning.
  The current quick start accurately distinguishes its complete intake example.
- Architecture and vision qualify the remaining organizational model and diagrams
  as legacy. AGENTS, contribution and governance preserve this repository's
  existing operating contract and merge/release authority.
- Security/conduct changes retain the approved legacy email and both subject
  prefixes. Release guidance explicitly keeps old archives/tags and says the
  new Trusted Publisher and first publication need separate authorization.
- No global historical-name replacement, test deletion or weakening of the
  accepted test runner was observed. Accepted main
  `5ea9b9690afb1a444a50e0e06a5115a510a4b0ca` is an ancestor of the candidate.

## Independent rename observation

Read-only GitHub API checks of both `repos/zsz1210/workkeel` and the old
`repos/zsz1210/temple-ai-dev-org` returned the same repository ID `1350310959`,
node ID `R_kgDOUHwcLw`, new name and canonical
`https://github.com/zsz1210/workkeel` URL. The new endpoint reports the recorded
task-coordination description, five expected topics and `has_pages: false`.
Local origin is `https://github.com/zsz1210/workkeel.git`. These observations
corroborate the retained rename report; no remote mutation was made by this
reviewer. They do not establish npm publication or code integration to main.

## Compatible full measurement and limits

The Developer full run remains reusable for unchanged behavior: exact candidate
`6bb9c98e25fe6056621ba4189ce0ed640e8f4438`, `npm run verify`, recorded exit 0,
131 test files, `real 335.35`, `user 1605.39`, `sys 733.67` seconds. The raw log
contains successful repository/docs/package checks, 469 package files and the
full compact test run. I independently verified SHA-256
`4a2bd1ab486491545c7685c2aa9834ed893e5fea17cda576b9dfe288c04a9f8c` for
`.ai-org/artifacts/WI-0259/workkeel-verify-6bb9c98e.log`.

The exact candidate-to-current diff is empty for source, binaries, tests,
scripts, package manifests, READMEs, docs, public policy documents and GitHub
configuration. Later commits contain evidence and administration. The full suite
was not rerun; its result is a reused Developer measurement, not a new independent
full run or an observed total test-case count.

Live gateways, automatic runtime dispatch, authenticated multi-human operation,
production use and npm publication are outside this review and remain unverified.
The earlier failed self-test, WI-0258 rejection and separate later WI-0258
acceptance are preserved; this judgment is specific to WI-0259.

## Required disposition

Complete this review worker with this report, then use the pinned CLI's supported
same-scope rework operation on the exact rejected candidate. Return ownership to
Developer with B1 retained. The Developer needs a new claim and corrected commit;
future review must preserve this negative attempt and explicitly resolve B1.
No product/docs correction, commit, push, close, merge, release or publication was
performed by this reviewer. Post-mutation Status, Doctor and fast verification
are reported separately by the reviewer runtime after the supported operation.
