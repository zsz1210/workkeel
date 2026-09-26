# Repository instructions

This repository builds and self-hosts Workkeel using the native task lifecycle:
intake -> build -> test -> release_gate -> done. Cancellation and rework are
explicit operations. New work has no organization or Position workflow.

## Current entrypoint

Read the whole WORKKEEL.md and the approved native task contract. Use this
checkout's pinned launcher without downloading a package:

```sh
WORKKEEL_CLI_PATH=./bin/workkeel.mjs node ./workkeelw.mjs status .
WORKKEEL_CLI_PATH=./bin/workkeel.mjs node ./workkeelw.mjs doctor .
```

Use the same prefix for task, intake, context and workflow commands. Follow
docs/operations/workkeel-daily-work.md for the brief, claim, handoff, independent
review and acceptance. This public checkout retains the previously published
legacy history and uses a separately initialized native project. Its publication
boundary is recorded in .ai-org/artifacts/public-source/README.md. Private task
records and execution sources are retained in the maintainer's local checkout.

## History and authority

- TEMPLE.md, temple.lock, templew.mjs and the Temple lifecycle Skills are retained
  compatibility/history material, not instructions for current repository work.
  Do not select temple-work or temple-init to manage new tasks.
- Work Items listed in workkeel.lock's legacy_manifest are immutable, read-only
  history. Pending legacy review remains pending; migration never accepts it.
  Continue approved outstanding work in a separately approved native task.
- Never hand-edit canonical tasks, forge review identity or turn a test result
  into acceptance. A distinct registered Agent performs review.
- Use the actual user's scope and authority. A design discussion does not start
  implementation. Plans, generated documents and service liveness grant nothing.
- Keep model/provider choice with the execution host. The observer reads existing
  records without model calls. Do not infer permission for new model runs,
  credentials, external messages, publication, or account/global setting changes.
- For newly approved delegated work, include the reviewed project dispatch policy
  in the task's pinned data policy refs. Follow docs/operations/workkeel-native-dispatch.md:
  plan nonconflicting scopes, prepare a dispatch ticket before spawning, pass its
  model/reasoning explicitly to the host, then bind the exact child turn and report
  activity. Never silently inherit the coordinator's model. Record an explicit
  host capability limitation when the requested model cannot be selected.
  This repository's current approved policy is docs/policies/development-dispatch.json
  (bounded work: Luna medium; conservative/review: Sol medium; up to three workers).
  This is repository development configuration, not a framework-wide provider default.
- The main conversation keeps the user's chosen model. Execution IDs are generated;
  nicknames are optional. Existing registered actor IDs remain accountability keys.
- Files and exact evidence are canonical. Never rewrite historical schema IDs,
  evidence digests or old timestamps as a branding change.
- Retain framework-managed, project-owned and generated boundaries. Exact legacy
  managed-file entries describe compatibility files, not arbitrary allowed roots.

## Implementation and verification

- Use apply_patch for edits.
- Follow docs/getting-started/testing.md. Run verify:fast for prose-only changes
  and npm run verify once on the final behavioral candidate. Run native Doctor
  after canonical state changes. Browser gates apply to UI implementation;
  respect the user's direction to defer repeated layout checks during discussion.
- Read relevant Skills and only their required references. Follow the Skill
  authoring/design and engineering-learning guides when changing those systems.
- Follow docs/concepts/ui-design.md and ADR-0016 for UI contracts. No design
  vendor is mandatory. Follow the tracker coordination guide before integrations.
- Do not vendor or activate optional integrations without their required ADR,
  pinned version, license review and tests.
- Legacy compatibility remains tested in isolated fixtures. Its Position and
  organization policy is not the native project workflow.

<!-- workkeel:begin -->
Read [WORKKEEL.md](WORKKEEL.md) for this project's task and verification workflow. Before acting, match the task to the available Skills, read the applicable Skill instructions, and report what was applied and verified. Read only task-relevant material; do not load the whole catalog.
<!-- workkeel:end -->
