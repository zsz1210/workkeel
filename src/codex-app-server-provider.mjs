import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import path from "node:path";
import { TEMPLATE_VERSION } from "./constants.mjs";
import { readJson, sha256 } from "./files.mjs";
import { withProjectMutationLock } from "./project.mjs";
import { registerTask, updateTask } from "./tasks.mjs";
import { listWorkItemDocuments } from "./work-items.mjs";
import { isLegacyConcludedItem } from "./workflow.mjs";
import {
  PROVIDER_CAPABILITIES,
  PROVIDER_CONTRACT_SCHEMA
} from "./control-plane-providers.mjs";

export const CODEX_APP_SERVER_PROTOCOL_PROFILE = "codex-app-server-v2-observer-2026-08-30";
export const CODEX_APP_SERVER_SOURCE = "urn:temple:provider:codex-app-server:local";
export const DEFAULT_CODEX_HISTORY_TURN_LIMIT = 20;
export const DEFAULT_CODEX_HISTORY_ITEM_LIMIT = 200;
export const CODEX_LIVE_TASK_STATUSES = ["active", "waiting", "attention"];
export const CODEX_TERMINAL_TASK_STATUSES = ["completed", "archived"];
export const CODEX_TERMINAL_WORK_ITEM_STATES = ["done", "concluded", "cancelled"];
export const CODEX_AGENT_COMMAND_OPERATIONS = ["new-turn", "steer", "interrupt"];
export const CODEX_PROVIDER_OWNED_INSTRUCTION_LIMIT = 4000;
export const CODEX_PROVIDER_OWNED_APPROVAL_POLICIES = ["never", "onRequest", "unlessTrusted"];
export const CODEX_PROVIDER_OWNED_SANDBOX_MODES = ["readOnly", "workspaceWrite"];
export const CODEX_PROVIDER_OWNED_REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"];
export const CODEX_ATTACH_OUTCOMES = ["detached", "pending", "history-only", "live-attached", "degraded"];
export const CODEX_ATTACH_REASON_CODES = [
  "archived-task",
  "live-resume-disabled",
  "live-resume-not-eligible",
  "thread-read-empty",
  "thread-read-invalid",
  "thread-read-unsupported",
  "thread-read-unavailable",
  "thread-resume-invalid",
  "thread-resume-unsupported",
  "thread-resume-unavailable",
  "thread-not-in-app-server-store"
];

export class CodexAgentCommandError extends Error {
  constructor(message, statusCode = 409, reasonCode = "agent-command-precondition") {
    super(message);
    this.name = "CodexAgentCommandError";
    this.statusCode = statusCode;
    this.reasonCode = reasonCode;
    this.providerBoundaryCrossed = false;
  }
}

export class CodexProviderOwnedLaunchError extends Error {
  constructor(message, reasonCode, details = {}) {
    super(message);
    this.name = "CodexProviderOwnedLaunchError";
    this.reasonCode = reasonCode;
    this.providerThreadId = details.providerThreadId ?? null;
    this.taskId = details.taskId ?? null;
    this.providerRpcCode = Number.isInteger(details.providerRpcCode) ? details.providerRpcCode : null;
    this.rejectionCategory = details.rejectionCategory ?? null;
    this.turnStarted = details.turnStarted === true;
    this.automaticRetry = false;
    this.instructionRetained = false;
  }
}

const PROVIDER_OWNED_APPROVAL_WIRE_VALUES = Object.freeze({
  never: "never",
  onRequest: "on-request",
  unlessTrusted: "untrusted"
});

const PROVIDER_OWNED_SANDBOX_WIRE_VALUES = Object.freeze({
  readOnly: "read-only",
  workspaceWrite: "workspace-write"
});

const LIVE_TASK_STATUS_SET = new Set(CODEX_LIVE_TASK_STATUSES);
const TERMINAL_TASK_STATUS_SET = new Set(CODEX_TERMINAL_TASK_STATUSES);
const TERMINAL_WORK_ITEM_STATE_SET = new Set(CODEX_TERMINAL_WORK_ITEM_STATES);

const NOTIFICATION_TYPES = new Map([
  ["thread/started", "org.temple.codex.thread.started.v1"],
  ["thread/status/changed", "org.temple.codex.thread.status.v1"],
  ["turn/started", "org.temple.codex.turn.started.v1"],
  ["turn/completed", "org.temple.codex.turn.completed.v1"],
  ["item/started", "org.temple.codex.item.started.v1"],
  ["item/completed", "org.temple.codex.item.completed.v1"],
  ["turn/plan/updated", "org.temple.codex.plan.updated.v1"],
  ["turn/diff/updated", "org.temple.codex.diff.updated.v1"],
  ["model/rerouted", "org.temple.codex.model.rerouted.v1"],
  ["thread/tokenUsage/updated", "org.temple.codex.usage.updated.v1"],
  ["serverRequest/resolved", "org.temple.codex.runtime-request.resolved.v1"],
  ["error", "org.temple.codex.failure.observed.v1"]
]);

const REQUEST_CLASSES = new Map([
  ["item/commandExecution/requestApproval", "runtime-permission"],
  ["item/fileChange/requestApproval", "runtime-permission"],
  ["item/permissions/requestApproval", "runtime-permission"],
  ["item/tool/requestUserInput", "business-fact"]
]);

function capabilities(overrides = {}) {
  return Object.fromEntries(
    PROVIDER_CAPABILITIES.map((capability) => [capability, overrides[capability] ?? "unsupported"])
  );
}

export function codexAppServerProviderContract(options = {}) {
  const status = options.status ?? "offline";
  return {
    schema_version: PROVIDER_CONTRACT_SCHEMA,
    id: options.id ?? "codex-local",
    kind: "codex-app-server",
    version: CODEX_APP_SERVER_PROTOCOL_PROFILE,
    status,
    capabilities: capabilities({
      enumeration: "supported",
      history_snapshot: "supported",
      live_events: "supported",
      plan_summary: "supported",
      diff_summary: "supported",
      token_usage: "supported",
      runtime_approval: "supported",
      thread_launch: "supported",
      thread_resume: "supported"
    }),
    last_observed_at: null,
    degraded_reason: options.degradedReason ?? (status === "ready" ? null : "not connected"),
    protocol: {
      profile: CODEX_APP_SERVER_PROTOCOL_PROFILE,
      detected_cli_version: options.detectedCliVersion ?? null,
      connection_mode: "explicit-opt-in",
      agent_commands: {
        support: "supported",
        methods: ["turn/start", "turn/steer", "turn/interrupt"],
        existing_registered_threads_only: true,
        loopback_only: true,
        automatic_retry: false
      },
      provider_owned_launch: {
        support: "supported",
        methods: ["thread/start", "turn/start"],
        canonical_registration_before_turn: true,
        loopback_only: true,
        automatic_retry: false,
        instruction_retained: false
      }
    }
  };
}

function boundedText(value, limit = 240) {
  if (typeof value !== "string") return null;
  const normalized = value.replaceAll(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

function requiredLaunchText(value, label, maximum = 160) {
  if (typeof value !== "string") throw new CodexProviderOwnedLaunchError(`${label} is required`, "launch-request-invalid");
  const normalized = value.trim();
  if (!normalized || normalized.includes("\0") || normalized.length > maximum) {
    throw new CodexProviderOwnedLaunchError(
      `${label} must be a non-empty string of at most ${maximum} characters`,
      "launch-request-invalid"
    );
  }
  return normalized;
}

function optionalLaunchText(value, label, maximum = 160) {
  if (value === undefined || value === null || value === "") return null;
  return requiredLaunchText(value, label, maximum);
}

function providerOwnedLaunchRequest(request, target) {
  const approvalPolicy = requiredLaunchText(request?.approvalPolicy, "Approval policy", 40);
  if (!CODEX_PROVIDER_OWNED_APPROVAL_POLICIES.includes(approvalPolicy)) {
    throw new CodexProviderOwnedLaunchError("Approval policy is unsupported", "launch-request-invalid");
  }
  const sandboxMode = requiredLaunchText(request?.sandboxMode, "Sandbox mode", 40);
  if (!CODEX_PROVIDER_OWNED_SANDBOX_MODES.includes(sandboxMode)) {
    throw new CodexProviderOwnedLaunchError("Sandbox mode is unsupported", "launch-request-invalid");
  }
  if (request?.networkAccess !== undefined && typeof request.networkAccess !== "boolean") {
    throw new CodexProviderOwnedLaunchError("Network access must be boolean", "launch-request-invalid");
  }
  const instruction = requiredLaunchText(
    request?.instruction,
    "Instruction",
    CODEX_PROVIDER_OWNED_INSTRUCTION_LIMIT
  );
  const requestedModel = requiredLaunchText(request?.requestedModel, "Requested model");
  const reasoningEffort = optionalLaunchText(request?.reasoningEffort, "Reasoning effort", 80);
  if (reasoningEffort && !CODEX_PROVIDER_OWNED_REASONING_EFFORTS.includes(reasoningEffort)) {
    throw new CodexProviderOwnedLaunchError("Reasoning effort is unsupported", "launch-request-invalid");
  }
  const launchRevision = requiredLaunchText(request?.launchRevision, "Launch revision", 240);
  return {
    workItemId: requiredLaunchText(request?.workItemId, "Work Item ID", 80),
    positionId: requiredLaunchText(request?.positionId, "Position ID", 80),
    actor: requiredLaunchText(request?.actor, "Actor", 160),
    instruction,
    instructionLength: instruction.length,
    requestedModel,
    reasoningEffort,
    launchRevision,
    approvalPolicy,
    sandboxMode,
    networkAccess: request?.networkAccess === true,
    cwd: target
  };
}

export function codexProviderOwnedWirePolicy(request) {
  const approvalPolicy = PROVIDER_OWNED_APPROVAL_WIRE_VALUES[request?.approvalPolicy];
  const threadSandboxMode = PROVIDER_OWNED_SANDBOX_WIRE_VALUES[request?.sandboxMode];
  if (!approvalPolicy || !threadSandboxMode) {
    throw new CodexProviderOwnedLaunchError(
      "Provider-owned policy has no verified App Server wire mapping",
      "launch-request-invalid"
    );
  }
  const turnSandboxPolicy = request.sandboxMode === "readOnly"
    ? { type: "readOnly", networkAccess: false }
    : {
        type: "workspaceWrite",
        writableRoots: [request.cwd],
        networkAccess: request.networkAccess === true
      };
  return {
    approvalPolicy,
    threadSandboxMode,
    turnSandboxPolicy
  };
}

export function classifyCodexProviderRejection(error) {
  const providerRpcCode = Number.isInteger(error?.rpcCode) ? error.rpcCode : null;
  if (providerRpcCode === -32600 || providerRpcCode === -32602) {
    return { providerRpcCode, rejectionCategory: "invalid-request" };
  }
  if (providerRpcCode === -32601) {
    return { providerRpcCode, rejectionCategory: "method-unsupported" };
  }
  if (providerRpcCode !== null) {
    return { providerRpcCode, rejectionCategory: "provider-rejected" };
  }
  return { providerRpcCode: null, rejectionCategory: "transport-unavailable" };
}

function timestamp(value, fallback) {
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    if (!Number.isNaN(date.valueOf())) return date.toISOString();
  }
  if (Number.isFinite(value)) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(milliseconds);
    if (!Number.isNaN(date.valueOf())) return date.toISOString();
  }
  return fallback;
}

function taskForThread(tasks, threadId) {
  const matches = (tasks ?? []).filter((task) => task.thread_id === threadId);
  return matches.length === 1 ? matches[0] : null;
}

function terminalWorkItemIds(workItems = []) {
  return new Set(
    workItems
      .filter((item) => TERMINAL_WORK_ITEM_STATE_SET.has(item?.state) || isLegacyConcludedItem(item))
      .map((item) => item.id)
  );
}

export function classifyCodexTasks(tasks = [], options = {}) {
  const registered = tasks.filter((task) => typeof task?.thread_id === "string" && task.thread_id.trim());
  const terminalItems = terminalWorkItemIds(options.workItems);
  const terminal = (task) => TERMINAL_TASK_STATUS_SET.has(task.status) || terminalItems.has(task.work_item_id);
  return {
    registered,
    history_reconcilable: registered.filter((task) => task.status !== "archived"),
    live_resumable: registered.filter((task) => LIVE_TASK_STATUS_SET.has(task.status) && !terminal(task)),
    terminal: registered.filter(terminal),
    non_live: registered.filter((task) => !LIVE_TASK_STATUS_SET.has(task.status) && !terminal(task))
  };
}

export function shouldResumeCodexTask(task, options = {}) {
  return classifyCodexTasks([task], options).live_resumable.length === 1;
}

export function classifyCodexAttachFailure(error, operation = "thread/resume") {
  const prefix = operation === "thread/read" ? "thread-read" : "thread-resume";
  const rpcCode = Number.isInteger(error?.rpcCode) ? error.rpcCode : null;
  const providerReason = String(error?.providerReason ?? error?.message ?? "").toLowerCase();
  if (rpcCode === -32601 || providerReason.includes("method not found") || providerReason.includes("unsupported")) {
    return { reason_code: `${prefix}-unsupported`, retryable: false, provider_wide: true };
  }
  if (rpcCode === -32600 || rpcCode === -32602 || providerReason.includes("invalid request") || providerReason.includes("invalid params")) {
    return { reason_code: `${prefix}-invalid`, retryable: false, provider_wide: false };
  }
  if (
    operation === "thread/resume" &&
    (providerReason.includes("not found") || providerReason.includes("unknown thread") || providerReason.includes("no such thread"))
  ) {
    return { reason_code: "thread-not-in-app-server-store", retryable: false, provider_wide: false };
  }
  return { reason_code: `${prefix}-unavailable`, retryable: true, provider_wide: false };
}

function commonData(projectId, tasks, params) {
  const threadId = params?.threadId ?? params?.thread?.id ?? null;
  const task = taskForThread(tasks, threadId);
  return {
    project_id: projectId,
    work_item_id: task?.work_item_id ?? null,
    task_id: task?.id ?? null,
    position_id: task?.position_id ?? null,
    agent_id: task?.agent_id ?? null,
    runtime_worker_id: task?.worker_id ?? null,
    provider_thread_id: threadId,
    provider_turn_id: params?.turnId ?? params?.turn?.id ?? null,
    provider_item_id: params?.itemId ?? params?.item?.id ?? null,
    scope_revision: task?.launch_revision ?? task?.current_revision ?? null,
    correlation: task ? "registered" : "unregistered"
  };
}

function subject(projectId, data) {
  return data.work_item_id
    ? `project/${projectId}/work-item/${data.work_item_id}`
    : `project/${projectId}`;
}

function safePlan(plan) {
  return (Array.isArray(plan) ? plan : []).slice(0, 50).map((step) => ({
    status: boundedText(step?.status, 40) ?? "unknown",
    step: boundedText(step?.step, 240) ?? "Unlabelled step"
  }));
}

export function summarizeUnifiedDiff(diff) {
  const files = new Set();
  let additions = 0;
  let deletions = 0;
  let hunks = 0;
  for (const line of String(diff ?? "").split(/\r?\n/)) {
    if (line.startsWith("+++ ")) {
      const value = line.slice(4).trim().replace(/^b\//, "");
      if (value && value !== "/dev/null") files.add(boundedText(value, 240));
    } else if (line.startsWith("@@")) hunks += 1;
    else if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return {
    files: [...files].filter(Boolean).slice(0, 100),
    file_count: files.size,
    additions,
    deletions,
    hunks,
    raw_diff_retained: false
  };
}

function safeItem(item, lifecycle) {
  const changes = Array.isArray(item?.changes) ? item.changes : [];
  const paths = changes
    .map((change) => boundedText(change?.path ?? change?.filePath, 240))
    .filter(Boolean)
    .slice(0, 100);
  return {
    item_type: boundedText(item?.type, 80) ?? "unknown",
    item_status: boundedText(item?.status, 80) ?? lifecycle,
    lifecycle,
    terminal: lifecycle === "completed",
    exit_code: Number.isInteger(item?.exitCode) ? item.exitCode : null,
    changed_files: paths,
    change_count: changes.length,
    raw_content_retained: false
  };
}

function safeUsage(tokenUsage) {
  const total = tokenUsage?.total ?? {};
  const last = tokenUsage?.last ?? {};
  const number = (value) => (Number.isFinite(value) && value >= 0 ? value : null);
  return {
    total: {
      input_tokens: number(total.inputTokens),
      cached_input_tokens: number(total.cachedInputTokens),
      output_tokens: number(total.outputTokens),
      reasoning_output_tokens: number(total.reasoningOutputTokens),
      total_tokens: number(total.totalTokens)
    },
    last: {
      input_tokens: number(last.inputTokens),
      cached_input_tokens: number(last.cachedInputTokens),
      output_tokens: number(last.outputTokens),
      reasoning_output_tokens: number(last.reasoningOutputTokens),
      total_tokens: number(last.totalTokens)
    },
    model_context_window: Number.isFinite(tokenUsage?.modelContextWindow) ? tokenUsage.modelContextWindow : null,
    monetary_cost: null,
    price_source: null
  };
}

function optionalDimension(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return boundedText(value, 160);
  }
  return null;
}

function usageOutcome(workItem) {
  if (!workItem) return "unknown";
  if (workItem.lifecycle_outcome === "accepted") return "accepted";
  if (["no-go", "inconclusive"].includes(workItem.lifecycle_outcome)) return workItem.lifecycle_outcome;
  if (workItem.lifecycle_outcome === "cancelled") return "abandoned";
  if (workItem.state === "done") return "accepted";
  if (workItem.state === "concluded" || isLegacyConcludedItem(workItem)) return "no-go";
  if (workItem.state === "cancelled") return "abandoned";
  if (workItem.state === "blocked") return "blocked";
  return "in-progress";
}

function safeUsageAttribution(data, task, workItem, params, tokenUsage, options) {
  const providerModel = optionalDimension(params?.model, params?.effectiveModel, tokenUsage?.model, tokenUsage?.effectiveModel);
  const model = providerModel ?? optionalDimension(task?.effective_model, task?.requested_model);
  const requestedReasoningEffort = optionalDimension(task?.requested_reasoning_effort);
  const observedThreadReasoningEffort = optionalDimension(task?.observed_thread_reasoning_effort);
  const effectiveTurnReasoningEffort = optionalDimension(
    params?.effectiveTurnReasoningEffort,
    tokenUsage?.effectiveTurnReasoningEffort,
    task?.effective_turn_reasoning_effort
  );
  const compatibilityReasoningEffort = effectiveTurnReasoningEffort
    ?? observedThreadReasoningEffort
    ?? requestedReasoningEffort
    ?? optionalDimension(task?.reasoning_effort);
  const reasoningEffortSource = effectiveTurnReasoningEffort
    ? "provider-turn"
    : observedThreadReasoningEffort
      ? "provider-thread"
      : requestedReasoningEffort
        ? "canonical-requested"
        : optionalDimension(task?.reasoning_effort_source) ?? "unknown";
  const attribution = {
    project_id: data.project_id,
    work_item_id: data.work_item_id,
    position_id: task?.position_id ?? null,
    lifecycle_stage: workItem?.state ?? "unknown",
    lifecycle_stage_source: options.reconciliation === true ? "current-canonical-at-reconciliation" : "current-canonical-at-observation",
    task_id: task?.id ?? null,
    provider_thread_id: data.provider_thread_id,
    attempt_id: data.provider_turn_id,
    retry_of_attempt_id: optionalDimension(params?.retryOfTurnId, params?.retryOfAttemptId),
    provider_id: task?.provider_id ?? options.providerId ?? "codex-local",
    model,
    model_source: providerModel
      ? "provider-event"
      : task?.effective_model
        ? "canonical-effective"
        : task?.requested_model
          ? "canonical-requested"
          : "unknown",
    model_version: optionalDimension(params?.modelVersion, params?.effectiveModelVersion, tokenUsage?.modelVersion),
    requested_reasoning_effort: requestedReasoningEffort,
    observed_thread_reasoning_effort: observedThreadReasoningEffort,
    effective_turn_reasoning_effort: effectiveTurnReasoningEffort,
    reasoning_effort: compatibilityReasoningEffort,
    reasoning_effort_source: reasoningEffortSource,
    service_tier: optionalDimension(params?.serviceTier, tokenUsage?.serviceTier, task?.service_tier),
    context_capsule_digest: optionalDimension(params?.contextCapsuleDigest, task?.context_capsule_digest),
    capability_set_digest: optionalDimension(params?.capabilitySetDigest, task?.capability_set_digest),
    source: "provider-reported",
    quality: "exact",
    outcome: usageOutcome(workItem)
  };
  const required = [
    "work_item_id",
    "position_id",
    "lifecycle_stage",
    "task_id",
    "attempt_id",
    "provider_id",
    "model",
    "model_version",
    "reasoning_effort",
    "service_tier",
    "context_capsule_digest",
    "capability_set_digest",
    "outcome"
  ];
  attribution.missing_dimensions = required.filter((field) => attribution[field] === null || attribution[field] === "unknown");
  attribution.quality = attribution.missing_dimensions.length === 0 ? "exact" : "partial";
  return attribution;
}

function safeRuntimeRequest(method, requestId, params) {
  return {
    request_id: String(requestId),
    request_method: method,
    request_class: REQUEST_CLASSES.get(method),
    status: "pending",
    answerable: true,
    started_at: timestamp(params?.startedAtMs, null),
    reason: boundedText(params?.reason),
    command_present: typeof params?.command === "string" && params.command.length > 0,
    question_count: Array.isArray(params?.questions) ? params.questions.length : 0,
    available_decisions: (params?.availableDecisions ?? []).slice(0, 20).map((entry) =>
      boundedText(typeof entry === "string" ? entry : entry?.decision ?? entry?.type, 80)
    ).filter(Boolean),
    raw_request_retained: false
  };
}

function safeRequestView(eventData, params) {
  return {
    ...eventData,
    questions: (params?.questions ?? []).slice(0, 20).map((question) => ({
      id: boundedText(question?.id, 120),
      header: boundedText(question?.header, 120),
      question: boundedText(question?.question, 500),
      is_secret: question?.isSecret === true,
      options: (question?.options ?? []).slice(0, 20).map((option) => ({
        label: boundedText(option?.label, 160),
        description: boundedText(option?.description, 300)
      }))
    })).filter((question) => question.id && question.question)
  };
}

export function buildCodexRuntimeRequestResponse(method, params, action) {
  const request = { method, params };
  if (request.method === "item/commandExecution/requestApproval" || request.method === "item/fileChange/requestApproval") {
    const decision = String(action?.decision ?? "");
    const allowed = new Set(["accept", "acceptForSession", "decline", "cancel"]);
    if (!allowed.has(decision)) throw new Error(`Unsupported runtime decision: ${decision || "missing"}`);
    if (
      request.params?.availableDecisions?.length &&
      !request.params.availableDecisions.some((entry) => (typeof entry === "string" ? entry : entry?.type) === decision)
    ) {
      throw new Error(`Runtime provider did not offer decision ${decision}`);
    }
    return { decision };
  }
  if (request.method === "item/permissions/requestApproval") {
    const decision = String(action?.decision ?? "");
    if (!new Set(["accept", "decline"]).has(decision)) throw new Error("Permission requests accept only accept or decline");
    return {
      permissions: decision === "accept" ? structuredClone(request.params?.permissions ?? {}) : {},
      scope: "turn"
    };
  }
  if (request.method === "item/tool/requestUserInput") {
    const answers = action?.answers;
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) throw new Error("Business response answers are required");
    const questions = request.params?.questions ?? [];
    const expectedIds = new Set(questions.map((question) => question.id));
    if (Object.keys(answers).some((id) => !expectedIds.has(id)) || [...expectedIds].some((id) => !Object.hasOwn(answers, id))) {
      throw new Error("Business response must answer every current question exactly once");
    }
    const normalized = {};
    for (const question of questions) {
      const values = answers[question.id];
      if (!Array.isArray(values) || values.length === 0 || values.length > 20) throw new Error(`Question ${question.id} requires one or more answers`);
      normalized[question.id] = {
        answers: values.map((value) => {
          const bounded = boundedText(String(value), 1000);
          if (!bounded) throw new Error(`Question ${question.id} contains an empty answer`);
          return bounded;
        })
      };
    }
    return { answers: normalized };
  }
  throw new Error(`Unsupported live runtime request method: ${request.method}`);
}

function eventId(method, data, occurredAt) {
  const identity = [
    CODEX_APP_SERVER_PROTOCOL_PROFILE,
    method,
    data.provider_thread_id,
    data.provider_turn_id,
    data.provider_item_id,
    data.request_id,
    data.status,
    data.lifecycle,
    data.plan,
    data.diff_summary,
    data.from_model,
    data.to_model,
    data.reason,
    data.usage,
    occurredAt
  ];
  return `${method.replaceAll(/[^a-zA-Z0-9]+/g, "-")}-${sha256(JSON.stringify(identity)).slice(0, 32)}`;
}

export function normalizeCodexMessage(projectId, tasks, message, options = {}) {
  const observedAt = options.observedAt ?? new Date().toISOString();
  const method = message?.method;
  const params = message?.params ?? {};
  const notificationType = NOTIFICATION_TYPES.get(method);
  const requestClass = REQUEST_CLASSES.get(method);
  if (!notificationType && !requestClass) return null;
  const data = commonData(projectId, tasks, params);
  const task = taskForThread(tasks, data.provider_thread_id);
  const workItem = (options.workItems ?? []).find((item) => item.id === data.work_item_id) ?? null;
  let type = notificationType;
  let occurredAt = timestamp(message?.emittedAtMs ?? params?.emittedAtMs, observedAt);

  if (method === "thread/started") {
    data.status = params.thread?.status?.type ?? "unknown";
    data.provider_thread_id = params.thread?.id ?? null;
  } else if (method === "thread/status/changed") {
    data.status = params.status?.type ?? "unknown";
    data.active_flags = Array.isArray(params.status?.activeFlags) ? params.status.activeFlags.slice(0, 20) : [];
  } else if (method === "turn/started") {
    data.status = params.turn?.status ?? "inProgress";
    occurredAt = timestamp(params.turn?.startedAt, occurredAt);
  } else if (method === "turn/completed") {
    data.status = params.turn?.status ?? "unknown";
    data.duration_ms = Number.isFinite(params.turn?.durationMs) ? params.turn.durationMs : null;
    data.error_code = boundedText(params.turn?.error?.code ?? params.turn?.error?.type, 120);
    occurredAt = timestamp(params.turn?.completedAt, occurredAt);
  } else if (method === "item/started" || method === "item/completed") {
    Object.assign(data, safeItem(params.item, method.endsWith("completed") ? "completed" : "started"));
    occurredAt = timestamp(method.endsWith("completed") ? params.completedAtMs : params.startedAtMs, occurredAt);
  } else if (method === "turn/plan/updated") {
    data.status = "updated";
    data.plan = safePlan(params.plan);
    data.explanation_retained = false;
  } else if (method === "turn/diff/updated") {
    data.status = "updated";
    data.diff_summary = summarizeUnifiedDiff(params.diff);
  } else if (method === "model/rerouted") {
    data.status = "rerouted";
    data.from_model = optionalDimension(params.fromModel);
    data.to_model = optionalDimension(params.toModel);
    data.reason = boundedText(params.reason, 120);
  } else if (method === "thread/tokenUsage/updated") {
    data.status = "updated";
    data.usage = safeUsage(params.tokenUsage);
    data.attribution = safeUsageAttribution(data, task, workItem, params, params.tokenUsage, options);
  } else if (method === "serverRequest/resolved") {
    data.request_id = String(params.requestId);
    data.status = "resolved";
    data.answerable = false;
  } else if (method === "error") {
    data.status = "failed";
    data.error_code = boundedText(params?.error?.code ?? params?.code ?? "provider-error", 120);
  } else if (requestClass) {
    type = "org.temple.codex.runtime-request.pending.v1";
    Object.assign(data, safeRuntimeRequest(method, message.id, params));
    occurredAt = timestamp(params.startedAtMs, occurredAt);
  }

  if (task) {
    data.work_item_id = task.work_item_id;
    data.task_id = task.id;
    data.runtime_worker_id = task.worker_id ?? null;
    data.scope_revision = task.launch_revision ?? task.current_revision ?? null;
    data.correlation = "registered";
  }
  return {
    specversion: "1.0",
    id: eventId(method, data, occurredAt),
    source: CODEX_APP_SERVER_SOURCE,
    type,
    subject: subject(projectId, data),
    time: occurredAt,
    data
  };
}

function validatedHistoryLimit(value, fallback, maximum, name) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  }
  return resolved;
}

function boundedSnapshotWindow(thread, options = {}) {
  const turnLimit = validatedHistoryLimit(
    options.historyTurnLimit,
    DEFAULT_CODEX_HISTORY_TURN_LIMIT,
    100,
    "Codex history turn limit"
  );
  const itemLimit = validatedHistoryLimit(
    options.historyItemLimit,
    DEFAULT_CODEX_HISTORY_ITEM_LIMIT,
    1000,
    "Codex history item limit"
  );
  const availableTurns = Array.isArray(thread?.turns) ? thread.turns : [];
  const retainedTurns = availableTurns.slice(-turnLimit);
  const boundedTurns = new Array(retainedTurns.length);
  let remainingItems = itemLimit;
  for (let index = retainedTurns.length - 1; index >= 0; index -= 1) {
    const turn = retainedTurns[index];
    const availableItems = Array.isArray(turn?.items) ? turn.items : [];
    const retainedItems = remainingItems > 0 ? availableItems.slice(-remainingItems) : [];
    remainingItems -= retainedItems.length;
    boundedTurns[index] = { ...turn, items: retainedItems };
  }
  const availableItemCount = availableTurns.reduce(
    (total, turn) => total + (Array.isArray(turn?.items) ? turn.items.length : 0),
    0
  );
  const retainedItemCount = boundedTurns.reduce((total, turn) => total + turn.items.length, 0);
  return {
    turns: boundedTurns,
    metadata: {
      turn_limit: turnLimit,
      item_limit: itemLimit,
      available_turns: availableTurns.length,
      retained_turns: boundedTurns.length,
      available_items: availableItemCount,
      retained_items: retainedItemCount,
      truncated: availableTurns.length > boundedTurns.length || availableItemCount > retainedItemCount
    }
  };
}

function snapshotMessages(thread, fallbackTime, options = {}) {
  const window = boundedSnapshotWindow(thread, options);
  const output = [{
    method: "thread/status/changed",
    params: { threadId: thread.id, status: thread.status },
    emittedAtMs: fallbackTime
  }];
  for (const turn of window.turns) {
    const method = turn.status === "inProgress" ? "turn/started" : "turn/completed";
    output.push({ method, params: { threadId: thread.id, turn }, emittedAtMs: fallbackTime });
    for (const item of turn.items ?? []) {
      const completed = turn.status !== "inProgress" || ["completed", "failed", "declined"].includes(item?.status);
      const itemTime = completed
        ? item?.completedAtMs ?? item?.completedAt ?? fallbackTime
        : item?.startedAtMs ?? item?.startedAt ?? fallbackTime;
      output.push({
        method: completed ? "item/completed" : "item/started",
        params: {
          threadId: thread.id,
          turnId: turn.id,
          item,
          ...(completed ? { completedAtMs: itemTime } : { startedAtMs: itemTime })
        },
        emittedAtMs: fallbackTime
      });
    }
  }
  return { messages: output, metadata: window.metadata };
}

export function normalizeCodexThreadSnapshot(projectId, tasks, thread, options = {}) {
  const observedAt = options.observedAt ?? new Date().toISOString();
  const task = taskForThread(tasks, thread?.id);
  const snapshotTime = timestamp(thread?.createdAt, timestamp(task?.created_at, observedAt));
  const snapshot = snapshotMessages(thread, snapshotTime, options);
  return snapshot.messages
    .map((message) => normalizeCodexMessage(projectId, tasks, message, {
      observedAt,
      workItems: options.workItems,
      providerId: options.providerId,
      reconciliation: true
    }))
    .filter(Boolean)
    .map((event, index) => {
      const windowState = index === 0 ? snapshot.metadata : null;
      return {
        ...event,
        id: `reconcile-${sha256(JSON.stringify([
          event.type,
          event.data.provider_thread_id,
          event.data.provider_turn_id,
          event.data.provider_item_id,
          event.data.status,
          event.data.lifecycle,
          event.data.item_status,
          event.data.scope_revision,
          event.time,
          windowState
        ])).slice(0, 32)}`,
        data: {
          ...event.data,
          reconciled: true,
          reconciliation_source: options.source ?? "provider-snapshot",
          reconciliation_bounds: {
            turn_limit: snapshot.metadata.turn_limit,
            item_limit: snapshot.metadata.item_limit
          },
          ...(windowState ? { reconciliation_window: windowState } : {})
        }
      };
    });
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
        schema_version: "temple.protocol-diagnostic/v1",
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

export async function startCodexAppServerProvider(target, journal, registry, options = {}) {
  const project = await readJson(path.join(target, ".ai-org/project/project.json"));
  const taskRegistry = await readJson(path.join(target, ".ai-org/project/tasks.json"));
  const workItems = await listWorkItemDocuments(target);
  const taskTopology = classifyCodexTasks(taskRegistry.tasks ?? [], { workItems });
  const tasks = taskTopology.history_reconcilable;
  const providerId = options.providerId ?? "codex-local";
  const taskRegistrar = options.taskRegistrar ?? registerTask;
  const taskUpdater = options.taskUpdater ?? updateTask;
  const command = options.command ?? "codex";
  const commandArgs = options.commandArgs ?? ["app-server", "--stdio"];
  const pendingRuntimeRequests = new Map();
  const historyTurnLimit = validatedHistoryLimit(
    options.historyTurnLimit,
    DEFAULT_CODEX_HISTORY_TURN_LIMIT,
    100,
    "Codex history turn limit"
  );
  const historyItemLimit = validatedHistoryLimit(
    options.historyItemLimit,
    DEFAULT_CODEX_HISTORY_ITEM_LIMIT,
    1000,
    "Codex history item limit"
  );
  const notificationDrainTimeoutMs = validatedHistoryLimit(
    options.notificationDrainTimeoutMs,
    1000,
    30000,
    "Codex notification drain timeout"
  );
  let connection = null;
  let stopped = false;
  let reconnectTimer = null;
  let connecting = null;
  const attachOutcomes = new Map();
  const suppressedReadTasks = new Set();
  const suppressedResumeTasks = new Set();
  const suppressedReadReasons = new Map();
  const suppressedResumeReasons = new Map();
  let readMethodUnavailable = false;
  let resumeMethodUnavailable = false;
  const activeTurnByThread = new Map();
  let notificationQueue = Promise.resolve();

  async function refreshWorkItems() {
    const current = await listWorkItemDocuments(target);
    workItems.splice(0, workItems.length, ...current);
    return current;
  }

  function replaceCorrelatedTask(updated) {
    for (const collection of [taskTopology.registered, tasks, taskTopology.live_resumable]) {
      const index = collection.findIndex((task) => task.id === updated.id);
      if (index >= 0) collection[index] = updated;
    }
  }

  function observeThreadSnapshot(thread) {
    const turns = Array.isArray(thread?.turns) ? thread.turns : [];
    const active = [...turns].reverse().find((turn) => turn?.status === "inProgress" && typeof turn?.id === "string");
    if (active) activeTurnByThread.set(thread.id, active.id);
    else if (typeof thread?.id === "string") activeTurnByThread.delete(thread.id);
  }

  function observeTurnMessage(message) {
    const threadId = message?.params?.threadId ?? message?.params?.thread?.id;
    const turnId = message?.params?.turnId ?? message?.params?.turn?.id;
    if (typeof threadId !== "string" || typeof turnId !== "string") return;
    if (message.method === "turn/started") activeTurnByThread.set(threadId, turnId);
    else if (message.method === "turn/completed" && activeTurnByThread.get(threadId) === turnId) activeTurnByThread.delete(threadId);
  }

  function initialAttachOutcome(task) {
    const archived = task.status === "archived";
    const liveEligible = shouldResumeCodexTask(task, { workItems });
    return {
      task_id: task.id,
      work_item_id: task.work_item_id ?? null,
      provider_thread_id: task.thread_id,
      history_read: archived ? "not-eligible" : "pending",
      live_resume: archived || !liveEligible ? "not-eligible" : options.resumeThreads === false ? "disabled" : "pending",
      attach_outcome: archived ? "detached" : "pending",
      reason_code: archived
        ? "archived-task"
        : !liveEligible
          ? "live-resume-not-eligible"
          : options.resumeThreads === false
            ? "live-resume-disabled"
            : null,
      retry_suppressed: false
    };
  }

  for (const task of taskTopology.registered) attachOutcomes.set(task.id, initialAttachOutcome(task));

  function attachmentOutcomeList() {
    return [...attachOutcomes.values()]
      .map((outcome) => structuredClone(outcome))
      .sort((left, right) => String(left.task_id).localeCompare(String(right.task_id)));
  }

  function attachmentSummary() {
    const outcomes = attachmentOutcomeList();
    return {
      registered_tasks: outcomes.length,
      outcomes: Object.fromEntries(CODEX_ATTACH_OUTCOMES.map((outcome) => [
        outcome,
        outcomes.filter((entry) => entry.attach_outcome === outcome).length
      ])),
      retry_suppressed_tasks: outcomes.filter((outcome) => outcome.retry_suppressed).length,
      tasks: outcomes.slice(0, 100).map((outcome) => ({
        task_id: outcome.task_id,
        history_read: outcome.history_read,
        live_resume: outcome.live_resume,
        attach_outcome: outcome.attach_outcome,
        reason_code: outcome.reason_code,
        retry_suppressed: outcome.retry_suppressed
      })),
      truncated: outcomes.length > 100
    };
  }

  function updateAttachOutcome(task, patch) {
    const current = attachOutcomes.get(task.id) ?? initialAttachOutcome(task);
    attachOutcomes.set(task.id, { ...current, ...patch });
    registry.update(providerId, { attachment: attachmentSummary() });
  }

  async function recordAttachFailure(task, operation, error) {
    const failure = classifyCodexAttachFailure(error, operation);
    const isRead = operation === "thread/read";
    const prior = attachOutcomes.get(task.id);
    if (!failure.retryable) {
      (isRead ? suppressedReadTasks : suppressedResumeTasks).add(task.id);
      (isRead ? suppressedReadReasons : suppressedResumeReasons).set(task.id, failure.reason_code);
    }
    if (failure.provider_wide) {
      if (isRead) readMethodUnavailable = true;
      else resumeMethodUnavailable = true;
    }
    updateAttachOutcome(task, {
      ...(isRead ? { history_read: "failed" } : { live_resume: "failed" }),
      attach_outcome: "degraded",
      reason_code: failure.reason_code,
      retry_suppressed: prior?.retry_suppressed === true || !failure.retryable
    });
    const event = normalizeCodexMessage(project.id, tasks, {
      method: "error",
      params: { threadId: task.thread_id, code: failure.reason_code }
    }, { workItems, providerId });
    await journal.append(event);
    registry.update(providerId, { status: "degraded", degraded_reason: failure.reason_code });
    return failure;
  }

  registry.set({
    ...codexAppServerProviderContract({ id: providerId }),
    attachment: attachmentSummary()
  });

  async function append(message) {
    observeTurnMessage(message);
    if (message?.method === "model/rerouted") {
      const task = taskForThread(tasks, message.params?.threadId);
      const toModel = optionalDimension(message.params?.toModel);
      if (task && toModel) {
        try {
          const updated = await withProjectMutationLock(target, () => taskUpdater(target, {
            taskId: task.id,
            status: task.status,
            effectiveModel: toModel,
            reasoningEffort: task.reasoning_effort,
            serviceTier: task.service_tier,
            actor: task.agent_id
          }));
          replaceCorrelatedTask(updated);
        } catch {
          registry.update(providerId, {
            status: "degraded",
            degraded_reason: "provider-model-reroute-task-update-failed"
          });
        }
      }
    }
    const event = normalizeCodexMessage(project.id, tasks, message, { workItems, providerId });
    if (!event) return null;
    const result = await journal.append(event);
    registry.update(providerId, { last_observed_at: result.record?.templeobservedat ?? new Date().toISOString() });
    return result;
  }

  async function drainNotificationQueue() {
    const deadline = Date.now() + notificationDrainTimeoutMs;
    while (true) {
      const pending = notificationQueue;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        registry.update(providerId, {
          ...(stopped ? {} : { status: "degraded" }),
          degraded_reason: "provider-notification-drain-timeout"
        });
        return false;
      }
      let timer;
      const drained = await Promise.race([
        pending.then(() => true),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), remaining);
        })
      ]);
      if (timer) clearTimeout(timer);
      if (!drained) {
        registry.update(providerId, {
          ...(stopped ? {} : { status: "degraded" }),
          degraded_reason: "provider-notification-drain-timeout"
        });
        return false;
      }
      if (pending === notificationQueue) return true;
    }
  }

  async function reconcile(thread, source) {
    observeThreadSnapshot(thread);
    const events = normalizeCodexThreadSnapshot(project.id, tasks, thread, {
      source,
      historyTurnLimit,
      historyItemLimit,
      workItems,
      providerId
    });
    for (const event of events) await journal.append(event);
    return events.length;
  }

  async function agentCommandTargets() {
    const [currentTaskRegistry, currentWorkItems] = await Promise.all([
      readJson(path.join(target, ".ai-org/project/tasks.json")),
      listWorkItemDocuments(target)
    ]);
    const currentTasks = new Map((currentTaskRegistry.tasks ?? []).map((task) => [task.id, task]));
    const currentItems = new Map(currentWorkItems.map((item) => [item.id, item]));
    const providerStatus = registry.get(providerId)?.status ?? "offline";
    return taskTopology.registered.map((registeredTask) => {
      const task = currentTasks.get(registeredTask.id);
      const item = task ? currentItems.get(task.work_item_id) : null;
      const outcome = attachOutcomes.get(registeredTask.id);
      const activeTurnId = activeTurnByThread.get(registeredTask.thread_id) ?? null;
      let unavailableReason = null;
      if (providerStatus !== "ready") unavailableReason = `provider-${providerStatus}`;
      else if (!task || !item) unavailableReason = "target-not-registered";
      else if (task.thread_id !== registeredTask.thread_id) unavailableReason = "provider-thread-changed";
      else if (task.host_id !== "local") unavailableReason = "target-host-not-local";
      else if (!LIVE_TASK_STATUS_SET.has(task.status)) unavailableReason = "task-not-live";
      else if (TERMINAL_WORK_ITEM_STATE_SET.has(item.state) || isLegacyConcludedItem(item)) unavailableReason = "work-item-terminal";
      else if (outcome?.attach_outcome !== "live-attached") unavailableReason = "provider-thread-not-live-attached";
      const operations = unavailableReason
        ? []
        : activeTurnId
          ? ["steer", "interrupt"]
          : ["new-turn"];
      return {
        task_id: task?.id ?? registeredTask.id,
        work_item_id: task?.work_item_id ?? registeredTask.work_item_id ?? null,
        work_item_title: item?.title ?? null,
        position_id: task?.position_id ?? registeredTask.position_id ?? null,
        agent_id: task?.agent_id ?? registeredTask.agent_id ?? null,
        provider_thread_id: registeredTask.thread_id,
        task_status: task?.status ?? null,
        work_item_state: item?.state ?? null,
        active_turn_id: activeTurnId,
        operations,
        available: unavailableReason === null,
        unavailable_reason: unavailableReason
      };
    }).sort((left, right) => String(left.task_id).localeCompare(String(right.task_id)));
  }

  async function prepareAgentCommand(command) {
    if (!CODEX_AGENT_COMMAND_OPERATIONS.includes(command?.operation)) {
      throw new CodexAgentCommandError("Agent command operation is unsupported", 400, "operation-unsupported");
    }
    if (!connection || registry.get(providerId)?.status !== "ready") {
      throw new CodexAgentCommandError("Codex provider is not ready for Agent commands", 409, "provider-not-ready");
    }
    const targetView = (await agentCommandTargets()).find((entry) => entry.task_id === command.task_id);
    if (!targetView || !targetView.available) {
      throw new CodexAgentCommandError("Registered task is not currently eligible for Agent commands", 409, targetView?.unavailable_reason ?? "target-not-registered");
    }
    if (
      command.work_item_id !== targetView.work_item_id ||
      command.expected_provider_thread_id !== targetView.provider_thread_id ||
      command.expected_task_status !== targetView.task_status ||
      command.expected_work_item_state !== targetView.work_item_state
    ) {
      throw new CodexAgentCommandError("Registered task or Work Item state changed before dispatch", 409, "stale-target-state");
    }
    if (!targetView.operations.includes(command.operation)) {
      throw new CodexAgentCommandError("Requested operation is unavailable for the observed turn state", 409, "operation-unavailable");
    }
    const expectedTurnId = command.expected_active_turn_id ?? null;
    if (expectedTurnId !== targetView.active_turn_id) {
      throw new CodexAgentCommandError("Active turn changed before dispatch", 409, "stale-active-turn");
    }
    return targetView;
  }

  async function dispatchAgentCommand(command) {
    const targetView = await prepareAgentCommand(command);
    const input = command.operation === "interrupt"
      ? null
      : [{ type: "text", text: command.instruction, text_elements: [] }];
    const clientUserMessageId = `temple-${sha256(command.idempotency_key).slice(0, 32)}`;
    const method = command.operation === "new-turn"
      ? "turn/start"
      : command.operation === "steer"
        ? "turn/steer"
        : "turn/interrupt";
    const params = command.operation === "new-turn"
      ? { threadId: targetView.provider_thread_id, clientUserMessageId, input, turnTrigger: "user" }
      : command.operation === "steer"
        ? {
            threadId: targetView.provider_thread_id,
            clientUserMessageId,
            input,
            expectedTurnId: targetView.active_turn_id
          }
        : { threadId: targetView.provider_thread_id, turnId: targetView.active_turn_id };
    try {
      const response = await connection.request(method, params, options.commandTimeoutMs ?? 15000);
      const providerTurnId = command.operation === "new-turn"
        ? response?.turn?.id ?? null
        : command.operation === "steer"
          ? response?.turnId ?? targetView.active_turn_id
          : targetView.active_turn_id;
      if (command.operation === "new-turn" && providerTurnId) activeTurnByThread.set(targetView.provider_thread_id, providerTurnId);
      const responseStatus = response?.turn?.status;
      const terminalStatus = ["completed", "failed", "interrupted"].includes(responseStatus) ? responseStatus : null;
      return {
        status: terminalStatus ?? (command.operation === "new-turn" ? "turn-started" : "provider-accepted"),
        transport_status: "provider-accepted",
        execution_status: terminalStatus ?? (command.operation === "new-turn" ? "turn-started" : "pending"),
        provider_turn_id: providerTurnId,
        provider_method: method,
        rejection_code: null,
        automatic_retry: false
      };
    } catch (error) {
      if (Number.isInteger(error?.rpcCode)) {
        return {
          status: "provider-rejected",
          transport_status: "provider-rejected",
          execution_status: "not-started",
          provider_turn_id: targetView.active_turn_id,
          provider_method: method,
          rejection_code: "provider-json-rpc-error",
          automatic_retry: false
        };
      }
      return {
        status: "delivery-unknown",
        transport_status: "delivery-unknown",
        execution_status: "unknown",
        provider_turn_id: targetView.active_turn_id,
        provider_method: method,
        rejection_code: "provider-acknowledgement-unavailable",
        automatic_retry: false
      };
    }
  }

  async function markProviderOwnedTaskAttention(task, reasonCode) {
    try {
      const current = tasks.find((entry) => entry.id === task.id) ?? task;
      const updated = await withProjectMutationLock(target, () => taskUpdater(target, {
        taskId: current.id,
        status: "attention",
        effectiveModel: current.effective_model,
        reasoningEffort: current.reasoning_effort,
        serviceTier: current.service_tier,
        notes: `Provider-owned launch ${reasonCode}; instruction content not retained; automatic retry disabled.`,
        actor: current.agent_id
      }));
      replaceCorrelatedTask(updated);
      return updated;
    } catch {
      registry.update(providerId, { status: "degraded", degraded_reason: "provider-owned-task-update-failed" });
      return task;
    }
  }

  function rememberProviderOwnedTask(task) {
    if (!taskTopology.registered.some((entry) => entry.id === task.id)) taskTopology.registered.push(task);
    if (!tasks.some((entry) => entry.id === task.id)) tasks.push(task);
    if (!taskTopology.live_resumable.some((entry) => entry.id === task.id)) taskTopology.live_resumable.push(task);
    attachOutcomes.set(task.id, {
      task_id: task.id,
      work_item_id: task.work_item_id,
      provider_thread_id: task.thread_id,
      history_read: "not-required",
      live_resume: "not-required",
      attach_outcome: "live-attached",
      reason_code: null,
      retry_suppressed: false
    });
    registry.update(providerId, { attachment: attachmentSummary() });
  }

  async function launchProviderOwnedTask(request) {
    if (!connection || registry.get(providerId)?.status !== "ready") {
      throw new CodexProviderOwnedLaunchError(
        "Codex provider is not ready for a provider-owned launch",
        "provider-not-ready"
      );
    }
    const launch = providerOwnedLaunchRequest(request, target);
    await refreshWorkItems();
    const workItem = workItems.find((item) => item.id === launch.workItemId);
    if (!workItem || TERMINAL_WORK_ITEM_STATE_SET.has(workItem.state) || isLegacyConcludedItem(workItem)) {
      throw new CodexProviderOwnedLaunchError("Work Item is unavailable for launch", "work-item-not-launchable");
    }
    if (workItem.owner_position !== launch.positionId || workItem.claim?.status !== "active") {
      throw new CodexProviderOwnedLaunchError(
        "Provider-owned launch requires the current Position and an active claim",
        "work-item-not-claimed"
      );
    }
    if (workItem.claim.agent_id !== launch.actor) {
      throw new CodexProviderOwnedLaunchError(
        "Provider-owned launch actor must hold the active Work Item claim",
        "work-item-claim-mismatch"
      );
    }
    const wirePolicy = codexProviderOwnedWirePolicy(launch);

    let threadResponse;
    try {
      threadResponse = await connection.request("thread/start", {
        model: launch.requestedModel,
        cwd: launch.cwd,
        approvalPolicy: wirePolicy.approvalPolicy,
        sandbox: wirePolicy.threadSandboxMode,
        serviceName: "temple-control-plane"
      }, options.launchTimeoutMs ?? 15000);
    } catch (error) {
      const rejection = classifyCodexProviderRejection(error);
      throw new CodexProviderOwnedLaunchError(
        "Codex App Server did not create the provider-owned thread",
        rejection.providerRpcCode !== null ? "thread-start-rejected" : "thread-start-unavailable",
        rejection
      );
    }
    const thread = threadResponse?.thread;
    if (typeof thread?.id !== "string" || !thread.id.trim()) {
      throw new CodexProviderOwnedLaunchError(
        "Codex App Server returned an invalid provider-owned thread",
        "thread-start-invalid"
      );
    }
    if (thread.ephemeral === true) {
      throw new CodexProviderOwnedLaunchError(
        "Codex App Server returned an ephemeral thread for a durable provider-owned launch",
        "thread-start-ephemeral",
        { providerThreadId: thread.id, turnStarted: false }
      );
    }
    const effectiveModel = optionalDimension(threadResponse?.model);
    const observedThreadReasoningEffort = optionalDimension(threadResponse?.reasoningEffort);
    const serviceTier = optionalDimension(threadResponse?.serviceTier);
    let task;
    try {
      task = await withProjectMutationLock(target, () => taskRegistrar(target, {
        workItemId: launch.workItemId,
        positionId: launch.positionId,
        threadId: thread.id,
        hostId: "local",
        status: "active",
        revision: launch.launchRevision,
        launchRevision: launch.launchRevision,
        executionOrigin: "temple-provider-owned",
        providerId,
        requestedModel: launch.requestedModel,
        effectiveModel,
        requestedReasoningEffort: launch.reasoningEffort,
        observedThreadReasoningEffort,
        effectiveTurnReasoningEffort: null,
        serviceTier,
        notes: "Provider-owned launch; instruction content not retained; automatic retry disabled.",
        actor: launch.actor
      }));
    } catch {
      throw new CodexProviderOwnedLaunchError(
        "Provider thread was created, but canonical task registration failed before generation",
        "task-registration-failed",
        { providerThreadId: thread.id, turnStarted: false }
      );
    }

    rememberProviderOwnedTask(task);
    const clientUserMessageId = `temple-${sha256(`${task.id}\0${thread.id}\0${launch.launchRevision}`).slice(0, 32)}`;
    const turnParams = {
      threadId: thread.id,
      clientUserMessageId,
      input: [{ type: "text", text: launch.instruction }],
      turnTrigger: "user",
      cwd: launch.cwd,
      approvalPolicy: wirePolicy.approvalPolicy,
      sandboxPolicy: wirePolicy.turnSandboxPolicy,
      model: launch.requestedModel,
      ...(launch.reasoningEffort ? { effort: launch.reasoningEffort } : {})
    };
    try {
      const response = await connection.request("turn/start", turnParams, options.launchTimeoutMs ?? 15000);
      const providerTurnId = response?.turn?.id ?? null;
      if (!providerTurnId) {
        await markProviderOwnedTaskAttention(task, "turn-start-invalid");
        return {
          status: "provider-invalid-response",
          transport_status: "provider-accepted",
          execution_status: "unknown",
          task_id: task.id,
          provider_thread_id: thread.id,
          provider_turn_id: null,
          requested_model: launch.requestedModel,
          effective_model: effectiveModel,
          requested_reasoning_effort: launch.reasoningEffort,
          observed_thread_reasoning_effort: observedThreadReasoningEffort,
          effective_turn_reasoning_effort: null,
          reasoning_effort: observedThreadReasoningEffort ?? launch.reasoningEffort,
          reasoning_effort_source: observedThreadReasoningEffort ? "provider-thread" : "canonical-requested",
          service_tier: serviceTier,
          launch_revision: launch.launchRevision,
          instruction_length: launch.instructionLength,
          instruction_retained: false,
          automatic_retry: false
        };
      }
      activeTurnByThread.set(thread.id, providerTurnId);
      return {
        status: "turn-started",
        transport_status: "provider-accepted",
        execution_status: response.turn?.status ?? "inProgress",
        task_id: task.id,
        provider_thread_id: thread.id,
        provider_turn_id: providerTurnId,
        requested_model: launch.requestedModel,
        effective_model: effectiveModel,
        requested_reasoning_effort: launch.reasoningEffort,
        observed_thread_reasoning_effort: observedThreadReasoningEffort,
        effective_turn_reasoning_effort: null,
        reasoning_effort: observedThreadReasoningEffort ?? launch.reasoningEffort,
        reasoning_effort_source: observedThreadReasoningEffort ? "provider-thread" : "canonical-requested",
        service_tier: serviceTier,
        launch_revision: launch.launchRevision,
        instruction_length: launch.instructionLength,
        instruction_retained: false,
        automatic_retry: false
      };
    } catch (error) {
      const rejection = classifyCodexProviderRejection(error);
      const reasonCode = rejection.providerRpcCode !== null ? "turn-start-rejected" : "turn-start-delivery-unknown";
      await markProviderOwnedTaskAttention(task, reasonCode);
      return {
        status: rejection.providerRpcCode !== null ? "provider-rejected" : "delivery-unknown",
        transport_status: rejection.providerRpcCode !== null ? "provider-rejected" : "delivery-unknown",
        execution_status: rejection.providerRpcCode !== null ? "not-started" : "unknown",
        task_id: task.id,
        provider_thread_id: thread.id,
        provider_turn_id: null,
        requested_model: launch.requestedModel,
        effective_model: effectiveModel,
        requested_reasoning_effort: launch.reasoningEffort,
        observed_thread_reasoning_effort: observedThreadReasoningEffort,
        effective_turn_reasoning_effort: null,
        reasoning_effort: observedThreadReasoningEffort ?? launch.reasoningEffort,
        reasoning_effort_source: observedThreadReasoningEffort ? "provider-thread" : "canonical-requested",
        service_tier: serviceTier,
        launch_revision: launch.launchRevision,
        rejection_code: reasonCode,
        provider_rpc_code: rejection.providerRpcCode,
        rejection_category: rejection.rejectionCategory,
        instruction_length: launch.instructionLength,
        instruction_retained: false,
        automatic_retry: false
      };
    }
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, options.reconnectMs ?? 2000);
  }

  async function connect() {
    if (stopped || connecting) return connecting;
    if (connection) return true;
    connecting = (async () => {
      try {
        const activeConnection = createJsonRpcProcess(command, commandArgs, {
          cwd: target,
          onNotification(message) {
            if (message.method === "serverRequest/resolved") pendingRuntimeRequests.delete(String(message.params?.requestId));
            notificationQueue = notificationQueue.then(() => append(message)).catch((error) => {
              registry.update(providerId, { status: "degraded", degraded_reason: error.message });
            });
          },
          onRequest(message, responder) {
            const safe = normalizeCodexMessage(project.id, tasks, message, { workItems, providerId });
            if (!safe) return;
            pendingRuntimeRequests.set(String(message.id), {
              id: String(message.id),
              method: message.method,
              params: message.params,
              responder,
              safe: safeRequestView(safe.data, message.params),
              observed_at: new Date().toISOString()
            });
            void journal.append(safe).catch((error) => {
              registry.update(providerId, { status: "degraded", degraded_reason: error.message });
            });
          },
          onProtocolError(error) {
            registry.update(providerId, { status: "degraded", degraded_reason: error.message });
          },
          onExit(error) {
            if (connection !== activeConnection) return;
            connection = null;
            for (const request of pendingRuntimeRequests.values()) request.safe.answerable = false;
            registry.update(providerId, {
              status: stopped ? "disabled" : "offline",
              degraded_reason: stopped ? "stopped" : error.message
            });
            scheduleReconnect();
          }
        });
        connection = activeConnection;
        const initialized = await activeConnection.request("initialize", {
          clientInfo: { name: "temple", title: "Temple Control Plane", version: TEMPLATE_VERSION },
          capabilities: { experimentalApi: false }
        });
        activeConnection.notify("initialized", {});
        const detectedCliVersion = initialized?.serverInfo?.version ?? initialized?.serverInfo?.name ??
          boundedText(initialized?.userAgent, 240);
        registry.set({
          ...codexAppServerProviderContract({
            id: providerId,
            status: "ready",
            detectedCliVersion
          }),
          attachment: attachmentSummary()
        });
        registry.update(providerId, { last_observed_at: new Date().toISOString(), degraded_reason: null });

        for (const task of tasks) {
          let snapshotReconciled = false;
          if (readMethodUnavailable || suppressedReadTasks.has(task.id)) {
            updateAttachOutcome(task, {
              history_read: "suppressed",
              attach_outcome: "degraded",
              reason_code: readMethodUnavailable ? "thread-read-unsupported" : suppressedReadReasons.get(task.id),
              retry_suppressed: true
            });
            registry.update(providerId, {
              status: "degraded",
              degraded_reason: readMethodUnavailable ? "thread-read-unsupported" : suppressedReadReasons.get(task.id)
            });
          } else {
            try {
              const read = await activeConnection.request("thread/read", { threadId: task.thread_id, includeTurns: true });
              if (read?.thread) {
                await reconcile(read.thread, "thread/read");
                snapshotReconciled = true;
                updateAttachOutcome(task, { history_read: "succeeded", attach_outcome: "history-only", reason_code: null });
              } else {
                updateAttachOutcome(task, {
                  history_read: "failed",
                  attach_outcome: "degraded",
                  reason_code: "thread-read-empty"
                });
                registry.update(providerId, { status: "degraded", degraded_reason: "thread-read-empty" });
              }
            } catch (error) {
              await recordAttachFailure(task, "thread/read", error);
            }
          }

          if (options.resumeThreads === false || !shouldResumeCodexTask(task, { workItems })) continue;
          if (resumeMethodUnavailable || suppressedResumeTasks.has(task.id)) {
            updateAttachOutcome(task, {
              live_resume: "suppressed",
              attach_outcome: "degraded",
              reason_code: resumeMethodUnavailable ? "thread-resume-unsupported" : suppressedResumeReasons.get(task.id),
              retry_suppressed: true
            });
            registry.update(providerId, {
              status: "degraded",
              degraded_reason: resumeMethodUnavailable ? "thread-resume-unsupported" : suppressedResumeReasons.get(task.id)
            });
            continue;
          }
          try {
            const resumed = await activeConnection.request("thread/resume", { threadId: task.thread_id });
            if (resumed?.thread && !snapshotReconciled) await reconcile(resumed.thread, "thread/resume");
            const prior = attachOutcomes.get(task.id);
            updateAttachOutcome(task, {
              live_resume: "succeeded",
              attach_outcome: "live-attached",
              reason_code: prior?.history_read === "succeeded" ? null : prior?.reason_code ?? null,
              retry_suppressed: prior?.retry_suppressed === true
            });
          } catch (error) {
            await recordAttachFailure(task, "thread/resume", error);
          }
        }
        return true;
      } catch (error) {
        registry.update(providerId, { status: "offline", degraded_reason: error.message });
        if (connection) await connection.close().catch(() => {});
        connection = null;
        scheduleReconnect();
        return false;
      } finally {
        connecting = null;
      }
    })();
    return connecting;
  }

  return {
    providerId,
    tasks,
    taskTopology,
    attachmentOutcomes() {
      return attachmentOutcomeList();
    },
    agentCommandStatus() {
      return registry.get(providerId)?.status ?? "offline";
    },
    agentCommandTargets,
    prepareAgentCommand,
    dispatchAgentCommand,
    launchProviderOwnedTask,
    async start() {
      await connect();
      return this;
    },
    pendingRequests() {
      return [...pendingRuntimeRequests.values()].map((request) => ({ ...request.safe, observed_at: request.observed_at }));
    },
    answerRuntimeRequest(requestId, action) {
      const request = pendingRuntimeRequests.get(String(requestId));
      if (!request || !request.safe.answerable || !connection) throw new Error("Runtime request is no longer live or answerable");
      const result = buildCodexRuntimeRequestResponse(request.method, request.params, action);
      request.responder.respond(result);
      request.safe.answerable = false;
      request.safe.status = "answered";
      pendingRuntimeRequests.delete(String(requestId));
      return { request_id: String(requestId), method: request.method, answered: true, request_class: request.safe.request_class };
    },
    async reconnect() {
      await drainNotificationQueue();
      if (connection) await connection.close();
      await drainNotificationQueue();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      return connect();
    },
    async stop() {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      await drainNotificationQueue();
      if (connection) await connection.close();
      connection = null;
      await drainNotificationQueue();
      registry.update(providerId, { status: "disabled", degraded_reason: "stopped" });
    }
  };
}
