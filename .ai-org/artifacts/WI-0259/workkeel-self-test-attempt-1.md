# Workkeel branding self-test attempt 1

Candidate `e769f02fb1ee7ef0d7863ceecea3f26abbc716bc` failed complete verification:
131 test files, exit 1, real 330.27 seconds, user 1598.21, sys 728.27.

The one reported failure was `agent-led onboarding validation keeps deterministic
success separate from provider evidence`. Offline installation succeeded, but the
validator attempted to launch the old hard-coded package path and received
`MODULE_NOT_FOUND`. The renamed package was installed at its new name.

Correction: derive the installed legacy CLI path from `sourcePackage.name` and
`sourcePackage.bin.temple`. Keep the offline dependency-lock setup and every
assertion unchanged. The original raw log is retained in local work storage;
machine-specific paths are not copied into public repository evidence.

This failed measurement is not acceptance. A new candidate requires fresh full
verification and distinct-Agent review. No failed history or test is removed.
