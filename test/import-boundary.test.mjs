import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkImportBoundary, dynamicImports, readImports } from "../scripts/check-import-boundary.mjs";

async function fixture(t, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-boundary-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries({ "src/project.mjs": "export const value = 1;\n", ...files })) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), content);
  }
  return root;
}
const entry = 'import "../src/workkeel-cli.mjs";\n';

test("the repository's native modules reach only native and shared modules", () => {
  const result = checkImportBoundary();
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.bridges, ["src/workkeel-cli.mjs -> src/cli.mjs"]);
  assert.ok(result.entries.includes("src/workkeel-claude-review.mjs") && result.entries.includes("src/workkeel-dispatch-classifier.mjs"));
  assert.ok(result.reached.every(file => file === "bin/workkeel.mjs" || /^src\/(?:workkeel-[^/]+|files|ids|task-contract|headroom-adapter)\.mjs$/.test(file)));
});

test("native imports of Temple modules are rejected, including transitive ones", async t => {
  const root = await fixture(t, {
    "bin/workkeel.mjs": entry,
    "src/workkeel-cli.mjs": 'import { a } from "./workkeel-a.mjs";\nconst x = await import("./cli.mjs");\n',
    "src/workkeel-a.mjs": 'export { value as a } from "./project.mjs";\n',
    "src/cli.mjs": 'import "./work-items.mjs";\n'
  });
  const result = checkImportBoundary(root);
  assert.deepEqual(result.errors, ["src/workkeel-a.mjs -> src/project.mjs: native code must not import Temple modules"]);
  assert.ok(!result.reached.includes("src/work-items.mjs"));
});

test("legal syntax variations cannot hide a Temple import", async t => {
  const hidden = {
    "spaced dynamic import": 'await import ("./project.mjs");\n',
    "comment inside static import": 'import/* comment */ {value} from "./project.mjs";\n',
    "comment before the specifier": 'import { value } from /* x */ "./project.mjs";\n',
    "line break and comment in dynamic import": 'await import(\n  // load\n  "./project.mjs"\n);\n',
    "template literal specifier": "await import(`./project.mjs`);\n",
    "dynamic import with options": 'await import("./project.mjs", { with: {} });\n',
    "re-export": 'export * from "./project.mjs";\n',
    "side-effect import with single quotes": "import './project.mjs';\n",
    "unicode escape in dynamic specifier": 'await import("\\u002e/project.mjs");\n',
    "braced unicode and hex escapes": "await import('\\u{2e}\\x2fproject.mjs');\n",
    "escapes in a template specifier": "await import(`\\x2e/\\u0070roject.mjs`);\n",
    "line continuation in dynamic specifier": 'await import("./pro\\\nject.mjs");\n',
    "call followed by a block on the next line": 'import("./project.mjs")\n{}\n',
    "call followed by a block on the same line": 'if (true) import("./project.mjs"); {}\n'
  };
  for (const [label, source] of Object.entries(hidden)) {
    const root = await fixture(t, { "bin/workkeel.mjs": entry, "src/workkeel-cli.mjs": source });
    assert.deepEqual(checkImportBoundary(root).errors, ["src/workkeel-cli.mjs -> src/project.mjs: native code must not import Temple modules"], label);
  }
});

test("import-like text in comments, strings and regexes is not an import", () => {
  const source = [
    '// import("./project.mjs")',
    '/* import "./project.mjs" */',
    'const text = "import(\'./project.mjs\')";',
    "const page = `<script>await import('/client.mjs')</script>`;",
    "const pattern = /import\\(\"\\.\\/project\\.mjs\"\\)/g;",
    'loader.import("./project.mjs");',
    "const value = 4 / 2 / 1;"
  ].join("\n");
  assert.deepEqual(dynamicImports(source), []);
  assert.deepEqual(readImports(source), []);
});

test("string and template escapes decode exactly as JavaScript evaluates them", () => {
  const literals = [String.raw`"\u002e/a.mjs"`, String.raw`'\x2e\x2fb.mjs'`, String.raw`"\u{1F600}\u{2e}"`, String.raw`"\t\n\r\b\f\v\0x"`,
    String.raw`"\q\'\"\\"`, "\"a\\\nb\"", "\"a\\\r\nb\"", "`\\x2e/t\\u0065mplate.mjs`", "`line\\\ncontinued`"];
  for (const literal of literals) assert.deepEqual(dynamicImports(`import(${literal})`), [Function(`"use strict"; return ${literal};`)()], literal);
  assert.throws(() => dynamicImports(String.raw`import("\01.mjs")`), /Octal/);
  assert.throws(() => dynamicImports(String.raw`import("\u{110000}")`), /Unicode/);
  assert.throws(() => dynamicImports('import("unterminated\n")'), /Unterminated/);
});

test("a method named import is conservatively treated as a computed import", async t => {
  const root = await fixture(t, { "bin/workkeel.mjs": entry, "src/workkeel-cli.mjs": "export const loader = { import(name) { return name; } };\n" });
  assert.deepEqual(checkImportBoundary(root).errors, ["src/workkeel-cli.mjs: computed import() cannot be checked"]);
});

test("computed imports and a static legacy bridge are rejected in native code", async t => {
  const root = await fixture(t, {
    "bin/workkeel.mjs": entry,
    "src/workkeel-cli.mjs": 'import { main } from "./cli.mjs";\nconst name = "x";\nawait import(`./${name}.mjs`);\nawait import("./" + name);\n',
    "src/cli.mjs": "export const main = 1;\n"
  });
  const { errors } = checkImportBoundary(root);
  assert.deepEqual(errors.sort(), [
    "src/workkeel-cli.mjs -> src/cli.mjs: the legacy bridge must stay a lazy import",
    "src/workkeel-cli.mjs: computed import() cannot be checked",
    "src/workkeel-cli.mjs: computed import() cannot be checked"
  ].sort());
});

test("native modules the CLI entry does not reach are still checked", async t => {
  const root = await fixture(t, {
    "bin/workkeel.mjs": entry,
    "src/workkeel-cli.mjs": "export const ok = true;\n",
    "src/workkeel-unreached.mjs": 'import "./project.mjs";\n'
  });
  const result = checkImportBoundary(root);
  assert.ok(result.entries.includes("src/workkeel-unreached.mjs"));
  assert.deepEqual(result.errors, ["src/workkeel-unreached.mjs -> src/project.mjs: native code must not import Temple modules"]);
});

test("a native module that does not parse fails the check", async t => {
  const root = await fixture(t, { "bin/workkeel.mjs": entry, "src/workkeel-cli.mjs": "import {;\n" });
  assert.match(checkImportBoundary(root).errors[0], /^src\/workkeel-cli\.mjs: cannot be parsed as a module/);
});
