# WI-0265 developer evidence

## Candidate scope

New manual paired-model experiment harness and five offline tests; a development ADR and
focused results guide. No `src/`, production dependency, model default, console,
credential or published package behavior changed. Personal optional router lives
outside the repository under the parent workspace's `work/development-router`.

## Live observations and disposition

`pilot-results.json` binds the live source candidate
`d45b4eec95665049a1c1fb7e1308cc01255e3cf7`, frozen plan, five raw report hashes,
complete recorded usage and actual runtime confirmations. Raw fixtures and reports
remain local under the sibling `model-pilot-20260924` directory and its referenced
synthetic temporary fixtures. No result or journal was rewritten.

The pilot stopped after five steps, one valid pair, one invalid pair and an
environment/attention stop. Third pair unrun. Comparison outcome is inconclusive.
The Sol repair was induced by the flawed oracle, not established model rework.
Luna's blocked run still retained input/output/time observations. No new inference
after stopping. See the focused guide for limitations, including overlapping
offline load, account-shared quota and no token-to-dollar conversion.

## Offline corrections

Corrected missing-ID semantics and oracle; regression rejects a completion-only
implementation. Explicit coordinator-owned tests avoid telling agents to invoke
an unavailable Node.js executable. No sandbox widening. Focused tests: 5 pass.
Corrected harness has no live qualification claim.

First full verification at original live candidate passed (137 files, 1,407
passing test markers). A second full verification is required after the offline
fixture changes; its completion record names the final tested revision.

## Optional tool evidence

LiteLLM 1.101.0 installed only in sibling `litellm-dev-1.101.0`, 55 exact wheel
versions and hashes in `litellm-dev-requirements.txt`; installation report and logs
retained. macOS ARM64 LiteLLM wheel hash matches the development ADR. `pip check`: no broken
requirements. Installed package license notices retained, no source vendoring.
Transitive licenses include MIT, BSD, Apache, PSF, CNRI and MPL (certifi/tqdm);
this is local installation, not redistribution. Do not claim every dependency
is MIT. Future redistribution requires those packages' notice obligations too.

Initial hand-built platform sandbox failed to start Python; no model calls.
Replaced it with the existing version-pinned Codex sandbox's platform support,
root denied, only dependency/tool paths readable, network and writes disabled.
No blanket access or unsandboxed fallback. Real offline classification and
denied network/read/write checks pass; revised optional suite has four tests.
The initial heuristic wrongly sent Chinese architecture-level work to Luna;
the conservative guard now sends ambiguous/general/risky work to Sol and only
explicit mechanical SIMPLE tasks to Luna. Its limitations remain disclosed.

The optional interactive launcher is unexercised live. It previews first, requires
a terminal and ChatGPT login, does not edit global settings and excludes API-key
environment inheritance. No automatic current-task model change is claimed.

The second verification attempt failed before tests because two new internal
experiment documents exceeded the reviewed npm file-count boundary. They now
live with this Work Item's evidence instead of the distributable documentation.
No package-count/size guard was raised or disabled. The third full verification
checks the corrected final candidate. The failed log remains preserved.

## Learning and next owner

No framework-wide model-choice rule is justified by one valid pair. The oracle
defect needs independent preflight review before another pilot. No lesson promoted
from this small sample. Independent reviewer: agent-lulu in a distinct runtime;
review the exact final candidate, optional-tool hashes, unchanged pilot history and
stop enforcement. Release scope is local handoff only, not full comparison
qualification, publish, push, merge, or another experiment.
