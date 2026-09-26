# ADR-0080: Read existing records in a local observer workspace

- Status: Accepted
- Date: 2026-09-26

## Decision

Extend the existing optional task monitor with Dashboard, Task board, Usage analysis,
Activity, Backlog, Learning & skills, Settings and How Workkeel works. The observer
is a local projection, not a model agent, execution host, settings editor or lifecycle
writer. No model calls, paid services, CDN assets, credentials or background daemon
are required to view it. The frontend uses local modules, CSS and SVG charts.

The server keeps loopback binding, same-origin checks, bearer authorization, read-only
HTTP methods, a restrictive CSP and bounded responses. Document requests use opaque
IDs rebuilt from current task references and project-local learning/Skill inventories.
Paths are validated by the existing safe reader; symlinks and arbitrary paths are
rejected. Only bounded Markdown/text document bodies are exposed. Raw runtime output,
connection URLs, credential variables and unrestricted configuration are excluded.

## Data and update semantics

Snapshot requests retain fresh authority, evidence and timing validation. A visible
page polls sequentially two seconds after its previous update. Hidden pages pause.
Unchanged projections do not rebuild the page; document reading remains on the opened
version until explicit reload. Source changes are signalled. Failure hides stale task
data and labels any retained document version. A session-scoped access token supports
reloads; it is never put in requests to external sites or shared with other origins.

The library uses a bounded, content-digest-keyed cache for derived search entries.
Source bytes and paths are still checked; mtimes alone never establish validity.
This cache saves repeated parsing/index construction, not all filesystem reads.
Diagnostics report successful safe-reader calls, source bytes, request duration,
response bytes and cache hits/misses. These measurements consume no model tokens.

Time and token charts operate on operation identities, not task-state percentages.
Repeated identities are counted once. Final results supersede cumulative progress.
Incomplete journals and unknown fields retain partial/unknown semantics. Parallel
call durations can overlap and are distinct from task elapsed time. UTC start dates
determine daily/week buckets; no unrecorded day is assumed to have zero usage.

Requested model/effort comes from the pinned execution selection; reported models
remain separate. Historical records without effort reports remain unreported.
Provider-neutral native coordination includes hosts using local models. The current
built-in automatic adapter remains a separate, explicitly documented capability.

## Learning and Skills

Inventory the project Skill directory and explicit task Skill references. Exact
bundled-source matches identify Workkeel Skills; other project sources do not prove
authorship. Third-party provenance declared in a source is labelled as a declaration.
Selection is not proof of reading/application/verification. Missing evidence stays
unrecorded. No personal global Skill folders or account settings are scanned.

Learning milestones are capture, validation, adoption, approval, authoring, checking
and enablement. Existing learning/proposal records establish at most the first four.
The observer does not fabricate the remaining milestones, migrate the learning
schema, promote records, or automatically create or activate Skills.

## Verification

### 2026-09-26 accepted redesign

The approved Liquid Glass shell now uses an indexed workspace API, bounded recent
board, cursor-paged history, server-aggregated charts and execution interval lanes.
The rebuildable memory index watches dependencies and reconciles source bytes every
30 seconds. Its as-of validation timestamp remains visible; details revalidate.
This supersedes the whole-snapshot polling description above for the workspace.
Supplementary definitions use anchored popovers without changing layout. Task quick
views expand into URL-addressable full pages with browser-back and source-view state.
Native task phases remain separate from explicitly selected retained legacy history.
No database package, provider API, cost estimator or model-generated summary is added.

Use deterministic synthetic fixtures, analytical oracles, path/authentication tests,
read-only file fingerprints and the monitor browser gate. Measure local overhead
separately from model execution. Synthetic charts prove rendering/arithmetic, not
provider performance or savings. Full repository verification remains required.
