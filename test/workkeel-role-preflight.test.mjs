import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateRoleContract, createTrustedRoleHost, runRolePreflight } from "../src/workkeel-role-preflight.mjs";
import { createCodexRuntime } from "../src/workkeel-codex-runtime.mjs";

const role = (overrides = {}) => ({ schema_version: "workkeel.role-contract/v1", role: "implementation", product_access: "write", tests: "coordinator",
  edit_tools: ["apply_patch"], model: { provider: "openai", model: "example-model", effort: "high" }, usage: { fields: ["input_tokens", "output_tokens"] }, ...overrides });
const reviewRole = () => role({ role: "review", product_access: "read", tests: "role", edit_tools: [] });
const probe = (overrides = {}) => ({ host: "fixture-host", enforcement: { sandbox: "enforced", product_access: "write", network: "disabled", test_scratch: "none" },
  tools: ["apply_patch", "shell"], models: [{ provider: "openai", model: "example-model", efforts: ["high"] }],
  usage: { fields: ["input_tokens", "output_tokens"], unknown: "null" }, ...overrides });
function trusted(result) {
  const calls = { probe: 0 };
  return { calls, host: createTrustedRoleHost({ id: "fixture-role-host", probe: async () => { calls.probe++; return typeof result === "function" ? result() : structuredClone(result); } }) };
}

test("role contracts state requirements only and reject contradictions and declared capabilities", () => {
  assert.equal(validateRoleContract(role()).role, "implementation");
  assert.throws(() => validateRoleContract(role({ role: "review" })), /review requires product read access/);
  assert.throws(() => validateRoleContract(role({ edit_tools: [] })), /requires an editing tool/);
  assert.throws(() => validateRoleContract({ ...reviewRole(), edit_tools: ["apply_patch"] }), /read-only roles cannot require editing tools/);
  assert.throws(() => validateRoleContract({ ...reviewRole(), role: "verification", tests: "none" }), /test ownership/);
  assert.throws(() => validateRoleContract(role({ role: "operator" })), /unknown role/);
  assert.throws(() => validateRoleContract(role({ sandbox: "enforced" })), /unknown fields/);
  assert.throws(() => validateRoleContract(role({ model: { provider: "openai", model: "example-model" } })), /unknown fields/);
  assert.throws(() => validateRoleContract(role({ usage: { fields: ["input_tokens", "invented_tokens"] } })), /malformed usage/);
});

test("preflight fails closed on missing tools, unproven sandbox, test conflicts, model and usage gaps", async () => {
  const ok = trusted(probe());
  const receipt = await runRolePreflight({ role: role(), host: ok.host, context: { approved_tools: ["apply_patch"], coordinator_checks: ["git", "tests"] } });
  assert.equal(receipt.execution_authorized, false); assert.equal(receipt.probed_host, "fixture-host"); assert.equal(ok.calls.probe, 1);
  const cases = [
    [probe({ tools: ["shell"] }), /editing tool "apply_patch" is unavailable/],
    [probe({ enforcement: { ...probe().enforcement, sandbox: "declared" } }), /sandbox enforcement is unproven/],
    [probe({ enforcement: { ...probe().enforcement, product_access: "read" } }), /host enforces product read access/],
    [probe({ enforcement: { ...probe().enforcement, network: "unknown" } }), /network isolation/],
    [probe({ models: [{ provider: "openai", model: "example-model", efforts: ["low"] }] }), /exact model and effort/],
    [probe({ models: [{ provider: "other", model: "example-model", efforts: ["high"] }] }), /exact model and effort/],
    [probe({ usage: { fields: ["input_tokens"], unknown: "null" } }), /partial usage report lacks output_tokens/],
    [probe({ usage: { fields: ["input_tokens", "output_tokens"], unknown: "zero" } }), /malformed usage report/],
    [probe({ usage: { fields: "input_tokens", unknown: "null" } }), /malformed probed usage/],
    [{ ...probe(), sandbox_proof: true }, /unknown fields/],
    [() => { throw new Error("catalogue offline"); }, /probe failed/]
  ];
  for (const [result, pattern] of cases) await assert.rejects(runRolePreflight({ role: role(), host: trusted(result).host }), pattern);
  await assert.rejects(runRolePreflight({ role: role(), host: ok.host, context: { approved_tools: ["shell"] } }), /not approved by the task/);
  await assert.rejects(runRolePreflight({ role: role({ tests: "role" }), host: ok.host, context: { coordinator_checks: ["tests"] } }), /both the role and the coordinator/);
  await assert.rejects(runRolePreflight({ role: role(), host: ok.host, context: { coordinator_checks: ["git"] } }), /does not own them/);
  const readHost = trusted(probe({ enforcement: { ...probe().enforcement, product_access: "read" } }));
  await assert.rejects(runRolePreflight({ role: reviewRole(), host: readHost.host }), /host-private scratch/);
  // A serialized copy of a trusted host, or a declared object, never qualifies.
  for (const host of [JSON.parse(JSON.stringify(ok.host)), { id: "declared", probe: async () => probe() }])
    await assert.rejects(runRolePreflight({ role: role(), host }), /trusted embedding code/);
  // Task-side contradictions stop before the host is even probed.
  assert.equal(ok.calls.probe, 1);
});

test("sparse or padded arrays never satisfy role or probe requirements", async () => {
  const holes = n => new Array(n);
  const padded = values => Object.assign([...values], { extra: "input_tokens" });
  // Role declarations: usage fields and edit tools must be dense.
  for (const contract of [role({ usage: { fields: holes(1) } }), role({ usage: { fields: ["input_tokens", , "output_tokens"] } }),
    role({ usage: { fields: padded(["input_tokens"]) } }), role({ edit_tools: holes(1) }), role({ edit_tools: ["apply_patch", ,] })])
    assert.throws(() => validateRoleContract(contract), /malformed/);
  const ok = trusted(probe());
  await assert.rejects(runRolePreflight({ role: role({ usage: { fields: holes(1) } }), host: ok.host }), /malformed usage requirement/);
  // Task context arrays are dense too.
  await assert.rejects(runRolePreflight({ role: role(), host: ok.host, context: { approved_tools: ["apply_patch", ,] } }), /malformed approved tools/);
  await assert.rejects(runRolePreflight({ role: role(), host: ok.host, context: { coordinator_checks: holes(1) } }), /malformed coordinator checks/);
  assert.equal(ok.calls.probe, 0);
  // Probe evidence: usage fields, tools, model catalogue and efforts.
  const cases = [
    [probe({ usage: { fields: holes(1), unknown: "null" } }), /malformed probed usage report/],
    [probe({ usage: { fields: ["input_tokens", "output_tokens", ,], unknown: "null" } }), /malformed probed usage report/],
    [probe({ tools: ["apply_patch", , "shell"] }), /malformed probed tools/],
    [probe({ tools: padded(["apply_patch"]) }), /malformed probed tools/],
    [probe({ models: holes(1) }), /malformed probed model catalogue/],
    [probe({ models: [{ provider: "openai", model: "example-model", efforts: ["high"] }, ,] }), /malformed probed model catalogue/],
    [probe({ models: [{ provider: "openai", model: "example-model", efforts: holes(1) }] }), /malformed probed efforts/],
    [probe({ models: [{ provider: "openai", model: "example-model", efforts: ["high", ,] }] }), /malformed probed efforts/]
  ];
  for (const [result, pattern] of cases) await assert.rejects(runRolePreflight({ role: role(), host: trusted(result).host }), pattern);
});

async function codexContext(t) {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-role-"));
  t.after(() => fs.rm(target, { recursive: true, force: true }));
  await fs.mkdir(path.join(target, "src")); await fs.writeFile(path.join(target, "approval.md"), "Synthetic offline approval");
  return { target, operation_id: "run:node", run_id: "run", conversation_id: null,
    contract: { execution: { runtime: { adapter_id: "codex-app-server", required_features: [] } },
      authorization: { approval_ref: "approval.md", expires_at: null, operations: ["read", "write", "execute"] },
      environment: { cwd: ".", read_paths: ["src"], write_paths: ["src"], tools: ["apply_patch", "shell"], external_actions: [], data: { model_access: "approved-connection" } } },
    policy: { headroom: { mode: "off" }, limits: { timeout_ms: 3000, max_cost_usd: null } },
    selection: { connection: { kind: "codex-subscription", model: "example-model", effort: "high" } },
    input: { instruction: "Offline role fixture", previous_results: {} } };
}
function countingCodexHost() {
  const calls = { connect: 0, profiles: [] };
  return { calls, host: { assertCompatible: async () => {}, connect: ({ permissionProfile }) => { calls.connect++; calls.profiles.push(permissionProfile.profile); throw new Error("fixture stops at launch"); } } };
}

test("Codex role opt-in blocks before any process launch and enforces read-only review scope", async t => {
  const c = await codexContext(t);
  assert.throws(() => createCodexRuntime(countingCodexHost().host, { coordinatorChecks: ["tests"], role: { contract: role({ tests: "role" }), host: trusted(probe()).host } }), /test ownership contradicts/);
  assert.throws(() => createCodexRuntime(countingCodexHost().host, { role: { contract: role(), host: { probe: async () => probe() } } }), /trusted embedding code/);
  assert.throws(() => createCodexRuntime(countingCodexHost().host, { role: { contract: role({ usage: { fields: new Array(1) } }), host: trusted(probe()).host } }), /malformed usage/);
  const failures = [
    [role(), probe({ tools: ["shell"] }), /apply_patch" is unavailable/],
    [role(), probe({ enforcement: { ...probe().enforcement, sandbox: "unknown" } }), /unproven/],
    [role({ model: { provider: "openai", model: "example-model", effort: "low" } }), probe(), /differs from the role model/],
    [role(), probe({ usage: { fields: ["output_tokens"], unknown: "null" } }), /partial usage/],
    [role(), probe({ usage: { fields: ["input_tokens", "output_tokens", ,], unknown: "null" } }), /malformed probed usage/]
  ];
  for (const [contract, result, pattern] of failures) {
    const codex = countingCodexHost();
    await assert.rejects(createCodexRuntime(codex.host, { coordinatorChecks: ["tests"], role: { contract, host: trusted(result).host } }).start(c), pattern);
    assert.equal(codex.calls.connect, 0);
  }
  const native = countingCodexHost();
  await assert.rejects(createCodexRuntime(native.host, { coordinatorChecks: ["tests"], role: { contract: role(), host: trusted(probe()).host } })
    .start({ ...c, selection: { connection: { kind: "native" } } }), /differs from the role model/);
  assert.equal(native.calls.connect, 0);
  const review = countingCodexHost(), readProbe = trusted(probe({ enforcement: { ...probe().enforcement, product_access: "read", test_scratch: "host-private" } }));
  await assert.rejects(createCodexRuntime(review.host, { role: { contract: reviewRole(), host: readProbe.host } }).start(c), /fixture stops at launch/);
  assert.equal(readProbe.calls.probe, 1); assert.equal(review.calls.connect, 1);
  assert.equal(review.calls.profiles[0].filesystem[await fs.realpath(path.join(c.target, "src"))], "read");
  const legacy = countingCodexHost();
  await assert.rejects(createCodexRuntime(legacy.host).start(c), /fixture stops at launch/);
  assert.equal(legacy.calls.profiles[0].filesystem[await fs.realpath(path.join(c.target, "src"))], "write");
});
