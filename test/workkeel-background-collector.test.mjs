import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startBackgroundCollector} from '../scripts/workkeel-background-collector.mjs';

async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'collector-'));
  const dir=await fs.realpath(root),file=path.join(dir,'bindings.json');
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const write=async value=>{await fs.rm(file,{force:true});await fs.writeFile(file,JSON.stringify(value),{mode:0o600});};
  const calls=[],errors=[];
  const start=async(options={})=>{
    const collector=await startBackgroundCollector('explicit-target',file,{intervalMs:60000,collect:async(target,id)=>{assert.equal(target,'explicit-target');calls.push(id);},onError:message=>errors.push(message),...options});
    t.after(()=>collector.close());return collector;
  };
  return {dir,file,write,calls,errors,start};
}

test('missing startup configuration, additions, removals and deletion reload without restart',async t=>{
  const f=await fixture(t),collector=await f.start();
  assert.deepEqual(f.calls,[]);
  await f.write(['first']);await collector.tick();
  await f.write(['first','second']);await collector.tick();
  await f.write(['second']);await collector.tick();
  await fs.rm(f.file);await collector.tick();
  assert.deepEqual(f.calls,['first','first','second','second']);
  assert.deepEqual(f.errors,[]);
});

test('invalid configuration fails closed, deduplicates errors and recovers',async t=>{
  const f=await fixture(t);await f.write(['valid']);const collector=await f.start();
  const invalid=[
    ()=>fs.writeFile(f.file,'{"invalid":'),
    ()=>fs.writeFile(f.file,' '.repeat(16385)),
    async()=>{await f.write(['valid']);await fs.chmod(f.file,0o644);},
    ()=>f.write(['duplicate','duplicate']),
    ()=>f.write(Array.from({length:33},(_,i)=>`binding-${i}`)),
    ()=>f.write(['../private']),
    ()=>f.write({binding:'valid'}),
    async()=>{await fs.rm(f.file);await fs.symlink(path.join(f.dir,'other'),f.file);},
  ];
  for(const corrupt of invalid) {
    await corrupt();const count=f.calls.length,errors=f.errors.length;
    await collector.tick();await collector.tick();
    assert.equal(f.calls.length,count);assert.equal(f.errors.length,errors+1);
    await f.write(['valid']);await collector.tick();assert.equal(f.calls.length,count+1);
  }
  assert(f.errors.every(message=>message==='Native usage configuration unavailable'));
});

test('binding errors are isolated, retried and cleared after recovery',async t=>{
  const f=await fixture(t);await f.write(['bad','good']);let fail=true;
  const collector=await f.start({collect:async(_,id)=>{f.calls.push(id);if(id==='bad'&&fail)throw Error('/secret/source');}});
  await collector.tick();assert.equal(f.errors.length,1);
  fail=false;await collector.tick();fail=true;await collector.tick();
  assert.equal(f.errors.length,2);assert.deepEqual(f.calls,Array(4).fill(['bad','good']).flat());
  assert(f.errors.every(message=>!message.includes('/secret')&&!message.includes('bad')));
});

test('slow ticks serialize and close waits while preventing further bindings',async t=>{
  const f=await fixture(t),collector=await f.start({intervalMs:5,collect:async(_,id)=>{f.calls.push(id);await blocked;}});
  let release;const blocked=new Promise(resolve=>{release=resolve;});
  await f.write(['first','second']);
  const tick=collector.tick();assert.equal(collector.tick(),tick);
  while(!f.calls.length)await new Promise(resolve=>setTimeout(resolve,1));
  await new Promise(resolve=>setTimeout(resolve,20));assert.deepEqual(f.calls,['first']);
  let finished=false;const closing=collector.close().then(()=>{finished=true;});
  await new Promise(resolve=>setTimeout(resolve,5));assert.equal(finished,false);
  release();await closing;await tick;await collector.tick();assert.deepEqual(f.calls,['first']);
});

test('leaf replacement during descriptor read is rejected and recovers',async t=>{
  const f=await fixture(t);await f.write(['old']);const collector=await f.start();
  const originalOpen=fs.open;let replaced=false;
  fs.open=async(...args)=>{
    const handle=await originalOpen(...args);
    if(args[0]===f.file&&!replaced) {
      const read=handle.read.bind(handle);
      handle.read=async(...readArgs)=>{const result=await read(...readArgs);if(!replaced){replaced=true;await f.write(['new']);}return result;};
    }
    return handle;
  };
  try {await collector.tick();}finally{fs.open=originalOpen;}
  assert.deepEqual(f.calls,['old']);await collector.tick();assert.deepEqual(f.calls,['old','new']);
});

test('parent swap to outside symlink never uses outside configuration bytes',async t=>{
  const f=await fixture(t),parent=path.join(f.dir,'state'),outside=path.join(f.dir,'outside');
  await fs.mkdir(parent);await fs.mkdir(outside);
  const file=path.join(parent,'bindings.json');
  await fs.writeFile(file,'["inside"]',{mode:0o600});
  await fs.writeFile(path.join(outside,'bindings.json'),'["outside"]',{mode:0o600});
  const calls=[];const collector=await startBackgroundCollector('target',file,{intervalMs:60000,collect:async(_,id)=>calls.push(id),onError:()=>{}});
  t.after(()=>collector.close());
  const originalOpen=fs.open;let swapped=false;
  fs.open=async(...args)=>{
    if(args[0]===file&&!swapped){swapped=true;await fs.rename(parent,parent+'-saved');await fs.symlink(outside,parent);}
    return originalOpen(...args);
  };
  try {await collector.tick();}finally{fs.open=originalOpen;}
  assert.deepEqual(calls,['inside']);
  await fs.rm(parent);await fs.rename(parent+'-saved',parent);
  await collector.tick();assert.deepEqual(calls,['inside','inside']);
});
