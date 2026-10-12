import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJsonRpcProcess } from "../src/codex-app-server-provider.mjs";

const fixture = `
  const readline = require('node:readline');
  if (process.argv[1] === 'stubborn') process.on('SIGTERM', () => {});
  else process.on('SIGTERM', () => process.exit(0));
  setInterval(() => {}, 1000);
  readline.createInterface({ input: process.stdin }).on('line', line => {
    const message = JSON.parse(line);
    if (message.method === 'pending') return;
    if (message.method === 'exit') process.exit(0);
    process.stdout.write(JSON.stringify({ id: message.id, result: message.params }) + '\\n');
  });
`;

function owned(t, mode = "graceful", options = {}) {
  const rpc = createJsonRpcProcess(process.execPath, ["-e", fixture, mode], options);
  t.after(async () => {
    if (rpc.child.exitCode === null && rpc.child.signalCode === null) {
      const exit = once(rpc.child, "exit");
      rpc.child.kill("SIGKILL");
      await exit;
    }
    await rpc.close();
  });
  return rpc;
}

test("close confirms graceful exit and preserves ordinary JSON-RPC", async t => {
  const rpc = owned(t);
  assert.deepEqual(await rpc.request("ready", { value: 42 }), { value: 42 });
  await rpc.close();
  assert.equal(rpc.child.exitCode, 0);
  assert.equal(rpc.child.stdin.destroyed, true);
  await assert.rejects(rpc.request("after-close"), /closed/);
  await rpc.close();
});

test("close escalates an owned TERM-resistant child and leaves a sibling untouched", { skip: process.platform === "win32" }, async t => {
  const rpc = owned(t, "stubborn");
  const sibling = owned(t);
  await Promise.all([rpc.request("ready"), sibling.request("ready")]);
  const pending = assert.rejects(rpc.request("pending", {}, 10000), /closed|exited/);
  const first = rpc.close();
  const second = rpc.close();
  await Promise.all([first, second]);
  assert.equal(rpc.child.signalCode, "SIGKILL");
  assert.strictEqual(first, second, "concurrent callers share the confirmed shutdown");
  await pending;
  assert.equal(rpc.child.stdout.destroyed, true);
  assert.equal(sibling.child.exitCode, null);
  assert.equal(sibling.child.signalCode, null);
  assert.deepEqual(await sibling.request("still-alive", { owned: false }), { owned: false });
});

test("natural exit rejects pending requests and close remains safe", async t => {
  const rpc = owned(t);
  await rpc.request("ready");
  const pending = assert.rejects(rpc.request("pending", {}, 10000), /exited/);
  const exit = once(rpc.child, "exit");
  rpc.notify("exit");
  await exit;
  await pending;
  await rpc.close();
  assert.equal(rpc.child.stdin.destroyed, true);
});

test("spawn failure rejects outstanding work promptly and can be closed", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "temple-spawn-failure-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const rpc = createJsonRpcProcess(path.join(directory, "nonexistent-command"));
  const request = assert.rejects(rpc.request("never-started", {}, 10000), /ENOENT|ENOTDIR|closed/);
  await request;
  await rpc.close();
  assert.equal(rpc.child.pid, undefined);
});

test("synchronous send failure does not poison later requests or shutdown", async t => {
  const rpc = owned(t);
  await rpc.request("ready");
  const circular = {}; circular.self = circular;
  await assert.rejects(rpc.request("circular", circular, 10000), /circular/i);
  assert.deepEqual(await rpc.request("healthy", { ok: true }), { ok: true });
  await rpc.close();
});

test("unconfirmed termination reports failure instead of successful cleanup", async t => {
  const rpc = createJsonRpcProcess(process.execPath, ["-e", fixture, "stubborn"]);
  const kill = rpc.child.kill.bind(rpc.child);
  t.after(async () => {
    rpc.child.kill = kill;
    if (rpc.child.exitCode === null && rpc.child.signalCode === null) {
      const exit = once(rpc.child, "exit");
      kill("SIGKILL");
      await exit;
    }
  });
  await rpc.request("ready");
  const signals = [];
  rpc.child.kill = signal => { signals.push(signal); return false; };
  await assert.rejects(rpc.close(), /could not confirm child exit/);
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(rpc.child.exitCode, null);
  assert.equal(rpc.child.signalCode, null);
});
