import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { sha256, formatJson } from "./files.mjs";
import { runSupervisedCommand } from "./delivery-check.mjs";
import { confinedCheckCommand } from "./confined-check.mjs";

const PLAN = "temple.measurement-plan/v1", RESULT = "temple.measurement-result/v1";
const STORE = ".ai-org/artifacts/measurements";
const stable = value => JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const digest = value => sha256(stable(value));
const text = value => typeof value === "string" && value.trim().length > 0 && !value.includes("\0");
const known = value => text(value) && !/^(unknown|unavailable|unspecified|unset)$/i.test(value.trim());
const relative = value => text(value) && !path.isAbsolute(value) && !/[\\:]/.test(value) && !value.split("/").some(p => ["", ".", "..", ".git"].includes(p));
const within = (a, b) => a === b || a.startsWith(b + "/");
function problem(code, message, detail = {}) {
  return Object.assign(new Error(message), { code, mutation_status: "not-performed", execution_started: false,
    missing_condition: message, responsible_actor: "measurement-owner", next_action: "Correct the declared measurement inputs or select an available execution adapter, then inspect again.", ...detail });
}
const requireValue = (ok, message) => { if (!ok) throw problem("MEASUREMENT_PLAN_INVALID", message); };
function keys(value, allowed, message) {
  requireValue(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(k => allowed.includes(k)), message);
}
function paths(value, label) {
  requireValue(Array.isArray(value) && value.length <= 1000 && value.every(relative) && new Set(value).size === value.length, `Declare safe, unique ${label} paths`);
}
export function validateMeasurementPlan(plan) {
  keys(plan, ["schema_version", "id", "check_policy", "command", "inputs", "toolchain", "environment", "timeout_ms", "output_limit_bytes", "outputs"], "Invalid measurement plan fields");
  requireValue(plan.schema_version === PLAN && (plan.id === undefined || text(plan.id)), "Expected versioned measurement plan");
  requireValue(["trusted-local", "confined-node"].includes(plan.check_policy), "Select an explicit check policy");
  keys(plan.command, ["executable", "args", "cwd"], "Declare executable, argv and working directory");
  requireValue(text(plan.command.executable) && Array.isArray(plan.command.args) && plan.command.args.length <= 1000 && plan.command.args.every(v => typeof v === "string" && !v.includes("\0")), "Declare executable and string argv without shell evaluation");
  requireValue(plan.command.cwd === "." || relative(plan.command.cwd), "Working directory must stay inside the repository");
  keys(plan.inputs, ["files", "directories", "tests", "fixtures", "dependencies"], "Declare every input category");
  for (const name of ["files", "directories", "tests", "fixtures", "dependencies"]) paths(plan.inputs[name], name);
  requireValue(Object.values(plan.inputs).some(v => v.length), "At least one fingerprint input is required");
  keys(plan.toolchain, ["identity", "files"], "Declare toolchain identity and files");
  requireValue(known(plan.toolchain.identity), "Toolchain identity must be known"); paths(plan.toolchain.files, "toolchain");
  keys(plan.environment, ["identity", "names"], "Declare environment identity and names");
  requireValue(known(plan.environment.identity) && Array.isArray(plan.environment.names) && plan.environment.names.every(n => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) && new Set(plan.environment.names).size === plan.environment.names.length, "Environment identity and variable names must be known");
  requireValue(!plan.environment.names.some(n => ["TMPDIR", "TMP", "TEMP", "NODE_TEST_CONTEXT", "NODE_CHANNEL_FD", "NODE_CHANNEL_SERIALIZATION_MODE"].includes(n)), "Temporary and supervisor environment is adapter-owned");
  requireValue(Number.isSafeInteger(plan.timeout_ms) && plan.timeout_ms >= 100 && plan.timeout_ms <= 300000, "Timeout must be between 100 and 300000 milliseconds");
  requireValue(Number.isSafeInteger(plan.output_limit_bytes) && plan.output_limit_bytes >= 1 && plan.output_limit_bytes <= 8 * 1024 * 1024, "Output limit must be between 1 and 8388608 bytes");
  paths(plan.outputs, "output");
  const inputs = [...Object.values(plan.inputs).flat(), ...plan.toolchain.files];
  requireValue(!plan.outputs.some(o => inputs.some(i => within(o, i) || within(i, o))), "Output and fingerprint input paths must not overlap");
  if (plan.check_policy === "confined-node") {
    const expected = ["--test", "--test-isolation=none", "--test-reporter=tap", `--test-timeout=${plan.timeout_ms}`, ...plan.inputs.tests];
    requireValue(plan.command.executable === process.execPath && stable(plan.command.args) === stable(expected) && plan.command.cwd === "." && plan.inputs.tests.length > 0, "confined-node supports only the declared Node test command; no fallback");
    requireValue(plan.outputs.length === 0 && plan.environment.names.length === 0, "confined-node owns its environment and permits no repository outputs");
  }
  return plan;
}

export function measurementCapabilities({ platform = process.platform } = {}) {
  const posix = ["darwin", "linux", "freebsd", "openbsd", "aix", "sunos"].includes(platform);
  return { schema_version: "temple.measurement-capabilities/v1", platform, actual_host_platform: process.platform,
    execution_performed: false, acceptance_granted: false,
    adapters: {
      "trusted-local": { supported: posix, shell_evaluation: false, non_node: true, parent_agent_confined: false,
        descendant_cleanup: posix ? "owned-posix-process-group" : "unsupported-without-job-object-adapter",
        limitations: ["Trusted commands must not detach or daemonize; escaped process sessions are outside the owned group.", "Workspace snapshots detect persistent changes, not transient or external writes.", ...(platform === "win32" ? ["Windows execution and cleanup are unavailable; a POSIX fixture does not prove Windows execution."] : [])] },
      "confined-node": { supported: platform === "darwin", availability: platform === "darwin" ? "requires-local-sandbox-exec-probe" : "unsupported-platform", parent_agent_confined: false, fallback: "none" }
    } };
}

async function safePath(root, relativePath, { directory = false, create = false } = {}) {
  if (relativePath === "." && directory) return fs.realpath(root);
  if (!relative(relativePath)) throw problem("MEASUREMENT_UNSAFE_PATH", "Measurement paths must stay inside the repository");
  let current = await fs.realpath(root);
  const parts = relativePath.split("/");
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let stat = await fs.lstat(current).catch(e => { if (e.code === "ENOENT") return null; throw e; });
    if (stat?.isSymbolicLink()) throw problem("MEASUREMENT_UNSAFE_PATH", `Symlink is not a measurement boundary: ${relativePath}`);
    const needsDirectory = i < parts.length - 1 || directory;
    if (!stat && create && needsDirectory) { await fs.mkdir(current).catch(e => { if (e.code !== "EEXIST") throw e; }); stat = await fs.lstat(current); }
    if (stat && (stat.isSymbolicLink() || needsDirectory && !stat.isDirectory())) throw problem("MEASUREMENT_UNSAFE_PATH", `Invalid parent directory: ${relativePath}`);
  }
  return current;
}

async function inventory(root, selections, { exclude = [], missing = false, recordSymlinks = false } = {}) {
  const records = {}; let bytes = 0, count = 0;
  async function visit(name) {
    if (exclude.some(e => within(name, e)) || name === ".git" || name.startsWith(".git/")) return;
    if (Object.hasOwn(records, name)) return;
    // Whole-workspace snapshots record links without following them; selected
    // fingerprint inputs still reject links whose content boundary is unknown.
    const file = recordSymlinks ? path.join(await safePath(root, path.posix.dirname(name), { directory: true }), path.posix.basename(name)) : await safePath(root, name);
    const stat = await fs.lstat(file).catch(e => { if (e.code === "ENOENT") return null; throw e; });
    if (!stat) { if (missing) { records[name] = { missing: true }; return; } throw problem("MEASUREMENT_INPUT_UNAVAILABLE", `Input is unavailable: ${name}`); }
    if (++count > 100000) throw problem("MEASUREMENT_INVENTORY_LIMIT", "Measurement inventory exceeds 100000 entries");
    const mode = stat.mode & 0o777;
    if (stat.isSymbolicLink() && recordSymlinks) records[name] = { type: "symlink", mode, target: await fs.readlink(file) };
    else if (stat.isDirectory()) {
      records[name] = { type: "directory", mode };
      for (const child of (await fs.readdir(file)).sort()) await visit(`${name}/${child}`);
    } else if (stat.isFile()) {
      bytes += stat.size;
      if (stat.size > 32 * 1024 * 1024 || bytes > 256 * 1024 * 1024) throw problem("MEASUREMENT_INVENTORY_LIMIT", "Measurement inventory exceeds its byte limit");
      records[name] = { type: "file", mode, bytes: stat.size, sha256: sha256(await fs.readFile(file)) };
    } else throw problem("MEASUREMENT_UNSAFE_PATH", `Unsupported input type: ${name}`);
  }
  for (const name of [...new Set(selections)].sort()) await visit(name);
  return Object.fromEntries(Object.entries(records).sort(([a], [b]) => a.localeCompare(b)));
}
async function executable(root, plan, env) {
  const name = plan.command.executable, cwd = await safePath(root, plan.command.cwd, { directory: true });
  if (!(await fs.stat(cwd)).isDirectory()) throw problem("MEASUREMENT_INPUT_UNAVAILABLE", "Working directory is unavailable");
  const candidates = path.isAbsolute(name) ? [name] : name.includes("/") ? [path.resolve(cwd, name)] : (env.PATH ?? "").split(path.delimiter).filter(Boolean).map(p => path.resolve(cwd, p, name));
  for (const file of candidates) {
    try {
      await fs.access(file, fs.constants.X_OK);
      const resolved = await fs.realpath(file), stat = await fs.stat(resolved);
      if (!stat.isFile() || stat.size > 128 * 1024 * 1024) continue;
      return { path: resolved, sha256: sha256(await fs.readFile(resolved)), mode: stat.mode & 0o777 };
    } catch (e) { if (!["ENOENT", "EACCES", "ENOTDIR"].includes(e.code)) throw e; }
  }
  throw problem("MEASUREMENT_TOOL_UNAVAILABLE", "Executable is unavailable in the declared environment");
}
function selectedEnvironment(plan, env) {
  const selected = {};
  for (const name of plan.environment.names) {
    if (typeof env[name] !== "string") throw problem("MEASUREMENT_ENVIRONMENT_UNKNOWN", `Declared environment variable is unavailable: ${name}`);
    selected[name] = env[name];
  }
  return selected;
}
export async function fingerprintMeasurement(root, plan, { env = process.env } = {}) {
  validateMeasurementPlan(plan);
  try {
    const selected = selectedEnvironment(plan, env);
    const tool = await executable(root, plan, selected);
    for (const dir of plan.inputs.directories) await fs.stat(await safePath(root, dir, { directory: true }));
    const inputs = await inventory(root, [...Object.values(plan.inputs).flat(), ...plan.toolchain.files]);
    const environment = { identity: plan.environment.identity, variables: Object.fromEntries(Object.entries(selected).map(([k, v]) => [k, sha256(v)])), temporary: "fresh-owned-directory" };
    const toolchain = { identity: plan.toolchain.identity, executable: tool, platform: process.platform, arch: process.arch, release: os.release(), node: process.versions,
      adapter_sha256: sha256(await fs.readFile(new URL("./delivery-check-worker.mjs", import.meta.url))), implementation_sha256: sha256(await fs.readFile(new URL("./verification.mjs", import.meta.url))),
      supervisor_sha256: sha256(await fs.readFile(new URL("./delivery-check.mjs", import.meta.url))), confinement_sha256: sha256(await fs.readFile(new URL("./confined-check.mjs", import.meta.url))) };
    const key = digest({ plan, inputs, environment, toolchain });
    return { schema_version: "temple.measurement-fingerprint/v1", complete: true, key, reason: "complete-declared-inputs", inventory: inputs, environment, toolchain };
  } catch (error) {
    return { schema_version: "temple.measurement-fingerprint/v1", complete: false, key: null, reason: error.code ?? "MEASUREMENT_INPUT_UNAVAILABLE", detail: error.message, mutation_status: "not-performed", next_action: error.next_action ?? "Restore the missing input and inspect again." };
  }
}
function storeBoundary(plan, storePath) {
  requireValue(relative(storePath), "Attempt store must be a repository-relative directory");
  requireValue(![...Object.values(plan.inputs).flat(), ...plan.toolchain.files, ...plan.outputs].some(p => within(p, storePath) || within(storePath, p)), "Attempt store cannot overlap inputs or outputs");
}
const envelope = (fingerprint, reason, extra = {}) => ({ schema_version: "temple.measurement-inspection/v1", cache_status: "miss", reason,
  execution_started: false, acceptance_granted: false, independent_review_required: true, mutation_status: "not-performed", fingerprint, ...extra });
async function readRecord(root, ref) {
  const file = await safePath(root, ref), stat = await fs.stat(file);
  if (stat.size > 16 * 1024 * 1024) throw problem("MEASUREMENT_RECORD_INVALID", "Measurement record exceeds the size limit");
  const value = JSON.parse(await fs.readFile(file, "utf8")), { checksum, ...record } = value;
  if (checksum !== digest(record)) throw problem("MEASUREMENT_RECORD_INVALID", "Measurement record integrity mismatch");
  return record;
}
async function artifactIntegrity(root, result, attemptPath) {
  if (!Array.isArray(result.artifacts) || result.artifacts.length < 2) return false;
  const seen = new Set();
  for (const artifact of result.artifacts) {
    if (!relative(artifact.path) || !within(artifact.path, attemptPath + "/artifacts") || seen.has(artifact.path)) return false;
    seen.add(artifact.path);
    try {
      const file = await safePath(root, artifact.path), stat = await fs.stat(file);
      if (!stat.isFile() || stat.size !== artifact.bytes || stat.size > 32 * 1024 * 1024 || sha256(await fs.readFile(file)) !== artifact.sha256) return false;
    } catch { return false; }
  }
  return true;
}
export async function inspectMeasurement(root, plan, { env = process.env, storePath = STORE } = {}) {
  validateMeasurementPlan(plan); storeBoundary(plan, storePath);
  const fingerprint = await fingerprintMeasurement(root, plan, { env });
  if (!fingerprint.complete) return envelope(fingerprint, fingerprint.reason, { next_action: fingerprint.next_action });
  let names;
  try { names = await fs.readdir(await safePath(root, storePath, { directory: true })); }
  catch (e) { if (e.code === "ENOENT") return envelope(fingerprint, "no-prior-attempt"); throw e; }
  const attempts = [];
  for (const name of names.filter(n => n.startsWith("attempt-")).sort().reverse()) {
    const attemptPath = `${storePath}/${name}`;
    try {
      const pending = await readRecord(root, `${attemptPath}/attempt.json`);
      if (pending.schema_version !== "temple.measurement-attempt/v1" || pending.attempt_id !== name) return envelope(fingerprint, "invalid-attempt-record");
      if (pending.key === fingerprint.key) { attempts.push({ pending, attemptPath }); break; }
    } catch { return envelope(fingerprint, "invalid-attempt-record"); }
  }
  if (!attempts.length) return envelope(fingerprint, names.some(n => n.startsWith("attempt-")) ? "fingerprint-changed" : "no-prior-attempt");
  // A newer failed/interrupted attempt must never be hidden behind an older pass.
  attempts.sort((a, b) => b.pending.started_at_ms - a.pending.started_at_ms || b.pending.attempt_id.localeCompare(a.pending.attempt_id));
  const { attemptPath, pending } = attempts[0], resultRef = `${attemptPath}/result.json`;
  let result;
  try { result = await readRecord(root, resultRef); } catch (e) { return envelope(fingerprint, e.code === "ENOENT" ? "attempt-incomplete" : "invalid-result-record"); }
  if (result.schema_version !== RESULT || result.key !== fingerprint.key || result.attempt_id !== pending.attempt_id || result.plan_digest !== digest(plan)) return envelope(fingerprint, "invalid-result-record");
  if (result.retired === true || await fs.lstat(path.join(root, attemptPath, "retired.json")).catch(() => null)) return envelope(fingerprint, "attempt-retired");
  if (result.status !== "completed" || result.successful !== true || result.exit_code !== 0 || result.process_exit_confirmed !== true || result.timed_out !== false || result.surviving_descendants !== false || result.instrument_error || !Array.isArray(result.workspace_changes) || result.workspace_changes.length || result.inputs_changed !== false || result.temporary_removed !== true || result.acceptance_granted !== false) return envelope(fingerprint, "prior-attempt-unsuccessful", { result, result_ref: resultRef });
  if (result.fingerprint?.key !== result.key || digest({ plan, inputs: result.fingerprint.inventory, environment: result.fingerprint.environment, toolchain: result.fingerprint.toolchain }) !== result.key) return envelope(fingerprint, "invalid-result-record");
  if (!await artifactIntegrity(root, result, attemptPath)) return envelope(fingerprint, "artifact-integrity-mismatch", { result_ref: resultRef });
  return envelope(fingerprint, "compatible-successful-measurement", { cache_status: "hit", status: "completed", successful: true, result, result_ref: resultRef, next_action: "An eligible reviewer must judge this measurement's applicability to the current candidate." });
}
async function writeImmutable(root, ref, record) {
  const file = await safePath(root, ref, { create: true });
  await fs.writeFile(file, formatJson({ ...record, checksum: digest(record) }), { flag: "wx", mode: 0o600 });
}
async function workspace(root, exclusions) {
  return inventory(root, await fs.readdir(root), { exclude: [".git", ...exclusions], recordSymlinks: true });
}
export async function runMeasurement(root, plan, { env = process.env, storePath = STORE, reuse = true, hooks = {} } = {}) {
  validateMeasurementPlan(plan); storeBoundary(plan, storePath);
  const inspected = await inspectMeasurement(root, plan, { env, storePath });
  if (reuse && inspected.cache_status === "hit") return { ...inspected, reused: true };
  if (!inspected.fingerprint.complete) return { ...inspected, status: "blocked", successful: false };
  const capabilities = measurementCapabilities(), adapter = capabilities.adapters[plan.check_policy];
  if (!adapter.supported) return envelope(inspected.fingerprint, "unsupported-execution-adapter", { status: "blocked", successful: false, capabilities, next_action: "Use a supported host; no weaker adapter will be selected automatically." });
  const started = Date.now(), monotonicStarted = performance.now(), attemptId = `attempt-${started}-${randomUUID()}`, attemptPath = `${storePath}/${attemptId}`;
  let temporary = null, result, mutationStatus = "not-performed";
  try {
    await safePath(root, storePath, { directory: true, create: true }); mutationStatus = "performed";
    temporary = await fs.mkdtemp(path.join(await fs.realpath(root), ".temple-measurement-"));
    const temporaryName = path.basename(temporary);
    let before = await workspace(root, [storePath, temporaryName]);
    let command = { executable: inspected.fingerprint.toolchain.executable.path, args: plan.command.args,
      cwd: await safePath(root, plan.command.cwd, { directory: true }), env: { ...selectedEnvironment(plan, env), TMPDIR: temporary, TMP: temporary, TEMP: temporary } };
    let boundary = { adapter: "trusted-local", parent_agent_confined: false, descendant_cleanup: "owned-posix-process-group", limitations: adapter.limitations };
    if (plan.check_policy === "confined-node") {
      const confined = await confinedCheckCommand(root, temporary, plan.inputs.tests, plan.timeout_ms);
      command = { executable: confined.command, args: confined.args, cwd: command.cwd, env: confined.env }; boundary = confined.boundary;
    }
    await writeImmutable(root, `${attemptPath}/attempt.json`, { schema_version: "temple.measurement-attempt/v1", attempt_id: attemptId, key: inspected.fingerprint.key, plan_digest: digest(plan), started_at_ms: started });
    const execution = await runSupervisedCommand(command, { timeout_ms: plan.timeout_ms, output_limit_bytes: plan.output_limit_bytes, hooks: { started: async metadata => {
      await hooks.started?.({ ...metadata, temporary: temporaryName });
      before = await workspace(root, [storePath, temporaryName]);
      const current = await fingerprintMeasurement(root, plan, { env });
      if (!current.complete || current.key !== inspected.fingerprint.key) throw problem("MEASUREMENT_INPUT_CHANGED", "Inputs changed before command execution");
    } } });
    result = { schema_version: RESULT, attempt_id: attemptId, key: inspected.fingerprint.key, plan_digest: digest(plan), started_at_ms: started, completed_at_ms: Date.now(),
      retired: false, status: execution.instrument_error ? "instrument-failure" : "completed", successful: false, acceptance_granted: false, execution_boundary: boundary,
      fingerprint: inspected.fingerprint, command: plan.command, ...execution, artifacts: [] };
    const after = await workspace(root, [storePath, temporaryName]);
    result.workspace_changes = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(p => stable(before[p]) !== stable(after[p]) && !plan.outputs.some(o => within(p, o) || !before[p] && after[p]?.type === "directory" && within(o, p)));
    const refreshed = await fingerprintMeasurement(root, plan, { env }); result.inputs_changed = !refreshed.complete || refreshed.key !== result.key;
    result.temporary_residue = await fs.readdir(temporary);
    const outputs = await inventory(root, plan.outputs);
    for (const [name, body] of [["stdout.txt", execution.stdout], ["stderr.txt", execution.stderr]]) {
      const ref = `${attemptPath}/artifacts/${name}`, bytes = Buffer.from(body);
      await fs.writeFile(await safePath(root, ref, { create: true }), bytes, { flag: "wx", mode: 0o600 });
      result.artifacts.push({ path: ref, bytes: bytes.length, sha256: sha256(bytes), kind: name.slice(0, -4) });
    }
    for (const [source, info] of Object.entries(outputs)) if (info.type === "file") {
      const ref = `${attemptPath}/artifacts/outputs/${source}`, body = await fs.readFile(await safePath(root, source));
      if (sha256(body) !== info.sha256) throw problem("MEASUREMENT_OUTPUT_CHANGED", "Output changed while preserving its artifact");
      await fs.writeFile(await safePath(root, ref, { create: true }), body, { flag: "wx", mode: 0o600 });
      result.artifacts.push({ path: ref, source, bytes: body.length, sha256: info.sha256, source_mode: info.mode, kind: "output" });
    }
    result.output_inventory = outputs;
    if (plan.check_policy === "confined-node") {
      result.tests = Number(execution.stdout.match(/^# tests (\d+)/m)?.[1] ?? 0);
      if (!result.tests || !/^# fail 0$/m.test(execution.stdout) || !/^# cancelled 0$/m.test(execution.stdout)) result.instrument_error ??= "confined-runtime-did-not-report-successful-tests";
    }
    result.successful = result.status === "completed" && result.exit_code === 0 && result.process_exit_confirmed && !result.timed_out && !result.surviving_descendants && !result.instrument_error && !result.inputs_changed && result.workspace_changes.length === 0 && (plan.check_policy !== "confined-node" || result.temporary_residue.length === 0);
  } catch (error) {
    result = { schema_version: RESULT, attempt_id: attemptId, key: inspected.fingerprint.key, plan_digest: digest(plan), started_at_ms: started,
      completed_at_ms: Date.now(), retired: false, acceptance_granted: false, ...result, status: "instrument-failure", successful: false,
      instrument_error: error.code ?? error.message, execution_started: result?.execution_started ?? false,
      next_action: error.next_action ?? "Inspect the failed attempt and restore its missing precondition before retrying." };
  } finally {
    if (temporary && result?.process_exit_confirmed !== false) {
      try { await fs.rm(temporary, { recursive: true, force: true }); if (result) result.temporary_removed = true; }
      catch { if (result) Object.assign(result, { successful: false, status: "instrument-failure", temporary_removed: false, instrument_error: "temporary-cleanup-failed" }); }
    }
  }
  result.elapsed_ms = Date.now() - started;
  result.monotonic_elapsed_ms = performance.now() - monotonicStarted;
  result.completed_at_ms = Date.now();
  try {
    // If setup failed before attempt creation, still preserve the failed attempt.
    const attemptRef = `${attemptPath}/attempt.json`;
    if (!await fs.lstat(path.join(root, attemptRef)).catch(() => null)) await writeImmutable(root, attemptRef, { schema_version: "temple.measurement-attempt/v1", attempt_id: attemptId, key: result.key, plan_digest: digest(plan), started_at_ms: started });
    await writeImmutable(root, `${attemptPath}/result.json`, result); mutationStatus = "performed";
  } catch (error) { throw problem("MEASUREMENT_PERSIST_FAILED", "Preserve the attempt directory and inspect the incomplete measurement before retrying", { mutation_status: mutationStatus === "performed" ? "partial" : "not-performed", execution_started: result.execution_started, attempt_ref: attemptPath, cause: error }); }
  return envelope(inspected.fingerprint, inspected.cache_status === "hit" ? "reuse-disabled" : inspected.reason, { mutation_status: mutationStatus, reused: false, execution_started: result.execution_started,
    status: result.status, successful: result.successful, result, result_ref: `${attemptPath}/result.json`, next_action: result.successful ? "Submit the measurement for independent candidate applicability review." : result.next_action ?? "Resolve the failed measurement condition and run a new attempt." });
}
