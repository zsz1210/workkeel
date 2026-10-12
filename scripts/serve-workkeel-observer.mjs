import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {startTaskMonitor} from '../src/workkeel-monitor.mjs';
import {startBackgroundCollector} from './workkeel-background-collector.mjs';

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
// operator explicitly configures existing, authorized binding IDs. Reloading the
// list never discovers sources, creates bindings or calls a model.
const bindingsFile=path.join(stateDirectory,'host-usage-bindings.json');
const collector=await startBackgroundCollector(target,bindingsFile);
await fs.writeFile(path.join(stateDirectory,'access-url.txt'),monitor.url+'\n',{mode:0o600});
console.log('Workkeel observer ready on loopback port '+portValue+'; source '+target);
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{await collector.close();await privateViewer?.close();await monitor.close();process.exit(0);});
