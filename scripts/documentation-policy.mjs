// Shared by repository verification and explicit delivery evidence preflight.
// Exact accepted paths remain exceptions; suffixes do not grant localization.
const localizedDocumentation = new Set([
  'README.md',
  'README.ja.md',
  'README.zh-TW.md'
]);

export function documentationLanguageIssue(relativePath, content) {
  if (!relativePath.endsWith('.md') || localizedDocumentation.has(relativePath)) return null;
  // Preserve exact UI labels and filenames quoted in English prose.
  const prose = content.replace(/`[^`\r\n]+`/g, '');
  return /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(prose)
    ? `${relativePath} contains CJK text; non-localized documentation must use English`
    : null;
}
