# Third-party notices

## pstack review guidance

- Project: [Cursor pstack](https://github.com/cursor/plugins/tree/main/pstack)
- Material: `interrogate` Skill, reviewer prompt, review rubric and lead judgment;
  `principle-attack-the-premise` Skill
- License: MIT
- Copyright (c) 2026 Lauren Tan

The [independent QA and release gate](docs/operations/workkeel-review-assessment.md#independent-qa-and-release-gate)
adapts finding dispositions, evidence filtering, must-fix reproductions, the
premise step after a second failed review and independent multi-model review
to Workkeel's risk tiers and acceptance boundaries. No pstack runtime or Skill is
installed or invoked. The upstream license follows:

MIT License

Copyright (c) 2026 Lauren Tan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Runtime dependencies

The npm lockfile resolves these core runtime packages. They are installed as separate dependencies and are not copied into Workkeel's source files.

| Package | Resolved version | License |
| --- | --- | --- |
| `ajv` | 8.20.0 | MIT |
| `ajv-formats` | 3.0.1 | MIT |
| `fast-deep-equal` | 3.1.3 | MIT |
| `fast-uri` | 3.1.6 | BSD-3-Clause |
| `json-schema-traverse` | 1.0.0 | MIT |
| `picomatch` | 4.0.7 | MIT |
| `require-from-string` | 2.0.2 | MIT |
| `semver` | 7.8.5 | ISC |

The dependency packages retain their own copyright and license files in an installed dependency tree. Review this inventory together with `package-lock.json` before each public release.

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

### Acorn

- Project: <https://github.com/acornjs/acorn>
- Package: `acorn`
- Pinned version: `8.19.0`
- License: MIT

Workkeel uses Acorn only in the repository import boundary check, to parse its own source modules. Acorn is not imported by Workkeel's runtime source, vendored, or included in its npm package or runtime dependency tree.

### validate-npm-package-name

- Project: <https://github.com/npm/validate-npm-package-name>
- Package: `validate-npm-package-name`
- Pinned version: `8.0.0`
- License: ISC

Workkeel uses validate-npm-package-name only in the repository import boundary check, to validate package names in its own source modules. It is not imported by Workkeel's runtime source, vendored, or included in its npm package or runtime dependency tree.

## Mermaid README diagrams

- Projects: <https://github.com/mermaid-js/mermaid> and <https://github.com/mermaid-js/mermaid-cli>
- Authoring tool: `@mermaid-js/mermaid-cli`
- Pinned authoring version: `11.10.1`
- License: MIT

Workkeel commits independently authored Mermaid source and static SVG documentation assets. Mermaid is used only during documentation authoring; it is not vendored, installed as a runtime dependency, or required to operate Workkeel.

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

The `grill-me`, `grill-with-docs`, `domain-modeling`, `tdd`, `diagnosing-bugs`, `codebase-design`, `code-review`, `prototype`, `retro`, `writing-great-skills`, and related development Skills were reviewed as product and maintenance inspiration. Workkeel's former bundled Skills, including `$skill-authoring`, were independent implementations written for repository-persisted decisions, project ownership boundaries, and delivery; Workkeel 0.2 no longer ships them. No upstream Skill source is vendored, loaded, or wrapped at runtime.

If future versions copy or adapt upstream source, they must include the applicable MIT copyright and permission notice with the distributed copy or substantial portion.

## README and project documentation inspiration

- Hypergiant Agent Skills, `accelint-readme-writer`: <https://github.com/gohypergiant/agent-skills/tree/459a846a65544cf311164059f2ea4623ec443b02/skills/accelint-readme-writer> — Apache-2.0, reviewed commit `459a846a65544cf311164059f2ea4623ec443b02`.
- AsyrafHussin Agent Skills, `project-docs`: <https://github.com/AsyrafHussin/agent-skills/tree/1aa0ff717c10309226c9e678f00873976450fd76/skills/project-docs> — MIT, reviewed commit `1aa0ff717c10309226c9e678f00873976450fd76`.

Workkeel used these as design references for its former, independently implemented `project-documentation` Skill, which 0.2 no longer ships. Neither source is copied, loaded, or invoked by Workkeel; that Skill was original text grounded in its own repository-evidence and authority model.

## Security review inspiration

- Project: <https://github.com/OWASP/secure-agent-playbook>
- Capability reviewed: `code-review-security`
- License: CC-BY-4.0
- Reviewed commit: `79fea6b9115b55687818f8c4073844ee9ba907a6`

Workkeel records this as provenance for a possible future optional security-review pack. No OWASP source, play, or template is currently installed, copied, loaded, or invoked. Any later adaptation must preserve attribution and clearly identify changes under the applicable license.
