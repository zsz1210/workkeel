import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { durableAtomicCreate, durableAtomicWrite } from "../src/files.mjs";

const helperUrl = new URL("../src/files.mjs", import.meta.url).href;
const PARTICIPANTS = 6;
const PARTICIPANT_PAYLOAD_BYTES = 256 * 1024;
const READY_TIMEOUT_MS = 30000;
const RESULT_TIMEOUT_MS = 30000;
const EXIT_TIMEOUT_MS = 10000;
const REAP_TIMEOUT_MS = 5000;
const LONG_BASENAME_BYTES = 242;

async function fixtureDirectory(context, label) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `workkeel-durable-${label}-`));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function bounded(promise, milliseconds, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not finish within ${milliseconds} ms`)), milliseconds);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function settlesWithin(promise, milliseconds) {
  return bounded(promise, milliseconds, "settlement").then(() => true, () => false);
}

function assertBytes(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label}: byte length`);
  if (actual.equals(expected)) return;
  let offset = 0;
  while (actual[offset] === expected[offset]) offset += 1;
  assert.fail(`${label}: bytes differ first at offset ${offset}`);
}

function participantPayload(participant, size) {
  return Buffer.from(`participant ${participant}\n${participant.repeat(size)}`.slice(0, size), "utf8");
}

const workerSource = `
const [helperUrl, target, participant, size] = process.argv.slice(1);
const { durableAtomicCreate } = await import(helperUrl);
const participantPayload = ${participantPayload.toString()};
const payload = participantPayload(participant, Number(size));
let started = false;
process.on("message", async (message) => {
  if (message?.type !== "start" || started) {
    process.send({ type: "protocol-error", participant, received: message });
    return;
  }
  started = true;
  let result;
  try {
    await durableAtomicCreate(target, payload);
    result = { type: "result", participant, outcome: "resolved" };
  } catch (error) {
    result = { type: "result", participant, outcome: "rejected", code: error.code ?? null, message: String(error.message) };
  }
  process.send(result, () => process.disconnect());
});
process.send({ type: "ready", participant, pid: process.pid });
`;

function launchParticipant(participant, target) {
  const child = spawn(process.execPath, [
    "--input-type=module", "--eval", workerSource, helperUrl, target, participant, String(PARTICIPANT_PAYLOAD_BYTES)
  ], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const state = {
    participant,
    child,
    closed: false,
    stderr: "",
    protocolErrors: [],
    readyMessage: null,
    resultMessage: null,
    ready: Promise.withResolvers(),
    result: Promise.withResolvers(),
    exit: Promise.withResolvers()
  };
  state.ready.promise.catch(() => {});
  state.result.promise.catch(() => {});
  const fail = (error) => {
    state.protocolErrors.push(error.message);
    state.ready.reject(error);
    state.result.reject(error);
  };
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    if (state.stderr.length < 8192) state.stderr += chunk;
  });
  child.on("error", (error) => fail(new Error(`participant ${participant} process error: ${error.message}`)));
  child.on("message", (message) => {
    if (message?.type === "ready" && !state.readyMessage) {
      state.readyMessage = message;
      state.ready.resolve(message);
    } else if (message?.type === "result" && state.readyMessage && !state.resultMessage) {
      state.resultMessage = message;
      state.result.resolve(message);
    } else {
      fail(new Error(`participant ${participant} sent an unexpected message: ${JSON.stringify(message)}`));
    }
  });
  child.on("close", (code, signal) => {
    state.closed = true;
    if (!state.resultMessage) {
      fail(new Error(`participant ${participant} exited (code ${code}, signal ${signal}) before reporting a result: ${state.stderr}`));
    }
    state.exit.resolve({ code, signal });
  });
  return state;
}

async function reapParticipants(states) {
  const unreaped = [];
  await Promise.all(states.map(async (state) => {
    if (state.closed || state.child.pid === undefined) return;
    state.child.kill("SIGTERM");
    if (await settlesWithin(state.exit.promise, REAP_TIMEOUT_MS)) return;
    state.child.kill("SIGKILL");
    if (!(await settlesWithin(state.exit.promise, REAP_TIMEOUT_MS))) unreaped.push(state.child.pid);
  }));
  if (unreaped.length > 0) throw new Error(`participant processes were not reaped: ${unreaped.join(", ")}`);
}

async function withReapedParticipants(states, body) {
  let failure = null;
  try {
    await body();
  } catch (error) {
    failure = error;
  }
  try {
    await reapParticipants(states);
  } catch (cleanupError) {
    throw failure ? new AggregateError([failure, cleanupError], "participant race failed and cleanup was incomplete") : cleanupError;
  }
  if (failure) throw failure;
}

test("durableAtomicCreate admits exactly one of several independent processes racing for an absent target", async (context) => {
  const directory = await fixtureDirectory(context, "create-race");
  const target = path.join(directory, "contended.txt");
  const states = [];
  await withReapedParticipants(states, async () => {
    for (let index = 0; index < PARTICIPANTS; index += 1) states.push(launchParticipant(`p${index}`, target));
    const ready = await bounded(Promise.all(states.map((state) => state.ready.promise)), READY_TIMEOUT_MS, "participant readiness");
    assert.deepEqual(ready.map((message) => message.participant), states.map((state) => state.participant));
    assert.deepEqual(ready.map((message) => message.pid), states.map((state) => state.child.pid));
    assert.equal(new Set(ready.map((message) => message.pid)).size, PARTICIPANTS);
    await assert.rejects(fs.lstat(target), { code: "ENOENT" });

    const released = states.map((state) => new Promise((resolve, reject) => {
      state.child.send({ type: "start" }, (error) => (error ? reject(error) : resolve()));
    }));
    await bounded(Promise.all(released), RESULT_TIMEOUT_MS, "barrier release");
    const results = await bounded(Promise.all(states.map((state) => state.result.promise)), RESULT_TIMEOUT_MS, "participant results");
    const exits = await bounded(Promise.all(states.map((state) => state.exit.promise)), EXIT_TIMEOUT_MS, "participant exit");
    assert.deepEqual(exits, states.map(() => ({ code: 0, signal: null })));
    assert.deepEqual(states.flatMap((state) => state.protocolErrors), []);

    const winners = results.filter((result) => result.outcome === "resolved");
    assert.equal(winners.length, 1, `expected one winner: ${JSON.stringify(results)}`);
    for (const loser of results.filter((result) => result !== winners[0])) {
      assert.deepEqual({ outcome: loser.outcome, code: loser.code }, { outcome: "rejected", code: "EEXIST" }, loser.message);
    }
    assertBytes(await fs.readFile(target), participantPayload(winners[0].participant, PARTICIPANT_PAYLOAD_BYTES), "winner bytes");
    assert.deepEqual(await fs.readdir(directory), ["contended.txt"]);
  });
});

// Injects a failure after a real partial temporary-file write. This is not a disk-full test.
async function withInjectedPartialWrite(directory, body) {
  const originalOpen = fs.open;
  const injected = new Error("injected temporary-file write failure");
  const record = { injected, temporaryPaths: [], prefix: null, observed: null, handles: [] };
  fs.open = async function (...args) {
    const handle = await originalOpen.apply(this, args);
    const [filename, flags] = args;
    if (typeof filename !== "string" || path.dirname(filename) !== directory || flags !== "wx") return handle;
    record.temporaryPaths.push(filename);
    record.handles.push(handle);
    const originalWriteFile = handle.writeFile;
    handle.writeFile = async function (data) {
      const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
      record.prefix = bytes.subarray(0, Math.floor(bytes.length / 2));
      await originalWriteFile.call(this, record.prefix);
      record.observed = await fs.readFile(filename);
      throw injected;
    };
    return handle;
  };
  try {
    return await body(record);
  } finally {
    fs.open = originalOpen;
    for (const handle of record.handles) delete handle.writeFile;
  }
}

function assertPartialWriteInjected(record, payload) {
  assert.equal(record.temporaryPaths.length, 1);
  assert.ok(record.prefix.length > 0 && record.prefix.length < Buffer.byteLength(payload), "proper nonempty prefix");
  assertBytes(record.observed, record.prefix, "temporary file bytes before injected failure");
  assert.ok(record.handles.every((handle) => !Object.hasOwn(handle, "writeFile")), "file handle hook restored");
}

test("durable helpers reject and leave no trace when the temporary write fails after partial bytes", async (context) => {
  const originalOpen = fs.open;
  const payload = "replacement payload that must never become visible ✓\n".repeat(64);

  const replaceDirectory = await fixtureDirectory(context, "partial-write");
  const destination = path.join(replaceDirectory, "settings.json");
  const original = Buffer.from("{\"fictional\":\"original\"}\n");
  await fs.writeFile(destination, original);
  const replaceRecord = await withInjectedPartialWrite(replaceDirectory, async (record) => {
    await assert.rejects(durableAtomicWrite(destination, payload), (error) => error === record.injected);
    return record;
  });
  assert.equal(fs.open, originalOpen);
  assertPartialWriteInjected(replaceRecord, payload);
  assertBytes(await fs.readFile(destination), original, "existing destination");
  assert.deepEqual(await fs.readdir(replaceDirectory), ["settings.json"]);

  const createDirectory = await fixtureDirectory(context, "partial-create");
  const created = path.join(createDirectory, "record.json");
  const createRecord = await withInjectedPartialWrite(createDirectory, async (record) => {
    await assert.rejects(durableAtomicCreate(created, payload), (error) => error === record.injected);
    return record;
  });
  assert.equal(fs.open, originalOpen);
  assertPartialWriteInjected(createRecord, payload);
  await assert.rejects(fs.lstat(created), { code: "ENOENT" });
  assert.deepEqual(await fs.readdir(createDirectory), []);

  await assert.rejects(withInjectedPartialWrite(createDirectory, async () => {
    assert.fail("synthetic assertion failure inside the hooked section");
  }), { name: "AssertionError" });
  assert.equal(fs.open, originalOpen);
});

function longBasename() {
  const suffix = ".txt";
  const name = `durable-${"n".repeat(LONG_BASENAME_BYTES - "durable-".length - suffix.length)}${suffix}`;
  assert.equal(Buffer.byteLength(name), LONG_BASENAME_BYTES);
  return name;
}

async function unsupportedLongBasename(directory, basename) {
  const probe = path.join(directory, basename);
  try {
    await fs.writeFile(probe, "");
    await fs.rm(probe);
    return null;
  } catch (error) {
    if (error.code === "ENAMETOOLONG") {
      return `filesystem rejected a ${Buffer.byteLength(basename)}-byte basename (${error.code}); property unverified here`;
    }
    throw error;
  }
}

function largeUtf8Payload(label, minimumBytes) {
  const unit = `${label} ascii é ü 中文 Ωμέγα 🚀\n`;
  const payload = `${unit.repeat(Math.ceil(minimumBytes / Buffer.byteLength(unit)))}END ${label} ✓`;
  assert.ok(Buffer.byteLength(payload) > payload.length, "payload contains multibyte characters");
  assert.ok(Buffer.byteLength(payload) >= minimumBytes);
  return payload;
}

async function longBasenameCase(context, label) {
  const root = await fixtureDirectory(context, label);
  const probeDirectory = path.join(root, "probe");
  const directory = path.join(root, "case");
  await fs.mkdir(probeDirectory);
  await fs.mkdir(directory);
  const basename = longBasename();
  const unsupported = await unsupportedLongBasename(probeDirectory, basename);
  return { directory, basename, target: path.join(directory, basename), unsupported };
}

test("durableAtomicCreate stores complete large UTF-8 content at a 242-byte basename and refuses replacement", async (context) => {
  const { directory, basename, target, unsupported } = await longBasenameCase(context, "create-large");
  if (unsupported) {
    context.skip(unsupported);
    return;
  }
  const first = largeUtf8Payload("first", 5 * 1024 * 1024);
  await durableAtomicCreate(target, first);
  assertBytes(await fs.readFile(target), Buffer.from(first, "utf8"), "created bytes");
  assert.deepEqual(await fs.readdir(directory), [basename]);

  const second = largeUtf8Payload("second", 3 * 1024 * 1024);
  await assert.rejects(durableAtomicCreate(target, second), { code: "EEXIST" });
  assertBytes(await fs.readFile(target), Buffer.from(first, "utf8"), "bytes after refused replacement");
  assert.deepEqual(await fs.readdir(directory), [basename]);
});

test("durableAtomicWrite stores and replaces complete large UTF-8 content at a 242-byte basename", async (context) => {
  const { directory, basename, target, unsupported } = await longBasenameCase(context, "write-large");
  if (unsupported) {
    context.skip(unsupported);
    return;
  }
  const first = largeUtf8Payload("first", 5 * 1024 * 1024);
  await durableAtomicWrite(target, first);
  assertBytes(await fs.readFile(target), Buffer.from(first, "utf8"), "initial bytes");
  assert.deepEqual(await fs.readdir(directory), [basename]);

  const second = largeUtf8Payload("second", 3 * 1024 * 1024);
  await durableAtomicWrite(target, second);
  assertBytes(await fs.readFile(target), Buffer.from(second, "utf8"), "replacement bytes");
  assert.deepEqual(await fs.readdir(directory), [basename]);
});
