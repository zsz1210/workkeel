# Extension and migration contracts

Temple separates framework-owned extension definitions from project-owned state. Alpha.19 versions both boundaries so an upgrade can explain what it understands without taking ownership of project content.

## Pack manifest v2

An official optional pack uses `temple.pack/v2`. Its manifest declares:

- every managed Skill entrypoint, reference, script, and asset;
- pack dependencies and whether they are bundled, external, or merely required at use time;
- source and license provenance;
- compatible Temple and runtime versions; and
- whether the pack is enabled by default.

Install, upgrade, and removal compare the complete declared file set and checksum every managed file. A project file at a new managed path is a collision even when its bytes happen to match. Temple never silently adopts it.

The Build Quality pack is the reference implementation. Its TDD Skill includes a referenced evidence contract, a local validator, and an example test-observation asset. The script validates supplied JSON; it does not run the recorded command or prove that the observation is truthful.

## Runtime JSON Schema validation

The managed schema catalog maps canonical and generated JSON documents to Draft 2020-12 schemas:

```bash
node ./templew.mjs schema validate .
node ./templew.mjs schema validate . --json
```

Failures identify the document, schema, instance path, schema path, keyword, and message. Domain validators still enforce rules that depend on several documents, repository paths, Git state, or Position relationships. JSON Schema is structural evidence, not the entire governance model.

## Migration registry

`.ai-org/core/migrations.json` is the managed migration registry. `temple.lock` records which entries were applied and whether each was a fresh baseline or an upgrade migration.

```bash
node ./templew.mjs migration plan . --json
node ./templew.mjs upgrade . --dry-run
node ./templew.mjs upgrade .
```

An upgrade may install framework files and create a missing empty project-owned seed. It does not rewrite existing project-owned content merely because a schema evolved. For example, Learning v1 remains readable; `learning migrate` is the explicit mutation that upgrades that index to v2.

## Ownership and compatibility rules

1. A manifest declares files; it does not make third-party code trustworthy or authorize execution.
2. A migration record explains an applied state change; it is not distributed database coordination.
3. Project-owned Skills, learning, adapters, Work Items, evidence, and artifacts remain outside the managed checksum set unless their exact paths were installed by an official pack.
4. Managed collisions, incompatible versions, invalid schema documents, and digest drift stop before silent takeover.
5. Every adapter or pack may narrow authority, but none may grant release, external-action, or Position authority.

See [ADR-0024](../adr/0024-version-extension-contracts-and-migrations.md) for the decision rationale.
