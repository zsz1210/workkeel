# Documentation assets

Workkeel uses original explanatory diagrams:

- `workkeel-workflow.svg` and `workkeel-workflow-mobile.svg`: the same lifecycle
  in wide and narrow layouts, including risk, exact-commit review and explicit
  approver rework.
- `workkeel-core-optional.svg`: repository files and CLI beside your coding tool,
  with optional parts in dashed boxes.
- `workkeel-architecture.svg` and `workkeel-architecture-mobile.svg`: retained
  four-layer diagrams, still referenced by package checks and existing tests.
- `workkeel-flow.html`: self-contained, offline state animation; play, pause and
  step through native execution, approval, rework, pause, block or cancellation.
  English and Traditional Chinese labels are included. This is a simulation,
  not a monitor; it never reads task data, contacts a service or calls a model.

`scripts/generate-workkeel-diagrams.mjs` is the authoring source for all five
SVGs, including the hand-drawn layouts. Edit the source, then run
`node scripts/generate-workkeel-diagrams.mjs` to regenerate the files, or add
`--check` to verify that they match without writing.

The HTML is its own editable source. Download it or open the cloned file directly
in a browser; no local server or install is needed. GitHub's file view shows its
source, not the interactive page. README uses static SVGs, so its essential
explanation remains visible without JavaScript or animation. Inspect desktop and
mobile layouts, light/dark appearance, keyboard controls and reduced motion.

The stacked-layer organization was inspired by a reader-supplied infographic;
no third-party artwork, icons, branding or diagram text is reproduced. These
assets are repository-authored and covered by the project's MIT license.
