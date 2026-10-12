import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createObserverFixture} from '../scripts/workkeel-observer-fixture.mjs';
import {readMonitorLibrary,readMonitorDocument,createLibraryCache,documentId} from '../src/workkeel-monitor-data.mjs';
import {startTaskMonitor} from '../src/workkeel-monitor.mjs';
import {operationRows,aggregateRows,filterRows,trendRows} from '../src/workkeel-monitor-analytics.mjs';
test('analytics preserves partial, unknown and zero, deduplicates identities and filters operations',()=>{
 const op=(id,model,input,output,ms,done=true)=>({operation_id:id,node:'work',runtime_model:model,result_recorded:done,usage:{input_tokens:input,output_tokens:output},adapter_elapsed_ms:ms,dispatched_at:'2026-09-24T23:59:00Z'});
 const a=op('work-0-0','model-a',100,20,1200),b=op('review-0-0','local-model',50,null,null,false),z=op('zero','model-a',0,0,0),unknown=op('unknown',null,null,null,null,false);
 const tasks=[{id:'A',title:'A',settings:{runtime:{kind:'native'}},runs:[{run_id:'one',operations:[a,b,a,z,unknown]}]},{id:'B',title:'B',runs:[{run_id:'two',operations:[a]}]}];
 const rows=operationRows(tasks);assert.equal(rows.length,5);
 const groups=aggregateRows(rows);assert.equal(groups[0].tokens,170);assert.equal(groups[0].tokens_complete,false);assert.equal(groups[0].ms,1200);assert.equal(groups[0].time_complete,false);
 assert.equal(groups[1].tokens,120);assert.equal(groups[1].tokens_complete,true);
 assert.equal(filterRows(rows,{model:'local-model'}).length,1);
 assert.equal(aggregateRows([rows.find(r=>r.operation_id==='zero')])[0].tokens,0);
 assert.equal(aggregateRows([rows.find(r=>r.operation_id==='unknown')])[0].tokens,null);
 assert.equal(trendRows(rows)[0].id,'2026-09-24');assert.equal(trendRows(rows,'week')[0].id,'2026-09-21');
 assert.equal(filterRows(rows,{days:'7',now:Date.parse('2026-10-05')}).length,0);
 const corrupt=operationRows([{...tasks[1],measurement_errors:[{}]}]);assert.equal(aggregateRows(corrupt)[0].tokens_complete,false);
});
test('library searches content and invalidates derived cache without inferring Skill activation',async t=>{
 const root=await createObserverFixture();t.after(()=>fs.rm(root,{recursive:true,force:true}));const cache=createLibraryCache();
 const first=await readMonitorLibrary(root,{cache});assert.equal(first.skills.filter(x=>x.availability==='project').length,3);assert.ok(first.skills.some(x=>x.origin==='workkeel'&&x.availability==='not-added'));assert.deepEqual(first.learning.map(x=>x.completed_milestones),[1,2,3,1]);assert.equal(first.learning.at(-1).stopped,true);
 assert.equal(first.skills.find(x=>x.name==='temple-work').origin,'workkeel');assert.equal(first.skills.find(x=>x.name==='custom-check').origin,'project');
 assert.equal((await readMonitorLibrary(root,{cache,query:'copper kestrel'})).skills.length,1);assert.ok(cache.hits>0);
 const ref='.agents/skills/custom-check/SKILL.md';await fs.writeFile(path.join(root,ref),'# Changed\nSilver owl\n');
 assert.equal((await readMonitorLibrary(root,{cache,query:'copper kestrel'})).skills.length,0);
 assert.equal((await readMonitorLibrary(root,{cache,query:'silver owl'})).skills.length,1);
 const doc=await readMonitorDocument(root,documentId(ref),{cache});assert.match(doc.content,/Silver owl/);
 await fs.unlink(path.join(root,ref));await fs.symlink('/etc/hosts',path.join(root,ref));
 await assert.rejects(readMonitorDocument(root,documentId(ref),{cache}));
 await assert.rejects(readMonitorDocument(root,'../../etc/hosts',{cache}));
 await fs.writeFile(path.join(root,'private.md'),'NOT_INDEXED');await assert.rejects(readMonitorDocument(root,documentId('private.md'),{cache}));
 assert.ok(cache.entries.size<=256);
});
test('all observer APIs retain authentication, read-only methods and no external resources',async t=>{
 const root=await createObserverFixture();t.after(()=>fs.rm(root,{recursive:true,force:true}));const monitor=await startTaskMonitor(root);t.after(()=>monitor.close());const url=new URL(monitor.url),headers={Authorization:'Bearer '+url.hash.slice(1)};
 for(const route of ['/api/library','/api/document?id='+documentId('.agents/skills/custom-check/SKILL.md'),'/api/diagnostics']){
  assert.equal((await fetch(url.origin+route)).status,401);assert.equal((await fetch(url.origin+route,{method:'PUT',headers})).status,405);
  assert.equal((await fetch(url.origin+route,{headers:{...headers,Origin:'https://example.invalid'}})).status,403);
  assert.equal((await fetch(url.origin+route,{headers})).status,200);
 }
 const diag=await (await fetch(url.origin+'/api/diagnostics',{headers})).json();assert.equal(diag.model_calls,0);assert.ok(diag.last.file_reads>0);assert.ok(diag.last.response_bytes>0);
 const client=await (await fetch(url.origin+'/client.mjs')).text();assert.doesNotMatch(client,/https:\/\/.*(?:cdn|unpkg|jsdelivr)/);
 const data=await (await fetch(url.origin+'/api/snapshot',{headers})).json();assert.equal(data.project.observer.model_calls,0);assert.equal(data.tasks[0].settings?.connection?.credential_env,undefined);
 assert.equal(data.tasks.find(t=>t.id==='WK-working').settings.execution_policy.source_status,'pinned');
 const policyPath=path.join(root,'docs/policy.json'),policy=JSON.parse(await fs.readFile(policyPath,'utf8'));policy.limits.steps=4;await fs.writeFile(policyPath,JSON.stringify(policy));
 const changed=await (await fetch(url.origin+'/api/snapshot',{headers})).json();assert.equal(changed.tasks.find(t=>t.id==='WK-working').settings.execution_policy.source_status,'changed');
 assert.equal((await fetch(url.origin+'/api/document?id='+documentId('private.md'),{headers})).status,503);
});
