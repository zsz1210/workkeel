# ADR-0038: Separate multi-human identity, eligibility, authority, and validation

## Status

Status: Accepted for compatibility design.

## Context

Temple's original Collaborative contract could name Human Principals, sponsor Agent Identities, pool Position members, and record claims. It did not yet model personnel lifecycle, evidence-qualified membership, scoped human authority, bootstrap retirement, configurable recovery, or the distinction between a local collaboration simulation and real independently administered environments. The Team screen also placed one Human Principal above every Position, which looked like a reporting hierarchy and did not fit a company or open-source project with several accountable people.

The framework must continue to work for one person while supporting many contributors. Display names and email addresses are unsuitable as durable authority keys; company titles must not silently grant Temple authority; and repository coordination must not be described as a distributed lock.

## Decision

Use immutable project Principal IDs with `active`, `suspended`, and `inactive` lifecycle states. Duplicate display names are allowed, and email is neither required nor a uniqueness key. A clone-local actor binding is stored under the Git common directory, outside version-controlled project state. It records bounded verification provenance and is not a credential or a claim that Temple authenticated the provider.

Keep Human Principal, Agent Identity, sponsorship, Position, Discipline, Position Membership, default Assignment, Work claim, Human Authority Grant, and Git-hosting permission as separate concepts. A Position may have an unlimited eligible membership pool and at most one default Assignment. Non-default membership begins provisional and requires explicit evidence to qualify.

Use scoped, expiring Human Authority Grants. A temporary Bootstrap Owner may establish the first governance and recovery configuration, but retirement is permanent and requires viable distributed authority and recovery. Recovery trustees and threshold are project configuration, not a fixed team-size rule or hidden backdoor.

Keep Team read-only and divide it into Responsibilities, People & Agents, and Authority. Remove the Human Principal apex. Keep active claims and execution detail in Work. Redact Principal records, sponsorship detail, grants, trustee identities, and local binding data from the private viewer.

Record automated, simulated Collaborative, real Collaborative, representative pilot, and High-Assurance drill gates independently. A local multi-clone drill may pass only the simulated gate. Real Collaborative requires distinct active humans operating independently administered environments.

## Consequences

- Fresh projects use collaboration v2; upgrades preserve existing v1 project state until an explicit migration.
- Solo remains usable with an implicit `human` and a self-asserted local binding.
- Collaborative and High-Assurance claims can require stronger binding evidence without embedding provider credentials.
- Git conflict and recovery tests support only conflict visibility, no silent canonical loss, and recoverability. They do not prove atomic cross-machine claims.
- Real multi-human and High-Assurance validation remain explicit retained gates until their named environments and people are exercised.
- Provider authentication, distributed coordination, HR systems, and remote mutation require separate adapter decisions and evidence.

## Rejected alternatives

- Keying people by display name or email.
- Deriving Temple authority from a company job title.
- Keeping one permanent Human Principal or bootstrap superuser above every team.
- Treating a fixed four-person example as a product rule.
- Promoting pooled membership from self-description, model choice, or Skill possession alone.
- Treating two clones controlled by one person as real Collaborative evidence.
- Claiming that repository mutation locks coordinate separate machines.
