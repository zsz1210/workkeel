import {AsyncLocalStorage} from 'node:async_hooks';
const scope=new AsyncLocalStorage();
const sources=new AsyncLocalStorage();
export function observeSource(root,ref){sources.getStore()?.add(root+'/'+ref);}
export async function trackSources(fn){const dependencies=new Set();return {result:await sources.run(dependencies,fn),dependencies};}
export function observeFileRead(bytes) {const m=scope.getStore();if(m){m.file_reads++;m.source_bytes+=bytes;}}
export async function measureReads(fn) {
  const metrics={file_reads:0,source_bytes:0},start=performance.now();
  const result=await scope.run(metrics,fn);
  return {result,metrics:{...metrics,elapsed_ms:Math.round((performance.now()-start)*100)/100}};
}
