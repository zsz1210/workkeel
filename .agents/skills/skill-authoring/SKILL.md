---
name: skill-authoring
description: Design, create, revise, or audit a repository-local Skill with precise routing, authority, dependencies, provenance, and observable completion. Use when the user asks to turn a reusable procedure into a Skill; do not use to perform the target procedure, install external packages, edit ordinary Agent instructions, or promote a Skill into an official distribution.
---

# Skill Authoring

Turn a repeated, non-obvious procedure into a narrow repository capability without expanding the user's request or creating a competing source of truth.

## Route the request

- Use this Skill only for authoring, revising, or auditing a Skill. If the user wants the target work performed, perform that work through its normal workflow instead.
- First decide whether the proposed behavior is a reusable decision procedure. A Position responsibility, project fact, generic instruction, one-time workaround, or missing tool feature is not a Skill by itself.
- Inspect existing Skill names and descriptions before choosing a name. Avoid overlapping triggers and catchall capabilities.

## Establish ownership and authority

- Treat inspection, classification, and a proposed design as read-only by default. Create or edit files only when the request authorizes Skill changes.
- If `temple.lock` exists, inspect its exact `managed_files` entries. Do not modify a target path listed there. An unlisted path may be project-owned, but confirm its contents and provenance before editing it.
- Stop on a name or path collision. Do not resolve it by editing `temple.lock`, replacing a managed Skill, or silently choosing ownership.
- This Skill does not authorize installation, publication, lifecycle mutation, external communication, spending, or irreversible actions.

## Author the Skill

Before writing or materially revising a Skill, read [references/authoring-contract.md](references/authoring-contract.md) and apply the relevant contract.

Keep the entrypoint as short as the capability permits. Put only routing, essential constraints, the useful workflow, and completion conditions in `SKILL.md`. Add references, scripts, or assets only when repeated use materially benefits from them.

Record dependencies and missing-dependency behavior explicitly. For external inspiration or adapted material, verify provenance and license before copying; unknown or incompatible terms are a blocker, not permission to paraphrase source text closely.

## Validate and finish

- Perform structural checks, routing and authority scenarios, and a manual overlap review. These checks do not prove real model behavior.
- Forward-test a complex or risky Skill only when delegation is available and authorized. Use a realistic request and isolated temporary workspace, and do not provide the evaluator with the intended answer.
- Do not claim Independent QA from a static scenario or an author self-review.
- Do not auto-install, publish, promote, or register the Skill, and do not invent unavailable Skill-management commands.

Finish by reporting the ownership classification, changed paths, trigger and non-trigger, authority boundary, dependencies, provenance, validation evidence, forward-test status, and unresolved limitations.
