# Temple Core Skills

This catalog describes the retained compatibility distribution. Current Workkeel
projects use [task-relevant Skill selection and outcome checks](../extensions/workkeel-context.md);
the `temple-init` and `temple-work` identifiers below retain their original scope.

Temple Core Skills are reusable methods for recurring development situations. They tell an Agent **how to approach a kind of work**; they do not grant permission, approve a dependency, or replace the project's Work Item lifecycle.

## What does `$skill-name` mean?

The `$name` form is a prompt convention. It asks Codex to use a named Temple method for the request that follows.

```text
Use $decision-interview to clarify the unresolved product decision.
```

It is **not** a terminal command, environment variable, or package name. The method still obeys the current request, repository policy, assigned Position, and human approval boundaries.

## Choose the method by the situation

| Situation | Use | Expected result |
|---|---|---|
| Temple has not been installed in the target repository | [`$temple-init`](#temple-init) | A confirmed, verified project organization or a precise setup blocker |
| An important product or technical choice is still unclear | [`$decision-interview`](#decision-interview) | A decision frontier: decided, deferred, rejected, assumptions, and next gate |
| Important domain terms or rules conflict | [`$domain-modeling`](#domain-modeling) | Shared definitions, invariants, unresolved conflicts, and affected contracts |
| Human-facing repository documentation must be created or reconciled | [`$project-documentation`](#project-documentation) | Documentation grounded in current repository evidence |
| A repeated non-obvious procedure should become a repository Skill | [`$skill-authoring`](#skill-authoring) | A narrowly routed, authority-bounded, validated Skill or a documented reason not to create one |
| An initialized project needs canonical Work Item or lifecycle changes | [`$temple-work`](#temple-work) | Validated changes made through the pinned Temple launcher |

If two descriptions seem relevant, choose the method that owns the immediate problem. A Skill can recommend the next method, but it cannot silently expand the request.

<a id="temple-init"></a>

## `$temple-init`

**Use it when:** a repository is adopting Temple for the first time.

**It does:** inspect the target and its existing repository policy, ask only about integration choices that remain consequentially unclear, propose the standard responsibility coverage, wait for one combined confirmation of the workflow summary and Agent Identity mappings, preview the installation, initialize through the Temple CLI, and verify the result.

**It does not:** perform ordinary feature work, impose GitHub Flow, configure a repository host, guess project-specific names or permissions, overwrite existing organization state, or treat a global unversioned CLI as the project runtime.

**Example request:**

> Use `$temple-init` to initialize `/absolute/path/to/project`. Inspect its existing branch, review, and integration policy first; ask only about missing choices that affect execution. Then suggest Agent Identity names, show me the Position mapping and integration summary, and wait for my confirmation before writing.

**Expected result:** the target has a visible, project-owned organization layer and repository-integration routing record; `doctor` and `status` pass, or the exact unresolved prerequisite is reported. The referenced project policy remains authoritative.

<a id="decision-interview"></a>

## `$decision-interview`

**Use it when:** a consequential product, architecture, or implementation choice contains unresolved ambiguity that would materially change the outcome.

**It does:** establish the decision owner, separate facts from assumptions and preferences, ask the smallest useful questions, compare options, challenge weak premises, and summarize the current decision frontier.

**It does not:** turn routine execution into an interview, force every decision to be made immediately, or persist files and create Work Items unless the request already authorizes those changes.

**Example request:**

> Use `$decision-interview` to decide whether this integration belongs in Temple core, an optional adapter, or project-owned code.

**Expected result:** a concise record of what is decided, deferred, rejected, still assumed, and what approval or evidence is required next.

<a id="domain-modeling"></a>

## `$domain-modeling`

**Use it when:** product documents, code, tests, or people use important domain terms differently, and the difference affects behavior.

**It does:** identify authoritative sources, define terms in context, record examples and non-examples, establish invariants and owners, and preserve unresolved conflicts and downstream impacts.

**It does not:** add Domain-Driven Design labels for appearance, treat popularity as authority, or authorize a code refactor or interface rename.

**Example request:**

> Use `$domain-modeling` to reconcile how the product specification and API use “member,” “principal,” and “agent.” Propose the glossary changes before editing.

**Expected result:** shared vocabulary that product decisions, implementation, tests, and handoffs can use without guessing.

<a id="project-documentation"></a>

## `$project-documentation`

**Use it when:** README, setup, usage, contribution, or documentation-index claims must be created, reorganized, or reconciled with the repository.

**It does:** identify the reader and task, verify commands and capability claims against current files and tests, choose the right document depth, preserve language and ownership policy, and validate links and rendered structure.

**It does not:** market an unverified capability, use chat memory as project truth, duplicate the same canonical guide in several places, or change product behavior under the cover of documentation work.

**Example request:**

> Use `$project-documentation` to make the README a clear first-time entry point and move implementation detail into the documentation index.

**Expected result:** human-facing documentation whose claims, commands, links, and maintenance boundary match the repository.

<a id="skill-authoring"></a>

## `$skill-authoring`

**Use it when:** a repeated, non-obvious decision procedure should be designed, created, revised, or audited as a repository-local Skill.

**It does:** check whether the behavior is truly reusable, prevent trigger overlap, establish ownership and authority boundaries, author the smallest useful contract, and validate routing and completion behavior.

**It does not:** perform the target procedure itself, turn a one-time workaround or Position responsibility into a Skill, overwrite framework-managed files, install dependencies, publish, or promote the Skill into Temple core.

**Example request:**

> Use `$skill-authoring` to design a project-local release-notes Skill from this validated recurring procedure. Audit overlap before creating files.

**Expected result:** a narrow Skill with a clear trigger, non-trigger, authority limit, dependencies, provenance, and validation evidence—or a clear reason the procedure should remain documentation instead.

<a id="temple-work"></a>

## `$temple-work`

**Use it when:** an initialized repository has authorized changes to canonical Work Items, claims, handoffs, resources, lifecycle state, tasks, tracker mappings, learning records, or closeout.

**It does:** inspect the pinned project runtime, resolve current organization state, preview context, and use `node ./templew.mjs` commands so related canonical records and generated views remain consistent.

**It does not:** authorize the implementation itself, hand-edit canonical JSON when the launcher supports the operation, mutate an external tracker without explicit permission, or turn a generated plan into an active worker automatically.

**Example request:**

> Use `$temple-work` to create a bounded Work Item for the approved README change, record its affected paths, and prepare the first safe owner.

**Expected result:** the requested lifecycle mutation is recorded through the repository-pinned CLI, verified, and reported with its Work Item ID and remaining gate.

## Authority stays outside the Skill

A Skill answers “how should this kind of work be approached?” Authority answers “may this actor perform this action here?” Temple keeps those questions separate.

- The human request and project policy define the authorized scope.
- Position and Agent Identity determine responsibility and eligible execution.
- The Work Item lifecycle defines which evidence and approval are needed next.
- A Skill cannot skip any of those boundaries.

## Maintainer and Agent contracts

The operational contracts live in the repository and are written for Agents and maintainers:

- [`temple-init` contract](../../.agents/skills/temple-init/SKILL.md)
- [`decision-interview` contract](../../.agents/skills/decision-interview/SKILL.md)
- [`domain-modeling` contract](../../.agents/skills/domain-modeling/SKILL.md)
- [`project-documentation` contract](../../.agents/skills/project-documentation/SKILL.md)
- [`skill-authoring` contract](../../.agents/skills/skill-authoring/SKILL.md)
- [`temple-work` contract](../../.agents/skills/temple-work/SKILL.md)

For capability discovery, project-owned extensions, and lifecycle status, continue with the [Capability catalog](../extensions/capability-catalog.md), [Skill authoring guide](../extensions/skill-authoring.md), and [Engineering Learning Loop](../extensions/engineering-learning.md).
