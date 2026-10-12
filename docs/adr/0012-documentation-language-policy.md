# ADR-0012: English canonical documentation with localized README entry points

- Status: Accepted
- Date: 2026-08-29
- Last amended: 2026-08-30

## Context

The toolkit accumulated English, Traditional Chinese, and Japanese across architecture decisions and usage instructions. That made navigation inconsistent and left readers unsure which version was authoritative. Public readers benefit from clear README entry points in three languages.

## Decision

- `README.md` is the canonical English entry point.
- `README.ja.md` and `README.zh-TW.md` are maintained entry points with the same information hierarchy and claims.
- All other toolkit documentation, installed instructions, Skills, templates, changelog entries, contribution guidance, and security guidance use English.
- A change to public README behavior or claims must update all three README variants in the same change.
- Repository checks may reject CJK text in Markdown outside the localized README files. Identifiers, product names written in Latin characters, diagrams, and non-language typography are unaffected.
- This is a policy for the central toolkit. The installed `$project-documentation` Skill follows each target project's own language policy and does not impose multilingual documentation on product repositories.

## Consequences

- Detailed documentation has one canonical language and no longer drifts across isolated partial translations.
- English remains the default GitHub language while Japanese and Traditional Chinese readers retain onboarding visibility.
- Contributors keep the three README variants aligned, but do not need to translate every document.
- A future localization expansion requires a deliberate maintenance decision rather than adding isolated translated files.
