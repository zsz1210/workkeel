---
name: project-documentation
description: Create or update human-facing repository documentation from verified project evidence. Use for README files, setup guides, usage guides, contributor documentation, or documentation indexes whose commands, links, and capability claims must match the repository; do not use for Agent instructions, Skills, product specifications, or generic prose editing.
---

# Project Documentation

Make the repository understandable to its intended human audience without turning the README into an internal design archive.

## Establish the documentation contract

Before writing, identify:

- the intended reader and the task they need to complete;
- the canonical language and any explicitly requested translations;
- the document's scope and the deeper documents it should link to;
- whether the request authorizes repository edits or only a proposed draft.

Follow the repository's language and documentation conventions. Do not invent a multilingual policy or translate unrelated files unless the request or project policy requires it.

## Ground every claim

Read the smallest authoritative evidence set needed for the document, such as package manifests, executable entrypoints, configuration files, tests, release metadata, existing documentation, and current Git state.

- Verify installation and usage commands when the local environment permits it.
- Describe shipped behavior as current only when code or tests support it.
- Label planned, experimental, optional, and externally managed behavior accurately.
- Prefer stable relative links and confirm their targets exist.
- Do not use generated status views or old chat summaries as stronger authority than canonical files.

If evidence conflicts, preserve the discrepancy as an explicit documentation blocker instead of choosing the most convenient version.

## Keep each document focused

For a public README, prefer a concise path through:

1. what the project is and why it matters;
2. prerequisites and the shortest working setup;
3. one representative usage path;
4. the small set of capabilities or concepts needed to evaluate the project;
5. links to detailed guides, architecture, decisions, security, and contribution information.

Move internal lifecycle history, exhaustive architecture, implementation notes, test matrices, and long policy explanations to focused documents. Avoid duplicating the same source of truth across several files.

## Authority boundary

Documentation inspection is read-only by default. Edit files only when the user request or current authorized work item includes documentation changes. This Skill does not authorize product implementation, lifecycle transitions, publication, release, or changes to Agent instructions.

## Verification and completion

Before finishing:

- run or otherwise validate commands that the document tells readers to execute;
- check local links and referenced paths;
- compare capability and compatibility claims with repository evidence;
- keep translations structurally aligned while preserving natural language;
- report anything that could not be verified.

Finish when the intended reader has a short, evidence-backed route to the promised outcome and deeper details remain discoverable without crowding the entry document.
