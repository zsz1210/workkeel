import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { codexModelConnectionParams, planTaskRuntime } from "../src/workkeel-runtime.mjs";
import { assertPolicy } from "../src/workkeel-project.mjs";

const gateway = () => ({ kind: "gateway", provider: "litellm", base_url: "http://localhost:4000/v1", model: "approved-model-alias", selection: "fixed", credential_env: "WORKKEEL_GATEWAY_KEY" });
test("model connection is separate from runtime, deterministic, credential-free and native-preserving", () => {
  assert.deepEqual(codexModelConnectionParams({ kind: "native" }), {});
  const connection = gateway(); const first = codexModelConnectionParams(connection);
  assert.deepEqual(first, codexModelConnectionParams(connection));
  assert.equal(first.model, "approved-model-alias");
  const settings = first.config[`model_providers.${first.modelProvider}`];
  assert.equal(settings.wire_api, "responses"); assert.equal(settings.env_key, "WORKKEEL_GATEWAY_KEY");
  assert.equal(settings.requires_openai_auth, false); assert.equal(settings.base_url, "http://localhost:4000/v1");
  const second = codexModelConnectionParams({ ...connection, model: "another-alias" });
  assert.notEqual(first.modelProvider, second.modelProvider);
});
test("gateway settings reject embedded credentials, implicit routing and unknown configuration", () => {
  for (const change of [
    { base_url: "http://remote.example/v1" }, { base_url: "https://user:secret@example.com/v1" },
    { base_url: "https://example.com/v1?key=secret" }, { selection: "auto" },
    { credential_env: "secret-key" }, { api_key: "secret" }, { model: "" }, { provider: "unknown" }
  ]) assert.throws(() => codexModelConnectionParams({ ...gateway(), ...change }));
  assert.throws(() => codexModelConnectionParams({ kind: "native", api_key: "secret" }));
});

test("documented policy and native/gateway runtime plans are executable but never launch", async () => {
  const guide = await fs.readFile(new URL("../docs/getting-started/workkeel.md", import.meta.url), "utf8");
  const examples = [...guide.matchAll(/```json\n([\s\S]*?)\n```/g)].map(m => JSON.parse(m[1]));
  assertPolicy(examples[0]); const contract = examples[1];
  const native = planTaskRuntime(contract); assert.deepEqual(native.thread_start_overrides, {});
  contract.execution.runtime = { kind: "adapter", adapter_id: "codex-app-server", required_features: [] };
  contract.execution.model_connection = gateway(); contract.environment.network = { mode: "allowlist", hosts: ["localhost"] };
  contract.environment.data.model_access = "approved-connection"; contract.authorization.operations.push("network");
  const plan = planTaskRuntime(contract);
  assert.deepEqual(plan.thread_start_overrides, plan.thread_resume_overrides);
  assert.equal(plan.provider_contact, false); assert.equal(plan.execution_authorized, false); assert.equal(plan.automatic_launch_supported, false);
});
