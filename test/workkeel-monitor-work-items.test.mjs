import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readWorkItemSnapshot,readWorkItemDocument} from '../src/workkeel-monitor-work-items.mjs';
import {startTaskMonitor} from '../src/workkeel-monitor.mjs';

async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'workkeel-observer-wi-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'.ai-org/work-items'),{recursive:true});
  await fs.mkdir(path.join(root,'.ai-org/events'),{recursive:true});
  await fs.writeFile(path.join(root,'temple.lock'),JSON.stringify({schema_version:'temple.lock/v1',template:{version:'test'}}));
  const item={schema_version:'temple.work-item/v1',id:'WI-0001',title:'Actual task',state:'build',created_at:'2026-09-25T00:00:00Z',updated_at:'2026-09-26T00:00:00Z',scope:['UI'],acceptance_criteria:['Readable'],evidence:['brief.md'],claim:{status:'active'}};
  await fs.writeFile(path.join(root,'.ai-org/work-items/WI-0001.json'),JSON.stringify(item));
  await fs.writeFile(path.join(root,'.ai-org/events/events.jsonl'),JSON.stringify({timestamp:item.updated_at,event_type:'work_item_transitioned',work_item_id:item.id,to_state:'build'})+'\n');
  await fs.writeFile(path.join(root,'brief.md'),'# Actual scope');
  return root;
}
test('explicit Work Item observation preserves raw stages, unknown usage and current documents',async t=>{
  const root=await fixture(t),s=await readWorkItemSnapshot(root),task=s.tasks[0];
  assert.equal(s.complete,true);assert.equal(task.task_state,'build');assert.equal(task.record_mode,'work-items');
  assert.deepEqual(task.runs,[]);assert.equal(task.usage.input_tokens,null);assert.equal(task.quality.locally_accepted,null);
  assert.equal(task.timeline[0].state,'build');assert.equal(task.lifecycle.coverage,'partial-history');
  assert.equal((await readWorkItemDocument(root,task.documents[0].id)).content,'# Actual scope');
  await assert.rejects(readWorkItemDocument(root,'0'.repeat(64)),/referenced/);
  await fs.writeFile(path.join(root,'.ai-org/events/events.jsonl'),'{bad');
  assert.equal((await readWorkItemSnapshot(root)).complete,false);
});
test('Work Item observer does not follow records or document symlinks',async t=>{
  const root=await fixture(t),s=await readWorkItemSnapshot(root),id=s.tasks[0].documents[0].id;
  await fs.rename(path.join(root,'brief.md'),path.join(root,'other.md'));
  await fs.symlink('other.md',path.join(root,'brief.md'));
  await assert.rejects(readWorkItemDocument(root,id),/symlink/);
  await fs.symlink('WI-0001.json',path.join(root,'.ai-org/work-items/WI-0002.json'));
  assert.equal((await readWorkItemSnapshot(root)).tasks.find(x=>x.id==='WI-0002').read_status,'unavailable');
});
test('malformed optional Work Item structure is isolated from other tasks',async t=>{
  const root=await fixture(t),file=path.join(root,'.ai-org/work-items/WI-0001.json');
  const item=JSON.parse(await fs.readFile(file,'utf8'));
  await fs.writeFile(path.join(root,'.ai-org/work-items/WI-0002.json'),JSON.stringify({...item,id:'WI-0002',handoffs:'invalid'}));
  const snapshot=await readWorkItemSnapshot(root);
  assert.equal(snapshot.complete,false);
  assert.equal(snapshot.tasks.find(t=>t.id==='WI-0001').read_status,'available');
  assert.equal(snapshot.tasks.find(t=>t.id==='WI-0002').read_status,'unavailable');
});
test('Work Item server needs explicit mode and keeps authentication and read-only routes',async t=>{
  const root=await fixture(t);await assert.rejects(startTaskMonitor(root));
  const m=await startTaskMonitor(root,{recordMode:'work-items'});t.after(()=>m.close());
  const u=new URL(m.url),headers={Authorization:'Bearer '+u.hash.slice(1)};
  assert.equal((await fetch(u.origin+'/api/snapshot')).status,401);
  assert.equal((await fetch(u.origin+'/api/snapshot',{headers,method:'POST'})).status,405);
  assert.equal((await fetch(u.origin+'/api/snapshot',{headers:{...headers,Origin:'https://example.org'}})).status,403);
  assert.equal((await (await fetch(u.origin+'/api/snapshot',{headers})).json()).tasks[0].id,'WI-0001');
  assert.equal((await fs.readdir(root)).includes('workkeel.lock'),false);
});
