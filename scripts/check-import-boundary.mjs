import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Shared modules native code may load besides src/workkeel-*.
export const NATIVE_SHARED_MODULES = new Set([
  "src/files.mjs", "src/ids.mjs", "src/task-contract.mjs", "src/headroom-adapter.mjs"
]);
// The only remaining route into Temple: lazy `workkeel legacy` and temple.lock dispatch.
export const LEGACY_BRIDGES = new Set(["src/workkeel-cli.mjs -> src/cli.mjs"]);

function isNative(file) {
  return file === "bin/workkeel.mjs" || /^src\/workkeel-[^/]+\.mjs$/.test(file);
}

// The specifier of import(...), or null when it is computed at runtime.
function literalSpecifier(node) {
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return null;
}

function walk(node, visit) {
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) { for (const child of value) if (child && typeof child.type === "string") walk(child, visit); }
    else if (value && typeof value.type === "string") walk(value, visit);
  }
}

/** Parses a source as an ES module with acorn and returns every import, export-from and import() call. */
export function readImports(source) {
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module", allowHashBang: true });
  const imports = [];
  walk(ast, (node) => {
    if (node.type === "ImportDeclaration" || node.type === "ExportAllDeclaration" || node.type === "ExportNamedDeclaration" && node.source) {
      imports.push({ specifier: node.source.value, dynamic: false });
    } else if (node.type === "ImportExpression") {
      imports.push({ specifier: literalSpecifier(node.source), dynamic: true });
    }
  });
  return imports;
}

function nativeEntries(target) {
  const entries = ["bin/workkeel.mjs"];
  for (const name of fs.readdirSync(path.join(target, "src")).sort()) if (isNative(`src/${name}`)) entries.push(`src/${name}`);
  return entries;
}

/** Walks every relative import from the native entry and all src/workkeel-* modules. */
export function checkImportBoundary(target = root, entries = nativeEntries(target)) {
  const errors = [], bridges = [], reached = new Set(), queue = [...entries];
  while (queue.length) {
    const file = queue.shift();
    if (reached.has(file)) continue;
    reached.add(file);
    let imports;
    try {
      imports = readImports(fs.readFileSync(path.join(target, file), "utf8"));
    } catch (error) {
      errors.push(`${file}: cannot be parsed as a module (${error.message})`);
      continue;
    }
    for (const item of imports) {
      if (item.specifier === null) {
        if (isNative(file)) errors.push(`${file}: computed import() cannot be checked`);
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
  return { entries, reached: [...reached].sort(), bridges: [...new Set(bridges)].sort(), errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkImportBoundary();
  if (result.errors.length) {
    for (const error of result.errors) console.error(`import boundary: ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`Import boundary passed: ${result.entries.length} native entry points, ${result.reached.length} modules checked, legacy bridge ${result.bridges.join(", ") || "none"}.`);
  }
}
