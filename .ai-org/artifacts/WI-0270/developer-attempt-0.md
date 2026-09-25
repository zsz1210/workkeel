# Developer handoff, attempt 0

Candidate: `2673ebe34a5c55a3a70c25e079f5fde8659723a8`.
Coordinator implementation attributed to agent-rikku.

Explicit source-map recording, durability/export opt-in, v2 portable readback and
v1 compatibility are implemented. `node --test test/field-evidence.test.mjs`
passed 12 tests. `npm run check` passed repository/documentation/package checks.
The real three-record pilot recovered five exact files and preserved the original
registry; see pilot-verification.md. A frozen-candidate full run is still executing
at this handoff; final verification must record its actual exit status.

Actual GPT-6 Sol review 0 is preserved separately. It claims --evidence is not
repeatable. The unchanged candidate has --evidence in REPEATABLE_FLAGS at line 565;
the coordinator reproduced a successful three-record CLI export twice. The same
candidate is receiving an actual independent reconsideration with that evidence.
No product edit or pass is inferred from the coordinator's disagreement.

Risks and non-goals remain the approved work order: source availability is not
authentication or acceptance, and no historical cleanup is authorized here.
