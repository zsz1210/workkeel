# Usage observation

Temple can organize and deliver work without observing Token usage. Usage observation is an optional, clone-local operating mode for people who want per-Work-Item analysis. The [Management Console](management-console.md) is a separate optional process: collection does not require a browser, and viewing does not start collection.

## Choose a mode

| Mode | What runs | When to use it | New detailed Token data |
| --- | --- | --- | --- |
| Off | No Codex Provider | The framework is being evaluated, the machine should run no background service, or task-level analytics are unnecessary | Not collected; missing values remain unknown |
| On demand | A foreground Usage Collector with the Codex Provider and no HTTP listener | Bounded analysis sessions, development, and troubleshooting | Collected only while the process is running and an eligible registered task emits usage |
| Managed local | An explicitly installed macOS LaunchAgent running only the Usage Collector | An advanced experiment after the team has shown that continuous local capture changes a useful decision | Expected while the service is healthy and tasks are registered |

The selected mode is local operator state. It is not committed to Git, installed by `temple init`, or imposed on other contributors.

## What is retained

Detailed provider observations are stored below the clone's Git common directory by default. Stopping the Collector or Codex Provider does not delete earlier observations. Removing a managed service also leaves telemetry intact.

Temple retains numeric usage and proven attribution fields. It does not retain raw prompts, responses, hidden reasoning, credentials, or raw provider payloads for this feature.

The boundary is important:

- a registered Work Item and Codex task do not contain their Token amount;
- Git does not transport clone-local telemetry;
- work performed while detailed observation was unavailable cannot later be reconstructed at Work Item level;
- `account/usage/read` is account-wide and remains unallocated, so Temple does not distribute those values across projects or tasks.

The official Codex App Server provides active-thread `thread/tokenUsage/updated` notifications and a separate account usage query. It does not document a guaranteed historical replay of per-turn usage through `thread/read`. See the [Codex App Server protocol](https://developers.openai.com/codex/app-server/).

## Run on demand

From an initialized project repository:

```bash
node ./templew.mjs usage collect .
```

This process opens no HTTP listener. If a person also wants the Console, start it separately:

```bash
TEMPLE_LAN_IP="$(ipconfig getifaddr en1)"
node ./templew.mjs console start . \
  --lan-viewer-host "$TEMPLE_LAN_IP" \
  --lan-viewer-port 41741
```

The Console remains read-only on loopback and LAN. It does not acquire the Collector's writer lease, so both processes may run concurrently.

## Install managed local observation on macOS

Managed local observation is macOS-only and experimental in the current implementation. It is never installed by `temple init`. Preview the exact Collector-only plan first:

```bash
node ./templew.mjs control-plane observer-plan . \
  --json
```

Review the absolute project, Node, Codex, plist, log, and state paths. The plan must say that the Console and HTTP listener are not started. Copy the returned `plan_digest`, then install and start that exact plan:

```bash
node ./templew.mjs control-plane observer-apply . \
  --expected-plan sha256:REVIEWED_DIGEST \
  --activate
```

`observer-apply` without `--activate` installs the definition but does not call `launchctl`. Replacing a different installed plan additionally requires `--confirm-replace`. The LaunchAgent executes `temple usage collect --observation-mode managed-local` through Node and the repository launcher with an argument array; it does not invoke a shell, store credentials, or expose the Console.

Inspect current clone-local state:

```bash
node ./templew.mjs control-plane observer-status .
```

Remove only the exact installed plan:

```bash
node ./templew.mjs control-plane observer-remove . \
  --expected-plan sha256:INSTALLED_DIGEST \
  --confirm-delete
```

Removal stops the exact LaunchAgent when it was activated and deletes only the generated plist plus clone-local service manifest. Retained usage telemetry is not deleted.

## Register a Codex task

Temple Provider-owned launches register their returned thread before starting the turn. A Codex task created elsewhere remains explicit:

```bash
node ./templew.mjs task register . \
  --work-item WI-0001 \
  --position developer \
  --thread-id THREAD_ID \
  --execution-origin codex-host-owned \
  --launch-revision GIT_COMMIT
```

Registration creates correlation, not usage. The task must still be observable by the active Provider and emit a detailed Token notification.

## Read capture gaps

The Usage view separates two questions:

1. **All-time coverage:** how many completed Work Items have any correlated detailed observation?
2. **Since observation started:** which Work Items completed after the current local observation boundary but have no correlated detailed evidence?

A post-start gap may mean the task was not registered, the Provider was unavailable, or the active connection did not receive the notification. It does not by itself prove that the managed service was down. Temple lists the affected Work Item IDs and keeps backfill marked unsupported.

## Multi-machine limit

Each developer's Collector sees only tasks available to that local Codex Provider and keeps telemetry in that clone's Git common directory. One managed service is not an organization-wide collector. Cross-machine export, merging, and centralized aggregation remain future work.
