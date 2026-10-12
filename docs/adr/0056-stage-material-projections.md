# ADR-0056: Scope derived stage material without dropping governing rules

Status: Accepted for bounded compatibility implementation.

## Decision

Add opt-in `context packet --material stage`. Omitted mode or `--material full` preserves ADR-0055's full v1 response. Stage mode uses an explicit v2 response with representation, original-source and emitted-body hashes/bytes. Bind material mode and the emitted representation manifest into its digest. A full-mode digest cannot authorize or validate stage mode, and neither digest authorizes mutation.

Acquire and recheck every whole selected source through the existing safe, bounded path before projecting. Do not replace full-source freshness with a subset hash. Source permissions, provider entry instructions, missing/unsafe-source failures, required nested reads, canonical-state checks and existing lifecycle validators remain unchanged. No bodies are persisted by Temple.

Only two structured sources may be narrowed when selected solely as authority metadata, during primary/integration acquisition:

- `temple.lock/v1`: preserve every top-level field except the full managed-file array. Select exact managed entries for the declared affected paths and all selected source paths, with an explicit positive/negative lookup for every requested path. Retain boundaries and their exact-entry ownership precedence. Nonmatching allowed roots never imply managed ownership; negative lookup never implies write permission. Unlisted paths remain unassessed. Do not interpret directories or glob patterns as exact scopes.
- `temple.positions/v1`: retain complete Position records for the requested/current owner, recorded handoff participants and next workflow owner. Keep all fields including purpose, responsibilities and approval restrictions, plus the list/count of omitted Position IDs. Other Position definitions remain available in the full source when needed.

Require recognized root/record shapes, unique IDs/paths and unambiguous nonempty scope. Unknown fields/schema, unsafe or wildcard/directory-like paths, missing required records, explicit Context-route/specification/gate references to either source, and recovery purpose retain the whole file with a reason. Do not infer a narrower policy from prose. Use the whole source if the derived body would not be smaller. A partial shape match is not sufficient.

All other bodies are unchanged: AGENTS.md, TEMPLE.md, Skills and procedure references, policies, workflow, collaboration, usage, assignments, agents, specifications and evidence. This is a presentation boundary for machine-readable inventories, not an exemption from reading a required full source. No profile or verification responsibility changes.

## Validation

Compare full/stage responses on the same synthetic Build/Test snapshot. Assert original hashes, distinct emitted hashes, retained Position restrictions, exact managed-path lookup, byte-identical governing prose/policies, same acquisition problems, no writes and mode-bound freshness. Test unknown/custom fields, ambiguous scopes, outside paths, explicit full references, recovery, stale omitted entries and inherited default compatibility. Test actual CLI options and full repository/package checks; obtain distinct-Identity QA before acceptance.

Report emitted response bytes separately from full bytes read. Savings in these fixtures do not establish Token, latency, model quality or general delivery efficiency. Keep the mode opt-in and do not rerun frozen comparisons. Revert the optional mode and documentation to roll back.
