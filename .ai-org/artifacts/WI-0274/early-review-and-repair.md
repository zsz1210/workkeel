# Pre-delivery independent review and same-scope repair

Initial behavioral candidate: 638603c4390bc2c4ab6428c8b06ea63edd5d80c0.
The actual independent GPT-6 Sol medium review returned FAIL with two findings:

1. Fixture Git commits inherited configuration/hooks and lacked subprocess bounds.
2. A legacy marker hid partial native initialization files in start guidance.

The initial candidate later completed full verification (143 files, exit 0), but
is not accepted. The reviewer saw only its then-running log, accurately reporting
that full verification was unconfirmed in those inputs. Both findings are repaired
before Developer handoff. This is a pre-delivery review correction, not a fabricated
native lifecycle rework event or a waiver of Standard Independent QA.

Git helpers now strip inherited GIT_* configuration, disable system/global config,
hooks and signing, use an empty init template and bound calls to ten seconds.
A regression injects a hostile hook, signing and template settings without touching
user settings. Start checks partial native files before returning legacy guidance;
regressions preserve both conflicting files. Final full verification and actual
fresh independent judgment remain required for the repaired candidate.

Original reviewer output and actual model/usage receipt are retained separately.
