import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {inspectEvidenceAvailability} from '../scripts/workkeel-evidence-availability.mjs';

async function fixture(t){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'evidence-availability-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(root+'/Evidence');
  const retired={kind:'retire',path:'Evidence/old.mp4',bytes:123,sha256:'a'.repeat(64)};
  const rows=[{kind:'authorization',plannedFiles:1,plannedBytes:123},retired,{kind:'complete',files:1,bytes:123}];
  await fs.writeFile(root+'/cleanup.jsonl',rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
  return {root,rows,retired,source:{path:'cleanup.jsonl',format:'slime-retirement-jsonl/v1'}};
}
test('retired, unexplained, present and archive leads remain separate without opening media',async t=>{
  const f=await fixture(t);await fs.writeFile(f.root+'/Evidence/present.png','abc');await fs.writeFile(f.root+'/archive.zip','zip');
  const before=await fs.readFile(f.root+'/cleanup.jsonl');
  const out=await inspectEvidenceAvailability(f.root,{files:[
    {path:'Evidence/present.png',bytes:3,sha256:'b'.repeat(64)},
    {path:'Evidence/old.mp4',bytes:123,sha256:'a'.repeat(64)},
    {path:'Evidence/manual.mp4'},{path:'Evidence/moved.mp4',archive_path:'archive.zip'},
  ],retirement_journals:[f.source]});
  assert.deepEqual(out.files.map(f=>f.state),['present','retired-recorded','missing-unexplained','archive-present-unverified']);
  assert.equal(out.media_bytes_read,0);assert.ok(out.files.every(f=>f.content_integrity==='not-checked'));
  assert.deepEqual(await fs.readFile(f.root+'/cleanup.jsonl'),before);
});
test('incomplete, contradictory or conflicting receipts cannot explain missing evidence',async t=>{
  const f=await fixture(t),request={files:[{path:'Evidence/old.mp4',bytes:123,sha256:'a'.repeat(64)}],retirement_journals:[f.source]};
  for(const rows of [f.rows.slice(0,-1),[...f.rows,{kind:'retire',path:'extra'}],[f.rows[0],f.retired,{kind:'complete',files:1,bytes:0}]]){
    await fs.writeFile(f.root+'/cleanup.jsonl',rows.map(r=>JSON.stringify(r)).join('\n'));
    const out=await inspectEvidenceAvailability(f.root,request);assert.equal(out.files[0].state,'missing-unexplained');assert.equal(out.warnings.length,1);
  }
  await fs.writeFile(f.root+'/cleanup.jsonl',f.rows.map(r=>JSON.stringify(r)).join('\n'));
  let out=await inspectEvidenceAvailability(f.root,{...request,files:[{path:'Evidence/old.mp4',sha256:'b'.repeat(64)}]});
  assert.equal(out.files[0].state,'missing-unexplained');assert.equal(out.files[0].retirement_conflict,true);
  await fs.writeFile(f.root+'/other.jsonl',f.rows.map(r=>JSON.stringify(r.kind==='retire'?{...r,sha256:'b'.repeat(64)}:r)).join('\n'));
  out=await inspectEvidenceAvailability(f.root,{...request,retirement_journals:[f.source,{...f.source,path:'other.jsonl'}]});
  assert.equal(out.files[0].state,'missing-unexplained');assert.equal(out.files[0].retirement_conflict,true);
});
test('size drift, unsafe files and traversal never become available evidence',async t=>{
  const f=await fixture(t);await fs.writeFile(f.root+'/Evidence/changed.png','abcd');
  await fs.symlink('/etc/passwd',f.root+'/Evidence/link.png');await fs.symlink('/etc',f.root+'/escape');
  const out=await inspectEvidenceAvailability(f.root,{files:[{path:'Evidence/changed.png',bytes:3},{path:'Evidence/link.png'},{path:'escape/passwd'}]});
  assert.deepEqual(out.files.map(f=>f.state),['size-mismatch','unsafe','unavailable']);
  for(const p of ['../secret','/etc/passwd','Evidence/../secret','Evidence/./file','Evidence\\file','Evidence/file\n']){
    await assert.rejects(inspectEvidenceAvailability(f.root,{files:[{path:p}]}));
  }
  await assert.rejects(inspectEvidenceAvailability(f.root,{files:[{path:'a'},{path:'a'}]}),/duplicate/);
  await assert.rejects(inspectEvidenceAvailability(f.root,{files:[],retirement_journals:[{...f.source,format:'unknown'}]}),/unsupported/);
});
