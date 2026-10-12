import crypto from "node:crypto";
import { realpathSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { atomicWrite, formatJson, pathExists, readJson, sha256 } from "./files.mjs";

export const TELEMETRY_EVENT_SPEC_VERSION = "1.0";
export const TELEMETRY_CHECKPOINT_SCHEMA = "temple.control-plane-checkpoint/v1";
export const TELEMETRY_DAEMON_SCHEMA = "temple.control-plane-daemon/v1";

const EVENT_IDENTITY_SEPARATOR = "\u0000";
const DEFAULT_REDACT_KEYS = ["api-key", "apikey", "authorization", "cookie", "password", "secret", "token"];
const SENSITIVE_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /\bgh[oprsu]_[A-Za-z0-9]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g
];
const NON_SECRET_TOKEN_METRICS = new Set([
  "inputtokens",
  "cachedinputtokens",
  "outputtokens",
  "reasoningoutputtokens",
  "totaltokens",
  "modelcontextwindow",
  "tokenbudget"
]);

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function gitCommonDirectory(target) {
  const result = spawnSync("git", ["-C", target, "rev-parse", "--git-common-dir"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`Control plane requires a Git repository: ${result.stderr.trim() || target}`);
  }
  const value = result.stdout.trim();
  if (!value) throw new Error("Git returned an empty common directory");
  return realpathSync(path.resolve(target, value));
}

export function resolveControlPlaneStateDirectory(target, configuredPath = null) {
  const projectRoot = path.resolve(target);
  const commonDirectory = gitCommonDirectory(projectRoot);
  const stateDirectory = configuredPath
    ? path.resolve(projectRoot, configuredPath)
    : path.join(commonDirectory, "temple", "control-plane");
  const filesystemRoot = path.parse(stateDirectory).root;
  if ([filesystemRoot, os.homedir(), projectRoot, commonDirectory].includes(stateDirectory)) {
    throw new Error(`Refusing broad control-plane state directory: ${stateDirectory}`);
  }
  if (isWithin(projectRoot, stateDirectory) && !isWithin(commonDirectory, stateDirectory)) {
    throw new Error("Control-plane telemetry cannot be stored in the version-controlled worktree");
  }
  return stateDirectory;
}

function normalizedKey(value) {
  return String(value).toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function redactString(value) {
  let output = value;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) output = output.replace(pattern, "[REDACTED]");
  return output;
}

function redactValue(value, sensitiveKeys, depth = 0) {
  if (depth > 20) return "[DEPTH_LIMIT]";
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, sensitiveKeys, depth + 1));
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    const candidate = normalizedKey(key);
    const numericTokenMetric = typeof entry === "number" && NON_SECRET_TOKEN_METRICS.has(candidate);
    output[key] = !numericTokenMetric && sensitiveKeys.some((sensitive) => candidate.includes(sensitive))
      ? "[REDACTED]"
      : redactValue(entry, sensitiveKeys, depth + 1);
  }
  return output;
}

function stableValue(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stableValue);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function validDateTime(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function validSource(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function redactTelemetryData(data, privacy = {}) {
  const sensitiveKeys = [...new Set([...(privacy.redact_keys ?? DEFAULT_REDACT_KEYS), ...DEFAULT_REDACT_KEYS].map(normalizedKey))];
  const redacted = redactValue(data ?? {}, sensitiveKeys);
  const encoded = JSON.stringify(redacted);
  const maxBytes = privacy.max_data_bytes ?? 16384;
  if (Buffer.byteLength(encoded, "utf8") <= maxBytes) return redacted;
  const boundedSummary = {};
  for (const key of ["project_id", "work_item_id", "task_id", "worker_id", "status", "summary"]) {
    if (Object.hasOwn(redacted, key)) boundedSummary[key] = redacted[key];
  }
  return {
    ...boundedSummary,
    temple_truncated: true,
    original_bytes: Buffer.byteLength(encoded, "utf8"),
    sha256: sha256(encoded)
  };
}

export function normalizeTelemetryEvent(input, options = {}) {
  const observedAt = options.observedAt ?? new Date().toISOString();
  const event = {
    specversion: TELEMETRY_EVENT_SPEC_VERSION,
    id: String(input?.id ?? "").trim(),
    source: String(input?.source ?? "").trim(),
    type: String(input?.type ?? "").trim(),
    ...(input?.subject ? { subject: String(input.subject).trim() } : {}),
    time: input?.time ?? observedAt,
    templeobservedat: observedAt,
    data: redactTelemetryData(input?.data ?? {}, options.privacy)
  };
  if (!event.id || event.id.length > 512) throw new Error("Telemetry event ID must contain 1 to 512 characters");
  if (!validSource(event.source)) throw new Error(`Telemetry event source is not a URI: ${event.source}`);
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(event.type)) throw new Error(`Invalid telemetry event type: ${event.type}`);
  if (!validDateTime(event.time) || !validDateTime(event.templeobservedat)) {
    throw new Error("Telemetry event time and observation time must be RFC 3339 date-times");
  }
  if (event.subject !== undefined && !event.subject) throw new Error("Telemetry event subject cannot be empty");
  return event;
}

function identityFor(event) {
  return `${event.source}${EVENT_IDENTITY_SEPARATOR}${event.id}`;
}

function comparableEvent(event) {
  const { templecursor, templeobservedat, ...stable } = event;
  return stable;
}

async function readJournalRecords(journalPath) {
  if (!(await pathExists(journalPath))) return [];
  const content = await fs.readFile(journalPath, "utf8");
  const records = [];
  let previousCursor = 0;
  for (const [index, line] of content.split("\n").entries()) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid telemetry journal JSON at line ${index + 1}: ${error.message}`);
    }
    if (!Number.isSafeInteger(record.templecursor) || record.templecursor <= previousCursor) {
      throw new Error(`Telemetry journal cursor is not strictly increasing at line ${index + 1}`);
    }
    if (record.specversion !== TELEMETRY_EVENT_SPEC_VERSION || !record.id || !record.source || !record.type) {
      throw new Error(`Telemetry journal event is invalid at line ${index + 1}`);
    }
    previousCursor = record.templecursor;
    records.push(record);
  }
  return records;
}

async function durableAppend(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const handle = await fs.open(filePath, "a");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function openTelemetryJournal(stateDirectory, options = {}) {
  const root = path.resolve(stateDirectory);
  const journalPath = path.join(root, "journal", "events.jsonl");
  const checkpointPath = path.join(root, "checkpoint.json");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  const records = await readJournalRecords(journalPath);
  const identities = new Map(records.map((record) => [identityFor(record), record]));
  const listeners = new Set();
  const maxEvents = options.maxEvents ?? 10000;
  let mutationTail = Promise.resolve();
  let acceptingAppends = !options.readOnly;
  let closePromise = null;

  function enqueueMutation(operation) {
    const result = mutationTail.then(operation, operation);
    mutationTail = result.catch(() => {});
    return result;
  }

  async function writeCheckpoint() {
    const firstCursor = records[0]?.templecursor ?? null;
    const lastCursor = records.at(-1)?.templecursor ?? 0;
    await atomicWrite(
      checkpointPath,
      formatJson({
        schema_version: TELEMETRY_CHECKPOINT_SCHEMA,
        first_cursor: firstCursor,
        last_cursor: lastCursor,
        retained_events: records.length,
        updated_at: new Date().toISOString()
      })
    );
  }

  async function compactIfNeeded() {
    if (records.length <= maxEvents) return;
    const retained = records.slice(-maxEvents);
    records.splice(0, records.length, ...retained);
    identities.clear();
    for (const record of records) identities.set(identityFor(record), record);
    await atomicWrite(journalPath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  }

  if (!options.readOnly) await writeCheckpoint();

  return {
    root,
    journalPath,
    checkpointPath,
    async append(input, appendOptions = {}) {
      if (options.readOnly) throw new Error("Cannot append through a read-only telemetry journal");
      if (!acceptingAppends) throw new Error("Cannot append through a closed telemetry journal");
      const event = normalizeTelemetryEvent(input, {
        observedAt: appendOptions.observedAt,
        privacy: options.privacy
      });
      return enqueueMutation(async () => {
        const identity = identityFor(event);
        const existing = identities.get(identity);
        if (existing) {
          if (stableStringify(comparableEvent(existing)) !== stableStringify(comparableEvent(event))) {
            throw new Error(`Telemetry event identity collision for ${event.source} ${event.id}`);
          }
          return { record: existing, duplicate: true };
        }
        const lastCursor = records.at(-1)?.templecursor ?? 0;
        const record = { ...event, templecursor: lastCursor + 1 };
        await durableAppend(journalPath, `${JSON.stringify(record)}\n`);
        records.push(record);
        identities.set(identity, record);
        await compactIfNeeded();
        await writeCheckpoint();
        for (const listener of listeners) listener(record);
        return { record, duplicate: false };
      });
    },
    readAfter(cursor = 0) {
      const normalized = Number(cursor);
      if (!Number.isSafeInteger(normalized) || normalized < 0) throw new Error("Telemetry cursor must be a non-negative integer");
      const firstCursor = records[0]?.templecursor ?? null;
      return {
        reset_required: firstCursor !== null && normalized < firstCursor - 1,
        first_cursor: firstCursor,
        last_cursor: records.at(-1)?.templecursor ?? 0,
        records: records.filter((record) => record.templecursor > normalized)
      };
    },
    snapshot() {
      return {
        schema_version: TELEMETRY_CHECKPOINT_SCHEMA,
        first_cursor: records[0]?.templecursor ?? null,
        last_cursor: records.at(-1)?.templecursor ?? 0,
        retained_events: records.length
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async close() {
      if (closePromise) return closePromise;
      acceptingAppends = false;
      closePromise = (async () => {
        await mutationTail;
        listeners.clear();
        if (!options.readOnly) await writeCheckpoint();
      })();
      return closePromise;
    }
  };
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

export async function acquireControlPlaneLease(stateDirectory) {
  const root = path.resolve(stateDirectory);
  const leasePath = path.join(root, "daemon.lock");
  await fs.mkdir(root, { recursive: true });
  const token = crypto.randomUUID();
  const lease = {
    schema_version: "temple.control-plane-lease/v1",
    pid: process.pid,
    token,
    acquired_at: new Date().toISOString()
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(leasePath, "wx");
      try {
        await handle.writeFile(formatJson(lease), "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      return {
        leasePath,
        lease,
        async release() {
          let current = null;
          try {
            current = await readJson(leasePath);
          } catch (error) {
            if (error.code === "ENOENT") return;
            throw error;
          }
          if (current.token !== token) throw new Error("Control-plane lease ownership changed before release");
          await fs.unlink(leasePath);
        }
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let existing = null;
      try {
        existing = await readJson(leasePath);
      } catch {
        throw new Error(`Control-plane lease exists and cannot be inspected: ${leasePath}`);
      }
      if (processIsAlive(existing.pid)) {
        throw new Error(`Control plane is already running with PID ${existing.pid}`);
      }
      await fs.unlink(leasePath).catch((unlinkError) => {
        if (unlinkError.code !== "ENOENT") throw unlinkError;
      });
    }
  }
  throw new Error("Could not acquire the control-plane writer lease");
}

export async function writeDaemonMetadata(stateDirectory, metadata) {
  const daemonPath = path.join(stateDirectory, "daemon.json");
  await atomicWrite(
    daemonPath,
    formatJson({
      schema_version: TELEMETRY_DAEMON_SCHEMA,
      pid: process.pid,
      host: metadata.host,
      port: metadata.port,
      url: metadata.url,
      project_root: metadata.projectRoot,
      started_at: metadata.startedAt,
      version: metadata.version
    })
  );
  return daemonPath;
}

export async function readDaemonMetadata(stateDirectory) {
  const daemonPath = path.join(stateDirectory, "daemon.json");
  return (await pathExists(daemonPath)) ? readJson(daemonPath) : null;
}
