import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { walkFiles } from "../src/files.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTERNAL_LINK = /^(?:[a-z][a-z0-9+.-]*:|#)/i;

/**
 * Classifies each line of a Markdown source as prose or fenced code. Fences open
 * with ``` or ~~~ and may sit inside block quotes and list items. A fence closes
 * on a line with at least as many of the same character and nothing else, or
 * when its container ends: a line with fewer quote markers, or a nonblank line
 * indented less than a list fence. `inner` is the line without its quote
 * markers and leading indentation.
 */
export function markdownLines(markdown) {
  const result = [];
  let fence = null, listContent = 0;
  for (const line of markdown.split("\n")) {
    const prefix = /^((?:[ \t]*>)*)([ \t]*)/.exec(line), depth = (prefix[1].match(/>/g) ?? []).length;
    const indent = prefix[2].replace(/\t/g, "    ").length, inner = line.slice(prefix[0].length);
    if (fence && (depth < fence.depth || fence.indent && inner.trim() && depth === fence.depth && indent < fence.indent)) fence = null;
    if (fence) {
      const close = /^(`{3,}|~{3,})\s*$/.exec(inner);
      if (close && close[1][0] === fence.marker[0] && close[1].length >= fence.marker.length) { fence = null; result.push({ text: line, inner, code: false, fence: true }); }
      else result.push({ text: inner, inner, code: true, fence: false });
      continue;
    }
    const open = /^((?:[-*+]|\d+[.)])[ \t]+)?(`{3,}|~{3,})(.*)$/.exec(inner);
    if (open && !(open[2][0] === "`" && open[3].includes("`"))) {
      // A fence in a list item, or indented under one, ends with that item.
      const listIndent = open[1] ? indent + open[1].length : listContent && indent >= listContent ? listContent : indent >= 4 ? indent : 0;
      fence = { marker: open[2], depth, indent: listIndent };
      result.push({ text: line, inner, code: false, fence: true });
      continue;
    }
    // Remember the content indent of the current list item; unindented prose ends the list.
    const item = /^((?:[-*+]|\d+[.)])[ \t]+)/.exec(inner);
    if (item) listContent = indent + item[1].length;
    else if (inner.trim() && indent === 0) listContent = 0;
    result.push({ text: line, inner, code: false, fence: false });
  }
  return result;
}

/** The prose of a Markdown source: fenced code and inline code spans removed. */
function proseOnly(markdown) {
  return markdownLines(markdown).map(line => line.code || line.fence ? "" : line.text).join("\n").replace(/`[^`\n]*`/g, "");
}

export function extractLocalLinks(markdown) {
  const withoutCode = proseOnly(markdown);
  const targets = [];
  for (const match of withoutCode.matchAll(/!?\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\)/g)) {
    const raw = match[1].startsWith("<") ? match[1].slice(1, -1) : match[1];
    if (!EXTERNAL_LINK.test(raw)) targets.push(raw);
  }
  return targets;
}

/** Same-file fragment links such as [Section](#section), outside code. */
export function extractFragmentLinks(markdown) {
  return [...proseOnly(markdown).matchAll(/!?\[[^\]]*\]\((<#[^>]*>|#[^)\s]*)(?:\s+["'][^"']*["'])?\)/g)]
    .map(match => match[1].startsWith("<") ? match[1].slice(1, -1) : match[1]);
}

/** The heading anchor GitHub generates for one heading's text. */
export function headingSlug(text) {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
}

/** Every anchor a Markdown file defines: heading slugs (numbered when repeated, as GitHub does) and HTML id or name attributes. */
export function markdownAnchors(markdown) {
  const anchors = new Set(), counts = new Map(), classified = markdownLines(markdown);
  // Headings are read without quote markers, so "> ## Title" defines an anchor too.
  const lines = classified.map(line => line.code || line.fence ? "" : line.text.replace(/^(?:[ \t]*>)+ ?/, ""));
  const add = (slug) => {
    const count = counts.get(slug) ?? 0;
    counts.set(slug, count + 1);
    anchors.add(count ? `${slug}-${count}` : slug);
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (classified[i].code || classified[i].fence) continue;
    for (const match of line.matchAll(/<[a-z][^>]*\s(?:id|name)=["']([^"']+)["']/gi)) anchors.add(match[1]);
    const atx = /^ {0,3}#{1,6}(?:\s+(.*?))?(?:\s+#+)?\s*$/.exec(line);
    if (atx) { add(headingSlug(atx[1] ?? "")); continue; }
    // A setext heading: one line of text underlined with = or -.
    const underline = /^ {0,3}(?:=+|-+)\s*$/.test(lines[i + 1] ?? "");
    if (underline && line.trim() && !/^ {0,3}(?:[-*+>|]|\d+[.)]\s)/.test(line) && !/^ {4}/.test(line)) add(headingSlug(line));
  }
  return anchors;
}

export function resolveLocalLink(sourceFile, target) {
  const withoutFragment = target.split("#", 1)[0].split("?", 1)[0];
  if (!withoutFragment) return null;
  return path.resolve(path.dirname(sourceFile), decodeURIComponent(withoutFragment));
}

/** The decoded fragment of a link, or null when it has none. An empty fragment ("#") names the top of the page. */
export function linkFragment(target) {
  const index = target.indexOf("#");
  if (index < 0 || index === target.length - 1) return null;
  const raw = target.slice(index + 1);
  try { return decodeURIComponent(raw); } catch { return raw; }
}

// Git-ignored Markdown (for example .workkeel-private/) is local state, not
// documentation. Outside a Git repository nothing is treated as ignored.
export function gitIgnoredFiles(directory, files) {
  if (files.length === 0) return new Set();
  const result = spawnSync("git", ["-C", directory, "check-ignore", "--stdin", "-z"], { input: files.join("\0"), encoding: "utf8" });
  return result.status === 0 ? new Set(result.stdout.split("\0").filter(Boolean)) : new Set();
}

export async function findBrokenLinks(markdownRoot = root) {
  const failures = [];
  const candidates = (await walkFiles(markdownRoot)).filter(
    (candidate) =>
      candidate.endsWith(".md") &&
      !candidate.startsWith(".git/") &&
      !candidate.startsWith("node_modules/")
  );
  const ignored = gitIgnoredFiles(markdownRoot, candidates);
  const anchorCache = new Map();
  const anchorsOf = async (file) => {
    if (!anchorCache.has(file)) anchorCache.set(file, markdownAnchors(await fs.readFile(file, "utf8")));
    return anchorCache.get(file);
  };
  const markdownFiles = candidates.filter((candidate) => !ignored.has(candidate));

  for (const relativeFile of markdownFiles) {
    const sourceFile = path.join(markdownRoot, relativeFile);
    const content = await fs.readFile(sourceFile, "utf8");
    for (const target of extractLocalLinks(content)) {
      const resolved = resolveLocalLink(sourceFile, target);
      if (!resolved) continue;
      try {
        await fs.access(resolved);
      } catch {
        failures.push(`${relativeFile} -> ${target}`);
        continue;
      }
      const fragment = linkFragment(target);
      if (fragment !== null && resolved.endsWith(".md") && !(await anchorsOf(resolved)).has(fragment)) failures.push(`${relativeFile} -> ${target} (no such heading anchor)`);
    }
    for (const target of extractFragmentLinks(content)) {
      const fragment = linkFragment(target);
      if (fragment !== null && !(await anchorsOf(sourceFile)).has(fragment)) failures.push(`${relativeFile} -> ${target} (no such heading anchor)`);
    }
  }

  return failures;
}

async function main() {
  const failures = await findBrokenLinks();
  if (failures.length > 0) {
    console.error(`Documentation link checks failed:\n- ${failures.join("\n- ")}`);
    process.exitCode = 1;
    return;
  }
  console.log("Documentation link checks passed.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
