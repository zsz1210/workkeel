import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readStartGuide, applyInstructions} from '../src/workkeel-onboarding.mjs';
import {initializeTaskProject} from '../src/workkeel-project.mjs';
import {applyTaskIntake} from '../src/workkeel-intake.mjs';

const actor = {agent_id:'builder', principal_id:'owner'};
const policy = {schema_version:'workkeel.task-policy/v1', principals:['owner'], agents:[actor], approvers:['owner'], review_separation:'distinct-agent'};
async function fixture(t, native=false, {commit=true}={}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'workkeel-start-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  execFileSync('git',['-C',root,'init','-q']);
  if(native) await initializeTaskProject(root,policy);
  if(commit) execFileSync('git',['-C',root,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','Baseline']);
  return root;
}
for(const native of [false,true]) test(`start identifies an unborn repository ${native?'after':'before'} init without writing`,async t=>{
  const root=await fixture(t,native,{commit:false}),before=await files(root),guide=await readStartGuide(root);
  assert.equal(guide.stage,'baseline'); assert.equal(guide.ready,false);
  assert.match(guide.next_action,/This repository has no commits/);
  assert.ok(guide.next_action.includes('git add -A && git commit -m baseline'));
  assert.deepEqual(guide.next_command,['git','add','-A']);
  assert.deepEqual(await files(root),before);
  const cli=fileURLToPath(new URL('../bin/workkeel.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[cli,'start',root],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr); assert.equal(JSON.parse(result.stdout).stage,'baseline');
});
async function files(root) {
  const result = {};
  async function walk(dir, prefix='') {
    for(const e of await fs.readdir(dir,{withFileTypes:true})) {
      if(e.name==='.git') continue;
      const ref=prefix+e.name;
      if(e.isDirectory()) await walk(path.join(dir,e.name),ref+'/');
      else result[ref]=await fs.readFile(path.join(dir,e.name),'base64');
    }
  }
  await walk(root); return result;
}
test('start identifies Git root and points to plain init without writing',async t=>{
  const root=await fixture(t),before=await files(root),guide=await readStartGuide(root);
  assert.equal(guide.stage,'init'); assert.equal(guide.ready,false);
  assert.deepEqual(guide.next_command,['init','.']); assert.equal(guide.drafts,undefined);
  assert.deepEqual(await files(root),before);
  await fs.mkdir(root+'/nested');
  assert.equal((await readStartGuide(root+'/nested')).stage,'git-root');
  const other=await fs.mkdtemp(path.join(os.tmpdir(),'workkeel-no-git-'));
  t.after(()=>fs.rm(other,{recursive:true,force:true}));
  assert.equal((await readStartGuide(other)).stage,'git');
  await fs.writeFile(root+'/WORKKEEL.md','Existing user file');
  assert.equal((await readStartGuide(root)).valid,false);
  assert.equal(await fs.readFile(root+'/WORKKEEL.md','utf8'),'Existing user file');
});
test('interrupted or malformed native files never fall back',async t=>{
  const root=await fixture(t);
  for(const ref of ['WORKKEEL.md','workkeelw.mjs']){
    await fs.writeFile(root+'/'+ref,'Interrupted native initialization');
    const conflict=await readStartGuide(root);
    assert.equal(conflict.valid,false);assert.equal(conflict.next_command,null);
    assert.equal(await fs.readFile(root+'/'+ref,'utf8'),'Interrupted native initialization');
    await fs.unlink(root+'/'+ref);
  }
  await fs.writeFile(root+'/workkeel.lock','broken');
  assert.equal((await readStartGuide(root)).valid,false);
});
test('native start preserves instructions and does not invent an actor or grants',async t=>{
  const root=await fixture(t,true); await fs.writeFile(root+'/AGENTS.md','Custom policy\n');
  const before=await files(root),guide=await readStartGuide(root);
  assert.equal(guide.stage,'instructions'); assert.deepEqual(await files(root),before);
  await applyInstructions(root,guide.instruction_preview.fingerprint);
  const next=await readStartGuide(root);
  assert.equal(next.stage,'task'); assert.equal(next.drafts,undefined);
  assert.deepEqual(next.next_command.slice(0,3),['task','new','.']);
  assert.equal(next.next_command[next.next_command.indexOf('--actor')+1],'<agent id>','no actor is chosen for the user');
  assert.deepEqual(next.identity_choices.agents,[actor]);
  assert.equal(next.execution_authorized,false);
  assert.ok((await fs.readFile(root+'/AGENTS.md','utf8')).startsWith('Custom policy\n'));
  await fs.appendFile(root+'/AGENTS.md','<!-- workkeel:begin -->');
  assert.equal((await readStartGuide(root)).valid,false);
});
test('explicit brief uses pinned intake and stale approval remains rejected',async t=>{
  const root=await fixture(t,true),g=await readStartGuide(root);
  await applyInstructions(root,g.instruction_preview.fingerprint);
  await fs.writeFile(root+'/approval.md','Approved offline fixture');
  const brief={schema_version:'workkeel.task-brief/v1',id:'WK-start',goal:'Test entry',actor,acceptance:['Verified'],exclude:[],
    environment:{cwd:'.',read_paths:['src'],write_paths:['src'],tools:['node'],resources:[],network:{mode:'none',hosts:[]},external_actions:[],
      data:{classification:'internal',model_access:'none',policy_refs:['approval.md']}},
    authorization:{approved_by:'owner',approval_ref:'approval.md',operations:['read','write','execute'],expires_at:null}};
  await fs.writeFile(root+'/brief.json',JSON.stringify(brief));
  const before=await files(root),preview=await readStartGuide(root,{requestRef:'brief.json'});
  assert.equal(preview.ready,true); assert.equal(preview.execution_authorized,false);
  assert.deepEqual(await files(root),before);
  await fs.appendFile(root+'/approval.md',' changed');
  await assert.rejects(applyTaskIntake(root,brief,preview.intake_preview.fingerprint),/Stale/);
  const fresh=await readStartGuide(root,{requestRef:'brief.json'});
  const created=await applyTaskIntake(root,brief,fresh.intake_preview.fingerprint);
  assert.equal(created.state,'intake'); assert.equal(created.claim,null);
  for(const requestRef of ['absent.json','../escape']) assert.equal((await readStartGuide(root,{requestRef})).valid,false);
  await fs.symlink(root+'/brief.json',root+'/linked.json');
  assert.equal((await readStartGuide(root,{requestRef:'linked.json'})).valid,false);
});
test('CLI start operates before init and invalid briefs return nonzero with no-write diagnostics',async t=>{
  const root=await fixture(t,true),g=await readStartGuide(root);
  await applyInstructions(root,g.instruction_preview.fingerprint);
  const cli=fileURLToPath(new URL('../bin/workkeel.mjs',import.meta.url));
  const bad=spawnSync(process.execPath,[cli,'start',root,'--request','missing.json'],{encoding:'utf8'});
  assert.equal(bad.status,1); assert.equal(JSON.parse(bad.stdout).mutation_status,'no-write');
  const fresh=await fixture(t),ok=spawnSync(process.execPath,[cli,'start',fresh],{encoding:'utf8'});
  assert.equal(ok.status,0); assert.equal(JSON.parse(ok.stdout).stage,'init');
});
