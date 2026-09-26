import http from 'node:http';

const routes=new Set(['/','/view.mjs','/client.mjs','/style.css','/analytics.mjs','/dom.mjs','/workkeel-monitor-time.mjs',
  '/api/snapshot','/api/workspace','/api/tasks','/api/task','/api/analysis','/api/activity','/api/changes','/api/library','/api/document']);
// Tailscale Serve strips incoming identity headers and supplies authenticated
// identity. Listen on loopback only; never trust these headers on a LAN listener.
export async function startTailnetObserver({upstream,accessToken,hostname,allowedLogin,port=0}) {
  const target=new URL(upstream);
  if(target.protocol!=='http:'||target.hostname!=='127.0.0.1'||target.pathname!=='/'||target.search||target.hash||target.username||target.password)throw Error('Expected loopback observer origin');
  if(!/^[a-f0-9]{64}$/.test(accessToken)||!/^[-a-z0-9]+\.[-a-z0-9]+\.ts\.net$/.test(hostname??'')||typeof allowedLogin!=='string'||!allowedLogin||allowedLogin.length>320||/[^\x21-\x7e]/.test(allowedLogin))throw Error('Invalid private observer configuration');
  if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid private observer port');
  const origin='https://'+hostname;let active=0;
  const server=http.createServer(async(req,res)=>{
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Type':'text/plain; charset=utf-8','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"};
    const send=(status,body,extra={})=>{if(!res.destroyed){res.writeHead(status,{...headers,...extra});res.end(body);}};
    if(!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||![hostname,hostname+':443'].includes(req.headers.host)||req.headers['tailscale-user-login']!==allowedLogin)return send(403,'Private Workkeel access only');
    if(req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')return send(403,'Forbidden origin');
    if(req.method!=='GET')return send(405,'Read-only observer');
    if(!req.url?.startsWith('/')||req.url.startsWith('//')||req.url.includes('\\')||req.url.length>8192)return send(400,'Invalid request');
    let url;try{url=new URL(req.url,origin);}catch{return send(400,'Invalid request');}
    if(url.origin!==origin)return send(400,'Invalid request');
    if(!routes.has(url.pathname))return send(404,'Not found');
    if(active>=16)return send(429,'Observer busy');
    active++;
    const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),15000);
    const stop=()=>abort.abort();res.once('close',stop);
    try {
      const response=await fetch(target.origin+url.pathname+url.search,{headers:{Authorization:'Bearer '+accessToken},redirect:'error',signal:abort.signal});
      const chunks=[];let size=0;
      for await(const chunk of response.body){size+=chunk.length;if(size>4*1024*1024)throw Error('Response limit');chunks.push(chunk);}
      let body=Buffer.concat(chunks);
      if(url.pathname==='/'&&response.status===200){
        const html=body.toString('utf8'),marker='<html lang="zh-Hant">';
        if(!html.includes(marker))throw Error('Unexpected observer page');
        body=Buffer.from(html.replace(marker,'<html lang="zh-Hant" data-observer-auth="tailscale">'));
      }
      send(response.status,body,{'Content-Type':response.headers.get('content-type')??'text/plain; charset=utf-8',
        'Content-Security-Policy':response.headers.get('content-security-policy')??headers['Content-Security-Policy']});
    }catch{send(502,'Workkeel observer is unavailable');}
    finally{clearTimeout(timeout);res.removeListener('close',stop);active--;}
  });
  server.requestTimeout=10000;server.headersTimeout=5000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {port:server.address().port,origin,close:()=>new Promise((resolve,reject)=>{server.close(e=>e?reject(e):resolve());server.closeAllConnections();})};
}
