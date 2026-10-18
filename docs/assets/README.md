# Documentation assets

Workkeel uses two original explanatory diagrams, each with a narrow-screen SVG:

- `workkeel-workflow.svg`: five task states, review/rework and the separate runner.
- `workkeel-architecture.svg`: agreement, coordination, execution and evidence.
- `workkeel-flow.html`: self-contained, offline state animation; play, pause and
  step through native execution, approval, rework, pause, block or cancellation.
  English and Traditional Chinese labels are included. This is a simulation,
  not a monitor; it never reads task data, contacts a service or calls a model.

Regenerate the four SVGs from the original, dependency-free authoring source:

```sh
node scripts/generate-workkeel-diagrams.mjs
node scripts/generate-workkeel-diagrams.mjs --check
```

The HTML is its own editable source. Download it or open the cloned file directly
in a browser; no local server or install is needed. GitHub's file view shows its
source, not the interactive page. README uses static SVGs, so its essential
explanation remains visible without JavaScript or animation. Inspect desktop and
mobile layouts, light/dark appearance, keyboard controls and reduced motion.

The stacked-layer organization was inspired by a reader-supplied infographic;
no third-party artwork, icons, branding or diagram text is reproduced. These
assets are repository-authored and covered by the project's MIT license.
