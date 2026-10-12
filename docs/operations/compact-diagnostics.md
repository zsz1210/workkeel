# Compact diagnostics

Use compact output when checking one stage's delivery without loading the entire project's successful diagnostic detail:

```sh
node ./templew.mjs status . --compact --json --work-item WI-0001
node ./templew.mjs doctor . --compact
```

Status still builds the full projection and writes full generated views. Add `--no-write` for inspection only. The selected Work Item is its complete existing Status row; global totals and every attention entry remain visible. Omit `--work-item` for totals and attention only. This observation does not validate gates or replace the canonical Work Item. Invalid IDs or flag combinations fail before writing views.

Doctor runs every check and preserves its exit status and summary. Compact output omits only successful check details. Every warning and failure remains visible, so exceptional output can still be large. Add `--json` for `temple.doctor-summary/v1`; compact Status uses `temple.status-summary/v1`. Existing full-output schemas and commands are unchanged.

A Builder finishes the assigned delivery and required checks, reports the exact candidate, handoff and remaining issues, and hands responsibility onward. Passing diagnostics does not mean the fresh verifier or whole Work Item has completed. Compact output reduces returned bytes; it does not establish lower model Tokens, faster delivery or equal quality without a new matched experiment.
