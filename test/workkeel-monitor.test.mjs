import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {request} from 'node:http';
import {createMonitorFixture} from '../scripts/workkeel-monitor-fixture.mjs';
import {startTaskMonitor,readMonitorSnapshot} from '../src/workkeel-monitor.mjs';
import {formatCount,formatCost,formatDuration} from '../src/workkeel-monitor-view.mjs';

test('formatter preserves unknown, partial, zero, strict numbers and duration semantics',()=>{
 assert.equal(formatCount({complete:true,total:12345}),'12,345');
 assert.equal(formatCount({complete:false,known_subtotal:0}),'>= 0 (partial)');
 assert.equal(formatCount({complete:true,total:null,known_subtotal:1200}),'>= 1,200 (partial)');
 for(const total of [null,'1',-1,0.2,Infinity,NaN,Number.MAX_SAFE_INTEGER+1])assert.equal(formatCount({complete:true,total}),'Unknown');
 assert.equal(formatCount(null),'Unknown');assert.equal(formatCost({complete:true,total:0}),'$0.0000');
 assert.equal(formatCost({complete:false,known_subtotal:0.01234}),'>= $0.0123 (partial)');
 for(const total of [null,'1',-1,Infinity,NaN,1e12])assert.equal(formatCost({complete:true,total}),'Unknown');
 assert.equal(formatDuration(1234),'1.2 s');assert.equal(formatDuration(60000),'1 min 0 s');assert.equal(formatDuration(119999),'1 min 59 s');
 for(const ms of [null,'1',-1,Infinity,NaN,Number.MAX_SAFE_INTEGER+1])assert.equal(formatDuration(ms),'Unknown');
});
async function fingerprint(root) {
 const rows=[];for(const entry of await fs.readdir(path.join(root,'.ai-org'),{recursive:true,withFileTypes:true}))if(entry.isFile()){
  const file=path.join(entry.parentPath,entry.name);rows.push([path.relative(root,file),createHash('sha256').update(await fs.readFile(file)).digest('hex')]);
 }return rows.sort((a,b)=>a[0].localeCompare(b[0]));
}
test('monitor serves read-only redacted measurements and protects its local API',async t=>{
 const root=await createMonitorFixture();t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const before=await fingerprint(root),monitor=await startTaskMonitor(root);t.after(()=>monitor.close());
 const url=new URL(monitor.url),headers={Authorization:'Bearer '+url.hash.slice(1)},api=url.origin+'/api/snapshot';
 assert.equal((await fetch(api)).status,401);assert.equal((await fetch(api,{headers:{Authorization:'Bearer wrong'}})).status,401);
 assert.equal((await fetch(api,{headers:{...headers,Origin:'https://evil.example'}})).status,403);
 assert.equal((await fetch(api,{headers:{...headers,'Sec-Fetch-Site':'cross-site'}})).status,403);
 assert.equal((await fetch(api,{method:'POST',headers})).status,405);
 assert.equal((await fetch(url.origin+'/../secret',{headers})).status,404);
 const hostStatus=await new Promise((resolve,reject)=>{const r=request(api,{headers:{...headers,Host:'evil.example'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});r.on('error',reject);r.end();});assert.equal(hostStatus,403);
 const response=await fetch(api,{headers});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('access-control-allow-origin'),null);
 const data=await response.json();assert.equal(data.tasks.length,3);assert.equal(data.mutation_status,'no-write');
 assert.equal(data.tasks.find(t=>t.id==='WK-unobserved').usage.input_tokens.total,null);
 assert.equal(data.tasks.find(t=>t.id==='WK-completed').usage.input_tokens.total,1200);
 assert.equal(data.tasks.find(t=>t.id==='WK-interrupted').usage.input_tokens.total,null);
 assert.equal(data.tasks.find(t=>t.id==='WK-interrupted').usage.input_tokens.known_subtotal,1200);
 assert.ok(!JSON.stringify(data).includes('PRIVATE_OUTPUT_NOT_FOR_MONITOR'));
 const html=await fetch(url.origin);assert.match(html.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 assert.ok(!(await html.text()).includes(url.hash.slice(1)));assert.deepEqual(await fingerprint(root),before);
 await fs.writeFile(path.join(root,'.ai-org/execution/completed/status.json'),'corrupt');
 const degraded=await fetch(api,{headers});assert.equal(degraded.status,200);
 const partial=await degraded.json();assert.equal(partial.complete,false);
 assert.equal(partial.tasks.find(t=>t.id==='WK-completed').usage.input_tokens.total,null);
 assert.equal(partial.tasks.find(t=>t.id==='WK-unobserved').read_status,'available');
});
test('empty project stays empty and legacy/uninitialized projects are not migrated',async t=>{
 const root=await createMonitorFixture({empty:true});t.after(()=>fs.rm(root,{recursive:true,force:true}));
 assert.deepEqual((await readMonitorSnapshot(root)).tasks,[]);
 await assert.rejects(startTaskMonitor(root,{port:-1}),/Invalid/);
 await fs.unlink(path.join(root,'workkeel.lock'));await assert.rejects(startTaskMonitor(root));
});
