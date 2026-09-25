import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {verifyProcessRecovery} from '../scripts/verify-workkeel-process-recovery.mjs';

test('killed process retains unknown intent and resumes only after evidence reconciliation', {skip:process.platform==='win32',timeout:60000}, async t=>{
  const parent=await fs.mkdtemp(path.join(os.tmpdir(),'workkeel-process-recovery-'));
  t.after(()=>fs.rm(parent,{recursive:true,force:true}));
  const root=path.join(parent,'exercise'),report=await verifyProcessRecovery(root);
  assert.deepEqual(report.effects,{first:1,middle:1,last:1});
  assert.ok(Object.values(report.guards).every(Boolean));
  assert.equal(report.task_state,'build');assert.equal(report.model_calls,0);
  await assert.rejects(verifyProcessRecovery(root),{code:'EEXIST'});
});

test('exercise ignores injected Git hooks, signing and init templates', {skip:process.platform==='win32',timeout:60000},async t=>{
  const parent=await fs.mkdtemp(path.join(os.tmpdir(),'workkeel-hostile-git-'));
  t.after(()=>fs.rm(parent,{recursive:true,force:true}));
  await fs.mkdir(parent+'/hooks');
  const marker=parent+'/hook-ran';
  await fs.writeFile(parent+'/hooks/pre-commit',`#!/bin/sh\ntouch '${marker}'\nexit 1\n`,{mode:0o755});
  await fs.writeFile(parent+'/injected.gitconfig',`[core]\n hooksPath = ${parent}/hooks\n[commit]\n gpgSign = true\n[init]\n templateDir = ${parent}/absent-template\n`);
  const script=fileURLToPath(new URL('../scripts/verify-workkeel-process-recovery.mjs',import.meta.url));
  const {stdout}=await promisify(execFile)(process.execPath,[script,parent+'/exercise'],{
    timeout:45000,env:{...process.env,GIT_CONFIG_GLOBAL:parent+'/injected.gitconfig',GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.hooksPath',GIT_CONFIG_VALUE_0:parent+'/hooks'}});
  assert.equal(JSON.parse(stdout).passed,true);
  await assert.rejects(fs.stat(marker),{code:'ENOENT'});
});
