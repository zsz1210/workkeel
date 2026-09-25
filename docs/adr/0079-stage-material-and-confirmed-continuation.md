# ADR-0079: Stage material and confirmed continuation

Status: accepted for bounded implementation, unreleased.

## Decision

Provide shared task-first preparation for initial, repair, takeover, review, rereview and reconsideration. Required contract references remain mandatory. Explicit materials are selected by work type; selected file content is hashed and safe-read, with purposes and expansion references. Whole specifications are never automatically truncated. Stage-specific instructions come from structured scope, not independent conflicting templates. Prepared inputs render through workflow v1's existing string input and are revalidated before dispatch. Legacy free-text remains supported without a prepared-material guarantee.

Keep model completion separate from acceptance, and point reconsideration separate from whole-candidate review. Retain full effective authority at the runtime boundary. Consolidate optional instructional repetition, not enforcement.

Confirmed interrupted operations may produce a read-only continuation plan bound to original run, operation, contract, partial sources and cleanup evidence. Execute only under current task authorization and claim, with a durable single successor binding and pre-dispatch revalidation. Preserve original journals; do not replay an interrupted/unknown original operation. Missing cleanup evidence, live locks, drift, unknown dispatch, changed policy and terminal tasks stop continuation. A stopped local runner alone does not prove child cleanup.

Reuse existing project records, workflow locks, safe file readers, host boundary, and lifecycle gates. Do not add model-based classification, external search infrastructure, global configuration or fixed organization roles. The existing monitor remains a public read-only projection; private execution material is not published into it.

## Verification

Offline contract and integration checks cover six work types, missing/changed references, scope mismatch, review candidate drift, unknown or unsettled operations, duplicate continuation, interrupted initialization and authorization drift. Qualify actual entrypoints with a bounded model study; bytes are diagnostic rather than token or monetary savings. Preserve legacy workflow behavior and exact-candidate independent QA.

## Rollback

Revert the implementation while retaining immutable prior run evidence and successor intent records. Never delete uncertainty to make an older runner execute.
