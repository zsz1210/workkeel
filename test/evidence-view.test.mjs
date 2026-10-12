import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { evidenceView, MAX_EVIDENCE_VIEW_BYTES } from "../src/evidence-view.mjs";
const exec = promisify(execFile);
const cli = new URL("../bin/temple.mjs", import.meta.url).pathname;
const summary = "ℹ tests 2\nℹ suites 0\nℹ pass 1\nℹ fail 1\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 34.56\n";
async function fixture(t, text, name = "evidence.log") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "temple-evidence-view-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, name), text);
  return root;
}

test("compact spec output preserves failures, caveats, summary and final failure detail", async t => {
  const tail = "\n✖ failing tests:\nassertion: expected approved scope\n✔ literal evidence (1ms)\n";
  const input = "Unverified: no model billing measured\n✔ valid case (1.23ms)\n✖ rejects changed scope (2ms)\n  Error: stale digest\n" + summary + tail;
  const root = await fixture(t, input);
  const before = await fs.stat(path.join(root, "evidence.log"));
  const view = await evidenceView(root, { source: "evidence.log", format: "node-test", compact: true });
  assert.equal(view.omitted_passing_lines, 1);
  assert.equal(view.content, input.replace("✔ valid case (1.23ms)\n", ""));
  assert.equal(view.summary.fail, "1");
  assert.equal(view.acceptance_granted, false);
  assert.equal(view.execution_started, false);
  assert.equal(await fs.readFile(path.join(root, "evidence.log"), "utf8"), input);
  assert.equal((await fs.stat(path.join(root, "evidence.log"))).mtimeMs, before.mtimeMs);
  assert.deepEqual(await fs.readdir(root), ["evidence.log"]);
});

test("full read is the default; digest-pinned read recovers original and rejects drift", async t => {
  const input = "✔ valid case (1ms)\n" + summary;
  const root = await fixture(t, input);
  const view = await evidenceView(root, { source: "evidence.log", format: "node-test", compact: true });
  const full = await evidenceView(root, { source: "evidence.log", expectedSha256: view.source.sha256 });
  assert.equal(full.content, input);
  await fs.appendFile(path.join(root, "evidence.log"), "changed");
  await assert.rejects(evidenceView(root, { source: "evidence.log", expectedSha256: view.source.sha256 }), /digest changed/);
});

test("JSON compaction preserves exact numeric lexemes, duplicates, escapes and limitation text", async t => {
  const input = '{ "n": 9007199254740993, "n": -0, "x": 1.234567890123456789, "limit": "not a bill;  spaces \\t \\\"", "v": [null, false, 1e999] }\n';
  const root = await fixture(t, input);
  const view = await evidenceView(root, { source: "evidence.log", format: "json", compact: true });
  assert.equal(view.content, '{"n":9007199254740993,"n":-0,"x":1.234567890123456789,"limit":"not a bill;  spaces \\t \\\"","v":[null,false,1e999]}');
  assert.equal(view.omitted_passing_lines, 0);
});

test("unknown, incomplete, colored and prose formats are not guessed or truncated", async t => {
  const input = "✔ approved authority (1ms)\nℹ tests 1\n";
  const root = await fixture(t, input);
  for (const format of ["node-test", "text"]) assert.equal((await evidenceView(root, { source: "evidence.log", format, compact: true })).content, input);
  const colored = "\x1b[32m✔ valid case (1ms)\x1b[0m\n" + summary;
  await fs.writeFile(path.join(root, "evidence.log"), colored);
  assert.equal((await evidenceView(root, { source: "evidence.log", format: "node-test", compact: true })).content, colored);
});

test("invalid JSON, UTF-8, binary and oversize evidence fail clearly", async t => {
  const root = await fixture(t, "not JSON");
  await assert.rejects(evidenceView(root, { source: "evidence.log", format: "json", compact: true }), /valid JSON/);
  await fs.writeFile(path.join(root, "evidence.log"), Buffer.from([0xff]));
  await assert.rejects(evidenceView(root, { source: "evidence.log" }), /UTF-8/);
  await fs.writeFile(path.join(root, "evidence.log"), "a\0b");
  await assert.rejects(evidenceView(root, { source: "evidence.log" }), /Binary/);
  await fs.truncate(path.join(root, "evidence.log"), MAX_EVIDENCE_VIEW_BYTES + 1);
  await assert.rejects(evidenceView(root, { source: "evidence.log" }), /8 MiB/);
});

test("unsafe paths, symlink components and special files are refused", async t => {
  const root = await fixture(t, "private original");
  for (const source of ["../evidence.log", "/etc/passwd", "./evidence.log", "x//y", "x\\y", "C:/file", "x\ny"]) {
    await assert.rejects(evidenceView(root, { source }), /relative path/);
  }
  await fs.symlink("evidence.log", path.join(root, "linked"));
  await assert.rejects(evidenceView(root, { source: "linked" }), /links or special/);
  await fs.mkdir(path.join(root, "dir"));
  await fs.writeFile(path.join(root, "dir", "nested"), "text");
  await fs.symlink("dir", path.join(root, "linked-dir"));
  await assert.rejects(evidenceView(root, { source: "linked-dir/nested" }), /links or special/);
  await assert.rejects(evidenceView(root, { source: "dir" }), /links or special/);
  if (process.platform !== "win32") {
    await exec("mkfifo", [path.join(root, "fifo")]);
    await assert.rejects(evidenceView(root, { source: "fifo" }), /links or special/);
  }
});

test("CLI is read-only, rejects unsupported options and withholds changed source content", async t => {
  const root = await fixture(t, "✔ passes (1ms)\n" + summary);
  const args = [cli, "evidence", "view", root, "--source", "evidence.log", "--format", "node-test", "--compact", "--json"];
  const view = JSON.parse((await exec(process.execPath, args)).stdout);
  assert.equal(view.omitted_passing_lines, 1);
  assert.equal(view.mutation_performed, false);
  assert.deepEqual(await fs.readdir(root), ["evidence.log"]);
  await assert.rejects(exec(process.execPath, [...args, "--output", "bad.md"]), /Unsupported/);
  await fs.appendFile(path.join(root, "evidence.log"), "DO_NOT_OUTPUT_CHANGED_CONTENT");
  await assert.rejects(exec(process.execPath, [...args, "--expected-sha256", view.source.sha256]), error => {
    assert(!error.stdout.includes("DO_NOT_OUTPUT_CHANGED_CONTENT"));
    assert.match(error.stderr, /digest changed/);
    return true;
  });
});
