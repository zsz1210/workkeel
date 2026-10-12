# ADR-0064: Opt-in daily core delivery

Status: Accepted for compatibility implementation.

Ship a delivery CLI family for existing eligible low-risk bounded Lean Work Items.
This is an execution style, not a workflow profile or model scheduler. An approved
brief supports current prebuild gates; AI chooses implementation methods and the
host coordinator consumes the returned next action without requesting repeated
approval for routine authorized work. Native instructions and all existing risk
floors remain. No background service, provider call or external authority is added.
Unlike the isolated research worker, this general entry claims neither provider
context isolation nor the same measured efficiency.

Use product src dependencies only. Reuse canonical claims, workflow checks, finish
journal/diagnostics and same-scope rework. A CLI-owned execution record under the
Work Item artifacts pins the explicit approved plan, source hashes, checks and
budget. Work Item state remains lifecycle authority. Fixed checks bind the exact
candidate and working content; they never replace a distinct Verifier judgment.
Provide open, next, check, finish, rework, observe, pause, resume and report.
Next/report are read-only. Failed checks return repair. Failed review uses normal
rework. Identical finish requests recover via the existing journal. Unknown check
or rework execution, changed authority and conflicting claims require reconciliation.

Plans reserve total admission time, verification/repair/cleanup time and maximum
repair attempts. Optional hard token ceilings require complete scoped observations
and downstream reserves. Explicit null token ceiling allows time/attempt-bounded
operation with unknown tokens; it is not a financial limit or reset. Admission
guards cannot interrupt arbitrary host model turns. Test subprocess deadlines
and owned cleanup are enforced locally. Checks execute explicit repository Node
test files without a shell; host permissions remain the security boundary.

Automatic events record check/admin duration, phase changes and explicit pauses.
Optional usage receipts retain provenance and failed calls, deduplicated by call
ID. Reports separate observed totals, missing coverage, active/wait time and
reserved capacity. Unknown is never zero; account usage is never allocated to a
task. No model generates reports. Host/provider observations are required to measure
model turns; unobserved outer coordination remains unknown.

Validate real install/CLI, clean/failed/residual/timed-out checks, stale candidates,
distinct identities, rework, recovery, duplicate/conflicting usage, budget guards,
read-only reports and the full suite. After distinct review, use a real eligible
self-hosted task. Managed instructions, including the self-host Work Skill, update
only through normal CLI upgrade under the maintainer's approved integration scope.
