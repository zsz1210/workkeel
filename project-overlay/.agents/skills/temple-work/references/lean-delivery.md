# Lean Developer delivery

Use only for authorized low-risk bounded Lean Developer Build with `ui_delivery_mode=not-applicable`, a current active Developer claim, committed exact candidate, existing evidence and no active runtime worker. Other profiles and interface work keep individual handoff/release/transition operations. Never downgrade work to qualify.

Run the pinned CLI from the project root:

```text
node ./templew.mjs work-item deliver . --work-item WI-#### --operation-id <stable-attempt-id> --claim-id <current-claim-id> --agent-id <developer-id> --principal-id <principal-id> --revision <full-candidate-sha> --completed <description> --evidence <repository-path-or-evidence-id> --json
```

Repeat `--completed`, `--evidence` or `--unresolved` when needed. Use a stable operation ID for this exact attempt. Default execution validates and applies under the local mutation lock. Optional `--dry-run` previews without writing; `--expected-plan <digest>` binds application to that preview. A changed plan requires rereading the relevant changes, not silently discarding its digest.

The same validators govern handoff, release and transition. This operation does not run tests, claim Test, verify acceptance or release externally. The Quality Evaluator must perform the next responsibility. `already_applied` describes a historical operation, not current stage or fresh verification.

An interruption may leave a local recovery journal. Resume only the identical request after inspecting the error, receipt and current state; the CLI revalidates inputs and applies missing writes. Different facts need a new operation ID only after the previous operation is settled. If inputs or outputs drifted, preserve the journal and investigate. Never delete it or fall back to individual mutations to evade recovery.

Read [Assurance and recovery](assurance-and-recovery.md) on failure.
