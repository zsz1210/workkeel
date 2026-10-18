import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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

// V8 parses each source as a module and reports its static dependency
// specifiers exactly, so comments, spacing and string forms cannot hide one.
const STATIC_PARSER = `
import vm from "node:vm";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const out = {};
for (const [name, source] of Object.entries(JSON.parse(input))) {
  try { out[name] = { specifiers: new vm.SourceTextModule(source, { identifier: name }).dependencySpecifiers }; }
  catch (error) { out[name] = { error: error.message }; }
}
process.stdout.write(JSON.stringify(out));
`;

function staticSpecifiers(sources) {
  const result = spawnSync(process.execPath, ["--experimental-vm-modules", "--no-warnings", "--input-type=module", "-e", STATIC_PARSER],
    { input: JSON.stringify(sources), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Module parser failed: ${result.stderr.trim()}`);
  return JSON.parse(result.stdout);
}

const SIMPLE_ESCAPES = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v" };

/** Decodes the escape at `index` (the backslash) as a cooked string or template value does. */
export function readEscape(source, index) {
  const next = source[index + 1];
  if (next === undefined) throw new Error("Unterminated escape sequence");
  if (next === "\r") return { value: "", end: index + (source[index + 2] === "\n" ? 3 : 2) };
  if (["\n", "\u2028", "\u2029"].includes(next)) return { value: "", end: index + 2 };
  if (Object.hasOwn(SIMPLE_ESCAPES, next)) return { value: SIMPLE_ESCAPES[next], end: index + 2 };
  if (next === "x") {
    const hex = /^[0-9a-fA-F]{2}/.exec(source.slice(index + 2, index + 4));
    if (!hex) throw new Error("Invalid hexadecimal escape");
    return { value: String.fromCodePoint(parseInt(hex[0], 16)), end: index + 4 };
  }
  if (next === "u") {
    const braced = /^\{([0-9a-fA-F]+)\}/.exec(source.slice(index + 2, index + 16));
    const code = braced ? parseInt(braced[1], 16) : /^[0-9a-fA-F]{4}/.test(source.slice(index + 2, index + 6)) ? parseInt(source.slice(index + 2, index + 6), 16) : NaN;
    if (!Number.isInteger(code) || code > 0x10ffff) throw new Error("Invalid Unicode escape");
    return { value: String.fromCodePoint(code), end: index + 2 + (braced ? braced[0].length : 4) };
  }
  // Modules are strict: \0 is allowed only before a non-digit; other digits are legacy octal.
  if (next === "0" && !/[0-9]/.test(source[index + 2] ?? "")) return { value: "\0", end: index + 2 };
  if (/[0-9]/.test(next)) throw new Error("Octal escapes are not allowed in modules");
  return { value: next, end: index + 2 };
}

const REGEX_AFTER_WORD = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);

/** Tokenizes JavaScript just enough to find `import(...)` calls outside comments, strings and regexes. */
export function tokenize(source) {
  const tokens = [], modes = [];
  let index = source.startsWith("#!") ? source.indexOf("\n") + 1 || source.length : 0;
  const previous = () => tokens.at(-1);
  const regexAllowed = () => {
    const token = previous();
    if (!token) return true;
    if (token.type === "word") return REGEX_AFTER_WORD.has(token.value);
    if (token.type === "punct") return ![")", "]", "}"].includes(token.value);
    return false;
  };
  // Reads template characters until the closing backtick or a substitution.
  const template = () => {
    let value = "";
    while (index < source.length) {
      const char = source[index];
      if (char === "\\") { const escape = readEscape(source, index); value += escape.value; index = escape.end; continue; }
      if (char === "`") { index += 1; return { value, closed: true }; }
      if (char === "$" && source[index + 1] === "{") { index += 2; return { value, closed: false }; }
      value += char; index += 1;
    }
    throw new Error("Unterminated template literal");
  };
  while (index < source.length) {
    const char = source[index], next = source[index + 1];
    if (/\s/.test(char)) { index += 1; continue; }
    if (char === "/" && next === "/") { const end = source.indexOf("\n", index); index = end === -1 ? source.length : end; continue; }
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) throw new Error("Unterminated comment");
      index = end + 2; continue;
    }
    if (char === "'" || char === '"') {
      let value = ""; index += 1;
      while (index < source.length && source[index] !== char) {
        if (source[index] === "\\") { const escape = readEscape(source, index); value += escape.value; index = escape.end; }
        else if (source[index] === "\n" || source[index] === "\r") throw new Error("Unterminated string literal");
        else { value += source[index]; index += 1; }
      }
      if (index >= source.length) throw new Error("Unterminated string literal");
      index += 1; tokens.push({ type: "string", value }); continue;
    }
    if (char === "`") {
      index += 1;
      const part = template();
      if (part.closed) tokens.push({ type: "string", value: part.value });
      else { tokens.push({ type: "template" }); modes.push("template"); }
      continue;
    }
    if (char === "}" && modes.at(-1) === "template") {
      index += 1;
      const part = template();
      if (part.closed) modes.pop(); // the template token already marks it non-literal
      continue;
    }
    if (char === "{") { modes.push("brace"); tokens.push({ type: "punct", value: char }); index += 1; continue; }
    if (char === "}") { modes.pop(); tokens.push({ type: "punct", value: char }); index += 1; continue; }
    if (char === "/" && regexAllowed()) {
      let inClass = false; index += 1;
      while (index < source.length) {
        const current = source[index];
        if (current === "\\") { index += 2; continue; }
        if (current === "\n") throw new Error("Unterminated regular expression");
        if (current === "[") inClass = true;
        else if (current === "]") inClass = false;
        else if (current === "/" && !inClass) break;
        index += 1;
      }
      index += 1;
      while (/[\p{ID_Continue}$]/u.test(source[index] ?? "")) index += 1;
      tokens.push({ type: "regex" }); continue;
    }
    const word = /^[\p{ID_Start}$_\\][\p{ID_Continue}$‌‍]*/u.exec(source.slice(index, index + 256));
    if (word) { tokens.push({ type: "word", value: word[0] }); index += word[0].length; continue; }
    const number = /^(?:\.\d|\d)[\w.]*/.exec(source.slice(index, index + 256));
    if (number) { tokens.push({ type: "number" }); index += number[0].length; continue; }
    if (char === "?" && next === "." && !/\d/.test(source[index + 2] ?? "")) { tokens.push({ type: "punct", value: "?." }); index += 2; continue; }
    tokens.push({ type: "punct", value: char }); index += 1;
  }
  return tokens;
}

/** Returns each `import(...)` call: its literal specifier, or null when it is computed. */
export function dynamicImports(source) {
  const tokens = tokenize(source), calls = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i], before = tokens[i - 1];
    if (token.type !== "word" || token.value !== "import" || tokens[i + 1]?.value !== "(") continue;
    if (before?.type === "punct" && [".", "?."].includes(before.value)) continue;
    // Conservative: a method named import also counts as a call, so it can
    // never be confused with a call that is followed by a block.
    const argument = tokens[i + 2], after = tokens[i + 3];
    const literal = argument?.type === "string" && [")", ","].includes(after?.value);
    calls.push(literal ? argument.value : null);
  }
  return calls;
}

/** Reads static and dynamic imports for each named source. */
export function readImportsBatch(sources) {
  const statics = staticSpecifiers(sources), out = {};
  for (const [name, source] of Object.entries(sources)) {
    if (statics[name].error) { out[name] = { error: statics[name].error, imports: [] }; continue; }
    const imports = statics[name].specifiers.map(specifier => ({ specifier, dynamic: false }));
    try {
      for (const specifier of dynamicImports(source)) imports.push({ specifier, dynamic: true });
      out[name] = { imports };
    } catch (error) {
      out[name] = { error: error.message, imports };
    }
  }
  return out;
}

export function readImports(source) {
  const result = readImportsBatch({ source }).source;
  if (result.error) throw new Error(result.error);
  return result.imports;
}

function nativeEntries(target) {
  const entries = ["bin/workkeel.mjs"];
  for (const name of fs.readdirSync(path.join(target, "src")).sort()) if (isNative(`src/${name}`)) entries.push(`src/${name}`);
  return entries;
}

/** Walks every relative import from the native entry and all src/workkeel-* modules. */
export function checkImportBoundary(target = root, entries = nativeEntries(target)) {
  const errors = [], bridges = [], reached = new Set();
  let frontier = [...entries];
  while (frontier.length) {
    const sources = {};
    for (const file of frontier) {
      if (reached.has(file)) continue;
      reached.add(file);
      sources[file] = fs.readFileSync(path.join(target, file), "utf8");
    }
    const parsed = Object.keys(sources).length ? readImportsBatch(sources) : {};
    frontier = [];
    for (const [file, { imports, error }] of Object.entries(parsed)) {
      if (error) errors.push(`${file}: cannot be parsed as a module (${error})`);
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
        frontier.push(dependency);
      }
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
