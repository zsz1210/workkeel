// Guards against native code importing modules outside the native graph; it is
// not a security boundary against deliberate bypasses. It checks ESM import and
// export statements and import() only. Known limits: require() through
// createRequire and import.meta.resolve() are not checked, and acorn 8.19.0
// cannot parse `o?.return / 2`, which fails the check rather than passing.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isBuiltin } from "node:module";
import { parse } from "acorn";
import validatePackageName from "validate-npm-package-name";
import { PACKAGE_NAME } from "../src/workkeel-version.mjs";
import { optionalFiles } from "./test-groups.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Shared modules native code may load besides src/workkeel-*.
export const NATIVE_SHARED_MODULES = new Set([
  "src/files.mjs", "src/task-contract.mjs", "src/headroom-adapter.mjs"
]);
// Modules the monitor serves to the browser; their "/name.mjs" imports are served asset URLs.
export const BROWSER_MODULES = new Set(["src/workkeel-monitor-client.mjs"]);

// A package subpath segment: plain characters only, never "." or "..". This
// excludes traversal, empty segments, backslashes and percent-encoding, which
// Node normalizes and could resolve back into the repository.
const SUBPATH_SEGMENT = /^[A-Za-z0-9._~@+-]+$/;

// Another package: a valid npm name (checked by npm's validator) and a plain subpath.
function packageSpecifier(specifier) {
  const parts = specifier.split("/"), nameParts = specifier.startsWith("@") ? 2 : 1;
  const name = parts.slice(0, nameParts).join("/");
  if (name === PACKAGE_NAME || !validatePackageName(name).validForOldPackages) return false;
  return parts.slice(nameParts).every((segment) => SUBPATH_SEGMENT.test(segment) && segment !== "." && segment !== "..");
}

// Classifies a non-relative specifier. Only Node built-ins, other packages and
// the browser module's served assets leave the source graph; every other form
// (file: or other URLs, absolute or Windows paths, #imports, this package's own
// name, package subpaths that could normalize) is rejected. This covers ESM
// import and export statements and import(); CommonJS require through
// createRequire is not checked.
function externalSpecifier(file, specifier) {
  if (specifier.startsWith("node:")) return isBuiltin(specifier);
  if (BROWSER_MODULES.has(file) && /^\/[A-Za-z0-9._-]+\.mjs$/.test(specifier)) return true;
  return packageSpecifier(specifier);
}

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
  const errors = [], reached = new Set(), queue = [...entries];
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
        errors.push(`${file}: computed import() cannot be checked`);
        continue;
      }
      if (!item.specifier.startsWith(".")) {
        if (!externalSpecifier(file, item.specifier)) errors.push(`${file}: import specifier ${JSON.stringify(item.specifier)} must be a relative path, a node: built-in or another package`);
        continue;
      }
      const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(file), item.specifier));
      const edge = `${file} -> ${dependency}`;
      if (!isNative(dependency) && !NATIVE_SHARED_MODULES.has(dependency)) {
        errors.push(`${edge}: native code must not import non-native modules`);
        continue;
      }
      queue.push(dependency);
    }
  }
  return { entries, reached: [...reached].sort(), errors };
}

// Layer rule: core code must not import optional-subsystem modules. The optional
// set comes from two sources. First, the optional test group in
// scripts/test-groups.mjs: each test maps to src/<test name>.mjs, or to the
// modules in OPTIONAL_TEST_MODULES when no module has that name. Second, the
// optional subsystems of `workkeel help advanced` and
// docs/concepts/compatibility.md, which OPTIONAL_TIERS lists by command name.
// "loop" stands for the experimental Workkeel Loop features of that document.
export const OPTIONAL_TIERS = {
  monitor: ["src/workkeel-monitor.mjs", "src/workkeel-monitor-analytics.mjs", "src/workkeel-monitor-client.mjs", "src/workkeel-monitor-data.mjs",
    "src/workkeel-monitor-dom.mjs", "src/workkeel-monitor-page.mjs", "src/workkeel-monitor-time.mjs", "src/workkeel-monitor-view.mjs",
    "src/workkeel-observer-index.mjs", "src/workkeel-tailnet.mjs", "scripts/serve-workkeel-observer.mjs", "scripts/verify-workkeel-monitor.mjs",
    "scripts/workkeel-monitor-fixture.mjs", "scripts/workkeel-observer-fixture.mjs", "scripts/workkeel-execution-clarity-browser.mjs",
    "scripts/workkeel-observer-release-browser.mjs"],
  workspace: ["src/workkeel-workspace.mjs", "src/workkeel-workspace-server.mjs", "src/workkeel-workspace-ui.mjs", "src/workkeel-workspace-scene.mjs",
    "src/workkeel-workspace-hooks.mjs"],
  workflow: ["src/workkeel-workflows.mjs", "src/workkeel-workflow-schema.mjs", "src/workkeel-continuation.mjs", "src/workkeel-checkpoints.mjs"],
  dispatch: ["src/workkeel-dispatch.mjs", "src/workkeel-dispatch-classifier.mjs", "scripts/prepare-workkeel-dispatch.mjs"],
  usage: ["src/workkeel-host-usage.mjs", "scripts/collect-workkeel-host-usage.mjs", "scripts/workkeel-background-collector.mjs",
    "scripts/workkeel-execution-capture.mjs"],
  "model-policy": ["src/workkeel-model-policy.mjs", "src/workkeel-model-policy-resolution.mjs", "src/workkeel-model-routing.mjs",
    "src/workkeel-model-rules-ui.mjs"],
  headroom: ["src/workkeel-headroom.mjs", "src/headroom-adapter.mjs"],
  learning: ["src/workkeel-learning.mjs", "src/workkeel-learning-context.mjs", "src/workkeel-learning-lifecycle.mjs", "src/workkeel-learning-receipts.mjs"],
  "skill-lifecycle": ["src/workkeel-learning-lifecycle.mjs"],
  goal: ["src/workkeel-goals.mjs", "src/workkeel-goal-runtime.mjs"],
  autonomy: ["src/workkeel-autonomy.mjs", "src/workkeel-autonomy-admission.mjs", "src/workkeel-improvement-cycle.mjs"],
  retention: ["src/workkeel-retention.mjs"],
  loop: ["src/workkeel-loop-run.mjs", "src/workkeel-loop-comparison.mjs"]
};

// Optional tests without a src/<test name>.mjs module, mapped to the modules they cover.
export const OPTIONAL_TEST_MODULES = {
  "headroom-preservation": ["src/headroom-adapter.mjs"],
  "workkeel-background-collector": ["scripts/workkeel-background-collector.mjs"],
  "workkeel-capture-observer": ["scripts/workkeel-execution-capture.mjs"],
  "workkeel-desktop-product": ["src/workkeel-model-rules-ui.mjs", "src/workkeel-workspace-scene.mjs"],
  "workkeel-dispatch-history": ["src/workkeel-dispatch.mjs"],
  "workkeel-execution-capture": ["scripts/workkeel-execution-capture.mjs"],
  "workkeel-flow-browser": ["src/workkeel-workspace-server.mjs", "scripts/workkeel-monitor-fixture.mjs"],
  "workkeel-host-observer": ["src/workkeel-monitor-view.mjs"],
  "workkeel-learning-observer": ["src/workkeel-learning.mjs", "scripts/workkeel-monitor-fixture.mjs"],
  "workkeel-monitor-catalogue": ["src/workkeel-monitor-data.mjs", "scripts/workkeel-observer-fixture.mjs"],
  "workkeel-observer": ["src/workkeel-monitor-data.mjs", "scripts/workkeel-observer-fixture.mjs"],
  "workkeel-usage-scope": ["src/workkeel-host-usage.mjs"]
};

// Core-to-optional edges that existed when the rule was introduced. Each entry
// is one importer and one imported module. "lazy" entries accept import() only,
// so a static import of the same module still fails. An entry that no longer
// matches an edge fails the check, so the list cannot go stale.
const router = (to, command) => ({ from: "src/workkeel-cli.mjs", to: `src/${to}`, lazy: true, reason: `command router loads ${command} on demand` });
export const OPTIONAL_IMPORT_ALLOWLIST = [
  router("workkeel-monitor.mjs", "`workkeel monitor`"),
  router("workkeel-workspace.mjs", "`workkeel workspace`"),
  router("workkeel-workspace-server.mjs", "`workkeel workspace serve`"),
  router("workkeel-workspace-hooks.mjs", "`workkeel workspace serve`"),
  router("workkeel-scoring.mjs", "`workkeel stats`"),
  router("workkeel-retention.mjs", "`workkeel retention`"),
  router("workkeel-model-policy.mjs", "`workkeel model-policy`"),
  router("workkeel-learning-lifecycle.mjs", "`workkeel skill-lifecycle`"),
  router("workkeel-goals.mjs", "`workkeel goal`"),
  router("workkeel-autonomy-admission.mjs", "`workkeel goal extend-admission|dispose-proposal`"),
  router("workkeel-autonomy.mjs", "`workkeel autonomy`"),
  router("workkeel-learning.mjs", "`workkeel learning`"),
  router("workkeel-dispatch.mjs", "`workkeel dispatch`"),
  router("workkeel-host-usage.mjs", "`workkeel usage`"),
  router("workkeel-workflows.mjs", "`workkeel workflow`"),
  router("workkeel-continuation.mjs", "`workkeel workflow continuation-plan|continue`"),
  router("workkeel-headroom.mjs", "`workkeel headroom`"),
  { from: "src/workkeel-codex-host.mjs", to: "src/workkeel-learning-lifecycle.mjs", reason: "the Codex host records skill-lifecycle use for workflow runs" },
  { from: "src/workkeel-execution-policy.mjs", to: "src/workkeel-model-routing.mjs", reason: "execution policy resolves the model route of each role" },
  { from: "src/workkeel-material.mjs", to: "src/workkeel-learning-context.mjs", lazy: true, reason: "`workkeel context prepare` adds approved learning context when requested" },
  { from: "src/workkeel-measurements.mjs", to: "src/workkeel-host-usage.mjs", reason: "task metrics include bound host usage records" },
  { from: "src/workkeel-review-recovery.mjs", to: "src/workkeel-dispatch.mjs", reason: "review recovery reads the dispatch record of the failed review" },
  { from: "src/workkeel-review-recovery.mjs", to: "src/workkeel-host-usage.mjs", reason: "review recovery reads the usage binding of the failed review" },
  { from: "src/workkeel-stats-report.mjs", to: "src/workkeel-scoring.mjs", reason: "`stats --report` reuses the review score model" },
  { from: "src/workkeel-tasks.mjs", to: "src/workkeel-loop-run.mjs", reason: "task records carry the Workkeel Loop run fields" },
  { from: "scripts/verify-workkeel-process-recovery.mjs", to: "src/workkeel-workflows.mjs", reason: "process recovery verification drives a workflow run" },
  { from: "scripts/workkeel-delivery.mjs", to: "src/workkeel-dispatch.mjs", reason: "delivery reads the dispatch record of the task" },
  { from: "scripts/workkeel-delivery.mjs", to: "src/workkeel-host-usage.mjs", reason: "delivery reads the usage binding of the task" }
];

/** Returns the sorted optional module set, and errors for mappings that name missing files. */
export function optionalModules(target = root, { tests = optionalFiles, tiers = OPTIONAL_TIERS, testModules = OPTIONAL_TEST_MODULES } = {}) {
  const modules = new Set(), errors = [];
  const add = (file, source) => {
    if (fs.existsSync(path.join(target, file))) modules.add(file);
    else errors.push(`${source}: optional module ${file} does not exist`);
  };
  for (const test of tests) {
    const name = path.posix.basename(test).replace(/\.test\.mjs$/, ""), own = `src/${name}.mjs`;
    if (Object.hasOwn(testModules, name)) for (const file of testModules[name]) add(file, `optional test ${test}`);
    else if (fs.existsSync(path.join(target, own))) modules.add(own);
    else errors.push(`optional test ${test}: no src/${name}.mjs; map it in OPTIONAL_TEST_MODULES`);
  }
  for (const [tier, files] of Object.entries(tiers)) for (const file of files) add(file, `optional tier ${tier}`);
  return { modules: [...modules].sort(), errors };
}

// Every JavaScript module under one directory, at any depth.
function moduleFiles(target, dir) {
  if (!fs.existsSync(path.join(target, dir))) return [];
  return fs.readdirSync(path.join(target, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:mjs|js|cjs)$/.test(entry.name))
    .map((entry) => path.relative(target, path.join(entry.parentPath, entry.name)).split(path.sep).join("/")).sort();
}

// The repository file a relative specifier names: Node drops a ?query or #hash and decodes percent-escapes.
function localDependency(file, specifier) {
  let name = specifier.replace(/[?#].*$/s, "");
  try { name = decodeURIComponent(name); } catch { /* an invalid escape cannot name an optional module */ }
  return path.posix.normalize(path.posix.join(path.posix.dirname(file), name));
}

/** Checks that core modules anywhere in bin/, src/ and scripts/ do not import optional modules outside the allowlist. */
export function checkOptionalBoundary(target = root, { allowlist = OPTIONAL_IMPORT_ALLOWLIST, ...sources } = {}) {
  const { modules, errors } = optionalModules(target, sources);
  const optional = new Set(modules), edges = new Set();
  const allowed = new Map(allowlist.map((entry, index) => [`${entry.from} -> ${entry.to}`, { ...entry, index }]));
  for (const entry of allowlist) {
    if (!entry.reason?.trim()) errors.push(`allowlist ${entry.from} -> ${entry.to}: a reason is required`);
    if (optional.has(entry.from)) errors.push(`allowlist ${entry.from} -> ${entry.to}: the importer is optional, so no entry is needed`);
  }
  if (allowed.size !== allowlist.length) errors.push("allowlist: duplicate entries");
  for (const file of [...moduleFiles(target, "bin"), ...moduleFiles(target, "src"), ...moduleFiles(target, "scripts")]) {
    if (optional.has(file)) continue;
    let imports;
    try { imports = readImports(fs.readFileSync(path.join(target, file), "utf8")); }
    catch (error) { errors.push(`${file}: cannot be parsed as a module (${error.message})`); continue; }
    for (const item of imports) {
      if (item.specifier === null) { errors.push(`${file}: computed import() in core code cannot be checked against optional modules`); continue; }
      if (!item.specifier.startsWith(".")) continue;
      const dependency = localDependency(file, item.specifier);
      if (!optional.has(dependency)) continue;
      const edge = `${file} -> ${dependency}`, entry = allowed.get(edge);
      edges.add(edge);
      if (!entry) errors.push(`${edge}: core code must not import the optional module; add an allowlist entry with a reason only for an approved edge`);
      else if (entry.lazy && !item.dynamic) errors.push(`${edge}: the allowlist accepts import() only, not a static import`);
    }
  }
  for (const edge of allowed.keys()) if (!edges.has(edge)) errors.push(`allowlist ${edge}: no such import; remove the entry`);
  return { optional: modules, edges: [...edges].sort(), errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkImportBoundary(), layer = checkOptionalBoundary();
  const errors = [...result.errors, ...layer.errors];
  if (errors.length) {
    for (const error of errors) console.error(`import boundary: ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`Import boundary passed: ${result.entries.length} native entry points, ${result.reached.length} modules checked; ` +
      `${layer.optional.length} optional modules, ${layer.edges.length} allowlisted core-to-optional edges.`);
  }
}
