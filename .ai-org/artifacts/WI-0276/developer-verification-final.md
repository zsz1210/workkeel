# Final coordinator verification

Exact tested behavioral candidate: f7489253987bfdb3ba8ea15daf36f6f807135670.

`npm run verify` exited 0: repository, documentation link and package checks,
then 144 test files. The candidate includes negative checks for candidate fields
on all non-review types and prior_revision outside reconsideration. Required
package inventory includes all three modules and both documents, within 509
files and the unchanged 8 MiB ceiling. No package was published.

`node scripts/verify-workkeel-monitor.mjs` exited 0, 34 checks at 1440/390 widths,
using installed Chrome and zero model calls. Desktop/mobile screenshots and the
scoped Chinese next-action text were inspected. Pure observer projection tests
passed 7/7. Corrected-candidate UI source matches the previously inspected UI
candidate; the corrected candidate was also browser-tested directly.

The six paired synthetic tasks passed at the initial study source, with the
later rejection-only correction outside those valid input combinations. Refer
to evaluation.md for measurements and limitations. No historical experiment was
edited. Study used nine turns; actual independent source QA used three additional
turns, all GPT-6 Sol medium. Total twelve real model turns.

Independent QA: broader review identified one P2. Scoped repair review against
this exact candidate returned PASS. An intermediate review preparation mixed a
snapshot commit and product commit and was rejected; it is retained, not counted
as a pass. The final preparation matched workspace HEAD to the actual product
candidate and checked the selected source against that Git blob. See the separate
independent QA record for scope and coordinator-owned limits.

Hosted Verify (Node.js 24) passed for this product candidate. Governance-only
closeout changes still require final PR-head CI and normal merge. This evidence
does not itself perform either action.

Rollback: revert product changes through normal review; retain all original
operations, receipts, failed attempts and authority records. No account/global
configuration, dependency installation or external service was changed.
