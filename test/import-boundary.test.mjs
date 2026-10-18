import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
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

// Evaluates each source as a module in V8 and records the imports it actually makes.
// With `run: false` it only parses, which proves the syntax is a legal module.
function v8Evaluate(sources, { run = true } = {}) {
  const runner = `
    import vm from "node:vm";
    let input = ""; for await (const chunk of process.stdin) input += chunk;
    const out = [];
    const { sources, run } = JSON.parse(input);
    for (const source of sources) {
      const seen = [];
      try {
        const module = new vm.SourceTextModule(source, { importModuleDynamically: async specifier => {
          seen.push(specifier);
          const target = new vm.SyntheticModule([], () => {});
          await target.link(() => {}); await target.evaluate(); return target;
        } });
        if (!run) { out.push({ seen }); continue; }
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
    { input: JSON.stringify({ sources, run }), encoding: "utf8" });
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

// The 22 legal modules from the fourth review that the hand-written lexer missed,
// verbatim. Several imports never run (an unexecuted loop or method), so V8 is
// only required to accept the module; the checker must still report them.
const reviewProbes = {
  "template-regex": "`${/x/}` / 2; import(\".\\x2fproject.mjs\"); const b=6 / 2;",
  "template-private": "class C{#return=4; f(){`${this.#return}` / 2; import(\".\\x2fproject.mjs\"); const b=6 / 2;}}",
  "for-await": "for await (const x of []) /\"/; import(\".\\x2fproject.mjs\"); /\"/;",
  "for-await-nested": "for await (const x of f(g())) /\"/; import(\".\\x2fproject.mjs\"); /\"/;",
  "label-break": "label: while(false){break label\n /\"/; import(\".\\x2fproject.mjs\"); /\"/;}",
  "break-asi": "while(false){break\n /\"/; import(\".\\x2fproject.mjs\"); /\"/;}",
  "continue-asi": "while(false){continue\n /\"/; import(\".\\x2fproject.mjs\"); /\"/;}",
  "debugger-asi": "debugger\n /\"/; import(\".\\x2fproject.mjs\"); /\"/;",
  "private-return": "class C { #return=4; f(){this.#return / 2; import(\".\\x2fproject.mjs\"); const b=6 / 2;}}",
  "optional-private-return": "class C { #return=4; f(){this?.#return / 2; import(\".\\x2fproject.mjs\"); const b=6 / 2;}}",
  "private-typeof": "class C { #typeof=4; f(){this.#typeof / 2; import(\".\\x2fproject.mjs\"); const b=6 / 2;}}",
  "optional-private-typeof": "class C { #typeof=4; f(){this?.#typeof / 2; import(\".\\x2fproject.mjs\"); const b=6 / 2;}}",
  "private-call-if": "class C { #if(){return 4;} f(){this.#if() / 2; import(\".\\x2fproject.mjs\"); const b=6 / 2;}}",
  "private-call-while": "class C { #while(){return 4;} f(){this.#while() / 2; import(\".\\x2fproject.mjs\"); const b=6 / 2;}}",
  "private-call-for": "class C { #for(){return 4;} f(){this.#for() / 2; import(\".\\x2fproject.mjs\"); const b=6 / 2;}}",
  "private-call-with": "class C { #with(){return 4;} f(){this.#with() / 2; import(\".\\x2fproject.mjs\"); const b=6 / 2;}}",
  "private-default": "class C { #default=4; f(){this.#default / 2; import(\".\\x2fproject.mjs\"); const b=6 / 2;}}",
  "optional-private-default": "class C { #default=4; f(){this?.#default / 2; import(\".\\x2fproject.mjs\"); const b=6 / 2;}}",
  "private-extends": "class C { #extends=4; f(){this.#extends / 2; import(\".\\x2fproject.mjs\"); const b=6 / 2;}}",
  "optional-private-extends": "class C { #extends=4; f(){this?.#extends / 2; import(\".\\x2fproject.mjs\"); const b=6 / 2;}}",
  "private-in": "class C { #in=4; f(){this.#in / 2; import(\".\\x2fproject.mjs\"); const b=6 / 2;}}",
  "optional-private-in": "class C { #in=4; f(){this?.#in / 2; import(\".\\x2fproject.mjs\"); const b=6 / 2;}}",
  "continue-label-asi": "label: while(false){continue label\n /\"/; import(\".\\x2fproject.mjs\"); /\"/;}"
};

test("the fourth review's 22 probes, verbatim, are all reported", async t => {
  const labels = Object.keys(reviewProbes), evaluated = v8Evaluate(Object.values(reviewProbes), { run: false });
  assert.equal(labels.length, 23);
  for (const [index, label] of labels.entries()) {
    const source = reviewProbes[label];
    assert.equal(evaluated[index].error, undefined, `${label}: V8 must accept the module`);
    assert.ok(readImports(source).some(item => item.specifier === "./project.mjs"), `${label}: readImports must find ./project.mjs`);
    assert.deepEqual((await nativeSource(t, source)).errors, [templeImport], label);
  }
});

test("a computed import in a shared module fails the check", async t => {
  const root = await fixture(t, {
    "bin/workkeel.mjs": entry,
    "src/workkeel-cli.mjs": 'import "./files.mjs";\n',
    "src/files.mjs": 'await import("./" + "project.mjs");\n'
  });
  assert.deepEqual(checkImportBoundary(root).errors, ["src/files.mjs: computed import() cannot be checked"]);
});

test("file: URLs, absolute paths and other non-package specifiers cannot reach repository files", async t => {
  const root = await fixture(t, { "bin/workkeel.mjs": entry, "src/project.mjs": 'console.log("LOADED");\nexport const value = 1;\n' });
  const real = await fs.realpath(root), absolute = path.join(real, "src/project.mjs");
  const rejected = [pathToFileURL(absolute).href, absolute, `data:text/javascript,import ${JSON.stringify(pathToFileURL(absolute).href)};`,
    "#internal", "C:\\repo\\src\\project.mjs", "@zsz1210/workkeel", "@zsz1210/workkeel/src/project.mjs", "/view.mjs"];
  // Node really loads the Temple module through the first two.
  for (const specifier of rejected.slice(0, 2)) {
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(specifier)});`], { encoding: "utf8" });
    assert.equal(run.stdout.trim(), "LOADED", specifier);
  }
  for (const specifier of rejected) {
    for (const form of [`await import(${JSON.stringify(specifier)});\n`, `import ${JSON.stringify(specifier)};\n`]) {
      await fs.writeFile(path.join(root, "src/workkeel-cli.mjs"), form);
      assert.deepEqual(checkImportBoundary(root).errors,
        [`src/workkeel-cli.mjs: import specifier ${JSON.stringify(specifier)} must be a relative path, a node: built-in or another package`], form);
    }
  }
});

test("package subpaths that Node could normalize back into the repository are rejected", async t => {
  const root = await fixture(t, {
    "bin/workkeel.mjs": entry,
    "src/project.mjs": 'console.log("LOADED");\nexport const value = 1;\n',
    "node_modules/ajv/package.json": '{"name":"ajv","version":"0.0.0","type":"module"}\n',
    "node_modules/ajv/index.mjs": "export default 1;\n"
  });
  // The fifth review's probes, verbatim: Node resolves both to this checkout's src/project.mjs.
  const probes = ["ajv/../../src/project.mjs", "ajv/%2e%2e/%2e%2e/src/project.mjs"];
  for (const specifier of probes) {
    await fs.writeFile(path.join(root, "src/workkeel-probe.mjs"), `await import(${JSON.stringify(specifier)});\n`);
    const run = spawnSync(process.execPath, [path.join(root, "src/workkeel-probe.mjs")], { encoding: "utf8" });
    assert.equal(run.stdout.trim(), "LOADED", specifier);
  }
  await fs.rm(path.join(root, "src/workkeel-probe.mjs"));
  const rejected = [...probes, "ajv/./../../src/project.mjs", "ajv//../../src/project.mjs", "ajv/dist/../../../src/project.mjs",
    "ajv/%2E%2E/%2E%2E/src/project.mjs", "ajv/..%2f..%2fsrc/project.mjs", "ajv/x%2f..%2f..%2f..%2fsrc/project.mjs",
    "ajv\\..\\..\\src\\project.mjs", "ajv/.", "ajv/", "ajv/x?y", "ajv/x#y", "@scope/pkg/../../../src/project.mjs",
    "@scope/../../src/project.mjs", "node:../src/project.mjs", "node:not-a-builtin"];
  for (const specifier of rejected) {
    for (const form of [`await import(${JSON.stringify(specifier)});\n`, `import ${JSON.stringify(specifier)};\n`]) {
      await fs.writeFile(path.join(root, "src/workkeel-cli.mjs"), form);
      assert.deepEqual(checkImportBoundary(root).errors,
        [`src/workkeel-cli.mjs: import specifier ${JSON.stringify(specifier)} must be a relative path, a node: built-in or another package`], form);
    }
  }
});

test("built-ins, other packages and the browser module's served assets stay allowed", async t => {
  const root = await fixture(t, {
    "bin/workkeel.mjs": entry,
    "src/workkeel-cli.mjs": 'import fs from "node:fs";\nimport fsp from "node:fs/promises";\nimport Ajv from "ajv";\nimport x from "ajv/dist/2020.js";\nawait import("@langchain/langgraph");\nawait import("@langchain/langgraph-checkpoint/dist/index.js");\nawait import("JSONStream");\n',
    "src/workkeel-monitor-client.mjs": 'import { label } from "/view.mjs";\n'
  });
  assert.deepEqual(checkImportBoundary(root).errors, []);
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
