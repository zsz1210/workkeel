// Synthetic local I/O benchmark. No provider/runtime adapter is invoked here.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createObserverFixture} from './workkeel-observer-fixture.mjs';
import {readNativeTask,createNativeTask} from '../src/workkeel-tasks.mjs';
import {startTaskMonitor} from '../src/workkeel-monitor.mjs';
import {operationRows,aggregateRows} from '../src/workkeel-monitor-analytics.mjs';
const output=path.resolve(process.argv[2]??'output/playwright/workkeel-monitor/benchmark.json');
async function fingerprint(root){
 const files=[];
 async function walk(dir){for(const name of (await fs.readdir(path.join(root,dir))).sort()){
  if(name==='.git')continue;const ref=path.join(dir,name),info=await fs.lstat(path.join(root,ref));
  if(info.isDirectory())await walk(ref);else if(info.isFile())files.push([ref,createHash('sha256').update(await fs.readFile(path.join(root,ref))).digest('hex')]);
 }}await walk('');return createHash('sha256').update(JSON.stringify(files)).digest('hex');
}
const report={schema:'workkeel.observer-benchmark/v1',data:'synthetic offline fixtures',created_at:new Date().toISOString(),node:process.version,external_model_calls:0,scenarios:[]};
const root=await createObserverFixture();let monitor;
try{
 let created=6;for(const count of [6,100,1000]){
  if(count>created){const template=(await readNativeTask(root,'WK-unobserved')).contract;for(let i=created;i<count;i++){
   const contract={...structuredClone(template),id:'WK-scale-'+String(i).padStart(3,'0'),goal:'Synthetic scale task '+i};
   await createNativeTask(root,contract,{operation_id:'create',expected_version:0,actor:contract.actor});
  }created=count;}
  const before=await fingerprint(root);monitor=await startTaskMonitor(root);
  const url=new URL(monitor.url),headers={authorization:'Bearer '+url.hash.slice(1)};
  const get=async(route)=>{const r=await fetch(url.origin+route,{headers});assert.equal(r.status,200);return r.json();};
  const coldStart=performance.now(),snapshot=await get('/api/workspace');assert.equal(snapshot.tasks.length,count);
  const coldMs=performance.now()-coldStart,coldDiagnostics=await get('/api/diagnostics');
  const cold={roundtrip_ms:Math.round(coldMs*100)/100,...coldDiagnostics.index.last_build,response_bytes:coldDiagnostics.last.response_bytes};
  const analysis=await get('/api/analysis');assert.equal(analysis.operation_count,3);assert.equal(analysis.totals.tokens,2860);assert.equal(analysis.totals.tokens_complete,false);
  const measurements=[];
  for(const route of ['/api/workspace','/api/changes','/api/tasks','/api/analysis','/api/library']){
   for(let i=0;i<8;i++){const start=performance.now();await get(route);const roundtrip=performance.now()-start;const d=await get('/api/diagnostics');measurements.push({iteration:i+1,route,roundtrip_ms:Math.round(roundtrip*100)/100,...d.last});}
  }
  const library=await get('/api/library'),doc=library.skills.find(s=>s.name==='custom-check');
  await get('/api/document?id='+doc.id);const document=await get('/api/diagnostics');
  const diagnostics=await get('/api/diagnostics');assert.equal(diagnostics.model_calls,0);
  await monitor.close();monitor=null;const after=await fingerprint(root);assert.equal(after,before);
  const groups=['/api/workspace','/api/changes','/api/tasks','/api/analysis','/api/library'].map(route=>{
   const selected=measurements.filter(m=>m.route===route),times=selected.map(m=>m.roundtrip_ms).sort((a,b)=>a-b);
   return {route,samples:times.length,median_ms:times[Math.floor(times.length/2)],p95_ms:times[Math.ceil(times.length*.95)-1],file_reads:selected[0].file_reads,source_bytes:selected[0].source_bytes,response_bytes:selected[0].response_bytes,first_cache_misses:selected[0].cache_misses,last_cache_hits:selected.at(-1).cache_hits};
  });
  report.scenarios.push({tasks:count,cold,readonly_fingerprint_match:true,fixture_operation_rows:analysis.operation_count,known_tokens:2860,partial_usage:true,groups,document:document.last,samples:measurements});
 }
 await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,scenarios:report.scenarios.map(({tasks,readonly_fingerprint_match,groups})=>({tasks,readonly_fingerprint_match,groups}))},null,2));
}finally{if(monitor)await monitor.close();await fs.rm(root,{recursive:true,force:true});}
