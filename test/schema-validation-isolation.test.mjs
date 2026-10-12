import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { validateProjectSchemas } from "../src/schema-validation.mjs";

const draft = "https://json-schema.org/draft/2020-12/schema";
const schema = (extra = {}) => ({ $schema: draft, $id: "fixture", type: "integer", ...extra });
async function write(root, file, value) {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), JSON.stringify(value));
}
async function fixture(t, cases) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "temple-schema-isolation-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await write(root, ".ai-org/learning/index.json", { schema_version: "ai-org.learning-index/v2", entries: [] });
  await setCases(root, cases);
  return root;
}
async function setCases(root, cases) {
  await write(root, ".ai-org/core/schemas/schema-catalog.json", {
    schema_version: "temple.schema-catalog/v1",
    documents: cases.map((_, i) => ({ id: `synthetic-${i}`, schema: `${i}.json`, path: `data/${i}.json`, required: true }))
  });
  for (const [i, c] of cases.entries()) {
    await write(root, `.ai-org/core/schemas/${i}.json`, c.schema);
    await write(root, `data/${i}.json`, c.data);
  }
}
function isolatedOutcome(c) {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
  addFormats(ajv);
  let validate;
  try { validate = ajv.compile(c.schema); }
  catch (error) { return { compile: error.message }; }
  return { valid: validate(c.data), errors: structuredClone(validate.errors ?? []) };
}
async function assertIsolated(root, cases) {
  const result = await validateProjectSchemas(root);
  for (const [i, c] of cases.entries()) {
    const expected = isolatedOutcome(c), file = `.ai-org/core/schemas/${i}.json`;
    const errors = result.errors.filter(e => e.schema === file);
    if (expected.compile) {
      assert.deepEqual(errors.map(e => [e.keyword, e.message]), [["compile", expected.compile]]);
      assert.ok(!result.checked.some(e => e.schema === file));
    } else {
      assert.equal(result.checked.find(e => e.schema === file)?.valid, expected.valid);
      assert.deepEqual(errors.map(e => [e.keyword, e.instance_path, e.schema_path, e.message, e.params]),
        expected.errors.map(e => [e.keyword, e.instancePath, e.schemaPath, e.message, e.params]));
    }
  }
  assert.equal(result.errors.some(e => e.schema === "runtime:temple.skill-proposal/v1"), false);
  return result;
}

test("schema entries preserve isolated IDs, references, formats and compile failures in either order", async t => {
  const cases = [
    { schema: schema(), data: 3 },
    { schema: schema({ type: "string", format: "email" }), data: "not-an-email" },
    { schema: schema({ $id: "provider", $defs: { number: { type: "number" } } }), data: 3 },
    { schema: schema({ $id: "consumer", $ref: "provider#/$defs/number" }), data: 3 },
    { schema: schema({ $id: "nested", $defs: { child: { $id: "child", type: "string" } }, type: "string", $ref: "child" }), data: "ok" },
    { schema: schema({ $id: "after-nested", $ref: "child" }), data: 3 },
    { schema: schema({ $defs: { value: { type: "integer" } }, $ref: "#/$defs/value" }), data: "invalid" },
    { schema: schema({ type: "not-a-type" }), data: 3 },
    { schema: schema({ minimum: 5 }), data: 3 },
    { schema: { type: "integer" }, data: "bad" },
    { schema: { $schema: "https://json-schema.org/schema", type: "integer" }, data: 3 },
    { schema: false, data: 3 },
    { schema: schema({ $schema: "https://invalid.example/schema" }), data: 3 },
    { schema: schema({ $id: draft }), data: 3 }
  ];
  const root = await fixture(t, cases);
  await assertIsolated(root, cases);
  cases.reverse(); await setCases(root, cases); await assertIsolated(root, cases);
});

test("schema and document changes and parallel roots never reuse previous validation results", async t => {
  const first = [{ schema: schema(), data: 3 }], second = [{ schema: schema({ type: "string" }), data: "ok" }];
  const a = await fixture(t, first), b = await fixture(t, second);
  await Promise.all([assertIsolated(a, first), assertIsolated(b, second)]);
  await setCases(a, second); assert.equal((await assertIsolated(a, second)).valid, true);
  await write(a, "data/0.json", 3);
  assert.equal((await assertIsolated(a, [{ ...second[0], data: 3 }])).valid, false);
  await write(a, ".ai-org/core/schemas/0.json", schema());
  assert.equal((await assertIsolated(a, first)).valid, true);
  assert.equal((await assertIsolated(b, second)).valid, true);
});

test("fresh file parsing, required documents and semantic validation remain mandatory", async t => {
  const root = await fixture(t, [{ schema: schema(), data: 3 }]);
  await fs.unlink(path.join(root, "data/0.json"));
  assert.ok((await validateProjectSchemas(root)).errors.some(e => e.keyword === "required"));
  await fs.writeFile(path.join(root, "data/0.json"), "{");
  assert.ok((await validateProjectSchemas(root)).errors.some(e => e.keyword === "parse"));
  await write(root, ".ai-org/core/schemas/schema-catalog.json", { schema_version: "temple.schema-catalog/v1", documents: [
    { id: "usage-policy", schema: "0.json", path: "data/0.json", required: true }
  ] });
  await write(root, ".ai-org/core/schemas/0.json", schema({ type: "object" }));
  await write(root, "data/0.json", {});
  assert.ok((await validateProjectSchemas(root)).errors.some(e => e.keyword === "semantic"));
});
