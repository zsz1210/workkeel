# ADR-0074: Read existing task measurements on demand

- Status: Accepted
- Date: 2026-09-24

## Decision

Offer an explicitly started foreground task monitor with no new dependency or
background collector. Read the existing integrity-checked task/workflow journal;
do not infer usage from arbitrary native sessions. Lifecycle authority, execution
state and observations remain separate. Unknown totals, backend models, prices
and percentage completion stay unknown.

The local HTTP server exposes a fixed page, module and read-only snapshot route.
Bind to loopback only; require a random in-memory capability for API data, exact
Host and same-origin requests, no CORS, no-store responses, safe text rendering
and a restrictive CSP. It cannot mutate tasks or contact a model. This is not
containment against a hostile process already running as the same local user.

The external personal LiteLLM development selector is not a runtime dependency
or a framework default. Its selected model must match the independently approved
one-step Codex policy before a measured launch. Infrastructure uncertainty stops;
a verified quality failure may get one separately bounded Sol repair. No automatic
Astra or global app-model change.

## Consequences

No macOS app maintenance, always-on daemon, duplicate telemetry store or model
call is needed to view results. Polling is point-in-time, not proof of liveness or
transactional consistency across runs. Large projects use per-task queries.
The existing legacy Console and the offline explainer keep their distinct scope.
