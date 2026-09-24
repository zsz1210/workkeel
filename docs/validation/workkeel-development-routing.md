# Bounded development routing evaluation

## Real maintenance sample — 2026-09-24

The optional task monitor uses a pure number/time formatting module implemented
by `gpt-6-luna` at medium effort, then source-reviewed by `gpt-6-sol` at medium.
The submitted module was integrated byte-for-byte, SHA-256
`d610ae93b423af60923547586cbed89110daaaa2a268626f314150c52444c8a9`.
Prewritten independent checks passed 32/32 on the first submission. Sol found no
contract defect. Zero repair steps; the bounded experiment stopped after review.

| Measured step | Input tokens | Output tokens | Adapter-call time | Result |
| --- | ---: | ---: | ---: | --- |
| Luna implementation | 63,744 | 856 | 37.35 s | 32/32 coordinator checks |
| Sol source review | 59,636 | 1,680 | 59.14 s | Pass; no findings |

These are different roles on one real small task, not a same-task speed ranking.
The earlier WI-0266 paired synthetic comparison used three tasks per model; all
six first attempts passed. Neither sample proves general success rate, net token
savings or monthly allowance savings. Coordinator, browser work and final QA are
excluded from the table. The model's restricted tool environment lacks Node;
checks ran separately in the coordinator's environment, not inside either model.

Selected and runtime-confirmed models matched in both steps. Independently
observed serving-backend model and subscription dollars were unavailable. Time
includes runtime setup, tools and cleanup, not just model computation. The
predeclared bounds were three steps maximum, 120 seconds each, ten minutes total
and a fresh shared-account quota brake. No third step was needed or dispatched.

## Personal external selector, not a bundled gateway

This development evaluation used the pinned MIT-licensed non-enterprise LiteLLM
1.101.0 `ComplexityRouter` local heuristic with networking disabled, plus explicit
policy guards. It did not call a classifier model, embedding service, LiteLLM
proxy or OAuth gateway. LiteLLM's semantic Auto gateway is not enabled by this
tool. The separate native Codex App Server used the existing subscription login;
no paid API key, account change, global settings rewrite or Astra dispatch.

The external measured entry first verifies the selected model against the pinned,
approved one-step Workkeel policy, writes an exclusive launch receipt, then uses
the qualified native host. Each result retains requested/runtime model, unknown
backend identity, tokens and elapsed time. Uncertain outcomes cannot silently
replay. The older interactive terminal entry is not qualified by this measured
test; these are different entry paths. Personal scripts, venv and account records
are not shipped in the framework package.

Rules: explicit bounded low-risk work with checkable acceptance can use Luna;
ambiguous/complex work and review use Sol. A confirmed quality failure can receive
one Sol repair within the original budget. Infrastructure, timeout or unresolved
dispatch stops without escalation. Astra requires a separate explicit request.
The heuristic alone is not reliable for implicit or Chinese task complexity.

No new OSS dependency, copied third-party source or artwork was introduced in
Workkeel by this feature. The personal LiteLLM environment retains its own and
transitive license files outside the repository. Framework dependency notices
remain in [THIRD_PARTY_NOTICES](../../THIRD_PARTY_NOTICES.md).
