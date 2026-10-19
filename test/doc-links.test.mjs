import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { extractLocalLinks, findBrokenLinks, resolveLocalLink } from "../scripts/check-doc-links.mjs";

test("documentation link extraction keeps local targets and ignores external destinations", () => {
  const markdown = [
    "[Guide](docs/guide.md)",
    "[Section](#section)",
    "[Web](https://example.com)",
    "![Diagram](docs/assets/flow.svg)",
    "`[Code](not-a-link.md)`"
  ].join("\n");

  assert.deepEqual(extractLocalLinks(markdown), ["docs/guide.md", "docs/assets/flow.svg"]);
});

test("documentation link resolution handles relative paths, fragments, and encoded names", () => {
  const source = path.join("/workspace", "docs", "guide.md");

  assert.equal(resolveLocalLink(source, "../README.md#start"), path.join("/workspace", "README.md"));
  assert.equal(resolveLocalLink(source, "assets/My%20Flow.svg?raw=1"), path.join("/workspace", "docs", "assets", "My Flow.svg"));
  assert.equal(resolveLocalLink(source, "#local"), null);
});

test("documentation link checks skip git-ignored Markdown", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-doc-links-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, ".workkeel-private"));
  await fs.writeFile(path.join(directory, ".workkeel-private", "notes.md"), "[Missing](missing.md)\n");
  await fs.writeFile(path.join(directory, "README.md"), "[Missing](absent.md)\n");
  // Without Git nothing is ignored.
  assert.deepEqual((await findBrokenLinks(directory)).sort(), [".workkeel-private/notes.md -> missing.md", "README.md -> absent.md"]);
  assert.equal(spawnSync("git", ["init", "-q", directory]).status, 0);
  await fs.writeFile(path.join(directory, ".gitignore"), ".workkeel-private/\n");
  assert.deepEqual(await findBrokenLinks(directory), ["README.md -> absent.md"]);
});
