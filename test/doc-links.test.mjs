import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { extractFragmentLinks, extractLocalLinks, findBrokenLinks, headingSlug, linkFragment, markdownAnchors, resolveLocalLink } from "../scripts/check-doc-links.mjs";

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

test("heading slugs follow GitHub: lowercase, punctuation dropped, spaces to hyphens, Unicode kept", () => {
  assert.equal(headingSlug("Claim, deliver, review, accept"), "claim-deliver-review-accept");
  assert.equal(headingSlug("0.1.0-beta.1"), "010-beta1");
  assert.equal(headingSlug("2. Documentation language (from ADR-0012)"), "2-documentation-language-from-adr-0012");
  assert.equal(headingSlug("Use `task new` and [links](x.md)"), "use-task-new-and-links");
  assert.equal(headingSlug("快速開始 snake_case"), "快速開始-snake_case");
});

test("anchors cover ATX and setext headings, repeats and HTML ids, but not code blocks", () => {
  const anchors = markdownAnchors(["# Title", "## Setup", "## Setup #", "Other", "-----", "<a id=\"custom\"></a>", "```", "# Not a heading", "```", "- item", "---"].join("\n"));
  assert.deepEqual([...anchors].sort(), ["custom", "other", "setup", "setup-1", "title"]);
  assert.deepEqual(extractFragmentLinks("[A](#a) [B](b.md#b) `[C](#c)` [D](<#d e>)"), ["#a", "#d e"]);
  assert.equal(linkFragment("a.md#x%20y"), "x y");
  assert.equal(linkFragment("a.md#"), null);
  assert.equal(linkFragment("a.md"), null);
});

test("documentation link checks report missing heading anchors and keep file checks", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-doc-anchors-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, "docs"));
  await fs.writeFile(path.join(directory, "docs", "guide.md"), "# Guide\n\n## Quick start\n\n[Self](#guide) [Gone](#gone)\n");
  await fs.writeFile(path.join(directory, "docs", "notes.txt"), "plain\n");
  await fs.writeFile(path.join(directory, "README.md"), [
    "[Ok](docs/guide.md#quick-start)", "[Missing anchor](docs/guide.md#install)", "[Top](docs/guide.md#)",
    "[Not Markdown](docs/notes.txt#L1)", "[Missing file](docs/absent.md#x)"
  ].join("\n"));
  assert.deepEqual((await findBrokenLinks(directory)).sort(), [
    "README.md -> docs/absent.md#x",
    "README.md -> docs/guide.md#install (no such heading anchor)",
    "docs/guide.md -> #gone (no such heading anchor)"
  ]);
});
