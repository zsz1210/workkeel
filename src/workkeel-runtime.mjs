import { validateTaskContract } from "./task-contract.mjs";
import { sha256, formatJson } from "./files.mjs";

/** Model transport only: it neither starts an agent nor widens its sandbox. */
export function codexModelConnectionParams(connection) {
  if (connection?.kind === "native" && Object.keys(connection).length === 1) return {};
  const fields = ["base_url", "credential_env", "kind", "model", "provider", "selection"];
  if (!connection || Object.keys(connection).sort().join(",") !== fields.sort().join(",") ||
      connection.kind !== "gateway" || !["litellm", "openai-compatible"].includes(connection.provider) ||
      connection.selection !== "fixed" || typeof connection.model !== "string" || !connection.model.trim() ||
      !/^[A-Z_][A-Z0-9_]*$/.test(connection.credential_env ?? "")) throw new Error("A fixed gateway model and credential environment name are required");
  let url;
  try { url = new URL(connection.base_url); } catch { throw new Error("Invalid gateway endpoint"); }
  if (url.username || url.password || url.search || url.hash ||
      !(url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("Gateway endpoint must be HTTPS or loopback HTTP and contain no credentials");
  const provider = `workkeel_${sha256(formatJson(connection)).slice(0, 16)}`;
  return { model: connection.model, modelProvider: provider, config: {
    [`model_providers.${provider}`]: { name: "Workkeel fixed gateway", base_url: url.href.replace(/\/$/, ""),
      env_key: connection.credential_env, wire_api: "responses", requires_openai_auth: false }
  } };
}

export function planTaskRuntime(contract) {
  const validation = validateTaskContract(contract);
  if (!validation.contract_complete) throw new Error("Runtime planning requires a complete current task contract");
  const runtime = contract.execution.runtime;
  if (runtime.kind === "adapter" && runtime.adapter_id !== "codex-app-server") throw new Error("Unsupported runtime adapter; native host-owned execution remains available");
  const parameters = codexModelConnectionParams(contract.execution.model_connection);
  return { schema_version: "workkeel.runtime-plan/v1", authority: "observation-only", mutation_status: "no-write",
    runtime, model_connection: contract.execution.model_connection, connection_fingerprint: sha256(formatJson(contract.execution.model_connection)),
    thread_start_overrides: parameters, thread_resume_overrides: parameters,
    operations: { start: "thread/start then turn/start", resume: "thread/resume", cancel: "turn/interrupt", result: "turn/completed" },
    transport_implementation: "src/codex-app-server-provider.mjs", execution_authorized: false,
    automatic_launch_supported: false, provider_contact: false, boundary_enforcement: "host-responsibility",
    limitations: [
      "This is per-thread configuration, not a launched or accepted task.",
      "Keep the same connection fingerprint on resume; never silently switch providers.",
      "The existing provider uses broader filesystem/network controls than this contract; host enforcement must be reviewed before launch.",
      "Responses API, tool behavior, model alias and gateway routing require live qualification.",
      "A fixed requested alias does not prove the gateway has disabled server-side fallbacks.",
      "Credentials are read only by the selected runtime; no global configuration is modified."
    ] };
}
