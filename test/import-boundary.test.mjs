import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { checkImportBoundary, readImports } from "../scripts/check-import-boundary.mjs";

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
const templeImport = "src/workkeel-cli.mjs -> src/project.mjs: native code must not import Temple modules";
const nativeSource = async (t, source) => checkImportBoundary(await fixture(t, { "bin/workkeel.mjs": entry, "src/workkeel-cli.mjs": source }));

// Evaluates each source as a module in V8 and records the import() calls it actually makes.
function v8Evaluate(sources) {
  const runner = `
    import vm from "node:vm";
    let input = ""; for await (const chunk of process.stdin) input += chunk;
    const out = [];
    for (const source of JSON.parse(input)) {
      const seen = [];
      try {
        const module = new vm.SourceTextModule(source, { importModuleDynamically: async specifier => {
          seen.push(specifier);
          const target = new vm.SyntheticModule([], () => {});
          await target.link(() => {}); await target.evaluate(); return target;
        } });
        await module.link(specifier => {
          seen.push(specifier);
          return new vm.SyntheticModule(["value"], function () { this.setExport("value", 1); });
        });
        await module.evaluate();
        await new Promise(resolve => setTimeout(resolve, 0));
        out.push({ seen });
      } catch (error) { out.push({ error: error.message }); }
    }
    process.stdout.write(JSON.stringify(out));`;
  const result = spawnSync(process.execPath, ["--experimental-vm-modules", "--no-warnings", "--input-type=module", "-e", runner],
    { input: JSON.stringify(sources), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

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

// Every case is a legal module that imports ./project.mjs. Earlier review rounds
// found each one hidden from a hand-written lexer; acorn must report all of them.
const target = 'import(".\\x2fproject.mjs");';
const privateName = (member, use) => `class C {\n  ${member}\n  f() {\n    ${use} / 2; ${target} const b = 6 / 2;\n  }\n}\nnew C().f();\n`;
const regressions = {
  "spaced dynamic import": 'await import ("./project.mjs");\n',
  "comment inside static import": 'import/* comment */ {value} from "./project.mjs";\n',
  "comment before the specifier": 'import { value } from /* x */ "./project.mjs";\n',
  "line break and comment in dynamic import": 'await import(\n  // load\n  "./project.mjs"\n);\n',
  "template literal specifier": "await import(`./project.mjs`);\n",
  "dynamic import with options": 'await import("./project.mjs", { with: {} });\n',
  "re-export all": 'export * from "./project.mjs";\n',
  "named re-export": 'export { value } from "./project.mjs";\n',
  "side-effect import": "import './project.mjs';\n",
  "unicode escape in specifier": 'await import("\\u002e/project.mjs");\n',
  "braced unicode and hex escapes": "await import('\\u{2e}\\x2fproject.mjs');\n",
  "escapes in a template specifier": "await import(`\\x2e/\\u0070roject.mjs`);\n",
  "line continuation in specifier": 'await import("./pro\\\nject.mjs");\n',
  "call followed by a block": 'import("./project.mjs")\n{}\n',
  "division after an object literal": `let a = {} / 2; ${target} let b = 6 / 2;\n`,
  "postfix increment": `let x = 0;\nx++ / 2; ${target} const b = 6 / 2;\n`,
  "postfix decrement": `let x = 0;\nx-- / 2; ${target} const b = 6 / 2;\n`,
  "keyword property": `const o = { return: 4 };\no.return / 2; ${target} const b = 6 / 2;\n`,
  "variable named of": `const of = 4;\nof / 2; ${target} const b = 6 / 2;\n`,
  "private #default": privateName("#default = 4;", "this.#default"),
  "private #extends": privateName("#extends = 4;", "this.#extends"),
  "private #if()": privateName("#if() { return 4; }", "this.#if()"),
  "private #while()": privateName("#while() { return 4; }", "this.#while()"),
  "private #for()": privateName("#for() { return 4; }", "this.#for()"),
  "private #with()": privateName("#with() { return 4; }", "this.#with()"),
  "private postfix increment": privateName("#n = 4;", "this.#n++"),
  "regex in a template substitution": `\`\${/x/}\` / 2; ${target} const b = 6 / 2;\n`,
  "regex in a tagged template substitution": `String.raw\`\${/x/}\` / 2; ${target} const b = 6 / 2;\n`,
  "regex in a nested template substitution": `\`\${\`\${/x/}\`}\` / 2; ${target} const b = 6 / 2;\n`,
  "regex after a for await head": `for await (const x of []) /"/; ${target} /"/;\n`,
  "regex after debugger and a line break": `debugger\n/"/; ${target} /"/;\n`,
  "regex after break and a line break": `for (;;) {\n  ${target}\n  break\n  /"/; /"/;\n}\n`,
  "regex after continue and a line break": `for (let i = 0; i < 1; i++) {\n  ${target}\n  continue\n  /"/; /"/;\n}\n`,
  "regex after break label": `outer: for (;;) {\n  ${target}\n  break outer\n  /"/; /"/;\n}\n`,
  "regex after continue label": `outer: for (let i = 0; i < 1; i++) {\n  ${target}\n  continue outer\n  /"/; /"/;\n}\n`,
  "prefix increment of a regex member": `let a = 1\n++/x/.lastIndex; ${target} /"/;\n`,
  "regex after a block": `{}\n/"/; ${target} /"/;\n`,
  "regex after a class declaration": `class A {}\n/"/; ${target} /"/;\n`,
  "export default regex": `export default /"/; ${target} /"/;\n`,
  "class extends regex": `class A extends /"/.constructor {}\n${target}\n`
};

test("regression cases: legal modules that import ./project.mjs are always reported", async t => {
  const labels = Object.keys(regressions), evaluated = v8Evaluate(Object.values(regressions));
  for (const [index, label] of labels.entries()) {
    const source = regressions[label];
    assert.equal(evaluated[index].error, undefined, `${label}: V8 must accept and run the module`);
    if (/import\s*\(/.test(source)) assert.ok(evaluated[index].seen.includes("./project.mjs"), `${label}: V8 must actually import ./project.mjs`);
    assert.ok(readImports(source).some(item => item.specifier === "./project.mjs"), `${label}: readImports must find ./project.mjs`);
    assert.deepEqual((await nativeSource(t, source)).errors, [templeImport], label);
  }
});

test("imports in unexecuted branches are still reported", async t => {
  const source = 'if (false) import("./project.mjs");\nconst lazy = () => import("./project.mjs");\n';
  assert.deepEqual(v8Evaluate([source])[0].seen, []);
  assert.deepEqual(readImports(source).map(item => item.specifier), ["./project.mjs", "./project.mjs"]);
  assert.deepEqual((await nativeSource(t, source)).errors, [templeImport, templeImport]);
});

test("import-like text in comments, strings, templates, regexes and members is not an import", () => {
  const source = [
    '// import("./project.mjs")',
    '/* import "./project.mjs" */',
    'const text = "import(\'./project.mjs\')";',
    "const page = `<script>await import('/client.mjs')</script>`;",
    "const pattern = /import\\(\"\\.\\/project\\.mjs\"\\)/g;",
    "const loader = { import(name) { return name; } };",
    'loader.import("./project.mjs");',
    "const value = 4 / 2 / 1;"
  ].join("\n");
  assert.deepEqual(readImports(source), []);
});

test("computed imports and a static legacy bridge are rejected in native code", async t => {
  const root = await fixture(t, {
    "bin/workkeel.mjs": entry,
    "src/workkeel-cli.mjs": 'import { main } from "./cli.mjs";\nconst name = "x";\nawait import(`./${name}.mjs`);\nawait import("./" + name);\nawait import(String.raw`./project.mjs`);\n',
    "src/cli.mjs": "export const main = 1;\n"
  });
  assert.deepEqual(checkImportBoundary(root).errors.sort(), [
    "src/workkeel-cli.mjs -> src/cli.mjs: the legacy bridge must stay a lazy import",
    "src/workkeel-cli.mjs: computed import() cannot be checked",
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

test("a native module the parser rejects fails the check instead of passing", async t => {
  // Syntax errors, and legal code acorn 8.19.0 cannot parse (`o?.return / 2`),
  // both fail closed.
  for (const source of ["import {;\n", `const o = { return: 4 };\no?.return / 2; ${target}\n`]) {
    const { errors } = await nativeSource(t, source);
    assert.equal(errors.length, 1, source);
    assert.match(errors[0], /^src\/workkeel-cli\.mjs: cannot be parsed as a module \(/, source);
  }
});
