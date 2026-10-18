import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Shared modules the native CLI may load besides src/workkeel-*.
export const NATIVE_SHARED_MODULES = new Set([
  "src/files.mjs", "src/ids.mjs", "src/task-contract.mjs", "src/headroom-adapter.mjs"
]);
// The only remaining route into Temple: lazy `workkeel legacy` and temple.lock dispatch.
export const LEGACY_BRIDGES = new Set(["src/workkeel-cli.mjs -> src/cli.mjs"]);

const SPECIFIER = /\b(?:import|export)\s[^'"`;]*?\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\bimport\(\s*([^)]*?)\s*\)/g;

function isNative(file) {
  return file.startsWith("bin/workkeel") || /^src\/workkeel-[^/]+\.mjs$/.test(file);
}

export function readImports(source) {
  const imports = [];
  for (const match of source.matchAll(SPECIFIER)) {
    if (match[1] ?? match[2]) imports.push({ specifier: match[1] ?? match[2], dynamic: false });
    else {
      const literal = /^["']([^"'`]+)["']$/.exec(match[3]);
      imports.push(literal ? { specifier: literal[1], dynamic: true } : { specifier: null, dynamic: true, expression: match[3] });
    }
  }
  return imports;
}

/** Walks every relative import reachable from the native entry and reports boundary violations. */
export function checkImportBoundary(target = root, entry = "bin/workkeel.mjs") {
  const errors = [], bridges = [], reached = new Set(), queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (reached.has(file)) continue;
    reached.add(file);
    const source = fs.readFileSync(path.join(target, file), "utf8");
    for (const item of readImports(source)) {
      if (item.specifier === null) {
        if (isNative(file)) errors.push(`${file}: non-literal import(${item.expression}) cannot be checked`);
        continue;
      }
      // Browser-served paths and packages are outside the source graph.
      if (!item.specifier.startsWith(".")) continue;
      const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(file), item.specifier));
      const edge = `${file} -> ${dependency}`;
      if (LEGACY_BRIDGES.has(edge)) {
        if (!item.dynamic) errors.push(`${edge}: the legacy bridge must stay a lazy import`);
        bridges.push(edge);
        continue;
      }
      if (!isNative(dependency) && !NATIVE_SHARED_MODULES.has(dependency)) {
        errors.push(`${edge}: native code must not import Temple modules`);
        continue;
      }
      queue.push(dependency);
    }
  }
  return { reached: [...reached].sort(), bridges: [...new Set(bridges)].sort(), errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkImportBoundary();
  if (result.errors.length) {
    for (const error of result.errors) console.error(`import boundary: ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`Import boundary passed: ${result.reached.length} native modules, legacy bridge ${result.bridges.join(", ") || "none"}.`);
  }
}
