# ADR-0011: Stop by default when a pilot is complete

- Status: Accepted
- Date: 2026-08-29

## Context

A greenfield pilot illustrated a stop-boundary risk: completion of a bounded
framework trial can be mistaken for authorization to continue developing its
sample application. Passing a release gate within the trial ends only the
approved slice.

This scope drift wastes time and may also make users believe that Temple automatically gained authority to create a new work item, expand the product roadmap, or prepare a release.

## Decision

When a work item is defined as a pilot, example, proof, or template validation:

- The specification must state the experiment purpose, observable stop condition, and excluded follow-on work.
- A release-gate `go` accepts only the bounded experiment; it does not authorize the next product work item.
- After the stop condition is met, the default action is to freeze the sample, return control to the Engineering Manager and user, and write a retrospective.
- New features, a second work item, distribution, or promotion of the sample into a formal product all require a new explicit request.
- The toolkit may preserve anonymized lessons or lessons without private product content, but must not copy code or data from a private pilot repository into the open-source toolkit.

This rule belongs in the project operating contract and shared instructions. The CLI or status output may add a pilot projection later, but that is not a prerequisite for this decision to take effect.

## Consequences

- Completing the lifecycle no longer grants authority for unlimited product expansion.
- Pilot closeout has a clear stop point and retrospective opportunity.
- A user who wants to turn the sample into a product must explicitly define the new goal and risk boundary.
- A greenfield pilot can validate Temple successfully while remaining disposable, private, and non-production.
