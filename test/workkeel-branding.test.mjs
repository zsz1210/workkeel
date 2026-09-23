import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PACKAGE_NAME, TEMPLATE_REPOSITORY, TEMPLATE_VERSION, KNOWN_PACKAGE_NAMES } from "../src/constants.mjs";
import { buildCliBootstrapMetadata, validateCliBootstrapMetadata } from "../src/bootstrap.mjs";
import { WORKKEEL_PACKAGE } from "../src/workkeel-project.mjs";

test("Workkeel package metadata, version and both CLI entrypoints agree", async () => {
  const pkg = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url)));
  const lock = JSON.parse(await fs.readFile(new URL("../package-lock.json", import.meta.url)));
  assert.equal(PACKAGE_NAME, "@zsz1210/workkeel");
  assert.equal(WORKKEEL_PACKAGE, PACKAGE_NAME);
  assert.equal(pkg.name, PACKAGE_NAME); assert.equal(lock.name, PACKAGE_NAME);
  assert.equal(lock.packages[""].name, PACKAGE_NAME);
  assert.equal(pkg.repository.url, `git+https://github.com/${TEMPLATE_REPOSITORY}.git`);
  assert.equal(TEMPLATE_REPOSITORY, "zsz1210/workkeel");
  for (const name of ["workkeel", "temple"]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL(`../${pkg.bin[name]}`, import.meta.url)), "version"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), TEMPLATE_VERSION);
  }
});

test("new bootstrap pins Workkeel while explicit historical exact pins remain valid", async () => {
  const metadata = await buildCliBootstrapMetadata();
  assert.equal(metadata.package_spec, `@zsz1210/workkeel@${TEMPLATE_VERSION}`);
  assert.equal(validateCliBootstrapMetadata(metadata).valid, true);
  for (const name of ["@zsz1210/temple-ai-dev-org", "@zsz1210/ai-development-org-template"]) {
    assert.equal(KNOWN_PACKAGE_NAMES.has(name), true);
    assert.equal(validateCliBootstrapMetadata({ ...metadata, package_spec: `${name}@${TEMPLATE_VERSION}` }).valid, true);
  }
  for (const package_spec of ["@other/workkeel@0.1.0-alpha.33", "@zsz1210/workkeel@latest", "@zsz1210/temple-ai-dev-org@latest", "@zsz1210/workkeel@0.1.0-alpha.32"]) {
    assert.equal(validateCliBootstrapMetadata({ ...metadata, package_spec }).valid, false);
  }
});
