# Workkeel 1.0 compatibility guarantees

## Covered by SemVer

Breaking changes to the following require a new major release (2.0):

- Every core CLI command, flag and JSON output field listed in the core part of `workkeel help`.
- Task lifecycle states.
- Risk-tier and rework-cap rules.
- File formats of `workkeel.lock`, `WORKKEEL.md`, `workkeelw.mjs` and `.ai-org/` task records. A 1.x CLI reads all 1.x records; move older pins with `workkeel upgrade`, without converting records.
- `workkeel stats` and `--report` output schemas.
- The Node.js 24.15+ requirement.

## Optional parts, best effort

The workspace observatory, `workkeel monitor`, native dispatch and usage records
have best-effort compatibility. Their JSON may gain fields in minor releases.
We announce breaking changes in the CHANGELOG first.

## Experimental, no guarantee

The LangGraph workflow runner, goals and autonomy, Workkeel Loop features, review
helpers and the Bot-layer reference usage may change or be removed in a minor
release.

## Never guaranteed

Workkeel does not guarantee sandboxing, permission enforcement or model behavior;
the coding tool or host handles these. Workkeel does not guarantee recovery from
every interruption.
