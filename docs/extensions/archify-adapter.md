# Archify adapter

Archify is an optional isolated third-party adapter. Temple remains fully usable when it is absent.

## Pinned contract

- Repository: `tt-a1i/archify`
- Tag: `v2.16.0`
- Commit: `c826e6c3a7abad19c0f3cd1ca57207d54b1ad8de`
- License: MIT
- Reviewed downstream patch: `fast-uri-3.1.7-security-override`

The installer performs no network request. First obtain that exact Git checkout through an authorized process, then provide its local path:

```bash
node ./templew.mjs adapter archify-status .
node ./templew.mjs adapter archify-install . --source /absolute/path/to/archify-checkout --json
node ./templew.mjs adapter archify-status . --json
node ./templew.mjs doctor .
```

The source must resolve to the pinned commit, have no modified, untracked, or ignored content under `LICENSE` or `archify/`, and contain the expected license, Skill, CLI, and schema entrypoints. Installation copies only the licensed Archify distribution into `.ai-org/adapters/archify/v2.16.0/`. It then applies one deterministic data-only patch that changes the upstream `fast-uri` override and matching lock entry from `3.1.5` to `3.1.7`. Every expected original value must match or installation stops. Temple runs no package manager and executes no Archify source during this step.

The installed manifest keeps the exact clean upstream revision and ordered downstream patch descriptor separate, then records every resulting file digest. The adapter never modifies Work Items, Assignments, evidence gates, or approval state.

`archify-status` returns `not_installed`, `installed`, or `invalid`. Absence is a safe optional state. Missing or unrecorded files, symbolic links, provenance drift, or a digest mismatch makes the adapter unusable and causes `doctor` to fail until the project repairs or deliberately removes the invalid installation.

Installing the adapter does not execute Archify, generate architecture truth, contact a network, or authorize any external action. Generated visuals remain projections of selected canonical sources.
