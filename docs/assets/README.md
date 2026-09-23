# Documentation assets

The current Workkeel README uses two independently authored diagrams:
`workkeel-workflow.mmd` and `workkeel-architecture.mmd`, each with a `-mobile`
source. They use established workflow/runtime terms and omit historical migration
details. Regenerate their SVGs using the pinned Mermaid CLI below, with the source
glob `docs/assets/workkeel-*.mmd`. Use an installed browser through
`PUPPETEER_EXECUTABLE_PATH`; no browser download is needed. Check both light/dark
README backgrounds and desktop/narrow layouts before delivery.

    for source in docs/assets/workkeel-*.mmd; do
      PUPPETEER_SKIP_DOWNLOAD=true npx --yes @mermaid-js/mermaid-cli@11.10.1 \
        -i "$source" -o "${source%.mmd}.svg" -b '#ffffff'
    done

## Retained compatibility diagrams

The Temple delivery diagrams in this directory are static README assets generated from the adjacent Mermaid source files.

- `temple-delivery-path.<locale>.mmd` is the desktop source.
- `temple-delivery-path.<locale>-mobile.mmd` is the narrow-layout source.
- Earlier README revisions used these assets; current entrypoints use Workkeel diagrams.
- Historical localized versions remain available for compatibility documentation.

Regenerate all six SVGs with the pinned authoring tool:

    for source in docs/assets/temple-delivery-path.*.mmd; do
      npx --yes @mermaid-js/mermaid-cli@11.10.1 \
        -i "$source" \
        -o "${source%.mmd}.svg" \
        -b transparent
    done

Mermaid is an authoring-only tool. It is not a Temple runtime dependency and is not installed by default. After regeneration, validate the SVG files and inspect the rendered READMEs at desktop and narrow widths.
