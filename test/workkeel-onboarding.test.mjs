import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";
import { initializeTaskProject } from "../src/workkeel-project.mjs";
import { previewInstructions, applyInstructions } from "../src/workkeel-onboarding.mjs";
import { auditSkillUse } from "../src/workkeel-skill-audit.mjs";
import { workkeelToolView, workkeelOriginal, workflowToolView } from "../src/workkeel-headroom.mjs";
import { sha256 } from "../src/files.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-onboarding-"));
  t.after(() => fs.rm(root, { force: true, recursive: true }));
  execFileSync("git", ["-C", root, "init", "-q"]);
  await initializeTaskProject(root, { schema_version: "workkeel.task-policy/v1", principals: ["owner"],
    agents: [{ agent_id: "builder", principal_id: "owner" }], approvers: ["owner"], review_separation: "distinct-agent" });
  return root;
}
test("instruction preview preserves existing bytes, rejects drift, imports WORKKEEL and is idempotent", async t => {
  const root = await fixture(t);
  const original = "\ufeff# My instructions\r\nKeep these bytes!";
  await fs.writeFile(path.join(root, "AGENTS.md"), original);
  const preview = await previewInstructions(root);
  assert.equal(preview.files.length, 2);
  assert.equal(await fs.readFile(path.join(root, "AGENTS.md"), "utf8"), original);
  await fs.writeFile(path.join(root, "CLAUDE.md"), "User-owned instructions");
  await assert.rejects(applyInstructions(root, preview.fingerprint), /changed/);
  const fresh = await previewInstructions(root);
  await applyInstructions(root, fresh.fingerprint);
  assert.ok((await fs.readFile(path.join(root, "AGENTS.md"), "utf8")).startsWith(original));
  assert.match(await fs.readFile(path.join(root, "CLAUDE.md"), "utf8"), /@WORKKEEL.md/);
  assert.equal((await previewInstructions(root)).files.length, 0);
  const again = await previewInstructions(root);
  assert.equal((await applyInstructions(root, again.fingerprint)).mutation_status, "already-applied");
});
test("new source launcher does not silently fetch an unpublished package", async t => {
  const root = await fixture(t);
  const env = { ...process.env }; delete env.WORKKEEL_CLI_PATH; delete env.WORKKEEL_ALLOW_PACKAGE_FETCH;
  const output = spawnSync(process.execPath, [path.join(root, "workkeelw.mjs"), "status"], { env, encoding: "utf8" });
  assert.equal(output.status, 1); assert.match(output.stderr, /No download was attempted/);
});
test("Skill audit catches missing, unexpected, unread and unapplied choices without claiming quality", async t => {
  const root = await fixture(t);
  const skill = ".agents/skills/readme/SKILL.md";
  await fs.mkdir(path.dirname(path.join(root, skill)), { recursive: true });
  await fs.writeFile(path.join(root, skill), "Use for README writing; not status-only checks.");
  // Explicitly named and description-triggered cases share the same reviewed
  // expectation; this audits selection, not a model's language understanding.
  for (const reason of ["explicit", "implicit-readme-task"]) {
    const report = await auditSkillUse(root, { expected: [skill], selected: [], records: [] });
    assert.equal(report.issues[0].code, "missing-selection", reason);
  }
  const unrelated = await auditSkillUse(root, { expected: [], selected: [skill], records: [] });
  assert.deepEqual(unrelated.issues.map(i => i.code), ["unexpected-selection", "reading-not-recorded", "application-not-evidenced", "verification-not-evidenced"]);
  const statusOnly = await auditSkillUse(root, { expected: [], selected: [], records: [] });
  assert.equal(statusOnly.records_complete, true);
  const applied = await auditSkillUse(root, { expected: [skill], selected: [skill], records: [{ skill, read_complete: true,
    application_evidence: ["WORKKEEL.md"], verification_evidence: ["WORKKEEL.md"] }] });
  assert.equal(applied.records_complete, true); assert.equal(applied.quality_verified, false);
});
test("native Headroom preserves instructions and exact original bytes, including BOM", async t => {
  const root = await fixture(t); let calls = 0;
  const request = { input: "WORKKEEL.md", kind: "json", mode: "lossless", snapshot: ".ai-org/artifacts/WK-one/headroom/original.json", python_env: null };
  const protectedView = await workkeelToolView(root, request, { runWorker: async () => { calls++; } });
  assert.equal(protectedView.diagnostics.reason, "protected-source"); assert.equal(calls, 0);
  const text = "\ufeff日本語\r\nexact bytes";
  await fs.writeFile(path.join(root, "tool.txt"), text);
  const raw = await workkeelToolView(root, { ...request, input: "tool.txt", kind: "log", mode: "off" });
  assert.equal(raw.text, text);
});
test("planned lossless policy verifies values, stores original and falls back on worker failure", async t => {
  const root = await fixture(t);
  const rows = Array.from({ length: 400 }, (_, id) => ({ id, detail: `unique-detail-${id}` }));
  const source = JSON.stringify(rows, null, 2), compact = JSON.stringify(rows);
  await fs.writeFile(path.join(root, "tool.json"), source);
  const contract = { id: "WK-one", skills: [], authorization: { approval_ref: "approval.md" },
    environment: { read_paths: ["."], data: { policy_refs: ["policy.json"] } } };
  const context = { target: root, contract, policy: { headroom: { mode: "lossless" } } };
  const request = { input: "tool.json", kind: "json", snapshot: ".ai-org/artifacts/WK-one/headroom/original.json", python_env: null };
  const runWorker = async data => {
    const text = JSON.stringify({ content: compact, readback: data.modelReadback });
    return { version: "0.37.0", tokenizer_version: "0.14.0", original_sha256: sha256(source), content: compact,
      transforms: ["offline-fixture"], input_tokens: 6000, output_tokens: 4000, model_payload: { text, sha256: sha256(text), tokens: 4100 } };
  };
  const compressed = await workflowToolView(context, request, { runWorker });
  assert.equal(compressed.diagnostics.status, "compressed");
  assert.equal((await workkeelOriginal(root, { input: request.snapshot, sha256: sha256(source) })).content, source);
  const failed = await workflowToolView(context, { ...request, snapshot: ".ai-org/artifacts/WK-one/headroom/failure.json" }, { runWorker: async () => { throw new Error("offline"); } });
  assert.equal(failed.text, source); assert.equal(failed.diagnostics.reason, "worker-unavailable");
  context.policy.headroom.mode = "off";
  const disabled = await workflowToolView(context, request, { runWorker: async () => { throw new Error("should not run"); } });
  assert.equal(disabled.diagnostics.metrics.worker_attempts, 0);
  await fs.writeFile(path.join(root, "policy.json"), source);
  assert.equal((await workflowToolView(context, { ...request, input: "policy.json" })).diagnostics.reason, "protected-task-authority");
});
