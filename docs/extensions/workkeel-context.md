# Project context and Skills

Context engineering means choosing the instructions and evidence a task actually
needs. Workkeel keeps those sources in the repository and binds important
references to the approved task. It does not require a catalogue telling a coding
model how to perform general reasoning or programming.

## Connect native instructions

Initialization creates `WORKKEEL.md` and preserves existing instructions. Preview
the additive bridge before applying it:

```sh
workkeel instructions preview .
workkeel instructions apply . --fingerprint <reviewed-fingerprint>
```

The preview binds the exact current bytes. Apply refuses drift and preserves text
outside its managed blocks. `AGENTS.md` directs the agent to read `WORKKEEL.md`;
`CLAUDE.md` imports `@WORKKEEL.md` and points to native project instructions.
Conflicting existing Workkeel markers require a human-reviewed merge, not overwrite.

Use these bridges with existing coding agents, including Codex and Claude Code.
Claude versions differ in direct `AGENTS.md` support, so the explicit `CLAUDE.md`
bridge is the portable entrypoint. Confirm loaded instructions in your installed
runtime. File existence does not prove loading or compliance. This is native
onboarding, not a shipped automatic Claude workflow adapter. See Claude's
[official memory documentation](https://code.claude.com/docs/en/memory).

The qualified Codex subscription host disables ambient instruction/Skill discovery
to keep host configuration controlled. Its explicit runtime instruction instead
requires reading the project entrypoints, applicable nested instructions, selected
Skills and required references before task work. This is a prompt obligation, not
a deterministic compliance gate; inspect actual Skill evidence and output.

## Select, read, apply, verify

At each meaningful task boundary:

1. Match explicit Skill requests and relevant descriptions to the actual task.
2. Read the complete selected Skill and its required routed references.
3. Apply its procedure within the approved scope.
4. Check the resulting artifact or behavior, not just the reading record.

For a README, select the documentation Skill because the task is documentation,
even if the user never says its name. For a backend fix, do not load image or
presentation Skills just because they are installed. Re-evaluate when the task
changes. This is a bounded matching step, not unconditional whole-catalog reading.

Projects can review selection records using `workkeel skills audit . --request
skill-use.json`. Example request:

```json
{
  "expected":[".agents/skills/readme-writing/SKILL.md"],
  "selected":[".agents/skills/readme-writing/SKILL.md"],
  "records":[{
    "skill":".agents/skills/readme-writing/SKILL.md",
    "read_complete":true,
    "application_evidence":[".ai-org/artifacts/WK-docs/documentation-review.md"],
    "verification_evidence":[".ai-org/artifacts/WK-docs/link-and-render-check.md"]
  }]
}
```

The reviewer supplies `expected` after checking triggers. The audit detects missing
or unexpected selections, unavailable files and absent reading/application/check
records. `records_complete: true` still returns `quality_verified: false`:
self-reported reading and nonempty files cannot prove a good README or correct code.
Review actual output. The audit does not install Skills or modify files.

## Headroom removed

Workkeel 2.0.0 removed the Headroom tool-output view and `workkeel headroom`.
Workkeel no longer compresses tool output. Execution policies still accept
`headroom.mode` (`off` or `lossless`) for compatibility. The value has no
compression effect.

