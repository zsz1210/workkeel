import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createJsonRpcProcess } from "./codex-app-server-provider.mjs";
import { createCodexRuntime, codexPermissionProfileArgs } from "./workkeel-codex-runtime.mjs";
import { safeDirectory } from "./workkeel-project.mjs";

const exec = promisify(execFile);
export const QUALIFIED_CODEX_VERSION = "codex-cli 0.155.0-alpha.9.2";
// An intentionally narrow local profile. Updating its runtime version requires
// protocol and sandbox qualification, not just broadening the version comparison.
const disabled = ["apps", "plugins", "remote_plugin", "hooks", "browser_use", "browser_use_external", "browser_use_full_cdp_access",
  "computer_use", "image_generation", "multi_agent", "multi_agent_v2", "memories", "skill_mcp_dependency_install", "skill_search",
  "shell_snapshot", "workspace_dependencies", "tool_suggest", "auth_elicitation", "goals", "in_app_local_automation"];
const cleanEnvironment = () => Object.fromEntries(["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "CODEX_HOME"]
  .filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));

async function initialize(rpc) {
  await rpc.request("initialize", { clientInfo: { name: "workkeel-subscription-host", version: "1" }, capabilities: { experimentalApi: false } });
  rpc.notify("initialized");
}
function enabledServers(config) { return Object.entries(config.mcp_servers ?? {}).filter(([, value]) => value.enabled !== false).map(([name]) => name); }
function assertControls(config, target) {
  const failed = [...disabled.filter(name => config.features?.[name] !== false).map(name => `feature:${name}`),
    ...Object.entries({ web_search: config.web_search === "disabled", analytics: config.analytics?.enabled === false,
      environment: config.shell_environment_policy?.inherit === "none" && Object.values(config.shell_environment_policy?.set ?? {}).every(value => value === "") && config.shell_environment_policy?.experimental_use_profile === false,
      project_trust: config.projects?.[target]?.trust_level === "untrusted", mcp: !enabledServers(config).length,
      instructions: config.project_doc_max_bytes === 0 && !config.instructions && !config.developer_instructions && !config.model_instructions_file,
      skill_discovery: config.features?.skip_host_skill_discovery === true,
      login_shell: config.allow_login_shell === false,
      telemetry: !config.otel || [undefined, "none"].includes(config.otel.exporter) }).filter(([, valid]) => !valid).map(([name]) => name)];
  if (failed.length) throw new Error(`Codex host controls mismatch: ${failed.join(", ")}`);
  if (config.openai_base_url || config.chatgpt_base_url && !["https://chatgpt.com/backend-api", "https://chatgpt.com/backend-api/"].includes(config.chatgpt_base_url) || config.model_providers?.openai) throw new Error("Custom OpenAI transport is outside the subscription profile; use an explicitly reviewed host adapter");
}

/** Uses existing ChatGPT login; never reads/copies credentials or rewrites global config. */
export async function createLocalCodexSubscriptionHost(targetInput, { command = "codex" } = {}) {
  const target = await safeDirectory(targetInput, ".");
  const env = cleanEnvironment();
  const version = (await exec(command, ["--version"], { env, timeout: 5000 })).stdout.trim();
  if (version !== QUALIFIED_CODEX_VERSION || process.platform !== "darwin") throw new Error("Codex version/platform needs host qualification before automatic execution");
  const settings = [...disabled.map(name => `features.${name}=false`), "web_search=\"disabled\"", "analytics.enabled=false",
    "shell_environment_policy.inherit=\"none\"", "shell_environment_policy.set={}", "shell_environment_policy.include_only=[]", "shell_environment_policy.experimental_use_profile=false",
    "project_doc_max_bytes=0", "instructions=\"\"", "developer_instructions=\"\"", "features.skip_host_skill_discovery=true", "allow_login_shell=false",
    `projects={${JSON.stringify(target)}={trust_level=\"untrusted\"}}`, "approval_policy=\"never\"", "sandbox_mode=\"read-only\""];
  const args = () => ["app-server", "--stdio", ...settings.flatMap(setting => ["-c", setting])];
  const probe = createJsonRpcProcess(command, args(), { cwd: target, env });
  try {
    await initialize(probe);
    const { config } = await probe.request("config/read", { cwd: target, includeLayers: false });
    // Empty TOML tables merge with inherited configuration. Explicitly clear
    // every injected value without reading, copying or logging its contents.
    for (const name of Object.keys(config.shell_environment_policy?.set ?? {})) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error("Codex environment name requires a separately reviewed host profile");
      settings.push(`shell_environment_policy.set.${name}=\"\"`);
    }
    for (const name of enabledServers(config)) {
      if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error("Codex MCP name requires a separately reviewed host profile");
      settings.push(`mcp_servers.${name}.enabled=false`);
    }
  } finally { await probe.close(); }
  const assertConnected = async (rpc, context) => {
    const { config } = await rpc.request("config/read", { cwd: target, includeLayers: false }); assertControls(config, target);
    const account = await rpc.request("account/read", { refreshToken: false });
    if (account.account?.type !== "chatgpt") throw new Error("Existing ChatGPT subscription login is required; Workkeel will not change accounts");
    const catalog = await rpc.request("model/list", { includeHidden: false, limit: 100 });
    const model = catalog.data?.find(m => m.model === context.selection.connection.model);
    if (!model?.supportedReasoningEfforts.some(e => e.reasoningEffort === context.selection.connection.effort)) throw new Error("Requested subscription model/effort is not currently available");
  };
  return {
    assertCompatible: async ({ target: requested, contract, selection }) => {
      if (await safeDirectory(requested, ".") !== target || selection.connection.kind !== "codex-subscription" ||
          contract.environment.tools.length !== 1 || contract.environment.tools[0] !== "codex" ||
          contract.environment.network.mode !== "none" || contract.environment.resources.length ||
          contract.environment.cwd !== "." || !contract.environment.read_paths.includes(".") ||
          contract.execution.runtime.required_features.some(feature => !["filesystem-sandbox", "network-disabled", "fixed-model", "resume", "cancel"].includes(feature))) throw new Error("Local subscription host supports only native Codex tools, sandboxed paths and disabled tool networking");
    },
    assertConnected,
    connect: ({ permissionProfile, ...callbacks }) => createJsonRpcProcess(command, [...args(), ...(permissionProfile ? codexPermissionProfileArgs(permissionProfile) : [])], { ...callbacks, cwd: target, env })
  };
}

export async function createLocalCodexSubscriptionRuntime(target, options) {
  return createCodexRuntime(await createLocalCodexSubscriptionHost(target, options));
}
