# WI-0254 cancellation reason

WI-0254 cannot safely complete its configured Lean finish. The candidate's three
affected product/test paths are byte- and mode-identical to
`b863ee4976c9ed1c8fe586525401b2dddcea39bc`, and independent QA passed both the
63-test focused run and exact-candidate `npm run verify` over all 127 test files.

The blocker is the Work Item's prebuild gate configuration. Both `approved_scope`
and `acceptance_criteria` reference the mutable canonical file
`.ai-org/work-items/WI-0254.json`. Lean finish correctly treats committed prebuild
gate references as protected authority and compares their current physical bytes
with the candidate. The candidate records blob `e1d425ebba9784576a310953edac58b50fb67650`,
while later supported Developer handoff and Quality Evaluator claim operations
necessarily changed that canonical file. The resulting `GUARD_REJECTED` reported
`mutation_status: not_started`.

Do not bypass the guard, rewrite history, repoint gates, or claim that the rejected
finish accepted the Work Item. Cancel WI-0254 while retaining its passing QA
evidence and this configuration defect for a separately governed correction.
