# Multi-repository federation

Temple federation lets a coordination repository observe several Temple projects without moving their lifecycle authority into a central store. Each participant remains authoritative for its own Work Items, credentials, Human Principals, evidence bodies, approvals, and release decisions. The portfolio is a bounded read-only projection.

## Authority boundary

The coordination repository owns `.ai-org/project/federation.json`. It may define cross-service Initiatives, dependencies, contract references, compatibility, and rollout waves. It does not own participant lifecycle state.

The federation module:

- reads each participant at an exact Git revision;
- requires the participant path to resolve to that Git worktree's exact top level rather than a nested directory discovered through a parent repository;
- invokes Git noninteractively with an allowlisted environment, ignores ambient Git directory, credential, object, config, and transport injection variables, and skips global and system Git configuration;
- disables external `core.fsmonitor`, repository hooks, credential helpers, replacement objects, and lazy fetching for every inspection command;
- rejects bare Work Item IDs in favor of `project_id + work_item_id + revision`;
- checks the participant's `temple.lock` and project identity;
- rejects dirty participant canonical state;
- caps projected Work Items and JSON document sizes;
- returns `unknown` for missing, stale, unreadable, invalid, identity-mismatched, or revision-mismatched participants;
- never transitions, approves, closes, releases, reserves capacity, records evidence, or writes an external system.

`overall_completion` is always `null`. A portfolio must not infer that an Initiative, contract migration, rollout, or participant has completed.

## Participant registry

The registry uses `temple.federation/v1` and contains only coordination metadata. A participant path is relative to the coordination repository. Sibling paths such as `../orders-api` are supported only when their resolved real path remains below the caller-supplied federation root and is the exact top level reported by Git. A nested directory inside a repository is not a participant root. Absolute paths, Windows-style paths, malformed paths, and symlink escapes are rejected.

```json
{
  "schema_version": "temple.federation/v1",
  "participants": [
    {
      "id": "orders-api",
      "path": "../orders-api",
      "expected_project_id": "orders-api",
      "expected_revision": "1111111111111111111111111111111111111111",
      "expected_revision_observed_at": "2026-08-30T00:00:00.000Z",
      "max_age_seconds": 86400,
      "max_work_items": 100
    }
  ],
  "initiatives": [],
  "dependencies": [],
  "contracts": [],
  "rollout_waves": [],
  "updated_at": "2026-08-30T00:00:00.000Z"
}
```

`expected_revision_observed_at` records when the coordinator pinned the participant revision. When `max_age_seconds` is present, an expired pin projects `unknown` even if the repository still has that revision checked out.

The participant `id` must equal `expected_project_id`. This binds the registry identity to the immutable project ID instead of allowing a coordinator-local alias to silently rename a participant.

## Composite and versioned coordination references

A Work Item reference is always an object:

```json
{
  "project_id": "orders-api",
  "work_item_id": "WI-0001",
  "revision": "1111111111111111111111111111111111111111"
}
```

The revision must equal the participant's registry pin. Initiatives, dependencies, API contracts, event contracts, and rollout waves also carry a coordinator-owned `version` and `revision`. A rollout wave references the exact contract `id`, `version`, and `revision`; a stale contract reference makes the registry invalid. An incompatible contract must have at least one explicit rollout wave. Waves describe ordered coordination, not an atomic multi-repository commit or a release approval.

## Bounded signals

For a current participant, the portfolio exposes only safe aggregates:

| Signal | Source | Projection |
|---|---|---|
| Status | canonical Work Items | projected count and counts by lifecycle state |
| Capacity | canonical resource registry | active resource count, total capacity units, active reserved units |
| Evidence | canonical evidence registry | entry, expiry, invalidation, and kind counts; never approval validity |
| Risk | canonical Work Item fields | counts by declared risk tier |
| Usage | generated usage-baseline view | observation count and Token total when observed |

Every signal has `authoritative: false`: the aggregate is a projection, while its linked participant repository remains authoritative. Usage additionally has `source_kind: generated-projection`; it is never promoted to canonical authority. Missing, invalid, incomplete, or truncated signal input returns `status: unknown` with a bounded reason code. Unknown values are not converted to zero.

The portfolio excludes participant paths, credentials, principals, worker identities, raw evidence titles and bodies, artifact paths, business-source bodies, prompts, provider payloads, claim bodies, approvals, and release decisions.

## CLI and integration API

Alpha.27 exposes validation and bounded portfolio generation through the project launcher:

```bash
node ./templew.mjs federation validate . --json

node ./templew.mjs portfolio build . \
  --allowed-root /absolute/organization-checkouts \
  --no-write \
  --json
```

Remove `--no-write` to write only the coordinator's generated `.ai-org/views/portfolio.json`. That exact output is registered in the schema catalog. `--allowed-root` constrains the coordinator and all participants to one explicit real filesystem boundary.

The same behavior is available as a module API:

```js
import {
  buildFederatedPortfolio,
  readFederationRegistry,
  validateFederationRegistry
} from "./src/federation.mjs";

const registry = await readFederationRegistry(projectRoot);
const validation = validateFederationRegistry(registry);
if (!validation.valid) throw new Error(validation.errors.join("\n"));

const portfolio = await buildFederatedPortfolio(projectRoot, {
  allowedRoot: organizationCheckoutRoot
});
```

The CLI prints or explicitly writes the returned projection only when requested. It does not acquire the project mutation lock or call participant lifecycle commands. The default federation root is the real parent directory of the coordination repository; operators should pass an explicit, narrowly scoped `--allowed-root`.

## Unknown diagnostics

Participant diagnostics are bounded codes rather than raw filesystem or Git errors:

- `participant_missing`, `participant_unreadable`, or `participant_invalid`;
- `unsafe_path`;
- `repository_root_mismatch`;
- `identity_mismatch`;
- `source_revision_unavailable` or `source_revision_mismatch`;
- `stale_revision_observation`;
- `canonical_state_dirty`;
- `projection_truncated`.

An unknown participant has no projected Work Items and every signal remains unknown. A coordination record resolves as `current` only when every exact composite Work Item reference is present in a current participant projection; otherwise its resolution is `unknown`.

## Current limits

This alpha implementation supports local filesystem repositories and Git revisions. The bounded local two-participant rehearsal passed current-to-unknown degradation and participant immutability checks. Inspection does not fetch repositories: a missing promisor object fails closed as an unknown participant without contacting its remote. It does not verify hosted-provider identity, perform organization-wide RBAC, write participant state, encrypt registry data, coordinate atomic commits, or prove multi-machine availability. Filesystem and Git checks reduce local authority leakage but do not provide a hardened defense against a repository being replaced during the same read. Real multi-human and multi-machine evidence remains separate enterprise qualification.
