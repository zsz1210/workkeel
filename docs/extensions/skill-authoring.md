# Extending a project with Skills

Temple is designed to be extended. An initialized project may add repository-local Skills without changing its Positions, lifecycle, or canonical state model. The extension remains project-owned unless a separate maintainer process promotes it into Temple core or an official pack.

Use the installed `$skill-authoring` Skill when creating, revising, or auditing a repository-local Skill. This guide explains the public contract around that procedure; [Skill design policy](skill-design.md) covers central maintainer decisions.

## Decide whether the idea is a Skill

A good Skill is a reusable, non-obvious decision procedure. It should improve routing, safety, reliability, or completion evidence in a repeated situation.

Do not create a Skill merely to store:

- a Position's standing responsibility;
- project facts, architecture, or domain vocabulary;
- generic advice that does not change behavior;
- a one-time workaround;
- behavior better enforced by deterministic code or a repository check;
- several unrelated procedures under one broad trigger.

When the fit is unclear, preserve the idea as a candidate and write down its trigger plus two bounded examples before installing anything.

Temple can now identify a narrowly qualified candidate and prepare a governed proposal. Run `learning skill-candidates` to inspect the deterministic threshold. A claimed Tech Lead may use `learning propose-skill` during Design to preserve the evidence and routing contract. A Human Principal's `learning decide-skill --decision approve` creates an internal authoring Work Item; it does not create or activate the Skill. Author the Skill only inside that separately governed Work Item.

## Choose the distribution class

| Class | Installed by | Ownership | Update path |
|---|---|---|---|
| Core | `temple init` | Organization-managed | Temple release |
| Official pack | Explicit `temple pack install` | Organization-managed after installation | Pack release |
| Project extension | Project author | Project-owned | Project workflow |
| Third-party extension | Project author or external tool | Project-owned under the current release | Project workflow and upstream review |

Ownership is determined per exact file. A file is organization-managed only when its exact path appears in `temple.lock.managed_files`; the `.agents/skills/` directory is not blanket-owned by Temple. Re-init and upgrade preserve unlisted project files and stop on a future managed-path collision, even when the contents happen to be identical.

## Create a project extension

1. Inspect existing Skill names, descriptions, and `temple.lock.managed_files`.
2. Select a collision-free path such as `.agents/skills/<skill-name>/`.
3. Define the purpose, positive trigger, neighboring non-trigger, authority, dependencies, output, completion condition, and failure behavior.
4. Write a concise `SKILL.md`. Add `references/`, `scripts/`, or `assets/` only when repeated use needs them.
5. Record provenance and license obligations before copying or adapting external material.
6. Validate structure, routing scenarios, authority boundaries, repository checks, and—when the Skill is complex or risky—an isolated forward test.

Do not edit `temple.lock` to register a project extension. Authoring a Skill does not authorize installing dependencies, publishing it, performing its target operation, or promoting it into an official distribution.

## Minimum behavioral contract

Every Skill should make these decisions explicit:

- **Purpose:** what repeated outcome improves.
- **Trigger:** when the Skill should be selected.
- **Non-trigger:** the nearby request that belongs elsewhere.
- **Authority:** what can be read, proposed, changed, or performed externally.
- **Evidence:** the smallest authoritative input set.
- **Workflow:** only the instructions that materially change behavior.
- **Completion:** the observable artifact or result that means stop.
- **Failure behavior:** what missing evidence, permission, or dependency blocks progress.
- **Dependencies:** required tools, services, runtimes, or other supported capabilities.
- **Provenance:** original, independently inspired, adapted, vendored, or externally referenced.

The frontmatter description is a routing contract, not a summary of every step. Keep the entrypoint short and use progressive disclosure for material that is not required on every invocation.

Completion and evidence claims must not exceed the Skill's declared capability scope. A documentation-example check may pass its own verification gate; it cannot claim that the entire release is ready.

## Validation ladder

Validation increases in cost and confidence:

1. **Structure:** valid frontmatter, matching name and folder, reachable references, no scaffold placeholders.
2. **Contract:** explicit trigger, non-trigger, authority, dependencies, blocker, and completion boundary.
3. **Scenarios:** positive, negative, read-only, authorized mutation, blocker, and completion cases agree with neighboring Skills.
4. **Repository checks:** the existing project verification commands pass.
5. **Forward test:** an Agent receives a realistic request and minimal raw evidence in an isolated workspace without being taught the expected answer.
6. **Repeated use:** more than one bounded real case demonstrates that the trigger is reusable.

Structural checks and written scenarios do not prove model routing, and an author's self-review is not Independent QA. Report those evidence classes separately.

## External sources and open source

Before distributing copied or adapted material, record the source URL, immutable revision or version, license, required notices, and local changes. Temple's MIT License covers Temple's original work; it does not replace a third party's license. Missing, unclear, or incompatible terms block copying.

Ideas may inform an independent implementation, but provenance must describe that relationship honestly. Keep runtime instructions focused; store longer attribution in the repository's third-party notice or capability catalog.

## Current limits

The current alpha has no command that writes or activates `SKILL.md`, custom-pack publisher, generic dependency resolver, automated model-routing evaluation, or third-party Skill update manager. It can detect evidence-backed candidates, preserve Skill Proposals, and create a separate authoring Work Item after human approval. It also generates a read-only Capability Registry and can retrieve existing Skills; discovery and proposal approval do not install, publish, activate, or take ownership of a project extension. Official Pack v2 can declare Skill entrypoints, references, scripts, assets, dependencies, provenance, and compatibility. Project extensions may use the same progressive-disclosure structure while remaining project-owned; promotion into an official pack still requires repeated project evidence, an ADR, license review, scenario coverage, and install/remove/upgrade tests.

See [ADR-0013](../adr/0013-governed-skill-extensions.md) for the ownership decision and [Skill scenario matrix](skill-scenarios.md) for the installed routing contract.
