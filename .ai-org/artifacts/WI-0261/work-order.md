# Reviewed package inventory

Parent: WI-0260. The approved implementation includes distributable graph,
subscription-runtime and onboarding modules and public guides/diagram assets.
This bounded supporting task updates only `scripts/check-package.mjs` after
comparing the dry-run manifest with the base revision's tracked inventory.

Acceptance and design: require every newly reviewed distributable path; raise the
file-count ceiling only by that enumerated delta. Keep forbidden roots, permitted
roots and the 8 MiB unpacked ceiling unchanged. Validate the actual npm dry run.
No publication, dependency change, test-runner redesign or historical cleanup.

Risk is low and bounded: an explicit packaging assertion, not runtime behavior.
Lean is eligible without UI or active workers. A distinct Verifier must judge the
exact candidate; this work order is not verification. Revert the isolated script
change if incorrect. Main product acceptance remains with WI-0260.
