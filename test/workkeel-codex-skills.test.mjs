import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { codexSkillPolicy, assertCodexSkills } from "../src/workkeel-codex-host.mjs";
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
  const policy = await codexSkillPolicy(rpc, root), disabled = policy.disabledPaths;
  assert.deepEqual(disabled, skills.slice(1).map(s => s.path));
  assert.deepEqual(policy.enabledPaths, [skills[0].path]);
  for (const skill of skills) if (disabled.includes(skill.path)) skill.enabled = false;
  await assertCodexSkills(rpc, root, policy);
  assert.equal(skills[0].enabled, true);
  // A read-only source is still usable. No Skill body needs to be copied.
  await fs.chmod(skills[0].path, 0o444);
  await assertCodexSkills(rpc, root, policy);
});

test("ignored disable overrides and catalogue drift fail before dispatch", async t => {
  const {root, skills, rpc} = await fixture(t);
  const policy = await codexSkillPolicy(rpc, root), disabled = policy.disabledPaths;
  await assert.rejects(assertCodexSkills(rpc, root, policy), /enabled out-of-scope/);
  for (const skill of skills) if (disabled.includes(skill.path)) skill.enabled = false;
  skills[1].enabled = true; // An inherited disabled project Skill must not be reenabled.
  await assert.rejects(assertCodexSkills(rpc, root, policy), /disabled Skill/);
  skills[1].enabled = false;
  skills.push({path:path.join(path.dirname(root), "new-external/SKILL.md"), enabled:true});
  await assert.rejects(assertCodexSkills(rpc, root, policy), /out-of-scope/);
  skills.pop();
  await fs.unlink(skills[0].path);
  await assert.rejects(assertCodexSkills(rpc, root, policy), /out-of-scope/);
});

test("original enabled project Skills must remain present and enabled before dispatch", async t => {
  const {root, skills, rpc} = await fixture(t);
  const policy = await codexSkillPolicy(rpc, root);
  for (const skill of skills) if (policy.disabledPaths.includes(skill.path)) skill.enabled = false;
  skills[0].enabled = false;
  await assert.rejects(assertCodexSkills(rpc, root, policy), /lost an enabled project Skill/);
  const local = skills.shift();
  await assert.rejects(assertCodexSkills(rpc, root, policy), /lost an enabled project Skill/);
  skills.push({...local,enabled:true});
  await assertCodexSkills(rpc, root, policy); // Order is not part of the contract.
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
    await assert.rejects(codexSkillPolicy(rpc, root), /incomplete or invalid/);
    await assert.rejects(assertCodexSkills(rpc, root, {disabledPaths:[],enabledPaths:[]}), /incomplete or invalid/);
  }
  assert.deepEqual(await codexSkillPolicy({request:async()=>({data:[valid]})}, root), {disabledPaths:[],enabledPaths:[]});
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
