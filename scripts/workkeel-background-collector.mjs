import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {collectHostUsage} from '../src/workkeel-host-usage.mjs';

const LIMIT=16384;
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.mode===b.mode&&a.uid===b.uid;

// Resolve platform aliases once (including macOS /var), then check every
// traversal component around each bounded descriptor read. This is a race
// observation guard, not a filesystem sandbox.
async function configLocation(configFile) {
  const absolute=path.resolve(configFile),parent=await fs.realpath(path.dirname(absolute));
  const entries=[];
  let current=path.parse(parent).root;
  for(const part of parent.split(path.sep).filter(Boolean)) {
    current=path.join(current,part);
    const stat=await fs.lstat(current);
    if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('parent');
    entries.push({name:current,stat});
  }
  return {filename:path.join(parent,path.basename(absolute)),entries};
}

async function readBindings({filename,entries}) {
  const stableParents=async()=>{
    for(const entry of entries)if(!same(entry.stat,await fs.lstat(entry.name)))throw Error('parent replaced');
  };
  await stableParents();
  let leaf;
  try {leaf=await fs.lstat(filename);} catch(error) {
    if(error.code!=='ENOENT')throw error;
    await stableParents();
    return [];
  }
  const privateFile=stat=>stat.isFile()&&!stat.isSymbolicLink()&&!(stat.mode&0o077)&&stat.uid===process.getuid()&&stat.size<=LIMIT;
  if(!privateFile(leaf))throw Error('private regular file required');
  const stable=async()=>{
    await stableParents();
    if(!same(leaf,await fs.lstat(filename))||await fs.realpath(filename)!==filename)throw Error('file replaced');
  };
  const handle=await fs.open(filename,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  let bytes;
  try {
    const before=await handle.stat();
    if(!same(before,leaf)||!privateFile(before))throw Error('opened file replaced');
    await stable();
    const buffer=Buffer.alloc(LIMIT+1);let size=0;
    while(size<buffer.length) {
      const result=await handle.read(buffer,size,buffer.length-size,null);
      if(!result.bytesRead)break;
      size+=result.bytesRead;
    }
    const after=await handle.stat();
    if(!same(before,after)||size>LIMIT||size!==before.size||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw Error('file changed');
    await stable();
    bytes=buffer.subarray(0,size);
  } finally {await handle.close();}
  const bindings=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!Array.isArray(bindings)||bindings.length>32||new Set(bindings).size!==bindings.length||bindings.some(id=>typeof id!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(id)))throw Error('invalid list');
  return bindings;
}

export async function startBackgroundCollector(target,configFile,{intervalMs=5000,onError=message=>console.error(message),collect=collectHostUsage}={}) {
  if(!Number.isFinite(intervalMs)||intervalMs<=0)throw Error('Invalid collection interval');
  let location,closed=false,inFlight=null,timer,configFailed=false;
  const failed=new Set();
  const report=message=>{try{onError(message);}catch{/* Logging must not stop recovery. */}};
  const tick=()=>{
    if(closed)return inFlight??Promise.resolve();
    if(inFlight)return inFlight;
    inFlight=(async()=>{
      let bindings;
      try {
        location??=await configLocation(configFile);
        bindings=await readBindings(location);
        configFailed=false;
      } catch {
        if(!configFailed)report('Native usage configuration unavailable');
        configFailed=true;
        return;
      }
      for(const id of failed)if(!bindings.includes(id))failed.delete(id);
      for(const id of bindings) {
        if(closed)break;
        try {await collect(target,id);failed.delete(id);} catch {
          if(!failed.has(id))report('Native usage collection unavailable for configured binding');
          failed.add(id);
        }
      }
    })().finally(()=>{inFlight=null;});
    return inFlight;
  };
  await tick();
  timer=setInterval(()=>{void tick();},intervalMs);
  timer.unref();
  return {tick,async close(){closed=true;clearInterval(timer);await inFlight;}};
}
