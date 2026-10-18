import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PACKAGE_NAME, TEMPLATE_REPOSITORY, TEMPLATE_VERSION } from "../src/workkeel-version.mjs";
import { WORKKEEL_PACKAGE } from "../src/workkeel-project.mjs";

test("Workkeel package metadata, version and the CLI entrypoint agree", async () => {
  const pkg = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url)));
  const lock = JSON.parse(await fs.readFile(new URL("../package-lock.json", import.meta.url)));
  assert.equal(PACKAGE_NAME, "@zsz1210/workkeel");
  assert.equal(WORKKEEL_PACKAGE, PACKAGE_NAME);
  assert.equal(pkg.name, PACKAGE_NAME); assert.equal(lock.name, PACKAGE_NAME);
  assert.equal(lock.packages[""].name, PACKAGE_NAME);
  assert.equal(pkg.version, TEMPLATE_VERSION); assert.equal(lock.version, TEMPLATE_VERSION);
  assert.equal(pkg.repository.url, `git+https://github.com/${TEMPLATE_REPOSITORY}.git`);
  assert.equal(TEMPLATE_REPOSITORY, "zsz1210/workkeel");
  assert.deepEqual(Object.keys(pkg.bin), ["workkeel"]);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(`../${pkg.bin.workkeel}`, import.meta.url)), "version"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), TEMPLATE_VERSION);
});
