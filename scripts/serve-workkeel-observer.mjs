import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {startTaskMonitor} from '../src/workkeel-monitor.mjs';

// Explicit local deployment entry point. This never installs or changes a service.
const [target,stateDirectory,portValue='49618',recordMode='native',catalogFile]=process.argv.slice(2);
if(!target||!stateDirectory)throw Error('Usage: node scripts/serve-workkeel-observer.mjs PROJECT STATE_DIR [PORT] [native|work-items] [SKILL_SOURCES_JSON]');
await fs.mkdir(stateDirectory,{recursive:true,mode:0o700});
const tokenPath=path.join(stateDirectory,'observer-access');
try{await fs.writeFile(tokenPath,randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
const info=await fs.lstat(tokenPath);
if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077))throw Error('Observer access file must be private and regular');
const accessToken=(await fs.readFile(tokenPath,'utf8')).trim();
const catalogRoots=catalogFile?JSON.parse(await fs.readFile(catalogFile,'utf8')):[];
const monitor=await startTaskMonitor(target,{port:Number(portValue),recordMode,service:'background',accessToken,catalogRoots});
// Optional owner-only private viewer, behind the user's existing Tailscale Serve.
// The full capability stays on this machine and is never sent to remote browsers.
let privateViewer=null;
try{
  const configFile=path.join(stateDirectory,'tailnet-observer.json'),stat=await fs.lstat(configFile);
  if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)||stat.size>4096)throw Error('Invalid private viewer configuration');
  const config=JSON.parse(await fs.readFile(configFile,'utf8'));
  if(Object.keys(config).some(key=>!['hostname','allowedLogin','port'].includes(key)))throw Error('Invalid private viewer fields');
  const {startTailnetObserver}=await import('../src/workkeel-tailnet.mjs');
  privateViewer=await startTailnetObserver({...config,upstream:new URL(monitor.url).origin,accessToken});
}catch(error){if(error.code!=='ENOENT'){await monitor.close();throw error;}}
// Optional ingestion is separate from the read-only HTTP observer. The local
// operator must explicitly configure existing, authorized binding IDs. No source
// discovery, new binding, conversation request or model call happens here.
const bindingsFile=path.join(stateDirectory,'host-usage-bindings.json');
let collectorTimer=null,collecting=false,collectorPromise=Promise.resolve();
try{
  const stat=await fs.lstat(bindingsFile);
  if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)||stat.size>16384)throw Error('Invalid private host usage configuration');
  const bindings=JSON.parse(await fs.readFile(bindingsFile,'utf8'));
  if(!Array.isArray(bindings)||bindings.length>32||new Set(bindings).size!==bindings.length||bindings.some(id=>typeof id!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(id)))throw Error('Invalid host usage binding list');
  const {collectHostUsage}=await import('../src/workkeel-host-usage.mjs'),failed=new Set();
  const collect=()=>{
    if(collecting)return collectorPromise;
    collecting=true;
    collectorPromise=(async()=>{for(const id of bindings){try{await collectHostUsage(target,id);failed.delete(id);}catch{if(!failed.has(id))console.error('Native usage collection unavailable for binding '+id);failed.add(id);}}})().finally(()=>{collecting=false;});
    return collectorPromise;
  };
  await collect();collectorTimer=setInterval(collect,5000);collectorTimer.unref();
}catch(error){if(error.code!=='ENOENT')throw error;}
await fs.writeFile(path.join(stateDirectory,'access-url.txt'),monitor.url+'\n',{mode:0o600});
console.log('Workkeel observer ready on loopback port '+portValue+'; source '+target);
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{clearInterval(collectorTimer);await collectorPromise;await privateViewer?.close();await monitor.close();process.exit(0);});
