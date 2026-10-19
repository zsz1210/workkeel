import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {executionDigest} from '../src/workkeel-execution-policy.mjs';
import {appendLearningReceipt,readLearningReceipts,replayLearningReceipt,learningEvidenceProblems} from '../src/workkeel-learning-receipts.mjs';

const fail=message=>{throw Error(message);};
async function fixture(t){
  const target=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'workkeel-receipts-')));
  t.after(()=>fs.rm(target,{recursive:true,force:true}));
  const request={task_id:'WK-first',operation_id:'same-operation'},event={schema_version:'synthetic.receipt/v1',sequence:1,previous_hash:null,action:'use',request,request_sha256:executionDigest(request),at:'2026-01-01T00:00:00Z',pins:[]};
  const options={root:'.ai-org/learning/native',schema:event.schema_version,limit:2,fail,validate:e=>{if(e.action!=='use')fail('semantic action');}};
  return {target,event,options,ref:target+'/'+options.root+'/000001.json'};
}

test('shared receipts retain hashes, sequence, caller validation and task-bound replay',async t=>{
  const f=await fixture(t);assert.deepEqual(await readLearningReceipts(f.target,f.options),[]);
  const receipt=await appendLearningReceipt(f.target,f.options.root,f.event);
  assert.equal(receipt.sha256,executionDigest(f.event));assert.equal(receipt.replayed,false);
  const events=await readLearningReceipts(f.target,f.options);assert.deepEqual(events,[{event:f.event,sha256:receipt.sha256}]);
  assert.equal(replayLearningReceipt(events,'use',f.event.request,fail).replayed,true);
  assert.equal(replayLearningReceipt(events,'use',{...f.event.request,task_id:'WK-other'},fail),null);
  for(const [action,request] of [['review',f.event.request],['use',{...f.event.request,changed:true}]])assert.throws(()=>replayLearningReceipt(events,action,request,fail),/replay conflict/);
  const second={...f.event,sequence:2,previous_hash:receipt.sha256,request:{...f.event.request,operation_id:'second'}};second.request_sha256=executionDigest(second.request);
  await appendLearningReceipt(f.target,f.options.root,second);assert.equal((await readLearningReceipts(f.target,f.options)).length,2);
  await assert.rejects(readLearningReceipts(f.target,{...f.options,limit:1}),/inventory limit/);
});

test('shared receipt storage rejects tampering, gaps and bounded writes without overwriting',async t=>{
  const f=await fixture(t);await appendLearningReceipt(f.target,f.options.root,f.event);const original=await fs.readFile(f.ref,'utf8');
  for(const change of [{schema_version:'wrong'},{sequence:2},{previous_hash:'a'.repeat(64)},{request_sha256:'a'.repeat(64)},{at:'invalid'},{action:'review'}]){
    const event={...f.event,...change};await fs.writeFile(f.ref,JSON.stringify({event,sha256:executionDigest(event)}));
    await assert.rejects(readLearningReceipts(f.target,f.options),/integrity|semantic action/);
  }
  await fs.writeFile(f.ref,original);await assert.rejects(appendLearningReceipt(f.target,f.options.root,f.event),{code:'EEXIST'});assert.equal(await fs.readFile(f.ref,'utf8'),original);
  await assert.rejects(appendLearningReceipt(f.target,f.options.root,{...f.event,sequence:2},{maxBytes:1,fail}),/bounded size/);
  assert.deepEqual(await fs.readdir(path.dirname(f.ref)),['000001.json']);
  await fs.rename(f.ref,path.dirname(f.ref)+'/000002.json');await assert.rejects(readLearningReceipts(f.target,f.options),/sequence gap/);
});

test('shared evidence observations preserve each callers reason field',async t=>{
  const f=await fixture(t);await fs.mkdir(f.target+'/docs');await fs.writeFile(f.target+'/docs/proof','original');
  const pins=[{path:'docs/proof',sha256:executionDigest('stale')},{path:'docs/missing',sha256:'a'.repeat(64)}];
  for(const field of ['source','path'])assert.deepEqual(await learningEvidenceProblems(f.target,pins,field),[{code:'stale-evidence',[field]:'docs/proof'},{code:'unknown-evidence',[field]:'docs/missing'}]);
});
