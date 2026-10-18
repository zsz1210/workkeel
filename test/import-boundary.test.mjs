import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkImportBoundary, readImports } from "../scripts/check-import-boundary.mjs";

async function fixture(t, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-boundary-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), content);
  }
  return root;
}

test("the repository native entry reaches only native and shared modules", () => {
  const result = checkImportBoundary();
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.bridges, ["src/workkeel-cli.mjs -> src/cli.mjs"]);
  assert.ok(result.reached.every(file => file === "bin/workkeel.mjs" || /^src\/(?:workkeel-[^/]+|files|ids|task-contract|headroom-adapter)\.mjs$/.test(file)));
});

test("native imports of Temple modules are rejected, including transitive ones", async t => {
  const root = await fixture(t, {
    "bin/workkeel.mjs": 'import "../src/workkeel-cli.mjs";\n',
    "src/workkeel-cli.mjs": 'import { a } from "./workkeel-a.mjs";\nconst x = await import("./cli.mjs");\n',
    "src/workkeel-a.mjs": 'export { b } from "./project.mjs";\n',
    "src/project.mjs": "export const b = 1;\n",
    "src/cli.mjs": 'import "./work-items.mjs";\n'
  });
  const result = checkImportBoundary(root);
  assert.deepEqual(result.errors, ["src/workkeel-a.mjs -> src/project.mjs: native code must not import Temple modules"]);
  assert.ok(!result.reached.includes("src/work-items.mjs"));
});

test("the legacy bridge must stay lazy and non-literal native imports are rejected", async t => {
  const root = await fixture(t, {
    "bin/workkeel.mjs": 'import "../src/workkeel-cli.mjs";\n',
    "src/workkeel-cli.mjs": 'import { main } from "./cli.mjs";\nconst name = "x";\nawait import(`./${name}.mjs`);\n',
    "src/cli.mjs": "export const main = 1;\n"
  });
  const { errors } = checkImportBoundary(root);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /must stay a lazy import/);
  assert.match(errors[1], /non-literal import/);
});

test("import parsing covers static, re-export, side-effect and dynamic forms", () => {
  const specifiers = readImports('import a from "./a.mjs";\nexport * from "./b.mjs";\nimport "./c.mjs";\nawait import(\'./d.mjs\');\nimport("node:fs");\n')
    .map(item => item.specifier);
  assert.deepEqual(specifiers, ["./a.mjs", "./b.mjs", "./c.mjs", "./d.mjs", "node:fs"]);
});
