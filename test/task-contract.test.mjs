import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { TASK_CONTRACT_SCHEMA, validateTaskContract, projectLegacyTask, readTaskContractInput, inspectLegacyTaskContract } from "../src/task-contract.mjs";

const cli = fileURLToPath(new URL("../bin/temple.mjs", import.meta.url));
function contract() {
  return {
    schema_version: TASK_CONTRACT_SCHEMA, id: "WI-0001", goal: "Fix checkout total",
    scope: { include: ["Checkout calculation"], exclude: ["Deployment"] },
    actor: { agent_id: "agent-a", principal_id: "principal-owner" }, state: "build", dependencies: [],
    acceptance: { criteria: ["Exact cents round correctly"], evidence: [] }, handoff: null,
    verification: { risk_tier: "standard", separation: "distinct-agent", implementer: { agent_id: "agent-a", principal_id: "principal-owner" }, reviewer: null, candidate_revision: null },
    environment: { cwd: ".", read_paths: ["src", "test"], write_paths: ["src/cart.mjs"], tools: ["node"], resources: [],
      network: { mode: "none", hosts: [] }, external_actions: [],
      data: { classification: "internal", model_access: "none", policy_refs: ["docs/data-policy.md"] } },
    authorization: { approved_by: "principal-owner", approval_ref: "docs/work-order.md", operations: ["read", "write", "execute"], expires_at: null },
    skills: [], execution: { runtime: { kind: "host-owned", adapter_id: null, required_features: [] }, model_connection: { kind: "native" } },
    legacy: null
  };
}
function gateway() {
  const doc = contract();
  doc.execution.runtime = { kind: "adapter", adapter_id: "fixture-adapter", required_features: ["tool-results"] };
  doc.execution.model_connection = { kind: "gateway", provider: "litellm", base_url: "http://localhost:4000/v1", model: "configured-model-alias", selection: "fixed", credential_env: "WORKKEEL_GATEWAY_KEY" };
  doc.environment.network = { mode: "allowlist", hosts: ["localhost"] };
  doc.environment.data.model_access = "approved-connection";
  doc.authorization.operations.push("network");
  return doc;
}
const legacy = () => ({ schema_version: "temple.work-item/v1", id: "WI-0001", title: "Fix checkout total", state: "build", owner_position: "developer", assigned_agent_id: "agent-a", scope: ["Checkout"], acceptance_criteria: ["Exact total"], affected_paths: ["src/**"], dependencies: [], evidence: [], claim: null });
const provenance = { sourceRef: ".ai-org/work-items/WI-0001.json", sourceSha256: "a".repeat(64) };

test("role-free native and fixed gateway contracts never grant execution authority", () => {
  for (const document of [contract(), gateway()]) {
    const before = structuredClone(document);
    const result = validateTaskContract(document);
    assert.deepEqual(result.errors, []);
    assert.equal(result.contract_complete, true);
    assert.equal(result.execution_authorized, false);
    assert.equal(result.boundary_enforcement, "not-performed");
    assert.equal(result.provider_contact, false);
    assert.equal(result.mutation_status, "no-write");
    assert.deepEqual(document, before);
  }
});

test("unknown, missing, unsafe and conflicting fields fail closed without echoing secrets", () => {
  const cases = [
    (d) => { d.position_id = "developer"; },
    (d) => { d.capabilities = ["code.change"]; },
    (d) => { delete d.environment; },
    (d) => { d.environment.cwd = "../other"; },
    (d) => { d.environment.write_paths = ["src/**"]; },
    (d) => { d.environment.read_paths = ["/etc"]; },
    (d) => { d.environment.cwd = "C:\\external"; },
    (d) => { d.environment.read_paths = ["src\u0000bad"]; },
    (d) => { d.environment.network.hosts = ["example.com"]; },
    (d) => { d.environment.network = { mode: "allowlist", hosts: ["*.example.com"] }; },
    (d) => { d.authorization.operations = ["read"]; },
    (d) => { d.authorization.approval_ref = "https://example.com/approval"; },
    (d) => { d.dependencies = [d.id]; },
    (d) => { d.execution.runtime.adapter_id = "hidden-adapter"; },
    (d) => { d.execution.model_connection.api_key = "never-print-this-secret"; },
    (d) => { d.state = "maybe-done"; }
  ];
  for (const mutate of cases) {
    const doc = contract(); mutate(doc);
    const result = validateTaskContract(doc);
    assert.equal(result.valid, false, JSON.stringify(doc));
    assert.equal(result.contract_complete, false);
    assert.equal(result.execution_authorized, false);
    assert.ok(!JSON.stringify(result).includes("never-print-this-secret"));
  }
  for (const value of [null, 42, [], {}, "secret"]) assert.equal(validateTaskContract(value).valid, false);
});

test("gateway descriptors require explicit adapter, fixed model and matching boundaries", () => {
  const mutations = [
    (d) => { d.execution.runtime = contract().execution.runtime; },
    (d) => { d.execution.model_connection.base_url = "http://remote.example/v1"; },
    (d) => { d.execution.model_connection.base_url = "https://user:secret@example.com/v1"; },
    (d) => { d.execution.model_connection.base_url = "https://example.com/v1?api_key=secret"; },
    (d) => { d.execution.model_connection.base_url = "not-a-url"; },
    (d) => { d.execution.model_connection.selection = "auto"; },
    (d) => { d.execution.model_connection.credential_env = "some-secret-value"; },
    (d) => { d.environment.network.hosts = ["elsewhere.example"]; },
    (d) => { d.environment.data.model_access = "none"; },
    (d) => { d.authorization.operations = ["read", "write", "execute"]; }
  ];
  for (const mutate of mutations) {
    const doc = gateway(); mutate(doc);
    assert.equal(validateTaskContract(doc).valid, false);
  }
});

test("incomplete and expired descriptors are structurally valid but not complete", () => {
  const doc = contract();
  doc.environment = null; doc.authorization = null; doc.actor = null;
  const result = validateTaskContract(doc);
  assert.equal(result.valid, true);
  assert.equal(result.contract_complete, false);
  assert.deepEqual(result.incomplete_fields, ["actor.principal_id", "environment", "authorization"]);
  const expired = contract(); expired.authorization.expires_at = "2020-01-01T00:00:00.000Z";
  assert.deepEqual(validateTaskContract(expired, { now: new Date("2021-01-01") }).incomplete_fields, ["authorization.expired"]);
});

test("review separation concerns actual actor identifiers, not company titles", () => {
  const doc = contract();
  doc.verification.reviewer = { agent_id: "agent-a", principal_id: "principal-owner" };
  assert.equal(validateTaskContract(doc).valid, false);
  doc.verification.reviewer.agent_id = "agent-b";
  assert.equal(validateTaskContract(doc).valid, true);
  doc.verification.separation = "distinct-principal";
  assert.equal(validateTaskContract(doc).valid, false);
  doc.verification.reviewer.principal_id = "another-owner";
  assert.equal(validateTaskContract(doc).valid, true);
  doc.state = "done";
  assert.equal(validateTaskContract(doc).contract_complete, false);
  doc.verification.risk_tier = "critical";
  doc.verification.separation = "none";
  assert.equal(validateTaskContract(doc).valid, false);
});

test("legacy projection keeps provenance and exact handoff revision but invents no grants", () => {
  const item = legacy();
  item.claim = { status: "released", agent_id: "old-agent", principal_id: "old-owner" };
  item.handoffs = [{ actor: "old-agent", principal_id: "old-owner", input_revision: "b".repeat(40), artifact: ".ai-org/artifacts/WI-0001/handoff.md" }];
  const before = structuredClone(item);
  const result = projectLegacyTask(item, provenance);
  assert.equal(result.valid, true);
  assert.equal(result.contract_complete, false);
  assert.equal(result.contract.environment, null);
  assert.equal(result.contract.authorization, null);
  assert.deepEqual(result.contract.actor, { agent_id: "agent-a", principal_id: null });
  assert.equal(result.contract.handoff.revision, "b".repeat(40));
  assert.equal(result.contract.legacy.owner_position, "developer");
  assert.equal(result.contract.legacy.source_sha256, provenance.sourceSha256);
  assert.deepEqual(item, before);
  item.claim.status = "active";
  assert.equal(projectLegacyTask(item, provenance).contract.actor.principal_id, "old-owner");
  item.risk_tier = "high";
  assert.equal(projectLegacyTask(item, provenance).valid, true);
  assert.equal(projectLegacyTask(item, provenance).contract_complete, false);
  item.state = "unknown";
  assert.equal(projectLegacyTask(item, provenance).valid, false);
  item.schema_version = "unrecognized";
  assert.throws(() => projectLegacyTask(item, provenance), /Unsupported legacy/);
});

test("documented full contract matches the executable schema", async () => {
  const guide = await fs.readFile(new URL("../docs/concepts/task-contract.md", import.meta.url), "utf8");
  const example = JSON.parse([...guide.matchAll(/```json\n([\s\S]*?)\n```/g)][0][1]);
  assert.equal(validateTaskContract(example).contract_complete, true);
});

test("CLI and reader are bounded and read-only without any Position configuration", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-contract-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, ".ai-org/work-items"), { recursive: true });
  const source = JSON.stringify(legacy());
  await fs.writeFile(path.join(root, provenance.sourceRef), source);
  await fs.writeFile(path.join(root, "contract.json"), JSON.stringify(contract()));
  const run = (...args) => spawnSync(process.execPath, [cli, "work-item", ...args], { encoding: "utf8", timeout: 15000 });
  let result = run("contract", root, "--work-item", "WI-0001", "--no-write", "--json");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).contract_complete, false);
  result = run("validate-contract", root, "--source", "contract.json", "--no-write", "--json");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).execution_authorized, false);
  for (const extra of [["--actor", "agent-a"], ["--source", "contract.json"]]) {
    result = run("contract", root, "--work-item", "WI-0001", "--no-write", "--json", ...extra);
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).mutation_status, "not_started");
  }
  result = run("contract", root, "--work-item", "WI-0001", "--json");
  assert.equal(result.status, 1);
  assert.equal(await fs.readFile(path.join(root, provenance.sourceRef), "utf8"), source);
  assert.deepEqual((await fs.readdir(root)).sort(), [".ai-org", "contract.json"]);
  assert.deepEqual(await fs.readdir(path.join(root, ".ai-org")), ["work-items"]);
  await fs.symlink(path.join(root, "contract.json"), path.join(root, "linked.json"));
  await fs.symlink(path.join(root, ".ai-org"), path.join(root, "linked-dir"));
  for (const ref of ["../outside.json", "/etc/passwd", "linked.json", "linked-dir/work-items/WI-0001.json", ".ai-org"]) {
    await assert.rejects(readTaskContractInput(root, ref));
  }
  await fs.writeFile(path.join(root, "oversized.json"), " ".repeat(1024 * 1024 + 1));
  await assert.rejects(readTaskContractInput(root, "oversized.json"), /at most 1 MiB/);
  await fs.writeFile(path.join(root, "bad.json"), '{"secret": "never-print-this-secret"');
  await assert.rejects(readTaskContractInput(root, "bad.json"), /^Error: Contract input is not valid JSON$/);
  await fs.writeFile(path.join(root, "bad-utf8.json"), Buffer.from([0xff]));
  await assert.rejects(readTaskContractInput(root, "bad-utf8.json"), /not valid UTF-8/);
  const item = legacy(); item.id = "WI-0002";
  await fs.writeFile(path.join(root, provenance.sourceRef), JSON.stringify(item));
  await assert.rejects(inspectLegacyTaskContract(root, "WI-0001"), /does not match/);
});
