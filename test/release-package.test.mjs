import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildCliBootstrapMetadata, SUPPORTED_NODE_RANGE } from "../src/bootstrap.mjs";
import {
  FORBIDDEN_PACKAGE_PREFIXES,
  REQUIRED_PACKAGE_PATHS,
  validatePackageDryRun
} from "../scripts/check-package.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("package and installed bootstrap expose the same qualified Node.js LTS range", async () => {
  const packageDocument = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  const bootstrap = await buildCliBootstrapMetadata();
  assert.equal(packageDocument.engines.node, SUPPORTED_NODE_RANGE);
  assert.equal(bootstrap.node, SUPPORTED_NODE_RANGE);
  assert.equal(packageDocument.private, undefined, "the approved Alpha package must be publishable");
  assert.deepEqual(packageDocument.publishConfig, { access: "public", tag: "next" });
});

test("package validator rejects missing, forbidden, undeclared and oversized manifests", () => {
  const pack = { files: REQUIRED_PACKAGE_PATHS.map((pathname) => ({ path: pathname })), unpackedSize: 1024 };
  assert.deepEqual(validatePackageDryRun(pack), []);
  for (const requiredPath of REQUIRED_PACKAGE_PATHS) {
    const missing = { ...pack, files: pack.files.filter((entry) => entry.path !== requiredPath) };
    assert.ok(validatePackageDryRun(missing).some((error) => error.includes(`missing: ${requiredPath}`)));
  }
  for (const prefix of FORBIDDEN_PACKAGE_PREFIXES) {
    assert.ok(validatePackageDryRun({ ...pack, files: [...pack.files, { path: `${prefix}secret` }] }).some((error) => error.includes("forbidden")), prefix);
  }
  assert.ok(validatePackageDryRun({ ...pack, files: [...pack.files, { path: "unknown.txt" }] }).some((error) => error.includes("undeclared")));
  assert.ok(validatePackageDryRun({ ...pack, files: [...pack.files, ...Array.from({ length: 500 }, (_, n) => ({ path: `src/${n}` }))] }).some((error) => error.includes("file count")));
  for (const size of [undefined, NaN, 9 * 1024 * 1024]) assert.ok(validatePackageDryRun({ ...pack, unpackedSize: size }).some((error) => error.includes("unpacked size")));
  assert.ok(validatePackageDryRun(null).length);
});
