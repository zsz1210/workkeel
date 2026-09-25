import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { codexSkillDisables, assertCodexSkills } from "../src/workkeel-codex-host.mjs";
import { codexPermissionsForContract } from "../src/workkeel-codex-runtime.mjs";

async function fixture(t) {
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "workkeel-skills-")));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, "project");
  const files = ["project/.agents/skills/local/SKILL.md", "project/disabled/SKILL.md", "external/SKILL.md",
    "project-other/SKILL.md", "project/.ai-org/execution/secret/SKILL.md"];
  for (const file of files) {
    await fs.mkdir(path.dirname(path.join(temp, file)), { recursive: true });
    await fs.writeFile(path.join(temp, file), "Synthetic Skill body");
  }
  await fs.symlink(path.join(temp, "external"), path.join(root, "linked"));
  await fs.symlink(path.join(root, ".agents/skills/local/SKILL.md"), path.join(root, "linked-file"));
  const skills = [...files.map(file => ({path: path.join(temp, file), enabled: !file.includes("disabled")})),
    ...["linked/SKILL.md", "linked-file", "absent/SKILL.md", "disabled"].map(file => ({path: path.join(root, file), enabled: true}))];
  const rpc = { request: async (method, params) => {
    assert.equal(method, "skills/list"); assert.deepEqual(params, {cwds:[root], forceReload:true});
    return {data:[{cwd:root, errors:[], skills}]};
  }};
  return {root, skills, rpc};
}

test("automatic routing preserves readable project Skills and suppresses only unavailable or disabled entries", async t => {
  const {root, skills, rpc} = await fixture(t);
  const disabled = await codexSkillDisables(rpc, root);
  assert.deepEqual(disabled, skills.slice(1).map(s => s.path));
  for (const skill of skills) if (disabled.includes(skill.path)) skill.enabled = false;
  await assertCodexSkills(rpc, root, disabled);
  assert.equal(skills[0].enabled, true);
  // A read-only source is still usable. No Skill body needs to be copied.
  await fs.chmod(skills[0].path, 0o444);
  await assertCodexSkills(rpc, root, disabled);
});

test("ignored disable overrides and catalogue drift fail before dispatch", async t => {
  const {root, skills, rpc} = await fixture(t);
  const disabled = await codexSkillDisables(rpc, root);
  await assert.rejects(assertCodexSkills(rpc, root, disabled), /enabled out-of-scope/);
  for (const skill of skills) if (disabled.includes(skill.path)) skill.enabled = false;
  skills[1].enabled = true; // An inherited disabled project Skill must not be reenabled.
  await assert.rejects(assertCodexSkills(rpc, root, disabled), /disabled Skill/);
  skills[1].enabled = false;
  skills.push({path:path.join(path.dirname(root), "new-external/SKILL.md"), enabled:true});
  await assert.rejects(assertCodexSkills(rpc, root, disabled), /out-of-scope/);
  skills.pop();
  await fs.unlink(skills[0].path);
  await assert.rejects(assertCodexSkills(rpc, root, disabled), /out-of-scope/);
});

test("incomplete, malformed and ambiguous catalogues are not silently treated as empty", async t => {
  const {root, skills} = await fixture(t);
  const valid = {cwd:root, errors:[], skills:[]};
  for (const data of [undefined, [], [valid,valid], [{...valid,cwd:root+'-other'}],
    [{...valid,errors:[{message:'unreadable'}]}], [{...valid,skills:null}],
    [{...valid,skills:[null]}], [{...valid,skills:[{path:'relative',enabled:true}]}],
    [{...valid,skills:[{path:root+'/../SKILL.md',enabled:true}]}],
    [{...valid,skills:[{path:root+'/SKILL.md'}]}], [{...valid,skills:[skills[0],skills[0]]}]]) {
    const rpc = {request:async()=>({data})};
    await assert.rejects(codexSkillDisables(rpc, root), /incomplete or invalid/);
    await assert.rejects(assertCodexSkills(rpc, root, []), /incomplete or invalid/);
  }
  assert.deepEqual(await codexSkillDisables({request:async()=>({data:[valid]})}, root), []);
});

test("named Skills remain validated in-project requirements and never expand the sandbox", async t => {
  const {root, skills} = await fixture(t);
  const contract = {environment:{read_paths:['.'],write_paths:[]},skills:['.agents/skills/local/SKILL.md']};
  const profile = await codexPermissionsForContract(root, contract);
  assert.equal(profile.filesystem[skills[0].path], 'read');
  assert.equal(profile.filesystem[':root'], 'deny');
  assert.equal(profile.filesystem[path.join(root,'.ai-org/execution')], 'deny');
  assert.equal(profile.network.enabled, false);
  for (const ref of ['absent/SKILL.md','../external/SKILL.md','linked/SKILL.md','linked-file']) {
    await assert.rejects(codexPermissionsForContract(root, {...contract,skills:[ref]}));
  }
});
