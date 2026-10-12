import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createMonitorFixture} from '../scripts/workkeel-monitor-fixture.mjs';
import {readNativeTask,createNativeTask,mutateNativeTask} from '../src/workkeel-tasks.mjs';
import {captureNativeLearning,reviewNativeLearning,recordNativeLearningUse} from '../src/workkeel-learning.mjs';
import {startTaskMonitor} from '../src/workkeel-monitor.mjs';
import {executionDigest} from '../src/workkeel-execution-policy.mjs';

test('native learning source, search, use and invalidation reach the read-only HTTP observer',async t=>{
 const root=await createMonitorFixture({extended:true});let monitor;t.after(async()=>{await monitor?.close();await fs.rm(root,{recursive:true,force:true});});
 const original=await readNativeTask(root,'WK-working'),contract=structuredClone(original.contract),id='WK-learning-observer',actor=contract.actor;
 contract.id=id;contract.environment.write_paths=['.ai-org/learning/native'];contract.environment.read_paths=['docs'];
 await createNativeTask(root,contract,{operation_id:'create',expected_version:0,actor});
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_'))),base=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8',env}).trim();
 await mutateNativeTask(root,id,'claim',{operation_id:'claim',expected_version:1,actor,base_revision:base});
 const task=await readNativeTask(root,id),auth={task_id:id,actor,claim_id:task.claim.id,contract_sha256:task.contract_sha256};
 await fs.writeFile(root+'/docs/learning-proof.md','Bounded synthetic check evidence');
 await captureNativeLearning(root,{...auth,operation_id:'capture',record:{id:'LESSON-http',kind:'lesson',title:'HTTP contract',summary:'Keep source and outcome distinct',applicability:'Fixture HTTP boundary',exclusions:'No runtime savings claim',aliases:['外部介面'],derived_from:[],evidence:['docs/learning-proof.md'],skill_refs:[]}});
 await reviewNativeLearning(root,{...auth,operation_id:'review',learning_id:'LESSON-http',result:'confirmed',decision:'Inspected synthetic boundary',evidence:['docs/learning-proof.md'],adopt:false});
 for(const stage of ['found','read','applied','outcome'])await recordNativeLearningUse(root,{...auth,operation_id:stage,learning_id:'LESSON-http',stage,decision:'Explicit fixture '+stage,evidence:['docs/learning-proof.md'],outcome:stage==='outcome'?'verified':null});
 monitor=await startTaskMonitor(root);const url=new URL(monitor.url),headers={Authorization:'Bearer '+url.hash.slice(1)},get=async path=>{const r=await fetch(url.origin+path,{headers});assert.equal(r.status,200);return r.json();};
 const lib=await get('/api/library?q='+encodeURIComponent('外部介面')),entry=lib.learning[0];assert.deepEqual(lib.errors,[]);assert.equal(entry.native,true);assert.equal(entry.use_count,4);assert.equal(entry.effective_state,'validated');
 const doc=await get('/api/document?id='+entry.document_id);assert.match(doc.content,/Bounded|Keep source/);assert.equal(doc.digest,entry.digest);
 assert.equal((await get('/api/task?id='+id)).learning_uses.length,4);
 // Synthetic records exercise document access beyond the library display cap.
 // They are fixture data only, with the same independently checked chain shape.
 const capture=JSON.parse(await fs.readFile(root+'/.ai-org/learning/native/000001.json','utf8'));
 let previous=JSON.parse(await fs.readFile(root+'/.ai-org/learning/native/000006.json','utf8')).sha256;
 for(let n=1;n<=256;n++){
  const event=structuredClone(capture.event);event.sequence=6+n;event.previous_hash=previous;
  event.request.operation_id='fixture-capture-'+n;event.request.record.id='LESSON-cap-'+n;
  event.request_sha256=executionDigest(event.request);previous=executionDigest(event);
  await fs.writeFile(root+'/.ai-org/learning/native/'+String(event.sequence).padStart(6,'0')+'.json',JSON.stringify({event,sha256:previous}));
 }
 const beyond=(await get('/api/library?q=LESSON-cap-256')).learning[0];assert.equal(beyond.id,'LESSON-cap-256');
 assert.equal((await get('/api/document?id='+beyond.document_id)).digest,beyond.digest);
 await fs.writeFile(root+'/docs/learning-proof.md','Changed source');const changed=(await get('/api/library')).learning[0];assert.equal(changed.effective_state,'review-required');assert.equal(changed.eligible,false);
 assert.ok(changed.reasons.some(r=>r.code==='stale-evidence'));
 const staleUse=(await get('/api/task?id='+id)).learning_uses.find(use=>use.stage==='outcome');
 assert.equal(staleUse.outcome,'verified');assert.ok(staleUse.reasons.some(r=>r.code==='stale-evidence'));
 await fs.writeFile(root+'/.ai-org/learning/native/000001.json','corrupt');const invalid=await get('/api/library');assert.equal(invalid.learning.length,0);assert.ok(invalid.errors.some(e=>e.code==='native-learning-unavailable'));
 assert.equal((await get('/api/task?id='+id)).learning_unavailable,true);assert.equal((await get('/api/diagnostics')).model_calls,0);
});
