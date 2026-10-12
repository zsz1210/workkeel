# Third-party notices

## Runtime dependencies

The npm lockfile resolves these core runtime packages. They are installed as separate dependencies and are not copied into Workkeel's source files.

| Package | Resolved version | License |
| --- | --- | --- |
| `ajv` | 8.20.0 | MIT |
| `ajv-formats` | 3.0.1 | MIT |
| `fast-deep-equal` | 3.1.3 | MIT |
| `fast-uri` | 3.1.6 | BSD-3-Clause |
| `json-schema-traverse` | 1.0.0 | MIT |
| `require-from-string` | 2.0.2 | MIT |

The dependency packages retain their own copyright and license files in an installed dependency tree. Review this inventory together with `package-lock.json` before each public release.

## Optional graph dependencies

Workkeel uses public LangGraph interfaces for graph execution and checkpointing.
These exact installed packages and their license files were reviewed on 2026-09-23.
All entries below are MIT-licensed; retain their copyright and permission notices
when redistributing dependency code. The lockfile records artifact integrity.

| Package | Resolved version(s) |
| --- | --- |
| `@langchain/core` | 1.2.12 |
| `@langchain/langgraph` | 1.4.17 |
| `@langchain/langgraph-checkpoint` | 1.1.5 |
| `@langchain/langgraph-sdk` | 1.11.2 |
| `@langchain/protocol` | 0.0.19 |
| `@cfworker/json-schema` | 4.1.1 |
| `@standard-schema/spec` | 1.1.0 |
| `@types/json-schema` | 7.0.15 |
| `zod` | 4.6.5 |
| `js-tiktoken` | 1.0.21 |
| `base64-js` | 1.5.1 |
| `langsmith` | 0.10.5 |
| `mustache` | 4.2.0 |
| `p-queue` | 6.6.2, 9.3.3 |
| `p-timeout` | 3.2.0, 7.0.2 |
| `p-finally` | 1.0.0 |
| `p-retry` | 7.1.1 |
| `is-network-error` | 1.3.2 |
| `eventemitter3` | 4.0.7, 5.0.4 |

These are optional npm dependencies, **installed by default** by npm. Use
`npm ci --omit=optional --ignore-scripts` for the core-only source installation.
Workkeel loads the graph engine only when executing a workflow. `langsmith` being
present does not enable a hosted tracing service: external tracing is rejected
by the workflow runner. No LangGraph hosted service or Enterprise source is used.
Node's built-in SQLite API stores checkpoints; no SQLite npm binding is bundled.

Upstream navigation: [LangGraph](https://github.com/langchain-ai/langgraphjs),
[LangChain Core](https://github.com/langchain-ai/langchainjs),
[Zod](https://github.com/colinhacks/zod). Exact package versions above, not upstream
default branches, identify this review.

## External coding runtimes and gateways

Codex is an independently installed runtime; Workkeel speaks its App Server
protocol and does not copy its executable or authentication material. Its
open-source license does not replace the connected model service's terms or
a ChatGPT subscription. Workkeel does not bypass service limits.

LiteLLM is an optional, separately operated gateway, not a bundled server or a
required subscription-routing dependency. The upstream root
[license](https://github.com/BerriAI/litellm/blob/main/LICENSE) is MIT with an
explicit exclusion for the separately licensed `enterprise/` directory. No
Enterprise material is copied or invoked. A future deployment must review its
exact version, dependencies and enabled features; this source-only integration
does not certify a service deployment or grant commercial permissions.

## Development dependencies

### Playwright Core

- Project: <https://github.com/microsoft/playwright>
- Package: `playwright-core`
- Pinned version: `1.62.1`
- License: Apache-2.0

Workkeel uses Playwright Core only for repository development and browser checks. It launches an already installed Google Chrome with an ephemeral automation profile. Workkeel does not download, vendor, redistribute, or include a browser binary in its npm package or runtime dependency tree.

## Mermaid README diagrams

- Projects: <https://github.com/mermaid-js/mermaid> and <https://github.com/mermaid-js/mermaid-cli>
- Authoring tool: `@mermaid-js/mermaid-cli`
- Pinned authoring version: `11.10.1`
- License: MIT

Workkeel commits independently authored Mermaid source and static SVG documentation assets. Mermaid is used only during documentation authoring; it is not vendored, installed as a runtime dependency, or required to operate Workkeel.

## Headroom optional tool-output adapter

- Project: <https://github.com/headroomlabs-ai/headroom>
- Pinned package: `headroom-ai==0.37.0`, upstream tag `v0.37.0`
- License: Apache-2.0; Copyright 2025 Headroom Contributors
- Local tokenizer: `tiktoken==0.14.0`, MIT, OpenAI contributors

Workkeel's independently authored wrapper uses an explicitly supplied, separately
installed Python environment. No Headroom/tokenizer source, environment or model
weights are vendored, downloaded or installed by Workkeel. The upstream LICENSE and
NOTICE were reviewed; the operator must retain the environment's licenses, notices
and dependency lock. Default-off operation needs no Python packages. The version
pin is not a full environment integrity attestation. See the [adapter guide](docs/extensions/headroom-adapter.md).

## Archify

- Project: <https://github.com/tt-a1i/archify>
- License: MIT
- Pinned upstream release for the optional adapter contract: `v2.16.0`
- Resolved upstream commit: `c826e6c3a7abad19c0f3cd1ca57207d54b1ad8de`
- Reviewed downstream security patch: `fast-uri-3.1.7-security-override`

New projects do not install or execute Archify by default. This repository's
self-hosting records include an explicitly installed source copy under
`.ai-org/adapters/archify/v2.16.0/`, with its MIT license, dependency BSD-3-Clause
notice and file digests. That project-owned tree is excluded from the npm package.
The installer copies an exact local checkout and deterministically changes the
declared `fast-uri` override and matching lock entry from `3.1.5` to `3.1.7` without
running a package manager or upstream code. Keep the recorded base and downstream
patch when redistributing that copy. The adapter is replaceable and is not a
source of task authority.

## Matt Pocock Skills inspiration

- Project: <https://github.com/mattpocock/skills>
- License: MIT
- Reviewed commit: `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`
- Upstream copyright: Copyright (c) 2026 Matt Pocock

The `grill-me`, `grill-with-docs`, `domain-modeling`, `tdd`, `diagnosing-bugs`, `codebase-design`, `code-review`, `prototype`, `retro`, `writing-great-skills`, and related development Skills were reviewed as product and maintenance inspiration. Workkeel's Skills, including `$skill-authoring`, are independent implementations written for repository-persisted decisions, project ownership boundaries, and delivery. No upstream Skill source is vendored, loaded, or wrapped at runtime.

If future versions copy or adapt upstream source, they must include the applicable MIT copyright and permission notice with the distributed copy or substantial portion.

## README and project documentation inspiration

- Hypergiant Agent Skills, `accelint-readme-writer`: <https://github.com/gohypergiant/agent-skills/tree/459a846a65544cf311164059f2ea4623ec443b02/skills/accelint-readme-writer> — Apache-2.0, reviewed commit `459a846a65544cf311164059f2ea4623ec443b02`.
- AsyrafHussin Agent Skills, `project-docs`: <https://github.com/AsyrafHussin/agent-skills/tree/1aa0ff717c10309226c9e678f00873976450fd76/skills/project-docs> — MIT, reviewed commit `1aa0ff717c10309226c9e678f00873976450fd76`.

Workkeel used these as design references for its independently implemented `project-documentation` Skill. Neither source is copied, loaded, or invoked by Workkeel; the distributed Skill is original text grounded in its own repository-evidence and authority model.

## Security review inspiration

- Project: <https://github.com/OWASP/secure-agent-playbook>
- Capability reviewed: `code-review-security`
- License: CC-BY-4.0
- Reviewed commit: `79fea6b9115b55687818f8c4073844ee9ba907a6`

Workkeel records this as provenance for a possible future optional security-review pack. No OWASP source, play, or template is currently installed, copied, loaded, or invoked. Any later adaptation must preserve attribution and clearly identify changes under the applicable license.
