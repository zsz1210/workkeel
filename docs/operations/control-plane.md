# Legacy combined control plane and Temple Workspace

The Phase 3 Control Plane combines canonical repository state, generated local telemetry, provider processes, a browser interface, and optional local command routes without giving telemetry authority over lifecycle gates. It remains available for compatibility and advanced operator workflows.

For ordinary use, keep the optional processes separate:

- start no process when Temple Core and CLI output are sufficient;
- use [`temple console start`](management-console.md) for a read-only human overview;
- use [`temple usage collect`](usage-observation.md) for explicit on-demand Token observation;
- run both separately when a human view and live collection are useful at the same time.

Starting the optional Console does not start this combined Control Plane.

## State boundary

- `.ai-org/` remains canonical project state.
- `<git-common-dir>/temple/control-plane/` is generated local state shared by linked worktrees in one clone.
- Browser snapshots and SSE frames are disposable views.

The local journal records normalized metadata and bounded summaries. It excludes raw prompts, hidden reasoning, full command output, secrets, and complete tool payloads by default. Recording a telemetry event never satisfies a gate.

## Configuration

`.ai-org/project/control-plane.json` is project-owned. The safe default:

- binds only to `127.0.0.1`;
- lets the operating system select a free port;
- retains up to 10,000 local events;
- evaluates stalled work after five minutes, with a 30-second pending period and 60-second cooldown;
- leaves token anomaly detection unknown until an explicit token budget is configured;
- leaves Agent Commands disabled until the project opts in;
- disables raw-payload capture;
- enables the repository provider.

An explicit `state_directory` or `--state-dir` may move generated telemetry outside the Git common directory. The CLI rejects a version-controlled worktree destination and broad targets such as the filesystem root, home directory, project root, or Git common directory itself.

## Combined compatibility commands

Inspect the current local snapshot without changing canonical state:

```bash
node ./templew.mjs control-plane snapshot . --json
```

Start the legacy combined local server:

```bash
node ./templew.mjs control-plane start .
```

This command acquires the telemetry writer lease and starts the repository provider. Do not use it merely to obtain a read-only browser view; use `node ./templew.mjs console start .` instead.

Expose a separate redacted read-only Temple Workspace on one exact trusted home-LAN address:

```bash
TEMPLE_LAN_IP="$(ipconfig getifaddr en1)"
node ./templew.mjs control-plane start . \
  --lan-viewer-host "$TEMPLE_LAN_IP"
```

The LAN listener defaults to port `41741`. It accepts only an RFC1918 IPv4 address and never turns the loopback mutation gateway into a network listener. See [Home-LAN private Temple Workspace](../integrations/home-lan-private-dashboard.md).

Expose only a redacted read-only Temple Workspace to an authenticated device on the same permitted Tailscale network:

```bash
node ./templew.mjs control-plane start . --tailscale-viewer
```

The listener still binds only to `127.0.0.1`. The pinned optional launcher configures Tailscale Serve as a localhost reverse proxy and prints a tailnet HTTPS URL. The private page contains no Human Inbox, Agent Commands, session secret, daemon path, raw event payload, or mutation route. See [Tailscale private Temple Workspace](../integrations/tailscale-private-dashboard.md).

Opt in to the pinned Codex App Server observer for registered task thread IDs:

```bash
node ./templew.mjs control-plane start . --codex
```

To observe Codex while also serving the home-LAN read-only viewer, enable both explicitly:

```bash
node ./templew.mjs control-plane start . \
  --codex \
  --lan-viewer-host "$TEMPLE_LAN_IP"
```

`--lan-viewer-host` alone serves repository and retained telemetry, but it does not start Codex observation. This separation prevents a network-viewing choice from silently enabling a Provider process.

The HTTP server and repository snapshot become available before optional Codex history synchronization begins. During that background synchronization, provider-dependent state remains capability-labelled as `registered-only`, `history-only`, or `unknown`; Temple Workspace does not wait for an entire conversation history before serving health and snapshot routes.

### Read Temple Workspace by question

The complete human-facing browser surface is **Temple Workspace**. It uses familiar destination names while retaining canonical IDs and technical terms in traceable detail:

- **Overview** answers what needs attention and shows only four flow metrics: active work, blocked work, live tasks, and human decisions.
- **Team** separates **Responsibilities**, **People & Agents**, and **Authority**. Responsibilities groups Positions into Product & Experience, Engineering Delivery, and Assurance & Release, showing the default Assignment and eligible-pool size without creating a reporting hierarchy. People & Agents keeps accountable Human Principals distinct from Agent Identities. Authority shows the operating profile, temporary Bootstrap Owner state, recovery readiness, Human Authority Grant count, validation ladder, and separation safeguards. `Configured` never means online.
- **Work** answers who is working on what. Its responsibility map follows `Teammate → Role → Work Item → Codex task → observed model`; only assigned, blocked, or running work appears in that map. **Open work** uses native, keyboard-operable disclosure rows: selecting a row reveals ownership, progress, task, and technical details. Work waiting for a release decision and planned work are kept in separate collapsed groups.
- **Usage** answers whether new project Token data can be captured and where the observed Tokens and models went. Its capture-health panel distinguishes active capture, a ready Provider with no live task, retained historical-only data, and capture being unavailable. It shows the last successful capture time and completed-Work-Item coverage; missing provider observations remain unknown instead of becoming zero.
- **Health** answers whether providers and control-plane conditions are healthy.
- **Activity** keeps terminal Work Items and the bounded occurrence timeline out of the operational starting view.

Temple Workspace separates update connectivity from data freshness. A connected SSE stream does not make old or failed data actionable. During normal operation, the page shows one quiet `Last updated` timestamp; it does not show a redundant current-state badge or repeat connectivity and timestamp messages around the page. A reconnecting stream or delayed refresh appears only as an exception. A delayed or failed refresh becomes a prominent warning, keeps the previous information visible, and disables every loopback mutation until current data is available again. The private viewer uses the same warning hierarchy without implying that remote actions are available.

`Team` is a bounded presentation of the organization projection from `.ai-org/project/agents.json`, `.ai-org/project/assignments.json`, `.ai-org/core/positions.json`, and `.ai-org/project/collaboration.json`. Its three primary responsibility groups are presentation metadata only; an unknown future Position remains visible under `Additional responsibilities`. Quality & Evaluation and Independent QA receive separate non-color markers so the assurance boundary remains legible. Private viewers may read this roster and governance metadata, but the projection excludes Human Principal records, sponsorships, credentials, prompts, command payloads, local Inbox state, and inferred online presence. Membership eligibility remains distinct from the active Assignment that holds a Position.

Model information in **People & Agents** is an execution overlay, not an Agent Identity property or routing rule. A live nonterminal task with an observed model is `Active`; otherwise the latest correlated task-level evidence is `Last observed`. A canonical requested model without effective evidence is labelled `Requested` and never presented as execution. Missing provider evidence remains `No model observation`. Requested and effective models stay separate when they differ, and the panel may show only bounded reasoning effort, Work Item/task provenance, and observation time. It does not expose prompts, hidden reasoning, credentials, raw provider payloads, cost claims, or automatic model decisions.

The private read-only viewer redacts Principal records, sponsorships, authority grant holders and scopes, recovery trustee IDs, and clone-local actor bindings. It retains only aggregate readiness and validation state needed to understand project health.

The public hashes are `#overview`, `#team`, `#work`, `#usage`, `#health`, and `#activity`. Existing bookmarks using `#now`, `#organization`, `#execution`, `#system`, or `#history` remain accepted and normalize to the new names. Wide screens receive a labeled sidebar and fluid content area, compact desktop and tablet widths receive an accessible icon rail, and mobile receives a Menu drawer. Temple Workspace defaults to a neutral black-and-charcoal engineering theme; restrained teal indicates selection or health, while amber, red, and blue retain their attention, failure, and assurance meanings. A user may still select the optional light theme. The preference is browser-local presentation state and never enters canonical project state or telemetry.

Current attention and Work Items are still classified internally as active, QA pending, approval pending, queued, blocked, and terminal. The primary interface presents those categories as **In progress**, **Testing**, **Waiting for release decision**, **Planned**, **Blocked**, and **Complete** or **Cancelled**. Exact state, revision, source, and freshness remain available inside **Technical details**. This presentation and progressive disclosure do not change lifecycle authority.

An unrelated refresh preserves an in-progress Agent Command instruction, selection, and focus. If the exact registered task, Work Item state, provider thread, active turn, or supported operation changes, the page keeps the draft but clears confirmation and explains which precondition must be reviewed. A stale snapshot cannot submit that draft. These client safeguards supplement the server's exact-state and idempotency checks; they do not grant command authority.

The combined timeline displays event occurrence time separately from later observation time. Repository-origin telemetry is omitted when the same canonical repository event is already present, so replay does not make an older event look newly occurred.

`--codex` performs an App Server handshake and reads each non-archived registered thread. It resumes only tasks registered as `active`, `waiting`, or `attention` whose Work Item is nonterminal. Completed tasks and tasks attached to terminal Work Items are reconciled as history without a live resume. The initial reconciliation retains the newest 20 turns and at most 200 items per registered thread by default. Equivalent snapshots reuse stable event identities; when the upstream history changes, one changing window-summary event and only new or changed history events are appended. A successful `thread/read` snapshot is not duplicated by the following resume response. A task that cannot be attached or uses an unavailable provider remains `registered-only` or `unknown`; it is never inferred to be idle or complete. The adapter pins the `codex-app-server-v2-observer-2026-08-30` protocol profile and reports the detected App Server user agent at runtime.

Projects may reduce or increase the bounded startup window without retaining raw content:

```json
{
  "id": "codex-local",
  "kind": "codex-app-server",
  "enabled": true,
  "options": {
    "resume_threads": true,
    "history_turn_limit": 20,
    "history_item_limit": 200
  }
}
```

`history_turn_limit` accepts 1–100 and `history_item_limit` accepts 1–1000. Larger values increase local startup work and journal volume; they do not grant more lifecycle authority.

### Opt in to local Agent Commands

Agent Commands are a prototype for deliberately continuing one existing registered Codex task from the loopback Temple Workspace. Starting the observer with `--codex` does not enable commands. Opt in separately in `.ai-org/project/control-plane.json`:

```json
{
  "agent_commands": {
    "enabled": true,
    "max_instruction_chars": 4000
  }
}
```

The Codex App Server provider must also be explicitly enabled and ready. A target is eligible only when all of the following are current:

- it has a registered task ID and provider thread ID;
- its registered `host_id` is `local`;
- its task status is `active`, `waiting`, or `attention`;
- its Work Item is nonterminal;
- the provider has successfully attached that exact thread.

An idle eligible target offers `new-turn`. A target with an observed active turn offers only `steer` and `interrupt`, bound to that exact turn ID. Every submission carries the expected task status, Work Item state, provider thread, active turn, an idempotency key, and an explicit confirmation. The route accepts no provider executable, shell command, model override, host, arbitrary thread ID, or new-task request.

Temple Workspace shows the complete normalized instruction only in the transient local preview. Generated command state and history retain the target identity, operation, timestamps, instruction length, and a fixed non-content omission summary. They retain no instruction prefix, suffix, content-derived digest, or provider credentials, so even one-character and short instructions cannot be recovered from history. Do not enter credentials or secrets.

The server exposes:

- `GET /` — the local live Observer and bounded Human Inbox;
- `GET /healthz` — process and journal health;
- `GET /api/v1/snapshot` — canonical Observer, live projection, stateful conditions, safe Inbox projection, provider health, and journal state;
- `GET /api/v1/events` — SSE replay and live local events.
- `GET /api/v1/inbox` — the same safe, credential-free Inbox projection;
- `POST /api/v1/inbox/runtime-permission` — answer one still-live provider permission request;
- `POST /api/v1/inbox/business-fact` — answer a live question and retain a redacted local proposal;
- `POST /api/v1/inbox/business-incorporation` — explicitly add one proposal as a canonical Work Item context reference;
- `POST /api/v1/inbox/governance-approval` — create one policy-checked approval record for the current exact revision.
- `POST /api/v1/inbox/agent-command` — submit one confirmed `new-turn`, `steer`, or `interrupt` request to an eligible existing registered task.

An SSE client may send `Last-Event-ID` or `?after=<cursor>`. A retained cursor receives only newer records. If retention has removed the requested cursor, the server sends a fresh `temple.snapshot` event before continuing with retained events.

All other mutation routes return `405`. The browser receives only a new per-process Inbox session secret; provider credentials and GitHub tokens never enter the page or snapshot. Every command POST must come from the exact loopback origin, use JSON no larger than 64 KiB, provide the session secret, and repeat the same idempotency key in its header and body.

### Private read-only viewer

The optional private viewer is a separate request class, not a remotely accessible version of the Human Inbox. Tailscale requests require one exact runtime Tailscale DNS Host and a Tailscale-injected user identity header. The backend trusts that header only because the full server remains bound to localhost. The home-LAN mode instead owns a second listener bound to one exact RFC1918 address; that listener assigns read-only authority directly and does not trust caller headers.

Private requests may use only `GET /`, `GET /healthz`, `GET /api/v1/snapshot`, and `GET /api/v1/events`. The snapshot omits `daemon`, `inbox`, and `recent_events`. The event stream sends refresh cursors rather than raw journal records. `GET /api/v1/inbox` returns `403`; every private-viewer non-GET request returns `405` before command parsing.

The full loopback Temple Workspace retains its local tools. `--tailscale-viewer` does not enable `--codex`, change `agent_commands`, mutate a tailnet policy, bind to a LAN address, or invoke Funnel. `--lan-viewer-host` does not enable `--codex`, change `agent_commands`, configure a router, start at login, or make the listener public. Both read-only transports may run concurrently.

## Human Inbox authority

The three queues look similar but cannot substitute for one another:

- **Runtime permission** answers only the original request while the Codex App Server connection and request remain live. Disconnect or request replacement makes the action stale. A provider response is not a repository approval.
- **Business fact** first answers the live question and stores a generated local proposal. Secret answers are represented only by an omission marker. A separate incorporation action checks the actor, current Work Item state, and exact revision, then writes a Markdown source, registers a project-owned Context Map route, and pins that route ID to the Work Item without changing scope, acceptance criteria, specifications, decisions, or lifecycle state.
- **Governance approval** is available only for a Work Item currently at `release_gate`. It creates `temple.approval/v1`, checks the exact candidate revision and active Human Principals, enforces the risk-derived approval count, and applies High-Assurance sponsor independence. It does not close the Work Item or perform a release.

Accepted and rejected commands are audited below the generated control-plane state directory without raw instruction or provider-error content. Repeating a completed command with the same idempotency key returns its prior result without another provider call. During the originating process, reuse with different instruction content is rejected; after restart, retained non-content metadata can reject shape changes while an equal-shape reuse returns the prior result and still never dispatches. Canonical mutations also run through the project mutation lock and their own duplicate guards.

## Agent Command delivery states

Transport acknowledgement and Agent execution are separate. Temple Workspace and the snapshot use these textual states:

- `submitted` — persisted locally before the provider request; repeat submission is disabled;
- `provider-accepted` — the provider acknowledged steering or interruption, but completion is not observed;
- `turn-started` — the provider returned the new turn ID, but completion is not observed;
- `completed`, `failed`, or `interrupted` — a later privacy-filtered provider event observed the terminal turn state;
- `provider-rejected` — the provider returned an explicit JSON-RPC rejection and Temple did not retry;
- `delivery-unknown` — the provider boundary may have been crossed, but a timeout or disconnect prevented acknowledgement.

`delivery-unknown` is intentionally not converted into a retry. Inspect the target task, refresh the eligible-target projection, and make a new deliberate decision. Reusing the same idempotency key returns the stored result without another provider call. HTTP success therefore means only that the local gateway returned a bounded result; it never means the Agent completed the instruction.

The pinned adapter maps only `new-turn` to `turn/start`, `steer` to `turn/steer`, and `interrupt` to `turn/interrupt`. It does not create tasks, select or switch models, enable remote control, cross a host boundary, or launch background work. Real-task validation requires separate authorization for a disposable eligible task; deterministic fake-provider and fake-App-Server verification does not mutate an existing Codex task.

## GitHub PR and Checks provider

Add an explicit provider to `.ai-org/project/control-plane.json`:

```json
{
  "id": "github-pr-42",
  "kind": "github",
  "enabled": true,
  "options": {
    "repository": "owner/repository",
    "pull_number": 42,
    "head_sha": "0123456789abcdef0123456789abcdef01234567",
    "work_item_id": "WI-0001",
    "token_env": "GH_TOKEN",
    "poll_interval_ms": 30000
  }
}
```

The configured SHA must be a full lowercase commit. `token_env` names an environment variable; never place the credential itself in project configuration. The provider performs only GitHub REST `GET` requests for the configured pull request and Check Runs at that exact SHA, uses ETags, reports rate-limit state, and becomes degraded instead of reading checks when the observed PR head differs. An optional `fixture_path` must remain inside the project repository and replaces network polling for deterministic tests.

After reviewing the observation, capture it explicitly:

```bash
node ./templew.mjs control-plane capture-github . \
  --provider-id github-pr-42 \
  --work-item WI-0001 \
  --revision 0123456789abcdef0123456789abcdef01234567
```

Capture rechecks the configured, observed, and locally resolvable Git commit, then appends normalized `github` evidence. It performs no GitHub write and does not populate Work Item gate evidence or transition lifecycle state.

## Live observation and alert semantics

The live view correlates only registered task thread IDs with Work Items. It retains plan steps, changed-file counts, diff statistics, token counts, lifecycle state, and request metadata. It does not retain raw prompts, hidden reasoning, commands, command output, diff bodies, or full tool arguments and results. Initial reconciliation uses a bounded `thread/read` snapshot. Only registered tasks in `active`, `waiting`, or `attention` status whose Work Item is nonterminal are resumed for live notifications. A task becomes `live` only after a non-reconciled runtime event is observed through a ready Provider. Completed tasks and tasks attached to `done` or `cancelled` Work Items remain `history-only` with `historical` provenance; archived tasks remain detached from Provider reconciliation. Failed runtime workers and failed or stale evidence remain auditable after terminal closeout, but they no longer create current attention for a `done` or `cancelled` Work Item. Terminal item state wins over a later transient delta. Canonical Work Items in `done` or `cancelled` appear in the `terminal` category rather than returning to the queued-work count.

`usage preflight` inspects this topology and any retained detailed usage without writing canonical or generated project state. The separately authorized Codex account probe is account-wide, unallocated, value-discarding, and incapable of satisfying a lifecycle or baseline gate. See [Token Efficiency and Model Routing](token-efficiency-and-model-routing.md).

Conditions use `true`, `false`, or `unknown` status and a separate `pending`, `firing`, `suppressed`, or `resolved` lifecycle. The initial set covers stalled work, orphaned work, scope conflict, stale evidence, and token-usage anomaly. Provider outages suppress dependent conclusions as `unknown`. Failing or interrupted turns create observed blocked attention without changing the canonical Work Item lifecycle.

Stale-evidence conditions are actionable only for nonterminal Work Items. Older exact-revision records remain queryable in the Evidence Registry and Observer history after closeout, but they do not page the team once `done` or `cancelled` establishes a terminal boundary.

## Provider fixtures

Deterministic provider fixtures test replay, redaction, disconnect, ordering, and future provider adapters without requiring a live external service:

```json
{
  "schema_version": "temple.provider-fixture/v1",
  "provider_id": "fixture-local",
  "observed_at": "2026-08-30T00:00:00.000Z",
  "events": [
    {
      "id": "turn-1-completed",
      "source": "urn:temple:provider:fixture:local",
      "type": "org.temple.fixture.turn.completed.v1",
      "time": "2026-08-30T00:00:00.000Z",
      "data": { "work_item_id": "WI-0001", "status": "completed" }
    }
  ]
}
```

```bash
node ./templew.mjs control-plane ingest . --fixture ./provider-fixture.json --json
```

The `source` and `id` pair is the deduplication identity. Reusing the pair with different non-redacted content is an identity collision rather than a second event.

## Recovery

Only one local daemon may write the journal for one Git common directory. A stale dead-process lease may be recovered; an active writer is never displaced.

Rebuild generated telemetry from canonical repository events while preserving the previous journal in a timestamped local archive:

```bash
node ./templew.mjs control-plane rebuild . --json
```

A rebuild restores the active canonical history projection. Provider-only transient events remain only in the archived journal and are never copied back into the active event stream or presented as canonical truth. The Usage projection may read a bounded, strict Token-only subset from eligible local archives so historical resource analysis survives rebuild. It ignores archive cursor order, deduplicates by Provider event identity, quarantines identity conflicts, skips unsafe or invalid files, and exposes only bounded coverage diagnostics. It never rewrites an archive or lets archived telemetry satisfy a lifecycle gate.

## Current capability boundary

The compatibility Control Plane includes replay-safe telemetry, the Observer,
Temple Workspace, stateful conditions, the authority-separated Human Inbox,
and optional read-only integrations. These capabilities do not grant remote
control, tracker or PR writes, model switching, merge, or deployment. The
legacy design remains scoped to projects that explicitly retain it.
