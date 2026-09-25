# Independent QA — FAIL / stage revision fields

Actual read-only GPT-6 Sol medium independent conversation reviewed combined
candidate 26e42ce7604ae611c2271f66dde13d6c975ef6d4. The reviewer is separate from
the coordinator implementation. It returned FAIL with one P2 finding:

`src/workkeel-material.mjs` accepts candidate_revision on initial/repair/takeover
without validating HEAD, and accepts prior_revision outside reconsideration.
An initial packet without source material can thus emit a bogus candidate. Reject
inapplicable revision fields and test them before dispatch.

The affected module is byte-identical to WI-0276's handed-off candidate
262d6c76e520f97dbdf9dcf4e5f61dc635065b91; that original candidate is rejected for
the same demonstrated validation gap. No issue was established in the UI followup.

Coverage: six-kind preparation, scope/authority/source validation, workflow
dispatch/replay, continuation receipt/inventory/locks, successor initialization,
current guards and monitor redaction. Reviewer did not run tests or establish
package inclusion from its supplied source diff. Coordinator owns those checks.
Raw judgment and confirmed model receipt are preserved in the external output.
