import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const fastFiles = [
  "ci-scope", "doc-links", "import-boundary", "npm-release-workflow", "publication-audit", "publication-boundary",
  "release-package", "skill-policy", "test-groups", "workkeel-visuals"
].map((name) => `test/${name}.test.mjs`);
export const dailyFiles = [...new Set([...fastFiles, ...[
  "json-rpc-process-cleanup", "json-rpc-process-protocol", "task-contract", "workkeel-cli-flags", "workkeel-command-supervisor", "workkeel-daily-entry",
  "workkeel-delivery-request", "workkeel-lifecycle", "workkeel-lock", "workkeel-review-recovery", "workkeel-risk-tiers"
].map((name) => `test/${name}.test.mjs`)])].sort();

// Every product test is core; the group remains for changed-file selection.
export function groupFor() {
  return "core";
}

export async function testInventory(target = root) {
  const entries = await fs.readdir(path.join(target, "test"), { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && /\.test\.[cm]?js$/.test(entry.name))
    .map((entry) => path.relative(target, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort();
}

export function selectChangedTests(paths, inventory) {
  if (!paths?.length) return { mode: "full", reason: "No trustworthy change scope; run all tests.", files: inventory };
  const selected = new Set(fastFiles);
  for (const file of paths) {
    if (inventory.includes(file)) {
      for (const candidate of inventory) if (groupFor(candidate) === groupFor(file)) selected.add(candidate);
    } else if (/^(?:README(?:\.[\w-]+)?\.md|CONTRIBUTING\.md|CHANGELOG\.md|docs\/[^\r\n]+\.md)$/.test(file) && !file.split("/").includes("..")) {
      // Prose-only edits still run repository/package/link checks via verify:changed.
    } else {
      return { mode: "full", reason: `Shared, executable, state, deleted-test, or unclassified change: ${file}`, files: inventory };
    }
  }
  return { mode: "selected", reason: "Local editing selection; not behavioral-candidate or Release evidence.", files: [...selected].sort() };
}

export function changedPaths(target, base) {
  if (!base || base.startsWith("-")) throw new Error("An explicit Git comparison base is required.");
  const git = (args) => {
    const result = spawnSync("git", ["-C", target, ...args], { encoding: "utf8" });
    if (result.status !== 0 || result.error) throw new Error("Git comparison failed; use the full suite.");
    return result.stdout;
  };
  const ancestor = git(["merge-base", base, "HEAD"]).trim();
  const tracked = git(["diff", "--name-only", "--no-renames", "-z", ancestor, "--"]);
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"]);
  return [...new Set((tracked + untracked).split("\0").filter(Boolean))];
}

export function selectionOptions(group, args) {
  const result = { base: null, list: false, verbose: false };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--list" && !result.list) result.list = true;
    else if (args[i] === "--verbose" && !result.verbose) result.verbose = true;
    else if (args[i] === "--base" && group === "changed" && result.base === null && args[i + 1] && !args[i + 1].startsWith("-")) result.base = args[++i];
    else throw new Error(`Unknown, duplicate, or incomplete selection option: ${args[i]}`);
  }
  return result;
}

async function main(args) {
  const [group = "full", ...options] = args;
  const inventory = await testInventory();
  let parsed;
  let selection;
  if (group === "changed") {
    try { parsed = selectionOptions(group, options); selection = selectChangedTests(changedPaths(root, parsed.base), inventory); }
    catch (error) { selection = { mode: "full", reason: error.message, files: inventory }; }
  } else if (["core", "fast", "daily", "full"].includes(group)) {
    parsed = selectionOptions(group, options);
    selection = { mode: group, files: group === "fast" ? fastFiles : group === "daily" ? dailyFiles : inventory.filter((file) => group === "full" || groupFor(file) === group) };
  } else throw new Error(`Unknown test group: ${group}`);
  if (!selection.files.length) throw new Error("Empty test selection is not verification.");
  if (options.includes("--list")) { console.log(JSON.stringify(selection, null, 2)); return; }
  console.log(`${selection.mode}: ${selection.files.length} test files. ${selection.reason ?? ""}`);
  // Explicit inventory avoids Node treating this executable helper as a test.
  // Dot keeps successful runs compact and still expands full failed-test details.
  const result = spawnSync(process.execPath, ["--test", ...(parsed?.verbose ? [] : ["--test-reporter=dot"]), ...selection.files], { cwd: root, stdio: "inherit" });
  process.exitCode = result.error || result.signal ? 1 : result.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
