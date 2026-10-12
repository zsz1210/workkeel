# Shared delivery execution

Use for an explicitly selected delivery plan after approved Build entry, without
active workers or conflicting ownership. V1 retains low-risk bounded Lean without
UI. V2 selects autonomous execution across existing Lean/Standard/High-Assurance
contracts. Prebuild gates and native instructions remain. This is an execution
style, not a background service or a new workflow profile.

1. The coordinator records an approved repository plan with authorization_ref,
   explicit Git-visible Node test files or a v2 measurement_plan, timeout and complete buffered time/repair
   limits. A positive token ceiling additionally needs complete scoped observations;
   unknown tokens never count as available enforced capacity.
2. Run delivery open with --work-item, --agent-id, --principal-id and --request
   pointing to that plan. Read the returned contract and required routed sources.
   The AI chooses how to implement the approved result.
3. Implement, run project-required tests, commit the exact product candidate, and
   write evidence plus the finish request before delivery check. Check failures
   route authorized repair while preserving verification/repair/cleanup reserves.
4. delivery finish consumes that request and composes the existing stage handoff,
   release and transition. Do not also use work-item deliver/finish or repeat
   individual administration. Inspect mutation and diagnostics separately.
5. The coordinator continues to a distinct eligible Verifier without asking the
   human to repeat authorization. The Verifier opens Test, independently judges
   the exact candidate, records evidence/request, runs check and finishes on pass.
   A rejected review uses delivery rework, then a fresh Developer claim and
   independent revalidation. A worker never assumes the next owner's judgment.
6. delivery next/report are read-only. Reuse the durable record across conversation
   recovery. Retry an interrupted finish only with its identical request; unknown
   check/rework execution needs investigation, never a speculative replay or
   deleted pending record. Native recovery and risk floors remain.
7. Continue routine authorized work through repair and verification. Record a
   delivery pause only for a genuine missing decision, external dependency,
   authority/capacity boundary or uncertain execution. Resume requires resolution
   evidence and cannot waive the frozen authority or budget.

For v2, every finish request names the current stage and Position, exact revision,
operation_id and current edge's satisfied evidence. Developer supplies completed
facts/evidence; review supplies its actual pass judgment. Test/Eval/Independent QA
may reuse substantive evidence and an unchanged check from the same eligible Identity.
Prepare those requests before checking; no model turn per administrative stage is
required. Release Gate supplies approval and rollback through the existing closeout
validator. High-Assurance retains normalized evidence and Human Principal requirements.
Never manufacture a later owner's judgment or use earlier evidence to prefill its gate.

Select trusted-local or confined-node explicitly in v2. The latter requires the
macOS check adapter and compatible Node tests; unsupported execution has no fallback.
It confines the check process, not the parent agent. Actual provider tools still
need host enforcement. Real external actions retain separate authority and adapters.

Before choosing a command plan, inspect `measurement capabilities`. A trusted-local
measurement uses executable/argv, complete declared inputs and environment identity,
bounded execution, and declared outputs. `measurement inspect` reports reuse
eligibility; `measurement run` preserves immutable attempts. A hit did not execute
the command again and never grants acceptance. Review current-candidate applicability;
changed tests, dependencies, fixtures, toolchain or missing artifacts require a miss.
Preserve native project checks and recorded environment limitations. Windows is
reported unsupported until its required process cleanup adapter is available.

Commands use node ./templew.mjs delivery <action> . --work-item WI-#### --json.
Mutations require explicit actor/principal; open, finish, rework, observe, pause
and resume use --request for their repository input. The installed operations
guides docs/operations/daily-delivery.md (v1) and docs/operations/autonomous-delivery.md
(v2) in the framework package define the JSON contracts and limitations.
Report consumes recorded data without a model call;
missing whole-task usage stays unknown. The path neither publishes/deploys nor
claims provider prompt isolation or measured efficiency improvement.
