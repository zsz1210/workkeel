// Manual opt-in qualification. Never loaded by the automatic test suite.
// Uses the signed-in ChatGPT subscription, at most two workflow dispatches.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { initializeTaskProject } from "../../src/workkeel-project.mjs";
import { createNativeTask, mutateNativeTask } from "../../src/workkeel-tasks.mjs";
import { createLocalCodexSubscriptionRuntime } from "../../src/workkeel-codex-host.mjs";
import { executeWorkflow } from "../../src/workkeel-workflows.mjs";
import { formatJson, sha256, durableAtomicCreate } from "../../src/files.mjs";

if (process.argv[2] !== "--use-subscription" || !process.argv[3]) throw new Error("Explicit --use-subscription and a fresh report path are required");
const reportPath = path.resolve(process.argv[3]);
await fs.lstat(reportPath).then(() => { throw new Error("Report already exists; choose a fresh path before spending subscription allowance"); }, error => { if (error.code !== "ENOENT") throw error; });
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-subscription-")));
const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const actor = { agent_id: "builder", principal_id: "owner" };
const started = performance.now();
const report = { schema_version: "workkeel.subscription-qualification/v1", at: new Date().toISOString(),
  environment: { platform: process.platform, node: process.version, codex: execFileSync("codex", ["--version"], { encoding: "utf8", timeout: 5000 }).trim() }, workflow_dispatch_limit: 2,
  mode: "live-chatgpt-subscription", api_key_used: false, dollars: null, outcome: "not-completed", elapsed_ms: null,
  code_sha256: {}, observations: [], limitations: ["One synthetic local task; not production readiness or comparative quality/cost evidence.",
    "Runtime-confirmed model is distinct from an independently observed backend model.", "No subscription quota-to-dollar conversion is available."] };
for (const name of ["workkeel-codex-host.mjs", "workkeel-codex-runtime.mjs", "workkeel-workflows.mjs", "workkeel-checkpoints.mjs", "workkeel-execution-policy.mjs"]) {
  report.code_sha256[name] = sha256(await fs.readFile(new URL(`../../src/${name}`, import.meta.url)));
}
try {
  git("init", "-q"); git("config", "user.name", "Workkeel qualification"); git("config", "user.email", "qualification@example.invalid");
  await initializeTaskProject(root, { schema_version: "workkeel.task-policy/v1", principals: ["owner"], agents: [actor], approvers: ["owner"], review_separation: "distinct-agent" });
  await fs.mkdir(path.join(root, "src")); await fs.mkdir(path.join(root, "docs"));
  await fs.writeFile(path.join(root, "src/input.txt"), "workkeel bounded subscription test\n");
  await fs.writeFile(path.join(root, "docs/approval.md"), "Maintainer authorized bounded Codex subscription qualification: two turns, Luna then Sol, synthetic local data, no publishing or external tools.");
  const policy = { schema_version: "workkeel.execution-policy/v1", models: [
    { id: "luna", connection: { kind: "codex-subscription", model: "gpt-6-luna", effort: "low" }, data_classes: ["public"] },
    { id: "sol", connection: { kind: "codex-subscription", model: "gpt-6-sol", effort: "low" }, data_classes: ["public"] }],
    default_model: "sol", rules: [{ id: "small-read", nodes: ["read"], model: "luna" }],
    limits: { steps: 2, attempts_per_node: 1, parallelism: 1, timeout_ms: 180000, max_cost_usd: null }, headroom: { mode: "off" } };
  const definition = { schema_version: "workkeel.workflow/v1", nodes: [
    { id: "read", kind: "runtime", write_paths: [], input: "Use a shell tool to read src/input.txt. Do not write files or use network. Return its exact text and nothing else." },
    { id: "write", kind: "runtime", write_paths: ["src"], input: "Use the text returned by the previous read node. Use a shell tool to create src/output.txt with the uppercase version of that text and one final newline. Do not modify other files. Reply DONE." }],
    edges: [{ from: "start", to: "read" }, { from: "read", to: "write" }, { from: "write", to: "end" }] };
  await fs.writeFile(path.join(root, "docs/policy.json"), formatJson(policy));
  await fs.writeFile(path.join(root, "docs/workflow.json"), formatJson(definition));
  const contract = { schema_version: "workkeel.task-contract/v1", id: "WK-subscription", goal: "Verify selected subscription models with bounded real tools", state: "intake", actor,
    scope: { include: ["Read input and create uppercase output"], exclude: ["External actions", "User projects"] }, dependencies: [],
    acceptance: { criteria: ["Output exactly matches uppercase source"], evidence: [] }, handoff: null,
    verification: { risk_tier: "standard", separation: "distinct-agent", implementer: null, reviewer: null, candidate_revision: null },
    environment: { cwd: ".", read_paths: ["."], write_paths: ["src"], tools: ["codex"], resources: [], network: { mode: "none", hosts: [] }, external_actions: [],
      data: { classification: "public", model_access: "approved-connection", policy_refs: ["docs/approval.md", "docs/policy.json", "docs/workflow.json"] } },
    authorization: { approved_by: "owner", approval_ref: "docs/approval.md", operations: ["read", "write", "execute"], expires_at: new Date(Date.now() + 600000).toISOString() }, skills: [],
    execution: { runtime: { kind: "adapter", adapter_id: "codex-app-server", required_features: ["filesystem-sandbox", "network-disabled", "fixed-model"] }, model_connection: { kind: "policy", policy_ref: "docs/policy.json" } }, legacy: null };
  git("add", "."); git("commit", "-qm", "Synthetic subscription qualification");
  await createNativeTask(root, contract, { operation_id: "create", expected_version: 0, actor });
  const claim = await mutateNativeTask(root, contract.id, "claim", { operation_id: "claim", expected_version: 1, actor, base_revision: git("rev-parse", "HEAD") });
  const runtime = await createLocalCodexSubscriptionRuntime(root);
  const run = await executeWorkflow(root, { run_id: "subscription-check", task_id: contract.id, actor, claim_id: claim.claim.id,
    policy_ref: "docs/policy.json", workflow_ref: "docs/workflow.json" }, { adapters: [runtime] });
  const output = await fs.readFile(path.join(root, "src/output.txt"), "utf8");
  assert.equal(output, "WORKKEEL BOUNDED SUBSCRIPTION TEST\n");
  assert.equal(run.status.state, "completed");
  report.outcome = "pass"; report.output_sha256 = sha256(output); report.dispatches = run.status.dispatches; report.usage = run.status.usage;
} catch (error) {
  report.outcome = "fail";
  // Do not retain provider exception payloads, account identities or prompts.
  report.failure = error.message.startsWith("Codex") || error.message.startsWith("Local subscription") ? error.message : error.name;
  report.protocol_code = error.rpcCode ?? null;
  report.experimental_protocol_rejected = /experimental|permissionProfile|permissions/i.test(error.providerReason ?? "");
  if ([-32600, -32601, -32602].includes(error.rpcCode)) report.protocol_reason = error.providerReason;
  process.exitCode = 1;
} finally {
  const journal = path.join(root, ".ai-org/execution/subscription-check/operations");
  for (const name of await fs.readdir(journal).catch(() => [])) {
    const { value } = JSON.parse(await fs.readFile(path.join(journal, name), "utf8"));
    report.observations.push({ node: value.node, requested_model: value.requested_model,
      selection_reason: value.selection_reason, runtime_model: value.result?.runtime_model ?? null,
      observed_model: value.result?.observed_model ?? null, status: value.result?.status ?? "uncertain",
      usage: value.result?.usage ?? null });
  }
  report.elapsed_ms = performance.now() - started;
  report.fixture_path = root;
  await durableAtomicCreate(reportPath, formatJson(report));
  console.log(JSON.stringify(report));
  // Preserve synthetic fixtures, including failed journals, for diagnosis.
}
