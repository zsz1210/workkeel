import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixture } from "./helpers/lean-delivery-fixture.mjs";
import { planUpgrade, executeUpgrade } from "../src/upgrade.mjs";
import { runDoctor } from "../src/doctor.mjs";
import { buildStatus } from "../src/status.mjs";
import { sha256 } from "../src/files.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const support = ".agents/skills/temple-work/references/read-only-support.md";
const read = relative => fs.readFile(path.join(root, "project-overlay", relative), "utf8");

test("instruction contract distinguishes support, sequential delivery and governed workers (not a model evaluation)", async () => {
  const helper = await read(support);
  for (const boundary of [/no project or canonical writes/, /no delegation, model or spending authority/,
    /no independent delivery or formal verification/, /no declared scarce shared resources/,
    /if that boundary cannot be maintained, do not dispatch/, /Never relabel an already reserved/,
    /not acceptance, Independent QA/, /source\/revision references/, /Native entrypoint\/bootstrap/]) {
    assert.match(helper, boundary);
  }
  const skill = await read(".agents/skills/temple-work/SKILL.md");
  assert.match(skill, /references\/read-only-support\.md/);
  assert.match(skill, /sequential delivery does not require parallel preparation/);
  assert.match(skill, /Failed diagnostics remain unresolved/);
  assert.match(skill, /historical receipts are not fresh verification/);
  assert.match(skill, /Mandatory project tests remain required/);
  assert.match(await read("TEMPLE.md"), /Sequential delivery:[\s\S]+Governed parallel delivery only:/);
  assert.match(await read("AGENTS.md"), /read-only-support reference/);
  assert.match(await read("AGENTS.md"), /Before governed parallel execution/);
});

test("init and upgrade distribute the helper and preserve project-owned content", async t => {
  const f = await fixture();
  t.after(f.cleanup);
  const expected = await read(support);
  assert.equal(await fs.readFile(path.join(f.target, support), "utf8"), expected);
  const lock = JSON.parse(await fs.readFile(path.join(f.target, "temple.lock"), "utf8"));
  assert.equal(lock.managed_files.find(entry => entry.path === support)?.sha256, sha256(expected));
  const custom = path.join(f.target, ".agents/skills/local-review/SKILL.md");
  await fs.mkdir(path.dirname(custom), { recursive: true });
  const local = "---\nname: local-review\ndescription: Inspect this fixture only.\n---\nReturn findings without mutation.\n";
  await fs.writeFile(custom, local);
  // Synthetic older installation: it predates the new managed support reference.
  await fs.unlink(path.join(f.target, support));
  lock.managed_files = lock.managed_files.filter(entry => entry.path !== support);
  await fs.writeFile(path.join(f.target, "temple.lock"), JSON.stringify(lock));
  await executeUpgrade(await planUpgrade(f.target));
  assert.equal(await fs.readFile(custom, "utf8"), local);
  assert.equal(await fs.readFile(path.join(f.target, support), "utf8"), expected);
  const doctor = await runDoctor(f.target);
  assert.equal(doctor.summary.fail, 0, JSON.stringify(doctor));
  const status = await buildStatus(f.target);
  assert.ok(status);
});
