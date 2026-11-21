import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { walkFiles } from "../src/files.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTERNAL_LINK = /^(?:[a-z][a-z0-9+.-]*:|#)/i;

export function extractLocalLinks(markdown) {
  const withoutCode = markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "");
  const targets = [];
  for (const match of withoutCode.matchAll(/!?\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\)/g)) {
    const raw = match[1].startsWith("<") ? match[1].slice(1, -1) : match[1];
    if (!EXTERNAL_LINK.test(raw)) targets.push(raw);
  }
  return targets;
}

/** Same-file fragment links such as [Section](#section), outside code. */
export function extractFragmentLinks(markdown) {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  return [...withoutCode.matchAll(/!?\[[^\]]*\]\((<#[^>]*>|#[^)\s]*)(?:\s+["'][^"']*["'])?\)/g)]
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
  const anchors = new Set(), counts = new Map(), lines = markdown.split("\n");
  const add = (slug) => {
    const count = counts.get(slug) ?? 0;
    counts.set(slug, count + 1);
    anchors.add(count ? `${slug}-${count}` : slug);
  };
  let fence = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i], marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) { if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !line.slice(marker[0].length).trim()) fence = null; continue; }
    if (marker) { fence = marker[1]; continue; }
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
