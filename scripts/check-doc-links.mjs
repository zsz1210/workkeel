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

export function resolveLocalLink(sourceFile, target) {
  const withoutFragment = target.split("#", 1)[0].split("?", 1)[0];
  if (!withoutFragment) return null;
  return path.resolve(path.dirname(sourceFile), decodeURIComponent(withoutFragment));
}

export async function findBrokenLinks(markdownRoot = root) {
  const failures = [];
  const markdownFiles = (await walkFiles(markdownRoot)).filter(
    (candidate) =>
      candidate.endsWith(".md") &&
      !candidate.startsWith(".git/") &&
      !candidate.startsWith("node_modules/")
  );

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
      }
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
