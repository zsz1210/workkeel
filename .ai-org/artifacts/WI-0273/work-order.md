# Codex Skill catalogue and sandbox alignment

The maintainer approved the daily adoption follow-up with GO on 2026-09-25:
fix unreadable automatic Skill routing, retain required reading and permissions,
verify with bounded real turns, then ordinary PR integration and runtime sync.

## Approved scope and acceptance

Filter automatic host Skill metadata to regular, physically in-project files,
excluding private execution state. Preserve project Skills and inherited disabled
entries. Use process-local CLI overrides only; never edit user settings, copy
external Skill bodies, read credentials, install dependencies or expand permissions.
Explicit contract Skills and applicable instruction references remain mandatory;
missing required material must still block work, never become an implicit waiver.

Require a fresh skills/list check before starting a thread/model turn. Malformed
catalogues, discovery errors or newly enabled inaccessible Skills fail closed.
Retain all existing contract, model, authorization, approval and sandbox checks.
Regression tests cover inside/outside paths, prefix confusion, symlinks, missing
files, execution-state exclusion, inherited disables and changed catalogues.

## Design and risk

Installed alpha.16.3 reports skip_host_skill_discovery=true yet lists 49 enabled
external Skills. A model-free process override using folder paths leaves all 49
enabled; exact SKILL.md paths disables all 49. Use exact returned file paths and
verify effective enabled flags, rather than trusting an accepted config value.
Only Skill metadata is queried; there is no need to read unrelated Skill bodies.
The local host already requires project-root reads. A physical file/path check
and exclusion of .ai-org/execution align its automatic catalogue with that scope.
No security boundary is widened, durable schema changed or external integration
added; ordinary Standard workflow applies, with actual distinct independent QA.
Discovery is a point-in-time check, not a filesystem transaction; later required
reference failures remain attention under the unchanged runtime contract.

## Verification and stop

Focused offline regressions, complete npm run verify on the frozen behavioral
candidate, and one independent GPT-6 Sol medium candidate review. Bounded live
qualification: at most two diagnostic task turns, each at most 180 seconds,
with a readable named project Skill and a real report task resembling the prior
daily pilot. Preserve every attempt, actual model, tokens and outcome. A failed
case may receive one scoped repair/review; no model-quality population claim or
subscription cost inference. Stop after normal merge and canonical runtime sync;
no new scenario study, observer feature, package release or Gateway work.

Root implements as agent-rikku; a distinct actual review runtime supplies
agent-lulu's judgment. Roles are attributed, not provider authentication. Rollback
reverts the product commit while retaining diagnostics and historical failed runs.
