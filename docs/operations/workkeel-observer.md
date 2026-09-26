# Workkeel observer

The observer reads a project's existing records and displays them in a local
website. Opening it, leaving it open, searching, filtering and drawing charts
make **zero model calls**. Task execution by a coding tool is separate and can consume
tokens; the observer only shows usage already recorded by that execution.

## Open

From an existing source checkout:

```sh
node bin/workkeel.mjs monitor /path/to/task-first-project
```

Open the complete loopback URL printed by the command. Keep this access link private.
The page removes the fragment after retaining access in that tab's session storage;
reloading the same tab works while the server remains running. Stop the terminal
process with Ctrl-C to revoke that server's access. No daemon is installed.

### A stable local address or an existing Work Item repository

The source-checkout entry point below retains a private access token across restarts
and supports an explicitly selected record format:

```sh
node scripts/serve-workkeel-observer.mjs /path/to/project /path/to/private-state 49618 native
```

For an existing `temple.lock` repository with `.ai-org/work-items`, replace `native`
with `work-items`. This mode shows the original Work Item stages and referenced
documents. It does not migrate records or treat a recorded stage as acceptance.
Legacy records without operation usage show unknown tokens and execution time;
elapsed calendar time includes waiting and is not a usage estimate.

The state directory holds `access-url.txt` and a private observer access token, not
a model credential. The process listens only on `127.0.0.1`. A local process manager
may keep it running; the script itself neither detaches nor installs login startup.
Stopping it disconnects the website. Retaining the state directory preserves access
on restart; revoke old access by stopping the server and removing its access-token
and URL files before restarting.

An optional fifth argument selects a JSON file of additional Skill directories:

```json
[
  {"path": "/absolute/path/to/personal-skills", "origin": "user", "label": "Personal skills"},
  {"path": "/absolute/path/to/plugin/skills", "origin": "third-party", "label": "Plugin skills"}
]
```

Each source contributes only immediate `<skill-name>/SKILL.md` files. Select the
directories explicitly at launch. The website cannot add sources or browse
arbitrary files. Missing sources are reported while available sources remain visible.

## Pages

| Page | Contents |
| --- | --- |
| Dashboard | Current workload, required action, recent results, known usage and observation coverage |
| Task board | Last seven days, at most ten cards per column, with a discoverable unfinished-history entry |
| Usage analysis | Paired time/token bars, task scatter and daily/weekly trends; shared filters |
| Activity | Recorded execution lanes over 24 hours or seven days; paged events on demand; gaps stay unknown |
| Backlog | Searchable task/document history, 50 rows per page; retained pre-migration history is a separate view |
| Learning & skills | Project learning, compact milestones, bundled/project/configured Skills and content search |
| Settings | Language/timezone display preferences and read-only project/runtime policy explanations |
| How Workkeel works | Task flow, component responsibilities and the optional learning path |

Task details separate the requested model from the runtime/provider model reports.
A task can contain several tools, models and operations. Reasoning settings preserve
the provider's name/value; requested effort is not reported effort. No cost estimates
or inferred savings are displayed.

## Reading metrics

Task execution time is the union of recorded dispatch/end intervals. Overlap counts
once; unknown/open intervals are not extended to the current time. Usage analysis
separately sums recorded adapter durations, including setup, tools and cleanup.
Phase residence includes waiting and downtime. None is human effort or pure model
compute time. This distinction also appears in contextual help beside each heading.

Tokens combine recorded input and output. An asterisk marks a partial subtotal;
unknown is never zero. An operation's final result replaces its cumulative progress
report. Filters apply at operation level. Scatter points aggregate the selected
operations per task; a diamond marks a task whose full record includes multiple
reported models. Unavailable tasks and corrupt journals cannot establish complete
project totals. No population-wide model ranking follows from these charts.

Dates use the browser's system timezone by default; the header shows its name and
current UTC offset. Settings can select another IANA timezone. The preference stays
in this browser and changes activity dates, detail timestamps, date filters and
trends together. Durations and token totals do not change. The last 7/30 days include
today in that timezone; they are calendar dates, not rolling 24-hour intervals.
Trends use operation start dates in the selected timezone; weekly buckets start on
Monday. Cross-day operations are not split by guessing. Unrecorded days are not
filled with zero.
Native coding sessions and other tools have no automatic usage until their host
records it. Task categories use the existing sample classification (real task,
paired experiment, fixture or unclassified); feature/bug/documentation types are
not inferred from task titles.

## Sources and privacy

The observer reads the selected task format, referenced Markdown/text evidence,
execution journals, project learning records, bundled/project Skills and explicitly
configured personal or plugin Skill directories. It does not
scan user-wide credentials or model settings. Document bodies are requested on open;
Skill/learning content is indexed locally for search. Documents remain at the opened
version while reading; an update notice lets you choose when to reload.

Skill origin is an exact bundled-source match, a declared/configured third-party
source, or a project/personal location with unrecorded authorship. Installation
location is not author proof. Source and project availability are separate fields:
a bundled or personal Skill is not necessarily installed in this project. Identical
bundled copies in the project appear once; different versions remain distinguishable.
Native Workkeel setup/delivery Skills are available separately. Skills tied to the
retired lifecycle are hidden by default and explicitly labelled as compatibility
material; their source identifiers and historical content are preserved.
Task contract selection is shown separately from reading/application/verification;
the current native task records do not store a unified application receipt, so those
fields remain unrecorded. Running a Skill audit is not itself a persisted receipt.

Learning stages are conditional milestones, not percentages of time. Existing
learning/proposal records can confirm capture through approval. A Skill proposal
approval authorizes authoring; it does not create or enable a Skill. The observer
does not claim that automatic promotion or the later completion records exist.

## Local overhead and limits

A rebuildable bounded memory index watches file changes. Dependencies recorded by
the safe reader invalidate affected task projections; new observations invalidate
their task, while shared policy changes invalidate all dependent projections.
Fresh source reconciliation clears task caches every 30 seconds. The browser checks
an authenticated change endpoint every two seconds while visible; unchanged checks
reuse the index and perform no source reads. Hidden pages pause. Watch delivery is
not transactional, so the header exposes last check, last source validation and last
data change separately. Direct task/detail and document requests revalidate sources.
Derived library indexes remain keyed by content digests, at most 256 entries.
Semantic revisions ignore heartbeat/read timestamps while retaining real usage and
source changes. The browser patches retained nodes, preserving task tabs, open and
closed disclosures, focus, selection and scroll. Library source changes still
invalidate content. Open documents retain their text and offer a reload action.
Authenticated diagnostics at `/api/diagnostics` show local read counts, bytes, elapsed
time, response size and cache hits. No model performs these calculations.

The workspace index supports up to 2,000 native tasks and 50,000 operations.
Task and operation APIs use revision/filter-bound cursors, 50 rows by default and
100 maximum. Charts aggregate before capping display to 20 bars, 100 points and 180
buckets, with coverage and visible limits. The compatibility full-snapshot API
retains its 200-task bound. Explicit Work Item mode allows 1000 records
and an 8 MiB event journal; its timeline shows at most 200 recent events per task,
without claiming complete phase timing. Up to 64 configured Skill sources are
allowed. Combined Skill inventories and learning inventories are each capped at
256 entries; readable document bodies at 256 KiB and API responses at 4 MiB. Limits
fail visibly instead of silently calling a model or reading arbitrary files.

The framework is model/provider-neutral. Native hosts can use cloud or local models.
Automatic workflow execution still needs an actual adapter; see the current
[runtime support boundary](workkeel-workflows.md#choose-how-to-run). The website
neither installs an adapter nor claims a connection is tested because it can display
its recorded name.

## Private access over Tailscale

The native website can also use an owner-only Tailscale Serve route. It remains
read-only and makes no model calls. The local URL keeps its existing capability
requirement. The private viewer checks the exact tailnet hostname and the
configured owner's `Tailscale-User-Login` header before serving either the page
or an API. Other users, missing identities and tagged-device requests are denied.

The current integration was validated with the already-installed Tailscale CLI
`1.98.8`. No package is installed or vendored; the open-source client is BSD-3-Clause
licensed. Hosted account terms remain separate. See
[ADR-0035](../adr/0035-private-read-only-dashboard.md#native-observer-extension)
and the [official Serve identity documentation](https://tailscale.com/docs/features/tailscale-serve).

For the existing source-checkout service, an optional owner-readable-only regular
file `tailnet-observer.json` in its private state directory selects `hostname`,
`allowedLogin` and a separate loopback `port`. Use the exact existing DNS name and
owner Login from local Tailscale status, not an inferred account name. The HTTP
backend retains its private access capability; it never publishes that capability
to the remote browser. The UI's private-mode marker is not an API authorization.

After reviewing the private config and restarting the owned observer, inspect
`tailscale serve status --json`. Proceed only when it is empty or already exactly
matches this observer. Start the existing loopback proxy with
`tailscale serve --bg --https=443 http://127.0.0.1:49619` and verify the returned
hostname, target and that Funnel is disabled. Do not overwrite unrelated routes,
change ACLs, or enable Funnel. This setup uses the user's existing signed-in
tailnet; if HTTPS setup needs account consent, leave that separate step unresolved.

Serve with `--bg` survives Tailscale restarts. The observer process must also be
running; this option does not itself install login startup. Tailscale access rules
still apply. Identity headers are trusted only on loopback and do not isolate
this service from other processes already running on the same Mac.

Rollback removes only the verified observer route using
`tailscale serve --https=443 off`. Remove its private config and restart the owned
observer to stop the separate listener. Do not reset unrelated Serve routes or
delete task records.
