# Workkeel automation validation

Development evidence as of 2026-09-23. This page separates offline tests, local
process tests and real model execution; it is not a production-readiness claim.
Final candidate verification and independent review are still pending.

## Observed results

| Check | Observation | What it establishes |
| --- | --- | --- |
| Graph failure/recovery suite | 19 tests passed in 11.46 s | Registered execution, direct joins, conditional loops, approvals/rejection, separate-process resume, corruption/missing-record rejection, model continuity, fallback limits, cancellation settlement and uncertain-cleanup lock retention |
| Codex protocol fixture | 11 local-process tests passed in 1.08 s | Start/resume/cancel wire handling, explicit permissions, account/model/effort checks, early-fatal setup, refusal results and delayed dispatch cancellation; no real model involved |
| Onboarding/context suite | 5 tests passed | Preserved instructions, stale-preview protection, no implicit package fetch, Skill audit and exact Headroom originals |
| Real macOS permission profile | 9 checks passed, zero local network connections | Allowed reads/writes succeeded; outside reads/writes, runner-state access, task-policy/approval writes and tool networking failed, even with ordinary root writes allowed |
| Early ChatGPT subscription sample | Luna read → Sol write completed in 42.08 s | Requested models matched runtime-confirmed models; output matched the expected file; no extra API key. This preceded later runtime fixes and is not final-candidate qualification |
| Later subscription checks | Attempts 09 and 11 failed functional acceptance; 10 stopped in preflight | Incorrect UTC interpretation and propagation of a refusal exposed real defects. Reports are preserved; structured attention results now stop downstream work. Final bounded requalification remains pending |

The live task used synthetic public text in an isolated repository, two nodes,
one attempt per node, serial execution and a 180-second ceiling. Environment:
macOS, Node.js 24.7.0, Codex 0.155.0-alpha.9.2. Data and scope were approved before
creating the task. Earlier preflight/protocol failures remain recorded; they are
not counted as successful qualification or silently replaced.

The first successful subscription report recorded the provider's `last` token
sample. That is **not the complete tool-using node total**, so those numeric values
must not be used for aggregate cost/savings claims. The adapter now uses cumulative
usage for new conversations and reports unknown usage on resume when it lacks a
trusted pre-turn baseline. Attempts 09 and 11 contain cumulative usage but failed
functional acceptance, so their usage is not successful-task efficiency evidence.
A follow-up exact-source measurement is pending.

Runtime-confirmed model names are not independent observations of the service's
backend. Dollars and subscription-quota savings remain unknown. This is one small
functional sample, not a comparative model-quality benchmark or proof of general
time/token savings.

## Reproduce

From a source checkout with optional graph dependencies installed:

```sh
node --test test/workkeel-workflows.test.mjs test/workkeel-codex-runtime.test.mjs test/workkeel-onboarding.test.mjs
node test/fixtures/workkeel-sandbox-qualification.mjs /absolute/new-report.json
```

The second command runs local synthetic sandbox probes without a model. Both
fixture runners retain their task-owned temporary directories for inspection.
To explicitly spend a small amount of the signed-in subscription allowance:

```sh
node test/fixtures/workkeel-subscription-qualification.mjs --use-subscription /absolute/new-live-report.json
```

It permits at most two workflow dispatches; each coding-agent turn can involve
multiple model/tool calls. Use a fresh report path. The normal automated test suite
never runs this live fixture. Do not substitute an API-key account or assume an
unknown model/version is supported.

## Qualification boundaries

- LiteLLM live gateway behavior remains unverified without a configured service,
  allowed models, data policy and budget. Offline fixed-connection tests are not
  gateway qualification.
- Claude onboarding is an instruction bridge, not an automatic runtime adapter or
  evidence that every installed Claude version loaded every instruction.
- Headroom's native entrypoint and policy wrapper are tested; the Codex native-tool
  path does not currently apply it automatically.
- Locks are local, identities are attributed, and arbitrary registered host code
  is trusted. Workkeel does not promise distributed locking, authenticated humans,
  malicious-host containment or exactly-once external effects.

See the [testing policy](../getting-started/testing.md),
[workflow guide](../operations/workkeel-workflows.md), and
[OSS inventory](../../THIRD_PARTY_NOTICES.md). Final delivery must reference the
exact tested candidate and a distinct Agent's review, not only these editing checks.
