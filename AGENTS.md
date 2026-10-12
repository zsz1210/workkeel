# Workkeel source development

This repository contains the Workkeel framework, its documentation and reproducible
tests. Use the native Workkeel lifecycle for approved development. Read WORKKEEL.md
and the approved task contract. A discussion or inspection does not authorize edits.

- Use this checkout's pinned source CLI: `node ./bin/workkeel.mjs`. Initialize local
  task state deliberately if it is absent; a clean clone contains no maintainer tasks.
- Keep all actual task records, approvals, dispatch records, execution sources and
  review evidence in ignored local state with a separate private backup. Never commit
  `.ai-org/`, `workkeel.lock`, raw execution output or machine-specific settings.
- Do not select Temple lifecycle Skills for new work. Compatibility code and fixtures
  are product support, not instructions governing this repository.
- Claim before implementation. Use approved paths and authority; record exact candidate
  verification and obtain review by an actual different Agent before acceptance.
- Use applicable Skills, read their instructions, and report their use. Use apply_patch
  for edits. Run `npm run verify:fast` for prose and `npm run verify` for behavioral
  candidates. Run native Doctor after task-state changes and browser gates for UI work.
- Follow the reviewed task-local dispatch policy when delegating. Prepare and bind
  each actual executor; never invent model usage, identity or review evidence.
- Before any public push, run the publication boundary check over all outgoing history.
  Public CI is a second check, not the first privacy boundary. Preserve LICENSE and
  third-party notices. Use explicit file staging rather than `git add .`.
- Publication, releases and remote mutations require the human's authorized scope.
  Task acceptance alone grants none of those operations.
