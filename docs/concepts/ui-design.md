# UI design responsibility and delivery modes

For a native Workkeel task with a user-facing interface, make UI design responsibility explicit in the approved brief and acceptance criteria. A separate pre-implementation visual artifact is required only when project risk, collaboration cost, or visual sensitivity justifies it. Work without a user-facing interface records `not-applicable` and does not manufacture UI evidence. Select one of the four delivery modes before implementation and preserve the relevant evidence with the task.

## UX and UI are separate responsibilities

| Responsibility | Covers | Does not certify |
|---|---|---|
| UX design | User flow, information and interaction structure, behavioral states, usability risk, and copy decisions | Implementation quality or release |
| UI design | Visual hierarchy, layout, component treatment, design-system guidance, visual states, and UI delivery mode | Implementation quality or release |

The task coordinator can assign both responsibilities to one executor or delegate them within the approved scope. Native tasks use registered Agent and Principal identities for attribution and authority; they do not require a Position roster or a fixed number of Agents. The task's separation policy still requires an independent reviewer before authorized acceptance.

## Delivery modes

### Not applicable

Use for backend, command-line, library, migration, or infrastructure work with no user-facing interface.

- No UI brief or visual artifact is required.
- The explicit mode prevents missing UI work from being confused with genuinely UI-free scope.
- If scope later adds an interface, select one of the three interface delivery modes before implementation.

### Code-first

Use for low-risk features, exploratory interfaces, internal tools, and inexpensive iteration.

- No separate mockup is required before implementation.
- Record a concise UI brief and required states.
- Follow approved product, platform, and design-system conventions.
- Inspect the executable result and preserve runtime visual-review evidence.

Code-first means implementation is the first visual artifact. It does not mean visual design, accessibility, state coverage, or review is optional.

### Preview-first

Use when layout, interaction direction, or stakeholder understanding should be confirmed before full implementation.

- Produce a wireframe, SwiftUI Preview, Storybook story, HTML prototype, partial Figma design, or equivalent artifact.
- Review required states and important variants.
- Record feedback and the artifact revision.
- Compare the executable result with the accepted preview.

### Design-led

Use for brand-sensitive surfaces, expensive rework, design-system changes, multi-team delivery, or high visual and accessibility risk.

- Use an approved and versioned design source.
- Define components, tokens, states, responsive variants, accessibility, and motion where relevant.
- Record approval and implementation mapping.
- Treat implementation review as verification against the design source, not as approval inferred from the artifact's existence.

## Tool policy

Choose the lightest tool that can produce the required evidence. The framework does not require Figma. Tools and media may include Figma, native code previews, Storybook, browser prototypes, annotated screenshots, or Markdown UI specifications.

Tool choice does not change assigned responsibilities, user authorization, or release gates. A design artifact is evidence and input; it is not proof that the implementation matches it.

Figma is one example, not a privileged format. In code-first delivery the executable implementation is the first visual artifact; the executor responsible for UI design may propose that first version within the approved product scope, UX flow, platform conventions, design system, accessibility requirements, and human approval policy.

Keep the selected mode, required states, and design references in the approved task material and its delivery evidence. A lighter mode or materially different interface scope requires explicit authorization and replanning before implementation continues; it cannot be inferred from an existing artifact. Native task contracts remain immutable, and handoff identifies the exact implementation revision and evidence for review.

## Native task and legacy compatibility boundaries

The native task contract records scope, acceptance criteria, authorization, and verification separation. UI modes and design references belong in its approved supporting material; the native schema does not add the legacy Work Item's dedicated UI-mode or contract-reference fields. Use the [testing guide](../getting-started/testing.md) for executable and browser verification, then the native handoff, independent review, and acceptance gates.

[ADR-0016](../adr/0016-ui-design-position-and-delivery-modes.md) records the earlier Position-based design policy. Its UI Designer installation, five-Identity configuration, UI brief template, machine-readable delivery modes, and Work Item contract-reference gates remain supported for legacy projects and tested in compatibility fixtures. In that workflow, the selected mode and UX/UI/technical contract identities remain pinned from Build onward: only an approved revision of the same contract may be repinned, while a different contract or materially changed scope requires stopping and replanning. Those legacy structures are not setup requirements for a native Workkeel task.

Project-level UI defaults, design-source adapters, design-token synchronization, and automated visual-regression integration remain planned capabilities.
