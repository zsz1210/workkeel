import fs from "node:fs/promises";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import {
  durableAtomicWrite,
  formatJson,
  pathExists,
  readJson,
  sha256,
  toPosix
} from "./files.mjs";
import { resolveControlPlaneStateDirectory } from "./telemetry.mjs";
import { buildUsageBaseline } from "./usage-attribution.mjs";

const execFile = promisify(execFileCallback);

export const VALIDATION_PROGRAM_SCHEMA = "temple.validation-program/v1";
export const VALIDATION_PROGRAM_STATE_SCHEMA = "temple.validation-program-state/v1";
export const VALIDATION_PROGRAM_REPORT_SCHEMA = "temple.validation-program-report/v1";
export const VALIDATION_PROGRAM_REPORT_VIEW = ".ai-org/views/validation-program-report.json";

const TOKEN_FIELDS = [
  "input_tokens",
  "cached_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "total_tokens"
];

const LIMIT_FIELDS = [
  "max_turns",
  "max_launch_attempts",
  "max_retries",
  "max_concurrency",
  "per_turn_warning_tokens",
  "per_turn_hard_tokens",
  "aggregate_warning_tokens",
  "aggregate_hard_tokens",
  "per_turn_warning_ms",
  "per_turn_hard_ms",
  "program_warning_ms",
  "program_hard_ms",
  "per_repository_warning_bytes",
  "per_repository_hard_bytes",
  "aggregate_warning_bytes",
  "aggregate_hard_bytes"
];

const AUTHORITY_FIELDS = [
  "network_access",
  "external_writes",
  "external_spend_yen",
  "api_key_use",
  "usage_reset",
  "deployment",
  "publication",
  "fallback_allowed"
];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => String(left).localeCompare(String(right)));
}

function stableValue(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stableValue);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function manifestDigest(manifest) {
  return sha256(JSON.stringify(stableValue(manifest)));
}

function exactKeys(value, allowed, location, errors) {
  if (!isObject(value)) {
    errors.push(`${location} must be an object`);
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${location} contains unsupported field ${key}`);
  }
  return true;
}

function validId(value, pattern = /^[a-z0-9][a-z0-9-]{0,79}$/) {
  return typeof value === "string" && pattern.test(value);
}

function safeRelativePath(value, { allowParent = false, allowCurrent = false } = {}) {
  if (typeof value !== "string" || !value || value.length > 500 || path.isAbsolute(value)) return false;
  if (allowCurrent && value === ".") return true;
  if (value.includes("\\") || value.includes("\0") || value.includes("//") || value.endsWith("/")) return false;
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === ".")) return false;
  if (!allowParent && segments.includes("..")) return false;
  const firstNonParent = segments.findIndex((segment) => segment !== "..");
  return firstNonParent >= 0 && !segments.slice(firstNonParent).includes("..");
}

function safeAllowedPath(value) {
  return safeRelativePath(value) && value !== ".git" && !value.startsWith(".git/");
}

function pathRuleContains(parentRule, childRule) {
  return childRule === parentRule || childRule.startsWith(`${parentRule}/`);
}

function pushDuplicateErrors(values, location, errors) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) errors.push(`${location} contains duplicate ${value}`);
    seen.add(value);
  }
}

function validatePositiveLimit(limits, field, errors, { zeroAllowed = false } = {}) {
  const value = limits[field];
  if (!Number.isSafeInteger(value) || value < (zeroAllowed ? 0 : 1)) {
    errors.push(`limits.${field} must be ${zeroAllowed ? "a non-negative" : "a positive"} safe integer`);
  }
}

/**
 * Validate the semantic safety boundary that JSON Schema cannot express by itself.
 */
export function validateValidationProgramManifest(manifest) {
  const errors = [];
  if (!exactKeys(
    manifest,
    ["schema_version", "id", "coordinator_project_id", "authority", "limits", "participants", "waves"],
    "manifest",
    errors
  )) return { valid: false, errors };

  if (manifest.schema_version !== VALIDATION_PROGRAM_SCHEMA) errors.push(`schema_version must be ${VALIDATION_PROGRAM_SCHEMA}`);
  if (!validId(manifest.id)) errors.push("id must be a lowercase record ID");
  if (!validId(manifest.coordinator_project_id, /^[a-z0-9][a-z0-9-]*$/)) errors.push("coordinator_project_id is invalid");

  if (exactKeys(manifest.authority, AUTHORITY_FIELDS, "authority", errors)) {
    for (const field of AUTHORITY_FIELDS) {
      const expected = field === "external_spend_yen" ? 0 : false;
      if (manifest.authority[field] !== expected) errors.push(`authority.${field} must be ${String(expected)}`);
    }
  }

  if (exactKeys(manifest.limits, LIMIT_FIELDS, "limits", errors)) {
    for (const field of LIMIT_FIELDS) validatePositiveLimit(manifest.limits, field, errors, { zeroAllowed: field === "max_retries" });
    if (manifest.limits.max_retries !== 0) errors.push("limits.max_retries must be 0");
    for (const [warning, hard] of [
      ["per_turn_warning_tokens", "per_turn_hard_tokens"],
      ["aggregate_warning_tokens", "aggregate_hard_tokens"],
      ["per_turn_warning_ms", "per_turn_hard_ms"],
      ["program_warning_ms", "program_hard_ms"],
      ["per_repository_warning_bytes", "per_repository_hard_bytes"],
      ["aggregate_warning_bytes", "aggregate_hard_bytes"]
    ]) {
      if (Number.isSafeInteger(manifest.limits[warning]) && Number.isSafeInteger(manifest.limits[hard]) && manifest.limits[warning] > manifest.limits[hard]) {
        errors.push(`limits.${warning} must not exceed limits.${hard}`);
      }
    }
  }

  if (!Array.isArray(manifest.participants) || manifest.participants.length === 0) {
    errors.push("participants must contain at least one repository");
  }
  const participantIds = [];
  const participantsById = new Map();
  for (const [index, participant] of (manifest.participants ?? []).entries()) {
    const location = `participants[${index}]`;
    if (!exactKeys(participant, ["id", "path", "expected_project_id", "allowed_paths", "usage_state_directory"], location, errors)) continue;
    if (!validId(participant.id, /^[a-z0-9][a-z0-9-]*$/)) errors.push(`${location}.id is invalid`);
    if (!safeRelativePath(participant.path, { allowParent: true, allowCurrent: true })) errors.push(`${location}.path must be a safe relative repository path`);
    if (!validId(participant.expected_project_id, /^[a-z0-9][a-z0-9-]*$/)) errors.push(`${location}.expected_project_id is invalid`);
    if (!Array.isArray(participant.allowed_paths) || participant.allowed_paths.length === 0) {
      errors.push(`${location}.allowed_paths must contain at least one project-relative path`);
    } else {
      for (const allowedPath of participant.allowed_paths) {
        if (!safeAllowedPath(allowedPath)) errors.push(`${location}.allowed_paths contains unsafe path ${String(allowedPath)}`);
      }
      pushDuplicateErrors(participant.allowed_paths, `${location}.allowed_paths`, errors);
    }
    if (participant.usage_state_directory !== undefined && !safeRelativePath(participant.usage_state_directory)) {
      errors.push(`${location}.usage_state_directory must be a safe project-relative path`);
    }
    participantIds.push(participant.id);
    participantsById.set(participant.id, participant);
  }
  pushDuplicateErrors(participantIds, "participants", errors);

  if (!Array.isArray(manifest.waves) || manifest.waves.length === 0) errors.push("waves must contain at least one wave");
  const waveIds = [];
  const waveOrders = [];
  const turnIds = [];
  let totalTurns = 0;
  for (const [waveIndex, wave] of (manifest.waves ?? []).entries()) {
    const waveLocation = `waves[${waveIndex}]`;
    if (!exactKeys(wave, ["id", "order", "turns"], waveLocation, errors)) continue;
    if (!validId(wave.id)) errors.push(`${waveLocation}.id is invalid`);
    if (!Number.isSafeInteger(wave.order) || wave.order < 1) errors.push(`${waveLocation}.order must be a positive integer`);
    if (!Array.isArray(wave.turns) || wave.turns.length === 0) errors.push(`${waveLocation}.turns must not be empty`);
    if (Number.isSafeInteger(manifest.limits?.max_concurrency) && (wave.turns?.length ?? 0) > manifest.limits.max_concurrency) {
      errors.push(`${waveLocation} exceeds limits.max_concurrency`);
    }
    waveIds.push(wave.id);
    waveOrders.push(wave.order);
    const waveProjects = [];
    for (const [turnIndex, turn] of (wave.turns ?? []).entries()) {
      totalTurns += 1;
      const turnLocation = `${waveLocation}.turns[${turnIndex}]`;
      if (!exactKeys(
        turn,
        [
          "id",
          "project_id",
          "work_item_id",
          "position_id",
          "requested_model",
          "requested_reasoning_effort",
          "sandbox_mode",
          "approval_policy",
          "network_access",
          "instruction_path",
          "allowed_paths"
        ],
        turnLocation,
        errors
      )) continue;
      if (!validId(turn.id)) errors.push(`${turnLocation}.id is invalid`);
      if (!participantsById.has(turn.project_id)) errors.push(`${turnLocation}.project_id names an unknown participant`);
      if (typeof turn.work_item_id !== "string" || !/^WI-(?:[0-9]{4,}|[0-9]{8}-[A-F0-9]{10})$/.test(turn.work_item_id)) {
        errors.push(`${turnLocation}.work_item_id is invalid`);
      }
      if (!validId(turn.position_id, /^[a-z][a-z0-9_]*$/)) errors.push(`${turnLocation}.position_id is invalid`);
      if (typeof turn.requested_model !== "string" || !/^gpt-5\.6-(?:sol|terra|luna)$/.test(turn.requested_model)) {
        errors.push(`${turnLocation}.requested_model must use the gpt-5.6 family`);
      }
      if (!["low", "medium", "high", "xhigh", "max", "ultra"].includes(turn.requested_reasoning_effort)) {
        errors.push(`${turnLocation}.requested_reasoning_effort is unsupported`);
      }
      if (turn.requested_model === "gpt-5.6-luna" && turn.requested_reasoning_effort === "ultra") {
        errors.push(`${turnLocation}.requested_reasoning_effort ultra is not supported by gpt-5.6-luna`);
      }
      if (!["read-only", "workspace-write"].includes(turn.sandbox_mode)) errors.push(`${turnLocation}.sandbox_mode is unsupported`);
      if (turn.approval_policy !== "never") errors.push(`${turnLocation}.approval_policy must be never`);
      if (turn.network_access !== false) errors.push(`${turnLocation}.network_access must be false`);
      if (!safeRelativePath(turn.instruction_path)) errors.push(`${turnLocation}.instruction_path must be project relative`);
      if (!Array.isArray(turn.allowed_paths) || turn.allowed_paths.length === 0) {
        errors.push(`${turnLocation}.allowed_paths must not be empty`);
      } else {
        const participantRules = participantsById.get(turn.project_id)?.allowed_paths ?? [];
        for (const allowedPath of turn.allowed_paths) {
          if (!safeAllowedPath(allowedPath)) errors.push(`${turnLocation}.allowed_paths contains unsafe path ${String(allowedPath)}`);
          else if (!participantRules.some((rule) => pathRuleContains(rule, allowedPath))) {
            errors.push(`${turnLocation}.allowed_paths path ${allowedPath} exceeds the participant allowlist`);
          }
        }
        pushDuplicateErrors(turn.allowed_paths, `${turnLocation}.allowed_paths`, errors);
      }
      turnIds.push(turn.id);
      waveProjects.push(turn.project_id);
    }
    pushDuplicateErrors(waveProjects, `${waveLocation}.projects`, errors);
  }
  pushDuplicateErrors(waveIds, "waves", errors);
  pushDuplicateErrors(waveOrders, "wave orders", errors);
  pushDuplicateErrors(turnIds, "turns", errors);
  if (Number.isSafeInteger(manifest.limits?.max_turns) && totalTurns > manifest.limits.max_turns) errors.push("planned turns exceed limits.max_turns");
  if (Number.isSafeInteger(manifest.limits?.max_launch_attempts) && totalTurns > manifest.limits.max_launch_attempts) {
    errors.push("planned turns exceed limits.max_launch_attempts");
  }
  const sortedOrders = [...waveOrders].sort((left, right) => left - right);
  if (sortedOrders.some((order, index) => order !== index + 1)) errors.push("wave order must be contiguous from 1");

  return {
    valid: errors.length === 0,
    errors: sortedUnique(errors),
    summary: {
      participants: manifest.participants?.length ?? 0,
      waves: manifest.waves?.length ?? 0,
      turns: totalTurns,
      max_concurrency: manifest.limits?.max_concurrency ?? null,
      retries: manifest.limits?.max_retries ?? null
    }
  };
}

function containsPath(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function realDirectory(target, label) {
  let resolved;
  try {
    resolved = await fs.realpath(target);
  } catch (error) {
    throw new Error(`${label} is unavailable: ${error.message}`);
  }
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) throw new Error(`${label} is not a directory`);
  return resolved;
}

async function resolveManifestPath(coordinatorRoot, manifestPath) {
  const absolute = path.resolve(coordinatorRoot, manifestPath);
  const realCoordinator = await realDirectory(coordinatorRoot, "coordinator root");
  const realManifest = await fs.realpath(absolute).catch((error) => {
    throw new Error(`validation manifest is unavailable: ${error.message}`);
  });
  if (!containsPath(realCoordinator, realManifest)) throw new Error("validation manifest escapes the coordinator repository");
  return realManifest;
}

export async function resolveValidationProgram(coordinatorRoot, options = {}) {
  const realCoordinator = await realDirectory(coordinatorRoot, "coordinator root");
  const manifestPath = await resolveManifestPath(realCoordinator, options.manifestPath ?? ".ai-org/project/validation-program.json");
  const manifest = await readJson(manifestPath);
  const validation = validateValidationProgramManifest(manifest);
  if (!validation.valid) throw new Error(`Invalid validation program:\n- ${validation.errors.join("\n- ")}`);

  const coordinatorProject = await readJson(path.join(realCoordinator, ".ai-org/project/project.json"));
  if (coordinatorProject.id !== manifest.coordinator_project_id) {
    throw new Error(`coordinator project mismatch: expected ${manifest.coordinator_project_id}, observed ${coordinatorProject.id}`);
  }

  const allowedRoot = await realDirectory(options.allowedRoot ?? path.dirname(realCoordinator), "allowed root");
  if (!containsPath(allowedRoot, realCoordinator)) throw new Error("coordinator repository escapes the allowed root");
  const participants = [];
  for (const participant of manifest.participants) {
    const root = await realDirectory(path.resolve(realCoordinator, participant.path), `participant ${participant.id}`);
    if (!containsPath(allowedRoot, root)) throw new Error(`participant ${participant.id} escapes the allowed root`);
    const project = await readJson(path.join(root, ".ai-org/project/project.json"));
    if (project.id !== participant.expected_project_id) {
      throw new Error(`participant ${participant.id} project mismatch: expected ${participant.expected_project_id}, observed ${project.id}`);
    }
    let resolvedUsageStateDirectory;
    try {
      resolvedUsageStateDirectory = resolveControlPlaneStateDirectory(
        root,
        participant.usage_state_directory ?? null
      );
    } catch (error) {
      throw new Error(`participant ${participant.id} usage state directory is invalid: ${error.message}`);
    }
    const instructions = new Map();
    for (const wave of manifest.waves) {
      for (const turn of wave.turns.filter((entry) => entry.project_id === participant.id)) {
        const instructionPath = await fs.realpath(path.join(root, turn.instruction_path)).catch((error) => {
          throw new Error(`turn ${turn.id} instruction is unavailable: ${error.message}`);
        });
        if (!containsPath(root, instructionPath)) throw new Error(`turn ${turn.id} instruction escapes participant ${participant.id}`);
        const stat = await fs.stat(instructionPath);
        if (!stat.isFile()) throw new Error(`turn ${turn.id} instruction is not a file`);
        instructions.set(turn.id, instructionPath);
      }
    }
    participants.push({
      ...participant,
      root,
      project,
      instructions,
      resolved_usage_state_directory: resolvedUsageStateDirectory
    });
  }
  return {
    manifest,
    manifest_path: manifestPath,
    manifest_digest: manifestDigest(manifest),
    coordinator_root: realCoordinator,
    allowed_root: allowedRoot,
    participants
  };
}

export async function inspectValidationProgram(coordinatorRoot, options = {}) {
  const resolved = await resolveValidationProgram(coordinatorRoot, options);
  return {
    schema_version: "temple.validation-program-inspection/v1",
    generated_at: new Date().toISOString(),
    id: resolved.manifest.id,
    manifest_digest: resolved.manifest_digest,
    coordinator_project_id: resolved.manifest.coordinator_project_id,
    participants: resolved.participants.map((participant) => ({
      id: participant.id,
      expected_project_id: participant.expected_project_id,
      project_id: participant.project.id,
      path: toPosix(path.relative(resolved.coordinator_root, participant.root)) || ".",
      instructions: participant.instructions.size,
      allowed_paths: participant.allowed_paths,
      usage_state_directory_policy: "git-common-directory",
      usage_state_directory_configured: participant.usage_state_directory !== undefined
    })),
    waves: [...resolved.manifest.waves]
      .sort((left, right) => left.order - right.order)
      .map((wave) => ({ id: wave.id, order: wave.order, turns: wave.turns.map((turn) => turn.id) })),
    limits: resolved.manifest.limits,
    authority: {
      ...resolved.manifest.authority,
      lifecycle_authority: "participant-repositories",
      canonical_state_changed: false,
      model_generation_requested: false,
      external_action_performed: false
    }
  };
}

function parseNullPaths(value) {
  return value.split("\0").filter(Boolean).map(toPosix);
}

async function git(root, args) {
  const result = await execFile("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" }
  });
  return result.stdout;
}

function parsePorcelainZero(output) {
  const records = output.split("\0");
  const paths = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const status = record.slice(0, 2);
    paths.push(toPosix(record.slice(3)));
    if (/[RC]/.test(status)) index += 1;
  }
  return sortedUnique(paths.filter(Boolean));
}

export async function inspectGitRepository(root, options = {}) {
  const revision = (await git(root, ["rev-parse", "HEAD"])).trim();
  const statusOutput = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const dirtyPaths = parsePorcelainZero(statusOutput);
  const committedPaths = options.baseRevision && options.baseRevision !== revision
    ? parseNullPaths(await git(root, ["diff", "--name-only", "-z", `${options.baseRevision}..${revision}`]))
    : [];
  return {
    revision,
    dirty: dirtyPaths.length > 0,
    dirty_paths: dirtyPaths,
    changed_paths: sortedUnique([...committedPaths, ...dirtyPaths])
  };
}

export async function measureRepositoryBytes(root) {
  let total = 0;
  async function visit(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) total += (await fs.stat(absolute)).size;
    }
  }
  await visit(root);
  return total;
}

function changedPathAllowed(changedPath, allowedPaths) {
  return allowedPaths.some((rule) => pathRuleContains(rule, changedPath));
}

async function appendDurableEvent(eventsPath, event) {
  await fs.mkdir(path.dirname(eventsPath), { recursive: true });
  const handle = await fs.open(eventsPath, "a", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(event)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function initialState(resolved, now) {
  return {
    schema_version: VALIDATION_PROGRAM_STATE_SCHEMA,
    program_id: resolved.manifest.id,
    manifest_digest: resolved.manifest_digest,
    status: "pending",
    started_at: now.toISOString(),
    updated_at: now.toISOString(),
    completed_at: null,
    counters: {
      turns_started: 0,
      turns_completed: 0,
      launch_attempts: 0,
      aggregate_tokens: 0,
      aggregate_budget_tokens: 0,
      program_elapsed_ms: 0,
      aggregate_disk_delta_bytes: 0
    },
    repository_baselines: {},
    waves: Object.fromEntries(resolved.manifest.waves.map((wave) => [wave.id, { status: "pending", completed_at: null }])),
    turns: Object.fromEntries(resolved.manifest.waves.flatMap((wave) => wave.turns.map((turn) => [turn.id, {
      status: "pending",
      attempts: 0,
      started_at: null,
      completed_at: null,
      duration_ms: null,
      total_tokens: 0,
      budget_tokens: 0,
      usage: null,
      before_revision: null,
      after_revision: null,
      changed_paths: [],
      disk_delta_bytes: 0,
      result: null,
      stop_code: null
    }]))),
    warnings: [],
    stop: null
  };
}

function warning(state, code, details = {}) {
  if (state.warnings.some((entry) => entry.code === code && entry.turn_id === details.turn_id && entry.project_id === details.project_id)) return;
  state.warnings.push({ code, ...details });
}

function setStop(state, code, message, details = {}) {
  if (!state.stop) state.stop = { code, message, ...details };
  state.status = "stopped";
}

function hardProgramCheck(state, limits, elapsed) {
  state.counters.program_elapsed_ms = elapsed;
  if (state.counters.launch_attempts >= limits.max_launch_attempts) return ["max-launch-attempts", "maximum launch attempts reached"];
  if (state.counters.turns_started >= limits.max_turns) return ["max-turns", "maximum turns reached"];
  if (state.counters.aggregate_budget_tokens >= limits.aggregate_hard_tokens) return ["aggregate-token-hard-limit", "aggregate non-cached Token budget hard limit reached"];
  if (elapsed >= limits.program_hard_ms) return ["program-time-hard-limit", "program wall-clock hard limit reached"];
  if (state.counters.aggregate_disk_delta_bytes >= limits.aggregate_hard_bytes) return ["aggregate-disk-hard-limit", "aggregate disk hard limit reached"];
  return null;
}

function updateWarnings(state, limits, turnState = null, projectId = null) {
  if (state.counters.aggregate_budget_tokens >= limits.aggregate_warning_tokens) warning(state, "aggregate-token-warning");
  if (state.counters.program_elapsed_ms >= limits.program_warning_ms) warning(state, "program-time-warning");
  if (state.counters.aggregate_disk_delta_bytes >= limits.aggregate_warning_bytes) warning(state, "aggregate-disk-warning");
  if (turnState?.budget_tokens >= limits.per_turn_warning_tokens) warning(state, "per-turn-token-warning", { turn_id: turnState.id });
  if (turnState?.duration_ms >= limits.per_turn_warning_ms) warning(state, "per-turn-time-warning", { turn_id: turnState.id });
  if (turnState?.disk_delta_bytes >= limits.per_repository_warning_bytes) warning(state, "per-repository-disk-warning", { project_id: projectId });
}

function integerTotalTokens(usage) {
  const value = usage?.total_tokens ?? usage?.total?.total_tokens ?? usage?.last?.total_tokens;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("usage total_tokens must be a non-negative safe integer");
  return value;
}

function usageField(usage, field) {
  const value = usage?.[field] ?? usage?.total?.[field] ?? usage?.last?.[field];
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function normalizeValidationUsage(usage) {
  const totalTokens = integerTotalTokens(usage);
  const inputTokens = usageField(usage, "input_tokens");
  const cachedInputTokens = usageField(usage, "cached_input_tokens");
  const outputTokens = usageField(usage, "output_tokens");
  const reasoningOutputTokens = usageField(usage, "reasoning_output_tokens");
  const detailed = [inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens].every((value) => value !== null);
  if (detailed && cachedInputTokens > inputTokens) throw new Error("usage cached_input_tokens must not exceed input_tokens");
  return {
    input_tokens: inputTokens,
    cached_input_tokens: cachedInputTokens,
    output_tokens: outputTokens,
    reasoning_output_tokens: reasoningOutputTokens,
    total_tokens: totalTokens,
    budget_tokens: detailed ? inputTokens - cachedInputTokens + outputTokens : totalTokens,
    budget_basis: detailed ? "noncached-input-plus-output" : "gross-total-fallback"
  };
}

function candidateLocalStop(code) {
  return ["per-turn-token-hard-limit", "per-turn-time-hard-limit"].includes(code);
}

async function timeoutRace(promise, delay, controller, code) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(code);
      error.code = code;
      controller.abort(error);
      reject(error);
    }, Math.max(1, delay));
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run a previously reviewed local program. The caller owns the model adapter;
 * this function supplies fail-closed orchestration and never retries.
 */
export async function runValidationProgram(options) {
  if (typeof options?.launchTurn !== "function") throw new Error("runValidationProgram requires launchTurn");
  const resolved = options.resolved ?? await resolveValidationProgram(options.coordinatorRoot, {
    manifestPath: options.manifestPath,
    allowedRoot: options.allowedRoot
  });
  const now = options.now ?? (() => new Date());
  const inspectRepository = options.inspectRepository ?? inspectGitRepository;
  const measureDisk = options.measureDisk ?? measureRepositoryBytes;
  const statePath = path.resolve(resolved.coordinator_root, options.statePath ?? `.ai-org/runtime/validation-program/${resolved.manifest.id}/state.json`);
  const eventsPath = path.resolve(resolved.coordinator_root, options.eventsPath ?? `.ai-org/runtime/validation-program/${resolved.manifest.id}/events.jsonl`);
  if (!containsPath(resolved.coordinator_root, statePath) || !containsPath(resolved.coordinator_root, eventsPath)) {
    throw new Error("validation state and events must remain inside the coordinator repository");
  }
  const rawWriteState = options.writeState ?? (async (state) => durableAtomicWrite(statePath, formatJson(state)));
  const rawAppendEvent = options.appendEvent ?? (async (event) => appendDurableEvent(eventsPath, event));
  let persistence = Promise.resolve();
  const serializePersistence = (operation) => {
    const current = persistence.then(operation);
    persistence = current.catch(() => {});
    return current;
  };
  const writeState = (currentState) => {
    const snapshot = structuredClone(currentState);
    return serializePersistence(() => rawWriteState(snapshot));
  };
  const appendEvent = (event) => {
    const snapshot = structuredClone(event);
    return serializePersistence(() => rawAppendEvent(snapshot));
  };
  const participantById = new Map(resolved.participants.map((participant) => [participant.id, participant]));
  let state = await pathExists(statePath) ? await readJson(statePath) : initialState(resolved, now());
  if (state.schema_version !== VALIDATION_PROGRAM_STATE_SCHEMA || state.program_id !== resolved.manifest.id) {
    throw new Error("validation state belongs to another program");
  }
  if (state.manifest_digest !== resolved.manifest_digest) throw new Error("validation manifest changed after the checkpoint was created");
  state.counters.aggregate_budget_tokens ??= state.counters.aggregate_tokens ?? 0;
  for (const turnState of Object.values(state.turns)) {
    turnState.budget_tokens ??= turnState.total_tokens ?? 0;
    turnState.usage ??= null;
  }
  const startedAtMs = Date.parse(state.started_at);
  if (!Number.isFinite(startedAtMs)) throw new Error("validation state has an invalid started_at timestamp");
  if (state.status === "completed" || state.status === "stopped") return { state, statePath, eventsPath, resumed: true };
  const ambiguous = Object.entries(state.turns).find(([, turn]) => turn.status === "running");
  if (ambiguous) {
    setStop(state, "ambiguous-running-attempt", "a previous process ended while a turn was running; automatic relaunch is forbidden", { turn_id: ambiguous[0] });
    state.updated_at = now().toISOString();
    await writeState(state);
    await appendEvent({ at: state.updated_at, type: "program-stopped", program_id: state.program_id, ...state.stop });
    return { state, statePath, eventsPath, resumed: true };
  }

  if (Object.keys(state.repository_baselines).length === 0) {
    for (const participant of resolved.participants) {
      const inspected = await inspectRepository(participant.root);
      if (inspected.dirty) {
        setStop(state, "dirty-participant-start", `participant ${participant.id} is dirty before execution`, { project_id: participant.id });
        break;
      }
      state.repository_baselines[participant.id] = {
        revision: inspected.revision,
        bytes: await measureDisk(participant.root),
        current_bytes: null,
        disk_delta_bytes: 0
      };
    }
  }
  state.status = state.stop ? "stopped" : "running";
  state.updated_at = now().toISOString();
  await writeState(state);
  await appendEvent({ at: state.updated_at, type: state.stop ? "program-stopped" : "program-started", program_id: state.program_id, ...(state.stop ?? {}) });
  if (state.stop) return { state, statePath, eventsPath, resumed: false };

  const limits = resolved.manifest.limits;
  const orderedWaves = [...resolved.manifest.waves].sort((left, right) => left.order - right.order);
  for (const wave of orderedWaves) {
    if (state.waves[wave.id].status === "completed") continue;
    const elapsed = Math.max(0, now().getTime() - startedAtMs);
    const precheck = hardProgramCheck(state, limits, elapsed);
    if (precheck) {
      setStop(state, ...precheck, { wave_id: wave.id });
      break;
    }
    state.waves[wave.id].status = "running";
    state.updated_at = now().toISOString();
    await writeState(state);
    await appendEvent({ at: state.updated_at, type: "wave-started", program_id: state.program_id, wave_id: wave.id });

    const freshTurns = wave.turns.filter((turn) => state.turns[turn.id].status !== "completed");
    const prepared = [];
    for (const turn of freshTurns) {
      const participant = participantById.get(turn.project_id);
      const turnState = state.turns[turn.id];
      const before = await inspectRepository(participant.root);
      if (before.dirty) {
        setStop(state, "dirty-turn-start", `participant ${participant.id} is dirty before turn ${turn.id}`, { wave_id: wave.id, turn_id: turn.id, project_id: participant.id });
        break;
      }
      const perTurnCheck = hardProgramCheck(state, limits, Math.max(0, now().getTime() - startedAtMs));
      if (perTurnCheck) {
        setStop(state, ...perTurnCheck, { wave_id: wave.id, turn_id: turn.id });
        break;
      }
      turnState.status = "running";
      turnState.id = turn.id;
      turnState.attempts += 1;
      turnState.started_at = now().toISOString();
      turnState.before_revision = before.revision;
      state.counters.turns_started += 1;
      state.counters.launch_attempts += 1;
      state.updated_at = turnState.started_at;
      await writeState(state);
      await appendEvent({
        at: state.updated_at,
        type: "turn-started",
        program_id: state.program_id,
        wave_id: wave.id,
        turn_id: turn.id,
        project_id: turn.project_id,
        attempt: turnState.attempts,
        requested_model: turn.requested_model,
        requested_reasoning_effort: turn.requested_reasoning_effort
      });
      prepared.push({ turn, participant, before, turnState });
    }
    if (state.stop) break;

    const outcomes = await Promise.all(prepared.map(async ({ turn, participant, before, turnState }) => {
      const controller = new AbortController();
      let lastTokens = turnState.total_tokens;
      let lastBudgetTokens = turnState.budget_tokens;
      let tokenStopCode = null;
      const turnStartedMs = Date.parse(turnState.started_at);
      const onUsage = async (usage) => {
        const snapshot = normalizeValidationUsage(usage);
        const totalTokens = snapshot.total_tokens;
        const budgetTokens = snapshot.budget_tokens;
        if (totalTokens < lastTokens) throw new Error("usage total_tokens decreased within one turn");
        if (budgetTokens < lastBudgetTokens) throw new Error("usage budget_tokens decreased within one turn");
        state.counters.aggregate_tokens += totalTokens - lastTokens;
        state.counters.aggregate_budget_tokens += budgetTokens - lastBudgetTokens;
        lastTokens = totalTokens;
        lastBudgetTokens = budgetTokens;
        turnState.total_tokens = totalTokens;
        turnState.budget_tokens = budgetTokens;
        turnState.usage = snapshot;
        if (budgetTokens >= limits.per_turn_hard_tokens) tokenStopCode = "per-turn-token-hard-limit";
        if (state.counters.aggregate_budget_tokens >= limits.aggregate_hard_tokens) tokenStopCode = "aggregate-token-hard-limit";
        updateWarnings(state, limits, turnState, turn.project_id);
        state.updated_at = now().toISOString();
        await writeState(state);
        await appendEvent({
          at: state.updated_at,
          type: "turn-usage",
          program_id: state.program_id,
          wave_id: wave.id,
          turn_id: turn.id,
          project_id: turn.project_id,
          total_tokens: totalTokens,
          input_tokens: snapshot.input_tokens,
          cached_input_tokens: snapshot.cached_input_tokens,
          output_tokens: snapshot.output_tokens,
          reasoning_output_tokens: snapshot.reasoning_output_tokens,
          budget_tokens: budgetTokens,
          budget_basis: snapshot.budget_basis,
          aggregate_tokens: state.counters.aggregate_tokens,
          aggregate_budget_tokens: state.counters.aggregate_budget_tokens,
          interrupt_requested: tokenStopCode !== null,
          stop_code: tokenStopCode
        });
        if (tokenStopCode && !controller.signal.aborted) controller.abort(new Error(tokenStopCode));
        return { interrupt: tokenStopCode !== null, reason: tokenStopCode };
      };
      const observeRepositoryAfterTurn = async () => {
        const after = await inspectRepository(participant.root, { baseRevision: before.revision });
        const currentBytes = await measureDisk(participant.root);
        const baseline = state.repository_baselines[turn.project_id];
        baseline.current_bytes = currentBytes;
        baseline.disk_delta_bytes = Math.max(0, currentBytes - baseline.bytes);
        state.counters.aggregate_disk_delta_bytes = Object.values(state.repository_baselines)
          .reduce((sum, entry) => sum + (entry.disk_delta_bytes ?? 0), 0);
        turnState.after_revision = after.revision;
        turnState.changed_paths = after.changed_paths;
        turnState.disk_delta_bytes = baseline.disk_delta_bytes;
        return {
          after,
          baseline,
          disallowed: after.changed_paths.filter((changedPath) => !changedPathAllowed(changedPath, turn.allowed_paths))
        };
      };
      try {
        const programRemaining = Math.max(1, limits.program_hard_ms - Math.max(0, now().getTime() - startedAtMs));
        const result = await timeoutRace(
          Promise.resolve(options.launchTurn({
            program: resolved.manifest,
            wave,
            turn,
            participant,
            instruction_path: participant.instructions.get(turn.id),
            signal: controller.signal,
            onUsage
          })),
          Math.min(limits.per_turn_hard_ms, programRemaining),
          controller,
          programRemaining <= limits.per_turn_hard_ms ? "program-time-hard-limit" : "per-turn-time-hard-limit"
        );
        if (result?.usage) await onUsage(result.usage);
        const { after, baseline, disallowed } = await observeRepositoryAfterTurn();
        turnState.duration_ms = Math.max(0, now().getTime() - turnStartedMs);
        updateWarnings(state, limits, turnState, turn.project_id);
        if (tokenStopCode) throw Object.assign(new Error(tokenStopCode), { code: tokenStopCode });
        if (turnState.duration_ms >= limits.per_turn_hard_ms) throw Object.assign(new Error("per-turn-time-hard-limit"), { code: "per-turn-time-hard-limit" });
        if (baseline.disk_delta_bytes >= limits.per_repository_hard_bytes) throw Object.assign(new Error("per-repository-disk-hard-limit"), { code: "per-repository-disk-hard-limit" });
        if (state.counters.aggregate_disk_delta_bytes >= limits.aggregate_hard_bytes) throw Object.assign(new Error("aggregate-disk-hard-limit"), { code: "aggregate-disk-hard-limit" });
        if (disallowed.length > 0) throw Object.assign(new Error(`path-allowlist-violation: ${disallowed.join(", ")}`), { code: "path-allowlist-violation", disallowed });
        turnState.status = "completed";
        turnState.completed_at = now().toISOString();
        turnState.result = result?.status ?? "completed";
        state.counters.turns_completed += 1;
        state.updated_at = turnState.completed_at;
        await writeState(state);
        await appendEvent({
          at: turnState.completed_at,
          type: "turn-completed",
          program_id: state.program_id,
          wave_id: wave.id,
          turn_id: turn.id,
          project_id: turn.project_id,
          total_tokens: turnState.total_tokens,
          budget_tokens: turnState.budget_tokens,
          usage: turnState.usage,
          duration_ms: turnState.duration_ms,
          disk_delta_bytes: turnState.disk_delta_bytes,
          before_revision: turnState.before_revision,
          after_revision: turnState.after_revision,
          changed_paths: turnState.changed_paths
        });
        return null;
      } catch (error) {
        const { baseline, disallowed } = await observeRepositoryAfterTurn();
        turnState.status = "stopped";
        turnState.completed_at = now().toISOString();
        turnState.duration_ms = Math.max(0, now().getTime() - turnStartedMs);
        turnState.stop_code = error.code ?? tokenStopCode ?? "turn-launch-failed";
        turnState.result = "stopped";
        if (disallowed.length > 0) turnState.stop_code = "path-allowlist-violation";
        else if (baseline.disk_delta_bytes >= limits.per_repository_hard_bytes) turnState.stop_code = "per-repository-disk-hard-limit";
        else if (state.counters.aggregate_disk_delta_bytes >= limits.aggregate_hard_bytes) turnState.stop_code = "aggregate-disk-hard-limit";
        state.updated_at = turnState.completed_at;
        await writeState(state);
        await appendEvent({
          at: turnState.completed_at,
          type: "turn-stopped",
          program_id: state.program_id,
          wave_id: wave.id,
          turn_id: turn.id,
          project_id: turn.project_id,
          stop_code: turnState.stop_code,
          message: String(error.message ?? error).slice(0, 500),
          total_tokens: turnState.total_tokens,
          budget_tokens: turnState.budget_tokens,
          usage: turnState.usage,
          disk_delta_bytes: turnState.disk_delta_bytes,
          before_revision: turnState.before_revision,
          after_revision: turnState.after_revision,
          changed_paths: turnState.changed_paths
        });
        return { code: turnState.stop_code, message: String(error.message ?? error), turn_id: turn.id, wave_id: wave.id, project_id: turn.project_id };
      }
    }));
    const failed = outcomes.find((outcome) => outcome && !candidateLocalStop(outcome.code));
    const isolated = outcomes.filter((outcome) => outcome && candidateLocalStop(outcome.code));
    state.counters.program_elapsed_ms = Math.max(0, now().getTime() - startedAtMs);
    state.updated_at = now().toISOString();
    if (failed) {
      setStop(state, failed.code, failed.message, failed);
      state.waves[wave.id].status = "stopped";
      await writeState(state);
      break;
    }
    for (const outcome of isolated) {
      warning(state, "candidate-local-stop", { turn_id: outcome.turn_id, project_id: outcome.project_id });
      await appendEvent({
        at: state.updated_at,
        type: "candidate-stop-isolated",
        program_id: state.program_id,
        ...outcome
      });
    }
    state.waves[wave.id] = { status: "completed", completed_at: now().toISOString() };
    await writeState(state);
    await appendEvent({ at: state.waves[wave.id].completed_at, type: "wave-completed", program_id: state.program_id, wave_id: wave.id });
  }

  state.counters.program_elapsed_ms = Math.max(0, now().getTime() - startedAtMs);
  updateWarnings(state, limits);
  if (!state.stop) {
    state.status = "completed";
    state.completed_at = now().toISOString();
  }
  state.updated_at = now().toISOString();
  await writeState(state);
  await appendEvent({
    at: state.updated_at,
    type: state.status === "completed" ? "program-completed" : "program-stopped",
    program_id: state.program_id,
    counters: state.counters,
    ...(state.stop ?? {})
  });
  return { state, statePath, eventsPath, resumed: false };
}

function taskShape(dimensions) {
  if (typeof dimensions?.position_id !== "string" || !dimensions.position_id || dimensions.position_id === "unknown") return null;
  if (typeof dimensions?.lifecycle_stage !== "string" || !dimensions.lifecycle_stage || dimensions.lifecycle_stage === "unknown") return null;
  return `${dimensions.position_id}:${dimensions.lifecycle_stage}`;
}

function qualifiedSamples(participant, issues) {
  const baseline = participant.baseline;
  if (baseline?.schema_version !== "temple.usage-baseline/v1") {
    issues.push(`${participant.project_id}: invalid usage baseline schema`);
    return [];
  }
  if (baseline.project?.id !== participant.project_id) {
    issues.push(`${participant.project_id}: baseline project mismatch`);
    return [];
  }
  const ids = baseline.source?.longitudinal_coverage?.detailed_token_observation_coverage?.qualified_completed_work_item_ids;
  if (!Array.isArray(ids)) {
    issues.push(`${participant.project_id}: qualified Work Item list is unavailable`);
    return [];
  }
  const samples = [];
  for (const workItemId of sortedUnique(ids)) {
    const groups = (baseline.driver_groups ?? []).filter((group) => group.dimensions?.work_item_id === workItemId);
    const candidates = groups.map((group) => ({
      task_id: group.dimensions?.task_id,
      model: group.dimensions?.model,
      task_shape: taskShape(group.dimensions)
    })).filter((candidate) => candidate.task_id && candidate.model && candidate.model !== "unknown" && candidate.task_shape);
    const identities = sortedUnique(candidates.map((candidate) => `${candidate.task_id}\0${candidate.model}\0${candidate.task_shape}`));
    if (identities.length !== 1 || groups.length === 0) {
      issues.push(`${participant.project_id}:${workItemId}: expected exactly one task/model/shape identity`);
      continue;
    }
    const [taskId, model, shape] = identities[0].split("\0");
    const tokens = Object.fromEntries(TOKEN_FIELDS.map((field) => {
      const values = groups.map((group) => group.tokens?.[field]);
      return [field, values.every((value) => Number.isSafeInteger(value) && value >= 0)
        ? values.reduce((sum, value) => sum + value, 0)
        : null];
    }));
    samples.push({
      id: `${participant.project_id}:${workItemId}`,
      project_id: participant.project_id,
      work_item_id: workItemId,
      task_id: taskId,
      task_shape: shape,
      model,
      observations: groups.reduce((sum, group) => sum + (Number.isSafeInteger(group.observations) ? group.observations : 0), 0),
      tokens
    });
  }
  return samples;
}

export function buildCrossRepositoryUsageReportFromBaselines(participants, options = {}) {
  const issues = [];
  const participantReports = [];
  const samples = [];
  const seenProjects = new Set();
  for (const participant of participants) {
    if (!isObject(participant) || typeof participant.project_id !== "string" || !participant.project_id) {
      issues.push("participant project_id is invalid");
      continue;
    }
    if (seenProjects.has(participant.project_id)) {
      issues.push(`duplicate participant ${participant.project_id}`);
      continue;
    }
    seenProjects.add(participant.project_id);
    if (typeof participant.revision !== "string" || !/^[0-9a-f]{40,64}$/.test(participant.revision)) {
      issues.push(`${participant.project_id}: exact revision is unavailable`);
    }
    const participantIssues = [];
    const participantSamples = qualifiedSamples(participant, participantIssues);
    issues.push(...participantIssues);
    samples.push(...participantSamples);
    participantReports.push({
      project_id: participant.project_id,
      revision: participant.revision ?? null,
      baseline_generated_at: participant.baseline?.generated_at ?? null,
      baseline_status: participant.baseline?.baseline_status ?? "invalid",
      qualified_completed_work_items: participantSamples.length,
      qualified_task_shapes: sortedUnique(participantSamples.map((sample) => sample.task_shape)),
      issues: participantIssues
    });
  }
  const distinctIds = sortedUnique(samples.map((sample) => sample.id));
  const shapes = sortedUnique(samples.map((sample) => sample.task_shape));
  const requiredWorkItems = Number.isSafeInteger(options.requiredWorkItems) && options.requiredWorkItems > 0 ? options.requiredWorkItems : 10;
  const totals = Object.fromEntries(TOKEN_FIELDS.map((field) => {
    const values = samples.map((sample) => sample.tokens[field]);
    return [field, values.length > 0 && values.every((value) => Number.isSafeInteger(value) && value >= 0)
      ? values.reduce((sum, value) => sum + value, 0)
      : null];
  }));
  const qualified = issues.length === 0 && distinctIds.length >= requiredWorkItems && shapes.length >= 2;
  return {
    schema_version: VALIDATION_PROGRAM_REPORT_SCHEMA,
    generated_at: (options.now ?? new Date()).toISOString(),
    program: {
      id: options.programId ?? "cross-repository-usage",
      manifest_digest: options.manifestDigest ?? null,
      coordinator_project_id: options.coordinatorProjectId ?? null
    },
    status: qualified ? "qualified-observation" : "not-qualified",
    qualification: {
      required_completed_work_items: requiredWorkItems,
      qualified_completed_work_items: distinctIds.length,
      qualified_completed_work_item_ids: distinctIds,
      required_task_shapes: 2,
      qualified_task_shapes: shapes.length,
      qualified_task_shape_ids: shapes,
      threshold_met: qualified
    },
    participants: participantReports,
    qualified_samples: samples.sort((left, right) => left.id.localeCompare(right.id)),
    totals: {
      ...totals,
      cached_input_ratio: totals.input_tokens !== null && totals.cached_input_tokens !== null && totals.input_tokens + totals.cached_input_tokens > 0
        ? totals.cached_input_tokens / (totals.input_tokens + totals.cached_input_tokens)
        : null,
      monetary_cost: null,
      price_source: null,
      cost_status: "unknown"
    },
    issues: sortedUnique(issues),
    claims: {
      savings_claim_allowed: false,
      cost_claim_allowed: false,
      model_quality_claim_allowed: false,
      routing_claim_allowed: false,
      enterprise_readiness_claim_allowed: false,
      automatic_routing: false
    },
    authority: {
      lifecycle_authority: "participant-repositories",
      participant_lifecycle_mutations_performed: false,
      release_authority_granted: false
    },
    privacy: {
      raw_prompts_retained: false,
      hidden_reasoning_retained: false,
      credentials_retained: false
    },
    canonical_state_changed: false,
    external_action_performed: false
  };
}

export async function buildCrossRepositoryUsageReport(coordinatorRoot, options = {}) {
  const resolved = await resolveValidationProgram(coordinatorRoot, options);
  const participants = [];
  for (const participant of resolved.participants) {
    const baseline = await buildUsageBaseline(participant.root, {
      stateDirectory: participant.resolved_usage_state_directory,
      write: false
    });
    const repository = await inspectGitRepository(participant.root);
    participants.push({ project_id: participant.project.id, revision: repository.revision, baseline });
  }
  return buildCrossRepositoryUsageReportFromBaselines(participants, {
    programId: resolved.manifest.id,
    manifestDigest: resolved.manifest_digest,
    coordinatorProjectId: resolved.manifest.coordinator_project_id,
    requiredWorkItems: options.requiredWorkItems,
    now: options.now
  });
}
