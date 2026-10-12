# UI Interaction Contract

- UI Contract ID:
- Feature Spec ID and path:
- Work item:
- Status: `draft | approved | superseded | archived`
- Contract path: `not-applicable | code-first | preview-first | design-led`
- UX Designer Position owner:
- UI Designer Position owner:
- Frontend owner:
- API contract owner:
- Backend owner:
- Integration owner:
- Authoritative location:
- Source revision:
- Source content SHA-256, when repository-native and approved:
- Visual artifact path or URL, when applicable:
- Visual artifact revision:
- Approved by, when required:
- Approved at, when required:
- Approval record reference, when required:

## Applicability and selected path

Explain why the interaction contract is not applicable or why code-first, preview-first, or design-led evidence is proportionate to the risk. `not-applicable` means no user-facing or operator-facing interaction changes; it does not remove a required API, event, data, or backend contract.

The selected tool is optional. A design file, including a Figma file, is authoritative only for the explicitly named decisions and revision recorded here.

## User goal and journey

- User or operator:
- Starting context:
- Goal:
- Entry points:
- Completion:
- Cancel, back, resume, and recovery paths:

## Screen-state-action-error mapping

| Surface | User state | Action or event | Frontend response | API or service operation | Backend rule or transition | Error and recovery | Owner | Acceptance evidence |
|---|---|---|---|---|---|---|---|---|

## State inventory

- Initial, empty, loading, ready, editing, submitting, success, and partial-success states:
- Validation, authorization, permission, conflict, rate-limit, offline, timeout, and unexpected-error states:
- Duplicate action, stale data, retry, cancellation, and resume behavior:

## Content, accessibility, and variants

- User-facing copy and terminology source:
- Keyboard and focus behavior:
- Screen-reader semantics:
- Contrast and motion requirements:
- Localization and content-length cases:
- Responsive, platform, and device variants:

## API and backend contract references

| Contract | Path or URL | Revision | Owner | Success semantics | Failure semantics | Compatibility boundary |
|---|---|---|---|---|---|---|

## Parallel delivery slices

| Slice | Position and Discipline | Dependencies | Affected paths | Contract revision | Evidence | Integration owner | Readiness |
|---|---|---|---|---|---|---|---|

Parallel work requires stable shared contracts, explicit dependencies, bounded affected paths, and a named integration owner. Sequence or block work when those conditions are not satisfied.

## Verification

- UX review evidence:
- UI and visual review evidence:
- Frontend test and runtime evidence:
- API or backend contract evidence:
- Cross-layer evaluation evidence:
- Independent QA evidence:
- Integrated candidate revision reference:

## Unresolved and change control

| Decision or change | Owner | Status | Blocks | Affected slices | Required re-verification |
|---|---|---|---|---|---|

A material behavior, state, schema, error, recovery, or visual-authority change creates a new contract revision and requires affected Work Items to recheck readiness.
