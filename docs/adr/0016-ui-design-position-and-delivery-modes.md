# ADR-0016: Own UI design explicitly and scale its artifacts by risk

- Status: Accepted
- Date: 2026-08-29

## Context

The framework assigns UX flow, interaction states, and usability risk to UX Designer, but it does not explicitly own visual hierarchy, layout, component treatment, design-system guidance, or the decision to create a pre-implementation visual artifact. This leaves UI choices implicit in Developer work and makes the process unclear at both ends of the scale: a small project may be burdened by unnecessary mockups, while a larger or brand-sensitive project may begin implementation without an approved visual source.

The framework must define responsibility and required evidence without making Figma or any other design tool a universal dependency.

## Decision

### Add UI Designer as a stable Position

UI Designer owns visual direction, layout and hierarchy, UI specifications, design-system guidance, and selection of a proportionate UI delivery mode. UX Designer continues to own user flow, information and interaction structure, behavior, copy decisions, and UX risks.

The lean configuration still uses five Agent Identities. The Product Design Identity initially holds Product Manager, UX Designer, and UI Designer. A larger project may later assign UI Designer to a separate Identity without changing the Position vocabulary or historical work.

### Use three delivery modes

- **Code-first:** no separate pre-implementation visual artifact is required. The work still needs a UI brief, required-state coverage, and runtime visual review.
- **Preview-first:** a wireframe, code preview, prototype, or equivalent artifact is reviewed before full implementation.
- **Design-led:** an approved, versioned design source and implementation mapping are required for brand-sensitive, high-rework-cost, or multi-party work.

The selected mode is recorded in a project-owned UI design brief for the work item. A future project profile may provide a default and a work-item override; this release does not add that CLI or schema field yet.

### Define evidence, not a mandatory tool

Figma, SwiftUI Preview, Storybook, HTML prototypes, annotated screenshots, Markdown specifications, and future tools are all valid when they satisfy the selected mode's evidence contract. The framework requires provenance, relevant states, accessibility and device considerations, approval where needed, and runtime comparison; it does not require one vendor.

### Migrate existing projects deterministically

Upgrade preserves any existing active UI Designer Assignment. When none exists, it assigns UI Designer to the single active UX Designer Agent Identity. If that owner cannot be identified unambiguously, upgrade stops without changing project state.

## Consequences

- UI decisions no longer become an implicit Developer responsibility.
- Lightweight projects can keep implementation-first speed without skipping visual accountability.
- Larger projects can require an approved design source without making that process universal.
- The core organization grows from nine to ten Positions while retaining five initial Agent Identities.
- Figma remains an optional tool or future adapter rather than a core runtime dependency.
- Project-profile defaults, work-item UI-mode fields, design-source adapters, and automated visual comparison remain future capabilities.
