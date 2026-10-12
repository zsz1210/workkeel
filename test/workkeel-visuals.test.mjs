import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { generatedDiagrams } from "../scripts/generate-workkeel-diagrams.mjs";

test("committed explanatory diagrams match their dependency-free source", async () => {
  for (const [name, expected] of Object.entries(generatedDiagrams())) {
    const actual = await fs.readFile(new URL(`../docs/assets/${name}`, import.meta.url), "utf8");
    assert.equal(actual, expected, name);
    assert.match(actual, /<title id="title">/);
    assert.match(actual, /<desc id="desc">/);
    assert.doesNotMatch(actual, /<script|<foreignObject|(?:href|src)="https?:/);
  }
});

test("offline flow explorer declares isolation and preserves distinct task and run states", async () => {
  const html = await fs.readFile(new URL("../docs/assets/workkeel-flow.html", import.meta.url), "utf8");
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(|<script[^>]+src=/);
  for (const state of ["intake", "build", "test", "release_gate", "done"]) assert.ok(html.includes(`data-state="${state}"`));
  for (const state of ["created", "running", "awaiting-approval", "paused", "blocked", "completed", "cancelled", "rejected"]) assert.ok(html.includes(`'${state}'`));
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /aria-live="polite"/);
});
