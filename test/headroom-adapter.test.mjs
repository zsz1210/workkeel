import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHeadroomView, createHeadroomPayload, readHeadroomOriginal, runHeadroomWorker, HEADROOM_CONTRACT } from "../src/headroom-adapter.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const cli = fileURLToPath(new URL("../bin/temple.mjs", import.meta.url));
async function fixture(t, content = "record: example value\r\n".repeat(1000)) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "temple-headroom-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const input = path.join(root, "input.txt"), snapshot = path.join(root, "original.txt");
  await fs.writeFile(input, content);
  // Existing adversarial snapshot/worker tests explicitly exercise lossy views.
  return { root, input, snapshot, content, allowLossy: true };
}
function worker(content = "Condensed fictional result") {
  return async ({ content: original }) => ({ version: "0.37.0", tokenizer_version: "0.14.0",
    original_sha256: hash(original), content, transforms: ["fixture-transform"], input_tokens: 6000, output_tokens: 6 });
}
const forbidden = async () => { throw new Error("must not execute"); };

function payloadWorker({ inputTokens = 6000, tokens = 100, content = "Condensed result" } = {}) {
  return async (data) => {
    const base = await worker(content)(data);
    const text = JSON.stringify({ content, readback: data.modelReadback, ...(data.modelNotice ? { notice: data.modelNotice } : {}) });
    return { ...base, input_tokens: inputTokens, model_payload: { text, sha256: hash(text), tokens } };
  };
}

test("enabled default admits complete JSON tables and rejects unmarked row loss in both APIs", async (t) => {
  const rows = Array.from({ length: 400 }, (_,id) => ({ id, detail: `unique-detail-${id}` }));
  const f = await fixture(t, JSON.stringify(rows, null, 2));
  const table = '[400]{id:int,detail:string}\n'+rows.map(r=>`${r.id},${r.detail}`).join('\n');
  for (const [name, create] of [["view", createHeadroomView], ["payload", createHeadroomPayload]]) {
    const snapshot = path.join(f.root, `${name}.txt`);
    const answer = await create({ ...f, allowLossy: undefined, snapshot, enabled: true, kind: "json" }, { runWorker: payloadWorker({ content: table }) });
    const view = answer.diagnostics ?? answer;
    assert.equal(view.status, "compressed"); assert.equal(view.preservation, "verified-json-values");
    assert.equal(view.compression_policy, "lossless-only"); assert.equal(view.notice, undefined);
    if (name === "payload") assert.deepEqual(Object.keys(JSON.parse(answer.text)), ["content", "readback"]);
    assert.equal((await readHeadroomOriginal({ input: snapshot, sha256: hash(f.content) })).content, f.content);
    const rejectedSnapshot = path.join(f.root, `${name}-rejected.txt`);
    const dropped = await create({ ...f, allowLossy: undefined, snapshot: rejectedSnapshot, enabled: true, kind: "json" }, { runWorker: payloadWorker({ content: JSON.stringify(rows.slice(0,15)) }) });
    const rejected = dropped.diagnostics ?? dropped;
    assert.equal(rejected.reason, "lossless-unverified"); assert.equal(rejected.content, f.content);
    assert.equal(rejected.preservation, "original"); assert.equal(rejected.readback, null);
    await assert.rejects(fs.access(rejectedSnapshot));
  }
});

test("lossy selection needs separate opt-in and includes its notice in measured model text", async (t) => {
  const f = await fixture(t, JSON.stringify(Array.from({length:400},(_,i)=>`${i}:`+'abcdef'.repeat(20)),null,2));
  const short = JSON.stringify(JSON.parse(f.content).slice(0,15));
  const result = await createHeadroomPayload({ ...f, enabled:true, kind:"json" }, {runWorker:payloadWorker({content:short})});
  assert.equal(result.diagnostics.status,'compressed'); assert.equal(result.diagnostics.preservation,'unverified');
  assert.match(JSON.parse(result.text).notice,/may omit details/);
  const noNotice = await createHeadroomPayload({ ...f, snapshot:path.join(f.root,'bad.txt'), enabled:true, kind:'json' }, {runWorker:async data=>{
    const r=await payloadWorker({content:short})(data);
    r.model_payload.text=JSON.stringify({content:short,readback:data.modelReadback});r.model_payload.sha256=hash(r.model_payload.text);
    return r;
  }});
  assert.equal(noNotice.diagnostics.reason,'invalid-payload-measurement'); assert.equal(noNotice.text,f.content);
  await assert.rejects(fs.access(path.join(f.root,'bad.txt')));
});

test("default text bypass avoids workers; opting into lossy does not enable a disabled adapter", async (t) => {
  const f=await fixture(t);let calls=0;const runWorker=async()=>{calls++;return {};};
  const raw=await createHeadroomPayload({...f,allowLossy:undefined,enabled:true,kind:'log'},{runWorker});
  assert.equal(raw.text,f.content);assert.equal(raw.diagnostics.reason,'lossless-json-only');
  const disabled=await createHeadroomPayload({...f,enabled:false,kind:'log'},{runWorker});
  assert.equal(disabled.diagnostics.reason,'disabled');assert.equal(calls,0);
  await assert.rejects(createHeadroomPayload({...f,allowLossy:'true'}),/boolean/);
  const args=[cli,'adapter','headroom-payload',f.root,'--input','input.txt','--kind','log','--json'];
  const selected=spawnSync(process.execPath,[...args,'--allow-lossy-headroom'],{encoding:'utf8'});
  assert.equal(selected.status,0,selected.stderr);
  assert.equal(JSON.parse(selected.stdout).diagnostics.compression_policy,'allow-lossy');
  assert.equal(JSON.parse(selected.stdout).diagnostics.reason,'disabled');
  const plain=spawnSync(process.execPath,[...args,'--enable-headroom'],{encoding:'utf8'});
  assert.equal(plain.status,0,plain.stderr);assert.equal(JSON.parse(plain.stdout).diagnostics.reason,'lossless-json-only');
});

test("model payload passthrough is byte exact without a worker or diagnostic wrapper", async (t) => {
  const f = await fixture(t, "\ufeff日本語 😀\r\nno trailing newline");
  let calls = 0;
  for (const enabled of [false, true]) {
    const result = await createHeadroomPayload({ ...f, enabled, kind: "log" }, { runWorker: async () => { calls++; return {}; } });
    assert.equal(result.text, f.content);
    assert.equal(result.diagnostics.metrics.worker_attempts, 0);
  }
  assert.equal(calls, 0); assert.deepEqual(await fs.readdir(f.root), ["input.txt"]);
});

test("payload admission counts metadata and enforces absolute and proportional savings before writing", async (t) => {
  const f = await fixture(t);
  for (const [inputTokens, tokens, accepted] of [[1000, 745, false], [1000, 744, true], [6000, 5401, false], [6000, 5400, true]]) {
    const snapshot = path.join(f.root, `raw-${inputTokens}-${tokens}.txt`);
    const result = await createHeadroomPayload({ ...f, snapshot, enabled: true, kind: "log" }, { runWorker: payloadWorker({ inputTokens, tokens }) });
    assert.equal(result.diagnostics.status === "compressed", accepted);
    const estimate = result.diagnostics.metrics.model_text_token_estimate;
    assert.equal(estimate.returned_output, accepted ? tokens : inputTokens);
    if (accepted) {
      const body = JSON.parse(result.text);
      assert.deepEqual(Object.keys(body), ["content", "readback", "notice"]);
      assert.match(body.notice, /may omit details/);
      assert.equal((await readHeadroomOriginal({ input: body.readback.snapshot, sha256: body.readback.sha256 })).content, f.content);
    } else {
      assert.equal(result.text, f.content); assert.equal(result.diagnostics.reason, "insufficient-payload-savings");
      await assert.rejects(fs.access(snapshot));
    }
  }
});

test("tiny content savings or invalid complete-text measurements return raw without snapshots", async (t) => {
  const f = await fixture(t);
  const variants = [
    async (data) => ({ ...await payloadWorker()(data), model_payload: undefined }),
    async (data) => { const r = await payloadWorker()(data); r.model_payload.tokens = -1; return r; },
    async (data) => { const r = await payloadWorker()(data); r.model_payload.tokens = Infinity; return r; },
    async (data) => { const r = await payloadWorker()(data); r.model_payload.sha256 = "0".repeat(64); return r; },
    async (data) => { const r = await payloadWorker()(data); r.model_payload.text = "stripped readback"; r.model_payload.sha256 = hash(r.model_payload.text); return r; },
    payloadWorker({ tokens: 5999 }),
    payloadWorker({ content: f.content + "bigger", tokens: 1 })
  ];
  for (const runWorker of variants) {
    const result = await createHeadroomPayload({ ...f, enabled: true, kind: "log" }, { runWorker });
    assert.equal(result.text, f.content); assert.equal(result.diagnostics.status, "original");
    assert.equal(result.diagnostics.readback, null); await assert.rejects(fs.access(f.snapshot));
  }
});

test("payload keeps exact serialized readback and snapshot failure restores raw accounting", async (t) => {
  const f = await fixture(t);
  const content = '引用 "quoted" \\ line\n😀';
  const success = await createHeadroomPayload({ ...f, enabled: true, kind: "log" }, { runWorker: payloadWorker({ content }) });
  assert.equal(JSON.parse(success.text).content, content);
  assert.equal(success.diagnostics.metrics.model_text_token_estimate.returned_output, 100);
  const snapshot = path.join(f.root, "conflict.txt");
  const failed = await createHeadroomPayload({ ...f, snapshot, enabled: true, kind: "log" }, { runWorker: async (data) => {
    await fs.writeFile(snapshot, "another owner"); return payloadWorker()(data);
  } });
  assert.equal(failed.text, f.content); assert.equal(failed.diagnostics.reason, "snapshot-write-failed");
  assert.equal(failed.diagnostics.metrics.model_text_token_estimate.returned_output, 6000);
  assert.equal(await fs.readFile(snapshot, "utf8"), "another owner");
});

test("payload CLI emits only exact model text unless operator JSON is explicitly requested", async (t) => {
  const f = await fixture(t, "\ufeff繁體中文\r\nno newline");
  const args = [cli, "adapter", "headroom-payload", f.root, "--input", "input.txt", "--kind", "log", "--enable-headroom"];
  const plain = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(plain.status, 0, plain.stderr); assert.equal(plain.stdout, f.content); assert.equal(plain.stderr, "");
  const diagnostic = spawnSync(process.execPath, [...args, "--json"], { encoding: "utf8" });
  assert.equal(diagnostic.status, 0, diagnostic.stderr);
  const value = JSON.parse(diagnostic.stdout);
  assert.equal(value.text, f.content); assert.equal(value.diagnostics.metrics.worker_attempts, 0);
});

test("disabled, small, unsupported and malformed JSON skip runtime and snapshot", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const runWorker = async () => { calls++; return forbidden(); };
  for (const [options, reason] of [
    [{}, "disabled"], [{ enabled: true, kind: "code" }, "unsupported-kind"],
    [{ enabled: true, kind: "json" }, "invalid-json"]
  ]) {
    const view = await createHeadroomView({ ...f, kind: "log", ...options }, { runWorker });
    assert.equal(view.content, f.content); assert.equal(view.reason, reason);
    assert.equal(view.readback, null); assert.equal(view.metrics.model_usage, null);
  }
  await fs.writeFile(f.input, "short 日本語\n");
  const view = await createHeadroomView({ ...f, kind: "log", enabled: true }, { runWorker });
  assert.equal(view.reason, "below-threshold"); assert.equal(calls, 0);
  assert.deepEqual((await fs.readdir(f.root)).sort(), ["input.txt"]);
});

test("compressed view preserves an exclusive exact Unicode original and measures returned content", async (t) => {
  const f = await fixture(t, "\ufeff日本語繁體中文 😀\r\n".repeat(1300));
  const view = await createHeadroomView({ ...f, kind: "log", enabled: true }, { runWorker: worker() });
  assert.equal(view.status, "compressed"); assert.equal(view.source_sha256, hash(f.content));
  assert.equal(view.metrics.worker_attempts, 1); assert.equal(view.metrics.snapshot_bytes, Buffer.byteLength(f.content));
  assert.equal(view.metrics.output_bytes, Buffer.byteLength(view.content));
  assert.equal(view.metrics.local_token_estimate.returned_output, 6);
  if (process.platform !== "win32") assert.equal((await fs.stat(f.snapshot)).mode & 0o777, 0o600);
  const reread = await readHeadroomOriginal({ input: view.readback.snapshot, sha256: view.readback.sha256 });
  assert.equal(reread.content, f.content); assert.equal(reread.metrics.output_bytes, Buffer.byteLength(f.content));
  assert.equal(await fs.readFile(f.input, "utf8"), f.content);
  const again = await createHeadroomView({ ...f, kind: "log", enabled: true }, { runWorker: forbidden });
  assert.equal(again.reason, "snapshot-exists"); assert.equal(again.content, f.content);
});

test("worker failures, private diagnostics, drift, CCR and expansion fall back without storing", async (t) => {
  const f = await fixture(t);
  const good = await worker()({ content: f.content });
  const variants = [
    async () => { throw new Error("PRIVATE SECRET"); },
    async () => ({ failure: "worker-timeout", stderr: "PRIVATE SECRET" }),
    async () => ({ ...good, version: "next" }),
    async () => ({ ...good, original_sha256: "0".repeat(64) }),
    async () => ({ ...good, content: "<<ccr:abc123>>" }),
    async () => ({ ...good, content: f.content + "longer" }),
    async () => ({ ...good, input_tokens: NaN }),
    async () => ({ ...good, output_tokens: 6000 })
  ];
  for (const runWorker of variants) {
    const result = await createHeadroomView({ ...f, kind: "log", enabled: true }, { runWorker });
    assert.equal(result.status, "original"); assert.equal(result.content, f.content); assert.equal(result.readback, null);
    assert.ok(!JSON.stringify(result).includes("PRIVATE SECRET"));
    if (result.metrics.local_token_estimate) assert.equal(result.metrics.local_token_estimate.returned_output, 6000);
  }
  assert.deepEqual((await fs.readdir(f.root)).sort(), ["input.txt"]);
});

test("snapshot conflict during compression preserves competing file and returns original", async (t) => {
  const f = await fixture(t);
  const result = await createHeadroomView({ ...f, kind: "log", enabled: true }, { runWorker: async (data) => {
    await fs.writeFile(f.snapshot, "other owner"); return worker()(data);
  } });
  assert.equal(result.reason, "snapshot-write-failed"); assert.equal(result.content, f.content);
  assert.equal(await fs.readFile(f.snapshot, "utf8"), "other owner");
});

test("replacing the checked snapshot parent cannot redirect a write into canonical state", async (t) => {
  const f = await fixture(t);
  const parent = path.join(f.root, "snapshots"), protectedDir = path.join(f.root, ".ai-org");
  await fs.mkdir(parent); await fs.mkdir(protectedDir);
  const snapshot = path.join(parent, "original.txt");
  const result = await createHeadroomView({ ...f, snapshot, enabled: true, kind: "log" }, { runWorker: async (data) => {
    await fs.rename(parent, path.join(f.root, "moved"));
    await fs.symlink(protectedDir, parent);
    return worker()(data);
  } });
  assert.equal(result.status, "original"); assert.equal(result.content, f.content);
  assert.equal(result.reason, "snapshot-write-failed"); assert.equal(result.readback, null);
  assert.deepEqual(await fs.readdir(protectedDir), []);
  assert.deepEqual(await fs.readdir(path.join(f.root, "moved")), []);
});

test("a new directory at the same snapshot pathname fails the pinned identity check", async (t) => {
  const f = await fixture(t); const parent = path.join(f.root, "snapshots"); await fs.mkdir(parent);
  const result = await createHeadroomView({ ...f, snapshot: path.join(parent, "original.txt"), enabled: true, kind: "log" }, { runWorker: async (data) => {
    await fs.rename(parent, path.join(f.root, "moved")); await fs.mkdir(parent);
    return worker()(data);
  } });
  assert.equal(result.reason, "snapshot-write-failed"); assert.equal(result.readback, null);
  assert.deepEqual(await fs.readdir(parent), []);
});

test("readback rejects corruption, missing files, symlinks, binary and oversized data", async (t) => {
  const f = await fixture(t);
  await assert.rejects(readHeadroomOriginal({ input: f.input, sha256: "invalid" }), /exact lowercase/);
  await assert.rejects(readHeadroomOriginal({ input: f.input, sha256: "0".repeat(64) }), /changed/);
  await assert.rejects(readHeadroomOriginal({ input: f.snapshot, sha256: hash(f.content) }));
  await fs.symlink(f.input, f.snapshot);
  await assert.rejects(readHeadroomOriginal({ input: f.snapshot, sha256: hash(f.content) }));
  await fs.writeFile(f.input, Buffer.from([0xff, 0xfe]));
  await assert.rejects(createHeadroomView({ input: f.input }));
  await fs.writeFile(f.input, Buffer.alloc(HEADROOM_CONTRACT.maximumBytes + 1));
  await assert.rejects(createHeadroomView({ input: f.input }), /1 MiB/);
  await assert.rejects(createHeadroomView({ input: f.root }));
});

test("canonical snapshot paths and symlinked canonical parents never execute", async (t) => {
  const f = await fixture(t);
  const protectedDir = path.join(f.root, ".ai-org"); await fs.mkdir(protectedDir);
  await fs.symlink(protectedDir, path.join(f.root, "alias"));
  for (const snapshot of ["relative.txt", path.join(protectedDir, "x.txt"), path.join(f.root, "alias/x.txt")]) {
    let called = false;
    const result = await createHeadroomView({ ...f, snapshot, enabled: true, kind: "log" }, { runWorker: async () => { called = true; return {}; } });
    assert.equal(result.status, "original"); assert.equal(called, false);
  }
  assert.deepEqual(await fs.readdir(protectedDir), []);
  const protectedInput = path.join(protectedDir, "evidence.json");
  await fs.writeFile(protectedInput, f.content);
  const protectedView = await createHeadroomView({ ...f, input: protectedInput, enabled: true, kind: "log" }, { runWorker: forbidden });
  assert.equal(protectedView.reason, "protected-source");
  assert.equal(protectedView.content, f.content);
});

test("actual runner confines network and writes and removes its scratch", { skip: process.platform !== "darwin" }, async (t) => {
  const f = await fixture(t);
  const executable = path.join(f.root, "fixture-runtime.mjs");
  const outside = path.join(f.root, "forbidden.txt");
  await fs.writeFile(executable, `#!${process.execPath}
import fs from 'node:fs'; import net from 'node:net';
let denied=false;try{fs.writeFileSync(${JSON.stringify(outside)},'forbidden')}catch{denied=true}
fs.writeFileSync(process.env.HOME+'/scratch.txt','allowed');
const socket=net.connect({host:'127.0.0.1',port:9});
socket.on('connect',()=>{console.log(JSON.stringify({failure:'network-was-allowed'}));socket.destroy()});
socket.on('error',error=>console.log(JSON.stringify({writeDenied:denied,networkDenied:error.code==='EPERM'||error.code==='EACCES',scratch:process.env.HOME,secretInherited:process.env.TEMPLE_FIXTURE_SECRET!==undefined})));
`, { mode: 0o700 });
  process.env.TEMPLE_FIXTURE_SECRET = "must not inherit";
  let result;
  try { result = await runHeadroomWorker({ content: f.content, query: "fixture", python: executable }); }
  finally { delete process.env.TEMPLE_FIXTURE_SECRET; }
  assert.equal(result.writeDenied, true); assert.equal(result.networkDenied, true);
  assert.equal(result.secretInherited, false);
  await assert.rejects(fs.access(result.scratch)); await assert.rejects(fs.access(outside));
});

test("actual runner terminates a timed-out configured process", { skip: process.platform !== "darwin" }, async (t) => {
  const f = await fixture(t);
  const executable = path.join(f.root, "slow-runtime.mjs");
  await fs.writeFile(executable, `#!${process.execPath}\nsetTimeout(()=>{},60000);\n`, { mode: 0o700 });
  const start = performance.now();
  const result = await runHeadroomWorker({ content: f.content, query: "fixture", python: executable });
  assert.equal(result.failure, "worker-timeout");
  assert.ok(performance.now()-start < HEADROOM_CONTRACT.timeoutMs+10000);
});

test("real CLI passthrough and exact readback need no optional environment", async (t) => {
  const f = await fixture(t, "日本語 tool output\n");
  const invoke = (args) => spawnSync(process.execPath, [cli, "adapter", ...args, "--json"], { encoding: "utf8" });
  const raw = invoke(["headroom-view", f.root, "--input", "input.txt", "--kind", "log"]);
  assert.equal(raw.status, 0, raw.stderr); const view = JSON.parse(raw.stdout);
  assert.equal(view.content, f.content); assert.equal(view.metrics.worker_attempts, 0);
  const read = invoke(["headroom-read", f.root, "--input", "input.txt", "--expected-sha256", view.source_sha256]);
  assert.equal(read.status, 0, read.stderr); assert.equal(JSON.parse(read.stdout).content, f.content);
  const changed = invoke(["headroom-read", f.root, "--input", "input.txt", "--expected-sha256", "0".repeat(64)]);
  assert.notEqual(changed.status, 0);
});
