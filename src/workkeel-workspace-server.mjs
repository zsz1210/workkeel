import http from 'node:http';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {readWorkspace,readWorkspaceSnapshot,registerWorkspaceProject,removeWorkspaceProject,projectWorkspaceAttention,projectWorkspaceExecution,projectWorkspaceAnalysis} from './workkeel-workspace.mjs';
import {startTaskMonitor} from './workkeel-monitor.mjs';
import {renderWorkspacePage,workspaceClient,workspaceStyle} from './workkeel-workspace-ui.mjs';

const authenticate=(supplied,token)=>{
  const a=Buffer.from(supplied??''),b=Buffer.from('Bearer '+token);
  return a.length===b.length&&timingSafeEqual(a,b);
};
async function body(req) {
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>64*1024)throw Error('Command exceeds its limit');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const commandHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function readReceipt(file) {
  const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(!handle)return null;
  try {
    const stat=await handle.stat();if(!stat.isFile()||stat.size>128*1024)throw Error('Command receipt exceeds its limit');
    const bytes=Buffer.alloc(stat.size+1);let size=0;
    while(size<bytes.length){const result=await handle.read(bytes,size,bytes.length-size,null);if(!result.bytesRead)break;size+=result.bytesRead;}
    const after=await handle.stat(),entry=await fs.lstat(file);
    if(size!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ctimeMs!==stat.ctimeMs||entry.isSymbolicLink()||entry.ino!==stat.ino||entry.dev!==stat.dev)throw Error('Command receipt changed during read');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size)));
  }finally{await handle.close();}
}
async function writeReceipt(file,record,{create=false}={}) {
  const content=JSON.stringify(record)+'\n';if(Buffer.byteLength(content)>128*1024)throw Error('Command result exceeds its limit');
  const handle=await fs.open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await handle.writeFile(content);await handle.sync();}finally{await handle.close();}
}

/** Read capability and control capability are separate. Host-provided handlers
 * enforce canonical actor/authority, policy revisions and immutable task scope.
 * Attribution here is never presented as provider authentication. */
export async function startWorkspaceServer(stateDir,{port=0,readSnapshot=readWorkspaceSnapshot,control=null,hooks={},observerFactory=startTaskMonitor}={}) {
  if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid workspace port');
  await readWorkspace(stateDir);
  if(control && (!control.actor || !Array.isArray(control.actions) || control.actions.some(a=>typeof a!=='string')))throw Error('Control requires an explicit actor and action allowlist');
  const readToken=randomBytes(32).toString('hex'),writeToken=control?randomBytes(32).toString('hex'):null,nonce=randomBytes(24).toString('base64');
  const page=renderWorkspacePage(nonce),observers=new Map(),pending=new Map();let origin,closed=false,lastSnapshot=null;
  const commandDir=path.join(stateDir,'commands');
  async function executeCommand(kind,command) {
    if(!command || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(command.idempotencyKey??'') || !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion<0 || typeof command.action!=='string' || !command.payload || typeof command.payload!=='object' || Array.isArray(command.payload))throw Error('Invalid command');
    if(!control.actions.includes(command.action)) {const e=Error('This capability does not authorize that action');e.code='FORBIDDEN';throw e;}
    const project=(await readWorkspace(stateDir)).projects.find(p=>p.id===command.project_id);
    if(kind!=='workspace'&&!project)throw Error('Select a registered project');
    const identity=commandHash({kind,command,actor:control.actor}),key=command.idempotencyKey;
    await fs.mkdir(commandDir,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
    if((await fs.lstat(commandDir)).isSymbolicLink())throw Error('Unsafe command store');
    const file=path.join(commandDir,key+'.json');
    const existing=await readReceipt(file);
    if(existing){const record=existing;if(record.request_digest!==identity){const e=Error('Idempotency key binds a different command');e.code='CONFLICT';throw e;}return {...record,replayed:true};}
    if(pending.has(key)){const prior=pending.get(key);if(prior.identity!==identity){const e=Error('Idempotency key binds a different command');e.code='CONFLICT';throw e;}return prior.promise;}
    const operation=(async()=>{
      const registry=await readWorkspace(stateDir);
      if(command.expectedRegistryVersion!==registry.version){const e=Error('Workspace changed; reload before sending a command');e.code='CONFLICT';throw e;}
      const request={schema_version:'workkeel.workspace-command/v1',request_digest:identity,idempotency_key:key,action:command.action,actor:control.actor,status:'submitted',result:null};
      // Reserve before dispatch. A lost connection or restart cannot blindly
      // replay a side effect; the recorded request is reconciled by its host.
      if((await fs.readdir(commandDir)).length>=1000)throw Error('Command receipt inventory limit reached; preserve and reconcile recorded requests');
      try{await writeReceipt(file,request,{create:true});}
      catch(e){if(e.code!=='EEXIST')throw e;const record=await readReceipt(file);if(record.request_digest!==identity){const conflict=Error('Idempotency key conflict');conflict.code='CONFLICT';throw conflict;}return {...record,replayed:true};}
      const hook=hooks[kind];
      try {
        let result;
        if(kind==='workspace'&&command.action==='workspace.register')result=await registerWorkspaceProject(stateDir,command.payload,{expectedVersion:command.expectedVersion});
        else if(kind==='workspace'&&command.action==='workspace.remove')result=await removeWorkspaceProject(stateDir,command.payload.id,{expectedVersion:command.expectedVersion});
        else if(typeof hook?.execute==='function')result=await hook.execute({action:command.action,expectedVersion:command.expectedVersion,idempotencyKey:key,payload:command.payload,project,actor:control.actor});
        else throw Error('This host has no handler for that action');
        const record={...request,status:'confirmed',result};
        const temp=file+'.tmp';await writeReceipt(temp,record);await fs.rename(temp,file);return record;
      }catch(error){
        // Once the handler has been called its outcome may be unknown. Preserve
        // the request and key instead of reporting a reversible failure.
        const record={...request,status:'requires-reconciliation',message:'The request was recorded; check canonical state before retrying.',error_code:error.code??'HOST_UNCONFIRMED'};
        const temp=file+'.reconcile.tmp';await writeReceipt(temp,record);await fs.rename(temp,file);return record;
      }
    })();pending.set(key,{identity,promise:operation});try{return await operation;}finally{pending.delete(key);}
  }
  const server=http.createServer(async(req,res)=>{
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':`default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`};
    const send=(status,data,type='application/json; charset=utf-8')=>{const value=typeof data==='string'?data:JSON.stringify(data);if(Buffer.byteLength(value)>8*1024*1024){res.writeHead(503,headers);res.end('Response exceeds workspace limit');return;}res.writeHead(status,{...headers,'Content-Type':type});res.end(value);};
    if(closed||!origin)return send(503,{error:'Workspace is stopping'});
    if(req.headers.host!==new URL(origin).host || req.headers.origin&&req.headers.origin!==origin || req.headers['sec-fetch-site']==='cross-site')return send(403,{error:'Forbidden origin'});
    let route;try{route=new URL(req.url,origin);}catch{return send(400,{error:'Invalid URL'});}
    const staticAssets=new Map([['/',[page,'text/html; charset=utf-8']],['/workspace.js',[workspaceClient,'text/javascript; charset=utf-8']],['/workspace.css',[workspaceStyle,'text/css; charset=utf-8']]]);
    if(req.method==='GET'&&staticAssets.has(route.pathname)){const [asset,type]=staticAssets.get(route.pathname);return send(200,asset,type);}
    if(!route.pathname.startsWith('/api/'))return send(404,{error:'Not found'});
    const write=['POST','PUT','DELETE'].includes(req.method);
    if(write&&(!writeToken || !authenticate(req.headers.authorization,writeToken)))return send(403,{error:'A separate control capability is required'});
    if(write&&req.headers.origin!==origin)return send(403,{error:'Commands require the exact local origin'});
    if(!write&&!authenticate(req.headers.authorization,readToken))return send(401,{error:'Read capability required'});
    try {
      if(req.method==='GET'&&['/api/execution','/api/analysis'].includes(route.pathname)) {
        const snapshot=await readSnapshot(stateDir),page={limit:Number(route.searchParams.get('limit')??30),offset:Number(route.searchParams.get('offset')??0)};
        if(route.pathname==='/api/execution')return send(200,projectWorkspaceExecution(snapshot,{...page,project_id:route.searchParams.get('project'),task_id:route.searchParams.get('task')}));
        return send(200,projectWorkspaceAnalysis(snapshot,{...page,project:route.searchParams.get('project')??'all',activity:route.searchParams.get('activity')??'all',tool:route.searchParams.get('tool')??'all',model:route.searchParams.get('model')??'all',group:route.searchParams.get('group')??'activity_kind'}));
      }
      if(req.method==='GET'&&route.pathname==='/api/workspace') {
        const snapshot=await readSnapshot(stateDir);
        for(const project of snapshot.projects)if(project.read_status!=='available') {
          const previous=lastSnapshot?.projects.find(p=>p.id===project.id);
          if(previous?.last_confirmed_at){project.last_confirmed_at=previous.last_confirmed_at;project.last_known_goal=previous.goal??previous.last_known_goal??null;
            const oldTasks=lastSnapshot.tasks.filter(task=>task.project_id===project.id);
            for(const task of oldTasks)if(!snapshot.tasks.some(t=>t.key===task.key))snapshot.tasks.push({...task,read_status:'stale',last_confirmed_at:previous.last_confirmed_at});
          }
        }
        snapshot.attention=projectWorkspaceAttention(snapshot.tasks,snapshot.projects);lastSnapshot=structuredClone(snapshot);
        return send(200,{...snapshot,capabilities:{control:!!writeToken,actions:control?.actions??[],hooks:Object.keys(hooks).filter(k=>typeof hooks[k]?.read==='function')}});
      }
      if(req.method==='GET'&&route.pathname==='/api/observer') {
        const id=route.searchParams.get('project'),project=(await readWorkspace(stateDir)).projects.find(p=>p.id===id);
        if(!project)return send(404,{error:'Project not found'});
        if(project.observer_url)return send(200,{url:project.observer_url});
        if(!observers.has(id))observers.set(id,Promise.resolve(observerFactory(project.task_root)));
        try{return send(200,{url:(await observers.get(id)).url});}catch(error){observers.delete(id);throw error;}
      }
      const kind=route.pathname.slice('/api/'.length);
      if(['policy','learning','autonomy','retention'].includes(kind)) {
        if(req.method==='GET') {
          const project=(await readWorkspace(stateDir)).projects.find(p=>p.id===route.searchParams.get('project'));
          if(!project)return send(404,{error:'Select a registered project'});
          if(typeof hooks[kind]?.read!=='function')return send(200,{available:false,reason:'This host has not connected this capability.'});
          return send(200,{available:true,...await hooks[kind].read({project,task:route.searchParams.get('task'),policy_id:route.searchParams.get('policy_id')??'project',actor:control?.actor??null})});
        }
        if(req.method===(kind==='policy'?'PUT':'POST'))return send(200,await executeCommand(kind,await body(req)));
      }
      if(req.method==='POST'&&route.pathname==='/api/workspace')return send(200,await executeCommand('workspace',await body(req)));
      if(req.method==='GET'&&route.pathname==='/api/command') {
        if(!writeToken||!authenticate(req.headers['x-workkeel-control'],writeToken))return send(403,{error:'Control capability required'});
        const key=route.searchParams.get('id');if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(key??''))throw Error('Invalid command key');
        const receipt=await readReceipt(path.join(commandDir,key+'.json'));return receipt?send(200,receipt):send(404,{error:'Request not recorded'});
      }
      return send(405,{error:'Unsupported route or method'});
    }catch(error){return send(error.code==='FORBIDDEN'?403:error.code==='CONFLICT'||error.code==='WORKSPACE_CONFLICT'?409:400,{error:error.message});}
  });
  server.requestTimeout=10000;server.headersTimeout=5000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${server.address().port}`;
  return {url:origin+'/#'+readToken+(writeToken?'/'+writeToken:''),read_url:origin+'/#'+readToken,origin,
    async close(){if(closed)return;closed=true;await Promise.allSettled([...pending.values()].map(p=>p.promise));await Promise.allSettled([...observers.values()].map(async monitor=>(await monitor).close()));await new Promise((resolve,reject)=>{server.close(e=>e?reject(e):resolve());server.closeIdleConnections();});}};
}
