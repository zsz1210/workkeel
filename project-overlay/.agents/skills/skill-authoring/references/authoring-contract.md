# Repository Skill authoring contract

Use this contract to design or audit a repository-local Skill. Apply only the sections relevant to the current request; the checklist is a quality boundary, not a reason to create unnecessary files.

## 1. Confirm that a Skill is the right artifact

A Skill is justified when a repeated situation benefits from a distinct decision procedure that changes how an Agent works. It should improve routing, safety, reliability, or completion evidence beyond what a capable Agent would already do.

Do not create a Skill merely to hold:

- a Position's standing responsibility;
- product facts, architecture state, or domain vocabulary that belong in canonical project documents;
- generic writing or coding advice;
- a single incident, workaround, fixture prerequisite, or personal preference;
- behavior that should be implemented as a deterministic CLI or repository check;
- several unrelated procedures grouped under a broad name.

When the fit is uncertain, document the proposed trigger and at least two bounded cases. Keep the idea as a candidate until repeated evidence supports it.

## 2. Classify lifecycle ownership

Inspect the target repository before editing.

- **Organization-managed:** the exact file path appears in `temple.lock.managed_files`. Do not edit it as a project extension. Changes belong in the managing source repository and its release workflow.
- **Project-owned:** the path is absent from `managed_files` and the repository establishes local ownership. Place a new extension under `.agents/skills/<skill-name>/` without changing the lock.
- **External source:** copied, adapted, or referenced material retains its upstream provenance and license obligations. Its lifecycle may still be project-owned; external origin does not make it organization-managed.

Lock membership is the decisive managed-file signal. A broad directory label is not permission to overwrite an exact managed entry. If a desired name or path already exists, stop and ask for a different name or an explicit maintainer workflow.

## 3. Define the behavioral contract

Before writing instructions, establish:

| Contract element | Required decision |
|---|---|
| Purpose | What repeated outcome improves because this Skill exists? |
| Positive trigger | Which user requests or repository conditions should route here? |
| Neighboring non-trigger | Which plausible request belongs elsewhere or needs no Skill? |
| Authority | What may be read, proposed, changed, or performed externally? |
| Inputs | What is the smallest authoritative evidence set? |
| Workflow | Which non-obvious decisions or invariants change behavior? |
| Output | What artifact, result, or evidence should exist? |
| Completion | What observable condition means stop? |
| Failure behavior | What missing evidence, permission, or dependency blocks progress? |
| Dependencies | Which tools, services, runtimes, or other Skills are genuinely required? |
| Provenance | Is the content original, independently implemented from inspiration, adapted, copied, or externally referenced? |

Do not encode authority through implication. A request to inspect, explain, diagnose, or audit is read-only unless the user or an authorized work item explicitly includes changes. Approval to author a Skill does not authorize performing the Skill's target operation.

Completion and evidence claims must remain inside the declared capability scope. Passing one Skill-specific check does not establish whole-feature, whole-release, security, or production readiness unless those broader claims are explicitly in scope and supported by their own evidence.

## 4. Write for accurate discovery

Use a lowercase hyphenated name no longer than 64 characters, and make the folder name match the frontmatter `name`.

The frontmatter must include a concise `name` and a discriminating `description`. The description should say what the Skill does and when it applies. Add a non-trigger when a neighboring capability could plausibly capture the same request. Do not list every workflow detail in the description.

Keep the body focused on instructions that change a decision, action, safety boundary, or completion check. Assume the Agent already knows ordinary software and writing practices. Avoid background essays, repeated global policy, speculative edge cases, and examples that do not clarify routing.

## 5. Use progressive disclosure deliberately

A minimal Skill contains only `SKILL.md`. Add supporting resources only for a concrete reason:

- `references/` for substantial schemas, policies, domain rules, or mode-specific procedures that are not needed on every invocation;
- `scripts/` for deterministic repeated operations whose automation improves reliability;
- `assets/` for material copied into generated output rather than loaded as instructions;
- supported Agent metadata only when the target environment and requested behavior require it.

Link every reference from `SKILL.md` or another reachable resource and state when it should be read. Keep information in one authoritative location. Do not create empty directories, placeholder examples, a Skill-local README, a changelog, or an installation guide without a packaging requirement.

Run every new or changed script against a representative input. State its inputs, outputs, side effects, and failure behavior. Do not hide network access, credentials, external mutation, or expensive operations behind a helper.

## 6. Declare dependencies and failure behavior

Name only dependencies the workflow actually requires. For each one, identify:

- what capability it provides;
- how availability is established without exposing secrets;
- whether a safe fallback exists;
- what the Skill must report and where it must stop when unavailable.

Do not assume another Skill, plugin, service, subagent, or command exists merely because the authoring environment has it. Keep the Skill self-contained unless the dependency is part of the target environment's supported contract.

## 7. Preserve provenance and license boundaries

Classify external influence accurately:

- **Original:** written from project requirements without copying external implementation text.
- **Inspired, independently implemented:** sources informed concepts, but the instructions were written for this repository's workflow without copying source text.
- **Adapted or copied:** source text or a substantial portion was modified or included locally.
- **Externally referenced:** the repository points to a dependency without distributing its source.

For external material, record the source URL, immutable revision or version, license, copyright or notice obligations, local adoption state, and whether changes were made. Preserve required notices with distributed copies. If the license is missing, unclear, or incompatible with the intended distribution, do not copy the material.

Do not place long provenance history in the model-facing entrypoint unless it changes runtime decisions. Use the repository's third-party notice or capability registry when one exists, and report when no suitable record is available.

## 8. Design routing and authority scenarios

Provide a small scenario set that exercises meaningful behavior:

1. A positive request that should invoke the Skill.
2. A neighboring request that should not invoke it.
3. A read-only request that must not mutate the repository.
4. An authorized mutation case when the Skill supports changes.
5. A missing dependency, evidence, or permission case that must stop safely.
6. A completion case showing the observable stopping condition.

Compare the description with every installed neighboring Skill, not only with the intended scenario. Static fixtures can verify names and expected routing contracts, but they do not demonstrate that a model selects or follows the Skill correctly.

## 9. Apply the validation ladder

Validate in increasing order of cost:

1. **Structure:** frontmatter parses; name and folder agree; required files exist; links stay inside the intended tree and resolve; no scaffold placeholders remain.
2. **Contract:** trigger, non-trigger, authority, dependencies, failure behavior, and completion are explicit.
3. **Scenario consistency:** positive, negative, authority, blocker, and completion cases match the description and neighboring Skills.
4. **Repository checks:** run the repository's existing verification commands when available. Do not invent a dedicated Skill command.
5. **Forward test:** use the Skill on a realistic request with minimal raw evidence and inspect the actual outcome.
6. **Repeated use:** preserve results from more than one bounded real case before treating a local workaround as reusable.

Structural validation, scenario fixtures, author review, independent forward testing, and Independent QA are different evidence classes. Report each accurately.

## 10. Forward-test without teaching the answer

Use an independent evaluator only for a sufficiently complex or risky Skill and only when delegation is available and authorized. Give it the Skill, a realistic user request, and the minimum raw artifacts. Do not include the expected answer, suspected flaw, proposed correction, or earlier conclusions unless the task genuinely requires them.

Use an isolated temporary workspace for generated artifacts. Keep side effects inside the authorized boundary, and request approval before any live, external, costly, or irreversible action. Review the outcome and change the Skill only in response to observed behavior.

## 11. Current limits

- Do not assume this repository provides dedicated commands to create, validate, list, test, install, adopt, remove, publish, or promote Skills.
- Do not edit `temple.lock` by hand to register a project-owned Skill.
- Do not claim automatic dependency resolution, provenance verification, model-routing evaluation, or third-party update management.
- Official pack packaging may not support every supporting resource used by a project-owned Skill. Verify the current pack schema before proposing distribution.
- A validated project Skill remains project-owned. Promotion to an official pack or core capability requires a separate maintainer decision, provenance and license review, real-project evidence, packaging and upgrade tests, and explicit authorization.

Finish authoring with an evidence report rather than an implied promotion.
