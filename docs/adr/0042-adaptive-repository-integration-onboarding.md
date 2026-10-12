# ADR-0042: Adapt first-run guidance to the project's repository workflow

## Status

Status: Accepted for compatibility design.

## Context

Temple needs enough repository-integration context to keep AI work inside the project's real delivery process. Temple's own maintainers currently use GitHub Flow, but adopters may use GitLab Flow, trunk-based development, release branches, direct integration in a small project, or an internal enterprise process. Making Temple's workflow the adopter's default would confuse framework development policy with product-project policy.

The previous initialization flow confirmed Agent Identity names and Position mappings but did not durably record how changes should reach the project's integration target. Asking every possible workflow question up front would create a long questionnaire even when `CONTRIBUTING.md`, CI configuration, or repository state already answered most of them. Inferring a workflow from a default branch alone could authorize the wrong behavior.

## Decision

Add the project-owned `.ai-org/project/repository-integration.json` contract. It records a minimal routing summary: confirmation state, source and policy references, integration target, change-isolation expectation, review gate, and confirmation provenance. The referenced project policy remains authoritative; the record is not a duplicate policy document or a permission grant.

During AI-assisted initialization, `$temple-init` inspects repository-local evidence first. When that evidence is sufficient, it cites and summarizes the policy. When an execution-relevant choice is still missing, it asks only for that choice. Agent Identity mappings and the integration summary appear in one pre-write confirmation. The Skill does not contact a repository provider, change hosting settings, or assume merge, release, deployment, or publication authority.

Omitting the document from a manual init configuration produces an exact `unconfirmed` default. This is a warning and routing signal, not an installation failure and not permission to integrate directly. An intentional postponement uses `deferred` with provenance and a summary that states the decision trigger. A `confirmed` record must resolve change isolation and the review gate, but it may defer detailed mechanics to the referenced project policy through `project-defined`.

Temple upgrades create the missing default atomically and preserve every existing project-owned record byte for byte. The file is schema-validated, visible in `doctor` and `status`, excluded from `temple.lock.managed_files`, and read by installed Agent instructions.

## Consequences

- First-time users receive guidance that adapts to an existing or new repository without facing a fixed enterprise questionnaire.
- Temple can remind Agents how to isolate and integrate work without imposing GitHub Flow or another vendor-specific process.
- A project can change its workflow by updating one project-owned routing record and its authoritative policy; framework upgrades do not overwrite either decision.
- Manual CLI initialization remains deterministic and safe when no AI performs discovery: the unknown state stays explicit until it matters.
- The contract does not prove that hosting protections exist or that humans followed the policy. Those claims still require provider or repository evidence.

## Rejected alternatives

- Require GitHub Flow for every Temple project.
- Infer integration permission from the current branch or hosting provider.
- Ask a complete workflow questionnaire before every initialization.
- Store no durable result and repeat the same questions in later conversations.
- Copy the full company policy or credentials into Temple project state.
