import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {crc32, inflateSync} from 'node:zlib';

// Screenshots are evidence, so a filename or PNG signature alone is insufficient.
// Chrome produces non-interlaced, eight-bit RGB/RGBA PNGs. Bound the decoded size
// before inflation and validate every chunk, scanline filter and compressed byte.
export function assertScreenshotPNG(data) {
  const invalid = () => { throw Error('Browser evidence is not a complete supported PNG screenshot'); };
  if (!data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) invalid();
  let offset=8, width=0, height=0, channels=0, ended=false, idatEnded=false;
  const compressed=[];
  while (offset < data.length) {
    if (data.length-offset < 12) invalid();
    const size=data.readUInt32BE(offset), end=offset+12+size;
    if (end>data.length) invalid();
    const type=data.toString('latin1',offset+4,offset+8), body=data.subarray(offset+8,end-4);
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type)) invalid();
    if (crc32(data.subarray(offset+4,end-4))!==data.readUInt32BE(end-4)) invalid();
    if (offset===8 && type!=='IHDR') invalid();
    if (type==='IHDR') {
      if (offset!==8 || size!==13) invalid();
      width=body.readUInt32BE(0); height=body.readUInt32BE(4);
      if (!width || !height || width>10000 || height>10000 || width*height>16000000 || body[8]!==8 || ![2,6].includes(body[9]) || body[10] || body[11] || body[12]) invalid();
      channels=body[9]===6?4:3;
    } else if (type==='IDAT') {
      if (idatEnded) invalid();
      compressed.push(body);
    } else {
      if (compressed.length) idatEnded=true;
      if (type==='IEND') { if (size || end!==data.length) invalid(); ended=true; }
      else if (!/^[a-z][A-Za-z]{3}$/.test(type)) invalid();
    }
    offset=end;
  }
  if (!ended || !compressed.length) invalid();
  const bytes=Buffer.concat(compressed), stride=width*channels+1, expected=stride*height;
  let decoded;
  try { decoded=inflateSync(bytes,{maxOutputLength:expected,info:true}); } catch { invalid(); }
  if (decoded.buffer.length!==expected || decoded.engine.bytesWritten!==bytes.length) invalid();
  for (let row=0; row<height; row++) if (decoded.buffer[row*stride]>4) invalid();
  return {width,height};
}

async function closeBrowser(endpoint) {
  if (!endpoint) return;
  await new Promise(resolve=>{
    const socket=new WebSocket(endpoint), timer=setTimeout(()=>{socket.close();resolve();},1000);
    socket.addEventListener('open',()=>socket.send(JSON.stringify({id:1,method:'Browser.close'})),{once:true});
    const done=()=>{clearTimeout(timer);socket.close();resolve();};
    socket.addEventListener('close',done,{once:true});socket.addEventListener('error',done,{once:true});
  });
}

// The coordinator owns Chrome. The approved check connects to it, but its OS
// profile forbids process-fork, including detached children. Browser processes
// get a separate profile and are shut down before reporting settled execution.
export async function withOwnedBrowser({chrome,profile,port,scratch,cwd,env,signal,timeout_ms},check) {
  const lifetime=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(timeout_ms)]);
  lifetime.throwIfAborted();
  const args=['--headless','--no-sandbox','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--disable-extensions','--disable-breakpad','--disable-crash-reporter','--disable-crashpad-for-testing','--disable-dev-shm-usage','--disable-features=MediaRouter,OptimizationHints','--metrics-recording-only','--password-store=basic','--use-mock-keychain','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port,'--user-data-dir='+scratch+'/chrome-profile','about:blank'];
  const child=spawn('/usr/bin/sandbox-exec',['-p',profile,chrome,...args],{cwd,env,detached:true,stdio:['ignore','ignore','pipe']});
  let finished=false, launchError, endpoint, diagnostics='';
  const settled=new Promise(resolve=>{child.once('error',e=>{launchError=e;finished=true;resolve();});child.once('close',()=>{finished=true;resolve();});});
  child.stderr.on('data',data=>{if(diagnostics.length<8192)diagnostics+=data.toString().slice(0,8192-diagnostics.length);});
  const kill=()=>{if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}};
  const abort=()=>{kill();};lifetime.addEventListener('abort',abort,{once:true});
  try {
    const deadline=Date.now()+Math.min(timeout_ms,15000);
    while (!endpoint) {
      lifetime.throwIfAborted();
      if (finished) throw Error('Owned browser exited before readiness: '+(launchError?.message??diagnostics));
      if (Date.now()>=deadline) throw Error('Owned browser readiness timed out: '+diagnostics);
      try {
        const response=await fetch('http://127.0.0.1:'+port+'/json/version',{signal:AbortSignal.any([lifetime,AbortSignal.timeout(400)])});
        const version=await response.json(), candidate=new URL(version.webSocketDebuggerUrl);
        if (candidate.protocol!=='ws:' || candidate.hostname!=='127.0.0.1' || candidate.port!==String(port) || !candidate.pathname.startsWith('/devtools/browser/')) throw Error('Unexpected browser endpoint');
        endpoint=candidate.href;
      } catch { await delay(50,undefined,{signal:lifetime}); }
    }
    return await check({endpoint,signal:lifetime});
  } finally {
    try {
      if (!finished) await closeBrowser(endpoint);
      await Promise.race([settled,delay(1500)]);
      kill();await settled;
    } finally { lifetime.removeEventListener('abort',abort); }
  }
}
