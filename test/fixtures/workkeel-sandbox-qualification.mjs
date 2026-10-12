// Manual, model-free qualification of the pinned Codex permission-profile wire.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createJsonRpcProcess } from "../../src/codex-app-server-provider.mjs";
import { codexPermissionsForContract, codexPermissionProfileArgs } from "../../src/workkeel-codex-runtime.mjs";
import { durableAtomicCreate, formatJson, sha256 } from "../../src/files.mjs";

if (!process.argv[2]) throw new Error("A fresh report path is required");
const reportPath = path.resolve(process.argv[2]);
await fs.lstat(reportPath).then(() => { throw new Error("Report already exists; choose a fresh path"); }, error => { if (error.code !== "ENOENT") throw error; });
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-sandbox-")));
const project = path.join(root, "project");
await fs.mkdir(path.join(project, "src"), { recursive: true });
await fs.mkdir(path.join(project, ".ai-org/execution"), { recursive: true });
await fs.writeFile(path.join(project, "src/input.txt"), "allowed synthetic input");
await fs.writeFile(path.join(project, ".ai-org/execution/private.txt"), "synthetic journal");
await fs.writeFile(path.join(project, "workkeel.lock"), "synthetic authority");
await fs.writeFile(path.join(project, "approval.md"), "synthetic approval");
await fs.writeFile(path.join(root, "outside.txt"), "out-of-scope synthetic input");
let connections = 0;
const server = http.createServer((request, response) => { connections++; response.end("unexpected network access"); });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const profile = await codexPermissionsForContract(project, { authorization: { approval_ref: "approval.md" }, environment: { read_paths: ["."], write_paths: ["."] } });
const id = `workkeel-${crypto.randomUUID()}`;
const rpc = createJsonRpcProcess("codex", ["app-server", "--stdio", ...codexPermissionProfileArgs({ id, profile }), "-c", "allow_login_shell=false"], { cwd: project });
const report = { schema_version: "workkeel.sandbox-qualification/v1", at: new Date().toISOString(), model_turns: 0, fixture_path: root, cases: [], outcome: "fail",
  environment: { platform: process.platform, node: process.version, codex: execFileSync("codex", ["--version"], { encoding: "utf8", timeout: 5000 }).trim() },
  runtime_sha256: sha256(await fs.readFile(new URL("../../src/workkeel-codex-runtime.mjs", import.meta.url))) };
try {
  await rpc.request("initialize", { clientInfo: { name: "workkeel-sandbox-qualification", version: "1" }, capabilities: { experimentalApi: true } }); rpc.notify("initialized");
  for (const [name, command, expected] of [
    ["approved-read", ["/bin/cat", path.join(project, "src/input.txt")], true],
    ["outside-read", ["/bin/cat", path.join(root, "outside.txt")], false],
    ["runner-journal-read", ["/bin/cat", path.join(project, ".ai-org/execution/private.txt")], false],
    ["approved-write", ["/usr/bin/touch", path.join(project, "src/output.txt")], true],
    ["outside-write", ["/usr/bin/touch", path.join(root, "outside-write.txt")], false],
    ["authority-write", ["/usr/bin/touch", path.join(project, ".ai-org/authority.txt")], false],
    ["task-policy-write", ["/usr/bin/touch", path.join(project, "workkeel.lock")], false],
    ["approval-write", ["/usr/bin/touch", path.join(project, "approval.md")], false],
    ["network", ["/usr/bin/curl", "--max-time", "2", `http://127.0.0.1:${server.address().port}`], false]
  ]) {
    const result = await rpc.request("command/exec", { command, cwd: project, permissionProfile: id, timeoutMs: 3000, outputBytesCap: 2048 });
    report.cases.push({ name, exit_code: result.exitCode, expected_success: expected, pass: (result.exitCode === 0) === expected });
  }
  report.network_connections = connections;
  report.outcome = report.cases.every(entry => entry.pass) && connections === 0 ? "pass" : "fail";
} catch (error) { report.failure = { message: error.message, protocol_reason: error.providerReason ?? null }; }
finally {
  await rpc.close(); await new Promise(resolve => server.close(resolve));
  await durableAtomicCreate(reportPath, formatJson(report)); console.log(JSON.stringify(report));
  if (report.outcome !== "pass") process.exitCode = 1;
}
