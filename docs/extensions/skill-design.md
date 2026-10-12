# Skill design policy

This maintainer policy applies when Temple adds or changes a core Skill or official pack. Project authors should start with [Extending a project with Skills](skill-authoring.md) and the installed `$skill-authoring` Skill. The rules below turn useful ideas behind `writing-great-skills` and the linked talk into project-specific maintenance rules without copying or vendoring their implementation.

## Design rules

1. **One capability, one distinct trigger.** A Skill should represent a reusable decision procedure, not a role, project, or collection of vaguely related advice.
2. **Descriptions must discriminate.** State what situation should trigger the Skill and when it should not. Every model-invoked description consumes recurring context.
3. **Every instruction must change behavior.** Remove background prose that does not affect a decision, action, safety boundary, or completion check.
4. **Use high-signal vocabulary.** Prefer established terms such as ubiquitous language, invariant, test seam, or deep module when they compress a real concept. Define project-specific meanings in the domain glossary.
5. **Make completion observable.** Name the repository artifact, evidence, unresolved state, or verification needed before the Skill can finish.
6. **Keep authority explicit.** A Skill never expands permission to implement, publish, message externally, spend money, or perform an irreversible action.
7. **Prefer progressive disclosure.** Keep the installed Skill concise; move optional examples or technology-specific procedures into referenced resources only when repeated use justifies them.
8. **Classify distribution and ownership.** Core Skills follow every project, official packs are installed deliberately, project and third-party extensions remain project-owned, and maintainer guidance stays in the central repository.
9. **Do not turn every pilot friction into a Skill.** First decide whether the behavior is a reusable procedure, a Position responsibility, a CLI defect, or a one-time fixture prerequisite. A successful pilot can finish without installing another Skill.

## Review checklist

- Does the description distinguish this Skill from neighboring Skills?
- Can a later Agent tell which files are authoritative?
- Are facts, assumptions, decisions, and unknowns kept separate?
- Is project-owned state preserved across upgrades?
- Are dependencies, provenance, license, and required tools visible?
- Is there a concrete completion boundary?
- Has the Skill passed structural validation and a realistic scenario test?
- Did more than one bounded case demonstrate a reusable trigger, or is this still a one-off workaround?

Structural checks and scenario-contract checks are necessary but do not prove model routing behavior. Record real project forward tests separately and do not label a designed scenario as independent QA evidence.

See [Skill scenario matrix](skill-scenarios.md) for the current routing, authority, and completion contract.

## Promotion gate

A project extension is not automatically a Temple capability. Promotion into core or an official pack requires repeated cross-project evidence, a distinct trigger, provenance and license review, an ADR, scenario coverage, packaging support, and install, remove, re-init, and upgrade tests. Transfer of ownership must be explicit; matching file contents do not authorize silent adoption.

## Sources of inspiration

- Matt Pocock Skills repository, pinned review commit `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`: <https://github.com/mattpocock/skills/tree/6654f6b60cd9d5be8b54c6fafe44346dabeb3b76>
- `writing-great-skills`: <https://skills.sh/mattpocock/skills/writing-great-skills>
- `writing-for-agents`: <https://skills.sh/mattpocock/skills/writing-for-agents>
- Talk discussed by the project owner: <https://www.youtube.com/watch?v=aR97E7aKEgg&t=691s>

These sources inform principles and vocabulary. Temple's distributed Skills are independently written for its own canonical-state and lifecycle model.
