# Workkeel 1.0 compatibility guarantees

## Covered by SemVer

Breaking changes to the following require a new major release (2.0):

- Every core CLI command, flag and JSON output field listed in the core part of `workkeel help`.
- Task lifecycle states.
- Risk-tier and rework-cap rules.
- File formats of `workkeel.lock`, `WORKKEEL.md`, `workkeelw.mjs` and `.ai-org/` task records. A 1.x CLI reads all 1.x records; move older pins with `workkeel upgrade`, without converting records.
- `workkeel stats` and `--report` output schemas.
- `stats --report` reads 0.1.0-beta.1 task records for statistics only. Other commands keep the version check.
- The Node.js 24.15+ requirement.

## Optional parts, best effort

Native dispatch and usage records have best-effort compatibility. Their JSON may gain fields in minor releases.
We announce breaking changes in the CHANGELOG first.

## Experimental, no guarantee

Goals and autonomy, Workkeel Loop features, review helpers and the Bot-layer
reference usage may change or be removed in a minor release.

## Removed in 2.0.0

Workkeel 2.0.0 removes `workkeel monitor`, `workkeel workspace`, `workkeel workflow`
and `workkeel headroom`. Each removed command exits with status 1 and prints a
`command-removed` error that names the replacement. Execution policies still
accept the `headroom` key, so existing policy files stay valid.

## Never guaranteed

Workkeel does not guarantee sandboxing, permission enforcement or model behavior;
the coding tool or host handles these. Workkeel does not guarantee recovery from
every interruption.
