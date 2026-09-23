# Current-content and distribution audit

Developer audit, 2026-09-23 UTC; release/publication is not authorized.

- Current entrypoints: root README in three languages, Workkeel CLI and generated
  WORKKEEL instructions, quick start, task-contract/architecture/terminology,
  workflow and context guides, documentation/ADR/validation/asset indexes.
  Removed obsolete “planning only” claims from the new runtime path, corrected
  automatic-versus-manual Headroom wording, and separated native Claude onboarding
  from a nonexistent automatic Claude runtime. New public content uses Workkeel.
- Vocabulary search covered `src`, `docs` and `project-overlay`: 317 files contain
  historical or compatibility terms. They are not 317 obsolete files. Legacy
  schemas, template identifiers, CLI aliases and recorded evidence remain live
  compatibility/history interfaces; bulk replacement would break them. Existing
  old-mode guides are explicitly scoped as compatibility material. Current terms
  map to state machines, graph orchestration, feedback loops, model routing and
  context engineering, with domain-specific names explained rather than renamed
  blindly. Canonical domain glossary has the current concepts and invariants.
- No historical artifacts, failed qualification attempts, product tests or
  compatibility assets were deleted. No duplicate runtime/UI framework was added.
  The separate test-slimming work and test runner remain unchanged.
- Actual npm dry run: 490 distributable files, exactly 21 additions over the
  reviewed 469-file baseline: nine modules, four guides/ADR and eight diagram
  assets. WI-0261 requires each path. Original forbidden roots and 8 MiB ceiling
  remain unchanged. Package/publication boundary check passed.
- OSS closure is listed in THIRD_PARTY_NOTICES: pinned optional LangGraph family
  and Zod, transitive licenses, separate tool authoring, external Headroom,
  existing Archify copy, and no vendored LiteLLM Enterprise code. License notices
  are preserved with source distributions; this is not a universal legal opinion.
- Whole-repository public-surface audit is **not clean**: 29 inherited
  maintainer-path findings in prior task records/evidence plus an oversized event
  stream, and 111 review-required findings (mostly historical binary artifacts).
  These are not new runtime secrets. They need a separate governed publication
  normalization/review; do not rewrite historical evidence, delete events, or
  declare the whole repository publication-safe from the passing npm boundary.

Final exact-candidate tests and independent judgment are separate evidence.
