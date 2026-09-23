# Workkeel repository rename observation

On 2026-09-23, after test-slimming PR #116 merged at
`5ea9b9690afb1a444a50e0e06a5115a510a4b0ca`, the owner-authorized rename changed
`zsz1210/temple-ai-dev-org` to `zsz1210/workkeel`.

Read-only preflight confirmed the effective owner `zsz1210`, admin permission,
no open PRs, `has_pages: false`, and no repository at the new exact name.
The existing repository was patched in place, not replaced.

- Repository ID remains `1350310959`; node ID `R_kgDOUHwcLw`.
- Canonical URL: https://github.com/zsz1210/workkeel
- About: A repository-native task coordination framework for coding agents.
- Topics: agent-workflows, coding-agents, developer-tools, local-first,
  task-coordination.
- The old repository API address resolves to the same ID and new full name.
- Shared checkout/worktree origin now points to the new HTTPS Git URL; no local
  directory was moved or renamed.
- `git ls-remote` through the new origin still reports the accepted exact main
  `5ea9b9690afb1a444a50e0e06a5115a510a4b0ca`.
- Private vulnerability reporting remains enabled. Existing reporting email and
  subject prefixes were retained. No branch-protection change was made.

No npm publication, release tag, deployment, global installation, credentials,
model service or Trusted Publisher configuration was changed. Main source still
awaits the Workkeel pull request; the rename itself is not code integration.
