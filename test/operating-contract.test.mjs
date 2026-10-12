import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fixture, cli, deliveryArgs } from "./helpers/lean-delivery-fixture.mjs";
import { enterWorkItemContext } from "../src/context-enter.mjs";
import { planUpgrade, executeUpgrade } from "../src/upgrade.mjs";
import { sha256 } from "../src/files.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = (f, position = "developer", extra = {}) => enterWorkItemContext(f.target, {
  workItemId: f.item.id, position, agentId: position === "developer" ? f.request.agentId : f.qualityAgent,
  principalId: "human", ...extra
});

test("installed whole contract and triggered procedures reach both cold delivery actors", async t => {
  const f = await fixture(); t.after(f.cleanup);
  const contract = await fs.readFile(path.join(f.target, "TEMPLE.md"), "utf8");
  assert.equal(contract, await fs.readFile(path.join(root, "project-overlay/TEMPLE.md"), "utf8"));
  // Reachability is structural, not evidence that a model recognizes a trigger.
  const references = [...contract.matchAll(/\]\(([^)]+)\)/g)].map(m => m[1]);
  assert.ok(references.length > 0);
  for (const ref of references) {
    assert.ok(!path.isAbsolute(ref) && !ref.startsWith("../"));
    assert.ok((await fs.stat(path.join(f.target, ref))).isFile(), ref);
  }
  // Preserve conditional entrypoints too, not just the currently selected Lean
  // procedure. QA found that a valid post-init route can hide a missing pre-init one.
  for (const skill of ["temple-init", "temple-work", "decision-interview",
    "domain-modeling", "project-documentation", "skill-authoring"]) {
    assert.ok(references.includes(`.agents/skills/${skill}/SKILL.md`), skill);
  }
  const normalized = contract.replace(/\s+/g, " ");
  assert.match(normalized, /First initialization.*temple-init.*before writes.*combined confirmation.*existing-file conflicts/);
  assert.match(normalized, /If scope, risk or ownership changes, stop the narrow path before further mutation and resolve the applicable route/);
  const agents = await fs.readFile(path.join(f.target, "AGENTS.md"), "utf8");
  assert.match(agents, /explicit routes with `--context-ref`/);
  const workSkill = await fs.readFile(path.join(f.target, ".agents/skills/temple-work/SKILL.md"), "utf8");
  assert.match(workSkill, /Release ownership on handoff or abandonment, after applicable worker cleanup/);
  for (const position of ["developer", "quality_evaluator"]) {
    if (position === "quality_evaluator") cli(deliveryArgs(f));
    const result = await entry(f, position);
    assert.equal(result.status, "eligible");
    assert.equal(result.navigation.authorization_granted, false);
    for (const name of ["TEMPLE.md", "AGENTS.md", ".agents/skills/temple-work/SKILL.md",
      ".agents/skills/temple-work/references/lean-execution.md"]) {
      const source = result.packet.sources.find(s => s.path === name);
      assert.equal(source.representation, "whole-source", name);
      assert.equal(source.body, await fs.readFile(path.join(f.target, name), "utf8"), name);
    }
  }
});

test("older whole instructions survive entry and upgrade respects exact ownership", async t => {
  const f = await fixture(); t.after(f.cleanup);
  const file = path.join(f.target, "TEMPLE.md"), lockFile = path.join(f.target, "temple.lock");
  const current = await fs.readFile(file, "utf8");
  const agentsFile = path.join(f.target, "AGENTS.md");
  const customAgents = (await fs.readFile(agentsFile, "utf8")) + "\nProject-owned instruction: preserve this text.\n";
  await fs.writeFile(agentsFile, customAgents);
  // Synthetic older installation, only in this disposable fixture. Real-project
  // lock rewriting is not an upgrade strategy. No Git history required by CI.
  const older = "# Older operating contract\nAn independently required whole-source rule must remain visible.\n";
  const lock = JSON.parse(await fs.readFile(lockFile, "utf8"));
  const managed = lock.managed_files.find(s => s.path === "TEMPLE.md");
  assert.ok(managed);
  managed.sha256 = sha256(Buffer.from(older));
  await fs.writeFile(file, older); await fs.writeFile(lockFile, JSON.stringify(lock, null, 2));
  const before = await entry(f);
  assert.equal(before.status, "eligible");
  assert.equal(before.packet.sources.find(s => s.path === "TEMPLE.md").body, older);
  const plan = await planUpgrade(f.target);
  assert.deepEqual(plan.conflicts, []);
  assert.ok(plan.actions.some(a => a.path === "TEMPLE.md" && a.type === "update-managed"));
  await executeUpgrade(plan);
  assert.equal(await fs.readFile(file, "utf8"), current);
  assert.equal(await fs.readFile(agentsFile, "utf8"), customAgents);
  await assert.rejects(entry(f, "developer", { expectedPlan: before.entry_digest }), { code: "STALE_PREVIEW" });

  await fs.writeFile(file, current + "\nUser edit: must not be overwritten.\n");
  const changed = await planUpgrade(f.target);
  assert.ok(changed.conflicts.some(s => /managed file changed.*TEMPLE.md/.test(s)));
  await assert.rejects(executeUpgrade(changed), /Upgrade stopped/);
  assert.match(await fs.readFile(file, "utf8"), /User edit/);
  const untrackedLock = JSON.parse(await fs.readFile(lockFile, "utf8"));
  untrackedLock.managed_files = untrackedLock.managed_files.filter(s => s.path !== "TEMPLE.md");
  await fs.writeFile(lockFile, JSON.stringify(untrackedLock, null, 2));
  const untracked = await planUpgrade(f.target);
  assert.ok(untracked.conflicts.some(s => /untracked file blocks.*TEMPLE.md/.test(s)));
  await assert.rejects(executeUpgrade(untracked), /Upgrade stopped/);
  assert.equal(await fs.readFile(agentsFile, "utf8"), customAgents);
});
