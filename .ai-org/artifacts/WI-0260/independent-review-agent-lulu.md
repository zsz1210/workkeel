# Independent review — WI-0260

- Reviewer: `agent-lulu` / Quality & Evaluation Engineer
- Principal: `human`
- Candidate: `c84f1b5599a210dcf42647f9c54ff9ffa8b14324`
- Base: `f2d0554023fa186f27d7b0d7bd98bd4368dfd111`
- Judgment: **pass for the approved experimental/local implementation**
- Actionable findings: none

This judgment does not qualify the Codex subscription path as a reliable
end-to-end workflow. It does not qualify live LiteLLM behavior, comparative model
quality, subscription or dollar savings, production readiness, publication or
deployment. The final authorized subscription qualification remains **failed**;
no additional live call was made during this review.

## Candidate and evidence binding

The checked-out `HEAD` and Developer handoff both resolve to the candidate above.
`git diff --quiet 2481c93f5524929558a85ddc82383b5cfb60b021..c84f1b5599a210dcf42647f9c54ff9ffa8b14324 -- src test scripts/check-package.mjs package.json package-lock.json`
returned exit 0. The later candidate commit changes public result prose and
evidence, not executable source, tests, package policy or dependency metadata.
The retained complete verification at `2481c93f5524929558a85ddc82383b5cfb60b021`
is therefore compatible with this exact candidate: 1,387 passing cases across
134 files, exit 0, 347.69 seconds.

The five module hashes in `subscription-qualification-12.json` were recomputed
from the candidate and match the report exactly. That report records a failed
11.31-second live attempt: Luna returned `attention` after incorrectly treating
the future expiry as expired, and Sol was not dispatched. The graph's fail-closed
stop is evidence for failure containment, not functional live qualification.

The retained nine-case macOS permission-profile report predates the final
early-reroute correction. Review of the intervening diff found that the only
runtime change was pre-turn model-reroute handling plus its fixture assertion;
permission construction and enforcement did not change. The report is compatible
for its bounded filesystem/network claim, but is not relabeled as an exact-module-
hash run. The browser and installed core-only package reports likewise retain
their stated scopes; later changes are result prose only.

## Independent offline checks

Run from the candidate checkout without a model, subscription dispatch, gateway,
paid service, account action, publication or push:

1. `node --test test/workkeel-workflows.test.mjs test/workkeel-codex-runtime.test.mjs test/workkeel-onboarding.test.mjs`
   passed 35/35 cases in 10.94 seconds wall time. This independently covered
   journal/recovery blocking, durable separate-process resume, approval binding,
   cancellation and quiescence, uncertain cleanup lock retention, model and
   conversation pinning, zero-dispatch-only fallback, real local JSON-RPC process
   handling, protected permissions, onboarding preservation, Skills auditing and
   lossless Headroom behavior.
2. `npm run verify:fast` passed in 4.82 seconds wall time: repository checks,
   documentation links, exact npm package boundary and 59/59 fast cases. The
   dry-run inventory was 490 files, 1,108,702 packed bytes and 4,317,389 unpacked
   bytes.

## Code and contract review

- Authority: workflow execution requires the current matching implementation
  claim, actor, unchanged contract digest, dependencies and pinned repository
  policy references. Workflow completion never mutates task acceptance.
- Journal and recovery: intent is durably inventoried before adapter dispatch;
  missing, corrupt or unresolved records fail closed; ambiguous effects require
  explicit repository evidence and reconciliation rather than replay.
- Cancellation and cleanup: active adapters are cancelled, node promises must
  settle, and an unconfirmed host shutdown or background-terminal cleanup retains
  the diagnostic lock and records uncertain external effects.
- Routing: approved connections and data/network boundaries are validated before
  dispatch; selections and conversations are pinned; runtime model drift and
  model-reroute notifications fail; fallback is allowed only after a confirmed
  zero-dispatch `not-started` result.
- Graph controls: definitions, topology, joins, loops, steps, attempts,
  parallelism, time, writable-root overlap and approval tokens are bounded. A
  completed graph is reported separately from task acceptance.
- Host boundary: the concrete subscription host is version/platform pinned,
  requires the existing ChatGPT login, disables unsupported ambient features,
  MCP servers, tool networking and inherited shell environment, and refuses
  unsupported budget or Headroom enforcement.
- Claims: the English, Traditional Chinese and Japanese entrypoints state that
  offline checks passed while the final live functional check failed; they do not
  claim reliable automation or savings. LiteLLM and automatic Codex-native
  Headroom remain explicitly unqualified.

## Named gate judgments

### Test evidence — pass

Pass for the exact candidate using the fresh 35-case protocol/recovery run, the
fresh 59-case fast gate, and compatible complete verification from the
source-identical revision. The retained browser, sandbox and installed-package
observations keep their narrower stated scopes.

### Evaluation report — pass with explicit failed-live boundary

The implementation satisfies the approved local experimental acceptance: bounded
graph execution, failure-sensitive recovery, explicit routing, Headroom/onboarding
boundaries, documentation and package controls are implemented and measured. The
single final live qualification did not satisfy its functional task and remains a
negative result. That failure prevents any reliable-live, quality, cost or savings
claim, but it is not concealed and is not a blocker to accepting the separately
scoped experimental/local implementation.

### Independent QA report — pass

No actionable defect was found in the candidate against the approved acceptance
and stated limitations. Accept for continued repository lifecycle review only.
Do not infer publication, deployment, production use or another live experiment.
