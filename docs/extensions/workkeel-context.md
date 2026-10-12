# Project context, Skills and Headroom

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
  "expected":[".agents/skills/project-documentation/SKILL.md"],
  "selected":[".agents/skills/project-documentation/SKILL.md"],
  "records":[{
    "skill":".agents/skills/project-documentation/SKILL.md",
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

## Plan Headroom before execution

Choose `headroom.mode` in the immutable workflow policy:

- `off`: preserve the original tool output.
- `lossless`: attempt compression only for eligible derived JSON/log output,
  verify preservation, and use the original when checks or minimum savings fail.

The existing adapter keeps the exact source snapshot and its SHA-256 for readback.
It protects instruction files, task authority, approval/policy references and
original evidence. This is a derived tool-output view, not a whole-prompt rewrite.
Lossy compression is not offered by the native Workkeel interface.

An embedded host that owns its tool pipeline uses `context.toolView(request)` to
apply the planned policy. The concrete Codex subscription adapter cannot intercept
Codex's built-in tool results and therefore rejects `lossless`; use `off` there.
Do not count standalone compression as automatic Codex token savings.

For an explicit standalone view, save a request such as:

```json
{
  "input":"logs/build.json", "kind":"json", "mode":"lossless",
  "snapshot":".ai-org/artifacts/WK-build/headroom/build.original.json",
  "python_env":"WORKKEEL_HEADROOM_PYTHON"
}
```

```sh
workkeel headroom view . --request tool-view.json
workkeel headroom read . --request original-read.json
```

`original-read.json` contains `input` (the returned original path, repository-relative)
and its `sha256`. The named environment variable identifies an explicitly installed
Python executable; Workkeel installs nothing. `off` needs no Python packages.
See the [Headroom adapter reference](headroom-adapter.md) for pinned versions,
eligibility, preservation checks and measurements. Always report originals,
compressed views and actual runtime token usage separately.
