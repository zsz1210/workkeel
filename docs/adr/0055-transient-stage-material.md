# ADR-0055: Acquire transient stage material through an opt-in read-only command

Status: Accepted for bounded compatibility implementation.

## Decision

Add `context packet --work-item WI-ID --position position --no-write --json` as an opt-in acquisition operation for current low-risk bounded Lean Build/Test without UI work. Keep `context resolve` and its capsule/compact formats unchanged. The packet does not implement start, finish, policy reduction or automated execution.

Reuse compact resolution for current scope, candidate, owner, warnings and deterministic routing. Select whole mandatory entry documents and the applicable delivery/recovery reference, recorded gate and latest handoff sources, repository specifications, selected context routes and validated learning. Include the authority snapshot's source bodies conservatively in this first version. Capability discovery suggestions remain on-demand references unless a path is independently required. No LLM summary, inferred exemption, custom arbitrary path, section truncation or new retrieval service is introduced.

Every selected local source is emitted once with path, selection reasons, UTF-8 body, byte size and hash. Content is data with source provenance; it is not an instruction to override higher-priority rules. Reject unsafe paths, `.git`, symlinks, non-regular/non-UTF-8 files and oversized inputs. A source is bounded at 256 KiB and the total at 1 MiB. Missing or unsupported external/normalized evidence references, drift, missing acceptance, wrong owner, pending delivery and resolver warnings produce explicit incomplete/fallback responses. Do not drop a restriction to fit the bound.

Bind the acquisition to the repository identity, Work Item/current route, source manifest and authority snapshot. Re-resolve and remeasure after acquisition. An expected packet digest can reject a stale preview, but this is still a read-only observation rather than a mutation token. Callers must revalidate at the time of any later mutation; there is no claim of an atomic filesystem snapshot or protection from a hostile concurrently writing process.

`acquisition=complete` means the selected set was acquired and checked, not complete semantic coverage of nested references, proof that an Agent read it, authorization, evidence acceptance or workflow readiness. Required sources referenced inside prose still apply. The packet states this boundary and retains original warnings. Incomplete packets emit no source bodies and return a failing command status. Bodies are emitted only on stdout for a successful explicit acquisition, never persisted to generated views, canonical state, telemetry or events by Temple. Caller/provider retention remains separate; this command adds no external transmission.

This extends ADR-0047/0054 with an explicitly separate transient acquisition format. Their prohibition on body storage and their navigation-only authority remain. AGENTS.md, TEMPLE.md, provider-native entrypoints, bootstrap and all existing mandatory-read obligations are unchanged. No automatic workflow/profile or model change occurs.

## Verification and limits

Test installed CLI option validation, no-write behavior, source provenance/deduplication, stage-specific material, unsafe/missing/non-text/oversized sources, stale expected digests, incomplete warnings and existing Context compatibility. Exercise a full cold acquisition without assuming previous source loading. Run full local verification and distinct-Identity QA.

Measure source and response bytes as acquisition evidence only. Conservative authority inclusion can make packets large; this slice makes no Token, latency or net-efficiency claim. Entry reduction and composed completion remain separate unimplemented slices. Revert this additive command/docs to roll back without changing any sealed experiment.
