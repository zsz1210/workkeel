# ADR-0077: Read-only first-use guidance

Status: Accepted for WI-0274, 2026-09-25

## Context

New users must connect project setup, instruction discovery and task intake across
several commands. Existing policy and brief validation already define authority;
a convenience entry must not invent identities, approval or execution permission.

## Decision

Add `workkeel start [target] [--request brief.json]`. Its JSON projection reports
the first actionable setup stage, required information, incomplete drafts and
the next CLI arguments. It writes nothing and never executes suggested commands.
Drafts deliberately contain null/empty required decisions, so they cannot be
applied as approval. Existing project identities are reported as choices only.

The entry checks Git root, legacy/native markers, the pinned native project and
the additive instruction preview. Legacy projects retain their pinned workflow.
An explicit brief is read using the existing safe reader and intake preview;
the returned fingerprint is still checked by the existing apply operation.
Malformed state is blocked, never treated as an absent project or repaired by
overwriting. Instruction integration remains an explicit preview/apply step.
Readiness means a task preview is available, not execution or acceptance.

Commands are argv arrays relative to the selected project (`.`). A caller chooses
its reviewed CLI/launcher and passes arguments without shell interpolation.
No durable canonical schema, filesystem ownership or runtime guard changes.

## Verification and limits

Cover fresh directories, nested Git paths, legacy markers, native initialization,
instruction conflicts, invalid/missing briefs, stale previews and no-write behavior.
An actual terminated child-process scenario separately qualifies existing workflow
lock recovery and evidence-backed reconciliation. A deterministic adapter measures
local effects and recovery phases without claiming model or cross-machine recovery.
