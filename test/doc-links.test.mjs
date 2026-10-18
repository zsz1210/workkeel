import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { extractLocalLinks, resolveLocalLink } from "../scripts/check-doc-links.mjs";

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
