# ADR-0061: Exact-text mechanical completion

Status: accepted for bounded opt-in implementation; not published.

## Decision

Permit one explicitly preapproved literal replacement in one project-owned,
non-normative plain-text note to complete low-risk bounded Solo Lean Build without
a fresh Verifier. This is deterministic mechanical completion, not Independent QA
or a general small-task bypass. Existing Lean completion retains a distinct
Verifier; Standard and High-Assurance remain unchanged.

Require an optional project-owned versioned policy and a versioned task contract
in the exact claimed base commit. Both must remain byte-identical. The contract
must be cited by approved scope and acceptance criteria, identify the Work Item,
human principal, file, original file hash and unique before/after literal. Only
explicitly allowlisted regular non-executable `docs/notes/*.txt` files qualify.
Authority-indexed, managed, linked, unknown or additional changes fail closed.
The CLI proves the exact committed transformation and preserves its evidence.

An explicit finish option selects this procedure; no generic workflow edge, new
profile, Position, Agent Identity substitution, shell check, arbitrary checker or
silent promotion is added. Existing recoverable journaling and diagnostics apply.
All other work retains the ordinary route. No model effectiveness claim follows.

## Trust, compatibility and migration

Repository approval records are the same trust boundary as other project-owned
scope records, not cryptographic proof of a human. An Agent must not invent them
from its own judgment. The policy owner classifies the note as non-normative; the
checker cannot prove that no program or person depends on arbitrary prose.

Existing installations are disabled by absence of the policy. Initialization and
upgrade do not create or activate it, alter existing Work Items or replace native
instructions. Contracts are strictly versioned and checked at invocation; unknown
fields/versions reject. Existing Work Item outcome fields and finish receipts carry
the explicit classification; no canonical schema migration is required. Old CLIs
reject the new option and must not be used to continue its pending transaction.

Rollback removes opt-in use and returns future work to ordinary verification.
Finish or explicitly investigate pending operations before changing the CLI;
preserve completed receipts and history. This framework change itself requires
Standard verification and distinct Independent QA.
