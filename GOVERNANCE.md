# Governance

Workkeel is currently a maintainer-led Alpha project. The repository owner is the
project maintainer and final release authority. Task-first Agent identities and
legacy Temple Position names never automatically grant GitHub permission or
maintainer authority. The toolkit's retained Temple self-hosting gates remain
binding; adopting the Workkeel name does not change the merge or release policy.

## How decisions are made

- Small, reversible fixes may be accepted through review and passing CI.
- Changes to architecture, lifecycle authority, security boundaries, file ownership, public APIs, dependencies, licensing, or external integrations require a documented decision or ADR.
- The maintainer may ask for a smaller experiment, additional evidence, or Independent QA before accepting a consequential change.
- Merging a pull request does not by itself publish a package, create a release, or authorize an external action.

## Maintainer responsibilities

The maintainer is responsible for repository settings, contributor moderation, security intake, release decisions, and protecting private project data. Before the repository becomes public, the maintainer must publish an enforceable code of conduct and a private conduct-reporting route.

## Single-maintainer pull request policy

Decision adopted on 2026-09-09: while this repository has one human maintainer, another GitHub account's approval is optional. Requiring approval from the sole Code Owner prevents that maintainer from completing their own pull requests. This decision applies to this repository's GitHub integration; it does not change Temple's workflow profiles or install a policy in downstream projects.

The normal integration path retains these requirements on `main`:

| Setting | Policy |
| --- | --- |
| Pull request before merging | Required |
| Approving GitHub reviews | Zero required; additional human review remains welcome |
| Code Owner approval / approval of the latest reviewable push by another person | Not required |
| Required status check | `Verify (Node.js 24)`, bound to the existing GitHub Actions app |
| Branch up to date before merging | Required by strict status checks |
| Review conversations | Must be resolved |
| Force pushes / branch deletion | Remain disabled |

`CODEOWNERS` remains ownership guidance. The change preserves stale-approval dismissal, the existing administrator enforcement setting, and all other branch-protection settings; it introduces no new bypass permission. Normal authorized work uses an ordinary PR merge after the required checks, rather than a recurring administrator exception. GitHub documents [PR requirements and optional approvals](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule) as separate choices.

Optional GitHub approval does not remove engineering review. Governed work must still satisfy its effective Temple workflow profile: the applicable scope and acceptance gates, evidence tied to the tested candidate revision, and distinct Developer and Independent QA Agent Identities wherever Independent QA is required. Those identities are not substitute GitHub accounts or fabricated human approvals. Follow the [testing guide](docs/getting-started/testing.md): behavioral candidates and releases require full local verification; prose-only changes use `verify:fast`; relevant browser and organization-state checks remain required. The GitHub CI badge does not prove these local checks or Independent QA took place; the integration owner must verify their recorded evidence before merging.

When the maintainer has already authorized a task through PR integration, its agent may complete the ordinary merge within that scope without requesting another confirmation solely to replace impossible self-approval. Passing CI or changing repository settings does not grant new task authority. Applicable approvals for consequential or irreversible changes, spending, publication, deployment, and other external actions still apply; merging is not release authorization.

Reconsider mandatory human approvals deliberately when another eligible human reviewer or Code Owner takes recurring responsibility. Restoring the prior policy requires one approving review, Code Owner approval, and approval of the latest reviewable push by another person; preserve the other protection settings during that change.

## Evolution

If sustained contributors take on recurring responsibility, governance may expand through a separate public decision. Commit volume, company title, AI model choice, or possession of a Temple Skill does not silently grant maintainer authority.
