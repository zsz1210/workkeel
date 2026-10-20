# Architecture Decision Records

An ADR is an Architecture Decision Record. It preserves the context, decision,
rationale, and consequences of an important technical or organizational choice
so that later Agents do not have to infer why it was made from chat memory.

Start with [ADR-0091: Foundations](0091-foundations.md). It carries forward the
principles from the Temple-era records ADR-0001 to ADR-0070, which were removed
from this tree and remain available in Git history. Those removed records
describe mechanisms that Workkeel no longer ships and are not current behavior.
[ADR-0083](0083-public-source-private-state.md) keeps its own exact wording and
governs the public and private boundary.

## Foundations and boundaries

- [ADR-0091: Foundations carried forward from the Temple-era decisions](0091-foundations.md)
- [ADR-0083: Separate public framework source from private task state](0083-public-source-private-state.md)

## Native task lifecycle

- [ADR-0090: Introduce a task contract before migrating lifecycle authority](0090-workkeel-task-contract.md)
- [ADR-0072: Task-first lifecycle without company Positions](0072-task-first-lifecycle.md)
- [ADR-0075: Daily task briefs and evidence-first observation](0075-daily-task-entry-and-observation.md)
- [ADR-0076: Explicit historical evidence artifact sources](0076-explicit-evidence-artifact-sources.md)
- [ADR-0077: Read-only first-use guidance](0077-first-use-guidance.md)
- [ADR-0079: Stage material and confirmed continuation](0079-stage-material-and-confirmed-continuation.md)
- [ADR-0086: Compact execution views and explicit completion evidence](0086-compact-execution-and-completion-evidence.md)
- [ADR-0089: Evidence-only rework and bounded process drain](0089-evidence-rework-and-process-drain.md)

## Review

- [ADR-0082: Read-only review assessment](0082-advisory-review-assessment.md)
- [ADR-0084: Role preflight and interrupted review recovery](0084-role-preflight-and-review-recovery.md)
- [ADR-0087: Coordinator-owned browser verification](0087-coordinator-owned-browser-verification.md)
- [ADR-0088: Explicit structured source-review protocol](0088-structured-source-review-protocol.md)

## Execution, dispatch and observation

- [ADR-0071: Opt-in tool-output compression with exact original readback](0071-opt-in-tool-output-compression.md)
- [ADR-0073: Opt-in workflow execution with explicit model and context policies](0073-opt-in-workflow-execution.md)
- [ADR-0081: Native dispatch and retained reading state](0081-native-dispatch-and-reading-state.md)
- [ADR-0074: Read existing task measurements on demand](0074-on-demand-task-monitor.md)
- [ADR-0078: Observer task lifecycle measurements](0078-observer-task-lifecycle-measurements.md)
- [ADR-0080: Read existing records in a local observer workspace](0080-read-only-observer-workspace.md)
- [ADR-0085: Native workspace, bounded autonomy and versioned Skill learning](0085-native-workspace-bounded-autonomy-and-skill-learning.md)

ADR-0090 was originally filed as a second `0071`; it was renumbered without
changing its decision.
