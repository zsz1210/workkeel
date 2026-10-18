import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { sha256 } from "./files.mjs";

function boundedText(value, limit = 240) {
  if (typeof value !== "string") return null;
  const normalized = value.replaceAll(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

export function createJsonRpcProcess(command, args = [], options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"]
  });
  const pending = new Map();
  let sequence = 0;
  let stderr = "";
  let closed = false;
  let exited = false;
  let closePromise = null;
  let firstProtocolError = null;
  let frameNumber = 0;
  let validFrames = 0;
  let resolveExit;
  const exitObserved = new Promise((resolve) => { resolveExit = resolve; });
  const decoder = new StringDecoder("utf8");
  let frameBuffer = "";

  function protocolFailure(reason, line) {
    const first = !firstProtocolError;
    if (!firstProtocolError) {
      firstProtocolError = new Error("Codex App Server emitted an invalid protocol frame");
      firstProtocolError.protocolDiagnostic = Object.freeze({
        schema_version: "workkeel.protocol-diagnostic/v1",
        reason,
        frame_class: !line.trim() ? "empty" : /^[\s]*[\[{]/u.test(line) ? "json-like" : "other",
        frame_bytes: Buffer.byteLength(line),
        frame_sha256: sha256(line),
        frame_number: frameNumber,
        preceding_valid_frames: validFrames,
        pending_requests: pending.size,
        raw_content_retained: false
      });
    }
    rejectPending(firstProtocolError);
    if (first) options.onProtocolError?.(firstProtocolError);
  }

  function rejectPending(error) {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  }

  function waitForExit(timeoutMs) {
    if (exited) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      exitObserved.then(() => { clearTimeout(timer); resolve(true); });
    });
  }

  function send(message) {
    if (closed || child.stdin.destroyed) throw new Error("Codex App Server connection is closed");
    if (firstProtocolError && !["turn/interrupt", "thread/backgroundTerminals/clean", "thread/backgroundTerminals/list"].includes(message.method)) throw firstProtocolError;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  }

  function consumeFrame(line) {
    frameNumber++;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      protocolFailure("invalid-json", line);
      return;
    }
    // The installed wire contract accepts omitted params and arbitrary result
    // values. Validate only routing envelopes; never retain payloads in errors.
    const object = message !== null && typeof message === "object" && !Array.isArray(message);
    const id = object && Object.hasOwn(message, "id");
    const method = object && Object.hasOwn(message, "method");
    const validId = typeof message?.id === "string" || Number.isSafeInteger(message?.id);
    const validError = message?.error && typeof message.error === "object" &&
      Number.isInteger(message.error.code) && typeof message.error.message === "string";
    const response = object && (Object.hasOwn(message, "result") !== Object.hasOwn(message, "error"));
    if (!object || (id && !validId) || (method ? typeof message.method !== "string" : !id || !response || (Object.hasOwn(message, "error") && !validError))) {
      protocolFailure("invalid-envelope", line);
      return;
    }
    validFrames++;
    if (message.id !== undefined && message.method === undefined) {
      const request = pending.get(String(message.id));
      if (!request) return;
      pending.delete(String(message.id));
      if (message.error) {
        const error = new Error(`Codex App Server ${request.method} failed (${message.error.code ?? "unknown"})`);
        error.rpcCode = Number.isInteger(message.error.code) ? message.error.code : null;
        error.providerReason = boundedText(message.error.message, 240);
        request.reject(error);
      } else request.resolve(message.result);
      return;
    }
    if (message.method && message.id !== undefined) options.onRequest?.(message, { respond: (result) => send({ id: message.id, result }) });
    else if (message.method) options.onNotification?.(message);
  }
  // JSONL uses LF. readline also splits legal U+2028/U+2029 string content.
  // Decode across chunks before splitting; CR remains legal JSON whitespace.
  child.stdout.on("data", (chunk) => {
    frameBuffer += decoder.write(chunk);
    let end;
    while ((end = frameBuffer.indexOf("\n")) !== -1) {
      const frame = frameBuffer.slice(0, end);
      frameBuffer = frameBuffer.slice(end + 1);
      consumeFrame(frame.endsWith("\r") ? frame.slice(0, -1) : frame);
    }
  });
  child.stdout.on("end", () => {
    frameBuffer += decoder.end();
    if (frameBuffer.length) consumeFrame(frameBuffer);
    frameBuffer = "";
  });
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-4096);
  });
  child.stdin.on("error", (error) => rejectPending(error));
  child.on("error", (error) => {
    rejectPending(error);
    // Failed spawn has no process to terminate; a failed signal does not prove exit.
    if (!child.pid) {
      closed = true;
      exited = true;
      resolveExit();
    }
    options.onExit?.(error);
  });
  child.on("exit", (code, signal) => {
    closed = true;
    exited = true;
    resolveExit();
    const error = new Error(`Codex App Server exited (${code ?? signal ?? "unknown"})`);
    rejectPending(error);
    options.onExit?.(error, { code, signal, stderr_present: Boolean(stderr.trim()) });
  });

  return {
    child,
    request(method, params = {}, timeoutMs = 15000) {
      if (closed || child.stdin.destroyed) return Promise.reject(new Error("Codex App Server connection is closed"));
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(String(id));
          reject(new Error(`Codex App Server ${method} timed out`));
        }, timeoutMs);
        pending.set(String(id), {
          method,
          resolve: (value) => { clearTimeout(timer); resolve(value); },
          reject: (error) => { clearTimeout(timer); reject(error); }
        });
        try {
          send({ id, method, params });
        } catch (error) {
          pending.get(String(id)).reject(error);
          pending.delete(String(id));
        }
      });
    },
    respond(id, result) {
      send({ id, result });
    },
    notify(method, params = {}) {
      send({ method, params });
    },
    close() {
      if (closePromise) return closePromise;
      closed = true;
      rejectPending(new Error("Codex App Server connection is closed"));
      closePromise = (async () => {
        try {
          if (!exited) {
            child.kill("SIGTERM");
            if (!await waitForExit(1000)) {
              // Only the child handle created above is owned here, never a PID sweep.
              child.kill("SIGKILL");
              if (!await waitForExit(1000)) throw new Error("Codex App Server shutdown could not confirm child exit");
            }
          }
        } finally {
          frameBuffer = "";
          child.stdin.destroy();
          child.stdout.destroy();
          child.stderr.destroy();
        }
      })();
      return closePromise;
    }
  };
}
