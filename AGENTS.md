# Repository instructions

This repository builds Workkeel, a repository-native task coordination framework
for coding agents. It retains Temple compatibility mode and currently self-hosts
the legacy operating contract below; do not reinterpret it as a task-first project.

- Never add project-specific Agent display names to `project-overlay/`.
- Keep Position definitions separate from Agent Identity and Assignment data.
- Treat files and evidence as canonical; chat titles and conversation memory are not state.
- Preserve managed, project-owned, and generated boundaries.
- Treat only exact `temple.lock.managed_files` entries as framework-managed; allowed roots are not ownership claims.
- Never make Developer and Independent QA the same Agent Identity.
- Follow `docs/extensions/skill-authoring.md` and `docs/extensions/skill-design.md` when creating or promoting a Skill.
- Follow `docs/extensions/engineering-learning.md` when changing the learning schema, templates, promotion rules, or retrieval behavior; do not treat one Lesson as a framework-wide rule.
- Follow `docs/concepts/ui-design.md` and ADR-0016 when changing UI ownership, delivery modes, evidence, or tool policy; do not make one design vendor a core dependency.
- Follow `docs/operations/task-and-tracker-coordination.md` and ADR-0020 when changing external-tracker mapping, field ownership, observations, reconciliation, or write policy; never store credentials or infer permission to mutate an external system.
- Use `apply_patch` for edits. Follow `docs/getting-started/testing.md`: run `npm run verify:fast` for prose-only changes and `npm run verify` for behavioral candidates or releases; focused groups are editing aids, not full-verification evidence. Run Doctor after canonical organization-state changes and the browser gate for UI changes.
- Do not vendor or activate optional integrations without an ADR, pinned version, license review, and tests.

<!-- temple:instructions:start -->
# Project AI development organization instructions

Read the whole `TEMPLE.md` operating contract before governed work. Applicable
native and project instructions remain required; a compact view never waives them.
Use the repository's `node ./templew.mjs` and `$temple-work` for lifecycle, claim,
worker, handoff, closeout and task-registry mutations. Never hand-edit supported
canonical JSON or substitute an unversioned global CLI after a bootstrap mismatch.

For a known Work Item, start with:

```text
node ./templew.mjs context resolve . --work-item WI-#### --position <position> --compact --no-write --json
```

Stage and `primary` purpose default to the item; choose `--purpose integration` or
`--purpose recovery` deliberately. Follow routed scope, authority and evidence, not
every discovered Skill. Use `capability find` when the Skill is uncertain. Opt-in
Lean `context enter` may replace this preview under the Work Skill's Lean reference.

Repository files and exact evidence are canonical. Chat memory/titles, external
observations and generated views are not lifecycle authority. Context, discovery,
plans and runtime completion grant no permission and do not satisfy a gate.

Record affected paths and explicit routes with `--context-ref`, coordinate named
Work Item overlaps, then claim before writing. Sequential work needs no parallel plan.
Before governed parallel execution, follow
the Work Skill's parallel reference: prepare only a fresh safe wave, attach actual
runtimes, and join exact evidence. Informational helpers use its read-only-support reference
only when eligible and authorized. A Position change needs no new task.

Never make Developer and Independent QA the same Agent Identity. Respect the
effective workflow/risk profile, exact managed-file ownership and human authority
in `TEMPLE.md`. An inspection request is read-only. Finish only the authorized
slice; no subsequent task, experiment, merge, publication or deployment is implied.
<!-- temple:instructions:end -->
