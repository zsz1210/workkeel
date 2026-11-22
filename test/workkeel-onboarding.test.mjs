import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";
import { initializeTaskProject } from "../src/workkeel-project.mjs";
import { previewInstructions, applyInstructions } from "../src/workkeel-onboarding.mjs";
import { auditSkillUse } from "../src/workkeel-skill-audit.mjs";

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
  const claude = await fs.readFile(path.join(root, "CLAUDE.md"), "utf8");
  assert.match(claude, /<!-- workkeel:begin -->\n@AGENTS\.md\n<!-- workkeel:end -->/); assert.doesNotMatch(claude, /@WORKKEEL\.md/);
  assert.equal((await previewInstructions(root)).files.length, 0);
  const again = await previewInstructions(root);
  assert.equal((await applyInstructions(root, again.fingerprint)).mutation_status, "already-applied");
});
test("an earlier generated CLAUDE.md block is upgraded in place; edited blocks stay manual", async t => {
  const root = await fixture(t);
  const previous = "<!-- workkeel:begin -->\n@WORKKEEL.md\n\nUse this project's AGENTS.md instructions when present. Match and read applicable Skills before acting; report applied steps and verification, not merely which files were read.\n<!-- workkeel:end -->";
  await fs.writeFile(path.join(root, "CLAUDE.md"), `# Mine\n\n${previous}\n\nKeep this.\n`);
  const preview = await previewInstructions(root), claude = preview.files.find(file => file.path === "CLAUDE.md");
  assert.equal(claude.upgrade, "replaces-previous-workkeel-block");
  await applyInstructions(root, preview.fingerprint);
  assert.equal(await fs.readFile(path.join(root, "CLAUDE.md"), "utf8"), "# Mine\n\n<!-- workkeel:begin -->\n@AGENTS.md\n<!-- workkeel:end -->\n\nKeep this.\n");
  await fs.writeFile(path.join(root, "CLAUDE.md"), "<!-- workkeel:begin -->\n@AGENTS.md edited\n<!-- workkeel:end -->\n");
  await assert.rejects(previewInstructions(root), /review it manually/);
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
