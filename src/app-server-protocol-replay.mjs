export const WAVE5_COMPLETION_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["changed_paths", "test_command", "test_result", "assumptions", "remaining_risks"],
  properties: {
    changed_paths: { type: "array", items: { type: "string" } },
    test_command: { type: "string" },
    test_result: { type: "string" },
    assumptions: { type: "array", items: { type: "string" } },
    remaining_risks: { type: "array", items: { type: "string" } }
  }
});

export const WAVE5_ALLOWED_COMMAND_PREFIXES = Object.freeze([
  Object.freeze(["rg"]),
  Object.freeze(["sed"]),
  Object.freeze(["node"]),
  Object.freeze(["npm", "test"]),
  Object.freeze(["git", "status"]),
  Object.freeze(["git", "diff"])
]);

export const WAVE5_INHERITED_CODEX_ENVIRONMENT_KEYS = Object.freeze([
  "CODEX_APP_TOOLS_PIPE_PATH",
  "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
  "CODEX_SESSION_ID",
  "CODEX_THREAD_ID"
]);

export function isolateWave5CodexEnvironment(source = {}) {
  const environment = { ...source };
  for (const key of WAVE5_INHERITED_CODEX_ENVIRONMENT_KEYS) delete environment[key];
  return environment;
}

export function wave5ThreadIsolation(root) {
  return {
    baseInstructions: "You are a bounded coding worker. Follow the developer instructions and user task, use only available local tools, and return the requested structured completion record.",
    allowProviderModelFallback: false,
    ephemeral: true
  };
}

const runtimePermissionMethods = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval"
]);

function prefixText(prefix) {
  if (Array.isArray(prefix) && prefix.length > 0 && prefix.every((part) => typeof part === "string" && part.length > 0)) {
    return prefix.join(" ");
  }
  return typeof prefix === "string" && prefix.length > 0 ? prefix : null;
}

function messageTurnId(message) {
  return message?.params?.turnId ?? message?.params?.turn?.id ?? null;
}

function matchesTurn(message, turnId) {
  const observed = messageTurnId(message);
  return observed === null || turnId === null || observed === turnId;
}

function bounded(value, limit = 120) {
  return String(value ?? "").slice(0, limit);
}

function containsExecutableShellControl(value) {
  let quote = null;
  let escaped = false;
  for (const character of value) {
    if (character.charCodeAt(0) < 0x20) return true;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === "single") {
      if (character === "'") quote = null;
      continue;
    }
    if (quote === "double") {
      if (character === '"') quote = null;
      else if (character === "\\") escaped = true;
      else if (character === "$" || character === "`") return true;
      continue;
    }
    if (character === "'") quote = "single";
    else if (character === '"') quote = "double";
    else if (character === "\\") escaped = true;
    else if (";&|<>$`".includes(character)) return true;
  }
  return quote !== null || escaped;
}

export function commandTextAllowed(value, allowedPrefixes = WAVE5_ALLOWED_COMMAND_PREFIXES) {
  if (typeof value !== "string" || value.length === 0 || containsExecutableShellControl(value)) return false;
  const trimmed = value.trim();
  return allowedPrefixes
    .map(prefixText)
    .filter(Boolean)
    .some((prefix) => trimmed === prefix || trimmed.startsWith(`${prefix} `));
}

export function commandItemAllowed(item, allowedPrefixes = WAVE5_ALLOWED_COMMAND_PREFIXES) {
  if (item?.type !== "commandExecution" || !Array.isArray(item.commandActions) || item.commandActions.length === 0) return false;
  if (item.commandActions.length > 32) return false;
  return item.commandActions.every((action) =>
    action !== null &&
    typeof action === "object" &&
    commandTextAllowed(action.command, allowedPrefixes)
  );
}

export function normalizeTokenUsage(params) {
  const total = params?.tokenUsage?.total;
  if (!total || !Number.isSafeInteger(total.totalTokens) || total.totalTokens < 0) return null;
  const fields = {
    input_tokens: total.inputTokens,
    cached_input_tokens: total.cachedInputTokens,
    output_tokens: total.outputTokens,
    reasoning_output_tokens: total.reasoningOutputTokens,
    total_tokens: total.totalTokens
  };
  for (const value of Object.values(fields)) {
    if (!Number.isSafeInteger(value) || value < 0) return null;
  }
  return fields;
}

export function terminalFailure(turn) {
  if (turn?.status === "completed") return null;
  const errorText = JSON.stringify(turn?.error ?? {});
  if (errorText.includes("invalid_json_schema")) {
    return {
      code: "provider-invalid-output-schema",
      message: "provider rejected the structured-output schema before generation"
    };
  }
  return {
    code: "turn-not-completed",
    message: `turn terminal status ${turn?.status ?? "missing"}`
  };
}

export function parseStructuredCompletion(text) {
  if (typeof text !== "string") throw new Error("structured completion message missing");
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const value = JSON.parse(trimmed);
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("structured completion must be an object");
  const keys = Object.keys(value).sort();
  const expected = [...WAVE5_COMPLETION_SCHEMA.required].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error("structured completion fields are invalid");
  }
  for (const key of ["changed_paths", "assumptions", "remaining_risks"]) {
    if (!Array.isArray(value[key]) || !value[key].every((entry) => typeof entry === "string")) {
      throw new Error(`structured completion ${key} is invalid`);
    }
  }
  if (typeof value.test_command !== "string" || typeof value.test_result !== "string") {
    throw new Error("structured completion test fields are invalid");
  }
  return value;
}

export function protocolViolationForMessage(message, options = {}) {
  const turnId = options.turnId ?? null;
  if (!matchesTurn(message, turnId)) return null;
  const direction = options.direction ?? "notification";
  if (direction === "request") {
    return {
      code: "runtime-request",
      message: runtimePermissionMethods.has(message?.method)
        ? `runtime permission request: ${message.method}`
        : `unsupported runtime request: ${bounded(message?.method)}`
    };
  }
  if (message?.method === "model/rerouted") {
    return { code: "model-rerouted", message: "model rerouted during the bounded turn" };
  }
  if (message?.method === "item/started" && message?.params?.item?.type === "commandExecution") {
    if (!commandItemAllowed(message.params.item, options.allowedCommandPrefixes)) {
      return {
        code: "command-policy-violation",
        message: `command policy rejected: ${bounded(message.params.item.command)}`
      };
    }
  }
  return null;
}

export function replayAppServerProtocol({ turn_id: turnId, allowed_command_prefixes: allowedPrefixes, events }) {
  if (typeof turnId !== "string" || turnId.length === 0) throw new Error("turn_id is required");
  if (!Array.isArray(events)) throw new Error("events must be an array");
  let latestUsage = null;
  let terminal = null;
  let completionText = null;
  let violation = null;

  for (const envelope of events) {
    const message = envelope?.message ?? envelope;
    const direction = envelope?.direction ?? "notification";
    if (!matchesTurn(message, turnId)) continue;
    violation ??= protocolViolationForMessage(message, {
      turnId,
      direction,
      allowedCommandPrefixes: allowedPrefixes
    });
    if (direction !== "notification") continue;
    if (message?.method === "thread/tokenUsage/updated") {
      const usage = normalizeTokenUsage(message.params);
      if (usage) latestUsage = usage;
    }
    if (message?.method === "item/completed" && message?.params?.item?.type === "agentMessage") {
      completionText = message.params.item.text;
    }
    if (message?.method === "turn/completed") terminal = message.params?.turn ?? null;
  }

  if (violation) return { status: "stopped", stop: violation, usage: latestUsage, completion: null };
  const failure = terminalFailure(terminal);
  if (failure) return { status: "stopped", stop: failure, usage: latestUsage, completion: null };
  if (!latestUsage) {
    return { status: "stopped", stop: { code: "usage-missing", message: "detailed Token usage is missing" }, usage: null, completion: null };
  }
  try {
    const completion = parseStructuredCompletion(completionText);
    return { status: "completed", stop: null, usage: latestUsage, completion };
  } catch (error) {
    return {
      status: "stopped",
      stop: { code: "structured-completion-invalid", message: bounded(error.message) },
      usage: latestUsage,
      completion: null
    };
  }
}
