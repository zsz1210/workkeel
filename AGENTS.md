# Workkeel source development

This repository is the public Workkeel framework source: code, public documentation
and reproducible tests only. It is not a task-management or
development-evidence repository. A discussion or inspection does not authorize edits.

For approved framework development, follow docs/operations/framework-development.md.
Use a separate private development workspace outside the public source checkout.
Run the native lifecycle there and read its generated WORKKEEL.md and approved
task contract. A private workspace may hold a working copy of this same source;
it is not a second framework implementation or a publishable repository.

- Use the reviewed source CLI: `node ./bin/workkeel.mjs`. Never initialize actual
  maintainer task state in the public source checkout; initialize only the private
  workspace. Source inspection and product tests require no maintainer task state.
- Keep all actual task records, approvals, dispatch records, execution sources and
  review evidence in that private workspace with a separate private backup. Do not
  store them in the public checkout, even under an ignored path. Never publish real
  task data in commits, branches, tags, issues, PR attachments or release assets.
  Synthetic test fixtures are framework source, not an exception allowing
  sanitized copies of real development records.
- Claim before implementation. Use approved paths and authority; record exact candidate
  verification and obtain review by an actual different Agent before acceptance.
- Use applicable Skills, read their instructions, and report their use. Run
  `npm run verify:fast` for prose and `npm run verify` for behavioral candidates.
  Run native Doctor after task-state changes and browser gates for UI work.
- Never invent model usage, identity or review evidence.
- Install the pre-push hook with `npm run setup:hooks` and never bypass it. It
  refuses every push except to `workkeel/*` branches and runs the publication
  boundary check over all outgoing history. Run that check before any public push.
  Promote only reviewed framework commits into the clean public source checkout and
  run `npm run check:source-checkout` there, including after verification.
  Public CI is a second check, not the first privacy boundary. Preserve LICENSE and
  third-party notices. Use explicit file staging rather than `git add .`.
- Publication, releases and remote mutations require the human's authorized scope.
  Task acceptance alone grants none of those operations.
