import { codexModelConnectionParams } from "./workkeel-runtime.mjs";
import { validateRuntimeResult, exactKeys } from "./workkeel-execution-policy.mjs";
import { safeDirectory } from "./workkeel-project.mjs";
import { createJsonRpcProcess } from "./codex-app-server-provider.mjs";
import path from "node:path";
import crypto from "node:crypto";
import { readTaskFile } from "./task-contract.mjs";

// A point-in-time observation, never a replacement grant or task-store update.
function authorizationSnapshot(contract, now = new Date()) {
  const authority = contract.authorization;
  if (!authority || typeof authority.approval_ref !== "string" || !authority.approval_ref.trim()) throw new Error("Codex dispatch requires task authorization");
  const expires = authority.expires_at;
  if (expires !== null && (typeof expires !== "string" || !Number.isFinite(Date.parse(expires)))) throw new Error("Invalid task authorization expiry");
  if (expires !== null && Date.parse(expires) <= now.getTime()) throw new Error("Task authorization expired before Codex dispatch");
  return { expiry_status: "valid_at_dispatch", checked_at_utc: now.toISOString(), expires_at_utc: expires,
    approval_ref: authority.approval_ref, authority_source: "task.authorization",
    scope: "Expiry check only; does not grant permissions, extend expiry or accept results." };
}

export function codexPermissionProfileArgs({ id, profile }) {
  if (!/^workkeel-[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid generated Codex permission profile ID");
  const toml = value => value !== null && typeof value === "object" ? `{${Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)}=${toml(entry)}`).join(",")}}` : JSON.stringify(value);
  return ["-c", `permissions.${id}=${toml(profile)}`];
}

/** Explicit embedding-host boundary. Never construct a host from workflow JSON. */
export function createCodexProcessHost({ command = "codex", args = ["app-server", "--stdio"], env, assertCompatible }) {
  if (typeof assertCompatible !== "function") throw new Error("Codex requires an enforcing, qualified host; a contract alone is not a sandbox");
  return { assertCompatible, connect: ({ target, permissionProfile, ...callbacks }) => createJsonRpcProcess(command, [...args, ...codexPermissionProfileArgs(permissionProfile)], { cwd: target, env, ...callbacks }) };
}

export async function codexPermissionsForContract(target, contract) {
  const environment = contract.environment;
  const root = await safeDirectory(target, ".");
  const protectedPaths = [".git", ".codex", ".agents", ".ai-org", "AGENTS.md", "CLAUDE.md", "WORKKEEL.md",
    "workkeel.lock", "workkeelw.mjs", "TEMPLE.md", "temple.lock", "templew.mjs"].map(name => path.join(root, name));
  const under = (entry, parent) => entry === parent || entry.startsWith(`${parent}${path.sep}`);
  const filesystem = { ":root": "deny", ":minimal": "read" };
  for (const ref of environment.read_paths) {
    const resolved = await safeDirectory(target, ref);
    if (under(resolved, path.join(root, ".ai-org/execution"))) throw new Error("Codex cannot read private workflow execution state");
    filesystem[resolved] = "read";
  }
  for (const ref of environment.write_paths) {
    const resolved = await safeDirectory(target, ref);
    if (protectedPaths.some(parent => under(resolved, parent))) throw new Error("Codex write roots cannot target protected task authority");
    filesystem[resolved] = "write";
  }
  // Model tools cannot rewrite their authority, instruction entrypoints or the
  // runner's journal, even when the task permits ordinary project-root writes.
  for (const ref of protectedPaths) filesystem[ref] = "read";
  for (const ref of new Set([contract.authorization?.approval_ref, ...(environment.data?.policy_refs ?? []), ...(contract.skills ?? [])].filter(Boolean))) {
    await readTaskFile(root, ref); // Normalized, regular in-project file; no symlinks.
    filesystem[path.join(root, ref)] = "read";
  }
  filesystem[path.join(root, ".ai-org/execution")] = "deny";
  return { filesystem, network: { enabled: false } };
}

/** Codex owns the coding loop. This adapter only connects its documented protocol. */
export function createCodexRuntime(host, options = {}) {
  if (!host || typeof host.connect !== "function" || typeof host.assertCompatible !== "function") throw new Error("A trusted Codex host is required");
  exactKeys(options, [], ["coordinatorChecks"]);
  const coordinatorChecks = options.coordinatorChecks ?? [];
  if (!Array.isArray(coordinatorChecks) || new Set(coordinatorChecks).size !== coordinatorChecks.length ||
      coordinatorChecks.some(check => !["git", "tests"].includes(check))) throw new Error("Unsupported coordinator check ownership");
  const assignedChecks = Object.freeze([...coordinatorChecks]);
  const active = new Map();
  async function assertCompatible(context) {
    const { contract, policy } = context;
    if (contract.execution.runtime.adapter_id !== "codex-app-server") throw new Error("Contract does not select the Codex adapter");
    if (contract.environment.data.model_access !== "approved-connection") throw new Error("Model data access must be explicitly approved");
    if (contract.environment.external_actions.length) throw new Error("Codex v1 adapter does not support external actions");
    if (policy.headroom.mode !== "off") throw new Error("Codex native tool output cannot be intercepted by this adapter; use Headroom through a host-owned tool integration");
    if (policy.limits.max_cost_usd !== null) throw new Error("Codex adapter cannot enforce a financial cap; use a qualified hard-budget host adapter");
    context.signal?.throwIfAborted();
    await codexPermissionsForContract(context.target, contract);
    // This is trusted application code, not a boolean declared in a task file.
    // It must verify supported tools, network/data policy, runtime version and
    // effective MCP/plugins/hooks/environment controls before opening a process.
    await host.assertCompatible(context);
  }
  async function cancel({ operation_id }) {
    const current = active.get(operation_id);
    if (!current) return;
    current.fail(new Error("Codex operation interrupted; inspect host state before recovery"));
    await current.settled;
  }
  async function dispatch(context, resume) {
    authorizationSnapshot(context.contract);
    await assertCompatible(context);
    if (context.signal?.aborted) throw new Error("Codex operation was cancelled before dispatch");
    if (active.has(context.operation_id)) throw new Error("Duplicate active runtime operation");
    let resolveTurn, rejectTurn, firstFatal = null, settle;
    const completed = new Promise((resolve, reject) => { resolveTurn = resolve; rejectTurn = error => { firstFatal ??= error; reject(error); }; });
    // Install a rejection handler before initialization to avoid an unhandled
    // process-exit rejection while a request is also rejecting.
    completed.catch(() => {});
    const fatalOnly = completed.then(() => new Promise(() => {}));
    fatalOnly.catch(() => {});
    let output = "", outputBytes = 0, usage = { input_tokens: null, output_tokens: null, cost_usd: null };
    let runtimeModel = null, observations = Promise.resolve();
    const previousCounters = {}, invalidCounters = new Set();
    const counter = (name, value) => {
      if (!Number.isSafeInteger(value) || value < 0 || value < (previousCounters[name] ?? 0)) invalidCounters.add(name);
      if (invalidCounters.has(name)) return null;
      previousCounters[name] = value; return value;
    };
    const observe = () => {
      const snapshot = { runtime_model: runtimeModel, observed_model: null, usage: { ...usage } };
      observations = observations.then(() => context.observe?.(snapshot));
      observations.catch(rejectTurn);
    };
    const buffered = [];
    const current = { threadId: null, turnId: null, turnRequested: false, rpc: null, fail: rejectTurn, terminalConfirmed: false,
      settled: new Promise(resolve => { settle = resolve; }) };
    function notification(message) {
      const p = message.params ?? {};
      // This connection belongs to one operation. A model change is fatal even
      // before the runtime has supplied the thread/turn identifiers.
      if (message.method === "model/rerouted") { rejectTurn(new Error("Runtime changed the pinned model; automatic fallback is prohibited")); return; }
      if (message.method === "turn/started" && current.turnRequested && p.threadId === current.threadId) {
        if (typeof p.turn?.id !== "string" || current.turnId && current.turnId !== p.turn.id) return rejectTurn(new Error("Codex started a conflicting turn"));
        current.turnId = p.turn.id;
      }
      if (!current.turnId) { if (buffered.length >= 2000) return rejectTurn(new Error("Excessive pre-turn notifications")); buffered.push(message); return; }
      if (p.threadId !== current.threadId || p.turnId && p.turnId !== current.turnId) return;
      if (message.method === "item/completed" && p.item?.type === "agentMessage") {
        const text = p.item.text;
        if (typeof text !== "string") return rejectTurn(new Error("Invalid Codex final message"));
        outputBytes += Buffer.byteLength(text) + 1;
        if (outputBytes > 65536) return rejectTurn(new Error("Codex output exceeds the bounded result size"));
        if (p.item.phase !== "commentary") output += `${text}\n`;
      }
      if (message.method === "thread/tokenUsage/updated") {
        if (p.turnId !== current.turnId || current.terminalConfirmed) return;
        // `last` is the latest model request, not the whole tool-using turn.
        // A fresh node conversation starts at zero; resumed conversations need
        // a trusted pre-turn baseline we do not yet have, so report unknown.
        const observed = resume ? null : p.tokenUsage?.total;
        usage = { input_tokens: counter("input_tokens", observed?.inputTokens),
          output_tokens: counter("output_tokens", observed?.outputTokens), cost_usd: null };
        observe();
      }
      if (message.method === "turn/completed" && p.turn?.id === current.turnId) { current.terminalConfirmed = true; resolveTurn(p.turn); }
    }
    const permissions = `workkeel-${crypto.randomUUID()}`;
    const profile = await codexPermissionsForContract(context.target, context.contract);
    const rpc = await host.connect({ target: context.target, permissionProfile: { id: permissions, profile },
      onNotification: notification,
      onRequest(message) {
        // Workflow approvals cannot silently approve host permission expansion,
        // external tool calls or requests for missing business information.
        rejectTurn(new Error("Host permission or input request needs operator attention"));
      },
      onExit: () => rejectTurn(new Error("Codex process exited before confirmed completion")),
      onProtocolError: () => rejectTurn(new Error("Codex emitted an invalid protocol frame"))
    });
    current.rpc = rpc; active.set(context.operation_id, current);
    const request = async (...args) => {
      if (firstFatal) throw firstFatal;
      context.signal?.throwIfAborted();
      const response = await Promise.race([rpc.request(...args), fatalOnly]);
      if (firstFatal) throw firstFatal;
      return response;
    };
    const aborted = () => { cancel({ operation_id: context.operation_id }).catch(rejectTurn); };
    context.signal?.addEventListener("abort", aborted, { once: true });
    const timer = setTimeout(aborted, context.policy.limits.timeout_ms);
    try {
      if (context.signal?.aborted) throw new Error("Codex operation was cancelled before initialization");
      await request("initialize", { clientInfo: { name: "workkeel", version: "1" }, capabilities: { experimentalApi: true } });
      rpc.notify("initialized");
      if (host.assertConnected) await host.assertConnected({ ...rpc, request }, context);
      if (context.selection.connection.kind === "codex-subscription") {
        const account = await request("account/read", { refreshToken: false });
        if (account.account?.type !== "chatgpt") throw new Error("Codex subscription routing requires ChatGPT login, not an API-key account");
        const catalog = await request("model/list", { includeHidden: false, limit: 100 });
        const selected = catalog.data?.find(model => model.model === context.selection.connection.model);
        if (!selected?.supportedReasoningEfforts.some(value => value.reasoningEffort === context.selection.connection.effort)) throw new Error("Selected subscription model or reasoning effort is unavailable on this host");
      }
      const parameters = codexModelConnectionParams(context.selection.connection);
      const cwd = await safeDirectory(context.target, context.contract.environment.cwd);
      const started = await request(resume ? "thread/resume" : "thread/start", {
        ...parameters, ...(resume ? { threadId: context.conversation_id } : { allowProviderModelFallback: false }), cwd,
        approvalPolicy: "never", permissions,
        developerInstructions: "Follow the full task contract and execution_context check_rule/result_rule. The coordinator owns claims, handoff, review and closure. Read applicable WORKKEEL.md, AGENTS.md, nested instructions, named/matching Skills and required references fully, even if discovery is disabled; match Skills without reading the whole catalog and batch independent reads. Use the actual UTC clock for expiry; authorization_check is a point-in-time observation, not authority. Missing material, expiry or scope conflicts require attention. Report the requested result, changed files, actual checks, Skill use and unverified outcomes. Never expand permissions, change models or start background/detached jobs.",
        config: { ...parameters.config, web_search: "disabled", allow_login_shell: false,
          permissions: { [permissions]: profile }, default_permissions: permissions }
      });
      current.threadId = started.thread?.id;
      if (typeof current.threadId !== "string" || resume && current.threadId !== context.conversation_id ||
          parameters.model && started.model !== parameters.model ||
          parameters.modelProvider && started.modelProvider !== parameters.modelProvider ||
          context.selection.connection.effort && started.reasoningEffort !== context.selection.connection.effort ||
          started.activePermissionProfile?.id !== permissions || started.activePermissionProfile?.extends ||
          started.cwd !== cwd || started.approvalPolicy !== "never" ||
          !Array.isArray(started.instructionSources) || started.instructionSources.length ||
          !Array.isArray(started.runtimeWorkspaceRoots) || started.runtimeWorkspaceRoots.some(root => root !== cwd) ||
          !resume && (!Array.isArray(started.thread.turns) || started.thread.turns.length)) throw new Error("Codex thread identity, permissions or selected connection differs from the request");
      runtimeModel = started.model ?? null; observe();
      const existingTerminals = await request("thread/backgroundTerminals/list", { threadId: current.threadId });
      if (!Array.isArray(existingTerminals.data) || existingTerminals.data.length || existingTerminals.nextCursor) throw new Error("Codex has unexpected background terminals; recovery requires inspection");
      // Initialization can outlive the approval. Recheck before any model work.
      const authorizationCheck = authorizationSnapshot(context.contract);
      current.turnRequested = true;
      const turn = await request("turn/start", { threadId: current.threadId, cwd, approvalPolicy: "never",
        permissions,
        outputSchema: { type: "object", properties: { outcome: { type: "string", enum: ["done", "attention"] }, output: { type: "string" } }, required: ["outcome", "output"], additionalProperties: false },
        input: [{ type: "text", text: JSON.stringify({ task: context.contract, work: context.input,
          execution_context: { started_at_utc: authorizationCheck.checked_at_utc, lifecycle_owner: "workkeel-coordinator",
            authorization_check: authorizationCheck,
            ...(assignedChecks.length ? { coordinator_checks: assignedChecks,
              check_rule: "Coordinator checks run after dispatch; evidence is separate. Do not run or probe them. Assignment grants no permission or acceptance." } : {}),
            result_rule: "done: work performed; attention: incomplete/blocked. Neither grants acceptance or lifecycle authority." } }) }],
        ...(parameters.model ? { model: parameters.model } : {}),
        ...(context.selection.connection.effort ? { effort: context.selection.connection.effort } : {}) });
      if (typeof turn.turn?.id !== "string" || current.turnId && current.turnId !== turn.turn.id) throw new Error("Codex did not return the matching turn ID");
      current.turnId = turn.turn.id;
      for (const message of buffered.splice(0)) notification(message);
      const terminal = await completed;
      if (firstFatal) throw firstFatal;
      if (!["completed", "failed", "interrupted"].includes(terminal.status)) throw new Error("Unknown Codex terminal status");
      let outcome = "attention";
      if (terminal.status === "completed") {
        let result;
        try { result = JSON.parse(output); } catch { throw new Error("Codex did not return the required structured node result"); }
        exactKeys(result, ["outcome", "output"]);
        if (!["done", "attention"].includes(result.outcome) || typeof result.output !== "string") throw new Error("Invalid Codex structured node result");
        output = result.output; outcome = result.outcome;
      }
      return validateRuntimeResult({ status: terminal.status === "completed" && outcome === "attention" ? "failed" : terminal.status,
        conversation_id: current.threadId, output, outcome, runtime_model: started.model, observed_model: null, usage });
    } finally {
      clearTimeout(timer); context.signal?.removeEventListener("abort", aborted);
      let cleanupError;
      try {
        if (current.turnRequested && !current.turnId) cleanupError = new Error("Codex dispatched turn identity is unconfirmed; inspect host state before recovery");
        if (current.threadId) {
          if (current.turnId && !current.terminalConfirmed) await rpc.request("turn/interrupt", { threadId: current.threadId, turnId: current.turnId }, 1000);
          await rpc.request("thread/backgroundTerminals/clean", { threadId: current.threadId }, 1500);
          const terminals = await rpc.request("thread/backgroundTerminals/list", { threadId: current.threadId }, 1500);
          if (!Array.isArray(terminals.data) || terminals.data.length || terminals.nextCursor) throw new Error("Background terminals remain");
        }
      } catch { cleanupError = new Error("Codex background terminal cleanup is unconfirmed; inspect host state before recovery"); }
      finally {
        try { await rpc.close(); }
        catch { cleanupError = new Error("Codex process shutdown is unconfirmed; inspect host state before recovery"); }
        active.delete(context.operation_id); settle();
      }
      try { await observations; }
      catch (error) { if (!cleanupError) throw error; }
      if (cleanupError) { cleanupError.runtimeUnsettled = true; throw cleanupError; }
    }
  }
  return { id: "codex-app-server", assertCompatible, start: context => dispatch(context, false), resume: context => dispatch(context, true), cancel };
}
