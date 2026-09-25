import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
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
